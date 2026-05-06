# 022 环境感知食物规划修正

## 背景

上一轮修复把雪地出生点附近的成熟甜浆果放到远处冰湖鱼之前，解决了 BOT 追鱼溺水的问题。但这个规则不能泛化成“任何开局都浆果优先”。用户指出：该选择成立是因为当前出生点是雪地/冰湖环境，湖面冰层和水下追鱼风险高；如果出生环境变成普通平原、森林或其他安全区域，应先通过初始探索/地形扫描判断食物来源，再选择采集什么。

## 检查结果

- `foodStrategySummary` 直接把 `matureBerryBushes` 作为最高推荐源，缺少地形、水体、冰雪和氧气风险解释。
- LLM system prompt 使用了“prefer nearby mature berry bushes”的硬表达，容易让 smart brain 把浆果当通用优先级。
- `shouldPreferNearbyBerryFood` 会在前期食物不足时让近处浆果压过较远动物，策略仍然偏硬；它应该只在鱼类风险、地形风险、无武器且动物很远等条件下触发。

## 解决办法

- `foodStrategy` 新增 `decisionBasis`、`needsInitialExploration` 和 `environmentRisk`，显式暴露 `coldOrIcyTerrain`、`waterPressure`、`aquaticRisk`。
- LLM 提示改为：不能硬编码浆果优先；食物未知时先安全探索；普通安全地形优先近处陆地动物；雪地/冰湖/高水体/低氧风险下，成熟甜浆果才压过远处或水下鱼。
- Controller 增加本地食物地形风险判断。成熟浆果仍会压过远处/危险鱼，但不会压过近处安全陆地动物。

## 测试

- 更新 `llmPlanner` 上下文测试：普通草地 + 近处鸡时推荐 `land_animal`；雪地高水体 + 远处 salmon 时推荐 `mature_berry_bush`；未知食物/地形时推荐 `explore_safe_food`。
- 新增 controller 回归测试：近处安全陆地动物不会被浆果硬抢优先级。

## 影响

- 当前雪地冰湖场景仍会避开远处/水下鱼，选择更安全的成熟甜浆果。
- 其他出生环境不会被固定浆果策略绑死，LLM 和 Controller 会基于初探环境选择食物来源。
