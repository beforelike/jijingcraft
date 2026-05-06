# 024 实体不移动与任务列表阻塞修正

## 背景

用户实机观察到：“BOT现在是根本没有动，不是体感上没有执行任务，同时，任务列表还是经常阻塞。” Dashboard `/api/status` 连续采样显示坐标保持在同一点，控制器 `busy=true`，当前显示任务为 `collect_stone`，但阶段追踪和事件实际停在 `collectWood -> approach_known_log`，并多次出现 `collect_wood_known_log` 20 秒超时。

## 检查结果

- `collectStone()` 在没有 pickaxe 时会先调用 `craftBasicTools()`，工具准备又会进入 `collectWood()`；因此 Dashboard 上的 `collect_stone` 可能实际卡在采木前置步骤。
- `gotoNear()` 和 `gotoBlock()` 只有总超时，没有实体位移进度监控；如果 pathfinder promise 忙但 BOT 物理位置不变，会等完整 12-20 秒才失败。
- `recordLearningEvent()` 已经会把失败位置写入 `learning.avoidedPositions` 和 `policyStats` 冷却，但 `knownLogTargets()` 没有读取这些避让/冷却数据，导致旧的不可达树干被反复选中。
- `collect_wood` blocked 后的恢复任务包含 `collect_stone`，而空背包/无工具状态下 `collect_stone` 又会回到采木，形成“看似换任务，实际仍卡采木”的阻塞循环。

## 解决办法

- `gotoNear()` 和 `gotoBlock()` 调用 `withTimeout()` 时启用 movement watchdog：默认每秒检查位置，长时间没有超过最小位移就提前失败、重置 motion，并把失败原因写成 `movement stalled ...`。
- `withTimeout()` 增加可选 movement watch 参数，保留原总超时逻辑；测试可通过较短采样和 stall 时间快速覆盖。
- `knownLogTargets()` 在选择记忆树干前检查 `collect_wood_known_log:known_log_area` 的策略冷却，并跳过处于学习避让半径内的树干坐标。
- 近处已加载且变成 `air` 的记忆树干会从 memory 中删除，减少已消失目标继续参与排序。
- `collect_wood` 被 task feedback 阻塞时，恢复任务收敛为 `explore`，不再允许 `collect_stone` 或建筑材料收集绕回采木前置逻辑。

## 测试

- `gotoNear aborts early when pathfinder is busy but the bot is not moving` 覆盖 pathfinder promise 不返回且 BOT 坐标不变时的早停。
- `knownLogTargets skips learned avoided logs and policy cooldowns` 覆盖已避让树干和策略冷却时不再选中旧记忆目标。
- `task feedback success clears recent failures for completed task` 断言 `collect_wood` blocked 的恢复任务现在只有 `explore`。
- `behavior queue skips non-recovery trees when the rule task is blocked` 明确覆盖 queued `collect_stone` 在 `collect_wood` blocked 时会被跳过，直到 `explore` 接管。
- 运行 `npm test -- test/controllerExecution.test.js test/behaviorExecution.test.js`，实际执行整套 Node 测试，结果 `299/299` 通过。

## 后续观察

- 实机继续观察 Dashboard 最近事件里是否从长时间 `timed out after 20000ms` 变为更快的 `movement stalled`，以及之后是否进入 `explore` 换区域。
- 如果 BOT 因服务端 TPS 或 pathfinder 计算慢而误判 stationary，可放宽 `movementStallMs` 或只对采集/探索等普通任务启用更短阈值。
- 如果记忆中的远处树木经常处于未加载状态且确实可达，可以进一步把 known-log approach 的候选数和重试顺序按失败次数动态降权。
