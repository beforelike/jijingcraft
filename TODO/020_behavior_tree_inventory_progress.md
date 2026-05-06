# 020 行为树背包进度验证修复

## 背景

修复任务反馈阻塞后，现场继续观察到 BOT 已经能采到云杉木并推进制作流程，但 Dashboard 的 `recentFailures` 里仍出现 `craft_basic_supplies` / `craft_basic_tools` 的 `no_observable_progress`。日志显示实际发生过木板、工作台、木斧、木镐等制作动作，说明后置条件观察面太窄。

## 检查结果

- `ExecutableBehaviorTreeRunner` 的 `captureMetrics()` 只记录原木数量、食物数量、生命、饱食和位置。
- 默认行为树的 `verify_task_progress` 只比较这些字段，制作任务如果只改变木板、木棍、工作台、镐、斧等物品，就可能被误判为没有进度。
- 该误判属于完整行为树后置条件失败，会进入 `taskFeedback`，多次累积后仍可能造成任务 blocked。

## 解决办法

- 在行为树运行前后的 metrics 中加入 `inventoryFingerprint`，按物品名和数量生成稳定签名。
- `verify_task_progress` 现在把背包物品组成变化也视为可观察进度。
- 保留原有后置条件：生命下降、位置不变且背包不变的普通任务仍会报告 `no_observable_progress`。

## 测试

- 新增 `behavior runner treats inventory item changes as task progress`，覆盖 `craft_basic_tools` 只改变背包但不改变位置/原木/食物时仍算成功。
- `node --test test/behaviorExecution.test.js test/controllerExecution.test.js`：106/106 通过。
- `npm test`：280/280 通过。

## 现场验证

- 重启后 BOT 进入 `collect_wood`，先制作木板、工作台、木棍和木斧，再继续采木。
- Dashboard 状态显示 `blockedCount=0`、`recentFailureCount=0`，`logs=15`，没有再因为制作类背包变化被误判为 `no_observable_progress`。