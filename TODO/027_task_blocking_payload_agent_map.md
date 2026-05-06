# 027 任务队列阻塞复查与 Agent payload 图谱细化

## 背景

用户继续反馈“任务列表还是经常阻塞”，并指出 Agent 思维导图只展示了模糊层级，不显示每层之间到底传递了什么，难以定位问题。

## 检查结果

- 实时 `/api/status` 出现新的阻塞形态：`behaviorQueue.currentTree` 显示 `collect_wood` 或 `wait_out_night` 仍为 `in_progress`，但 `taskTrace.status` 已经是 `failed`，Dashboard 诊断出现 `task_trace_stale`。
- 这与之前的 pending 头部阻塞不同：队列 current 快照和 trace 更新不同步，执行结束后没有立即发布最终 controller/queue 状态，Dashboard 可能长时间显示已经失败的 current tree。
- 夜间或 blocked 恢复时 LLM 会提前提交未来任务，例如 `collect_building_materials`、旧 `hunt_food` 或 `explore`。这些 advisory 行为树在本地规则切换后不再适配，如果继续保留在队列头，会反复出现 `rule_*_priority` 暂停。
- 死亡/重生只暂停和清 motion，没有释放当前 queued work；如果任务跨死亡或 invalid position 中断，容易留下 stale current。
- 初版 Agent 图谱只写“环境/进度/记忆进入 general_agent”，没有直接展示 `ruleDecision`、`taskFeedback`、LLM `taskRequests`、行为树 `constructorArgs`、队列 `lastEvent`、`taskTrace` 等实际 payload。

## 解决办法

- Controller 在每次任务执行结束后立即再次发布 controller 状态，确保 Dashboard 看到行为队列完成/失败后的最终 `currentTree`、`pendingTrees` 和 `lastEvent`。
- 增加 busy watchdog 心跳：当 controller 因执行中或 terminal trace stale 导致状态不刷新时，会发布当前 controller 状态；terminal trace stale 时会中断 motion 并释放 current queued work。
- 死亡和重生事件会标记当前动作被打断、释放当前行为树/LLM current task、结束 trace 并发布状态，避免 stale current 跨生命周期残留。
- 行为树调度新增 stale advisory 规则：不匹配当前本地规则的 LLM 行为树会被 `stale_<task>_before_<rule>` 跳过；非 busy 状态下遗留的 incompatible current tree 会被 failCurrent 释放，再继续扫描后续候选。
- Agent 思维导图升级为具体 payload 流：每个层级连接卡片显示 snapshot、progress、memory、`ruleDecision`、agent activation、LLM `taskRequests`、`behaviorTrees.constructorArgs`、queue `current/pending/lastEvent`、Controller `taskTrace`、recent failures 和 diagnostics 信号。

## 测试

- 新增 `behavior queue skips stale LLM advisory trees even without a runnable tree behind`，覆盖旧 LLM future task 不再让队列 pause。
- 新增 `behavior queue releases stale current tree before starting the active rule tree`，覆盖遗留 current 先释放再启动当前规则树。
- Dashboard 静态资源测试新增 `具体传递`、`ruleDecision.type`、`constructorArgs`、`队列 -> Controller -> 反馈` 和 `.agent-map-node.edge` 断言。
- `npm test -- test/behaviorExecution.test.js test/dashboardServer.test.js test/dashboardStatus.test.js` 实际运行通过：`304/304` passed。
- 重启 BOT 后 Dashboard `http://127.0.0.1:3000` 已加载新版图谱，浏览器验证到 16 个图谱节点、4 条 payload 边，且图谱包含 `具体传递`、`ruleDecision.type`、`constructorArgs`、`队列 -> Controller -> 反馈`。
- 重启后的 `/api/status` 在夜间 `wait_out_night` 场景中显示 diagnostics 为 `healthy`，`taskTrace.status=running` 且 trace age 正常；死亡/重生后没有继续保留旧 failed trace + current in_progress 的长时间组合。
- 继续观察到白天 `collect_wood` 后，LLM 旧 `wait_out_night` 和 `collect_building_materials` pending 行为树已按预期进入 completed skipped，原因分别为 `stale_wait_out_night_before_collect_wood`、`stale_collect_building_materials_before_collect_wood`。

## 后续观察

- 实机继续观察 `/api/status.controller.behaviorQueue.lastEvent` 是否从长期 `paused rule_*_priority` 转为短暂 `stale_*_before_*` 后继续本地规则。
- 如果仍出现 `task_trace_stale`，优先看 Agent 图谱中的 `trace.status`、`lastEvent` 和 recent failure payload，确认是执行器未返回、invalid position 恢复，还是 Dashboard 快照滞后。
