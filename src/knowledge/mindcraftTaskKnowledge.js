const { compactMineflayerActionPatterns } = require("./mineflayerActionPatterns");

const MINDCRAFT_COMMAND_MAPPINGS = Object.freeze([
  {
    command: "!goToCoordinates",
    mapsTo: ["explore"],
    parameterBridge: { x_y_z: "constructorArgs.targetPosition", closeness: "constructorArgs.radius" },
    safety: ["controller_validates_safe_window", "hard_safety_rules_stay_local"]
  },
  {
    command: "!searchForBlock",
    mapsTo: ["collect_wood", "collect_stone", "collect_building_materials", "explore"],
    parameterBridge: { type: "constructorArgs.target", search_range: "constructorArgs.searchRadius" },
    safety: ["only_select_task_matching_allowedTasks", "controller_checks_reachable_target"]
  },
  {
    command: "!collectBlocks",
    mapsTo: ["collect_wood", "collect_stone", "collect_building_materials", "mine_advanced_materials"],
    parameterBridge: { type: "constructorArgs.target", num: "constructorArgs.count" },
    safety: ["expand_resource_aliases", "safe_break_and_stand_position_required"]
  },
  {
    command: "!craftRecipe",
    mapsTo: ["craft_basic_supplies", "craft_basic_tools", "craft_stone_tools", "craft_furnace", "craft_weapon", "craft_bed"],
    parameterBridge: { recipe_name: "constructorArgs.target", num: "constructorArgs.count" },
    safety: ["do_not_generate_recipe_code", "controller_owns_crafting_table_access"]
  },
  {
    command: "!placeHere",
    mapsTo: ["build_shelter", "plant_crops", "build_animal_pen"],
    parameterBridge: { type: "constructorArgs.target", current_position: "constructorArgs.targetPosition" },
    safety: ["single_block_placement_only", "controller_checks_reference_face_and_collision"]
  },
  {
    command: "!consume",
    mapsTo: ["eat_food", "recover_starvation"],
    parameterBridge: { item_name: "constructorArgs.target" },
    safety: ["food_selection_remains_controller_owned"]
  },
  {
    command: "!attack",
    mapsTo: ["hunt_food", "defend_self", "defend_shelter"],
    parameterBridge: { type: "constructorArgs.target", range: "constructorArgs.searchRadius" },
    safety: ["combat_only_when_rule_window_allows", "hostile_rules_outrank_food_hunt"]
  },
  {
    command: "!stay",
    mapsTo: ["hold_position", "wait_out_night"],
    parameterBridge: { seconds: "constructorArgs.durationSeconds" },
    safety: ["passive_safety_task", "controller_monitors_hostiles_and_hazards"]
  }
]);

const ALWAYS_VISIBLE_SKILL_DOCS = Object.freeze([
  {
    skill: "skills.placeBlock",
    taskParameters: ["target", "targetPosition", "mode"],
    reason: "Basic engineering tasks need placement side, replaceable-block, and collision hints."
  },
  {
    skill: "skills.wait",
    taskParameters: ["durationSeconds", "mode"],
    reason: "Passive safety tasks need an interruptible wait intent, never an unbounded busy action."
  },
  {
    skill: "skills.breakBlockAt",
    taskParameters: ["targetPosition", "tool"],
    reason: "Mining/build clearing needs harvestability and distance checks before digging."
  }
]);

const TASK_PARAMETER_HINTS = Object.freeze({
  explore: {
    commands: ["!goToCoordinates", "!moveAway", "!searchForBlock"],
    parameters: {
      targetPosition: "Explicit safe destination when known.",
      radius: "Travel or local scan radius; accepts closeness/range aliases.",
      mode: "safe_scan, recovery, or local_reposition."
    },
    patterns: ["goToGoal_non_destructive_probe", "door_open_interval", "local_reposition_on_unreachable"]
  },
  collect_wood: {
    commands: ["!collectBlocks", "!searchForBlock"],
    parameters: {
      count: "Desired log count for this behavior-tree instance.",
      target: "Log block name or family hint.",
      targetPosition: "Known visible log position.",
      searchRadius: "Nearby log search radius."
    },
    patterns: ["collectBlock_search_aliases", "safe_break_gate", "tool_equip_before_dig"]
  },
  collect_stone: {
    commands: ["!collectBlocks", "!searchForBlock"],
    parameters: {
      count: "Stone or cobblestone target count.",
      target: "stone/cobblestone resource hint.",
      targetPosition: "Exposed stone position.",
      searchRadius: "Surface stone search radius."
    },
    patterns: ["cobblestone_expands_to_stone", "safe_side_stand", "manual_dig_fallback"]
  },
  collect_building_materials: {
    commands: ["!collectBlocks"],
    parameters: {
      count: "Building block target count.",
      target: "Preferred block family such as dirt, cobblestone, or logs.",
      searchRadius: "Material search radius."
    },
    patterns: ["collectBlock_search_aliases", "avoid_hazard_blocks"]
  },
  mine_advanced_materials: {
    commands: ["!collectBlocks", "!digDown"],
    parameters: {
      target: "Ore family name.",
      count: "Requested ore or resource count.",
      searchRadius: "Ore search radius."
    },
    patterns: ["ore_expands_to_ore_and_deepslate", "do_not_dig_down_without_escape_checks"]
  },
  build_shelter: {
    commands: ["!placeHere"],
    parameters: {
      targetPosition: "Open-sky build site if already known.",
      mode: "starter_house, emergency_shell, or repair.",
      target: "Optional block family/material hint."
    },
    patterns: ["placeBlock_face_fallback", "reposition_before_body_collision", "single_block_placement_as_primitive"]
  },
  plant_crops: {
    commands: ["!placeHere", "!useOn"],
    parameters: {
      targetPosition: "Known safe farmland/soil position.",
      target: "Seed type or crop family.",
      count: "Planting count."
    },
    patterns: ["placeBlock_face_fallback", "safe_adjacent_interaction"]
  },
  hunt_food: {
    commands: ["!searchForEntity", "!attack"],
    parameters: {
      target: "Preferred animal/food source.",
      searchRadius: "Food target search radius.",
      allowAquaticHunt: "Only true when oxygen and shore reachability are safe."
    },
    patterns: ["entity_search_then_approach", "oxygen_abort_for_aquatic_targets"]
  },
  eat_food: {
    commands: ["!consume"],
    parameters: { target: "Preferred food item when controller has multiple options." },
    patterns: ["controller_selects_safe_food_item"]
  },
  recover_starvation: {
    commands: ["!consume", "!stay"],
    parameters: { mode: "hold_then_food_search or emergency_hunt." },
    patterns: ["interruptible_wait", "hostile_abort"]
  },
  hold_position: {
    commands: ["!stay"],
    parameters: { durationSeconds: "Optional bounded hold duration.", mode: "guard, shelter_hold, or recovery_hold." },
    patterns: ["interruptible_wait", "safety_recheck_loop"]
  },
  wait_out_night: {
    commands: ["!stay", "!goToBed"],
    parameters: { mode: "shelter_hold or bed_if_safe.", durationSeconds: "Optional max wait window." },
    patterns: ["interruptible_wait", "night_safety_rules_remain_local"]
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function taskParameterHintsForTask(taskType) {
  return clone(TASK_PARAMETER_HINTS[taskType] ?? { commands: [], parameters: {}, patterns: [] });
}

function compactMindcraftTaskKnowledge() {
  return {
    source: "mindcraft_ce_command_skill_catalog_translation",
    controlBoundary: "Smart Brain may only pass constructorArgs/taskRequests; SurvivalController owns execution and safety priority.",
    commandMappings: clone(MINDCRAFT_COMMAND_MAPPINGS),
    alwaysVisibleSkillDocs: clone(ALWAYS_VISIBLE_SKILL_DOCS),
    taskParameterHints: Object.fromEntries(Object.keys(TASK_PARAMETER_HINTS).map((taskType) => [taskType, taskParameterHintsForTask(taskType)])),
    primitivePatterns: compactMineflayerActionPatterns()
  };
}

module.exports = {
  ALWAYS_VISIBLE_SKILL_DOCS,
  MINDCRAFT_COMMAND_MAPPINGS,
  TASK_PARAMETER_HINTS,
  compactMindcraftTaskKnowledge,
  taskParameterHintsForTask
};