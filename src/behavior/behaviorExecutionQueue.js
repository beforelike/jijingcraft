const {
  buildExecutableBehaviorTree,
  normalizeTaskConstructorArgs,
  taskFunctionName,
  taskLevel,
  taskParameterSchema,
  taskPriority,
  taskTreeClassName,
  validateExecutableBehaviorTree
} = require("./executableBehaviorTree");

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function summarizeTree(tree = null) {
  if (!tree) return null;
  return {
    id: tree.id ?? null,
    taskType: tree.taskType ?? null,
    label: tree.label ?? null,
    treeClass: tree.treeClass ?? taskTreeClassName(tree.taskType),
    taskFunction: tree.taskFunction ?? taskFunctionName(tree.taskType),
    constructorArgs: tree.constructorArgs && typeof tree.constructorArgs === "object" ? { ...tree.constructorArgs } : (tree.parameters && typeof tree.parameters === "object" ? { ...tree.parameters } : {}),
    parameterSchema: tree.parameterSchema && typeof tree.parameterSchema === "object" ? { ...tree.parameterSchema } : taskParameterSchema(tree.taskType),
    priority: Number(tree.priority) || 0,
    level: tree.level ?? taskLevel(tree.taskType),
    status: tree.status ?? "unknown",
    source: tree.source ?? null,
    sourceAgent: tree.sourceAgent ?? null,
    sourcePlanId: tree.sourcePlanId ?? null,
    requestedBy: tree.requestedBy ?? null,
    taskRequestId: tree.taskRequestId ?? null,
    reason: tree.reason ?? null,
    parameters: tree.parameters && typeof tree.parameters === "object" ? { ...tree.parameters } : {},
    createdAt: tree.createdAt ?? null,
    expiresAt: tree.expiresAt ?? null,
    startedAt: tree.startedAt ?? null,
    completedAt: tree.completedAt ?? null,
    attempts: Number(tree.attempts) || 0,
    lastOutcome: tree.lastOutcome ?? null,
    lastReason: tree.lastReason ?? null,
    preconditions: Array.isArray(tree.preconditions) ? tree.preconditions.slice(0, 8) : [],
    postconditions: Array.isArray(tree.postconditions) ? tree.postconditions.slice(0, 8) : [],
    nodes: Array.isArray(tree.nodes) ? tree.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      handler: node.handler,
      phaseId: node.phaseId ?? null
    })) : []
  };
}

class BehaviorExecutionQueue {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.maxTrees = Math.max(1, Number(options.maxTrees ?? 8));
    this.maxAgeMs = Math.max(1000, Number(options.maxAgeMs ?? 300000));
    this.maxCurrentAgeMs = Math.max(1000, Number(options.maxCurrentAgeMs ?? options.currentMaxAgeMs ?? this.maxAgeMs));
    this.queue = [];
    this.current = null;
    this.completed = [];
    this.feedback = [];
    this.lastEvent = null;
  }

  reject(reason, details = {}) {
    this.lastEvent = { type: "rejected", reason, details, at: nowIso() };
    return { accepted: false, reason, details, status: this.getStatus() };
  }

  enqueueTask(taskType, options = {}) {
    return this.enqueueTree(buildExecutableBehaviorTree(taskType, options), options);
  }

  enqueueTree(tree, options = {}) {
    if (!this.enabled) return this.reject("behavior_queue_disabled");
    this.releaseStaleCurrent(Date.now(), "current_tree_stale_before_enqueue", { sourcePlanId: options.sourcePlanId ?? null });
    const candidate = clone(tree);
    candidate.priority = taskPriority(candidate.taskType);
    candidate.level = taskLevel(candidate.priority);
    candidate.treeClass = candidate.treeClass ?? taskTreeClassName(candidate.taskType);
    candidate.taskFunction = candidate.taskFunction ?? taskFunctionName(candidate.taskType);
    candidate.constructorArgs = normalizeTaskConstructorArgs(candidate.taskType, candidate);
    candidate.parameters = candidate.constructorArgs;
    candidate.parameterSchema = candidate.parameterSchema ?? taskParameterSchema(candidate.taskType);
    if (options.source !== undefined) candidate.source = options.source;
    if (options.sourceAgent !== undefined) candidate.sourceAgent = options.sourceAgent;
    if (options.sourcePlanId !== undefined) candidate.sourcePlanId = options.sourcePlanId;
    if (options.reason !== undefined) candidate.reason = options.reason;
    if (!candidate.expiresAt) candidate.expiresAt = new Date(Date.now() + this.maxAgeMs).toISOString();
    candidate.status = "pending";
    candidate.attempts = Number(candidate.attempts) || 0;

    const validation = validateExecutableBehaviorTree(candidate);
    if (!validation.ok) return this.reject("invalid_behavior_tree", { errors: validation.errors });
    if (this.hasTask(candidate.taskType, candidate.sourcePlanId)) return this.reject("duplicate_behavior_tree", { taskType: candidate.taskType, sourcePlanId: candidate.sourcePlanId });

    this.queue.push(candidate);
    this.sortPendingTrees();
    this.trimPendingTrees();
    this.lastEvent = { type: "accepted", task: candidate.taskType, treeId: candidate.id, priority: candidate.priority, source: candidate.source, sourceAgent: candidate.sourceAgent, at: nowIso() };
    return { accepted: true, reason: "behavior_tree_queued", treeId: candidate.id, taskType: candidate.taskType, priority: candidate.priority, status: this.getStatus() };
  }

  enqueuePlan(plan = {}, metadata = {}) {
    if (!this.enabled) return this.reject("behavior_queue_disabled");
    const planId = metadata.sourcePlanId ?? plan.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const directiveRequests = Array.isArray(plan.agentDirectives)
      ? plan.agentDirectives.map((directive) => ({
        ...(directive.taskRequest ?? {}),
        fromAgent: directive.fromAgent,
        assignedAgent: directive.toAgent,
        directiveId: directive.directiveId ?? directive.id,
        directiveAction: directive.action,
        directiveReason: directive.reason
      }))
      : [];
    const taskRequests = [
      ...(Array.isArray(plan.taskRequests) ? plan.taskRequests : []),
      ...directiveRequests
    ].filter((request) => request && typeof request === "object" && (request.taskType || request.type || request.action));
    const treeInputs = Array.isArray(plan.behaviorTrees) && plan.behaviorTrees.length
      ? plan.behaviorTrees
      : (taskRequests.length ? taskRequests
      : (Array.isArray(plan.tasks) ? plan.tasks.map((taskType) => ({ taskType })) : []));
    if (!treeInputs.length) return this.reject("empty_behavior_plan");

    const accepted = [];
    const rejected = [];
    for (const treeInput of treeInputs.slice(0, this.maxTrees)) {
      try {
        const taskType = treeInput.taskType ?? treeInput.type ?? treeInput.action ?? treeInput;
        const treeOptions = {
          ...treeInput,
          source: metadata.source ?? treeInput.source ?? "llm_planner",
          sourceAgent: metadata.sourceAgent ?? treeInput.assignedAgent ?? treeInput.sourceAgent ?? treeInput.toAgent ?? null,
          sourcePlanId: planId,
          requestedBy: treeInput.requestedBy ?? treeInput.fromAgent ?? plan.brainAgent ?? null,
          taskRequestId: treeInput.taskRequestId ?? treeInput.requestId ?? treeInput.id ?? null,
          reason: treeInput.reason ?? treeInput.objective ?? treeInput.directiveReason ?? plan.reason ?? null,
          treeClass: treeInput.treeClass ?? null,
          taskFunction: treeInput.taskFunction ?? null,
          constructorArgs: treeInput.constructorArgs ?? treeInput.arguments ?? treeInput.args ?? treeInput.parameters ?? treeInput.taskParameters ?? {},
          parameters: treeInput.constructorArgs ?? treeInput.arguments ?? treeInput.args ?? treeInput.parameters ?? treeInput.taskParameters ?? {}
        };
        const tree = treeInput.nodes
          ? buildExecutableBehaviorTree(taskType, treeOptions)
          : buildExecutableBehaviorTree(taskType, {
            ...treeOptions,
            source: treeOptions.source,
          });
        const result = this.enqueueTree(tree, { sourcePlanId: planId });
        if (result.accepted) accepted.push(result);
        else rejected.push({ taskType: tree.taskType, reason: result.reason });
      } catch (error) {
        rejected.push({ taskType: treeInput.taskType ?? treeInput, reason: error.message });
      }
    }

    if (!accepted.length) return this.reject("no_behavior_trees_accepted", { rejected });
    this.lastEvent = { type: "accepted_plan", planId, accepted: accepted.length, rejected, at: nowIso() };
    return { accepted: true, reason: "behavior_plan_queued", planId, taskCount: accepted.length, rejected, status: this.getStatus() };
  }

  hasTask(taskType, sourcePlanId = null) {
    const matches = (tree) => tree?.taskType === taskType && (!sourcePlanId || tree.sourcePlanId === sourcePlanId);
    return matches(this.current) || this.queue.some(matches);
  }

  sortPendingTrees() {
    this.queue.sort((left, right) => Number(right.priority) - Number(left.priority) || Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  trimPendingTrees() {
    if (this.queue.length <= this.maxTrees) return;
    const removed = this.queue.splice(this.maxTrees);
    this.lastEvent = { type: "trimmed", removed: removed.map((tree) => tree.id), at: nowIso() };
  }

  discardPendingBySource(source, reason = "superseded", details = {}) {
    if (!source) return { type: "discarded_pending", source, reason, removed: 0, at: nowIso() };
    const removed = [];
    this.queue = this.queue.filter((tree) => {
      if (tree.source !== source) return true;
      tree.status = "skipped";
      tree.completedAt = nowIso();
      tree.lastOutcome = "skipped";
      tree.lastReason = reason;
      removed.push(tree);
      this.recordFeedback(tree, "skipped", reason, details);
      return false;
    });
    if (!removed.length) return { type: "discarded_pending", source, reason, removed: 0, at: nowIso() };
    this.completed = [...removed.reverse(), ...this.completed].slice(0, this.maxTrees);
    this.lastEvent = {
      type: "discarded_pending",
      source,
      reason,
      removed: removed.length,
      tasks: removed.map((tree) => tree.taskType),
      at: nowIso()
    };
    return { ...this.lastEvent };
  }

  pruneExpired(now = Date.now()) {
    const before = this.queue.length;
    this.queue = this.queue.filter((tree) => {
      const expiresAt = Date.parse(tree.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > now;
    });
    if (before !== this.queue.length) {
      this.lastEvent = { type: "expired", removed: before - this.queue.length, at: nowIso() };
      return true;
    }
    return false;
  }

  releaseStaleCurrent(now = Date.now(), reason = "current_tree_stale", details = {}) {
    if (!this.current?.startedAt) return null;
    const startedAt = Date.parse(this.current.startedAt);
    if (!Number.isFinite(startedAt) || now - startedAt <= this.maxCurrentAgeMs) return null;
    return this.failCurrent(reason, {
      ...details,
      ageMs: now - startedAt,
      maxCurrentAgeMs: this.maxCurrentAgeMs
    });
  }

  peek(now = Date.now()) {
    this.pruneExpired(now);
    this.releaseStaleCurrent(now);
    return this.current ?? this.queue[0] ?? null;
  }

  startNext(details = {}) {
    this.pruneExpired();
    this.releaseStaleCurrent(Date.now(), "current_tree_stale_before_start", details);
    if (this.current) return this.current;
    const tree = this.queue.shift();
    if (!tree) return null;
    tree.status = "in_progress";
    tree.attempts = Number(tree.attempts || 0) + 1;
    tree.startedAt = nowIso();
    tree.lastReason = details.ruleDecision ? `rule=${details.ruleDecision}` : null;
    this.current = tree;
    this.lastEvent = { type: "started", task: tree.taskType, treeId: tree.id, priority: tree.priority, at: tree.startedAt };
    return clone(tree);
  }

  completeCurrent(outcome = "completed", details = {}) {
    if (!this.current) return null;
    const tree = this.current;
    tree.status = outcome;
    tree.completedAt = nowIso();
    tree.lastOutcome = outcome;
    tree.lastReason = details.reason ?? null;
    this.completed.unshift(tree);
    this.completed = this.completed.slice(0, this.maxTrees);
    this.current = null;
    this.lastEvent = { type: outcome, task: tree.taskType, treeId: tree.id, reason: details.reason ?? null, at: tree.completedAt };
    this.recordFeedback(tree, outcome, details.reason ?? outcome, details);
    return clone(tree);
  }

  failCurrent(reason = "failed", details = {}) {
    return this.completeCurrent("failed", { ...details, reason });
  }

  skipNext(reason = "skipped", details = {}) {
    this.pruneExpired();
    if (this.current) return null;
    const tree = this.queue.shift();
    if (!tree) return null;
    tree.status = "skipped";
    tree.completedAt = nowIso();
    tree.lastOutcome = "skipped";
    tree.lastReason = reason;
    this.completed.unshift(tree);
    this.completed = this.completed.slice(0, this.maxTrees);
    this.lastEvent = { type: "skipped", task: tree.taskType, treeId: tree.id, reason, details, at: tree.completedAt };
    this.recordFeedback(tree, "skipped", reason, details);
    return clone(tree);
  }

  pause(reason = "paused", details = {}) {
    this.lastEvent = { type: "paused", reason, details, at: nowIso() };
    return { ...this.lastEvent };
  }

  clear(reason = "cleared") {
    const removed = this.queue.length + (this.current ? 1 : 0);
    this.queue = [];
    this.current = null;
    this.lastEvent = { type: "cleared", reason, removed, at: nowIso() };
    return { ...this.lastEvent };
  }

  recordFeedback(tree, outcome, reason, details = {}) {
    this.feedback.unshift({
      treeId: tree.id,
      taskType: tree.taskType,
      source: tree.source,
      sourceAgent: tree.sourceAgent,
      sourcePlanId: tree.sourcePlanId,
      outcome,
      reason,
      details,
      at: nowIso()
    });
    this.feedback = this.feedback.slice(0, 24);
  }

  getStatus() {
    this.pruneExpired();
    return {
      enabled: this.enabled,
      active: Boolean(this.current || this.queue.length),
      maxCurrentAgeMs: this.maxCurrentAgeMs,
      currentTree: summarizeTree(this.current),
      pendingTrees: this.queue.map(summarizeTree),
      completedTrees: this.completed.map(summarizeTree),
      feedback: this.feedback.slice(0, 12),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null
    };
  }
}

module.exports = {
  BehaviorExecutionQueue,
  summarizeTree
};