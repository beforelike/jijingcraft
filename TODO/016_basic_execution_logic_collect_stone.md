# 基础执行逻辑：采石目标选择修复

## 问题

运行中观察到 `collect_stone` 没有挖 BOT 身边或脚下已经裸露的石头，反而跑向远处、甚至选择泥土覆盖下的石头。这会让第一天石器链路被无意义寻路、挖泥土下方目标或 pathfinder timeout 拖垮。

## 原因

- 旧的 `surfaceOnly` 判定把“采矿站位上方有天空”当成地表石头证据，容易把目标石头本身仍被泥土覆盖的方块误判为可采裸露石。
- `maxMineBelow: 0` 会过滤 BOT 脚边低一格的真实裸露石头，导致近处安全侧挖目标被排除。
- BOT 正踩的支撑石以前被直接排除；这虽然避免了原地向下挖，但也会错过“先移动到侧边安全站位再挖脚下石头”的合理路径。

## 解决

- `collect_stone` 和 `exploreForSurfaceStone` 改为允许 `maxMineBelow: 1`，覆盖脚边/脚下低一格的地表裸露石。
- `isSurfaceMiningTarget()` 现在要求目标石头本身有顶部或侧面暴露面，不再只看站位天空列。
- `allowOwnSupportTarget` 只在采石地表搜索中启用：BOT 可以把当前支撑石作为目标，但执行阶段仍必须先找到并移动到安全侧挖站位。
- `miningTargetScore()` 对当前支撑石加小惩罚，让同样近的脚边裸露石优先，但脚下裸露石仍会优先于远处目标。

## 影响

- 采石应优先挖近处裸露石头，减少跑远、误挖泥土覆盖石和早期任务失败。
- 仍保留安全侧挖约束，不允许水中/危险方块/无安全站位目标进入采矿执行。
- 后续仍需继续处理 `collect_wood` 高树干目标、`explore` 近目标超时和甜浆果逃离 timeout 等基础 primitive 失败。

## 验证

- `node --test test/controllerExecution.test.js test/miningPlan.test.js`：81/81 pass。
- `npm test`：267/267 pass。