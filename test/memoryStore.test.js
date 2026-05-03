const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createDefaultSurvivalMemory,
  forgetKnownBlock,
  isLearningPositionAvoided,
  loadSurvivalMemory,
  rememberKnownBlock,
  recordLearningEvent,
  saveSurvivalMemory,
  updateProgressMemory
} = require("../src/survival/memoryStore");

test("stores and reloads known crafting table positions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bot-memory-"));
  const memoryPath = path.join(directory, "survival-memory.json");
  const memory = createDefaultSurvivalMemory();

  assert.equal(rememberKnownBlock(memory, "crafting_table", { x: 10, y: 64, z: -3 }, "overworld"), true);
  assert.equal(rememberKnownBlock(memory, "crafting_table", { x: 10, y: 64, z: -3 }, "overworld"), false);
  assert.equal(saveSurvivalMemory(memoryPath, memory, { warn() {} }), true);

  const loaded = loadSurvivalMemory(memoryPath, { warn() {} });
  assert.equal(loaded.knownBlocks.crafting_table.length, 1);
  assert.deepEqual(loaded.knownBlocks.crafting_table[0].position, { x: 10, y: 64, z: -3 });
});

test("updates progress and forgets missing known blocks", () => {
  const memory = createDefaultSurvivalMemory();
  rememberKnownBlock(memory, "crafting_table", { x: 1, y: 65, z: 2 }, "overworld");
  updateProgressMemory(memory, {
    hasStarterShelter: true,
    achievedMilestones: ["wood_age", "wood_age", "tool_age"]
  });

  assert.equal(memory.progress.hasStarterShelter, true);
  assert.deepEqual(memory.progress.achievedMilestones, ["wood_age", "tool_age"]);
  assert.equal(forgetKnownBlock(memory, "crafting_table", { x: 1, y: 65, z: 2 }, "overworld"), true);
  assert.equal(memory.knownBlocks.crafting_table.length, 0);
});

test("records failed action positions for adaptive avoidance", () => {
  const memory = createDefaultSurvivalMemory();
  const position = { x: 12, y: 64, z: -8 };

  assert.equal(recordLearningEvent(memory, {
    action: "forage_food",
    target: "sweet_berry_bush",
    outcome: "failure",
    reason: "safe_position_unreachable",
    position,
    dimension: "overworld",
    radius: 5
  }), true);

  assert.equal(isLearningPositionAvoided(memory, { x: 14, y: 64, z: -8 }, {
    action: "forage_food",
    target: "sweet_berry_bush",
    dimension: "overworld"
  }), true);
  assert.equal(memory.learning.policyStats["forage_food:sweet_berry_bush"].failures, 1);
});