const {
  ADVANCED_MATERIAL_ITEMS,
  ANIMAL_BAIT_ITEMS,
  BED_ITEMS,
  CROP_PLANT_ITEMS,
  FOOD_ITEMS,
  HOSTILE_MOBS,
  LOG_BLOCKS,
  PICKAXES,
  PLANK_ITEMS,
  SHELTER_BLOCK_ITEMS,
  STONE_OR_BETTER_PICKAXES,
  STONE_OR_BETTER_WEAPONS,
  WEAPONS,
  WOOL_ITEMS
} = require("./constants");
const { countItems, hasAny } = require("./inventory");
const { buildingMaterialCount } = require("./progress");

function nearestHostile(snapshot) {
  return snapshot.entities
    .filter((entity) => HOSTILE_MOBS.has(entity.name))
    .sort((left, right) => left.distance - right.distance)[0];
}

function maxStackCount(inventory, names) {
  return names.reduce((largest, name) => Math.max(largest, inventory[name] || 0), 0);
}

function decideNextTask(snapshot, config) {
  const hostile = nearestHostile(snapshot);
  const inventory = snapshot.inventory;
  const survival = config.survival;
  const threatRadius = survival.threatRadius ?? 20;
  const safeModeThreatRadius = survival.safeModeThreatRadius ?? threatRadius;
  const immediateThreatRadius = survival.immediateThreatRadius ?? 8;
  const shelterDefenseRadius = survival.shelterDefenseRadius ?? 4;
  const starterFoodTarget = survival.starterFoodTarget ?? Math.min(6, survival.foodStockTarget ?? 6);
  const foodStockTarget = survival.foodStockTarget ?? 6;
  const foodCount = countItems(inventory, FOOD_ITEMS);
  const shelterBlockTarget = survival.shelterBlockTarget ?? 28;
  const woolTarget = survival.woolTarget ?? 3;
  const cropPlotTarget = survival.cropPlotTarget ?? 6;
  const animalPenBlockTarget = survival.animalPenBlockTarget ?? 32;
  const advancedMaterialTarget = survival.advancedMaterialTarget ?? 8;
  const hasStarterShelter = Boolean(snapshot.progress?.hasStarterShelter);
  const hasUsableStarterShelter = hasStarterShelter
    && snapshot.progress?.isNearStarterShelter !== false
    && snapshot.progress?.isStarterShelterDefensible !== false;
  const hasCropPlot = Boolean(snapshot.progress?.hasCropPlot) || (snapshot.progress?.plantedCrops ?? 0) >= cropPlotTarget;
  const hasAnimalPen = Boolean(snapshot.progress?.hasAnimalPen);
  const hasCraftingTableAccess = Boolean(snapshot.progress?.hasCraftingTable) || hasAny(inventory, "crafting_table");
  const hasWeapon = hasAny(inventory, WEAPONS);
  const hasStonePickaxe = hasAny(inventory, STONE_OR_BETTER_PICKAXES);
  const hasStoneWeapon = hasAny(inventory, STONE_OR_BETTER_WEAPONS);
  const cobblestoneCount = countItems(inventory, "cobblestone");
  const stickCount = countItems(inventory, "stick");
  const shelterMaterials = buildingMaterialCount(inventory);
  const woolCount = maxStackCount(inventory, WOOL_ITEMS);
  const advancedMaterialCount = countItems(inventory, ADVANCED_MATERIAL_ITEMS);
  const canCraftBasicSuppliesAtNight = (countItems(inventory, PLANK_ITEMS) < 4 && hasAny(inventory, LOG_BLOCKS))
    || (countItems(inventory, "stick") < 2 && countItems(inventory, PLANK_ITEMS) >= 2)
    || (!hasCraftingTableAccess && countItems(inventory, PLANK_ITEMS) >= 4);
  const canCraftBasicToolsAtNight = !hasAny(inventory, PICKAXES)
    && hasCraftingTableAccess
    && countItems(inventory, PLANK_ITEMS) >= 3
    && stickCount >= 2;
  const canCraftStonePickaxeAtNight = hasCraftingTableAccess
    && cobblestoneCount >= 3
    && stickCount >= 2
    && !hasAny(inventory, STONE_OR_BETTER_PICKAXES);
  const canCraftStoneWeaponAtNight = hasCraftingTableAccess
    && cobblestoneCount >= 2
    && stickCount >= 1
    && !hasAny(inventory, STONE_OR_BETTER_WEAPONS);
  const canCraftStoneToolsAtNight = canCraftStonePickaxeAtNight || canCraftStoneWeaponAtNight;
  const canCraftFurnaceAtNight = !hasAny(inventory, "furnace")
    && hasCraftingTableAccess
    && cobblestoneCount >= 8;
  const canCraftWeaponAtNight = !hasAny(inventory, WEAPONS)
    && hasCraftingTableAccess
    && stickCount >= 1
    && (cobblestoneCount >= 2 || countItems(inventory, PLANK_ITEMS) >= 2);

  if (snapshot.environmentHazard) {
    return { type: "escape_hazard", reason: `damaging block ${snapshot.environmentHazard.name} is too close` };
  }

  if (snapshot.navigationTrap) {
    return { type: "escape_pit", reason: "bot appears trapped below surrounding terrain" };
  }

  if (snapshot.isInLava || snapshot.oxygen <= 8 || snapshot.timeSinceOnGround > 80) {
    return { type: "escape_hazard", reason: "environment hazard detected" };
  }

  if (snapshot.health <= survival.criticalHealth && hasAny(inventory, FOOD_ITEMS)) {
    return { type: "eat_food", reason: "critical health and food is available" };
  }

  if (snapshot.health <= survival.criticalHealth) {
    return { type: "evade_hostiles", reason: "critical health and no food is available" };
  }

  if (snapshot.isNight && hasUsableStarterShelter && hostile && hostile.distance <= shelterDefenseRadius) {
    return { type: "defend_shelter", reason: `${hostile.name} is inside shelter defense range`, target: hostile.name };
  }

  if (snapshot.isNight && !hasUsableStarterShelter && hostile && hostile.distance <= immediateThreatRadius) {
    if (hasAny(inventory, SHELTER_BLOCK_ITEMS)) {
      return { type: "wait_out_night", reason: `${hostile.name} is close; sealing temporary shelter before fighting`, target: hostile.name };
    }
    if (hasWeapon && snapshot.health > survival.criticalHealth && hostile.distance <= Math.max(3, immediateThreatRadius / 3)) {
      return { type: "defend_self", reason: `${hostile.name} is ${hostile.distance.toFixed(1)} blocks away and retreat room is limited`, target: hostile.name };
    }
    return { type: "evade_hostiles", reason: `${hostile.name} is ${hostile.distance.toFixed(1)} blocks away`, target: hostile.name };
  }

  if (snapshot.isNight && survival.buildShelter !== false && !hasUsableStarterShelter && hasStonePickaxe && hasStoneWeapon && foodCount >= starterFoodTarget && shelterMaterials >= shelterBlockTarget) {
    return { type: "build_shelter", reason: "shelter materials are ready" };
  }

  if (snapshot.isNight && (!hostile || hostile.distance > immediateThreatRadius)) {
    if (canCraftBasicSuppliesAtNight) {
      return { type: "craft_basic_supplies", reason: "nighttime local crafting can prepare supplies without exploration" };
    }
    if (canCraftBasicToolsAtNight) {
      return { type: "craft_basic_tools", reason: "nighttime local crafting can prepare tools without exploration" };
    }
    if (canCraftStoneToolsAtNight) {
      return { type: "craft_stone_tools", reason: "nighttime local crafting can upgrade stone tools without exploration" };
    }
    if (canCraftFurnaceAtNight) {
      return { type: "craft_furnace", reason: "nighttime local crafting can prepare a furnace without exploration" };
    }
    if (canCraftWeaponAtNight) {
      return { type: "craft_weapon", reason: "nighttime local crafting can prepare a weapon without exploration" };
    }
  }

  if (snapshot.isNight && hasUsableStarterShelter) {
    return { type: "wait_out_night", reason: "staying inside starter shelter until daylight" };
  }

  if (!snapshot.isNight && hostile && hostile.distance <= threatRadius) {
    return { type: "evade_hostiles", reason: `${hostile.name} is ${hostile.distance.toFixed(1)} blocks away`, target: hostile.name };
  }

  if (snapshot.food <= survival.lowFood && hasAny(inventory, FOOD_ITEMS)) {
    return { type: "eat_food", reason: "hunger is low" };
  }

  if (snapshot.food <= survival.lowFood && foodCount === 0) {
    return { type: "hunt_food", reason: "hunger is low and no food is available" };
  }

  if (survival.buildShelter !== false && !hasUsableStarterShelter && hasStonePickaxe && hasStoneWeapon && foodCount >= starterFoodTarget && shelterMaterials >= shelterBlockTarget) {
    return { type: "build_shelter", reason: "shelter materials are ready" };
  }

  if (snapshot.isNight && hasAny(inventory, SHELTER_BLOCK_ITEMS)) {
    return { type: "wait_out_night", reason: "nighttime is too dangerous for open exploration" };
  }

  if (survival.avoidNightExploration !== false && snapshot.isNight) {
    return { type: "hold_position", reason: "nighttime safety hold; avoiding hostile exploration" };
  }

  if (!hasAny(inventory, LOG_BLOCKS) && countItems(inventory, PLANK_ITEMS) < 4 && (stickCount < 2 || !hasCraftingTableAccess || !hasAny(inventory, PICKAXES))) {
    return { type: "collect_wood", reason: "wood is required for the survival tech tree" };
  }

  if (!hasCraftingTableAccess || stickCount < 2 || (!hasAny(inventory, PICKAXES) && countItems(inventory, PLANK_ITEMS) < 3)) {
    return { type: "craft_basic_supplies", reason: "planks, sticks, and crafting table are required" };
  }

  if (!hasAny(inventory, PICKAXES)) {
    return { type: "craft_basic_tools", reason: "a pickaxe is required for stone and ores" };
  }

  if (hasCraftingTableAccess && cobblestoneCount >= 3 && stickCount >= 2 && !hasStonePickaxe) {
    return { type: "craft_stone_tools", reason: "cobblestone is available, upgrading from wooden tools" };
  }

  if (hasCraftingTableAccess && cobblestoneCount >= 2 && stickCount >= 1 && !hasStoneWeapon) {
    return { type: "craft_stone_tools", reason: "stone weapon improves survival efficiency" };
  }

  if (!hasStonePickaxe || !hasStoneWeapon) {
    if (cobblestoneCount < 5) {
      return { type: "collect_stone", reason: "stone tools are required before risky material collection" };
    }
    if (hasCraftingTableAccess && stickCount >= 1) {
      return { type: "craft_stone_tools", reason: "stone pickaxe and sword are the first survival upgrade" };
    }
    return { type: "craft_basic_supplies", reason: "stone tools need sticks and crafting table access" };
  }

  if (starterFoodTarget > 0 && foodCount < starterFoodTarget) {
    return { type: "hunt_food", reason: `starter food reserve is ${foodCount}/${starterFoodTarget}` };
  }

  if (!hasAny(inventory, LOG_BLOCKS) && countItems(inventory, PLANK_ITEMS) < 8) {
    return { type: "collect_wood", reason: "wood is required for the survival tech tree" };
  }

  if (!hasCraftingTableAccess || stickCount < 2 || (!hasAny(inventory, PICKAXES) && countItems(inventory, PLANK_ITEMS) < 3)) {
    return { type: "craft_basic_supplies", reason: "planks, sticks, and crafting table are required" };
  }

  if (!hasAny(inventory, PICKAXES)) {
    return { type: "craft_basic_tools", reason: "a pickaxe is required for stone and ores" };
  }

  if (cobblestoneCount < 11) {
    return { type: "collect_stone", reason: "cobblestone is required for stone tools and furnace" };
  }

  if (!hasAny(inventory, "furnace")) {
    return { type: "craft_furnace", reason: "a furnace enables cooking and smelting" };
  }

  if (!hasAny(inventory, WEAPONS)) {
    return { type: "craft_weapon", reason: "a weapon improves survival odds" };
  }

  if (survival.buildShelter !== false && !hasUsableStarterShelter) {
    if (shelterMaterials < shelterBlockTarget) {
      return { type: "collect_building_materials", reason: `house materials are ${shelterMaterials}/${shelterBlockTarget}`, targetCount: shelterBlockTarget };
    }
    return { type: "build_shelter", reason: "a starter house is required before open-ended exploration" };
  }

  if (foodStockTarget > 0 && foodCount < foodStockTarget) {
    return { type: "hunt_food", reason: `large food reserve is ${foodCount}/${foodStockTarget}` };
  }

  if (!hasAny(inventory, BED_ITEMS)) {
    if (woolCount < woolTarget) {
      return { type: "collect_wool", reason: `bed wool is ${woolCount}/${woolTarget}` };
    }
    if (countItems(inventory, PLANK_ITEMS) < 3) {
      return { type: "collect_wood", reason: "bed needs planks" };
    }
    return { type: "craft_bed", reason: "a bed anchors the base and skips dangerous nights" };
  }

  if (survival.plantCrops !== false && !hasCropPlot) {
    if (!hasAny(inventory, CROP_PLANT_ITEMS)) {
      return { type: "collect_crop_seeds", reason: "crop farming needs seeds or plantable food" };
    }
    return { type: "plant_crops", reason: "a renewable crop plot is required before mining" };
  }

  if (survival.buildAnimalPen !== false && !hasAnimalPen) {
    if (shelterMaterials < animalPenBlockTarget) {
      return { type: "collect_building_materials", reason: `animal pen materials are ${shelterMaterials}/${animalPenBlockTarget}`, targetCount: animalPenBlockTarget };
    }
    return { type: "build_animal_pen", reason: "animal pen is required for livestock" };
  }

  if (survival.buildAnimalPen !== false && hasAnimalPen && hasAny(inventory, ANIMAL_BAIT_ITEMS) && (snapshot.progress?.animalsLured ?? 0) < 2) {
    return { type: "lure_animals", reason: "livestock pen has room for animals" };
  }

  if (advancedMaterialTarget > 0 && advancedMaterialCount < advancedMaterialTarget) {
    return { type: "mine_advanced_materials", reason: `advanced materials are ${advancedMaterialCount}/${advancedMaterialTarget}` };
  }

  return { type: "explore", reason: "base, food, farming, livestock, and mining prep are stable" };
}

module.exports = {
  decideNextTask,
  nearestHostile
};