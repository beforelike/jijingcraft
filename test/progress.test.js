const assert = require("node:assert/strict");
const test = require("node:test");
const { assessProgress, buildingMaterialCount } = require("../src/survival/progress");

test("assesses survival progress milestones and next stage", () => {
  const progress = assessProgress({
    inventory: {
      oak_planks: 30,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 6
    },
    progress: { hasStarterShelter: false }
  }, {
    survival: {
      foodStockTarget: 6,
      shelterBlockTarget: 28,
      buildShelter: true
    }
  });

  assert.equal(progress.stage, "starter_shelter");
  assert.equal(progress.next.label, "Starter house built");
  assert.ok(progress.achievedIds.includes("shelter_materials"));
});

test("counts shelter building materials", () => {
  assert.equal(buildingMaterialCount({ dirt: 3, cobblestone: 4, oak_planks: 5, apple: 2 }), 12);
});

test("treats a remembered crafting table as crafting progress", () => {
  const progress = assessProgress({
    inventory: { stick: 2 },
    progress: { hasCraftingTable: true }
  });

  assert.ok(progress.achievedIds.includes("crafting_ready"));
});

test("keeps previously achieved milestones even after materials are consumed", () => {
  const progress = assessProgress({
    inventory: { cooked_beef: 6, white_bed: 1, raw_iron: 8 },
    progress: {
      hasStarterShelter: true,
      hasCropPlot: true,
      hasAnimalPen: true,
      achievedMilestones: [
        "wood_age",
        "crafting_ready",
        "tool_age",
        "stone_age",
        "furnace_ready",
        "armed",
        "food_buffer",
        "shelter_materials",
        "starter_shelter",
        "bed_ready",
        "crop_farm",
        "animal_pen",
        "mining_ready",
        "advanced_materials"
      ]
    }
  }, {
    survival: {
      foodStockTarget: 6,
      shelterBlockTarget: 28,
      buildShelter: true
    }
  });

  assert.equal(progress.stage, "phase1_stable");
});