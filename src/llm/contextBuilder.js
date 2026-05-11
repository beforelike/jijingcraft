const { listAllowedTasks, listSurvivalSkills } = require("../knowledge/survivalSkills");
const { compactMinecraftSurvivalGuide } = require("../knowledge/minecraftSurvivalGuide");
const { compactMinecraftWikiKnowledge } = require("../knowledge/minecraftWikiKnowledge");
const { compactLocalMinecraftKnowledge } = require("../knowledge/minecraftKnowledgeBase");
const { compactMindcraftTaskKnowledge, taskParameterHintsForTask } = require("../knowledge/mindcraftTaskKnowledge");
const { compactResearchMissionCatalog } = require("../knowledge/researchMissionCatalog");
const { taskFunctionName, taskLevel, taskParameterSchema, taskPriority, taskTreeClassName } = require("../behavior/executableBehaviorTree");

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function positionSummary(position) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x: round(x), y: round(y), z: round(z) };
}

function topInventoryItems(inventory = {}, limit = 20) {
  return Object.entries(inventory)
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]) || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count: Number(count) }));
}

const LAND_FOOD_ENTITY_NAMES = new Set(["cow", "pig", "sheep", "chicken", "rabbit"]);
const LAND_CONTEXT_ENTITY_NAMES = new Set([...LAND_FOOD_ENTITY_NAMES, "horse", "donkey", "mule", "llama"]);

const GENERAL_AGENT_BLOCKED_TASKS = new Set([
  "escape_hazard",
  "escape_pit",
  "descend_from_platform",
  "evade_hostiles",
  "defend_shelter",
  "defend_self",
  "eat_food",
  "recover_starvation"
]);

function listGeneralAgentAllowedTasks(taskTypes = listAllowedTasks()) {
  return taskTypes.filter((taskType) => !GENERAL_AGENT_BLOCKED_TASKS.has(taskType));
}

function listLocalRuleManagedTasks(taskTypes = listAllowedTasks()) {
  return taskTypes.filter((taskType) => GENERAL_AGENT_BLOCKED_TASKS.has(taskType));
}

function isGeneralAgentBlockedTask(taskType) {
  return GENERAL_AGENT_BLOCKED_TASKS.has(taskType);
}

function isOxygenRelevant(snapshot = {}) {
  if (!snapshot || snapshot.oxygen === undefined || snapshot.oxygen === null) return false;
  const oxygen = Number(snapshot.oxygen);
  if (!Number.isFinite(oxygen)) return false;
  if (Boolean(snapshot.isBodyInWater) || Boolean(snapshot.isInWater) || Boolean(snapshot.isHeadInWater)) return true;
  if (oxygen <= 18) return true;
  const navigationKind = snapshot.navigationAnalysis?.kind;
  return navigationKind === "water_column" || navigationKind === "underwater";
}

function maybeOxygenField(snapshot = {}) {
  return isOxygenRelevant(snapshot) ? { oxygen: Number(snapshot.oxygen) } : {};
}

function inventoryTotals(inventory = {}) {
  const entries = Object.entries(inventory).filter(([, count]) => Number(count) > 0);
  return {
    totalKinds: entries.length,
    totalItems: entries.reduce((sum, [, count]) => sum + (Number(count) || 0), 0)
  };
}

function nearbyEntitySummary(entities = [], limit = 12) {
  const sorted = entities
    .filter((entity) => entity?.name && Number.isFinite(entity.distance))
    .sort((left, right) => left.distance - right.distance);
  const selected = [];
  for (const entity of sorted.filter((entry) => LAND_CONTEXT_ENTITY_NAMES.has(entry.name)).slice(0, Math.min(8, limit))) {
    selected.push(entity);
  }
  for (const entity of sorted) {
    if (selected.length >= limit) break;
    if (selected.includes(entity)) continue;
    selected.push(entity);
  }

  return selected
    .sort((left, right) => left.distance - right.distance)
    .map((entity) => ({
      name: entity.name,
      distance: round(entity.distance),
      position: positionSummary(entity.position)
    }));
}

function terrainSummary(terrain = null) {
  if (!terrain || typeof terrain !== "object") return null;
  const compactResources = (items = []) => Array.isArray(items)
    ? items.slice(0, 8).map((item) => ({
      name: item.name ?? null,
      position: positionSummary(item.position)
    })).filter((item) => item.name && item.position)
    : [];
  return {
    sampleRadius: Number(terrain.sampleRadius) || null,
    primaryGround: terrain.primaryGround ?? null,
    ground: Array.isArray(terrain.ground) ? terrain.ground.slice(0, 8) : [],
    safeStandCount: Number(terrain.safeStandCount) || 0,
    waterSamples: Number(terrain.waterSamples) || 0,
    damagingSamples: Number(terrain.damagingSamples) || 0,
    nearbyWater: compactResources(terrain.nearbyWater),
    matureBerryBushes: compactResources(terrain.matureBerryBushes),
    nearbyLogs: compactResources(terrain.nearbyLogs),
    exactLocal: terrain.exactLocal ? {
      radius: Number(terrain.exactLocal.radius) || 0,
      width: Number(terrain.exactLocal.width) || 0,
      center: positionSummary(terrain.exactLocal.center),
      safeStandCount: Number(terrain.exactLocal.safeStandCount) || 0,
      waterCount: Number(terrain.exactLocal.waterCount) || 0,
      hazardCount: Number(terrain.exactLocal.hazardCount) || 0,
      groundCounts: Array.isArray(terrain.exactLocal.groundCounts) ? terrain.exactLocal.groundCounts.slice(0, 8) : [],
      cells: Array.isArray(terrain.exactLocal.cells) ? terrain.exactLocal.cells.slice(0, 121).map((cell) => ({
        dx: Number(cell.dx) || 0,
        dz: Number(cell.dz) || 0,
        position: positionSummary(cell.position),
        ground: cell.ground ?? null,
        feet: cell.feet ?? null,
        head: cell.head ?? null,
        safeStand: Boolean(cell.safeStand),
        water: Boolean(cell.water),
        hazard: Boolean(cell.hazard)
      })) : []
    } : null,
    regional: terrain.regional ? {
      radius: Number(terrain.regional.radius) || 0,
      diameter: Number(terrain.regional.diameter) || 0,
      step: Number(terrain.regional.step) || 0,
      sampleCount: Number(terrain.regional.sampleCount) || 0,
      waterCells: Number(terrain.regional.waterCells) || 0,
      hazardCells: Number(terrain.regional.hazardCells) || 0,
      safeCells: Number(terrain.regional.safeCells) || 0,
      topBlocks: Array.isArray(terrain.regional.topBlocks) ? terrain.regional.topBlocks.slice(0, 12) : []
    } : null,
    descent: terrain.descent ? {
      needsDescent: Boolean(terrain.descent.needsDescent),
      summary: terrain.descent.summary ?? null,
      bestTarget: terrain.descent.bestTarget ? {
        waterPosition: positionSummary(terrain.descent.bestTarget.waterPosition),
        entryPosition: positionSummary(terrain.descent.bestTarget.entryPosition),
        horizontalDistance: round(terrain.descent.bestTarget.horizontalDistance),
        drop: Number(terrain.descent.bestTarget.drop) || 0,
        route: terrain.descent.bestTarget.route ?? null
      } : null
    } : null
  };
}

function terrainNameSet(terrain = null) {
  const names = new Set();
  if (terrain?.primaryGround) names.add(terrain.primaryGround);
  for (const entry of terrain?.ground ?? []) {
    if (entry?.name) names.add(entry.name);
  }
  for (const entry of terrain?.nearbyWater ?? []) {
    if (entry?.name) names.add(entry.name);
  }
  return names;
}

function hasColdOrIcyTerrain(terrain = null) {
  const names = terrainNameSet(terrain);
  return [...names].some((name) => /snow|ice|frozen|powder_snow/i.test(name));
}

function foodStrategySummary(snapshot = {}, progress = {}) {
  const terrain = terrainSummary(snapshot?.terrain);
  const entities = nearbyEntitySummary(snapshot?.entities, 16);
  const landFoodNames = new Set(["cow", "pig", "sheep", "chicken", "rabbit"]);
  const aquaticFoodNames = new Set(["salmon", "cod", "tropical_fish"]);
  const landFood = entities.filter((entity) => landFoodNames.has(entity.name));
  const aquaticFood = entities.filter((entity) => aquaticFoodNames.has(entity.name));
  const matureBerries = terrain?.matureBerryBushes ?? [];
  const foodCount = Number(progress?.foodCount ?? 0);
  const food = Number(snapshot?.food ?? 20);
  const hasSafeBerries = matureBerries.length > 0;
  const hasLandFood = landFood.length > 0;
  const nearestAquatic = aquaticFood[0] ?? null;
  const terrainKnown = Boolean(terrain && (terrain.ground.length || terrain.safeStandCount || terrain.nearbyWater.length || terrain.matureBerryBushes.length || terrain.nearbyLogs.length));
  const coldOrIcyTerrain = hasColdOrIcyTerrain(terrain);
  const waterPressure = (terrain?.waterSamples ?? 0) >= 4 || (terrain?.nearbyWater?.length ?? 0) >= 3;
  const aquaticDistance = Number(nearestAquatic?.distance);
  const aquaticRisk = Boolean(nearestAquatic) && (
    coldOrIcyTerrain
    || waterPressure
    || !Number.isFinite(aquaticDistance)
    || aquaticDistance > 12
    || Number(snapshot?.oxygen ?? 20) <= 12
  );
  const visibleFoodSources = matureBerries.length + landFood.length + aquaticFood.length;
  const needsInitialExploration = !terrainKnown || visibleFoodSources === 0;
  let recommendedSource = "explore_safe_food";
  let decisionBasis = needsInitialExploration ? "initial_exploration_needed" : "local_food_scan";

  if (needsInitialExploration) {
    recommendedSource = "explore_safe_food";
  } else if (hasLandFood) {
    recommendedSource = "land_animal";
    decisionBasis = "nearby_land_food_visible";
  } else if (hasSafeBerries && (!nearestAquatic || aquaticRisk)) {
    recommendedSource = "mature_berry_bush";
    decisionBasis = aquaticRisk ? "berry_safer_than_aquatic_risk" : "nearby_safe_plant_food_visible";
  } else if (nearestAquatic) {
    recommendedSource = "aquatic_fish_only_if_close_and_oxygen_safe";
    decisionBasis = "close_aquatic_food_after_local_scan";
  } else if (hasSafeBerries) {
    recommendedSource = "mature_berry_bush";
    decisionBasis = "nearby_safe_plant_food_visible";
  }

  return {
    recommendedSource,
    decisionBasis,
    needsInitialExploration,
    safeNearbyBerryCount: matureBerries.length,
    nearestBerry: matureBerries[0] ?? null,
    nearestLandFood: landFood[0] ?? null,
    nearestAquaticFood: nearestAquatic,
    environmentRisk: {
      terrainKnown,
      coldOrIcyTerrain,
      waterPressure,
      aquaticRisk
    },
    starterFoodReserve: foodCount,
    hunger: food,
    planningRule: "Do not hard-code berry priority. First use the local terrain scan or request initial explore when food sources are unknown. In snow/ice or high-water starts, nearby mature berries outrank distant/submerged fish; in other biomes compare visible land animals, berries, and close oxygen-safe aquatic food by risk and distance."
  };
}

function navigationAnalysisSummary(analysis = null) {
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
    rim: positionSummary(analysis.rim),
    rimRise: Number.isFinite(Number(analysis.rimRise)) ? Number(analysis.rimRise) : null,
    subsurface: analysis.subsurface ? {
      openSkyHere: Boolean(analysis.subsurface.openSkyHere),
      surfaceExit: positionSummary(analysis.subsurface.surfaceExit),
      surfaceExitRise: Number.isFinite(Number(analysis.subsurface.surfaceExitRise)) ? Number(analysis.subsurface.surfaceExitRise) : null,
      needsSurfaceRecovery: Boolean(analysis.subsurface.needsSurfaceRecovery)
    } : null,
    routeOptions: Array.isArray(analysis.routeOptions) ? analysis.routeOptions.slice(0, 6) : []
  };
}

function botPerspectiveSummary(view = null) {
  if (!view || typeof view !== "object") return null;
  return {
    heading: view.heading ?? null,
    yaw: round(Number(view.yaw), 3),
    pitch: round(Number(view.pitch), 3),
    eye: positionSummary(view.eye),
    frontBlocks: Array.isArray(view.frontBlocks) ? view.frontBlocks.slice(0, 12).map((block) => ({
      distance: Number(block.distance) || 0,
      name: block.name ?? null,
      solid: Boolean(block.solid),
      diggable: Boolean(block.diggable),
      position: positionSummary(block.position)
    })) : [],
    targetEntity: view.targetEntity ? {
      name: view.targetEntity.name ?? null,
      distance: round(Number(view.targetEntity.distance)),
      position: positionSummary(view.targetEntity.position)
    } : null
  };
}

function timeLabelFromTimeOfDay(timeOfDay) {
  const value = Number(timeOfDay);
  if (!Number.isFinite(value)) return "unknown";
  if (value < 6000) return "morning";
  if (value < 12000) return "afternoon";
  return "night";
}

function compactEntityTypes(entities = []) {
  const counts = new Map();
  for (const entity of entities ?? []) {
    if (!entity?.name) continue;
    counts.set(entity.name, (counts.get(entity.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([name, count]) => ({ name, count }));
}

function surroundingsSummary(terrain = null, botPerspective = null) {
  const centerCell = terrain?.exactLocal?.cells?.find((cell) => Number(cell.dx) === 0 && Number(cell.dz) === 0) ?? null;
  const firstSolidAhead = (botPerspective?.frontBlocks ?? []).find((block) => block.solid && block.name !== "air") ?? null;
  return {
    below: centerCell?.ground ?? null,
    legs: centerCell?.feet ?? null,
    head: centerCell?.head ?? null,
    firstSolidAhead: firstSolidAhead ? {
      name: firstSolidAhead.name,
      distance: Number(firstSolidAhead.distance) || 0,
      position: positionSummary(firstSolidAhead.position)
    } : null,
    safeStandCount: Number(terrain?.safeStandCount) || 0,
    waterSamples: Number(terrain?.waterSamples) || 0,
    hazardSamples: Number(terrain?.damagingSamples) || 0
  };
}

function actionSummary(controller = {}) {
  const summary = controller?.actionSummary ?? null;
  if (!summary || typeof summary !== "object") return null;
  return {
    currentDecisionType: summary.currentDecisionType ?? null,
    currentTrace: summary.currentTrace ? {
      taskType: summary.currentTrace.taskType ?? null,
      status: summary.currentTrace.status ?? null,
      activePhaseId: summary.currentTrace.activePhaseId ?? null,
      activePhaseLabel: summary.currentTrace.activePhaseLabel ?? null,
      updatedAt: summary.currentTrace.updatedAt ?? null
    } : null,
    lastAction: summary.lastAction ? {
      type: summary.lastAction.type ?? null,
      skillId: summary.lastAction.skillId ?? null,
      position: positionSummary(summary.lastAction.position),
      startedAt: summary.lastAction.startedAt ?? null
    } : null,
    lastFeedback: summary.lastFeedback ?? null
  };
}

function behaviorLogSummary(controller = {}, limit = 10) {
  return Array.isArray(controller?.behaviorLog)
    ? controller.behaviorLog.slice(-limit).map((event) => ({
      at: event.at ?? null,
      level: event.level ?? "info",
      kind: event.kind ?? "event",
      message: event.message ?? "",
      details: event.details && typeof event.details === "object" ? {
        reason: event.details.reason ?? null,
        label: event.details.label ?? null,
        target: event.details.target ?? null,
        position: positionSummary(event.details.position),
        failedTarget: positionSummary(event.details.failedTarget)
      } : null
    }))
    : [];
}

function modeLogSummary(controller = {}, limit = 12) {
  return Array.isArray(controller?.modeLog)
    ? controller.modeLog.slice(-limit).map((event) => ({
      at: event.at ?? null,
      level: event.level ?? "info",
      mode: event.mode ?? "local",
      event: event.event ?? "event",
      taskType: event.taskType ?? null,
      ruleDecision: event.ruleDecision ?? null,
      reason: event.reason ?? null,
      outcome: event.outcome ?? null,
      details: event.details && typeof event.details === "object" ? {
        queue: event.details.queue ?? null,
        queuedTask: event.details.queuedTask ?? null,
        interruptedQueues: event.details.interruptedQueues ?? null,
        health: event.details.health ?? null,
        food: event.details.food ?? null,
        position: positionSummary(event.details.position)
      } : null
    }))
    : [];
}

function explorationStrategySummary(controller = {}) {
  const strategy = controller?.explorationStrategy ?? null;
  if (!strategy || typeof strategy !== "object") return null;
  return {
    recentTargets: Array.isArray(strategy.recentTargets) ? strategy.recentTargets.slice(-6).map((entry) => ({
      position: positionSummary(entry.position),
      reached: Boolean(entry.reached),
      purpose: entry.purpose ?? null,
      at: entry.at ?? null
    })) : [],
    unreachableTargets: Array.isArray(strategy.unreachableTargets) ? strategy.unreachableTargets.slice(0, 6).map((entry) => ({
      position: positionSummary(entry.position),
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

function learningSummary(memory = {}) {
  return Object.entries(memory.learning?.policyStats ?? {})
    .map(([key, stats]) => ({
      key,
      attempts: Number(stats.attempts) || 0,
      successes: Number(stats.successes) || 0,
      failures: Number(stats.failures) || 0,
      lastOutcome: stats.lastOutcome ?? null,
      lastReason: stats.lastReason ?? null,
      updatedAt: stats.updatedAt ?? null
    }))
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, 10);
}

function knownBlockSummary(knownBlocks = {}, limit = 8) {
  return Object.fromEntries(Object.entries(knownBlocks).map(([name, entries]) => [
    name,
    {
      count: Array.isArray(entries) ? entries.length : 0,
      nearest: Array.isArray(entries)
        ? entries.slice(-limit).map((entry) => ({
          position: positionSummary(entry.position),
          dimension: entry.dimension ?? "unknown",
          lastSeenAt: entry.lastSeenAt ?? null
        })).filter((entry) => entry.position)
        : []
    }
  ]));
}

function skillSummary(skills = listSurvivalSkills()) {
  return skills.map((skill) => ({
    id: skill.id,
    category: skill.category,
    title: skill.title?.zh_cn ?? skill.title?.en_us ?? skill.id,
    tasks: skill.tasks,
    safety: skill.safety
  }));
}

function taskClassSummary(taskTypes = listAllowedTasks()) {
  return taskTypes.map((taskType) => ({
    taskType,
    treeClass: taskTreeClassName(taskType),
    taskFunction: taskFunctionName(taskType),
    priority: taskPriority(taskType),
    level: taskLevel(taskType),
    constructorSchema: taskParameterSchema(taskType),
    parameterHints: taskParameterHintsForTask(taskType)
  }));
}

function minecraftKnowledgeQuery(snapshot = {}, decision = null, skillEnvelope = null) {
  const taskType = decision?.type ?? skillEnvelope?.taskType ?? skillEnvelope?.plan?.nextTask ?? null;
  const terrain = snapshot?.terrain ?? {};
  const surroundings = snapshot?.botPerspective?.surroundings ?? {};
  return [
    taskType,
    decision?.reason,
    terrain.primaryGround,
    ...(Array.isArray(terrain.ground) ? terrain.ground.slice(0, 5).map((entry) => entry.name) : []),
    surroundings.feet,
    surroundings.head,
    surroundings.below,
    snapshot?.fallingBlockHazard?.name,
    snapshot?.environmentHazard?.name
  ].filter(Boolean).join(" ");
}

function compactFullStateSummary({ snapshot, progress, memory, decision, dimension, controller, terrain, botPerspective, action } = {}) {
  const inventory = snapshot?.inventory ?? {};
  const totals = inventoryTotals(inventory);
  return {
    gameplay: {
      position: positionSummary(snapshot?.position),
      dimension: dimension ?? "unknown",
      health: snapshot?.health ?? null,
      hunger: snapshot?.food ?? null,
      ...maybeOxygenField(snapshot),
      timeOfDay: snapshot?.timeOfDay ?? null,
      timeLabel: timeLabelFromTimeOfDay(snapshot?.timeOfDay),
      isNight: Boolean(snapshot?.isNight)
    },
    action: {
      current: action?.currentTrace?.taskType ?? controller?.lastAction?.type ?? decision?.type ?? "idle",
      isIdle: !controller?.busy && !controller?.emergencyBusy,
      activePhase: action?.currentTrace?.activePhaseLabel ?? action?.currentTrace?.activePhaseId ?? null,
      lastFeedback: action?.lastFeedback ?? null
    },
    surroundings: surroundingsSummary(terrain, botPerspective),
    inventory: {
      ...totals,
      topItems: topInventoryItems(inventory, 12),
      equipment: {
        mainHand: snapshot?.heldItem ?? null
      }
    },
    nearby: {
      entityTypes: compactEntityTypes(snapshot?.entities),
      closestEntities: nearbyEntitySummary(snapshot?.entities, 6)
    },
    modes: {
      safetyRule: decision?.type ?? null,
      queueActive: Boolean(controller?.behaviorQueue?.active || controller?.taskQueue?.active),
      emergencyBusy: Boolean(controller?.emergencyBusy),
      recentModeLog: modeLogSummary(controller, 6)
    },
    memory: {
      knownBlockKinds: Object.keys(memory?.knownBlocks ?? {}).length,
      recentLearningCount: Object.keys(memory?.learning?.policyStats ?? {}).length,
      visitedCount: Array.isArray(memory?.exploration?.visited) ? memory.exploration.visited.length : 0
    },
    progress: progress ? {
      stage: progress.stage ?? null,
      summary: progress.summary ?? null,
      next: progress.next ? { id: progress.next.id, label: progress.next.label } : null
    } : null
  };
}

function buildPlannerContext({ snapshot, progress, memory, decision, skillEnvelope, dimension, controller } = {}) {
  const compactTerrain = terrainSummary(snapshot?.terrain);
  const compactBotPerspective = botPerspectiveSummary(snapshot?.botPerspective);
  const compactAction = actionSummary(controller);
  const compactBehaviorLog = behaviorLogSummary(controller);
  const compactModeLog = modeLogSummary(controller);
  const compactExplorationStrategy = explorationStrategySummary(controller);
  const minecraftSurvivalGuide = compactMinecraftSurvivalGuide();
  const localMinecraftKnowledge = compactLocalMinecraftKnowledge({
    query: minecraftKnowledgeQuery(snapshot, decision, skillEnvelope),
    taskType: decision?.type ?? skillEnvelope?.taskType ?? skillEnvelope?.plan?.nextTask,
    limit: 4
  });
  const generalAgentAllowedTasks = listGeneralAgentAllowedTasks();
  const localRuleManagedTasks = listLocalRuleManagedTasks();
  return {
    purpose: "smart_brain_task_directive_planning",
    safetyRules: [
      "Never override emergency rules for low health, hazards, nearby hostiles, invalid position, or night shelter safety.",
      "Only request tasks from allowedTasks, or documented aliases that normalize to allowedTasks.",
      "Do not generate Mineflayer JavaScript or direct API calls.",
      "Output agentDirectives and taskRequests that task_agent can instantiate as behavior trees.",
      "When taskFeedback reports a blocked task, propose a different safe task that can gather information, change location, or prepare prerequisites instead of repeating the blocked task.",
      "For early food, do an environment-aware choice: request explore if food sources are unknown; prefer nearby land food when safe; prefer mature berry bushes over aquatic fish only when local terrain/water/oxygen risk makes fish unsafe or berries are clearly the safer visible source.",
      "Use minecraftWiki.guide.environmentRules and taskNotes: water with oxygen remaining is not a hazard, water columns are not escape pits, and dry-land tasks should first surface or find shore.",
      "Use minecraftWiki.knowledge topics falling_blocks and collect_stone before requesting collect_stone: sand/gravel/concrete_powder can fall, so beach downward digging must become surface-stone search or relocation.",
      "Use localMinecraftKnowledge RAG hits and query_minecraft_knowledge before planning around sand, gravel, suffocation, collect_stone, or player-state fairness diagnostics.",
      "If navigationAnalysis.kind is subsurface_enclosure or subsurface.needsSurfaceRecovery is true, let safety rules surface the bot before normal explore/resource tasks.",
      "Hard emergency tasks are local-rule/safety_agent managed; general_agent should not request localRuleManagedTasks directly.",
      "If terrain.descent.needsDescent is true, avoid ordinary progression requests until local safety rules have completed descend_from_platform.",
      "Use researchMissions only as evaluation references for task requests and success criteria; never assume a mission can bypass live safety rules."
    ],
    minecraftWiki: {
      ...minecraftSurvivalGuide,
      guide: minecraftSurvivalGuide,
      knowledge: compactMinecraftWikiKnowledge(),
      localRag: localMinecraftKnowledge
    },
    localMinecraftKnowledge,
    researchMissions: compactResearchMissionCatalog(),
    taskParameterKnowledge: compactMindcraftTaskKnowledge(),
    compactState: compactFullStateSummary({
      snapshot,
      progress,
      memory,
      decision,
      dimension,
      controller,
      terrain: compactTerrain,
      botPerspective: compactBotPerspective,
      action: compactAction
    }),
    bot: {
      health: snapshot?.health ?? null,
      food: snapshot?.food ?? null,
      ...maybeOxygenField(snapshot),
      position: positionSummary(snapshot?.position),
      dimension: dimension ?? "unknown",
      playerState: snapshot?.playerState ?? null
    },
    world: {
      timeOfDay: snapshot?.timeOfDay ?? null,
      isNight: Boolean(snapshot?.isNight),
      environmentHazard: snapshot?.environmentHazard ? {
        name: snapshot.environmentHazard.name,
        distance: round(snapshot.environmentHazard.distance)
      } : null,
      fallingBlockHazard: snapshot?.fallingBlockHazard ? {
        name: snapshot.fallingBlockHazard.name,
        reason: snapshot.fallingBlockHazard.reason,
        role: snapshot.fallingBlockHazard.role ?? null,
        distance: round(snapshot.fallingBlockHazard.distance ?? 0)
      } : null,
      navigationTrap: Boolean(snapshot?.navigationTrap),
      navigationAnalysis: navigationAnalysisSummary(snapshot?.navigationAnalysis),
      terrain: compactTerrain,
      botPerspective: compactBotPerspective,
      isInLava: Boolean(snapshot?.isInLava),
      isBodyInWater: Boolean(snapshot?.isBodyInWater)
    },
    currentRuleDecision: decision ? {
      type: decision.type,
      reason: decision.reason ?? null,
      target: decision.target ?? null
    } : null,
    foodStrategy: foodStrategySummary(snapshot, progress),
    currentSkillPlan: skillEnvelope?.plan ? {
      skillId: skillEnvelope.plan.skillId,
      title: skillEnvelope.plan.title,
      tasks: skillEnvelope.plan.tasks,
      nextTask: skillEnvelope.plan.nextTask,
      safety: skillEnvelope.plan.safety
    } : null,
    progress: progress ? {
      stage: progress.stage,
      summary: progress.summary,
      next: progress.next ? { id: progress.next.id, label: progress.next.label } : null,
      foodCount: progress.foodCount,
      materialCount: progress.materialCount,
      achievedMilestones: (progress.milestones ?? []).filter((milestone) => milestone.achieved).map((milestone) => milestone.id),
      missingMilestones: (progress.milestones ?? []).filter((milestone) => !milestone.achieved).map((milestone) => milestone.id)
    } : null,
    inventory: topInventoryItems(snapshot?.inventory),
    nearbyEntities: nearbyEntitySummary(snapshot?.entities),
    memory: {
      knownBlocks: knownBlockSummary(memory?.knownBlocks ?? {}),
      recentLearning: learningSummary(memory),
      exploration: memory?.exploration ? {
        lastScanAt: memory.exploration.lastScanAt ?? null,
        lastPosition: positionSummary(memory.exploration.lastPosition),
        lastLocalScan: memory.exploration.lastLocalScan ?? null,
        lastRegionalScan: memory.exploration.lastRegionalScan ?? null,
        lastDescent: memory.exploration.lastDescent ?? null,
        visitedCount: Array.isArray(memory.exploration.visited) ? memory.exploration.visited.length : 0,
        coarseCellCount: memory.exploration.coarseCells && typeof memory.exploration.coarseCells === "object" ? Object.keys(memory.exploration.coarseCells).length : 0
      } : null
    },
    controller: {
      busy: Boolean(controller?.busy),
      emergencyBusy: Boolean(controller?.emergencyBusy),
      invalidPositionTicks: Number(controller?.invalidPositionTicks) || 0,
      lastActionType: controller?.lastAction?.type ?? null,
      taskFeedback: controller?.taskFeedback ?? null,
      taskQueue: controller?.taskQueue ?? null,
      priorityTasks: controller?.priorityTasks ?? null,
      behaviorQueue: controller?.behaviorQueue ?? null,
      schedulerStatus: controller?.priorityScheduler?.getStatus?.() ?? null,
      actionFailureReports: controller?.getFailureReportsForPlanner?.() ?? [],
      agents: controller?.agents ?? null,
      actionSummary: compactAction,
      behaviorLog: compactBehaviorLog,
      modeLog: compactModeLog,
      explorationStrategy: compactExplorationStrategy
    },
    allowedTasks: generalAgentAllowedTasks,
    localRuleManagedTasks,
    agentPolicy: {
      generalAgentCanRequestEmergencyTasks: false,
      oxygenField: isOxygenRelevant(snapshot) ? "included_when_relevant" : "omitted_normal_ground_air"
    },
    taskTreeClasses: taskClassSummary(generalAgentAllowedTasks),
    availableSkills: skillSummary()
  };
}

module.exports = {
  buildPlannerContext,
  knownBlockSummary,
  isGeneralAgentBlockedTask,
  isOxygenRelevant,
  listGeneralAgentAllowedTasks,
  listLocalRuleManagedTasks,
  nearbyEntitySummary,
  positionSummary,
  skillSummary,
  taskClassSummary,
  terrainSummary,
  foodStrategySummary,
  botPerspectiveSummary,
  actionSummary,
  behaviorLogSummary,
  compactFullStateSummary,
  explorationStrategySummary,
  modeLogSummary,
  topInventoryItems
};