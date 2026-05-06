const { validateTaskSequence } = require("../knowledge/survivalSkills");
const {
  normalizeTaskConstructorArgs,
  taskFunctionName,
  taskLevel,
  taskPriority,
  taskTreeClassName
} = require("../behavior/executableBehaviorTree");
const { createDefaultToolRegistry } = require("../knowledge/toolRegistry");
const { buildPlannerContext } = require("./contextBuilder");
const { createPlannerToolRegistry, runToolCallingLoop } = require("./toolLoop");

const TASK_ACTION_ALIASES = Object.freeze({
  safe_explore: "explore",
  safe_exploration: "explore",
  explore_environment: "explore",
  explore_area: "explore",
  collect_logs: "collect_wood",
  chop_tree: "collect_wood",
  chop_wood: "collect_wood",
  forage_food: "hunt_food"
});

function extractJsonObject(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizePlan(rawPlan = {}) {
  const agentDirectives = Array.isArray(rawPlan.agentDirectives)
    ? rawPlan.agentDirectives.map(normalizeAgentDirective).filter(Boolean)
    : [];
  const directTaskRequests = Array.isArray(rawPlan.taskRequests)
    ? rawPlan.taskRequests.map(normalizeTaskRequest).filter(Boolean)
    : [];
  const directiveTaskRequests = agentDirectives.map((directive) => directive.taskRequest).filter(Boolean);
  const taskRequests = dedupeTaskRequests([...directTaskRequests, ...directiveTaskRequests]);
  const tasks = Array.isArray(rawPlan.tasks) ? rawPlan.tasks.filter((task) => typeof task === "string") : [];
  const normalizedTasks = tasks.length ? tasks.map(normalizeTaskType).filter(Boolean) : taskRequests.map((request) => request.taskType);
  const explicitBehaviorTrees = Array.isArray(rawPlan.behaviorTrees)
    ? rawPlan.behaviorTrees
      .filter((tree) => tree && typeof tree === "object" && typeof tree.taskType === "string")
      .map((tree) => {
        const taskType = normalizeTaskType(tree.taskType);
        const constructorArgs = normalizeParameters(taskType, tree);
        return {
          taskType,
          treeClass: typeof tree.treeClass === "string" ? tree.treeClass : taskTreeClassName(taskType),
          taskFunction: typeof tree.taskFunction === "string" ? tree.taskFunction : taskFunctionName(taskType),
          constructorArgs,
          level: tree.level ?? taskLevel(taskType),
          priority: taskPriority(taskType),
          reason: typeof tree.reason === "string" ? tree.reason : undefined,
          sourceAgent: typeof tree.sourceAgent === "string" ? tree.sourceAgent : undefined,
          requestedBy: typeof tree.requestedBy === "string" ? tree.requestedBy : undefined,
          taskRequestId: typeof tree.taskRequestId === "string" ? tree.taskRequestId : undefined,
          parameters: constructorArgs,
          nodes: Array.isArray(tree.nodes) ? tree.nodes : undefined,
          preconditions: Array.isArray(tree.preconditions) ? tree.preconditions : undefined,
          postconditions: Array.isArray(tree.postconditions) ? tree.postconditions : undefined
        };
      })
    : [];
  const requestBehaviorTrees = taskRequests.map((request) => ({
    taskType: request.taskType,
    treeClass: request.treeClass,
    taskFunction: request.taskFunction,
    constructorArgs: request.constructorArgs,
    level: request.level,
    priority: request.priority,
    reason: request.reason ?? request.objective,
    sourceAgent: request.assignedAgent,
    requestedBy: request.fromAgent,
    taskRequestId: request.requestId,
    parameters: request.parameters,
    preconditions: request.preconditions,
    postconditions: request.successCriteria
  }));
  const behaviorTrees = explicitBehaviorTrees.length ? explicitBehaviorTrees : requestBehaviorTrees;
  return {
    brainAgent: typeof rawPlan.brainAgent === "string" ? rawPlan.brainAgent : "general_agent",
    stageAssessment: typeof rawPlan.stageAssessment === "string" ? rawPlan.stageAssessment : "",
    goal: typeof rawPlan.goal === "string" ? rawPlan.goal : "",
    tasks: normalizedTasks,
    agentDirectives,
    taskRequests,
    behaviorTrees,
    reason: typeof rawPlan.reason === "string" ? rawPlan.reason : "",
    constraints: Array.isArray(rawPlan.constraints) ? rawPlan.constraints.filter((item) => typeof item === "string") : [],
    confidence: Number.isFinite(Number(rawPlan.confidence)) ? Math.max(0, Math.min(1, Number(rawPlan.confidence))) : null
  };
}

function normalizeTaskType(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const taskType = value.trim();
  return TASK_ACTION_ALIASES[taskType] ?? taskType;
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
}

function normalizeParameters(taskType, value = {}) {
  return normalizeTaskConstructorArgs(taskType, value);
}

function normalizeTaskRequest(rawRequest = {}) {
  if (!rawRequest || typeof rawRequest !== "object") return null;
  const taskType = normalizeTaskType(rawRequest.taskType ?? rawRequest.type ?? rawRequest.action ?? rawRequest.name);
  if (!taskType) return null;
  const priority = taskPriority(taskType);
  const constructorArgs = normalizeParameters(taskType, rawRequest);
  return {
    requestId: typeof rawRequest.requestId === "string" ? rawRequest.requestId : (typeof rawRequest.id === "string" ? rawRequest.id : null),
    fromAgent: typeof rawRequest.fromAgent === "string" ? rawRequest.fromAgent : "general_agent",
    assignedAgent: typeof rawRequest.assignedAgent === "string" ? rawRequest.assignedAgent : (typeof rawRequest.toAgent === "string" ? rawRequest.toAgent : "survival_agent"),
    taskType,
    treeClass: typeof rawRequest.treeClass === "string" ? rawRequest.treeClass : taskTreeClassName(taskType),
    taskFunction: typeof rawRequest.taskFunction === "string" ? rawRequest.taskFunction : taskFunctionName(taskType),
    constructorArgs,
    action: typeof rawRequest.action === "string" ? rawRequest.action : taskType,
    level: rawRequest.level ?? taskLevel(priority),
    priority,
    objective: typeof rawRequest.objective === "string" ? rawRequest.objective : "",
    reason: typeof rawRequest.reason === "string" ? rawRequest.reason : "",
    parameters: constructorArgs,
    preconditions: normalizeStringArray(rawRequest.preconditions),
    successCriteria: normalizeStringArray(rawRequest.successCriteria ?? rawRequest.postconditions)
  };
}

function normalizeAgentDirective(rawDirective = {}) {
  if (!rawDirective || typeof rawDirective !== "object") return null;
  const taskRequest = normalizeTaskRequest({
    ...(rawDirective.taskRequest ?? rawDirective.request ?? {}),
    fromAgent: rawDirective.fromAgent ?? rawDirective.agent ?? "general_agent",
    assignedAgent: rawDirective.toAgent ?? rawDirective.assignedAgent ?? rawDirective.targetAgent ?? "survival_agent"
  });
  return {
    directiveId: typeof rawDirective.directiveId === "string" ? rawDirective.directiveId : (typeof rawDirective.id === "string" ? rawDirective.id : null),
    fromAgent: typeof rawDirective.fromAgent === "string" ? rawDirective.fromAgent : "general_agent",
    toAgent: typeof rawDirective.toAgent === "string" ? rawDirective.toAgent : (taskRequest?.assignedAgent ?? "survival_agent"),
    action: typeof rawDirective.action === "string" ? rawDirective.action : "request_task",
    reason: typeof rawDirective.reason === "string" ? rawDirective.reason : "",
    taskRequest
  };
}

function dedupeTaskRequests(requests = []) {
  const seen = new Set();
  const result = [];
  for (const request of requests) {
    const key = request.requestId ?? `${request.fromAgent}:${request.assignedAgent}:${request.taskType}:${JSON.stringify(request.parameters)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(request);
  }
  return result;
}

class LlmPlanner {
  constructor({ config, client, recorder, logger = console, onUpdate = null, toolRegistry = null } = {}) {
    this.config = config ?? {};
    this.client = client;
    this.recorder = recorder;
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.toolRegistry = toolRegistry ?? createPlannerToolRegistry(createDefaultToolRegistry());
    this.running = false;
    this.lastStartedAt = 0;
    this.state = {
      enabled: Boolean(this.config.enabled),
      disabledReason: this.config.disabledReason ?? null,
      status: this.config.enabled ? "idle" : "disabled",
      model: this.config.model ?? null,
      baseHost: this.config.baseHost ?? null,
      lastCallAt: null,
      lastPlan: null,
      lastError: null,
      taskQueue: null,
      recentCalls: []
    };
  }

  getStatus() {
    return {
      ...this.state,
      recentCalls: this.recorder?.listRecent?.() ?? this.state.recentCalls ?? []
    };
  }

  publish(update) {
    this.state = { ...this.state, ...update };
    this.onUpdate?.(this.getStatus());
  }

  shouldRun(now = Date.now(), options = {}) {
    if (!this.config.enabled || !this.client || this.running) return false;
    if (options.force) return true;
    const interval = Math.max(1000, this.config.plannerIntervalMs ?? 60000);
    return now - this.lastStartedAt >= interval;
  }

  noteSkipped(reason) {
    this.publish({ status: "skipped", lastError: reason });
  }

  noteQueueDecision(queueResult = {}) {
    const lastPlan = this.state.lastPlan ? {
      ...this.state.lastPlan,
      accepted: Boolean(queueResult.accepted),
      queue: {
        accepted: Boolean(queueResult.accepted),
        reason: queueResult.reason ?? null,
        taskCount: queueResult.taskCount ?? 0,
        planId: queueResult.planId ?? null,
        skippedTasks: queueResult.skippedTasks ?? []
      }
    } : null;
    const status = queueResult.accepted ? "queued" : this.state.status;
    this.publish({ status, lastPlan, taskQueue: queueResult.status ?? this.state.taskQueue ?? null });
    this.recorder?.record?.({
      type: "task_queue",
      status: queueResult.accepted ? "accepted" : "rejected",
      model: this.config.model,
      baseHost: this.config.baseHost,
      promptSummary: lastPlan ? `goal=${lastPlan.goal}; tasks=${lastPlan.tasks.join(",")}` : null,
      plan: lastPlan,
      error: queueResult.accepted ? null : queueResult.reason
    });
  }

  async runDryPlan(input = {}) {
    if (!this.shouldRun(Date.now(), { force: Boolean(input.force) })) return null;
    this.running = true;
    this.lastStartedAt = Date.now();
    const context = buildPlannerContext(input);
    const promptSummary = `stage=${context.progress?.stage ?? "unknown"}; rule=${context.currentRuleDecision?.type ?? "none"}; hp=${context.bot.health}; food=${context.bot.food}; night=${context.world.isNight}`;
    this.publish({ status: "planning", lastCallAt: new Date().toISOString(), lastError: null });

    const messages = [
      {
        role: "system",
        content: "You are the smart brain for a Minecraft survival bot. Your output is a command envelope for agents and executable behavior-tree instances, not a prose reasoning trace. You may call read-only tools to inspect status, progress, memory, task feedback, and allowed tasks. Return only strict JSON with: brainAgent, stageAssessment, agentDirectives, taskRequests, behaviorTrees, constraints, confidence. Do not include chain-of-thought, hidden reasoning, or narrative explanations. Use short reason/objective strings only. agentDirectives are commands such as general_agent activating survival_agent. taskRequests are requests accepted by task_agent and must use allowed taskType values or known aliases like safe_explore. Treat low-level taskType values as function names and behaviorTrees as class instances. Each taskRequest should provide taskType plus constructorArgs/parameters; each behaviorTrees item should be a class-instance envelope with treeClass, taskType, constructorArgs, level, sourceAgent, requestedBy, taskRequestId, reason, preconditions, postconditions. Do not output node internals, direct Mineflayer APIs, executable code, or prose thoughts. If taskFeedback shows a blocked task, request a different recovery task. For early food, do not hard-code berry priority: use foodStrategy and the local terrain scan first, request safe exploration when food sources are unknown, prefer nearby land animals when they are safe, prefer mature berry bushes over aquatic fish when snow/ice/high-water terrain or oxygen risk makes fish dangerous, and only request aquatic hunt_food when fish are close, reachable from shore/air, and oxygen is not low. If memory has knownBlocks with useful coordinates, pass those coordinates in constructorArgs.targetPosition."
      },
      {
        role: "user",
        content: JSON.stringify(context)
      }
    ];

    try {
      const toolLoop = await runToolCallingLoop({
        client: this.client,
        toolRegistry: this.toolRegistry,
        messages,
        config: this.config,
        request: {
          temperature: 0.2,
          responseFormat: { type: "json_object" },
          timeoutMs: this.config.timeoutMs
        },
        toolContext: { plannerContext: context }
      });
      const response = toolLoop.response;

      if (!toolLoop.ok) {
        const record = this.recorder?.record({
          type: "planner",
          status: "error",
          model: this.config.model,
          baseHost: this.config.baseHost,
          durationMs: response?.durationMs,
          promptSummary,
          toolCalls: toolLoop.toolCalls,
          toolResults: toolLoop.toolResults,
          error: toolLoop.error ?? response?.error ?? "tool_loop_failed"
        });
        this.publish({ status: "error", lastError: record?.error ?? "tool_loop_failed", recentCalls: this.recorder?.listRecent?.() ?? [] });
        this.logger.warn?.(`llm planner failed: ${record?.error ?? "tool_loop_failed"}`);
        return { status: "error", error: record?.error ?? "tool_loop_failed", record };
      }

      const parsed = extractJsonObject(response.content);
      const plan = normalizePlan(parsed ?? {});
      const validation = validateTaskSequence([...plan.tasks, ...plan.behaviorTrees.map((tree) => tree.taskType)]);
      const status = parsed && validation.ok ? "ok" : "invalid";
      const planEnvelope = {
        ...plan,
        validation,
        dryRun: !this.config.taskQueueEnabled,
        accepted: false,
        ruleDecision: context.currentRuleDecision?.type ?? null,
        createdAt: new Date().toISOString()
      };
      const record = this.recorder?.record({
        type: "planner",
        status,
        model: response.model ?? this.config.model,
        baseHost: this.config.baseHost,
        durationMs: response.durationMs,
        usage: response.usage,
        promptSummary,
        responseSummary: response.content,
        toolCalls: toolLoop.toolCalls,
        toolResults: toolLoop.toolResults,
        plan: planEnvelope,
        error: status === "invalid" ? (parsed ? `unknown tasks: ${validation.unknownTasks.join(", ")}` : "invalid_json_plan") : null
      });
      this.publish({
        status,
        model: response.model ?? this.config.model,
        lastPlan: planEnvelope,
        lastError: record?.error ?? null,
        recentCalls: this.recorder?.listRecent?.() ?? []
      });
      return { status, plan: planEnvelope, record };
    } catch (error) {
      const record = this.recorder?.record({
        type: "planner",
        status: "error",
        model: this.config.model,
        baseHost: this.config.baseHost,
        promptSummary,
        error: error.message
      });
      this.publish({ status: "error", lastError: error.message, recentCalls: this.recorder?.listRecent?.() ?? [] });
      return { status: "error", error: error.message, record };
    } finally {
      this.running = false;
    }
  }
}

module.exports = {
  LlmPlanner,
  extractJsonObject,
  normalizePlan
};