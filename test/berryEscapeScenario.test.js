const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  hasBerryDamageEvidence,
  hasBerryHazardExposureEvidence,
  hasEscapeEvidence,
  hasTestTaskEvidence,
  horizontalSpeed,
  isInsideBerryPatchPosition,
  isOutsideBerryPatch,
  isSafeAfterEscape,
  scenarioConfig
} = require("../scripts/berryEscapeScenario");

test("berry escape scenario targets the existing bot and inserts a test pipeline task", () => {
  const previous = { ...process.env };
  try {
    delete process.env.SCENARIO_BOT_USERNAME;
    delete process.env.BOT_USERNAME;
    process.env.SCENARIO_ADMIN_USERNAME = "BerryAdmin";
    process.env.SCENARIO_TRAP_X = "4";
    process.env.SCENARIO_TRAP_Y = "81";
    process.env.SCENARIO_TRAP_Z = "-3";
    const config = scenarioConfig();

    assert.equal(config.botUsername, "SurvivalBot");
    assert.equal(config.dashboardUrl, "http://127.0.0.1:3000");
    assert.equal(config.testTaskType, "escape_hazard");
    assert.equal(config.testTaskPriority, 100);
    assert.equal(config.trapPosition.x, 4);
    assert.equal(config.berryPatchRadius, 4);
    assert.equal(config.platformRadius, 10);
    assert.equal(config.maxHorizontalSpeed, 5.2);
    assert.equal(config.setupPauseMs, 30000);
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("berry escape scenario success requires hazard escape evidence and safe status", () => {
  const status = {
    connection: { state: "connected" },
    bot: { health: 19 },
    world: { environmentHazard: null }
  };
  const messages = [
    "decision=escape_hazard; hp=20; food=20; reason=damaging block sweet_berry_bush is too close",
    "action=escape_hazard_block; mode=clear_plant; block=sweet_berry_bush; pos=0,80,0"
  ];

  assert.equal(hasEscapeEvidence(messages), true);
  assert.equal(hasTestTaskEvidence({ controller: { testTasks: { pendingTasks: [{ type: "escape_hazard", status: "pending" }] } } }), true);
  assert.equal(hasTestTaskEvidence({ controller: { testTasks: { completedTasks: [{ type: "escape_hazard", status: "completed" }] } } }), true);
  assert.equal(isSafeAfterEscape(status), true);
  assert.equal(isSafeAfterEscape({ ...status, world: { environmentHazard: { name: "sweet_berry_bush" } } }), false);
  assert.equal(hasBerryDamageEvidence(["emergency=damage_block; block=sweet_berry_bush; distance=0.3; escaping"], 20, 20), true);
  assert.equal(hasBerryDamageEvidence([], 20, 19.5), true);
  assert.equal(hasBerryDamageEvidence([], 20, 20), false);
});

test("berry escape scenario requires leaving the generated berry patch", () => {
  const config = {
    trapPosition: { x: 0, y: 80, z: 0 },
    berryPatchRadius: 4
  };

  assert.equal(isOutsideBerryPatch({ bot: { position: { x: 0.5, y: 80, z: 0.5 } } }, config), false);
  assert.equal(isOutsideBerryPatch({ bot: { position: { x: 5.2, y: 80, z: 0.5 } } }, config), true);
  assert.equal(isOutsideBerryPatch({ bot: { position: { x: 0.5, y: 80, z: -5.1 } } }, config), true);
  assert.equal(isInsideBerryPatchPosition({ x: 0.5, y: 80, z: 0.5 }, config), true);
  assert.equal(isInsideBerryPatchPosition({ x: 5.2, y: 80, z: 0.5 }, config), false);
  assert.equal(hasBerryHazardExposureEvidence({ bot: { position: { x: 0.5, y: 80, z: 0.5 } }, world: { environmentHazard: { name: "sweet_berry_bush" } } }, config), true);
});

test("berry escape scenario audits horizontal movement speed", () => {
  const previous = { at: 1000, position: { x: 0, y: 80, z: 0 } };
  const normalWalk = { at: 2000, position: { x: 4.2, y: 80, z: 0 } };
  const suspiciousJump = { at: 2000, position: { x: 8.5, y: 80, z: 0 } };

  assert.equal(Number(horizontalSpeed(previous, normalWalk).toFixed(1)), 4.2);
  assert.equal(Number(horizontalSpeed(previous, suspiciousJump).toFixed(1)), 8.5);
});

test("berry escape live script keeps normal movement and avoids harvest forcing", () => {
  const script = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "berryEscapeScenario.js"), "utf8");

  assert.equal(script.includes("/effect give"), false);
  assert.equal(script.includes("minecraft:movement_speed base set"), false);
  assert.equal(script.includes("minecraft:generic.movement_speed"), false);
  assert.equal(script.includes("/effect clear"), false);
  assert.equal(script.includes("/clear ${config.botUsername}"), false);
  assert.equal(script.includes("/gamemode survival"), false);
  assert.equal(script.includes("doMobSpawning"), false);
  assert.equal(script.includes("/api/test/tasks"), false);
  assert.equal(script.includes("/api/test/pipeline"), true);
  assert.equal(script.includes("/api/test/reset-state"), true);
  assert.equal(script.includes("releasePause"), true);
  assert.ok(script.indexOf("await resetExistingBotState(config)") < script.indexOf("await prepareScenarioWorld(admin, config)"));
  assert.ok(script.indexOf("await initializeScenarioBot(admin, config)") < script.indexOf("await insertBerryEscapeTask(config)"));
  assert.ok(script.indexOf("await insertBerryEscapeTask(config)") < script.indexOf("await releaseExistingBotState(config)"));
  assert.equal(script.includes("outsidePatch"), true);
  assert.equal(script.includes("missing_real_berry_damage_evidence"), false);
  assert.equal(script.includes("spawn(process.execPath"), false);
  assert.equal(script.includes("TEST_INITIAL_FORCED_TASK"), false);
  assert.equal(script.includes("forceHuntFood"), false);
  assert.equal(script.includes("STARTER_FOOD_TARGET"), false);
  assert.equal(script.includes("FOOD_STOCK_TARGET"), false);
});