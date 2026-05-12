# MC Survival Bot

一个基于 Mineflayer 的 Minecraft 生存 BOT。项目目标不是演示作弊指令，而是让 BOT 在普通生存规则下持续观察环境、选择任务、执行行为树，并通过 Dashboard 暴露决策链路。

当前能力覆盖早期生存循环：避险、吃食物、水中容错与低氧/冰下破冰逃生、高台水坑下降、怪物撤离/防御、采木、制作基础物资、采石、工具升级、觅食、夜间等待、临时庇护、地表 7x7x5 固定房屋、任务失败反馈，以及 LLM Smart Brain 的受控行为树规划。

## 亮点

- **无作弊生存控制**：默认不使用 `/give`、`/tp`、改时间、改难度等命令，动作都通过 Mineflayer 插件和本地控制器执行。
- **安全优先级固定在本地**：环境危险、低氧、死亡/重生、低血、饥饿、近身敌对生物和夜间压力由规则层优先接管，LLM 不能覆盖硬安全决策。
- **Smart Brain 输出可执行任务实例**：LLM 不输出思考过程，而是输出 `taskRequests` / `behaviorTrees`，例如 `CollectWoodTree({ count, targetPosition })`。
- **内置 MC 生存知识摘要**：Planner payload 会携带项目维护的 Minecraft wiki-style 摘要，提醒 Smart Brain 水不是伤害方块、有氧气时不要逃生、干地任务先上浮或找岸，冰下低氧要破冰开呼吸口，固定庇护所应是地表房屋而不是地下洞。
- **行为树执行队列**：每个任务会被拆成准备、感知、移动、执行、验证等节点，队列保存 pending/current/completed/feedback 状态。
- **阻塞自恢复**：过期 LLM advisory tree 会以 `stale_<task>_before_<rule>` 跳过；死亡、重生、无效坐标和 stale trace 会释放 current queued work。
- **Dashboard 可观测性**：网页面板展示 BOT 状态、当前任务、行为树、阶段追踪、LLM 状态、队列、记忆、诊断、Agent payload 图谱，以及本地 11x11 精确扫描和 200x200 粗略地形扫描。
- **研究任务目录**：吸收 Malmo 的 mission/observation/reward/quit 抽象，并结合 Minecraft_AI 的 action feedback 思路，提供项目内可查询、可通过测试管线注入的轻量评测任务。
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
- [src/knowledge/minecraftSurvivalGuide.js](src/knowledge/minecraftSurvivalGuide.js)：提供给 Smart Brain 的 MC 生存规则摘要，覆盖水、氧气、早期进度和基础任务常识。
- [src/knowledge/researchMissionCatalog.js](src/knowledge/researchMissionCatalog.js)：项目自己的轻量 mission catalog，用 observation/reward/quit 条件描述可重复评测任务。
- [src/llm](src/llm)：OpenAI 兼容客户端、Planner、上下文压缩、受控工具调用和审计记录。
- [python_brain](python_brain)：Python Smart Brain 服务，使用 FastAPI + asyncio 并发运行多个规划 agent。
- [src/dashboard](src/dashboard)：本地状态面板、REST API、诊断和前端图谱。
- [test](test)：所有单元和回归测试。

## Dashboard

启动后默认访问：

```text
http://127.0.0.1:3000
```

Dashboard 会显示：

- 连接状态、血量、饱食、氧气、坐标和世界时间。
- 环境扫描：本地 11x11 方块格、200x200 粗略地形摘要、平台下方水坑下降目标和探索记忆数量。
- 当前规则决策、技能计划、行为树队列和优先任务队列。
- 任务阶段追踪：准备、扫描、接近、攻击/采集、拾取、验证、失败原因。
- LLM 状态：模型、最近调用、候选任务、队列接受结果。
- 服务管理：查看 Dashboard、Minecraft BOT、Python Smart Brain 的状态，并启动/停止/重启本地 Python Brain 进程。
- 研究任务：`GET /api/research/missions` 查询评测任务目录；测试模式下可用 `POST /api/test/mission` 将 mission 的首个任务注入 test pipeline。
- Agent 思维导图：具体展示 `snapshot -> general_agent -> sub agents -> Smart Brain -> BehaviorExecutionQueue -> Controller -> feedback` 的 payload。
- 控制诊断：`task_trace_stale`、`blocked_tasks_present`、夜间敌对压力、低血/饥饿等信号。
- 本地模式日志：记录安全规则接管、自动避险、队列暂停/跳过/中断的原因和结果，便于按 Mindcraft behavior log 的思路回放控制权流向。

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

当前开发分支提供 Python Smart Brain 服务作为新的规划入口：Node.js Controller 负责安全规则、Mineflayer 动作和行为树执行；Python 服务负责并发运行 `safety_agent`、`combat_agent`、`survival_agent`、`engineering_agent`，再由 `general_agent` 合并为 `behaviorTrees`。Planner context 会携带 `minecraftWiki`、Mindcraft 风格的 `compactState`、以及转译后的 `taskParameterKnowledge`，让本地 JS Planner 和 Python Brain 都能看到水/氧气、前期进度、探索、采木、采石、夜间等待、命令参数映射和基础动作模式。这个拆分参考 Voyager 的可复用技能库/环境反馈闭环，以及 TouhouLittleMaid 的任务接口与 brain task 分层，但所有执行仍回到本项目的本地白名单行为树。

启动 Python Brain：

```bash
pip install -r python_brain/requirements.txt
python -m python_brain.main
```

也可以在 `.env` 中设置 `PYTHON_BRAIN_ENABLED=true`，并用 Dashboard 的“服务管理”面板启动或重启该服务。

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
| `MC_VERSION` | `1.21.1` | 推荐固定为 `1.21.1`；当前 mineflayer 4.37.x 对 1.21.6+ 的 update_health/oxygen/difficulty/abilities 协议解析未补全，会导致 BOT 血量永远显示 20。客户端 LAN 世界请用 1.21.1 客户端打开 |
| `DASHBOARD_PORT` | `3000` | Dashboard 端口 |
| `LOW_OXYGEN_THRESHOLD` | `8` | 水下低氧抢占阈值；水中氧气高于该值时不会仅因在水里触发逃生 |
| `NIGHT_SHELTER_RETURN_MAX_DISTANCE` | `96` | 夜间最多返回多远的已记住庇护所；更远时就地等待或造临时庇护 |
| `HOUSE_BLOCK_TARGET` | `160` | 固定庇护所材料目标；默认按地表 7x7x5 房屋、双开门和室内功能方块准备 |
| `EXACT_SCAN_RADIUS` | `5` | 本地精确扫描半径，默认覆盖约 11x11 区域 |
| `REGIONAL_SCAN_RADIUS` | `100` | 粗略区域扫描半径，默认覆盖约 200x200 区域 |
| `REGIONAL_SCAN_STEP` | `10` | 粗略区域扫描步长 |
| `LLM_ENABLED` | `false` | 开启 LLM Smart Brain |
| `LLM_BASE_URL` | — | OpenAI 兼容接口地址 |
| `LLM_API_KEY` | — | API 密钥（不要提交到 git） |
| `LLM_MODEL` | — | 模型名称 |
| `LLM_TIMEOUT_MS` | `60000` | 调用超时（慢模型建议 60s+） |
| `PYTHON_BRAIN_ENABLED` | `false` | 使用 Python Smart Brain 服务接管高层规划 |
| `PYTHON_BRAIN_SERVICE_ENABLED` | `true` | 允许 Dashboard 服务管理面板启动/停止 Python Smart Brain 进程 |
| `PYTHON_BRAIN_URL` | `http://127.0.0.1:3001` | Python Brain 服务地址 |
| `PYTHON_BRAIN_AUTO_START` | `false` | 启动 Node Dashboard 时自动启动 Python Brain |
| `BRAIN_PARALLEL_AGENTS` | `true` | Python Brain 内部并发运行子 agent |

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

本地开发记录会继续保存在工作区的 `README.dev.md` 与 `TODO/` 中；这些文件不会随公开仓库发布。
