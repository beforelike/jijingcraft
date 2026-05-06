const { listAllowedTasks } = require("../knowledge/survivalSkills");
const { FOOD_ITEMS, LOG_BLOCKS } = require("../survival/constants");
const { countItems, inventoryFromBot } = require("../survival/inventory");

const ALLOWED_TASKS = new Set(listAllowedTasks());
const AQUATIC_HUNT_TARGETS = new Set(["salmon", "cod", "tropical_fish"]);
const NON_BLOCKING_NODE_FAILURES = new Set(["low_oxygen_escape", "target_unreachable", "hunt_food_primitive_failed"]);

const DEFAULT_TASK_PRIORITIES = Object.freeze({
  escape_hazard: 1000,
  escape_pit: 990,
  descend_from_platform: 985,
  eat_food: 980,
  recover_starvation: 970,
  evade_hostiles: 960,
  defend_shelter: 950,
  defend_self: 940,
  wait_out_night: 760,
  hold_position: 740,
  hunt_food: 680,
  collect_wood: 620,
  craft_basic_supplies: 600,
  craft_basic_tools: 590,
  collect_stone: 580,
  craft_stone_tools: 570,
  craft_furnace: 560,
  craft_weapon: 550,
  collect_building_materials: 500,
  build_shelter: 490,
  collect_wool: 460,
  craft_bed: 450,
  collect_crop_seeds: 430,
  plant_crops: 420,
  build_animal_pen: 410,
  lure_animals: 400,
  mine_advanced_materials: 360,
  explore: 120
});

const TASK_LABELS = Object.freeze({
  escape_hazard: "脱离危险方块",
  escape_pit: "脱离地形陷阱",
  descend_from_platform: "高台下降",
  eat_food: "紧急进食",
  recover_starvation: "饥饿危机稳定",
  evade_hostiles: "规避敌对生物",
  defend_shelter: "庇护所防御",
  defend_self: "最后反击",
  wait_out_night: "夜间安全等待",
  hold_position: "原地警戒",
  hunt_food: "觅食/狩猎",
  collect_wood: "采集木材",
  craft_basic_supplies: "制作基础补给",
  craft_basic_tools: "制作基础工具",
  collect_stone: "安全采石",
  craft_stone_tools: "升级石器",
  craft_furnace: "制作熔炉",
  craft_weapon: "补充武器",
  collect_building_materials: "收集建筑材料",
  build_shelter: "建造固定庇护所",
  collect_wool: "收集羊毛",
  craft_bed: "制作床",
  collect_crop_seeds: "收集种子",
  plant_crops: "开垦农田",
  build_animal_pen: "建造动物围栏",
  lure_animals: "诱导动物入栏",
  mine_advanced_materials: "采集高级材料",
  explore: "安全探索"
});

const TASK_TREE_CLASS_OVERRIDES = Object.freeze({
  collect_wood: {
    treeClass: "CollectWoodTree",
    taskFunction: "collectWood",
    parameterSchema: {
      count: "number of logs to collect in this tree instance",
      targetPosition: "known log position {x,y,z} to approach before collecting",
      tool: "preferred tool intent, for example hand or axe",
      searchRadius: "maximum nearby log search radius",
      preferredTerrain: "terrain hint for fallback exploration"
    },
    defaults: { count: 4, tool: "auto" }
  },
  collect_stone: {
    treeClass: "CollectStoneTree",
    taskFunction: "collectStone",
    parameterSchema: {
      count: "number of stone/cobblestone blocks to collect",
      targetPosition: "known exposed stone position {x,y,z}",
      searchRadius: "surface stone search radius"
    },
    defaults: { count: 11, searchRadius: 48 }
  },
  collect_building_materials: {
    treeClass: "CollectBuildingMaterialsTree",
    taskFunction: "collectBuildingMaterials",
    parameterSchema: {
      count: "target total building blocks after this task",
      searchRadius: "material search radius"
    }
  },
  explore: {
    treeClass: "ExploreTree",
    taskFunction: "explore",
    parameterSchema: {
      radius: "safe exploration radius or preferred travel distance",
      area: "semantic area size such as 10x10",
      targetPosition: "explicit exploration target {x,y,z}",
      mode: "exploration mode, for example safe_scan or recovery",
      allowNight: "whether this instance may explore at night if health is safe"
    },
    defaults: { radius: 10, mode: "safe_scan" }
  },
  hunt_food: {
    treeClass: "HuntFoodTree",
    taskFunction: "huntFood",
    parameterSchema: {
      count: "desired food item count for this attempt",
      target: "preferred animal or food source name",
      searchRadius: "food target search radius",
      allowAquaticHunt: "whether this instance may chase fish or other aquatic food targets"
    }
  }
});

const TREE_TEMPLATES = Object.freeze({
  escape_hazard: {
    preconditions: ["damaging_block_or_lava_detected"],
    postconditions: ["hazard_clear"],
    nodes: [
      { id: "scan_hazard", label: "扫描危险方块", kind: "sense", handler: "scan_hazard", phaseId: "scan" },
      { id: "escape_hazard", label: "执行危险方块脱离", kind: "action", handler: "execute_task", phaseId: "act" },
      { id: "verify_hazard_clear", label: "验证危险已解除", kind: "check", handler: "verify_hazard_clear", phaseId: "verify" }
    ]
  },
  escape_pit: {
    preconditions: ["navigation_trap_detected"],
    postconditions: ["navigation_safe"],
    nodes: [
      { id: "scan_environment", label: "扫描脚下与周围地形", kind: "sense", handler: "analyze_navigation", phaseId: "scan_environment" },
      { id: "choose_route", label: "选择脱困路线", kind: "setup", handler: "choose_escape_route", phaseId: "choose_route" },
      { id: "execute_escape", label: "执行脱困动作", kind: "action", handler: "execute_task", phaseId: "controlled_descent" },
      { id: "verify_navigation_safe", label: "验证已离开陷阱", kind: "check", handler: "verify_navigation_safe", phaseId: "verify" }
    ]
  },
  descend_from_platform: {
    preconditions: ["elevated_platform_detected", "descent_target_visible"],
    postconditions: ["platform_left_or_descent_progress"],
    nodes: [
      { id: "scan_descent", label: "扫描平台下方水坑", kind: "sense", handler: "scan_descent_target", phaseId: "scan_environment" },
      { id: "approach_edge", label: "移动到安全边缘", kind: "move", handler: "approach_descent_edge", phaseId: "approach_edge" },
      { id: "descend", label: "执行高台下降", kind: "action", handler: "execute_task", phaseId: "controlled_descent" },
      { id: "verify_descent", label: "验证已离开高台", kind: "check", handler: "verify_navigation_safe", phaseId: "verify" }
    ]
  },
  eat_food: {
    preconditions: ["food_available_or_low_health"],
    postconditions: ["food_or_health_stable"],
    nodes: [
      { id: "check_food", label: "检查可食用物品", kind: "sense", handler: "check_food_inventory", phaseId: "prepare" },
      { id: "eat_food", label: "执行进食", kind: "action", handler: "execute_task", phaseId: "eat" },
      { id: "verify_stable", label: "验证饱食或生命稳定", kind: "check", handler: "verify_food_or_health_stable", phaseId: "verify" }
    ]
  },
  recover_starvation: {
    preconditions: ["critical_health_or_starvation_risk"],
    postconditions: ["not_idle_without_food_plan"],
    nodes: [
      { id: "stop_motion", label: "停止移动并检查状态", kind: "setup", handler: "stop_motion", phaseId: "prepare" },
      { id: "recover_starvation", label: "执行饥饿危机恢复", kind: "action", handler: "execute_task", phaseId: "fallback" },
      { id: "verify_recovery", label: "验证恢复动作已推进", kind: "check", handler: "verify_task_progress", phaseId: "verify" }
    ]
  },
  hunt_food: {
    preconditions: ["not_in_hazard", "food_needed_or_recovery"],
    postconditions: ["food_inventory_increased_or_area_changed"],
    nodes: [
      { id: "prepare_hunt", label: "准备武器与状态", kind: "setup", handler: "prepare_hunt_food", phaseId: "prepare" },
      { id: "scan_hunt_targets", label: "寻找动物目标", kind: "sense", handler: "scan_hunt_targets", phaseId: "search" },
      { id: "track_hunt_target", label: "锁定并追踪目标", kind: "sense", handler: "track_hunt_target", phaseId: "track_animal" },
      { id: "approach_hunt_target", label: "接近食物目标", kind: "move", handler: "approach_hunt_target", phaseId: "approach_animal" },
      { id: "attack_hunt_target", label: "执行攻击", kind: "action", handler: "attack_hunt_target", phaseId: "attack_animal" },
      { id: "collect_hunt_drops", label: "拾取掉落物", kind: "action", handler: "collect_hunt_drops", phaseId: "collect_drops" },
      { id: "verify_hunt_gain", label: "验证食物增加", kind: "check", handler: "verify_hunt_food_gain", phaseId: "verify" }
    ]
  },
  collect_wood: {
    preconditions: ["not_in_hazard", "not_critically_hungry"],
    postconditions: ["wood_inventory_increased"],
    nodes: [
      { id: "prepare_wood_tool", label: "切换或放空伐木工具", kind: "setup", handler: "prepare_woodcutting_tool", phaseId: "prepare" },
      { id: "locate_low_log", label: "定位低位可达树干", kind: "sense", handler: "locate_wood_source", phaseId: "search" },
      { id: "collect_wood_batch", label: "采集树干批次", kind: "action", handler: "execute_task", phaseId: "act" },
      { id: "verify_wood_gain", label: "验证原木入包", kind: "check", handler: "verify_wood_inventory", phaseId: "verify" }
    ]
  },
  explore: {
    preconditions: ["safe_to_move"],
    postconditions: ["position_or_information_changed"],
    nodes: [
      { id: "choose_safe_target", label: "选择安全探索目标", kind: "sense", handler: "record_explore_intent", phaseId: "search" },
      { id: "explore", label: "执行安全探索", kind: "move", handler: "execute_task", phaseId: "act" },
      { id: "verify_progress", label: "验证探索推进", kind: "check", handler: "verify_task_progress", phaseId: "verify" }
    ]
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function toPascalCase(value) {
  return String(value ?? "")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function toCamelCase(value) {
  const pascal = toPascalCase(value);
  return pascal ? `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}` : "executeTask";
}

function taskPriority(taskType) {
  return DEFAULT_TASK_PRIORITIES[taskType] ?? 100;
}

function taskLevel(taskTypeOrPriority) {
  const priority = typeof taskTypeOrPriority === "string" ? taskPriority(taskTypeOrPriority) : Number(taskTypeOrPriority);
  if (priority >= 900) return "S";
  if (priority >= 700) return "A";
  if (priority >= 550) return "B";
  if (priority >= 400) return "C";
  return "D";
}

function taskTreeClassName(taskType) {
  return TASK_TREE_CLASS_OVERRIDES[taskType]?.treeClass ?? `${toPascalCase(taskType)}Tree`;
}

function taskFunctionName(taskType) {
  return TASK_TREE_CLASS_OVERRIDES[taskType]?.taskFunction ?? toCamelCase(taskType);
}

function taskParameterSchema(taskType) {
  return clone(TASK_TREE_CLASS_OVERRIDES[taskType]?.parameterSchema ?? {});
}

function normalizeConstructorPosition(value) {
  if (!value || typeof value !== "object") return null;
  const position = { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z) ? position : null;
}

function normalizeTaskConstructorArgs(taskType, value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const merged = {
    ...(TASK_TREE_CLASS_OVERRIDES[taskType]?.defaults ?? {})
  };
  for (const candidate of [source.constructorArgs, source.parameters, source.taskParameters, source.args, source.arguments]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) Object.assign(merged, candidate);
  }
  for (const key of ["area", "radius", "range", "target", "targetPosition", "position", "count", "quantity", "targetCount", "tool", "mode", "allowNight", "allowAquaticHunt", "searchRadius", "preferredTerrain"]) {
    if (source[key] !== undefined) merged[key] = source[key];
  }

  const normalized = {};
  for (const [key, item] of Object.entries(merged)) {
    if (item === undefined || typeof item === "function" || typeof item === "symbol") continue;
    normalized[key] = item;
  }

  if (normalized.quantity !== undefined) normalized.count = normalized.quantity;
  if (normalized.targetCount !== undefined) normalized.count = normalized.targetCount;
  delete normalized.quantity;
  delete normalized.targetCount;

  const targetPosition = normalizeConstructorPosition(normalized.targetPosition)
    ?? normalizeConstructorPosition(normalized.position)
    ?? (typeof normalized.target === "object" ? normalizeConstructorPosition(normalized.target) : null);
  if (targetPosition) normalized.targetPosition = targetPosition;
  if (normalized.position !== undefined) delete normalized.position;
  if (typeof normalized.target === "object") delete normalized.target;

  if (normalized.radius !== undefined) normalized.radius = Number(normalized.radius);
  if (normalized.range !== undefined) normalized.range = Number(normalized.range);
  if (normalized.searchRadius !== undefined) normalized.searchRadius = Number(normalized.searchRadius);
  if (normalized.count !== undefined) normalized.count = Number(normalized.count);
  for (const key of ["radius", "range", "searchRadius", "count"]) {
    if (normalized[key] !== undefined && !Number.isFinite(normalized[key])) delete normalized[key];
  }

  return clone(normalized);
}

function defaultTemplate(taskType) {
  return {
    preconditions: ["safe_window_or_rule_match"],
    postconditions: ["task_attempted"],
    nodes: [
      { id: `${taskType}_execute`, label: TASK_LABELS[taskType] ?? taskType, kind: "action", handler: "execute_task", phaseId: "act" },
      { id: `${taskType}_verify`, label: "验证任务状态", kind: "check", handler: "verify_task_progress", phaseId: "verify" }
    ]
  };
}

function buildExecutableBehaviorTree(taskType, options = {}) {
  if (!ALLOWED_TASKS.has(taskType)) throw new Error(`unknown behavior tree task: ${taskType}`);
  const template = clone(TREE_TEMPLATES[taskType] ?? defaultTemplate(taskType));
  const priority = taskPriority(taskType);
  const constructorArgs = normalizeTaskConstructorArgs(taskType, options);
  return {
    id: options.id ?? `bt:${Date.now()}:${Math.random().toString(36).slice(2, 8)}:${taskType}`,
    taskType,
    label: options.label ?? TASK_LABELS[taskType] ?? taskType,
    treeClass: options.treeClass ?? taskTreeClassName(taskType),
    taskFunction: options.taskFunction ?? taskFunctionName(taskType),
    constructorArgs,
    parameterSchema: taskParameterSchema(taskType),
    priority,
    level: taskLevel(priority),
    status: "pending",
    source: options.source ?? "agent_orchestrator",
    sourceAgent: options.sourceAgent ?? null,
    sourcePlanId: options.sourcePlanId ?? null,
    requestedBy: options.requestedBy ?? null,
    taskRequestId: options.taskRequestId ?? options.requestId ?? null,
    reason: options.reason ?? null,
    parameters: constructorArgs,
    createdAt: options.createdAt ?? nowIso(),
    expiresAt: options.expiresAt ?? null,
    preconditions: options.preconditions ?? template.preconditions,
    postconditions: options.postconditions ?? template.postconditions,
    nodes: options.nodes ?? template.nodes,
    metadata: options.metadata && typeof options.metadata === "object" ? { ...options.metadata } : {}
  };
}

function validateExecutableBehaviorTree(tree) {
  const errors = [];
  if (!tree || typeof tree !== "object") errors.push("tree_required");
  if (tree && !ALLOWED_TASKS.has(tree.taskType)) errors.push(`unknown_task:${tree?.taskType}`);
  if (!Number.isFinite(Number(tree?.priority))) errors.push("priority_required");
  if (!Array.isArray(tree?.nodes) || tree.nodes.length === 0) errors.push("nodes_required");
  for (const node of tree?.nodes ?? []) {
    if (!node.id) errors.push("node_id_required");
    if (!node.handler) errors.push(`node_handler_required:${node.id ?? "unknown"}`);
  }
  return { ok: errors.length === 0, errors };
}

function countLogs(controller) {
  if (!controller?.bot?.inventory?.items) return 0;
  return countItems(inventoryFromBot(controller.bot), LOG_BLOCKS);
}

function countFoodItems(controller) {
  if (!controller?.bot?.inventory?.items) return 0;
  return countItems(inventoryFromBot(controller.bot), FOOD_ITEMS);
}

function inventoryFingerprint(controller) {
  if (!controller?.bot?.inventory?.items) return "";
  return Object.entries(inventoryFromBot(controller.bot))
    .filter(([, count]) => Number(count) > 0)
    .sort(([leftName], [rightName]) => leftName.localeCompare(rightName))
    .map(([name, count]) => `${name}:${Number(count) || 0}`)
    .join("|");
}

function currentPositionKey(controller) {
  const position = controller?.bot?.entity?.position;
  if (!controller?.hasValidPosition?.(position)) return null;
  return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
}

function captureMetrics(controller) {
  return {
    logs: countLogs(controller),
    foodItems: countFoodItems(controller),
    inventoryFingerprint: inventoryFingerprint(controller),
    health: Number(controller?.bot?.health ?? 20),
    food: Number(controller?.bot?.food ?? 20),
    positionKey: currentPositionKey(controller)
  };
}

const DEFAULT_ACTION_HANDLERS = {
  async scan_hazard({ controller }) {
    const hazard = controller.findNearbyDamagingBlock?.(controller.bot?.entity?.position, 1.5) ?? null;
    controller.recordTaskObservation?.("behavior_tree", "hazard scan completed", { hazard: hazard?.name ?? null });
    return true;
  },

  async analyze_navigation({ controller, context }) {
    const position = controller.bot?.entity?.position;
    const analysis = controller.analyzeNavigationSituation?.(position) ?? null;
    context.navigationAnalysis = analysis;
    controller.recordTaskObservation?.("behavior_tree", "navigation analysis completed", {
      kind: analysis?.kind ?? null,
      recommendedAction: analysis?.recommendedAction ?? null,
      supportColumnDepth: analysis?.supportColumnDepth ?? null
    });
    return true;
  },

  async choose_escape_route({ controller, context }) {
    const analysis = context.navigationAnalysis;
    controller.recordTaskObservation?.("behavior_tree", "escape route selected", {
      route: analysis?.recommendedAction ?? "controller_escape_pit",
      options: analysis?.routeOptions ?? []
    });
    return true;
  },

  async scan_descent_target({ controller, context }) {
    const targets = controller.findWaterDescentTargets?.(controller.bot?.entity?.position, 16, 96) ?? [];
    context.descentTargets = targets;
    controller.recordTaskObservation?.("behavior_tree", "platform descent scan completed", {
      targetCount: targets.length,
      bestTarget: targets[0] ?? null
    });
    return targets.length ? true : { ok: false, reason: "no_water_descent_target" };
  },

  async approach_descent_edge({ controller, context }) {
    const bestTarget = context.descentTargets?.[0] ?? null;
    if (!bestTarget) return { ok: false, reason: "no_descent_target" };
    controller.recordTaskObservation?.("behavior_tree", "platform descent edge delegated to primitive", { bestTarget });
    return true;
  },

  async check_food_inventory({ controller }) {
    const inventory = controller.bot?.inventory?.items?.() ?? [];
    controller.recordTaskObservation?.("behavior_tree", "food inventory checked", { itemKinds: inventory.length });
    return true;
  },

  async stop_motion({ controller }) {
    controller.resetMotion?.();
    return true;
  },

  async prepare_woodcutting_tool({ controller }) {
    if (typeof controller.ensureWoodcuttingTool === "function" && !(await controller.ensureWoodcuttingTool())) {
      await controller.unequipHandIfHolding?.([]);
    }
    return true;
  },

  async locate_wood_source({ controller }) {
    const logIds = LOG_BLOCKS
      .map((blockName) => controller.mcData?.blocksByName?.[blockName]?.id)
      .filter((id) => id !== undefined);
    const positions = logIds.length && controller.bot?.findBlocks
      ? controller.bot.findBlocks({ matching: logIds, maxDistance: 64, count: 8 })
      : [];
    for (const position of positions.slice(0, 8)) {
      const block = controller.bot?.blockAt?.(position);
      if (block?.name) controller.rememberBlock?.(block.name, block.position ?? position);
    }
    controller.recordTaskObservation?.("behavior_tree", "wood source scan completed", { candidates: positions.length });
    return true;
  },

  async prepare_hunt_food({ controller }) {
    if (typeof controller.ensureHuntingWeapon === "function") await controller.ensureHuntingWeapon();
    else await controller.equipBestWeapon?.();
    return true;
  },

  async scan_hunt_targets({ controller, context }) {
    if (typeof controller.selectHuntFoodTarget === "function") {
      const selected = controller.selectHuntFoodTarget();
      context.huntSelection = selected;
      const selectedTarget = selected?.animal ?? selected?.target ?? selected?.entity;
      context.huntTarget = selectedTarget?.position ? selectedTarget : (selected?.position ? selected : null);
    }
    if (!context.huntTarget && typeof controller.nearestEntity === "function") {
      const radius = controller.config?.survival?.foodSearchRadius ?? 32;
      context.huntTarget = controller.nearestEntity((entity) => controller?.isHuntFoodTarget?.(entity) ?? false, radius);
    }
    if (!context.huntTarget) {
      context.delegateHuntPrimitive = true;
      controller.recordTaskObservation?.("behavior_tree", "no direct hunt target; delegating to huntFood primitive", {
        candidates: context.huntSelection?.candidates?.length ?? 0
      });
    }
    return true;
  },

  async track_hunt_target({ controller, context }) {
    if (context.delegateHuntPrimitive) return true;
    const target = context.huntTarget;
    if (!target) return { ok: false, reason: "hunt_target_missing" };
    controller.recordTaskObservation?.("behavior_tree", "hunt target tracked", {
      target: target.name,
      distance: target.position?.distanceTo?.(controller.bot?.entity?.position ?? target.position) ?? null
    });
    return true;
  },

  async approach_hunt_target({ controller, context }) {
    if (context.delegateHuntPrimitive) return true;
    const target = context.huntTarget;
    if (!target || !target.position) return { ok: false, reason: "hunt_target_invalid" };
    if (controller.isLowOxygen?.()) {
      await controller.escapeLowOxygen?.({ reason: "behavior_tree_hunt_approach", target: target.name });
      return { ok: false, reason: "low_oxygen_escape" };
    }

    const isAquatic = AQUATIC_HUNT_TARGETS.has(target.name);
    let reached = false;
    if (typeof controller.gotoEntity === "function") {
      reached = await controller.gotoEntity(target, isAquatic ? 4 : 2.5, {
        label: "hunt_food_target",
        timeoutMs: isAquatic ? Math.min(Math.max((controller.config?.survival?.actionTimeoutMs ?? 9000) * 2, 9000), 14000) : Math.min(controller.config?.survival?.actionTimeoutMs ?? 9000, 9000),
        segmentTimeoutMs: isAquatic ? 650 : undefined,
        learnPosition: target.position,
        target: target.name,
        radius: isAquatic ? 16 : 8,
        taskFeedback: false,
        tolerance: isAquatic ? 2.5 : 1.5,
        abortOnLowOxygen: isAquatic
      });
    } else if (typeof controller.gotoNear === "function") {
      reached = await controller.gotoNear(target.position.x, target.position.y, target.position.z, 3, {
        label: "hunt_food_target",
        timeoutMs: Math.min(controller.config?.survival?.actionTimeoutMs ?? 9000, 9000),
        learnPosition: target.position,
        target: target.name,
        radius: 8,
        taskFeedback: false
      });
    } else {
      return { ok: false, reason: "goto_entity_missing" };
    }
    if (controller.isLowOxygen?.()) {
      await controller.escapeLowOxygen?.({ reason: "behavior_tree_hunt_approach", target: target.name });
      return { ok: false, reason: "low_oxygen_escape" };
    }
    if (!reached) return { ok: false, reason: "target_unreachable" };
    return true;
  },

  async attack_hunt_target({ controller, context, tree, decision }) {
    if (context.delegateHuntPrimitive) {
      if (typeof controller.executePrimitive !== "function") return { ok: false, reason: "controller_execute_primitive_missing" };
      context.primitiveHuntResult = await controller.executePrimitive({
        ...decision,
        type: tree.taskType,
        constructorArgs: tree.constructorArgs ?? {},
        taskParameters: tree.constructorArgs ?? {}
      });
      return context.primitiveHuntResult ? true : { ok: false, reason: "hunt_food_primitive_failed" };
    }
    let target = context.huntTarget;
    if (!target) return { ok: false, reason: "hunt_target_missing_before_attack" };
    if (!controller.bot?.entities?.[target.id]) return { ok: false, reason: "hunt_target_gone" };
    if (!controller.bot?.pvp?.attack || !controller.bot?.pvp?.stop) return { ok: false, reason: "pvp_unavailable" };

    const timeoutMs = controller.config?.survival?.actionTimeoutMs ?? 9000;
    const deadline = Date.now() + timeoutMs;
    controller.bot.pvp.attack(target);
    try {
      while (Date.now() < deadline && controller.bot.entities[target.id]) {
        target = controller.bot.entities[target.id] ?? target;
        if (controller.isLowOxygen?.()) {
          await controller.escapeLowOxygen?.({ reason: "behavior_tree_hunt_attack", target: target.name });
          return { ok: false, reason: "low_oxygen_escape" };
        }
        await controller.wait?.(300);
      }
    } finally {
      controller.bot.pvp.stop();
    }
    return true;
  },

  async collect_hunt_drops({ controller }) {
    await controller.collectNearbyItems?.();
    return true;
  },

  async verify_hunt_food_gain({ controller, context }) {
    if (context.delegateHuntPrimitive && context.primitiveHuntResult) return true;
    const after = captureMetrics(controller);
    const gainedFood = after.foodItems - context.before.foodItems;
    return gainedFood > 0 ? true : { ok: false, reason: "food_inventory_not_increased" };
  },

  async record_explore_intent({ controller, tree }) {
    controller.recordTaskObservation?.("behavior_tree", "exploration tree selected", { treeId: tree.id, constructorArgs: tree.constructorArgs ?? tree.parameters ?? {} });
    return true;
  },

  async execute_task({ controller, tree, decision }) {
    if (typeof controller.executePrimitive !== "function") throw new Error("controller_execute_primitive_missing");
    const parameters = (tree.constructorArgs && typeof tree.constructorArgs === "object")
      ? tree.constructorArgs
      : (tree.parameters && typeof tree.parameters === "object" ? tree.parameters : {});
    return controller.executePrimitive({
      ...decision,
      type: tree.taskType,
      behaviorTreeQueued: false,
      constructorArgs: parameters,
      taskParameters: parameters,
      target: parameters.target ?? parameters.targetPosition ?? decision.target,
      targetCount: parameters.count ?? parameters.quantity ?? decision.targetCount
    });
  },

  async verify_hazard_clear({ controller }) {
    const hazard = controller.findNearbyDamagingBlock?.(controller.bot?.entity?.position, 1.2) ?? null;
    return hazard ? { ok: false, reason: `hazard_still_nearby:${hazard.name}` } : true;
  },

  async verify_navigation_safe({ controller }) {
    if (typeof controller.isLikelyPitPosition !== "function") return true;
    const stillTrapped = controller.isLikelyPitPosition(controller.bot?.entity?.position);
    return stillTrapped ? { ok: false, reason: "navigation_trap_still_detected" } : true;
  },

  async verify_food_or_health_stable({ controller, context }) {
    const after = captureMetrics(controller);
    return after.food > context.before.food || after.health >= context.before.health;
  },

  async verify_wood_inventory({ controller, context }) {
    const afterLogs = countLogs(controller);
    return afterLogs > context.before.logs ? true : { ok: false, reason: "wood_inventory_not_increased" };
  },

  async verify_task_progress({ controller, context, tree }) {
    const after = captureMetrics(controller);
    if (tree?.taskType === "hold_position" || tree?.taskType === "wait_out_night") {
      return after.health >= context.before.health ? true : { ok: false, reason: "passive_safety_health_dropped" };
    }
    return after.positionKey !== context.before.positionKey
      || after.logs !== context.before.logs
      || after.inventoryFingerprint !== context.before.inventoryFingerprint
      || after.food !== context.before.food
      || after.health !== context.before.health
      ? true
      : { ok: false, reason: "no_observable_progress" };
  }
};

class ExecutableBehaviorTreeRunner {
  constructor(actionHandlers = {}) {
    this.actionHandlers = { ...DEFAULT_ACTION_HANDLERS, ...actionHandlers };
  }

  async execute(tree, controller, decision = {}) {
    const validation = validateExecutableBehaviorTree(tree);
    if (!validation.ok) throw new Error(`invalid_behavior_tree:${validation.errors.join(",")}`);
    const context = {
      before: captureMetrics(controller),
      navigationAnalysis: null,
      huntTarget: null
    };
    controller.recordTaskObservation?.("behavior_tree", `started executable behavior tree ${tree.taskType}`, {
      treeId: tree.id,
      treeClass: tree.treeClass,
      taskFunction: tree.taskFunction,
      source: tree.source,
      sourceAgent: tree.sourceAgent,
      priority: tree.priority,
      constructorArgs: tree.constructorArgs ?? tree.parameters ?? {}
    });

    for (const node of tree.nodes) {
      const phaseId = node.phaseId ?? node.id;
      controller.markTaskPhase?.(phaseId, node.label ?? node.id, "active", { behaviorTreeId: tree.id, nodeId: node.id, kind: node.kind });
      const handler = this.actionHandlers[node.handler];
      if (!handler) throw new Error(`unknown_behavior_action:${node.handler}`);
      const result = await handler({ controller, tree, node, decision, context });
      if (result === false || result?.ok === false) {
        const reason = result?.reason ?? `node_failed:${node.id}`;
        controller.markTaskPhase?.(phaseId, node.label ?? node.id, "failed", { behaviorTreeId: tree.id, reason });
        controller.recordTaskObservation?.("behavior_tree", `node ${node.id} failed`, { reason, treeId: tree.id }, "warn");
        controller.recordActionFailure?.(tree.taskType, reason, controller.bot?.entity?.position, {
          target: "behavior_tree",
          taskType: tree.taskType,
          behaviorTreeId: tree.id,
          taskFeedback: NON_BLOCKING_NODE_FAILURES.has(reason) ? false : undefined
        });
        return false;
      }
      controller.markTaskPhase?.(phaseId, node.label ?? node.id, "completed", { behaviorTreeId: tree.id });
    }

    controller.recordTaskObservation?.("behavior_tree", `completed executable behavior tree ${tree.taskType}`, { treeId: tree.id });
    return true;
  }
}

module.exports = {
  DEFAULT_ACTION_HANDLERS,
  DEFAULT_TASK_PRIORITIES,
  TASK_TREE_CLASS_OVERRIDES,
  TASK_LABELS,
  ExecutableBehaviorTreeRunner,
  buildExecutableBehaviorTree,
  normalizeTaskConstructorArgs,
  taskFunctionName,
  taskLevel,
  taskParameterSchema,
  taskPriority,
  taskTreeClassName,
  validateExecutableBehaviorTree
};