# 026 Agent Mind Map Dashboard

## 用户需求

- “网页监控使用思维导图的方式把BOT的框架展示出来，总agent接收什么信息，给什么agent发送什么信息。哪个agent接受到身信息输出什么。”
- 参考示例：`C:\Users\woo_w\Desktop\示例.drawio`，结构是环境/记忆输入进入总 agent，再由阶段判断分发到子 agent 和后续任务。

## 检查结果

- Dashboard 是纯静态前端，入口位于 `src/dashboard/public/index.html`，渲染逻辑位于 `src/dashboard/public/dashboard.js`，样式位于 `src/dashboard/public/dashboard.css`。
- `/api/status` 已经提供 `decision`、`progress`、`memory`、`controller.agents`、`controller.behaviorQueue`、`taskFeedback`、`llm.lastPlan` 和 `taskTrace`，足够在前端直接拼出 agent 信息流。

## 解决办法

- 新增“Agent 思维导图”面板，用横向流程展示：环境/进度/记忆输入 -> `general_agent` -> Smart Brain JSON/阶段判断 -> `safety_agent`、`combat_agent`、`survival_agent`、`engineering_agent` -> 行为树队列/Controller/反馈回写。
- 面板动态展示当前规则、活跃 agent、LLM `agentDirectives`/`taskRequests`/`behaviorTrees`、子 agent 最近 proposal、行为树队列 current/pending/lastEvent 和 feedback 状态。
- 样式使用现有 Dashboard 深色面板体系，横向图谱可滚动，避免压缩后文字互相遮挡。

## 测试

- 新增 `dashboard static resources include the Agent mind map monitor`，检查首页、JS 和 CSS 中都包含思维导图入口和渲染资源。

## 影响

- 不改变 BOT 决策和执行逻辑，只增强 Dashboard 可观测性。
- 运行中的 Dashboard 静态资源按请求读取文件，刷新页面即可看到新面板。