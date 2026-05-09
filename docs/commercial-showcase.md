# MC Survival Bot 商业展示项目介绍

> 面向商务演示、产品路演、合作洽谈和项目主页的介绍文档。复杂图片建议使用文末提示词生成后替换到对应位置。本文档不使用 Minecraft 官方商标素材，不声称与 Mojang 或 Microsoft 存在官方关联。

## 01. 封面定位

**MC Survival Bot** 是一个基于 Mineflayer 的自主 Minecraft 生存智能体项目。它不是脚本刷物品，也不是作弊指令演示，而是让 BOT 在普通生存规则下持续观察世界、理解风险、选择任务、执行行为树，并通过 Dashboard 把每一次决策、失败和恢复过程展示出来。

**一句话介绍**

让 Minecraft 生存 BOT 从“执行脚本”进化为“可观察、可恢复、可扩展的 Smart Brain 智能体”。

**建议封面图位**

```text
Prompt: A premium commercial hero image for an autonomous AI agent surviving in a block-based sandbox world, no official Minecraft logos, a small robot explorer standing near a wooden shelter at sunrise, holographic dashboard panels showing health, hunger, behavior tree, and safety alerts, cinematic but clean, product showcase style, high detail, warm daylight, 16:9, suitable for a technology pitch deck.
```

## 02. 产品亮点

| 亮点 | 展示价值 | 商业表达 |
|---|---|---|
| 本地安全优先级 | LLM 不能覆盖低血、危险方块、低氧、敌对生物、夜间安全等硬规则 | 可控 AI，而不是不可预测自动化 |
| Smart Brain 任务实例 | LLM 输出 `taskRequests` / `behaviorTrees`，不输出自由文本动作 | 规划层和执行层清晰分离 |
| 行为树队列 | 任务以准备、感知、移动、执行、验证的节点运行 | 可审计、可回放、可测试 |
| Dashboard 可观测性 | 页面显示状态、行为树、队列、阶段追踪、诊断、modeLog | 演示友好，适合商业展示和现场排障 |
| 失败反馈与恢复 | 不可达目标、stale trace、无效坐标、死亡重生会触发恢复 | BOT 不只是尝试，还会学习避开坏策略 |
| 研究项目融合 | 吸收 Mindcraft、Malmo、Minecraft_AI 等思路，但控制权保持本地 | 兼具工程落地和研究扩展性 |

## 03. 当前能力范围

项目已覆盖早期生存循环的关键动作：

- 环境危险识别与逃离：岩浆、仙人掌、甜浆果伤害、水下低氧、冰下破冰呼吸。
- 地形脱困：坑洞逃离、高台水坑下降、平台出生优先下降。
- 生存基础：吃食物、觅食、采木、制作基础物资、采石、工具升级。
- 夜间策略：临时庇护、等待天亮、敌对生物撤离/防御。
- 建筑进度：地表固定庇护所、门洞、基础功能方块状态追踪。
- 规划扩展：JS Planner 与 Python Smart Brain 都可消费同一套 compact planner context。
- 可观测控制：Dashboard 显示任务树、队列、诊断、行为日志、本地模式日志。

## 04. 系统架构图

```mermaid
flowchart LR
  Server[Minecraft Server] --> Bot[Mineflayer Bot]
  Bot --> Controller[SurvivalController.js]

  Controller --> Safety[Local Safety Rules]
  Controller --> Queue[BehaviorExecutionQueue]
  Controller --> Memory[Survival Memory]
  Controller --> Dashboard[Dashboard]

  Safety -->|hard priority| Controller
  Queue --> Runner[ExecutableBehaviorTreeRunner]
  Runner --> Actions[Mineflayer Actions]
  Actions --> Bot

  Controller --> Context[Planner Context]
  Context --> JSPlanner[JS Smart Brain Planner]
  Context --> PythonBrain[Python Smart Brain]
  JSPlanner --> Queue
  PythonBrain --> Queue

  Dashboard --> Operator[Human Operator]
```

**架构说明**

核心控制权始终在 `SurvivalController.js`。Smart Brain 只提供高层任务实例，例如 `CollectWoodTree({ count: 4 })`，不能直接调用 Mineflayer API，也不能绕过本地安全规则。行为树队列负责保存 pending/current/completed 状态，Dashboard 负责把运行过程变成可读、可展示、可排障的产品界面。

## 05. Smart Brain 如何工作

```mermaid
sequenceDiagram
  participant W as World Snapshot
  participant C as SurvivalController
  participant P as Planner Context
  participant B as Smart Brain
  participant Q as Behavior Queue
  participant R as Tree Runner
  participant D as Dashboard

  W->>C: health / food / oxygen / terrain / entities
  C->>C: local safety decision
  C->>P: compactState + taskParameterKnowledge
  P->>B: controlled planning payload
  B->>Q: taskRequests / behaviorTrees
  Q->>C: runnable tree if safety window allows
  C->>R: execute tree nodes
  R->>C: outcome / failure reason
  C->>D: taskTrace / behaviorLog / modeLog
```

**关键区别**

传统自动化常见问题是“模型想做什么就让它做什么”。本项目的策略相反：模型只负责给出受控任务参数，真正的动作执行、优先级、安全中断、失败恢复全部在本地控制器完成。

## 06. Planner Context 展示

Smart Brain 接收到的上下文不是完整世界转储，而是压缩后的关键状态：

```json
{
  "compactState": {
    "gameplay": {
      "health": 20,
      "hunger": 16,
      "oxygen": 20,
      "timeLabel": "morning",
      "isNight": false
    },
    "action": {
      "current": "collect_wood",
      "isIdle": false,
      "activePhase": "search"
    },
    "surroundings": {
      "below": "grass_block",
      "legs": "air",
      "head": "air",
      "safeStandCount": 80
    },
    "modes": {
      "safetyRule": "collect_wood",
      "queueActive": true,
      "recentModeLog": []
    }
  },
  "taskParameterKnowledge": {
    "commandMappings": ["!collectBlocks -> collect_wood / collect_stone"],
    "primitivePatterns": ["goToGoal", "collectBlock", "placeBlock"]
  }
}
```

这套设计借鉴 Mindcraft 的 `full_state/query` 思想，但做了工程约束：上下文只告诉 Smart Brain “可以实例化什么任务、可以传什么参数”，不提供任意执行代码能力。

## 07. Dashboard 展示重点

```mermaid
flowchart TB
  subgraph Dashboard[Dashboard 状态面板]
    Metrics[生命 / 饱食 / 氧气 / 坐标]
    Terrain[11x11 精确扫描 / 200x200 粗略地图]
    Tree[行为树与阶段追踪]
    Queue[LLM / Behavior Queue 状态]
    Diagnostics[控制诊断]
    ModeLog[本地模式日志]
  end

  Metrics --> Diagnostics
  Terrain --> Tree
  Queue --> Tree
  Tree --> ModeLog
  Diagnostics --> ModeLog
```

Dashboard 不只是监控面板，也是商业演示的核心界面。它能把复杂的智能体行为拆成可被客户理解的链路：当前看到了什么、为什么选择这个任务、执行到了哪一步、失败后怎么恢复、哪个安全规则接管了控制权。

**Dashboard 截图建议**

已获取当前实机 Dashboard 截图，可直接用于展示：

![SurvivalBot Dashboard 实机截图](assets/dashboard-showcase.png)

如果需要重新截图，可在服务启动后打开：

```text
http://127.0.0.1:3000
```

推荐截取页面上半部分，包含：BOT 状态、环境扫描、控制诊断、当前任务、Agent 思维导图。若用生成式工具制作更精修的产品图，可使用下面的提示词。

```text
Prompt: A clean SaaS-style operations dashboard for an autonomous game AI survival bot, dark-neutral interface with compact data panels, health and hunger meters, behavior tree visualization, local mode log, terrain scan grid, queue status, agent mind map, no fantasy decoration, professional enterprise demo, 16:9 screenshot mockup, sharp typography, realistic UI density.
```

## 08. 本地安全优先级

```mermaid
flowchart TB
  A[硬安全任务] --> B[低氧 / 岩浆 / 危险方块]
  A --> C[低血 / 饥饿恢复]
  A --> D[近身敌对生物]
  A --> E[死亡重生 / 无效位置]

  F[规则绑定任务] --> G[夜间等待]
  F --> H[原地警戒]

  I[Smart Brain Advisory] --> J[采木 / 采石 / 建筑 / 探索]

  A -->|始终优先| Controller[SurvivalController]
  F --> Controller
  I -->|安全窗口打开才进入队列| Controller
```

商业价值在于“可控”。客户看到的不只是一个会动的 BOT，而是一个带有明确安全边界、审计日志和失败恢复机制的智能体运行时。

## 09. 行为树实例示例

```json
{
  "taskType": "collect_wood",
  "treeClass": "CollectWoodTree",
  "taskFunction": "collectWood",
  "constructorArgs": {
    "count": 4,
    "targetPosition": { "x": 12, "y": 64, "z": -3 },
    "searchRadius": 64,
    "tool": "auto"
  },
  "preconditions": ["not_in_hazard", "not_critically_hungry"],
  "postconditions": ["wood_inventory_increased"]
}
```

对应执行阶段：

```mermaid
flowchart LR
  Prepare[准备工具] --> Locate[定位低位可达树干]
  Locate --> Move[移动到安全站位]
  Move --> Collect[采集树干]
  Collect --> Pickup[拾取掉落物]
  Pickup --> Verify[验证原木入包]
```

## 10. 研究融合说明

| 参考方向 | 本项目吸收的部分 | 没有采用的部分 |
|---|---|---|
| Mindcraft CE | 命令/技能目录、compact state、ActionManager/behavior log 思路 | 不启用 `!newAction`，不让模型写代码执行 |
| Malmo | mission / observation / reward / quit 的评测抽象 | 不迁移 Malmo 运行时 |
| Minecraft_AI | action/query/cache/pattern 的反馈思想 | 不直接复制外部工程结构 |
| Voyager 类技能库 | 可复用技能和失败反馈循环 | 不让 LLM 直接生成 Mineflayer JS |

这使项目既有研究展示价值，又保持可工程化维护。

## 11. 商业演示脚本

**开场 30 秒**

这是一个 Minecraft 生存智能体运行时。它不靠作弊指令，而是在普通生存规则下观察环境、判断风险、执行任务，并把整个决策链路通过 Dashboard 展示出来。

**产品价值 60 秒**

很多 AI Agent 演示的问题是不可控、不可解释、不可复现。本项目把 LLM 限制在任务规划层，所有安全规则、任务优先级和动作执行都留在本地控制器。这样既能使用 Smart Brain 做高层规划，又能保证低血、低氧、敌对生物、夜间危险等场景不会被模型覆盖。

**技术亮点 90 秒**

系统把 BOT 状态压缩成 compact planner context，Smart Brain 输出行为树实例，BehaviorExecutionQueue 负责排队，ExecutableBehaviorTreeRunner 负责执行节点，Dashboard 则展示任务阶段、队列状态、诊断信号和本地 modeLog。每次失败都会记录原因，并影响下一次任务选择。

**收尾 30 秒**

这不是单一游戏脚本，而是一套可观察、可恢复、可扩展的智能体控制框架。Minecraft 是展示环境，核心能力可以迁移到更广泛的仿真、教育、游戏 AI 和多 Agent 控制场景。

## 12. 可生成图片清单

### A. 商业封面图

```text
Prompt: Premium pitch deck cover for an autonomous AI survival bot in a voxel sandbox world, robot explorer, sunrise, small wooden shelter, holographic behavior tree and safety dashboard, clean commercial technology style, cinematic lighting, no official Minecraft logos, 16:9, high resolution.
```

### B. 架构大图

```text
Prompt: Isometric technical architecture diagram for a Minecraft-like autonomous agent system, blocks labeled Mineflayer Bot, SurvivalController, Local Safety Rules, Smart Brain, Behavior Tree Queue, Dashboard, Memory, arrows showing data flow, enterprise software presentation style, clean white background, blue and green accents, 16:9.
```

### C. Dashboard 产品截图风格图

```text
Prompt: Professional dark UI dashboard for an autonomous survival game bot, compact operations layout, behavior tree panel, terrain scan grid, health and hunger meters, local mode log, agent mind map, queue diagnostics, enterprise monitoring aesthetic, crisp text placeholders, 16:9.
```

### D. 行为树执行插画

```text
Prompt: Visual explanation of behavior tree execution for an AI game agent, nodes named Prepare, Sense, Move, Act, Verify, connected with glowing lines, small voxel character collecting wood safely, clean infographic style, no brand logos, 4:3.
```

### E. 安全接管场景图

```text
Prompt: Split-screen product illustration showing an AI bot interrupted by safety rules, left side bot approaching hazard water/lava/hostile mob, right side dashboard mode log showing safety preemption and recovery, polished technical demo style, 16:9.
```

### F. 投资人/客户汇报配图

```text
Prompt: Futuristic but realistic AI agent operations center for a voxel survival simulation, multiple monitoring panels, behavior logs, planner context, safety priority pyramid, calm professional tone, no fantasy creatures, no official Minecraft branding, high-detail commercial render, 16:9.
```

## 13. 对外话术

**官网标题**

可观察、可恢复、可控的 Minecraft 生存智能体。

**官网副标题**

MC Survival Bot 将 Mineflayer 动作执行、本地安全规则、行为树队列和 Smart Brain 规划组合成一套可演示、可测试、可扩展的游戏 AI Agent 运行时。

**客户价值**

- 为游戏 AI、仿真智能体和多 Agent 控制提供可视化演示样板。
- 为 LLM Agent 项目提供安全边界、审计日志和任务队列的工程范式。
- 为教育、研究和技术营销提供直观的动态环境案例。

**技术可信点**

- Node.js + Mineflayer 生态，使用真实动作执行链路。
- 本地规则层固定安全优先级，LLM 仅输出受控任务实例。
- Dashboard 提供完整可观测性。
- 使用 `node:test` 覆盖关键行为和回归场景。

## 14. 演示准备清单

1. 启动 Minecraft Java 服务器，默认地址 `localhost:8000`。
2. 在项目根目录执行 `npm start`。
3. 打开 Dashboard：`http://127.0.0.1:3000`。
4. 演示 BOT 状态、行为树、任务阶段追踪、Agent 思维导图和本地模式日志。
5. 如需展示 Smart Brain，启动 Python Brain 并开启对应环境变量。
6. 截取 Dashboard 关键区域作为真实产品截图，替换本文档中的生成图位。

## 15. 版本状态

- 当前定位：早期生存 BOT 与 Smart Brain 控制框架。
- 技术栈：Node.js、Mineflayer、Python Smart Brain、Dashboard、Mermaid、node:test。
- 最近验证：全量测试 `362/362` 通过。
- 适用场景：产品路演、技术展示、AI Agent 架构说明、游戏智能体研究展示。
