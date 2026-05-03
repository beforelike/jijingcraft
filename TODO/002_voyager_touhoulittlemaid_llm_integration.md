# 002 Voyager、TouhouLittleMaid、Ponderer 与 Patchouli LLM 集成分析报告

## 背景

当前项目已经实现了一个基于 Mineflayer 的第一阶段生存 BOT：连接 `localhost:8000`，通过规则状态机完成避险、采集、制作、石器升级、食物储备、带门庇护所、夜间防御、记忆和失败学习。

用户要求分析项目目录中的 `Voyager-main.zip` 和 `TouhouLittleMaid-1.20.zip`，结合当前 BOT 设计一个后续 LLM 大模型驱动方案。随后又加入 `Ponderer-1.20.1.zip` 和 `Patchouli-1.21.x.zip`，需要判断这两个“思索/文档”模组源码能否在本项目中起作用。LLM 相关配置已经放在 `.env.example`，当前包含 `BSAE_URL`、`API_KEY`、`MODEL` 三个字段。报告中不展开实际密钥内容，只描述配置读取方式和安全约束。

## 资料检查结果

### Voyager-main.zip

Voyager 是一个 Python 编排、Node/Mineflayer 执行的 Minecraft 终身学习 Agent。核心源码位于 `Voyager-main/voyager/`，关键模块包括：

- `voyager.py`：主流程，暴露 `learn()`、`rollout()`、`step()`、`decompose_task()`、`inference()`。
- `agents/curriculum.py`：自动课程代理，根据观察、历史完成任务、失败任务和 QA 上下文生成下一目标。
- `agents/action.py`：行动代理，把环境观察、任务、错误、批评意见和可用技能拼成 Prompt，让 LLM 生成 JavaScript 异步函数。
- `agents/critic.py`：评价代理，判断当前任务是否成功，并给出 critique。
- `agents/skill.py`：技能管理器，把成功生成的 JS 程序保存到技能库，生成技能描述，并用向量检索复用技能。
- `env/bridge.py`：Python Gym 环境桥接，启动 Node Mineflayer 服务，通过 HTTP `/start`、`/step`、`/pause`、`/stop` 与执行端通信。
- `env/mineflayer/index.js`：Node 执行服务，创建 Mineflayer bot，收集观察事件，执行传入代码。
- `control_primitives/` 与 `control_primitives_context/`：给 LLM 使用的基础动作和动作说明，例如 `mineBlock`、`craftItem`、`exploreUntil`、`killMob`、`smeltItem`。
- `skill_library/`：已经学到的 JS 技能、文本描述和 Chroma 向量库。

Voyager 的基本闭环是：

1. 环境桥接启动 Mineflayer 服务并连接 Minecraft。
2. CurriculumAgent 基于观察提出下一个探索任务。
3. SkillManager 按任务检索相关技能代码。
4. ActionAgent 把任务、观察、上次代码、执行错误、技能和基础动作说明交给 LLM。
5. LLM 输出一个 `async function xxx(bot)` JS 函数。
6. ActionAgent 用 Babel 解析代码，找到最后一个 `async` 主函数并生成 `await xxx(bot);`。
7. Mineflayer 执行服务运行代码，返回观察、聊天、错误和保存事件。
8. CriticAgent 判断任务成功与否。
9. 成功则 SkillManager 保存新技能，失败则把 critique 反馈给下一轮代码生成。
10. CurriculumAgent 记录成功/失败任务，继续提出下一目标。

Voyager 的优势是会持续积累可复用技能，并且能把失败错误反馈到下一次代码生成。它的问题也很明显：原版默认流程偏研究环境，README 中要求 Creative、Peaceful、LAN cheats，且大量依赖 LLM 生成代码。直接照搬到当前无作弊生存 BOT，会带来安全、卡死、幻觉代码和生存风险。

### TouhouLittleMaid-1.20.zip

TouhouLittleMaid 是 Forge/NeoForge 女仆模组，本 zip 对应 Minecraft `1.20.1`、Forge `47.2.0`、Java 17。入口是 `TouhouLittleMaid.java`，启动时注册实体、属性、Memory Module、Sensor、Schedule、Activity、方块、物品、容器、声音、配方、战利品修改器、命令参数和 POI。

该项目不只是传统实体 AI，已经包含完整 LLM 聊天/工具调用框架。关键模块包括：

- `ai/service/llm/`：LLM 抽象层，包含 `LLMClient`、`LLMSite`、`LLMMessage`、`Role`、`DefaultLLMSite`。
- `ai/service/llm/openai/`：OpenAI 兼容实现，`LLMOpenAIClient` 组装 Chat Completions 请求，支持 Bearer Key、模型选择、额外 header、工具调用、reasoning/developer 消息兼容和 thinking 字段控制。
- `ai/manager/entity/MaidAIChatManager.java`：女仆聊天管理，负责构造角色设定、历史消息、上下文、TTS/STT、自动设定和摘要。
- `ai/manager/entity/LLMCallback.java`：LLM 回调和工具调用处理，支持最多工具轮数、重复工具批次限制、并发/异步工具调用、工具结果回写和再次调用 LLM。
- `ai/agent/tool/ITool.java`：工具接口，定义工具 ID、摘要、参数 schema、Codec 解码、同步/异步执行、触发条件和调用摘要。
- `ai/agent/tool/ToolRegister.java`：注册工具，包括 `use_skill`、查询 Minecraft Wiki、查询游戏上下文、切换跟随、切换工作任务、切换日程、切换坐下。
- `ai/agent/skill/SkillLoader.java`：从配置目录和数据包加载 `skill.md`，并生成可被 `use_skill` 工具调用的技能实例。
- `ai/agent/context/GameContextRegister.java`：注册和查询可暴露给 LLM 的游戏上下文，例如女仆状态、装备、附近实体、位置、用户上下文等。

TouhouLittleMaid 的 LLM 流程更接近“工具调用式智能体”：

1. 玩家与女仆交互或聊天。
2. MaidAIChatManager 汇总女仆设定、历史摘要、当前语言和游戏上下文。
3. LLMOpenAIClient 发送 OpenAI 兼容 Chat Completion 请求。
4. 如果需要工具，ToolRegister 中的工具根据 `trigger()` 判断是否暴露给模型。
5. 模型返回文本或 function/tool call。
6. LLMCallback 解码工具参数，执行工具，追加 tool result。
7. 继续请求 LLM，直到得到最终文本或达到工具轮数限制。
8. 最终响应进入聊天气泡、TTS 或游戏行为切换。

与 Voyager 相比，TouhouLittleMaid 不让模型任意生成代码，而是让模型在受控工具集合中选择动作，稳定性和安全性更适合当前生存 BOT。

### Ponderer-1.20.1.zip

Ponderer 是 Minecraft `1.20.1` 的数据驱动 Ponder 场景编辑/播放模组，支持 Forge `47.2.6+` 和 Fabric `0.16.9+`，Java 17。核心能力不是控制实体行为，而是把结构、操作提示、文字说明和方块变化组织成可视化“思索”教程。

源码中与本项目相关的关键点：

- `README.md` 明确支持 JSON DSL 场景定义、游戏内可视化编辑、AI 场景生成、热重载、客户端/服务端同步、PonderJS 导入导出和资源包格式导入导出。
- `Common/src/main/resources/data/ponderer/default_scripts/ponderer_example.json` 展示了场景数据格式：`id`、`items`、多语言 `title`、`structures`、`scenes`、`steps`，步骤类型包括 `show_structure`、`text`、`idle`、`show_controls`、`set_block`、`replace_blocks`、`destroy_block` 等。
- `DynamicPonderPlugin` 会遍历 `SceneRuntime.getScenes()`，把 JSON DSL 注册成 Ponder storyboard；支持结构展示、文字、控制提示、界面演示、方块替换/破坏、实体、镜头、红石和多段场景。
- `DslScene` 定义了稳定的数据模型，还支持 `triggerMode`、结构/坐标触发、`nbtFilter`、多语言文本、场景包归属和只读/可编辑标记。
- `AiSceneGenerator` 已经实现两阶段 LLM 场景生成：先让模型生成 outline 和 `REQUIRED_ELEMENTS`，再结合结构描述、注册表映射和用户提示生成 JSON，并做解析重试、保存和重载。
- `OpenAiCompatProvider` 与 `AnthropicProvider` 支持 OpenAI 兼容 `/v1/chat/completions` 和 Anthropic Messages API；`Config` 中可配置 provider、base URL、API key、model、proxy 和 max tokens。

Ponderer 对当前项目的价值是“可解释技能演示”和“训练/复盘材料生成”。例如 BOT 学会一个 `early_stone_tools` 技能后，可以生成一个 Ponderer JSON：展示先砍树、合成工作台/木镐、优先找地表裸露石头、再合成石镐石剑。又比如庇护所被怪物攻破后，可以把失败前后的结构差异转成一个 Ponderer 场景，给开发者和后续 LLM 解释“为什么这个门洞/屋顶不安全”。

不建议把 Ponderer 当成当前 BOT 的运行时控制器。它依赖 Ponder/Create 生态和 Minecraft 客户端渲染，不会替代 Mineflayer 的寻路、采集、制作和战斗；并且当前源码目标是 `1.20.1`，与 live server `1.21.11` 不一致。

### Patchouli-1.21.x.zip

Patchouli 是 Minecraft 模组和整合包常用的游戏内手册系统，当前源码 `gradle.properties` 指向 `mc_version=1.21.1`、build `94`。它的定位是“可访问、数据驱动、弱依赖的文档系统”，不是 Agent 执行框架。

源码中与本项目相关的关键点：

- `PatchouliAPI` 暴露稳定 API：打开书本/条目、获取书本物品、注册模板、注册文本命令/函数、注册和展示 multiblock、多方块状态 matcher 等。
- 1.20 之后书本资源基于资源包：`book.json` 位于 `/data/<namespace>/patchouli_books/<book>/book.json`，正文内容位于 `/assets/<namespace>/patchouli_books/<book>/<lang>/categories|entries|templates`；外部 `.minecraft/patchouli_books` 仍可继续同目录放置。
- 示例 `book.json` 只声明书本元数据，例如 `name`、`landing_text`、`subtitle`、`creative_tab`、`use_resource_pack`。
- 示例 entry JSON 由 `name`、`icon`、`category` 和 `pages` 组成，页面类型可以承载文字、物品、配方、多方块等内容。
- `PatchouliAPIImpl` 可以通过网络消息打开指定玩家的书本或条目；`ItemModBook` 使用该 API 在玩家使用书本时打开 GUI。
- Multiblock API 可以把结构模式和 matcher 注册为可视化/可验证结构，这一点对庇护所、农田、围栏、矿道入口等 BOT 建筑蓝图很有价值。

TouhouLittleMaid 已经提供了 Patchouli 兼容用法：`PatchouliCompat` 初始化多方块注册并在客户端注册打开书本事件；`MultiblockRegistry` 用 `PatchouliAPI.get().makeMultiblock()` 注册祭坛结构；`OpenDefaultBook` 在任务相关事件中打开 `memorizable_gensokyo` 手册；`AltarRecipeComponent` 通过 `IComponentProcessor` 把游戏配方数据注入书本模板。

Patchouli 对当前项目的价值是“结构化知识库”和“游戏内说明书”。它可以把 BOT 的阶段目标、白名单任务、工具使用规则、庇护所蓝图、危险方块说明、失败案例和长期技能库写成条目，供人阅读，也可以被 LLM 检索为受控知识来源。多方块功能还可以作为未来 Forge/NeoForge 桥接版本中的建筑验证参考，例如检查入门庇护所是否满足墙体、屋顶、门和内部空间约束。

不建议把 Patchouli 当成当前 Node/Mineflayer BOT 的直接依赖。当前 BOT 不运行在 Forge/NeoForge 模组端，Patchouli GUI 和 API 也不会直接影响 Mineflayer 行为。更稳的做法是先生成 Patchouli 风格 JSON/Markdown 知识，再在需要模组客户端展示时打包成资源包或配套 mod。

## 与当前项目的关系

当前项目的优势是“可执行动作已经稳定”：`SurvivalController` 里已经实现了吃食物、采木、制作、采石、石器升级、狩猎、庇护所、夜间等待、撤离、反击、记忆、坑洞逃生和失败学习。`decision.js` 是确定性策略入口，`memoryStore.js` 是本地生存记忆，`progress.js` 是阶段进度模型。

因此不建议第一步让 LLM 直接生成 Mineflayer JS 代码。更稳妥的路线是：

- 借鉴 Voyager 的“课程/行动/评价/技能库/反思”闭环。
- 借鉴 TouhouLittleMaid 的“OpenAI 兼容客户端 + 工具调用 + 上下文注册 + 工具轮数限制”。
- 保留当前规则状态机作为安全底座，让 LLM 只做高层目标选择、任务排序、失败解释和策略调整。

换句话说，当前 BOT 的下一阶段应是“LLM 高层规划 + 规则执行器”，而不是“LLM 直接控制键鼠或直接 eval 代码”。

## 兼容性判断

- 当前 live server 曾验证为 `1.21.11` / protocol `774`，而 TouhouLittleMaid zip 是 Forge `1.20.1` 项目，不能直接作为当前服务器 mod 加载。
- TouhouLittleMaid 仍然很有价值：它的 LLM 工具调用、技能加载、上下文组织、回调限制和 token 限制设计可以作为本项目 Node 端架构参考。
- Ponderer 当前主版本是 Minecraft `1.20.1`，Patchouli 当前源码是 `1.21.1`，都与 live server `1.21.11` 不完全一致，不能作为当前 Mineflayer BOT 的直接运行时控制依赖。
- Ponderer/Patchouli 仍然很有价值：Ponderer 适合作为技能演示、失败复盘和可解释教程输出格式；Patchouli 适合作为结构化知识库、阶段手册和建筑蓝图/多方块验证参考。
- Voyager 使用 Python、LangChain、Chroma、OpenAIEmbeddings 和 Node Mineflayer 服务，栈较重；当前项目是纯 Node/CommonJS，建议先用 Node 实现一个轻量版 Voyager 闭环，不急着引入 Python 运行时。
- `.env.example` 当前字段为 `BSAE_URL`，可能是 `BASE_URL` 的拼写错误。实现时建议读取 `BASE_URL || BSAE_URL` 兼容旧配置，文档中逐步迁移到 `LLM_BASE_URL` 或 `BASE_URL`。
- `.env.example` 不适合长期保存真实 API Key。实际开发建议把真实密钥放进 `.env`，`.env.example` 只保留占位值。

## 建议总体架构

### 1. 安全底座

安全底座继续由现有规则系统控制。以下任务永远不交给 LLM 决定是否执行：

- 低血量进食。
- 受伤后撤离或重定位。
- 岩浆、水域、仙人掌、甜浆果等危险规避。
- 夜间临时庇护、撤离和最后反击。
- 坑洞逃生、无效坐标恢复、断线重连。

LLM 输出的计划只能在安全底座允许的窗口中执行。如果 `decision.js` 判断当前处于危险状态，LLM 计划必须暂停。

### 2. LLM Planner

新增 `src/llm/` 模块，使用 OpenAI 兼容 API 调用 `.env.example` 中的模型配置。Planner 输入应包含：

- 当前状态快照：生命、饥饿、时间、位置、维度、生物群系、附近实体、附近方块、危险状态。
- 背包和装备摘要。
- `progress.js` 的阶段结果。
- `memoryStore.js` 的关键记忆：房屋、工作台、危险点、失败冷却、最近目标。
- 当前可执行任务清单。
- 不可违反的安全规则。

Planner 输出必须是严格 JSON，不允许直接输出代码。推荐格式：

```json
{
  "goal": "build_reusable_shelter",
  "priority": "high",
  "tasks": ["collect_building_materials", "build_shelter"],
  "constraints": ["avoid_water", "do_not_explore_at_night"],
  "reason": "stone tools and starter food are ready; fixed shelter is still unusable"
}
```

### 3. 工具调用层

参考 TouhouLittleMaid 的 `ITool` 和 `ToolRegister`，在 Node 中定义受控工具集合：

- `query_status`：查询当前 BOT 状态快照。
- `query_progress`：查询当前第一阶段进度。
- `query_memory`：查询已知房屋、工作台、危险点、失败点。
- `set_goal`：设置当前高层目标。
- `enqueue_task`：把高层动作加入执行队列。
- `cancel_goal`：取消当前目标。
- `record_lesson`：把失败原因写入长期记忆。
- `request_search`：需要外部资料时标记需要使用 Multi Search Engine，由开发/运维侧执行，不让游戏内 BOT 直接无边界联网。

工具调用层要限制最大轮数，例如 TouhouLittleMaid 的 `MAX_TOOL_TURN_COUNT` 和重复工具批次限制，避免模型在同一工具调用上循环。

### 4. 执行适配层

新增 `src/survival/taskExecutor.js` 或在 `SurvivalController` 外侧增加 `TaskQueue`。LLM 只能投递现有动作名，执行层负责映射：

- `collect_wood` -> 当前采木逻辑。
- `craft_basic_supplies` -> 当前基础制作逻辑。
- `collect_stone` -> 当前地表优先安全采石。
- `craft_stone_tools` -> 当前石器升级。
- `hunt_food` -> 当前狩猎/浆果逻辑。
- `collect_building_materials` -> 当前建筑材料收集。
- `build_shelter` -> 当前带门固定庇护所建造。
- `plant_crops`、`build_animal_pen`、`mine_advanced_materials` -> 当前基地后续逻辑。

如果 LLM 提出未知任务，执行层直接拒绝并把错误反馈给 Critic/Planner。

### 5. Critic / Evaluator

参考 Voyager 的 CriticAgent，在每个 LLM 目标执行后进行评价：

- 规则评价优先：检查进度、背包、坐标、血量、房屋可用性。
- LLM 评价只用于解释失败、调整下一步计划，不直接覆盖事实判断。
- 每次失败记录 `goal`、`task`、`reason`、`position`、`snapshot` 到 `memoryStore.learning`。

### 6. 技能库

第一阶段技能库不采用 Voyager 的“成功后保存任意 JS 代码”，而采用更稳的 Markdown/JSON 描述：

```json
{
  "name": "early_stone_tools",
  "description": "Get wood, craft table and pickaxe, collect safe surface stone, craft stone pickaxe and sword.",
  "tasks": ["collect_wood", "craft_basic_supplies", "craft_basic_tools", "collect_stone", "craft_stone_tools"],
  "preconditions": ["daytime_or_safe_shelter", "not_in_hazard"],
  "success": ["has_stone_pickaxe", "has_stone_sword"]
}
```

后续如果要尝试 Voyager 式技能生成，必须加 AST 白名单、禁止 `require`/文件/网络/进程访问、动作超时、沙箱和回滚机制。

### 7. 知识与教程层

Ponderer 和 Patchouli 可以作为第二阶段的“知识/教程/复盘层”，而不是实时控制层：

- Patchouli 风格知识库：把每个阶段目标、任务白名单、危险规则、建筑蓝图、工具升级条件和失败案例保存为 `data/knowledge/*.json` 或 Markdown，再按需要导出为 Patchouli book 资源包。
- Ponderer 风格技能演示：把成功技能或失败复盘生成 `data/tutorials/ponderer/*.json`，包含结构、步骤、文字、操作提示和方块变化。
- LLM 检索输入：Planner 可检索这些知识条目，但只能引用事实和策略，不能从中获得直接执行任意代码的权限。
- 人类可视化调试：当 BOT 频繁失败时，把当前房屋结构、失败路径或工具升级顺序生成教程/复盘，方便开发者快速看懂问题。
- 未来模组端展示：如果后续切到兼容 Forge/NeoForge/Fabric 服务器，可以把这些 JSON 打包成 Ponderer/Patchouli 内容，在游戏内直接打开书本或播放思索场景。

这层和现有 `memoryStore.js` 的关系是：memory 记录事实和失败，knowledge 负责沉淀为可复用策略，tutorial 负责把策略转成可视化解释。

## 实现流程

### 阶段 A：配置与 LLM 客户端

1. 在 `src/config.js` 增加 `llm` 配置段：
   - `enabled`
   - `baseUrl`，兼容 `BASE_URL`、`LLM_BASE_URL` 和当前 `BSAE_URL`
   - `apiKey`
   - `model`
   - `timeoutMs`
   - `maxToolTurns`
   - `plannerIntervalMs`
2. 新增 `src/llm/client.js`：实现 OpenAI 兼容 `/chat/completions` 请求。
3. 日志中必须屏蔽 API Key，只输出 baseUrl host、model 和请求耗时。
4. 新增配置解析测试，覆盖 `BSAE_URL` 兼容和缺 Key 时禁用 LLM。

### 阶段 B：上下文快照

1. 新增 `src/llm/contextBuilder.js`。
2. 从 `SurvivalController` 和 `progress.js` 抽取压缩后的状态：
   - 生存状态
   - 进度阶段
   - 背包摘要
   - 已知资源点
   - 失败学习摘要
3. 控制上下文长度，避免把完整 `survival-memory.json` 全塞给模型。
4. 新增单元测试，固定快照格式。

### 阶段 C：工具注册与计划 schema

1. 新增 `src/llm/tools/`。
2. 实现 `ToolRegistry`，每个工具包含 `name`、`description`、`parameters`、`execute()`。
3. 实现第一批只读工具：`query_status`、`query_progress`、`query_memory`。
4. 实现计划输出 JSON schema 校验，拒绝未知 task、危险 constraint 或格式错误。
5. 新增测试覆盖工具参数校验、未知工具拒绝、重复工具轮数限制。

### 阶段 D：Planner 与现有状态机融合

1. 新增 `src/llm/planner.js`。
2. 在 `decision.js` 外层增加高层目标入口，但保留当前危险优先级。
3. 只有在以下状态允许调用 LLM：
   - 非受伤应急中。
   - 非夜间无庇护危险状态。
   - 非采集/寻路 busy。
   - 与上次 LLM 调用间隔超过 `plannerIntervalMs`。
4. LLM 输出只设置高层目标和候选 task，不直接执行 Mineflayer API。
5. 如果 LLM 不可用或请求失败，自动回退当前规则状态机。

### 阶段 E：目标队列与执行器

1. 新增目标队列，把 LLM 的 `tasks` 映射到已有动作。
2. 每轮执行前仍调用安全检查，安全任务可打断 LLM 目标。
3. 执行结果写回 memory：成功、失败、超时、被安全策略打断。
4. 新增测试：LLM 计划 `collect_stone -> craft_stone_tools` 时，执行器按当前动作映射；未知任务被拒绝。

### 阶段 F：评价与技能库

1. 新增 `src/llm/evaluator.js`。
2. 先用规则判断目标是否完成，再调用 LLM 生成失败解释或下一步建议。
3. 新增 `data/skills/*.json` 或 `data/skills/*.md`，维护静态技能库。
4. 根据任务目标检索相关技能，加入 Planner prompt。
5. 新增测试：技能检索、评价结果、失败教训写入。

### 阶段 G：可选 TouhouLittleMaid 桥接

如果后续服务器切换到 Forge `1.20.1` 并实际安装 TouhouLittleMaid，可以考虑：

1. 编写一个轻量 Forge 辅助 mod 或使用现有女仆 AI 工具，暴露 HTTP/WebSocket 事件。
2. Node BOT 通过桥接读取女仆上下文、任务状态和聊天事件。
3. 当前 Mineflayer BOT 仍作为玩家代理，TouhouLittleMaid 作为游戏内 NPC/工具层。

当前不建议直接做这个阶段，因为 live server 与 TouhouLittleMaid zip 的 Minecraft 版本不一致。

### 阶段 H：Ponderer/Patchouli 知识与教程层

这个阶段可以独立于当前 Mineflayer 运行时先做，不要求服务器安装 Ponderer 或 Patchouli：

1. 新增 `data/knowledge/`，定义 Patchouli 风格知识条目：阶段、任务、前置条件、成功条件、危险点、推荐工具、相关记忆字段。
2. 新增 `data/tutorials/ponderer/`，定义 Ponderer 风格演示 JSON：技能 ID、触发物品、结构池、场景步骤、中文说明。
3. 新增 `src/knowledge/` 工具：把技能库和失败学习记录导出为 Markdown/JSON，供 LLM Planner 检索。
4. 对庇护所、农田、围栏、矿道入口定义 `blueprint` schema；短期由 Node 规则检查，长期可导出为 Patchouli multiblock。
5. 当某个目标连续失败时，自动生成一条复盘知识：失败目标、失败坐标、危险源、当时装备、建议修正。
6. 如果后续迁移到兼容模组端，再把 `data/knowledge` 导出为 Patchouli book，把 `data/tutorials/ponderer` 导出为 Ponderer scene pack。
7. 这层只负责解释、检索和展示，不允许直接调用 Mineflayer API，也不覆盖安全底座。

## 推荐 Prompt 边界

系统 Prompt 应明确：

- 你不是直接控制 Minecraft API 的代码生成器。
- 你只能选择给定 task 列表中的动作。
- 安全策略不可覆盖。
- 夜间、低血、受伤、危险方块、溺水、岩浆和坑洞由规则控制器接管。
- 输出必须是 JSON。
- 如果信息不足，选择 `query_status` 或返回 `need_more_info`。

## 风险与规避

- 密钥泄漏：不要把真实 `API_KEY` 放入报告、日志或提交；运行时用 `.env`。
- 字段拼写：当前 `BSAE_URL` 应兼容读取，但建议迁移到 `BASE_URL` 或 `LLM_BASE_URL`。
- 幻觉动作：只允许白名单任务。
- 工具循环：设置最大工具轮数、重复工具批次限制。
- 生存安全：LLM 不可覆盖危险优先级。
- 延迟：LLM 调用应异步缓存计划，不阻塞紧急控制循环。
- 版本不兼容：TouhouLittleMaid `1.20.1` 不能直接用于当前 `1.21.11` 服务器。
- 文档模组误用：Ponderer/Patchouli 不是 BOT 控制框架，只能作为知识、教程、蓝图和复盘层；当前阶段不要把它们放进 Node 运行路径。
- 知识过期：BOT 行为更新后需要同步更新 Patchouli/Ponderer 风格知识条目，避免 LLM 检索到旧策略。
- Voyager 式代码生成风险：先禁用任意代码生成，只保留静态技能和受控任务；后续若启用，必须沙箱化。

## 最小可行版本

最小可行版本不需要改 Mineflayer 执行动作，只增加 LLM 规划层：

1. 读取 `.env`/`.env.example` 的模型配置。
2. 构建当前状态快照。
3. 把可执行任务白名单和安全规则发送给模型。
4. 模型返回高层目标和任务序列。
5. 执行器按现有 `SurvivalController` 动作逐步执行。
6. 失败后把原因反馈给下一次规划。
7. LLM 不可用时完全回退规则状态机。

这样可以同时吸收 Voyager 的长期学习思路、TouhouLittleMaid 的工具调用稳定性，以及 Ponderer/Patchouli 的知识沉淀和可视化解释能力，又不会破坏当前已经调好的生存可靠性。