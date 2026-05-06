const { validateTaskSequence } = require("./survivalSkills");

const RESEARCH_MISSIONS = Object.freeze([
  {
    id: "berry_escape",
    category: "safety",
    title: { en_us: "Sweet Berry Escape", zh_cn: "甜浆果逃生" },
    summary: "Validate that damaging plant contact becomes escape_hazard, not harvesting or random evasion.",
    taskPipeline: [{ taskType: "escape_hazard", priority: 100, ttlMs: 70000 }],
    observations: ["world.environmentHazard", "recentEvents", "bot.health", "bot.position", "controller.testTasks"],
    rewards: ["hazard_clear", "health_above_zero", "left_generated_patch", "escape_action_logged"],
    quitConditions: ["hazard_clear_and_outside_patch", "timeout_ms"],
    setupHints: ["scripts/berryEscapeScenario.js prepares this mission on a live server with TEST_CONTROL_ENABLED=true"],
    sourcePatterns: ["malmo_reward_quit_handlers", "minecraft_ai_action_feedback"]
  },
  {
    id: "ice_low_oxygen_escape",
    category: "safety",
    title: { en_us: "Ice Low Oxygen Escape", zh_cn: "冰下低氧逃生" },
    summary: "Validate that low oxygen under ice opens a breathing hole instead of treating ice surface contact as air.",
    taskPipeline: [{ taskType: "escape_hazard", priority: 100, ttlMs: 60000 }],
    observations: ["bot.oxygen", "world.isBodyInWater", "world.terrain.exactLocal", "recentEvents"],
    rewards: ["oxygen_recovered", "overhead_ice_cleared", "no_escape_pit_loop"],
    quitConditions: ["oxygen_above_threshold", "timeout_ms"],
    setupHints: ["spawn bot below an ice ceiling with enough water depth to require breaking overhead ice"],
    sourcePatterns: ["malmo_observation_from_grid", "project_mc_wiki_summary"]
  },
  {
    id: "platform_descent",
    category: "navigation",
    title: { en_us: "Platform Descent", zh_cn: "高台下降" },
    summary: "Validate that elevated spawn/platform states run descend_from_platform before wood, food, or exploration work.",
    taskPipeline: [{ taskType: "descend_from_platform", priority: 100, ttlMs: 90000 }],
    observations: ["world.terrain.descent", "world.navigationAnalysis", "bot.position", "taskTrace.phaseEvents"],
    rewards: ["left_platform", "safe_drop_or_controlled_descent", "normal_survival_route_unblocked"],
    quitConditions: ["platform_left", "timeout_ms"],
    setupHints: ["place bot on a bounded elevated platform with visible water or safe descent route below"],
    sourcePatterns: ["malmo_mission_world_generator", "malmo_reward_for_reaching_position"]
  },
  {
    id: "starter_food_buffer",
    category: "survival",
    title: { en_us: "Starter Food Buffer", zh_cn: "启动食物储备" },
    summary: "Validate environment-aware food selection without hard-coded berry or aquatic food priority.",
    taskPipeline: [{ taskType: "hunt_food", priority: 80, ttlMs: 120000 }],
    observations: ["inventory.food", "nearbyEntities", "world.terrain", "foodStrategy", "taskFeedback"],
    rewards: ["food_inventory_increased", "health_stable", "risk_aware_food_choice"],
    quitConditions: ["food_count_increased", "timeout_ms"],
    setupHints: ["vary land animals, berries, water pressure, and oxygen risk between repeated runs"],
    sourcePatterns: ["malmo_reward_for_collecting_item", "minecraft_ai_pattern_recognition"]
  },
  {
    id: "starter_shelter_house",
    category: "base",
    title: { en_us: "Starter Shelter House", zh_cn: "入门地表房屋" },
    summary: "Validate that fixed shelter construction means a surface 7x7x5 house with usable doorway and utilities.",
    taskPipeline: [{ taskType: "build_shelter", priority: 80, ttlMs: 180000 }],
    observations: ["progress.hasStarterShelter", "memory.knownBlocks", "taskTrace.phaseEvents", "controller.behaviorQueue"],
    rewards: ["surface_house_shell", "double_door_installed", "crafting_table_furnace_chest_inside", "night_hold_usable"],
    quitConditions: ["starter_shelter_verified", "timeout_ms"],
    setupHints: ["ensure material count is enough for a 7x7x5 starter house before arming the mission"],
    sourcePatterns: ["malmo_structure_reward", "minecraft_ai_query_action"]
  }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function localize(value, locale = "zh_cn") {
  if (!value || typeof value !== "object") return value;
  return value[locale] ?? value.en_us ?? Object.values(value)[0];
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(number, max));
}

function missionTasks(mission) {
  return (mission.taskPipeline ?? []).map((task) => task.taskType);
}

function validateResearchMission(mission) {
  const validation = validateTaskSequence(missionTasks(mission));
  return {
    ok: validation.ok,
    unknownTasks: validation.unknownTasks,
    taskCount: missionTasks(mission).length
  };
}

function summarizeMission(mission, options = {}) {
  const title = localize(mission.title, options.locale);
  const validation = validateResearchMission(mission);
  return {
    id: mission.id,
    category: mission.category,
    title,
    summary: mission.summary,
    tasks: missionTasks(mission),
    firstTask: mission.taskPipeline?.[0]?.taskType ?? null,
    priority: mission.taskPipeline?.[0]?.priority ?? null,
    ttlMs: mission.taskPipeline?.[0]?.ttlMs ?? null,
    observations: mission.observations.slice(0, 8),
    rewards: mission.rewards.slice(0, 8),
    quitConditions: mission.quitConditions.slice(0, 8),
    sourcePatterns: mission.sourcePatterns.slice(0, 8),
    validation
  };
}

function listResearchMissions(options = {}) {
  return RESEARCH_MISSIONS.map((mission) => summarizeMission(mission, options));
}

function compactResearchMissionCatalog(options = {}) {
  return listResearchMissions(options).map((mission) => ({
    id: mission.id,
    category: mission.category,
    title: mission.title,
    tasks: mission.tasks,
    observations: mission.observations,
    rewards: mission.rewards,
    quitConditions: mission.quitConditions
  }));
}

function getResearchMission(id, options = {}) {
  const mission = RESEARCH_MISSIONS.find((candidate) => candidate.id === id);
  if (!mission) return null;
  return options.full ? clone(mission) : summarizeMission(mission, options);
}

function missionToTestTask(missionId, options = {}) {
  const mission = getResearchMission(missionId, { full: true });
  if (!mission) throw new Error(`unknown research mission: ${missionId}`);
  const validation = validateResearchMission(mission);
  if (!validation.ok) throw new Error(`invalid research mission ${missionId}: ${validation.unknownTasks.join(",")}`);
  const firstTask = mission.taskPipeline[0];
  const title = localize(mission.title, options.locale);
  return {
    taskType: firstTask.taskType,
    priority: clampNumber(options.priority, firstTask.priority ?? 50, 0, 1000),
    ttlMs: clampNumber(options.ttlMs, firstTask.ttlMs ?? 60000, 1000, 1800000),
    reason: options.reason || `research mission ${mission.id}: ${title}`,
    source: options.source || "research_mission",
    replace: options.replace !== false,
    metadata: {
      researchMissionId: mission.id,
      title,
      category: mission.category,
      observations: clone(mission.observations),
      rewards: clone(mission.rewards),
      quitConditions: clone(mission.quitConditions),
      setupHints: clone(mission.setupHints),
      sourcePatterns: clone(mission.sourcePatterns),
      ...(options.metadata && typeof options.metadata === "object" ? options.metadata : {})
    }
  };
}

module.exports = {
  RESEARCH_MISSIONS,
  compactResearchMissionCatalog,
  getResearchMission,
  listResearchMissions,
  missionToTestTask,
  validateResearchMission
};