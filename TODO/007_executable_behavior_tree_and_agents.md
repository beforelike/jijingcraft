# 007 - 可执行行为树与多 Agent 调度

## 需求补全

用户要求行为树不能只作为 Dashboard 展示，而要成为直接操控 BOT 的执行模块；LLM 不能直接操作 Mineflayer API，但可以向执行模块提交行为树。所有提交到执行模块的行为都必须有预设优先级，最高优先级是逃生、脱离危险、进食和饥饿危机恢复等硬安全行为。执行模块需要按照优先级和同优先级提交顺序执行任务树，并持续保存任务状态；当执行结果不符合预设状态时，要反馈给发布任务的 LLM 或 Agent。多 Agent 架构中，总 Agent 必须一直激活，负责根据当前状态唤醒安全、生存、战斗、工程等 Agent。

## 本轮实现

- 新增 `src/behavior/executableBehaviorTree.js`：定义可执行行为树模板、任务优先级、节点校验和运行器。`collect_wood` 已拆成切换工具、定位低位树干、采集、验证原木入包；`escape_pit` 已拆成环境扫描、路线选择、执行脱困和验证离开陷阱。
- 新增 `src/behavior/behaviorExecutionQueue.js`：支持行为树入队、优先级排序、启动、完成、失败、跳过、过期清理和 feedback 记录。
- 新增 `src/agents/agentOrchestrator.js`：`general_agent` 始终 active，并按规则任务唤醒 `safety_agent`、`survival_agent`、`combat_agent` 或 `engineering_agent` 生成行为树提案。
- `SurvivalController` 新增行为树队列和运行器，调度顺序变为：forced/test/priority -> behavior tree queue -> LLM task queue -> taskFeedback fallback。硬安全任务仍可压过不相关行为树。
- LLM planner 支持可选 `behaviorTrees` 输出字段，白名单校验会同时检查 `tasks` 和 `behaviorTrees.taskType`；LLM 提交的行为树会进入行为树队列，而不是直接执行。
- Dashboard `/api/status.controller` 新增 `behaviorQueue` 和 `agents`，前端当前任务摘要会显示行为树队列状态。

## 测试影响

- 新增 `test/behaviorExecution.test.js` 覆盖行为树模板、优先级队列、运行器成功/失败反馈、Agent 唤醒、Controller 行为树选择和 LLM 行为树计划入队。
- 更新 `test/llmPlanner.test.js` 覆盖 `behaviorTrees` 解析。
- 更新 `test/dashboardStatus.test.js` 覆盖行为树队列与 Agent 状态序列化。
- 定向测试通过：`node --test test/behaviorExecution.test.js test/dashboardStatus.test.js test/llmPlanner.test.js test/controllerTaskQueue.test.js test/controllerExecution.test.js`，95/95 通过。
- 全量回归通过：`npm test`，227/227 通过；输出中只有 Node `punycode` 弃用警告，没有失败测试。

## Live 验证与闭环修复

- 重启最新 BOT 后，真实服务器 `localhost:8000` 连接成功，Dashboard `/api/status.controller.behaviorQueue` 与 `/api/status.controller.agents` 已发布运行态字段。
- live 日志确认行为树队列真实参与执行：出现 `behavior_tree_queue=insert/start`，决策理由包含 `behavior tree hunt_food`，`general_agent` 始终 active，并唤醒 `survival_agent` 发布行为树提案。
- live 采样显示 `agents.feedback` 会记录安全/生存 Agent 发布的行为树执行结果，`behaviorQueue.completedTrees` 会保留已完成树和来源 Agent。
- live 发现 `hunt_food` 被 task feedback 标记 blocked 后，Agent 仍可能反复提交同一个 `hunt_food` 行为树；同时 primitive 执行失败未总是向行为树队列返回 `false`，使树状态偏乐观。
- 已修复：`AgentOrchestrator` 现在会读取 `taskFeedback.blockedTasks`，将 blocked 规则任务转向第一个可用恢复任务，例如 `hunt_food -> explore`；`SurvivalController.executePrimitive()` 现在向上返回 primitive 的执行结果，让行为树队列能正确失败/反馈。
- 新增回归：blocked 规则任务会生成恢复行为树，Controller primitive 失败结果会向上冒泡。
- 最新定向测试通过：`node --test test/behaviorExecution.test.js test/controllerTaskQueue.test.js test/controllerExecution.test.js`，83/83 通过。
- 最新全量回归通过：`npm test`，229/229 通过；输出中只有 Node `punycode` 弃用警告，没有失败测试。
- 补丁后 live 再次启动成功，`/api/status` 显示 `behaviorQueue.enabled=true`，`general_agent.active=true`，夜间安全状态下 `hold_position` 行为树由 `survival_agent` 提交并执行；硬安全 `escape_hazard` 结果也进入了 Agent feedback。

## 追加验证：优先级、恢复门禁与 live 生存兜底

- live smoke 发现 LLM 输出的 `behaviorTrees.priority` 可能让普通任务插队，违背“行为树必须按本地预设优先级执行”的要求。已修复：`buildExecutableBehaviorTree()` 和 `BehaviorExecutionQueue` 都强制使用本地 `taskPriority(taskType)`，`normalizePlan()` 不再保留模型提供的 priority。
- live smoke 发现 blocked rule 的队列门禁过宽，blocked `collect_wood` 时无关 LLM 行为树仍可能接管。已修复：`SurvivalController` 在 blocked rule 下只允许 `taskFeedback.blockedTasks[ruleTask].recoveryTasks` 明确列出的恢复任务运行。
- live smoke 暴露 sustained `unknown_damage` 风险：附近安全候选为 0 时，旧逻辑只记录日志，BOT 可能继续留在掉血位置。已修复：Controller 现在记录最近安全站立点，未知伤害无法快速重定位时会尝试清理脚/头部空间并回退到最近安全站立点；日志会包含脚、头、脚下方块、氧气和岩浆状态。
- live smoke 暴露 emergency pathfinder 竞态：掉血触发 `damage_reposition` 时，正在运行的 `collect_wood -> explore` 可能改写 pathfinder 目标。已修复：普通 `explore` 和 `collect_wood` 在 emergency interruption 窗口内直接退出，不再抢占紧急移动。
- live smoke 暴露 critical starvation 夜间风险：极低血、无食物时 `recover_starvation` 仍允许夜间探索，可能被怪物击杀。已修复：critical health 且夜间无立即安全食物时改为 `holdPositionSafely()`，只有血量高于 critical 阈值时 food recovery 才能覆盖夜间探索限制。
- 新增/更新回归覆盖：LLM priority 被本地预设覆盖、blocked rule 只允许显式恢复任务、unknown damage last-safe fallback、emergency interruption 不改写 pathfinder、critical starvation 夜间原地防守。
- 定向回归通过：`node --test test/controllerExecution.test.js test/controllerEmergency.test.js test/behaviorExecution.test.js test/controllerTaskQueue.test.js test/llmPlanner.test.js`，108/108 通过。
- 全量回归通过：`npm test`，235/235 通过；输出中只有 Node `punycode` 弃用警告。
- 最新 live smoke：连接 `localhost:8000` 成功，Dashboard `http://127.0.0.1:3000` 返回 `connection=connected`，BOT 保持 `health=20`、`food=20`；未复现 unknown_damage 死亡链。`behaviorQueue` 显示 LLM pending 行为树 priority 已被压到本地预设，blocked `collect_wood` 的无关 LLM 行为树被跳过，夜间进入 `hold_position`。

## 追加验证：规则绑定任务不再阻塞队列

- live 继续验证时发现 LLM 提交的 `evade_hostiles`、`defend_self`、`wait_out_night` 等高优先级建议虽然会被本地规则拦住，但会停留在行为树队首，导致后续匹配当前规则的 `collect_stone` 行为树无法被选中。
- 已修复：`SurvivalController` 新增规则绑定队列任务集合，`escape/evade/defend/eat/recover_starvation/wait_out_night/hold_position` 只有在当前本地规则匹配时才可执行；规则不匹配时会被跳过并反馈给 Agent/LLM，不再阻塞后续可执行行为树。
- 新增回归覆盖：`behavior queue skips stale rule-bound safety trees to reach the active rule tree`。
- 定向回归通过：`node --test test/behaviorExecution.test.js test/controllerTaskQueue.test.js test/llmPlanner.test.js`，32/32 通过。
- 全量回归通过：`npm test`，236/236 通过；输出中只有 Node `punycode` 弃用警告。
- 最新 live smoke：重启后连接 `localhost:8000` 成功，Dashboard `connection=connected`；白天启动 `collect_stone` 行为树，入夜后切到 `wait_out_night/hold_position`。Dashboard 显示 stale `evade_hostiles/defend_self/wait_out_night` 已按 `rule_*_priority` 跳过，`general_agent.active=true`，LLM 调用记录与队列接受记录正常。

## 后续

- 继续把更多任务从单个 Controller 方法拆成更细的行为树动作节点，例如 `hunt_food`、`collect_stone`、`build_shelter`。
- 给 LLM planner 增加更严格的行为树节点 schema 工具，避免模型直接编造不可执行 handler。
- Dashboard 后续可以增加独立的行为树队列/Agent 面板，而不只是在当前任务摘要中展示。
