const ALLOWED_TASKS = [
  "escape_hazard",
  "escape_pit",
  "descend_from_platform",
  "create_or_open_exit",
  "evade_hostiles",
  "defend_shelter",
  "defend_self",
  "hold_position",
  "eat_food",
  "recover_starvation",
  "hunt_food",
  "wait_out_night",
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
];

const SURVIVAL_SKILLS = [
  {
    id: "platform_descent",
    category: "safety",
    icon: "minecraft:water_bucket",
    title: {
      en_us: "Platform Descent",
      zh_cn: "高台下降"
    },
    description: {
      en_us: "When spawned on an elevated test platform, scan below for water or safe descent targets before normal resource work.",
      zh_cn: "出生在高空测试平台时，先扫描平台下方水坑或安全下降点，再进行普通资源任务。"
    },
    tasks: ["descend_from_platform", "escape_pit", "explore"],
    preconditions: ["elevated_platform_or_long_drop", "water_or_safe_descent_visible"],
    success: ["left_platform", "ground_or_water_reached", "normal_survival_route_unblocked"],
    safety: ["prefer_water_landing", "do_not_collect_wood_before_descent", "record_descent_target_in_environment_memory"],
    sourcePatterns: ["test_platform_bootstrap", "environment_first_task_gate"]
  },
  {
    id: "confined_space_exit",
    category: "safety",
    icon: "minecraft:oak_door",
    title: {
      en_us: "Confined Space Exit",
      zh_cn: "封闭空间出口"
    },
    description: {
      en_us: "When local spatial awareness reports a sealed cell or enclosed room during daylight, open an existing door or create a small exit before navigation-heavy work.",
      zh_cn: "当局部空间感知在白天识别到封闭小室或封闭房间时，先打开已有门或创建小出口，再执行依赖导航的工作。"
    },
    tasks: ["create_or_open_exit", "explore"],
    preconditions: ["confined_or_enclosed_space", "daylight_preferred", "no_immediate_hostile"],
    success: ["exit_opened", "bot_can_leave_local_cell", "normal_resource_route_unblocked"],
    safety: ["do_not_open_at_night_with_nearby_hostiles", "prefer_existing_doors", "dig_only_small_two_block_exit"],
    sourcePatterns: ["spatial_structure_recommended_action", "task_feedback_navigation_block"]
  },
  {
    id: "early_stone_tools",
    category: "progression",
    icon: "minecraft:stone_pickaxe",
    title: {
      en_us: "Early Stone Tools",
      zh_cn: "前期石器升级"
    },
    description: {
      en_us: "Get wood, craft a table and wooden pickaxe, collect safe exposed stone, then craft a stone pickaxe and sword.",
      zh_cn: "先获取木材，制作工作台和木镐，优先采安全裸露石头，再制作石镐和石剑。"
    },
    tasks: ["collect_wood", "craft_basic_supplies", "craft_basic_tools", "collect_stone", "craft_stone_tools"],
    preconditions: ["daytime_or_safe_shelter", "not_in_hazard", "not_critically_hungry"],
    success: ["has_stone_pickaxe", "has_stone_sword"],
    safety: ["avoid_water", "mine_from_safe_side", "do_not_dig_vertical_shafts", "avoid_falling_blocks"],
    sourcePatterns: ["voyager_skill_sequence", "touhou_tool_whitelist", "patchouli_entry"]
  },
  {
    id: "starter_food_buffer",
    category: "survival",
    icon: "minecraft:sweet_berries",
    title: {
      en_us: "Starter Food Buffer",
      zh_cn: "启动食物储备"
    },
    description: {
      en_us: "Use hunting and safe berry harvesting to get the first food reserve before committing to base construction.",
      zh_cn: "通过狩猎和安全采集甜浆果获得启动食物，再投入固定基地建设。"
    },
    tasks: ["hunt_food", "eat_food"],
    preconditions: ["stone_weapon_preferred", "avoid_night_hunting"],
    success: ["food_count_at_least_starter_target", "health_stable"],
    safety: ["harvest_berries_from_adjacent_safe_block", "retreat_from_hostiles", "attribute_plant_damage_before_unknown_damage"],
    sourcePatterns: ["voyager_critic_feedback", "ponderer_failure_replay"]
  },
  {
    id: "reusable_shelter",
    category: "base",
    icon: "minecraft:oak_door",
    title: {
      en_us: "Reusable Door Shelter",
      zh_cn: "可复用带门庇护所"
    },
    description: {
      en_us: "Collect enough building blocks and build a surface 7x7x5 starter house with double doors and core utility blocks.",
      zh_cn: "收集足够建筑方块，在地表建造 7x7x5 入门房屋，带双开门和核心功能方块。"
    },
    tasks: ["collect_building_materials", "build_shelter", "wait_out_night"],
    preconditions: ["has_stone_tools", "starter_food_ready", "surface_open_sky_site", "daytime_preferred"],
    success: ["starter_shelter_nearby", "starter_shelter_defensible", "double_door_installed", "crafting_table_furnace_chest_inside"],
    safety: ["do_not_build_fixed_shelter_underground", "add_torches_when_available", "do_not_trust_distant_shelter_memory", "hold_inside_at_night"],
    sourcePatterns: ["patchouli_multiblock_blueprint", "ponderer_structure_demo"]
  },
  {
    id: "night_safety_hold",
    category: "safety",
    icon: "minecraft:shield",
    title: {
      en_us: "Night Safety Hold",
      zh_cn: "夜间安全等待"
    },
    description: {
      en_us: "At night, keep emergency rules in control: seal shelter if possible, hold position for distant mobs, retreat only from close threats.",
      zh_cn: "夜间由安全底座接管：有方块先封闭庇护，远处怪物只警戒，近身威胁才撤离。"
    },
    tasks: ["wait_out_night", "hold_position", "evade_hostiles", "defend_self"],
    preconditions: ["is_night"],
    success: ["survive_until_day", "no_repeated_retreat_loop"],
    safety: ["distant_mobs_do_not_trigger_retreat", "last_resort_melee_only", "stop_all_motion_before_eating_or_reposition"],
    sourcePatterns: ["touhou_tool_trigger_guard", "survival_rule_priority"]
  },
  {
    id: "surface_stone_search",
    category: "mining",
    icon: "minecraft:cobblestone",
    title: {
      en_us: "Surface Stone Search",
      zh_cn: "地表石头搜索"
    },
    description: {
      en_us: "Prefer exposed surface stone with a safe side stand; only use a stair mine probe after repeated surface search failures.",
      zh_cn: "优先寻找有安全侧挖站位的裸露地表石头，多次失败后才使用阶梯矿道兜底。"
    },
    tasks: ["collect_stone", "mine_advanced_materials"],
    preconditions: ["has_pickaxe", "not_in_water", "safe_stand_available"],
    success: ["cobblestone_reserve_ready", "no_pit_trap"],
    safety: ["prefer_surface", "safe_side_dig", "avoid_falling_blocks", "avoid_beach_down_dig", "escape_pit_if_trapped"],
    sourcePatterns: ["voyager_mine_block_primitive", "ponderer_path_replay"]
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function listSurvivalSkills() {
  return clone(SURVIVAL_SKILLS);
}

function getSurvivalSkill(id) {
  const skill = SURVIVAL_SKILLS.find((candidate) => candidate.id === id);
  return skill ? clone(skill) : null;
}

function listAllowedTasks() {
  return [...ALLOWED_TASKS];
}

function validateTaskSequence(tasks) {
  const allowed = new Set(ALLOWED_TASKS);
  const unknownTasks = (Array.isArray(tasks) ? tasks : []).filter((task) => !allowed.has(task));
  return {
    ok: unknownTasks.length === 0,
    unknownTasks
  };
}

function findSkillsForTask(taskType) {
  return SURVIVAL_SKILLS
    .filter((skill) => skill.tasks.includes(taskType))
    .map((skill) => skill.id);
}

function primarySkillForTask(taskType) {
  return findSkillsForTask(taskType)[0] ?? null;
}

function formatSkillSummaryXml(skills = SURVIVAL_SKILLS, locale = "zh_cn") {
  if (!skills.length) return "No skills are currently available.";
  const body = skills.map((skill) => {
    const title = skill.title?.[locale] ?? skill.title?.en_us ?? skill.id;
    const description = skill.description?.[locale] ?? skill.description?.en_us ?? "";
    return `<skill><name>${escapeXml(skill.id)}</name><title>${escapeXml(title)}</title><description>${escapeXml(description)}</description></skill>`;
  }).join("");
  return `<available_skills>${body}</available_skills>`;
}

module.exports = {
  ALLOWED_TASKS,
  SURVIVAL_SKILLS,
  escapeXml,
  findSkillsForTask,
  formatSkillSummaryXml,
  getSurvivalSkill,
  listAllowedTasks,
  listSurvivalSkills,
  primarySkillForTask,
  validateTaskSequence
};