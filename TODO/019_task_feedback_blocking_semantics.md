# 019 任务反馈阻塞语义修复

## 背景

用户指出任务列表大部分时间都处于 blocked。现场采木修复验证时，BOT 一次 `collect_wood` 内部会连续尝试多个已记忆树干坐标；每次辅助寻路失败都会写入 `taskFeedback`，导致完整任务尚未走到 fallback 或手动挖掘阶段，就已经把 `collect_wood` 标记为 blocked。

## 检查结果

- `recordActionFailure()` 默认会调用 `recordTaskFeedbackFailure()`，而 `currentDecisionType` 会把内部动作归到当前任务，例如 `collect_wood_known_log`、`collect_blocks` 插件失败都会计入 `collect_wood`。
- `collectBlocks()` 在 Mineflayer `collectBlock.collect()` 失败后会切到 `collectBlocksManually()`，但旧逻辑已经先把插件失败算进任务阻塞计数。
- `gotoNear()` 和 `gotoBlock()` 没有透传 `taskFeedback: false`，因此辅助寻路即使只是学习避让，也会触发 blocked。
- 完整任务成功后只解除 blocked 状态，不会清理该任务的近期失败历史，后续少量失败仍可能快速再次 blocked。

## 解决办法

- `gotoNear()`、`gotoBlock()` 支持透传 `taskFeedback`，采木显式目标接近、记忆树干接近等辅助移动使用 `taskFeedback: false`。
- `collectBlocks()` 的插件路径失败只写学习记录，不再直接计入任务阻塞；手动 fallback 的单个站位/挖掘失败也只做学习记录。
- 安全采矿内部的单目标站位失败和挖掘失败不再立刻阻塞完整采集任务，避免一次批量采集内多个候选失败把队列锁死。
- `recordTaskFeedbackSuccess()` 会在任务成功时清理同任务的近期失败记录，同时解除 blocked 状态。
- 控制循环在完整任务返回成功后统一调用 `recordTaskFeedbackSuccess(decision.type)`，确保没有显式子动作成功记录的任务也能清理失败历史。

## 影响范围

- Dashboard 仍会显示 `learning=failure`，可复盘具体路径和目标失败；但任务列表只在完整任务连续失败后才进入 blocked。
- LLM/行为树队列不会再因为一次 primitive 内部 fallback 的多个中间失败而长时间停在 blocked 恢复模式。
- 真正的完整任务失败仍会通过行为树后置条件或任务执行结果进入 `taskFeedback`，恢复任务机制保留。

## 测试

- `node --test test/controllerExecution.test.js`：86/86 通过。
- `npm test`：279/279 通过。

## 后续观察

- 已重启现场观察：白天进入 `collect_wood` 后，Dashboard 状态显示 `blockedCount=0`、`recentFailureCount=0`；日志进入 `action=collect_blocks; targets=spruce_log...`，没有再被内部辅助尝试快速写成 blocked。
- 后续现场继续观察到采木已经实际入包，`logs=5`，并推进到制作木板、工作台、木斧和木镐；`blockedCount` 仍为 0。
- 同时发现新的误判来源：制作类行为树已经改变背包，但通用后置条件只看原木、食物、生命和位置，可能把 `craft_basic_supplies` / `craft_basic_tools` 误记为 `no_observable_progress`。已在 `020_behavior_tree_inventory_progress.md` 中单独记录并修复。