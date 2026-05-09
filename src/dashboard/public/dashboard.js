const elements = {
  connectionBadge: document.getElementById("connectionBadge"),
  healthValue: document.getElementById("healthValue"),
  healthMeter: document.getElementById("healthMeter"),
  foodValue: document.getElementById("foodValue"),
  foodMeter: document.getElementById("foodMeter"),
  positionValue: document.getElementById("positionValue"),
  dimensionValue: document.getElementById("dimensionValue"),
  timeValue: document.getElementById("timeValue"),
  nightValue: document.getElementById("nightValue"),
  setDayButton: document.getElementById("setDayButton"),
  setNightButton: document.getElementById("setNightButton"),
  timeControlStatus: document.getElementById("timeControlStatus"),
  serviceSummary: document.getElementById("serviceSummary"),
  dashboardServiceState: document.getElementById("dashboardServiceState"),
  dashboardServiceUrl: document.getElementById("dashboardServiceUrl"),
  botServiceState: document.getElementById("botServiceState"),
  botServiceDetail: document.getElementById("botServiceDetail"),
  pythonBrainServiceState: document.getElementById("pythonBrainServiceState"),
  pythonBrainServiceDetail: document.getElementById("pythonBrainServiceDetail"),
  serviceLog: document.getElementById("serviceLog"),
  pythonBrainButtons: [...document.querySelectorAll("[data-python-brain-action]")],
  botViewHeading: document.getElementById("botViewHeading"),
  botViewAngles: document.getElementById("botViewAngles"),
  botViewDirection: document.getElementById("botViewDirection"),
  botViewTarget: document.getElementById("botViewTarget"),
  botViewTargetDistance: document.getElementById("botViewTargetDistance"),
  botViewBlocks: document.getElementById("botViewBlocks"),
  terrainSummary: document.getElementById("terrainSummary"),
  localTerrainMap: document.getElementById("localTerrainMap"),
  regionalTerrainSummary: document.getElementById("regionalTerrainSummary"),
  descentTargetSummary: document.getElementById("descentTargetSummary"),
  diagOverall: document.getElementById("diagOverall"),
  diagSummary: document.getElementById("diagSummary"),
  diagSignalCount: document.getElementById("diagSignalCount"),
  diagSnapshotAge: document.getElementById("diagSnapshotAge"),
  diagTraceAge: document.getElementById("diagTraceAge"),
  diagSignals: document.getElementById("diagSignals"),
  diagRecommendations: document.getElementById("diagRecommendations"),
  diagTimeline: document.getElementById("diagTimeline"),
  updatedAt: document.getElementById("updatedAt"),
  decisionType: document.getElementById("decisionType"),
  decisionReason: document.getElementById("decisionReason"),
  skillId: document.getElementById("skillId"),
  nextTask: document.getElementById("nextTask"),
  priorityQueueState: document.getElementById("priorityQueueState"),
  controllerState: document.getElementById("controllerState"),
  playbookPanel: document.getElementById("playbookPanel"),
  playbookPhase: document.getElementById("playbookPhase"),
  playbookGoals: document.getElementById("playbookGoals"),
  agentMapStatus: document.getElementById("agentMapStatus"),
  agentMindMap: document.getElementById("agentMindMap"),
  progressSummary: document.getElementById("progressSummary"),
  milestones: document.getElementById("milestones"),
  activeBranch: document.getElementById("activeBranch"),
  behaviorTree: document.getElementById("behaviorTree"),
  traceStatus: document.getElementById("traceStatus"),
  traceTask: document.getElementById("traceTask"),
  tracePhase: document.getElementById("tracePhase"),
  traceTarget: document.getElementById("traceTarget"),
  traceRisk: document.getElementById("traceRisk"),
  phaseTimeline: document.getElementById("phaseTimeline"),
  taskObservations: document.getElementById("taskObservations"),
  taskHistory: document.getElementById("taskHistory"),
  modeLogCount: document.getElementById("modeLogCount"),
  modeLog: document.getElementById("modeLog"),
  skillTitle: document.getElementById("skillTitle"),
  skillTasks: document.getElementById("skillTasks"),
  llmStatus: document.getElementById("llmStatus"),
  llmModel: document.getElementById("llmModel"),
  llmHost: document.getElementById("llmHost"),
  llmLastCall: document.getElementById("llmLastCall"),
  llmLastError: document.getElementById("llmLastError"),
  llmGoal: document.getElementById("llmGoal"),
  llmReason: document.getElementById("llmReason"),
  llmTasks: document.getElementById("llmTasks"),
  llmQueueState: document.getElementById("llmQueueState"),
  llmQueueTasks: document.getElementById("llmQueueTasks"),
  entityCount: document.getElementById("entityCount"),
  entities: document.getElementById("entities"),
  inventoryCount: document.getElementById("inventoryCount"),
  inventory: document.getElementById("inventory"),
  eventCount: document.getElementById("eventCount"),
  events: document.getElementById("events")
};

const NORMAL_REFRESH_MS = 1000;
const DETAIL_REVIEW_REFRESH_MS = 5000;
const openTaskHistoryItems = new Set();
let lastServices = null;

const AGENT_FRAMEWORK = [
  {
    id: "safety_agent",
    title: "安全 agent",
    receives: ["危险方块/岩浆/水下氧气", "地形陷阱/高台/掉落风险", "低血量/饥饿/伤害事件"],
    outputs: ["EscapeHazardTree", "EscapePitTree", "DescendFromPlatformTree", "EatFoodTree", "RecoverStarvationTree"],
    tasks: ["escape_hazard", "escape_pit", "descend_from_platform", "eat_food", "recover_starvation"]
  },
  {
    id: "combat_agent",
    title: "战斗 agent",
    receives: ["近身敌对生物", "夜间庇护所压力", "武器/血量/距离窗口"],
    outputs: ["EvadeHostilesTree", "DefendShelterTree", "DefendSelfTree"],
    tasks: ["evade_hostiles", "defend_shelter", "defend_self"]
  },
  {
    id: "survival_agent",
    title: "生存 agent",
    receives: ["当前规则任务", "食物/木材/夜间需求", "附近实体和可达资源"],
    outputs: ["HuntFoodTree", "CollectWoodTree", "ExploreTree", "WaitOutNightTree"],
    tasks: ["hunt_food", "collect_wood", "explore", "wait_out_night", "hold_position"]
  },
  {
    id: "engineering_agent",
    title: "工程 agent",
    receives: ["阶段里程碑", "背包材料", "技能计划 nextTask"],
    outputs: ["Craft/Build/Mining 行为树实例", "材料收集与基地建设任务"],
    tasks: ["craft_basic_tools", "collect_stone", "build_shelter", "craft_bed", "mine_advanced_materials"]
  }
];

function taskHistoryKey(item = {}) {
  return [item.id, item.status, item.finishedAt ?? item.updatedAt ?? item.startedAt].filter(Boolean).join("#");
}

function hasOpenTaskHistoryItem() {
  return Boolean(elements.taskHistory?.querySelector("details.task-history-item[open]"));
}

function setText(element, value) {
  element.textContent = value ?? "--";
}

function percent(value, max = 20) {
  const number = Number(value) || 0;
  return `${Math.max(0, Math.min(100, (number / max) * 100))}%`;
}

function formatTime(timestamp) {
  if (!timestamp) return "等待数据";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function formatDetails(details) {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 5)
    .map(([key, value]) => `${key}: ${typeof value === "object" ? value.text ?? JSON.stringify(value) : value}`)
    .join(" · ");
}

function formatFullDetails(details) {
  if (!details || typeof details !== "object") return "";
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "object" ? value.text ?? JSON.stringify(value) : value}`)
    .join(" · ");
}

function taskLevelFromPriority(priority) {
  const value = Number(priority) || 0;
  if (value >= 900) return "S";
  if (value >= 700) return "A";
  if (value >= 550) return "B";
  if (value >= 400) return "C";
  return "D";
}

function taskLevelText(task = {}) {
  return `等级 ${task.level ?? taskLevelFromPriority(task.priority)}`;
}

function formatConstructorValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    if (value.text) return value.text;
    if (Number.isFinite(Number(value.x)) && Number.isFinite(Number(value.y)) && Number.isFinite(Number(value.z))) {
      return `${Number(value.x)},${Number(value.y)},${Number(value.z)}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

function taskInstanceText(task = {}) {
  const treeClass = task.treeClass ?? task.taskClass ?? null;
  if (!treeClass) return null;
  const args = task.constructorArgs ?? task.parameters ?? {};
  const renderedArgs = Object.entries(args)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 4)
    .map(([key, value]) => {
      const rendered = formatConstructorValue(value);
      return rendered ? `${key}=${rendered}` : null;
    })
    .filter(Boolean)
    .join(", ");
  return `${treeClass}(${renderedArgs})`;
}

function renderReplayPhaseList(container, phases = []) {
  container.replaceChildren();
  for (const phase of phases) {
    const row = document.createElement("li");
    row.className = `phase-item ${phase.status ?? "active"}`;
    const title = document.createElement("strong");
    title.textContent = `${phase.label ?? phase.id} (${phase.id ?? "unknown"})`;
    const meta = document.createElement("span");
    meta.textContent = `${phase.status ?? "active"} · ${formatTime(phase.at)}`;
    const detail = document.createElement("small");
    detail.textContent = formatFullDetails(phase.details);
    row.append(title, meta);
    if (detail.textContent) row.append(detail);
    container.append(row);
  }
  if (!container.children.length) {
    const row = document.createElement("li");
    row.className = "phase-item pending";
    row.textContent = "没有阶段事件";
    container.append(row);
  }
}

function renderReplayObservationList(container, observations = []) {
  container.replaceChildren();
  for (const observation of observations) {
    const row = document.createElement("div");
    row.className = `observation-row ${observation.level ?? "info"}`;
    const kind = document.createElement("strong");
    kind.textContent = `${observation.kind ?? "observation"} · ${formatTime(observation.at)}`;
    const message = document.createElement("span");
    message.textContent = observation.message ?? "";
    const details = document.createElement("small");
    details.textContent = formatFullDetails(observation.details);
    row.append(kind, message);
    if (details.textContent) row.append(details);
    container.append(row);
  }
  if (!container.children.length) clearAndEmpty(container, "没有观测日志");
}

function clearAndEmpty(container, text = "暂无数据") {
  container.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty";
  empty.textContent = text;
  container.append(empty);
}

function compactValue(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value.text ?? JSON.stringify(value);
  return String(value);
}

function appendTextList(container, lines = [], emptyText = "--", limit = 6) {
  const list = document.createElement("ul");
  list.className = "agent-map-list";
  const safeLines = lines.filter((line) => line !== null && line !== undefined && line !== "");
  for (const line of safeLines.slice(0, limit)) {
    const item = document.createElement("li");
    item.textContent = line;
    list.append(item);
  }
  if (!list.children.length) {
    const item = document.createElement("li");
    item.textContent = emptyText;
    list.append(item);
  }
  container.append(list);
}

function createAgentMapNode({ role, title, subtitle, sections = [], tags = [], active = false, muted = false }) {
  const node = document.createElement("article");
  node.className = `agent-map-node ${role ?? ""} ${active ? "active" : ""} ${muted ? "muted" : ""}`;

  const heading = document.createElement("div");
  heading.className = "agent-map-node-heading";
  const titleElement = document.createElement("strong");
  titleElement.textContent = title ?? "--";
  const subtitleElement = document.createElement("span");
  subtitleElement.textContent = subtitle ?? "--";
  heading.append(titleElement, subtitleElement);
  node.append(heading);

  if (tags.length) {
    const tagRow = document.createElement("div");
    tagRow.className = "agent-map-tags";
    for (const tag of tags.slice(0, 8)) {
      const pill = document.createElement("span");
      pill.textContent = tag;
      tagRow.append(pill);
    }
    node.append(tagRow);
  }

  for (const section of sections) {
    const block = document.createElement("div");
    block.className = "agent-map-section";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = section.label;
    block.append(label);
    appendTextList(block, section.lines, section.emptyText, section.limit ?? 6);
    node.append(block);
  }

  return node;
}

function findRuntimeAgent(status, agentId) {
  const agentStatus = status.controller?.agents ?? {};
  if (agentId === "general_agent") return agentStatus.generalAgent ?? null;
  return (agentStatus.agents ?? []).find((agent) => agent.id === agentId) ?? null;
}

function directivesForAgent(status, agentId) {
  const plan = status.llm?.lastPlan ?? {};
  const directives = (plan.agentDirectives ?? [])
    .filter((directive) => (directive.toAgent ?? directive.assignedAgent) === agentId)
    .map((directive) => `${directive.fromAgent ?? "general_agent"} -> ${directive.toAgent ?? agentId}: ${directive.action ?? "request_task"}${directive.reason ? ` · ${directive.reason}` : ""}`);
  const taskRequests = (plan.taskRequests ?? [])
    .filter((request) => (request.assignedAgent ?? request.toAgent ?? request.sourceAgent) === agentId)
    .map((request) => `${request.fromAgent ?? "general_agent"} 请求 ${request.taskType}${request.objective ? ` · ${request.objective}` : ""}`);
  const behaviorTrees = (plan.behaviorTrees ?? [])
    .filter((tree) => (tree.sourceAgent ?? tree.assignedAgent) === agentId)
    .map((tree) => `${tree.treeClass ?? "BehaviorTree"}(${tree.taskType ?? "task"})${tree.reason ? ` · ${tree.reason}` : ""}`);
  return [...directives, ...taskRequests, ...behaviorTrees];
}

function proposalsForAgent(status, agentId) {
  return (status.controller?.agents?.lastProposals ?? [])
    .filter((proposal) => proposal.sourceAgent === agentId)
    .map((proposal) => `${proposal.taskType} · ${taskLevelText(proposal)} · P${proposal.priority ?? "--"}`);
}

function shortJson(value, fallback = "--", maxLength = 150) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "object") return String(value);
  const text = value.text ?? JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function payloadLine(key, value, fallback = "--") {
  return `${key}: ${shortJson(value, fallback)}`;
}

function topEntityLines(status, limit = 4) {
  return (status.entities ?? []).slice(0, limit).map((entity) => (
    `${entity.name}@${compactValue(entity.distance)}m pos=${compactValue(entity.position?.text)}`
  ));
}

function blockedTaskLines(blockedTasks = []) {
  return blockedTasks.map((task) => (
    `${task.taskType}: reason=${compactValue(task.reason)} recovery=${(task.recoveryTasks ?? []).join(",") || "--"} until=${compactValue(task.expiresAt)}`
  ));
}

function taskRequestPayloadLine(request = {}) {
  return `${request.fromAgent ?? "general_agent"}->${request.assignedAgent ?? request.toAgent ?? request.sourceAgent ?? "agent"}: task=${request.taskType ?? request.action} tree=${request.treeClass ?? "--"} args=${shortJson(request.constructorArgs ?? request.parameters ?? {})} reason=${compactValue(request.reason ?? request.objective)}`;
}

function directivePayloadLine(directive = {}) {
  return `${directive.fromAgent ?? directive.agent ?? "general_agent"}->${directive.toAgent ?? directive.target ?? directive.assignedAgent ?? "agent"}: action=${directive.action ?? "request"} reason=${compactValue(directive.reason)}`;
}

function behaviorTreePayloadLine(tree = {}) {
  return `${tree.taskType ?? "task"}: class=${tree.treeClass ?? "--"} fn=${tree.taskFunction ?? "--"} args=${shortJson(tree.constructorArgs ?? tree.parameters ?? {})} pre=${(tree.preconditions ?? []).slice(0, 3).join("|") || "--"} post=${(tree.postconditions ?? []).slice(0, 3).join("|") || "--"} reason=${compactValue(tree.reason)}`;
}

function queueTreePayloadLine(tree = {}) {
  return `${tree.taskType ?? "task"}: status=${tree.status ?? "--"} source=${tree.source ?? "--"}/${tree.sourceAgent ?? "--"} args=${shortJson(tree.constructorArgs ?? tree.parameters ?? {})} reason=${compactValue(tree.reason ?? tree.lastReason)}`;
}

function recentFailureLines(failures = []) {
  return failures.slice(0, 4).map((failure) => (
    `${failure.taskType ?? failure.action}: action=${failure.action ?? "--"} reason=${compactValue(failure.reason)} pos=${compactValue(failure.position?.text)}`
  ));
}

function createAgentMapEdge({ title, subtitle, lines = [], details = [], tone = "default" }) {
  return createAgentMapNode({
    role: `edge ${tone}`,
    title,
    subtitle,
    tags: ["具体传递"],
    sections: [
      { label: "payload", lines, emptyText: "暂无 payload", limit: 9 },
      { label: "排障字段", lines: details, emptyText: "暂无排障字段", limit: 6 }
    ]
  });
}

function renderAgentMindMap(status) {
  if (!elements.agentMindMap) return;
  const controller = status.controller ?? {};
  const progress = status.progress ?? {};
  const decision = status.decision ?? {};
  const behaviorQueue = controller.behaviorQueue ?? {};
  const currentTree = behaviorQueue.currentTree ?? null;
  const blockedTasks = controller.taskFeedback?.blockedTasks ?? [];
  const recentFailures = controller.taskFeedback?.recentFailures ?? [];
  const activeAgents = [controller.agents?.generalAgent, ...(controller.agents?.agents ?? [])]
    .filter((agent) => agent?.active)
    .map((agent) => agent.id);
  const plan = status.llm?.lastPlan ?? null;
  const llmQueue = plan?.queue ?? null;

  setText(
    elements.agentMapStatus,
    `rule=${decision.type ?? "--"} / queue=${currentTree?.taskType ?? `${behaviorQueue.pendingTrees?.length ?? 0} pending`} / active=${activeAgents.length ? activeAgents.join(",") : "--"}`
  );
  elements.agentMindMap.replaceChildren();

  const flow = document.createElement("div");
  flow.className = "agent-map-flow";

  const inputs = document.createElement("div");
  inputs.className = "agent-map-column inputs";
  inputs.append(
    createAgentMapNode({
      role: "input",
      title: "环境输入",
      subtitle: "world snapshot",
      tags: [status.world?.isNight ? "夜间" : "白天", compactValue(status.world?.environmentHazard, "无危险方块")],
      sections: [{
        label: "snapshot payload",
        lines: [
          payloadLine("bot.health", status.bot?.health),
          payloadLine("bot.food", status.bot?.food),
          payloadLine("bot.oxygen", status.bot?.oxygen),
          payloadLine("bot.position", status.bot?.position?.text),
          payloadLine("world.timeOfDay", status.world?.timeOfDay),
          payloadLine("world.isNight", status.world?.isNight),
          payloadLine("navigation.summary", status.world?.navigationAnalysis?.summary, status.world?.navigationTrap ? "地形受限" : "open"),
          payloadLine("front.targetEntity", status.botPerspective?.targetEntity?.name, "none")
        ],
        limit: 8
      }]
    }),
    createAgentMapNode({
      role: "input",
      title: "进度/背包输入",
      subtitle: "progress + inventory",
      tags: [progress.stage ?? "unknown", progress.summary ?? "0/0"],
      sections: [{
        label: "progress payload",
        lines: [
          payloadLine("progress.stage", progress.stage),
          payloadLine("progress.summary", progress.summary),
          payloadLine("progress.next", progress.next?.label ?? progress.next?.id),
          payloadLine("progress.foodCount", progress.foodCount),
          payloadLine("progress.materialCount", progress.materialCount),
          payloadLine("inventory.totalKinds", status.inventory?.totalKinds),
          payloadLine("inventory.totalItems", status.inventory?.totalItems),
          payloadLine("skillPlan.nextTask", status.skillPlan?.plan?.nextTask ?? decision.type)
        ],
        limit: 8
      }]
    }),
    createAgentMapNode({
      role: "input",
      title: "记忆/反馈输入",
      subtitle: "memory + taskFeedback",
      tags: blockedTasks.length ? [`blocked ${blockedTasks.length}`] : ["反馈正常"],
      sections: [{
        label: "feedback payload",
        lines: [
          payloadLine("memory.knownBlocks", status.memory?.knownBlocks ?? {}),
          payloadLine("memory.avoidedPositions", status.memory?.avoidedPositions?.length ?? 0),
          payloadLine("taskFeedback.lastEvent", controller.taskFeedback?.lastEvent),
          ...blockedTaskLines(blockedTasks),
          ...recentFailureLines(recentFailures)
        ],
        limit: 8
      }]
    })
  );

  const inputToGeneral = createAgentMapEdge({
    title: "输入 -> general_agent",
    subtitle: "snapshot / progress / memory",
    lines: [
      payloadLine("ruleDecision.input", decision.type),
      payloadLine("diagnostics.overall", status.diagnostics?.overall),
      payloadLine("entities.top", topEntityLines(status, 3).join(" | "), "none"),
      payloadLine("blockedTasks", blockedTasks.map((task) => task.taskType).join(","), "none"),
      payloadLine("policyStats.top", status.memory?.policyStats?.[0])
    ],
    details: [
      payloadLine("snapshotAgeMs", status.diagnostics?.snapshotAgeMs),
      payloadLine("traceAgeMs", status.diagnostics?.traceAgeMs),
      payloadLine("controller.pausedUntil", controller.pausedUntil)
    ],
    tone: "input"
  });

  const generalSends = (controller.agents?.agents ?? []).map((agent) => {
    const verb = agent.active ? "激活" : "旁路";
    return `${verb} ${agent.id}: reason=${agent.reason ?? "--"}`;
  });
  const general = createAgentMapNode({
    role: "general",
    title: "总 agent / general_agent",
    subtitle: "接收全局 payload 并分发 agent 状态",
    active: true,
    tags: [decision.type ?? "waiting", progress.stage ?? "stage:unknown", status.llm?.enabled ? "LLM on" : "LLM off"],
    sections: [
      {
        label: "接收",
        lines: [
          payloadLine("ruleDecision.type", decision.type),
          payloadLine("ruleDecision.reason", decision.reason),
          payloadLine("stageAssessment", plan?.stageAssessment ?? progress.stage),
          payloadLine("taskFeedback.blocked", blockedTasks.map((task) => task.taskType).join(","), "none"),
          payloadLine("behaviorQueue.current", currentTree?.taskType, "none"),
          payloadLine("behaviorQueue.pending", behaviorQueue.pendingTrees?.map((tree) => tree.taskType).join(","), "none")
        ],
        limit: 6
      },
      {
        label: "发送",
        lines: generalSends,
        limit: 5
      }
    ]
  });

  const generalToAgents = createAgentMapEdge({
    title: "general_agent -> 子 agent",
    subtitle: "activation + ruleDecision",
    lines: [
      ...generalSends,
      ...(controller.agents?.lastProposals ?? []).slice(0, 4).map((proposal) => (
        `proposal ${proposal.sourceAgent}->queue: task=${proposal.taskType} treeId=${proposal.treeId ?? "--"} P${proposal.priority ?? "--"} reason=${compactValue(proposal.reason)}`
      ))
    ],
    details: [
      payloadLine("general.updatedAt", controller.agents?.updatedAt),
      payloadLine("general.feedback", controller.agents?.feedback?.[0])
    ],
    tone: "general"
  });

  const brain = createAgentMapNode({
    role: "brain",
    title: "阶段判断 / Smart Brain JSON",
    subtitle: "只输出可验证任务实例",
    active: Boolean(plan),
    tags: [`status ${status.llm?.status ?? "disabled"}`, `trees ${(plan?.behaviorTrees ?? []).length}`],
    sections: [
      {
        label: "接收",
        lines: [
          payloadLine("prompt.rule", plan?.ruleDecision ?? decision.type),
          payloadLine("prompt.stage", progress.stage),
          payloadLine("prompt.hp_food", `hp=${compactValue(status.bot?.health)} food=${compactValue(status.bot?.food)}`),
          payloadLine("prompt.queue.current", currentTree?.taskType, "none"),
          payloadLine("prompt.recentFailure", recentFailures[0])
        ],
        limit: 6
      },
      {
        label: "输出",
        lines: [
          payloadLine("brainAgent", plan?.brainAgent),
          payloadLine("confidence", plan?.confidence),
          payloadLine("constraints", (plan?.constraints ?? []).slice(0, 4).join(" | "), "none"),
          ...((plan?.agentDirectives ?? []).slice(0, 2).map(directivePayloadLine)),
          ...((plan?.taskRequests ?? []).slice(0, 2).map(taskRequestPayloadLine)),
          ...((plan?.behaviorTrees ?? []).slice(0, 2).map(behaviorTreePayloadLine))
        ],
        limit: 9
      }
    ]
  });

  const brainToQueue = createAgentMapEdge({
    title: "Smart Brain -> 队列",
    subtitle: "taskRequests / behaviorTrees",
    lines: [
      payloadLine("queue.accepted", llmQueue?.accepted ?? plan?.accepted, "waiting"),
      payloadLine("queue.reason", llmQueue?.reason, "--"),
      ...((plan?.taskRequests ?? []).slice(0, 3).map(taskRequestPayloadLine)),
      ...((plan?.behaviorTrees ?? []).slice(0, 3).map(behaviorTreePayloadLine))
    ],
    details: [
      payloadLine("planId", llmQueue?.planId ?? plan?.createdAt),
      payloadLine("skippedTasks", llmQueue?.skippedTasks ?? []),
      payloadLine("validation", plan?.validation)
    ],
    tone: "brain"
  });

  const agents = document.createElement("div");
  agents.className = "agent-map-column subagents";
  for (const definition of AGENT_FRAMEWORK) {
    const runtime = findRuntimeAgent(status, definition.id);
    const runtimeDirectives = directivesForAgent(status, definition.id);
    const proposals = proposalsForAgent(status, definition.id);
    agents.append(createAgentMapNode({
      role: "subagent",
      title: definition.title,
      subtitle: definition.id,
      active: Boolean(runtime?.active),
      muted: runtime && !runtime.active,
      tags: [runtime?.active ? "active" : "idle", runtime?.reason ?? "--"],
      sections: [
        {
          label: "接收",
          lines: [
            payloadLine("runtime.active", runtime?.active),
            payloadLine("runtime.reason", runtime?.reason),
            ...runtimeDirectives.slice(0, 3),
            ...definition.receives
          ],
          limit: 7
        },
        {
          label: "输出",
          lines: [
            ...proposals,
            ...definition.outputs,
            `allowedTasks=${definition.tasks.join(",")}`
          ],
          limit: 7
        }
      ]
    }));
  }

  const queueToController = createAgentMapEdge({
    title: "队列 -> Controller -> 反馈",
    subtitle: "current / pending / trace / learning",
    lines: [
      currentTree ? `current ${queueTreePayloadLine(currentTree)}` : "current: none",
      ...((behaviorQueue.pendingTrees ?? []).slice(0, 3).map((tree, index) => `pending[${index}] ${queueTreePayloadLine(tree)}`)),
      payloadLine("lastEvent", behaviorQueue.lastEvent),
      payloadLine("decision.executed", decision.type),
      payloadLine("trace.status", status.taskTrace?.status),
      payloadLine("trace.phase", status.taskTrace?.activePhaseLabel ?? status.taskTrace?.activePhaseId),
      ...recentFailureLines(recentFailures)
    ],
    details: [
      payloadLine("queue.feedback[0]", behaviorQueue.feedback?.[0]),
      payloadLine("diagnostics.signals", status.diagnostics?.signals?.map((signal) => signal.code).join(","), "none"),
      payloadLine("recentEvent", status.recentEvents?.[0]?.message)
    ],
    tone: "output"
  });

  const outputs = document.createElement("div");
  outputs.className = "agent-map-column outputs";
  outputs.append(
    createAgentMapNode({
      role: "output",
      title: "行为树队列",
      subtitle: "BehaviorExecutionQueue",
      active: Boolean(behaviorQueue.active),
      tags: [behaviorQueue.enabled === false ? "disabled" : "enabled", behaviorQueue.lastEvent?.type ?? "no event"],
      sections: [{
        label: "queue state",
        lines: [
          currentTree ? queueTreePayloadLine(currentTree) : "current: none",
          ...((behaviorQueue.pendingTrees ?? []).slice(0, 4).map(queueTreePayloadLine)),
          payloadLine("lastEvent", behaviorQueue.lastEvent)
        ],
        limit: 6
      }]
    }),
    createAgentMapNode({
      role: "output",
      title: "Controller 执行器",
      subtitle: "taskFunction -> Mineflayer",
      active: Boolean(controller.busy),
      tags: [controller.emergencyBusy ? "emergency" : (controller.busy ? "executing" : "idle")],
      sections: [{
        label: "execute payload",
        lines: [
          payloadLine("decision.type", decision.type),
          payloadLine("decision.reason", decision.reason),
          payloadLine("taskTrace.status", status.taskTrace?.status),
          payloadLine("taskTrace.phase", status.taskTrace?.activePhaseLabel ?? status.taskTrace?.activePhaseId),
          payloadLine("lastAction", controller.lastAction)
        ],
        limit: 6
      }]
    }),
    createAgentMapNode({
      role: "output",
      title: "反馈回写",
      subtitle: "memory + feedback + LLM context",
      active: Boolean((behaviorQueue.feedback ?? []).length || controller.taskFeedback?.lastEvent),
      tags: [controller.taskFeedback?.lastEvent?.type ?? "feedback"],
      sections: [{
        label: "feedback payload",
        lines: [
          payloadLine("behaviorQueue.feedback[0]", behaviorQueue.feedback?.[0]),
          payloadLine("taskFeedback.lastEvent", controller.taskFeedback?.lastEvent),
          ...recentFailureLines(recentFailures),
          payloadLine("diagnostics.overall", status.diagnostics?.overall),
          payloadLine("diagnostics.summary", status.diagnostics?.summary)
        ],
        limit: 8
      }]
    })
  );

  flow.append(inputs, inputToGeneral, general, generalToAgents, brain, brainToQueue, agents, queueToController, outputs);
  elements.agentMindMap.append(flow);
}

function renderConnection(status) {
  const connection = status.connection ?? {};
  setText(elements.connectionBadge, connection.state ?? "starting");
  elements.connectionBadge.className = `connection ${connection.state ?? "starting"}`;
}

function serviceClass(status) {
  const value = String(status ?? "unknown").toLowerCase();
  if (["running", "connected", "reachable", "process_running", "ok", "started", "already_reachable"].includes(value)) return "ok";
  if (["disabled", "unconfigured", "stopped", "disconnected", "kicked", "dead"].includes(value)) return "bad";
  return "warn";
}

function setServiceState(element, value) {
  if (!element) return;
  element.textContent = value ?? "--";
  element.className = `service-state ${serviceClass(value)}`;
}

function renderServices(services = lastServices) {
  if (!services || !elements.serviceSummary) return;
  lastServices = services;
  const dashboard = services.dashboard ?? {};
  const bot = services.minecraftBot ?? {};
  const brain = services.pythonBrain ?? {};
  const brainHealth = brain.health ?? {};
  const brainStatus = brainHealth.ok ? (brain.status === "process_running" ? "process_running" : "reachable") : brain.status;

  setServiceState(elements.dashboardServiceState, dashboard.status ?? "running");
  setText(elements.dashboardServiceUrl, dashboard.url ?? location.origin);
  setServiceState(elements.botServiceState, bot.status ?? "unknown");
  setText(elements.botServiceDetail, [bot.username, bot.host && bot.port ? `${bot.host}:${bot.port}` : null, bot.message].filter(Boolean).join(" · ") || "--");
  setServiceState(elements.pythonBrainServiceState, brainStatus ?? "unknown");
  setText(elements.pythonBrainServiceDetail, [brain.enabled ? brain.url : "service disabled", brain.plannerEnabled ? "planner on" : "planner off", brain.pid ? `pid ${brain.pid}` : null, brainHealth.error].filter(Boolean).join(" · ") || "--");

  const healthyCount = [dashboard.status === "running", ["connected", "connecting"].includes(bot.status), Boolean(brainHealth.ok)].filter(Boolean).length;
  setText(elements.serviceSummary, `${healthyCount}/3 在线 · Python Brain ${brainHealth.ok ? "可达" : "不可达"}`);
  elements.serviceLog?.replaceChildren();
  for (const log of brain.logs ?? []) {
    const row = document.createElement("div");
    row.className = `service-log-row ${log.level ?? "info"}`;
    const level = document.createElement("strong");
    level.textContent = log.level ?? "info";
    const message = document.createElement("span");
    message.textContent = `${formatTime(log.at)} · ${log.message ?? ""}`;
    row.append(level, message);
    elements.serviceLog?.append(row);
  }
  if (!elements.serviceLog?.children.length) {
    const row = document.createElement("div");
    row.className = "service-log-row muted";
    row.textContent = "暂无 Python Brain 进程日志";
    elements.serviceLog?.append(row);
  }
}

function renderMetrics(status) {
  const bot = status.bot ?? {};
  const world = status.world ?? {};
  setText(elements.healthValue, bot.health === null ? "--" : `${bot.health}/20`);
  elements.healthMeter.style.width = percent(bot.health);
  setText(elements.foodValue, bot.food === null ? "--" : `${bot.food}/20`);
  elements.foodMeter.style.width = percent(bot.food);
  setText(elements.positionValue, bot.position?.text ?? "--");
  setText(elements.dimensionValue, bot.dimension ?? "unknown");
  setText(elements.timeValue, world.timeOfDay ?? "--");
  setText(elements.nightValue, world.isNight ? "夜间" : "白天");
}

function renderDecision(status) {
  const decision = status.decision ?? {};
  const skillPlan = status.skillPlan ?? {};
  const controller = status.controller ?? {};
  setText(elements.updatedAt, formatTime(status.updatedAt));
  setText(elements.decisionType, decision.type ?? "等待决策");
  setText(elements.decisionReason, decision.reason ?? "--");
  setText(elements.skillId, `skill: ${skillPlan.primarySkillId ?? "--"}`);
  setText(elements.nextTask, `next: ${skillPlan.plan?.nextTask ?? decision.type ?? "--"}`);
  const testTasks = controller.testTasks ?? {};
  const priorityTasks = controller.priorityTasks ?? {};
  const behaviorQueue = controller.behaviorQueue ?? {};
  const blockedTasks = controller.taskFeedback?.blockedTasks ?? [];
  const testSummary = testTasks.currentTask
    ? `${testTasks.currentTask.type} · running`
    : `${testTasks.pendingTasks?.length ?? 0} pending`;
  const prioritySummary = priorityTasks.currentTask
    ? `${priorityTasks.currentTask.type} · running`
    : `${priorityTasks.pendingTasks?.length ?? 0} pending`;
  const behaviorSummary = behaviorQueue.currentTree
    ? `${behaviorQueue.currentTree.taskType} · ${taskLevelText(behaviorQueue.currentTree)} · P${behaviorQueue.currentTree.priority}`
    : `${behaviorQueue.pendingTrees?.length ?? 0} trees`;
  const feedbackSummary = blockedTasks.length
    ? ` / blocked: ${blockedTasks.map((task) => task.taskType).join(",")}`
    : "";
  setText(elements.priorityQueueState, `test: ${testSummary} / priority: ${prioritySummary} / behavior: ${behaviorSummary}${feedbackSummary}`);
  const state = controller.emergencyBusy ? "emergency" : controller.busy ? "executing" : "idle";
  setText(elements.controllerState, state);
}

function renderBotPerspective(status) {
  const view = status.botPerspective ?? null;
  if (!view) {
    setText(elements.botViewHeading, "--");
    setText(elements.botViewAngles, "--");
    setText(elements.botViewDirection, "--");
    setText(elements.botViewTarget, "--");
    setText(elements.botViewTargetDistance, "--");
    if (elements.botViewBlocks) clearAndEmpty(elements.botViewBlocks, "暂无前方方块数据");
    return;
  }

  setText(elements.botViewHeading, view.heading ?? "--");
  setText(elements.botViewAngles, `yaw ${view.yawDeg ?? "--"}° / pitch ${view.pitchDeg ?? "--"}°`);
  setText(
    elements.botViewDirection,
    view.direction
      ? `dir (${view.direction.x}, ${view.direction.y}, ${view.direction.z})`
      : "--"
  );

  if (view.targetEntity) {
    setText(elements.botViewTarget, view.targetEntity.name ?? "--");
    setText(elements.botViewTargetDistance, `${view.targetEntity.distance ?? "--"}m`);
  } else {
    setText(elements.botViewTarget, "无");
    setText(elements.botViewTargetDistance, "--");
  }

  elements.botViewBlocks.replaceChildren();
  for (const block of view.frontBlocks ?? []) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = `${block.distance}m · ${block.name}`;
    row.querySelector("span").textContent = block.position?.text ?? "--";
    elements.botViewBlocks.append(row);
  }
  if (!elements.botViewBlocks.children.length) clearAndEmpty(elements.botViewBlocks, "前方无可采样方块");
}

function terrainCellClass(cell = {}) {
  if (cell.hazard) return "terrain-cell hazard";
  if (cell.water) return "terrain-cell water";
  if (cell.safeStand) return "terrain-cell safe";
  if (cell.feet && cell.feet !== "air") return "terrain-cell blocked";
  return "terrain-cell neutral";
}

function terrainCellText(cell = {}) {
  if (cell.dx === 0 && cell.dz === 0) return "B";
  if (cell.water) return "W";
  if (cell.hazard) return "!";
  if (cell.safeStand) return ".";
  return "";
}

function renderTerrain(status) {
  const terrain = status.world?.terrain ?? null;
  if (!terrain) {
    setText(elements.terrainSummary, "暂无扫描");
    clearAndEmpty(elements.localTerrainMap, "暂无 10x10 数据");
    clearAndEmpty(elements.regionalTerrainSummary, "暂无 200x200 数据");
    clearAndEmpty(elements.descentTargetSummary, "暂无下降目标");
    return;
  }

  const local = terrain.exactLocal;
  const regional = terrain.regional;
  const descent = terrain.descent;
  setText(
    elements.terrainSummary,
    `local ${local?.width ?? 0}x${local?.width ?? 0} · regional ${regional?.diameter ?? 0}x${regional?.diameter ?? 0} · water ${regional?.waterCells ?? 0}`
  );

  elements.localTerrainMap.replaceChildren();
  if (local?.cells?.length) {
    elements.localTerrainMap.style.setProperty("--terrain-width", String(local.width || 11));
    const sortedCells = [...local.cells].sort((left, right) => left.dz - right.dz || left.dx - right.dx);
    for (const cell of sortedCells) {
      const item = document.createElement("span");
      item.className = terrainCellClass(cell);
      item.textContent = terrainCellText(cell);
      item.title = `${cell.position?.text ?? `${cell.dx},${cell.dz}`} · ground=${cell.ground ?? "--"} feet=${cell.feet ?? "--"}`;
      elements.localTerrainMap.append(item);
    }
  } else {
    clearAndEmpty(elements.localTerrainMap, "暂无 10x10 数据");
  }

  elements.regionalTerrainSummary.replaceChildren();
  const regionalRows = [
    [`采样`, `${regional?.sampleCount ?? 0} cells · step ${regional?.step ?? "--"}`],
    [`安全`, `${regional?.safeCells ?? 0} safe · ${regional?.waterCells ?? 0} water · ${regional?.hazardCells ?? 0} hazard`],
    [`主要方块`, (regional?.topBlocks ?? []).slice(0, 6).map((entry) => `${entry.name}:${entry.count}`).join(" / ") || "--"],
    [`探索记忆`, `${status.memory?.exploration?.coarseCellCount ?? 0} coarse cells · visited ${status.memory?.exploration?.visitedCount ?? 0}`]
  ];
  for (const [label, value] of regionalRows) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = label;
    row.querySelector("span").textContent = value;
    elements.regionalTerrainSummary.append(row);
  }

  elements.descentTargetSummary.replaceChildren();
  const target = descent?.bestTarget;
  const descentRows = target ? [
    [descent.needsDescent ? "需要下降" : "可选目标", descent.summary ?? "water landing visible"],
    ["水面", target.waterPosition?.text ?? "--"],
    ["入口", `${target.entryPosition?.text ?? "--"} · drop ${target.drop ?? "--"}`]
  ] : [["状态", "暂无水坑下降目标"]];
  for (const [label, value] of descentRows) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = label;
    row.querySelector("span").textContent = value;
    elements.descentTargetSummary.append(row);
  }
}

function formatAge(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "--";
  return `${Math.max(0, Math.round(milliseconds / 1000))}s`;
}

function renderDiagnostics(status) {
  const diagnostics = status.diagnostics ?? {};
  const history = status.diagnosticsHistory ?? [];
  const overall = diagnostics.overall ?? "unknown";
  const signalCounts = diagnostics.signalCounts ?? {};
  const totalSignals = Number(signalCounts.total) || 0;

  if (elements.diagOverall) {
    setText(elements.diagOverall, overall);
    elements.diagOverall.className = `diag-badge ${overall}`;
  }
  if (elements.diagSummary) setText(elements.diagSummary, diagnostics.summary ?? "--");
  if (elements.diagSignalCount) setText(elements.diagSignalCount, `signals: ${totalSignals}`);
  if (elements.diagSnapshotAge) setText(elements.diagSnapshotAge, formatAge(diagnostics.snapshotAgeMs));
  if (elements.diagTraceAge) setText(elements.diagTraceAge, `trace age: ${formatAge(diagnostics.traceAgeMs)}`);

  if (elements.diagSignals) {
    elements.diagSignals.replaceChildren();
    for (const signal of diagnostics.signals ?? []) {
      const row = document.createElement("div");
      row.className = `event-row ${signal.level ?? "info"}`;
      const level = document.createElement("strong");
      level.textContent = signal.level ?? "info";
      const message = document.createElement("span");
      message.textContent = `${signal.label ?? signal.code ?? "signal"}${signal.detail ? ` · ${signal.detail}` : ""}`;
      row.append(level, message);
      elements.diagSignals.append(row);
    }
    if (!elements.diagSignals.children.length) clearAndEmpty(elements.diagSignals, "暂无异常信号");
  }

  if (elements.diagRecommendations) {
    elements.diagRecommendations.replaceChildren();
    for (const recommendation of diagnostics.recommendations ?? []) {
      const row = document.createElement("div");
      row.className = `event-row ${recommendation.level ?? "info"}`;
      const level = document.createElement("strong");
      level.textContent = recommendation.level ?? "info";
      const message = document.createElement("span");
      message.textContent = recommendation.action ?? "--";
      row.append(level, message);
      elements.diagRecommendations.append(row);
    }
    if (!elements.diagRecommendations.children.length) clearAndEmpty(elements.diagRecommendations, "暂无建议");
  }

  if (elements.diagTimeline) {
    elements.diagTimeline.replaceChildren();
    for (const entry of history.slice(0, 10)) {
      const row = document.createElement("div");
      row.className = `event-row ${entry.overall ?? "info"}`;
      const level = document.createElement("strong");
      level.textContent = `${entry.overall ?? "unknown"} · ${formatTime(entry.at)}`;
      const message = document.createElement("span");
      const topSignal = entry.topSignals?.[0];
      message.textContent = topSignal
        ? `${entry.summary ?? "--"} · ${topSignal.label ?? topSignal.code}`
        : (entry.summary ?? "--");
      row.append(level, message);
      elements.diagTimeline.append(row);
    }
    if (!elements.diagTimeline.children.length) clearAndEmpty(elements.diagTimeline, "暂无状态变化");
  }
}

function renderPlaybook(status) {
  const progress = status.progress ?? {};
  if (!progress.playbookEnabled) {
    if (elements.playbookPanel) elements.playbookPanel.style.display = "none";
    return;
  }
  if (elements.playbookPanel) elements.playbookPanel.style.display = "";
  const logsCount = progress.logsCount ?? 0;
  const cobblestoneCount = progress.cobblestoneCount ?? 0;
  const hasShelter = progress.hasShelter ?? false;
  const day1LogTarget = progress.day1LogTarget ?? 20;
  const day1CobblestoneTarget = progress.day1CobblestoneTarget ?? 24;
  const stockpileLogTarget = progress.stockpileLogTarget ?? 96;
  const stockpileCobblestoneTarget = progress.stockpileCobblestoneTarget ?? 128;
  const day1LogDone = logsCount >= day1LogTarget;
  const day1StoneDone = cobblestoneCount >= day1CobblestoneTarget;
  const stockpileLogDone = logsCount >= stockpileLogTarget;
  const stockpileStoneDone = cobblestoneCount >= stockpileCobblestoneTarget;

  const phase = hasShelter
    ? (stockpileLogDone && stockpileStoneDone ? "全部完成" : "囤货阶段")
    : (day1LogDone && day1StoneDone ? "建造避难所" : "第一天目标");
  setText(elements.playbookPhase, phase);

  const goals = [
    { label: "第一天原木", current: logsCount, target: day1LogTarget, done: day1LogDone },
    { label: "第一天鹅卵石", current: cobblestoneCount, target: day1CobblestoneTarget, done: day1StoneDone },
    { label: "避难所", current: hasShelter ? 1 : 0, target: 1, done: hasShelter, boolean: true },
    { label: "囤货原木", current: logsCount, target: stockpileLogTarget, done: stockpileLogDone },
    { label: "囤货鹅卵石", current: cobblestoneCount, target: stockpileCobblestoneTarget, done: stockpileStoneDone }
  ];

  elements.playbookGoals.replaceChildren();
  for (const goal of goals) {
    const row = document.createElement("div");
    row.className = `playbook-goal ${goal.done ? "done" : ""}`;
    const header = document.createElement("div");
    header.className = "playbook-goal-header";
    const labelEl = document.createElement("span");
    labelEl.textContent = goal.label;
    const valueEl = document.createElement("span");
    valueEl.className = "playbook-goal-value";
    valueEl.textContent = goal.boolean ? (goal.done ? "完成" : "未完成") : `${goal.current}/${goal.target}`;
    header.append(labelEl, valueEl);
    row.append(header);
    if (!goal.boolean) {
      const track = document.createElement("div");
      track.className = "playbook-bar";
      const fill = document.createElement("div");
      fill.className = "playbook-bar-fill";
      const pct = Math.max(0, Math.min(100, (goal.current / goal.target) * 100));
      fill.style.width = `${pct}%`;
      track.append(fill);
      row.append(track);
    }
    elements.playbookGoals.append(row);
  }
}

function renderProgress(status) {
  const progress = status.progress ?? {};
  setText(elements.progressSummary, progress.summary ?? "0/0");
  elements.milestones.replaceChildren();
  for (const milestone of progress.milestones ?? []) {
    const item = document.createElement("div");
    item.className = `milestone ${milestone.achieved ? "done" : ""}`;
    item.textContent = milestone.label ?? milestone.id;
    elements.milestones.append(item);
  }
  if (!elements.milestones.children.length) clearAndEmpty(elements.milestones);
}

const TASK_FUNCTION_FALLBACKS = {
  collect_wood: "collectWood",
  hunt_food: "huntFood",
  collect_stone: "collectStone",
  collect_building_materials: "collectBuildingMaterials",
  build_shelter: "buildStarterShelter",
  explore: "explore",
  wait_out_night: "waitOutNight",
  hold_position: "holdPositionSafely",
  evade_hostiles: "evadeHostiles",
  defend_self: "defendSelf",
  defend_shelter: "defendShelter",
  escape_hazard: "escapeHazard",
  escape_pit: "escapePit",
  descend_from_platform: "descendFromPlatform",
  eat_food: "eatFood",
  recover_starvation: "recoverFromStarvation"
};

function behaviorTaskLabel(taskType, status = {}) {
  const flattened = (status.behaviorTree ?? []).flatMap((group) => group.nodes ?? []);
  return flattened.find((node) => node.id === taskType)?.label ?? taskType ?? "任务";
}

function functionNameForTask(taskType, tree = {}) {
  return tree.taskFunction ?? TASK_FUNCTION_FALLBACKS[taskType] ?? String(taskType ?? "runTask").replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function formatFunctionArgValue(value) {
  if (value === null || value === undefined) return "auto";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "object" && ["x", "y", "z"].every((key) => Number.isFinite(Number(value[key])))) {
    return `{x:${Math.round(Number(value.x))}, y:${Math.round(Number(value.y))}, z:${Math.round(Number(value.z))}}`;
  }
  return shortJson(value, 80);
}

function functionArgsFromTree(tree = {}, status = {}) {
  const args = { ...(tree.constructorArgs ?? tree.parameters ?? {}) };
  if (!Object.keys(args).length && status.decision?.target) args.target = status.decision.target;
  return args;
}

function formatFunctionSignature(taskType, tree = {}, status = {}) {
  const args = functionArgsFromTree(tree, status);
  const argEntries = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatFunctionArgValue(value)}`);
  return `${functionNameForTask(taskType, tree)}(${argEntries.join(", ")})`;
}

function dispatchTitle(taskType, tree = {}, status = {}) {
  const args = functionArgsFromTree(tree, status);
  const count = args.count ?? args.quantity ?? args.targetCount;
  const suffix = Number.isFinite(Number(count)) ? `（${Number(count)}）` : "";
  return `分派任务：${behaviorTaskLabel(taskType, status)}${suffix}`;
}

function nodeCallName(node = {}) {
  if (node.handler === "execute_task") return "runPrimitiveTask";
  if (!node.handler) return node.id ?? "step";
  return String(node.handler).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function conditionTextForNode(node = {}) {
  if (node.id === "explore_if_no_wood") return "if (tree == none)";
  return `if (${node.id})`;
}

function loopConditionText(node = {}) {
  if (node.until === "wood_inventory_increased") return `while (!inventory.hasLogs && attempts < ${node.maxIterations ?? 4})`;
  if (node.until) return `while (!${node.until} && attempts < ${node.maxIterations ?? 1})`;
  return `while (attempts < ${node.maxIterations ?? 1})`;
}

function programLinesForNode(node = {}, depth = 1) {
  const indent = "  ".repeat(depth);
  if (node.kind === "loop") {
    const lines = [`${indent}${loopConditionText(node)} {`];
    for (const child of node.nodes ?? []) lines.push(...programLinesForNode(child, depth + 1));
    lines.push(`${indent}}`);
    return lines;
  }
  if (node.kind === "condition") {
    return [
      `${indent}${conditionTextForNode(node)} {`,
      `${indent}  ${nodeCallName(node)}()`,
      `${indent}}`
    ];
  }
  if (node.id === "locate_low_log") return [`${indent}tree = locateWoodSource(perception.regional.treeCells, memory.knownLogs)`];
  if (node.id === "collect_wood_batch") return [`${indent}collectWoodBatch(tree, count)`];
  if (node.id === "verify_wood_gain") return [`${indent}inventory.hasLogs = verifyWoodGain()`];
  return [`${indent}${nodeCallName(node)}()`];
}

function fallbackProgramLines(taskType, signature) {
  if (taskType === "collect_wood") {
    return [
      `${signature} {`,
      "  tree = locateWoodSource(perception.regional.treeCells, memory.knownLogs)",
      "  while (tree == none) {",
      "    explore(direction=randomCardinal(), distance=20)",
      "    tree = locateWoodSource(perception, memory)",
      "  }",
      "  collectWoodBatch(tree, count)",
      "  verifyWoodGain()",
      "}"
    ];
  }
  return [
    `${signature} {`,
    "  prepare()",
    "  if (!preconditionsOk) recoverOrExplore()",
    "  runPrimitiveTask()",
    "  verifyResult()",
    "}"
  ];
}

function programLinesForTree(taskType, tree = {}, status = {}) {
  const signature = formatFunctionSignature(taskType, tree, status);
  if (!Array.isArray(tree.nodes) || !tree.nodes.length) return fallbackProgramLines(taskType, signature);
  const lines = [`${signature} {`];
  for (const node of tree.nodes) lines.push(...programLinesForNode(node, 1));
  lines.push("}");
  return lines;
}

function activeBehaviorProgramSource(status = {}) {
  const behaviorQueue = status.controller?.behaviorQueue ?? {};
  const currentTree = behaviorQueue.currentTree ?? null;
  const pendingTree = behaviorQueue.pendingTrees?.[0] ?? null;
  const taskType = currentTree?.taskType ?? status.taskTrace?.taskType ?? status.decision?.type ?? pendingTree?.taskType ?? null;
  return {
    taskType,
    tree: currentTree ?? pendingTree ?? {},
    currentTree,
    pendingTree,
    behaviorQueue
  };
}

function appendProgramLine(parent, line, index, activeNeedle = null) {
  const row = document.createElement("div");
  row.className = "program-line";
  const lineNo = document.createElement("span");
  lineNo.className = "program-line-no";
  lineNo.textContent = String(index + 1).padStart(2, "0");
  const code = document.createElement("code");
  code.textContent = line;
  if (activeNeedle && line.includes(activeNeedle)) row.classList.add("active");
  row.append(lineNo, code);
  parent.append(row);
}

function renderBehaviorTree(status) {
  const tree = status.behaviorTree ?? [];
  const activeGroup = tree.find((group) => group.active);
  const programSource = activeBehaviorProgramSource(status);
  const activeTaskType = programSource.taskType;
  const activeLabel = activeTaskType ? behaviorTaskLabel(activeTaskType, status) : null;
  setText(elements.activeBranch, activeLabel ?? (activeGroup ? activeGroup.label : "--"));
  elements.behaviorTree.replaceChildren();

  if (!activeTaskType) {
    const empty = document.createElement("div");
    empty.className = "behavior-program empty";
    empty.textContent = "等待任务分派";
    elements.behaviorTree.append(empty);
    return;
  }

  const card = document.createElement("div");
  card.className = "behavior-program";
  const header = document.createElement("div");
  header.className = "program-header";
  const title = document.createElement("strong");
  title.textContent = dispatchTitle(activeTaskType, programSource.tree, status);
  const meta = document.createElement("span");
  meta.textContent = `${programSource.tree.treeClass ?? "LocalRule"} · ${taskLevelText(programSource.tree)} · P${programSource.tree.priority ?? "--"}`;
  header.append(title, meta);

  const signature = document.createElement("div");
  signature.className = "program-signature";
  signature.textContent = formatFunctionSignature(activeTaskType, programSource.tree, status);

  const code = document.createElement("div");
  code.className = "program-code";
  const activePhase = status.taskTrace?.activePhaseId ?? null;
  const activeNeedle = activePhase === "search" ? "locate"
    : activePhase === "act" ? "collect"
      : activePhase === "verify" ? "verify"
        : null;
  programLinesForTree(activeTaskType, programSource.tree, status)
    .forEach((line, index) => appendProgramLine(code, line, index, activeNeedle));

  const details = document.createElement("div");
  details.className = "program-details";
  const queueLabel = programSource.currentTree ? "current" : (programSource.pendingTree ? "pending" : "local");
  const detailItems = [
    `queue=${queueLabel}`,
    `source=${programSource.tree.source ?? status.decision?.reason ?? "local_rule"}`,
    `args=${shortJson(functionArgsFromTree(programSource.tree, status), 120)}`
  ];
  for (const item of detailItems) {
    const pill = document.createElement("span");
    pill.textContent = item;
    details.append(pill);
  }

  const phases = (tree.flatMap((group) => group.nodes ?? []).find((node) => node.id === activeTaskType)?.phases ?? [])
    .filter((phase) => phase.status !== "pending" || phase.active);
  if (phases.length) {
    const phaseStack = document.createElement("div");
    phaseStack.className = "tree-phases program-phases";
    for (const phase of phases) {
      const phaseElement = document.createElement("span");
      phaseElement.className = `tree-phase ${phase.status ?? "pending"} ${phase.active ? "active" : ""}`;
      phaseElement.textContent = phase.label;
      phaseStack.append(phaseElement);
    }
    card.append(header, signature, code, details, phaseStack);
  } else {
    card.append(header, signature, code, details);
  }

  elements.behaviorTree.append(card);
}

function renderTaskTrace(status) {
  const trace = status.taskTrace ?? {};
  const history = status.taskTraceHistory ?? [];
  const latestRisk = trace.risks?.[0] ?? null;
  setText(elements.traceStatus, trace.status ?? "idle");
  setText(elements.traceTask, trace.taskType ?? status.decision?.type ?? "--");
  setText(elements.tracePhase, trace.activePhaseLabel ?? trace.activePhaseId ?? "--");
  setText(elements.traceTarget, trace.target ?? trace.reason ?? "--");
  setText(elements.traceRisk, latestRisk ? `${latestRisk.kind}: ${latestRisk.message}` : "--");

  elements.phaseTimeline.replaceChildren();
  for (const phase of trace.phaseEvents ?? []) {
    const item = document.createElement("li");
    item.className = `phase-item ${phase.status ?? "active"}`;
    const title = document.createElement("strong");
    title.textContent = phase.label ?? phase.id;
    const meta = document.createElement("span");
    meta.textContent = `${phase.status ?? "active"} · ${formatTime(phase.at)}`;
    const detail = document.createElement("small");
    detail.textContent = formatDetails(phase.details);
    item.append(title, meta);
    if (detail.textContent) item.append(detail);
    elements.phaseTimeline.append(item);
  }
  if (!elements.phaseTimeline.children.length) {
    const item = document.createElement("li");
    item.className = "phase-item pending";
    item.textContent = "等待任务阶段";
    elements.phaseTimeline.append(item);
  }

  elements.taskObservations.replaceChildren();
  for (const observation of trace.observations ?? []) {
    const row = document.createElement("div");
    row.className = `observation-row ${observation.level ?? "info"}`;
    const kind = document.createElement("strong");
    kind.textContent = observation.kind ?? "observation";
    const message = document.createElement("span");
    message.textContent = observation.message ?? "";
    const details = document.createElement("small");
    details.textContent = formatDetails(observation.details);
    row.append(kind, message);
    if (details.textContent) row.append(details);
    elements.taskObservations.append(row);
  }
  if (!elements.taskObservations.children.length) clearAndEmpty(elements.taskObservations, "暂无阶段观测");

  if (elements.taskHistory) {
    elements.taskHistory.replaceChildren();
    for (const item of history.slice(0, 12)) {
      const row = document.createElement("details");
      const historyKey = taskHistoryKey(item);
      row.className = `task-history-item ${item.status ?? "unknown"}`;
      row.dataset.historyKey = historyKey;
      row.open = openTaskHistoryItems.has(historyKey);
      row.addEventListener("toggle", () => {
        if (!historyKey) return;
        if (row.open) openTaskHistoryItems.add(historyKey);
        else openTaskHistoryItems.delete(historyKey);
      });
      const summaryRow = document.createElement("summary");
      const title = document.createElement("strong");
      const duration = Number.isFinite(item.durationMs) ? `${Math.round(item.durationMs / 1000)}s` : "--";
      title.textContent = `${item.taskType} · ${item.status} · ${duration}`;
      const summary = document.createElement("span");
      const risk = item.risks?.[0]?.message ?? "";
      const reason = item.reason ?? "";
      summary.textContent = [formatTime(item.startedAt), formatTime(item.finishedAt), reason || risk].filter(Boolean).join(" · ");
      summaryRow.append(title, summary);

      const meta = document.createElement("div");
      meta.className = "task-history-meta";
      const phaseCount = item.phaseEventCount ?? item.phaseEvents?.length ?? 0;
      const observationCount = item.observationCount ?? item.observations?.length ?? 0;
      meta.textContent = `skill=${item.skillId ?? "--"} · phaseEvents=${phaseCount} · observations=${observationCount} · active=${item.activePhaseLabel ?? item.activePhaseId ?? "--"}`;

      const detailsGrid = document.createElement("div");
      detailsGrid.className = "task-replay-grid";
      const phasesWrap = document.createElement("div");
      const observationsWrap = document.createElement("div");
      const phaseTitle = document.createElement("span");
      phaseTitle.className = "label";
      phaseTitle.textContent = "phaseEvents 全量";
      const observationTitle = document.createElement("span");
      observationTitle.className = "label";
      observationTitle.textContent = "observations 全量";
      const phaseList = document.createElement("ol");
      phaseList.className = "phase-timeline replay-list";
      const observationList = document.createElement("div");
      observationList.className = "observation-log replay-list";
      renderReplayPhaseList(phaseList, item.phaseEvents ?? []);
      renderReplayObservationList(observationList, item.observations ?? []);
      phasesWrap.append(phaseTitle, phaseList);
      observationsWrap.append(observationTitle, observationList);
      detailsGrid.append(phasesWrap, observationsWrap);

      row.append(summaryRow, meta, detailsGrid);
      elements.taskHistory.append(row);
    }
    if (!elements.taskHistory.children.length) clearAndEmpty(elements.taskHistory, "暂无历史结果");
  }
}

function renderSkillPlan(status) {
  const plan = status.skillPlan?.plan;
  setText(elements.skillTitle, plan?.title ?? status.skillPlan?.primarySkillId ?? "--");
  elements.skillTasks.replaceChildren();
  for (const task of plan?.tasks ?? []) {
    const item = document.createElement("li");
    item.className = task === plan.nextTask ? "active" : "";
    item.textContent = task;
    elements.skillTasks.append(item);
  }
  if (!elements.skillTasks.children.length) {
    const item = document.createElement("li");
    item.textContent = "--";
    elements.skillTasks.append(item);
  }
}

function renderModeLog(status) {
  const modeLog = status.controller?.modeLog ?? [];
  if (!elements.modeLog || !elements.modeLogCount) return;
  setText(elements.modeLogCount, modeLog.length);
  elements.modeLog.replaceChildren();
  for (const event of modeLog.slice(0, 30)) {
    const row = document.createElement("div");
    row.className = `event-row ${event.level ?? "info"}`;
    const mode = document.createElement("strong");
    mode.textContent = `${event.mode ?? "local"}:${event.event ?? "event"}`;
    const message = document.createElement("span");
    message.textContent = [
      event.taskType ? `task=${event.taskType}` : null,
      event.ruleDecision ? `rule=${event.ruleDecision}` : null,
      event.outcome ? `outcome=${event.outcome}` : null,
      event.reason ? `reason=${event.reason}` : null
    ].filter(Boolean).join(" · ") || "--";
    const details = document.createElement("small");
    details.textContent = formatDetails(event.details);
    row.append(mode, message);
    if (details.textContent) row.append(details);
    elements.modeLog.append(row);
  }
  if (!modeLog.length) clearAndEmpty(elements.modeLog, "暂无本地模式日志");
}

function renderLlm(status) {
  const llm = status.llm ?? {};
  const plan = llm.lastPlan ?? null;
  setText(elements.llmStatus, llm.status ?? (llm.enabled ? "idle" : "disabled"));
  setText(elements.llmModel, llm.model ?? "--");
  setText(elements.llmHost, llm.baseHost ?? "--");
  setText(elements.llmLastCall, llm.lastCallAt ? formatTime(llm.lastCallAt) : "--");
  setText(elements.llmLastError, llm.lastError ?? llm.disabledReason ?? "--");
  setText(elements.llmGoal, plan?.stageAssessment || plan?.goal || "--");
  const directiveSummary = plan?.agentDirectives?.[0]
    ? `${plan.agentDirectives[0].fromAgent ?? "agent"} -> ${plan.agentDirectives[0].toAgent ?? "agent"}: ${plan.agentDirectives[0].action ?? "request_task"}`
    : null;
  setText(elements.llmReason, directiveSummary || plan?.reason || "--");
  elements.llmTasks.replaceChildren();
  const planTaskRows = plan?.taskRequests?.length
    ? plan.taskRequests
    : (plan?.behaviorTrees?.length ? plan.behaviorTrees : (plan?.tasks ?? []).map((taskType) => ({ taskType })));
  for (const task of planTaskRows ?? []) {
    const item = document.createElement("li");
    const taskType = typeof task === "string" ? task : task.taskType;
    const agent = typeof task === "string" ? null : (task.assignedAgent ?? task.sourceAgent);
    const objective = typeof task === "string" ? null : (task.objective ?? task.reason);
    item.textContent = [taskLevelText(task), taskType, taskInstanceText(task), agent, objective].filter(Boolean).join(" · ");
    elements.llmTasks.append(item);
  }
  if (!elements.llmTasks.children.length) {
    const item = document.createElement("li");
    item.textContent = "--";
    elements.llmTasks.append(item);
  }

  const queue = llm.taskQueue ?? null;
  const behaviorQueue = status.controller?.behaviorQueue ?? null;
  const queueSource = behaviorQueue?.currentTree || behaviorQueue?.pendingTrees?.length ? behaviorQueue : queue;
  const queueState = queueSource ? `${queueSource.enabled ? "enabled" : "disabled"}${queueSource.active ? " / active" : ""}` : "--";
  setText(elements.llmQueueState, queueState);
  elements.llmQueueTasks.replaceChildren();
  const queueTasks = [
    ...(behaviorQueue?.currentTree ? [{ ...behaviorQueue.currentTree, type: behaviorQueue.currentTree.taskType, label: "current" }] : []),
    ...(behaviorQueue?.pendingTrees ?? []).map((tree) => ({ ...tree, type: tree.taskType })),
    ...(queue?.currentTask ? [{ ...queue.currentTask, label: "current" }] : []),
    ...(queue?.pendingTasks ?? [])
  ];
  for (const task of queueTasks) {
    const item = document.createElement("li");
    item.className = task.label === "current" ? "active" : "";
    const taskType = task.type ?? task.taskType;
    const instance = taskInstanceText(task);
    item.textContent = task.label === "current"
      ? [taskType, taskLevelText(task), instance, "running"].filter(Boolean).join(" · ")
      : [taskType, taskLevelText(task), instance].filter(Boolean).join(" · ");
    elements.llmQueueTasks.append(item);
  }
  if (!elements.llmQueueTasks.children.length) {
    const item = document.createElement("li");
    item.textContent = queueSource?.lastEvent?.reason ?? "--";
    elements.llmQueueTasks.append(item);
  }
}

function renderEntities(status) {
  const entities = status.entities ?? [];
  setText(elements.entityCount, entities.length);
  elements.entities.replaceChildren();
  for (const entity of entities) {
    const row = document.createElement("div");
    row.className = "list-row";
    row.innerHTML = `<strong></strong><span></span>`;
    row.querySelector("strong").textContent = entity.name;
    row.querySelector("span").textContent = `${entity.distance}m`;
    elements.entities.append(row);
  }
  if (!entities.length) clearAndEmpty(elements.entities, "附近无实体");
}

function renderInventory(status) {
  const inventory = status.inventory ?? { items: [] };
  setText(elements.inventoryCount, `${inventory.totalKinds ?? 0} 类 / ${inventory.totalItems ?? 0}`);
  elements.inventory.replaceChildren();
  for (const item of inventory.items ?? []) {
    const block = document.createElement("div");
    block.className = "inventory-item";
    const count = document.createElement("strong");
    count.textContent = item.count;
    const name = document.createElement("span");
    name.textContent = item.name;
    block.append(count, name);
    elements.inventory.append(block);
  }
  if (!inventory.items?.length) clearAndEmpty(elements.inventory, "背包为空");
}

function renderEvents(status) {
  const events = status.recentEvents ?? [];
  setText(elements.eventCount, events.length);
  elements.events.replaceChildren();
  for (const event of events.slice(0, 28)) {
    const row = document.createElement("div");
    row.className = `event-row ${event.level ?? "info"}`;
    const level = document.createElement("strong");
    level.textContent = event.level ?? "info";
    const message = document.createElement("span");
    message.textContent = event.message ?? "";
    row.append(level, message);
    elements.events.append(row);
  }
  if (!events.length) clearAndEmpty(elements.events, "暂无事件");
}

function render(status) {
  renderServices(lastServices);
  renderConnection(status);
  renderMetrics(status);
  renderBotPerspective(status);
  renderTerrain(status);
  renderDiagnostics(status);
  renderDecision(status);
  renderProgress(status);
  renderPlaybook(status);
  renderAgentMindMap(status);
  renderBehaviorTree(status);
  renderTaskTrace(status);
  renderModeLog(status);
  renderSkillPlan(status);
  renderLlm(status);
  renderEntities(status);
  renderInventory(status);
  renderEvents(status);
}

function setTimeControlBusy(isBusy) {
  if (elements.setDayButton) elements.setDayButton.disabled = isBusy;
  if (elements.setNightButton) elements.setNightButton.disabled = isBusy;
}

function setServiceControlBusy(isBusy) {
  for (const button of elements.pythonBrainButtons ?? []) button.disabled = isBusy;
}

async function controlPythonBrain(action) {
  setServiceControlBusy(true);
  if (elements.serviceSummary) elements.serviceSummary.textContent = `Python Brain ${action}...`;
  try {
    const response = await fetch("/api/services/python-brain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      if (elements.serviceSummary) elements.serviceSummary.textContent = `Python Brain 操作失败: ${payload.error || `HTTP ${response.status}`}`;
      return;
    }
    await refreshServices();
  } catch (error) {
    if (elements.serviceSummary) elements.serviceSummary.textContent = `Python Brain 操作失败: ${error.message}`;
  } finally {
    setServiceControlBusy(false);
  }
}

async function switchWorldTime(mode) {
  if (!elements.timeControlStatus) return;
  setTimeControlBusy(true);
  elements.timeControlStatus.textContent = `正在切换到${mode === "day" ? "白天" : "夜晚"}...`;
  try {
    const response = await fetch("/api/control/time", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      const error = payload.error || `HTTP ${response.status}`;
      elements.timeControlStatus.textContent = `切换失败: ${error}`;
      return;
    }
    elements.timeControlStatus.textContent = `已发送: ${mode === "day" ? "白天" : "夜晚"}`;
    await refresh();
  } catch (error) {
    elements.timeControlStatus.textContent = `切换失败: ${error.message}`;
  } finally {
    setTimeControlBusy(false);
  }
}

async function refresh() {
  try {
    const [response] = await Promise.all([fetch("/api/status", { cache: "no-store" }), refreshServices()]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    elements.connectionBadge.className = "connection disconnected";
    elements.connectionBadge.textContent = "面板离线";
  }
}

async function refreshServices() {
  try {
    const response = await fetch("/api/services", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const services = await response.json();
    renderServices(services);
    return services;
  } catch (error) {
    if (elements.serviceSummary) elements.serviceSummary.textContent = `服务状态离线: ${error.message}`;
    return null;
  }
}

if (elements.setDayButton) {
  elements.setDayButton.addEventListener("click", () => switchWorldTime("day"));
}
if (elements.setNightButton) {
  elements.setNightButton.addEventListener("click", () => switchWorldTime("night"));
}
for (const button of elements.pythonBrainButtons ?? []) {
  button.addEventListener("click", () => controlPythonBrain(button.dataset.pythonBrainAction));
}

refresh();

async function refreshLoop() {
  await refresh();
  window.setTimeout(refreshLoop, hasOpenTaskHistoryItem() ? DETAIL_REVIEW_REFRESH_MS : NORMAL_REFRESH_MS);
}

window.setTimeout(refreshLoop, NORMAL_REFRESH_MS);
