# 017 基础生存执行逻辑：夜间返家与食物缓冲

## 背景

用户反馈 BOT 的基础任务不是单点问题：持续死亡、采集不到食物，并且进度显示固定庇护所已接近或已经完成后，夜间仍然在当前位置把自己封起来，而不是回到固定庇护所。

## 检查结果

- Dashboard 现场状态显示当前任务为 `wait_out_night`，固定庇护所进度已完成，但日志反复出现“remembered starter shelter is not usable here, building emergency shelter”。
- `waitOutNight()` 只检查当前位置是否有可用 starter shelter；如果当前位置离记忆中的房屋较远，就直接建临时庇护，没有返家路径。
- `decision.js` 认为“远处记忆房屋不可当作当前安全点”是对的，但没有进一步把夜间任务导向“先回记忆房屋”。
- 现场背包已有甜浆果但饱食值未满；夜间等待前没有主动把随身食物吃到安全缓冲，容易让 BOT 带着食物进入长时间低饱食状态。

## 解决办法

- `waitOutNight()` 新增固定庇护所返家流程：
  - 若记忆中存在 starter shelter 且当前位置不可用，先调用 `returnToStarterShelterForNight()`。
  - 返家会寻路到记忆中的房屋 base，抵达后重新校验距离和防御完整度，并执行夜间修补。
  - 只有返家失败、附近威胁阻断或房屋无法验证时，才回退到临时应急庇护。
- `createSnapshot()` 暴露 `starterShelterDistance`，方便 Dashboard/LLM 区分“有房屋记忆”和“当前是否已经靠近”。
- `decision.js` 新增夜间记忆房屋调度：有房屋坐标、当前位置不可用、且没有贴脸敌人时，选择 `wait_out_night` 进入返家等待流程。
- `decision.js` 新增夜间食物缓冲：背包有可食物且夜间饱食低于 `NIGHT_FOOD_BUFFER` 时，先 `eat_food` 再等待或返家。
- `config.js` 新增 `NIGHT_FOOD_BUFFER`，默认 `18`，可按服务器难度调整。

## 影响范围

- 夜间不再把“远处固定房屋不可用”误处理为“只能就地封闭”，而是先尝试回固定房屋。
- 临时庇护仍作为兜底保留，避免返家路径被怪物或寻路失败阻断时无保护。
- 饱食逻辑更主动：BOT 不会在夜间带着甜浆果/肉类却低于安全缓冲继续挂机。
- 规则层仍保持硬安全优先级：贴脸怪物、环境危险、低血等紧急情况会先处理，不会强行返家。

## 测试

- `node --test test/controllerExecution.test.js test/decision.test.js`：126/126 通过。
- `node --test test/controllerExecution.test.js test/decision.test.js test/config.test.js`：141/141 通过。

## 后续观察

- 重启 BOT 后观察 Dashboard：夜间若存在 `starterShelterPosition`，应出现 `action=return_starter_shelter`，而不是直接 `build_simple_shelter`。
- 若仍频繁食物失败，需要继续从任务 trace 中定位是目标不可达、掉落物拾取失败、夜间风险过高，还是死亡后进度/库存状态不同步。
