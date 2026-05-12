const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { SurvivalController } = require("../src/survival/SurvivalController");

test("unknown damage response repositions to a nearby safe stand position", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let target = null;
  controller.bot = {
    entity: {
      position: new Vec3(0, 64, 0)
    }
  };
  controller.config = {
    survival: {
      actionTimeoutMs: 25000
    }
  };
  controller.logger = {
    warn: () => {}
  };
  controller.isSafeStandPosition = (position) => position.x === 4 && position.y === 64 && position.z === 0;
  controller.findNearbyDamagingBlock = () => null;
  controller.gotoNear = async (x, y, z, range) => {
    target = { x, y, z, range };
    return true;
  };

  await controller.respondToUnknownDamage(20, 16);

  assert.deepEqual(target, { x: 4, y: 64, z: 0, range: 1 });
});

test("unknown damage response falls back to the last safe stand when no candidates exist", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const fallback = new Vec3(2, 64, 0);
  let gotoTarget = null;
  controller.bot = {
    entity: {
      position: new Vec3(0, 58, 0)
    }
  };
  controller.config = {
    survival: {
      actionTimeoutMs: 25000
    }
  };
  controller.logger = {
    warn: () => {},
    debug: () => {}
  };
  controller.lastSafeStandPosition = fallback;
  controller.findNearbySafeStandPositions = () => [];
  controller.clearImmediateBodySpace = async () => false;
  controller.gotoNear = async (x, y, z, range) => {
    gotoTarget = { x, y, z, range };
    return false;
  };

  await controller.respondToUnknownDamage(10, 8);

  assert.deepEqual(gotoTarget, { x: 2, y: 64, z: 0, range: 1 });
  assert.deepEqual(controller.bot.entity.position, fallback);
});

test("emergency damage near a damaging plant escapes the plant instead of unknown reposition", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const plant = { name: "sweet_berry_bush", position: new Vec3(1, 64, 0), distance: 1.2 };
  let escaped = null;
  let unknownRepositioned = false;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    health: 18
  };
  controller.config = {
    survival: {
      safeModeThreatRadius: 28
    }
  };
  controller.logger = {
    warn: () => {},
    debug: () => {}
  };
  controller.emergencyBusy = false;
  controller.pause = () => {};
  controller.cancelCollectTask = async () => {};
  controller.resetMotion = () => {};
  controller.findNearbyDamagingBlock = () => null;
  controller.findNearbyDamagingBlockLoose = () => plant;
  controller.nearestEntity = () => null;
  controller.escapeHazardBlock = async (hazard) => {
    escaped = hazard;
  };
  controller.respondToUnknownDamage = async () => {
    unknownRepositioned = true;
  };

  await controller.handleEmergencyDamage(19, 18);

  assert.equal(escaped, plant);
  assert.equal(unknownRepositioned, false);
});

test("emergency damage in water with oxygen buffer does not trigger oxygen escape", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let oxygenEscaped = false;
  let unknownRepositioned = false;
  controller.bot = {
    oxygenLevel: 12,
    health: 18,
    entity: { position: new Vec3(0, 60, 0) },
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (blockPosition.y === 60 || blockPosition.y === 61) return { name: "water", position: blockPosition, boundingBox: "empty" };
      return { name: "air", position: blockPosition, boundingBox: "empty" };
    }
  };
  controller.config = { survival: { lowOxygenThreshold: 8, safeModeThreatRadius: 28 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.emergencyBusy = false;
  controller.pause = () => {};
  controller.cancelCollectTask = async () => {};
  controller.resetMotion = () => {};
  controller.findNearbyDamagingBlock = () => null;
  controller.findNearbyDamagingBlockLoose = () => null;
  controller.nearestEntity = () => null;
  controller.isLikelyStarvationDamage = () => false;
  controller.escapeLowOxygen = async () => {
    oxygenEscaped = true;
  };
  controller.respondToUnknownDamage = async () => {
    unknownRepositioned = true;
  };

  await controller.handleEmergencyDamage(19, 18);

  assert.equal(oxygenEscaped, false);
  assert.equal(unknownRepositioned, true);
});

test("phantom damage does not cancel active platform descent", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let hostileResponded = false;
  let paused = false;
  controller.bot = {
    health: 18,
    oxygenLevel: 20,
    entity: { position: new Vec3(0, 80, 0) },
    blockAt: () => ({ name: "air", boundingBox: "empty" })
  };
  controller.config = { survival: { criticalHealth: 6, safeModeThreatRadius: 28 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.currentDecisionType = "descend_from_platform";
  controller.emergencyBusy = false;
  controller.pause = () => { paused = true; };
  controller.findNearbyDamagingBlock = () => null;
  controller.findNearbyDamagingBlockLoose = () => null;
  controller.nearestEntity = () => ({ name: "phantom", position: new Vec3(1, 80, 0) });
  controller.respondToHostileDamage = async () => { hostileResponded = true; };
  controller.respondToUnknownDamage = async () => {};

  await controller.handleEmergencyDamage(20, 18);

  assert.equal(hostileResponded, false);
  assert.equal(paused, false);
  assert.equal(controller.emergencyBusy, false);
});

test("lifecycle reset clears queued work and publishes dead state", () => {
  const controller = Object.create(SurvivalController.prototype);
  let behaviorFailed = false;
  let behaviorCleared = false;
  let taskFailed = false;
  let taskCleared = false;
  let resetMotion = false;
  controller.bot = {
    health: 0,
    food: 0,
    oxygenLevel: 20,
    entity: { position: new Vec3(0, 64, 0), isInLava: false },
    game: { dimension: "overworld" }
  };
  controller.config = { survival: {}, memory: { enabled: false } };
  controller.memory = { knownBlocks: {}, learning: { policyStats: {}, avoidedPositions: [] } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.statusReporter = null;
  controller.behaviorQueue = {
    current: { taskType: "collect_wood" },
    failCurrent: () => { behaviorFailed = true; return { taskType: "collect_wood" }; },
    clear: () => { behaviorCleared = true; return { removed: 2 }; },
    getStatus: () => ({})
  };
  controller.taskQueue = {
    current: { type: "collect_wood" },
    failCurrent: () => { taskFailed = true; },
    clear: () => { taskCleared = true; },
    getStatus: () => ({})
  };
  controller.priorityTaskQueue = { clear: () => ({ removed: 1 }), getStatus: () => ({}) };
  controller.testTaskQueue = { getStatus: () => ({}) };
  controller.resetMotion = () => { resetMotion = true; };
  controller.pause = (milliseconds) => { controller.pausedUntil = Date.now() + milliseconds; };
  controller.reportBehaviorTreeFeedback = () => {};
  controller.publishTaskQueueStatus = () => {};
  controller.createSnapshot = () => ({ health: controller.bot.health, food: 0, oxygen: 20, position: controller.bot.entity.position });
  controller.busy = true;
  controller.emergencyBusy = true;
  controller.taskTrace = null;

  const result = controller.handleLifecycleReset("bot_death", { pauseMs: 5000, interruptMs: 8000 });

  assert.equal(result.lifecycleState, "dead");
  assert.equal(controller.busy, false);
  assert.equal(controller.emergencyBusy, false);
  assert.equal(controller.hostileFleeUntilClearBusy, false);
  assert.equal(controller.lastPublishContext.snapshot.health, 0);
  assert.equal(behaviorFailed, true);
  assert.equal(behaviorCleared, true);
  assert.equal(taskFailed, true);
  assert.equal(taskCleared, true);
  assert.equal(resetMotion, true);
  assert.equal(controller.pendingEmergencyDamage, null);
});

test("respawn lifecycle clears stale death pause and shortens interruption", () => {
  const controller = Object.create(SurvivalController.prototype);
  const now = Date.now();
  controller.bot = {
    health: 20,
    food: 20,
    oxygenLevel: 20,
    entity: { position: new Vec3(0, 64, 0), isInLava: false },
    game: { dimension: "overworld" }
  };
  controller.config = { survival: {}, memory: { enabled: false } };
  controller.memory = { knownBlocks: {}, learning: { policyStats: {}, avoidedPositions: [] } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.statusReporter = null;
  controller.behaviorQueue = { clear: () => ({ removed: 0 }), getStatus: () => ({}) };
  controller.taskQueue = { clear: () => ({ removed: 0 }), getStatus: () => ({}) };
  controller.priorityTaskQueue = { clear: () => ({ removed: 0 }), getStatus: () => ({}) };
  controller.testTaskQueue = { getStatus: () => ({}) };
  controller.resetMotion = () => {};
  controller.reportBehaviorTreeFeedback = () => {};
  controller.publishTaskQueueStatus = () => {};
  controller.recordModeLog = () => {};
  controller.createSnapshot = () => ({ health: controller.bot.health, food: 20, oxygen: 20, position: controller.bot.entity.position });
  controller.pausedUntil = now + 5000;
  controller.actionInterruptedUntil = now + 8000;
  controller.hostileFleeRunId = 3;

  const result = controller.handleLifecycleReset("bot_respawn", { pauseMs: 0, interruptMs: 1500 });

  assert.equal(result.lifecycleState, "active");
  assert.equal(controller.pausedUntil, 0);
  assert.ok(controller.actionInterruptedUntil <= Date.now() + 1700);
  assert.equal(controller.hostileFleeRunId, 4);
});

test("hostile damage during flee-until-clear does not stop the active flee", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const zombie = { id: 1, name: "zombie", position: new Vec3(1.4, 64, 0) };
  let resetMotion = false;
  let collectCancelled = false;
  let hostileResponded = false;
  let pausedMs = 0;
  controller.bot = {
    health: 18,
    oxygenLevel: 20,
    entity: { position: new Vec3(0, 64, 0) }
  };
  controller.config = { survival: { safeModeThreatRadius: 28 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.emergencyBusy = false;
  controller.hostileFleeUntilClearBusy = true;
  controller.actionInterruptedUntil = 0;
  controller.pause = (milliseconds) => { pausedMs = milliseconds; };
  controller.shouldEscapeForLowOxygen = () => false;
  controller.findNearbyDamagingBlock = () => null;
  controller.findNearbyDamagingBlockLoose = () => null;
  controller.findFallingBlockEntrapment = () => null;
  controller.nearestEntity = () => zombie;
  controller.cancelCollectTask = async () => { collectCancelled = true; };
  controller.resetMotion = () => { resetMotion = true; };
  controller.respondToHostileDamage = async () => { hostileResponded = true; };
  controller.recordModeLog = () => {};

  await controller.handleEmergencyDamage(20, 18, { source: "entity_hurt" });

  assert.equal(resetMotion, false);
  assert.equal(collectCancelled, false);
  assert.equal(hostileResponded, false);
  assert.equal(controller.emergencyBusy, false);
  assert.equal(controller.hostileFleeUntilClearBusy, true);
  assert.equal(pausedMs, 500);
  assert.ok(controller.actionInterruptedUntil > 0);
});

test("unknown damage during flee-until-clear does not start reposition or reset motion", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let resetMotion = false;
  let collectCancelled = false;
  let unknownRepositioned = false;
  let pausedMs = 0;
  controller.bot = {
    health: 4,
    oxygenLevel: 20,
    entity: { position: new Vec3(0, 64, 0) }
  };
  controller.config = { survival: { safeModeThreatRadius: 28 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.emergencyBusy = false;
  controller.hostileFleeUntilClearBusy = true;
  controller.actionInterruptedUntil = 0;
  controller.pause = (milliseconds) => { pausedMs = milliseconds; };
  controller.shouldEscapeForLowOxygen = () => false;
  controller.findNearbyDamagingBlock = () => null;
  controller.findNearbyDamagingBlockLoose = () => null;
  controller.findFallingBlockEntrapment = () => null;
  controller.nearestEntity = () => null;
  controller.cancelCollectTask = async () => { collectCancelled = true; };
  controller.resetMotion = () => { resetMotion = true; };
  controller.respondToUnknownDamage = async () => { unknownRepositioned = true; };
  controller.recordModeLog = () => {};

  await controller.handleEmergencyDamage(7, 4, { source: "health" });

  assert.equal(resetMotion, false);
  assert.equal(collectCancelled, false);
  assert.equal(unknownRepositioned, false);
  assert.equal(controller.emergencyBusy, false);
  assert.equal(controller.hostileFleeUntilClearBusy, true);
  assert.equal(pausedMs, 500);
  assert.ok(controller.actionInterruptedUntil > 0);
});

test("fatal damage is ignored instead of starting stale emergency movement", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let resetMotion = false;
  let hostileResponded = false;
  controller.bot = {
    health: 0,
    entity: { position: new Vec3(0, 64, 0) }
  };
  controller.config = { survival: { safeModeThreatRadius: 28 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.emergencyBusy = false;
  controller.lifecycleState = "active";
  controller.pendingEmergencyDamage = { previousHealth: 4, currentHealth: 0, source: "health", at: Date.now() };
  controller.resetMotion = () => { resetMotion = true; };
  controller.respondToHostileDamage = async () => { hostileResponded = true; };

  await controller.handleEmergencyDamage(4, 0, { source: "health" });

  assert.equal(resetMotion, true);
  assert.equal(hostileResponded, false);
  assert.equal(controller.pendingEmergencyDamage, null);
});

test("emergency damage does not reenter an active hazard escape", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const plant = { name: "sweet_berry_bush", position: new Vec3(0, 64, 0), distance: 0.4 };
  const warnings = [];
  let escaped = false;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    health: 18
  };
  controller.config = { survival: { safeModeThreatRadius: 28 } };
  controller.logger = { warn: (message) => warnings.push(message), debug: () => {} };
  controller.emergencyBusy = false;
  controller.hazardEscapeBusy = true;
  controller.findNearbyDamagingBlock = () => plant;
  controller.findNearbyDamagingBlockLoose = () => plant;
  controller.nearestEntity = () => null;
  controller.escapeHazardBlock = async () => {
    escaped = true;
  };

  await controller.handleEmergencyDamage(19, 18);

  assert.equal(escaped, false);
  assert.ok(warnings.some((message) => /already_escaping/.test(message)));
});

test("hostile damage from a melee zombie counterattacks instead of starting another retreat", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const zombie = { id: 1, name: "zombie", position: new Vec3(1.5, 64, 0) };
  let defended = null;
  let retreated = false;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: "stone_sword", count: 1 }] }
  };
  controller.config = {
    survival: {
      criticalHealth: 8,
      immediateThreatRadius: 8,
      panicRetreatMs: 3500
    }
  };
  controller.logger = { warn: () => {} };
  controller.defendSelf = async (target) => {
    defended = target;
  };
  controller.panicRetreatFrom = async () => {
    retreated = true;
    return true;
  };

  await controller.respondToHostileDamage(zombie, 19, 14.5);

  assert.equal(defended, zombie);
  assert.equal(retreated, false);
});

test("hostile damage keeps fleeing when unarmed retreat fails", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const zombie = { id: 1, name: "zombie", position: new Vec3(1, 64, 0) };
  let fled = null;
  let defended = false;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] }
  };
  controller.config = {
    survival: {
      criticalHealth: 8,
      immediateThreatRadius: 8,
      panicRetreatMs: 3500
    }
  };
  controller.logger = { warn: () => {} };
  controller.fleeUntilNoHostiles = async (target, options) => { fled = { target, options }; return true; };
  controller.panicRetreatFrom = async () => { throw new Error("unexpected one-shot retreat"); };
  controller.defendSelf = async () => { defended = true; };

  await controller.respondToHostileDamage(zombie, 20, 20);

  assert.equal(defended, false);
  assert.equal(fled.target, zombie);
  assert.equal(fled.options.reason, "hostile_damage");
});

test("bot entityHurt triggers emergency damage even when health has not changed", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const botEntity = { id: 42, position: new Vec3(0, 64, 0) };
  let call = null;
  controller.bot = {
    entity: botEntity,
    health: 20
  };
  controller.lastHealth = 20;
  controller.logger = { debug: () => {} };
  controller.publishControllerState = () => {};
  controller.handleEmergencyDamage = async (previousHealth, currentHealth, options) => {
    call = { previousHealth, currentHealth, options };
  };

  await controller.handleBotEntityHurt({ id: 42, position: new Vec3(0, 64, 0) });

  assert.deepEqual(call, {
    previousHealth: 20,
    currentHealth: 20,
    options: { source: "entity_hurt" }
  });
});

test("bot entityHurt ignores other hurt entities", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let called = false;
  controller.bot = {
    entity: { id: 42, position: new Vec3(0, 64, 0) },
    health: 20
  };
  controller.handleEmergencyDamage = async () => {
    called = true;
  };

  await controller.handleBotEntityHurt({ id: 7, name: "zombie", position: new Vec3(1, 64, 0) });

  assert.equal(called, false);
});

test("emergency damage preempts active queued work before hostile response", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const zombie = { id: 1, name: "zombie", position: new Vec3(2, 64, 0) };
  let released = false;
  let respondedAfterRelease = false;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    health: 18,
    oxygenLevel: 20
  };
  controller.config = { survival: { safeModeThreatRadius: 28 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.currentDecisionType = "collect_wood";
  controller.emergencyBusy = false;
  controller.behaviorQueue = {
    current: { taskType: "collect_wood", id: "tree-1" },
    failCurrent: () => {
      released = true;
      return { taskType: "collect_wood", id: "tree-1" };
    },
    clear: () => ({ removed: 0 })
  };
  controller.reportBehaviorTreeFeedback = () => {};
  controller.pause = () => {};
  controller.cancelCollectTask = async () => {};
  controller.resetMotion = () => {};
  controller.shouldEscapeForLowOxygen = () => false;
  controller.findNearbyDamagingBlock = () => null;
  controller.findNearbyDamagingBlockLoose = () => null;
  controller.findFallingBlockEntrapment = () => null;
  controller.isLikelyStarvationDamage = () => false;
  controller.nearestEntity = () => zombie;
  controller.respondToHostileDamage = async () => {
    respondedAfterRelease = released;
  };
  controller.respondToUnknownDamage = async () => {};

  await controller.handleEmergencyDamage(20, 18, { source: "entity_hurt" });

  assert.equal(released, true);
  assert.equal(respondedAfterRelease, true);
});

test("emergency damage does not interrupt active melee defense", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const zombie = { id: 1, name: "zombie", position: new Vec3(1.5, 64, 0) };
  let released = false;
  let responded = false;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    health: 18,
    oxygenLevel: 20
  };
  controller.config = { survival: { criticalHealth: 8, safeModeThreatRadius: 28 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.currentDecisionType = "evade_hostiles";
  controller.combatEngagementDepth = 1;
  controller.activeCombatTargetId = zombie.id;
  controller.emergencyBusy = false;
  controller.pause = () => {};
  controller.cancelCollectTask = async () => {};
  controller.resetMotion = () => {};
  controller.shouldEscapeForLowOxygen = () => false;
  controller.findNearbyDamagingBlock = () => null;
  controller.findNearbyDamagingBlockLoose = () => null;
  controller.findFallingBlockEntrapment = () => null;
  controller.isLikelyStarvationDamage = () => false;
  controller.nearestEntity = () => zombie;
  controller.releaseCurrentQueuedWork = () => {
    released = true;
  };
  controller.respondToHostileDamage = async () => {
    responded = true;
  };

  await controller.handleEmergencyDamage(20, 18, { source: "entity_hurt" });

  assert.equal(released, false);
  assert.equal(responded, false);
  assert.equal(controller.emergencyBusy, false);
});

test("escapeHazardBlock pathfinds to a nearby safe stand when quick retreat is not enough", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const hazard = { name: "cactus", position: new Vec3(0, 64, 0), distance: 0.2 };
  let target = null;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };
  controller.config = {
    survival: {
      actionTimeoutMs: 25000
    }
  };
  controller.logger = {
    warn: () => {},
    debug: () => {}
  };
  controller.resetMotion = () => {};
  controller.quickRetreatFromHazard = async () => {};
  controller.manualStepTowardSafePositions = async () => false;
  controller.clearDamagingPlantBlock = async () => false;
  controller.findNearbyDamagingBlock = (position) => (position.x === 0 && position.z === 0 ? hazard : null);
  controller.isSafeStandPosition = (position) => position.x === 1 && position.y === 64 && position.z === 0;
  controller.gotoNear = async (x, y, z, range, options) => {
    target = { x, y, z, range, options };
    controller.bot.entity.position = new Vec3(x, y, z);
    return true;
  };

  await controller.escapeHazardBlock(hazard);

  assert.deepEqual({ x: target.x, y: target.y, z: target.z, range: target.range }, { x: 1, y: 64, z: 0, range: 1 });
  assert.equal(target.options.label, "escape_hazard_block");
});

test("escapeHazardBlock clears a berry bush when movement cannot escape it", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const hazard = { name: "sweet_berry_bush", position: new Vec3(0, 64, 0), distance: 0.2 };
  let cleared = null;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };
  controller.config = {
    survival: {
      actionTimeoutMs: 25000
    }
  };
  controller.logger = {
    warn: () => {},
    debug: () => {}
  };
  controller.resetMotion = () => {};
  controller.findSafeAdjacentStandPositions = () => [];
  controller.findNearbySafeStandPositions = () => [];
  controller.findNearbyDamagingBlock = () => null;
  controller.clearDamagingPlantBlock = async (detectedHazard) => {
    cleared = detectedHazard;
    return true;
  };
  controller.gotoNear = async () => {
    throw new Error("pathing should not be needed after clearing the plant");
  };

  await controller.escapeHazardBlock(hazard);

  assert.equal(cleared, hazard);
});

test("escapeDamagingPlantBlock clears touching berry bushes before stepping away", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const hazard = { name: "sweet_berry_bush", position: new Vec3(0, 64, 0), distance: 0.2 };
  const block = { name: "sweet_berry_bush", position: hazard.position, diggable: true };
  let dug = false;
  controller.mcData = {};
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position) => {
      if (!dug && position.x === 0 && position.y === 64 && position.z === 0) return block;
      if (position.y === 63) return { name: "grass_block", position, boundingBox: "block" };
      return { name: "air", position, boundingBox: "empty" };
    },
    lookAt: async () => {},
    dig: async () => {
      dug = true;
    }
  };
  controller.config = { survival: { actionTimeoutMs: 25000 } };
  controller.logger = { warn: () => {} };
  controller.withTimeout = async (promise) => promise;
  controller.resetMotion = () => {};
  controller.recordActionSuccess = () => {};
  controller.recordActionFailure = () => {};
  controller.manualStepTowardPosition = async () => {
    throw new Error("movement should not be needed after clearing the only touching plant");
  };
  controller.findNearbyDamagingBlock = () => (dug ? null : hazard);
  controller.manualStepTowardSafePositions = async () => {
    throw new Error("safe-position stepping should not be needed after clearing the touching plant");
  };
  controller.gotoNear = async () => {
    throw new Error("pathing should not be needed after clearing the touching plant");
  };

  const escaped = await controller.escapeDamagingPlantBlock(hazard);

  assert.equal(escaped, true);
  assert.equal(dug, true);
});

test("clearDamagingPlantCorridor only clears a bounded number of berry bushes", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const patchRadius = 4;
  const cleared = new Set();
  const keyFor = (position) => `${position.x},${position.y},${position.z}`;
  controller.mcData = {};
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position) => {
      if (position.y === 64 && Math.abs(position.x) <= patchRadius && Math.abs(position.z) <= patchRadius && !cleared.has(keyFor(position))) {
        return { name: "sweet_berry_bush", position, diggable: true };
      }
      if (position.y === 63) return { name: "grass_block", position, boundingBox: "block" };
      return { name: "air", position, boundingBox: "empty" };
    },
    lookAt: async () => {},
    dig: async (block) => {
      cleared.add(keyFor(block.position));
    }
  };
  controller.config = { survival: { actionTimeoutMs: 25000 } };
  controller.logger = { warn: () => {}, debug: () => {} };
  controller.withTimeout = async (promise) => promise;
  controller.resetMotion = () => {};
  controller.recordActionSuccess = () => {};
  controller.recordActionFailure = () => {};

  const clearedAny = await controller.clearDamagingPlantCorridor(new Vec3(0, 64, 0), new Vec3(6, 64, 0), 1);

  assert.equal(clearedAny, true);
  assert.equal(cleared.size, 1);
});

test("priority berry escape keeps moving while inside the generated patch", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let stepped = null;
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0), isInLava: false, timeSinceOnGround: 0 },
    oxygenLevel: 20
  };
  controller.resetMotion = () => {};
  controller.findNearbyDamagingBlock = () => null;
  controller.findDamagingPlantEscapeTarget = () => new Vec3(5, 64, 0);
  controller.stepTowardDamagingPlantEscapeTarget = async (blockName, origin, target) => {
    stepped = { blockName, origin, target };
    return false;
  };

  const escaped = await controller.escapeHazard({
    priorityMetadata: {
      scenario: "berry_escape",
      trapPosition: { x: 0, y: 64, z: 0 },
      berryPatchRadius: 4
    }
  });

  assert.equal(escaped, false);
  assert.equal(stepped.blockName, "sweet_berry_bush");
  assert.deepEqual(stepped.target, new Vec3(5, 64, 0));
});

test("clearDamagingPlantBlock digs the touching berry bush as an emergency fallback", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const block = { name: "sweet_berry_bush", position: new Vec3(0, 64, 0), diggable: true };
  let dug = false;
  let success = null;
  controller.bot = {
    blockAt: () => block,
    lookAt: async () => {},
    dig: async () => {
      dug = true;
    }
  };
  controller.config = {
    survival: {
      actionTimeoutMs: 25000
    }
  };
  controller.logger = {
    warn: () => {}
  };
  controller.withTimeout = async (promise) => promise;
  controller.resetMotion = () => {};
  controller.recordActionSuccess = (action, position, details) => {
    success = { action, position, details };
  };
  controller.recordActionFailure = () => {};

  const cleared = await controller.clearDamagingPlantBlock({ name: "sweet_berry_bush", position: block.position });

  assert.equal(cleared, true);
  assert.equal(dug, true);
  assert.equal(success.action, "escape_hazard_block");
  assert.equal(success.details.target, "sweet_berry_bush");
});

test("clearDamagingPlantBlock still attempts clearable plants marked non-diggable", async () => {
  const controller = Object.create(SurvivalController.prototype);
  const block = { name: "sweet_berry_bush", position: new Vec3(0, 64, 0), diggable: false };
  let dug = false;
  controller.bot = {
    blockAt: () => block,
    lookAt: async () => {},
    dig: async () => {
      dug = true;
    }
  };
  controller.config = { survival: { actionTimeoutMs: 25000 } };
  controller.logger = { warn: () => {} };
  controller.withTimeout = async (promise) => promise;
  controller.resetMotion = () => {};
  controller.recordActionSuccess = () => {};
  controller.recordActionFailure = () => {};

  const cleared = await controller.clearDamagingPlantBlock({ name: "sweet_berry_bush", position: block.position });

  assert.equal(cleared, true);
  assert.equal(dug, true);
});

test("remembered starter shelter is not usable when the bot is far away", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.progressState = {
    hasStarterShelter: true,
    starterShelterPosition: { x: 0, y: 64, z: 0 }
  };
  controller.bot = {
    entity: {
      position: new Vec3(32, 64, 0)
    },
    blockAt: () => {
      throw new Error("far shelter structure should not be inspected");
    }
  };

  const status = controller.getStarterShelterStatus(controller.bot.entity.position);

  assert.equal(status.isNear, false);
  assert.equal(status.usable, false);
});