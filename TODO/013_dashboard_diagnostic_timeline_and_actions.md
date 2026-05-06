# 013 Dashboard Diagnostic Timeline And Actions

## 目标
在已有 BOT 视角与控制诊断基础上，新增：
1. 诊断时间线（记录最近状态变化）
2. 可执行建议（按当前异常信号给出操作建议）

## 实现内容
- statusHub:
  - diagnostics 新增 recommendations 字段。
  - 新增 diagnosticsHistory，按诊断签名变化记录历史。
  - 历史条目包括：时间、overall、summary、信号计数、topSignals。
- dashboard 前端:
  - 控制诊断面板新增“建议动作”和“状态时间线”区域。
  - 渲染 recommendations 与 diagnosticsHistory。

## 规则说明
- recommendations 来源于 signal.code -> action 的映射。
- diagnosticsHistory 仅在诊断签名变化时写入，避免每秒重复刷入。
- 历史上限：24 条。

## 验证
- 扩展 test/dashboardStatus.test.js：
  - 校验 recommendations 输出。
  - 校验 diagnosticsHistory 随状态变化追加记录。

## 影响范围
- 仅增强观测与运维诊断展示。
- 不影响控制器执行逻辑与任务策略。
