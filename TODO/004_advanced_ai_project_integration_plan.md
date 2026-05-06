# 004 Advanced AI Project Integration Plan

## 当前结论

本项目现在的“高级功能”主要停在知识导出层：`src/knowledge/survivalSkills.js`、`src/knowledge/toolRegistry.js` 和 `src/knowledge/exportKnowledge.js` 已经能把生存技能整理成受控技能、Patchouli 风格条目和 Ponderer 风格场景，但这些内容没有进入 `SurvivalController.tick()` 的运行闭环。主循环仍然是 `snapshot -> decideNextTask() -> execute()` 的规则状态机，所以当前没有 LLM 请求、没有工具调用轮次、没有模型响应记录，也没有 LLM 评价/反思日志。

用户反馈“功能都不好”的根因不是单个动作缺一两个判断，而是系统结构还没有形成真正的智能体闭环：缺少高层目标规划、失败解释、长期课程、任务队列、模型调用审计、技能检索复用、建筑蓝图验证和可视化复盘。继续只在 `SurvivalController` 里堆规则，会越来越难维护。

## 参考项目结构分析

### Voyager

Voyager 是“课程代理 + 行动代理 + 评价代理 + 技能库”的长期学习闭环：

- `voyager/voyager.py` 串联 `CurriculumAgent`、`ActionAgent`、`CriticAgent`、`SkillManager`。
- `agents/curriculum.py` 根据观察、已完成任务、失败任务和 QA 上下文提出下一目标。
- `agents/action.py` 把任务、上下文、上次代码、执行错误、聊天记录和技能代码发给 LLM，要求模型生成 Mineflayer JS。
- `agents/critic.py` 用 LLM 判断任务是否完成，并返回 critique。
- `agents/skill.py` 把成功代码保存为技能，生成描述，并用向量库检索复用。
- `env/mineflayer/index.js` 是执行端，负责观察和执行传入代码。

可借鉴：课程、评价、失败反馈、技能检索、执行记录。

不能直接照搬：当前 BOT 是真实生存服务器，不应该让 LLM 直接生成并 eval 任意 JS；Voyager 默认更偏研究环境，安全边界不适合当前阶段。

### TouhouLittleMaid

TouhouLittleMaid 的 LLM 架构更适合当前项目，因为它让模型调用受控工具而不是任意写代码：

- `ITool.java` 定义工具 ID、摘要、参数 schema、Codec 解码、同步/异步执行、调用摘要和 trigger。
- `ToolRegister.java` 集中注册 `use_skill`、查询上下文、切换任务/日程/状态等工具。
- `GameContextRegister.java` 把世界、装备、位置、附近实体、用户上下文等分成可按需查询的上下文分类。
- `SkillLoader.java` 从配置目录和数据包加载 `skill.md`，并生成紧凑 XML 摘要给 LLM。
- `LLMOpenAIClient.java` 实现 OpenAI 兼容 Chat Completions，请求中自动附带可用 tools。
- `LLMCallback.java` 处理工具调用、参数错误反馈、工具结果回写、重复 tool batch 去重、最大工具轮次限制和历史记录。

可借鉴：受控工具调用、上下文注册、工具轮次限制、重复调用拦截、工具结果写回历史、模型请求审计。

### Ponderer

Ponderer 是数据驱动教程和复盘系统，不是运行时控制器：

- `DslScene.java` 定义场景、结构池、步骤、触发条件、文本、控制提示、方块变更和实体/镜头字段。
- `AiSceneGenerator.java` 使用两段式 LLM：先生成 outline 和 required elements，再生成 JSON；失败时重试解析，并把 outline、响应、解析错误写入日志。
- `OpenAiCompatProvider.java` 是轻量 OpenAI 兼容请求实现。
- `ponderer_example.json` 展示 `show_structure`、`text`、`idle`、`show_controls`、`set_block`、`replace_blocks`、`destroy_block` 等步骤。

可借鉴：技能演示、失败复盘、两段式 JSON 生成、结构描述、解析重试、生成日志。

不能直接作为当前控制器：它依赖客户端渲染和 1.20.1 模组环境，不能替代 Mineflayer 行为执行。

### Patchouli

Patchouli 是数据驱动知识书和多方块说明系统：

- `BookRegistry.java` 从 `data/<namespace>/patchouli_books/<book>/book.json` 加载书本元数据。
- 书本正文位于资源路径下的 `categories`、`entries`、`templates`。
- `PatchouliAPI.java` 支持打开书本/条目、注册模板、注册命令/函数和注册 multiblock。
- `MultiblockRegistry.java` 维护多方块结构定义。

可借鉴：BOT 知识手册、技能条目、危险规则文档、建筑蓝图、多方块验证思路。

不能直接作为当前运行时依赖：当前 BOT 是 Node/Mineflayer 进程，不运行在 Forge/Fabric 模组端。

## 本项目当前需求重新拆解

第一阶段仍然是“能在真实服务器里活下来”，但现在需要从纯规则执行器升级为可观察、可解释、可学习的智能体：

- 安全优先：低血、危险方块、近身敌对、夜间庇护、无效坐标恢复必须继续由规则接管。
- LLM 只做高层规划：模型选择目标和任务序列，不直接执行 Mineflayer API。
- 所有 LLM 行为必须有记录：模型、耗时、请求类型、输入摘要、输出、工具调用、工具结果、是否被采纳。
- 任务必须白名单化：LLM 只能组合现有 controller 支持的任务。
- 失败要变成知识：连续失败不只写日志，还要进入 memory、critic、Patchouli 条目和 Ponderer 复盘。
- Dashboard 要看到智能体脑内状态：当前规则决策、LLM 候选计划、工具调用链、critic 结论、任务队列、失败学习。

## 推荐组合方式

### 1. 保留规则安全底座

`decision.js` 继续负责硬安全优先级。LLM Planner 只能在安全窗口运行：非应急、非危险方块、非近身威胁、非低血无食物、非夜间露天危急、当前没有长动作 busy。任何时刻只要安全规则触发，LLM 目标队列暂停。

### 2. 用 TLM 风格实现 Node LLM 工具层

新增 `src/llm/`：

- `client.js`：OpenAI 兼容 `/v1/chat/completions`，读取 `LLM_BASE_URL || BASE_URL || BSAE_URL`、`API_KEY`、`MODEL`。
- `records.js`：写 `data/llm/records/*.jsonl`，隐藏 API Key，只记录 host、model、usage、latency、requestType、toolCalls、acceptedPlan。
- `contextRegistry.js`：按 TLM 的 `GameContextRegister` 思路拆分 `status`、`progress`、`inventory`、`memory`、`nearby_entities`、`risks`、`skills`。
- `toolExecutor.js`：包装现有 `ToolRegistry`，加入 `query_status`、`query_progress`、`query_memory`、`validate_task_sequence`、`plan_survival_skill`。
- `callbackLoop.js`：实现最大工具轮数、重复工具批次检测、未知工具/参数错误反馈。

### 3. 用 Voyager 风格实现高层 Planner/Critic

不复制 Voyager 的代码生成路径，只复制闭环结构：

- `planner.js`：根据当前上下文、技能库、失败记忆提出高层目标和白名单任务序列。
- `taskQueue.js`：把 LLM 计划转成待执行队列，但每步执行前仍经过规则安全检查。
- `critic.js`：每个目标结束后先做规则事实判断，再让 LLM 解释失败原因和下一步建议。
- `curriculum.js`：根据 `progress.js` 阶段、已完成/失败目标和环境情况选择下一组目标。
- `skillMemory.js`：保存成功的“任务序列 + 前置条件 + 成功条件 + 失败兜底”，不保存任意 JS 代码。

### 4. 用 Ponderer/Patchouli 做知识和复盘层

当前已经有 `exportKnowledge.js`，后续需要把运行时失败也纳入：

- 每次目标连续失败，生成 `data/knowledge/failures/*.json`。
- 失败案例同步导出 Patchouli entry：原因、坐标、当时装备、周围危险、建议修复。
- 庇护所、农田、动物围栏、矿道入口转成 Patchouli multiblock 风格蓝图。
- 成功技能和失败案例导出 Ponderer scene：用步骤展示“正确做法”和“失败点”。
- 后续如果服务器切换到兼容模组端，再把这些 JSON 打包成真实 Patchouli/Ponderer 内容。

## 第一批可开发任务

### A. LLM 配置与调用记录

目标：先证明模型真的被调用，并且 Dashboard/日志能看到记录，不改变 BOT 行为。

- 已在 `config.js` 加 `llm.enabled`、`llm.baseUrl`、`llm.apiKey`、`llm.model`、`llm.timeoutMs`、`llm.maxToolTurns`、`llm.plannerIntervalMs`、`llm.recordsDir`。
- 已新增 `src/llm/client.js` OpenAI 兼容客户端和 `src/llm/callRecorder.js` JSONL 记录器。
- 启动时日志输出 `llm=enabled/disabled; model=...; baseHost=...`，不输出 Key。
- 已新增测试覆盖 `BSAE_URL` 兼容、缺 key 自动禁用、OpenAI 请求体、响应解析和调用记录脱敏。

### B. 上下文注册和 Dashboard 展示

目标：把 BOT 状态压缩成模型可读上下文，并在网页上显示 LLM 状态。

- 已新增 `src/llm/contextBuilder.js`，只传状态、进度、背包、实体、记忆计数和近期学习摘要。
- Dashboard 状态已增加 `llm`：enabled、status、model、baseHost、lastCallAt、lastPlan、lastError、recentCalls。
- 网页已新增 LLM 规划面板，展示模型状态、最近调用、候选目标和候选任务。

### C. Planner Dry Run

目标：让 LLM 先旁路运行，只生成候选计划，不影响 BOT。

- 已新增 `src/llm/planner.js`，每隔 `plannerIntervalMs` 在安全窗口异步调用一次 Planner。
- LLM 输出严格 JSON：goal、tasks、constraints、reason、confidence。
- 已用现有 `validateTaskSequence` 验证任务，未知任务会被标记为 invalid，不进入执行队列。
- 记录 `ruleDecision` 和 dry-run 候选计划，用于观察“规则决策 vs LLM 建议”。

### D. 受控工具调用闭环

目标：让模型可以查询状态/技能/记忆，但不能直接执行动作。

- 已新增 `src/llm/toolLoop.js`，把 `ToolRegistry` 暴露为 OpenAI-compatible tools，并支持工具 JSON schema。
- 已暴露 `query_status`、`query_progress`、`query_memory`、`list_survival_skills`、`get_survival_skill`、`plan_survival_skill`、`validate_task_sequence`、`recommend_survival_skill`。
- 已实现最大工具轮次、重复 tool batch 检测和非法参数反馈；参数错误会作为 tool result 回写给模型，而不是让主循环崩溃。
- 工具结果已写回 LLM messages 和 `data/llm/records`，调用审计包含 `toolCalls` 与 `toolResults`。
- Planner dry run 已改为先走工具闭环，再解析最终 JSON 候选计划；仍不接管任何 Mineflayer 动作。

### E. 任务队列接入

目标：让 LLM 计划在安全窗口逐步影响行为。

- 已新增 `src/llm/taskQueue.js` 高层安全任务队列，默认由 `LLM_TASK_QUEUE_ENABLED=false` 关闭，需要显式开启。
- 队列只接收 `validate_task_sequence` 通过的任务，并进一步过滤为可排队的非硬安全任务；如 `hunt_food -> eat_food` 会只排入 `hunt_food`，把 `eat_food` 交还规则层。
- `SurvivalController.tick()` 仍先跑 `decision.js` 硬规则；队列任务只有在与当前规则决策一致，或当前规则决策为 `explore` 时才会被使用。
- 每个队列任务会记录 started/completed/failed/pause/expired 状态，并通过 LLM Dashboard 面板展示当前任务、待执行任务和队列事件。
- LLM Planner 会把队列接受/拒绝结果写入调用审计，`lastPlan.accepted` 和 `lastPlan.queue` 可看到是否被采纳。
- 尚未实现连续失败交给 Critic；这部分留给下一阶段。

### F. Critic 与知识沉淀

目标：失败不再只是日志，而是变成可复用经验。

- 规则事实判断优先：背包、进度、位置、庇护所完整度。
- LLM 只解释原因和提出下一步，不覆盖事实。
- 失败写入 memory 和 Patchouli/Ponderer 导出源。
- Dashboard 显示最近失败原因和模型建议。

## 不建议做的事

- 不要直接把 Voyager 的任意 JS 代码生成接入 `SurvivalController`。
- 不要把 Forge/Fabric 模组源码作为 Node 运行时依赖。
- 不要让 LLM 覆盖低血、危险方块、近身怪物、夜间庇护等硬安全规则。
- 不要把完整 prompt、API Key 或超长 memory 全量写进普通日志。
- 不要先做复杂向量库；第一版用静态技能库和简单文本检索即可。

## 最小可行里程碑

第一周目标应是“模型有记录但不接管”：完成配置、OpenAI 兼容调用、上下文摘要、Planner dry run、Dashboard LLM 面板和 JSONL 审计。这样可以立刻验证 API 配置和模型计划质量，而且不会破坏当前 BOT 已经调好的生存动作。

第二步“受控工具调用”已完成到 dry-run 阶段：模型可以通过工具查询技能、状态和记忆，并产出可验证任务序列，但还不能影响动作执行。

第三步“安全窗口任务队列”已完成第一版：开启 `LLM_TASK_QUEUE_ENABLED=true` 后，模型计划可以有限度地影响 `collect_wood`、`hunt_food`、`build_shelter` 等白名单任务顺序，但硬安全规则仍然不可覆盖。

第四步做“Critic + 知识复盘”：把失败转成记忆、Patchouli 条目和 Ponderer 场景，逐步形成可学习系统。