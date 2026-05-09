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

test("exposes playbook counts and targets in assessProgress result", () => {
  const progress = assessProgress({
    inventory: { oak_log: 15, cobblestone: 10 },
    progress: { hasStarterShelter: false }
  }, {
    survival: {
      playbookEnabled: true,
      day1LogTarget: 20,
      day1CobblestoneTarget: 24,
      stockpileLogTarget: 96,
      stockpileCobblestoneTarget: 128
    }
  });

  assert.equal(progress.logsCount, 15);
  assert.equal(progress.cobblestoneCount, 10);
  assert.equal(progress.hasShelter, false);
  assert.equal(progress.playbookEnabled, true);
  assert.equal(progress.day1LogTarget, 20);
  assert.equal(progress.day1CobblestoneTarget, 24);
  assert.equal(progress.stockpileLogTarget, 96);
  assert.equal(progress.stockpileCobblestoneTarget, 128);
});

test("hasShelter reflects hasStarterShelter from progress state", () => {
  const progress = assessProgress({
    inventory: {},
    progress: { hasStarterShelter: true }
  }, { survival: {} });

  assert.equal(progress.hasShelter, true);
});