const {
  ADVANCED_MATERIAL_ITEMS,
  ANIMAL_BAIT_ITEMS,
  BED_ITEMS,
  CROP_PLANT_ITEMS,
  FOOD_ITEMS,
  HOSTILE_MOBS,
  MELEE_HOSTILE_MOBS,
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
const { armedMeleeDefenseDistance } = require("./threatResponse");

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
  const daylightThreatRadius = survival.daylightThreatRadius ?? Math.max(6, Math.min(threatRadius, immediateThreatRadius + 2));
  const nightThreatPressureRadius = Math.max(immediateThreatRadius + 2, safeModeThreatRadius);
  const shelterDefenseRadius = survival.shelterDefenseRadius ?? 4;
  const starterFoodTarget = survival.starterFoodTarget ?? Math.min(6, survival.foodStockTarget ?? 6);
  const foodStockTarget = survival.foodStockTarget ?? 6;
  const foodCount = countItems(inventory, FOOD_ITEMS);
  const achievedMilestones = new Set(snapshot.progress?.achievedMilestones ?? []);
  const foodBufferAlreadyAchieved = achievedMilestones.has("food_buffer");
  const starterFoodReady = starterFoodTarget <= 0 || foodCount >= starterFoodTarget || foodBufferAlreadyAchieved;
  const foodStockReady = foodStockTarget <= 0 || foodCount >= foodStockTarget || foodBufferAlreadyAchieved;
  const shelterBlockTarget = survival.shelterBlockTarget ?? 28;
  const woolTarget = survival.woolTarget ?? 3;
  const cropPlotTarget = survival.cropPlotTarget ?? 6;
  const animalPenBlockTarget = survival.animalPenBlockTarget ?? 32;
  const advancedMaterialTarget = survival.advancedMaterialTarget ?? 8;
  const hasStarterShelter = Boolean(snapshot.progress?.hasStarterShelter);
  const hasRememberedStarterShelter = hasStarterShelter && Boolean(snapshot.progress?.starterShelterPosition);
  const hasUsableStarterShelter = hasStarterShelter
    && snapshot.progress?.isNearStarterShelter !== false
    && snapshot.progress?.isStarterShelterDefensible !== false;
  const hasCropPlot = Boolean(snapshot.progress?.hasCropPlot) || (snapshot.progress?.plantedCrops ?? 0) >= cropPlotTarget;
  const hasAnimalPen = Boolean(snapshot.progress?.hasAnimalPen);
  const hasCraftingTableAccess = Boolean(snapshot.progress?.hasCraftingTable) || hasAny(inventory, "crafting_table");
  const hasWeapon = hasAny(inventory, WEAPONS);
  const hasStonePickaxe = hasAny(inventory, STONE_OR_BETTER_PICKAXES);
  const hasStoneWeapon = hasAny(inventory, STONE_OR_BETTER_WEAPONS);
  const logsCount = countItems(inventory, LOG_BLOCKS);
  const cobblestoneCount = countItems(inventory, "cobblestone");
  const stickCount = countItems(inventory, "stick");
  const shelterMaterials = buildingMaterialCount(inventory);
  const playbookEnabled = survival.playbookEnabled === true;
  const day1LogTarget = Math.max(0, survival.day1LogTarget ?? 20);
  const day1CobblestoneTarget = Math.max(0, survival.day1CobblestoneTarget ?? 24);
  const stockpileLogTarget = Math.max(day1LogTarget, survival.stockpileLogTarget ?? 96);
  const stockpileCobblestoneTarget = Math.max(day1CobblestoneTarget, survival.stockpileCobblestoneTarget ?? 128);
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
  const hasInventoryFood = hasAny(inventory, FOOD_ITEMS);
  const nightFoodBuffer = Math.max(survival.lowFood ?? 14, Math.min(20, survival.nightFoodBuffer ?? 18));
  const lowOxygenThreshold = survival.lowOxygenThreshold ?? 8;

  if (snapshot.environmentHazard) {
    return { type: "escape_hazard", reason: `damaging block ${snapshot.environmentHazard.name} is too close` };
  }

  if (snapshot.navigationTrap) {
    return { type: "escape_pit", reason: snapshot.navigationAnalysis?.summary ?? "bot appears trapped by local terrain" };
  }

  if (snapshot.isInLava || (snapshot.isBodyInWater && snapshot.oxygen <= lowOxygenThreshold) || snapshot.timeSinceOnGround > 80) {
    return { type: "escape_hazard", reason: "environment hazard detected" };
  }

  if (snapshot.terrain?.descent?.needsDescent && snapshot.terrain?.descent?.bestTarget) {
    return {
      type: "descend_from_platform",
      reason: snapshot.terrain.descent.summary ?? "elevated platform descent target detected",
      targetPosition: snapshot.terrain.descent.bestTarget.entryPosition ?? snapshot.terrain.descent.bestTarget.waterPosition ?? null
    };
  }

  if (snapshot.health <= survival.criticalHealth && hasAny(inventory, FOOD_ITEMS)) {
    return { type: "eat_food", reason: "critical health and food is available" };
  }

  if (snapshot.health <= survival.criticalHealth) {
    const criticalThreatRadius = snapshot.isNight && !hasUsableStarterShelter
      ? nightThreatPressureRadius
      : immediateThreatRadius + 2;
    if (hostile && hostile.distance <= criticalThreatRadius) {
      return { type: "evade_hostiles", reason: `critical health, no food, and ${hostile.name} is ${hostile.distance.toFixed(1)} blocks away`, target: hostile.name };
    }
    return { type: "recover_starvation", reason: "critical health and no food is available; stop movement and search for immediate safe food" };
  }

  if (snapshot.isNight && hasUsableStarterShelter && hostile && hostile.distance <= shelterDefenseRadius) {
    return { type: "defend_shelter", reason: `${hostile.name} is inside shelter defense range`, target: hostile.name };
  }

  if (snapshot.isNight && !hasUsableStarterShelter && hostile && hostile.distance <= immediateThreatRadius) {
    if (hasAny(inventory, SHELTER_BLOCK_ITEMS)) {
      return { type: "wait_out_night", reason: `${hostile.name} is close; sealing temporary shelter before fighting`, target: hostile.name };
    }
    if (hasWeapon && snapshot.health > survival.criticalHealth && MELEE_HOSTILE_MOBS.has(hostile.name) && hostile.distance <= armedMeleeDefenseDistance(immediateThreatRadius)) {
      return { type: "defend_self", reason: `${hostile.name} is ${hostile.distance.toFixed(1)} blocks away and retreat room is limited`, target: hostile.name };
    }
    return { type: "evade_hostiles", reason: `${hostile.name} is ${hostile.distance.toFixed(1)} blocks away`, target: hostile.name };
  }

  if (snapshot.isNight && !hasUsableStarterShelter && hostile && hostile.distance <= nightThreatPressureRadius) {
    if (hasAny(inventory, SHELTER_BLOCK_ITEMS)) {
      return { type: "wait_out_night", reason: `${hostile.name} is within night pressure radius; sealing temporary shelter`, target: hostile.name };
    }
    return { type: "hold_position", reason: `${hostile.name} is within night pressure radius at ${hostile.distance.toFixed(1)} blocks; holding instead of chasing a distant retreat`, target: hostile.name };
  }

  if (snapshot.isNight && hasInventoryFood && snapshot.food < nightFoodBuffer && (!hostile || hostile.distance > immediateThreatRadius)) {
    return { type: "eat_food", reason: `night food buffer is ${snapshot.food}/${nightFoodBuffer}` };
  }

  if (snapshot.isNight && hasRememberedStarterShelter && !hasUsableStarterShelter && (!hostile || hostile.distance > immediateThreatRadius)) {
    return { type: "wait_out_night", reason: "returning to remembered starter shelter before waiting out night" };
  }

  if (snapshot.isNight && survival.buildShelter !== false && !hasUsableStarterShelter && hasStonePickaxe && hasStoneWeapon && starterFoodReady && shelterMaterials >= shelterBlockTarget) {
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

  if (!snapshot.isNight && hostile && hostile.distance <= Math.max(3.2, Math.min(4.5, immediateThreatRadius * 0.55)) && hasWeapon && snapshot.health > survival.criticalHealth) {
    return { type: "defend_self", reason: `${hostile.name} is ${hostile.distance.toFixed(1)} blocks away and already in melee range`, target: hostile.name };
  }

  if (!snapshot.isNight && hostile && hostile.distance <= daylightThreatRadius) {
    return { type: "evade_hostiles", reason: `${hostile.name} is ${hostile.distance.toFixed(1)} blocks away`, target: hostile.name };
  }

  if (snapshot.food <= survival.lowFood && hasInventoryFood) {
    return { type: "eat_food", reason: "hunger is low" };
  }

  if (snapshot.isNight && snapshot.food <= survival.lowFood && foodCount === 0) {
    if (hasAny(inventory, SHELTER_BLOCK_ITEMS)) {
      return { type: "wait_out_night", reason: "nighttime food search is too dangerous; seal and wait for daylight" };
    }
    return { type: "hold_position", reason: "nighttime food search is too dangerous; hold position until daylight" };
  }

  if (snapshot.food <= survival.lowFood && foodCount === 0) {
    return { type: "hunt_food", reason: "hunger is low and no food is available" };
  }

  if (survival.buildShelter !== false && !hasUsableStarterShelter && hasStonePickaxe && hasStoneWeapon && starterFoodReady && shelterMaterials >= shelterBlockTarget) {
    return { type: "build_shelter", reason: "shelter materials are ready" };
  }

  if (snapshot.isNight && hasAny(inventory, SHELTER_BLOCK_ITEMS)) {
    return { type: "wait_out_night", reason: "nighttime is too dangerous for open exploration" };
  }

  if (survival.avoidNightExploration !== false && snapshot.isNight) {
    return { type: "hold_position", reason: "nighttime safety hold; avoiding hostile exploration" };
  }

  if ((!hasAny(inventory, LOG_BLOCKS) || (playbookEnabled && logsCount < day1LogTarget))
    && countItems(inventory, PLANK_ITEMS) < 4
    && (stickCount < 2 || !hasCraftingTableAccess || !hasAny(inventory, PICKAXES))) {
    return { type: "collect_wood", reason: playbookEnabled && logsCount < day1LogTarget ? `day1 wood target is ${logsCount}/${day1LogTarget}` : "wood is required for the survival tech tree" };
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
    const earlyStoneTarget = playbookEnabled ? Math.max(5, day1CobblestoneTarget) : 5;
    if (cobblestoneCount < earlyStoneTarget) {
      return {
        type: "collect_stone",
        reason: playbookEnabled && cobblestoneCount < day1CobblestoneTarget
          ? `day1 cobblestone target is ${cobblestoneCount}/${day1CobblestoneTarget}`
          : "stone tools are required before risky material collection"
      };
    }
    if (hasCraftingTableAccess && stickCount >= 1) {
      return { type: "craft_stone_tools", reason: "stone pickaxe and sword are the first survival upgrade" };
    }
    return { type: "craft_basic_supplies", reason: "stone tools need sticks and crafting table access" };
  }

  if (!starterFoodReady) {
    return { type: "hunt_food", reason: `starter food reserve is ${foodCount}/${starterFoodTarget}` };
  }

  if ((!hasAny(inventory, LOG_BLOCKS) || (playbookEnabled && logsCount < day1LogTarget)) && countItems(inventory, PLANK_ITEMS) < 8) {
    return {
      type: "collect_wood",
      reason: playbookEnabled && logsCount < day1LogTarget
        ? `day1 wood target is ${logsCount}/${day1LogTarget}`
        : "wood is required for the survival tech tree"
    };
  }

  if (!hasCraftingTableAccess || stickCount < 2 || (!hasAny(inventory, PICKAXES) && countItems(inventory, PLANK_ITEMS) < 3)) {
    return { type: "craft_basic_supplies", reason: "planks, sticks, and crafting table are required" };
  }

  if (!hasAny(inventory, PICKAXES)) {
    return { type: "craft_basic_tools", reason: "a pickaxe is required for stone and ores" };
  }

  const midStoneTarget = playbookEnabled ? Math.max(11, day1CobblestoneTarget) : 11;
  if (cobblestoneCount < midStoneTarget) {
    return {
      type: "collect_stone",
      reason: playbookEnabled && cobblestoneCount < day1CobblestoneTarget
        ? `day1 cobblestone target is ${cobblestoneCount}/${day1CobblestoneTarget}`
        : "cobblestone is required for stone tools and furnace"
    };
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

  if (!foodStockReady) {
    return { type: "hunt_food", reason: `large food reserve is ${foodCount}/${foodStockTarget}` };
  }

  if (playbookEnabled && hasUsableStarterShelter) {
    if (logsCount < stockpileLogTarget) {
      return { type: "collect_wood", reason: `stockpile logs are ${logsCount}/${stockpileLogTarget}` };
    }
    if (cobblestoneCount < stockpileCobblestoneTarget) {
      return { type: "collect_stone", reason: `stockpile cobblestone is ${cobblestoneCount}/${stockpileCobblestoneTarget}` };
    }
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