const {
  ADVANCED_MATERIAL_ITEMS,
  BED_ITEMS,
  CROP_BLOCKS,
  CROP_ITEMS,
  CROP_PLANT_ITEMS,
  FOOD_ITEMS,
  LOG_BLOCKS,
  PICKAXES,
  PLANK_ITEMS,
  SHELTER_BLOCK_ITEMS,
  WEAPONS,
  WOOL_ITEMS
} = require("./constants");
const { countItems, hasAny } = require("./inventory");

function buildingMaterialCount(inventory) {
  return countItems(inventory, SHELTER_BLOCK_ITEMS);
}

function maxStackCount(inventory, names) {
  return names.reduce((largest, name) => Math.max(largest, inventory[name] || 0), 0);
}

function assessProgress(snapshot, config = {}) {
  const inventory = snapshot.inventory ?? {};
  const survival = config.survival ?? {};
  const achievedHistory = new Set(snapshot.progress?.achievedMilestones ?? []);
  const foodStockTarget = survival.foodStockTarget ?? 6;
  const shelterBlockTarget = survival.shelterBlockTarget ?? 28;
  const cropPlotTarget = survival.cropPlotTarget ?? 6;
  const advancedMaterialTarget = survival.advancedMaterialTarget ?? 8;
  const foodCount = countItems(inventory, FOOD_ITEMS);
  const materialCount = buildingMaterialCount(inventory);
  const plantedCrops = snapshot.progress?.plantedCrops ?? 0;
  const logsCount = countItems(inventory, LOG_BLOCKS);
  const cobblestoneCount = countItems(inventory, "cobblestone");

  const milestones = [
    {
      id: "wood_age",
      label: "Wood acquired",
      achieved: achievedHistory.has("wood_age") || hasAny(inventory, LOG_BLOCKS) || countItems(inventory, PLANK_ITEMS) >= 4
    },
    {
      id: "crafting_ready",
      label: "Crafting table and sticks ready",
      achieved: achievedHistory.has("crafting_ready") || ((hasAny(inventory, "crafting_table") || Boolean(snapshot.progress?.hasCraftingTable)) && countItems(inventory, "stick") >= 2)
    },
    {
      id: "tool_age",
      label: "Pickaxe crafted",
      achieved: achievedHistory.has("tool_age") || hasAny(inventory, PICKAXES)
    },
    {
      id: "stone_age",
      label: "Stone reserve collected",
      achieved: achievedHistory.has("stone_age") || countItems(inventory, "cobblestone") >= 11
    },
    {
      id: "furnace_ready",
      label: "Furnace ready",
      achieved: achievedHistory.has("furnace_ready") || hasAny(inventory, "furnace")
    },
    {
      id: "armed",
      label: "Weapon crafted",
      achieved: achievedHistory.has("armed") || hasAny(inventory, WEAPONS)
    },
    {
      id: "food_buffer",
      label: "Large food reserve stocked",
      achieved: foodStockTarget <= 0 || achievedHistory.has("food_buffer") || foodCount >= foodStockTarget
    },
    {
      id: "shelter_materials",
      label: "House materials stocked",
      achieved: survival.buildShelter === false || achievedHistory.has("shelter_materials") || materialCount >= shelterBlockTarget
    },
    {
      id: "starter_shelter",
      label: "Starter house built",
      achieved: survival.buildShelter === false || achievedHistory.has("starter_shelter") || Boolean(snapshot.progress?.hasStarterShelter)
    },
    {
      id: "bed_ready",
      label: "Bed crafted",
      achieved: achievedHistory.has("bed_ready") || hasAny(inventory, BED_ITEMS)
    },
    {
      id: "crop_farm",
      label: "Crop farm started",
      achieved: survival.plantCrops === false || achievedHistory.has("crop_farm") || Boolean(snapshot.progress?.hasCropPlot) || plantedCrops >= cropPlotTarget || hasAny(inventory, CROP_ITEMS) || hasAny(inventory, CROP_BLOCKS)
    },
    {
      id: "animal_pen",
      label: "Animal pen prepared",
      achieved: survival.buildAnimalPen === false || achievedHistory.has("animal_pen") || Boolean(snapshot.progress?.hasAnimalPen)
    },
    {
      id: "mining_ready",
      label: "Mining expedition ready",
      achieved: achievedHistory.has("mining_ready") || (hasAny(inventory, WEAPONS) && hasAny(inventory, PICKAXES) && (hasAny(inventory, BED_ITEMS) || maxStackCount(inventory, WOOL_ITEMS) >= 3) && (foodStockTarget <= 0 || foodCount >= Math.min(foodStockTarget, 8)) && (survival.plantCrops === false || Boolean(snapshot.progress?.hasCropPlot) || hasAny(inventory, CROP_PLANT_ITEMS)) && (survival.buildAnimalPen === false || Boolean(snapshot.progress?.hasAnimalPen)))
    },
    {
      id: "advanced_materials",
      label: "Advanced materials gathered",
      achieved: advancedMaterialTarget <= 0 || achievedHistory.has("advanced_materials") || countItems(inventory, ADVANCED_MATERIAL_ITEMS) >= advancedMaterialTarget
    }
  ];

  const achieved = milestones.filter((milestone) => milestone.achieved);
  const next = milestones.find((milestone) => !milestone.achieved) ?? null;

  return {
    milestones,
    achievedIds: achieved.map((milestone) => milestone.id),
    next,
    stage: next?.id ?? "phase1_stable",
    summary: `${achieved.length}/${milestones.length}`,
    foodCount,
    materialCount,
    logsCount,
    cobblestoneCount,
    hasShelter: Boolean(snapshot.progress?.hasStarterShelter),
    playbookEnabled: survival.playbookEnabled === true,
    day1LogTarget: survival.day1LogTarget ?? 20,
    day1CobblestoneTarget: survival.day1CobblestoneTarget ?? 24,
    stockpileLogTarget: survival.stockpileLogTarget ?? 96,
    stockpileCobblestoneTarget: survival.stockpileCobblestoneTarget ?? 128
  };
}

module.exports = {
  assessProgress,
  buildingMaterialCount
};