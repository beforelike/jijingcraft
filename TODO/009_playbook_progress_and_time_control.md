# 009 Playbook Progress And Time Control

## 背景问题

- BOT 在运行中出现“任务在执行但进度不增长”的现象。
- `hunt_food` 等任务存在成功判定偏宽的问题，导致行为树可能误判为完成。
- Dashboard 缺少直接控制世界昼夜的入口，不利于场景复现与排障。

## 本轮改动

### 1. 行为推进与决策约束

- 在 `src/survival/SurvivalController.js` 收紧 `huntFood()` 成功语义，统一显式返回 `true/false`。
- 无净增/中断/找不到可用食物源时，记录失败反馈，避免“空跑任务”被当作成功。
- 在 `src/config.js` 新增攻略阶段配置：
  - `PLAYBOOK_ENABLED`
  - `DAY1_LOG_TARGET`
  - `DAY1_COBBLESTONE_TARGET`
  - `STOCKPILE_LOG_TARGET`
  - `STOCKPILE_COBBLESTONE_TARGET`
- 在 `src/survival/decision.js` 接入 Day1 与阶段囤货约束：
  - 支持 Day1 木头与圆石目标。
  - 庇护所可用后支持 logs/cobblestone stockpile 目标。
  - 保持测试兼容：决策层仅在 `playbookEnabled === true` 时启用攻略约束；默认测试配置不受影响。
  - 修复回归：仅在 playbook 开启时才提升早中期圆石阈值，避免默认决策被错误前置到 `collect_stone`。

### 2. Dashboard 昼夜切换

- 后端 `src/dashboard/server.js` 新增 `POST /api/control/time`：
  - 入参 `mode: day|night`。
  - 通过 bot chat 发送 `/time set day` 或 `/time set night`。
  - 覆盖错误场景：method 校验、bot 未就绪、无 chat 能力、非法 mode。
- 启动注入 `src/index.js`：
  - Dashboard control 新增 `getBot`，供时间控制 API 获取当前 bot。
- 前端新增控制入口：
  - `src/dashboard/public/index.html` 增加“切换白天/切换夜晚”按钮与状态文案。
  - `src/dashboard/public/dashboard.js` 增加按钮事件、API 调用与 busy 状态。
  - `src/dashboard/public/dashboard.css` 增加按钮与控制区样式，并适配移动端布局。

## 测试与验证

### 新增/更新测试

- `test/dashboardServer.test.js`
  - 新增 time control API 成功路径（day/night）。
  - 新增 time control API 校验路径（bot_not_ready / invalid_time_mode）。
- `test/config.test.js`
  - 新增 playbook 环境变量覆盖测试。
- `test/decision.test.js`
  - 新增 playbook 启用后 shelter 阶段 stockpile 决策测试。

### 执行结果

- 定向测试：
  - `node --test test/decision.test.js test/dashboardServer.test.js test/config.test.js`
  - 结果：全部通过。
- 全量测试：
  - `npm test`
  - 结果：`240 passed, 0 failed`。

## 影响评估

- 正向影响：
  - 任务完成判定更严格，减少“看起来在做事但没有进展”的假推进。
  - 决策层具备可配置攻略约束，可按阶段推进资源囤积。
  - Dashboard 增加昼夜控制，便于快速复现夜间/白天场景。
- 兼容性：
  - playbook 约束为显式开关，不影响未开启场景和既有默认测试预期。
- 风险点：
  - `/time` 指令依赖服务器权限；无权限时 API 仍会返回请求发送成功，但服务器可能拒绝执行，需要结合聊天回执或日志观察。
