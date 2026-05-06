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

test("stores and reloads exploration coarse map memory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mc-bot-exploration-memory-"));
  const memoryPath = path.join(directory, "survival-memory.json");
  const memory = createDefaultSurvivalMemory();
  memory.exploration.lastScanAt = "2026-05-06T00:00:00.000Z";
  memory.exploration.lastPosition = { x: 1, y: 80, z: 2 };
  memory.exploration.lastRegionalScan = { radius: 100, step: 10, sampleCount: 25 };
  memory.exploration.lastDescent = { waterPosition: { x: 4, y: 60, z: 4 }, entryPosition: { x: 4, y: 61, z: 4 }, drop: 20 };
  memory.exploration.visited.push({ at: memory.exploration.lastScanAt, dimension: "overworld", position: { x: 1, y: 80, z: 2 } });
  memory.exploration.coarseCells["overworld:0:0"] = {
    dimension: "overworld",
    position: { x: 0, y: 64, z: 0 },
    topBlock: "stone",
    water: false,
    hazard: false,
    safeStand: true,
    lastSeenAt: memory.exploration.lastScanAt
  };

  assert.equal(saveSurvivalMemory(memoryPath, memory, { warn() {} }), true);
  const loaded = loadSurvivalMemory(memoryPath, { warn() {} });

  assert.equal(loaded.exploration.visited.length, 1);
  assert.equal(Object.keys(loaded.exploration.coarseCells).length, 1);
  assert.equal(loaded.exploration.coarseCells["overworld:0:0"].topBlock, "stone");
  assert.equal(loaded.exploration.lastDescent.drop, 20);
});