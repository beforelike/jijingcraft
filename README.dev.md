# MC Survival Bot

第一阶段目标是实现一个能独自在服务器中探索和生存的 Minecraft 智能 BOT。当前实现是一个基于 mineflayer 的无作弊生存状态机，默认连接玩家客户端开放的服务器端口 `8000`。

## 需求分析

- BOT 需要独立连接服务器并持续运行。
- 第一阶段优先处理真实生存：饥饿、低血量、怪物威胁、基础资源采集、基地建设、食物储备、农牧起步和矿前准备。
- BOT 不依赖 `/give`、`/tp`、改时间、改难度等作弊指令。
- 网络搜索只在需要查资料时使用项目内安装的 Multi Search Engine skill。
- 后续第二阶段可在此基础上接入 Voyager/LLM 任务规划，让策略从固定状态机升级为可学习任务系统。

## 第一阶段方案

系统分为三层：

- 连接层：`src/botFactory.js` 创建 mineflayer BOT，加载寻路、采集、战斗和工具插件。
- 决策层：`src/survival/decision.js` 根据血量、饥饿、实体威胁和背包状态选择下一步任务。
- 执行层：`src/survival/SurvivalController.js` 执行吃食物、逃离怪物、采木、制作工作台、制作工具、采石、制作熔炉、狩猎、建房、做床、种植、围栏、诱导动物和矿物采集等动作。
- 进度层：`src/survival/progress.js` 评估木器、工作台、石器、熔炉、武器、大量食物、房屋、床、农田、动物围栏、矿前准备和高级材料等第一阶段里程碑。
- 知识层：`src/knowledge/survivalSkills.js` 借鉴 TouhouLittleMaid 的 SkillLoader 思路，把前期石器、食物储备、可复用庇护所、夜间安全和地表采石整理为受控技能库；`src/knowledge/toolRegistry.js` 借鉴 ToolRegister 思路，提供技能列表、技能查询、技能计划、任务校验和技能推荐工具。运行日志会给决策标注 `skill=...`，后续 LLM 或工具调用只能复用白名单任务，而不是任意生成危险指令。
- 可视化层：`src/dashboard` 随 BOT 进程启动一个本地网页面板，展示连接状态、血量/饱食/坐标、当前决策、下一步技能计划、第一阶段里程碑、行为树、附近实体、背包和最近日志事件。

优先级顺序：环境危险 > 低血量吃食物 > 怪物规避 > 饥饿处理 > 木材、工作台和木镐 > 采集圆石 > 第一时间制作石镐和石剑 > 启动食物储备 > 收集房屋材料 > 建造带门固定庇护所 > 大量食物储备 > 制作床 > 开始农田 > 建造动物围栏并尝试诱导动物 > 持武器寻找或挖掘矿道 > 收集煤、铁、铜等高级材料 > 探索。

## 第二阶段 LLM 规划

已完成对 `Voyager-main.zip`、`TouhouLittleMaid-1.20.zip`、`Ponderer-1.20.1.zip` 和 `Patchouli-1.21.x.zip` 的本地源码分析，并形成当前项目的 LLM 高层规划集成方案。建议路线是保留现有规则状态机作为安全底座，借鉴 Voyager 的课程/行动/评价/技能库闭环，TouhouLittleMaid 的 OpenAI 兼容客户端、工具调用、上下文注册和工具轮数限制，以及 Ponderer/Patchouli 的知识库、教程演示、建筑蓝图和失败复盘能力。详细报告见 [TODO/002_voyager_touhoulittlemaid_llm_integration.md](TODO/002_voyager_touhoulittlemaid_llm_integration.md)。

当前已落地第一步现成项目集成：`npm run export:knowledge` 会从生存技能库和受控工具注册表生成 [data/knowledge/survival-skills.json](data/knowledge/survival-skills.json)、Patchouli 风格书本 JSON 和 Ponderer 风格教程 JSON。详细实现记录见 [TODO/003_existing_project_skill_library.md](TODO/003_existing_project_skill_library.md)。

最新工程路线已进一步明确：当前高级功能尚未进入 BOT 控制循环，LLM 没有运行时调用记录。后续应先实现 OpenAI 兼容配置、调用审计、上下文注册、Planner dry run 和 Dashboard LLM 面板，再逐步接入受控工具调用、任务队列、Critic 评价、Patchouli 知识沉淀和 Ponderer 失败复盘。详细拆解见 [TODO/004_advanced_ai_project_integration_plan.md](TODO/004_advanced_ai_project_integration_plan.md)。

当前已落地 LLM 第一批运行时能力：`src/llm/client.js` 提供 OpenAI 兼容 Chat Completions 客户端，`src/llm/callRecorder.js` 把调用审计写入 `data/llm/records/*.jsonl`，`src/llm/contextBuilder.js` 构造压缩状态上下文，`src/llm/toolLoop.js` 实现受控工具调用闭环，`src/llm/planner.js` 在安全窗口生成高层候选计划。动作仍由规则层和白名单任务执行，模型不能直接调用 Mineflayer API；当 `LLM_ENABLED=true` 且配置完整时，安全任务队列默认开启，模型通过校验的非硬安全任务可以进入队列。控制器会把连续失败的任务写入 `taskFeedback`，LLM 上下文、Dashboard 和队列调度都能看到 blocked task；只有同一任务的同类重复失败才会触发 blocked，低氧撤离、危险中断和辅助寻路失败不会把任务长期拉黑。当当前规则任务被反馈标记为 blocked 时，LLM 队列可以插入不同的安全恢复任务，不能继续重复同一个 blocked 任务。

当前又新增了可执行行为树执行模块：`src/behavior/executableBehaviorTree.js` 把 `escape_pit`、`escape_hazard`、`collect_wood`、`eat_food`、`recover_starvation`、`explore` 等任务拆成可绑定 Controller 动作的节点，并为每棵树预设优先级；`src/behavior/behaviorExecutionQueue.js` 按优先级和提交顺序调度行为树，保存 pending/current/completed/feedback 状态；`src/agents/agentOrchestrator.js` 让 `general_agent` 始终激活，并按当前规则决策唤醒 `safety_agent`、`survival_agent`、`combat_agent` 或 `engineering_agent` 提交行为树。LLM 仍不能直接操作 BOT，但可以在计划 JSON 中提交 `behaviorTrees`，由行为树队列验证优先级、白名单和节点定义后再交给执行模块。`hunt_food` 行为树会复用 Controller 的动态实体追踪、剑优先准备和低氧撤离；水下捕鱼一旦氧气低会停止追击并优先上岸/出水。行为树失败会写入 `taskFeedback`、Agent feedback 和 LLM 上下文，后续模型能看到“不符合预设状态”的反馈再重规划。

行为树优先级现在完全由本地 `taskPriority(taskType)` 决定，LLM 输出的 `behaviorTrees.priority` 会被忽略，避免模型让普通任务插队硬安全任务。若某个规则任务被 `taskFeedback` 标记为 blocked，执行队列只允许该 blocked 任务记录中的显式 `recoveryTasks` 接管，例如 `collect_wood -> explore`，不会让无关 LLM 行为树趁机执行；`collect_wood` 被阻塞时不会再把 `collect_stone` 当恢复任务，避免石头任务因缺少工具又递归进入采木。路径移动现在带有实体坐标进度监控，`gotoNear`/`gotoBlock` 在 pathfinder 忙但 BOT 长时间没有位移时会提前失败、重置 motion 并记录学习事件；采木会跳过处于学习避让或策略冷却中的已知树木坐标，避免反复对同一批不可达树干等待完整超时。硬安全任务到来时，行为树队列会跳过或中断与当前规则不匹配的旧树，例如无食物时过期的 `eat_food`，避免安全接管在 Dashboard 上表现为队列暂停；普通安全窗口中，如果队列头部是旧的高优先级任务但后面已经有当前规则可执行树，控制器会把旧头部标记为 stale skipped 并继续扫描，避免 `currentTree=null`、`pendingTrees` 非空时长期 head-of-line 阻塞。LLM 在夜间或 blocked 恢复期间提交的未来 advisory 行为树如果不再匹配当前本地规则，也会以 `stale_<task>_before_<rule>` 跳过；如果遗留 `currentTree` 已经不是当前规则，控制器会释放它并继续扫描后续树。每次任务执行结束后 Controller 会立即发布最终队列快照，死亡/重生也会释放当前 queued work，避免 Dashboard 长时间显示已经失败的 `currentTree=in_progress`。紧急掉血会打断普通采集和探索；未知伤害会记录脚/头/脚下环境、尝试清理身体空间，并在附近没有安全候选位时回退到最近安全站立点。0 饱食造成的小额饥饿掉血会被归类为 `starvation_damage`，不会误走未知伤害重定位。极低血且无食物时，夜间 `recover_starvation` 会先检查安全半径内的敌对压力；有怪物持续逼近时继续撤离，只有没有开放地带威胁时才进入原地防守。

最新的 LLM/行为树接口进一步收敛为“基础任务像函数，行为树像类实例”。`src/behavior/executableBehaviorTree.js` 会为每个白名单任务生成 `treeClass`、`taskFunction`、`constructorArgs` 和 `parameterSchema`；LLM 的 `taskRequests` 只需要选择 `taskType` 并传入构造参数，例如 `ExploreTree({ radius: 10 })` 或 `CollectWoodTree({ targetPosition, count: 3, tool: "hand" })`，队列会在本地实例化、校验等级和优先级后执行。Dashboard 的 LLM 面板会显示 `TreeClass(key=value)`，方便确认模型是在下达可执行任务实例，而不是输出思考过程。

## 运行

安装依赖：

```bash
npm install
```

启动 BOT：

```bash
npm start
```

启动后默认同时打开本地状态面板：

```text
http://127.0.0.1:3000
```

面板会轮询 `/api/status`，用于观察 BOT 当前状态、下一步计划和行为树高亮节点。若 `3000` 被占用，进程会自动尝试后续端口并在日志中输出实际地址。

Dashboard 现在包含“Agent 思维导图”面板，会用流程图方式展示环境、进度、记忆和失败反馈如何进入 `general_agent`，`general_agent` 如何按当前规则唤醒 `safety_agent`、`combat_agent`、`survival_agent`、`engineering_agent`，以及子 agent 输出的行为树实例如何进入 `BehaviorExecutionQueue`、Controller 执行器并回写记忆/反馈。该面板会动态高亮当前活跃 agent、当前规则、LLM Smart Brain JSON 输出和正在执行的行为树，并在每条层级连接上显示具体 payload，例如 `ruleDecision.type`、`taskFeedback.lastEvent`、LLM `taskRequests`、`behaviorTrees.constructorArgs`、队列 `current/pending/lastEvent`、`taskTrace.status` 和最近失败原因，便于定位到底是哪一层把任务卡住。

Dashboard 现在会显示详细任务阶段追踪，而不是只显示一个任务名。狩猎/觅食会拆成准备、扫描动物与植物、发现食物源、接近动物或安全采集位、攻击/采集、躲避怪物或植物伤害、拾取掉落物、验证食物增加和失败后换目标；战斗会显示装备武器、锁定敌对生物、站位、攻击窗口、低血撤离和威胁解除验证。`/api/status` 同步暴露 `taskTrace`，其中包含当前阶段、阶段事件、风险事件和最近观测，网页中的“任务阶段追踪”面板可用来判断 BOT 的逻辑是否真的推进，而不是只看日志猜测。

导出生存知识库：

```bash
npm run export:knowledge
```

导出内容位于 [data/knowledge](data/knowledge)，包括可供 LLM prompt 使用的技能摘要、受控工具清单、Patchouli 风格条目和 Ponderer 风格步骤演示。

导入 Ponderer `.nbt` 蓝图到本项目可读取的 JSON（可选）：

```bash
npm run blueprint:import:ponderer -- "Ponderer-1.20.1/Ponderer-1.20.1/.minecraft/versions/1.20.1-Fabric/config/ponderer/structures/<your_structure>.nbt" "data/blueprints/starter_shelter_blueprint.json" --id=ponderer_imported_starter --name="Imported Starter" --style=ponderer_imported_structure
```

转换后，`src/survival/shelterPlan.js` 会优先读取 `PONDERER_STARTER_BLUEPRINT_JSON` 指向的文件；未设置时默认尝试 `data/blueprints/starter_shelter_blueprint.json`。文件不存在或格式无效时，会自动回退到内置 starter shelter 蓝图。

现在 `build_starter_shelter` 还会在开工前自动触发“思考式蓝图设计”：

- 已移植 Ponderer 的核心生成思路：先生成大纲（outline + `REQUIRED_ELEMENTS`），再生成严格 JSON，并做 JSON 提取、清洗与重试。
- 优先使用 LLM 生成 starter house 设计规格（`roofType`、`wallPattern`、`windowCount`、`ridgeDirection` 等），再由 `src/survival/shelterPlan.js` 生成可执行蓝图。
- 若 LLM 不可用、超时或返回无效 JSON，会自动回退到启发式设计，不会阻断建房任务。
- 设计规格会写入生存记忆进度，便于中断后续建时保持同一房屋风格。
- 可选环境变量 `PONDERER_STARTER_STRUCTURE_NBT` 可注入一个 Ponderer `.nbt` 结构描述作为 LLM 上下文，进一步贴近原项目的结构感知流程。

实现入口位于 `src/survival/blueprintBrain.js`（设计规格生成）和 `src/survival/SurvivalController.js` 的 `maybeDesignStarterShelterBlueprint`（自动触发与注入）。

运行甜浆果误入逃脱 live 场景测试：

```bash
npm run scenario:berry-escape
```

`npm run scenario:berries` 也是同一逃脱测试的兼容别名。该脚本复用当前运行中的 `SurvivalBot`，因此需要先用 `TEST_CONTROL_ENABLED=true npm start` 启动原 BOT 和 Dashboard。脚本会通过测试专用管道 `POST /api/test/pipeline` 插入 `escape_hazard`，让测试任务压过普通优先队列、LLM 队列和常规任务，但不清空这些队列；硬安全任务仍然最高优先级。场景会初始化白天、21x21 草地方台和默认 9x9 成熟甜浆果丛，并把原 BOT 送到测试坐标。脚本不会启动随机测试 BOT，不会给 BOT 速度、治疗或饱和效果，也不会清背包、清效果、改游戏模式或改 movement_speed 属性；它会采样逃脱阶段水平速度，默认超过 `5.2` blocks/s 会判定测试无效。通过标准是测试管道任务被消费，BOT 触发 `escape_hazard`，执行 `action=escape_hazard_block`，保持存活，Dashboard 中 `environmentHazard` 回到 `null`，并且 BOT 必须离开生成的甜浆果区域。脚本会记录是否出现真实掉血或 `emergency=damage_block`，但不会为了制造伤害而强行让 BOT 在浆果碰撞里移动；香草机制下站在浆果中不动不会掉血。场景结束后脚本会清理剩余甜浆果并把 BOT 移到平台外侧安全点，避免测试残留继续干扰普通任务。可用 `SCENARIO_BOT_USERNAME`、`SCENARIO_DASHBOARD_URL`、`SCENARIO_BERRY_PATCH_RADIUS`、`SCENARIO_PLATFORM_RADIUS`、`SCENARIO_MAX_HORIZONTAL_SPEED`、`SCENARIO_TEST_TASK`、`SCENARIO_TEST_TASK_PRIORITY`、`SCENARIO_TRAP_X/Y/Z` 和 `SCENARIO_TIMEOUT_MS` 覆盖默认场景参数。

Dashboard 测试控制现在分成两条任务入口：`POST /api/test/pipeline` 用于场景验证，`DELETE /api/test/pipeline` 清空测试管道；`POST /api/test/tasks` 仍可插入 `{ "taskType": "explore", "priority": 80 }` 这类普通优先任务，后续玩家聊天产生的新任务也可以复用这一入口。测试管道只在测试时切换，不和普通优先任务混用。

启动时会先 ping 服务器并检查 mineflayer 当前是否支持该协议版本。如果服务器返回的版本不在 `minecraft-protocol` 支持列表中，BOT 会停止并输出原因，而不是继续进入底层连接崩溃。

默认连接：

- Host: `localhost`
- Port: `8000`
- Username: `SurvivalBot`
- Auth: `offline`
- Protocol error logging: `HIDE_PROTOCOL_ERRORS=true`
- Dashboard: `DASHBOARD_ENABLED=true`, `DASHBOARD_HOST=127.0.0.1`, `DASHBOARD_PORT=3000`
- LLM planner: `LLM_ENABLED=false`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_MS=60000`, `LLM_PLANNER_INTERVAL_MS=60000`, `LLM_TASK_QUEUE_ENABLED` defaults to enabled when LLM is enabled
- Auto reconnect: `AUTO_RECONNECT=true`
- Survival memory: `SURVIVAL_MEMORY_ENABLED=true`, `SURVIVAL_MEMORY_FILE=data/survival-memory.json`
- Night exploration guard: `AVOID_NIGHT_EXPLORATION=true`
- Action timeout: `ACTION_TIMEOUT_MS=25000`
- Block placement timeout: `PLACE_BLOCK_TIMEOUT_MS=3000`
- Starter food reserve: `STARTER_FOOD_TARGET=6`
- Food stock target: `FOOD_STOCK_TARGET=18`
- Night food buffer: `NIGHT_FOOD_BUFFER=18`
- Starter house: `BUILD_SHELTER=true`, `HOUSE_BLOCK_TARGET=80`
- Runtime blueprint design: `AUTO_BLUEPRINT_DESIGN=true`
- Bed and farming: `WOOL_TARGET=3`, `PLANT_CROPS=true`, `CROP_PLOT_TARGET=6`
- Animal pen: `BUILD_ANIMAL_PEN=true`, `ANIMAL_PEN_BLOCK_TARGET=32`
- Mining preparation: `ADVANCED_MATERIAL_TARGET=8`, `MINE_SEARCH_RADIUS=64`

可以通过环境变量或命令行覆盖：

```bash
MC_HOST=localhost MC_PORT=8000 BOT_USERNAME=SurvivalBot npm start
node src/index.js --mc-host localhost --mc-port 8000 --bot-username SurvivalBot
```

`HIDE_PROTOCOL_ERRORS=true` 会关闭底层协议库的 partial packet 调试输出，用于避免服务器中实体同步警告刷屏；BOT 仍会通过自己的日志输出连接、决策和运行错误。

`DASHBOARD_ENABLED=true` 会在 BOT 进程内启动本地网页面板。网页显示当前连接状态、BOT 基础属性、决策原因、技能计划、阶段进度、行为树、附近实体、背包和最近日志。`DASHBOARD_HOST` 与 `DASHBOARD_PORT` 控制监听地址；默认监听 `127.0.0.1:3000`，不会占用 Minecraft 服务器端口 `8000`。需要只运行 BOT 不开网页时设置 `DASHBOARD_ENABLED=false`。

`LLM_ENABLED=true` 会启用第二阶段的高层规划。当前支持 OpenAI 兼容接口：`LLM_BASE_URL` 指向 `/v1` 基础地址，`LLM_API_KEY` 是密钥，`LLM_MODEL` 是模型名；也兼容旧变量 `BASE_URL`、`API_KEY`、`MODEL` 和误拼写 `BSAE_URL`。如果缺少密钥、模型或地址，系统会自动保持 LLM disabled，并在日志和 Dashboard 中显示原因。模型调用不会绕过 `decision.js` 的硬安全优先级，也不会执行任意 Mineflayer 代码。Planner 会暴露 `query_status`、`query_progress`、`query_memory`、`list_survival_skills`、`plan_survival_skill`、`validate_task_sequence` 和 `recommend_survival_skill` 等受控工具；`LLM_TIMEOUT_MS` 默认 60000，用于给较慢的 OpenAI 兼容模型留出响应时间；`LLM_MAX_TOOL_TURNS` 限制工具轮数，重复工具批次会被拦截。调用审计写入 `LLM_RECORDS_DIR`，记录模型、host、耗时、usage、摘要、工具调用、工具结果、候选任务、队列接受结果和错误，不写入 API Key。

`LLM_TASK_QUEUE_ENABLED` 默认跟随 `LLM_ENABLED`，也可以显式设为 `false` 退回只规划不入队模式。安全任务队列仍然不执行危险动作：低血、危险方块、近身怪物、夜间等待、进食等硬安全决策继续由规则层独占；队列任务通常只有在与当前规则决策一致，或规则层已经进入 `explore` 这种开放阶段时才会被执行。若队列头部不适合当前规则，但后面已经有匹配当前规则或显式恢复任务的候选，控制器会跳过旧头部并继续启动后面的任务，而不是反复 pause。若队列头部是不再匹配当前规则的 LLM advisory 行为树，即使后面没有可执行候选，也会被标记为 stale skipped，让本地规则继续直接控制 BOT；这样夜间提前规划的 `collect_building_materials` 或旧 `hunt_food/explore` 不会在白天采木、回避或恢复任务期间让队列看起来阻塞。若 `taskFeedback` 发现当前规则任务连续失败并标记为 blocked，队列可以执行不同的白名单恢复任务，例如从卡住的 `hunt_food` 切到 `explore`，但不会重复执行同一个 blocked 任务；饥饿恢复不会因为 `hunt_food` blocked 转去砍树或造房。Planner 上下文还会暴露 `foodStrategy`：它不会硬编码“浆果优先”，而是先看初始地形扫描/探索、可见食物源、水体/冰雪/氧气风险，再决定近处陆地动物、成熟甜浆果、可安全接近的鱼或继续 `explore`。雪地冰湖这类高水体风险开局会让成熟甜浆果压过远处/水下/冰下鱼；普通安全地形则优先比较近处陆地动物和其他安全食物。`LLM_MAX_QUEUED_TASKS` 控制单个计划最多排入多少任务，`LLM_TASK_QUEUE_MAX_AGE_MS` 控制计划过期时间。Dashboard 的 LLM 面板会显示队列是否启用、当前任务和待执行任务；决策摘要会显示 blocked 任务。

`AUTO_RECONNECT=true` 会在 BOT 被踢出或连接断开后自动重新执行协议检查并加入服务器；`RECONNECT_MIN_DELAY_MS` 和 `RECONNECT_MAX_DELAY_MS` 控制重连退避时间。

`SURVIVAL_MEMORY_ENABLED=true` 会把 BOT 的本地生存记忆保存到 `SURVIVAL_MEMORY_FILE`。当前会记录已知工作台坐标、已达成进度、房屋位置、农田、动物围栏、矿道探测次数和动作失败学习状态。工作台被放到地上后会被记录，后续制作会优先复用附近或记忆中的工作台，不再因为背包里没有工作台就反复制作新的。`KNOWN_BLOCK_SEARCH_RADIUS=96` 控制回到已知工作台的最大距离。需要完全重置 BOT 记忆时，可以停止 BOT 后删除该文件。

失败学习状态用于避免 BOT 以同样方式反复失败。采集、寻路、甜浆果安全站位和无效坐标恢复会记录动作、目标、失败原因和坐标冷却；后续同类任务会跳过近期失败点，转向其他资源或重新决策。运行时还会维护 `controller.taskFeedback`：同一任务短时间内同类重复失败会变成 blocked task，触发本地 fallback 或 LLM 队列恢复任务。内部辅助动作会继续写入学习记录，但不会因为单个路径探测、低氧撤离、危险中断、采集插件失败或手动挖掘 fallback 失败就直接阻塞整个任务；完整任务成功会清理该任务的近期失败和 blocked 状态。行为树的通用进度验证会比较背包物品组成，因此制作木板、工作台、木镐、斧头等任务只要实际改变了背包，就不会被误判为 `no_observable_progress`。日志中的 `learning=failure`、`task_feedback=blocked`、`task_feedback=replan`、`task_feedback=unblocked`、`learning=success` 和 `skipped learned risky...` 可用于确认反馈闭环正在生效。

`AVOID_NIGHT_EXPLORATION=true` 会让 BOT 在夜间停止主动远距离探索，改为安全等待；如果敌对生物进入安全半径，会立即撤离、防御或封闭庇护。夜间等待前，若背包有可食物且饱食低于 `NIGHT_FOOD_BUFFER`，BOT 会先吃到安全缓冲，避免带着食物低饱食挂机。若记忆中存在固定入门房屋坐标，而当前位置不在房屋附近，BOT 会先尝试 `return_starter_shelter` 回到固定房屋并修补门洞/墙体；只有返家失败、附近威胁阻断或房屋无法验证时，才在当前位置搭建临时应急庇护。夜间警戒不会再反复按蹲下键，因此客户端不会看到 BOT 一直重复弯腰。若背包里已有足够材料，BOT 会优先在安全窗口完成木板、木棍、基础工具、熔炉或武器等本地制作任务，然后再等待天亮。没有正式房屋且有建筑方块时，BOT 会先搭建封闭临时庇护：两格高墙体、四角补强和完整屋顶会优先阻断 skeleton 视线和怪物路径。没有方块且安全半径内仍有夜间敌对压力时，BOT 会继续执行撤离，而不是等到怪物贴脸才反应。

`IMMEDIATE_THREAT_RADIUS=8` 仍用于区分贴脸威胁和短撤离窗口；`SAFE_MODE_THREAT_RADIUS=28` 用于夜间开放地带的持续敌对压力判断。没有正式庇护所时，近身怪物会优先触发封闭临时庇护或短撤离；如果没有建筑方块，安全半径内的夜间怪物也会持续驱动 `evade_hostiles`，避免 BOT 撤离一段后又停在原地。只有敌人已经贴脸、撤离空间不足且 BOT 有武器时，才把原地自卫作为兜底。`SHELTER_DEFENSE_RADIUS=4` 会让已有入门庇护所的 BOT 在夜里留在屋内，只对贴近庇护所的怪物原地防御，不主动追出去。

`PANIC_RETREAT_MS=3500` 控制近距离危险时的短撤离时间。撤离会优先选择远离敌人的安全落脚点并通过 pathfinder 前往；只有找不到安全路径时才进行很短的手动疾跑，且每一步都会检查前方是否有可站立地面，避免盲跑到悬空或无效坐标状态。撤离时间不宜过长，否则夜间容易跑离安全点并进入新的敌对生物范围。

BOT 受到伤害时会立即打断当前采集、寻路或等待动作。若伤害来自脚下或身边危险方块，会先脱离危险方块；若附近有敌对生物，会先撤离到更安全的位置，只有撤离失败且敌人仍贴近时才进行最后反击。若伤害来源没有被实体或方块识别到，BOT 会先排除 0 饱食造成的小额饥饿掉血；真正未知伤害才执行一次安全重定位，避免无伤落地、饥饿扣血或非攻击场景把 BOT 误推入危险移动。

2026-05-12 的 live 生存安全收尾进一步修复了“受击后停止逃跑”和“低血仍被普通任务拖走”的复发链路：受击中的 protected flee 会持续到敌对压力清除，逃跑时普通采集、寻路和行为树不会抢回控制权；低氧、落沙/窒息和危险方块仍能抢占逃跑。逃跑过程中会尝试挖开叶子、泥土等软阻挡，并在短安全窗口收集一块附近建筑材料。极低血量且饥饿值尚可时，`recover_starvation` 不再追远处动物、探索或高台下降，只允许吃现有食物、找近处安全食物、撤离近身敌对生物或原地保命。控制器还新增局部 3D 空间感知、`create_or_open_exit` 安全任务、水中/绕圈卡顿反馈、湿石目标过滤和未完成 starter shelter 续建保护。详细记录见 [TODO/031_live_survival_safety_closure.md](TODO/031_live_survival_safety_closure.md)。

如果 Mineflayer 实体坐标连续多轮变成无效值，BOT 会主动断线并依赖 `AUTO_RECONNECT` 重新加入服务器。这个恢复路径用于处理客户端看见 BOT 悬浮、控制器日志显示 `position is invalid` 或 `arrived=unknown` 的状态；未死亡时单纯 `respawn()` 无法修复这类实体同步问题。

`ACTION_TIMEOUT_MS=25000` 会限制单次寻路/采集动作的最长等待时间。超时后 BOT 会取消当前采集或寻路，清理移动状态，然后进入下一轮决策，避免白天卡在原地。

`PLACE_BLOCK_TIMEOUT_MS=3000` 会限制单次清理目标方块或放置建筑方块的等待时间。某个位置无法放置时，BOT 会跳过该位置继续尝试，避免建筑任务卡住控制循环。

BOT 会在采集前按目标方块切换工具。砍树会优先制作并装备斧头；如果暂时做不出斧头，会空手砍树，而不是继续拿镐。采木会按树柱选择最低可达原木，并允许从目标下方两到三格的安全地面站位砍高出脚面的树干；雪地/云杉树林里第一节原木比 BOT 脚高两格时，不再被误判为“无可达树干”。如果 LLM 或记忆给出的是高处原木坐标，BOT 会先靠近树旁安全站位或对应地面区域，再执行附近原木扫描；失败重试不会把搜索半径越缩越小，且会优先靠近记忆中最近的树干坐标。采集日志中的 `mineable_candidates=...; usable_targets=0; sample=...` 可用于判断是扫描不到方块、站位被安全规则过滤，还是需要转向已记忆树林。采石会优先寻找地表或山坡上裸露、上方接近露天的石头；地表目标会压过更近的地下石头，连续多轮找不到地表石头后才允许进入阶梯矿道兜底。一次采石只要实际挖到几块圆石，就会按剩余目标继续扫描当前工作面，并在短时间内记住该采石点，避免刚下到石头层又换位置重新挖。挖到圆石并拥有工作台与木棍后，BOT 会优先从木镐升级为石镐，并在材料允许时制作石剑和石斧；石剑优先级高于石斧。采集日志中的 `tool=...` 字段可用于确认当前手持工具。

BOT 会避开仙人掌、凋零玫瑰、滴水石、岩浆块、火、岩浆和水域等早期危险环境。甜浆果灌木会被特殊处理：成熟甜浆果会从安全方块右键采集；如果 BOT 真的站进灌木或受到接触伤害，会取消当前采集/移动，优先清除脚下或贴身甜浆果丛，然后按一格一格清出通道的方式用正常速度移动到安全格，直到离开植物簇。

`STARTER_FOOD_TARGET=6` 会让 BOT 在石镐和石剑成型后、建造固定房屋前先准备一小段启动食物，避免一边收集建筑材料一边饿死。`FOOD_STOCK_TARGET=18` 会让 BOT 在固定庇护所可用后、继续远距离探索前主动准备较大的食物储备；`FOOD_SEARCH_RADIUS=48` 控制动物和可采甜浆果的搜索半径。觅食现在会先检查附近成熟甜浆果，安全浆果会压过远处水下鱼；追动物会刷新实体位置而不是只跑向旧坐标，准备阶段会优先装备或制作剑，只有没有剑时才退到斧头。捕鱼属于后备方案，接近和攻击过程中会轮询氧气，低氧时立即停止追击并执行 `escape_low_oxygen`，不会把这次撤离记成 `hunt_food` blocked。

`BUILD_SHELTER=true` 会让 BOT 在自由探索前收集建筑材料并搭建一个 5x5 入门房屋，包含围墙、屋顶和可重复进出的门；`HOUSE_BLOCK_TARGET=80` 控制开始建造前期望拥有的可用建筑方块数量。房屋完成度现在需要达到 90%，且门洞位置必须被门或防御方块保护，才会被记为可防御庇护。夜间会按完整墙体、屋顶和门洞位置重新检查并修补漏洞。为了兼容旧配置，仍可使用 `SHELTER_BLOCK_TARGET`，但新配置优先读取 `HOUSE_BLOCK_TARGET`。

记忆中的房屋不会被无条件当成当前安全点。BOT 只有在自己确实靠近房屋坐标、且本地检查到墙体/屋顶仍达到防御完整度时，才会使用“屋内等待”和小范围防御逻辑；死亡重生或探索到远处时，Dashboard 会通过 `starterShelterDistance` 显示它离固定房屋还有多远。夜间如果有可用房屋坐标且没有贴脸威胁，BOT 会先返家并验证房屋，失败后才回退到野外临时封闭、撤离或最后反击。

`WOOL_TARGET=3` 会让 BOT 在建房后主动寻找羊并制作床；`PLANT_CROPS=true` 与 `CROP_PLOT_TARGET=6` 会让 BOT 搜集种子或可种植食物，制作锄头并开始农田。

`BUILD_ANIMAL_PEN=true` 与 `ANIMAL_PEN_BLOCK_TARGET=32` 会让 BOT 在农田起步后建造动物围栏；若背包里有合适饵料，会尝试把附近动物引向围栏区域。

`ADVANCED_MATERIAL_TARGET=8` 和 `MINE_SEARCH_RADIUS=64` 控制矿前阶段。基地、食物、床、农田和围栏完成后，BOT 会持武器寻找煤/铁/铜等矿物；如果附近没有安全暴露矿物，会挖一个浅层阶梯矿道探测入口。采石和采矿会优先站在安全侧面挖墙面目标，不会追着低处目标垂直向下挖，也不会把水里或水边位置当成安全站位；主动挖矿入口会按前进方向逐步下降，形成可以原路返回的梯步。若 BOT 已经掉进坑里且周围没有同层出口，会先执行 `escape_pit`，尝试走到坑沿，失败后挖上升阶梯并在缺支撑时使用泥土、圆石、木板或原木补一个垫脚支撑。BOT 会在日志中输出 `progress=...` 和 `progress_stage=...`，用于观察当前第一阶段游戏进度。

`MC_VERSION` 默认设为 `1.21.1`。目前 mineflayer 4.37.x + minecraft-protocol 1.66.x 对 1.21.6 及以后的 `update_health` / `entity_metadata`(oxygen) / `server_difficulty` / `player_abilities` / `entity_properties` 解析不完整，会让 dashboard 永远看到满血、氧气越界、难度为空，进而让 `handleEmergencyDamage` 不被触发。开 LAN 时请使用 1.21.1 客户端打开存档；如果一定要在 1.21.11 上跑，必须接受 BOT 看不到自己掉血。

## 当前协议诊断

历史测试中，`localhost:8000` 曾返回：

- Version: `26.1.1`
- Protocol: `775`

当前已发布的 `mineflayer@4.37.0` / `minecraft-protocol@1.66.0` 支持列表最高到 `1.21.11`，暂不支持 protocol `775`。因此 protocol `775` 服务器不能直接加入。当前测试服务器切换到 `1.21.11` / protocol `774` 后，BOT 可以正常进入服务器。

## 测试

```bash
npm test
```

当前测试覆盖配置解析、生存决策优先级、进度评估、生存记忆、阶梯矿道规划、防御庇护规划、制作路径、前期石器/食物门槛、夜间返固定庇护所、夜间食物缓冲、夜间封闭/持续撤离优先级、受伤应急反应策略、任务阶段追踪、硬安全行为树队列接管、stale LLM advisory/current 行为树释放、Dashboard Agent payload 图谱静态资源和直接构造场景下的狩猎/近战推进。

新增或修复复杂行为时，测试标准是先构造对应场景，再确认功能能在短时间内推进或完成。比如狩猎逻辑要用白天附近有动物或成熟甜浆果的场景验证阶段能推进到攻击/采集和食物增加；战斗逻辑要用近身敌对生物加可用武器的场景验证 BOT 会装备、保持距离、攻击并在危险时撤离。真实服务器测试可用 OP 命令注入场景，例如 `/time set day`、`/give SurvivalBot stone_axe 1`、`/summon zombie <x> <y> <z>`，然后观察 Dashboard 的 `taskTrace` 是否推进。凡是常规运行中发现的问题，都应补成直接场景测试，直到生成的场景能通过为止。

详细监控与场景化验证路线见 [TODO/005_detailed_behavior_monitoring_and_scenario_validation.md](TODO/005_detailed_behavior_monitoring_and_scenario_validation.md)。

## 已知限制

- 第一阶段仍以规则状态机为安全底座；技能库和受控工具注册表已经可被后续 LLM/工具层读取，但暂不允许 LLM 自主写代码或绕过白名单任务。
- 农牧目前是第一阶段起步能力：能建围栏、开农田并尝试诱导动物，但还没有完整的自动繁殖、收割、补种和长期基地坐标持久化。
- 服务器若启用正版验证，需要设置 `MC_AUTH=microsoft` 并完成 mineflayer 支持的登录流程。