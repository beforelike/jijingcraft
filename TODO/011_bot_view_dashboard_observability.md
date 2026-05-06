# 011 BOT视角与Dashboard观测增强

## 目标

- 在网页面板中增加 BOT 视角信息，用于与控制状态联合判断控制系统是否正常运行。

## 变更内容

- `src/survival/SurvivalController.js`
  - 新增 BOT 视角快照构建：朝向、俯仰、视线方向、前方方块采样、视野内注视实体。
  - 在 `createSnapshot()` 中附加 `botPerspective` 字段。
- `src/dashboard/statusHub.js`
  - 新增 `normalizeBotPerspective()`，将 `botPerspective` 序列化为前端可直接渲染的数据结构。
  - `createInitialState()` 与 `publishTick()` 增加 `botPerspective` 状态通路。
- `src/dashboard/public/index.html`
  - 新增 “BOT 视角” 面板。
- `src/dashboard/public/dashboard.js`
  - 新增 `renderBotPerspective()` 渲染：朝向/角度、当前注视实体、前方方块采样列表。
- `src/dashboard/public/dashboard.css`
  - 新增 BOT 视角面板布局与响应式样式。
- `test/dashboardStatus.test.js`
  - 新增对 `botPerspective` 序列化字段的断言。

## 影响评估

- 对外 API：`/api/status` 新增 `botPerspective` 字段，兼容旧前端读取（新增字段不破坏现有字段）。
- 风险：视角采样每 tick 额外读取少量方块与实体角度计算，成本低；若实体/方块数据缺失会安全降级为 `null`。

## 验证

- 回归测试覆盖：`dashboardStatus` 快照序列化、控制器与行为树回归测试。
- 运行后可在 Dashboard 观察：
  - 朝向与角度变化是否与 BOT 转头一致。
  - 注视实体是否与任务目标一致（如 hunt_food 时看向动物）。
  - 前方方块采样是否与 pathing 场景一致（墙体/空气/树干）。

## 后续建议

- 可进一步接入“简易第一视角截图流”（例如低频 Canvas/PNG 采样）以做更直观的人机核对。
- 可在面板加入“控制系统健康评分”规则（决策更新频率、路径成功率、风险恢复时间）。
