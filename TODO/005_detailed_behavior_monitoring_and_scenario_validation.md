# 005 - 详细行为监控与场景化验证

## 背景

当前 BOT 已经能连接服务器、执行第一阶段生存状态机，并接入 LLM dry-run planner。但只展示 `decision.type` 的行为树不足以判断复杂任务是否合理，例如觅食/狩猎实际需要准备、搜索、发现食物源、接近、攻击或采集、处理伤害与怪物、拾取掉落物和验证食物是否增加。

## 已完成

- 行为树节点新增阶段模板，`hunt_food`、`defend_self`、`evade_hostiles`、`collect_wood`、`collect_stone`、`wait_out_night` 和 `build_shelter` 可显示子阶段状态。
- `SurvivalController` 新增 `taskTrace` 生命周期：每次决策开始生成追踪，动作执行时发布阶段、观测、风险和结果。
- 狩猎/觅食已拆分为准备、扫描动物与植物、植物扫描、发现食物源、接近动物、安全采集站位、攻击动物、采集植物、风险应对、拾取和验证。
- 近战防御和敌对生物撤离已发布装备、锁敌、站位、攻击、撤离、拾取和验证阶段。
- Dashboard 新增“任务阶段追踪”面板，显示当前任务、当前阶段、目标/原因、风险、阶段时间线和最近观测。
- 单元测试覆盖行为树阶段、`/api/status` 的 `taskTrace` 归一化，以及直接构造的狩猎/近战场景推进。

## 场景化验证标准

复杂行为不能只通过静态 mock 判断成功。每次修复或新增动作后，需要把发现的问题转成可直接复现的场景，并观察 BOT 是否能在短时间内推进到目标阶段。

- 狩猎/觅食：切到白天，在 BOT 附近放置动物或成熟甜浆果，观察 `taskTrace` 是否推进到攻击/采集、拾取和食物增加验证。
- 战斗：给 BOT 一把石斧或石剑，在近身范围生成敌对生物，观察是否装备武器、保持距离、攻击，并在低血时撤离。
- 失败学习：对同一失败点重复构造场景，确认 `memory.learning` 会记录失败并在后续跳过风险点或切换策略。
- 危险方块：把 BOT 放在甜浆果、岩浆块或其他早期危险旁，确认任务被打断并先执行风险应对。

## 真实服务器命令模板

以下命令需要服务器允许执行 OP 指令，执行前应记录 BOT 坐标并清理干扰实体。

```text
/time set day
/weather clear
/kill @e[type=zombie,distance=..20]
/give SurvivalBot stone_axe 1
/summon zombie <bot_x+3> <bot_y> <bot_z>
/summon chicken <bot_x+5> <bot_y> <bot_z>
```

通过标准：Dashboard 中 `taskTrace.phaseEvents` 在超时时间内出现对应关键阶段，并且最终 `verify` 阶段为 `completed`，或在失败时出现明确 `risk_response`/`fallback` 与学习记录。

## 本轮验证记录

- `npm test` 通过：179 个测试全部成功。
- 编辑器诊断通过：Dashboard、Controller 和新增测试文件未发现静态错误。
- 使用 mock Dashboard 服务验证页面渲染：行为树阶段、任务阶段追踪、风险观测和 LLM 面板均能显示，无前端控制台错误。
- 发现 3000 端口仍由旧 `node src/index.js` 进程提供状态，旧进程的 `/api/status` 没有 `taskTrace`；停止旧 `npm start`/`node` 进程后重新启动，最新后端开始发布 `taskTrace`。
- live Dashboard 验证通过：真实 BOT 连接 `localhost:8000` 后，`/api/status.taskTrace` 显示 `evade_hostiles` 的“扫描威胁 -> 寻找撤离路线”，随后显示 `collect_wood` 的“准备伐木工具 -> 搜索低位可达树干”。LLM 状态从 `planning` 转为 `ok`，并记录了真实 planner 调用。
- 将 `npm run scenario:berries` 调整为甜浆果误入逃脱 live 场景测试，并新增等价命令 `npm run scenario:berry-escape`：脚本不再生成随机测试 BOT，而是复用当前 `SurvivalBot`；最新版本改为通过 `POST /api/test/pipeline` 切入测试任务管道，把 `escape_hazard` 与普通优先任务、LLM 队列和常规任务隔离。测试管道不会清空普通优先队列和 LLM 队列，硬安全仍然压过不相关测试任务。脚本会把 BOT 送入 21x21 草地方台和默认 9x9 成熟甜浆果丛内测试误入逃脱，但不会清背包、清效果、切游戏模式或修改 movement_speed 等 BOT 自身属性；水平速度仍按默认 `5.2` blocks/s 阈值审计。通过标准是测试管道任务被消费，硬安全层触发 `escape_hazard`，执行 `action=escape_hazard_block`，在正常状态下存活，并且必须离开生成的甜浆果区域；脚本记录真实掉血或 `emergency=damage_block`，但不为了制造掉血而强行让 BOT 在浆果碰撞里移动。
- 本轮严格 live 验证通过：`npm run scenario:berry-escape` 在真实服务器上复用原 `SurvivalBot`，高优先级 `escape_hazard` 被消费并标记完成，BOT 从 9x9 浆果区中心逐格清出通道并移动到 `-4.4, 80, 0.5`，`outsideBerryPatch=true`，`environmentHazard=null`，生命保持 20，最大水平速度 `1.07` blocks/s，低于 `5.2` 阈值；清理前仍剩余 65 棵甜浆果，说明测试没有通过清完整片 patch 取巧。
- 新增通用优先级任务列表：`SurvivalController.insertPriorityTask` 可插入高优先级任务，Dashboard `controller.priorityTasks` 会显示 current/pending/completed；它不依赖 LLM 队列，后续玩家聊天或其他外部交互产生的新任务可以复用该入口。硬安全任务仍压过不相关的插队任务，若插入任务与当前硬安全任务一致，则会被正常消费并标记完成。
- 新增测试任务管道：`SurvivalController.insertTestTask` 和 Dashboard `POST /api/test/pipeline` 提供独立的 `controller.testTasks` 状态。测试管道在控制循环中位于 forced task 之后、普通优先队列和 LLM 队列之前，用来隔离 live 场景验证；普通优先任务保留给玩家聊天或外部任务插入，不再承担测试隔离职责。
- 测试任务管道 live 验证通过：重启最新 BOT 并启用 `TEST_CONTROL_ENABLED=true` 后，`npm run scenario:berry-escape` 通过 `POST /api/test/pipeline` 插入 `escape_hazard`。BOT 在真实服务器 `localhost:8000` 的 9x9 成熟甜浆果区域中触发 `escape_hazard`，`controller.testTasks.completedTasks` 记录任务完成，普通 `priorityTasks` 保持空队列；最终坐标 `-4.3, 80, 0.5`，`outsideBerryPatch=true`，`environmentHazard=null`，最大水平速度 `1.15` blocks/s，低于 `5.2` 阈值。脚本没有执行 `/attribute ... movement_speed`、`/clear`、`/effect clear` 或 `/gamemode survival`；清理前仍剩余 65 棵甜浆果，证明测试只切换任务管道，没有通过改变 BOT 自身属性或清整片 patch 取巧。
- 修复正常运行中移动速度观感过快：代码搜索确认普通 pathfinder 已设置 `allowSprinting=false`，但危险方块快速撤离和敌对生物手动撤离仍会直接 `setControlState("sprint", true)`。现已改为强制 `sprint=false`，让应急移动也保持普通步行控制，不再出现非玩家式疾跑；同时确认 `src` 与场景脚本中不再包含 `sprint=true` 或 movement_speed 属性修改命令。新增 `manual emergency movement keeps normal walking speed` 与 `quick hazard retreat keeps normal walking speed` 两个回归测试，全量 `npm test` 通过 185/185。正常模式重启 BOT 后，启动探索段从 `1,80,6` 到 `1,80,-3` 约 2.25 秒，折算约 `4.0` blocks/s；随后 60 秒 Dashboard 坐标采样最大水平速度为 `0`，BOT 在夜间低饥饿状态下保持原地等待，没有出现异常高速移动。
- 修复任务系统缺少动态反馈闭环：此前 `learning=failure` 只写入记忆和位置冷却，规则任务仍会反复选择同一个失败任务，LLM 也只能 dry-run 记录计划而不影响调度。现新增 `controller.taskFeedback`，动作失败会归并到当前任务，短时间连续失败会把任务标记为 blocked，并同步到 Dashboard 与 LLM planner context。调度层在非硬安全窗口会先让 LLM 安全队列尝试不同的恢复任务；若没有可用 LLM 任务，本地 fallback 会根据环境切换，例如夜间 `hunt_food` 连续失败时转为 `hold_position`/`wait_out_night`，白天则转为 `explore` 寻找新区域。`LLM_TASK_QUEUE_ENABLED` 默认跟随 `LLM_ENABLED`，LLM 计划通过白名单校验后可入安全队列；当规则任务 blocked 时，队列允许不同恢复任务接管，但不允许重复执行同一个 blocked 任务。新增回归测试覆盖 blocked 反馈生成、本地重规划、LLM 替代任务接管、禁止 LLM 重复 blocked 任务、LLM 强制反馈规划和 Dashboard 状态发布；定向测试 80/80 通过。
- 新增测试控制启动参数：`TEST_START_PAUSED_MS` 与 `TEST_INITIAL_FORCED_TASK` 允许 live 场景在第一轮控制 tick 前暂停并锁定任务，防止测试 BOT 在场景还没切换到目标任务前执行探索或伐木。
- 修复觅食采集上限：`forageNearbyFood` 不再固定只尝试 4 棵成熟甜浆果，而是按 `FOOD_STOCK_TARGET` 上限搜索并持续采集，直到达到食物目标或当前成熟浆果片被处理完。
- 本轮用户进一步澄清：当前问题不是主动采集整片浆果，而是 BOT 误入浆果丛后被刺死；因此 live 场景测试不再强制 `hunt_food`，也不再把采集整片浆果作为通过标准，避免普通任务失败和非正常测试条件干扰逃脱能力判断。
- 修复低血无食物错误撤离循环：此前 `health=1`、`food=0` 且没有近身敌对生物时，规则层会直接选择 `evade_hostiles`，导致 BOT 在没有真实敌人目标时随机撤离、路径失败并重复消耗状态。现新增硬安全任务 `recover_starvation`：优先停止移动、检查背包食物、检查近身威胁、短半径寻找即时安全食物；没有可行食物时记录 `no_immediate_safe_food` 并进入安全保持，而不是随机逃跑。若确有近身敌对生物，仍保持 `evade_hostiles`。
- 修复 starvation 场景没有强制思索的问题：`maybeStartPlannerDryRun` 现在会把 `force` 传入 `llmPlanner.shouldRun(Date.now(), { force })`；同时新增 starvation advisory window，在低血无食物但没有岩浆/坑洞/危险方块/近身敌对时允许 LLM 进行旁路规划。LLM 仍不能直接执行 Mineflayer API，计划必须通过白名单和安全队列。
- 修复 invalid position 主动重连循环：旧逻辑连续 3 次位置无效后执行 `bot.quit("Invalid position recovery")`，实机日志出现 `bot disconnected: Invalid position recovery` -> 5 秒后重连的进出服务器循环。现改为暂停控制器 15 秒、重置无效位置计数、记录 `invalid_position` 反馈，不再主动退出游戏。新增回归测试确认该分支不会调用 `bot.quit`。
- 修复 blocked 后恢复探索仍在小范围往返的问题：`explore` 支持 food/wood recovery 模式。当 `hunt_food` 或 `collect_wood` 被反馈系统标记 blocked 时，探索会选更远的安全站点 `[24, 32, 40, 48, 64]`，避开最近探索目标，并使用 `food_recovery_explore`/`wood_recovery_explore` 标签与更严格到达范围，避免只在平台边缘来回走。
- 修复低饥饿下 LLM 队列抢占食物恢复：当规则任务是 `hunt_food` 或低饥饿且背包无食物时，LLM 队列不再允许 `collect_wood`、`craft_basic_tools` 等非食物任务接管；blocked `hunt_food` 只允许 `explore` 作为恢复任务。blocked 非食物任务仍可由 LLM 的不同安全恢复任务接管，例如 blocked `collect_wood` 可被 `explore` 替代。
- 最新回归测试通过：定向测试覆盖 starvation 决策与执行、planner force、invalid-position 不退出、food/wood recovery 探索、低饥饿 LLM 队列门禁和 Dashboard/LLM 状态；全量 `npm test` 通过 201/201。
- 最新 live 验证：重启最新 BOT 后连接 `localhost:8000`，低血无食物实景直接触发 `decision=recover_starvation`，日志记录 `action=recover_starvation` 和 `no_immediate_safe_food`，没有再出现 `bot disconnected: Invalid position recovery` 或主动进出服务器循环。Dashboard `/api/status` 显示 `connection=connected`、`health=1`、`food=0`、LLM `recentCalls` 有 `ok`/`accepted` 记录；同时也出现一次 `request_timeout_60000ms` 和一次 `non_queueable_tasks` 拒绝，说明 LLM 有真实调用，但硬安全与队列过滤仍会阻止不可执行或非安全任务。
- 修复 invalid-position hold 原地空等：用户反馈 BOT 满血满饥饿但停在原地且任务不更新。Dashboard 显示 `decision=hold_position`、`controllerBusy=true`、LLM 队列已有 `explore` pending，但最近事件反复出现 `control tick skipped; waiting for a valid bot position` 和 `invalid position persisted; holding controller instead of reconnecting`。根因是手动撤离后 Mineflayer 本地 `bot.entity.position` 可能变成无效坐标，旧逻辑为避免进出服务器循环只暂停 15 秒，却没有实际恢复实体坐标；同时还把 `invalid_position` 归入 `hold_position` 失败反馈，导致 hold 任务被 blocked。现已在控制 tick 连续无效时用 `lastValidPosition` 恢复本地实体坐标并短暂停顿，不再把该系统错误写入任务反馈；`manualRetreatFrom`、危险方块手动步进和快速撤离也会在直接移动导致坐标无效时立即回滚到最后安全坐标并返回失败，避免把坏状态留到下一轮 tick。新增回归测试覆盖 last-valid 恢复、无恢复点降级暂停、手动撤离坐标损坏回滚。
- 修复 starvation 任务队列被安全窗口卡住：重启 live 后，BOT 不再进入 invalid-position 循环，但低血、饱食 17、无背包食物时反复执行 `recover_starvation`，LLM 已生成 `explore -> hunt_food` 恢复计划，却因为 `recover_starvation` 走 `isPlannerSafeWindow` 的低血拦截而被 `safety_window_closed` 暂停。现将 `recover_starvation` 的任务队列窗口改为复用 starvation advisory 条件：没有危险方块、坑洞、岩浆和近身敌对时，允许队列里的 `explore`/`hunt_food` 作为食物恢复任务接管；仍拒绝 `collect_wood`、工具制作等无关任务。后续 live 又发现队列可执行 `explore` 后，若 LLM 新计划把 `collect_wood` 排在 `hunt_food` 前面，前置无关任务仍会堵住恢复链；现在 starvation 恢复会把队列前面的无关任务标记为 `skipped`，继续寻找后面的 `explore`/`hunt_food`，避免一个错误排序任务让 BOT 再次停住。新增回归测试覆盖 starvation 下允许 food recovery 队列、跳过前置无关任务、拒绝纯无关队列。
- 修复 recover_starvation 本地兜底原地等待：live 继续显示队列已能执行 `explore`/`hunt_food`，但当队列耗尽或寻路找食物失败后，硬安全任务自身仍会在“附近没有安全食物”时调用 `hold_position` 等下一轮 LLM。现把 `recover_starvation` 的无近处食物兜底改为直接执行 food-recovery `explore`，并在行为树中显示“迁移搜索食物”阶段；这样即使 LLM 队列暂时为空，BOT 也会主动迁移搜索，而不是站在原地等。
- 修复夜间普通探索规则拦截 starvation 恢复：latest live 在夜晚启动时，`recover_starvation` 已经调用主动探索兜底，但 `explore()` 的 `avoidNightExploration` 普通规则又把它改成 `hold_position`。现让 `recover_starvation` 触发的 food-recovery `explore` 带 `allowNight`，队列决策也保留 `ruleDecision=recover_starvation`，使执行层能识别这是应急找食物而不是普通夜游；近身敌对、危险方块和岩浆检查仍在进入恢复动作前生效。
- 修复恢复探索持续选远距离不可达点：live 验证显示 BOT 已经会持续更新任务和迁移，但 `collect_wood`/`hunt_food` 失败后的恢复探索频繁选择 40-100 格外目标，导致 `No path to the goal` 或 `arrived_too_far` 循环。现把 recovery explore 从远距离优先改为中近距离目标 `[12,16,20,24,32]`，并在 `explore` 自身也被反馈标记失败后收敛到 `[6,8,10,12,16]`，同时把恢复探索到达范围放宽到 3 格，减少不可达远点造成的空转。
- 修复夜间 `craft_basic_tools` 工作台失败重复执行：live 读取持久进度后在夜间选择本地制作工具，但 `ensurePlacedBlock("crafting_table")` 失败时只记录日志并进入普通 `explore()`，夜间又会变成 `hold_position`，且没有任务反馈，导致下一轮继续同一个失败动作。现将工作台放置/查找失败记录为 `craft_basic_tools` 的 `crafting_table_unavailable`，重复失败后反馈重规划为带 `allowNight` 的近距离探索，先找附近更安全平地再继续制作。
- 最新 live 收尾验证通过：重启最新 BOT 后，真实服务器日志显示 BOT 不再原地等待，先执行 `hunt_food`，成功击杀鸡/兔并把食物储备从 4 提升到 6，随后切换到 `collect_wood` 并继续砍树；Dashboard `/api/status` 采样显示 `busy=true`、`invalidTicks=0`、位置已移动到 `-170.5, 72, -36.5`，最近事件持续出现 `hunt_food`、`eat_food` 和 `collect_blocks`。本轮全量回归测试通过 `210/210`，live 终端为 `70dfd26d-04dd-40af-90d6-72ac552f4f77`。仍需后续单独观察 `unknown_damage` 和偶发 pathfinder timeout，但它们没有再导致任务停更或原地卡死。
- 修复地形陷阱思考过粗的问题：`createSnapshot()` 新增 `navigationAnalysis`，会分析同层出口、坑沿候选、侧面阻塞、脚下支撑方块、下方支撑柱深度和推荐动作；Dashboard `world.navigationAnalysis` 与 LLM planner context 同步暴露这些字段，行为树中的 `escape_pit` 也改为“脱离地形陷阱”，并拆成“扫描脚下与周围地形 -> 选择脱困路线 -> 安全边缘/逐格下挖/开凿阶梯 -> 验证”。
- 新增 `elevated_support_column` 处理：当 BOT 站在高空支撑柱上、周围没有同层安全出口、脚下和下一格均是可挖实体方块时，`escape_pit` 会选择 `controlled_descent`，逐格挖掉脚下支撑并等待自然下落，而不是继续抽象寻路或依赖 LLM 猜测。若是普通坑洞，仍保留坑沿寻路和上升阶梯兜底；坑沿寻路只有在位置不再被判定为陷阱时才算成功。
- LLM 安全建议窗口扩展到 `escape_pit`：地形陷阱出现时允许模型读取 `navigationAnalysis` 做只读规划记录，但不会把硬安全任务写入普通任务队列，避免 LLM 用 `collect_wood`、`collect_stone` 等任务覆盖脱困动作。prompt 已要求模型基于实际方块、出口、支撑柱、坑沿和推荐动作给出约束。
- 最新回归测试通过：定向测试覆盖地形分析、受控下降、坑沿误判不算成功、多方向阶梯兜底、Dashboard 行为树阶段、Dashboard `navigationAnalysis` 序列化、LLM context 地形摘要和 blocked 队列跳过；最终全量 `npm test` 通过 `220/220`，编辑器诊断无错误。
- 最新 live 验证通过：重启最新 BOT 后，真实服务器中 BOT 初始位于 `1,78,5` 高空支撑柱附近；Dashboard 显示 `navigationAnalysis.kind=elevated_support_column`、`support=cobblestone`、`supportDepth=15`、`recommended=controlled_descent`，行为树进入 `controlled_descent`。终端日志连续出现 `action=escape_pit; mode=controlled_descent; dig=1,76,5` 到 `dig=1,63,5`，BOT 从 `y=77` 逐格下降到 `y=63`，随后恢复 `collect_stone`、`explore`、`collect_wood`，并继续移动到 `-77,64,19`、`-76,63,34` 等地面坐标，不再长时间重复 `decision=escape_pit`。

## 后续

- 为甜浆果伤害、动物不可达、怪物打断狩猎、重复失败点学习分别补充直接场景测试。
- 把失败复盘导出到 Patchouli/Ponderer 风格知识条目，让 LLM 后续能读取已验证的失败模式。