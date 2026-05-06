# 021 食物、低氧、采石连续性修复

## 背景

现场观察到五个连续问题：任务反馈列表经常进入 blocked；狩猎追不上移动动物且会拿木斧当主武器；捕鱼时低氧不会中断；出生点附近有成熟甜浆果时仍规划远处冰湖鱼；采石已经到达石头层后只挖几块就离开并重新下挖。

## 检查结果

- `taskFeedback` 之前按同一任务的失败总数触发 blocked，不区分失败原因，容易把移动目标丢失、低氧撤离和普通失败混在一起。
- `huntFood` 已具备部分动态追踪能力，但成熟甜浆果仍在动物/鱼选择之后才尝试，水下追击也缺少低氧轮询。
- `HuntFoodTree` 仍使用静态 `gotoNear(target.position)` 和旧武器准备，和 Controller 的动态追踪/剑优先逻辑不一致。
- LLM 上下文虽然有 `matureBerryBushes` 和 `nearbyWater`，但没有直接告诉 smart brain “附近浆果优先，远水鱼后备”。
- `collectStone` 把一次 `collectBlocks(...).collected` 当成任务完成，即使实际只得到几块圆石。

## 解决办法

- `taskFeedback` 现在只用同一任务、同一动作、同一原因的重复失败触发 blocked；低氧、危险中断、紧急恢复和辅助移动失败不再长期阻塞任务。`hunt_food` 的 blocked 恢复任务收敛为安全探索，不再在饥饿时转去砍树或造房。
- 狩猎准备使用 `ensureHuntingWeapon()`，优先装备/制作剑；动态接近使用 `gotoEntity()`，移动目标会刷新位置。
- 水下/捕鱼追击改为短段轮询氧气；低氧时停止 pvp/pathfinder，执行 `escapeLowOxygen()` 并以 `taskFeedback:false` 记录。
- `huntFood` 在选择远处鱼之前优先扫描附近成熟甜浆果；LLM 上下文新增 `foodStrategy`，系统提示要求前期成熟浆果和陆地食物优先，远处/水下/冰下鱼只作后备。
- `collectStone` 按本次石材库存增量循环采集，未达到目标时继续当前工作面；部分成功会记住短期采石点，后续回到同一位置续采。

## 测试

- 新增 controller 回归测试：同任务不同失败原因不 blocked、成熟浆果优先于远处 salmon、低氧捕鱼触发撤离且不 blocked、石剑优先于木斧、可制作石剑时自动制作装备、采石部分进度会续采。
- 新增 behavior tree 回归测试：`hunt_food` 使用 `gotoEntity` 动态追踪，低氧撤离失败写入非阻塞反馈。
- 更新 LLM 上下文测试：验证 `foodStrategy.recommendedSource`、成熟浆果安全规则和 `HuntFoodTree.allowAquaticHunt` 参数Schema。

## 现场验证建议

- 白天在出生点附近放置成熟甜浆果和远处湖中 salmon，观察 Dashboard 的 `taskTrace` 应先进入 `plant_scan` / `harvest_plant`，而不是 `approach_animal` 追鱼。
- 让 BOT 在低氧状态接近水下鱼，日志应出现 `action=escape_low_oxygen`，Dashboard 不应新增 `hunt_food` blocked。
- 采石时观察 `action=collect_stone; progress=...; continuing_current_worksite=true`，应持续在当前工作面补足目标圆石。