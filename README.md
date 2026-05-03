# MC Survival Bot

第一阶段目标是实现一个能独自在服务器中探索和生存的 Minecraft 智能 BOT。当前实现是一个基于 mineflayer 的无作弊生存状态机，默认连接玩家客户端开放的服务器端口 `8000`。

## 需求分析

- BOT 需要独立连接服务器并持续运行。
- 第一阶段优先处理真实生存：饥饿、低血量、怪物威胁、基础资源采集、基地建设、食物储备、农牧起步和矿前准备。
- BOT 不依赖 `/give`、`/tp`、改时间、改难度等作弊指令。
- 网络搜索只在需要查资料时使用项目内安装的 Multi Search Engine skill。
- 后续第二阶段可在此基础上接入 Voyager/LLM 任务规划，让策略从固定状态机升级为可学习任务系统。

## 第一阶段方案

系统分为三层：

- 连接层：`src/botFactory.js` 创建 mineflayer BOT，加载寻路、采集、战斗和工具插件。
- 决策层：`src/survival/decision.js` 根据血量、饥饿、实体威胁和背包状态选择下一步任务。
- 执行层：`src/survival/SurvivalController.js` 执行吃食物、逃离怪物、采木、制作工作台、制作工具、采石、制作熔炉、狩猎、建房、做床、种植、围栏、诱导动物和矿物采集等动作。
- 进度层：`src/survival/progress.js` 评估木器、工作台、石器、熔炉、武器、大量食物、房屋、床、农田、动物围栏、矿前准备和高级材料等第一阶段里程碑。

优先级顺序：环境危险 > 低血量吃食物 > 怪物规避 > 饥饿处理 > 木材、工作台和木镐 > 采集圆石 > 第一时间制作石镐和石剑 > 启动食物储备 > 收集房屋材料 > 建造带门固定庇护所 > 大量食物储备 > 制作床 > 开始农田 > 建造动物围栏并尝试诱导动物 > 持武器寻找或挖掘矿道 > 收集煤、铁、铜等高级材料 > 探索。

## 第二阶段 LLM 规划

已完成对 `Voyager-main.zip`、`TouhouLittleMaid-1.20.zip`、`Ponderer-1.20.1.zip` 和 `Patchouli-1.21.x.zip` 的本地源码分析，并形成当前项目的 LLM 高层规划集成方案。建议路线是保留现有规则状态机作为安全底座，借鉴 Voyager 的课程/行动/评价/技能库闭环，TouhouLittleMaid 的 OpenAI 兼容客户端、工具调用、上下文注册和工具轮数限制，以及 Ponderer/Patchouli 的知识库、教程演示、建筑蓝图和失败复盘能力。详细报告见 [TODO/002_voyager_touhoulittlemaid_llm_integration.md](TODO/002_voyager_touhoulittlemaid_llm_integration.md)。

## 运行

安装依赖：

```bash
npm install
```

启动 BOT：

```bash
npm start
```

启动时会先 ping 服务器并检查 mineflayer 当前是否支持该协议版本。如果服务器返回的版本不在 `minecraft-protocol` 支持列表中，BOT 会停止并输出原因，而不是继续进入底层连接崩溃。

默认连接：

- Host: `localhost`
- Port: `8000`
- Username: `SurvivalBot`
- Auth: `offline`
- Protocol error logging: `HIDE_PROTOCOL_ERRORS=true`
- Auto reconnect: `AUTO_RECONNECT=true`
- Survival memory: `SURVIVAL_MEMORY_ENABLED=true`, `SURVIVAL_MEMORY_FILE=data/survival-memory.json`
- Night exploration guard: `AVOID_NIGHT_EXPLORATION=true`
- Action timeout: `ACTION_TIMEOUT_MS=25000`
- Block placement timeout: `PLACE_BLOCK_TIMEOUT_MS=3000`
- Starter food reserve: `STARTER_FOOD_TARGET=6`
- Food stock target: `FOOD_STOCK_TARGET=18`
- Starter house: `BUILD_SHELTER=true`, `HOUSE_BLOCK_TARGET=80`
- Bed and farming: `WOOL_TARGET=3`, `PLANT_CROPS=true`, `CROP_PLOT_TARGET=6`
- Animal pen: `BUILD_ANIMAL_PEN=true`, `ANIMAL_PEN_BLOCK_TARGET=32`
- Mining preparation: `ADVANCED_MATERIAL_TARGET=8`, `MINE_SEARCH_RADIUS=64`

可以通过环境变量或命令行覆盖：

```bash
MC_HOST=localhost MC_PORT=8000 BOT_USERNAME=SurvivalBot npm start
node src/index.js --mc-host localhost --mc-port 8000 --bot-username SurvivalBot
```

`HIDE_PROTOCOL_ERRORS=true` 会关闭底层协议库的 partial packet 调试输出，用于避免服务器中实体同步警告刷屏；BOT 仍会通过自己的日志输出连接、决策和运行错误。

`AUTO_RECONNECT=true` 会在 BOT 被踢出或连接断开后自动重新执行协议检查并加入服务器；`RECONNECT_MIN_DELAY_MS` 和 `RECONNECT_MAX_DELAY_MS` 控制重连退避时间。

`SURVIVAL_MEMORY_ENABLED=true` 会把 BOT 的本地生存记忆保存到 `SURVIVAL_MEMORY_FILE`。当前会记录已知工作台坐标、已达成进度、房屋位置、农田、动物围栏、矿道探测次数和动作失败学习状态。工作台被放到地上后会被记录，后续制作会优先复用附近或记忆中的工作台，不再因为背包里没有工作台就反复制作新的。`KNOWN_BLOCK_SEARCH_RADIUS=96` 控制回到已知工作台的最大距离。需要完全重置 BOT 记忆时，可以停止 BOT 后删除该文件。

失败学习状态用于避免 BOT 以同样方式反复失败。采集、寻路、甜浆果安全站位和无效坐标恢复会记录动作、目标、失败原因和坐标冷却；后续同类任务会跳过近期失败点，转向其他资源或重新决策。日志中的 `learning=failure`、`learning=success` 和 `skipped learned risky...` 可用于确认该机制正在生效。

`AVOID_NIGHT_EXPLORATION=true` 会让 BOT 在夜间停止主动远距离探索，改为原地警戒；如果敌对生物进入安全半径，会立即撤离或防御。夜间警戒不会再反复按蹲下键，因此客户端不会看到 BOT 一直重复弯腰。若背包里已有足够材料，BOT 会优先在原地完成木板、木棍、基础工具、熔炉或武器等安全制作任务，然后再等待天亮。没有正式房屋但有建筑方块时，BOT 会先搭建封闭临时庇护：两格高墙体、四角补强和完整屋顶会优先阻断 skeleton 视线和怪物路径。

`IMMEDIATE_THREAT_RADIUS=8` 会限制夜间无庇护时只有近距离怪物才触发反应，避免看到远处怪物就离开安全点。没有正式庇护所且没有方块时，远处怪物只会让 BOT 保持警戒，不会驱动长距离撤离。若近身怪物出现，BOT 会优先封闭临时庇护或撤离；只有敌人已经贴脸、撤离空间不足且 BOT 有武器时，才把原地自卫作为兜底。`SHELTER_DEFENSE_RADIUS=4` 会让已有入门庇护所的 BOT 在夜里留在屋内，只对贴近庇护所的怪物原地防御，不主动追出去。

`PANIC_RETREAT_MS=3500` 控制近距离危险时的短撤离时间。撤离会优先选择远离敌人的安全落脚点并通过 pathfinder 前往；只有找不到安全路径时才进行很短的手动疾跑，且每一步都会检查前方是否有可站立地面，避免盲跑到悬空或无效坐标状态。撤离时间不宜过长，否则夜间容易跑离安全点并进入新的敌对生物范围。

BOT 受到伤害时会立即打断当前采集、寻路或等待动作。若伤害来自脚下或身边危险方块，会先脱离危险方块；若附近有敌对生物，会先撤离到更安全的位置，只有撤离失败且敌人仍贴近时才进行最后反击。若伤害来源没有被实体或方块识别到，BOT 也会执行一次安全重定位，避免受伤后继续站在原地。

如果 Mineflayer 实体坐标连续多轮变成无效值，BOT 会主动断线并依赖 `AUTO_RECONNECT` 重新加入服务器。这个恢复路径用于处理客户端看见 BOT 悬浮、控制器日志显示 `position is invalid` 或 `arrived=unknown` 的状态；未死亡时单纯 `respawn()` 无法修复这类实体同步问题。

`ACTION_TIMEOUT_MS=25000` 会限制单次寻路/采集动作的最长等待时间。超时后 BOT 会取消当前采集或寻路，清理移动状态，然后进入下一轮决策，避免白天卡在原地。

`PLACE_BLOCK_TIMEOUT_MS=3000` 会限制单次清理目标方块或放置建筑方块的等待时间。某个位置无法放置时，BOT 会跳过该位置继续尝试，避免建筑任务卡住控制循环。

BOT 会在采集前按目标方块切换工具。砍树会优先制作并装备斧头；如果暂时做不出斧头，会空手砍树，而不是继续拿镐。采石会优先寻找地表或山坡上裸露、上方接近露天的石头；地表目标会压过更近的地下石头，连续多轮找不到地表石头后才允许进入阶梯矿道兜底。挖到圆石并拥有工作台与木棍后，BOT 会优先从木镐升级为石镐，并在材料允许时制作石剑和石斧；石剑优先级高于石斧。采集日志中的 `tool=...` 字段可用于确认当前手持工具。

BOT 会避开仙人掌、凋零玫瑰、滴水石、岩浆块、火、岩浆和水域等早期危险环境。甜浆果灌木会被特殊处理：成熟甜浆果会从相邻安全方块右键采集，只有 BOT 真的站进灌木或受到接触伤害时才触发逃离。若健康变化时检测到正在接触伤害方块，会取消当前采集/移动，先短距离疾跑脱离，再走安全寻路。

`STARTER_FOOD_TARGET=6` 会让 BOT 在石镐和石剑成型后、建造固定房屋前先准备一小段启动食物，避免一边收集建筑材料一边饿死。`FOOD_STOCK_TARGET=18` 会让 BOT 在固定庇护所可用后、继续远距离探索前主动准备较大的食物储备；`FOOD_SEARCH_RADIUS=48` 控制动物和可采甜浆果的搜索半径。

`BUILD_SHELTER=true` 会让 BOT 在自由探索前收集建筑材料并搭建一个 5x5 入门房屋，包含围墙、屋顶和可重复进出的门；`HOUSE_BLOCK_TARGET=80` 控制开始建造前期望拥有的可用建筑方块数量。房屋完成度现在需要达到 90%，且门洞位置必须被门或防御方块保护，才会被记为可防御庇护。夜间会按完整墙体、屋顶和门洞位置重新检查并修补漏洞。为了兼容旧配置，仍可使用 `SHELTER_BLOCK_TARGET`，但新配置优先读取 `HOUSE_BLOCK_TARGET`。

记忆中的房屋不会被无条件当成当前安全点。BOT 只有在自己确实靠近房屋坐标、且本地检查到墙体/屋顶仍达到防御完整度时，才会使用“屋内等待”和小范围防御逻辑；死亡重生或探索到远处时，会按野外夜间逻辑处理，优先临时封闭庇护、大范围扫描、撤离或最后反击。

`WOOL_TARGET=3` 会让 BOT 在建房后主动寻找羊并制作床；`PLANT_CROPS=true` 与 `CROP_PLOT_TARGET=6` 会让 BOT 搜集种子或可种植食物，制作锄头并开始农田。

`BUILD_ANIMAL_PEN=true` 与 `ANIMAL_PEN_BLOCK_TARGET=32` 会让 BOT 在农田起步后建造动物围栏；若背包里有合适饵料，会尝试把附近动物引向围栏区域。

`ADVANCED_MATERIAL_TARGET=8` 和 `MINE_SEARCH_RADIUS=64` 控制矿前阶段。基地、食物、床、农田和围栏完成后，BOT 会持武器寻找煤/铁/铜等矿物；如果附近没有安全暴露矿物，会挖一个浅层阶梯矿道探测入口。采石和采矿会优先站在安全侧面挖墙面目标，不会追着低处目标垂直向下挖，也不会把水里或水边位置当成安全站位；主动挖矿入口会按前进方向逐步下降，形成可以原路返回的梯步。若 BOT 已经掉进坑里且周围没有同层出口，会先执行 `escape_pit`，尝试走到坑沿，失败后挖上升阶梯并在缺支撑时使用泥土、圆石、木板或原木补一个垫脚支撑。BOT 会在日志中输出 `progress=...` 和 `progress_stage=...`，用于观察当前第一阶段游戏进度。

`MC_VERSION` 默认留空，由 mineflayer 自动探测。若服务器自动探测失败，再填标准 Java 版本号，例如 `1.21.1` 或 `26.1.1`。

## 当前协议诊断

历史测试中，`localhost:8000` 曾返回：

- Version: `26.1.1`
- Protocol: `775`

当前已发布的 `mineflayer@4.37.0` / `minecraft-protocol@1.66.0` 支持列表最高到 `1.21.11`，暂不支持 protocol `775`。因此 protocol `775` 服务器不能直接加入。当前测试服务器切换到 `1.21.11` / protocol `774` 后，BOT 可以正常进入服务器。

## 测试

```bash
npm test
```

当前测试覆盖配置解析、生存决策优先级、进度评估、生存记忆、阶梯矿道规划、防御庇护规划、制作路径、前期石器/食物门槛、夜间封闭/撤离优先级和受伤应急反应策略。

## 已知限制

- 第一阶段是规则状态机，不包含 LLM 自主写代码或长期技能库。
- 农牧目前是第一阶段起步能力：能建围栏、开农田并尝试诱导动物，但还没有完整的自动繁殖、收割、补种和长期基地坐标持久化。
- 服务器若启用正版验证，需要设置 `MC_AUTH=microsoft` 并完成 mineflayer 支持的登录流程。