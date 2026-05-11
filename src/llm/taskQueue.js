const { validateTaskSequence } = require("../knowledge/survivalSkills");

const DEFAULT_QUEUEABLE_TASKS = new Set([
  "hunt_food",
  "collect_wood",
  "craft_basic_supplies",
  "craft_basic_tools",
  "collect_stone",
  "craft_stone_tools",
  "craft_furnace",
  "craft_weapon",
  "collect_building_materials",
  "build_shelter",
  "collect_wool",
  "craft_bed",
  "collect_crop_seeds",
  "plant_crops",
  "build_animal_pen",
  "lure_animals",
  "mine_advanced_materials",
  "explore"
]);

function nowIso() {
  return new Date().toISOString();
}

function createQueueTask(type, planId, index) {
  return {
    id: `${planId}:${index}:${type}`,
    type,
    status: "pending",
    attempts: 0,
    startedAt: null,
    completedAt: null,
    lastOutcome: null,
    lastReason: null
  };
}

class LlmTaskQueue {
  constructor(options = {}) {
    this.enabled = Boolean(options.taskQueueEnabled);
    this.maxQueuedTasks = Math.max(1, Number(options.maxQueuedTasks ?? 5));
    this.maxAgeMs = Math.max(1000, Number(options.taskQueueMaxAgeMs ?? 300000));
    this.maxCurrentAgeMs = Math.max(1000, Number(options.taskQueueCurrentMaxAgeMs ?? options.maxCurrentAgeMs ?? this.maxAgeMs));
    this.queueableTasks = new Set(options.queueableTasks ?? DEFAULT_QUEUEABLE_TASKS);
    this.activePlan = null;
    this.queue = [];
    this.current = null;
    this.completed = [];
    this.lastEvent = null;
  }

  isQueueableTask(taskType) {
    return this.queueableTasks.has(taskType);
  }

  reject(reason, details = {}) {
    this.lastEvent = { type: "rejected", reason, details, at: nowIso() };
    return { accepted: false, reason, details, status: this.getStatus() };
  }

  enqueuePlan(plan = {}, metadata = {}) {
    if (!this.enabled) return this.reject("task_queue_disabled");
    const releasedCurrent = this.releaseStaleCurrent(Date.now(), "current_task_stale_before_enqueue");
    if (this.current) return this.reject("task_in_progress", { currentTask: this.current.type });
    if (!plan || !Array.isArray(plan.tasks) || plan.tasks.length === 0) return this.reject("empty_plan");

    const validation = plan.validation?.ok === false ? plan.validation : validateTaskSequence(plan.tasks);
    if (!validation.ok) return this.reject("invalid_task_sequence", { unknownTasks: validation.unknownTasks ?? [] });

    const unsafeTasks = plan.tasks.filter((task) => !this.isQueueableTask(task));
    const queueablePlanTasks = plan.tasks.filter((task) => this.isQueueableTask(task));
    if (queueablePlanTasks.length === 0) return this.reject("non_queueable_tasks", { unsafeTasks });

    const createdAt = nowIso();
    const planId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tasks = queueablePlanTasks.slice(0, this.maxQueuedTasks).map((task, index) => createQueueTask(task, planId, index));
    this.activePlan = {
      id: planId,
      goal: plan.goal ?? "",
      reason: plan.reason ?? "",
      confidence: plan.confidence ?? null,
      source: metadata.source ?? "llm_planner",
      ruleDecision: metadata.ruleDecision ?? plan.ruleDecision ?? null,
      createdAt,
      expiresAt: new Date(Date.now() + this.maxAgeMs).toISOString()
    };
    this.queue = tasks;
    this.current = null;
    this.completed = [];
    this.lastEvent = { type: "accepted", reason: "plan_queued", taskCount: tasks.length, skippedTasks: unsafeTasks, releasedCurrent: releasedCurrent ? { ...releasedCurrent } : null, at: createdAt };
    return { accepted: true, reason: "plan_queued", taskCount: tasks.length, skippedTasks: unsafeTasks, planId, releasedCurrent, status: this.getStatus() };
  }

  pruneExpired(now = Date.now()) {
    if (!this.activePlan) return false;
    const createdAt = Date.parse(this.activePlan.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt <= this.maxAgeMs) return false;
    this.clear("plan_expired");
    return true;
  }

  releaseStaleCurrent(now = Date.now(), reason = "current_task_stale", details = {}) {
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
    this.releaseStaleCurrent(Date.now(), "current_task_stale_before_start", details);
    if (this.current) return this.current;
    const task = this.queue.shift();
    if (!task) return null;
    task.status = "in_progress";
    task.attempts += 1;
    task.startedAt = nowIso();
    task.lastReason = details.ruleDecision ? `rule=${details.ruleDecision}` : null;
    this.current = task;
    this.lastEvent = { type: "started", task: task.type, at: task.startedAt };
    return task;
  }

  completeCurrent(outcome = "completed", details = {}) {
    if (!this.current) return null;
    const task = this.current;
    task.status = outcome;
    task.completedAt = nowIso();
    task.lastOutcome = outcome;
    task.lastReason = details.reason ?? null;
    this.completed.unshift(task);
    this.completed = this.completed.slice(0, this.maxQueuedTasks);
    this.current = null;
    this.lastEvent = { type: outcome, task: task.type, reason: details.reason ?? null, at: task.completedAt };
    if (this.queue.length === 0) {
      this.lastEvent = { ...this.lastEvent, planDone: true };
    }
    return task;
  }

  failCurrent(reason = "failed", details = {}) {
    return this.completeCurrent("failed", typeof reason === "object" ? reason : { ...details, reason });
  }

  skipNext(reason = "skipped", details = {}) {
    this.pruneExpired();
    if (this.current) return null;
    const task = this.queue.shift();
    if (!task) return null;
    task.status = "skipped";
    task.completedAt = nowIso();
    task.lastOutcome = "skipped";
    task.lastReason = reason;
    this.completed.unshift(task);
    this.completed = this.completed.slice(0, this.maxQueuedTasks);
    this.lastEvent = { type: "skipped", task: task.type, reason, details, at: task.completedAt };
    if (this.queue.length === 0) {
      this.lastEvent = { ...this.lastEvent, planDone: true };
    }
    return task;
  }

  pause(reason = "paused") {
    if (!this.activePlan) return null;
    this.lastEvent = { type: "paused", reason, at: nowIso() };
    return this.lastEvent;
  }

  clear(reason = "cleared") {
    const removed = this.queue.length + (this.current ? 1 : 0);
    this.queue = [];
    this.current = null;
    this.activePlan = null;
    this.lastEvent = { type: "cleared", reason, removed, at: nowIso() };
    return { ...this.lastEvent };
  }

  getStatus() {
    return {
      enabled: this.enabled,
      active: Boolean(this.activePlan),
      maxCurrentAgeMs: this.maxCurrentAgeMs,
      plan: this.activePlan ? { ...this.activePlan } : null,
      currentTask: this.current ? { ...this.current } : null,
      pendingTasks: this.queue.map((task) => ({ ...task })),
      completedTasks: this.completed.map((task) => ({ ...task })),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null
    };
  }
}

module.exports = {
  DEFAULT_QUEUEABLE_TASKS,
  LlmTaskQueue
};