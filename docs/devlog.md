# 开发记录

## 2026-05-10 — LangGraph 智能体重构 & 优先调度系统

**分支**: `feature/langgraph-action-system-refactor`  
**Commit**: `69fb0af`  
**作者**: LS Send Developer  
**规模**: 22 文件 · +4055 / -11 行 · 0 回归 (408 测试通过)

### 架构变更

本次重构将 Smart Brain 从基于 `asyncio.gather` 的简单并发模型升级为三层架构：

**Layer 1 — Python 动作系统**

新建 `python_brain/actions/` 包，25 个原始动作以 dataclass 建模（`walk`, `mine`, `craft`, `attack`, `place`, `eat`, `observe` 等），每个动作自带 `monitor()` 和 `diagnose()` 方法。`ActionCompiler` 将 Python 动作编译为类型化 JSON，供 Node.js 端执行。

**Layer 2 — LangGraph 层级规划器**

新建 `python_brain/langgraph_agents/` 包，以 LangGraph `StateGraph` 替代旧有的 `asyncio.gather` 并发模式。图结构为 `StagePlanner → Workers → GeneralAgent → JudgeAgent → PromptOptimizer`，引入 LLM-as-Judge 反馈环实现结构化输出。Prompt 加入反冗长规则和 minecraftWiki 约束。

**Layer 3 — 优先抢占调度器**

新建 `src/behavior/PriorityScheduler.js` (865 行)，替代原有的 `BehaviorExecutionQueue`：
- **优先级抢占**: S-tier 任务可中断非 S-tier 任务
- **ActionMonitor**: 200ms 轮询，按指标类型检测卡顿
- **ActionDiagnoser**: 生成结构化失败报告
- **任务生命周期**: `pending → running → preempted → retrying → done/failed`

**Layer 4 — ActionExecutor 适配层**

新建 `src/behavior/ActionExecutor.js` (615 行)，将编译后的动作 JSON 翻译为 Mineflayer API 调用，集成监控与诊断，失败报告经 `contextBuilder` 回传 Planner。

### 关键文件

| 文件 | 行数 | 说明 |
|---|---|---|
| `python_brain/actions/base.py` | 268 | 动作基类、监控、诊断框架 |
| `python_brain/actions/catalog.py` | 247 | 25 个原始动作注册表 |
| `python_brain/langgraph_agents/brain.py` | 429 | Smart Brain 主入口 |
| `python_brain/langgraph_agents/graph.py` | 274 | StateGraph 定义与节点 |
| `python_brain/langgraph_agents/prompts.py` | 205 | 结构化提示词 |
| `src/behavior/PriorityScheduler.js` | 865 | 优先抢占调度器 |
| `src/behavior/ActionExecutor.js` | 615 | 动作执行适配器 |
| `src/survival/SurvivalController.js` | +43/-11 | 集成新调度器 |

### 设计决策

- 控制权保留在 `SurvivalController.js` 本地，Smart Brain 仅输出受控任务参数
- 安全规则优先级不受调度器影响（硬安全始终绕过队列）
- Python 侧只做规划和结构化输出，不直接调用 Mineflayer API
