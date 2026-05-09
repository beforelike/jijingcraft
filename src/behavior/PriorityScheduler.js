/**
 * Priority Preemptive Scheduler — replaces BehaviorExecutionQueue.
 *
 * Key improvements over old queue:
 *   1. Priority preemption — S-tier tasks interrupt non-S current tasks
 *   2. Per-action monitoring — each action has a monitor spec (interval, metric, thresholds)
 *   3. Anti-blocking — action-level stall detection with diagnose → FailureReport
 *   4. Structured failure reports — rich failure reasons fed back to Planner
 *   5. Task lifecycle — pending → running → preempted → resumed → done/failed
 */

const {
  buildExecutableBehaviorTree,
  normalizeTaskConstructorArgs,
  taskFunctionName,
  taskLevel,
  taskParameterSchema,
  taskPriority,
  taskTreeClassName,
  validateExecutableBehaviorTree,
  DEFAULT_TASK_PRIORITIES,
  TASK_LABELS,
} = require("./executableBehaviorTree");

// ── Constants ────────────────────────────────────────────────────────────────

const PREEMPTION_GAP = 100; // new priority must exceed current by this margin

const TASK_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  PREEMPTED: "preempted",
  RESUMING: "resuming",
  COMPLETED: "completed",
  FAILED: "failed",
  RETRYING: "retrying",
  GAVE_UP: "gave_up",
  SKIPPED: "skipped",
});

const PREEMPTIBLE_LEVELS = new Set(["B", "C", "D"]);
const UNINTERRUPTIBLE_LEVELS = new Set(["S", "A"]);

// Default monitor specs per action type (mirrors Python side)
const DEFAULT_ACTION_MONITORS = Object.freeze({
  walk: {
    metric: "position_delta",
    checkIntervalMs: 200,
    stallThresholdMs: 1000,
    minProgressPerCheck: 0.05,
  },
  jump: {
    metric: "position_delta",
    checkIntervalMs: 100,
    stallThresholdMs: 500,
    minProgressPerCheck: 0.05,
  },
  swim: {
    metric: "position_delta",
    checkIntervalMs: 200,
    stallThresholdMs: 2000,
    minProgressPerCheck: 0.02,
  },
  mine: {
    metric: "block_breaking",
    checkIntervalMs: 200,
    stallThresholdMs: 2000,
    minProgressPerCheck: 0.1,
  },
  place: {
    metric: "block_placed",
    checkIntervalMs: 200,
    stallThresholdMs: 2000,
    minProgressPerCheck: 1.0,
  },
  eat: {
    metric: "bot_food",
    checkIntervalMs: 200,
    stallThresholdMs: 2000,
    minProgressPerCheck: 0.1,
  },
  collect: {
    metric: "inventory_count",
    checkIntervalMs: 300,
    stallThresholdMs: 3000,
    minProgressPerCheck: 1,
  },
  attack: {
    metric: "entity_health",
    checkIntervalMs: 150,
    stallThresholdMs: 1500,
    minProgressPerCheck: 0.05,
  },
  flee: {
    metric: "entity_proximity",
    checkIntervalMs: 200,
    stallThresholdMs: 2000,
    minProgressPerCheck: 0.1,
  },
  craft: {
    metric: "inventory_count",
    checkIntervalMs: 200,
    stallThresholdMs: 2000,
    minProgressPerCheck: 1,
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  return Date.now();
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function treeKey(tree) {
  const args = JSON.stringify(tree?.constructorArgs ?? tree?.parameters ?? {}, Object.keys(tree?.constructorArgs ?? tree?.parameters ?? {}).sort());
  return `${tree?.taskType ?? "unknown"}:${args}`;
}

// ── Action Monitor ───────────────────────────────────────────────────────────

class ActionMonitor {
  /**
   * Monitors action execution progress at high frequency.
   * Detects stalls based on action-specific monitor specs.
   *
   * @param {object} monitorSpec - from compiled action JSON or DEFAULT_ACTION_MONITORS
   */
  constructor(monitorSpec = {}) {
    this.metric = monitorSpec.metric ?? "position_delta";
    this.checkIntervalMs = monitorSpec.checkIntervalMs ?? 200;
    this.stallThresholdMs = monitorSpec.stallThresholdMs ?? 1000;
    this.minProgressPerCheck = monitorSpec.minProgressPerCheck ?? 0.05;
    this.targetValue = monitorSpec.targetValue ?? null;

    this.startValue = 0;
    this.lastValue = 0;
    this.lastProgressTime = 0;
    this.startTime = 0;
    this.totalProgress = 0;
    this.stalled = false;
    this.stallReason = null;
  }

  start(initialValue = 0) {
    this.startValue = initialValue;
    this.lastValue = initialValue;
    this.lastProgressTime = nowMs();
    this.startTime = nowMs();
    this.totalProgress = 0;
    this.stalled = false;
    this.stallReason = null;
  }

  tick(currentValue, _context = {}) {
    const now = nowMs();
    const delta = Math.max(0, currentValue - this.lastValue);

    if (delta > this.minProgressPerCheck) {
      this.lastValue = currentValue;
      this.lastProgressTime = now;
      this.stalled = false;
    } else {
      const stalledDuration = now - this.lastProgressTime;
      if (stalledDuration >= this.stallThresholdMs) {
        this.stalled = true;
        this.stallReason = `no_progress_${this.metric}_for_${Math.round(stalledDuration)}ms`;
      }
    }

    if (this.targetValue != null) {
      this.totalProgress = Math.min(1.0, currentValue / this.targetValue);
    } else {
      this.totalProgress = Math.min(1.0, (currentValue - this.startValue) / Math.max(1, Math.abs(this.startValue) + 1));
    }

    return {
      progress: Math.max(0, Math.min(1, this.totalProgress)),
      stalled: this.stalled,
      metric: this.metric,
      currentValue,
      delta,
      stalledDuration: now - this.lastProgressTime,
      stallReason: this.stallReason,
    };
  }

  isComplete() {
    return this.totalProgress >= 1.0;
  }

  getReport() {
    return {
      metric: this.metric,
      progress: this.totalProgress,
      stalled: this.stalled,
      stallReason: this.stallReason,
      elapsedMs: nowMs() - this.startTime,
      startValue: this.startValue,
      lastValue: this.lastValue,
      targetValue: this.targetValue,
    };
  }
}

// ── Action Diagnoser ─────────────────────────────────────────────────────────

class ActionDiagnoser {
  /**
   * Diagnoses why an action stalled, producing structured FailureReport.
   *
   * @param {object} diagnoseSpec - ordered checklist from compiled action JSON
   * @param {object} bot - Mineflayer bot instance for world queries
   */
  constructor(diagnoseSpec = [], bot = null) {
    this.checks = diagnoseSpec ?? [];
    this.bot = bot;
  }

  diagnose(action, context = {}) {
    for (const check of this.checks) {
      const result = this._runCheck(check, action, context);
      if (result) return result;
    }
    return {
      reason: "unknown_stall",
      detail: `Action ${action.type} stalled with no specific diagnosis`,
      suggestion: "retry_or_skip",
      context: { action: action.type, params: action.params, monitorReport: context.monitorReport ?? {} },
    };
  }

  _runCheck(check, action, context) {
    const domain = check.domain ?? check;

    switch (domain) {
      case "block_ahead": return this._checkBlockAhead(check, action, context);
      case "block_below": return this._checkBlockBelow(check, action, context);
      case "block_target": return this._checkBlockTarget(check, action, context);
      case "entity_nearby": return this._checkEntityNearby(check, action, context);
      case "entity_target": return this._checkEntityTarget(check, action, context);
      case "inventory_check": return this._checkInventory(check, action, context);
      case "tool_check": return this._checkTool(check, action, context);
      case "position_check": return this._checkPosition(check, action, context);
      default: return null;
    }
  }

  _checkBlockAhead(check, action, _context) {
    if (!this.bot?.entity?.position) return null;
    const offset = check.offset ?? { x: 0, y: 0, z: 0 };
    const pos = this.bot.entity.position.offset(offset.x ?? 0, offset.y ?? 0, offset.z ?? 0);
    const block = this.bot.blockAt?.(pos);
    if (!block) return null;

    if (check.check_solid && block.boundingBox === "block") {
      return {
        reason: "blocked_by_solid_block",
        detail: `${block.name} at (${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)})`,
        suggestion: "reroute_or_mine",
        context: { block: block.name, position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } },
      };
    }

    if (check.check_water_surface && block.name === "water") {
      return {
        reason: "under_ice_or_water_surface",
        detail: `water block at (${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)})`,
        suggestion: "break_ice_or_descend",
        context: { block: block.name, position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } },
      };
    }

    return null;
  }

  _checkBlockBelow(check, _action, _context) {
    if (!this.bot?.entity?.position) return null;
    const offset = check.offset ?? { x: 0, y: -1, z: 0 };
    const pos = this.bot.entity.position.offset(offset.x ?? 0, offset.y ?? 0, offset.z ?? 0);
    const block = this.bot.blockAt?.(pos);

    if (check.check_solid && (!block || block.boundingBox !== "block")) {
      return {
        reason: "no_ground",
        detail: "walking into air gap or edge",
        suggestion: "bridge_or_turn_back",
        context: { position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) } },
      };
    }
    return null;
  }

  _checkBlockTarget(check, action, _context) {
    const pos = check.offset ?? action.params?.position ?? check.position;
    if (!pos || !this.bot) return null;
    const block = this.bot.blockAt?.(pos);
    if (!block) return {
      reason: "target_block_gone",
      detail: `No block at target position`,
      suggestion: "rescan_area",
      context: { position: pos },
    };
    if (check.check_name && block.name !== check.check_name) {
      return {
        reason: "target_block_changed",
        detail: `Expected ${check.check_name}, found ${block.name}`,
        suggestion: "rescan_or_skip",
        context: { expected: check.check_name, actual: block.name },
      };
    }
    return null;
  }

  _checkEntityNearby(check, _action, _context) {
    if (!this.bot) return null;
    const radius = check.extra_params?.radius ?? 3;
    const checkDrops = check.extra_params?.check_drops ?? false;
    const checkHostile = check.extra_params?.check_hostile ?? false;
    const itemType = check.extra_params?.item_type ?? null;

    const entities = Object.values(this.bot.entities ?? {}).filter((e) => {
      if (!e.position) return false;
      const dist = this.bot.entity?.position?.distanceTo(e.position) ?? Infinity;
      return dist <= radius;
    });

    if (checkDrops) {
      const drops = entities.filter((e) => e.name === "item" || e.objectType === "Item");
      if (drops.length === 0) {
        return {
          reason: "no_drops_nearby",
          detail: `No item drops within ${radius} blocks`,
          suggestion: "widen_search_or_skip",
          context: { radius, itemType },
        };
      }
      if (itemType) {
        // Note: item stack inspection requires deeper Mineflayer access
        const matchingDrops = drops.filter((e) => {
          try {
            const meta = e.metadata ?? [];
            return meta.some((m) => typeof m === "object" && m.itemType === itemType);
          } catch { return false; }
        });
        if (drops.length > 0 && matchingDrops.length === 0) {
          return {
            reason: "no_matching_drops",
            detail: `Drops present but none match ${itemType}`,
            suggestion: "collect_whats_available",
            context: { radius, itemType, totalDrops: drops.length },
          };
        }
      }
    }

    if (checkHostile) {
      const hostiles = entities.filter((e) => e.type === "hostile" || e.kind === "hostile");
      if (hostiles.length > 0) {
        return {
          reason: "hostile_nearby",
          detail: `${hostiles.length} hostile(s) within ${radius}: ${hostiles.map((h) => h.name).join(",")}`,
          suggestion: "evade_or_defend",
          context: { hostiles: hostiles.map((h) => ({ name: h.name, distance: this.bot.entity?.position?.distanceTo(h.position) })) },
        };
      }
    }

    return null;
  }

  _checkEntityTarget(check, _action, _context) {
    const entityRef = check.extra_params?.entity;
    if (!entityRef?.id || !this.bot?.entities) return null;
    const entity = this.bot.entities[entityRef.id];
    if (!entity) return {
      reason: "target_entity_gone",
      detail: `Entity ${entityRef.id} no longer exists`,
      suggestion: "retarget_or_skip",
      context: { entityId: entityRef.id, entityName: entityRef.name },
    };
    const dist = this.bot.entity?.position?.distanceTo(entity.position) ?? Infinity;
    if (dist > 32) {
      return {
        reason: "target_entity_too_far",
        detail: `${entity.name ?? entityRef.name} is ${Math.round(dist)} blocks away`,
        suggestion: "close_distance_or_skip",
        context: { entityId: entityRef.id, distance: Math.round(dist) },
      };
    }
    return null;
  }

  _checkInventory(check, _action, _context) {
    // This check requires controller context — return null if unavailable
    if (check.check_food_full) {
      return {
        reason: "food_full_or_no_edible",
        detail: "Cannot eat — food bar full or no edible item equipped",
        suggestion: "skip_eat",
        context: {},
      };
    }
    if (check.check_full) {
      return {
        reason: "inventory_full",
        detail: "No space to collect items",
        suggestion: "drop_unwanted_or_craft",
        context: {},
      };
    }
    if (check.check_crafting_table) {
      return {
        reason: "need_crafting_table",
        detail: "Recipe requires crafting table",
        suggestion: "place_crafting_table",
        context: {},
      };
    }
    if (check.check_furnace) {
      return {
        reason: "need_furnace",
        detail: "Smelting requires furnace",
        suggestion: "craft_and_place_furnace",
        context: {},
      };
    }
    if (check.check_recipe) {
      return {
        reason: "missing_recipe_ingredients",
        detail: `Cannot craft ${check.check_name ?? "item"}: missing ingredients`,
        suggestion: "collect_ingredients_first",
        context: { itemType: check.check_name },
      };
    }
    return null;
  }

  _checkTool(check, _action, _context) {
    if (check.check_weapon) {
      return {
        reason: "no_effective_weapon",
        detail: "No weapon equipped for combat",
        suggestion: "equip_best_weapon_or_flee",
        context: {},
      };
    }
    if (check.check_name) {
      return {
        reason: "wrong_or_broken_tool",
        detail: `Tool ${check.check_name} missing or broken`,
        suggestion: "switch_tool_or_craft",
        context: { tool: check.check_name, blockType: check.extra_params?.block_type },
      };
    }
    return null;
  }

  _checkPosition(check, _action, _context) {
    if (!this.bot?.entity?.position) return null;
    const pos = this.bot.entity.position;
    // Check if position is valid/not NaN
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      return {
        reason: "invalid_position",
        detail: "Bot position is invalid or NaN",
        suggestion: "wait_for_sync_or_respawn",
        context: {},
      };
    }
    return null;
  }
}

// ── Priority Scheduler ───────────────────────────────────────────────────────

class PriorityScheduler {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.maxPending = Math.max(1, Number(options.maxPending ?? 8));
    this.maxPerType = Math.max(1, Number(options.maxPerType ?? 2));  // max 2 pending per taskType
    this.maxRetries = Math.max(0, Number(options.maxRetries ?? 3));
    this.maxHistory = Math.max(1, Number(options.maxHistory ?? 24));

    /** @type {object[]} — pending task queue (sorted by priority desc) */
    this.pending = [];
    /** @type {object|null} — currently executing task */
    this.current = null;
    /** @type {object|null} — preempted task (restored after high-prio completes) */
    this.preempted = null;
    /** @type {object[]} — completed task history */
    this.history = [];
    /** @type {object[]} — structured failure reports for Planner feedback */
    this.failureReports = [];
    /** @type {object|null} — last event for dashboard */
    this.lastEvent = null;
    /** @type {object[]} — task trace for diagnostics */
    this.trace = [];
  }

  // ── Enqueue ──────────────────────────────────────────────────────────────

  /**
   * Accept a task (behavior tree) for scheduling.
   * Checks for duplicates, slot limits, and decides whether to preempt.
   */
  enqueueTree(tree, options = {}) {
    if (!this.enabled) return this._reject("scheduler_disabled");

    const candidate = this._normalizeTree(tree, options);
    const validation = validateExecutableBehaviorTree(candidate);
    if (!validation.ok) return this._reject("invalid_behavior_tree", { errors: validation.errors });

    // Duplicate check by (taskType + constructorArgs hash)
    if (this._hasDuplicate(candidate)) return this._reject("duplicate_tree", { taskType: candidate.taskType, key: treeKey(candidate) });

    // Slot limit per task type
    const typeCount = this.pending.filter((t) => t.taskType === candidate.taskType).length;
    if (typeCount >= this.maxPerType) return this._reject("type_slot_full", { taskType: candidate.taskType, current: typeCount, max: this.maxPerType });

    // Total pending limit
    if (this.pending.length >= this.maxPending) {
      // Evict lowest priority pending task if new task has higher priority
      const lowest = this.pending[this.pending.length - 1];
      if (candidate.priority <= (lowest?.priority ?? 0)) {
        return this._reject("pending_full", { max: this.maxPending });
      }
      // Evict the lowest priority task
      const evicted = this.pending.pop();
      evicted.status = TASK_STATUS.SKIPPED;
      evicted.lastOutcome = "evicted";
      evicted.lastReason = "evicted_by_higher_priority";
      this._addToHistory(evicted);
      this._recordEvent("evicted", evicted);
    }

    candidate.status = TASK_STATUS.PENDING;
    this.pending.push(candidate);
    this._sortPending();
    this._recordEvent("enqueued", candidate);

    // Check preemption: new S/A task can interrupt current B/C/D task
    if (this.current && this._canPreempt(candidate, this.current)) {
      this._preemptCurrent(candidate);
    }

    return { accepted: true, treeId: candidate.id, taskType: candidate.taskType, priority: candidate.priority, status: "pending" };
  }

  /**
   * Accept a full plan from Smart Brain and enqueue all trees.
   */
  enqueuePlan(plan = {}, metadata = {}) {
    if (!this.enabled) return this._reject("scheduler_disabled");

    const trees = Array.isArray(plan.behaviorTrees) ? plan.behaviorTrees
      : (Array.isArray(plan.taskRequests) ? plan.taskRequests : []);
    if (!trees.length) return this._reject("empty_plan");

    const planId = metadata.sourcePlanId ?? plan.id ?? `plan-${nowMs()}`;
    const results = [];
    for (const treeInput of trees) {
      const taskType = treeInput.taskType ?? treeInput.type ?? treeInput;
      try {
        const tree = buildExecutableBehaviorTree(taskType, {
          ...treeInput,
          source: metadata.source ?? treeInput.source ?? "langgraph_planner",
          sourceAgent: treeInput.sourceAgent ?? treeInput.assignedAgent ?? null,
          sourcePlanId: planId,
          requestedBy: treeInput.requestedBy ?? treeInput.fromAgent ?? null,
          taskRequestId: treeInput.taskRequestId ?? treeInput.id ?? null,
          reason: treeInput.reason ?? null,
          constructorArgs: treeInput.constructorArgs ?? treeInput.arguments ?? treeInput.parameters ?? {},
        });
        results.push(this.enqueueTree(tree, { sourcePlanId: planId }));
      } catch (err) {
        results.push({ accepted: false, reason: "build_error", error: err.message });
      }
    }

    const accepted = results.filter((r) => r.accepted);
    if (!accepted.length) return this._reject("no_trees_accepted", { results });
    this._recordEvent("plan_accepted", { planId, accepted: accepted.length, total: trees.length });
    return { accepted: true, planId, taskCount: accepted.length, results };
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Get next task to execute. Returns the highest priority pending task.
   * If a preempted task exists and no higher priority tasks are pending, restores it.
   */
  dequeue() {
    // Restore preempted task if no higher-priority pending
    if (this.preempted) {
      const higherPending = this.pending.some((t) => this._canPreempt(t, { priority: this.preempted.priority }));
      if (!higherPending) {
        const restored = this.preempted;
        this.preempted = null;
        restored.status = TASK_STATUS.RESUMING;
        restored.lastReason = "resumed_after_preemption";
        this.current = restored;
        this._recordEvent("resumed", restored);
        return clone(restored);
      }
    }

    if (this.current) return null; // already executing

    const tree = this.pending.shift() ?? null;
    if (!tree) return null;

    tree.status = TASK_STATUS.RUNNING;
    tree.startedAt = nowIso();
    tree.attempts = (tree.attempts ?? 0) + 1;
    this.current = tree;
    this._recordEvent("started", tree);
    return clone(tree);
  }

  /**
   * Mark current task as done, pending next dequeue.
   */
  completeCurrent(outcome = TASK_STATUS.COMPLETED, details = {}) {
    if (!this.current) return null;
    const tree = this.current;
    tree.status = outcome;
    tree.completedAt = nowIso();
    tree.lastOutcome = outcome;
    tree.lastReason = details.reason ?? outcome;
    this._addToHistory(tree);
    this.current = null;
    this._recordEvent(outcome, tree, details);
    return clone(tree);
  }

  /**
   * Mark current task as failed with rich failure report.
   * Rich reports are accumulated for Planner feedback.
   */
  failCurrent(failureReport = {}) {
    if (!this.current) return null;
    const tree = this.current;

    // Build structured failure report
    const report = {
      treeId: tree.id,
      taskType: tree.taskType,
      source: tree.source,
      sourceAgent: tree.sourceAgent,
      sourcePlanId: tree.sourcePlanId,
      reason: failureReport.reason ?? "failed",
      detail: failureReport.detail ?? "",
      suggestion: failureReport.suggestion ?? "",
      context: failureReport.context ?? {},
      failedAt: nowIso(),
      attempt: tree.attempts ?? 1,
    };
    this.failureReports.unshift(report);
    this.failureReports = this.failureReports.slice(0, 24);

    // Retry logic
    const shouldRetry = (tree.attempts ?? 0) < this.maxRetries
      && !["invalid_position", "target_entity_gone", "inventory_full"].includes(failureReport.reason);

    if (shouldRetry) {
      tree.status = TASK_STATUS.RETRYING;
      tree.lastOutcome = "retrying";
      tree.lastReason = report.reason;
      tree.retryAfter = nowMs() + 2000; // 2s cooldown before retry
      this.current = null;
      // Re-enqueue at end of pending (lower effective priority on retry)
      this.pending.push(tree);
      this._sortPending();
      this._recordEvent("retrying", tree, report);
    } else {
      tree.status = TASK_STATUS.GAVE_UP;
      tree.lastOutcome = "gave_up";
      tree.lastReason = report.reason;
      tree.completedAt = nowIso();
      this._addToHistory(tree);
      this.current = null;
      this._recordEvent("gave_up", tree, report);
    }

    return { tree: clone(tree), report };
  }

  // ── Action monitoring integration ─────────────────────────────────────────

  /**
   * Create an ActionMonitor for the given action type.
   * Uses monitor spec from compiled action if available, otherwise defaults.
   */
  createMonitor(actionType, monitorSpec = null) {
    const spec = monitorSpec ?? DEFAULT_ACTION_MONITORS[actionType] ?? {
      metric: "time_elapsed",
      checkIntervalMs: 200,
      stallThresholdMs: 2000,
      minProgressPerCheck: 0,
    };
    return new ActionMonitor(spec);
  }

  /**
   * Create an ActionDiagnoser for the given compiled action.
   */
  createDiagnoser(compiledAction = {}, bot = null) {
    return new ActionDiagnoser(compiledAction.diagnose ?? [], bot);
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      enabled: this.enabled,
      currentTree: this.current ? this._summarize(this.current) : null,
      preemptedTree: this.preempted ? this._summarize(this.preempted) : null,
      pendingTrees: this.pending.map(this._summarize),
      history: this.history.map(this._summarize),
      failureReports: this.failureReports.slice(0, 12),
      lastEvent: this.lastEvent,
      trace: this.trace.slice(-20),
    };
  }

  getFailureReportsForPlanner() {
    // Only return reports since last planner call
    return this.failureReports.slice(0, 8).map((r) => ({
      taskType: r.taskType,
      reason: r.reason,
      detail: r.detail,
      suggestion: r.suggestion,
      context: r.context,
    }));
  }

  clearFailureReports() {
    this.failureReports = [];
  }

  hasStalledCurrent() {
    return this.current?.status === TASK_STATUS.RUNNING
      && this.current?.lastMonitorResult?.stalled === true;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _normalizeTree(tree, options = {}) {
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
    if (!candidate.id) candidate.id = `bt:${nowMs()}:${Math.random().toString(36).slice(2, 8)}:${candidate.taskType}`;
    candidate.createdAt = candidate.createdAt ?? nowIso();
    candidate.attempts = candidate.attempts ?? 0;
    return candidate;
  }

  _hasDuplicate(tree) {
    const key = treeKey(tree);
    if (this.current && treeKey(this.current) === key) return true;
    if (this.pending.some((t) => treeKey(t) === key)) return true;
    // Also check recent history (last 5) to prevent instant re-queue of failed tasks
    return this.history.slice(0, 5).some((t) => treeKey(t) === key && t.lastOutcome === "gave_up");
  }

  _sortPending() {
    this.pending.sort((a, b) => {
      const prioDiff = Number(b.priority) - Number(a.priority);
      if (prioDiff !== 0) return prioDiff;
      return Date.parse(a.createdAt) - Date.parse(b.createdAt);
    });
  }

  _canPreempt(newTree, current) {
    if (!current) return false;
    const newLevel = newTree.level ?? taskLevel(newTree.priority);
    const curLevel = current.level ?? taskLevel(current.priority ?? 0);
    // S-level can preempt non-S, A-level can preempt B/C/D
    if (newLevel === "S" && curLevel !== "S") return true;
    if (newLevel === "A" && !UNINTERRUPTIBLE_LEVELS.has(curLevel)) return true;
    // Priority gap check
    return (Number(newTree.priority) - Number(current.priority ?? 0)) >= PREEMPTION_GAP
      && PREEMPTIBLE_LEVELS.has(curLevel);
  }

  _preemptCurrent(newTree) {
    if (!this.current) return;
    const preempted = this.current;
    preempted.status = TASK_STATUS.PREEMPTED;
    preempted.preemptedBy = newTree.taskType;
    preempted.preemptedAt = nowIso();
    // Save action-level state if available
    if (preempted._actionState) {
      preempted._savedActionState = clone(preempted._actionState);
    }
    this.preempted = preempted;
    this.current = null;
    this._recordEvent("preempted", preempted, { by: newTree.taskType, byPriority: newTree.priority });
  }

  _addToHistory(tree) {
    this.history.unshift(tree);
    this.history = this.history.slice(0, this.maxHistory);
  }

  _recordEvent(type, tree, details = {}) {
    this.lastEvent = { type, task: tree?.taskType ?? null, treeId: tree?.id ?? null, priority: tree?.priority ?? null, at: nowIso(), details };
    this.trace.push({ ...this.lastEvent });
    this.trace = this.trace.slice(-50);
  }

  _reject(reason, details = {}) {
    this.lastEvent = { type: "rejected", reason, details, at: nowIso() };
    return { accepted: false, reason, details };
  }

  _summarize(tree) {
    if (!tree) return null;
    return {
      id: tree.id,
      taskType: tree.taskType,
      label: tree.label ?? TASK_LABELS[tree.taskType] ?? tree.taskType,
      priority: tree.priority,
      level: tree.level,
      status: tree.status,
      source: tree.source,
      sourceAgent: tree.sourceAgent,
      reason: tree.reason,
      constructorArgs: tree.constructorArgs ?? {},
      attempts: tree.attempts ?? 0,
      lastOutcome: tree.lastOutcome,
      lastReason: tree.lastReason,
      startedAt: tree.startedAt,
      completedAt: tree.completedAt,
      retryAfter: tree.retryAfter,
    };
  }
}

module.exports = {
  PriorityScheduler,
  ActionMonitor,
  ActionDiagnoser,
  TASK_STATUS,
  PREEMPTIBLE_LEVELS,
  UNINTERRUPTIBLE_LEVELS,
  DEFAULT_ACTION_MONITORS,
};
