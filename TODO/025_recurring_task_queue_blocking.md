# 025 任务队列头部阻塞修正

## 背景

用户反馈：“任务经常性阻塞修复这个问题”。实时 Dashboard `/api/status` 显示 BOT 已连接且规则决策为 `collect_wood`，但 `behaviorQueue.active=true`、`currentTree=null`，pending 队列头部是两个旧 `hunt_food` 行为树，后面才是可执行的 `collect_wood` 行为树。队列最后事件为 `paused`，原因是 `rule_collect_wood_priority`，因此队列在头部旧任务上反复暂停，后面的当前规则任务无法启动。

## 检查结果

- `selectDecisionWithBehaviorQueue()` 只检查队列头部；如果头部任务与当前规则不兼容且不是硬安全/blocked 跳过条件，就直接 pause。
- 行为树队列按本地优先级排序，`hunt_food` 优先级高于 `collect_wood`；旧觅食计划会自然排在采木计划之前。
- 此时规则层会继续尝试普通 `collect_wood`，但 Dashboard 表现为行为树队列 pending 非空、current 为空、lastEvent paused，容易长期积累旧计划并造成“任务列表阻塞”。
- 旧 LLM 简单任务队列有同类风险：计划里前一个任务与当前规则不兼容、后一个任务可执行时，原逻辑也会停在队列头。

## 解决办法

- 在行为树队列调度中增加后续候选扫描：当队列头不适合当前规则时，先检查后面是否存在当前规则可执行树或显式恢复任务。
- 如果存在可执行后续任务，将旧队列头标记为 `stale_<task>_before_<rule>` 并 skip，继续扫描直到启动可执行任务或队列耗尽。
- 保留原有保护：硬安全任务仍会跳过/中断不匹配树；只有单个不兼容普通任务且后面没有可执行候选时，才继续 pause，让当前规则保持控制。
- 同步给 LLM 简单任务队列补同样逻辑，避免旧 `hunt_food` 等普通任务挡住后面的 `collect_wood` 或恢复任务。

## 测试

- `behavior queue skips stale higher-priority head trees to reach the current rule tree` 覆盖两个旧 `hunt_food` 排在 `collect_wood` 前时会被 stale skipped，最终启动 `collect_wood` 行为树。
- `controller skips stale queued heads when a later task matches the current rule` 覆盖 LLM 简单任务队列中 `hunt_food -> collect_wood` 的头部跳过。
- 运行 `npm test -- test/behaviorExecution.test.js test/controllerTaskQueue.test.js`，实际执行项目测试脚本中的整套 Node 测试，结果 `301/301` 通过。

## 后续观察

- Dashboard 中若再次看到 `behaviorQueue.active=true` 且 `currentTree=null`，应检查 `lastEvent.reason` 是否从 `rule_*_priority` 变为短暂的 `stale_*_before_*` 后继续启动后续任务。
- 如果 LLM 持续提交同类旧任务导致队列频繁 stale skipped，可以再增加跨计划的同参数去重或更短的普通行为树 TTL。