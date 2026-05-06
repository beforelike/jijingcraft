const minecraftData = require("minecraft-data");
const { Movements, goals } = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");
const { AgentOrchestrator } = require("../agents/agentOrchestrator");
const { BehaviorExecutionQueue } = require("../behavior/behaviorExecutionQueue");
const { ExecutableBehaviorTreeRunner } = require("../behavior/executableBehaviorTree");
const { LlmTaskQueue } = require("../llm/taskQueue");
const { listAllowedTasks } = require("../knowledge/survivalSkills");
const { skillEnvelopeForDecision } = require("../knowledge/skillPlanner");
const { PriorityTaskQueue } = require("./priorityTaskQueue");
const {
  ADVANCED_MATERIAL_ITEMS,
  ADVANCED_ORE_BLOCKS,
  BED_ITEMS,
  AXES,
  CROP_BLOCKS,
  CROP_PLANT_ITEMS,
  DAMAGING_BLOCKS,
  DOOR_ITEMS,
  FOOD_ITEMS,
  FOOD_MOBS,
  HOES,
  HOSTILE_MOBS,
  LOG_BLOCKS,
  LOG_TO_PLANKS,
  PICKAXES,
  PLANK_ITEMS,
  PLANK_TO_DOOR,
  SHELTER_BLOCK_ITEMS,
  STONE_OR_BETTER_AXES,
  STONE_OR_BETTER_PICKAXES,
  STONE_OR_BETTER_WEAPONS,
  WATER_BLOCKS,
  WEAPONS,
  WOOL_ITEMS
} = require("./constants");
const { decideNextTask } = require("./decision");
const { countItems, firstInventoryItem, hasAny, inventoryFromBot } = require("./inventory");
const {
  CARDINAL_DIRECTIONS,
  createAscendingStairPlan,
  createDescendingStairPlan,
  normalizeCardinalDirection,
  sortMiningTargets
} = require("./miningPlan");
const {
  createEmergencyShelterDoorwayPlan,
  createEmergencyShelterPlan,
  createStarterShelterDoorwayPlan,
  createStarterShelterDoorwaySealPlan,
  createStarterShelterPlan
} = require("./shelterPlan");
const {
  createDefaultProgress,
  createDefaultSurvivalMemory,
  forgetKnownBlock,
  isLearningPositionAvoided,
  loadSurvivalMemory,
  rememberKnownBlock,
  recordLearningEvent,
  saveSurvivalMemory,
  updateProgressMemory
} = require("./memoryStore");
const { assessProgress, buildingMaterialCount } = require("./progress");
const { chooseHostileDamageResponse } = require("./threatResponse");
const { GoalNear, GoalLookAtBlock, GoalBlock, GoalFollow } = goals;
const DAMAGING_BLOCK_NAMES = new Set(DAMAGING_BLOCKS);
const WATER_BLOCK_NAMES = new Set(WATER_BLOCKS);
const AQUATIC_FOOD_MOBS = new Set(["salmon", "cod", "tropical_fish"]);
const HARD_SAFETY_TASKS = new Set(["escape_hazard", "escape_pit", "evade_hostiles", "defend_shelter", "defend_self", "eat_food", "recover_starvation"]);
const RULE_BOUND_QUEUE_TASKS = new Set([...HARD_SAFETY_TASKS, "wait_out_night", "hold_position"]);
const LLM_ADVISORY_ONLY_RULES = new Set(["escape_hazard", "escape_pit", "evade_hostiles", "defend_shelter", "defend_self"]);
const ALLOWED_FORCED_TASKS = new Set(listAllowedTasks());

class SurvivalController {
      // --- collect_wood 自适应重试状态 ---
      _collectWoodRetryState = {
        failCount: 0,
        lastTerrain: null,
        lastReset: 0
      };
      _collectWoodSearchRadii = [64, 64, 80, 96];
      _collectWoodTerrains = ["plains", "forest", "near_water", "any"];
      _collectWoodTerrainIdx = 0;
      _collectWoodRetryDecayMs = 180000; // 3分钟自动重置
    // --- hunt_food 不可达目标黑名单 ---
    _huntFoodUnreachableBlacklist = new Map(); // key: entity id, value: { name, pos, expiresAt }
    _huntFoodBlacklistDecayMs = 120000; // 2分钟自动衰减
    _huntFoodBlacklistMax = 8;
    _huntFoodLastUnreachable = null;
    _huntFoodSwitchCooldownMs = 3500;
    _huntFoodLastSwitchTime = 0;
  constructor(bot, config, logger, options = {}) {
    this.bot = bot;
    this.config = config;
    this.logger = logger;
    this.statusReporter = options.statusReporter ?? null;
    this.llmPlanner = options.llmPlanner ?? null;
    this.taskQueue = options.taskQueue ?? new LlmTaskQueue(this.config.llm ?? {});
    this.behaviorQueue = options.behaviorQueue ?? new BehaviorExecutionQueue(this.config.behaviorTrees ?? {});
    this.behaviorTreeRunner = options.behaviorTreeRunner ?? new ExecutableBehaviorTreeRunner();
    this.agentOrchestrator = options.agentOrchestrator ?? new AgentOrchestrator(this.config.agents ?? {});
    this.agentStatus = this.agentOrchestrator?.getStatus?.() ?? null;
    this.priorityTaskQueue = options.priorityTaskQueue ?? new PriorityTaskQueue();
    this.testTaskQueue = options.testTaskQueue ?? new PriorityTaskQueue();
    this.mcData = null;
    this.movements = null;
    this.loop = null;
    this.busy = false;
    this.emergencyBusy = false;
    this.pausedUntil = 0;
    this.invalidPositionTicks = 0;
    this.memory = config.memory?.enabled === false
      ? createDefaultSurvivalMemory()
      : loadSurvivalMemory(config.memory.filePath, logger);
    this.progressState = {
      ...createDefaultProgress(),
      ...this.memory.progress,
      achievedMilestones: Array.isArray(this.memory.progress?.achievedMilestones)
        ? [...this.memory.progress.achievedMilestones]
        : []
    };
    this.loggedProgressMilestones = new Set();
    this.lastProgressStage = null;
    this.handleHealthChange = null;
    this.lastHealth = null;
    this.lastValidPosition = null;
    this.lastSafeStandPosition = null;
    this.lastAction = null;
    this.lastPublishContext = null;
    this.busyWatchdogLastWarnAt = 0;
    this.currentDecisionType = null;
    this.forcedTask = null;
    this.taskTrace = null;
    this.taskTraceSequence = 0;
    this.taskFeedback = {
      recentFailures: [],
      blockedTasks: {},
      lastEvent: null
    };
    this.actionInterruptedUntil = 0;
    this.surfaceStoneSearchAttempts = 0;
    this.hazardEscapeBusy = false;
    this.emergencyShelterExitBusy = false;
    this.explorationHistory = [];
  }

  start() {
    this.mcData = minecraftData(this.bot.version);
    const movements = new Movements(this.bot, this.mcData);
    this.configureMovementPolicy(movements);
    this.bot.pathfinder.setMovements(movements);
    this.movements = movements;

    this.lastHealth = this.bot.health ?? 20;
    this.handleHealthChange = () => {
      const currentHealth = this.bot.health ?? 20;
      const previousHealth = this.lastHealth ?? currentHealth;
      this.lastHealth = currentHealth;
      if (currentHealth >= previousHealth) return;
      this.handleEmergencyDamage(previousHealth, currentHealth).catch((error) => this.logger.debug("emergency damage handler failed", error.message));
    };
    this.bot.on("health", this.handleHealthChange);

    this.logger.info(`survival controller started on ${this.config.host}:${this.config.port} as ${this.config.username}`);
    if (this.config.memory?.enabled !== false) {
      this.logger.info(`survival memory loaded from ${this.config.memory.filePath}`);
    }
    this.loop = setInterval(() => this.tick().catch((error) => this.logger.error("control tick failed", error)), this.config.controlIntervalMs);
    this.tick().catch((error) => this.logger.error("initial control tick failed", error));
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    if (this.handleHealthChange) this.bot.off("health", this.handleHealthChange);
    this.persistMemory();
    this.loop = null;
    this.handleHealthChange = null;
  }

  setForcedTask(taskType, options = {}) {
    if (!ALLOWED_FORCED_TASKS.has(taskType)) {
      throw new Error(`unknown forced task: ${taskType}`);
    }
    const ttlMs = Math.max(1000, Math.min(Number(options.ttlMs) || 60000, 300000));
    this.forcedTask = {
      taskType,
      reason: options.reason || "scenario test override",
      source: options.source || "test_control",
      expiresAt: Date.now() + ttlMs,
      ttlMs
    };
    this.logger.warn(`test_control=force_task; task=${taskType}; ttlMs=${ttlMs}; reason=${this.forcedTask.reason}`);
    return this.getForcedTask();
  }

  clearForcedTask(reason = "cleared") {
    const previous = this.forcedTask;
    this.forcedTask = null;
    if (previous) this.logger.warn(`test_control=clear_forced_task; task=${previous.taskType}; reason=${reason}`);
    return previous ? { ...previous } : null;
  }

  getForcedTask() {
    if (!this.forcedTask) return null;
    const remainingMs = this.forcedTask.expiresAt - Date.now();
    if (remainingMs <= 0) {
      this.clearForcedTask("expired");
      return null;
    }
    return { ...this.forcedTask, remainingMs };
  }

  applyForcedTask(ruleDecision, selectedDecision) {
    const forcedTask = this.getForcedTask();
    if (!forcedTask) return selectedDecision;
    if (HARD_SAFETY_TASKS.has(ruleDecision.type)) {
      this.logger.warn(`test_control=force_task_suppressed; forced=${forcedTask.taskType}; safety=${ruleDecision.type}`);
      return ruleDecision;
    }

    return {
      type: forcedTask.taskType,
      reason: `forced test task: ${forcedTask.reason}; rule=${ruleDecision.type}`,
      forced: true,
      source: forcedTask.source,
      originalDecision: selectedDecision.type,
      ruleDecision: ruleDecision.type
    };
  }

  insertPriorityTask(taskType, options = {}) {
    const task = this.priorityTaskQueue.insert(taskType, options);
    this.logger.warn(`task_queue=insert_priority; task=${task.type}; priority=${task.priority}; source=${task.source}; reason=${task.reason}`);
    return task;
  }

  clearPriorityTasks(reason = "cleared") {
    const event = this.priorityTaskQueue.clear(reason);
    this.logger.warn(`task_queue=clear_priority; reason=${reason}; removed=${event.removed}`);
    return event;
  }

  getPriorityTaskStatus() {
    return this.priorityTaskQueue.getStatus();
  }

  insertTestTask(taskType, options = {}) {
    const task = this.testTaskQueue.insert(taskType, {
      ...options,
      source: options.source || "test_pipeline"
    });
    this.logger.warn(`task_pipeline=insert_test; task=${task.type}; source=${task.source}; reason=${task.reason}`);
    return task;
  }

  clearTestTasks(reason = "cleared") {
    const event = this.testTaskQueue.clear(reason);
    this.logger.warn(`task_pipeline=clear_test; reason=${reason}; removed=${event.removed}`);
    return event;
  }

  getTestTaskStatus() {
    return this.testTaskQueue.getStatus();
  }

  getBehaviorQueueStatus() {
    return this.behaviorQueue?.getStatus?.() ?? null;
  }

  getAgentStatus() {
    return this.agentOrchestrator?.getStatus?.() ?? this.agentStatus ?? null;
  }

  enqueueBehaviorTreeProposal(proposal) {
    if (!proposal?.tree || !this.behaviorQueue?.enabled) return null;
    const result = this.behaviorQueue.enqueueTree(proposal.tree);
    if (result.accepted) {
      this.logger.warn(`behavior_tree_queue=insert; task=${result.taskType}; priority=${result.priority}; source=${proposal.tree.source}; agent=${proposal.tree.sourceAgent ?? "none"}`);
    } else if (result.reason !== "duplicate_behavior_tree") {
      this.logger.warn(`behavior_tree_queue=reject; task=${proposal.tree.taskType}; reason=${result.reason}`);
    }
    return result;
  }

  runAgentOrchestration(context = {}) {
    if (!this.agentOrchestrator?.tick) return null;
    const result = this.agentOrchestrator.tick({
      ...context,
      behaviorQueue: this.behaviorQueue
    });
    this.agentStatus = result.status;
    for (const proposal of result.proposals ?? []) this.enqueueBehaviorTreeProposal(proposal);
    return result;
  }

  resetRuntimeState(options = {}) {
    const interruptMs = Math.max(0, Math.min(options.interruptMs === undefined ? 3000 : Number(options.interruptMs), 30000));
    const pauseMs = Math.max(0, Math.min(options.pauseMs === undefined ? 0 : Number(options.pauseMs), 300000));
    if (interruptMs > 0) this.markCurrentActionInterrupted(interruptMs);
    if (options.releasePause) this.pausedUntil = 0;
    else if (pauseMs > 0) this.pause(pauseMs);
    this.resetMotion();
    if (options.clearForcedTask !== false) this.clearForcedTask("runtime_reset");
    if (options.clearTestTasks !== false) this.clearTestTasks("runtime_reset");
    if (options.clearPriorityTasks !== false) this.clearPriorityTasks("runtime_reset");
    if (options.clearLlmQueue && this.taskQueue?.clear) {
      this.taskQueue.clear("runtime_reset");
      this.publishTaskQueueStatus();
    }
    if (options.clearBehaviorQueue !== false && this.behaviorQueue?.clear) {
      this.behaviorQueue.clear("runtime_reset");
    }
    if (options.resetMemory !== false) {
      this.memory = createDefaultSurvivalMemory();
      this.progressState = createDefaultProgress();
      this.loggedProgressMilestones = new Set();
      this.lastProgressStage = null;
      this.persistMemory();
    }
    this.invalidPositionTicks = 0;
    this.lastAction = null;
    this.taskTrace = null;
    this.hazardEscapeBusy = false;
    this.currentDecisionType = null;
    if (interruptMs > 0) this.actionInterruptedUntil = Math.max(this.actionInterruptedUntil ?? 0, Date.now() + interruptMs);
    this.surfaceStoneSearchAttempts = 0;
    this.emergencyShelterExitBusy = false;
    this.logger.warn(`test_control=reset_runtime_state; resetMemory=${options.resetMemory !== false}; pauseMs=${pauseMs}; interruptMs=${interruptMs}; releasePause=${Boolean(options.releasePause)}`);
    return {
      ok: true,
      resetMemory: options.resetMemory !== false,
      pauseMs,
      interruptMs,
      released: Boolean(options.releasePause),
      forcedTask: this.getForcedTask(),
      testTasks: this.getTestTaskStatus(),
      priorityTasks: this.getPriorityTaskStatus(),
      behaviorQueue: this.getBehaviorQueueStatus(),
      agents: this.getAgentStatus()
    };
  }

  configureMovementPolicy(movements) {
    movements.canDig = false;
    movements.canOpenDoors = true;
    movements.allowSprinting = false;
    movements.allow1by1towers = false;
    this.configureMovementAvoidance(movements);
    this.configureDoorMovement(movements);
  }

  configureMovementAvoidance(movements) {
    for (const blockName of DAMAGING_BLOCKS) {
      const block = this.mcData.blocksByName[blockName];
      if (block) movements.blocksToAvoid.add(block.id);
    }
    for (const blockName of WATER_BLOCKS) {
      const block = this.mcData.blocksByName[blockName];
      if (block) movements.blocksToAvoid.add(block.id);
    }

    movements.exclusionAreasStep.push((block) => (block && DAMAGING_BLOCK_NAMES.has(block.name) ? 100 : 0));
    movements.exclusionAreasStep.push((block) => (block && WATER_BLOCK_NAMES.has(block.name) ? 80 : 0));
    movements.exclusionAreasBreak.push((block) => (block && DAMAGING_BLOCK_NAMES.has(block.name) ? 100 : 0));
    movements.exclusionAreasBreak.push((block) => (this.isDoorBlock(block) ? 100 : 0));
  }

  configureDoorMovement(movements) {
    if (!this.mcData?.blocksByName) return;
    for (const block of Object.values(this.mcData.blocksByName)) {
      if (!block?.name?.endsWith("_door")) continue;
      movements.blocksCantBreak?.add?.(block.id);
      movements.interactableBlocks?.add?.(block.name);
    }
  }

  currentDimension() {
    return this.bot.game?.dimension || this.bot.game?.dimensionName || "unknown";
  }

  persistMemory() {
    if (this.config.memory?.enabled === false) return false;
    updateProgressMemory(this.memory, this.progressState);
    return saveSurvivalMemory(this.config.memory.filePath, this.memory, this.logger);
  }

  startTaskTrace(decision, skillEnvelope, snapshot) {
    const now = new Date().toISOString();
    this.taskTrace = {
      id: `${Date.now()}-${++this.taskTraceSequence}`,
      taskType: decision?.type ?? "unknown",
      skillId: skillEnvelope?.primarySkillId ?? null,
      status: "running",
      reason: decision?.reason ?? null,
      target: decision?.target ?? null,
      startedAt: now,
      updatedAt: now,
      activePhaseId: null,
      activePhaseLabel: null,
      phaseEvents: [],
      observations: []
    };
    this.recordTaskObservation("decision", `selected ${this.taskTrace.taskType}`, {
      reason: decision?.reason ?? null,
      position: snapshot?.position ?? null,
      health: snapshot?.health ?? null,
      food: snapshot?.food ?? null
    });
  }

  publishTaskTrace() {
    this.statusReporter?.setTaskTrace?.(this.taskTrace);
  }

  buildControllerState() {
    return {
      busy: this.busy,
      emergencyBusy: this.emergencyBusy,
      pausedUntil: this.pausedUntil,
      invalidPositionTicks: this.invalidPositionTicks,
      lastAction: this.lastAction,
      taskTrace: this.taskTrace,
      forcedTask: this.getForcedTask(),
      taskFeedback: this.getTaskFeedbackStatus(),
      testTasks: this.getTestTaskStatus(),
      priorityTasks: this.getPriorityTaskStatus(),
      behaviorQueue: this.getBehaviorQueueStatus(),
      agents: this.getAgentStatus()
    };
  }

  publishControllerState(context = this.lastPublishContext) {
    if (!context?.snapshot || !this.statusReporter?.publishTick) return;
    this.statusReporter.publishTick({
      snapshot: context.snapshot,
      decision: context.decision,
      skillEnvelope: context.skillEnvelope,
      progress: context.progress,
      memory: this.memory,
      dimension: context.dimension ?? this.currentDimension(),
      controller: this.buildControllerState()
    });
  }

  checkBusyWatchdog() {
    this.publishControllerState();
    if (this.emergencyBusy || !this.taskTrace) return false;
    const now = Date.now();
    const updatedAt = Date.parse(this.taskTrace.updatedAt ?? "");
    const traceAgeMs = Number.isFinite(updatedAt) ? now - updatedAt : 0;
    const actionAgeMs = Number.isFinite(Number(this.lastAction?.startedAt)) ? now - Number(this.lastAction.startedAt) : 0;
    const staleMs = Math.max(15000, Number(this.config.survival?.busyTraceStaleMs ?? 25000));
    const terminalTraceStale = this.taskTrace.status !== "running" && traceAgeMs > 3000;
    const runningTraceStale = this.taskTrace.status === "running" && traceAgeMs > staleMs && actionAgeMs > staleMs;
    if (!terminalTraceStale && !runningTraceStale) return false;
    if (now - this.busyWatchdogLastWarnAt < Math.max(3000, Math.floor(staleMs / 2))) return true;

    this.busyWatchdogLastWarnAt = now;
    const reason = terminalTraceStale ? `terminal_trace_${this.taskTrace.status}` : "busy_trace_stale";
    this.logger.warn(`control_watchdog=${reason}; task=${this.taskTrace.taskType}; traceAgeMs=${traceAgeMs}; actionAgeMs=${actionAgeMs}`);
    this.recordTaskObservation("watchdog", "controller busy watchdog interrupted stale action", {
      reason,
      traceAgeMs,
      actionAgeMs,
      currentTree: this.behaviorQueue?.current?.taskType ?? null
    }, "warn");
    this.markCurrentActionInterrupted(3000);
    this.resetMotion();
    if (terminalTraceStale) this.releaseCurrentQueuedWork(reason, { traceStatus: this.taskTrace.status, ruleDecision: this.currentDecisionType ?? "unknown" });
    this.publishControllerState();
    return true;
  }

  releaseCurrentQueuedWork(reason = "runtime_interrupted", details = {}) {
    let released = false;
    if (this.behaviorQueue?.current) {
      const failedTree = this.behaviorQueue.failCurrent(reason, details);
      if (failedTree) {
        this.reportBehaviorTreeFeedback({ behaviorTree: failedTree }, "failed", reason);
        this.logger.warn(`behavior_tree_queue=release_current; task=${failedTree.taskType}; reason=${reason}`);
        released = true;
      }
    }
    if (this.taskQueue?.current) {
      this.taskQueue.failCurrent(reason, details);
      this.publishTaskQueueStatus();
      released = true;
    }
    return released;
  }

  markTaskPhase(id, label, status = "active", details = {}) {
    if (!this.taskTrace || !id) return;
    const now = new Date().toISOString();
    const movesActivePhase = ["active", "completed", "failed", "risk"].includes(status);
    if (movesActivePhase && this.taskTrace.activePhaseId && this.taskTrace.activePhaseId !== id) {
      const previous = this.taskTrace.phaseEvents.find((event) => event.id === this.taskTrace.activePhaseId && event.status === "active");
      if (previous) {
        previous.status = "completed";
        previous.at = now;
      }
    }

    const existing = this.taskTrace.phaseEvents.find((event) => event.id === id);
    const event = {
      id,
      label: label ?? id,
      status,
      at: now,
      details
    };
    if (existing) Object.assign(existing, event);
    else this.taskTrace.phaseEvents.push(event);

    if (movesActivePhase) {
      this.taskTrace.activePhaseId = id;
      this.taskTrace.activePhaseLabel = label ?? id;
    }
    this.taskTrace.updatedAt = now;
    this.publishTaskTrace();
  }

  recordTaskObservation(kind, message, details = {}, level = "info") {
    if (!this.taskTrace) return;
    this.taskTrace.observations.push({
      at: new Date().toISOString(),
      level,
      kind,
      message,
      details
    });
    this.taskTrace.observations = this.taskTrace.observations.slice(-120);
    this.taskTrace.updatedAt = new Date().toISOString();
    this.publishTaskTrace();
  }

  finishTaskTrace(status = "completed", details = {}) {
    if (!this.taskTrace) return;
    const now = new Date().toISOString();
    if (this.taskTrace.activePhaseId) {
      const active = this.taskTrace.phaseEvents.find((event) => event.id === this.taskTrace.activePhaseId && event.status === "active");
      if (active) {
        active.status = status === "completed" ? "completed" : "failed";
        active.at = now;
        active.details = { ...active.details, ...details };
      }
    }
    this.taskTrace.status = status;
    this.taskTrace.updatedAt = now;
    if (Object.keys(details).length > 0) this.recordTaskObservation("result", status, details, status === "failed" ? "error" : "info");
    this.publishTaskTrace();
  }

  rememberBlock(blockName, position) {
    const changed = rememberKnownBlock(this.memory, blockName, position, this.currentDimension());
    if (changed) {
      this.logger.info(`memory=remember_block; block=${blockName}; pos=${this.formatPosition(position)}`);
      this.persistMemory();
    }
    return changed;
  }

  forgetBlock(blockName, position) {
    const changed = forgetKnownBlock(this.memory, blockName, position, this.currentDimension());
    if (changed) {
      this.logger.warn(`memory=forget_block; block=${blockName}; pos=${this.formatPosition(position)}`);
      this.persistMemory();
    }
    return changed;
  }

  recordTaskResultToMapMemory(decision = {}) {
    if (!this.bot?.findBlocks || !this.mcData?.blocksByName || !this.hasValidPosition(this.bot.entity?.position)) return [];
    const memoryTasks = new Set(["explore", "collect_wood", "hunt_food", "collect_stone", "collect_building_materials"]);
    if (!memoryTasks.has(decision.type)) return [];
    const blockNames = [
      ...LOG_BLOCKS,
      "sweet_berry_bush",
      "stone",
      "cobblestone",
      "coal_ore",
      "iron_ore"
    ].filter((blockName) => this.mcData.blocksByName[blockName]);
    const blockIds = blockNames.map((blockName) => this.mcData.blocksByName[blockName].id);
    if (!blockIds.length) return [];

    let positions = [];
    try {
      positions = this.bot.findBlocks({ matching: blockIds, maxDistance: 32, count: 24 }) ?? [];
    } catch (error) {
      this.logger.debug?.(`map memory scan skipped: ${error.message}`);
      return [];
    }
    const remembered = [];
    const seen = new Set();
    for (const position of positions) {
      const block = this.bot.blockAt?.(position);
      if (!block?.name || !blockNames.includes(block.name)) continue;
      const key = `${block.name}:${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.rememberBlock(block.name, block.position);
      remembered.push({ name: block.name, position: this.feedbackPosition(block.position) });
    }

    if (remembered.length) {
      this.recordTaskObservation("map_memory", "task result saved nearby resources", {
        taskType: decision.type,
        remembered: remembered.slice(0, 8)
      });
      this.agentOrchestrator?.recordFeedback?.({
        taskType: decision.type,
        outcome: "map_memory_updated",
        reason: `remembered_${remembered.length}_nearby_blocks`,
        sourceAgent: decision.sourceAgent ?? null,
        sourcePlanId: decision.sourcePlanId ?? null
      });
    }
    return remembered;
  }

  findResourceBlockPositions(blockNames = [], maxDistance = 32, count = 12) {
    if (!this.mcData?.blocksByName || !this.bot?.findBlocks) return [];
    const blockIds = blockNames
      .map((blockName) => this.mcData.blocksByName[blockName]?.id)
      .filter((id) => id !== undefined);
    if (!blockIds.length) return [];
    try {
      return this.bot.findBlocks({ matching: blockIds, maxDistance, count }) ?? [];
    } catch (error) {
      this.logger.debug?.(`resource block scan skipped: ${error.message}`);
      return [];
    }
  }

  summarizeResourceBlocks(blockNames = [], maxDistance = 32, count = 12, filter = null) {
    const positions = this.findResourceBlockPositions(blockNames, maxDistance, count);
    const resources = [];
    for (const position of positions) {
      const block = this.bot.blockAt?.(position);
      if (!block?.name || !blockNames.includes(block.name)) continue;
      if (filter && !filter(block)) continue;
      resources.push({ name: block.name, position: this.feedbackPosition(block.position ?? position) });
    }
    return resources;
  }

  buildLocalTerrainSnapshot(position = this.bot.entity?.position) {
    if (!this.hasValidPosition(position) || typeof this.bot?.blockAt !== "function") return null;
    const base = position.floored();
    const groundCounts = new Map();
    let safeStandCount = 0;
    let waterCount = 0;
    let damagingCount = 0;

    for (let x = -6; x <= 6; x += 2) {
      for (let z = -6; z <= 6; z += 2) {
        const stand = base.offset(x, 0, z);
        const ground = this.bot.blockAt(stand.offset(0, -1, 0));
        if (ground?.name) groundCounts.set(ground.name, (groundCounts.get(ground.name) ?? 0) + 1);
        const feet = this.bot.blockAt(stand);
        if (this.isWaterBlock(feet) || this.isWaterBlock(ground)) waterCount++;
        if (this.isDamagingBlock(feet) || this.isDamagingBlock(ground)) damagingCount++;
        if (this.isSafeStandPosition(stand) && !this.findNearbyDamagingBlock(stand, 1.2)) safeStandCount++;
      }
    }

    const ground = [...groundCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      .slice(0, 8);
    const matureBerryBushes = this.summarizeResourceBlocks(["sweet_berry_bush"], this.config.survival.foodSearchRadius ?? 48, 12, (block) => this.isMatureBerryBush(block));
    const nearbyLogs = this.summarizeResourceBlocks(LOG_BLOCKS, 48, 12);
    const nearbyWater = this.summarizeResourceBlocks(WATER_BLOCKS, 48, 12);

    return {
      sampleRadius: 6,
      primaryGround: ground[0]?.name ?? null,
      ground,
      safeStandCount,
      waterSamples: waterCount,
      damagingSamples: damagingCount,
      nearbyWater: nearbyWater.slice(0, 6),
      matureBerryBushes: matureBerryBushes.slice(0, 6),
      nearbyLogs: nearbyLogs.slice(0, 6)
    };
  }

  recordActionFailure(action, reason, position = this.bot.entity?.position, details = {}) {
    const changed = recordLearningEvent(this.memory, {
      action,
      target: details.target,
      reason,
      outcome: "failure",
      position,
      dimension: this.currentDimension(),
      radius: details.radius
    });
    if (changed) {
      this.logger.warn(`learning=failure; action=${action}; target=${details.target ?? "default"}; reason=${reason}; pos=${this.formatPosition(position)}`);
      this.persistMemory();
    }
    if (details.taskFeedback !== false) this.recordTaskFeedbackFailure(action, reason, position, details);
  }

  recordActionSuccess(action, position = this.bot.entity?.position, details = {}) {
    const changed = recordLearningEvent(this.memory, {
      action,
      target: details.target,
      reason: "success",
      outcome: "success",
      position,
      dimension: this.currentDimension(),
      radius: details.radius
    });
    if (changed) this.persistMemory();
    this.recordTaskFeedbackSuccess(action, details);
  }

  recordTaskFeedbackFailure(action, reason, position = this.bot.entity?.position, details = {}) {
    const taskType = details.taskType ?? this.currentDecisionType ?? action;
    if (!taskType) return;
    const at = new Date().toISOString();
    const event = {
      taskType,
      action,
      reason,
      target: details.target ?? null,
      position: this.feedbackPosition(position),
      at
    };
    this.taskFeedback.recentFailures.unshift(event);
    this.taskFeedback.recentFailures = this.taskFeedback.recentFailures.slice(0, 24);
    this.taskFeedback.lastEvent = { type: "failure", ...event };

    const blockPolicy = this.taskFeedbackBlockPolicy(taskType);
    const recentFailures = this.recentFailureCountForTask(taskType, blockPolicy.windowMs, { reason, action });
    if (recentFailures >= blockPolicy.threshold && !HARD_SAFETY_TASKS.has(taskType) && this.isTaskFeedbackBlockableFailure(action, reason, details)) {
      const recoveryTasks = this.recoveryTasksForBlockedTask(taskType);
      this.taskFeedback.blockedTasks[taskType] = {
        taskType,
        reason,
        failureCount: recentFailures,
        lastAction: action,
        lastTarget: details.target ?? null,
        recoveryTasks,
        blockedAt: at,
        expiresAt: new Date(Date.now() + blockPolicy.durationMs).toISOString()
      };
      this.logger.warn(`task_feedback=blocked; task=${taskType}; failures=${recentFailures}; threshold=${blockPolicy.threshold}; durationMs=${blockPolicy.durationMs}; reason=${reason}; recovery=${recoveryTasks.join(",") || "none"}`);
    }
  }

  recordTaskFeedbackSuccess(action, details = {}) {
    const taskType = details.taskType ?? this.currentDecisionType ?? action;
    if (!taskType) return;
    if (this.taskFeedback.blockedTasks[taskType]) {
      delete this.taskFeedback.blockedTasks[taskType];
      this.logger.info(`task_feedback=unblocked; task=${taskType}; reason=success`);
    }
    this.taskFeedback.recentFailures = this.taskFeedback.recentFailures.filter((event) => event.taskType !== taskType);
    this.taskFeedback.lastEvent = { type: "success", taskType, action, target: details.target ?? null, at: new Date().toISOString() };
  }

  recordTaskFeedbackRecoverySuccess(blockedTaskType, recoveryTaskType, details = {}) {
    this.pruneTaskFeedback();
    const blockedTask = this.taskFeedback.blockedTasks[blockedTaskType];
    if (!blockedTask || !recoveryTaskType) return false;
    const recoveryTasks = Array.isArray(blockedTask.recoveryTasks) ? blockedTask.recoveryTasks : [];
    if (recoveryTasks.length && !recoveryTasks.includes(recoveryTaskType)) return false;

    delete this.taskFeedback.blockedTasks[blockedTaskType];
    this.taskFeedback.recentFailures = this.taskFeedback.recentFailures.filter((event) => event.taskType !== blockedTaskType);
    this.taskFeedback.lastEvent = {
      type: "recovery_success",
      taskType: blockedTaskType,
      recoveryTask: recoveryTaskType,
      reason: details.reason ?? "recovery_completed",
      at: new Date().toISOString()
    };
    this.logger.info(`task_feedback=unblocked; task=${blockedTaskType}; recovery=${recoveryTaskType}; reason=recovery_success`);
    return true;
  }

  feedbackPosition(position) {
    if (!this.hasValidPosition(position)) return null;
    return {
      x: Math.round(Number(position.x) * 10) / 10,
      y: Math.round(Number(position.y) * 10) / 10,
      z: Math.round(Number(position.z) * 10) / 10
    };
  }

  taskParametersFromDecision(decision = {}) {
    const parameters = {};
    for (const source of [
      decision.behaviorTree?.constructorArgs,
      decision.behaviorTree?.parameters,
      decision.constructorArgs,
      decision.parameters,
      decision.taskParameters
    ]) {
      if (source && typeof source === "object" && !Array.isArray(source)) Object.assign(parameters, source);
    }
    for (const key of ["area", "radius", "range", "target", "targetPosition", "position", "count", "quantity", "targetCount", "tool", "mode", "allowNight", "searchRadius", "preferredTerrain"]) {
      if (decision[key] !== undefined && parameters[key] === undefined) parameters[key] = decision[key];
    }
    return parameters;
  }

  countFromDecision(decision = {}, fallback = null) {
    const parameters = this.taskParametersFromDecision(decision);
    const value = decision.targetCount ?? decision.count ?? parameters.count ?? parameters.quantity ?? parameters.targetCount;
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? count : fallback;
  }

  targetPositionFromDecision(decision = {}) {
    const parameters = this.taskParametersFromDecision(decision);
    const raw = decision.targetPosition ?? decision.target ?? decision.position ?? parameters.targetPosition ?? parameters.target ?? parameters.position;
    if (!raw || typeof raw !== "object") return null;
    const position = new Vec3(Number(raw.x), Number(raw.y), Number(raw.z));
    return this.hasValidPosition(position) ? position : null;
  }

  pruneTaskFeedback(now = Date.now()) {
    for (const [taskType, blocked] of Object.entries(this.taskFeedback.blockedTasks)) {
      const expiresAt = Date.parse(blocked.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now) delete this.taskFeedback.blockedTasks[taskType];
    }
  }

  recentFailureCountForTask(taskType, windowMs = 120000, filter = {}) {
    const now = Date.now();
    return this.taskFeedback.recentFailures.filter((event) => {
      const eventAt = Date.parse(event.at);
      if (event.taskType !== taskType || !Number.isFinite(eventAt) || now - eventAt > windowMs) return false;
      if (filter.reason && event.reason !== filter.reason) return false;
      if (filter.action && event.action !== filter.action) return false;
      return true;
    }).length;
  }

  isTaskFeedbackBlockableFailure(action, reason, details = {}) {
    if (details.taskFeedback === false) return false;
    if (!reason) return true;
    if (/interrupted|low_oxygen|emergency|hazard_escape|position_recovery/i.test(reason)) return false;
    if (/escape|panic|retreat/i.test(action ?? "")) return false;
    return true;
  }

  taskFeedbackBlockPolicy(taskType) {
    if (taskType === "collect_wood") return { threshold: 4, windowMs: 180000, durationMs: 45000 };
    if (taskType === "hunt_food") return { threshold: 3, windowMs: 120000, durationMs: 30000 };
    if (["collect_stone", "collect_building_materials", "collect_wool", "mine_advanced_materials"].includes(taskType)) {
      return { threshold: 3, windowMs: 120000, durationMs: 45000 };
    }
    return { threshold: 3, windowMs: 120000, durationMs: 60000 };
  }

  isTaskFeedbackBlocked(taskType) {
    this.pruneTaskFeedback();
    return Boolean(taskType && this.taskFeedback.blockedTasks[taskType]);
  }

  recoveryTasksForBlockedTask(taskType) {
    if (taskType === "hunt_food") return ["explore"];
    if (taskType === "collect_wood") return ["explore"];
    if (["collect_stone", "collect_building_materials", "collect_wool", "mine_advanced_materials"].includes(taskType)) return ["explore", "collect_wood"];
    if (["craft_basic_supplies", "craft_basic_tools", "craft_stone_tools", "craft_furnace", "craft_weapon"].includes(taskType)) return ["explore", "collect_wood", "collect_stone"];
    return ["explore"];
  }

  getTaskFeedbackStatus() {
    this.pruneTaskFeedback();
    return {
      recentFailures: this.taskFeedback.recentFailures.slice(0, 12),
      blockedTasks: Object.values(this.taskFeedback.blockedTasks),
      lastEvent: this.taskFeedback.lastEvent ? { ...this.taskFeedback.lastEvent } : null
    };
  }

  isLearnedAvoidPosition(position, action, target = null) {
    return isLearningPositionAvoided(this.memory, position, {
      action,
      target,
      dimension: this.currentDimension()
    });
  }

  isLearningPolicyCoolingDown(action, target = null, now = Date.now()) {
    const key = `${action}:${target || "default"}`;
    const cooldownUntil = this.memory?.learning?.policyStats?.[key]?.cooldownUntil;
    const cooldownAt = Date.parse(cooldownUntil ?? "");
    return Number.isFinite(cooldownAt) && cooldownAt > now;
  }

  refreshKnownCraftingTables(position) {
    if (!this.mcData || !this.hasValidPosition(position)) return;
    const craftingTableId = this.mcData.blocksByName.crafting_table?.id;
    if (craftingTableId === undefined) return;

    const tablePositions = this.bot.findBlocks({ matching: craftingTableId, maxDistance: 32, count: 8 });
    let changed = false;
    for (const tablePosition of tablePositions) {
      changed = rememberKnownBlock(this.memory, "crafting_table", tablePosition, this.currentDimension()) || changed;
    }
    this.progressState.hasCraftingTable = this.hasCraftingTableAccess(position);
    if (changed) this.persistMemory();
  }

  hasCraftingTableAccess(position = this.bot.entity?.position) {
    if (firstInventoryItem(this.bot, "crafting_table")) return true;
    if (!this.hasValidPosition(position)) return false;

    const nearbyTable = this.findNearbyBlock("crafting_table", 12);
    if (nearbyTable) return true;

    const nearbyKnownTable = this.nearestKnownBlockEntry("crafting_table", position, 12);
    if (!nearbyKnownTable) return false;

    const rememberedBlock = this.bot.blockAt(new Vec3(
      nearbyKnownTable.position.x,
      nearbyKnownTable.position.y,
      nearbyKnownTable.position.z
    ));
    return rememberedBlock?.name === "crafting_table";
  }

  nearestKnownBlockEntry(blockName, position, maxDistance) {
    if (!this.hasValidPosition(position)) return null;
    const entries = this.memory.knownBlocks?.[blockName] ?? [];
    const dimension = this.currentDimension();
    return entries
      .filter((entry) => entry.dimension === dimension && this.hasValidPosition(entry.position))
      .map((entry) => ({
        ...entry,
        distance: this.distanceBetweenPositions(entry.position, position)
      }))
      .filter((entry) => entry.distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance)[0] ?? null;
  }

  knownLogTargets(position = this.bot.entity?.position, maxDistance = 128, excludedKeys = new Set()) {
    if (!this.hasValidPosition(position)) return [];
    if (this.isLearningPolicyCoolingDown("collect_wood_known_log", "known_log_area")) return [];
    const dimension = this.currentDimension();
    const bestByColumn = new Map();
    for (const blockName of LOG_BLOCKS) {
      for (const entry of this.memory.knownBlocks?.[blockName] ?? []) {
        if (entry.dimension !== dimension || !this.hasValidPosition(entry.position)) continue;
        const targetPosition = new Vec3(Number(entry.position.x), Number(entry.position.y), Number(entry.position.z));
        const key = `${blockName}:${Math.floor(targetPosition.x)},${Math.floor(targetPosition.z)}`;
        if (excludedKeys.has(key)) continue;
        if (this.isLearnedAvoidPosition(targetPosition, "collect_wood_known_log", "known_log_area")) continue;
        const distance = this.distanceBetweenPositions(targetPosition, position);
        if (distance > maxDistance) continue;
        const observedBlock = this.bot?.blockAt?.(targetPosition);
        if (observedBlock?.name === "air" && distance <= 32) {
          if (forgetKnownBlock(this.memory, blockName, targetPosition, dimension)) this.persistMemory();
          continue;
        }
        if (observedBlock?.name && observedBlock.name !== "air" && !LOG_BLOCKS.includes(observedBlock.name)) continue;
        const candidate = { ...entry, name: blockName, position: targetPosition, distance, key };
        const existing = bestByColumn.get(key);
        if (!existing || candidate.position.y < existing.position.y || (candidate.position.y === existing.position.y && candidate.distance < existing.distance)) {
          bestByColumn.set(key, candidate);
        }
      }
    }
    return [...bestByColumn.values()].sort((left, right) => left.distance - right.distance || left.position.y - right.position.y);
  }

  findNearbyBlock(blockName, maxDistance) {
    const blockId = this.mcData?.blocksByName[blockName]?.id;
    if (blockId === undefined) return null;
    return this.bot.findBlock({ matching: blockId, maxDistance });
  }

  async handleEmergencyDamage(previousHealth = this.lastHealth, currentHealth = this.bot.health ?? 20) {
    if (this.emergencyBusy || !this.bot.entity || !this.hasValidPosition(this.bot.entity.position)) return;
    const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.5);
    const nearbyHazard = hazard ?? this.findNearbyDamagingBlockLoose(this.bot.entity.position, 2.8);
    const hostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius);

    if (!nearbyHazard && !hostile && this.isLikelyStarvationDamage(previousHealth, currentHealth)) {
      this.logger.warn(`emergency=starvation_damage; hp=${previousHealth}->${currentHealth}; food=${this.bot.food ?? "unknown"}; holding recovery without unknown-damage reposition`);
      this.markCurrentActionInterrupted(2000);
      this.pause(500);
      return;
    }

    if ((this.hazardEscapeBusy || this.currentDecisionType === "escape_hazard") && nearbyHazard) {
      this.logger.warn(`emergency=damage_block; block=${nearbyHazard.name}; distance=${nearbyHazard.distance.toFixed(1)}; already_escaping`);
      return;
    }

    this.emergencyBusy = true;
    this.markCurrentActionInterrupted(6000);
    this.pause(5000);
    try {
      await this.cancelCollectTask();
      this.resetMotion();
      if (nearbyHazard) {
        this.logger.warn(`emergency=damage_block; block=${nearbyHazard.name}; distance=${nearbyHazard.distance.toFixed(1)}; escaping`);
        await this.escapeHazardBlock(nearbyHazard);
      }
      if (hostile && this.hasValidPosition(this.bot.entity.position)) {
        await this.respondToHostileDamage(hostile, previousHealth, currentHealth);
      } else if (!nearbyHazard && this.hasValidPosition(this.bot.entity.position)) {
        await this.respondToUnknownDamage(previousHealth, currentHealth);
      }
    } finally {
      this.emergencyBusy = false;
    }
  }

  markCurrentActionInterrupted(milliseconds = 3000) {
    this.actionInterruptedUntil = Math.max(this.actionInterruptedUntil ?? 0, Date.now() + milliseconds);
  }

  shouldAbortCurrentAction() {
    if (this.emergencyBusy) return true;
    if (Date.now() < (this.actionInterruptedUntil ?? 0)) return true;
    return !this.hasValidPosition(this.bot.entity?.position);
  }

  async respondToHostileDamage(hostile, previousHealth, currentHealth) {
    if (!hostile || !this.hasValidPosition(hostile.position)) return;
    const distance = hostile.position.distanceTo(this.bot.entity.position);
    const immediateThreatRadius = this.config.survival.immediateThreatRadius ?? 8;
    const response = chooseHostileDamageResponse({
      health: currentHealth,
      criticalHealth: this.config.survival.criticalHealth,
      distance,
      immediateThreatRadius,
      hasWeapon: Boolean(firstInventoryItem(this.bot, WEAPONS))
    });

    this.logger.warn(`emergency=hostile_damage; target=${hostile.name}; distance=${distance.toFixed(1)}; hp=${previousHealth}->${currentHealth}; response=${response}`);
    if (response === "defend") {
      await this.defendSelf(hostile);
      return;
    }
    const closeThreat = distance <= immediateThreatRadius + 2;
    const escaped = await this.panicRetreatFrom(hostile, closeThreat ? Math.min(this.config.survival.panicRetreatMs, 1200) : this.config.survival.panicRetreatMs, closeThreat ? {
      maxPathTimeoutMs: 1200,
      manualRetreatMs: 900
    } : {});
    const currentDistance = this.hasValidPosition(hostile.position) && this.hasValidPosition(this.bot.entity.position)
      ? hostile.position.distanceTo(this.bot.entity.position)
      : Infinity;
    if (!escaped && currentDistance <= immediateThreatRadius + 2) {
      this.logger.warn("emergency=hostile_damage; retreat failed, fighting as last resort");
      await this.defendSelf(hostile);
    }
  }

  isLikelyStarvationDamage(previousHealth, currentHealth) {
    const previous = Number(previousHealth);
    const current = Number(currentHealth);
    const damage = previous - current;
    const food = Number(this.bot?.food ?? 20);
    return Number.isFinite(damage) && damage > 0 && damage <= 1.1 && Number.isFinite(food) && food <= 0;
  }

  async respondToUnknownDamage(previousHealth, currentHealth) {
    const origin = this.bot.entity.position;
    this.logger.warn(`emergency=unknown_damage; hp=${previousHealth}->${currentHealth}; repositioning; ${this.describeImmediateEnvironment(origin)}`);
    if (!this.hasValidPosition(origin)) return;

    const candidates = this.findNearbySafeStandPositions(origin, 6).slice(0, 3);
    for (const candidate of candidates) {
      if (!this.hasValidPosition(this.bot.entity?.position)) {
        this.logger.warn("emergency=unknown_damage; aborting reposition because bot position is invalid");
        return;
      }
      const reached = await this.gotoNear(candidate.x, candidate.y, candidate.z, 1, {
        label: "damage_reposition",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 2500),
        learnPosition: candidate,
        target: "unknown_damage",
        radius: 4
      });
      if (reached) return;
    }

    this.logger.warn(`emergency=unknown_damage; no quick safe reposition succeeded; candidates=${candidates.length}`);
    if (await this.clearImmediateBodySpace(origin)) {
      await this.wait(300);
      if (this.hasValidPosition(this.bot.entity?.position) && this.isSafeStandPosition(this.bot.entity.position.floored())) return;
    }
    const fallback = this.findLastSafeStandFallback(origin, 24);
    if (fallback) {
      this.logger.warn(`emergency=unknown_damage; falling back to last_safe_stand=${this.formatPosition(fallback)}`);
      const reached = await this.gotoNear(fallback.x, fallback.y, fallback.z, 1, {
        label: "damage_last_safe_recovery",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 4500),
        learnPosition: fallback,
        target: "last_safe_stand",
        radius: 6
      });
      if (reached) return;
      this.restoreEntityPosition(fallback, "unknown_damage_last_safe_fallback");
    }
  }

  async tick() {
    if (this.busy) {
      this.checkBusyWatchdog();
      return;
    }
    if (this.emergencyBusy || !this.bot.entity) {
      this.publishControllerState();
      return;
    }
    if (Date.now() < this.pausedUntil) return;
    if (!this.hasValidPosition(this.bot.entity.position)) {
      this.invalidPositionTicks++;
      this.resetMotion();
      this.logger.warn(`control tick skipped; waiting for a valid bot position (${this.invalidPositionTicks})`);
      this.publishControllerState();
      if (this.invalidPositionTicks >= 2 && this.restoreEntityPositionFromLastValid("control_tick_invalid_position")) {
        this.invalidPositionTicks = 0;
        this.pause(1000);
        this.publishControllerState();
        return;
      }
      if (this.invalidPositionTicks >= 3) {
        this.logger.warn("invalid position persisted; holding controller instead of reconnecting to avoid join/leave loops");
        this.invalidPositionTicks = 0;
        this.pause(15000);
        this.recordActionFailure("position_recovery", "invalid_position", this.lastValidPosition, {
          target: this.lastAction?.type || "position_recovery",
          radius: 8,
          taskFeedback: false
        });
        this.releaseCurrentQueuedWork("invalid_position_recovery", { ruleDecision: this.currentDecisionType ?? "unknown" });
        this.publishControllerState();
      }
      return;
    }
    this.invalidPositionTicks = 0;
    this.lastValidPosition = this.cloneValidPosition(this.bot.entity.position);
    this.rememberSafeStandPosition(this.bot.entity.position);

    this.busy = true;
    let publishContext = null;
    try {
      const snapshot = this.createSnapshot();
      const progress = this.logSurvivalProgress(snapshot);
      const ruleDecision = decideNextTask(snapshot, this.config);
      this.runAgentOrchestration({
        snapshot,
        progress,
        ruleDecision,
        taskFeedback: this.getTaskFeedbackStatus()
      });
      const forcedDecision = this.applyForcedTask(ruleDecision, ruleDecision);
      const testDecision = forcedDecision.forced ? forcedDecision : this.selectDecisionWithTestTasks(snapshot, ruleDecision);
      const priorityDecision = forcedDecision.forced || testDecision.testQueued ? testDecision : this.selectDecisionWithPriorityTasks(snapshot, ruleDecision);
      let decision = priorityDecision;
      if (!forcedDecision.forced && !testDecision.testQueued && !priorityDecision.priorityQueued) {
        const behaviorDecision = this.selectDecisionWithBehaviorQueue(snapshot, ruleDecision);
        if (behaviorDecision.behaviorTreeQueued) {
          decision = behaviorDecision;
        } else {
          const queueDecision = this.selectDecisionWithTaskQueue(snapshot, ruleDecision);
          decision = queueDecision.llmQueued ? queueDecision : this.selectDecisionWithTaskFeedback(snapshot, ruleDecision);
        }
      }
      const skillEnvelope = skillEnvelopeForDecision(decision);
      const skillId = skillEnvelope.primarySkillId || "safety_base";
      this.lastAction = { type: decision.type, skillId, skillPlan: skillEnvelope.plan, position: snapshot.position.floored(), startedAt: Date.now() };
      this.startTaskTrace(decision, skillEnvelope, snapshot);
      const controllerState = this.buildControllerState();
      publishContext = { snapshot, decision, skillEnvelope, progress, dimension: this.currentDimension() };
      this.lastPublishContext = publishContext;
      if (!controllerState.testTasks.active) {
        this.maybeStartPlannerDryRun({
          snapshot,
          progress,
          memory: this.memory,
          decision: ruleDecision,
          skillEnvelope,
          dimension: this.currentDimension(),
          controller: controllerState,
          force: this.shouldForcePlannerForDecision(ruleDecision)
        });
      }
      this.statusReporter?.publishTick({
        snapshot: publishContext.snapshot,
        decision: publishContext.decision,
        skillEnvelope: publishContext.skillEnvelope,
        progress: publishContext.progress,
        memory: this.memory,
        dimension: publishContext.dimension,
        controller: controllerState
      });
      this.logger.info(`decision=${decision.type}; skill=${skillId}; hp=${snapshot.health}; food=${snapshot.food}; time=${snapshot.timeOfDay}; night=${snapshot.isNight}; pos=${this.formatPosition(snapshot.position)}; reason=${decision.reason}`);
      this.currentDecisionType = decision.type;
      try {
        const executionResult = await this.execute(decision);
        const taskCompleted = executionResult !== false;
        if (taskCompleted && decision.type !== ruleDecision.type) {
          this.recordTaskFeedbackRecoverySuccess(ruleDecision.type, decision.type, { reason: decision.reason });
        }
        if (taskCompleted) this.recordTaskFeedbackSuccess(decision.type, { taskType: decision.type, target: "task_completed" });
        if (taskCompleted) this.recordTaskResultToMapMemory(decision);
        this.finishTaskTrace(taskCompleted ? "completed" : "failed", { decision: decision.type });
        if (decision.behaviorTreeQueued) {
          if (taskCompleted) {
            this.behaviorQueue.completeCurrent("completed", { reason: `rule=${ruleDecision.type}` });
          } else {
            this.behaviorQueue.failCurrent("postcondition_failed", { ruleDecision: ruleDecision.type });
          }
          this.reportBehaviorTreeFeedback(decision, taskCompleted ? "completed" : "failed", taskCompleted ? `rule=${ruleDecision.type}` : "postcondition_failed");
        }
        if (decision.llmQueued) {
          if (taskCompleted) this.taskQueue.completeCurrent("completed", { reason: `rule=${ruleDecision.type}` });
          else this.taskQueue.failCurrent("postcondition_failed");
          this.publishTaskQueueStatus();
        }
        if (decision.testQueued) {
          if (executionResult !== false && this.isTestTaskComplete(decision)) {
            this.testTaskQueue.completeCurrent("completed", { reason: `rule=${ruleDecision.type}` });
          } else {
            this.testTaskQueue.pause("task_incomplete", { task: decision.type, ruleDecision: ruleDecision.type });
          }
        }
        if (decision.priorityQueued) {
          if (executionResult !== false && this.isPriorityTaskComplete(decision)) {
            this.priorityTaskQueue.completeCurrent("completed", { reason: `rule=${ruleDecision.type}` });
          } else {
            this.priorityTaskQueue.pause("task_incomplete", { task: decision.type, ruleDecision: ruleDecision.type });
          }
        }
      } catch (error) {
        this.finishTaskTrace("failed", { decision: decision.type, error: error.message });
        if (decision.behaviorTreeQueued) {
          this.behaviorQueue.failCurrent(error.message);
          this.reportBehaviorTreeFeedback(decision, "failed", error.message);
        }
        if (decision.llmQueued) {
          this.taskQueue.failCurrent(error.message);
          this.publishTaskQueueStatus();
        }
        if (decision.testQueued) this.testTaskQueue.failCurrent(error.message);
        if (decision.priorityQueued) this.priorityTaskQueue.failCurrent(error.message);
        throw error;
      } finally {
        this.currentDecisionType = null;
      }
    } finally {
      this.busy = false;
      if (publishContext) this.publishControllerState(publishContext);
    }
  }

  selectDecisionWithTestTasks(snapshot, ruleDecision) {
    const nextTask = this.testTaskQueue?.peek?.();
    if (!nextTask) return ruleDecision;
    if (HARD_SAFETY_TASKS.has(ruleDecision.type) && nextTask.type !== ruleDecision.type) {
      this.testTaskQueue.pause("hard_safety_test_pipeline", { queuedTask: nextTask.type, ruleDecision: ruleDecision.type });
      return ruleDecision;
    }

    const startedTask = this.testTaskQueue.startNext({ ruleDecision: ruleDecision?.type });
    if (!startedTask) return ruleDecision;
    this.logger.warn(`task_pipeline=start_test; task=${startedTask.type}; rule=${ruleDecision?.type ?? "none"}`);
    return {
      ...ruleDecision,
      type: startedTask.type,
      reason: `test pipeline task ${startedTask.type}; reason=${startedTask.reason}; rule=${ruleDecision?.type ?? "none"}`,
      testQueued: true,
      testTaskId: startedTask.id,
      testMetadata: startedTask.metadata ?? {},
      source: startedTask.source,
      originalDecision: ruleDecision.type,
      ruleDecision: ruleDecision.type
    };
  }

  selectDecisionWithPriorityTasks(snapshot, ruleDecision) {
    const nextTask = this.priorityTaskQueue?.peek?.();
    if (!nextTask) return ruleDecision;
    if (HARD_SAFETY_TASKS.has(ruleDecision.type) && nextTask.type !== ruleDecision.type) {
      this.priorityTaskQueue.pause("hard_safety_priority", { queuedTask: nextTask.type, ruleDecision: ruleDecision.type });
      return ruleDecision;
    }

    const startedTask = this.priorityTaskQueue.startNext({ ruleDecision: ruleDecision?.type });
    if (!startedTask) return ruleDecision;
    this.logger.warn(`task_queue=start_priority; task=${startedTask.type}; priority=${startedTask.priority}; rule=${ruleDecision?.type ?? "none"}`);
    return {
      ...ruleDecision,
      type: startedTask.type,
      reason: `priority task ${startedTask.type}; reason=${startedTask.reason}; rule=${ruleDecision?.type ?? "none"}`,
      priorityQueued: true,
      priorityTaskId: startedTask.id,
      priorityMetadata: startedTask.metadata ?? {},
      priority: startedTask.priority,
      source: startedTask.source,
      originalDecision: ruleDecision.type,
      ruleDecision: ruleDecision.type
    };
  }

  selectDecisionWithBehaviorQueue(snapshot, ruleDecision) {
    if (!this.behaviorQueue?.enabled) return ruleDecision;
    let nextTree = this.behaviorQueue.peek();
    if (!nextTree) return ruleDecision;

    while (nextTree && HARD_SAFETY_TASKS.has(ruleDecision.type) && nextTree.taskType !== ruleDecision.type) {
      const skipReason = `hard_safety_${ruleDecision.type}_priority`;
      const skippedTree = this.discardBehaviorTree(nextTree, skipReason, ruleDecision);
      if (!skippedTree) {
        this.behaviorQueue.pause("hard_safety_behavior_queue", { queuedTask: nextTree.taskType, ruleDecision: ruleDecision.type });
        return ruleDecision;
      }
      this.reportBehaviorTreeFeedback({ behaviorTree: skippedTree }, skippedTree.status === "failed" ? "failed" : "skipped", skipReason);
      this.logger?.warn?.(`behavior_tree_queue=discard; task=${skippedTree.taskType}; rule=${ruleDecision.type}; reason=${skipReason}`);
      nextTree = this.behaviorQueue.peek();
    }

    while (nextTree && !this.canUseBehaviorTreeTask(nextTree.taskType, ruleDecision, snapshot)) {
      const shouldSkip = this.shouldSkipQueuedBehaviorTree(nextTree, ruleDecision, snapshot);
      const hasRunnableTreeBehind = !shouldSkip && this.hasRunnableBehaviorTreeBehindHead(ruleDecision, snapshot);
      if (!shouldSkip && !hasRunnableTreeBehind) {
        this.behaviorQueue.pause(`rule_${ruleDecision?.type ?? "unknown"}_priority`, { queuedTask: nextTree.taskType, ruleDecision: ruleDecision?.type ?? "unknown" });
        return ruleDecision;
      }
      const staleAdvisory = this.isStaleAdvisoryBehaviorTree(nextTree, ruleDecision);
      const skipReason = this.isTaskFeedbackBlocked(nextTree.taskType)
        ? `blocked_${nextTree.taskType}`
        : hasRunnableTreeBehind || staleAdvisory
          ? `stale_${nextTree.taskType}_before_${ruleDecision?.type ?? "unknown"}`
          : `rule_${ruleDecision?.type ?? "unknown"}_priority`;
      const skippedTree = this.discardBehaviorTree(nextTree, skipReason, ruleDecision);
      if (!skippedTree) break;
      this.reportBehaviorTreeFeedback({ behaviorTree: skippedTree }, skippedTree.status === "failed" ? "failed" : "skipped", skipReason);
      this.logger?.warn?.(`behavior_tree_queue=skip; task=${skippedTree.taskType}; rule=${ruleDecision?.type ?? "unknown"}; reason=${skipReason}`);
      nextTree = this.behaviorQueue.peek();
    }

    if (!nextTree || !this.canUseBehaviorTreeTask(nextTree.taskType, ruleDecision, snapshot)) return ruleDecision;
    const startedTree = this.behaviorQueue.startNext({ ruleDecision: ruleDecision?.type });
    if (!startedTree) return ruleDecision;
    this.logger.warn(`behavior_tree_queue=start; task=${startedTree.taskType}; priority=${startedTree.priority}; agent=${startedTree.sourceAgent ?? "none"}; rule=${ruleDecision?.type ?? "none"}`);
    return {
      ...ruleDecision,
      type: startedTree.taskType,
      reason: `behavior tree ${startedTree.taskType}; source=${startedTree.source}; agent=${startedTree.sourceAgent ?? "none"}; rule=${ruleDecision?.type ?? "none"}`,
      behaviorTreeQueued: true,
      behaviorTree: startedTree,
      behaviorTreeId: startedTree.id,
      behaviorTreeSource: startedTree.source,
      sourceAgent: startedTree.sourceAgent,
      sourcePlanId: startedTree.sourcePlanId,
      originalDecision: ruleDecision.type,
      ruleDecision: ruleDecision.type
    };
  }

  discardBehaviorTree(tree, reason, ruleDecision = {}) {
    if (!tree) return null;
    const currentTree = this.behaviorQueue?.current;
    if (currentTree && currentTree.id === tree.id) {
      return this.behaviorQueue.failCurrent(reason, {
        queuedTask: tree.taskType,
        ruleDecision: ruleDecision?.type ?? "unknown"
      });
    }
    return this.behaviorQueue.skipNext(reason, {
      queuedTask: tree.taskType,
      ruleDecision: ruleDecision?.type ?? "unknown"
    });
  }

  shouldSkipQueuedBehaviorTree(tree, ruleDecision, snapshot = {}) {
    const taskType = tree?.taskType;
    if (this.shouldSkipQueuedTask(taskType, ruleDecision, snapshot)) return true;
    if (!taskType || !ruleDecision?.type || taskType === ruleDecision.type) return false;
    if (this.behaviorQueue?.current?.id === tree?.id) return true;
    return this.isStaleAdvisoryBehaviorTree(tree, ruleDecision);
  }

  isStaleAdvisoryBehaviorTree(tree, ruleDecision) {
    return tree?.source === "llm_planner" && Boolean(tree?.taskType) && Boolean(ruleDecision?.type) && tree.taskType !== ruleDecision.type;
  }

  canUseBehaviorTreeTask(taskType, ruleDecision, snapshot = {}) {
    if (!taskType || !ruleDecision?.type) return false;
    if (taskType === ruleDecision.type) return true;
    if (HARD_SAFETY_TASKS.has(ruleDecision.type)) return false;
    return this.canUseQueuedTask(taskType, ruleDecision, snapshot);
  }

  reportBehaviorTreeFeedback(decision, outcome, reason) {
    const tree = decision?.behaviorTree;
    const feedback = {
      treeId: tree?.id ?? decision?.behaviorTreeId ?? null,
      taskType: tree?.taskType ?? decision?.type ?? null,
      outcome,
      reason,
      source: tree?.source ?? decision?.behaviorTreeSource ?? null,
      sourceAgent: tree?.sourceAgent ?? decision?.sourceAgent ?? null,
      sourcePlanId: tree?.sourcePlanId ?? decision?.sourcePlanId ?? null,
      at: new Date().toISOString()
    };
    this.agentOrchestrator?.recordFeedback?.(feedback);
    if (feedback.source === "llm_planner" && outcome !== "completed") {
      this.llmPlanner?.publish?.({ lastError: `behavior_tree_${outcome}:${reason}` });
    }
    return feedback;
  }

  selectDecisionWithTaskFeedback(snapshot, ruleDecision) {
    if (!this.isTaskFeedbackBlocked(ruleDecision?.type)) return ruleDecision;
    if (HARD_SAFETY_TASKS.has(ruleDecision.type)) return ruleDecision;
    const blockedTask = this.taskFeedback.blockedTasks[ruleDecision.type];
    const fallback = this.fallbackDecisionForBlockedTask(snapshot, ruleDecision, blockedTask);
    if (!fallback || fallback.type === ruleDecision.type) return ruleDecision;

    this.logger.warn(`task_feedback=replan; blocked=${ruleDecision.type}; fallback=${fallback.type}; reason=${blockedTask.reason}`);
    return {
      ...ruleDecision,
      ...fallback,
      reason: `feedback replan after blocked ${ruleDecision.type}: ${fallback.reason}; original=${ruleDecision.reason}`,
      feedbackReplanned: true,
      blockedTask: ruleDecision.type,
      blockedReason: blockedTask.reason
    };
  }

  fallbackDecisionForBlockedTask(snapshot, ruleDecision, blockedTask = {}) {
    if (ruleDecision.type === "hunt_food") {
      if (snapshot.isNight) {
        if (hasAny(snapshot.inventory ?? {}, SHELTER_BLOCK_ITEMS)) {
          return { type: "wait_out_night", reason: "food search is blocked at night; seal and wait for safer daylight" };
        }
        return { type: "hold_position", reason: "food search is blocked at night; hold position until daylight" };
      }
      return { type: "explore", reason: "local food search failed repeatedly; move to a new search area" };
    }

    if (/^craft_/.test(ruleDecision.type) && /crafting_table_unavailable|failed to place or find crafting table/i.test(blockedTask.reason ?? "")) {
      return { type: "explore", reason: "crafting table placement failed repeatedly; move to a nearby safer flat area", allowNight: true };
    }

    const recoveryTask = blockedTask.recoveryTasks?.[0] ?? "explore";
    return { type: recoveryTask, reason: `${ruleDecision.type} failed repeatedly; trying ${recoveryTask} as recovery task` };
  }

  isPriorityTaskComplete(decision) {
    return this.isQueuedTaskComplete(decision, decision.priorityMetadata ?? {});
  }

  isTestTaskComplete(decision) {
    return this.isQueuedTaskComplete(decision, decision.testMetadata ?? {});
  }

  isQueuedTaskComplete(decision, metadata = {}) {
    if (decision.type !== "escape_hazard") return true;
    if (this.findNearbyDamagingBlock(this.bot.entity?.position, 1.2)) return false;

    if (metadata.scenario === "berry_escape") return this.isOutsideQueuedBerryPatch(metadata, this.bot.entity?.position);

    return true;
  }

  isOutsidePriorityBerryPatch(metadata = {}, position = this.bot.entity?.position) {
    return this.isOutsideQueuedBerryPatch(metadata, position);
  }

  isOutsideQueuedBerryPatch(metadata = {}, position = this.bot.entity?.position) {
    if (!metadata.trapPosition || !Number.isFinite(Number(metadata.berryPatchRadius))) return true;
    if (!this.hasValidPosition(position)) return false;
    const radius = Number(metadata.berryPatchRadius);
    return Math.abs(Math.floor(position.x) - Number(metadata.trapPosition.x)) > radius
      || Math.abs(Math.floor(position.z) - Number(metadata.trapPosition.z)) > radius;
  }

  selectDecisionWithTaskQueue(snapshot, ruleDecision) {
    if (!this.taskQueue?.enabled) return ruleDecision;
    if (!this.isTaskQueueSafeWindow(snapshot, ruleDecision)) {
      this.taskQueue.pause("safety_window_closed");
      this.publishTaskQueueStatus();
      return ruleDecision;
    }

    let nextTask = this.taskQueue.peek();
    if (!nextTask) {
      this.publishTaskQueueStatus();
      return ruleDecision;
    }

    while (nextTask && !this.canUseQueuedTask(nextTask.type, ruleDecision, snapshot)) {
      const shouldSkip = this.shouldSkipQueuedTask(nextTask.type, ruleDecision, snapshot);
      const hasRunnableTaskBehind = !shouldSkip && this.hasRunnableLlmTaskBehindHead(ruleDecision, snapshot);
      if (!shouldSkip && !hasRunnableTaskBehind) {
        this.taskQueue.pause(`rule_${ruleDecision?.type ?? "unknown"}_priority`);
        this.publishTaskQueueStatus();
        return ruleDecision;
      }
      const skipReason = this.isTaskFeedbackBlocked(nextTask.type)
        ? `blocked_${nextTask.type}`
        : hasRunnableTaskBehind
          ? `stale_${nextTask.type}_before_${ruleDecision?.type ?? "unknown"}`
          : `rule_${ruleDecision?.type ?? "unknown"}_priority`;
      const skippedTask = this.taskQueue.skipNext(skipReason, {
        queuedTask: nextTask.type,
        ruleDecision: ruleDecision?.type ?? "unknown"
      });
      if (!skippedTask) break;
      this.logger?.warn?.(`llm_task_queue=skip; task=${skippedTask.type}; rule=${ruleDecision?.type ?? "unknown"}`);
      this.publishTaskQueueStatus();
      nextTask = this.taskQueue.peek();
    }

    if (!nextTask) {
      this.publishTaskQueueStatus();
      return ruleDecision;
    }

    if (!this.canUseQueuedTask(nextTask.type, ruleDecision, snapshot)) {
      this.taskQueue.pause(`rule_${ruleDecision?.type ?? "unknown"}_priority`);
      this.publishTaskQueueStatus();
      return ruleDecision;
    }

    const startedTask = this.taskQueue.startNext({ ruleDecision: ruleDecision?.type });
    if (!startedTask) return ruleDecision;
    this.publishTaskQueueStatus();
    return {
      ...ruleDecision,
      type: startedTask.type,
      reason: `LLM queued task ${startedTask.type}; goal=${this.taskQueue.activePlan?.goal || "unknown"}; rule=${ruleDecision?.type ?? "none"}`,
      llmQueued: true,
      queueTaskId: startedTask.id,
      queuedGoal: this.taskQueue.activePlan?.goal ?? null,
      originalDecision: ruleDecision.type,
      ruleDecision: ruleDecision.type
    };
  }

  shouldSkipQueuedTask(taskType, ruleDecision, snapshot = {}) {
    if (!taskType) return false;
    if (this.isTaskFeedbackBlocked(taskType)) return true;
    if (!ruleDecision?.type) return false;
    if (RULE_BOUND_QUEUE_TASKS.has(taskType) && taskType !== ruleDecision.type) return true;
    if (ruleDecision.type === "recover_starvation") {
      return taskType !== "explore" && taskType !== "hunt_food";
    }
    if (this.isTaskFeedbackBlocked(ruleDecision.type)) {
      return !this.isRecoveryTaskForBlockedRule(taskType, ruleDecision.type);
    }
    return false;
  }

  hasRunnableBehaviorTreeBehindHead(ruleDecision, snapshot = {}) {
    const pendingTrees = Array.isArray(this.behaviorQueue?.queue) ? this.behaviorQueue.queue : [];
    const startIndex = this.behaviorQueue?.current ? 0 : 1;
    return pendingTrees.slice(startIndex).some((tree) => this.canUseBehaviorTreeTask(tree?.taskType, ruleDecision, snapshot));
  }

  hasRunnableLlmTaskBehindHead(ruleDecision, snapshot = {}) {
    const pendingTasks = Array.isArray(this.taskQueue?.queue) ? this.taskQueue.queue : [];
    const startIndex = this.taskQueue?.current ? 0 : 1;
    return pendingTasks.slice(startIndex).some((task) => this.canUseQueuedTask(task?.type, ruleDecision, snapshot));
  }

  isRecoveryTaskForBlockedRule(taskType, blockedRuleType) {
    if (!taskType || !blockedRuleType || !this.isTaskFeedbackBlocked(blockedRuleType)) return false;
    const recoveryTasks = this.taskFeedback.blockedTasks[blockedRuleType]?.recoveryTasks;
    if (!Array.isArray(recoveryTasks) || recoveryTasks.length === 0) return taskType !== blockedRuleType;
    return recoveryTasks.includes(taskType);
  }

  canUseQueuedTask(taskType, ruleDecision, snapshot = {}) {
    if (!taskType || !ruleDecision?.type) return false;
    if (this.isTaskFeedbackBlocked(taskType)) return false;
    const lowFoodThreshold = this.config.survival.lowFood ?? 14;
    const hasFood = hasAny(snapshot.inventory ?? {}, FOOD_ITEMS);
    if (ruleDecision.type === "recover_starvation") {
      return taskType === "explore" || taskType === "hunt_food";
    }
    if (ruleDecision.type === "hunt_food") {
      if (this.isTaskFeedbackBlocked("hunt_food")) return taskType === "explore";
      return taskType === "hunt_food" || taskType === "explore";
    }
    if (RULE_BOUND_QUEUE_TASKS.has(taskType) && taskType !== ruleDecision.type) return false;
    if ((snapshot.food ?? 20) <= lowFoodThreshold && !hasFood) {
      return taskType === "hunt_food" || taskType === "explore";
    }
    if (this.isTaskFeedbackBlocked(ruleDecision.type)) return this.isRecoveryTaskForBlockedRule(taskType, ruleDecision.type);
    if (taskType === ruleDecision.type) return true;
    return ruleDecision.type === "explore";
  }

  isTaskQueueSafeWindow(snapshot, ruleDecision) {
    const blockedRuleTasks = new Set(["escape_hazard", "escape_pit", "evade_hostiles", "defend_shelter", "defend_self", "eat_food", "wait_out_night", "hold_position"]);
    if (blockedRuleTasks.has(ruleDecision?.type)) return false;
    if (ruleDecision?.type === "recover_starvation") return this.isPlannerEmergencyAdvisoryWindow(snapshot, ruleDecision);
    return this.isPlannerSafeWindow(snapshot, ruleDecision);
  }

  publishTaskQueueStatus() {
    if (!this.taskQueue?.getStatus) return;
    this.llmPlanner?.publish?.({ taskQueue: this.taskQueue.getStatus() });
  }

  handlePlannerResult(result) {
    if (!result || result.status !== "ok" || !result.plan) return;
    if (LLM_ADVISORY_ONLY_RULES.has(result.plan.ruleDecision)) {
      this.llmPlanner?.noteQueueDecision?.({
        accepted: false,
        reason: "safety_advisory_only",
        taskCount: 0,
        skippedTasks: result.plan.tasks ?? [],
        status: this.taskQueue.getStatus()
      });
      return;
    }

    if (Array.isArray(result.plan.behaviorTrees) && result.plan.behaviorTrees.length && this.behaviorQueue?.enabled) {
      const behaviorResult = this.behaviorQueue.enqueuePlan(result.plan, {
        source: "llm_planner",
        sourcePlanId: result.plan.id ?? result.record?.timestamp ?? null
      });
      this.llmPlanner?.noteQueueDecision?.({
        accepted: Boolean(behaviorResult.accepted),
        reason: behaviorResult.reason,
        taskCount: behaviorResult.taskCount ?? 0,
        skippedTasks: behaviorResult.rejected ?? [],
        planId: behaviorResult.planId ?? null,
        status: behaviorResult.status ?? this.behaviorQueue?.getStatus?.() ?? null
      });
      this.publishTaskQueueStatus();
      return;
    }

    if (!this.taskQueue?.enabled) return;
    const queueResult = this.taskQueue.enqueuePlan(result.plan, {
      source: "llm_planner",
      ruleDecision: result.plan.ruleDecision
    });
    this.llmPlanner?.noteQueueDecision?.(queueResult);
    this.publishTaskQueueStatus();
  }

  maybeStartPlannerDryRun(input) {
    const force = Boolean(input?.force);
    if (!this.llmPlanner?.shouldRun?.(Date.now(), { force })) return;
    if (!this.isPlannerSafeWindow(input.snapshot, input.decision) && !this.isPlannerEmergencyAdvisoryWindow(input.snapshot, input.decision)) {
      this.llmPlanner.noteSkipped?.("safety_window_closed");
      return;
    }
    this.llmPlanner.runDryPlan(input)
      .then((result) => this.handlePlannerResult(result))
      .catch((error) => {
        this.logger.warn(`llm planner background error: ${error.message}`);
      });
  }

  isPlannerSafeWindow(snapshot, decision) {
    if (!snapshot || this.emergencyBusy) return false;
    if ((snapshot.health ?? 20) <= this.config.survival.criticalHealth) return false;
    if ((snapshot.oxygen ?? 20) <= (this.config.survival.lowOxygenThreshold ?? 8)) return false;
    if (snapshot.environmentHazard || snapshot.navigationTrap || snapshot.isInLava) return false;
    const hardSafetyTasks = new Set(["escape_hazard", "escape_pit", "evade_hostiles", "defend_shelter", "defend_self"]);
    if (hardSafetyTasks.has(decision?.type)) return false;
    const immediateThreatRadius = this.config.survival.immediateThreatRadius ?? 8;
    const closeHostile = (snapshot.entities ?? []).find((entity) => HOSTILE_MOBS.has(entity.name) && entity.distance <= immediateThreatRadius + 2);
    return !closeHostile;
  }

  isPlannerEmergencyAdvisoryWindow(snapshot, decision) {
    if (!snapshot || this.emergencyBusy) return false;
    if (decision?.type === "recover_starvation") {
      if ((snapshot.oxygen ?? 20) <= (this.config.survival.lowOxygenThreshold ?? 8) || snapshot.environmentHazard || snapshot.navigationTrap || snapshot.isInLava) return false;
    } else if (decision?.type === "escape_pit") {
      if ((snapshot.oxygen ?? 20) <= (this.config.survival.lowOxygenThreshold ?? 8) || !snapshot.navigationTrap || snapshot.environmentHazard || snapshot.isInLava) return false;
    } else {
      return false;
    }
    const immediateThreatRadius = this.config.survival.immediateThreatRadius ?? 8;
    const closeHostile = (snapshot.entities ?? []).find((entity) => HOSTILE_MOBS.has(entity.name) && entity.distance <= immediateThreatRadius + 2);
    return !closeHostile;
  }

  shouldForcePlannerForDecision(decision) {
    if (!decision?.type) return false;
    if (this.isTaskFeedbackBlocked(decision.type) || decision.type === "recover_starvation") return true;
    if (decision.type === "escape_pit") {
      const lastPlan = this.llmPlanner?.getStatus?.()?.lastPlan;
      return lastPlan?.ruleDecision !== "escape_pit";
    }
    return false;
  }

  pause(milliseconds) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + milliseconds);
  }

  resetMotion() {
    try {
      this.bot.clearControlStates();
      this.bot.pathfinder?.setGoal(null);
      this.bot.pvp?.stop();
    } catch (error) {
      this.logger.debug("failed to reset bot motion", error.message);
    }
  }

  describeImmediateEnvironment(position = this.bot.entity?.position) {
    if (!this.hasValidPosition(position) || typeof this.bot?.blockAt !== "function") {
      return `blocks=unknown; oxygen=${this.bot?.oxygenLevel ?? "unknown"}; lava=${Boolean(this.bot?.entity?.isInLava)}; airborne=${this.bot?.entity?.timeSinceOnGround || 0}`;
    }
    try {
      const base = position.floored();
      const feet = this.blockSummary(this.bot.blockAt(base));
      const head = this.blockSummary(this.bot.blockAt(base.offset(0, 1, 0)));
      const ground = this.blockSummary(this.bot.blockAt(base.offset(0, -1, 0)));
      return `blocks=feet:${feet?.name ?? "none"},head:${head?.name ?? "none"},ground:${ground?.name ?? "none"}; oxygen=${this.bot.oxygenLevel ?? 20}; lava=${Boolean(this.bot.entity?.isInLava)}; airborne=${this.bot.entity?.timeSinceOnGround || 0}`;
    } catch (error) {
      return `blocks=unreadable:${error.message}; oxygen=${this.bot?.oxygenLevel ?? "unknown"}; lava=${Boolean(this.bot?.entity?.isInLava)}; airborne=${this.bot?.entity?.timeSinceOnGround || 0}`;
    }
  }

  rememberSafeStandPosition(position = this.bot.entity?.position) {
    if (!this.hasValidPosition(position) || typeof this.bot?.blockAt !== "function") return false;
    try {
      const base = position.floored();
      if (!this.isSafeStandPosition(base) || this.findNearbyDamagingBlock(base, 1.2)) return false;
      this.lastSafeStandPosition = this.cloneValidPosition(base);
      return true;
    } catch (error) {
      this.logger.debug("failed to remember safe stand position", error.message);
      return false;
    }
  }

  findLastSafeStandFallback(origin = this.bot.entity?.position, maxDistance = 24) {
    const fallback = this.cloneValidPosition(this.lastSafeStandPosition);
    if (!fallback) return null;
    if (this.hasValidPosition(origin) && this.distanceBetweenPositions(origin, fallback) > maxDistance) return null;
    if (typeof this.bot?.blockAt !== "function") return fallback;
    try {
      if (!this.isSafeStandPosition(fallback) || this.findNearbyDamagingBlock(fallback, 1.2)) return null;
    } catch (error) {
      this.logger.debug("failed to validate last safe stand fallback", error.message);
      return null;
    }
    return fallback;
  }

  async clearImmediateBodySpace(origin = this.bot.entity?.position) {
    if (!this.hasValidPosition(origin) || typeof this.bot?.blockAt !== "function" || typeof this.bot?.dig !== "function") return false;
    const base = origin.floored();
    let cleared = false;
    for (const position of [base.offset(0, 1, 0), base]) {
      const block = this.bot.blockAt(position);
      if (!block || block.boundingBox !== "block" || block.diggable === false || this.isDoorBlock(block) || this.isWaterBlock(block) || this.isDamagingBlock(block)) continue;
      this.logger.warn(`emergency=unknown_damage; clearing_body_space=${block.name}; pos=${this.formatPosition(position)}`);
      cleared = await this.digBlockAt(position) || cleared;
    }
    return cleared;
  }

  cloneValidPosition(position) {
    if (!this.hasValidPosition(position)) return null;
    return typeof position.clone === "function"
      ? position.clone()
      : new Vec3(Number(position.x), Number(position.y), Number(position.z));
  }

  restoreEntityPosition(position, reason = "position_recovery") {
    const restored = this.cloneValidPosition(position);
    if (!restored || !this.bot?.entity) return false;
    try {
      this.bot.entity.position = restored;
      this.lastValidPosition = this.cloneValidPosition(restored);
      this.logger.warn(`invalid_position=recovered; mode=local_entity_restore; reason=${reason}; pos=${this.formatPosition(restored)}`);
      return true;
    } catch (error) {
      this.logger.warn(`invalid_position=recover_failed; reason=${reason}; error=${error.message}`);
      return false;
    }
  }

  restoreEntityPositionFromLastValid(reason = "position_recovery") {
    return this.restoreEntityPosition(this.lastValidPosition, reason);
  }

  viewHeadingLabelFromYaw(yaw = 0) {
    const directions = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
    const normalized = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const index = Math.round((normalized / (Math.PI * 2)) * 8) % 8;
    return directions[index];
  }

  buildBotPerspectiveSnapshot(position = this.bot.entity?.position) {
    if (!this.hasValidPosition(position)) return null;
    const yaw = Number(this.bot.entity?.yaw) || 0;
    const pitch = Number(this.bot.entity?.pitch) || 0;
    const eyeHeight = Number(this.bot.entity?.height) > 0 ? Number(this.bot.entity.height) * 0.9 : 1.62;
    const eye = position.offset(0, eyeHeight, 0);

    const direction = new Vec3(
      -Math.sin(yaw) * Math.cos(pitch),
      -Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    );

    const frontBlocks = [];
    const seenBlockPositions = new Set();
    for (let distance = 1; distance <= 8; distance++) {
      const probe = eye.plus(direction.scaled(distance));
      const blockPos = probe.floored();
      const key = `${blockPos.x},${blockPos.y},${blockPos.z}`;
      if (seenBlockPositions.has(key)) continue;
      seenBlockPositions.add(key);
      const block = this.bot.blockAt?.(blockPos);
      if (!block) continue;
      frontBlocks.push({
        distance,
        name: block.name,
        solid: block.boundingBox === "block",
        diggable: block.diggable !== false,
        position: block.position
      });
      if (block.boundingBox === "block" && block.name !== "air") break;
    }

    const entities = Object.values(this.bot.entities ?? {})
      .filter((entity) => entity && entity !== this.bot.entity && entity.name && this.hasValidPosition(entity.position));
    let targetEntity = null;
    for (const entity of entities) {
      const toEntity = entity.position.offset(0, 0.9, 0).minus(eye);
      const distance = toEntity.norm();
      if (!Number.isFinite(distance) || distance <= 0 || distance > 20) continue;
      const unit = toEntity.scaled(1 / distance);
      const dot = direction.dot(unit);
      if (dot < 0.9) continue;
      if (!targetEntity || dot > targetEntity.dot || (Math.abs(dot - targetEntity.dot) < 0.02 && distance < targetEntity.distance)) {
        targetEntity = {
          id: entity.id,
          name: entity.name,
          distance,
          dot,
          position: entity.position
        };
      }
    }

    return {
      yaw,
      pitch,
      heading: this.viewHeadingLabelFromYaw(yaw),
      eye,
      direction,
      frontBlocks,
      targetEntity
    };
  }

  createSnapshot() {
    const position = this.bot.entity.position;
    this.refreshKnownCraftingTables(position);
    this.refreshStarterShelterProgress(position);
    this.refreshCropProgress(position);
    const starterShelterStatus = this.getStarterShelterStatus(position);
    const navigationAnalysis = this.analyzeNavigationSituation(position);
    const botPerspective = this.buildBotPerspectiveSnapshot(position);
    const entities = Object.values(this.bot.entities)
      .filter((entity) => entity !== this.bot.entity && entity.name)
      .map((entity) => ({
        name: entity.name,
        distance: entity.position.distanceTo(position),
        position: entity.position
      }));

    return {
      health: this.bot.health ?? 20,
      food: this.bot.food ?? 20,
      oxygen: this.bot.oxygenLevel ?? 20,
      environmentHazard: this.findNearbyDamagingBlock(position, 1.5),
      navigationTrap: navigationAnalysis.trapped,
      navigationAnalysis,
      inventory: inventoryFromBot(this.bot),
      entities,
      botPerspective,
      terrain: this.buildLocalTerrainSnapshot(position),
      position,
      timeOfDay: this.bot.time?.timeOfDay ?? 0,
      isNight: this.isNight(),
      isInLava: this.bot.entity.isInLava,
      timeSinceOnGround: this.bot.entity.timeSinceOnGround || 0,
      experience: this.bot.experience,
      progress: {
        ...this.progressState,
        hasCraftingTable: this.hasCraftingTableAccess(position),
        isNearStarterShelter: starterShelterStatus.isNear,
        isStarterShelterDefensible: starterShelterStatus.defensible,
        usableStarterShelter: starterShelterStatus.usable,
        starterShelterDistance: Number.isFinite(starterShelterStatus.distance) ? starterShelterStatus.distance : null,
        achievedMilestones: [...this.progressState.achievedMilestones]
      }
    };
  }

  refreshStarterShelterProgress(position) {
    if (this.progressState.hasStarterShelter || !this.progressState.starterShelterPosition || !this.hasValidPosition(position)) return;

    const base = new Vec3(
      this.progressState.starterShelterPosition.x,
      this.progressState.starterShelterPosition.y,
      this.progressState.starterShelterPosition.z
    );
    const plan = this.createStarterShelterPlan(base);
    const completed = plan.filter((targetPosition) => this.isDefensiveShelterBlock(targetPosition)).length;

    if (completed >= Math.ceil(plan.length * 0.9) && this.isStarterShelterDoorInstalled(base)) {
      this.progressState.hasStarterShelter = true;
      this.progressState.starterShelterPosition = { x: base.x, y: base.y, z: base.z };
      this.persistMemory();
    }
  }

  starterShelterBase() {
    if (!this.progressState.starterShelterPosition) return null;
    const position = this.progressState.starterShelterPosition;
    if (!this.hasValidPosition(position)) return null;
    return new Vec3(position.x, position.y, position.z);
  }

  getStarterShelterStatus(position = this.bot.entity?.position) {
    const base = this.starterShelterBase();
    if (!this.progressState.hasStarterShelter || !base || !this.hasValidPosition(position)) {
      return { hasMemory: false, isNear: false, defensible: false, usable: false, distance: Infinity };
    }

    const current = position.floored();
    const horizontalDistance = Math.hypot(current.x - base.x, current.z - base.z);
    const verticalDistance = Math.abs(current.y - base.y);
    const isNear = horizontalDistance <= 6 && verticalDistance <= 6;
    if (!isNear) {
      return { hasMemory: true, isNear: false, defensible: false, usable: false, distance: horizontalDistance };
    }

    const plan = this.createStarterShelterPlan(base);
    const completed = plan.filter((targetPosition) => this.isDefensiveShelterBlock(targetPosition)).length;
    const doorwayDefensible = this.isStarterShelterDoorwayDefensible(base);
    const defensible = completed >= Math.ceil(plan.length * 0.9) && doorwayDefensible;
    if (!defensible) this.logger.warn(`starter_shelter=not_defensible; completed=${completed}/${plan.length}; pos=${this.formatPosition(base)}`);
    return { hasMemory: true, isNear: true, defensible, usable: defensible, distance: horizontalDistance };
  }

  hasUsableStarterShelterAt(position = this.bot.entity?.position) {
    return this.getStarterShelterStatus(position).usable;
  }

  refreshCropProgress(position) {
    if (this.progressState.hasCropPlot || !this.mcData || !this.hasValidPosition(position)) return;

    const cropIds = CROP_BLOCKS
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);
    if (cropIds.length === 0) return;

    const planted = this.bot.findBlocks({ matching: cropIds, maxDistance: 14, count: this.config.survival.cropPlotTarget });
    if (planted.length >= Math.max(2, Math.ceil((this.config.survival.cropPlotTarget ?? 6) / 2))) {
      this.progressState.hasCropPlot = true;
      this.progressState.plantedCrops = Math.max(this.progressState.plantedCrops, planted.length);
      this.persistMemory();
    }
  }

  logSurvivalProgress(snapshot) {
    let progress = assessProgress(snapshot, this.config);
    let updatedHistory = false;

    for (const milestone of progress.milestones) {
      if (!milestone.achieved || this.loggedProgressMilestones.has(milestone.id)) continue;
      this.loggedProgressMilestones.add(milestone.id);
      if (!this.progressState.achievedMilestones.includes(milestone.id)) {
        this.progressState.achievedMilestones.push(milestone.id);
        updatedHistory = true;
      }
      this.logger.info(`progress=${milestone.id}; label=${milestone.label}; summary=${progress.summary}`);
    }

    if (updatedHistory) {
      snapshot.progress.achievedMilestones = [...this.progressState.achievedMilestones];
      this.persistMemory();
      progress = assessProgress(snapshot, this.config);
    }

    if (progress.stage !== this.lastProgressStage) {
      this.lastProgressStage = progress.stage;
      const nextGoal = progress.next ? progress.next.label : "Phase 1 survival loop stable";
      this.logger.info(`progress_stage=${progress.stage}; next=${nextGoal}; food=${progress.foodCount}; building_blocks=${progress.materialCount}`);
    }

    return progress;
  }

  async execute(decision) {
    if (decision.behaviorTreeQueued && decision.behaviorTree) {
      return this.behaviorTreeRunner.execute(decision.behaviorTree, this, decision);
    }
    return this.executePrimitive(decision);
  }

  async executePrimitive(decision) {
    switch (decision.type) {
      case "escape_hazard":
        return this.escapeHazard(decision);
      case "escape_pit":
        return this.escapePit();
      case "evade_hostiles":
        return this.evadeHostiles();
      case "defend_shelter":
        return this.defendShelter();
      case "defend_self":
        return this.defendSelf();
      case "hold_position":
        return this.holdPositionSafely();
      case "eat_food":
        return this.eatFood();
      case "recover_starvation":
        return this.recoverFromStarvation();
      case "hunt_food":
        return this.huntFood(decision);
      case "wait_out_night":
        return this.waitOutNight();
      case "collect_wood":
        return this.collectWood(decision);
      case "craft_basic_supplies":
        return this.craftBasicSupplies();
      case "craft_basic_tools":
        return this.craftBasicTools();
      case "craft_stone_tools":
        return this.craftStoneTools();
      case "collect_stone":
        return this.collectStone(decision);
      case "craft_furnace":
        return this.craftFurnace();
      case "craft_weapon":
        return this.craftWeapon();
      case "collect_building_materials":
        return this.collectBuildingMaterials(decision);
      case "build_shelter":
        return this.buildStarterShelter();
      case "collect_wool":
        return this.collectWool();
      case "craft_bed":
        return this.craftBed();
      case "collect_crop_seeds":
        return this.collectCropSeeds();
      case "plant_crops":
        return this.plantCrops();
      case "build_animal_pen":
        return this.buildAnimalPen();
      case "lure_animals":
        return this.lureAnimals();
      case "mine_advanced_materials":
        return this.mineAdvancedMaterials();
      case "explore":
        return this.explore(decision);
      default:
        return this.explore();
    }
  }

  async escapeHazard(decision = {}) {
    const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.5);
    if (hazard) {
      return this.escapeHazardBlock(hazard);
    }

    const origin = this.bot.entity.position;
    this.resetMotion();
    if (!this.hasValidPosition(origin)) return false;

    const queuedMetadata = this.getQueuedDecisionMetadata(decision);
    if (queuedMetadata.scenario === "berry_escape" && !this.isOutsideQueuedBerryPatch(queuedMetadata, origin)) {
      const target = this.findDamagingPlantEscapeTarget(origin, 8);
      if (target) return this.stepTowardDamagingPlantEscapeTarget("sweet_berry_bush", origin, target);
    }

    this.logger.warn(`action=escape_hazard; mode=stabilize; pos=${this.formatPosition(origin)}; oxygen=${this.bot.oxygenLevel ?? 20}; lava=${Boolean(this.bot.entity.isInLava)}; airborne=${this.bot.entity.timeSinceOnGround || 0}`);
    if (this.isLowOxygen()) return this.escapeLowOxygen({ reason: decision.reason ?? "escape_hazard" });
    if (this.bot.entity.isInLava || (this.bot.oxygenLevel ?? 20) <= 8) {
      this.bot.setControlState("jump", true);
      await this.wait(700);
      this.bot.setControlState("jump", false);
    }

    if (!this.hasValidPosition(this.bot.entity.position)) return false;
    const current = this.bot.entity.position.floored();
    if (this.isSafeStandPosition(current) && !this.findNearbyDamagingBlock(current, 1.2)) return true;

    const safePosition = this.findNearbySafeStandPosition(origin, 5);
    if (safePosition) {
      return this.gotoNear(safePosition.x, safePosition.y, safePosition.z, 1, {
        label: "environment_reposition",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 6000),
        learnPosition: safePosition,
        target: "environment_hazard",
        radius: 5
      });
    }

    await this.wait(500);
    return this.hasValidPosition(this.bot.entity.position);
  }

  isLowOxygen(threshold = this.config?.survival?.lowOxygenThreshold ?? 8) {
    const oxygen = Number(this.bot?.oxygenLevel ?? 20);
    return Number.isFinite(oxygen) && oxygen <= threshold;
  }

  isBodyInWater(position = this.bot?.entity?.position) {
    if (!this.hasValidPosition(position) || typeof this.bot?.blockAt !== "function") return false;
    const base = position.floored();
    return this.isWaterBlock(this.bot.blockAt(base)) || this.isWaterBlock(this.bot.blockAt(base.offset(0, 1, 0)));
  }

  async escapeLowOxygen(options = {}) {
    const origin = this.cloneValidPosition(this.bot?.entity?.position);
    if (!origin) return false;
    this.markCurrentActionInterrupted(2500);
    await this.cancelCollectTask?.();
    this.resetMotion?.();
    this.bot?.pvp?.stop?.();
    this.logger.warn(`action=escape_low_oxygen; oxygen=${this.bot.oxygenLevel ?? "unknown"}; pos=${this.formatPosition(origin)}; reason=${options.reason ?? "low_oxygen"}`);

    const fallback = this.findLastSafeStandFallback(origin, 48) ?? this.findNearbySafeStandPosition(origin, 12);
    if (fallback) {
      const reached = await this.gotoNear(fallback.x, fallback.y, fallback.z, 1, {
        label: "oxygen_escape",
        timeoutMs: Math.min(this.config?.survival?.actionTimeoutMs ?? 6000, 6000),
        learnPosition: fallback,
        target: options.target ?? "air_or_shore",
        radius: 12,
        taskFeedback: false
      });
      if (reached && (!this.isLowOxygen(10) || !this.isBodyInWater(this.bot.entity.position))) return true;
    }

    const swimTarget = fallback ?? origin.offset(0, 3, 0);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!this.isLowOxygen(10) && !this.isBodyInWater(this.bot.entity.position)) return true;
      await this.bot.lookAt?.(swimTarget.offset(0, 1, 0), true);
      this.bot.setControlState?.("jump", true);
      this.bot.setControlState?.("forward", Boolean(fallback));
      await this.wait(700);
      this.bot.setControlState?.("forward", false);
      this.bot.setControlState?.("jump", false);
    }

    return !this.isLowOxygen(10) || !this.isBodyInWater(this.bot.entity.position);
  }

  getQueuedDecisionMetadata(decision = {}) {
    return decision.testMetadata ?? decision.priorityMetadata ?? {};
  }

  async escapePit() {
    this.resetMotion();
    const origin = this.bot.entity.position;
    if (!this.hasValidPosition(origin)) return false;

    const analysis = this.analyzeNavigationSituation(origin);
    const traceDetails = this.navigationTraceDetails(analysis);
    this.markTaskPhase("scan_environment", "扫描脚下与周围地形", "completed", traceDetails);
    this.recordTaskObservation("environment", analysis.summary, traceDetails, analysis.trapped ? "warn" : "info");
    if (!analysis.trapped) {
      this.markTaskPhase("verify", "验证已离开陷阱", "completed", traceDetails);
      return true;
    }

    this.markTaskPhase("choose_route", "选择脱困路线", "completed", traceDetails);
    if (analysis.recommendedAction === "controlled_descent") {
      const descentSteps = Math.min(Math.max(analysis.supportColumnDepth ?? 8, 8), 20);
      const descended = await this.descendSupportColumn(descentSteps, analysis);
      if (descended) return true;
      return false;
    }

    const rim = analysis.rim || null;
    if (rim) {
      this.markTaskPhase("rim_path", "尝试移动到安全边缘", "active", { target: rim });
      this.logger.info(`action=escape_pit; mode=rim; target=${this.formatPosition(rim)}`);
      const reached = await this.gotoNear(rim.x, rim.y, rim.z, 1, {
        label: "escape_pit_rim",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 7000),
        learnPosition: rim,
        target: "pit_rim"
      });
      if (reached && !this.isLikelyPitPosition(this.bot.entity.position)) {
        this.markTaskPhase("rim_path", "尝试移动到安全边缘", "completed", { target: rim, current: this.bot.entity.position });
        this.markTaskPhase("verify", "验证已离开陷阱", "completed", { current: this.bot.entity.position });
        this.recordActionSuccess("escape_pit", this.bot.entity.position, { target: "pit_rim" });
        return true;
      }
      this.markTaskPhase("rim_path", "尝试移动到安全边缘", "failed", { target: rim, current: this.bot.entity.position, reached });
      if (reached) {
        this.logger.warn(`action=escape_pit; rim_reached_but_still_trapped; current=${this.formatPosition(this.bot.entity.position)}; target=${this.formatPosition(rim)}`);
      }
    }

    this.markTaskPhase("carve_stair", "开凿上升阶梯", "active", { routeOptions: analysis.routeOptions });
    for (const direction of this.escapePitDirections(origin, rim)) {
      this.logger.warn(`action=escape_pit; carving stair direction=${this.formatPosition(direction)}`);
      const carved = await this.carveAscendingEscapeStair(direction, 5);
      if (carved && !this.isLikelyPitPosition(this.bot.entity.position)) {
        this.markTaskPhase("carve_stair", "开凿上升阶梯", "completed", { direction, current: this.bot.entity.position });
        this.markTaskPhase("verify", "验证已离开陷阱", "completed", { current: this.bot.entity.position });
        this.recordActionSuccess("escape_pit", this.bot.entity.position, { target: "pit_stair" });
        return true;
      }
    }

    if (analysis.safeSupportDescent && analysis.recommendedAction !== "controlled_descent") {
      const descended = await this.descendSupportColumn(6, analysis);
      if (descended) return true;
    }

    this.markTaskPhase("verify", "验证已离开陷阱", "failed", { current: this.bot.entity.position, analysis: traceDetails });
    this.recordActionFailure("escape_pit", "stair_escape_failed", origin, { target: "pit", radius: 8 });
    return false;
  }

  async descendSupportColumn(maxSteps = 8, initialAnalysis = null) {
    let moved = 0;
    const initialDetails = this.navigationTraceDetails(initialAnalysis ?? this.analyzeNavigationSituation(this.bot.entity.position));
    this.markTaskPhase("controlled_descent", "逐格下挖支撑下降", "active", initialDetails);

    for (let step = 1; step <= maxSteps; step++) {
      if (!this.hasValidPosition(this.bot.entity?.position)) break;
      const base = this.bot.entity.position.floored();
      const supportPosition = base.offset(0, -1, 0);
      const landingSupportPosition = base.offset(0, -2, 0);
      const support = this.bot.blockAt(supportPosition);
      const landingSupport = this.bot.blockAt(landingSupportPosition);

      if (!this.isDiggableSolidBlock(support) || !this.hasSolidSupport(landingSupportPosition)) {
        this.logger.warn(`action=escape_pit; controlled_descent blocked; support=${support?.name ?? "none"}; below=${landingSupport?.name ?? "none"}; step=${step}`);
        break;
      }

      this.logger.warn(`action=escape_pit; mode=controlled_descent; step=${step}; dig=${this.formatPosition(supportPosition)}; landing_support=${landingSupport.name}`);
      const before = this.cloneValidPosition(this.bot.entity.position);
      const dug = await this.digBlockAt(supportPosition);
      if (!dug) break;
      await this.wait(350);
      moved++;

      const current = this.bot.entity.position;
      if (!this.hasValidPosition(current)) break;
      const dropped = before ? before.y - current.y : 0;
      this.recordTaskObservation("movement", "controlled descent step", {
        step,
        dug: supportPosition,
        dropped: Number.isFinite(dropped) ? dropped.toFixed(1) : "unknown",
        current
      });
      if (!this.isLikelyPitPosition(current)) {
        this.markTaskPhase("controlled_descent", "逐格下挖支撑下降", "completed", { steps: moved, current });
        this.markTaskPhase("verify", "验证已离开陷阱", "completed", { current });
        this.recordActionSuccess("escape_pit", current, { target: "controlled_descent", steps: moved });
        return true;
      }
    }

    this.markTaskPhase("controlled_descent", "逐格下挖支撑下降", "failed", { steps: moved, current: this.bot.entity?.position });
    return false;
  }

  escapePitDirections(origin, rim = null) {
    const directions = [];
    const addDirection = (direction) => {
      const cardinal = normalizeCardinalDirection(direction);
      if (!directions.some((candidate) => candidate.x === cardinal.x && candidate.z === cardinal.z)) directions.push(cardinal);
    };

    if (rim && this.hasValidPosition(origin)) addDirection(new Vec3(rim.x - origin.x, 0, rim.z - origin.z));
    addDirection(this.cardinalDirection());
    for (const direction of CARDINAL_DIRECTIONS) addDirection(direction);
    return directions;
  }

  async escapeHazardBlock(hazard) {
    if (this.hazardEscapeBusy) return false;
    this.hazardEscapeBusy = true;
    try {
      this.resetMotion();
      const origin = this.bot.entity.position;
      if (!this.hasValidPosition(origin)) return false;

      if (this.isClearableDamagingPlant(hazard?.name)) {
        return this.escapeDamagingPlantBlock(hazard);
      }

      await this.quickRetreatFromHazard(hazard, 1200);
      const currentPosition = this.bot.entity.position;
      if (!this.hasValidPosition(currentPosition)) return false;
      if (!this.findNearbyDamagingBlock(currentPosition, 1.2)) return true;

      const safePosition = this.findNearbySafeStandPosition(currentPosition, 6);
      if (safePosition) {
        const reached = await this.gotoNear(safePosition.x, safePosition.y, safePosition.z, 1, {
          label: "escape_hazard_block",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 4000),
          learnPosition: hazard.position,
          target: hazard.name,
          radius: 4
        });
        if (reached) return true;
      }

      const awayX = origin.x - hazard.position.x;
      const awayZ = origin.z - hazard.position.z;
      const length = Math.max(Math.sqrt(awayX * awayX + awayZ * awayZ), 1);
      const fallbackDirection = this.cardinalDirection();
      const unitX = Math.abs(awayX) + Math.abs(awayZ) > 0.1 ? awayX / length : fallbackDirection.x;
      const unitZ = Math.abs(awayX) + Math.abs(awayZ) > 0.1 ? awayZ / length : fallbackDirection.z;

      this.logger.warn(`action=escape_hazard_block; block=${hazard.name}; pos=${this.formatPosition(hazard.position)}`);
      for (const distance of [4, 7, 10]) {
        const target = new Vec3(origin.x + unitX * distance, origin.y, origin.z + unitZ * distance);
        if (!this.isSafeStandPosition(target)) continue;
        return this.gotoNear(target.x, target.y, target.z, 1);
      }

      return this.gotoNear(origin.x + this.randomOffset() / 3, origin.y, origin.z + this.randomOffset() / 3, 3);
    } finally {
      this.hazardEscapeBusy = false;
    }
  }

  async escapeDamagingPlantBlock(hazard) {
    const origin = this.bot.entity.position;
    if (!hazard || !this.hasValidPosition(origin)) return false;

    const clearBudget = (this.bot.health ?? 20) <= (this.config.survival.criticalHealth ?? 8) ? 3 : 1;
    const clearedImmediate = await this.clearNearbyDamagingPlants(this.bot.entity.position, 1.25, clearBudget);
    if (clearedImmediate && !this.findNearbyDamagingBlock(this.bot.entity.position, 1.2)) {
      if (await this.leaveDamagingPlantCluster(hazard, origin)) return true;
      if (this.findNearbyClearableDamagingPlants(this.bot.entity.position, 3.5).length === 0) return true;
    }

    const safePositions = [
      ...this.findSafeAdjacentStandPositions(hazard.position),
      ...this.findNearbySafeStandPositions(origin, 4)
    ].filter((position, index, all) => all.findIndex((candidate) => this.sameBlockPosition(candidate, position)) === index);

    const steppedOut = await this.manualStepTowardSafePositions(hazard, safePositions.slice(0, 4), 1400);
    if (steppedOut && !this.findNearbyDamagingBlock(this.bot.entity.position, 1.2)) return true;

    const currentHazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.2) ?? hazard;
    const cleared = await this.clearDamagingPlantBlock(currentHazard);
    if (cleared && !this.findNearbyDamagingBlock(this.bot.entity.position, 1.2)) {
      if (await this.leaveDamagingPlantCluster(hazard, origin)) return true;
      if (this.findNearbyClearableDamagingPlants(this.bot.entity.position, 3.5).length === 0) return true;
    }

    const clearedNearby = await this.clearNearbyDamagingPlants(this.bot.entity.position, 1.8, 1);
    if (clearedNearby && !this.findNearbyDamagingBlock(this.bot.entity.position, 1.2)) {
      if (await this.leaveDamagingPlantCluster(hazard, origin)) return true;
      if (this.findNearbyClearableDamagingPlants(this.bot.entity.position, 3.5).length === 0) return true;
    }

    return false;
  }

  async leaveDamagingPlantCluster(hazard, origin) {
    if (!this.hasValidPosition(this.bot.entity?.position)) return false;
    if (this.findNearbyClearableDamagingPlants(this.bot.entity.position, 3.5).length === 0) return false;

    const target = this.findDamagingPlantEscapeTarget(this.bot.entity.position, 8);
    if (!target) return false;

    const stepped = await this.stepTowardDamagingPlantEscapeTarget(hazard.name, this.bot.entity.position, target);
    if (stepped && !this.findNearbyClearableDamagingPlants(this.bot.entity.position, 2.2).length) return true;

    return false;
  }

  async stepTowardDamagingPlantEscapeTarget(blockName, origin, target) {
    const stepTarget = this.nextDamagingPlantEscapeStep(origin, target);
    if (!stepTarget) return false;
    await this.clearNearbyDamagingPlants(origin, 1.45, 2);
    await this.clearDamagingPlantCorridor(origin, stepTarget, 1);
    await this.wait(700);
    this.logger.warn(`action=escape_hazard_block; mode=leave_plant_cluster; block=${blockName}; target=${this.formatPosition(stepTarget)}`);
    return this.gotoNear(stepTarget.x, stepTarget.y, stepTarget.z, 0, {
      label: "escape_plant_exit",
      timeoutMs: 2500,
      tolerance: 0.65
    });
  }

  nextDamagingPlantEscapeStep(origin, target) {
    if (!this.hasValidPosition(origin) || !this.hasValidPosition(target)) return null;
    const base = origin.floored();
    const deltaX = target.x + 0.5 - origin.x;
    const deltaZ = target.z + 0.5 - origin.z;
    const primary = Math.abs(deltaX) >= Math.abs(deltaZ)
      ? new Vec3(Math.sign(deltaX) || 0, 0, 0)
      : new Vec3(0, 0, Math.sign(deltaZ) || 0);
    const secondary = Math.abs(deltaX) >= Math.abs(deltaZ)
      ? new Vec3(0, 0, Math.sign(deltaZ) || 0)
      : new Vec3(Math.sign(deltaX) || 0, 0, 0);
    const candidates = [primary, secondary, new Vec3(primary.x + secondary.x, 0, primary.z + secondary.z)]
      .filter((offset) => offset.x !== 0 || offset.z !== 0)
      .map((offset) => base.plus(offset));

    return candidates.find((candidate) => {
      const ground = this.bot.blockAt(candidate.offset(0, -1, 0));
      const head = this.bot.blockAt(candidate.offset(0, 1, 0));
      return ground?.boundingBox === "block" && head?.boundingBox !== "block";
    }) ?? null;
  }

  findDamagingPlantEscapeTarget(origin, radius = 8) {
    if (!this.hasValidPosition(origin)) return null;
    return this.findNearbySafeStandPositions(origin, radius)
      .filter((position) => this.distanceBetweenPositions(origin, position) >= 3)
      .filter((position) => this.findNearbyClearableDamagingPlants(position, 2.2).length === 0)
      .sort((left, right) => this.distanceBetweenPositions(origin, left) - this.distanceBetweenPositions(origin, right))[0] ?? null;
  }

  async clearDamagingPlantCorridor(origin, target, maxClears = 3) {
    if (!this.hasValidPosition(origin) || !this.hasValidPosition(target)) return false;
    const distance = Math.max(1, Math.ceil(this.distanceBetweenPositions(origin, target)));
    const steps = Math.min(8, distance);
    let clearedAny = false;
    let clearedCount = 0;

    for (let step = 0; step <= steps; step++) {
      if (clearedCount >= maxClears) break;
      const ratio = step / steps;
      const point = new Vec3(
        Math.floor(origin.x + (target.x - origin.x) * ratio),
        Math.floor(origin.y),
        Math.floor(origin.z + (target.z - origin.z) * ratio)
      );
      const plant = this.findNearbyClearableDamagingPlants(point, 0.75, 1)[0];
      if (plant && await this.clearDamagingPlantBlock(plant)) {
        clearedAny = true;
        clearedCount++;
      }
    }

    return clearedAny;
  }

  findNearbyClearableDamagingPlants(position, radius = 1.5) {
    if (!this.mcData || !this.hasValidPosition(position) || typeof this.bot.blockAt !== "function") return [];
    const base = position.floored();
    const searchRadius = Math.ceil(radius);
    const plants = [];

    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          const block = this.bot.blockAt(base.offset(x, y, z));
          if (!this.isClearableDamagingPlant(block?.name)) continue;
          const distance = block.position.offset(0.5, 0.5, 0.5).distanceTo(position);
          if (distance > radius + 0.75) continue;
          plants.push({ name: block.name, position: block.position, distance, touching: this.isTouchingDamagingBlock(block, base) });
        }
      }
    }

    return plants
      .filter((plant, index, all) => all.findIndex((candidate) => this.sameBlockPosition(candidate.position, plant.position)) === index)
      .sort((left, right) => Number(right.touching) - Number(left.touching) || left.distance - right.distance);
  }

  async clearNearbyDamagingPlants(position, radius = 1.5, maxCount = 4) {
    const plants = this.findNearbyClearableDamagingPlants(position, radius).slice(0, maxCount);
    let clearedAny = false;
    for (const plant of plants) {
      if (await this.clearDamagingPlantBlock(plant)) clearedAny = true;
    }
    return clearedAny;
  }

  async manualStepTowardSafePositions(hazard, safePositions, durationMs) {
    const target = safePositions[0];
    if (!target || !this.hasValidPosition(this.bot.entity?.position)) return false;
    const deadline = Date.now() + durationMs;
    let moved = false;
    let lastSafePosition = this.cloneValidPosition(this.bot.entity.position);

    while (Date.now() < deadline && this.hasValidPosition(this.bot.entity.position)) {
      if (!this.findNearbyDamagingBlock(this.bot.entity.position, 1.2)) break;
      const origin = this.bot.entity.position;
      lastSafePosition = this.cloneValidPosition(origin) ?? lastSafePosition;
      const lookTarget = target.offset(0.5, 1.2, 0.5);
      await this.bot.lookAt(lookTarget, true);
      this.bot.setControlState("sprint", false);
      this.bot.setControlState("forward", true);
      this.bot.setControlState("jump", false);
      moved = true;
      await this.wait(150);
      if (!this.hasValidPosition(this.bot.entity?.position)) {
        this.logger.warn("action=escape_hazard_block; manual step produced invalid position; restoring last safe position");
        this.restoreEntityPosition(lastSafePosition, "manual_hazard_step_invalid_position");
        moved = false;
        break;
      }
    }

    this.bot.clearControlStates();
    if (moved && this.hasValidPosition(this.bot.entity?.position)) {
      this.logger.warn(`action=escape_hazard_block; mode=manual_step; block=${hazard.name}; current=${this.formatPosition(this.bot.entity.position)}`);
    }
    return moved;
  }

  async clearDamagingPlantBlock(hazard) {
    if (!this.isClearableDamagingPlant(hazard?.name) || !this.hasValidPosition(hazard.position)) return false;
    const block = this.bot.blockAt(hazard.position);
    if (!this.isClearableDamagingPlant(block?.name)) return false;

    this.logger.warn(`action=escape_hazard_block; mode=clear_plant; block=${block.name}; pos=${this.formatPosition(block.position)}`);
    try {
      await this.bot.lookAt(block.position.offset(0.5, 0.6, 0.5), true);
      await this.withTimeout(this.bot.dig(block, true), Math.min(this.config.survival.actionTimeoutMs, 1800), () => this.resetMotion());
      this.recordActionSuccess("escape_hazard_block", block.position, { target: block.name });
      return true;
    } catch (error) {
      this.logger.warn(`action=escape_hazard_block; clear_plant failed=${error.message}`);
      this.recordActionFailure("escape_hazard_block", error.message, block.position, { target: block.name, radius: 3 });
      return false;
    }
  }

  isClearableDamagingPlant(blockName) {
    return ["sweet_berry_bush", "wither_rose"].includes(blockName);
  }

  async quickRetreatFromHazard(hazard, durationMs) {
    const deadline = Date.now() + Math.min(durationMs, 1200);
    let lastSafePosition = this.cloneValidPosition(this.bot.entity?.position);

    while (Date.now() < deadline && this.hasValidPosition(this.bot.entity.position)) {
      const origin = this.bot.entity.position;
      lastSafePosition = this.cloneValidPosition(origin) ?? lastSafePosition;
      const direction = this.retreatDirectionFrom(origin, hazard.position);
      if (!this.findForwardSafeStandPosition(origin, direction.x, direction.z)) break;
      const lookTarget = new Vec3(origin.x + direction.x * 10, origin.y + 1.6, origin.z + direction.z * 10);

      await this.bot.lookAt(lookTarget, true);
      this.bot.setControlState("sprint", false);
      this.bot.setControlState("forward", true);
      await this.wait(200);
      if (!this.hasValidPosition(this.bot.entity?.position)) {
        this.logger.warn("action=escape_hazard; quick retreat produced invalid position; restoring last safe position");
        this.restoreEntityPosition(lastSafePosition, "quick_hazard_retreat_invalid_position");
        break;
      }
    }

    this.bot.clearControlStates();
  }

  async evadeHostiles() {
    const hostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius);
    const origin = this.bot.entity.position;
    this.markTaskPhase("scan", "扫描威胁", hostile ? "completed" : "failed", {
      target: hostile?.name ?? null,
      radius: this.config.survival.safeModeThreatRadius
    });

    if (hostile) {
      const distance = hostile.position.distanceTo(origin);
      const immediateThreatRadius = this.config.survival.immediateThreatRadius ?? 8;
      const closeCombatDistance = Math.max(3.2, Math.min(4.5, immediateThreatRadius * 0.55));
      if (distance <= closeCombatDistance && firstInventoryItem(this.bot, WEAPONS) && (this.bot.health ?? 20) > this.config.survival.criticalHealth) {
        this.logger.warn(`action=evade_hostiles; ${hostile.name} is already in melee range (${distance.toFixed(1)}), fighting now`);
        this.markTaskPhase("risk_response", "撤离失败转反击", "risk", { target: hostile.name, distance: distance.toFixed(1), reason: "melee_range" });
        await this.defendSelf(hostile);
        return;
      }

      this.logger.warn(`action=evade_hostiles; immediate retreat from ${hostile.name} at ${distance.toFixed(1)} blocks`);
      this.markTaskPhase("retreat_path", "寻找撤离路线", "active", { target: hostile.name, distance: distance.toFixed(1) });
      const closeThreat = distance <= immediateThreatRadius + 2;
      const escaped = await this.panicRetreatFrom(hostile, closeThreat ? Math.min(this.config.survival.panicRetreatMs, 1200) : this.config.survival.panicRetreatMs, closeThreat ? {
        maxPathTimeoutMs: 1200,
        manualRetreatMs: 900
      } : {});
      const currentDistance = this.hasValidPosition(hostile.position) && this.hasValidPosition(this.bot.entity.position)
        ? hostile.position.distanceTo(this.bot.entity.position)
        : Infinity;
      if (!escaped && currentDistance <= immediateThreatRadius + 2) {
        this.logger.warn("action=evade_hostiles; retreat failed, fighting as last resort");
        this.markTaskPhase("risk_response", "撤离失败转反击", "risk", { target: hostile.name, distance: currentDistance.toFixed(1), reason: "retreat_failed" });
        await this.defendSelf(hostile);
        return;
      }
      this.markTaskPhase("verify", "确认距离安全", "completed", { target: hostile.name, distance: Number.isFinite(currentDistance) ? currentDistance.toFixed(1) : "unknown" });
    }

    const currentPosition = this.bot.entity.position;
    if (!this.hasValidPosition(currentPosition)) {
      this.logger.warn("action=evade_hostiles; skipped path target because position is invalid after retreat");
      return;
    }

    let targetX = currentPosition.x + this.randomOffset();
    let targetZ = currentPosition.z + this.randomOffset();

    if (hostile) {
      const awayX = currentPosition.x - hostile.position.x;
      const awayZ = currentPosition.z - hostile.position.z;
      const length = Math.max(Math.sqrt(awayX * awayX + awayZ * awayZ), 1);
      targetX = currentPosition.x + (awayX / length) * this.config.survival.evadeDistance;
      targetZ = currentPosition.z + (awayZ / length) * this.config.survival.evadeDistance;
    }

    await this.gotoNear(targetX, currentPosition.y, targetZ, 3);
  }

  async panicRetreatFrom(hostile, durationMs, options = {}) {
    this.resetMotion();
    if (!hostile || !this.hasValidPosition(this.bot.entity.position)) return false;

    const safeTarget = this.findSafeRetreatTargetFrom(hostile);
    if (safeTarget) {
      this.logger.warn(`action=panic_retreat; mode=path; target=${this.formatPosition(safeTarget)}`);
      this.markTaskPhase("retreat_path", "寻找撤离路线", "active", { target: hostile.name, retreatTarget: safeTarget });
      const defaultPathTimeoutMs = Math.min(this.config.survival.actionTimeoutMs, Math.max(durationMs + 2500, 5000));
      const pathTimeoutMs = Math.max(250, Math.min(defaultPathTimeoutMs, options.maxPathTimeoutMs ?? defaultPathTimeoutMs));
      const reached = await this.gotoNear(safeTarget.x, safeTarget.y, safeTarget.z, 2, {
        label: "retreat",
        timeoutMs: pathTimeoutMs
      });
      if (reached) {
        this.markTaskPhase("verify", "确认距离安全", "completed", { target: hostile.name, retreatTarget: safeTarget });
        return true;
      }
    }

    this.logger.warn("action=panic_retreat; mode=manual; no safe path target found");
    this.markTaskPhase("manual_retreat", "手动撤离", "active", { target: hostile.name, durationMs });
    return this.manualRetreatFrom(hostile, Math.min(durationMs, options.manualRetreatMs ?? 1400));
  }

  async manualRetreatFrom(hostile, durationMs) {
    const deadline = Date.now() + durationMs;
    let moved = false;
    let lastSafePosition = this.cloneValidPosition(this.bot.entity?.position);

    while (Date.now() < deadline && this.hasValidPosition(this.bot.entity.position)) {
      const currentHostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius) || hostile;
      const origin = this.bot.entity.position;
      lastSafePosition = this.cloneValidPosition(origin) ?? lastSafePosition;
      const direction = this.retreatDirectionFrom(origin, currentHostile.position);
      if (!this.findForwardSafeStandPosition(origin, direction.x, direction.z)) {
        this.logger.warn("action=panic_retreat; manual retreat stopped before unsafe step");
        break;
      }
      const lookTarget = new Vec3(origin.x + direction.x * 12, origin.y + 1.6, origin.z + direction.z * 12);

      await this.bot.lookAt(lookTarget, true);
      this.bot.setControlState("sprint", false);
      this.bot.setControlState("forward", true);
      this.bot.setControlState("jump", false);
      moved = true;
      await this.wait(250);
      if (!this.hasValidPosition(this.bot.entity?.position)) {
        this.logger.warn("action=panic_retreat; manual retreat produced invalid position; restoring last safe position");
        this.restoreEntityPosition(lastSafePosition, "manual_retreat_invalid_position");
        moved = false;
        break;
      }
    }

    this.bot.clearControlStates();
    return moved;
  }

  findSafeRetreatTargetFrom(hostile) {
    const origin = this.bot.entity.position;
    if (!this.hasValidPosition(origin) || !this.hasValidPosition(hostile?.position)) return null;

    const direction = this.retreatDirectionFrom(origin, hostile.position);
    const perpendicular = new Vec3(-direction.z, 0, direction.x);
    const currentDistance = origin.distanceTo(hostile.position);

    for (const distance of [6, 10, 14, 18]) {
      for (const lateral of [0, 3, -3, 6, -6]) {
        for (const yOffset of [0, -1, 1, -2, 2]) {
          const candidate = new Vec3(
            Math.floor(origin.x + direction.x * distance + perpendicular.x * lateral),
            Math.floor(origin.y + yOffset),
            Math.floor(origin.z + direction.z * distance + perpendicular.z * lateral)
          );
          if (!this.isSafeStandPosition(candidate)) continue;
          if (this.findNearbyDamagingBlock(candidate, 1.2)) continue;
          if (candidate.distanceTo(hostile.position) <= currentDistance + 3) continue;
          return candidate;
        }
      }
    }

    return null;
  }

  retreatDirectionFrom(origin, threatPosition) {
    if (!this.hasValidPosition(origin) || !this.hasValidPosition(threatPosition)) {
      return this.cardinalDirection();
    }

    const awayX = origin.x - threatPosition.x;
    const awayZ = origin.z - threatPosition.z;
    const length = Math.sqrt(awayX * awayX + awayZ * awayZ);
    if (length < 0.1) return this.cardinalDirection();
    return new Vec3(awayX / length, 0, awayZ / length);
  }

  findForwardSafeStandPosition(origin, unitX, unitZ) {
    if (!this.hasValidPosition(origin)) return null;
    let stepX = Math.abs(unitX) >= 0.35 ? Math.sign(unitX) : 0;
    let stepZ = Math.abs(unitZ) >= 0.35 ? Math.sign(unitZ) : 0;
    if (stepX === 0 && stepZ === 0) {
      const fallback = this.cardinalDirection();
      stepX = fallback.x;
      stepZ = fallback.z;
    }

    const base = origin.floored().offset(stepX, 0, stepZ);
    for (const yOffset of [0, -1, 1]) {
      const candidate = base.offset(0, yOffset, 0);
      if (this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2)) return candidate;
    }

    return null;
  }

  findNearbySafeStandPosition(origin, radius = 5) {
    return this.findNearbySafeStandPositions(origin, radius)[0] ?? null;
  }

  findNearbySafeStandPositions(origin, radius = 5) {
    if (!this.hasValidPosition(origin)) return [];
    const base = origin.floored();
    const candidates = [];

    for (let distance = 0; distance <= radius; distance++) {
      for (let x = -distance; x <= distance; x++) {
        for (let z = -distance; z <= distance; z++) {
          if (Math.max(Math.abs(x), Math.abs(z)) !== distance) continue;
          for (const yOffset of [0, -1, 1, -2, 2]) {
            candidates.push(base.offset(x, yOffset, z));
          }
        }
      }
    }

    return candidates
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2))
      .sort((left, right) => this.distanceBetweenPositions(origin, left) - this.distanceBetweenPositions(origin, right));
  }

  findSafeExplorationTarget(origin = this.bot.entity?.position, options = {}) {
    if (!this.hasValidPosition(origin)) return null;
    const base = origin.floored();
    const directions = [
      ...CARDINAL_DIRECTIONS,
      new Vec3(1, 0, 1),
      new Vec3(1, 0, -1),
      new Vec3(-1, 0, 1),
      new Vec3(-1, 0, -1)
    ].map(normalizeCardinalDirection);
    const candidates = [];
    const distances = options.distances ?? [10, 14, 18, 24, 32];
    const avoidRecent = options.avoidRecent === true;
    const recentRadius = options.recentRadius ?? 8;
    const preferredDistance = options.preferredDistance ?? 18;

    for (const distance of distances) {
      for (const direction of directions) {
        for (const yOffset of [0, -1, 1, -2, 2, -3, 3]) {
          const candidate = new Vec3(
            Math.floor(base.x + direction.x * distance),
            Math.floor(base.y + yOffset),
            Math.floor(base.z + direction.z * distance)
          );
          if (!this.isSafeStandPosition(candidate)) continue;
          if (this.findNearbyDamagingBlock(candidate, 1.2)) continue;
          if (this.isLearnedAvoidPosition(candidate, "explore", "random_walk")) continue;
          if (avoidRecent && this.isRecentExplorationTarget(candidate, recentRadius)) continue;
          candidates.push(candidate);
        }
      }
    }

    return candidates
      .sort((left, right) => {
        if (options.preferFar) return this.distanceBetweenPositions(origin, right) - this.distanceBetweenPositions(origin, left);
        return Math.abs(this.distanceBetweenPositions(origin, left) - preferredDistance) - Math.abs(this.distanceBetweenPositions(origin, right) - preferredDistance);
      })[0] ?? null;
  }

  isRecentExplorationTarget(position, radius = 8) {
    if (!this.hasValidPosition(position)) return false;
    return (this.explorationHistory ?? [])
      .slice(-10)
      .some((entry) => this.hasValidPosition(entry.position) && this.distanceBetweenPositions(entry.position, position) <= radius);
  }

  rememberExplorationTarget(position, details = {}) {
    if (!this.hasValidPosition(position)) return;
    this.explorationHistory = [
      ...(this.explorationHistory ?? []),
      {
        position: position.floored ? position.floored() : new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z)),
        reached: Boolean(details.reached),
        purpose: details.purpose ?? "explore",
        at: Date.now()
      }
    ].slice(-16);
  }

  async holdPositionSafely() {
    this.resetMotion();
    await this.equipBestWeapon();
    this.bot.setControlState("sneak", false);
    this.logger.info(`action=hold_position; pos=${this.formatPosition(this.bot.entity.position)}; scanning for threats`);

    const deadline = Date.now() + 8000;
    const hasUsableStarterShelter = this.isNight() && this.hasUsableStarterShelterAt(this.bot.entity.position);
    const scanRadius = hasUsableStarterShelter
      ? this.config.survival.shelterDefenseRadius
      : this.config.survival.safeModeThreatRadius;
    try {
      while (Date.now() < deadline) {
        const hostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), scanRadius);
        if (hostile) {
          const distance = hostile.position.distanceTo(this.bot.entity.position);
          const closeThreat = hasUsableStarterShelter
            ? distance <= this.config.survival.shelterDefenseRadius
            : distance <= (this.config.survival.immediateThreatRadius + 2);
          const openNightPressure = this.isNight() && !hasUsableStarterShelter && distance <= scanRadius;
          const responseMode = hasUsableStarterShelter
            ? "defense"
            : closeThreat || openNightPressure
              ? "retreat"
              : "shelter_hold";
          const log = closeThreat || openNightPressure ? this.logger.warn.bind(this.logger) : this.logger.info.bind(this.logger);
          log(`action=hold_position; threat detected=${hostile.name}; distance=${distance.toFixed(1)}; switching to ${responseMode}`);
          const shelterBlock = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
          if (hasUsableStarterShelter) {
            await this.defendShelter(hostile);
          } else if (this.isNight() && shelterBlock && !closeThreat) {
            await this.buildSimpleShelter();
            await this.wait(1000);
            continue;
          } else if (this.isNight() && shelterBlock) {
            await this.buildSimpleShelter();
            await this.wait(1000);
            continue;
          } else {
            const escaped = await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
            const currentDistance = this.hasValidPosition(hostile.position) && this.hasValidPosition(this.bot.entity.position)
              ? hostile.position.distanceTo(this.bot.entity.position)
              : Infinity;
            if (!escaped && firstInventoryItem(this.bot, WEAPONS) && currentDistance <= this.config.survival.immediateThreatRadius + 2) {
              await this.defendSelf(hostile);
            }
          }
          return;
        }
        await this.wait(1000);
      }
    } finally {
      this.bot.setControlState("sneak", false);
    }
  }

  async defendShelter(target = null) {
    this.resetMotion();
    await this.equipBestWeapon();
    const hostile = target || this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.shelterDefenseRadius);
    if (!hostile) {
      await this.holdPositionSafely();
      return;
    }

    this.logger.warn(`action=defend_shelter; target=${hostile.name}; distance=${hostile.position.distanceTo(this.bot.entity.position).toFixed(1)}`);
    const deadline = Date.now() + Math.min(this.config.survival.actionTimeoutMs, 8000);
    this.bot.pvp.attack(hostile);
    try {
      while (Date.now() < deadline && this.bot.entities[hostile.id]) {
        const distance = hostile.position.distanceTo(this.bot.entity.position);
        if (distance > this.config.survival.shelterDefenseRadius + 2) break;
        if ((this.bot.health ?? 20) <= this.config.survival.criticalHealth) {
          this.logger.warn("action=defend_shelter; health critical, retreating");
          this.bot.pvp.stop();
          await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
          return;
        }
        await this.bot.lookAt(hostile.position.offset(0, 1, 0), true);
        if (distance <= 4.2) this.bot.attack(hostile);
        await this.wait(500);
      }
    } finally {
      this.bot.pvp.stop();
      this.resetMotion();
    }
  }

  async defendSelf(target = null) {
    this.resetMotion();
    this.markTaskPhase("prepare", "装备武器", "active", { health: this.bot.health ?? 20 });
    await this.equipBestWeapon();
    const targetStillVisible = target && this.bot.entities[target.id] && this.hasValidPosition(target.position);
    const hostile = targetStillVisible
      ? target
      : this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.immediateThreatRadius + 2);
    if (!hostile) {
      this.markTaskPhase("target", "锁定敌对生物", "failed", { reason: "no_visible_hostile" });
      await this.holdPositionSafely();
      return;
    }

    this.markTaskPhase("target", "锁定敌对生物", "completed", { target: hostile.name, position: hostile.position });
    this.logger.warn(`action=defend_self; target=${hostile.name}; distance=${hostile.position.distanceTo(this.bot.entity.position).toFixed(1)}`);
    const deadline = Date.now() + Math.min(this.config.survival.actionTimeoutMs, 10000);
    const immediateThreatRadius = this.config.survival.immediateThreatRadius ?? 8;
    this.markTaskPhase("attack", "攻击窗口", "active", { target: hostile.name, timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 10000) });
    this.bot.pvp?.attack?.(hostile);
    try {
      while (Date.now() < deadline && this.bot.entities[hostile.id]) {
        const currentHostile = this.bot.entities[hostile.id] ?? hostile;
        const distance = currentHostile.position.distanceTo(this.bot.entity.position);
        if ((this.bot.health ?? 20) <= this.config.survival.criticalHealth) {
          this.logger.warn("action=defend_self; health critical, retreating");
          this.markTaskPhase("retreat", "低血撤离", "risk", { target: currentHostile.name, health: this.bot.health ?? 20, distance: distance.toFixed(1) });
          this.recordTaskObservation("risk", "defend_self health critical, retreating", { target: currentHostile.name, health: this.bot.health ?? 20 }, "warn");
          this.bot.pvp?.stop?.();
          await this.panicRetreatFrom(currentHostile, this.config.survival.panicRetreatMs);
          return;
        }
        if (distance > immediateThreatRadius + 6) break;
        this.markTaskPhase("positioning", "保持距离与站位", "active", { target: currentHostile.name, distance: distance.toFixed(1), back: distance < 2.6, jump: distance < 2.4 });
        await this.attackHostileOnce(currentHostile, distance);
        this.bot.setControlState("back", distance < 2.6);
        this.bot.setControlState("jump", distance < 2.4);
        await this.wait(300);
      }
    } finally {
      this.bot.pvp?.stop?.();
      this.resetMotion();
    }

    this.markTaskPhase("collect_drops", "战后拾取", "active", { target: hostile.name });
    await this.collectNearbyItems({ maxDistance: 6, range: 1, avoidDamagingBlocks: true });
    this.markTaskPhase("verify", "确认威胁解除", this.bot.entities[hostile.id] ? "failed" : "completed", { target: hostile.name });
  }

  async attackHostileOnce(hostile, distance = null) {
    if (!hostile || !this.hasValidPosition(hostile.position) || !this.hasValidPosition(this.bot.entity?.position)) return false;
    const currentDistance = distance ?? hostile.position.distanceTo(this.bot.entity.position);
    await this.bot.lookAt(hostile.position.offset(0, 1, 0), true);
    if (currentDistance > 4.6 || typeof this.bot.attack !== "function") return false;
    try {
      this.bot.attack(hostile);
      return true;
    } catch (error) {
      this.logger.debug("manual hostile attack failed", error.message);
      return false;
    }
  }

  async eatFood() {
    const item = firstInventoryItem(this.bot, FOOD_ITEMS);
    if (!item) {
      this.logger.warn("wanted to eat but no edible item was found");
      return false;
    }

    await this.cancelCollectTask();
    this.resetMotion();
    try {
      await this.bot.equip(item, "hand");
      await this.withTimeout(this.bot.consume(), Math.min(this.config.survival.actionTimeoutMs, 6000), () => this.resetMotion());
      this.recordActionSuccess("eat_food", this.bot.entity?.position, { target: item.name });
      return true;
    } catch (error) {
      this.logger.warn(`action=eat_food; item=${item.name}; failed=${error.message}`);
      this.recordActionFailure("eat_food", error.message, this.bot.entity?.position, { target: item.name, radius: 4 });
      return false;
    }
  }

  async recoverFromStarvation() {
    await this.cancelCollectTask();
    this.resetMotion();
    const origin = this.bot.entity?.position;
    this.markTaskPhase("prepare", "停止移动并检查状态", "completed", {
      health: this.bot.health ?? null,
      food: this.bot.food ?? null,
      position: origin
    });
    this.logger.warn(`action=recover_starvation; hp=${this.bot.health ?? "unknown"}; food=${this.bot.food ?? "unknown"}; pos=${this.formatPosition(origin)}`);

    this.markTaskPhase("inventory_food", "检查可食用物品", "active", { foodItems: countItems(inventoryFromBot(this.bot), FOOD_ITEMS) });
    if (firstInventoryItem(this.bot, FOOD_ITEMS)) {
      this.markTaskPhase("inventory_food", "检查可食用物品", "completed", { result: "food_available" });
      this.markTaskPhase("eat", "进食恢复", "active", { source: "inventory" });
      return this.eatFood();
    }
    this.markTaskPhase("inventory_food", "检查可食用物品", "failed", { result: "no_food" });

    const closeHostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), (this.config.survival.immediateThreatRadius ?? 8) + 2);
    const nightPressureHostile = !closeHostile && this.isNight() && !this.hasUsableStarterShelterAt(origin)
      ? this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius ?? 28)
      : null;
    this.markTaskPhase("threat_check", "检查近身威胁", closeHostile || nightPressureHostile ? "risk" : "completed", {
      target: closeHostile?.name ?? nightPressureHostile?.name ?? null,
      distance: closeHostile
        ? closeHostile.position.distanceTo(this.bot.entity.position).toFixed(1)
        : nightPressureHostile
          ? nightPressureHostile.position.distanceTo(this.bot.entity.position).toFixed(1)
          : null
    });
    if (closeHostile) {
      this.recordTaskObservation("risk", "starvation recovery interrupted by close hostile", { target: closeHostile.name, position: closeHostile.position }, "warn");
      const escaped = await this.panicRetreatFrom(closeHostile, Math.min(this.config.survival.panicRetreatMs, 1200), {
        maxPathTimeoutMs: 1200,
        manualRetreatMs: 800
      });
      if (!escaped) this.recordActionFailure("recover_starvation", "close_hostile_retreat_failed", closeHostile.position, { target: closeHostile.name, radius: 8 });
      return false;
    }
    if (nightPressureHostile) {
      const distance = nightPressureHostile.position.distanceTo(this.bot.entity.position);
      this.markTaskPhase("threat_check", "检查夜间持续威胁", "risk", { target: nightPressureHostile.name, distance: distance.toFixed(1) });
      this.recordTaskObservation("risk", "starvation recovery interrupted by night hostile pressure", { target: nightPressureHostile.name, position: nightPressureHostile.position, distance: distance.toFixed(1) }, "warn");
      const escaped = await this.panicRetreatFrom(nightPressureHostile, this.config.survival.panicRetreatMs, {
        maxPathTimeoutMs: Math.min(this.config.survival.actionTimeoutMs, 5000),
        manualRetreatMs: 1200
      });
      if (!escaped) this.recordActionFailure("recover_starvation", "night_hostile_pressure_retreat_failed", nightPressureHostile.position, { target: nightPressureHostile.name, radius: this.config.survival.safeModeThreatRadius ?? 28 });
      return false;
    }

    this.markTaskPhase("nearby_food", "寻找近处安全食物", "active", { maxDistance: 10 });
    const foraged = await this.forageNearbyFood({ maxDistance: 10, maxBerryBushes: 8, stopAfterFood: true });
    if (foraged && firstInventoryItem(this.bot, FOOD_ITEMS)) {
      this.markTaskPhase("nearby_food", "寻找近处安全食物", "completed", { source: "nearby_forage" });
      this.markTaskPhase("eat", "进食恢复", "active", { source: "nearby_forage" });
      return this.eatFood();
    }

    this.markTaskPhase("nearby_food", "寻找近处安全食物", "failed", { reason: "no_immediate_safe_food" });
    this.markTaskPhase("feedback", "写入失败反馈", "active", { reason: "no_immediate_safe_food" });
    this.recordActionFailure("recover_starvation", "no_immediate_safe_food", origin, { target: "food", radius: 10 });
    this.recordTaskObservation("learning", "starvation recovery found no immediate safe food", { position: origin }, "warn");
    this.markTaskPhase("feedback", "写入失败反馈", "completed", { reason: "no_immediate_safe_food" });
    if (this.isNight() && (this.bot.health ?? 20) <= (this.config.survival.criticalHealth ?? 8)) {
      const closePassive = this.nearestEntity(
        (entity) => FOOD_MOBS.has(entity.name) && !HOSTILE_MOBS.has(entity.name),
        12
      );
      if (closePassive) {
        this.markTaskPhase("fallback", "紧急猎杀近处被动生物", "active", { target: closePassive.name, distance: closePassive.position.distanceTo(this.bot.entity.position).toFixed(1) });
        this.recordTaskObservation("learning", `recover_starvation: attempting emergency hunt on ${closePassive.name}`, { position: closePassive.position }, "warn");
        const reached = await this.gotoNear(closePassive.position.x, closePassive.position.y, closePassive.position.z, 3, {
          label: "recover_starvation_emergency_hunt",
          timeoutMs: 5000,
          target: closePassive.name
        });
        if (reached && this.bot.entities[closePassive.id]) {
          await this.equipBestWeapon();
          const deadline = Date.now() + 4000;
          this.bot.pvp.attack(closePassive);
          while (Date.now() < deadline && this.bot.entities[closePassive.id]) {
            await this.wait(500);
          }
          this.bot.pvp.stop();
          await this.collectNearbyItems();
          if (firstInventoryItem(this.bot, FOOD_ITEMS)) {
            this.markTaskPhase("fallback", "紧急猎杀近处被动生物", "completed", { target: closePassive.name });
            return this.eatFood();
          }
        }
        this.markTaskPhase("fallback", "紧急猎杀近处被动生物", "failed", { target: closePassive.name });
      }
      const nightHostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius ?? 28);
      if (nightHostile && !this.hasUsableStarterShelterAt(this.bot.entity.position)) {
        this.markTaskPhase("fallback", "夜间持续威胁撤离", "risk", { target: nightHostile.name, distance: nightHostile.position.distanceTo(this.bot.entity.position).toFixed(1) });
        await this.panicRetreatFrom(nightHostile, this.config.survival.panicRetreatMs, {
          maxPathTimeoutMs: Math.min(this.config.survival.actionTimeoutMs, 5000),
          manualRetreatMs: 1200
        });
        return false;
      }
      this.markTaskPhase("fallback", "夜间低血原地防守", "risk", { reason: "critical_health_night_no_food" });
      await this.holdPositionSafely();
      return false;
    }
    if (!this.isTaskFeedbackBlocked("hunt_food")) {
      this.markTaskPhase("hunt_attempt", "触发狩猎恢复（长距离搜索）", "active", {
        radius: this.config.survival.foodSearchRadius ?? 48
      });
      const hunted = await this.huntFood({ reason: "recover_starvation long range food search", ruleDecision: "recover_starvation" });
      if (firstInventoryItem(this.bot, FOOD_ITEMS)) {
        this.markTaskPhase("hunt_attempt", "触发狩猎恢复（长距离搜索）", "completed", { hunted });
        return this.eatFood();
      }
      this.markTaskPhase("hunt_attempt", "触发狩猎恢复（长距离搜索）", "failed", { hunted });
    }
    this.markTaskPhase("fallback", "迁移搜索食物", "active", { reason: "no_immediate_safe_food" });
    const moved = await this.explore({
      reason: "recover_starvation food recovery",
      ruleDecision: "recover_starvation",
      blockedTask: "hunt_food",
      allowNight: (this.bot.health ?? 20) > (this.config.survival.criticalHealth ?? 8)
    });
    this.markTaskPhase("fallback", "迁移搜索食物", moved ? "completed" : "failed", { moved });

    // 激进恢复策略：当探索后仍然没有食物时（无论 hunt_food 是否被 blocked）
    const hasFoodNow = firstInventoryItem(this.bot, FOOD_ITEMS);
    if (!hasFoodNow) {
      this.markTaskPhase("emergency_recovery", "探索后仍无食物，尝试强制大半径搜索", "active", { radius: 96, hadMoved: moved, huntFoodBlocked: this.isTaskFeedbackBlocked("hunt_food") });
      this.logger.warn("action=recover_starvation; emergency_recovery; attempting_force_hunt_with_extended_radius");

      // 强制搜索更大半径（96格）
      const emergencyHunted = await this.huntFood({
        reason: "recover_starvation emergency recovery - starvation critical",
        ruleDecision: "recover_starvation",
        searchRadius: 96,
        allowAquaticHunt: true
      });

      if (firstInventoryItem(this.bot, FOOD_ITEMS)) {
        this.markTaskPhase("emergency_recovery", "强制大半径搜索成功", "completed", { hunted: emergencyHunted });
        this.recordTaskFeedbackSuccess("hunt_food", { reason: "emergency_recovery_by_recover_starvation" });
        return this.eatFood();
      }
      this.markTaskPhase("emergency_recovery", "强制大半径搜索失败", "failed", { hunted: emergencyHunted });

      // 最后手段：如果血量极低且所有方法都失败，尝试自杀重生
      const health = this.bot.health ?? 20;
      if (health <= 4) {
        this.markTaskPhase("last_resort", "血量极低且无法获取食物，尝试自杀重生", "active", { health });
        this.logger.error(`action=recover_starvation; last_resort_suicide; health=${health}; all_recovery_methods_failed`);
        try {
          // 尝试接触危险方块自杀（岩浆、仙人掌等）
          const hazardBlock = this.findNearbyDamagingBlock(this.bot.entity?.position, 24);
          if (hazardBlock) {
            this.logger.warn(`action=recover_starvation; moving_to_hazard_for_suicide; hazard=${hazardBlock.name}`);
            await this.gotoNear(hazardBlock.position.x, hazardBlock.position.y, hazardBlock.position.z, 1, { label: "suicide_hazard", timeoutMs: 15000 });
          } else {
            // 没有危险方块，等待自然饿死
            this.markTaskPhase("last_resort", "等待自然死亡后重生", "active", { health });
            await this.holdPositionSafely();
          }
        } catch (error) {
          this.logger.debug("last resort suicide attempt failed", error.message);
        }
        // 返回 false 表示恢复失败
        return false;
      }
    }

    this.markTaskPhase("verify", "验证是否稳定", "completed", { health: this.bot.health ?? null, food: this.bot.food ?? null, moved });
    return moved;
  }

  async huntFood(decision = {}) {
        // 清理过期黑名单
        const now = Date.now();
        if (!this._huntFoodUnreachableBlacklist) this._huntFoodUnreachableBlacklist = new Map();
        for (const [id, entry] of this._huntFoodUnreachableBlacklist.entries()) {
          if (entry.expiresAt < now) this._huntFoodUnreachableBlacklist.delete(id);
        }
    const beforeFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    const parameters = this.taskParametersFromDecision(decision);
    const requestedRadius = Number(parameters.searchRadius ?? parameters.radius);
    const defaultSearchRadius = this.config.survival.foodSearchRadius ?? 48;
    const searchRadius = Number.isFinite(requestedRadius) && requestedRadius > 0
      ? Math.max(8, Math.min(96, requestedRadius))
      : defaultSearchRadius;
    const explicitTarget = this.targetPositionFromDecision(decision);
    const requestedTarget = typeof parameters.target === "string"
      ? parameters.target.toLowerCase()
      : typeof parameters.animal === "string"
        ? parameters.animal.toLowerCase()
        : null;
    const lowFood = this.config.survival.lowFood ?? 14;
    const criticalHealth = this.config.survival.criticalHealth ?? 8;
    const allowAquaticHunt = parameters.allowAquaticHunt === true
      || /aquatic|fish|salmon|cod/i.test(parameters.mode ?? "")
      || (this.bot.food ?? 20) <= lowFood
      || (this.bot.health ?? 20) <= criticalHealth;
    const maxAquaticDistance = allowAquaticHunt ? Math.min(searchRadius, 48) : 4;
    const maxAquaticVerticalDelta = allowAquaticHunt ? 6 : 2;
    const maxLandDistance = ((this.bot.food ?? 20) <= lowFood || (this.bot.health ?? 20) <= criticalHealth)
      ? Math.min(searchRadius, 24)
      : searchRadius;

    this.markTaskPhase("prepare", "准备武器与状态", "active", { food: beforeFood, foodTarget: this.config.survival.foodStockTarget });

    let { animal, landAnimal, aquaticAnimal, candidates } = this.selectHuntFoodTarget({
      searchRadius,
      allowAquaticHunt,
      maxAquaticDistance,
      maxAquaticVerticalDelta,
      maxLandDistance,
      blacklist: this._huntFoodUnreachableBlacklist
    });
    if (requestedTarget && !["food", "animal", "mob"].includes(requestedTarget) && candidates?.length) {
      const preferred = candidates.find((candidate) => candidate.name === requestedTarget || candidate.name.includes(requestedTarget));
      if (preferred) {
        animal = preferred;
        landAnimal = AQUATIC_FOOD_MOBS.has(preferred.name) ? null : preferred;
        aquaticAnimal = AQUATIC_FOOD_MOBS.has(preferred.name) ? preferred : aquaticAnimal;
      }
    }

    // 快速切换同类目标（如连续不可达）
    if (animal && this._huntFoodLastUnreachable && animal.id === this._huntFoodLastUnreachable.id) {
      if (candidates && candidates.length > 1 && now - this._huntFoodLastSwitchTime > this._huntFoodSwitchCooldownMs) {
        // 切换到下一个目标
        const idx = candidates.findIndex(e => e.id === animal.id);
        const next = candidates[(idx + 1) % candidates.length];
        if (next && next.id !== animal.id) {
          this.logger.warn(`hunt_food: switching to next candidate due to repeated unreachable: ${animal.name} -> ${next.name}`);
          this._huntFoodLastSwitchTime = now;
          this._huntFoodLastUnreachable = null;
          return await this.huntFood(decision); // 递归切换目标
        }
      }
    }
    let strategy = landAnimal ? "land_target" : (aquaticAnimal ? "aquatic_visible_range" : "none");

    this.markTaskPhase("search", "扫描动物与植物", animal ? "completed" : "active", {
      radius: searchRadius,
      landAnimal: landAnimal?.name ?? null,
      aquaticAnimal: aquaticAnimal?.name ?? null,
      strategy,
      food: beforeFood
    });

    if (this.shouldPreferNearbyBerryFood({ animal, landAnimal, aquaticAnimal, beforeFood, parameters })) {
      this.markTaskPhase("plant_scan", "寻找可食用植物", "active", { reason: "nearby_safe_berries_preferred", animal: animal?.name ?? null, strategy });
      const foraged = await this.forageNearbyFood({
        maxDistance: this.config.survival.berryPriorityRadius ?? 18,
        stopAfterFood: (this.bot.food ?? 20) > lowFood
      });
      if (foraged) {
        const afterForageFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
        this.markTaskPhase("verify", "验证食物增加", "completed", { food: `${beforeFood}->${afterForageFood}`, source: "nearby_berries" });
        return true;
      }
      this.markTaskPhase("plant_scan", "寻找可食用植物", "failed", { reason: "preferred_berries_unavailable_after_scan" });
    }

    if (!animal && explicitTarget) {
      this.markTaskPhase("approach_hint", "接近LLM给出的食物搜索坐标", "active", { position: explicitTarget, radius: searchRadius });
      const reachedHint = await this.gotoNear(explicitTarget.x, explicitTarget.y, explicitTarget.z, 5, {
        label: "hunt_food_target_position",
        timeoutMs: Math.min(Math.max(this.config.survival.actionTimeoutMs * 2, 9000), 16000),
        learnPosition: explicitTarget,
        target: requestedTarget ?? "food_search_position",
        radius: searchRadius
      });
      this.rememberExplorationTarget(explicitTarget, { reached: reachedHint, purpose: "hunt_food_target_position" });
      ({ animal, landAnimal, aquaticAnimal, candidates } = this.selectHuntFoodTarget({
        searchRadius,
        allowAquaticHunt,
        maxAquaticDistance,
        maxAquaticVerticalDelta,
        maxLandDistance,
        blacklist: this._huntFoodUnreachableBlacklist
      }));
      this.markTaskPhase("approach_hint", "接近LLM给出的食物搜索坐标", animal ? "completed" : "failed", {
        reachedHint,
        foundTarget: animal?.name ?? null
      });
      strategy = landAnimal ? "land_target" : (aquaticAnimal ? "aquatic_visible_range" : "none");
    }

    if (!animal) {
      this.markTaskPhase("plant_scan", "寻找可食用植物", "active", { reason: "no_nearby_food_mob" });
      const foraged = await this.forageNearbyFood();
      if (foraged) {
        const afterForageFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
        this.markTaskPhase("verify", "验证食物增加", "completed", { food: `${beforeFood}->${afterForageFood}`, source: "forage_food" });
        return true;
      }
      this.markTaskPhase("fallback", "失败后探索/换目标", "active", { reason: "no_food_source_found" });
      this.logger.info("action=hunt_food; no nearby food mobs, exploring for animals");
      const moved = await this.explore({ blockedTask: "hunt_food", reason: "no_food_source_found" });
      this.recordActionFailure("hunt_food", "no_food_source_found", this.bot.entity?.position, { target: "food", radius: searchRadius, moved });
      return false;
    }

    const equippedWeapon = await this.ensureHuntingWeapon();
    this.markTaskPhase("prepare", "准备武器与状态", "completed", { food: beforeFood, weaponReady: Boolean(equippedWeapon), weapon: equippedWeapon, strategy });

    const animalDistance = animal.position.distanceTo(this.bot.entity.position);
    this.markTaskPhase("food_source_found", "发现食物源", "completed", {
      target: animal.name,
      distance: animalDistance.toFixed(1),
      position: animal.position,
      strategy
    });
    this.markTaskPhase("track_animal", "追踪食物目标", "completed", {
      target: animal.name,
      distance: animalDistance.toFixed(1),
      strategy
    });

    this.logger.info(`action=hunt_food; target=${animal.name}; strategy=${strategy}; distance=${animalDistance.toFixed(1)}; food=${beforeFood}`);

    this.markTaskPhase("approach_animal", "接近动物", "active", { target: animal.name, distance: animalDistance.toFixed(1), position: animal.position, strategy });
    const approachRange = aquaticAnimal ? 4 : 2.5;
    if (this.isLowOxygen()) {
      this.markTaskPhase("risk_response", "低氧撤离", "risk", { target: animal.name, oxygen: this.bot.oxygenLevel ?? null, strategy });
      this.recordTaskObservation("risk", "hunt_food interrupted by low oxygen", { target: animal.name, oxygen: this.bot.oxygenLevel ?? null, position: this.feedbackPosition(this.bot.entity?.position) }, "warn");
      await this.escapeLowOxygen({ reason: "hunt_food_approach", target: animal.name });
      this.recordActionFailure("hunt_food", "low_oxygen_escape", animal.position, { target: animal.name, radius: aquaticAnimal ? 5 : 8, taskFeedback: false });
      return false;
    }
    const reachedAnimal = await this.gotoEntity(animal, approachRange, {
      label: "hunt_food_target",
      timeoutMs: aquaticAnimal
        ? Math.min(Math.max(this.config.survival.actionTimeoutMs * 2, 9000), 14000)
        : Math.min(this.config.survival.actionTimeoutMs, 9000),
      segmentTimeoutMs: aquaticAnimal ? 650 : undefined,
      learnPosition: animal.position,
      target: animal.name,
      radius: aquaticAnimal ? Math.min(Math.max(animalDistance, 8), maxAquaticDistance) : 8,
      taskFeedback: false,
      tolerance: aquaticAnimal ? 2.5 : 1.5,
      abortOnLowOxygen: aquaticAnimal
    });

    const maxAttackDistance = aquaticAnimal ? 8 : 6;
    let attackTarget = this.bot.entities[animal.id] ?? animal;
    const currentAnimalDistance = this.hasValidPosition(attackTarget?.position) && this.hasValidPosition(this.bot.entity?.position)
      ? attackTarget.position.distanceTo(this.bot.entity.position)
      : Infinity;
    if (this.isLowOxygen()) {
      this.markTaskPhase("risk_response", "低氧撤离", "risk", { target: animal.name, oxygen: this.bot.oxygenLevel ?? null, strategy });
      this.recordTaskObservation("risk", "hunt_food interrupted by low oxygen", { target: animal.name, oxygen: this.bot.oxygenLevel ?? null, position: this.feedbackPosition(this.bot.entity?.position) }, "warn");
      await this.escapeLowOxygen({ reason: "hunt_food_approach", target: animal.name });
      this.recordActionFailure("hunt_food", "low_oxygen_escape", attackTarget?.position ?? animal.position, { target: animal.name, radius: aquaticAnimal ? 5 : 8, taskFeedback: false });
      return false;
    }
    if (!reachedAnimal || !this.bot.entities[animal.id] || currentAnimalDistance > maxAttackDistance) {
      // 加入黑名单
      this._huntFoodUnreachableBlacklist.set(animal.id, {
        name: animal.name,
        pos: animal.position,
        expiresAt: now + this._huntFoodBlacklistDecayMs
      });
      if (this._huntFoodUnreachableBlacklist.size > this._huntFoodBlacklistMax) {
        // 移除最早的
        const oldest = [...this._huntFoodUnreachableBlacklist.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
        if (oldest) this._huntFoodUnreachableBlacklist.delete(oldest[0]);
      }
      this._huntFoodLastUnreachable = animal;
      this.markTaskPhase("approach_animal", "接近动物", "failed", { target: animal.name, reason: "target_unreachable", position: attackTarget?.position ?? animal.position, distance: Number.isFinite(currentAnimalDistance) ? currentAnimalDistance.toFixed(1) : null, strategy });
      this.recordTaskObservation("learning", "hunt_food target unreachable", { target: animal.name, position: attackTarget?.position ?? animal.position, radius: aquaticAnimal ? 5 : 8, strategy }, "warn");
      this.recordActionFailure("hunt_food", "target_unreachable", attackTarget?.position ?? animal.position, { target: animal.name, radius: aquaticAnimal ? 5 : 8 });
      this.markTaskPhase("plant_scan", "寻找可食用植物", "active", { reason: "animal_target_unreachable", strategy });
      const foraged = await this.forageNearbyFood();
      if (!foraged) {
        this.markTaskPhase("fallback", "失败后探索/换目标", "active", { reason: "animal_unreachable_and_no_plant_food", strategy });
        await this.explore({ blockedTask: "hunt_food", reason: "animal_unreachable_and_no_plant_food" });
      }
      return Boolean(foraged);
    }

    const attackDeadline = Date.now() + this.config.survival.actionTimeoutMs;
    this.markTaskPhase("approach_animal", "接近动物", "completed", { target: attackTarget.name, distance: currentAnimalDistance.toFixed(1), strategy, mode: "entity_follow" });
    this.markTaskPhase("attack_animal", "攻击动物", "active", { target: attackTarget.name, timeoutMs: this.config.survival.actionTimeoutMs, strategy });
    this.bot.pvp.attack(attackTarget);
    try {
      while (Date.now() < attackDeadline && this.bot.entities[animal.id]) {
        attackTarget = this.bot.entities[animal.id] ?? attackTarget;
        if (this.isLowOxygen()) {
          this.logger.warn(`action=hunt_food; interrupted by low oxygen=${this.bot.oxygenLevel ?? "unknown"}`);
          this.markTaskPhase("risk_response", "低氧撤离", "risk", { target: attackTarget.name, oxygen: this.bot.oxygenLevel ?? null, strategy });
          this.recordTaskObservation("risk", "hunt_food interrupted by low oxygen", { target: attackTarget.name, oxygen: this.bot.oxygenLevel ?? null, position: this.feedbackPosition(this.bot.entity?.position) }, "warn");
          this.bot.pvp.stop();
          await this.escapeLowOxygen({ reason: "hunt_food_attack", target: attackTarget.name });
          this.recordActionFailure("hunt_food", "low_oxygen_escape", attackTarget.position, { target: attackTarget.name, radius: aquaticAnimal ? 5 : 8, taskFeedback: false });
          return false;
        }
        const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
        if (threat) {
          this.logger.warn(`action=hunt_food; interrupted by ${threat.name}`);
          this.markTaskPhase("risk_response", "躲避怪物或植物伤害", "risk", { threat: threat.name, distance: threat.position.distanceTo(this.bot.entity.position).toFixed(1) });
          this.recordTaskObservation("risk", "hunt_food interrupted by hostile", { threat: threat.name, position: threat.position }, "warn");
          this.bot.pvp.stop();
          await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
          this.recordActionFailure("hunt_food", "interrupted_by_hostile", threat.position, { target: threat.name, radius: this.config.survival.threatRadius });
          return false;
        }
        const distance = this.hasValidPosition(attackTarget?.position) && this.hasValidPosition(this.bot.entity?.position)
          ? attackTarget.position.distanceTo(this.bot.entity.position)
          : Infinity;
        if (this.hasValidPosition(attackTarget?.position)) {
          await this.bot.lookAt?.(attackTarget.position.offset(0, 0.8, 0), true);
        }
        if (distance <= 4.5 && typeof this.bot.attack === "function") {
          try {
            this.bot.attack(attackTarget);
          } catch (error) {
            this.logger.debug("manual hunt attack failed", error.message);
          }
        }
        await this.wait(500);
      }
    } finally {
      this.bot.pvp.stop();
    }

    this.markTaskPhase("collect_drops", "拾取掉落物", "active", { target: animal.name, strategy });
    await this.collectNearbyItems();
    const afterFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    const gainedFood = afterFood - beforeFood;
    this.markTaskPhase("verify", "验证食物增加", gainedFood > 0 ? "completed" : "failed", {
      target: animal.name,
      food: `${beforeFood}->${afterFood}`,
      gainedFood,
      strategy
    });

    if (gainedFood > 0) {
      this.recordActionSuccess("hunt_food", animal.position, { target: animal.name, gainedFood });
      this.logger.info(`action=hunt_food; target=${animal.name}; result=success; strategy=${strategy}; food=${beforeFood}->${afterFood}; gained=${gainedFood}`);
      return true;
    }
    if (!this.bot.entities[animal.id]) {
      this.recordActionFailure("hunt_food", "no_food_drop_collected", animal.position, { target: animal.name, radius: aquaticAnimal ? 5 : 8 });
      this.logger.warn(`action=hunt_food; target=${animal.name}; result=no_food_drop_collected; strategy=${strategy}; food=${beforeFood}->${afterFood}`);
      return false;
    }

    this.recordActionFailure("hunt_food", "no_food_gain", animal.position, { target: animal.name, radius: aquaticAnimal ? 5 : 8 });
    this.logger.info(`action=hunt_food; target=${animal.name}; result=no_food_gain; strategy=${strategy}; food=${beforeFood}->${afterFood}`);
    return false;
  }

  isHuntFoodTarget(entity, options = {}) {
    if (!entity || !entity.name || !FOOD_MOBS.has(entity.name)) return false;
    // 黑名单过滤
    if (options.blacklist && options.blacklist.has(entity.id)) return false;
    const botPosition = this.bot.entity?.position;
    if (!this.hasValidPosition(botPosition) || !this.hasValidPosition(entity.position)) return false;

    const distance = entity.position.distanceTo(botPosition);
    const verticalDelta = Math.abs(entity.position.y - botPosition.y);
    const isAquatic = AQUATIC_FOOD_MOBS.has(entity.name);
    if (!isAquatic) {
      const maxLandDistance = options.maxLandDistance ?? (this.config.survival.foodSearchRadius ?? 48);
      const maxLandVerticalDelta = options.maxLandVerticalDelta ?? 12;
      return distance <= maxLandDistance && verticalDelta <= maxLandVerticalDelta;
    }

    if (!options.allowAquaticHunt) return false;
    const maxAquaticDistance = options.maxAquaticDistance ?? 6;
    const maxAquaticVerticalDelta = options.maxAquaticVerticalDelta ?? 2;
    if (verticalDelta > maxAquaticVerticalDelta) return false;
    return distance <= maxAquaticDistance;
  }

  selectHuntFoodTarget(options = {}) {
    const searchRadius = options.searchRadius ?? this.config.survival.foodSearchRadius ?? 48;
    const lowFood = this.config.survival.lowFood ?? 14;
    const criticalHealth = this.config.survival.criticalHealth ?? 8;
    const allowAquaticHunt = options.allowAquaticHunt ?? ((this.bot.food ?? 20) <= lowFood || (this.bot.health ?? 20) <= criticalHealth);
    const maxAquaticDistance = options.maxAquaticDistance ?? (allowAquaticHunt ? Math.min(searchRadius, 48) : 4);
    const maxAquaticVerticalDelta = options.maxAquaticVerticalDelta ?? (allowAquaticHunt ? 6 : 2);
    const maxLandDistance = options.maxLandDistance ?? searchRadius;
    const blacklist = options.blacklist;

    // 收集所有候选目标
    const candidates = Object.values(this.bot?.entities ?? {})
      .filter(entity => this.isHuntFoodTarget(entity, { allowAquaticHunt, maxAquaticDistance, maxAquaticVerticalDelta, maxLandDistance, blacklist }))
      .sort((left, right) => left.position.distanceTo(this.bot.entity.position) - right.position.distanceTo(this.bot.entity.position));
    // 优先陆地动物
    const landAnimal = candidates.find(entity => this.isHuntFoodTarget(entity, { allowAquaticHunt: false, maxLandDistance, blacklist }));
    // 其次水生动物
    const aquaticAnimal = candidates.find(entity => AQUATIC_FOOD_MOBS.has(entity.name));
    return { animal: landAnimal ?? aquaticAnimal, landAnimal, aquaticAnimal, candidates };
  }

  findMatureBerryBushes(maxDistance = this.config.survival.foodSearchRadius ?? 48, count = 16) {
    const berryBlock = this.mcData?.blocksByName?.sweet_berry_bush;
    if (!berryBlock || typeof this.bot?.findBlocks !== "function") return [];
    return this.bot.findBlocks({ matching: berryBlock.id, maxDistance, count })
      .map((position) => this.bot.blockAt(position))
      .filter((block) => block && this.isMatureBerryBush(block))
      .sort((left, right) => left.position.distanceTo(this.bot.entity.position) - right.position.distanceTo(this.bot.entity.position));
  }

  foodTerrainRiskSummary({ animal = null, aquaticAnimal = null } = {}) {
    let terrain = null;
    try {
      terrain = this.buildLocalTerrainSnapshot?.(this.bot.entity?.position) ?? null;
    } catch {
      terrain = null;
    }
    const terrainNames = new Set();
    if (terrain?.primaryGround) terrainNames.add(terrain.primaryGround);
    for (const entry of terrain?.ground ?? []) {
      if (entry?.name) terrainNames.add(entry.name);
    }
    for (const entry of terrain?.nearbyWater ?? []) {
      if (entry?.name) terrainNames.add(entry.name);
    }
    const coldOrIcyTerrain = [...terrainNames].some((name) => /snow|ice|frozen|powder_snow/i.test(name));
    const waterPressure = (terrain?.waterSamples ?? 0) >= 4 || (terrain?.nearbyWater?.length ?? 0) >= 3;
    const aquaticDistance = this.hasValidPosition((aquaticAnimal ?? animal)?.position) && this.hasValidPosition(this.bot.entity?.position)
      ? (aquaticAnimal ?? animal).position.distanceTo(this.bot.entity.position)
      : Infinity;
    return {
      terrainKnown: Boolean(terrain),
      coldOrIcyTerrain,
      waterPressure,
      aquaticDistance,
      aquaticRisk: Boolean(aquaticAnimal) && (
        coldOrIcyTerrain
        || waterPressure
        || aquaticDistance > 12
        || this.isLowOxygen()
      )
    };
  }

  shouldPreferNearbyBerryFood({ animal = null, landAnimal = null, aquaticAnimal = null, beforeFood = 0, parameters = {} } = {}) {
    const radius = this.config.survival.berryPriorityRadius ?? 18;
    const nearbyBerries = this.findMatureBerryBushes(radius, 8);
    if (nearbyBerries.length === 0) return false;
    const target = typeof parameters.target === "string" ? parameters.target.toLowerCase() : "";
    const berryTargets = new Set(["berry", "berries", "sweet_berry_bush", "sweet_berries"]);
    if (berryTargets.has(target)) return true;
    if (target && !["food", "animal", "mob"].includes(target) && !AQUATIC_FOOD_MOBS.has(target)) return false;
    if (!animal) return true;

    const nearestBerryDistance = nearbyBerries[0].position.distanceTo(this.bot.entity.position);
    const animalDistance = this.hasValidPosition(animal.position) ? animal.position.distanceTo(this.bot.entity.position) : Infinity;
    const risk = this.foodTerrainRiskSummary({ animal, aquaticAnimal });
    const hasReliableWeapon = Boolean(this.inventoryItemByPreference(STONE_OR_BETTER_WEAPONS));

    if (aquaticAnimal && (!landAnimal || animal.id === aquaticAnimal.id)) {
      if (risk.aquaticRisk) return true;
      return nearestBerryDistance <= 8 && animalDistance > 12;
    }

    if (landAnimal && animal.id === landAnimal.id) {
      return !hasReliableWeapon && nearestBerryDistance <= 6 && animalDistance > 14;
    }

    const lowFood = this.config.survival.lowFood ?? 14;
    const starterFoodTarget = this.config.survival.starterFoodTarget ?? Math.min(6, this.config.survival.foodStockTarget ?? 6);
    const earlyFoodBuffer = beforeFood < starterFoodTarget || (this.bot.food ?? 20) <= lowFood;
    if (earlyFoodBuffer && nearestBerryDistance <= 8 && animalDistance > 12) return true;
    return false;
  }

  async forageNearbyFood(options = {}) {
    const berryBlock = this.mcData.blocksByName.sweet_berry_bush;
    if (!berryBlock) {
      this.markTaskPhase("plant_scan", "寻找可食用植物", "skipped", { reason: "sweet_berry_bush_not_in_version" });
      return false;
    }

    const maxBerryBushes = options.maxBerryBushes ?? Math.max(12, Math.min(64, Number(this.config.survival.foodStockTarget) || 12));
    const searchRadius = options.maxDistance ?? this.config.survival.foodSearchRadius;
    const positions = this.bot.findBlocks({ matching: berryBlock.id, maxDistance: searchRadius, count: maxBerryBushes });
    const bushes = positions
      .map((position) => this.bot.blockAt(position))
      .filter((block) => block && this.isMatureBerryBush(block));
    if (bushes.length === 0) {
      this.markTaskPhase("plant_scan", "寻找可食用植物", "failed", { checkedPositions: positions.length, reason: "no_mature_berry_bush" });
      return false;
    }

    const beforeFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    this.markTaskPhase("plant_scan", "寻找可食用植物", "completed", { matureBushes: bushes.length, food: beforeFood });
    this.logger.info(`action=forage_food; mature_berry_bushes=${bushes.length}; food=${beforeFood}`);
    let failedHarvestAttempts = 0;

    for (const bush of bushes) {
      this.markTaskPhase("food_source_found", "发现食物源", "completed", { target: "sweet_berry_bush", position: bush.position });
      if (this.shouldAbortCurrentAction()) {
        this.markTaskPhase("risk_response", "躲避怪物或植物伤害", "risk", { reason: "emergency_interrupted" });
        this.logger.warn("action=forage_food; aborted because emergency handling interrupted current action");
        break;
      }

      if (this.isLearnedAvoidPosition(bush.position, "forage_food", "sweet_berry_bush")) {
        this.recordTaskObservation("learning", "skipped learned risky berry bush", { target: "sweet_berry_bush", position: bush.position }, "warn");
        this.logger.info(`action=forage_food; skipped learned risky bush at ${this.formatPosition(bush.position)}`);
        continue;
      }

      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=forage_food; interrupted by ${threat.name}`);
        this.markTaskPhase("risk_response", "躲避怪物或植物伤害", "risk", { threat: threat.name, position: threat.position });
        this.recordTaskObservation("risk", "forage_food interrupted by hostile", { threat: threat.name, position: threat.position }, "warn");
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }

      this.markTaskPhase("approach_plant", "接近安全采集位", "active", { target: "sweet_berry_bush", position: bush.position });
      const safePositions = this.findSafeBerryHarvestStandPositions(bush.position)
        .filter((position) => !this.isLearnedAvoidPosition(position, "forage_food", "sweet_berry_bush"))
        .slice(0, 3);
      if (safePositions.length === 0) {
        this.logger.warn(`action=forage_food; skipped bush without safe adjacent position at ${this.formatPosition(bush.position)}`);
        this.markTaskPhase("approach_plant", "接近安全采集位", "failed", { target: "sweet_berry_bush", reason: "no_safe_adjacent_position", position: bush.position });
        this.recordTaskObservation("learning", "berry bush has no safe adjacent position", { target: "sweet_berry_bush", position: bush.position }, "warn");
        this.recordActionFailure("forage_food", "no_safe_adjacent_position", bush.position, { target: "sweet_berry_bush", radius: 5 });
        continue;
      }

      const safePosition = await this.reachFirstSafeBerryPosition(safePositions);
      if (!safePosition) {
        if (this.shouldAbortCurrentAction()) {
          this.markTaskPhase("risk_response", "躲避怪物或植物伤害", "risk", { reason: "emergency_interrupted_pathing" });
          this.logger.warn("action=forage_food; stopped after emergency interrupted berry pathing");
          break;
        }
        failedHarvestAttempts++;
        this.markTaskPhase("approach_plant", "接近安全采集位", "failed", { target: "sweet_berry_bush", reason: "safe_position_unreachable", attempts: failedHarvestAttempts });
        if (failedHarvestAttempts >= 2) {
          this.recordTaskObservation("learning", "repeated safe-position failures, switching forage strategy", { attempts: failedHarvestAttempts }, "warn");
          this.logger.warn("action=forage_food; repeated safe-position failures, switching strategy");
          break;
        }
        continue;
      }
      const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.2);
      if (hazard) {
        this.logger.warn(`action=forage_food; stood in hazard=${hazard.name}; escaping before harvest`);
        this.markTaskPhase("risk_response", "躲避怪物或植物伤害", "risk", { hazard: hazard.name, position: hazard.position });
        this.recordTaskObservation("risk", "stood in damaging plant/block while foraging", { hazard: hazard.name, position: hazard.position }, "warn");
        this.recordActionFailure("forage_food", `stood_in_${hazard.name}`, bush.position, { target: "sweet_berry_bush", radius: 6 });
        await this.escapeHazardBlock(hazard);
        continue;
      }

      const currentBush = this.bot.blockAt(bush.position);
      if (!currentBush || !this.isMatureBerryBush(currentBush)) continue;
      this.markTaskPhase("harvest_plant", "采集植物", "active", { target: "sweet_berry_bush", position: currentBush.position });
      await this.bot.lookAt(currentBush.position.offset(0.5, 0.8, 0.5), true);
      await this.bot.activateBlock(currentBush);
      await this.wait(500);
      if (this.shouldAbortCurrentAction()) break;
      this.markTaskPhase("collect_drops", "拾取掉落物", "active", { target: "sweet_berry_bush" });
      await this.collectNearbyItems({ maxDistance: 4, range: 2, avoidDamagingBlocks: true });
      this.recordActionSuccess("forage_food", bush.position, { target: "sweet_berry_bush" });
      const currentFoodCount = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
      if (options.stopAfterFood && currentFoodCount > beforeFood) break;
      if (currentFoodCount >= this.config.survival.foodStockTarget) break;
    }

    const afterFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    this.markTaskPhase("verify", "验证食物增加", afterFood > beforeFood ? "completed" : "failed", { food: `${beforeFood}->${afterFood}`, gainedFood: afterFood - beforeFood, source: "forage_food" });
    this.logger.info(`action=forage_food; food=${beforeFood}->${afterFood}`);
    return afterFood > beforeFood;
  }

  isMatureBerryBush(block) {
    if (block.name !== "sweet_berry_bush") return false;
    const properties = typeof block.getProperties === "function" ? block.getProperties() : {};
    return Number(properties.age ?? 0) >= 2;
  }

  async collectWool() {
    const beforeWool = this.maxStackCount(inventoryFromBot(this.bot), WOOL_ITEMS);
    const sheep = this.nearestEntity((entity) => entity.name === "sheep", this.config.survival.foodSearchRadius);
    if (!sheep) {
      this.logger.info("action=collect_wool; no nearby sheep, exploring for wool source");
      await this.explore();
      return;
    }

    await this.equipBestWeapon();
    this.logger.info(`action=collect_wool; target=sheep; distance=${sheep.position.distanceTo(this.bot.entity.position).toFixed(1)}; wool=${beforeWool}`);
    await this.gotoNear(sheep.position.x, sheep.position.y, sheep.position.z, 3);

    const attackDeadline = Date.now() + this.config.survival.actionTimeoutMs;
    this.bot.pvp.attack(sheep);
    try {
      while (Date.now() < attackDeadline && this.bot.entities[sheep.id]) {
        const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
        if (threat) {
          this.logger.warn(`action=collect_wool; interrupted by ${threat.name}`);
          this.bot.pvp.stop();
          await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
          return;
        }
        await this.wait(500);
      }
    } finally {
      this.bot.pvp.stop();
    }

    await this.collectNearbyItems();
    const afterWool = this.maxStackCount(inventoryFromBot(this.bot), WOOL_ITEMS);
    this.logger.info(`action=collect_wool; wool=${beforeWool}->${afterWool}`);
  }

  async craftBed() {
    await this.craftBasicSupplies();
    let inventory = inventoryFromBot(this.bot);
    if (countItems(inventory, PLANK_ITEMS) < 3) {
      await this.craftPlanks(3);
      inventory = inventoryFromBot(this.bot);
    }

    if (countItems(inventory, PLANK_ITEMS) < 3 || this.maxStackCount(inventory, WOOL_ITEMS) < this.config.survival.woolTarget) {
      this.logger.warn("action=craft_bed; missing planks or same-color wool");
      await this.collectWool();
      return;
    }

    await this.ensurePlacedBlock("crafting_table");
    for (const bedName of BED_ITEMS) {
      if (await this.craftItem(bedName, 1, true)) return;
    }
    this.logger.warn("action=craft_bed; no bed recipe matched current wool colors");
  }

  async collectCropSeeds() {
    const beforeSeeds = countItems(inventoryFromBot(this.bot), CROP_PLANT_ITEMS);
    const forageBlocks = ["short_grass", "tall_grass", "fern", "large_fern", "grass", "wheat", "carrots", "potatoes", "beetroots"];
    this.logger.info(`action=collect_crop_seeds; plantables=${beforeSeeds}`);
    const result = await this.collectBlocks(forageBlocks, 10, 48);
    if (result.interruptedByThreat) return;
    await this.collectNearbyItems();
    const afterSeeds = countItems(inventoryFromBot(this.bot), CROP_PLANT_ITEMS);
    this.logger.info(`action=collect_crop_seeds; plantables=${beforeSeeds}->${afterSeeds}`);
    if (!result.collected && afterSeeds <= beforeSeeds) {
      this.logger.info("action=collect_crop_seeds; no reachable seed source, exploring for farmland inputs");
      await this.explore();
    }
  }

  async craftHoe() {
    if (hasAny(inventoryFromBot(this.bot), HOES)) return true;
    await this.craftBasicSupplies();
    await this.ensurePlacedBlock("crafting_table");
    if (countItems(inventoryFromBot(this.bot), "cobblestone") >= 2) {
      if (await this.craftItem("stone_hoe", 1, true)) return true;
    }
    return this.craftItem("wooden_hoe", 1, true);
  }

  async plantCrops() {
    if (!(await this.craftHoe())) {
      this.logger.warn("action=plant_crops; could not craft hoe");
      await this.collectWood();
      return;
    }

    if (!firstInventoryItem(this.bot, CROP_PLANT_ITEMS)) {
      await this.collectCropSeeds();
      return;
    }

    const soilIds = ["grass_block", "dirt", "coarse_dirt"]
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);
    if (soilIds.length === 0) return;

    const positions = this.bot.findBlocks({ matching: soilIds, maxDistance: 16, count: 32 });
    const soils = positions
      .map((position) => this.bot.blockAt(position))
      .filter((block) => block && this.bot.blockAt(block.position.offset(0, 1, 0))?.name === "air")
      .slice(0, this.config.survival.cropPlotTarget);

    if (soils.length === 0) {
      this.logger.info("action=plant_crops; no open soil nearby, exploring for a farm spot");
      await this.explore();
      return;
    }

    let planted = 0;
    for (const soil of soils) {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=plant_crops; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }

      const plantItem = firstInventoryItem(this.bot, CROP_PLANT_ITEMS);
      if (!plantItem) break;
      await this.gotoNear(soil.position.x, soil.position.y, soil.position.z, 3);
      const hoe = firstInventoryItem(this.bot, HOES);
      if (!hoe) break;
      await this.bot.equip(hoe, "hand");
      try {
        await this.withTimeout(this.bot.activateBlock(soil), this.config.survival.placeBlockTimeoutMs, null);
      } catch (error) {
        this.logger.debug("till soil failed", error.message);
        continue;
      }

      await this.wait(250);
      const farmland = this.bot.blockAt(soil.position);
      if (!farmland || farmland.name !== "farmland") continue;
      await this.bot.equip(plantItem, "hand");
      try {
        await this.withTimeout(this.bot.placeBlock(farmland, new Vec3(0, 1, 0)), this.config.survival.placeBlockTimeoutMs, null);
        planted++;
        await this.wait(250);
      } catch (error) {
        this.logger.debug("plant crop failed", error.message);
      }
    }

    if (planted > 0) {
      this.progressState.plantedCrops += planted;
      this.progressState.hasCropPlot = this.progressState.plantedCrops >= Math.max(2, Math.ceil(this.config.survival.cropPlotTarget / 2));
      this.persistMemory();
    }
    this.logger.info(`action=plant_crops; planted=${planted}; total=${this.progressState.plantedCrops}`);
  }

  async buildAnimalPen() {
    if (!this.hasValidPosition(this.bot.entity.position)) return false;
    await this.craftPlanks(Math.min(24, this.config.survival.animalPenBlockTarget));
    const beforeMaterials = buildingMaterialCount(inventoryFromBot(this.bot));
    if (beforeMaterials < Math.min(8, this.config.survival.animalPenBlockTarget)) {
      await this.collectBuildingMaterials(this.config.survival.animalPenBlockTarget);
      return false;
    }

    const base = this.bot.entity.position.floored();
    const plan = this.createAnimalPenPlan(base);
    let completed = 0;
    let placed = 0;
    this.logger.info(`action=build_animal_pen; origin=${this.formatPosition(base)}; plan=${plan.length}; materials=${beforeMaterials}`);

    for (const position of plan) {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=build_animal_pen; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }
      const result = await this.placeBuildingBlockAt(position);
      if (result.completed) completed++;
      if (result.placed) placed++;
      if (!firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS) && completed < plan.length) break;
    }

    const success = completed >= Math.ceil(plan.length * 0.7);
    if (success) {
      this.progressState.hasAnimalPen = true;
      this.progressState.animalPenPosition = { x: base.x, y: base.y, z: base.z };
      this.persistMemory();
    }
    this.logger.info(`action=build_animal_pen; placed=${placed}; completed=${completed}/${plan.length}; success=${success}`);
    return success;
  }

  createAnimalPenPlan(base) {
    const positions = [];
    const radius = 3;
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const isWall = Math.abs(x) === radius || Math.abs(z) === radius;
        if (isWall) positions.push(base.offset(x, 0, z));
      }
    }
    return positions;
  }

  async lureAnimals() {
    const animal = this.nearestEntity((entity) => FOOD_MOBS.has(entity.name), this.config.survival.foodSearchRadius);
    if (!animal) {
      this.logger.info("action=lure_animals; no nearby passive animals, continuing base work");
      return;
    }

    const bait = this.baitForAnimal(animal.name);
    if (!bait) {
      this.logger.info(`action=lure_animals; no bait for ${animal.name}`);
      return;
    }

    const pen = this.progressState.animalPenPosition || this.bot.entity.position;
    await this.bot.equip(bait, "hand");
    this.logger.info(`action=lure_animals; target=${animal.name}; bait=${bait.name}`);
    await this.gotoNear(animal.position.x, animal.position.y, animal.position.z, 2);
    await this.wait(1200);
    await this.gotoNear(pen.x, pen.y, pen.z, 2);
    await this.wait(1500);

    if (this.bot.entities[animal.id] && animal.position.distanceTo(new Vec3(pen.x, pen.y, pen.z)) <= 7) {
      this.progressState.animalsLured++;
      this.persistMemory();
      this.logger.info(`action=lure_animals; animals_lured=${this.progressState.animalsLured}`);
    }
  }

  async mineAdvancedMaterials() {
    if (!hasAny(inventoryFromBot(this.bot), PICKAXES)) await this.craftBasicTools();
    await this.equipBestWeapon();
    await this.equipBestTool("stone");

    const before = countItems(inventoryFromBot(this.bot), ADVANCED_MATERIAL_ITEMS);
    const needed = Math.max(2, Math.min(8, this.config.survival.advancedMaterialTarget - before));
    this.logger.info(`action=mine_advanced_materials; materials=${before}/${this.config.survival.advancedMaterialTarget}; needed=${needed}`);

    const result = await this.collectBlocks(ADVANCED_ORE_BLOCKS, needed, this.config.survival.mineSearchRadius, {
      action: "mine_advanced_materials",
      safeMining: true,
      maxMineBelow: 1
    });
    if (result.interruptedByThreat) return;
    await this.collectNearbyItems();
    const after = countItems(inventoryFromBot(this.bot), ADVANCED_MATERIAL_ITEMS);
    if (result.collected || after > before) {
      this.logger.info(`action=mine_advanced_materials; materials=${before}->${after}`);
      return;
    }

    this.logger.info("action=mine_advanced_materials; no safe exposed ore found, digging a stair mine probe");
    await this.excavateMineProbe();
  }

  async excavateMineProbe() {
    if (!this.hasValidPosition(this.bot.entity.position)) return;
    const origin = this.bot.entity.position.floored();
    let dug = 0;
    let moved = 0;

    for (const direction of this.prioritizedCardinalDirections()) {
      let directionDug = 0;
      let directionMoved = 0;

      for (const stair of createDescendingStairPlan(origin, direction, 8)) {
        const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
        if (threat) {
          this.logger.warn(`action=dig_mine_probe; interrupted by ${threat.name}`);
          await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
          break;
        }

        if (!this.hasSolidSupport(stair.support)) {
          this.logger.warn(`action=dig_mine_probe; direction=${this.formatPosition(direction)} unsupported at ${this.formatPosition(stair.feet)}`);
          break;
        }

        if (await this.digBlockAt(stair.feet)) directionDug++;
        if (await this.digBlockAt(stair.head)) directionDug++;
        if (!this.isSafeStandPosition(stair.feet)) break;

        const reached = await this.gotoNear(stair.feet.x, stair.feet.y, stair.feet.z, 1, {
          label: "mine_stair",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
          learnPosition: stair.feet,
          target: "stair_probe",
          radius: 6
        });
        if (!reached) break;
        directionMoved++;
        await this.collectNearbyItems({ maxDistance: 5, range: 1, avoidDamagingBlocks: true });
      }

      dug += directionDug;
      moved += directionMoved;
      if (directionMoved > 0) break;
    }

    if (dug > 0) {
      this.progressState.hasMiningEntry = true;
      this.progressState.miningTrips++;
      this.lastStoneWorksitePosition = this.cloneValidPosition(this.bot.entity.position);
      this.lastStoneWorksiteUntil = Date.now() + 90000;
      this.persistMemory();
      await this.collectNearbyItems();
    }
    this.logger.info(`action=dig_mine_probe; mode=stair; dug=${dug}; moved=${moved}; trips=${this.progressState.miningTrips}`);
    return { dug, moved };
  }

  async collectWood(decision = {}) {
          // 兼容测试环境未初始化
          if (!this._collectWoodRetryState) this._collectWoodRetryState = { failCount: 0, lastTerrain: null, lastReset: 0 };
      if (!this._collectWoodSearchRadii) this._collectWoodSearchRadii = [64, 64, 80, 96];
          if (!this._collectWoodTerrains) this._collectWoodTerrains = ["plains", "forest", "near_water", "any"];
          if (typeof this._collectWoodTerrainIdx !== "number") this._collectWoodTerrainIdx = 0;
        // 自适应重试状态衰减
        const now = Date.now();
        if (now - this._collectWoodRetryState.lastReset > this._collectWoodRetryDecayMs) {
          this._collectWoodRetryState = { failCount: 0, lastTerrain: null, lastReset: now };
          this._collectWoodTerrainIdx = 0;
        }
    const parameters = this.taskParametersFromDecision(decision);
    const targetLogs = Math.max(1, this.countFromDecision(decision, 4));
    const targetPosition = this.targetPositionFromDecision(decision);
    const requestedSearchRadius = Number(parameters.searchRadius ?? parameters.radius);
    const toolIntent = parameters.tool ?? "auto";
    this.markTaskPhase("prepare", "准备伐木工具", "active", { targetLogs, targetPosition: this.feedbackPosition(targetPosition), tool: toolIntent });
    this.logger.info("action=collect_wood; searching for nearby logs");
    if (targetPosition && this.distanceBetweenPositions(this.bot.entity.position, targetPosition) > 8) {
      const approach = this.collectWoodTargetApproach(targetPosition);
      const approachPosition = approach?.position ?? targetPosition;
      await this.gotoNear(approachPosition.x, approachPosition.y, approachPosition.z, approach?.range ?? 4, {
        label: "collect_wood_target",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 12000),
        target: approach?.target ?? "known_log",
        learnPosition: targetPosition,
        taskFeedback: false
      });
    }
    if (!(await this.ensureWoodcuttingTool())) {
      await this.unequipHandIfHolding([...PICKAXES, ...HOES, ...WEAPONS.filter((name) => !AXES.includes(name))]);
    }
    if (this.shouldAbortCurrentAction()) {
      this.logger.warn("action=collect_wood; aborted because emergency handling interrupted current action");
      return false;
    }
    this.markTaskPhase("prepare", "准备伐木工具", "completed", { toolReady: true });

    const startingLogs = countItems(inventoryFromBot(this.bot), LOG_BLOCKS);
    let currentLogs = startingLogs;
    let collectedAny = false;
    const approachedKnownLogs = new Set();

    for (let attempt = 0; attempt < 4 && currentLogs - startingLogs < targetLogs; attempt++) {
      // 动态调整搜索半径和地形
      let searchRadius = Number.isFinite(requestedSearchRadius)
        ? Math.max(8, Math.min(96, requestedSearchRadius))
        : this._collectWoodSearchRadii[Math.min(this._collectWoodRetryState.failCount, this._collectWoodSearchRadii.length - 1)];
      let terrain = parameters.preferredTerrain ?? this._collectWoodTerrains[this._collectWoodTerrainIdx] ?? "any";
      const neededLogs = Math.max(1, targetLogs - (currentLogs - startingLogs));
      this.markTaskPhase("search", "搜索低位可达树干", "active", { attempt: attempt + 1, neededLogs, searchRadius, terrain });
      const result = await this.collectBlocks(LOG_BLOCKS, neededLogs, searchRadius, {
        action: "collect_wood",
        lowestPerColumn: true,
        maxTargetAbove: 5,
        requireReachableStand: true,
        preferredTerrain: terrain !== "any" ? terrain : undefined
      });

      if (result.interruptedByThreat) {
        this.markTaskPhase("risk_response", "威胁/危险方块中断", "risk", { reason: "interrupted_by_threat" });
        return false;
      }
      if (this.shouldAbortCurrentAction()) {
        this.markTaskPhase("risk_response", "紧急处理打断", "risk", { reason: "emergency_interrupted" });
        this.logger.warn("action=collect_wood; stopped after emergency interrupted collection");
        return false;
      }

      const nextLogs = countItems(inventoryFromBot(this.bot), LOG_BLOCKS);
      const gainedLogs = nextLogs > currentLogs;
      collectedAny = collectedAny || result.collected || gainedLogs;
      currentLogs = nextLogs;
      this.markTaskPhase("verify", "验证原木入包", gainedLogs ? "completed" : "active", {
        logs: `${startingLogs}->${currentLogs}`,
        gainedLogs: nextLogs - startingLogs,
        searchRadius,
        terrain
      });

      if (!result.collected && !gainedLogs) {
        const knownApproach = await this.approachKnownWoodTarget(approachedKnownLogs);
        if (knownApproach.moved && !this.shouldAbortCurrentAction()) {
          await this.wait(150);
          continue;
        }
        // 失败计数+1，必要时切换地形
        this._collectWoodRetryState.failCount++;
        if (this._collectWoodRetryState.failCount >= this._collectWoodSearchRadii.length && this._collectWoodTerrainIdx < this._collectWoodTerrains.length - 1) {
          this._collectWoodTerrainIdx++;
          this._collectWoodRetryState.failCount = 0;
          this.logger.warn(`collect_wood: 切换地形类型为 ${this._collectWoodTerrains[this._collectWoodTerrainIdx]}`);
        }
        break;
      }
      await this.wait(150);
    }

    if (collectedAny || currentLogs > startingLogs) {
      // 成功则重置重试状态
      this._collectWoodRetryState = { failCount: 0, lastTerrain: null, lastReset: Date.now() };
      this._collectWoodTerrainIdx = 0;
      return true;
    }

    if (this.shouldAbortCurrentAction()) {
      this.markTaskPhase("risk_response", "紧急处理打断", "risk", { reason: "emergency_interrupted_before_explore" });
      this.logger.warn("action=collect_wood; skipped fallback exploration because emergency handling interrupted current action");
      return false;
    }

    this.markTaskPhase("fallback", "探索新树点", "active", { reason: "no_reachable_logs" });
    this.logger.info("action=collect_wood; no reachable logs found, exploring for trees");
    // 切换地形后探索新区域
    if (this._collectWoodTerrainIdx < this._collectWoodTerrains.length - 1) {
      this._collectWoodTerrainIdx++;
      this.logger.warn(`collect_wood: fallback 切换地形类型为 ${this._collectWoodTerrains[this._collectWoodTerrainIdx]}`);
    }
    const moved = await this.explore({ blockedTask: "collect_wood", reason: "no_reachable_logs", preferredTerrain: this._collectWoodTerrains[this._collectWoodTerrainIdx] });
    return Boolean(moved);
  }

  async approachKnownWoodTarget(excludedKeys = new Set()) {
    if (!this.hasValidPosition(this.bot.entity?.position)) return { moved: false, tried: 0 };
    const maxDistance = Math.max(128, this.config.memory?.knownBlockSearchRadius ?? 96, this.config.survival?.mineSearchRadius ?? 64);
    const targets = this.knownLogTargets(this.bot.entity.position, maxDistance, excludedKeys).slice(0, 4);
    for (const target of targets) {
      excludedKeys.add(target.key);
      const approach = this.collectWoodTargetApproach(target.position);
      const approachPosition = approach?.position ?? target.position;
      this.markTaskPhase("approach_known_log", "接近记忆中的树干", "active", {
        target: target.name,
        log: this.feedbackPosition(target.position),
        stand: this.feedbackPosition(approachPosition),
        distance: target.distance.toFixed(1)
      });
      this.logger.info(`action=collect_wood; approaching_known_log=${target.name}; log=${this.formatPosition(target.position)}; stand=${this.formatPosition(approachPosition)}; distance=${target.distance.toFixed(1)}`);
      const reached = await this.gotoNear(approachPosition.x, approachPosition.y, approachPosition.z, approach?.range ?? 6, {
        label: "collect_wood_known_log",
        timeoutMs: Math.min(Math.max((this.config.survival?.actionTimeoutMs ?? 10000) * 2, 12000), 20000),
        learnPosition: target.position,
        target: approach?.target ?? target.name,
        radius: 12,
        taskFeedback: false
      });
      this.markTaskPhase("approach_known_log", "接近记忆中的树干", reached ? "completed" : "failed", {
        target: target.name,
        reached,
        log: this.feedbackPosition(target.position),
        stand: this.feedbackPosition(approachPosition)
      });
      if (reached) return { moved: true, target };
      if (this.shouldAbortCurrentAction()) return { moved: false, tried: targets.length, aborted: true };
    }
    return { moved: false, tried: targets.length };
  }

  collectWoodTargetApproach(targetPosition) {
    if (!this.hasValidPosition(targetPosition) || !this.hasValidPosition(this.bot.entity?.position)) return null;
    const targetBlock = this.bot.blockAt?.(targetPosition);
    const targetBlockPosition = targetBlock?.position ?? targetPosition.floored?.() ?? targetPosition;
    const standPositions = [
      ...this.findSafeMiningStandPositions(targetBlockPosition),
      ...this.findSafeAdjacentStandPositions(targetBlockPosition)
    ].filter((position, index, all) => all.findIndex((candidate) => this.sameBlockPosition(candidate, position)) === index);

    if (standPositions.length > 0) {
      return {
        position: standPositions[0],
        range: 1,
        target: targetBlock && LOG_BLOCKS.includes(targetBlock.name) ? "known_log_stand" : "known_target_stand"
      };
    }

    const botFeet = this.bot.entity.position.floored();
    const groundedTarget = new Vec3(Math.floor(targetPosition.x), botFeet.y, Math.floor(targetPosition.z));
    const groundStandPositions = [
      ...this.findSafeAdjacentStandPositions(groundedTarget),
      ...this.findSafeMiningStandPositions(groundedTarget)
    ].filter((position, index, all) => all.findIndex((candidate) => this.sameBlockPosition(candidate, position)) === index);

    if (groundStandPositions.length > 0) {
      return { position: groundStandPositions[0], range: 2, target: "known_log_area" };
    }
    return { position: groundedTarget, range: 6, target: "known_log_area" };
  }

  async waitOutNight() {
    this.resetMotion();
    let hasUsableStarterShelter = this.hasUsableStarterShelterAt(this.bot.entity.position);
    let fortified = hasUsableStarterShelter ? await this.fortifyStarterShelterForNight() : false;
    if (!hasUsableStarterShelter && this.progressState.hasStarterShelter && this.starterShelterBase()) {
      const returned = await this.returnToStarterShelterForNight();
      hasUsableStarterShelter = returned && this.hasUsableStarterShelterAt(this.bot.entity.position);
      fortified = hasUsableStarterShelter;
    }
    if (!hasUsableStarterShelter || !fortified) {
      if (this.progressState.hasStarterShelter && !hasUsableStarterShelter) {
        this.logger.warn("action=wait_out_night; remembered starter shelter could not be reached or verified, building emergency shelter if possible");
      }
      await this.buildSimpleShelter();
    }
    this.logger.info(`action=wait_out_night; time=${this.bot.time?.timeOfDay ?? "unknown"}; holding position until safer`);
    await this.holdPositionSafely();
  }

  async returnToStarterShelterForNight() {
    const base = this.starterShelterBase();
    if (!base || !this.hasValidPosition(this.bot.entity?.position)) return false;
    if (this.hasUsableStarterShelterAt(this.bot.entity.position)) return this.fortifyStarterShelterForNight();

    const closeHostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), (this.config.survival.immediateThreatRadius ?? 8) + 2);
    if (closeHostile) {
      this.logger.warn(`action=return_starter_shelter; blocked_by=${closeHostile.name}; distance=${closeHostile.position.distanceTo(this.bot.entity.position).toFixed(1)}`);
      return false;
    }

    const distance = this.distanceBetweenPositions(this.bot.entity.position, base);
    this.logger.info(`action=return_starter_shelter; target=${this.formatPosition(base)}; distance=${distance.toFixed(1)}`);
    const reached = await this.gotoNear(base.x, base.y, base.z, 2, {
      label: "return_starter_shelter",
      timeoutMs: Math.min(Math.max(this.config.survival.actionTimeoutMs * 2, 12000), 22000),
      learnPosition: base,
      target: "starter_shelter",
      radius: Math.max(8, Math.min(64, Math.ceil(distance)))
    });
    if (!reached) {
      this.logger.warn(`action=return_starter_shelter; result=unreachable; target=${this.formatPosition(base)}`);
      return false;
    }

    const status = this.getStarterShelterStatus(this.bot.entity.position);
    if (!status.isNear) {
      this.logger.warn(`action=return_starter_shelter; result=arrived_too_far; distance=${status.distance?.toFixed?.(1) ?? status.distance}`);
      return false;
    }

    const fortified = await this.fortifyStarterShelterForNight();
    if (!fortified) this.logger.warn(`action=return_starter_shelter; result=not_defensible; target=${this.formatPosition(base)}`);
    return fortified && this.hasUsableStarterShelterAt(this.bot.entity.position);
  }

  async buildSimpleShelter() {
    const shelterItem = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
    if (!shelterItem || !this.hasValidPosition(this.bot.entity.position)) return false;

    await this.bot.equip(shelterItem, "hand");
    const base = this.bot.entity.position.floored();
    const plan = createEmergencyShelterPlan(base);

    let placed = 0;
    let completed = 0;
    for (const position of plan) {
      if (!firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS)) break;
      const target = this.bot.blockAt(position);
      if (target?.boundingBox === "block") {
        completed++;
        continue;
      }
      const result = await this.placeBuildingBlockAt(position);
      if (result.placed) placed++;
      if (result.completed || this.bot.blockAt(position)?.boundingBox === "block") completed++;
    }

    const success = completed >= Math.ceil(plan.length * 0.84);
    const doorInstalled = success ? await this.installEmergencyShelterDoor(base) : false;
    if (placed > 0 || completed > 0) this.logger.info(`action=build_simple_shelter; mode=${doorInstalled ? "door" : "sealed"}; placed=${placed}; completed=${completed}/${plan.length}; door=${doorInstalled}; success=${success}`);
    return success;
  }

  isEmergencyShelterShellAt(base) {
    if (!this.hasValidPosition(base)) return false;
    const plan = createEmergencyShelterPlan(base);
    const completed = plan.filter((position) => this.isDefensiveShelterBlock(position)).length;
    return completed >= Math.ceil(plan.length * 0.84);
  }

  async ensureEmergencyShelterExit() {
    if (this.emergencyShelterExitBusy) return false;
    if (typeof this.bot.blockAt !== "function") return false;
    if (!this.hasValidPosition(this.bot.entity?.position)) return false;
    const base = this.bot.entity.position.floored();
    const doorwayPlan = createEmergencyShelterDoorwayPlan(base);
    if (!this.isEmergencyShelterShellAt(base)) return false;

    this.emergencyShelterExitBusy = true;
    try {
      if (this.isDoorwayInstalled(doorwayPlan)) {
        await this.openDoorwayDoors(doorwayPlan);
        if (!this.isNight()) return this.moveThroughEmergencyShelterDoorway(base);
        return true;
      }

      if (this.isDoorwayPassable(doorwayPlan) && !this.isNight()) return this.moveThroughEmergencyShelterDoorway(base);
      if (await this.installEmergencyShelterDoor(base)) {
        if (!this.isNight()) await this.moveThroughEmergencyShelterDoorway(base);
        return true;
      }
      if (this.isNight()) return false;

      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.immediateThreatRadius ?? 8);
      if (threat) return false;

      let opened = false;
      for (const position of doorwayPlan) {
        const block = this.bot.blockAt(position);
        if (!block || block.name === "air" || this.isDoorBlock(block)) continue;
        if (await this.digBlockAt(position)) opened = true;
      }
      if (opened) this.logger.warn(`action=create_emergency_shelter_doorway; pos=${this.formatPosition(base)}; mode=daylight_repair`);
      if (opened) await this.moveThroughEmergencyShelterDoorway(base);
      return opened;
    } finally {
      this.emergencyShelterExitBusy = false;
    }
  }

  isDoorwayPassable(doorwayPlan) {
    return doorwayPlan.every((position) => {
      const block = this.bot.blockAt(position);
      return !block || block.name === "air" || this.isDoorBlock(block);
    });
  }

  async moveThroughEmergencyShelterDoorway(base) {
    if (typeof this.bot.pathfinder?.goto !== "function") return false;
    const outside = base.offset(0, 0, -2);
    if (!this.isSafeStandPosition(outside)) return false;
    await this.wait(250);
    const reached = await this.gotoNear(outside.x, outside.y, outside.z, 1, {
      label: "emergency_exit_step",
      timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 2500),
      learnPosition: outside,
      target: "emergency_shelter_exit",
      radius: 3
    });
    if (reached && this.isBeyondEmergencyDoorway(base)) return true;

    try {
      this.resetMotion();
      await this.bot.lookAt?.(outside.offset(0.5, 1, 0.5), true);
      for (let step = 0; step < 12 && !this.isBeyondEmergencyDoorway(base); step++) {
        this.bot.setControlState?.("sprint", false);
        this.bot.setControlState?.("forward", true);
        this.bot.setControlState?.("jump", false);
        await this.wait(180);
      }
    } finally {
      this.resetMotion();
    }
    const exited = this.isBeyondEmergencyDoorway(base);
    if (!exited) this.logger.warn(`action=emergency_exit_step; manual doorway step failed; current=${this.formatPosition(this.bot.entity?.position)}`);
    return exited;
  }

  isBeyondEmergencyDoorway(base) {
    if (!this.hasValidPosition(this.bot.entity?.position)) return false;
    const current = this.bot.entity.position.floored();
    return current.x === base.x && current.y === base.y && current.z <= base.z - 1;
  }

  async fortifyStarterShelterForNight() {
    if (!this.progressState.starterShelterPosition) return false;
    if (!this.getStarterShelterStatus(this.bot.entity.position).isNear) return false;
    const base = new Vec3(
      this.progressState.starterShelterPosition.x,
      this.progressState.starterShelterPosition.y,
      this.progressState.starterShelterPosition.z
    );
    const doorwayPlan = createStarterShelterDoorwaySealPlan(base);
    const planByKey = new Map();
    for (const position of [...doorwayPlan, ...this.createStarterShelterPlan(base)]) {
      planByKey.set(`${position.x},${position.y},${position.z}`, position);
    }
    const plan = [...planByKey.values()];
    if (!this.isStarterShelterDoorwayDefensible(base)) await this.installStarterShelterDoor(base);
    const existingCompleted = plan.filter((position) => this.isDefensiveShelterBlock(position)).length;
    const requiredCompleted = Math.ceil(plan.length * 0.9);
    if (existingCompleted >= requiredCompleted) return true;

    const item = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
    if (!item) return false;

    let placed = 0;
    let completed = existingCompleted;
    await this.bot.equip(item, "hand");
    for (const position of plan) {
      if (this.isDefensiveShelterBlock(position)) continue;
      const result = await this.placeBuildingBlockAt(position);
      if (result.placed) placed++;
      if (result.completed) completed++;
    }
    if (placed > 0 || completed > 0) this.logger.info(`action=fortify_starter_shelter; placed=${placed}; completed=${completed}/${plan.length}; success=${completed >= requiredCompleted}`);
    return completed >= requiredCompleted;
  }

  async collectBuildingMaterials(decisionOrTargetCount = this.config.survival.shelterBlockTarget) {
    const decision = decisionOrTargetCount && typeof decisionOrTargetCount === "object" ? decisionOrTargetCount : {};
    const parameters = this.taskParametersFromDecision(decision);
    const requestedTarget = typeof decisionOrTargetCount === "number"
      ? decisionOrTargetCount
      : this.countFromDecision(decision, this.config.survival.shelterBlockTarget);
    const targetCount = Math.max(4, Number(requestedTarget) || this.config.survival.shelterBlockTarget);
    const searchRadius = Math.max(8, Math.min(96, Number(parameters.searchRadius ?? parameters.radius) || 48));
    const before = buildingMaterialCount(inventoryFromBot(this.bot));
    const needed = Math.max(4, Math.min(16, targetCount - before));
    this.logger.info(`action=collect_building_materials; blocks=${before}/${targetCount}; needed=${needed}; radius=${searchRadius}`);

    const surfaceBlocks = ["dirt", "grass_block", ...LOG_BLOCKS];
    const mineableBlocks = hasAny(inventoryFromBot(this.bot), PICKAXES)
      ? ["dirt", "grass_block", "stone", "cobblestone", "deepslate", ...LOG_BLOCKS]
      : surfaceBlocks;

    const result = await this.collectBlocks(mineableBlocks, needed, searchRadius);
    if (result.interruptedByThreat) return;
    if (!result.collected) {
      this.logger.info("action=collect_building_materials; no reachable materials, exploring for build blocks");
      await this.explore({ ...decision, blockedTask: decision.blockedTask ?? "collect_building_materials", reason: decision.reason ?? "building material search" });
    }
  }

  async buildStarterShelter() {
    if (!this.hasValidPosition(this.bot.entity.position)) return false;

    await this.craftPlanks(Math.min(24, this.config.survival.shelterBlockTarget));
  await this.craftDoor();
    const beforeMaterials = buildingMaterialCount(inventoryFromBot(this.bot));
    if (beforeMaterials <= 0) {
      this.logger.warn("action=build_starter_shelter; no usable blocks found");
      return false;
    }

    this.resetMotion();
    const base = this.bot.entity.position.floored();
    const plan = this.createStarterShelterPlan(base);
    let completed = 0;
    let placed = 0;

    this.logger.info(`action=build_starter_shelter; origin=${this.formatPosition(base)}; plan=${plan.length}; materials=${beforeMaterials}`);

    for (const position of plan) {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=build_starter_shelter; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }

      const result = await this.placeBuildingBlockAt(position);
      if (result.completed) completed++;
      if (result.placed) placed++;
      if (!firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS) && completed < plan.length) break;
    }

    const doorInstalled = await this.installStarterShelterDoor(base);
    const success = completed >= Math.ceil(plan.length * 0.9) && doorInstalled;
    if (success) {
      this.progressState.hasStarterShelter = true;
      this.progressState.starterShelterPosition = { x: base.x, y: base.y, z: base.z };
      this.persistMemory();
    }

    this.logger.info(`action=build_starter_shelter; placed=${placed}; completed=${completed}/${plan.length}; door=${doorInstalled}; success=${success}`);
    return success;
  }

  createStarterShelterPlan(base) {
    return createStarterShelterPlan(base);
  }

  async craftDoor() {
    if (firstInventoryItem(this.bot, DOOR_ITEMS)) return true;
    await this.craftBasicSupplies();
    const inventory = inventoryFromBot(this.bot);
    const plankName = Object.keys(PLANK_TO_DOOR).find((name) => (inventory[name] || 0) >= 6);
    if (!plankName) return false;
    const table = await this.ensurePlacedBlock("crafting_table");
    if (!table) return false;
    return this.craftItem(PLANK_TO_DOOR[plankName], 1, true);
  }

  isDoorBlock(block) {
    return Boolean(block?.name && (DOOR_ITEMS.includes(block.name) || block.name.endsWith("_door")));
  }

  blockProperties(block) {
    if (!block) return {};
    if (typeof block.getProperties === "function") return block.getProperties() ?? {};
    return block.properties ?? block._properties ?? {};
  }

  isOpenDoorBlock(block) {
    if (!this.isDoorBlock(block)) return false;
    const properties = this.blockProperties(block);
    return properties.open === true || properties.open === "true";
  }

  isStarterShelterDoorInstalled(base) {
    return this.isDoorwayInstalled(createStarterShelterDoorwayPlan(base));
  }

  isDoorwayInstalled(doorwayPlan) {
    return doorwayPlan.every((position) => this.isDoorBlock(this.bot.blockAt(position)));
  }

  isDefensiveShelterBlock(position) {
    const block = this.bot.blockAt(position);
    return Boolean(block && (block.boundingBox === "block" || this.isDoorBlock(block)));
  }

  isStarterShelterDoorwayDefensible(base) {
    return createStarterShelterDoorwayPlan(base).every((position) => this.isDefensiveShelterBlock(position));
  }

  async installStarterShelterDoor(base) {
    return this.installDoorAt(createStarterShelterDoorwayPlan(base), "install_starter_door");
  }

  async installEmergencyShelterDoor(base) {
    return this.installDoorAt(createEmergencyShelterDoorwayPlan(base), "install_emergency_door");
  }

  async installDoorAt(doorwayPlan, label) {
    if (this.isDoorwayInstalled(doorwayPlan)) return true;
    if (!(await this.craftDoor())) return false;
    const doorItem = firstInventoryItem(this.bot, DOOR_ITEMS);
    if (!doorItem) return false;

    const [lower, upper] = doorwayPlan;
    for (const position of [lower, upper]) {
      const block = this.bot.blockAt(position);
      if (block && block.name !== "air" && !this.isDoorBlock(block)) await this.digBlockAt(position);
    }

    const floor = this.bot.blockAt(lower.offset(0, -1, 0));
    if (!floor || floor.boundingBox !== "block") return false;

    await this.bot.equip(doorItem, "hand");
    try {
      await this.withTimeout(this.bot.placeBlock(floor, new Vec3(0, 1, 0)), this.config.survival.placeBlockTimeoutMs, null);
      await this.wait(250);
    } catch (error) {
      this.logger.warn(`action=${label}; failed=${error.message}`);
      return false;
    }

    const installed = this.isDoorwayInstalled(doorwayPlan);
    this.logger.info(`action=${label}; success=${installed}`);
    return installed;
  }

  async craftBasicSupplies() {
    await this.craftPlanks();
    let inventory = inventoryFromBot(this.bot);
    if (!this.hasCraftingTableAccess() && countItems(inventory, PLANK_ITEMS) >= 4) {
      await this.craftItem("crafting_table", 1, false);
    }

    inventory = inventoryFromBot(this.bot);
    if (countItems(inventory, "stick") < 2 && countItems(inventory, PLANK_ITEMS) >= 2) {
      await this.craftItem("stick", 1, false);
    }
  }

  async craftBasicTools() {
    await this.craftBasicSupplies();
    let inventory = inventoryFromBot(this.bot);
    if (!this.hasCraftingTableAccess() || countItems(inventory, PLANK_ITEMS) < 3 || countItems(inventory, "stick") < 2) {
      this.logger.warn("action=craft_basic_tools; missing table, planks, or sticks; collecting more wood");
      await this.collectWood();
      return;
    }

    const table = await this.ensurePlacedBlock("crafting_table");
    if (!table) {
      this.logger.warn("action=craft_basic_tools; failed to place or find crafting table");
      this.recordActionFailure("craft_basic_tools", "crafting_table_unavailable", this.bot.entity?.position, { target: "crafting_table", radius: 6 });
      return false;
    }

    const craftedWoodenPickaxe = await this.craftItem("wooden_pickaxe", 1, true);
    if (!craftedWoodenPickaxe) {
      this.logger.warn("action=craft_basic_tools; wooden pickaxe recipe unavailable; collecting more wood");
      await this.collectWood();
      return;
    }
    if (countItems(inventoryFromBot(this.bot), "cobblestone") >= 3) {
      await this.craftItem("stone_pickaxe", 1, true);
    }
    await this.ensureWoodcuttingTool();
    await this.craftStoneTools();
  }

  async craftStoneTools() {
    await this.craftBasicSupplies();
    if (!this.hasCraftingTableAccess()) {
      this.logger.warn("action=craft_stone_tools; missing crafting table access");
      return false;
    }

    const table = await this.ensurePlacedBlock("crafting_table");
    if (!table) {
      this.logger.warn("action=craft_stone_tools; failed to place or find crafting table");
      return false;
    }

    let crafted = false;
    let inventory = inventoryFromBot(this.bot);

    if (!hasAny(inventory, STONE_OR_BETTER_PICKAXES) && countItems(inventory, "cobblestone") >= 3 && countItems(inventory, "stick") >= 2) {
      crafted = await this.craftItem("stone_pickaxe", 1, true) || crafted;
      inventory = inventoryFromBot(this.bot);
    }

    if (!hasAny(inventory, STONE_OR_BETTER_WEAPONS) && countItems(inventory, "cobblestone") >= 2 && countItems(inventory, "stick") >= 1) {
      crafted = await this.craftItem("stone_sword", 1, true) || crafted;
      inventory = inventoryFromBot(this.bot);
    }

    if (!hasAny(inventory, STONE_OR_BETTER_AXES) && countItems(inventory, "cobblestone") >= 3 && countItems(inventory, "stick") >= 2) {
      crafted = await this.craftItem("stone_axe", 1, true) || crafted;
    }

    if (!crafted) this.logger.info("action=craft_stone_tools; no stone upgrade craftable yet");
    return crafted;
  }

  async ensureWoodcuttingTool() {
    if (hasAny(inventoryFromBot(this.bot), AXES)) return true;

    await this.craftBasicSupplies();
    let inventory = inventoryFromBot(this.bot);
    if (!this.hasCraftingTableAccess()) return false;

    if (countItems(inventory, "stick") < 2 && countItems(inventory, PLANK_ITEMS) >= 2) {
      await this.craftItem("stick", 1, false);
      inventory = inventoryFromBot(this.bot);
    }

    if (countItems(inventory, "cobblestone") >= 3 && countItems(inventory, "stick") >= 2) {
      const table = await this.ensurePlacedBlock("crafting_table");
      if (table && await this.craftItem("stone_axe", 1, true)) return true;
    }

    if (countItems(inventory, PLANK_ITEMS) < 3) {
      await this.craftPlanks(3);
      inventory = inventoryFromBot(this.bot);
    }

    if (countItems(inventory, PLANK_ITEMS) >= 3 && countItems(inventory, "stick") >= 2) {
      const table = await this.ensurePlacedBlock("crafting_table");
      if (table && await this.craftItem("wooden_axe", 1, true)) return true;
    }

    this.logger.info("action=ensure_woodcutting_tool; no axe craftable yet, chopping by hand instead of using a pickaxe");
    return false;
  }

  async collectStone(decision = {}) {
    const parameters = this.taskParametersFromDecision(decision);
    const targetBlocks = Math.max(1, this.countFromDecision(decision, 11));
    const searchRadius = Math.max(8, Math.min(96, Number(parameters.searchRadius ?? parameters.radius) || 48));
    const targetPosition = this.targetPositionFromDecision(decision);
    const rememberedWorksite = this.lastStoneWorksiteUntil > Date.now() ? this.cloneValidPosition(this.lastStoneWorksitePosition) : null;
    const worksiteTarget = targetPosition ?? rememberedWorksite;
    if (!hasAny(inventoryFromBot(this.bot), PICKAXES)) {
      await this.craftBasicTools();
    }

    if (worksiteTarget && this.distanceBetweenPositions(this.bot.entity.position, worksiteTarget) > 8) {
      await this.gotoNear(worksiteTarget.x, worksiteTarget.y, worksiteTarget.z, 4, {
        label: "collect_stone_target",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 12000),
        target: targetPosition ? "known_stone" : "remembered_stone_worksite",
        learnPosition: worksiteTarget
      });
    }

    await this.equipBestTool("stone");
    const stoneBlocks = ["stone", "cobblestone", "deepslate"];
    const stoneItems = ["cobblestone", "stone", "deepslate", "cobbled_deepslate"];
    const startingStone = countItems(inventoryFromBot(this.bot), stoneItems);
    let previousStone = startingStone;
    let progressedThisAttempt = false;
    let continueExistingMine = Boolean(rememberedWorksite) || this.progressState.hasMiningEntry || parameters.mode === "continue_mine";

    for (let attempt = 0; attempt < 4; attempt++) {
      const gainedStone = previousStone - startingStone;
      const remaining = Math.max(1, targetBlocks - gainedStone);
      if (gainedStone >= targetBlocks) break;

      const collectOptions = {
        action: "collect_stone",
        safeMining: true,
        maxMineBelow: continueExistingMine ? 0 : 1,
        allowOwnSupportTarget: !continueExistingMine,
        surfaceOnly: !continueExistingMine && !progressedThisAttempt,
        preferSurface: !continueExistingMine && !progressedThisAttempt
      };
      const result = await this.collectBlocks(stoneBlocks, remaining, searchRadius, collectOptions);
      if (result.interruptedByThreat) return false;
      await this.collectNearbyItems({ maxDistance: 5, range: 1, avoidDamagingBlocks: true });

      const currentStone = countItems(inventoryFromBot(this.bot), stoneItems);
      if (result.collected || currentStone > previousStone) {
        progressedThisAttempt = true;
        continueExistingMine = true;
        previousStone = currentStone;
        this.surfaceStoneSearchAttempts = 0;
        this.lastStoneWorksitePosition = this.cloneValidPosition(this.bot.entity.position);
        this.lastStoneWorksiteUntil = Date.now() + 90000;
        this.logger.info(`action=collect_stone; progress=${currentStone - startingStone}/${targetBlocks}; continuing_current_worksite=${currentStone - startingStone < targetBlocks}`);
        if (currentStone - startingStone >= targetBlocks) return true;
        continue;
      }

      break;
    }

    if (progressedThisAttempt) {
      return true;
    }

    this.surfaceStoneSearchAttempts++;
    if (continueExistingMine) {
      this.logger.info("action=collect_stone; no more safe stone at remembered worksite, extending the current stair mine probe");
      await this.excavateMineProbe();
      return false;
    }

    if (this.surfaceStoneSearchAttempts <= 3) {
      this.logger.info(`action=collect_stone; no surface stone found, exploring for easier exposed stone (${this.surfaceStoneSearchAttempts}/3)`);
      await this.exploreForSurfaceStone(decision);
      return;
    }

    this.logger.info("action=collect_stone; surface stone search exhausted, digging a stair mine probe");
    await this.excavateMineProbe();
    return false;
  }

  async exploreForSurfaceStone(decision = {}) {
    const parameters = this.taskParametersFromDecision(decision);
    const searchRadius = Math.max(8, Math.min(96, Number(parameters.searchRadius ?? parameters.radius) || this.config.survival.mineSearchRadius));
    const candidate = this.findPreferredMineableBlock(["stone", "cobblestone", "deepslate"], searchRadius, {
      action: "collect_stone",
      maxMineBelow: 1,
      allowOwnSupportTarget: true,
      surfaceOnly: true,
      preferSurface: true,
      safeMining: true
    });

    if (candidate) {
      const standPosition = this.findSafeMiningStandPositions(candidate.position)[0];
      if (standPosition) {
        this.logger.info(`action=explore_surface_stone; target=${candidate.name}; pos=${this.formatPosition(candidate.position)}; stand=${this.formatPosition(standPosition)}`);
        const reached = await this.gotoNear(standPosition.x, standPosition.y, standPosition.z, 2, {
          label: "surface_stone",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 10000),
          learnPosition: standPosition,
          target: candidate.name,
          radius: 8
        });
        if (reached) return true;
      }
    }

    await this.explore({ ...decision, blockedTask: decision.blockedTask ?? "collect_stone", reason: decision.reason ?? "surface stone search" });
    return false;
  }

  async craftFurnace() {
    if (countItems(inventoryFromBot(this.bot), "furnace") > 0 || this.findNearbyBlock("furnace", 8)) return true;

    await this.craftBasicSupplies();
    const inventory = inventoryFromBot(this.bot);
    if (countItems(inventory, "cobblestone") < 8) {
      this.logger.info("action=craft_furnace; missing cobblestone, collecting stone first");
      await this.collectStone();
      return false;
    }

    const table = await this.ensurePlacedBlock("crafting_table");
    if (!table) {
      this.logger.warn("action=craft_furnace; failed to place or find crafting table");
      this.recordActionFailure("craft_furnace", "crafting_table_unavailable", this.bot.entity?.position, { target: "crafting_table", radius: 6 });
      return false;
    }

    return this.craftItem("furnace", 1, true, table);
  }

  async craftWeapon() {
    await this.craftBasicSupplies();
    await this.ensurePlacedBlock("crafting_table");
    if (countItems(inventoryFromBot(this.bot), "cobblestone") >= 2) {
      return this.craftItem("stone_sword", 1, true);
    } else {
      return this.craftItem("wooden_sword", 1, true);
    }
  }

  async explore(decision = {}) {
    if (this.shouldAbortCurrentAction()) {
      this.logger.warn("action=explore; aborted because emergency handling interrupted current action");
      return false;
    }

    const parameters = this.taskParametersFromDecision(decision);
    const explicitTarget = this.targetPositionFromDecision(decision);
    const requestedRadius = Number(parameters.radius ?? parameters.searchRadius);
    const requestedRange = Number(parameters.range);

    const nightRecoverySafe = (this.bot.health ?? 20) > (this.config.survival.criticalHealth ?? 8);
    const allowNightExploration = ((decision.allowNight === true || parameters.allowNight === true) && nightRecoverySafe)
      || ((decision.ruleDecision === "recover_starvation" || decision.originalDecision === "recover_starvation") && nightRecoverySafe);
    if (this.config.survival.avoidNightExploration !== false && this.isNight() && !allowNightExploration) {
      await this.holdPositionSafely();
      return false;
    }

    const origin = this.bot.entity.position;
    if (!this.hasValidPosition(origin)) {
      this.logger.warn("action=explore; skipped because position is not valid yet");
      return false;
    }

    const lowFoodThreshold = this.config.survival.lowFood ?? 14;
    const foodRecovery = decision.blockedTask === "hunt_food"
      || decision.ruleDecision === "hunt_food"
      || decision.ruleDecision === "recover_starvation"
      || decision.originalDecision === "recover_starvation"
      || /hunt_food|food/i.test(decision.reason ?? "")
      || (this.isTaskFeedbackBlocked("hunt_food") && (this.bot.food ?? 20) <= lowFoodThreshold);
    const woodRecovery = !foodRecovery && (decision.blockedTask === "collect_wood"
      || decision.ruleDecision === "collect_wood"
      || /collect_wood|wood/i.test(decision.reason ?? "")
      || this.isTaskFeedbackBlocked("collect_wood"));
    const recoveryExplore = foodRecovery || woodRecovery;
    const exploreBlocked = this.isTaskFeedbackBlocked("explore");
    const recoveryOptions = exploreBlocked
      ? { distances: [6, 8, 10, 12, 16], avoidRecent: true, recentRadius: 4, preferFar: false, preferredDistance: 10 }
      : { distances: [12, 16, 20, 24, 32], avoidRecent: true, recentRadius: 8, preferFar: false, preferredDistance: 18 };
    if (Number.isFinite(requestedRadius) && requestedRadius > 0) {
      const radius = Math.max(4, Math.min(64, requestedRadius));
      recoveryOptions.distances = [radius];
      recoveryOptions.preferredDistance = radius;
    }
    const visibleFoodTarget = foodRecovery
      ? this.selectHuntFoodTarget({
        searchRadius: this.config.survival.foodSearchRadius ?? 48,
        allowAquaticHunt: true,
        maxAquaticDistance: Math.min(this.config.survival.foodSearchRadius ?? 48, 48),
        maxAquaticVerticalDelta: 6,
        maxLandDistance: Math.min(this.config.survival.foodSearchRadius ?? 48, 32)
      }).animal
      : null;
    const localRecoveryStand = recoveryExplore && !woodRecovery && !foodRecovery && typeof this.bot?.blockAt === "function"
      ? this.findNearbySafeStandPositions(origin, 6).find(
        (candidate) => Math.abs(candidate.y - origin.y) <= 1 && candidate.distanceTo(origin) >= 4
      )
      : null;
    const safeTarget = explicitTarget ?? visibleFoodTarget?.position ?? localRecoveryStand ?? this.findSafeExplorationTarget(origin, recoveryExplore || Number.isFinite(requestedRadius) ? recoveryOptions : {});
    const fallbackScale = recoveryExplore ? (exploreBlocked ? 0.35 : 0.7) : 1;
    const target = safeTarget ?? new Vec3(origin.x + this.randomOffset() * fallbackScale, origin.y, origin.z + this.randomOffset() * fallbackScale);
    const label = explicitTarget ? "parameterized_explore" : visibleFoodTarget ? "food_source_recovery_explore" : foodRecovery ? "food_recovery_explore" : woodRecovery ? "wood_recovery_explore" : "explore";
    const range = Number.isFinite(requestedRange) && requestedRange > 0 ? requestedRange : (recoveryExplore || explicitTarget ? 3 : 4);
    if (this.shouldAbortCurrentAction()) {
      this.logger.warn("action=explore; aborted before pathfinder because emergency handling interrupted current action");
      return false;
    }
    this.logger.info(`action=explore; from=${this.formatPosition(origin)}; target=${this.formatPosition(target)}; mode=${parameters.mode ?? label}`);
    const reached = await this.gotoNear(target.x, target.y, target.z, range, {
      label,
      timeoutMs: recoveryExplore ? Math.min(Math.max(this.config.survival.actionTimeoutMs * 2, 12000), 20000) : Math.min(this.config.survival.actionTimeoutMs, 10000),
      learnPosition: new Vec3(target.x, target.y, target.z),
      target: visibleFoodTarget?.name ?? (explicitTarget ? (typeof parameters.target === "string" ? parameters.target : "parameterized_target") : foodRecovery ? "food_recovery" : woodRecovery ? "wood_recovery" : "random_walk"),
      radius: Number.isFinite(requestedRadius) ? requestedRadius : (recoveryExplore ? 18 : 10)
    });
    this.rememberExplorationTarget(target, { reached, purpose: parameters.mode ?? label, area: parameters.area ?? null });
    if (reached) {
      this.logger.info(`action=explore; arrived=${this.formatPosition(this.bot.entity.position)}`);
      return true;
    }
    this.logger.warn(`action=explore; failed to reach target=${this.formatPosition(target)}; current=${this.formatPosition(this.bot.entity.position)}`);
    return false;
  }

  async craftPlanks(targetPlanks = 8) {
    const inventory = inventoryFromBot(this.bot);
    const currentPlanks = countItems(inventory, PLANK_ITEMS);
    if (currentPlanks >= targetPlanks) return;

    const logName = Object.keys(LOG_TO_PLANKS).find((name) => inventory[name] > 0);
    if (!logName) return;
    const logsToCraft = Math.min(inventory[logName], Math.ceil((targetPlanks - currentPlanks) / 4));
    await this.craftItem(LOG_TO_PLANKS[logName], logsToCraft, false);
  }

  async craftItem(itemName, count, requireTable, tableOverride = null) {
    const item = this.mcData.itemsByName[itemName];
    if (!item) {
      this.logger.warn(`unknown item: ${itemName}`);
      return false;
    }

    const table = requireTable ? (tableOverride ?? await this.ensurePlacedBlock("crafting_table")) : null;
    if (requireTable && !table) {
      this.recordActionFailure("craft_item", "crafting_table_unavailable", this.bot.entity?.position, {
        target: itemName,
        radius: 6
      });
      return false;
    }

    const recipe = this.bot.recipesFor(item.id, null, 1, table)[0];
    if (!recipe) {
      this.logger.warn(`no available recipe for ${itemName}`);
      this.recordActionFailure("craft_item", "recipe_unavailable", table?.position ?? this.bot.entity?.position, {
        target: itemName,
        radius: 6
      });
      return false;
    }

    const beforeCount = countItems(inventoryFromBot(this.bot), itemName);
    try {
      this.resetMotion();
      await this.withTimeout(this.bot.craft(recipe, count, table), Math.min(this.config.survival.actionTimeoutMs, 8000), () => this.resetMotion());
      const afterCount = await this.waitForInventoryIncrease(itemName, beforeCount, 1200);
      if (afterCount <= beforeCount) {
        this.recordActionFailure("craft_item", "no_inventory_increase", table?.position ?? this.bot.entity?.position, {
          target: itemName,
          radius: 6
        });
        this.logger.warn(`action=craft_item; item=${itemName}; count=${count}; inventory=${beforeCount}->${afterCount}`);
        return false;
      }
      this.recordActionSuccess("craft_item", table?.position ?? this.bot.entity?.position, { target: itemName });
      this.logger.info(`action=craft_item; item=${itemName}; count=${count}; inventory=${beforeCount}->${afterCount}`);
      return true;
    } catch (error) {
      this.logger.warn(`action=craft_item; item=${itemName}; failed=${error.message}`);
      this.recordActionFailure("craft_item", error.message, table?.position ?? this.bot.entity?.position, {
        target: itemName,
        radius: 6
      });
      return false;
    }
  }

  async waitForInventoryIncrease(itemName, beforeCount, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let remainingAttempts = Math.max(1, Math.ceil(timeoutMs / 100));
    let currentCount = countItems(inventoryFromBot(this.bot), itemName);
    while (currentCount <= beforeCount && Date.now() < deadline && remainingAttempts > 0) {
      remainingAttempts--;
      await this.wait(100);
      currentCount = countItems(inventoryFromBot(this.bot), itemName);
    }
    return currentCount;
  }

  async collectBlocks(blockNames, count, maxDistance, options = {}) {
    const action = options.action ?? "collect_blocks";
    const blockIds = blockNames
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);

    if (blockIds.length === 0) return { collected: false, interruptedByThreat: false };
    const positions = this.bot.findBlocks({ matching: blockIds, maxDistance, count: Math.max(count * 4, 16) });
    const blocks = this.rankMineableBlocks(positions, { ...options, action })
      .slice(0, count);
    if (blocks.length === 0) {
      const sample = positions.slice(0, 6).map((position) => {
        const block = this.bot.blockAt(position);
        const standCount = block ? this.findSafeMiningStandPositions(block.position).length : 0;
        return `${block?.name ?? "unknown"}@${this.formatPosition(position)}:stands=${standCount}`;
      }).join("|") || "none";
      this.logger.info(`action=${action}; mineable_candidates=${positions.length}; usable_targets=0; maxDistance=${maxDistance}; requireReachableStand=${Boolean(options.requireReachableStand)}; maxTargetAbove=${options.maxTargetAbove ?? "any"}; sample=${sample}`);
      return { collected: false, interruptedByThreat: false };
    }

    if (options.safeMining) {
      return this.collectMineableBlocksSafely(blocks, count, { ...options, action });
    }

    await this.equipToolForBlock(blocks[0]);
    const heldTool = this.bot.heldItem?.name ?? "empty_hand";
    this.logger.info(`action=collect_blocks; targets=${blocks.map((block) => block.name).join(",")}; count=${blocks.length}; tool=${heldTool}`);
    const beforeItems = countItems(inventoryFromBot(this.bot), blockNames);
    const targetPositions = blocks.map((block) => ({ name: block.name, position: block.position }));
    let interruptedByThreat = null;
    let interruptedByHazard = null;
    let rejectForThreat = null;
    const threatPromise = new Promise((_, reject) => {
      rejectForThreat = reject;
    });
    const monitor = setInterval(() => {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (!threat || interruptedByThreat) return;
      interruptedByThreat = threat;
      this.logger.warn(`action=collect_blocks; interrupted by ${threat.name} at ${threat.position.distanceTo(this.bot.entity.position).toFixed(1)} blocks`);
      void this.cancelCollectTask();
      this.resetMotion();
      rejectForThreat(new Error(`collection interrupted by ${threat.name}`));
      return;
    }, 500);
    const hazardMonitor = setInterval(() => {
      const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.5);
      if (!hazard || interruptedByHazard) return;
      interruptedByHazard = hazard;
      this.logger.warn(`action=collect_blocks; interrupted by damaging block=${hazard.name} at ${hazard.distance.toFixed(1)} blocks`);
      void this.cancelCollectTask();
      this.resetMotion();
      rejectForThreat(new Error(`collection interrupted by ${hazard.name}`));
    }, 500);

    try {
      await this.withTimeout(
        Promise.race([
          this.bot.collectBlock.collect(blocks, { ignoreNoPath: true, count }),
          threatPromise
        ]),
        this.config.survival.actionTimeoutMs,
        async () => {
          this.logger.warn(`action=collect_blocks; timed out after ${this.config.survival.actionTimeoutMs}ms`);
          await this.cancelCollectTask();
          this.resetMotion();
        }
      );
      await this.collectNearbyItems({ maxDistance: 6, range: 1, avoidDamagingBlocks: true });
      const afterItems = countItems(inventoryFromBot(this.bot), blockNames);
      const blockChanged = this.didAnyTargetBlockChange(targetPositions);
      if (afterItems > beforeItems || blockChanged) {
        this.recordActionSuccess(action, blocks[0].position, { target: blocks[0].name });
        return { collected: !interruptedByThreat, interruptedByThreat: Boolean(interruptedByThreat) };
      }

      this.logger.warn(`action=collect_blocks; plugin reported success but inventory/block state did not change; falling back to manual dig`);
      const manualResult = await this.collectBlocksManually(blocks, count, { ...options, action });
      return {
        collected: manualResult.collected,
        interruptedByThreat: Boolean(interruptedByThreat) || manualResult.interruptedByThreat,
        interruptedByHazard: manualResult.interruptedByHazard
      };
    } catch (error) {
      if (blocks[0]) {
        this.recordActionFailure(action, error.message, blocks[0].position, {
          target: blocks[0].name,
          radius: 8,
          taskFeedback: false
        });
      }
      if (interruptedByHazard) {
        await this.escapeHazardBlock(interruptedByHazard);
        return { collected: false, interruptedByThreat: false, interruptedByHazard: true };
      }
      if (interruptedByThreat) {
        await this.panicRetreatFrom(interruptedByThreat, this.config.survival.panicRetreatMs);
        return { collected: false, interruptedByThreat: true };
      }
      const afterItems = countItems(inventoryFromBot(this.bot), blockNames);
      const blockChanged = this.didAnyTargetBlockChange(targetPositions);
      if (afterItems > beforeItems || blockChanged) {
        this.recordActionSuccess(action, blocks[0].position, { target: blocks[0].name });
        this.logger.info(`action=collect_blocks; recovered partial success after failure=${error.message}; inventory=${beforeItems}->${afterItems}; block_changed=${blockChanged}`);
        return { collected: true, interruptedByThreat: false };
      }
      this.logger.warn(`action=collect_blocks; failed=${error.message}`);
      return this.collectBlocksManually(blocks, count, { ...options, action });
    } finally {
      clearInterval(monitor);
      clearInterval(hazardMonitor);
    }
  }

  didAnyTargetBlockChange(targets) {
    return targets.some((target) => {
      const block = this.bot.blockAt(target.position);
      return !block || block.name === "air" || block.name !== target.name;
    });
  }

  async collectBlocksManually(blocks, count, options = {}) {
    const action = options.action ?? "collect_blocks";
    let collected = 0;

    for (const plannedBlock of blocks) {
      if (collected >= count) break;

      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=${action}; manual dig interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        return { collected: collected > 0, interruptedByThreat: true };
      }

      const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.5);
      if (hazard) {
        this.logger.warn(`action=${action}; manual dig interrupted by damaging block=${hazard.name}`);
        await this.escapeHazardBlock(hazard);
        return { collected: collected > 0, interruptedByThreat: false, interruptedByHazard: true };
      }

      const block = this.bot.blockAt(plannedBlock.position);
      if (!block || block.name === "air" || this.isDamagingBlock(block) || block.diggable === false) continue;
      if (this.isLearnedAvoidPosition(block.position, action, block.name)) continue;

      const standPositions = [
        ...this.findSafeMiningStandPositions(block.position),
        ...this.findSafeAdjacentStandPositions(block.position)
      ]
        .filter((position, index, all) => all.findIndex((candidate) => this.sameBlockPosition(candidate, position)) === index)
        .slice(0, 4);

      let reachedStand = false;
      for (const standPosition of standPositions) {
        const reached = await this.gotoNear(standPosition.x, standPosition.y, standPosition.z, 1, {
          label: `${action}_manual_stand`,
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 7000),
          learnPosition: standPosition,
          target: block.name,
          radius: 6
        });
        if (reached && this.distanceBetweenPositions(this.bot.entity.position, standPosition) <= 2.3) {
          reachedStand = true;
          break;
        }
      }

      if (!reachedStand) {
        this.recordActionFailure(action, "manual_stand_unreachable", block.position, { target: block.name, radius: 8, taskFeedback: false });
        continue;
      }

      await this.equipToolForBlock(block);
      this.logger.info(`action=${action}; target=${block.name}; pos=${this.formatPosition(block.position)}; mode=manual_dig`);
      if (await this.digBlockAt(block.position)) {
        collected++;
        this.recordActionSuccess(action, block.position, { target: block.name });
        await this.collectNearbyItems({ maxDistance: 6, range: 1, avoidDamagingBlocks: true });
      } else {
        this.recordActionFailure(action, "manual_dig_failed", block.position, { target: block.name, radius: 6, taskFeedback: false });
      }
    }

    return { collected: collected > 0, interruptedByThreat: false };
  }

  async cancelCollectTask() {
    try {
      const cancelTask = this.bot.collectBlock?.cancelTask?.();
      if (cancelTask && typeof cancelTask.then === "function") {
        await Promise.race([cancelTask, this.wait(500)]);
      }
    } catch (error) {
      this.logger.debug("collect cancel failed", error.message);
    }
  }

  findPreferredMineableBlock(blockNames, maxDistance, options = {}) {
    const blockIds = blockNames
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);
    if (blockIds.length === 0 || !this.hasValidPosition(this.bot.entity?.position)) return null;

    const positions = this.bot.findBlocks({ matching: blockIds, maxDistance, count: 96 });
    return this.rankMineableBlocks(positions, options)[0] ?? null;
  }

  rankMineableBlocks(positions, options = {}) {
    if (!this.hasValidPosition(this.bot.entity?.position)) return [];
    const action = options.action ?? "collect_blocks";
    const botFeet = this.bot.entity.position.floored();
    let candidates = positions
      .map((position) => this.bot.blockAt(position))
      .filter((block) => block && !this.isDamagingBlock(block) && !this.isLearnedAvoidPosition(block.position, action, block.name))
      .map((block) => ({
        block,
        position: block.position,
        isOwnSupport: this.sameBlockPosition(block.position, botFeet.offset(0, -1, 0)),
        isSurface: (options.preferSurface || options.surfaceOnly) ? this.isSurfaceMiningTarget(block) : false
      }))
      .filter((candidate) => options.maxTargetAbove === undefined || candidate.position.y <= botFeet.y + options.maxTargetAbove)
      .filter((candidate) => options.maxTargetBelow === undefined || candidate.position.y >= botFeet.y - options.maxTargetBelow)
      .filter((candidate) => !options.requireReachableStand || this.hasReachableDigStand(candidate.block))
      .filter((candidate) => !options.safeMining || this.isSafeMiningTarget(candidate.block, options))
      .filter((candidate) => !options.surfaceOnly || candidate.isSurface);

    if (options.lowestPerColumn) {
      const bestByColumn = new Map();
      for (const candidate of candidates) {
        const key = `${candidate.position.x},${candidate.position.z}`;
        const existing = bestByColumn.get(key);
        if (!existing || candidate.position.y < existing.position.y) bestByColumn.set(key, candidate);
      }
      candidates = [...bestByColumn.values()];
    }

    return sortMiningTargets(candidates, this.bot.entity.position, options).map((candidate) => candidate.block);
  }

  hasReachableDigStand(block) {
    if (!block || !this.hasValidPosition(this.bot.entity?.position)) return false;
    const maxDistance = this.config.survival.mineSearchRadius ?? 64;
    const standPositions = [
      ...this.findSafeMiningStandPositions(block.position),
      ...this.findSafeAdjacentStandPositions(block.position)
    ];
    return standPositions.some((position) => this.distanceBetweenPositions(this.bot.entity.position, position) <= maxDistance);
  }

  async collectMineableBlocksSafely(blocks, count, options = {}) {
    const action = options.action ?? "collect_blocks";
    let collected = 0;

    for (const plannedBlock of blocks) {
      if (collected >= count) break;
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=${action}; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        return { collected: collected > 0, interruptedByThreat: true };
      }

      const block = this.bot.blockAt(plannedBlock.position);
      if (!block || block.name === "air" || this.isDamagingBlock(block) || !this.isSafeMiningTarget(block, options)) continue;

      const standPositions = this.findSafeMiningStandPositions(block.position)
        .filter((position) => !this.isLearnedAvoidPosition(position, action, block.name))
        .slice(0, 3);
      if (standPositions.length === 0) {
        this.recordActionFailure(action, "no_safe_mining_stand", block.position, { target: block.name, radius: 6, taskFeedback: false });
        continue;
      }

      let reachedStand = false;
      for (const standPosition of standPositions) {
        const reached = await this.gotoNear(standPosition.x, standPosition.y, standPosition.z, 1, {
          label: `${action}_stand`,
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
          learnPosition: standPosition,
          target: block.name,
          radius: 6
        });
        if (reached && this.distanceBetweenPositions(this.bot.entity.position, standPosition) <= 2.2) {
          reachedStand = true;
          break;
        }
      }

      if (!reachedStand) {
        this.recordActionFailure(action, "safe_mining_stand_unreachable", block.position, { target: block.name, radius: 8, taskFeedback: false });
        continue;
      }

      await this.equipToolForBlock(block);
      this.logger.info(`action=${action}; target=${block.name}; pos=${this.formatPosition(block.position)}; mode=safe_side_dig`);
      if (await this.digBlockAt(block.position)) {
        collected++;
        this.recordActionSuccess(action, block.position, { target: block.name });
        await this.collectNearbyItems({ maxDistance: 5, range: 1, avoidDamagingBlocks: true });
      } else {
        this.recordActionFailure(action, "dig_failed", block.position, { target: block.name, radius: 6, taskFeedback: false });
      }
    }

    return { collected: collected > 0, interruptedByThreat: false };
  }

  isSafeMiningTarget(block, options = {}) {
    if (!block || block.name === "air" || this.isDamagingBlock(block) || block.diggable === false) return false;
    if (this.isWaterBlock(block) || this.isWaterBlock(this.bot.blockAt(block.position.offset(0, 1, 0)))) return false;
    if (!this.hasValidPosition(this.bot.entity?.position)) return false;

    const botFeet = this.bot.entity.position.floored();
    const maxMineBelow = options.maxMineBelow ?? 0;
    const isOwnSupport = this.sameBlockPosition(block.position, botFeet.offset(0, -1, 0));
    if (block.position.y < botFeet.y - maxMineBelow) return false;
    if (isOwnSupport && !options.allowOwnSupportTarget) return false;
    if (options.surfaceOnly && !this.isSurfaceMiningTarget(block)) return false;

    return this.findSafeMiningStandPositions(block.position).length > 0;
  }

  isSurfaceMiningTarget(block) {
    if (!block || block.name === "air" || this.isDamagingBlock(block)) return false;
    const aboveTarget = block.position.offset(0, 1, 0);
    if (this.isPassableBlockAt(aboveTarget)) return true;

    return CARDINAL_DIRECTIONS.some((direction) => {
      const side = block.position.plus(direction);
      return this.isPassableBlockAt(side) && this.isPassableBlockAt(side.offset(0, 1, 0));
    });
  }

  hasOpenSkyColumn(position, maxHeight = 18) {
    if (!this.hasValidPosition(position)) return false;
    const base = position.floored();
    for (let y = 0; y <= maxHeight; y++) {
      const block = this.bot.blockAt(base.offset(0, y, 0));
      if (!block) return false;
      if (block.boundingBox === "block") return false;
    }
    return true;
  }

  isPassableBlockAt(position) {
    const block = this.bot.blockAt(position);
    return Boolean(block && block.boundingBox !== "block" && !this.isDamagingBlock(block) && !this.isWaterBlock(block));
  }

  findSafeMiningStandPositions(blockPosition) {
    const offsets = [];
    for (const direction of CARDINAL_DIRECTIONS) {
      for (const yOffset of [0, -1, -2, -3, 1]) {
        offsets.push(direction.offset(0, yOffset, 0));
      }
    }

    return offsets
      .map((offset) => blockPosition.plus(offset))
      .filter((candidate) => this.isDigReachableFromStand(blockPosition, candidate))
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2))
      .sort((left, right) => this.distanceBetweenPositions(this.bot.entity.position, left) - this.distanceBetweenPositions(this.bot.entity.position, right));
  }

  isDigReachableFromStand(blockPosition, standPosition) {
    if (!this.hasValidPosition(blockPosition) || !this.hasValidPosition(standPosition)) return false;
    const eyePosition = standPosition.offset(0.5, 1.6, 0.5);
    const targetCenter = blockPosition.offset(0.5, 0.5, 0.5);
    return this.distanceBetweenPositions(eyePosition, targetCenter) <= 5.05;
  }

  blockSummary(block) {
    if (!block) return null;
    return {
      name: block.name ?? null,
      position: block.position ?? null,
      solid: block.boundingBox === "block",
      diggable: block.diggable !== false,
      damaging: this.isDamagingBlock(block),
      water: this.isWaterBlock(block)
    };
  }

  countSupportColumnDepth(position, maxDepth = 16) {
    if (!this.hasValidPosition(position)) return 0;
    const base = position.floored();
    let depth = 0;
    for (let offset = 1; offset <= maxDepth; offset++) {
      const block = this.bot.blockAt(base.offset(0, -offset, 0));
      if (!block || block.boundingBox !== "block" || block.diggable === false || this.isDamagingBlock(block) || this.isWaterBlock(block)) break;
      depth++;
    }
    return depth;
  }

  sameLevelExitCandidates(position) {
    if (!this.hasValidPosition(position)) return [];
    const base = position.floored();
    const candidates = [];
    for (const direction of CARDINAL_DIRECTIONS) {
      for (const yOffset of [0, 1]) {
        const candidate = base.plus(direction).offset(0, yOffset, 0);
        if (this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2)) candidates.push(candidate);
      }
    }
    return candidates;
  }

  analyzeNavigationSituation(position = this.bot.entity?.position) {
    if (!this.hasValidPosition(position)) {
      return { trapped: false, kind: "invalid_position", summary: "position is invalid", recommendedAction: "restore_position" };
    }

    const base = position.floored();
    const sameLevelExits = this.sameLevelExitCandidates(base);
    const rim = this.findPitRimCandidate(base);
    const rimRise = rim ? rim.y - base.y : null;
    const supportBlock = this.blockSummary(this.bot.blockAt(base.offset(0, -1, 0)));
    const belowSupportBlock = this.blockSummary(this.bot.blockAt(base.offset(0, -2, 0)));
    const supportColumnDepth = this.countSupportColumnDepth(base, 16);
    const safeSupportDescent = Boolean(
      supportBlock?.solid && supportBlock.diggable && !supportBlock.damaging && !supportBlock.water
      && belowSupportBlock?.solid && !belowSupportBlock.damaging && !belowSupportBlock.water
    );
    const blockedSideDetails = CARDINAL_DIRECTIONS.map((direction) => {
      const feet = this.blockSummary(this.bot.blockAt(base.plus(direction)));
      const head = this.blockSummary(this.bot.blockAt(base.plus(direction).offset(0, 1, 0)));
      return {
        direction: { x: direction.x, y: direction.y, z: direction.z },
        feet: feet?.name ?? null,
        head: head?.name ?? null,
        blocked: Boolean((feet?.solid && feet.diggable && !feet.damaging) || (head?.solid && head.diggable && !head.damaging))
      };
    });
    const blockingSides = blockedSideDetails.filter((side) => side.blocked).length;
    const recentMiningAction = ["collect_stone", "mine_advanced_materials", "craft_stone_tools", "escape_pit"].includes(this.lastAction?.type);
    const shallowPitWithoutMining = Boolean(rim && rimRise < 3 && !recentMiningAction);
    const pitLike = Boolean(rim && blockingSides >= 2 && !shallowPitWithoutMining);
    const elevatedColumn = sameLevelExits.length === 0 && safeSupportDescent && supportColumnDepth >= 2 && (!rim || blockingSides < 2);
    const trapped = sameLevelExits.length === 0 && (pitLike || elevatedColumn);
    const kind = !trapped ? "open" : (elevatedColumn ? "elevated_support_column" : "pit_or_enclosed_trap");
    const routeOptions = [];
    if (sameLevelExits.length > 0) routeOptions.push("same_level_exit");
    if (rim) routeOptions.push("rim_path");
    if (safeSupportDescent) routeOptions.push("controlled_descent");
    if (pitLike) routeOptions.push("ascending_stair");
    const recommendedAction = !trapped
      ? "none"
      : (elevatedColumn ? "controlled_descent" : (rim ? "rim_or_stair" : "controlled_descent"));
    const summary = trapped
      ? `navigation trap: ${kind}; exits=${sameLevelExits.length}; blockingSides=${blockingSides}; support=${supportBlock?.name ?? "none"}; supportDepth=${supportColumnDepth}; recommended=${recommendedAction}`
      : `navigation open: exits=${sameLevelExits.length}; support=${supportBlock?.name ?? "none"}`;

    return {
      trapped,
      kind,
      summary,
      recommendedAction,
      sameLevelExitCount: sameLevelExits.length,
      sameLevelExits,
      blockingSides,
      blockedSideDetails,
      supportBlock,
      belowSupportBlock,
      supportColumnDepth,
      safeSupportDescent,
      rim,
      rimRise,
      routeOptions
    };
  }

  navigationTraceDetails(analysis = {}) {
    return {
      kind: analysis.kind,
      summary: analysis.summary,
      recommendedAction: analysis.recommendedAction,
      sameLevelExitCount: analysis.sameLevelExitCount,
      blockingSides: analysis.blockingSides,
      support: analysis.supportBlock?.name ?? null,
      supportColumnDepth: analysis.supportColumnDepth,
      safeSupportDescent: Boolean(analysis.safeSupportDescent),
      rim: analysis.rim ?? null,
      rimRise: analysis.rimRise,
      routeOptions: analysis.routeOptions ?? []
    };
  }

  isLikelyPitPosition(position = this.bot.entity?.position) {
    return this.analyzeNavigationSituation(position).trapped;
  }

  findPitRimCandidate(position = this.bot.entity?.position, maxRise = 5, radius = 5) {
    if (!this.hasValidPosition(position)) return null;
    const base = position.floored();

    for (let yOffset = 1; yOffset <= maxRise; yOffset++) {
      const candidates = [];
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          if (Math.abs(x) !== radius && Math.abs(z) !== radius && Math.max(Math.abs(x), Math.abs(z)) > yOffset + 1) continue;
          if (x === 0 && z === 0) continue;
          candidates.push(base.offset(x, yOffset, z));
        }
      }

      const safe = candidates
        .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2))
        .sort((left, right) => this.distanceBetweenPositions(base, left) - this.distanceBetweenPositions(base, right))[0];
      if (safe) return safe;
    }

    return null;
  }

  async carveAscendingEscapeStair(direction, steps = 5) {
    const cardinal = normalizeCardinalDirection(direction);
    const start = this.bot.entity.position.floored();
    let moved = 0;

    for (const stair of createAscendingStairPlan(start, cardinal, steps)) {
      if (!this.hasSolidSupport(stair.support)) {
        const placedSupport = await this.placeEmergencySupport(stair.support);
        if (!placedSupport) break;
      }

      await this.digBlockAt(stair.feet);
      await this.digBlockAt(stair.head);
      if (!this.isSafeStandPosition(stair.feet)) break;

      const reached = await this.gotoNear(stair.feet.x, stair.feet.y, stair.feet.z, 1, {
        label: "escape_pit_stair",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
        learnPosition: stair.feet,
        target: "pit_stair",
        radius: 6
      });
      if (!reached) break;
      moved++;

      const rim = this.findPitRimCandidate(this.bot.entity.position, 2, 4);
      if (!this.isLikelyPitPosition(this.bot.entity.position)) return true;
      if (rim) {
        const reachedRim = await this.gotoNear(rim.x, rim.y, rim.z, 1, {
          label: "escape_pit_rim",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 7000),
          learnPosition: rim,
          target: "pit_rim"
        });
        if (reachedRim && !this.isLikelyPitPosition(this.bot.entity.position)) return true;
        if (reachedRim) {
          this.logger.warn(`action=escape_pit; rim_reached_but_still_trapped; current=${this.formatPosition(this.bot.entity.position)}; target=${this.formatPosition(rim)}`);
        }
      }
    }

    this.logger.warn(`action=escape_pit; stair_moved=${moved}/${steps}`);
    return moved > 0 && !this.isLikelyPitPosition(this.bot.entity.position);
  }

  async placeEmergencySupport(position) {
    const item = firstInventoryItem(this.bot, ["dirt", "cobblestone", ...PLANK_ITEMS, ...LOG_BLOCKS]);
    if (!item) return false;
    await this.bot.equip(item, "hand");
    return this.placeBlockAt(position);
  }

  hasSolidSupport(position) {
    const block = this.bot.blockAt(position);
    return Boolean(block && block.boundingBox === "block" && !this.isDamagingBlock(block));
  }

  isDiggableSolidBlock(block) {
    return Boolean(block && block.boundingBox === "block" && block.diggable !== false && !this.isDamagingBlock(block));
  }

  async ensurePlacedBlock(itemName) {
    const blockId = this.mcData.blocksByName[itemName]?.id;
    if (blockId === undefined) return null;

    const existing = this.findNearbyBlock(itemName, 16);
    if (existing) {
      if (itemName === "crafting_table") this.rememberBlock("crafting_table", existing.position);
      if (this.distanceBetweenPositions(this.bot.entity.position, existing.position.offset(0.5, 0.5, 0.5)) > 4.2) {
        const reachedExisting = await this.gotoNear(existing.position.x, existing.position.y, existing.position.z, 2, {
          label: `${itemName}_nearby`,
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
          learnPosition: existing.position,
          target: itemName,
          radius: 6
        });
        if (!reachedExisting) return null;
      }
      const currentBlock = this.bot.blockAt(existing.position);
      if (currentBlock?.name !== itemName) {
        if (itemName === "crafting_table") this.forgetBlock("crafting_table", existing.position);
        return null;
      }
      return currentBlock;
    }

    const item = firstInventoryItem(this.bot, itemName);
    if (itemName === "crafting_table" && item) {
      const placedLocal = await this.placeCarriedBlockNearby(itemName, item);
      if (placedLocal) return placedLocal;
    }

    if (itemName === "crafting_table" && !item) {
      const knownTable = this.nearestKnownBlockEntry("crafting_table", this.bot.entity.position, this.config.memory?.knownBlockSearchRadius ?? 96);
      if (knownTable) {
        this.logger.info(`memory=use_known_block; block=crafting_table; pos=${this.formatPosition(knownTable.position)}; distance=${knownTable.distance.toFixed(1)}`);
        const reachedKnownTable = await this.gotoNear(knownTable.position.x, knownTable.position.y, knownTable.position.z, 2, {
          label: "known_crafting_table",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 10000),
          learnPosition: knownTable.position,
          target: "crafting_table",
          radius: 8
        });
        if (!reachedKnownTable) {
          this.logger.warn(`memory=known_block_unreachable; block=crafting_table; pos=${this.formatPosition(knownTable.position)}`);
        }
        const rememberedBlock = this.bot.blockAt(new Vec3(knownTable.position.x, knownTable.position.y, knownTable.position.z));
        if (reachedKnownTable && rememberedBlock?.name === "crafting_table") {
          this.rememberBlock("crafting_table", rememberedBlock.position);
          return rememberedBlock;
        }
        if (rememberedBlock && rememberedBlock.name !== "crafting_table") this.forgetBlock("crafting_table", knownTable.position);
      }
    }

    if (!item) return null;

    return this.placeCarriedBlockNearby(itemName, item);
  }

  async placeCarriedBlockNearby(itemName, item = firstInventoryItem(this.bot, itemName)) {
    if (!item) return null;
    const placement = this.findPlacementReference();
    if (!placement) return null;

    await this.bot.equip(item, "hand");
    try {
      await this.withTimeout(
        this.bot.placeBlock(placement.block, placement.face),
        this.config.survival.placeBlockTimeoutMs,
        () => this.resetMotion()
      );
    } catch (error) {
      this.logger.debug(`place ${itemName} failed`, error.message);
      return null;
    }
    await this.wait(500);
    const placedBlock = this.findNearbyBlock(itemName, 6);
    if (placedBlock && itemName === "crafting_table") this.rememberBlock("crafting_table", placedBlock.position);
    return placedBlock;
  }

  async placeBlockAt(targetPosition) {
    const target = this.bot.blockAt(targetPosition);
    if (!target || target.boundingBox === "block" || this.isDoorBlock(target)) return false;

    if (!(await this.moveWithinPlacementRange(targetPosition))) return false;

    if (target.name !== "air") {
      try {
        await this.withTimeout(this.bot.dig(target, true), this.config.survival.placeBlockTimeoutMs, null);
        await this.wait(100);
      } catch (error) {
        this.logger.debug("clear target before placing failed", error.message);
      }
    }

    const faces = [
      new Vec3(0, 1, 0),
      new Vec3(0, -1, 0),
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1)
    ];

    for (const face of faces) {
      const reference = this.bot.blockAt(targetPosition.minus(face));
      if (!reference || reference.name === "air" || reference.boundingBox !== "block") continue;
      try {
        await this.withTimeout(this.bot.placeBlock(reference, face), this.config.survival.placeBlockTimeoutMs, null);
        await this.wait(150);
        return true;
      } catch (error) {
        this.logger.debug("place block failed", error.message);
      }
    }

    return false;
  }

  async moveWithinPlacementRange(targetPosition) {
    if (!this.hasValidPosition(this.bot.entity?.position) || !this.hasValidPosition(targetPosition)) return false;
    if (this.distanceBetweenPositions(this.bot.entity.position, targetPosition.offset(0.5, 0.5, 0.5)) <= 4.5) return true;

    const standPositions = this.findSafeAdjacentStandPositions(targetPosition).slice(0, 3);
    for (const standPosition of standPositions) {
      const reached = await this.gotoNear(standPosition.x, standPosition.y, standPosition.z, 1, {
        label: "place_block_stand",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 6000),
        learnPosition: standPosition,
        target: "place_block",
        radius: 5
      });
      if (reached && this.distanceBetweenPositions(this.bot.entity.position, targetPosition.offset(0.5, 0.5, 0.5)) <= 4.8) return true;
    }

    return this.gotoNear(targetPosition.x, targetPosition.y, targetPosition.z, 4, {
      label: "place_block_range",
      timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 6000),
      learnPosition: targetPosition,
      target: "place_block",
      radius: 5
    });
  }

  async placeBuildingBlockAt(targetPosition) {
    const target = this.bot.blockAt(targetPosition);
    if (target && (target.boundingBox === "block" || this.isDoorBlock(target))) return { completed: true, placed: false };
    if (!target) return { completed: false, placed: false };

    const item = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
    if (!item) return { completed: false, placed: false };

    await this.bot.equip(item, "hand");
    const placed = await this.placeBlockAt(targetPosition);
    return { completed: placed, placed };
  }

  findPlacementReference() {
    const base = this.bot.entity.position.floored();
    const offsets = [
      new Vec3(1, -1, 0),
      new Vec3(-1, -1, 0),
      new Vec3(0, -1, 1),
      new Vec3(0, -1, -1)
    ];

    for (const offset of offsets) {
      const ground = this.bot.blockAt(base.plus(offset));
      const target = this.bot.blockAt(base.plus(offset).offset(0, 1, 0));
      if (ground && target && ground.boundingBox === "block" && target.name === "air") {
        return { block: ground, face: new Vec3(0, 1, 0) };
      }
    }

    return null;
  }

  inventoryItemByPreference(itemNames) {
    const names = Array.isArray(itemNames) ? itemNames : [itemNames];
    const heldItem = this.bot?.heldItem;
    const inventoryItems = this.bot?.inventory?.items?.() ?? [];
    for (const name of names) {
      if (heldItem?.name === name) return heldItem;
      const item = inventoryItems.find((candidate) => candidate.name === name);
      if (item) return item;
    }
    return null;
  }

  async ensureHuntingWeapon() {
    const preferredSword = this.inventoryItemByPreference(WEAPONS.filter((name) => name.endsWith("_sword")));
    if (preferredSword) {
      await this.bot.equip?.(preferredSword, "hand");
      return preferredSword.name;
    }

    const canCraft = typeof this.bot?.recipesFor === "function" && typeof this.bot?.craft === "function";
    if (canCraft) await this.craftBasicSupplies();
    let inventory = inventoryFromBot(this.bot);
    if (canCraft && countItems(inventory, "cobblestone") >= 2 && countItems(inventory, "stick") >= 1) {
      const crafted = await this.craftWeapon();
      if (crafted) {
        const stoneSword = this.inventoryItemByPreference(["stone_sword"]);
        if (stoneSword) {
          await this.bot.equip?.(stoneSword, "hand");
          return stoneSword.name;
        }
      }
    }

    inventory = inventoryFromBot(this.bot);
    if (canCraft
      && !this.inventoryItemByPreference(WEAPONS.filter((name) => name.endsWith("_sword")))
      && countItems(inventory, PLANK_ITEMS) >= 2
      && countItems(inventory, "stick") >= 1) {
      const table = await this.ensurePlacedBlock("crafting_table");
      if (table && await this.craftItem("wooden_sword", 1, true, table)) {
        const woodenSword = this.inventoryItemByPreference(["wooden_sword"]);
        if (woodenSword) {
          await this.bot.equip?.(woodenSword, "hand");
          return woodenSword.name;
        }
      }
    }

    const equipped = await this.equipBestWeapon();
    return equipped?.name ?? null;
  }

  async equipBestWeapon() {
    const item = this.inventoryItemByPreference(WEAPONS);
    if (item) await this.bot.equip?.(item, "hand");
    return item ?? null;
  }

  async gotoEntity(entity, range, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.config.survival.actionTimeoutMs;
    const label = options.label ?? "goto_entity";
    const targetName = options.target ?? entity?.name ?? "entity";
    const latestTarget = () => (entity?.id !== undefined ? this.bot?.entities?.[entity.id] : null) ?? entity;
    let currentTarget = latestTarget();
    if (!currentTarget || !this.hasValidPosition(currentTarget.position) || !this.hasValidPosition(this.bot.entity?.position)) return false;
    if (options.abortOnLowOxygen && this.isLowOxygen()) {
      this.resetMotion();
      return false;
    }

    if (!options.abortOnLowOxygen && this.bot?.pathfinder?.goto && typeof GoalFollow === "function") {
      try {
        await this.ensureEmergencyShelterExit();
        if (this.hasNearbyDoor()) await this.openNearbyDoors(2.2, { passThrough: true, targetPosition: currentTarget.position });
        await this.withTimeout(
          this.bot.pathfinder.goto(new GoalFollow(currentTarget, range)),
          timeoutMs,
          () => {
            this.logger.warn(`action=${label}; timed out after ${timeoutMs}ms`);
            this.resetMotion();
          }
        );
        currentTarget = latestTarget();
        if (!currentTarget || !this.hasValidPosition(currentTarget.position)) return false;
        const finalDistance = currentTarget.position.distanceTo(this.bot.entity.position);
        const tolerance = options.tolerance ?? 1.75;
        if (finalDistance > range + tolerance) {
          const reason = `arrived_too_far_${finalDistance.toFixed(1)}`;
          this.logger.warn(`pathfinder ${label} failed=${reason}; target=${targetName}; current=${this.formatPosition(this.bot.entity.position)}`);
          if (options.learnPosition) {
            this.recordActionFailure(label, reason, currentTarget.position, {
              target: targetName,
              radius: options.radius ?? 6,
              taskFeedback: options.taskFeedback
            });
          }
          return false;
        }
        this.rememberSafeStandPosition(this.bot.entity.position);
        return true;
      } catch (error) {
        this.logger.warn(`pathfinder ${label} failed=${error.message}`);
        if (options.learnPosition) {
          currentTarget = latestTarget();
          this.recordActionFailure(label, error.message, currentTarget?.position ?? options.learnPosition, {
            target: targetName,
            radius: options.radius ?? 6,
            taskFeedback: options.taskFeedback
          });
        }
        return false;
      }
    }

    const segmentTimeoutMs = Math.max(250, Math.min(options.segmentTimeoutMs ?? 2200, timeoutMs));
    const maxAttempts = Math.max(1, Math.ceil(timeoutMs / segmentTimeoutMs) + 1);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (options.abortOnLowOxygen && this.isLowOxygen()) {
        this.resetMotion();
        return false;
      }
      currentTarget = latestTarget();
      if (!currentTarget || !this.hasValidPosition(currentTarget.position)) return false;
      const distance = currentTarget.position.distanceTo(this.bot.entity.position);
      if (distance <= range + (options.tolerance ?? 1.75)) return true;
      const reached = await this.gotoNear(currentTarget.position.x, currentTarget.position.y, currentTarget.position.z, range, {
        ...options,
        label,
        timeoutMs: segmentTimeoutMs,
        learnPosition: currentTarget.position,
        target: targetName,
        taskFeedback: options.taskFeedback ?? false
      });
      currentTarget = latestTarget();
      if (options.abortOnLowOxygen && this.isLowOxygen()) {
        this.resetMotion();
        return false;
      }
      if (!currentTarget || !this.hasValidPosition(currentTarget.position)) return false;
      if (reached && currentTarget.position.distanceTo(this.bot.entity.position) <= range + (options.tolerance ?? 1.75)) return true;
      await this.wait(100);
    }

    currentTarget = latestTarget();
    const finalDistance = this.hasValidPosition(currentTarget?.position) && this.hasValidPosition(this.bot.entity?.position)
      ? currentTarget.position.distanceTo(this.bot.entity.position)
      : Infinity;
    this.logger.warn(`pathfinder ${label} failed=moving_target_unreachable; target=${targetName}; distance=${Number.isFinite(finalDistance) ? finalDistance.toFixed(1) : "unknown"}`);
    return false;
  }

  async equipToolForBlock(block) {
    if (!block) return;

    if (LOG_BLOCKS.includes(block.name)) {
      const axe = firstInventoryItem(this.bot, AXES);
      if (axe) {
        await this.bot.equip(axe, "hand");
        return;
      }
      await this.unequipHandIfHolding([...PICKAXES, ...HOES, ...WEAPONS.filter((name) => !AXES.includes(name))]);
      return;
    }

    await this.equipBestTool(block.name);
  }

  async unequipHandIfHolding(itemNames) {
    const held = this.bot.heldItem;
    if (!held || !itemNames.includes(held.name)) return;
    try {
      await this.bot.unequip("hand");
    } catch (error) {
      this.logger.debug(`unequip hand failed: ${error.message}`);
    }
  }

  baitForAnimal(animalName) {
    const baitByAnimal = {
      cow: ["wheat"],
      sheep: ["wheat"],
      pig: ["carrot", "potato"],
      chicken: ["wheat_seeds", "beetroot_seeds"],
      rabbit: ["carrot"]
    };
    return firstInventoryItem(this.bot, baitByAnimal[animalName] || []);
  }

  async digBlockAt(position) {
    const block = this.bot.blockAt(position);
    if (!block || block.name === "air" || block.name.includes("water") || this.isDamagingBlock(block) || this.isDoorBlock(block) || block.diggable === false) {
      return false;
    }

    await this.equipBestTool(block.name);
    try {
      await this.withTimeout(this.bot.dig(block, true), this.config.survival.actionTimeoutMs, () => this.resetMotion());
      return true;
    } catch (error) {
      this.logger.debug(`dig block failed at ${this.formatPosition(position)}: ${error.message}`);
      return false;
    }
  }

  async equipBestTool(blockName) {
    if (this.bot.tool && this.mcData.blocksByName[blockName]) {
      const block = this.bot.findBlock({ matching: this.mcData.blocksByName[blockName].id, maxDistance: 16 });
      if (block) await this.bot.tool.equipForBlock(block);
    }
  }

  isDamagingBlock(block) {
    return Boolean(block && DAMAGING_BLOCK_NAMES.has(block.name));
  }

  isWaterBlock(block) {
    return Boolean(block && WATER_BLOCK_NAMES.has(block.name));
  }

  findNearbyDamagingBlock(position, radius = 1.5) {
    if (!this.mcData || !this.hasValidPosition(position)) return null;

    const base = position.floored();
    const searchRadius = Math.ceil(radius);
    let nearest = null;

    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          const block = this.bot.blockAt(base.offset(x, y, z));
          if (!this.isDamagingBlock(block)) continue;
          const distance = block.position.offset(0.5, 0.5, 0.5).distanceTo(position);
          if (distance > radius + 0.75 || !this.isTouchingDamagingBlock(block, base)) continue;
          if (!nearest || distance < nearest.distance) {
            nearest = { name: block.name, position: block.position, distance };
          }
        }
      }
    }

    return nearest;
  }

  findNearbyDamagingBlockLoose(position, radius = 2.8) {
    if (!this.mcData || !this.hasValidPosition(position)) return null;

    const base = position.floored();
    const searchRadius = Math.ceil(radius);
    let nearest = null;

    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          const block = this.bot.blockAt(base.offset(x, y, z));
          if (!this.isDamagingBlock(block)) continue;
          const distance = block.position.offset(0.5, 0.5, 0.5).distanceTo(position);
          if (distance > radius + 0.75) continue;
          if (!nearest || distance < nearest.distance) {
            nearest = { name: block.name, position: block.position, distance };
          }
        }
      }
    }

    return nearest;
  }

  isTouchingDamagingBlock(block, feetPosition) {
    if (!block || !feetPosition) return false;
    const headPosition = feetPosition.offset(0, 1, 0);
    const groundPosition = feetPosition.offset(0, -1, 0);

    if (["sweet_berry_bush", "wither_rose"].includes(block.name)) {
      return this.sameBlockPosition(block.position, feetPosition) || this.sameBlockPosition(block.position, headPosition);
    }

    if (block.name === "magma_block") {
      return this.sameBlockPosition(block.position, groundPosition);
    }

    if (["fire", "soul_fire", "lava", "pointed_dripstone"].includes(block.name)) {
      return [feetPosition, headPosition, groundPosition].some((position) => this.sameBlockPosition(block.position, position));
    }

    if (block.name === "cactus") {
      const sameHeight = block.position.y === feetPosition.y || block.position.y === headPosition.y;
      const touchingX = Math.abs(block.position.x - feetPosition.x) <= 1 && block.position.z === feetPosition.z;
      const touchingZ = Math.abs(block.position.z - feetPosition.z) <= 1 && block.position.x === feetPosition.x;
      return sameHeight && (touchingX || touchingZ);
    }

    return this.sameBlockPosition(block.position, feetPosition) || this.sameBlockPosition(block.position, headPosition);
  }

  sameBlockPosition(left, right) {
    return Boolean(left && right && left.x === right.x && left.y === right.y && left.z === right.z);
  }

  isSafeStandPosition(position) {
    if (!this.hasValidPosition(position)) return false;
    const base = position.floored();
    const feet = this.bot.blockAt(base);
    const head = this.bot.blockAt(base.offset(0, 1, 0));
    const ground = this.bot.blockAt(base.offset(0, -1, 0));
    if (this.isWaterBlock(feet) || this.isWaterBlock(head) || this.isWaterBlock(ground)) return false;
    if (this.isDamagingBlock(feet) || this.isDamagingBlock(head) || this.isDamagingBlock(ground)) return false;
    if ((feet?.boundingBox === "block" && !this.isDoorBlock(feet)) || (head?.boundingBox === "block" && !this.isDoorBlock(head))) return false;
    return Boolean(ground && ground.boundingBox === "block");
  }

  async openNearbyDoors(radius = 2.2, options = {}) {
    if (typeof radius === "object") {
      options = radius;
      radius = options.radius ?? 2.2;
    }
    if (!this.hasValidPosition(this.bot.entity?.position) || typeof this.bot.blockAt !== "function" || typeof this.bot.activateBlock !== "function") return false;
    const base = this.bot.entity.position.floored();
    const searchRadius = Math.ceil(radius);
    const opened = new Set();
    let openedAny = false;
    let passedThrough = false;

    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          const block = this.bot.blockAt(base.offset(x, y, z));
          if (!this.isDoorBlock(block)) continue;
          const interactBlock = this.doorInteractBlock(block);
          if (!interactBlock) continue;
          const key = `${interactBlock.position.x},${interactBlock.position.y},${interactBlock.position.z}`;
          if (opened.has(key)) continue;
          opened.add(key);
          const alreadyOpen = this.isOpenDoorBlock(block) || this.isOpenDoorBlock(interactBlock);
          const openedDoor = alreadyOpen || await this.openDoorBlock(interactBlock);
          openedAny = openedAny || (!alreadyOpen && openedDoor);
          if (openedDoor && options.passThrough && !passedThrough) {
            passedThrough = await this.passThroughDoor(interactBlock, options.targetPosition);
          }
        }
      }
    }

    return openedAny || passedThrough;
  }

  hasNearbyDoor(radius = 2.2) {
    if (!this.hasValidPosition(this.bot.entity?.position) || typeof this.bot.blockAt !== "function") return false;
    const base = this.bot.entity.position.floored();
    const searchRadius = Math.ceil(radius);

    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          if (this.isDoorBlock(this.bot.blockAt(base.offset(x, y, z)))) return true;
        }
      }
    }

    return false;
  }

  async openDoorwayDoors(doorwayPlan) {
    if (!Array.isArray(doorwayPlan)) return false;
    const opened = new Set();
    let openedAny = false;

    for (const position of doorwayPlan) {
      const block = this.bot.blockAt(position);
      if (!this.isDoorBlock(block) || this.isOpenDoorBlock(block)) continue;
      const interactBlock = this.doorInteractBlock(block);
      if (!interactBlock) continue;
      const key = `${interactBlock.position.x},${interactBlock.position.y},${interactBlock.position.z}`;
      if (opened.has(key)) continue;
      opened.add(key);
      if (await this.openDoorBlock(interactBlock)) openedAny = true;
    }

    return openedAny;
  }

  async openDoorBlock(block) {
    if (!this.isDoorBlock(block) || this.isOpenDoorBlock(block) || typeof this.bot.activateBlock !== "function") return false;
    try {
      await this.bot.lookAt?.(block.position.offset(0.5, 0.9, 0.5), true);
      await this.bot.activateBlock(block);
      await this.wait(120);
      return true;
    } catch (error) {
      this.logger.debug(`open door failed at ${this.formatPosition(block.position)}: ${error.message}`);
      return false;
    }
  }

  async passThroughDoor(block, targetPosition = null) {
    const interactBlock = this.doorInteractBlock(block);
    if (!interactBlock || !this.hasValidPosition(this.bot.entity?.position)) return false;
    const target = this.bestDoorPassThroughTarget(interactBlock, targetPosition);
    if (!target) return false;
    return this.manualStepTowardPosition(target, 1200, { label: "door_pass", jump: false });
  }

  bestDoorPassThroughTarget(block, targetPosition = null) {
    if (!this.isDoorBlock(block) || !this.hasValidPosition(this.bot.entity?.position)) return null;
    const current = this.bot.entity.position;
    const currentBlock = current.floored();
    const candidates = CARDINAL_DIRECTIONS
      .map((offset) => block.position.plus(offset))
      .filter((candidate) => !this.sameBlockPosition(candidate, currentBlock))
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.1));
    if (candidates.length === 0) return null;

    if (this.hasValidPosition(targetPosition)) {
      return candidates.sort((left, right) => {
        return this.distanceBetweenPositions(left, targetPosition) - this.distanceBetweenPositions(right, targetPosition);
      })[0];
    }

    return candidates.sort((left, right) => {
      return this.distanceBetweenPositions(right, current) - this.distanceBetweenPositions(left, current);
    })[0];
  }

  async manualStepTowardPosition(target, durationMs = 1200, options = {}) {
    if (!this.hasValidPosition(target) || !this.hasValidPosition(this.bot.entity?.position)) return false;
    const deadline = Date.now() + durationMs;
    const label = options.label ?? "manual_step";
    const range = options.range ?? 1.05;
    this.resetMotion();
    try {
      await this.bot.lookAt?.(target.offset(0.5, 1, 0.5), true);
      while (Date.now() < deadline && this.hasValidPosition(this.bot.entity?.position)) {
        if (this.distanceBetweenPositions(this.bot.entity.position, target.offset(0.5, 0, 0.5)) <= range) return true;
        this.bot.setControlState?.("sprint", Boolean(options.sprint));
        this.bot.setControlState?.("forward", true);
        this.bot.setControlState?.("jump", Boolean(options.jump));
        await this.wait(180);
      }
    } finally {
      this.resetMotion();
    }
    const current = this.bot.entity?.position;
    const reached = this.hasValidPosition(current) && this.distanceBetweenPositions(current, target.offset(0.5, 0, 0.5)) <= range;
    if (!reached) this.logger.warn(`action=${label}; manual step failed; target=${this.formatPosition(target)}; current=${this.formatPosition(this.bot.entity?.position)}`);
    return reached;
  }

  doorInteractBlock(block) {
    if (!this.isDoorBlock(block)) return null;
    const properties = this.blockProperties(block);
    if (properties.half === "upper") {
      const lower = this.bot.blockAt(block.position.offset(0, -1, 0));
      if (this.isDoorBlock(lower)) return lower;
    }
    return block;
  }

  findSafeAdjacentStandPosition(blockPosition) {
    return this.findSafeAdjacentStandPositions(blockPosition)[0] ?? null;
  }

  findSafeAdjacentStandPositions(blockPosition) {
    const offsets = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(1, 0, 1),
      new Vec3(1, 0, -1),
      new Vec3(-1, 0, 1),
      new Vec3(-1, 0, -1)
    ];

    return offsets
      .map((offset) => blockPosition.plus(offset))
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.1))
      .sort((left, right) => this.distanceBetweenPositions(this.bot.entity.position, left) - this.distanceBetweenPositions(this.bot.entity.position, right));
  }

  findSafeBerryHarvestStandPositions(blockPosition) {
    if (!this.hasValidPosition(blockPosition) || !this.hasValidPosition(this.bot.entity?.position)) return [];
    const candidates = [];
    for (const yOffset of [0, -1, 1]) {
      for (let x = -4; x <= 4; x++) {
        for (let z = -4; z <= 4; z++) {
          const horizontalDistance = Math.hypot(x, z);
          if (horizontalDistance < 2 || horizontalDistance > 4.25) continue;
          candidates.push(blockPosition.offset(x, yOffset, z));
        }
      }
    }

    const rangedPositions = candidates
      .filter((candidate, index, all) => all.findIndex((position) => this.sameBlockPosition(position, candidate)) === index)
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2))
      .filter((candidate) => this.distanceBetweenPositions(candidate.offset(0.5, 1, 0.5), blockPosition.offset(0.5, 0.8, 0.5)) <= 4.65)
      .filter((candidate) => this.nearestClearableDamagingPlantDistance(candidate, 1.7) > 1.35)
      .sort((left, right) => {
        const leftTravel = this.distanceBetweenPositions(this.bot.entity.position, left);
        const rightTravel = this.distanceBetweenPositions(this.bot.entity.position, right);
        if (leftTravel !== rightTravel) return leftTravel - rightTravel;
        return this.distanceBetweenPositions(right, blockPosition) - this.distanceBetweenPositions(left, blockPosition);
      });

    return rangedPositions.length > 0 ? rangedPositions : this.findSafeAdjacentStandPositions(blockPosition);
  }

  nearestClearableDamagingPlantDistance(position, radius = 2.5) {
    return this.findNearbyClearableDamagingPlants(position, radius)
      .reduce((nearest, plant) => Math.min(nearest, plant.distance), Number.POSITIVE_INFINITY);
  }

  async reachFirstSafeBerryPosition(safePositions) {
    for (const safePosition of safePositions) {
      if (this.shouldAbortCurrentAction()) return null;

      const reached = await this.gotoBlock(safePosition, {
        label: "forage_berry",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
        target: "sweet_berry_bush",
        tolerance: 1.15,
        radius: 5
      });
      const hazard = reached ? this.findNearbyDamagingBlock(this.bot.entity.position, 1.2) : null;
      if (reached && !hazard && this.sameBlockPosition(this.bot.entity.position.floored(), safePosition)) return safePosition;
      if (this.shouldAbortCurrentAction()) return null;

      this.recordActionFailure("forage_food", "safe_position_unreachable", safePosition, {
        target: "sweet_berry_bush",
        radius: 5
      });
    }

    return null;
  }

  async collectNearbyItems(options = {}) {
    const maxDistance = options.maxDistance ?? 12;
    const range = options.range ?? 1;
    const pickupRange = options.avoidDamagingBlocks ? Math.max(range, options.pickupRange ?? 1.8) : range;
    const item = this.nearestEntity((entity) => {
      if (entity.name !== "item") return false;
      return !options.avoidDamagingBlocks || Boolean(this.findSafeItemPickupPosition(entity.position, pickupRange));
    }, maxDistance);
    if (!item) return false;

    if (options.avoidDamagingBlocks) {
      const pickupPosition = this.findSafeItemPickupPosition(item.position, pickupRange);
      if (!pickupPosition) {
        this.logger.info(`action=collect_items; skipped unsafe item at ${this.formatPosition(item.position)}`);
        return false;
      }

      const reached = await this.gotoBlock(pickupPosition, {
        label: options.label ?? "collect_item_safe",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, options.timeoutMs ?? 4000),
        target: "item",
        radius: 4,
        tolerance: 1.15
      });
      const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.2);
      if (hazard) {
        this.logger.warn(`action=collect_items; touched hazard=${hazard.name}; escaping instead of chasing item`);
        await this.escapeHazardBlock(hazard);
        return false;
      }
      return reached;
    }

    return this.gotoNear(item.position.x, item.position.y, item.position.z, range, {
      label: options.label ?? "collect_item",
      timeoutMs: options.timeoutMs
    });
  }

  findSafeItemPickupPosition(itemPosition, pickupRange = 1.8) {
    return this.findSafeItemPickupPositions(itemPosition, pickupRange)[0] ?? null;
  }

  findSafeItemPickupPositions(itemPosition, pickupRange = 1.8) {
    if (!this.hasValidPosition(itemPosition) || !this.hasValidPosition(this.bot.entity?.position)) return [];
    const base = itemPosition.floored();
    const radius = Math.max(1, Math.ceil(pickupRange));
    const candidates = [];

    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        for (const yOffset of [0, -1, 1]) {
          const candidate = base.offset(x, yOffset, z);
          const distance = this.distanceBetweenPositions(candidate.offset(0.5, 0.5, 0.5), itemPosition);
          if (distance > pickupRange + 0.6) continue;
          candidates.push(candidate);
        }
      }
    }

    return candidates
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2))
      .sort((left, right) => this.distanceBetweenPositions(this.bot.entity.position, left) - this.distanceBetweenPositions(this.bot.entity.position, right));
  }

  maxStackCount(inventory, names) {
    return names.reduce((largest, name) => Math.max(largest, inventory[name] || 0), 0);
  }

  distanceBetweenPositions(left, right) {
    if (!this.hasValidPosition(left) || !this.hasValidPosition(right)) return Number.POSITIVE_INFINITY;
    const deltaX = left.x - right.x;
    const deltaY = left.y - right.y;
    const deltaZ = left.z - right.z;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
  }

  cardinalDirection() {
    const yaw = this.bot.entity?.yaw ?? 0;
    const x = Math.round(-Math.sin(yaw));
    const z = Math.round(-Math.cos(yaw));
    if (x === 0 && z === 0) return new Vec3(1, 0, 0);
    return new Vec3(x, 0, z);
  }

  prioritizedCardinalDirections() {
    const preferred = normalizeCardinalDirection(this.cardinalDirection());
    return [
      preferred,
      ...CARDINAL_DIRECTIONS.filter((direction) => direction.x !== preferred.x || direction.z !== preferred.z)
    ];
  }

  nearestEntity(predicate, maxDistance) {
    const position = this.bot.entity.position;
    if (!this.hasValidPosition(position)) return null;
    return Object.values(this.bot.entities)
      .filter((entity) => entity !== this.bot.entity && entity.name && this.hasValidPosition(entity.position) && predicate(entity))
      .map((entity) => ({ entity, distance: entity.position.distanceTo(position) }))
      .filter(({ distance }) => distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance)[0]?.entity;
  }

  async gotoNear(x, y, z, range, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.config.survival.actionTimeoutMs;
    const label = options.label ?? "goto";
    const targetPosition = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
    try {
      await this.ensureEmergencyShelterExit();
      if (this.hasNearbyDoor()) await this.openNearbyDoors(2.2, { passThrough: true, targetPosition });
      await this.withTimeout(
        this.bot.pathfinder.goto(new GoalNear(targetPosition.x, targetPosition.y, targetPosition.z, range)),
        timeoutMs,
        (error) => {
          this.logger.warn(error?.message?.startsWith("movement stalled")
            ? `action=${label}; ${error.message}`
            : `action=${label}; timed out after ${timeoutMs}ms`);
          this.resetMotion();
        },
        {
          movementWatch: options.movementWatch !== false && timeoutMs >= 3000,
          movementSampleMs: options.movementSampleMs,
          movementStallMs: options.movementStallMs,
          movementMinDistance: options.movementMinDistance,
          label
        }
      );
      const finalDistance = this.distanceBetweenPositions(this.bot.entity.position, targetPosition.offset(0.5, 0, 0.5));
      const tolerance = options.tolerance ?? 1.75;
      if (finalDistance > range + tolerance) {
        const reason = `arrived_too_far_${finalDistance.toFixed(1)}`;
        this.logger.warn(`pathfinder ${label} failed=${reason}; target=${this.formatPosition(targetPosition)}; current=${this.formatPosition(this.bot.entity.position)}`);
        if (options.learnPosition) {
          this.recordActionFailure(label, reason, options.learnPosition, {
            target: options.target,
            radius: options.radius ?? 6,
            taskFeedback: options.taskFeedback
          });
        }
        return false;
      }
      this.rememberSafeStandPosition(this.bot.entity.position);
      return true;
    } catch (error) {
      this.logger.warn(`pathfinder ${label} failed=${error.message}`);
      if (options.learnPosition) {
        this.recordActionFailure(label, error.message, options.learnPosition, {
          target: options.target,
          radius: options.radius ?? 6,
          taskFeedback: options.taskFeedback
        });
      }
      return false;
    }
  }

  async gotoBlock(position, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.config.survival.actionTimeoutMs;
    const label = options.label ?? "goto_block";
    try {
      await this.ensureEmergencyShelterExit();
      if (this.hasNearbyDoor()) await this.openNearbyDoors(2.2, { passThrough: true, targetPosition: position });
      await this.withTimeout(
        this.bot.pathfinder.goto(new GoalBlock(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z))),
        timeoutMs,
        (error) => {
          this.logger.warn(error?.message?.startsWith("movement stalled")
            ? `action=${label}; ${error.message}`
            : `action=${label}; timed out after ${timeoutMs}ms`);
          this.resetMotion();
        },
        {
          movementWatch: options.movementWatch !== false && timeoutMs >= 3000,
          movementSampleMs: options.movementSampleMs,
          movementStallMs: options.movementStallMs,
          movementMinDistance: options.movementMinDistance,
          label
        }
      );
      const finalDistance = this.distanceBetweenPositions(this.bot.entity.position, position.offset(0.5, 0, 0.5));
      if (finalDistance > (options.tolerance ?? 1.75)) {
        const reason = `arrived_too_far_${finalDistance.toFixed(1)}`;
        this.logger.warn(`pathfinder ${label} failed=${reason}; target=${this.formatPosition(position)}; current=${this.formatPosition(this.bot.entity.position)}`);
        if (options.learnPosition !== false) {
          this.recordActionFailure(label, reason, position, {
            target: options.target,
            radius: options.radius ?? 6,
            taskFeedback: options.taskFeedback
          });
        }
        return false;
      }
      this.rememberSafeStandPosition(this.bot.entity.position);
      return true;
    } catch (error) {
      this.logger.warn(`pathfinder ${label} failed=${error.message}`);
      if (options.learnPosition !== false) {
        this.recordActionFailure(label, error.message, position, {
          target: options.target,
          radius: options.radius ?? 6,
          taskFeedback: options.taskFeedback
        });
      }
      return false;
    }
  }

  withTimeout(promise, timeoutMs, onTimeout, options = {}) {
    let timer = null;
    let movementTimer = null;
    let finished = false;
    const sourcePromise = Promise.resolve(promise);
    sourcePromise.catch(() => {});

    const fail = async (reject, error) => {
      if (finished) return;
      finished = true;
      try {
        await onTimeout?.(error);
      } catch (cleanupError) {
        this.logger?.debug?.("timeout cleanup failed", cleanupError.message);
      }
      reject(error);
    };

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(async () => {
        await fail(reject, new Error(`action timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const racers = [sourcePromise, timeout];
    if (options.movementWatch && this.hasValidPosition(this.bot?.entity?.position)) {
      const sampleMs = Math.max(50, Number(options.movementSampleMs) || 1000);
      const stallMs = Math.max(sampleMs * 2, Number(options.movementStallMs) || Math.min(6000, Math.max(3500, Math.floor(timeoutMs * 0.4))));
      const minDistance = Math.max(0.05, Number(options.movementMinDistance) || 0.25);
      let lastMovedAt = Date.now();
      let lastPosition = this.cloneValidPosition(this.bot.entity.position);
      racers.push(new Promise((_, reject) => {
        movementTimer = setInterval(async () => {
          if (finished) return;
          const currentPosition = this.bot?.entity?.position;
          if (!this.hasValidPosition(currentPosition) || !this.hasValidPosition(lastPosition)) return;
          const moved = this.distanceBetweenPositions(currentPosition, lastPosition);
          if (moved >= minDistance) {
            lastMovedAt = Date.now();
            lastPosition = this.cloneValidPosition(currentPosition);
            return;
          }
          if (Date.now() - lastMovedAt < stallMs) return;
          const label = options.label ? ` for ${options.label}` : "";
          await fail(reject, new Error(`movement stalled${label} after ${stallMs}ms`));
        }, sampleMs);
      }));
    }

    return Promise.race(racers).finally(() => {
      finished = true;
      clearTimeout(timer);
      if (movementTimer) clearInterval(movementTimer);
    });
  }

  randomOffset() {
    const radius = this.config.survival.exploreRadius;
    const sign = Math.random() > 0.5 ? 1 : -1;
    return sign * Math.floor(radius / 2 + Math.random() * radius);
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  formatPosition(position) {
    if (!this.hasValidPosition(position)) return "unknown";
    return `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`;
  }

  hasValidPosition(position) {
    return position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  }

  isNight() {
    const timeOfDay = this.bot.time?.timeOfDay;
    return typeof timeOfDay === "number" && timeOfDay >= 12541 && timeOfDay <= 23458;
  }
}

module.exports = { SurvivalController };