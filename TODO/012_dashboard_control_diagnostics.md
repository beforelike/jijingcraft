# 012 Dashboard Control Diagnostics

## 背景
现有 BOT 视角与任务追踪已经可见，但操作者仍需手动综合多个区域判断“控制系统是否正常”。

## 本次改动
1. 在状态聚合层新增 diagnostics 计算。
2. 输出整体健康等级（healthy/warning/critical）、信号计数、快照与追踪延迟、异常信号列表。
3. 在前端新增“控制诊断”面板，展示健康徽标、摘要、信号详情。
4. 为 dashboard 状态测试新增 diagnostics 断言。

## 诊断规则（当前版本）
- critical:
  - 连接状态非 connected
  - 位置缺失
  - 存在环境危险但当前决策未进入危险处理类任务
- warning:
  - 视角数据缺失
  - controller 处于 emergencyBusy
  - 存在 blockedTasks
  - controller busy 且 taskTrace 长时间未更新（>15s）

## 验证
- 单测文件：test/dashboardStatus.test.js
- 新增校验：
  - 常规快照下 diagnostics 输出 warning 且包含 blocked_tasks_present
  - 初始未连接快照下 diagnostics 输出 critical

## 影响
- 仅新增观测字段与页面展示，不改变控制器任务执行逻辑。
