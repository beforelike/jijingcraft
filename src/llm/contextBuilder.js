const { listAllowedTasks, listSurvivalSkills } = require("../knowledge/survivalSkills");
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

function nearbyEntitySummary(entities = [], limit = 12) {
  return entities
    .filter((entity) => entity?.name && Number.isFinite(entity.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, limit)
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
    nearbyLogs: compactResources(terrain.nearbyLogs)
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
    routeOptions: Array.isArray(analysis.routeOptions) ? analysis.routeOptions.slice(0, 6) : []
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
    constructorSchema: taskParameterSchema(taskType)
  }));
}

function buildPlannerContext({ snapshot, progress, memory, decision, skillEnvelope, dimension, controller } = {}) {
  return {
    purpose: "smart_brain_task_directive_planning",
    safetyRules: [
      "Never override emergency rules for low health, hazards, nearby hostiles, invalid position, or night shelter safety.",
      "Only request tasks from allowedTasks, or documented aliases that normalize to allowedTasks.",
      "Do not generate Mineflayer JavaScript or direct API calls.",
      "Output agentDirectives and taskRequests that task_agent can instantiate as behavior trees.",
      "When taskFeedback reports a blocked task, propose a different safe task that can gather information, change location, or prepare prerequisites instead of repeating the blocked task.",
      "For early food, do an environment-aware choice: request explore if food sources are unknown; prefer nearby land food when safe; prefer mature berry bushes over aquatic fish only when local terrain/water/oxygen risk makes fish unsafe or berries are clearly the safer visible source."
    ],
    bot: {
      health: snapshot?.health ?? null,
      food: snapshot?.food ?? null,
      oxygen: snapshot?.oxygen ?? null,
      position: positionSummary(snapshot?.position),
      dimension: dimension ?? "unknown"
    },
    world: {
      timeOfDay: snapshot?.timeOfDay ?? null,
      isNight: Boolean(snapshot?.isNight),
      environmentHazard: snapshot?.environmentHazard ? {
        name: snapshot.environmentHazard.name,
        distance: round(snapshot.environmentHazard.distance)
      } : null,
      navigationTrap: Boolean(snapshot?.navigationTrap),
      navigationAnalysis: navigationAnalysisSummary(snapshot?.navigationAnalysis),
      terrain: terrainSummary(snapshot?.terrain),
      isInLava: Boolean(snapshot?.isInLava)
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
      recentLearning: learningSummary(memory)
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
      agents: controller?.agents ?? null
    },
    allowedTasks: listAllowedTasks(),
    taskTreeClasses: taskClassSummary(),
    availableSkills: skillSummary()
  };
}

module.exports = {
  buildPlannerContext,
  knownBlockSummary,
  nearbyEntitySummary,
  positionSummary,
  skillSummary,
  taskClassSummary,
  terrainSummary,
  foodStrategySummary,
  topInventoryItems
};