# 014 Smart Brain Task Requests

## 目标
把 LLM 从解释型 planner 调整为 smart brain：输出 agent 指令与可实例化任务请求，任务 agent 接收请求后加入行为树队列。网页需要展示任务等级，执行完成后把可复盘结果写回地图记忆。

## 实现内容
- LLM planner:
  - 新增 `agentDirectives`、`taskRequests`、`brainAgent`、`stageAssessment` 规范化。
  - 支持 `safe_explore`、`collect_logs` 等别名归一到允许任务。
  - 任务请求自动转换为 `behaviorTrees`，保留参数、来源 agent、请求 id。
  - 系统提示改为命令信封输出，避免输出思考过程。
- Behavior queue:
  - `enqueuePlan()` 支持 `taskRequests` 与 directive 内嵌任务请求。
  - 行为树实例保留 `level`、`parameters`、`requestedBy`、`taskRequestId`。
  - 优先级和等级继续由本地任务表强制决定。
- 控制器与记忆:
  - 成功探索/采集类任务后扫描附近资源块并写入 `knownBlocks`。
  - LLM 上下文中的 `knownBlocks` 从计数扩展为 count + 最近坐标摘要。
  - `collect_wood` 可读取任务参数中的数量和目标坐标。
- Dashboard:
  - LLM 面板展示 stage assessment、agent directive、任务请求等级、行为树等级和队列等级。
  - 状态规范化保留任务请求参数，便于复盘。

## 验证
- 新增/更新测试覆盖：
  - planner smart brain schema 归一化。
  - behavior queue 接收 taskRequests 并保留参数。
  - dashboard LLM 状态暴露等级和参数。
  - 控制器成功任务写入地图记忆。

## 影响范围
- 改变 LLM 输出协议，但保留旧 `tasks`/`behaviorTrees` 兼容。
- 不信任 LLM priority，仍使用本地任务优先级表。
- 地图记忆扫描是成功任务后的附加记录，异常会跳过，不改变任务完成状态。