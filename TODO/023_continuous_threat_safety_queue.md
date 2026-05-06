# 023 持续威胁安全接管与队列阻塞修正

## 背景

实机观察中，BOT 夜间 0 饱食、极低血时进入 `recover_starvation`，但安全半径内仍有 skeleton/zombie/creeper 压力。旧逻辑只在 immediate 半径内触发撤离；撤离一段后怪物仍在远处时，`hold_position` 会切到 `shelter_hold` 并等待，最终在持续追击中死亡。同时行为树队列可能保留过期的 `eat_food` 或普通任务，在硬安全规则到来时只记录 `hard_safety_behavior_queue` paused，Dashboard 看起来像任务列表阻塞。

## 检查结果

- `decision.js` 的夜间无庇护规则只用 `immediateThreatRadius` 触发 `evade_hostiles`，远处但仍在 `safeModeThreatRadius` 内的怪物会落到等待/制作/饥饿恢复。
- `recoverFromStarvation` 只检查近身敌对生物；无食物、极低血、夜晚时会进入“夜间低血原地防守”。
- `holdPositionSafely` 在夜间无庇护且无方块时，对非近身敌对生物只等待 1 秒后继续循环，不主动拉开距离。
- `selectDecisionWithBehaviorQueue` 遇到硬安全规则与队首行为树不一致时只 pause，不清理旧树。
- 饥饿造成的小额扣血会走 `unknown_damage`，触发不必要的安全重定位。
- Dashboard diagnostics 只看连接、位置、环境危险和 blockedTasks，极低血、0 饱食、夜间敌对压力仍可能显示 healthy。

## 解决办法

- 夜间无可用庇护时，把安全半径内的敌对生物视为持续压力；无建筑方块时持续 `evade_hostiles`，有方块时优先封闭临时庇护。
- `recover_starvation` 在夜间开放地带先处理 `safeModeThreatRadius` 内的敌对压力，再尝试近处食物或低血防守。
- `holdPositionSafely` 对开放夜晚的敌对压力直接撤离，不再等怪物进入贴脸半径。
- 硬安全规则接管时，行为树队列会跳过 pending 旧树，或中断 current 旧树，然后继续寻找与当前硬安全规则匹配的行为树。
- 0 饱食且小额掉血被记录为 `starvation_damage`，不再触发 `unknown_damage` 重定位。
- Dashboard diagnostics 新增 `critical_health`、`starvation_empty_food`、`night_hostile_pressure` 和 `behavior_queue_safety_paused`。

## 测试

- 决策测试覆盖极低血夜间远处 hostile 触发 `evade_hostiles`。
- 行为树测试覆盖 stale `eat_food` 被 `recover_starvation` 硬安全接管跳过，以及 current 普通行为树被 `evade_hostiles` 中断。
- Controller 测试覆盖 `recoverFromStarvation` 夜间持续压力先撤离、`holdPositionSafely` 开放夜晚撤离、饥饿掉血不触发 unknown damage。
- Dashboard 测试覆盖低血、0 饱食、夜间敌对压力和硬安全队列暂停诊断。

## 后续观察

- 实机继续观察夜间无方块、无食物、极低血时是否能持续扩大与 zombie/creeper/skeleton 的距离。
- 如果持续撤离把 BOT 带到新的怪物群，应增加“朝最近已知庇护/安全地形撤退”的方向偏好。
- 如果蜘蛛白天未攻击但仍被视为压力，需要加入白天蜘蛛中立状态或受击来源判定。
