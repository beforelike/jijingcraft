const { taskLevel, taskPriority } = require("../behavior/executableBehaviorTree");

const BEHAVIOR_TREE_GROUPS = [
  {
    id: "safety",
    label: "生存安全",
    nodes: [
      { id: "escape_hazard", label: "脱离危险方块", kind: "condition", priority: 1 },
      { id: "escape_pit", label: "脱离地形陷阱", kind: "condition", priority: 2 },
      { id: "eat_food", label: "紧急进食", kind: "action", priority: 3 },
      { id: "recover_starvation", label: "饥饿危机稳定", kind: "action", priority: 4 },
      { id: "evade_hostiles", label: "规避敌对生物", kind: "action", priority: 5 },
      { id: "defend_shelter", label: "庇护所防御", kind: "action", priority: 6 },
      { id: "defend_self", label: "最后反击", kind: "action", priority: 7 }
    ]
  },
  {
    id: "night",
    label: "夜间策略",
    nodes: [
      { id: "wait_out_night", label: "封闭等待", kind: "action", priority: 8 },
      { id: "hold_position", label: "原地警戒", kind: "action", priority: 9 }
    ]
  },
  {
    id: "early_game",
    label: "基础科技树",
    nodes: [
      { id: "collect_wood", label: "采集木材", kind: "action", priority: 10 },
      { id: "craft_basic_supplies", label: "制作木板/工作台/木棍", kind: "action", priority: 11 },
      { id: "craft_basic_tools", label: "制作基础工具", kind: "action", priority: 12 },
      { id: "collect_stone", label: "安全采石", kind: "action", priority: 13 },
      { id: "craft_stone_tools", label: "升级石器", kind: "action", priority: 14 },
      { id: "craft_furnace", label: "制作熔炉", kind: "action", priority: 15 },
      { id: "craft_weapon", label: "补充武器", kind: "action", priority: 16 }
    ]
  },
  {
    id: "base_food",
    label: "基地与食物",
    nodes: [
      { id: "hunt_food", label: "觅食/狩猎", kind: "action", priority: 17 },
      { id: "collect_building_materials", label: "收集建筑材料", kind: "action", priority: 18 },
      { id: "build_shelter", label: "建造固定庇护所", kind: "action", priority: 19 },
      { id: "collect_wool", label: "收集羊毛", kind: "action", priority: 20 },
      { id: "craft_bed", label: "制作床", kind: "action", priority: 21 }
    ]
  },
  {
    id: "renewable_base",
    label: "可持续基地",
    nodes: [
      { id: "collect_crop_seeds", label: "收集种子/可种植食物", kind: "action", priority: 22 },
      { id: "plant_crops", label: "开垦农田", kind: "action", priority: 23 },
      { id: "build_animal_pen", label: "建造动物围栏", kind: "action", priority: 24 },
      { id: "lure_animals", label: "诱导动物入栏", kind: "action", priority: 25 }
    ]
  },
  {
    id: "expansion",
    label: "探索与矿物",
    nodes: [
      { id: "mine_advanced_materials", label: "采集高级材料", kind: "action", priority: 26 },
      { id: "explore", label: "安全探索", kind: "action", priority: 27 }
    ]
  }
];

const DEFAULT_TASK_PHASES = [
  { id: "prepare", label: "准备", kind: "setup" },
  { id: "search", label: "搜索目标", kind: "sense" },
  { id: "approach", label: "接近目标", kind: "move" },
  { id: "act", label: "执行动作", kind: "action" },
  { id: "risk_response", label: "风险应对", kind: "risk" },
  { id: "verify", label: "结果验证", kind: "check" }
];

const TASK_PHASE_DEFINITIONS = {
  escape_pit: [
    { id: "scan_environment", label: "扫描脚下与周围地形", kind: "sense" },
    { id: "choose_route", label: "选择脱困路线", kind: "setup" },
    { id: "rim_path", label: "尝试移动到安全边缘", kind: "move" },
    { id: "controlled_descent", label: "逐格下挖支撑下降", kind: "action" },
    { id: "carve_stair", label: "开凿上升阶梯", kind: "action" },
    { id: "verify", label: "验证已离开陷阱", kind: "check" }
  ],
  hunt_food: [
    { id: "prepare", label: "准备武器与状态", kind: "setup" },
    { id: "search", label: "扫描动物与植物", kind: "sense" },
    { id: "plant_scan", label: "寻找可食用植物", kind: "sense" },
    { id: "food_source_found", label: "发现食物源", kind: "sense" },
    { id: "approach_animal", label: "接近动物", kind: "move" },
    { id: "approach_plant", label: "接近安全采集位", kind: "move" },
    { id: "attack_animal", label: "攻击动物", kind: "action" },
    { id: "harvest_plant", label: "采集植物", kind: "action" },
    { id: "risk_response", label: "躲避怪物或植物伤害", kind: "risk" },
    { id: "collect_drops", label: "拾取掉落物", kind: "action" },
    { id: "verify", label: "验证食物增加", kind: "check" },
    { id: "fallback", label: "失败后探索/换目标", kind: "fallback" }
  ],
  defend_self: [
    { id: "prepare", label: "装备武器", kind: "setup" },
    { id: "target", label: "锁定敌对生物", kind: "sense" },
    { id: "positioning", label: "保持距离与站位", kind: "move" },
    { id: "attack", label: "攻击窗口", kind: "action" },
    { id: "retreat", label: "低血撤离", kind: "risk" },
    { id: "collect_drops", label: "战后拾取", kind: "action" },
    { id: "verify", label: "确认威胁解除", kind: "check" }
  ],
  evade_hostiles: [
    { id: "scan", label: "扫描威胁", kind: "sense" },
    { id: "retreat_path", label: "寻找撤离路线", kind: "move" },
    { id: "manual_retreat", label: "手动撤离", kind: "move" },
    { id: "risk_response", label: "撤离失败转反击", kind: "risk" },
    { id: "verify", label: "确认距离安全", kind: "check" }
  ],
  recover_starvation: [
    { id: "prepare", label: "停止移动并检查状态", kind: "setup" },
    { id: "inventory_food", label: "检查可食用物品", kind: "sense" },
    { id: "threat_check", label: "检查近身威胁", kind: "risk" },
    { id: "nearby_food", label: "寻找近处安全食物", kind: "sense" },
    { id: "eat", label: "进食恢复", kind: "action" },
    { id: "feedback", label: "写入失败反馈", kind: "fallback" },
    { id: "fallback", label: "迁移搜索食物", kind: "move" },
    { id: "verify", label: "验证是否稳定", kind: "check" }
  ],
  collect_wood: [
    { id: "prepare", label: "准备伐木工具", kind: "setup" },
    { id: "search", label: "搜索低位可达树干", kind: "sense" },
    { id: "approach", label: "移动到安全砍伐位", kind: "move" },
    { id: "act", label: "砍伐/手动兜底", kind: "action" },
    { id: "risk_response", label: "威胁/危险方块中断", kind: "risk" },
    { id: "verify", label: "验证原木入包", kind: "check" },
    { id: "fallback", label: "探索新树点", kind: "fallback" }
  ],
  collect_stone: [
    { id: "prepare", label: "准备镐与安全规则", kind: "setup" },
    { id: "search", label: "找裸露地表石头", kind: "sense" },
    { id: "approach", label: "移动到侧挖站位", kind: "move" },
    { id: "act", label: "采石", kind: "action" },
    { id: "risk_response", label: "坑洞/水/怪物处理", kind: "risk" },
    { id: "verify", label: "验证圆石入包", kind: "check" },
    { id: "fallback", label: "阶梯矿道兜底", kind: "fallback" }
  ],
  wait_out_night: [
    { id: "shelter_check", label: "检查可用庇护所", kind: "sense" },
    { id: "seal", label: "封闭/补门", kind: "action" },
    { id: "hold", label: "原地警戒", kind: "action" },
    { id: "risk_response", label: "近身威胁处理", kind: "risk" },
    { id: "verify", label: "等待天亮", kind: "check" }
  ],
  build_shelter: [
    { id: "prepare", label: "统计材料", kind: "setup" },
    { id: "layout", label: "规划墙体屋顶门洞", kind: "sense" },
    { id: "place_blocks", label: "放置结构方块", kind: "action" },
    { id: "install_door", label: "安装门/封口", kind: "action" },
    { id: "risk_response", label: "怪物中断处理", kind: "risk" },
    { id: "verify", label: "验证结构可防御", kind: "check" }
  ]
};

function phaseDefinitionsForTask(taskType) {
  if (!taskType) return [];
  return TASK_PHASE_DEFINITIONS[taskType] ?? DEFAULT_TASK_PHASES;
}

function phaseStatus(phase, activeTaskType, taskTrace = {}) {
  if (taskTrace.taskType !== activeTaskType) return "pending";
  const event = (taskTrace.phaseEvents ?? []).find((candidate) => candidate.id === phase.id);
  return event?.status ?? "pending";
}

function createBehaviorTree(activeTaskType = null, taskTrace = null) {
  return BEHAVIOR_TREE_GROUPS.map((group) => ({
    ...group,
    active: group.nodes.some((node) => node.id === activeTaskType),
    nodes: group.nodes.map((node) => ({
      ...node,
      displayOrder: node.priority,
      priority: taskPriority(node.id),
      level: taskLevel(node.id),
      active: node.id === activeTaskType,
      phases: phaseDefinitionsForTask(node.id).map((phase) => ({
        ...phase,
        status: phaseStatus(phase, node.id, taskTrace ?? {}),
        active: taskTrace?.taskType === node.id && taskTrace.activePhaseId === phase.id
      }))
    }))
  }));
}

function flattenBehaviorTree(tree = BEHAVIOR_TREE_GROUPS) {
  return tree.flatMap((group) => group.nodes.map((node) => ({ ...node, groupId: group.id, groupLabel: group.label })));
}

module.exports = {
  BEHAVIOR_TREE_GROUPS,
  DEFAULT_TASK_PHASES,
  TASK_PHASE_DEFINITIONS,
  createBehaviorTree,
  flattenBehaviorTree,
  phaseDefinitionsForTask
};