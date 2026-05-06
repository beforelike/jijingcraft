# MC Survival Bot

一个基于 Mineflayer 的 Minecraft 生存 BOT。项目目标不是演示作弊指令，而是让 BOT 在普通生存规则下持续观察环境、选择任务、执行行为树，并通过 Dashboard 暴露决策链路。

当前能力覆盖早期生存循环：避险、吃食物、怪物撤离/防御、采木、制作基础物资、采石、工具升级、觅食、夜间等待、临时/固定庇护、任务失败反馈，以及 LLM Smart Brain 的受控行为树规划。

## 亮点

- **无作弊生存控制**：默认不使用 `/give`、`/tp`、改时间、改难度等命令，动作都通过 Mineflayer 插件和本地控制器执行。
- **安全优先级固定在本地**：环境危险、低血、饥饿、近身敌对生物和夜间压力由规则层优先接管，LLM 不能覆盖硬安全决策。
- **Smart Brain 输出可执行任务实例**：LLM 不输出思考过程，而是输出 `taskRequests` / `behaviorTrees`，例如 `CollectWoodTree({ count, targetPosition })`。
- **行为树执行队列**：每个任务会被拆成准备、感知、移动、执行、验证等节点，队列保存 pending/current/completed/feedback 状态。
- **阻塞自恢复**：过期 LLM advisory tree 会以 `stale_<task>_before_<rule>` 跳过；死亡、重生、无效坐标和 stale trace 会释放 current queued work。
- **Dashboard 可观测性**：网页面板展示 BOT 状态、当前任务、行为树、阶段追踪、LLM 状态、队列、记忆、诊断和 Agent payload 图谱。
- **回归测试完整**：使用 `node:test` 覆盖决策优先级、行为树、任务队列、Dashboard、LLM 工具循环和关键生存动作。

## 架构

```text
Minecraft Server
  -> mineflayer bot
  -> SurvivalController
     -> local safety rules
     -> AgentOrchestrator
     -> BehaviorExecutionQueue
     -> ExecutableBehaviorTreeRunner
     -> taskFeedback / memory / Dashboard status
  -> Dashboard (http://127.0.0.1:3000)
```

主要模块：

- [src/index.js](src/index.js)：启动 BOT、Dashboard、重连、死亡/重生处理。
- [src/botFactory.js](src/botFactory.js)：创建 Mineflayer BOT 并加载 pathfinder、pvp、collectBlock、tool 插件。
- [src/survival/SurvivalController.js](src/survival/SurvivalController.js)：核心控制循环、动作执行、任务追踪、队列仲裁和安全中断。
- [src/survival/decision.js](src/survival/decision.js)：本地生存规则与任务优先级。
- [src/behavior/executableBehaviorTree.js](src/behavior/executableBehaviorTree.js)：行为树模板、任务白名单、构造参数和执行器。
- [src/behavior/behaviorExecutionQueue.js](src/behavior/behaviorExecutionQueue.js)：可执行行为树队列。
- [src/agents/agentOrchestrator.js](src/agents/agentOrchestrator.js)：`general_agent` 与安全/战斗/生存/工程子 agent 的本地编排。
- [src/llm](src/llm)：OpenAI 兼容客户端、Planner、上下文压缩、受控工具调用和审计记录。
- [src/dashboard](src/dashboard)：本地状态面板、REST API、诊断和前端图谱。
- [test](test)：所有单元和回归测试。

## Dashboard

启动后默认访问：

```text
http://127.0.0.1:3000
```

Dashboard 会显示：

- 连接状态、血量、饱食、氧气、坐标和世界时间。
- 当前规则决策、技能计划、行为树队列和优先任务队列。
- 任务阶段追踪：准备、扫描、接近、攻击/采集、拾取、验证、失败原因。
- LLM 状态：模型、最近调用、候选任务、队列接受结果。
- Agent 思维导图：具体展示 `snapshot -> general_agent -> sub agents -> Smart Brain -> BehaviorExecutionQueue -> Controller -> feedback` 的 payload。
- 控制诊断：`task_trace_stale`、`blocked_tasks_present`、夜间敌对压力、低血/饥饿等信号。

图谱不是概念图，会直接显示排障字段，例如 `ruleDecision.type`、`taskFeedback.lastEvent`、LLM `taskRequests.constructorArgs`、队列 `currentTree` / `pendingTrees`、`taskTrace.status`。

## Smart Brain 与行为树

LLM 开启后，模型只负责产生受控任务请求，不能直接调用 Mineflayer API。输出会被规范化为本地白名单行为树：

```json
{
  "brainAgent": "general_agent",
  "stageAssessment": "daytime wood recovery",
  "taskRequests": [
    {
      "fromAgent": "general_agent",
      "assignedAgent": "survival_agent",
      "taskType": "collect_wood",
      "constructorArgs": {
        "count": 4,
        "targetPosition": { "x": 12, "y": 64, "z": -3 }
      }
    }
  ]
}
```

本地执行层会补齐 `treeClass`、`taskFunction`、`priority`、`level`、preconditions/postconditions，并使用固定的 `taskPriority(taskType)` 排序。模型提交的 priority 会被忽略。

## 快速开始

**要求**：Node.js 20+，可连接的 Minecraft Java 服务器（默认 `localhost:8000`）。

```bash
npm install
cp .env.example .env   # Windows: Copy-Item .env.example .env
# 编辑 .env，至少设置 MC_HOST / MC_PORT
npm start
```

Dashboard 地址：http://127.0.0.1:3000

## 配置

常用环境变量见 [.env.example](.env.example)。

| 变量 | 默认 | 说明 |
|---|---|---|
| `MC_HOST` | `localhost` | Minecraft 服务器地址 |
| `MC_PORT` | `8000` | 服务器端口 |
| `BOT_USERNAME` | `SurvivalBot` | BOT 用户名 |
| `MC_AUTH` | `offline` | 正版验证用 `microsoft` |
| `MC_VERSION` | 自动检测 | 无法自动检测时手动设置如 `1.21.11` |
| `DASHBOARD_PORT` | `3000` | Dashboard 端口 |
| `LLM_ENABLED` | `false` | 开启 LLM Smart Brain |
| `LLM_BASE_URL` | — | OpenAI 兼容接口地址 |
| `LLM_API_KEY` | — | API 密钥（不要提交到 git） |
| `LLM_MODEL` | — | 模型名称 |
| `LLM_TIMEOUT_MS` | `60000` | 调用超时（慢模型建议 60s+） |

## 测试

```bash
npm test
```

测试覆盖：配置解析、决策优先级、行为树构造/执行/验证、任务队列仲裁、Dashboard 状态、LLM 规范化、控制器场景（采木、采石、觅食、战斗、庇护、无效坐标恢复）。

## 已知限制

- 实验性 BOT，不保证在所有服务器、地形和插件环境下稳定生存。
- LLM 只做受控高层规划，不能绕过本地安全规则，也不能执行任意代码。
- 暂无农田耕作、完整基地自动化。
- 正版验证需设置 `MC_AUTH=microsoft`。

## 开发记录

详细设计、排查和修复记录保存在 [README.dev.md](README.dev.md) 和 [TODO](TODO) 目录，后续开发继续追加到这两个地方。
