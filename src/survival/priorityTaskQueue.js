const { listAllowedTasks } = require("../knowledge/survivalSkills");

const DEFAULT_ALLOWED_TASKS = new Set(listAllowedTasks());

function nowIso() {
  return new Date().toISOString();
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function cloneTask(task) {
  return task ? { ...task, metadata: { ...(task.metadata ?? {}) } } : null;
}

class PriorityTaskQueue {
  constructor(options = {}) {
    this.allowedTasks = new Set(options.allowedTasks ?? DEFAULT_ALLOWED_TASKS);
    this.maxTasks = Math.max(1, Number(options.maxTasks ?? 8));
    this.defaultTtlMs = clampNumber(options.defaultTtlMs, 300000, 1000, 1800000);
    this.queue = [];
    this.current = null;
    this.completed = [];
    this.lastEvent = null;
  }

  isAllowedTask(taskType) {
    return this.allowedTasks.has(taskType);
  }

  insert(taskType, options = {}) {
    if (!this.isAllowedTask(taskType)) throw new Error(`unknown priority task: ${taskType}`);
    if (options.replace) this.clear("replace");

    const createdAt = nowIso();
    const ttlMs = clampNumber(options.ttlMs, this.defaultTtlMs, 1000, 1800000);
    const task = {
      id: options.id || `priority:${Date.now()}:${Math.random().toString(36).slice(2, 8)}:${taskType}`,
      type: taskType,
      priority: clampNumber(options.priority, 50, 0, 1000),
      status: "pending",
      reason: options.reason || "priority task",
      source: options.source || "external",
      createdAt,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      startedAt: null,
      completedAt: null,
      attempts: 0,
      lastOutcome: null,
      lastReason: null,
      metadata: options.metadata && typeof options.metadata === "object" ? { ...options.metadata } : {}
    };

    this.queue.push(task);
    this.sortPendingTasks();
    this.trimPendingTasks();
    this.lastEvent = { type: "inserted", task: task.type, taskId: task.id, priority: task.priority, reason: task.reason, source: task.source, at: createdAt };
    return cloneTask(task);
  }

  sortPendingTasks() {
    this.queue.sort((left, right) => right.priority - left.priority || Date.parse(left.createdAt) - Date.parse(right.createdAt));
  }

  trimPendingTasks() {
    if (this.queue.length <= this.maxTasks) return;
    const removed = this.queue.splice(this.maxTasks);
    this.lastEvent = { type: "trimmed", removed: removed.map((task) => task.id), at: nowIso() };
  }

  pruneExpired(now = Date.now()) {
    const before = this.queue.length;
    this.queue = this.queue.filter((task) => {
      const expiresAt = Date.parse(task.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > now;
    });
    if (this.queue.length !== before) {
      this.lastEvent = { type: "expired", removed: before - this.queue.length, at: nowIso() };
      return true;
    }
    return false;
  }

  peek(now = Date.now()) {
    this.pruneExpired(now);
    return this.current ?? this.queue[0] ?? null;
  }

  startNext(details = {}) {
    this.pruneExpired();
    if (this.current) return this.current;
    const task = this.queue.shift();
    if (!task) return null;
    task.status = "in_progress";
    task.attempts += 1;
    task.startedAt = nowIso();
    task.lastReason = details.ruleDecision ? `rule=${details.ruleDecision}` : null;
    this.current = task;
    this.lastEvent = { type: "started", task: task.type, taskId: task.id, priority: task.priority, at: task.startedAt };
    return cloneTask(task);
  }

  completeCurrent(outcome = "completed", details = {}) {
    if (!this.current) return null;
    const task = this.current;
    task.status = outcome;
    task.completedAt = nowIso();
    task.lastOutcome = outcome;
    task.lastReason = details.reason ?? null;
    this.completed.unshift(task);
    this.completed = this.completed.slice(0, this.maxTasks);
    this.current = null;
    this.lastEvent = { type: outcome, task: task.type, taskId: task.id, reason: details.reason ?? null, at: task.completedAt };
    return cloneTask(task);
  }

  failCurrent(reason = "failed") {
    return this.completeCurrent("failed", { reason });
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

  getStatus() {
    this.pruneExpired();
    return {
      active: Boolean(this.current || this.queue.length),
      currentTask: cloneTask(this.current),
      pendingTasks: this.queue.map(cloneTask),
      completedTasks: this.completed.map(cloneTask),
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null
    };
  }
}

module.exports = {
  DEFAULT_ALLOWED_TASKS,
  PriorityTaskQueue
};