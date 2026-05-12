const { HOSTILE_MOBS } = require("../survival/constants");
const { createBehaviorTree } = require("./behaviorTree");

const MAX_RECENT_EVENTS = 80;
const MAX_INVENTORY_ITEMS = 40;
const MAX_ENTITIES = 16;
const MAX_TRACE_EVENTS = 24;
const MAX_TRACE_OBSERVATIONS = 16;
const MAX_TASK_TRACE_HISTORY = 32;
const MAX_TASK_TRACE_HISTORY_EVENTS = 120;
const MAX_TASK_TRACE_HISTORY_OBSERVATIONS = 120;
const MAX_TRACE_DETAIL_ARRAY_ITEMS = 12;
const MAX_TRACE_DETAIL_OBJECT_KEYS = 24;
const MAX_TRACE_DETAIL_DEPTH = 4;
const MAX_DIAGNOSTICS_HISTORY = 24;

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function serializePosition(position) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const serialized = { x: round(x), y: round(y), z: round(z) };
  serialized.text = `${serialized.x}, ${serialized.y}, ${serialized.z}`;
  return serialized;
}

function serializeError(error) {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  return String(error);
}

function stringifyArg(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function normalizeInventory(inventory = {}) {
  const items = Object.entries(inventory)
    .filter(([, count]) => Number(count) > 0)
    .map(([name, count]) => ({ name, count: Number(count) }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  return {
    totalKinds: items.length,
    totalItems: items.reduce((sum, item) => sum + item.count, 0),
    items: items.slice(0, MAX_INVENTORY_ITEMS)
  };
}

function normalizeEntities(entities = []) {
  return entities
    .filter((entity) => entity?.name && Number.isFinite(entity.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MAX_ENTITIES)
    .map((entity) => ({
      name: entity.name,
      distance: round(entity.distance),
      position: serializePosition(entity.position)
    }));
}

function toDegrees(radians) {
  if (!Number.isFinite(Number(radians))) return null;
  return round((Number(radians) * 180) / Math.PI, 1);
}

function normalizeBotPerspective(view = null) {
  if (!view || typeof view !== "object") return null;
  return {
    heading: view.heading ?? null,
    yawDeg: toDegrees(view.yaw),
    pitchDeg: toDegrees(view.pitch),
    eye: serializePosition(view.eye),
    direction: view.direction ? {
      x: round(view.direction.x, 3),
      y: round(view.direction.y, 3),
      z: round(view.direction.z, 3)
    } : null,
    targetEntity: view.targetEntity ? {
      name: view.targetEntity.name ?? null,
      distance: round(view.targetEntity.distance),
      position: serializePosition(view.targetEntity.position)
    } : null,
    frontBlocks: Array.isArray(view.frontBlocks)
      ? view.frontBlocks.slice(0, 16).map((block) => ({
        distance: Number(block.distance) || 0,
        name: block.name ?? null,
        solid: Boolean(block.solid),
        diggable: Boolean(block.diggable),
        position: serializePosition(block.position)
      }))
      : []
  };
}

function normalizeTerrainScan(terrain = null) {
  if (!terrain || typeof terrain !== "object") return null;
  const spatialStructure = terrain.spatialStructure ? {
    type: terrain.spatialStructure.type ?? null,
    summary: terrain.spatialStructure.summary ?? null,
    confined: Boolean(terrain.spatialStructure.confined),
    enclosed: Boolean(terrain.spatialStructure.enclosed),
    currentBodyOpen: Boolean(terrain.spatialStructure.currentBodyOpen),
    currentStandSafe: Boolean(terrain.spatialStructure.currentStandSafe),
    connectedStandCount: Number(terrain.spatialStructure.connectedStandCount) || 0,
    reachableSafeStandCount: Number(terrain.spatialStructure.reachableSafeStandCount) || 0,
    exitCount: Number(terrain.spatialStructure.exitCount) || 0,
    exitDirections: Array.isArray(terrain.spatialStructure.exitDirections) ? terrain.spatialStructure.exitDirections.slice(0, 4) : [],
    blockedSides: Number(terrain.spatialStructure.blockedSides) || 0,
    cardinalSides: Array.isArray(terrain.spatialStructure.cardinalSides)
      ? terrain.spatialStructure.cardinalSides.slice(0, 4).map((side) => ({
        direction: side.direction ?? null,
        passable: Boolean(side.passable),
        safeStand: Boolean(side.safeStand),
        blocked: Boolean(side.blocked),
        diggable: Boolean(side.diggable),
        feet: side.feet ?? null,
        head: side.head ?? null
      }))
      : [],
    verticalOpenBlocks: Number(terrain.spatialStructure.verticalOpenBlocks) || 0,
    openSky: Boolean(terrain.spatialStructure.openSky),
    airVolume: terrain.spatialStructure.airVolume ? {
      connectedAirCells: Number(terrain.spatialStructure.airVolume.connectedAirCells) || 0,
      sideOpeningCount: Number(terrain.spatialStructure.airVolume.sideOpeningCount) || 0,
      topOpening: Boolean(terrain.spatialStructure.airVolume.topOpening),
      bottomOpening: Boolean(terrain.spatialStructure.airVolume.bottomOpening),
      boundaryDirections: Array.isArray(terrain.spatialStructure.airVolume.boundaryDirections) ? terrain.spatialStructure.airVolume.boundaryDirections.slice(0, 4) : []
    } : null,
    recommendedAction: terrain.spatialStructure.recommendedAction ?? null,
    navigationKind: terrain.spatialStructure.navigationKind ?? null
  } : null;
  const exactLocal = terrain.exactLocal ? {
    radius: Number(terrain.exactLocal.radius) || 0,
    width: Number(terrain.exactLocal.width) || 0,
    center: serializePosition(terrain.exactLocal.center),
    safeStandCount: Number(terrain.exactLocal.safeStandCount) || 0,
    waterCount: Number(terrain.exactLocal.waterCount) || 0,
    hazardCount: Number(terrain.exactLocal.hazardCount) || 0,
    groundCounts: Array.isArray(terrain.exactLocal.groundCounts) ? terrain.exactLocal.groundCounts.slice(0, 12) : [],
    volume: terrain.exactLocal.volume ? {
      radius: Number(terrain.exactLocal.volume.radius) || 0,
      minDy: Number(terrain.exactLocal.volume.minDy) || 0,
      maxDy: Number(terrain.exactLocal.volume.maxDy) || 0,
      width: Number(terrain.exactLocal.volume.width) || 0,
      height: Number(terrain.exactLocal.volume.height) || 0,
      totalSamples: Number(terrain.exactLocal.volume.totalSamples) || 0,
      airCount: Number(terrain.exactLocal.volume.airCount) || 0,
      solidCount: Number(terrain.exactLocal.volume.solidCount) || 0,
      waterCount: Number(terrain.exactLocal.volume.waterCount) || 0,
      hazardCount: Number(terrain.exactLocal.volume.hazardCount) || 0,
      cells: Array.isArray(terrain.exactLocal.volume.cells) ? terrain.exactLocal.volume.cells.slice(0, 1800).map((cell) => ({
        dx: Number(cell.dx) || 0,
        dy: Number(cell.dy) || 0,
        dz: Number(cell.dz) || 0,
        position: serializePosition(cell.position),
        name: cell.name ?? null,
        solid: Boolean(cell.solid),
        passable: Boolean(cell.passable),
        diggable: Boolean(cell.diggable),
        water: Boolean(cell.water),
        hazard: Boolean(cell.hazard)
      })) : []
    } : null,
    cells: Array.isArray(terrain.exactLocal.cells) ? terrain.exactLocal.cells.slice(0, 121).map((cell) => ({
      dx: Number(cell.dx) || 0,
      dz: Number(cell.dz) || 0,
      position: serializePosition(cell.position),
      ground: cell.ground ?? null,
      feet: cell.feet ?? null,
      head: cell.head ?? null,
      safeStand: Boolean(cell.safeStand),
      water: Boolean(cell.water),
      hazard: Boolean(cell.hazard)
    })) : []
  } : null;
  const regional = terrain.regional ? {
    radius: Number(terrain.regional.radius) || 0,
    diameter: Number(terrain.regional.diameter) || 0,
    step: Number(terrain.regional.step) || 0,
    center: serializePosition(terrain.regional.center),
    sampledAt: terrain.regional.sampledAt ?? null,
    sampleCount: Number(terrain.regional.sampleCount) || 0,
    waterCells: Number(terrain.regional.waterCells) || 0,
    hazardCells: Number(terrain.regional.hazardCells) || 0,
    safeCells: Number(terrain.regional.safeCells) || 0,
    treeCells: Number(terrain.regional.treeCells) || 0,
    topBlocks: Array.isArray(terrain.regional.topBlocks) ? terrain.regional.topBlocks.slice(0, 16) : [],
    cells: Array.isArray(terrain.regional.cells) ? terrain.regional.cells.slice(0, 160).map((cell) => ({
      dx: Number(cell.dx) || 0,
      dz: Number(cell.dz) || 0,
      position: serializePosition(cell.position),
      topBlock: cell.topBlock ?? null,
      water: Boolean(cell.water),
      hazard: Boolean(cell.hazard),
      safeStand: Boolean(cell.safeStand),
      tree: Boolean(cell.tree)
    })) : []
  } : null;
  const descent = terrain.descent ? {
    needsDescent: Boolean(terrain.descent.needsDescent),
    summary: terrain.descent.summary ?? null,
    bestTarget: terrain.descent.bestTarget ? {
      waterPosition: serializePosition(terrain.descent.bestTarget.waterPosition),
      entryPosition: serializePosition(terrain.descent.bestTarget.entryPosition),
      horizontalDistance: round(Number(terrain.descent.bestTarget.horizontalDistance) || 0),
      drop: Number(terrain.descent.bestTarget.drop) || 0,
      route: terrain.descent.bestTarget.route ?? null
    } : null,
    targetCount: Array.isArray(terrain.descent.targets) ? terrain.descent.targets.length : 0
  } : null;
  return {
    sampleRadius: Number(terrain.sampleRadius) || 0,
    primaryGround: terrain.primaryGround ?? null,
    ground: Array.isArray(terrain.ground) ? terrain.ground.slice(0, 8) : [],
    safeStandCount: Number(terrain.safeStandCount) || 0,
    waterSamples: Number(terrain.waterSamples) || 0,
    damagingSamples: Number(terrain.damagingSamples) || 0,
    nearbyWater: Array.isArray(terrain.nearbyWater) ? terrain.nearbyWater.slice(0, 8).map((entry) => ({ name: entry.name, position: serializePosition(entry.position) })) : [],
    nearbyLogs: Array.isArray(terrain.nearbyLogs) ? terrain.nearbyLogs.slice(0, 8).map((entry) => ({ name: entry.name, position: serializePosition(entry.position) })) : [],
    spatialStructure,
    exactLocal,
    regional,
    descent
  };
}

function normalizeNavigationAnalysis(analysis = null) {
  if (!analysis || typeof analysis !== "object") return null;
  return {
    trapped: Boolean(analysis.trapped),
    kind: analysis.kind ?? null,
    summary: analysis.summary ?? null,
    recommendedAction: analysis.recommendedAction ?? null,
    sameLevelExitCount: Number(analysis.sameLevelExitCount) || 0,
    blockingSides: Number(analysis.blockingSides) || 0,
    supportColumnDepth: Number(analysis.supportColumnDepth) || 0,
    safeSupportDescent: Boolean(analysis.safeSupportDescent),
    supportBlock: analysis.supportBlock ? {
      name: analysis.supportBlock.name ?? null,
      solid: Boolean(analysis.supportBlock.solid),
      diggable: Boolean(analysis.supportBlock.diggable)
    } : null,
    belowSupportBlock: analysis.belowSupportBlock ? {
      name: analysis.belowSupportBlock.name ?? null,
      solid: Boolean(analysis.belowSupportBlock.solid),
      diggable: Boolean(analysis.belowSupportBlock.diggable)
    } : null,
    rim: serializePosition(analysis.rim),
    rimRise: Number.isFinite(Number(analysis.rimRise)) ? Number(analysis.rimRise) : null,
    routeOptions: Array.isArray(analysis.routeOptions) ? analysis.routeOptions.slice(0, 6) : []
  };
}

function normalizeProgress(progress = {}) {
  return {
    stage: progress.stage ?? "unknown",
    summary: progress.summary ?? "0/0",
    next: progress.next ? { id: progress.next.id, label: progress.next.label } : null,
    foodCount: Number(progress.foodCount) || 0,
    materialCount: Number(progress.materialCount) || 0,
    milestones: Array.isArray(progress.milestones)
      ? progress.milestones.map((milestone) => ({
        id: milestone.id,
        label: milestone.label,
        achieved: Boolean(milestone.achieved)
      }))
      : [],
    logsCount: Number(progress.logsCount) || 0,
    cobblestoneCount: Number(progress.cobblestoneCount) || 0,
    hasShelter: Boolean(progress.hasShelter),
    playbookEnabled: Boolean(progress.playbookEnabled),
    day1LogTarget: Number(progress.day1LogTarget) || 20,
    day1CobblestoneTarget: Number(progress.day1CobblestoneTarget) || 24,
    stockpileLogTarget: Number(progress.stockpileLogTarget) || 96,
    stockpileCobblestoneTarget: Number(progress.stockpileCobblestoneTarget) || 128
  };
}

function normalizeSkillPlan(skillEnvelope = {}) {
  const plan = skillEnvelope.plan;
  return {
    taskType: skillEnvelope.taskType ?? null,
    primarySkillId: skillEnvelope.primarySkillId ?? null,
    skillIds: Array.isArray(skillEnvelope.skillIds) ? [...skillEnvelope.skillIds] : [],
    plan: plan ? {
      ok: Boolean(plan.ok),
      skillId: plan.skillId,
      category: plan.category,
      title: plan.title,
      description: plan.description,
      tasks: Array.isArray(plan.tasks) ? [...plan.tasks] : [],
      nextTask: plan.nextTask ?? null,
      taskCount: Number(plan.taskCount) || 0,
      preconditions: plan.preconditions ?? [],
      success: plan.success ?? [],
      safety: plan.safety ?? []
    } : null
  };
}

function normalizeMemory(memory = {}) {
  const knownBlocks = Object.fromEntries(Object.entries(memory.knownBlocks ?? {})
    .map(([name, entries]) => [name, Array.isArray(entries) ? entries.length : 0]));
  const policyStats = Object.entries(memory.learning?.policyStats ?? {})
    .map(([key, stats]) => ({
      key,
      attempts: Number(stats.attempts) || 0,
      successes: Number(stats.successes) || 0,
      failures: Number(stats.failures) || 0,
      lastOutcome: stats.lastOutcome ?? null,
      lastReason: stats.lastReason ?? null,
      cooldownUntil: stats.cooldownUntil ?? null,
      updatedAt: stats.updatedAt ?? null
    }))
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, 12);

  const avoidedPositions = Array.isArray(memory.learning?.avoidedPositions)
    ? memory.learning.avoidedPositions.slice(-12).map((entry) => ({
      action: entry.action,
      target: entry.target,
      reason: entry.reason,
      position: serializePosition(entry.position),
      radius: Number(entry.radius) || 0,
      failures: Number(entry.failures) || 0,
      expiresAt: entry.expiresAt ?? null
    })).reverse()
    : [];

  const exploration = memory.exploration && typeof memory.exploration === "object" ? {
    lastScanAt: memory.exploration.lastScanAt ?? null,
    lastPosition: serializePosition(memory.exploration.lastPosition),
    lastLocalScan: memory.exploration.lastLocalScan ?? null,
    lastRegionalScan: memory.exploration.lastRegionalScan ?? null,
    lastDescent: memory.exploration.lastDescent ?? null,
    visitedCount: Array.isArray(memory.exploration.visited) ? memory.exploration.visited.length : 0,
    coarseCellCount: memory.exploration.coarseCells && typeof memory.exploration.coarseCells === "object" ? Object.keys(memory.exploration.coarseCells).length : 0
  } : null;

  return { knownBlocks, policyStats, avoidedPositions, exploration };
}

function normalizeController(controller = {}) {
  return {
    lifecycleState: controller.lifecycleState ?? "active",
    busy: Boolean(controller.busy),
    emergencyBusy: Boolean(controller.emergencyBusy),
    pausedUntil: Number(controller.pausedUntil) || 0,
    invalidPositionTicks: Number(controller.invalidPositionTicks) || 0,
    lastAction: controller.lastAction ? {
      type: controller.lastAction.type,
      skillId: controller.lastAction.skillId,
      position: serializePosition(controller.lastAction.position),
      startedAt: controller.lastAction.startedAt ?? null
    } : null,
    forcedTask: controller.forcedTask ? {
      taskType: controller.forcedTask.taskType,
      reason: controller.forcedTask.reason,
      source: controller.forcedTask.source,
      expiresAt: controller.forcedTask.expiresAt ?? null,
      remainingMs: Number(controller.forcedTask.remainingMs) || 0
    } : null,
    taskFeedback: normalizeTaskFeedback(controller.taskFeedback),
    taskProgress: normalizeTaskProgress(controller.taskProgress),
    testTasks: normalizePriorityTasks(controller.testTasks),
    priorityTasks: normalizePriorityTasks(controller.priorityTasks),
    behaviorQueue: normalizeBehaviorQueue(controller.behaviorQueue),
    agents: normalizeAgents(controller.agents),
    actionSummary: normalizeActionSummary(controller.actionSummary),
    behaviorLog: normalizeBehaviorLog(controller.behaviorLog),
    modeLog: normalizeModeLog(controller.modeLog),
    explorationStrategy: normalizeExplorationStrategy(controller.explorationStrategy)
  };
}

function normalizeActionSummary(summary = null) {
  if (!summary || typeof summary !== "object") return null;
  return {
    currentDecisionType: summary.currentDecisionType ?? null,
    currentTrace: summary.currentTrace ? {
      id: summary.currentTrace.id ?? null,
      taskType: summary.currentTrace.taskType ?? null,
      status: summary.currentTrace.status ?? null,
      activePhaseId: summary.currentTrace.activePhaseId ?? null,
      activePhaseLabel: summary.currentTrace.activePhaseLabel ?? null,
      updatedAt: summary.currentTrace.updatedAt ?? null
    } : null,
    lastAction: summary.lastAction ? {
      type: summary.lastAction.type ?? null,
      skillId: summary.lastAction.skillId ?? null,
      position: serializePosition(summary.lastAction.position),
      startedAt: summary.lastAction.startedAt ?? null
    } : null,
    lastFeedback: summary.lastFeedback ?? null
  };
}

function normalizeBehaviorLog(behaviorLog = []) {
  return Array.isArray(behaviorLog)
    ? behaviorLog.slice(-20).map((event = {}) => ({
      at: event.at ?? null,
      level: event.level ?? "info",
      kind: event.kind ?? "event",
      message: event.message ?? "",
      details: normalizeTraceDetails(event.details ?? {})
    })).reverse()
    : [];
}

function normalizeModeLog(modeLog = []) {
  return Array.isArray(modeLog)
    ? modeLog.slice(-30).map((event = {}) => ({
      at: event.at ?? null,
      level: event.level ?? "info",
      mode: event.mode ?? "local",
      event: event.event ?? "event",
      taskType: event.taskType ?? null,
      ruleDecision: event.ruleDecision ?? null,
      reason: event.reason ?? null,
      outcome: event.outcome ?? null,
      details: normalizeTraceDetails(event.details ?? {})
    })).reverse()
    : [];
}

function normalizeExplorationStrategy(strategy = null) {
  if (!strategy || typeof strategy !== "object") return null;
  return {
    recentTargets: Array.isArray(strategy.recentTargets) ? strategy.recentTargets.slice(-8).map((entry = {}) => ({
      position: serializePosition(entry.position),
      reached: Boolean(entry.reached),
      purpose: entry.purpose ?? null,
      at: entry.at ?? null
    })).reverse() : [],
    unreachableTargets: Array.isArray(strategy.unreachableTargets) ? strategy.unreachableTargets.slice(0, 8).map((entry = {}) => ({
      position: serializePosition(entry.position),
      reason: entry.reason ?? null,
      label: entry.label ?? null,
      target: entry.target ?? null,
      attempts: Number(entry.attempts) || 0,
      lastDistance: round(Number(entry.lastDistance)),
      movedDistance: round(Number(entry.movedDistance)),
      expiresAt: entry.expiresAt ?? null
    })) : []
  };
}

function normalizeBehaviorQueue(behaviorQueue = {}) {
  const normalizeNode = (node = {}) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    phaseId: node.phaseId ?? null,
    handler: node.handler ?? null,
    until: node.until ?? null,
    maxIterations: Number(node.maxIterations) || null,
    continueOnFailure: Boolean(node.continueOnFailure),
    continueOnChildFailure: Boolean(node.continueOnChildFailure),
    nodes: Array.isArray(node.nodes) ? node.nodes.slice(0, 12).map(normalizeNode) : []
  });

  const normalizeTree = (tree = null) => (tree && (tree.id || tree.taskType)) ? ({
    id: tree.id ?? null,
    taskType: tree.taskType ?? null,
    label: tree.label ?? null,
    treeClass: tree.treeClass ?? null,
    taskFunction: tree.taskFunction ?? null,
    constructorArgs: normalizeTraceDetails(tree.constructorArgs ?? tree.parameters ?? {}),
    parameterSchema: normalizeTraceDetails(tree.parameterSchema ?? {}),
    priority: Number(tree.priority) || 0,
    level: tree.level ?? null,
    status: tree.status ?? "unknown",
    source: tree.source ?? null,
    sourceAgent: tree.sourceAgent ?? null,
    sourcePlanId: tree.sourcePlanId ?? null,
    requestedBy: tree.requestedBy ?? null,
    taskRequestId: tree.taskRequestId ?? null,
    reason: tree.reason ?? null,
    createdAt: tree.createdAt ?? null,
    expiresAt: tree.expiresAt ?? null,
    startedAt: tree.startedAt ?? null,
    completedAt: tree.completedAt ?? null,
    parameters: normalizeTraceDetails(tree.parameters ?? tree.constructorArgs ?? {}),
    attempts: Number(tree.attempts) || 0,
    lastOutcome: tree.lastOutcome ?? null,
    lastReason: tree.lastReason ?? null,
    preconditions: Array.isArray(tree.preconditions) ? tree.preconditions.slice(0, 8) : [],
    postconditions: Array.isArray(tree.postconditions) ? tree.postconditions.slice(0, 8) : [],
    nodes: Array.isArray(tree.nodes) ? tree.nodes.slice(0, 10).map(normalizeNode) : []
  }) : null;

  return {
    enabled: behaviorQueue?.enabled !== false,
    active: Boolean(behaviorQueue?.active),
    currentTree: normalizeTree(behaviorQueue?.currentTree),
    pendingTrees: Array.isArray(behaviorQueue?.pendingTrees) ? behaviorQueue.pendingTrees.slice(0, 12).map(normalizeTree) : [],
    completedTrees: Array.isArray(behaviorQueue?.completedTrees) ? behaviorQueue.completedTrees.slice(0, 8).map(normalizeTree) : [],
    feedback: Array.isArray(behaviorQueue?.feedback) ? behaviorQueue.feedback.slice(0, 12) : [],
    lastEvent: behaviorQueue?.lastEvent ?? null
  };
}

function normalizeAgents(agents = {}) {
  return {
    enabled: agents?.enabled !== false,
    generalAgent: agents?.generalAgent ?? null,
    agents: Array.isArray(agents?.agents) ? agents.agents.slice(0, 8) : [],
    lastProposals: Array.isArray(agents?.lastProposals) ? agents.lastProposals.slice(0, 8) : [],
    feedback: Array.isArray(agents?.feedback) ? agents.feedback.slice(0, 12) : [],
    updatedAt: agents?.updatedAt ?? null
  };
}

function normalizeTaskProgress(taskProgress = null) {
  if (!taskProgress || typeof taskProgress !== "object") return null;
  return {
    taskType: taskProgress.taskType ?? null,
    status: taskProgress.status ?? "unknown",
    reason: taskProgress.reason ?? null,
    startedAt: taskProgress.startedAt ?? null,
    lastProgressAt: taskProgress.lastProgressAt ?? null,
    updatedAt: taskProgress.updatedAt ?? null,
    noProgressMs: Number(taskProgress.noProgressMs) || 0,
    interrupted: Boolean(taskProgress.interrupted),
    position: serializePosition(taskProgress.position),
    inventorySignature: taskProgress.inventorySignature ?? null,
    phaseKey: taskProgress.phaseKey ?? null
  };
}

function normalizeTaskFeedback(taskFeedback = {}) {
  const normalizeFailure = (failure = {}) => ({
    taskType: failure.taskType ?? null,
    action: failure.action ?? null,
    reason: failure.reason ?? null,
    target: failure.target ?? null,
    position: serializePosition(failure.position),
    at: failure.at ?? null
  });

  return {
    recentFailures: Array.isArray(taskFeedback?.recentFailures) ? taskFeedback.recentFailures.slice(0, 12).map(normalizeFailure) : [],
    blockedTasks: Array.isArray(taskFeedback?.blockedTasks)
      ? taskFeedback.blockedTasks.slice(0, 8).map((task = {}) => ({
        taskType: task.taskType ?? null,
        reason: task.reason ?? null,
        failureCount: Number(task.failureCount) || 0,
        lastAction: task.lastAction ?? null,
        lastTarget: task.lastTarget ?? null,
        recoveryTasks: Array.isArray(task.recoveryTasks) ? task.recoveryTasks.slice(0, 6) : [],
        blockedAt: task.blockedAt ?? null,
        expiresAt: task.expiresAt ?? null
      }))
      : [],
    lastEvent: taskFeedback?.lastEvent ?? null
  };
}

function normalizePriorityTasks(priorityTasks = {}) {
  const normalizeTask = (task = {}) => ({
    id: task.id ?? null,
    type: task.type ?? task.taskType ?? null,
    priority: Number(task.priority) || 0,
    status: task.status ?? "unknown",
    reason: task.reason ?? null,
    source: task.source ?? null,
    expiresAt: task.expiresAt ?? null,
    startedAt: task.startedAt ?? null,
    completedAt: task.completedAt ?? null,
    attempts: Number(task.attempts) || 0,
    lastOutcome: task.lastOutcome ?? null,
    lastReason: task.lastReason ?? null
  });

  return {
    active: Boolean(priorityTasks?.active),
    currentTask: priorityTasks?.currentTask ? normalizeTask(priorityTasks.currentTask) : null,
    pendingTasks: Array.isArray(priorityTasks?.pendingTasks) ? priorityTasks.pendingTasks.slice(0, 12).map(normalizeTask) : [],
    completedTasks: Array.isArray(priorityTasks?.completedTasks) ? priorityTasks.completedTasks.slice(0, 8).map(normalizeTask) : [],
    lastEvent: priorityTasks?.lastEvent ?? null
  };
}

function summarizeTraceValue(value) {
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (value && typeof value === "object") {
    const summary = {};
    if (value.name) summary.name = String(value.name);
    if (value.type) summary.type = String(value.type);
    if (value.id !== undefined) summary.id = value.id;
    if (value.position) summary.position = serializePosition(value.position);
    return Object.keys(summary).length ? summary : `[${value.constructor?.name ?? "Object"}]`;
  }
  return String(value);
}

function normalizeTraceValue(value, key = "", depth = 0, seen = new WeakSet()) {
  if (key.toLowerCase().includes("key")) return "[redacted]";
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)) return serializePosition(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_TRACE_DETAIL_DEPTH) return summarizeTraceValue(value);

  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_TRACE_DETAIL_ARRAY_ITEMS)
      .map((item, index) => normalizeTraceValue(item, `${key}[${index}]`, depth + 1, seen));
  }

  let entries = [];
  try {
    entries = Object.entries(value).slice(0, MAX_TRACE_DETAIL_OBJECT_KEYS);
  } catch {
    return summarizeTraceValue(value);
  }
  return Object.fromEntries(entries.map(([childKey, childValue]) => [
    childKey,
    normalizeTraceValue(childValue, childKey, depth + 1, seen)
  ]));
}

function normalizeTraceDetails(details = {}) {
  if (!details || typeof details !== "object") return normalizeTraceValue(details);
  return normalizeTraceValue(details);
}

function normalizeTraceEvent(event = {}) {
  return {
    id: event.id ?? "unknown",
    label: event.label ?? event.id ?? "unknown",
    status: event.status ?? "active",
    kind: event.kind ?? null,
    at: event.at ?? null,
    details: normalizeTraceDetails(event.details ?? {})
  };
}

function normalizeTraceObservation(observation = {}) {
  return {
    at: observation.at ?? null,
    level: observation.level ?? "info",
    kind: observation.kind ?? "observation",
    message: observation.message ?? "",
    details: normalizeTraceDetails(observation.details ?? {})
  };
}

function normalizeTaskTrace(trace = {}) {
  const phaseEvents = Array.isArray(trace.phaseEvents)
    ? trace.phaseEvents.slice(-MAX_TRACE_EVENTS).map(normalizeTraceEvent)
    : [];
  const observations = Array.isArray(trace.observations)
    ? trace.observations.slice(-MAX_TRACE_OBSERVATIONS).map(normalizeTraceObservation).reverse()
    : [];
  const risks = observations.filter((observation) => observation.level === "warn" || observation.kind === "risk").slice(0, 8);
  const activePhase = phaseEvents.find((event) => event.id === trace.activePhaseId) ?? phaseEvents.at(-1) ?? null;
  const finishedAt = trace.finishedAt ?? ((trace.status !== "running" && trace.status !== "idle") ? trace.updatedAt : null);

  return {
    id: trace.id ?? null,
    taskType: trace.taskType ?? null,
    skillId: trace.skillId ?? null,
    status: trace.status ?? "idle",
    reason: trace.reason ?? null,
    startedAt: trace.startedAt ?? null,
    updatedAt: trace.updatedAt ?? null,
    finishedAt,
    activePhaseId: trace.activePhaseId ?? activePhase?.id ?? null,
    activePhaseLabel: trace.activePhaseLabel ?? activePhase?.label ?? null,
    target: trace.target ?? null,
    phaseEvents,
    observations,
    risks
  };
}

function normalizeTaskTraceForHistory(trace = {}) {
  const normalized = normalizeTaskTrace(trace);
  const phaseEvents = Array.isArray(trace.phaseEvents)
    ? trace.phaseEvents.slice(-MAX_TASK_TRACE_HISTORY_EVENTS).map(normalizeTraceEvent)
    : [];
  const observations = Array.isArray(trace.observations)
    ? trace.observations.slice(-MAX_TASK_TRACE_HISTORY_OBSERVATIONS).map(normalizeTraceObservation)
    : [];
  const risks = observations
    .filter((observation) => observation.level === "warn" || observation.kind === "risk")
    .slice(-16)
    .reverse();

  return {
    ...normalized,
    phaseEvents,
    observations,
    risks,
    phaseEventCount: phaseEvents.length,
    observationCount: observations.length
  };
}

function summarizeTaskTraceForHistory(trace = {}) {
  const normalized = normalizeTaskTraceForHistory(trace);
  if (!normalized.id || !normalized.taskType || normalized.status === "idle") return null;
  const startedAtMs = Date.parse(normalized.startedAt ?? "");
  const finishedAtMs = Date.parse((normalized.finishedAt ?? normalized.updatedAt) ?? "");
  const durationMs = Number.isFinite(startedAtMs) && Number.isFinite(finishedAtMs)
    ? Math.max(0, finishedAtMs - startedAtMs)
    : null;
  return {
    id: normalized.id,
    taskType: normalized.taskType,
    skillId: normalized.skillId,
    status: normalized.status,
    reason: normalized.reason,
    target: normalized.target,
    startedAt: normalized.startedAt,
    finishedAt: normalized.finishedAt ?? normalized.updatedAt,
    durationMs,
    activePhaseId: normalized.activePhaseId,
    activePhaseLabel: normalized.activePhaseLabel,
    phaseEventCount: normalized.phaseEventCount,
    observationCount: normalized.observationCount,
    phaseEvents: normalized.phaseEvents,
    observations: normalized.observations,
    risks: normalized.risks
  };
}

function traceHistoryKey(trace = {}) {
  return `${trace.id ?? "no-id"}#${trace.status ?? "unknown"}#${trace.finishedAt ?? trace.updatedAt ?? "no-time"}`;
}

function normalizeLlmState(llm = {}) {
  const normalizeTaskRequest = (request = {}) => ({
    requestId: request.requestId ?? null,
    fromAgent: request.fromAgent ?? null,
    assignedAgent: request.assignedAgent ?? null,
    taskType: request.taskType ?? null,
    treeClass: request.treeClass ?? null,
    taskFunction: request.taskFunction ?? null,
    constructorArgs: normalizeTraceDetails(request.constructorArgs ?? request.parameters ?? {}),
    action: request.action ?? null,
    level: request.level ?? null,
    priority: Number(request.priority) || 0,
    objective: request.objective ?? null,
    reason: request.reason ?? null,
    parameters: normalizeTraceDetails(request.parameters ?? request.constructorArgs ?? {}),
    successCriteria: Array.isArray(request.successCriteria) ? request.successCriteria.slice(0, 8) : []
  });

  return {
    enabled: Boolean(llm.enabled),
    disabledReason: llm.disabledReason ?? null,
    status: llm.status ?? (llm.enabled ? "idle" : "disabled"),
    model: llm.model ?? null,
    baseHost: llm.baseHost ?? null,
    lastCallAt: llm.lastCallAt ?? null,
    updatedAt: llm.updatedAt ?? null,
    lastPlan: llm.lastPlan ? {
      brainAgent: llm.lastPlan.brainAgent ?? null,
      stageAssessment: llm.lastPlan.stageAssessment ?? "",
      goal: llm.lastPlan.goal ?? "",
      tasks: Array.isArray(llm.lastPlan.tasks) ? [...llm.lastPlan.tasks] : [],
      agentDirectives: Array.isArray(llm.lastPlan.agentDirectives) ? llm.lastPlan.agentDirectives.slice(0, 8).map((directive) => ({
        directiveId: directive.directiveId ?? null,
        fromAgent: directive.fromAgent ?? null,
        toAgent: directive.toAgent ?? null,
        action: directive.action ?? null,
        reason: directive.reason ?? null,
        taskRequest: directive.taskRequest ? normalizeTaskRequest(directive.taskRequest) : null
      })) : [],
      taskRequests: Array.isArray(llm.lastPlan.taskRequests) ? llm.lastPlan.taskRequests.slice(0, 8).map(normalizeTaskRequest) : [],
      behaviorTrees: Array.isArray(llm.lastPlan.behaviorTrees) ? llm.lastPlan.behaviorTrees.slice(0, 8).map((tree) => ({
        taskType: tree.taskType,
        treeClass: tree.treeClass ?? null,
        taskFunction: tree.taskFunction ?? null,
        constructorArgs: normalizeTraceDetails(tree.constructorArgs ?? tree.parameters ?? {}),
        level: tree.level ?? null,
        priority: Number(tree.priority) || 0,
        reason: tree.reason ?? null,
        sourceAgent: tree.sourceAgent ?? null,
        requestedBy: tree.requestedBy ?? null,
        taskRequestId: tree.taskRequestId ?? null,
        parameters: normalizeTraceDetails(tree.parameters ?? tree.constructorArgs ?? {}),
      })) : [],
      reason: llm.lastPlan.reason ?? "",
      constraints: Array.isArray(llm.lastPlan.constraints) ? [...llm.lastPlan.constraints] : [],
      confidence: llm.lastPlan.confidence ?? null,
      validation: llm.lastPlan.validation ?? null,
      dryRun: llm.lastPlan.dryRun !== false,
      accepted: Boolean(llm.lastPlan.accepted),
      queue: llm.lastPlan.queue ?? null,
      ruleDecision: llm.lastPlan.ruleDecision ?? null,
      createdAt: llm.lastPlan.createdAt ?? null
    } : null,
    taskQueue: llm.taskQueue ? {
      enabled: Boolean(llm.taskQueue.enabled),
      active: Boolean(llm.taskQueue.active),
      plan: llm.taskQueue.plan ?? null,
      currentTask: llm.taskQueue.currentTask ?? null,
      pendingTasks: Array.isArray(llm.taskQueue.pendingTasks) ? llm.taskQueue.pendingTasks.slice(0, 10) : [],
      completedTasks: Array.isArray(llm.taskQueue.completedTasks) ? llm.taskQueue.completedTasks.slice(0, 10) : [],
      lastEvent: llm.taskQueue.lastEvent ?? null
    } : null,
    lastError: llm.lastError ?? null,
    recentCalls: Array.isArray(llm.recentCalls) ? llm.recentCalls.slice(0, 20).map((call) => ({
      timestamp: call.timestamp ?? null,
      type: call.type ?? "unknown",
      status: call.status ?? "unknown",
      model: call.model ?? null,
      baseHost: call.baseHost ?? null,
      durationMs: call.durationMs ?? null,
      usage: call.usage ?? null,
      promptSummary: call.promptSummary ?? null,
      responseSummary: call.responseSummary ?? null,
      toolResults: call.toolResults ?? [],
      plan: call.plan ?? null,
      error: call.error ?? null
    })) : []
  };
}

function timestampToAgeMs(timestamp, nowMs) {
  const parsed = Date.parse(timestamp ?? "");
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, nowMs - parsed);
}

function recommendationForSignal(signal = {}) {
  switch (signal.code) {
    case "connection_not_ready":
      return "检查 BOT 进程与服务器端口连通性，优先确认 MC_HOST/MC_PORT 与服务在线状态。";
    case "position_unavailable":
      return "检查实体状态是否有效，必要时触发位置恢复或短暂停机后重连。";
    case "bot_perspective_missing":
      return "检查控制器快照中 botPerspective 采样逻辑是否执行，确认前端已连接最新后端实例。";
    case "hazard_without_escape":
      return "立即提升逃生任务优先级（escape_hazard/evade_hostiles），禁止进入普通采集流程。";
    case "hazard_handling":
      return "继续观察危险解除信号；若连续多个 tick 未解除，触发重规划并切换脱困策略。";
    case "falling_block_hazard":
      return "立即中断普通采集，清理 BOT 头/脚空间或移动到无沙砾坠落风险的安全站位。";
    case "player_state_parity_warning":
      return "检查 gamemode、activeEffects、abilities、attributes 与服务器 difficulty；只做诊断，不给 BOT 添加特权修正。";
    case "controller_emergency_busy":
      return "保持紧急流程独占，暂缓普通任务，确认 emergencyBusy 能在危险解除后回落。";
    case "blocked_tasks_present":
      return "查看 blockedTasks 的 recoveryTasks，优先执行探索/换位等恢复动作，避免原地重试。";
    case "task_no_progress":
      return "当前任务已被执行监督判定为无进展，应中断原动作、记录 taskFeedback，并切换到 blockedTasks 指定的恢复任务。";
    case "critical_health":
      return "暂停普通任务，优先吃食物、撤离威胁或进入饥饿恢复。";
    case "starvation_empty_food":
      return "确认 recover_starvation 是否推进；若无近处食物，应持续避险并等待安全搜索窗口。";
    case "night_hostile_pressure":
      return "夜间开放地带存在敌对压力，应持续执行 evade_hostiles/defend_self 或封闭庇护。";
    case "behavior_queue_safety_paused":
      return "清理与当前硬安全任务不匹配的旧行为树，避免安全接管被队列暂停表现卡住。";
    case "task_trace_stale":
      return "检查阶段推进与观测日志是否卡住；若超过阈值，触发中断并重启当前任务阶段。";
    default:
      return "继续观察并结合任务追踪确认控制链路是否推进。";
  }
}

function diagnosticsSignature(diagnostics = {}) {
  const codes = Array.isArray(diagnostics.signals)
    ? diagnostics.signals.map((signal) => `${signal.level}:${signal.code}`).join("|")
    : "";
  return `${diagnostics.overall ?? "unknown"}#${codes}`;
}

function diagnosticsHistoryEntry(diagnostics = {}, servedAt = nowIso()) {
  return {
    at: servedAt,
    overall: diagnostics.overall ?? "unknown",
    summary: diagnostics.summary ?? null,
    signalCounts: diagnostics.signalCounts ?? { critical: 0, warning: 0, total: 0 },
    topSignals: Array.isArray(diagnostics.signals)
      ? diagnostics.signals.slice(0, 3).map((signal) => ({
        code: signal.code,
        level: signal.level,
        label: signal.label
      }))
      : []
  };
}

function buildDiagnostics(state, servedAtMs) {
  const signals = [];
  const connectionState = state.connection?.state ?? "starting";
  const decisionType = state.decision?.type ?? null;
  const controller = state.controller ?? {};
  const taskTrace = state.taskTrace ?? {};
  const world = state.world ?? {};
  const hardHazardTasks = new Set(["escape_hazard", "evade_hostiles", "defend_self", "recover_starvation"]);
  const botHealth = Number(state.bot?.health ?? 20);
  const botFood = Number(state.bot?.food ?? 20);

  if (connectionState !== "connected") {
    signals.push({
      level: "critical",
      code: "connection_not_ready",
      label: "连接异常",
      detail: `state=${connectionState}`
    });
  }

  if (!state.bot?.position) {
    signals.push({
      level: "critical",
      code: "position_unavailable",
      label: "位置缺失",
      detail: "BOT 坐标未上报"
    });
  }

  if (!state.botPerspective) {
    signals.push({
      level: "warning",
      code: "bot_perspective_missing",
      label: "视角缺失",
      detail: "未收到 BOT 视角采样"
    });
  }

  if (world.environmentHazard) {
    const expected = hardHazardTasks.has(decisionType);
    signals.push({
      level: expected ? "warning" : "critical",
      code: expected ? "hazard_handling" : "hazard_without_escape",
      label: expected ? "危险处理中" : "危险未被正确处理",
      detail: `${world.environmentHazard.name} / decision=${decisionType ?? "none"}`
    });
  }

  if (world.fallingBlockHazard) {
    const expected = decisionType === "escape_hazard" || controller.emergencyBusy;
    signals.push({
      level: expected ? "warning" : "critical",
      code: "falling_block_hazard",
      label: expected ? "落沙脱困中" : "落沙风险未处理",
      detail: `${world.fallingBlockHazard.name}; reason=${world.fallingBlockHazard.reason ?? "unknown"}; decision=${decisionType ?? "none"}`
    });
  }

  const playerWarnings = Array.isArray(state.bot?.playerState?.warnings) ? state.bot.playerState.warnings : [];
  if (playerWarnings.length > 0) {
    signals.push({
      level: "warning",
      code: "player_state_parity_warning",
      label: "玩家状态需核查",
      detail: playerWarnings.map((warning) => warning.code).join(",")
    });
  }

  if (controller.emergencyBusy) {
    signals.push({
      level: "warning",
      code: "controller_emergency_busy",
      label: "紧急流程占用",
      detail: "控制器正在处理紧急状态"
    });
  }

  const blockedCount = controller.taskFeedback?.blockedTasks?.length ?? 0;
  if (blockedCount > 0) {
    signals.push({
      level: "warning",
      code: "blocked_tasks_present",
      label: "任务阻塞",
      detail: `${blockedCount} 个任务被阻塞`
    });
  }

  const taskProgress = controller.taskProgress ?? null;
  if (taskProgress?.status === "stuck") {
    signals.push({
      level: "warning",
      code: "task_no_progress",
      label: "任务无进展",
      detail: `${taskProgress.taskType ?? "unknown"}; stalled=${Math.round((Number(taskProgress.noProgressMs) || 0) / 1000)}s; reason=${taskProgress.reason ?? "unknown"}`
    });
  }

  if (Number.isFinite(botHealth) && botHealth <= 4) {
    signals.push({
      level: "critical",
      code: "critical_health",
      label: "生命极低",
      detail: `health=${botHealth}/20; decision=${decisionType ?? "none"}`
    });
  } else if (Number.isFinite(botHealth) && botHealth <= 8) {
    signals.push({
      level: "warning",
      code: "critical_health",
      label: "生命偏低",
      detail: `health=${botHealth}/20; decision=${decisionType ?? "none"}`
    });
  }

  if (Number.isFinite(botFood) && botFood <= 0) {
    signals.push({
      level: botHealth <= 8 ? "critical" : "warning",
      code: "starvation_empty_food",
      label: "饥饿见底",
      detail: `food=${botFood}/20; decision=${decisionType ?? "none"}`
    });
  }

  const nearestHostile = Array.isArray(state.entities)
    ? state.entities.find((entity) => HOSTILE_MOBS.has(entity.name) && Number(entity.distance) <= 28)
    : null;
  if (world.isNight && nearestHostile && !["evade_hostiles", "defend_self", "defend_shelter", "escape_hazard"].includes(decisionType)) {
    signals.push({
      level: botHealth <= 8 ? "critical" : "warning",
      code: "night_hostile_pressure",
      label: "夜间敌对压力",
      detail: `${nearestHostile.name} at ${nearestHostile.distance} blocks; decision=${decisionType ?? "none"}`
    });
  }

  const behaviorQueueEvent = controller.behaviorQueue?.lastEvent;
  if (behaviorQueueEvent?.type === "paused" && /hard_safety/.test(behaviorQueueEvent.reason ?? "")) {
    signals.push({
      level: "warning",
      code: "behavior_queue_safety_paused",
      label: "安全队列暂停",
      detail: `${behaviorQueueEvent.reason}; queued=${behaviorQueueEvent.details?.queuedTask ?? "unknown"}`
    });
  }

  const snapshotAgeMs = timestampToAgeMs(state.updatedAt, servedAtMs);
  const traceTimestamp = taskTrace.updatedAt ?? taskTrace.startedAt ?? state.updatedAt;
  const traceAgeMs = timestampToAgeMs(traceTimestamp, servedAtMs);
  if (controller.busy && Number.isFinite(traceAgeMs) && traceAgeMs > 15000) {
    signals.push({
      level: "warning",
      code: "task_trace_stale",
      label: "阶段追踪滞后",
      detail: `trace_age=${Math.round(traceAgeMs / 1000)}s`
    });
  }

  const criticalCount = signals.filter((signal) => signal.level === "critical").length;
  const warningCount = signals.filter((signal) => signal.level === "warning").length;
  const overall = criticalCount > 0 ? "critical" : (warningCount > 0 ? "warning" : "healthy");
  const summary = overall === "healthy"
    ? "控制系统状态稳定"
    : `${criticalCount > 0 ? `${criticalCount} critical` : ""}${criticalCount > 0 && warningCount > 0 ? " / " : ""}${warningCount > 0 ? `${warningCount} warning` : ""}`;

  return {
    overall,
    summary,
    snapshotAgeMs,
    traceAgeMs,
    signalCounts: {
      critical: criticalCount,
      warning: warningCount,
      total: signals.length
    },
    recommendations: signals.slice(0, 6).map((signal) => ({
      code: signal.code,
      level: signal.level,
      action: recommendationForSignal(signal)
    })),
    signals: signals.slice(0, 12)
  };
}

function createInitialState(config = {}) {
  return {
    startedAt: nowIso(),
    updatedAt: null,
    connection: {
      state: "starting",
      host: config.host ?? "localhost",
      port: config.port ?? 8000,
      username: config.username ?? "SurvivalBot",
      minecraftVersion: config.version ?? "auto",
      message: "dashboard initialized"
    },
    bot: {
      health: null,
      food: null,
      oxygen: null,
      position: null,
      dimension: "unknown",
      experience: null
    },
    world: {
      timeOfDay: 0,
      isNight: false,
      environmentHazard: null,
      navigationTrap: false,
      navigationAnalysis: null,
      isInLava: false,
      isBodyInWater: false,
      terrain: null,
      timeSinceOnGround: 0
    },
    decision: null,
    skillPlan: normalizeSkillPlan(),
    controller: normalizeController(),
    progress: normalizeProgress(),
    inventory: normalizeInventory(),
    entities: [],
    botPerspective: null,
    memory: normalizeMemory(),
    taskTrace: normalizeTaskTrace(),
    taskTraceHistory: [],
    behaviorTree: createBehaviorTree(),
    diagnostics: {
      overall: "warning",
      summary: "等待首个状态快照",
      snapshotAgeMs: null,
      traceAgeMs: null,
      signalCounts: { critical: 0, warning: 1, total: 1 },
      recommendations: [{ code: "waiting_first_tick", level: "warning", action: "等待首个状态快照后再评估控制健康。" }],
      signals: [{ level: "warning", code: "waiting_first_tick", label: "等待状态", detail: "尚未收到控制器快照" }]
    },
    diagnosticsHistory: [],
    llm: normalizeLlmState(config.llm ?? {}),
    recentEvents: []
  };
}

function createDashboardState(config = {}) {
  const state = createInitialState(config);
  let lastDiagnosticsSignature = null;
  const recordedTraceKeys = new Set();

  function rememberTaskTrace(trace = {}, { forceStatus = null } = {}) {
    const source = forceStatus ? { ...trace, status: forceStatus } : trace;
    const summary = summarizeTaskTraceForHistory(source);
    if (!summary) return;
    if (summary.status === "running") return;
    const key = traceHistoryKey(summary);
    if (recordedTraceKeys.has(key)) return;
    recordedTraceKeys.add(key);
    state.taskTraceHistory.unshift(summary);
    state.taskTraceHistory = state.taskTraceHistory.slice(0, MAX_TASK_TRACE_HISTORY);
  }

  function updateTaskTrace(trace = {}) {
    const previous = state.taskTrace;
    const next = normalizeTaskTrace(trace);
    if (previous?.id && previous.id !== next.id && previous.status === "running") {
      rememberTaskTrace(previous, { forceStatus: "interrupted" });
    }
    if (next?.id && next.status !== "running") {
      rememberTaskTrace(trace);
    }
    state.taskTrace = next;
    state.behaviorTree = createBehaviorTree(state.decision?.type ?? next.taskType, next);
    state.updatedAt = nowIso();
  }

  function pushEvent(event) {
    state.recentEvents.unshift({
      timestamp: event.timestamp ?? nowIso(),
      level: event.level ?? "info",
      message: event.message ?? "",
      details: event.details ?? null
    });
    state.recentEvents = state.recentEvents.slice(0, MAX_RECENT_EVENTS);
  }

  return {
    recordLog(entry = {}) {
      pushEvent({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message || (Array.isArray(entry.args) ? entry.args.map(stringifyArg).join(" ") : ""),
        details: entry.error ? { error: serializeError(entry.error) } : null
      });
    },

    recordEvent(level, message, details = null) {
      pushEvent({ level, message, details });
    },

    setConnection(update = {}) {
      state.connection = {
        ...state.connection,
        ...update,
        updatedAt: nowIso()
      };
    },

    setLlmState(update = {}) {
      state.llm = normalizeLlmState({
        ...state.llm,
        ...update,
        updatedAt: nowIso()
      });
    },

    setTaskTrace(trace = {}) {
      updateTaskTrace(trace);
    },

    publishTick({ snapshot, decision, skillEnvelope, progress, memory, dimension, controller } = {}) {
      if (!snapshot) return;
      state.updatedAt = nowIso();
      state.bot = {
        health: Number(snapshot.health) || 0,
        food: Number(snapshot.food) || 0,
        oxygen: Number(snapshot.oxygen) || 0,
        position: serializePosition(snapshot.position),
        dimension: dimension ?? "unknown",
        experience: snapshot.experience ?? null,
        playerState: snapshot.playerState ?? null
      };
      state.world = {
        timeOfDay: Number(snapshot.timeOfDay) || 0,
        isNight: Boolean(snapshot.isNight),
        environmentHazard: snapshot.environmentHazard ? {
          name: snapshot.environmentHazard.name,
          distance: round(snapshot.environmentHazard.distance)
        } : null,
        fallingBlockHazard: snapshot.fallingBlockHazard ? {
          name: snapshot.fallingBlockHazard.name,
          position: serializePosition(snapshot.fallingBlockHazard.position),
          distance: round(snapshot.fallingBlockHazard.distance ?? 0),
          role: snapshot.fallingBlockHazard.role ?? null,
          reason: snapshot.fallingBlockHazard.reason ?? null
        } : null,
        navigationTrap: Boolean(snapshot.navigationTrap),
        navigationAnalysis: normalizeNavigationAnalysis(snapshot.navigationAnalysis),
        isInLava: Boolean(snapshot.isInLava),
        isBodyInWater: Boolean(snapshot.isBodyInWater),
        terrain: normalizeTerrainScan(snapshot.terrain),
        timeSinceOnGround: Number(snapshot.timeSinceOnGround) || 0
      };
      state.decision = decision ? {
        type: decision.type,
        reason: decision.reason ?? null,
        target: decision.target ?? null
      } : null;
      state.skillPlan = normalizeSkillPlan(skillEnvelope);
      state.controller = normalizeController(controller);
      state.progress = normalizeProgress(progress);
      state.inventory = normalizeInventory(snapshot.inventory);
      state.entities = normalizeEntities(snapshot.entities);
      state.botPerspective = normalizeBotPerspective(snapshot.botPerspective);
      state.memory = normalizeMemory(memory);
      updateTaskTrace(controller?.taskTrace ?? state.taskTrace);
      state.behaviorTree = createBehaviorTree(decision?.type, state.taskTrace);
    },

    getSnapshot() {
      const servedAt = nowIso();
      const diagnostics = buildDiagnostics(state, Date.parse(servedAt));
      const signature = diagnosticsSignature(diagnostics);
      if (signature !== lastDiagnosticsSignature) {
        state.diagnosticsHistory.unshift(diagnosticsHistoryEntry(diagnostics, servedAt));
        state.diagnosticsHistory = state.diagnosticsHistory.slice(0, MAX_DIAGNOSTICS_HISTORY);
        lastDiagnosticsSignature = signature;
      }
      return clone({
        ...state,
        diagnostics,
        servedAt
      });
    }
  };
}

module.exports = {
  createDashboardState,
  normalizeLlmState,
  normalizeTaskTrace,
  serializePosition
};
