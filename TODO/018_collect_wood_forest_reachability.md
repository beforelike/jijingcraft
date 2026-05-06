# 018 基础生存执行逻辑：树林采木可达性

## 背景

用户指出 BOT 出生点就是树林，但日志仍然反复输出 `action=collect_wood; no reachable logs found, exploring for trees`。现场记录同时显示 BOT 已经扫描到 `spruce_log`，因此问题不是地形里没有树，而是采木基础任务把有效树干误判为不可达。

## 检查结果

- 现场日志中 `collect_wood` 连续失败，随后触发 `task_feedback=blocked; task=collect_wood`，攻略目标里原木仍为 `0/20`。
- 运行时记忆记录到多处 `spruce_log`，包括树干上方连续坐标，说明资源扫描能看到树林。
- `collectWood()` 会对显式 `targetPosition` 直接 `gotoNear(target.x, target.y, target.z, 4)`；如果 LLM 或记忆给的是高处原木方块，寻路目标就可能落在半空树干坐标上。
- `findSafeMiningStandPositions()` 只检查目标同高、低 1 格和高 1 格的站位。雪地/云杉树林里原木第一节可能在 BOT 脚上方 2 格，真正可砍位置是树旁地面，这个站位旧逻辑不会枚举。
- 重启后新增诊断继续显示 `mineable_candidates=3; usable_targets=0`，随后失败次数把采木搜索半径从 64 缩到 8；BOT 一边记录 `spruce_log` 在 `116,65,44`、`126,65,36`，一边只沿 z≈0 的冰面横向探索，未主动转向已记忆树林坐标。

## 解决办法

- `collectWood()` 新增显式目标转换：高处原木坐标先转为树旁安全砍伐站位；如果无法确认具体站位，则退到该 x/z 附近的当前地面高度区域，而不是直接寻路到高处原木方块。
- `findSafeMiningStandPositions()` 增加目标下方 2 到 3 格的候选站位，并用眼位到目标中心的距离限制保证仍在合理挖掘范围内。
- 采木失败重试不再缩小搜索半径，默认保持 64 起步并在持续失败时扩到 80/96，避免越失败越看不到树林。
- `collectWood()` 在附近扫描失败后会从 `memory.knownBlocks` 中选择最近的已记忆树干列，先靠近树旁安全站位或对应地面区域，然后重新扫描采木，而不是直接进入随机探索。
- `collectBlocks()` 在候选被全部过滤时输出 `mineable_candidates`、`usable_targets`、`requireReachableStand`、`maxTargetAbove` 和 `sample`，方便区分“没有扫描到树”“扫描到但被安全规则过滤”和“需要转向已记忆树林”。

## 影响范围

- 云杉、雪地森林或起伏地形中，BOT 可以从地面砍到高出脚面两格左右的最低可达树干。
- LLM/记忆给出高处 `spruce_log` 坐标时，路径不再追逐半空方块，而是接近树旁地面再进行批量采木。
- BOT 现场看到或记住远处树林后，会优先朝树干坐标靠近，不再沿单一方向连续探索到远离树林。
- 通用采矿站位也会允许少量下方安全站位，但仍要求站位本身安全、附近无伤害方块，并且目标在可挖距离内。

## 测试

- `node --test test/controllerExecution.test.js`：84/84 通过。
- `npm test`：277/277 通过。

## 后续观察

- 重启 BOT 后观察 `collect_wood` 是否从 `mineable_candidates>0; usable_targets=0` 转为实际 `collect_blocks` 或 `manual_dig`。
- 若仍失败，下一步检查 pathfinder 是否能到达树旁站位、是否被雪层/冰面/水边安全规则过滤，以及死亡后库存与进度是否同步。