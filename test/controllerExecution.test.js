const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { PriorityTaskQueue } = require("../src/survival/priorityTaskQueue");
const { SurvivalController } = require("../src/survival/SurvivalController");

function createController(overrides = {}) {
  const controller = Object.create(SurvivalController.prototype);
  controller.config = {
    memory: { enabled: false, knownBlockSearchRadius: 96 },
    survival: {
      actionTimeoutMs: 1000,
      placeBlockTimeoutMs: 1000,
      threatRadius: 8,
      mineSearchRadius: 64,
      panicRetreatMs: 500
    }
  };
  controller.logger = {
    info() {},
    warn() {},
    debug() {}
  };
  controller.mcData = {
    blocksByName: { crafting_table: { id: 1 }, oak_log: { id: 2 } },
    itemsByName: { stick: { id: 10 }, crafting_table: { id: 11 } }
  };
  controller.memory = { knownBlocks: {}, learning: { events: [], avoidedPositions: [], policyStats: {} } };
  controller.progressState = {};
  controller.priorityTaskQueue = new PriorityTaskQueue({ allowedTasks: new Set(["explore", "escape_hazard", "collect_wood"]) });
  controller.testTaskQueue = new PriorityTaskQueue({ allowedTasks: new Set(["explore", "escape_hazard", "collect_wood"]) });
  controller.taskTrace = null;
  controller.taskTraceSequence = 0;
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.persistMemory = () => false;
  controller.wait = async () => {};
  controller.resetMotion = () => {};
  controller.recordActionSuccess = () => {};
  controller.recordActionFailure = () => {};
  controller.currentDimension = () => "overworld";
  Object.assign(controller, overrides);
  return controller;
}

test("hasCraftingTableAccess does not treat a far remembered table as immediate access", () => {
  const tablePosition = new Vec3(40, 64, 0);
  const controller = createController();
  controller.memory.knownBlocks.crafting_table = [{ position: tablePosition, dimension: "overworld" }];
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] },
    findBlock: () => null,
    blockAt: () => ({ name: "crafting_table" })
  };

  assert.equal(controller.hasCraftingTableAccess(), false);
});

test("hasCraftingTableAccess accepts a nearby remembered table only when it is still present", () => {
  const tablePosition = new Vec3(5, 64, 0);
  const controller = createController();
  controller.memory.knownBlocks.crafting_table = [{ position: tablePosition, dimension: "overworld" }];
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] },
    findBlock: () => null,
    blockAt: (position) => (position.x === tablePosition.x ? { name: "crafting_table" } : { name: "air" })
  };

  assert.equal(controller.hasCraftingTableAccess(), true);

  controller.bot.blockAt = () => ({ name: "air" });
  assert.equal(controller.hasCraftingTableAccess(), false);
});

test("movement policy opens doors and does not dig through buildings", () => {
  const controller = createController();
  controller.mcData = {
    blocksByName: {
      oak_door: { id: 30, name: "oak_door" },
      stone: { id: 1, name: "stone" }
    }
  };
  const movements = {
    blocksToAvoid: new Set(),
    blocksCantBreak: new Set(),
    interactableBlocks: new Set(),
    exclusionAreasStep: [],
    exclusionAreasBreak: [],
    exclusionAreasPlace: []
  };

  controller.configureMovementPolicy(movements);

  assert.equal(movements.canDig, false);
  assert.equal(movements.canOpenDoors, true);
  assert.equal(movements.allowSprinting, false);
  assert.equal(movements.allow1by1towers, false);
  assert.equal(movements.blocksCantBreak.has(30), true);
  assert.equal(movements.interactableBlocks.has("oak_door"), true);
});

test("manual emergency movement keeps normal walking speed", async () => {
  const controlStates = [];
  const controller = createController();
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    lookAt: async () => {},
    setControlState: (name, value) => controlStates.push({ name, value }),
    clearControlStates: () => controlStates.push({ name: "clear", value: true })
  };
  controller.nearestEntity = () => null;
  controller.findForwardSafeStandPosition = (() => {
    let calls = 0;
    return () => calls++ === 0;
  })();

  await controller.manualRetreatFrom({ name: "zombie", position: new Vec3(2, 64, 0) }, 50);

  assert.equal(controlStates.some((entry) => entry.name === "sprint" && entry.value === true), false);
  assert.equal(controlStates.some((entry) => entry.name === "forward" && entry.value === true), true);
});

test("manual emergency movement restores position when direct movement invalidates entity state", async () => {
  const controller = createController({
    wait: async () => {
      controller.bot.entity.position = { x: Number.NaN, y: 64, z: 0 };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    lookAt: async () => {},
    setControlState: () => {},
    clearControlStates: () => {}
  };
  controller.nearestEntity = () => null;
  controller.findForwardSafeStandPosition = () => true;

  const retreated = await controller.manualRetreatFrom({ name: "zombie", position: new Vec3(2, 64, 0) }, 50);

  assert.equal(retreated, false);
  assert.deepEqual(controller.bot.entity.position, new Vec3(0, 64, 0));
});

test("quick hazard retreat keeps normal walking speed", async () => {
  const controlStates = [];
  const controller = createController();
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    lookAt: async () => {},
    setControlState: (name, value) => controlStates.push({ name, value }),
    clearControlStates: () => controlStates.push({ name: "clear", value: true })
  };
  controller.findForwardSafeStandPosition = (() => {
    let calls = 0;
    return () => calls++ === 0;
  })();

  await controller.quickRetreatFromHazard({ name: "cactus", position: new Vec3(1, 64, 0) }, 50);

  assert.equal(controlStates.some((entry) => entry.name === "sprint" && entry.value === true), false);
  assert.equal(controlStates.some((entry) => entry.name === "forward" && entry.value === true), true);
});

test("task feedback replans a repeatedly failed night food task", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.hunt_food = {
    taskType: "hunt_food",
    reason: "no_food_source_found",
    failureCount: 2,
    recoveryTasks: ["explore"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };

  const decision = controller.selectDecisionWithTaskFeedback({ isNight: true, inventory: {} }, {
    type: "hunt_food",
    reason: "hunger is low and no food is available"
  });

  assert.equal(decision.type, "hold_position");
  assert.equal(decision.feedbackReplanned, true);
  assert.equal(decision.blockedTask, "hunt_food");
});

test("task feedback records repeated action failures as a blocked task", () => {
  const controller = createController();
  controller.currentDecisionType = "hunt_food";
  controller.bot = { entity: { position: new Vec3(0, 64, 0) } };
  controller.currentDimension = () => "overworld";

  controller.recordTaskFeedbackFailure("forage_food", "safe_position_unreachable", new Vec3(3, 80, 4), { target: "sweet_berry_bush" });
  controller.recordTaskFeedbackFailure("forage_food", "safe_position_unreachable", new Vec3(5, 80, 4), { target: "sweet_berry_bush" });
  controller.recordTaskFeedbackFailure("forage_food", "safe_position_unreachable", new Vec3(7, 80, 4), { target: "sweet_berry_bush" });

  const status = controller.getTaskFeedbackStatus();
  assert.equal(status.blockedTasks[0].taskType, "hunt_food");
  assert.equal(status.blockedTasks[0].failureCount, 3);
  assert.ok(status.blockedTasks[0].recoveryTasks.includes("explore"));
});

test("task feedback does not block a task from unrelated transient failure reasons", () => {
  const controller = createController();
  controller.currentDecisionType = "hunt_food";
  controller.bot = { entity: { position: new Vec3(0, 64, 0) } };

  controller.recordTaskFeedbackFailure("hunt_food", "target_unreachable", new Vec3(3, 64, 0), { target: "chicken" });
  controller.recordTaskFeedbackFailure("hunt_food", "target_gone", new Vec3(4, 64, 0), { target: "chicken" });
  controller.recordTaskFeedbackFailure("hunt_food", "no_food_source_found", new Vec3(5, 64, 0), { target: "food" });

  const status = controller.getTaskFeedbackStatus();
  assert.equal(status.recentFailures.length, 3);
  assert.equal(status.blockedTasks.length, 0);
});

test("task feedback recovery success clears the original blocked task", () => {
  const controller = createController();
  controller.taskFeedback.recentFailures = [
    { taskType: "collect_wood", action: "collect_wood", reason: "wood_inventory_not_increased", at: new Date().toISOString() },
    { taskType: "collect_wood", action: "collect_wood", reason: "wood_inventory_not_increased", at: new Date().toISOString() }
  ];
  controller.taskFeedback.blockedTasks.collect_wood = {
    taskType: "collect_wood",
    reason: "wood_inventory_not_increased",
    failureCount: 4,
    recoveryTasks: ["explore", "collect_stone"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };

  const cleared = controller.recordTaskFeedbackRecoverySuccess("collect_wood", "explore", { reason: "moved_to_new_area" });
  const status = controller.getTaskFeedbackStatus();

  assert.equal(cleared, true);
  assert.equal(status.blockedTasks.length, 0);
  assert.equal(status.recentFailures.some((event) => event.taskType === "collect_wood"), false);
  assert.equal(status.lastEvent.type, "recovery_success");
  assert.equal(status.lastEvent.recoveryTask, "explore");
});

test("task feedback success clears recent failures for completed task", () => {
  const controller = createController();
  controller.currentDecisionType = "collect_wood";
  controller.bot = { entity: { position: new Vec3(0, 64, 0) } };

  controller.recordTaskFeedbackFailure("collect_wood", "wood_inventory_not_increased", new Vec3(1, 64, 0));
  controller.recordTaskFeedbackFailure("collect_wood", "wood_inventory_not_increased", new Vec3(2, 64, 0));
  controller.recordTaskFeedbackFailure("collect_wood", "wood_inventory_not_increased", new Vec3(3, 64, 0));
  controller.recordTaskFeedbackFailure("collect_wood", "wood_inventory_not_increased", new Vec3(4, 64, 0));

  assert.equal(controller.getTaskFeedbackStatus().blockedTasks[0].taskType, "collect_wood");
  assert.deepEqual(controller.getTaskFeedbackStatus().blockedTasks[0].recoveryTasks, ["explore"]);

  controller.recordTaskFeedbackSuccess("collect_wood", { taskType: "collect_wood", target: "task_completed" });
  const status = controller.getTaskFeedbackStatus();

  assert.equal(status.blockedTasks.length, 0);
  assert.equal(status.recentFailures.some((event) => event.taskType === "collect_wood"), false);
  assert.equal(status.lastEvent.type, "success");
});

test("auxiliary movement failures can skip task feedback blocking", async () => {
  const controller = createController({
    ensureEmergencyShelterExit: async () => {},
    hasNearbyDoor: () => false
  });
  controller.currentDecisionType = "collect_wood";
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goto: async () => { throw new Error("No path to the goal!"); } }
  };

  const reached = await controller.gotoNear(10, 64, 0, 3, {
    label: "collect_wood_known_log",
    learnPosition: new Vec3(10, 64, 0),
    target: "known_log_area",
    taskFeedback: false
  });

  assert.equal(reached, false);
  assert.equal(controller.getTaskFeedbackStatus().recentFailures.length, 0);
  assert.equal(controller.getTaskFeedbackStatus().blockedTasks.length, 0);
});

test("wood recovery exploration skips local safe stands and moves to a distant target", async () => {
  const origin = new Vec3(0, 64, 0);
  const localStand = new Vec3(4, 64, 0);
  const distantTarget = new Vec3(18, 64, 0);
  let gotoTarget = null;
  const controller = createController({
    bot: {
      health: 20,
      food: 20,
      entity: { position: origin },
      blockAt: () => ({ name: "grass_block" }),
      time: { timeOfDay: 6000 }
    },
    isNight: () => false,
    shouldAbortCurrentAction: () => false,
    findNearbySafeStandPositions: () => [localStand],
    findSafeExplorationTarget: () => distantTarget,
    findNearbyDamagingBlock: () => null,
    gotoNear: async (x, y, z) => {
      gotoTarget = new Vec3(x, y, z);
      return true;
    },
    rememberExplorationTarget() {}
  });

  const moved = await controller.explore({ blockedTask: "collect_wood", reason: "no_reachable_logs" });

  assert.equal(moved, true);
  assert.deepEqual(gotoTarget, distantTarget);
});

test("task feedback replans blocked crafting table placement to nearby exploration", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.craft_basic_tools = {
    taskType: "craft_basic_tools",
    reason: "crafting_table_unavailable",
    failureCount: 2,
    recoveryTasks: ["collect_wood", "collect_stone", "explore"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };

  const decision = controller.selectDecisionWithTaskFeedback({ isNight: true, inventory: {} }, {
    type: "craft_basic_tools",
    reason: "nighttime local crafting can prepare tools without exploration"
  });

  assert.equal(decision.type, "explore");
  assert.equal(decision.allowNight, true);
  assert.equal(decision.feedbackReplanned, true);
  assert.equal(decision.blockedTask, "craft_basic_tools");
});

test("craftBasicTools records feedback when crafting table cannot be placed", async () => {
  let failure = null;
  let explored = false;
  const controller = createController({
    craftBasicSupplies: async () => {},
    hasCraftingTableAccess: () => true,
    ensurePlacedBlock: async () => null,
    explore: async () => {
      explored = true;
    },
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(2, 64, 3) },
    inventory: { items: () => [{ name: "oak_planks", count: 4 }, { name: "stick", count: 2 }] }
  };

  const crafted = await controller.craftBasicTools();

  assert.equal(crafted, false);
  assert.equal(explored, false);
  assert.equal(failure.action, "craft_basic_tools");
  assert.equal(failure.reason, "crafting_table_unavailable");
  assert.equal(failure.details.target, "crafting_table");
});

test("ensurePlacedBlock places a carried crafting table before chasing distant memory", async () => {
  let placed = false;
  let chasedKnownTable = false;
  const placedTable = { name: "crafting_table", position: new Vec3(1, 64, 0) };
  const controller = createController({
    findNearbyBlock: () => (placed ? placedTable : null),
    nearestKnownBlockEntry: () => ({ position: new Vec3(80, 64, 0), distance: 80, dimension: "overworld" }),
    gotoNear: async () => {
      chasedKnownTable = true;
      return true;
    },
    findPlacementReference: () => ({ block: { name: "grass_block", position: new Vec3(0, 63, 0) }, face: new Vec3(0, 1, 0) }),
    withTimeout: async (promise) => promise,
    rememberBlock: () => {}
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: "crafting_table", count: 1 }] },
    equip: async () => {},
    placeBlock: async () => {
      placed = true;
    }
  };

  const table = await controller.ensurePlacedBlock("crafting_table");

  assert.equal(table, placedTable);
  assert.equal(placed, true);
  assert.equal(chasedKnownTable, false);
});

test("craftFurnace records task feedback when a crafting table cannot be placed", async () => {
  let failure = null;
  let collectedStone = false;
  const controller = createController({
    craftBasicSupplies: async () => {},
    ensurePlacedBlock: async () => null,
    collectStone: async () => {
      collectedStone = true;
    },
    findNearbyBlock: () => null,
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(2, 64, 3) },
    inventory: { items: () => [{ name: "cobblestone", count: 8 }] }
  };

  const crafted = await controller.craftFurnace();

  assert.equal(crafted, false);
  assert.equal(collectedStone, false);
  assert.equal(failure.action, "craft_furnace");
  assert.equal(failure.reason, "crafting_table_unavailable");
  assert.equal(failure.details.target, "crafting_table");
});

test("low hunger blocks queued non-food tasks while food recovery is active", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.hunt_food = {
    taskType: "hunt_food",
    reason: "safe_position_unreachable",
    failureCount: 2,
    recoveryTasks: ["explore", "collect_wood"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };

  const snapshot = { food: 5, inventory: {} };

  assert.equal(controller.canUseQueuedTask("collect_wood", { type: "hunt_food" }, snapshot), false);
  assert.equal(controller.canUseQueuedTask("craft_basic_tools", { type: "hunt_food" }, snapshot), false);
  assert.equal(controller.canUseQueuedTask("explore", { type: "hunt_food" }, snapshot), true);
});

test("starvation recovery records feedback and explores instead of random evasion when no immediate food exists", async () => {
  let held = false;
  let explored = null;
  let failure = null;
  let foraged = false;
  const controller = createController({
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    forageNearbyFood: async (options) => {
      foraged = options.maxDistance === 10 && options.stopAfterFood === true;
      return false;
    },
    huntFood: async () => false,
    holdPositionSafely: async () => {
      held = true;
    },
    explore: async (decision) => {
      explored = decision;
      return false;
    },
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    health: 1,
    food: 0,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    inventory: { items: () => [] },
    clearControlStates: () => {},
    pathfinder: { setGoal: () => {} },
    pvp: { stop: () => {} }
  };

  const recovered = await controller.recoverFromStarvation();

  assert.equal(recovered, false);
  assert.equal(foraged, true);
  assert.equal(held, false);
  assert.equal(explored.blockedTask, "hunt_food");
  assert.equal(explored.ruleDecision, "recover_starvation");
  assert.equal(explored.allowNight, false);
  assert.equal(failure.action, "recover_starvation");
  assert.equal(failure.reason, "no_immediate_safe_food");
});

test("critical starvation recovery holds at night when no immediate food exists", async () => {
  let held = false;
  let explored = false;
  const controller = createController({
    isNight: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    forageNearbyFood: async () => false,
    holdPositionSafely: async () => {
      held = true;
    },
    explore: async () => {
      explored = true;
      return true;
    },
    recordActionFailure: () => {}
  });
  controller.bot = {
    health: 1,
    food: 0,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    inventory: { items: () => [] },
    clearControlStates: () => {},
    pathfinder: { setGoal: () => {} },
    pvp: { stop: () => {} }
  };

  const recovered = await controller.recoverFromStarvation();

  assert.equal(recovered, false);
  assert.equal(held, true);
  assert.equal(explored, false);
});

test("starvation recovery tries hunt_food before explore when not blocked", async () => {
  let huntCalled = false;
  let explored = false;
  let ate = false;
  const controller = createController({
    isNight: () => false,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    forageNearbyFood: async () => false,
    huntFood: async () => { huntCalled = true; return true; },
    eatFood: async () => { ate = true; return true; },
    explore: async () => { explored = true; return true; },
    recordActionFailure: () => {},
    isTaskFeedbackBlocked: (t) => t !== "hunt_food"
  });
  // inventory is empty until huntFood is called (then returns raw chicken to simulate drop)
  controller.bot = {
    health: 4,
    food: 0,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    inventory: { items: () => (huntCalled ? [{ name: "chicken", count: 1 }] : []) },
    clearControlStates: () => {},
    pathfinder: { setGoal: () => {} },
    pvp: { stop: () => {} }
  };

  const recovered = await controller.recoverFromStarvation();

  assert.equal(huntCalled, true, "should attempt huntFood before explore");
  assert.equal(explored, false, "should not explore when hunt yields food");
  assert.equal(ate, true, "should eat after successful hunt");
  assert.equal(recovered, true);
});

test("starvation recovery falls through to explore when hunt_food is blocked", async () => {
  let huntCalled = false;
  let explored = false;
  const controller = createController({
    isNight: () => false,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    forageNearbyFood: async () => false,
    huntFood: async () => { huntCalled = true; return false; },
    explore: async () => { explored = true; return true; },
    recordActionFailure: () => {},
    isTaskFeedbackBlocked: () => true
  });
  controller.bot = {
    health: 4,
    food: 0,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    inventory: { items: () => [] },
    clearControlStates: () => {},
    pathfinder: { setGoal: () => {} },
    pvp: { stop: () => {} }
  };

  await controller.recoverFromStarvation();

  assert.equal(huntCalled, false, "should skip huntFood when hunt_food is blocked");
  assert.equal(explored, true, "should fall through to explore");
});

test("food recovery explore can run at night when starvation recovery allows it", async () => {
  let held = false;
  let gotoOptions = null;
  const controller = createController({
    isNight: () => true,
    holdPositionSafely: async () => {
      held = true;
    },
    findSafeExplorationTarget: () => new Vec3(8, 64, 0),
    gotoNear: async (_x, _y, _z, _range, options) => {
      gotoOptions = options;
      return true;
    },
    rememberExplorationTarget: () => {},
    isTaskFeedbackBlocked: () => false
  });
  controller.bot = {
    food: 17,
    entity: { position: new Vec3(0, 64, 0) }
  };

  const reached = await controller.explore({
    reason: "recover_starvation food recovery",
    ruleDecision: "recover_starvation",
    allowNight: true
  });

  assert.equal(reached, true);
  assert.equal(held, false);
  assert.equal(gotoOptions.label, "food_recovery_explore");
  assert.equal(gotoOptions.target, "food_recovery");
});

test("starvation advisory planning passes force through to the LLM planner", () => {
  let shouldRunOptions = null;
  let plannedInput = null;
  let skipped = false;
  const controller = createController({
    llmPlanner: {
      shouldRun: (_now, options) => {
        shouldRunOptions = options;
        return true;
      },
      noteSkipped: () => {
        skipped = true;
      },
      runDryPlan: (input) => {
        plannedInput = input;
        return Promise.resolve(null);
      }
    }
  });

  controller.maybeStartPlannerDryRun({
    snapshot: { health: 1, environmentHazard: null, navigationTrap: false, isInLava: false, entities: [] },
    decision: { type: "recover_starvation", reason: "critical hunger" },
    force: true
  });

  assert.equal(shouldRunOptions.force, true);
  assert.equal(skipped, false);
  assert.equal(plannedInput.decision.type, "recover_starvation");
});

test("waitOutNight returns to remembered starter shelter before building emergency shelter", async () => {
  let returnedHome = false;
  let builtEmergencyShelter = false;
  let heldPosition = false;
  let usableChecks = 0;
  const controller = createController({
    hasUsableStarterShelterAt: () => usableChecks++ > 0,
    returnToStarterShelterForNight: async () => {
      returnedHome = true;
      return true;
    },
    buildSimpleShelter: async () => {
      builtEmergencyShelter = true;
    },
    holdPositionSafely: async () => {
      heldPosition = true;
    }
  });
  controller.progressState = {
    hasStarterShelter: true,
    starterShelterPosition: { x: 10, y: 64, z: 0 }
  };
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    time: { timeOfDay: 18000 }
  };

  await controller.waitOutNight();

  assert.equal(returnedHome, true);
  assert.equal(builtEmergencyShelter, false);
  assert.equal(heldPosition, true);
});

test("waitOutNight builds emergency shelter when remembered starter shelter cannot be reached", async () => {
  let builtEmergencyShelter = false;
  const controller = createController({
    hasUsableStarterShelterAt: () => false,
    returnToStarterShelterForNight: async () => false,
    buildSimpleShelter: async () => {
      builtEmergencyShelter = true;
    },
    holdPositionSafely: async () => {}
  });
  controller.progressState = {
    hasStarterShelter: true,
    starterShelterPosition: { x: 10, y: 64, z: 0 }
  };
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    time: { timeOfDay: 18000 }
  };

  await controller.waitOutNight();

  assert.equal(builtEmergencyShelter, true);
});

test("returnToStarterShelterForNight navigates to the remembered base and fortifies it", async () => {
  let gotoCall = null;
  let fortified = false;
  const base = new Vec3(12, 64, -4);
  const controller = createController({
    nearestEntity: () => null,
    getStarterShelterStatus: (position) => {
      const distance = position.distanceTo(base);
      return {
        hasMemory: true,
        isNear: distance <= 2,
        defensible: distance <= 2,
        usable: distance <= 2,
        distance
      };
    },
    gotoNear: async (x, y, z, range, options) => {
      gotoCall = { x, y, z, range, options };
      controller.bot.entity.position = new Vec3(x, y, z);
      return true;
    },
    fortifyStarterShelterForNight: async () => {
      fortified = true;
      return true;
    }
  });
  controller.progressState = {
    hasStarterShelter: true,
    starterShelterPosition: { x: base.x, y: base.y, z: base.z }
  };
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const returned = await controller.returnToStarterShelterForNight();

  assert.equal(returned, true);
  assert.deepEqual({ x: gotoCall.x, y: gotoCall.y, z: gotoCall.z, range: gotoCall.range }, { x: base.x, y: base.y, z: base.z, range: 2 });
  assert.equal(gotoCall.options.label, "return_starter_shelter");
  assert.equal(gotoCall.options.target, "starter_shelter");
  assert.equal(fortified, true);
});

test("returnToStarterShelterForNight skips remembered shelters that are too far at night", async () => {
  let gotoCalled = false;
  const base = new Vec3(220, 64, 0);
  const controller = createController({
    nearestEntity: () => null,
    gotoNear: async () => {
      gotoCalled = true;
      return true;
    }
  });
  controller.config.survival.nightShelterReturnMaxDistance = 96;
  controller.progressState = {
    hasStarterShelter: true,
    starterShelterPosition: { x: base.x, y: base.y, z: base.z }
  };
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const returned = await controller.returnToStarterShelterForNight();

  assert.equal(returned, false);
  assert.equal(gotoCalled, false);
});

test("invalid position recovery restores the last valid position instead of quitting", async () => {
  let quitCalled = false;
  let pausedForMs = 0;
  let failure = null;
  let resetCount = 0;
  const controller = createController({
    pausedUntil: 0,
    invalidPositionTicks: 2,
    lastAction: { type: "evade_hostiles" },
    lastValidPosition: new Vec3(1, 64, 1),
    resetMotion: () => {
      resetCount++;
    },
    pause: (milliseconds) => {
      pausedForMs = milliseconds;
    },
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    entity: { position: { x: Number.NaN, y: 64, z: 0 } },
    quit: () => {
      quitCalled = true;
    }
  };

  await controller.tick();

  assert.equal(quitCalled, false);
  assert.equal(resetCount, 1);
  assert.equal(controller.invalidPositionTicks, 0);
  assert.equal(pausedForMs, 1000);
  assert.equal(failure, null);
  assert.deepEqual(controller.bot.entity.position, new Vec3(1, 64, 1));
});

test("invalid position recovery pauses without task feedback when no restore point exists", async () => {
  let quitCalled = false;
  let pausedForMs = 0;
  let failure = null;
  const controller = createController({
    pausedUntil: 0,
    invalidPositionTicks: 2,
    lastAction: { type: "hold_position" },
    lastValidPosition: null,
    pause: (milliseconds) => {
      pausedForMs = milliseconds;
    },
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    entity: { position: { x: Number.NaN, y: 64, z: 0 } },
    quit: () => {
      quitCalled = true;
    }
  };

  await controller.tick();

  assert.equal(quitCalled, false);
  assert.equal(controller.invalidPositionTicks, 0);
  assert.equal(pausedForMs, 15000);
  assert.equal(failure.action, "position_recovery");
  assert.equal(failure.reason, "invalid_position");
  assert.equal(failure.details.target, "hold_position");
  assert.equal(failure.details.taskFeedback, false);
});

test("door blocks are treated as passable shelter doorway space", () => {
  const base = new Vec3(0, 64, 0);
  const blocks = new Map([
    ["0,64,0", { name: "oak_door", position: base, boundingBox: "block" }],
    ["0,65,0", { name: "air", position: base.offset(0, 1, 0), boundingBox: "empty" }],
    ["0,63,0", { name: "spruce_planks", position: base.offset(0, -1, 0), boundingBox: "block" }]
  ]);
  const controller = createController();
  controller.bot = {
    blockAt: (position) => blocks.get(`${position.x},${position.y},${position.z}`) ?? { name: "air", position, boundingBox: "empty" }
  };

  assert.equal(controller.isSafeStandPosition(base), true);
});

test("starter shelter status requires house utilities instead of only a sealed shell", () => {
  const base = new Vec3(0, 64, 0);
  const controller = createController();
  const shellKeys = new Set(controller.createStarterShelterPlan(base).map((position) => `${position.x},${position.y},${position.z}`));
  const doorKeys = new Set(["0,64,-3", "0,65,-3", "1,64,-3", "1,65,-3"]);
  const utilityBlocks = new Map();
  controller.progressState = {
    hasStarterShelter: true,
    starterShelterPosition: { x: base.x, y: base.y, z: base.z }
  };
  controller.bot = {
    entity: { position: base.clone() },
    blockAt: (position) => {
      const key = `${position.x},${position.y},${position.z}`;
      if (utilityBlocks.has(key)) return { name: utilityBlocks.get(key), position, boundingBox: "block" };
      if (doorKeys.has(key)) return { name: "oak_door", position, boundingBox: "block" };
      if (shellKeys.has(key)) return { name: "spruce_planks", position, boundingBox: "block" };
      if (position.y === 63) return { name: "grass_block", position, boundingBox: "block" };
      return { name: "air", position, boundingBox: "empty" };
    }
  };

  assert.equal(controller.getStarterShelterStatus(base).usable, false);

  const utilities = controller.starterShelterUtilityPlan(base);
  utilityBlocks.set(`${utilities.craftingTable.x},${utilities.craftingTable.y},${utilities.craftingTable.z}`, "crafting_table");
  utilityBlocks.set(`${utilities.furnace.x},${utilities.furnace.y},${utilities.furnace.z}`, "furnace");
  utilityBlocks.set(`${utilities.chest.x},${utilities.chest.y},${utilities.chest.z}`, "chest");

  assert.equal(controller.getStarterShelterStatus(base).usable, true);
});

test("starter shelter surface site rejects covered underground spaces", () => {
  const controller = createController();
  const coveredBase = new Vec3(0, 50, 0);
  const surfaceBase = new Vec3(0, 64, 0);
  controller.bot = {
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (blockPosition.y === 49 || blockPosition.y === 63) return { name: "grass_block", position: blockPosition, boundingBox: "block" };
      if (blockPosition.y === 55) return { name: "stone", position: blockPosition, boundingBox: "block" };
      return { name: "air", position: blockPosition, boundingBox: "empty" };
    }
  };

  assert.equal(controller.isStarterShelterSurfaceBuildSite(coveredBase), false);
  assert.equal(controller.isStarterShelterSurfaceBuildSite(surfaceBase), true);
});

test("platform descent edge is selected from the current platform, not water center height", () => {
  const controller = createController();
  const blockAt = (position) => {
    const blockPosition = position.floored();
    const onPlatform = blockPosition.y === 63 && Math.abs(blockPosition.x) <= 2 && Math.abs(blockPosition.z) <= 2;
    if (onPlatform) return { name: "stone", position: blockPosition, boundingBox: "block", diggable: true };
    if (blockPosition.x === 7 && blockPosition.y === 40 && blockPosition.z === 0) return { name: "water", position: blockPosition, boundingBox: "empty", diggable: false };
    return { name: "air", position: blockPosition, boundingBox: "empty", diggable: false };
  };
  controller.bot = { blockAt };

  const edge = controller.findPlatformDescentEdge(new Vec3(0, 64, 0), new Vec3(7, 40, 0));

  assert.ok(edge);
  assert.equal(edge.stand.x, 2);
  assert.equal(edge.drop.x, 3);
  assert.equal(edge.stepTarget.x, 7);
  assert.equal(edge.targetHorizontalDistance, 4);
});

test("platform descent edge skips supported platform interior cells", () => {
  const controller = createController();
  const blockAt = (position) => {
    const blockPosition = position.floored();
    const platformGround = blockPosition.y === 63 && blockPosition.x >= -1 && blockPosition.x <= 1 && blockPosition.z === 0;
    if (platformGround) return { name: "stone", position: blockPosition, boundingBox: "block", diggable: true };
    if (blockPosition.x === 3 && blockPosition.y === 40 && blockPosition.z === 0) return { name: "water", position: blockPosition, boundingBox: "empty", diggable: false };
    return { name: "air", position: blockPosition, boundingBox: "empty", diggable: false };
  };
  controller.bot = { blockAt };

  const edge = controller.findPlatformDescentEdge(new Vec3(0, 64, 0), new Vec3(3, 40, 0));

  assert.ok(edge);
  assert.equal(edge.stand.x, 1);
  assert.equal(edge.drop.x, 2);
});

test("platform descent snapshot does not request descent without a real edge", () => {
  const controller = createController();
  const blockAt = (position) => {
    const blockPosition = position.floored();
    const supportedPlatform = blockPosition.y === 63 && Math.abs(blockPosition.x) <= 10 && Math.abs(blockPosition.z) <= 10;
    if (supportedPlatform) return { name: "stone", position: blockPosition, boundingBox: "block", diggable: true };
    if (blockPosition.x === 3 && blockPosition.y === 40 && blockPosition.z === 0) return { name: "water", position: blockPosition, boundingBox: "empty", diggable: false };
    return { name: "air", position: blockPosition, boundingBox: "empty", diggable: false };
  };
  controller.bot = { blockAt };

  const descent = controller.buildPlatformDescentSnapshot(new Vec3(0, 64, 0), null, { waterCount: 0 });

  assert.equal(descent.bestTarget, null);
  assert.equal(descent.needsDescent, false);
  assert.equal(descent.bestEdge, null);
  assert.equal(descent.summary, null);
});

test("water descent targets do not scan through solid blocks", () => {
  const controller = createController();
  controller.bot = {
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (blockPosition.x === 0 && blockPosition.z === 0 && blockPosition.y === 63) return { name: "stone", position: blockPosition, boundingBox: "block" };
      if (blockPosition.x === 0 && blockPosition.z === 0 && blockPosition.y === 40) return { name: "water", position: blockPosition, boundingBox: "empty" };
      return { name: "air", position: blockPosition, boundingBox: "empty" };
    }
  };

  assert.deepEqual(controller.findWaterDescentTargets(new Vec3(0, 64, 0), 0, 40), []);
  assert.equal(controller.findWaterLandingBelow(new Vec3(0, 64, 0), 40), null);
});

test("water with oxygen buffer is not treated as a pit or low oxygen emergency", () => {
  const controller = createController();
  controller.bot = {
    oxygenLevel: 10,
    entity: { position: new Vec3(0, 60, 0) },
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (blockPosition.x === 0 && blockPosition.z === 0 && (blockPosition.y === 60 || blockPosition.y === 61)) return { name: "water", position: blockPosition, boundingBox: "empty" };
      if (blockPosition.y <= 59) return { name: "sand", position: blockPosition, boundingBox: "block", diggable: true };
      return { name: "air", position: blockPosition, boundingBox: "empty" };
    }
  };

  assert.equal(controller.shouldEscapeForLowOxygen(new Vec3(0, 60, 0), 8), false);
  const analysis = controller.analyzeNavigationSituation(new Vec3(0, 60, 0));
  assert.equal(analysis.trapped, false);
  assert.equal(analysis.kind, "water_column");
  assert.equal(analysis.recommendedAction, "swim_or_find_shore");

  controller.bot.oxygenLevel = 8;
  assert.equal(controller.shouldEscapeForLowOxygen(new Vec3(0, 60, 0), 8), true);
});

test("low oxygen under ice digs an overhead breathing hole", async () => {
  const controller = createController();
  let iceBroken = false;
  let dugPosition = null;
  const swimTargets = [];
  controller.digBlockAt = async (position) => {
    dugPosition = position;
    iceBroken = true;
    return true;
  };
  controller.swimTowardAir = async (options) => {
    swimTargets.push(options.targetPosition);
    controller.bot.entity.position = new Vec3(0, 64, 0);
    return true;
  };
  controller.bot = {
    oxygenLevel: 6,
    entity: { position: new Vec3(0, 60, 0) },
    pvp: { stop() {} },
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (!iceBroken && blockPosition.y === 63) return { name: "ice", position: blockPosition, boundingBox: "block", diggable: true };
      if (blockPosition.y >= 60 && blockPosition.y <= 62) return { name: "water", position: blockPosition, boundingBox: "empty" };
      return { name: "air", position: blockPosition, boundingBox: "empty", diggable: false };
    }
  };

  const escaped = await controller.escapeLowOxygen({ reason: "test_under_ice" });

  assert.equal(escaped, true);
  assert.deepEqual(dugPosition, new Vec3(0, 63, 0));
  assert.deepEqual(swimTargets.at(-1), new Vec3(0, 64, 0));
});

test("explore exits water before applying normal night hold", async () => {
  const controller = createController();
  let gotoLabel = null;
  let heldAtNight = false;
  controller.isNight = () => true;
  controller.holdPositionSafely = async () => {
    heldAtNight = true;
    return false;
  };
  controller.gotoNear = async (x, y, z, range, options) => {
    gotoLabel = options.label;
    controller.bot.entity.position = new Vec3(x, y, z);
    return true;
  };
  controller.bot = {
    oxygenLevel: 12,
    health: 20,
    food: 20,
    entity: { position: new Vec3(0, 60, 0) },
    lookAt: async () => {},
    setControlState: () => {},
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (blockPosition.x === 0 && blockPosition.z === 0 && (blockPosition.y === 60 || blockPosition.y === 61)) return { name: "water", position: blockPosition, boundingBox: "empty" };
      if (blockPosition.x === 1 && blockPosition.z === 0 && blockPosition.y === 60) return { name: "dirt", position: blockPosition, boundingBox: "block", diggable: true };
      if (blockPosition.y <= 59) return { name: "sand", position: blockPosition, boundingBox: "block", diggable: true };
      return { name: "air", position: blockPosition, boundingBox: "empty" };
    }
  };

  const moved = await controller.explore({ type: "explore" });

  assert.equal(moved, true);
  assert.equal(gotoLabel, "explore_water_exit");
  assert.equal(heldAtNight, false);
});

test("evade hostiles exits water before land retreat logic", async () => {
  const controller = createController();
  let waterExitLabel = null;
  let evaded = false;
  controller.leaveWaterForTask = async (taskType, options) => {
    waterExitLabel = { taskType, options };
    return true;
  };
  controller.evadeHostiles = async () => {
    evaded = true;
    return true;
  };
  controller.bot = {
    oxygenLevel: 12,
    entity: { position: new Vec3(0, 60, 0) },
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (blockPosition.y === 60 || blockPosition.y === 61) return { name: "water", position: blockPosition, boundingBox: "empty" };
      return { name: "air", position: blockPosition, boundingBox: "empty" };
    }
  };

  const result = await controller.executePrimitive({ type: "evade_hostiles" });

  assert.equal(result, true);
  assert.equal(waterExitLabel.taskType, "evade_hostiles");
  assert.equal(evaded, false);
});

test("normal tasks descend from platform before executing", async () => {
  const controller = createController();
  let descended = false;
  let collectedWood = false;
  controller.bot = {
    entity: { position: new Vec3(0, 80, 0) },
    blockAt: () => ({ name: "air", boundingBox: "empty" })
  };
  controller.buildPlatformDescentSnapshot = () => ({
    needsDescent: true,
    summary: "elevated platform: water landing 19 blocks below",
    bestTarget: {
      entryPosition: { x: 0, y: 62, z: 0 },
      waterPosition: { x: 0, y: 61, z: 0 }
    }
  });
  controller.descendFromPlatform = async (decision) => {
    descended = decision.targetPosition;
    return true;
  };
  controller.collectWood = async () => {
    collectedWood = true;
    return true;
  };

  const result = await controller.executePrimitive({ type: "collect_wood" });

  assert.equal(result, true);
  assert.deepEqual(descended, { x: 0, y: 62, z: 0 });
  assert.equal(collectedWood, false);
});

test("water exit failure prevents dry task body from running underwater", async () => {
  const controller = createController();
  let collectedWood = false;
  controller.leaveWaterForTask = async () => false;
  controller.collectWood = async () => {
    collectedWood = true;
    return true;
  };
  controller.bot = {
    oxygenLevel: 12,
    entity: { position: new Vec3(0, 60, 0) },
    blockAt: (position) => {
      const blockPosition = position.floored();
      if (blockPosition.y === 60 || blockPosition.y === 61) return { name: "water", position: blockPosition, boundingBox: "empty" };
      return { name: "air", position: blockPosition, boundingBox: "empty" };
    }
  };

  const result = await controller.executePrimitive({ type: "collect_wood" });

  assert.equal(result, false);
  assert.equal(collectedWood, false);
});

test("log mining clears non-axe held items before chopping by hand", async () => {
  const controller = createController();
  let unequipped = false;
  controller.bot = {
    heldItem: { name: "oak_planks" },
    inventory: { items: () => [] },
    unequip: async (slot) => {
      if (slot === "hand") unequipped = true;
    }
  };

  await controller.equipToolForBlock({ name: "oak_log" });

  assert.equal(unequipped, true);
});

test("platform descent step walks horizontally until the bot leaves the stand block", async () => {
  const controller = createController();
  const edge = { drop: new Vec3(1, 64, 0) };
  const controls = [];
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    lookAt: async () => {},
    setControlState: (name, value) => {
      controls.push([name, value]);
      if (name === "forward" && value) controller.bot.entity.position = new Vec3(1.2, 63.4, 0);
    }
  };
  controller.resetMotion = () => {};
  controller.wait = async () => {};
  controller.isSafeStandPosition = (position) => position.x === 0 && position.y === 64 && position.z === 0;

  const steppedOff = await controller.stepOffPlatformTowardDescent(edge, new Vec3(4, 40, 0), 300);

  assert.equal(steppedOff, true);
  assert.ok(controls.some(([name, value]) => name === "forward" && value === true));
  assert.ok(controls.some(([name, value]) => name === "forward" && value === false));
});

test("platform descent step does not succeed while still short of the drop cell", async () => {
  const controller = createController();
  const edge = { stand: new Vec3(0, 64, 0), drop: new Vec3(1, 64, 0) };
  controller.bot = {
    entity: { position: new Vec3(0.2, 64, 0) },
    lookAt: async () => {},
    setControlState: () => {}
  };
  controller.resetMotion = () => {};
  controller.wait = async () => {};
  let warning = "";
  controller.logger.warn = (message) => { warning = message; };

  const steppedOff = await controller.stepOffPlatformTowardDescent(edge, new Vec3(4, 40, 0), 1);

  assert.equal(steppedOff, false);
  assert.match(warning, /platform_step_off/);
});

test("digBlockAt refuses to break doors", async () => {
  let dug = false;
  const controller = createController();
  controller.bot = {
    blockAt: (position) => ({ name: "oak_door", position, boundingBox: "block", diggable: true }),
    dig: async () => {
      dug = true;
    }
  };

  const result = await controller.digBlockAt(new Vec3(1, 64, 0));

  assert.equal(result, false);
  assert.equal(dug, false);
});

test("installStarterShelterDoor replaces a sealed doorway with an actual door", async () => {
  const base = new Vec3(10, 70, 10);
  const lowerLeft = base.offset(0, 0, -3);
  const upperLeft = base.offset(0, 1, -3);
  const lowerRight = base.offset(1, 0, -3);
  const upperRight = base.offset(1, 1, -3);
  const sealed = new Set([
    `${lowerLeft.x},${lowerLeft.y},${lowerLeft.z}`,
    `${upperLeft.x},${upperLeft.y},${upperLeft.z}`,
    `${lowerRight.x},${lowerRight.y},${lowerRight.z}`,
    `${upperRight.x},${upperRight.y},${upperRight.z}`
  ]);
  const doorPlaced = new Set();
  const cleared = [];
  const controller = createController({
    craftDoor: async () => true,
    digBlockAt: async (position) => {
      cleared.push(`${position.x},${position.y},${position.z}`);
      sealed.delete(`${position.x},${position.y},${position.z}`);
      return true;
    },
    withTimeout: async (promise) => promise
  });
  controller.bot = {
    inventory: { items: () => [{ name: "oak_door", count: 1 }] },
    equip: async () => {},
    placeBlock: async (floor) => {
      const lower = floor.position.offset(0, 1, 0);
      doorPlaced.add(`${lower.x},${lower.y},${lower.z}`);
      doorPlaced.add(`${lower.x},${lower.y + 1},${lower.z}`);
    },
    blockAt: (position) => {
      const key = `${position.x},${position.y},${position.z}`;
      if (doorPlaced.has(key)) {
        return { name: "oak_door", position, boundingBox: "block" };
      }
      if (sealed.has(key)) return { name: "spruce_planks", position, boundingBox: "block", diggable: true };
      if (key === `${lowerLeft.x},${lowerLeft.y - 1},${lowerLeft.z}` || key === `${lowerRight.x},${lowerRight.y - 1},${lowerRight.z}`) return { name: "spruce_planks", position, boundingBox: "block" };
      return { name: "air", position, boundingBox: "empty" };
    }
  };

  assert.equal(controller.isStarterShelterDoorInstalled(base), false);
  assert.equal(controller.isStarterShelterDoorwayDefensible(base), true);

  const installed = await controller.installStarterShelterDoor(base);

  assert.equal(installed, true);
  assert.equal(doorPlaced.size, 4);
  assert.deepEqual(cleared, [
    `${lowerLeft.x},${lowerLeft.y},${lowerLeft.z}`,
    `${upperLeft.x},${upperLeft.y},${upperLeft.z}`,
    `${lowerRight.x},${lowerRight.y},${lowerRight.z}`,
    `${upperRight.x},${upperRight.y},${upperRight.z}`
  ]);
  assert.equal(controller.isStarterShelterDoorInstalled(base), true);
});

test("buildSimpleShelter tries to install an emergency door after enclosing the shelter", async () => {
  const base = new Vec3(0, 64, 0);
  let doorBase = null;
  const controller = createController({
    placeBuildingBlockAt: async () => ({ completed: true, placed: true }),
    installEmergencyShelterDoor: async (position) => {
      doorBase = position;
      return true;
    }
  });
  controller.bot = {
    entity: { position: base },
    inventory: { items: () => [{ name: "dirt", count: 64 }] },
    equip: async () => {},
    blockAt: (position) => ({ name: "air", position, boundingBox: "empty" })
  };

  const built = await controller.buildSimpleShelter();

  assert.equal(built, true);
  assert.deepEqual(doorBase, base);
});

test("ensureEmergencyShelterExit creates a fixed doorway in old sealed emergency shelters during daylight", async () => {
  const base = new Vec3(0, 64, 0);
  const shellKeys = new Set(controllerShellKeys(base));
  const dug = [];
  const controller = createController({
    installEmergencyShelterDoor: async () => false,
    isNight: () => false,
    nearestEntity: () => null,
    digBlockAt: async (position) => {
      dug.push(`${position.x},${position.y},${position.z}`);
      return true;
    }
  });
  controller.bot = {
    entity: { position: base },
    activateBlock: async () => {
      throw new Error("door opening should not be used when no door is installed");
    },
    blockAt: (position) => {
      const key = `${position.x},${position.y},${position.z}`;
      if (shellKeys.has(key)) return { name: "spruce_planks", position, boundingBox: "block", diggable: true };
      if (position.y === 63) return { name: "grass_block", position, boundingBox: "block" };
      return { name: "air", position, boundingBox: "empty" };
    }
  };

  const opened = await controller.ensureEmergencyShelterExit();

  assert.equal(opened, true);
  assert.deepEqual(dug, ["0,64,-1", "0,65,-1"]);
});

test("ensureEmergencyShelterExit opens only an installed emergency shelter door", async () => {
  const base = new Vec3(0, 64, 0);
  const lower = base.offset(0, 0, -1);
  const upper = base.offset(0, 1, -1);
  const shellKeys = new Set(controllerShellKeys(base));
  const lowerDoor = { name: "oak_door", position: lower, boundingBox: "block", getProperties: () => ({ open: false, half: "lower" }) };
  const upperDoor = { name: "oak_door", position: upper, boundingBox: "block", getProperties: () => ({ open: false, half: "upper" }) };
  const activated = [];
  let dug = false;
  let movedThroughDoorway = false;
  const controller = createController({
    isNight: () => false,
    digBlockAt: async () => {
      dug = true;
      return true;
    },
    moveThroughEmergencyShelterDoorway: async () => {
      movedThroughDoorway = true;
      return true;
    }
  });
  controller.bot = {
    entity: { position: base },
    lookAt: async () => {},
    activateBlock: async (block) => {
      activated.push(block);
    },
    blockAt: (position) => {
      if (position.x === lower.x && position.y === lower.y && position.z === lower.z) return lowerDoor;
      if (position.x === upper.x && position.y === upper.y && position.z === upper.z) return upperDoor;
      const key = `${position.x},${position.y},${position.z}`;
      if (shellKeys.has(key)) return { name: "spruce_planks", position, boundingBox: "block", diggable: true };
      if (position.y === 63) return { name: "grass_block", position, boundingBox: "block" };
      return { name: "air", position, boundingBox: "empty" };
    }
  };

  const exited = await controller.ensureEmergencyShelterExit();

  assert.equal(exited, true);
  assert.deepEqual(activated, [lowerDoor]);
  assert.equal(dug, false);
  assert.equal(movedThroughDoorway, true);
});

function controllerShellKeys(base) {
  const positions = [];
  const cardinalOffsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1)
  ];
  const diagonalOffsets = [
    new Vec3(1, 0, 1),
    new Vec3(1, 0, -1),
    new Vec3(-1, 0, 1),
    new Vec3(-1, 0, -1)
  ];
  for (const offset of cardinalOffsets) positions.push(base.plus(offset));
  for (const offset of cardinalOffsets) positions.push(base.plus(offset).offset(0, 1, 0));
  for (const offset of cardinalOffsets) positions.push(base.plus(offset).offset(0, 2, 0));
  positions.push(base.offset(0, 2, 0));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset).offset(0, 1, 0));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset).offset(0, 2, 0));
  return positions.map((position) => `${position.x},${position.y},${position.z}`);
}

test("openNearbyDoors activates the lower half of a closed door once", async () => {
  const lower = new Vec3(1, 64, 0);
  const upper = lower.offset(0, 1, 0);
  const lowerDoor = { name: "oak_door", position: lower, boundingBox: "block", getProperties: () => ({ open: false, half: "lower" }) };
  const upperDoor = { name: "oak_door", position: upper, boundingBox: "block", getProperties: () => ({ open: false, half: "upper" }) };
  const activated = [];
  const controller = createController();
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    lookAt: async () => {},
    activateBlock: async (block) => {
      activated.push(block);
    },
    blockAt: (position) => {
      if (position.x === lower.x && position.y === lower.y && position.z === lower.z) return lowerDoor;
      if (position.x === upper.x && position.y === upper.y && position.z === upper.z) return upperDoor;
      return { name: "air", position, boundingBox: "empty" };
    }
  };

  const opened = await controller.openNearbyDoors(2);

  assert.equal(opened, true);
  assert.deepEqual(activated, [lowerDoor]);
});

test("openNearbyDoors passes through an opened door toward the movement target", async () => {
  const lower = new Vec3(1, 64, 0);
  const upper = lower.offset(0, 1, 0);
  const targetPosition = new Vec3(4, 64, 0);
  const lowerDoor = { name: "oak_door", position: lower, boundingBox: "block", getProperties: () => ({ open: false, half: "lower" }) };
  const upperDoor = { name: "oak_door", position: upper, boundingBox: "block", getProperties: () => ({ open: false, half: "upper" }) };
  const activated = [];
  let passThroughCall = null;
  const controller = createController({
    passThroughDoor: async (block, target) => {
      passThroughCall = { block, target };
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    lookAt: async () => {},
    activateBlock: async (block) => {
      activated.push(block);
    },
    blockAt: (position) => {
      if (position.x === lower.x && position.y === lower.y && position.z === lower.z) return lowerDoor;
      if (position.x === upper.x && position.y === upper.y && position.z === upper.z) return upperDoor;
      return { name: "air", position, boundingBox: "empty" };
    }
  };

  const opened = await controller.openNearbyDoors(2, { passThrough: true, targetPosition });

  assert.equal(opened, true);
  assert.deepEqual(activated, [lowerDoor]);
  assert.equal(passThroughCall.block, lowerDoor);
  assert.deepEqual(passThroughCall.target, targetPosition);
});

test("bestDoorPassThroughTarget chooses the safe side closest to the movement target", () => {
  const lower = new Vec3(1, 64, 0);
  const lowerDoor = { name: "oak_door", position: lower, boundingBox: "block", getProperties: () => ({ open: true, half: "lower" }) };
  const controller = createController();
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position) => {
      if (position.x === lower.x && position.y === lower.y && position.z === lower.z) return lowerDoor;
      if (position.y === 63) return { name: "grass_block", position, boundingBox: "block" };
      return { name: "air", position, boundingBox: "empty" };
    }
  };

  const target = controller.bestDoorPassThroughTarget(lowerDoor, new Vec3(4, 64, 0));

  assert.deepEqual(target, new Vec3(2, 64, 0));
});

test("gotoNear does not use door opening when no nearby door exists", async () => {
  let openedDoor = false;
  const controller = createController({
    openNearbyDoors: async () => {
      openedDoor = true;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position) => (position.y === 63
      ? { name: "grass_block", position, boundingBox: "block" }
      : { name: "air", position, boundingBox: "empty" }),
    pathfinder: {
      goto: async () => {
        controller.bot.entity.position = new Vec3(4, 64, 0);
      }
    }
  };

  const reached = await controller.gotoNear(4, 64, 0, 1, { label: "no_door_move" });

  assert.equal(reached, true);
  assert.equal(openedDoor, false);
});

test("moveThroughEmergencyShelterDoorway walks out without jumping under a low roof", async () => {
  const base = new Vec3(0, 64, 0);
  const controlStates = [];
  const controller = createController({
    gotoNear: async () => false,
    isSafeStandPosition: () => true,
    wait: async () => {
      const latestForward = controlStates.filter((entry) => entry.name === "forward").at(-1);
      if (latestForward?.value) controller.bot.entity.position = base.offset(0, 0, -1);
    },
    resetMotion: () => {
      controlStates.push({ name: "reset", value: true });
    }
  });
  controller.bot = {
    entity: { position: base.clone() },
    pathfinder: { goto: async () => {} },
    lookAt: async () => {},
    setControlState: (name, value) => {
      controlStates.push({ name, value });
    }
  };

  const exited = await controller.moveThroughEmergencyShelterDoorway(base);

  assert.equal(exited, true);
  assert.equal(controlStates.some((entry) => entry.name === "jump" && entry.value === true), false);
  assert.equal(controlStates.some((entry) => entry.name === "forward" && entry.value === true), true);
});

test("recoverFromStarvation retreats from night hostile pressure before foraging", async () => {
  const hostile = { id: 9, name: "skeleton", position: new Vec3(24, 64, 0) };
  let retreatedFrom = null;
  let foraged = false;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        criticalHealth: 8,
        immediateThreatRadius: 8,
        safeModeThreatRadius: 28,
        panicRetreatMs: 500
      }
    },
    isNight: () => true,
    hasUsableStarterShelterAt: () => false,
    cancelCollectTask: async () => {},
    nearestEntity: (predicate, maxDistance) => (maxDistance >= 28 && predicate(hostile) ? hostile : null),
    panicRetreatFrom: async (target) => {
      retreatedFrom = target;
      return true;
    },
    forageNearbyFood: async () => {
      foraged = true;
      return false;
    }
  });
  controller.bot = {
    health: 1,
    food: 0,
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] }
  };

  const recovered = await controller.recoverFromStarvation();

  assert.equal(recovered, false);
  assert.equal(retreatedFrom, hostile);
  assert.equal(foraged, false);
});

test("holdPositionSafely retreats from open-night hostile pressure", async () => {
  const hostile = { id: 11, name: "zombie", position: new Vec3(24, 64, 0) };
  let retreatedFrom = null;
  let waited = false;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        immediateThreatRadius: 8,
        safeModeThreatRadius: 28,
        shelterDefenseRadius: 4,
        panicRetreatMs: 500
      }
    },
    isNight: () => true,
    hasUsableStarterShelterAt: () => false,
    equipBestWeapon: async () => {},
    nearestEntity: (predicate) => (predicate(hostile) ? hostile : null),
    panicRetreatFrom: async (target) => {
      retreatedFrom = target;
      return true;
    },
    wait: async () => {
      waited = true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] },
    setControlState() {},
    clearControlStates() {},
    pathfinder: { setGoal() {} },
    pvp: { stop() {} }
  };

  await controller.holdPositionSafely();

  assert.equal(retreatedFrom, hostile);
  assert.equal(waited, false);
});

test("starvation damage does not trigger unknown damage reposition", async () => {
  let unknownDamageCalled = false;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: { safeModeThreatRadius: 28 }
    },
    pausedUntil: 0,
    findNearbyDamagingBlock: () => null,
    findNearbyDamagingBlockLoose: () => null,
    nearestEntity: () => null,
    respondToUnknownDamage: async () => {
      unknownDamageCalled = true;
    }
  });
  controller.bot = {
    health: 5,
    food: 0,
    entity: { position: new Vec3(0, 64, 0) }
  };

  await controller.handleEmergencyDamage(6, 5);

  assert.equal(unknownDamageCalled, false);
  assert.equal(controller.emergencyBusy, undefined);
});

test("huntFood records success when raw chicken is collected", async () => {
  const animal = { id: 1, name: "chicken", position: new Vec3(2, 64, 0) };
  let inventoryItems = [];
  let success = null;
  const controller = createController({
    nearestEntity: (predicate) => (predicate(animal) ? animal : null),
    equipBestWeapon: async () => {},
    gotoNear: async () => true,
    wait: async () => {
      delete controller.bot.entities[animal.id];
    },
    collectNearbyItems: async () => {
      inventoryItems = [{ name: "chicken", count: 1, slot: 36 }];
      return true;
    },
    recordActionSuccess: (action, position, details) => {
      success = { action, position, details };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [animal.id]: animal },
    inventory: { items: () => inventoryItems },
    pvp: { attack() {}, stop() {} }
  };
  controller.startTaskTrace({ type: "hunt_food", reason: "scenario:hunt-food-day" }, { primarySkillId: "starter_food_buffer" }, { position: controller.bot.entity.position, health: 20, food: 6 });

  const result = await controller.huntFood();

  assert.equal(result, true);
  assert.equal(success.action, "hunt_food");
  assert.equal(success.details.target, "chicken");
  assert.equal(success.details.gainedFood, 1);
  const phaseStatuses = Object.fromEntries(controller.taskTrace.phaseEvents.map((event) => [event.id, event.status]));
  assert.equal(phaseStatuses.prepare, "completed");
  assert.equal(phaseStatuses.search, "completed");
  assert.equal(phaseStatuses.food_source_found, "completed");
  assert.equal(phaseStatuses.approach_animal, "completed");
  assert.equal(phaseStatuses.attack_animal, "completed");
  assert.equal(phaseStatuses.collect_drops, "completed");
  assert.equal(phaseStatuses.verify, "completed");
});

test("huntFood pursues visible distant salmon when food is low", async () => {
  const salmon = { id: 2, name: "salmon", position: new Vec3(32, 64, 0) };
  let inventoryItems = [];
  let gotoOptions = null;
  let success = null;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        foodSearchRadius: 48,
        lowFood: 14,
        criticalHealth: 8,
        threatRadius: 8,
        panicRetreatMs: 500
      }
    },
    equipBestWeapon: async () => {},
    gotoNear: async (x, y, z, range, options) => {
      gotoOptions = { x, y, z, range, options };
      controller.bot.entity.position = new Vec3(x - 2, y, z);
      return true;
    },
    nearestEntity: () => null,
    wait: async () => {
      delete controller.bot.entities[salmon.id];
    },
    collectNearbyItems: async () => {
      inventoryItems = [{ name: "salmon", count: 1, slot: 36 }];
      return true;
    },
    recordActionSuccess: (action, position, details) => {
      success = { action, position, details };
    }
  });
  controller.bot = {
    health: 20,
    food: 10,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [salmon.id]: salmon },
    inventory: { items: () => inventoryItems },
    pvp: { attack() {}, stop() {} }
  };

  const result = await controller.huntFood();

  assert.equal(result, true);
  assert.equal(gotoOptions.options.target, "salmon");
  assert.ok(gotoOptions.options.radius >= 32);
  assert.equal(success.action, "hunt_food");
  assert.equal(success.details.target, "salmon");
});

test("huntFood forages nearby mature berries before chasing distant salmon", async () => {
  const salmon = { id: 2, name: "salmon", position: new Vec3(32, 64, 0) };
  let foraged = false;
  let chasedFish = false;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        foodSearchRadius: 48,
        berryPriorityRadius: 18,
        lowFood: 14,
        criticalHealth: 8,
        threatRadius: 8,
        panicRetreatMs: 500
      }
    },
    equipBestWeapon: async () => {},
    findMatureBerryBushes: () => [{ name: "sweet_berry_bush", position: new Vec3(5, 64, 0) }],
    forageNearbyFood: async (options) => {
      foraged = options.maxDistance === 18;
      return true;
    },
    gotoEntity: async () => {
      chasedFish = true;
      return true;
    }
  });
  controller.bot = {
    health: 20,
    food: 10,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [salmon.id]: salmon },
    inventory: { items: () => [] },
    pvp: { attack() {}, stop() {} }
  };

  const result = await controller.huntFood();

  assert.equal(result, true);
  assert.equal(foraged, true);
  assert.equal(chasedFish, false);
});

test("huntFood does not hard-prioritize berries over a nearby safe land animal", () => {
  const chicken = { id: 3, name: "chicken", position: new Vec3(6, 64, 0) };
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        foodSearchRadius: 48,
        berryPriorityRadius: 18,
        lowFood: 14,
        criticalHealth: 8,
        threatRadius: 8,
        panicRetreatMs: 500
      }
    },
    findMatureBerryBushes: () => [{ name: "sweet_berry_bush", position: new Vec3(4, 64, 0) }]
  });
  controller.bot = {
    health: 20,
    food: 10,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [chicken.id]: chicken },
    inventory: { items: () => [] }
  };

  assert.equal(controller.shouldPreferNearbyBerryFood({
    animal: chicken,
    landAnimal: chicken,
    aquaticAnimal: null,
    beforeFood: 0,
    parameters: {}
  }), false);
});

test("huntFood triggers low oxygen escape during aquatic hunt without blocking hunt_food", async () => {
  const salmon = { id: 2, name: "salmon", position: new Vec3(6, 62, 0) };
  let escaped = false;
  let failure = null;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        foodSearchRadius: 16,
        lowFood: 14,
        criticalHealth: 8,
        threatRadius: 8,
        panicRetreatMs: 500,
        lowOxygenThreshold: 8
      }
    },
    equipBestWeapon: async () => {},
    escapeLowOxygen: async () => {
      escaped = true;
      return true;
    }
  });
  controller.recordActionFailure = (action, reason, position, details) => {
    failure = { action, reason, position, details };
    SurvivalController.prototype.recordActionFailure.call(controller, action, reason, position, details);
  };
  controller.bot = {
    health: 20,
    food: 10,
    oxygenLevel: 7,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [salmon.id]: salmon },
    inventory: { items: () => [] },
    pvp: { attack() {}, stop() {} }
  };

  const result = await controller.huntFood();

  assert.equal(result, false);
  assert.equal(escaped, true);
  assert.equal(failure.action, "hunt_food");
  assert.equal(failure.reason, "low_oxygen_escape");
  assert.equal(failure.details.taskFeedback, false);
  assert.equal(controller.getTaskFeedbackStatus().blockedTasks.length, 0);
  assert.equal(controller.getTaskFeedbackStatus().recentFailures.length, 0);
});

test("ensureHuntingWeapon equips a stone sword before a wooden axe", async () => {
  let equipped = null;
  const controller = createController();
  controller.bot = {
    inventory: { items: () => [{ name: "wooden_axe", count: 1, slot: 36 }, { name: "stone_sword", count: 1, slot: 37 }] },
    equip: async (item) => {
      equipped = item.name;
    }
  };

  const weapon = await controller.ensureHuntingWeapon();

  assert.equal(weapon, "stone_sword");
  assert.equal(equipped, "stone_sword");
});

test("ensureHuntingWeapon crafts and equips a stone sword when materials are ready", async () => {
  let inventoryItems = [{ name: "cobblestone", count: 2, slot: 36 }, { name: "stick", count: 1, slot: 37 }];
  let crafted = false;
  let equipped = null;
  const controller = createController({
    craftBasicSupplies: async () => {},
    craftWeapon: async () => {
      crafted = true;
      inventoryItems = [{ name: "stone_sword", count: 1, slot: 38 }];
      return true;
    }
  });
  controller.bot = {
    inventory: { items: () => inventoryItems },
    recipesFor: () => [{}],
    craft: async () => {},
    equip: async (item) => {
      equipped = item.name;
    }
  };

  const weapon = await controller.ensureHuntingWeapon();

  assert.equal(crafted, true);
  assert.equal(weapon, "stone_sword");
  assert.equal(equipped, "stone_sword");
});

test("huntFood reports failure when no food is found even if recovery explore moves", async () => {
  let failure = null;
  const controller = createController({
    forageNearbyFood: async () => false,
    explore: async () => true,
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    health: 20,
    food: 10,
    entity: { position: new Vec3(0, 64, 0) },
    entities: {},
    inventory: { items: () => [] }
  };

  const result = await controller.huntFood();

  assert.equal(result, false);
  assert.equal(failure.action, "hunt_food");
  assert.equal(failure.reason, "no_food_source_found");
  assert.equal(failure.details.moved, true);
});

test("selectHuntFoodTarget prioritizes land mobs over fish", () => {
  const chicken = { id: 1, name: "chicken", position: new Vec3(6, 64, 0) };
  const salmon = { id: 2, name: "salmon", position: new Vec3(2, 64, 0) };
  const entities = [salmon, chicken];
  const controller = createController();
  controller.bot = {
    health: 20,
    food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity]))
  };

  const selected = controller.selectHuntFoodTarget({ searchRadius: 16 });

  assert.equal(selected.animal.name, "chicken");
  assert.equal(selected.landAnimal.name, "chicken");
  assert.equal(selected.aquaticAnimal, undefined);
});

test("selectHuntFoodTarget does not choose fish unless hunger is low", () => {
  const salmon = { id: 2, name: "salmon", position: new Vec3(3, 64, 0) };
  const controller = createController();
  controller.bot = {
    health: 20,
    food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [salmon.id]: salmon }
  };

  const normal = controller.selectHuntFoodTarget({ searchRadius: 16 });
  assert.equal(normal.animal, undefined);

  controller.bot.food = 10;
  const lowFood = controller.selectHuntFoodTarget({ searchRadius: 16 });
  assert.equal(lowFood.animal.name, "salmon");
  assert.equal(lowFood.aquaticAnimal.name, "salmon");
});

test("selectHuntFoodTarget includes distant fish during low-food recovery", () => {
  const salmon = { id: 2, name: "salmon", position: new Vec3(32, 64, 0) };
  const controller = createController();
  controller.bot = {
    health: 20,
    food: 10,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [salmon.id]: salmon }
  };

  const selected = controller.selectHuntFoodTarget({ searchRadius: 48 });

  assert.equal(selected.animal.name, "salmon");
  assert.equal(selected.aquaticAnimal.name, "salmon");
});

test("forageNearbyFood harvests the whole mature berry patch while below target", async () => {
  const positions = [
    new Vec3(3, 64, -2),
    new Vec3(3, 64, 2),
    new Vec3(5, 64, -2),
    new Vec3(5, 64, 2),
    new Vec3(7, 64, -2),
    new Vec3(7, 64, 2)
  ];
  const harvested = new Set();
  const activated = [];
  let berries = 0;
  const keyFor = (position) => `${position.x},${position.y},${position.z}`;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        placeBlockTimeoutMs: 1000,
        threatRadius: 8,
        foodSearchRadius: 24,
        foodStockTarget: 64,
        panicRetreatMs: 500
      }
    },
    nearestEntity: () => null,
    findSafeBerryHarvestStandPositions: (position) => [position.offset(-2, 0, 0)],
    isLearnedAvoidPosition: () => false,
    reachFirstSafeBerryPosition: async (safePositions) => safePositions[0],
    findNearbyDamagingBlock: () => null,
    collectNearbyItems: async () => true,
    shouldAbortCurrentAction: () => false
  });
  controller.mcData = { blocksByName: { sweet_berry_bush: { id: 512 } } };
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => (berries > 0 ? [{ name: "sweet_berries", count: berries, slot: 10 }] : []) },
    findBlocks: ({ count }) => positions.slice(0, count),
    blockAt: (position) => {
      const berryPosition = positions.find((candidate) => keyFor(candidate) === keyFor(position));
      if (berryPosition) {
        return {
          name: "sweet_berry_bush",
          position: berryPosition,
          getProperties: () => ({ age: harvested.has(keyFor(berryPosition)) ? 1 : 3 })
        };
      }
      return { name: "air", position, boundingBox: "empty" };
    },
    lookAt: async () => {},
    activateBlock: async (block) => {
      activated.push(block.position);
      harvested.add(keyFor(block.position));
      berries++;
    }
  };
  controller.startTaskTrace({ type: "hunt_food", reason: "scenario:berry-patch" }, { primarySkillId: "starter_food_buffer" }, { position: controller.bot.entity.position, health: 20, food: 6 });

  const foraged = await controller.forageNearbyFood();

  assert.equal(foraged, true);
  assert.equal(activated.length, positions.length);
  assert.equal(berries, positions.length);
  assert.deepEqual([...harvested].sort(), positions.map(keyFor).sort());
  const phaseStatuses = Object.fromEntries(controller.taskTrace.phaseEvents.map((event) => [event.id, event.status]));
  assert.equal(phaseStatuses.plant_scan, "completed");
  assert.equal(phaseStatuses.harvest_plant, "completed");
  assert.equal(phaseStatuses.collect_drops, "completed");
  assert.equal(phaseStatuses.verify, "completed");
});

test("direct combat scenario traces weapon use, positioning, and threat verification", async () => {
  const hostile = { id: 2, name: "zombie", position: new Vec3(2, 64, 0) };
  const attacks = [];
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        placeBlockTimeoutMs: 1000,
        threatRadius: 8,
        safeModeThreatRadius: 16,
        immediateThreatRadius: 8,
        criticalHealth: 6,
        panicRetreatMs: 500
      }
    },
    equipBestWeapon: async () => {},
    attackHostileOnce: async (target, distance) => {
      attacks.push({ target, distance });
      delete controller.bot.entities[hostile.id];
      return true;
    },
    collectNearbyItems: async () => true
  });
  controller.bot = {
    health: 20,
    entity: { position: new Vec3(0, 64, 0) },
    entities: { [hostile.id]: hostile },
    inventory: { items: () => [{ name: "stone_axe", count: 1 }] },
    pvp: { attack() {}, stop() {} },
    setControlState() {},
    lookAt: async () => {}
  };
  controller.startTaskTrace({ type: "defend_self", reason: "scenario:combat-hostile" }, { primarySkillId: "safety_base" }, { position: controller.bot.entity.position, health: 20, food: 12 });

  await controller.defendSelf(hostile);

  const phaseStatuses = Object.fromEntries(controller.taskTrace.phaseEvents.map((event) => [event.id, event.status]));
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0].target, hostile);
  assert.equal(phaseStatuses.prepare, "completed");
  assert.equal(phaseStatuses.target, "completed");
  assert.equal(phaseStatuses.attack, "completed");
  assert.equal(phaseStatuses.positioning, "completed");
  assert.equal(phaseStatuses.collect_drops, "completed");
  assert.equal(phaseStatuses.verify, "completed");
});

test("gotoNear returns false when pathfinder resolves but the bot remains too far", async () => {
  let failure = null;
  const controller = createController({
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goto: async () => {} }
  };

  const reached = await controller.gotoNear(20, 64, 0, 1, {
    label: "test_move",
    learnPosition: new Vec3(20, 64, 0),
    target: "stone"
  });

  assert.equal(reached, false);
  assert.equal(failure.action, "test_move");
  assert.match(failure.reason, /^arrived_too_far_/);
});

test("gotoNear aborts early when pathfinder is busy but the bot is not moving", async () => {
  let failure = null;
  let resetCount = 0;
  const controller = createController({
    resetMotion: () => {
      resetCount++;
    },
    recordActionFailure: (action, reason, position, details) => {
      failure = { action, reason, position, details };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    pathfinder: { goto: () => new Promise(() => {}) }
  };

  const startedAt = Date.now();
  const reached = await controller.gotoNear(20, 64, 0, 1, {
    label: "stalled_move",
    timeoutMs: 3000,
    movementSampleMs: 50,
    movementStallMs: 100,
    learnPosition: new Vec3(20, 64, 0),
    target: "stone"
  });

  assert.equal(reached, false);
  assert.ok(Date.now() - startedAt < 1500);
  assert.equal(resetCount, 1);
  assert.equal(failure.action, "stalled_move");
  assert.match(failure.reason, /^movement stalled for stalled_move after 100ms/);
});

test("craftItem fails when crafting reports success but inventory does not change", async () => {
  let failure = null;
  const controller = createController({
    recordActionFailure: (action, reason) => {
      failure = { action, reason };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] },
    recipesFor: () => [{}],
    craft: async () => {}
  };

  const crafted = await controller.craftItem("stick", 1, false);

  assert.equal(crafted, false);
  assert.deepEqual(failure, { action: "craft_item", reason: "no_inventory_increase" });
});

test("craftItem succeeds only after the crafted item appears in inventory", async () => {
  let items = [];
  let success = null;
  const controller = createController({
    recordActionSuccess: (action, position, details) => {
      success = { action, details };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => items },
    recipesFor: () => [{}],
    craft: async () => {
      items = [{ name: "stick", count: 4 }];
    }
  };

  const crafted = await controller.craftItem("stick", 1, false);

  assert.equal(crafted, true);
  assert.deepEqual(success, { action: "craft_item", details: { target: "stick" } });
});

test("collectBlocks uses manual fallback when collectBlock fails", async () => {
  const logPosition = new Vec3(2, 64, 0);
  const logBlock = { name: "oak_log", position: logPosition, diggable: true };
  let usedManualFallback = false;
  const controller = createController({
    rankMineableBlocks: () => [logBlock],
    equipToolForBlock: async () => {},
    collectNearbyItems: async () => false,
    nearestEntity: () => null,
    findNearbyDamagingBlock: () => null,
    collectBlocksManually: async (blocks, count, options) => {
      usedManualFallback = true;
      assert.equal(blocks[0], logBlock);
      assert.equal(count, 1);
      assert.equal(options.action, "collect_wood");
      return { collected: true, interruptedByThreat: false };
    }
  });
  controller.currentDecisionType = "collect_wood";
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    heldItem: null,
    inventory: { items: () => [] },
    findBlocks: () => [logPosition],
    blockAt: () => logBlock,
    collectBlock: { collect: async () => { throw new Error("no path"); } }
  };

  const result = await controller.collectBlocks(["oak_log"], 1, 16, { action: "collect_wood" });

  assert.equal(usedManualFallback, true);
  assert.deepEqual(result, { collected: true, interruptedByThreat: false });
  assert.equal(controller.getTaskFeedbackStatus().recentFailures.length, 0);
  assert.equal(controller.getTaskFeedbackStatus().blockedTasks.length, 0);
});

test("collectBlocks treats timeout with inventory gain as collected", async () => {
  const logPosition = new Vec3(2, 64, 0);
  const logBlock = { name: "oak_log", position: logPosition, diggable: true };
  let items = [];
  let usedManualFallback = false;
  const controller = createController({
    rankMineableBlocks: () => [logBlock],
    equipToolForBlock: async () => {},
    collectNearbyItems: async () => false,
    nearestEntity: () => null,
    findNearbyDamagingBlock: () => null,
    didAnyTargetBlockChange: () => false,
    collectBlocksManually: async () => {
      usedManualFallback = true;
      return { collected: false, interruptedByThreat: false };
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    heldItem: null,
    inventory: { items: () => items },
    findBlocks: () => [logPosition],
    blockAt: () => logBlock,
    collectBlock: {
      collect: async () => {
        items = [{ name: "oak_log", count: 1 }];
        throw new Error("action timed out after 25000ms");
      }
    }
  };

  const result = await controller.collectBlocks(["oak_log"], 1, 16, { action: "collect_wood" });

  assert.equal(usedManualFallback, false);
  assert.deepEqual(result, { collected: true, interruptedByThreat: false });
});

test("collectWood repeats partial trunk collection until enough logs are gathered", async () => {
  let logCount = 0;
  let collectCalls = 0;
  let explored = false;
  const controller = createController({
    ensureWoodcuttingTool: async () => true,
    collectBlocks: async (blockNames, count, maxDistance, options) => {
      collectCalls++;
      assert.ok(blockNames.includes("spruce_log"));
      assert.equal(maxDistance, 64);
      assert.equal(options.lowestPerColumn, true);
      assert.equal(options.maxTargetAbove, 5);
      logCount += Math.min(2, count);
      return { collected: true, interruptedByThreat: false };
    },
    explore: async () => {
      explored = true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => (logCount > 0 ? [{ name: "spruce_log", count: logCount }] : [])
    }
  };

  await controller.collectWood();

  assert.equal(collectCalls, 2);
  assert.equal(logCount, 4);
  assert.equal(explored, false);
});

test("collectStone repeats partial stone collection at the current worksite", async () => {
  let stoneCount = 0;
  const collectCounts = [];
  let explored = false;
  const controller = createController({
    equipBestTool: async () => {},
    collectNearbyItems: async () => true,
    collectBlocks: async (_blockNames, count, _maxDistance, options) => {
      collectCounts.push({ count, options });
      stoneCount += Math.min(2, count);
      return { collected: true, interruptedByThreat: false };
    },
    exploreForSurfaceStone: async () => {
      explored = true;
    },
    excavateMineProbe: async () => {
      explored = true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => [
        { name: "wooden_pickaxe", count: 1, slot: 36 },
        ...(stoneCount ? [{ name: "cobblestone", count: stoneCount, slot: 37 }] : [])
      ]
    }
  };

  const result = await controller.collectStone({ constructorArgs: { count: 5, searchRadius: 24 } });

  assert.equal(result, true);
  assert.deepEqual(collectCounts.map((entry) => entry.count), [5, 3, 1]);
  assert.equal(collectCounts[0].options.surfaceOnly, true);
  assert.equal(collectCounts[1].options.surfaceOnly, false);
  assert.equal(stoneCount, 5);
  assert.equal(explored, false);
});

test("collectWood approaches a safe ground stand for elevated target logs", async () => {
  const targetLog = new Vec3(8, 66, 0);
  let gotoCall = null;
  let logCount = 0;
  const controller = createController({
    ensureWoodcuttingTool: async () => true,
    collectBlocks: async () => {
      logCount = 4;
      return { collected: true, interruptedByThreat: false };
    },
    gotoNear: async (x, y, z, range, options) => {
      gotoCall = { x, y, z, range, options };
      return true;
    },
    findNearbyDamagingBlock: () => null
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => (logCount > 0 ? [{ name: "spruce_log", count: logCount }] : [])
    },
    blockAt: (position) => {
      const blockPosition = position.floored ? position.floored() : position;
      if (blockPosition.x === targetLog.x && blockPosition.y === targetLog.y && blockPosition.z === targetLog.z) {
        return { name: "spruce_log", position: targetLog, boundingBox: "block", diggable: true };
      }
      if (blockPosition.y === 63) return { name: "grass_block", position: blockPosition, boundingBox: "block", diggable: true };
      return { name: "air", position: blockPosition, boundingBox: "empty", diggable: false };
    }
  };

  await controller.collectWood({ constructorArgs: { count: 4, targetPosition: { x: targetLog.x, y: targetLog.y, z: targetLog.z } } });

  assert.equal(gotoCall.y, 64);
  assert.equal(gotoCall.range, 1);
  assert.equal(gotoCall.options.label, "collect_wood_target");
  assert.equal(gotoCall.options.target, "known_log_stand");
});

test("collectWood keeps a broad search radius after repeated failures", async () => {
  const radii = [];
  const controller = createController({
    ensureWoodcuttingTool: async () => true,
    collectBlocks: async (blockNames, count, maxDistance) => {
      radii.push(maxDistance);
      return { collected: false, interruptedByThreat: false };
    },
    explore: async () => false
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] }
  };

  await controller.collectWood();
  await controller.collectWood();

  assert.deepEqual(radii, [64, 64]);
});

test("knownLogTargets skips learned avoided logs and policy cooldowns", () => {
  const avoidedLog = new Vec3(24, 67, 18);
  const availableLog = new Vec3(32, 67, 18);
  const controller = createController();
  controller.memory.knownBlocks.spruce_log = [
    { position: avoidedLog, dimension: "overworld" },
    { position: availableLog, dimension: "overworld" }
  ];
  controller.memory.learning.avoidedPositions = [{
    key: "collect_wood_known_log:known_log_area",
    action: "collect_wood_known_log",
    target: "known_log_area",
    reason: "movement_stalled",
    position: { x: avoidedLog.x, y: avoidedLog.y, z: avoidedLog.z },
    dimension: "overworld",
    radius: 6,
    failures: 2,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    updatedAt: new Date().toISOString()
  }];
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: () => null
  };

  const targets = controller.knownLogTargets(controller.bot.entity.position, 128);

  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0].position, availableLog);

  controller.memory.learning.policyStats["collect_wood_known_log:known_log_area"] = {
    attempts: 6,
    successes: 0,
    failures: 6,
    lastOutcome: "failure",
    cooldownUntil: new Date(Date.now() + 60000).toISOString(),
    updatedAt: new Date().toISOString()
  };

  assert.deepEqual(controller.knownLogTargets(controller.bot.entity.position, 128), []);
});

test("collectWood approaches remembered forest logs before generic exploration", async () => {
  let collectCalls = 0;
  let logCount = 0;
  let explored = false;
  let gotoCall = null;
  const rememberedLog = new Vec3(24, 67, 18);
  const approachStand = new Vec3(23, 64, 18);
  const controller = createController({
    ensureWoodcuttingTool: async () => true,
    collectBlocks: async () => {
      collectCalls++;
      if (collectCalls === 1) return { collected: false, interruptedByThreat: false };
      logCount = 4;
      return { collected: true, interruptedByThreat: false };
    },
    collectWoodTargetApproach: (position) => {
      assert.deepEqual(position, rememberedLog);
      return { position: approachStand, range: 3, target: "known_log_area" };
    },
    gotoNear: async (x, y, z, range, options) => {
      gotoCall = { x, y, z, range, options };
      controller.bot.entity.position = new Vec3(x, y, z);
      return true;
    },
    explore: async () => {
      explored = true;
      return false;
    }
  });
  controller.memory.knownBlocks.spruce_log = [{ position: rememberedLog, dimension: "overworld" }];
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => (logCount > 0 ? [{ name: "spruce_log", count: logCount }] : [])
    }
  };

  const result = await controller.collectWood();

  assert.equal(result, true);
  assert.equal(collectCalls, 2);
  assert.equal(explored, false);
  assert.deepEqual({ x: gotoCall.x, y: gotoCall.y, z: gotoCall.z, range: gotoCall.range }, { x: 23, y: 64, z: 18, range: 3 });
  assert.equal(gotoCall.options.label, "collect_wood_known_log");
  assert.equal(gotoCall.options.target, "known_log_area");
  assert.equal(gotoCall.options.taskFeedback, false);
});

test("collectStone consumes behavior tree constructor args", async () => {
  let gotoTarget = null;
  let collectCall = null;
  let stoneCount = 0;
  const controller = createController({
    equipBestTool: async () => {},
    gotoNear: async (x, y, z, range, options) => {
      gotoTarget = { x, y, z, range, options };
      return true;
    },
    collectBlocks: async (blockNames, count, maxDistance, options) => {
      collectCall = { blockNames, count, maxDistance, options };
      stoneCount = count;
      return { collected: true, interruptedByThreat: false };
    },
    collectNearbyItems: async () => true
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: "wooden_pickaxe", count: 1 }, ...(stoneCount ? [{ name: "cobblestone", count: stoneCount }] : [])] }
  };

  await controller.collectStone({ constructorArgs: { count: 5, targetPosition: { x: 20, y: 64, z: 0 }, searchRadius: 24 } });

  assert.deepEqual({ x: gotoTarget.x, y: gotoTarget.y, z: gotoTarget.z, range: gotoTarget.range }, { x: 20, y: 64, z: 0, range: 4 });
  assert.equal(gotoTarget.options.label, "collect_stone_target");
  assert.equal(collectCall.count, 5);
  assert.equal(collectCall.maxDistance, 24);
  assert.equal(collectCall.options.action, "collect_stone");
  assert.equal(collectCall.options.maxMineBelow, 1);
  assert.equal(collectCall.options.allowOwnSupportTarget, true);
});

test("rankMineableBlocks prefers adjacent exposed ground-level stone over buried targets", () => {
  const makeBlock = (name, position, boundingBox = "block") => ({
    name,
    position,
    boundingBox,
    diggable: boundingBox === "block"
  });
  const underFoot = makeBlock("stone", new Vec3(0, 63, 0));
  const adjacentExposed = makeBlock("stone", new Vec3(1, 63, 0));
  const buried = makeBlock("stone", new Vec3(4, 63, 0));
  const distantExposed = makeBlock("stone", new Vec3(8, 63, 0));
  const blocks = new Map([
    ["0,63,0", underFoot],
    ["1,63,0", adjacentExposed],
    ["4,63,0", buried],
    ["4,64,0", makeBlock("dirt", new Vec3(4, 64, 0))],
    ["8,63,0", distantExposed]
  ]);
  const controller = createController({
    isDamagingBlock: () => false,
    isLearnedAvoidPosition: () => false,
    findNearbyDamagingBlock: () => null
  });
  controller.bot = {
    entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: (position) => {
      const blockPosition = position.floored ? position.floored() : new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
      const key = `${blockPosition.x},${blockPosition.y},${blockPosition.z}`;
      if (blocks.has(key)) return blocks.get(key);
      if (blockPosition.y === 63) return makeBlock("grass_block", blockPosition);
      return makeBlock("air", blockPosition, "empty");
    }
  };

  const ranked = controller.rankMineableBlocks([underFoot.position, buried.position, distantExposed.position, adjacentExposed.position], {
    action: "collect_stone",
    safeMining: true,
    surfaceOnly: true,
    preferSurface: true,
    maxMineBelow: 1,
    allowOwnSupportTarget: true
  });

  assert.deepEqual(ranked[0].position, adjacentExposed.position);
  assert.equal(controller.sameBlockPosition(ranked[1].position, underFoot.position), true);
  assert.equal(ranked.some((block) => controller.sameBlockPosition(block.position, buried.position)), false);
  assert.equal(ranked.some((block) => controller.sameBlockPosition(block.position, distantExposed.position)), true);
});

test("rankMineableBlocks prefers low reachable logs per tree column", () => {
  const lowLog = { name: "spruce_log", position: new Vec3(4, 64, 0), diggable: true };
  const highLog = { name: "spruce_log", position: new Vec3(4, 72, 0), diggable: true };
  const otherLog = { name: "spruce_log", position: new Vec3(8, 65, 0), diggable: true };
  const blocks = new Map([
    ["4,64,0", lowLog],
    ["4,72,0", highLog],
    ["8,65,0", otherLog]
  ]);
  const controller = createController({
    isDamagingBlock: () => false,
    isLearnedAvoidPosition: () => false,
    findSafeMiningStandPositions: (position) => [position.offset(1, -1, 0)],
    findSafeAdjacentStandPositions: () => []
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position) => blocks.get(`${position.x},${position.y},${position.z}`)
  };

  const ranked = controller.rankMineableBlocks([...blocks.values()].map((block) => block.position), {
    action: "collect_wood",
    lowestPerColumn: true,
    maxTargetAbove: 3,
    requireReachableStand: true
  });

  assert.deepEqual(ranked.map((block) => block.position), [lowLog.position, otherLog.position]);
});

test("rankMineableBlocks keeps elevated trunk logs reachable from lower forest floor", () => {
  const elevatedLog = { name: "spruce_log", position: new Vec3(4, 65, 0), diggable: true, boundingBox: "block" };
  const controller = createController({
    isDamagingBlock: () => false,
    isLearnedAvoidPosition: () => false,
    findNearbyDamagingBlock: () => null
  });
  controller.bot = {
    entity: { position: new Vec3(0.5, 63, 0.5) },
    blockAt: (position) => {
      const blockPosition = position.floored ? position.floored() : position;
      if (blockPosition.x === elevatedLog.position.x && blockPosition.y === elevatedLog.position.y && blockPosition.z === elevatedLog.position.z) return elevatedLog;
      if (blockPosition.y === 62) return { name: "grass_block", position: blockPosition, boundingBox: "block", diggable: true };
      return { name: "air", position: blockPosition, boundingBox: "empty", diggable: false };
    }
  };

  const ranked = controller.rankMineableBlocks([elevatedLog.position], {
    action: "collect_wood",
    lowestPerColumn: true,
    maxTargetAbove: 5,
    requireReachableStand: true
  });

  assert.deepEqual(ranked.map((block) => block.position), [elevatedLog.position]);
});

test("explore uses a known safe exploration target before random walking", async () => {
  let target = null;
  const safeTarget = new Vec3(10, 64, 0);
  const controller = createController({
    isNight: () => false,
    findSafeExplorationTarget: () => safeTarget,
    gotoNear: async (x, y, z, range, options) => {
      target = { x, y, z, range, options };
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const explored = await controller.explore();

  assert.equal(explored, true);
  assert.equal(target.x, safeTarget.x);
  assert.equal(target.z, safeTarget.z);
  assert.equal(target.options.label, "explore");
});

test("explore consumes behavior tree constructor args as function parameters", async () => {
  let target = null;
  let remembered = null;
  const controller = createController({
    isNight: () => false,
    isTaskFeedbackBlocked: () => false,
    gotoNear: async (x, y, z, range, options) => {
      target = { x, y, z, range, options };
      return true;
    },
    rememberExplorationTarget: (position, details) => {
      remembered = { position, details };
    }
  });
  controller.bot = {
    health: 20,
    food: 20,
    entity: { position: new Vec3(0, 64, 0) }
  };

  const explored = await controller.explore({ constructorArgs: { targetPosition: { x: 9, y: 64, z: 1 }, radius: 12, range: 2, mode: "safe_scan" } });

  assert.equal(explored, true);
  assert.deepEqual({ x: target.x, y: target.y, z: target.z, range: target.range }, { x: 9, y: 64, z: 1, range: 2 });
  assert.equal(target.options.label, "parameterized_explore");
  assert.equal(target.options.radius, 12);
  assert.equal(remembered.details.purpose, "safe_scan");
});

test("explore does not change pathfinder goals during emergency interruption", async () => {
  let targetSearched = false;
  let pathfinderCalled = false;
  const controller = createController({
    actionInterruptedUntil: Date.now() + 5000,
    isNight: () => false,
    findSafeExplorationTarget: () => {
      targetSearched = true;
      return new Vec3(10, 64, 0);
    },
    gotoNear: async () => {
      pathfinderCalled = true;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const explored = await controller.explore();

  assert.equal(explored, false);
  assert.equal(targetSearched, false);
  assert.equal(pathfinderCalled, false);
});

test("explore expands its search when recovering from blocked wood collection", async () => {
  let target = null;
  let targetOptions = null;
  const safeTarget = new Vec3(48, 64, 0);
  const controller = createController({
    isNight: () => false,
    findSafeExplorationTarget: (_origin, options) => {
      targetOptions = options;
      return safeTarget;
    },
    isTaskFeedbackBlocked: () => false,
    gotoNear: async (x, y, z, range, options) => {
      target = { x, y, z, range, options };
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const explored = await controller.explore({ blockedTask: "collect_wood", reason: "feedback replan after blocked collect_wood" });

  assert.equal(explored, true);
  assert.deepEqual(targetOptions.distances, [12, 16, 20, 24, 32]);
  assert.equal(targetOptions.avoidRecent, true);
  assert.equal(target.options.label, "wood_recovery_explore");
  assert.equal(target.range, 3);
});

test("explore expands its search when recovering from blocked food search", async () => {
  let target = null;
  let targetOptions = null;
  const safeTarget = new Vec3(0, 64, 48);
  const controller = createController({
    isNight: () => false,
    findSafeExplorationTarget: (_origin, options) => {
      targetOptions = options;
      return safeTarget;
    },
    isTaskFeedbackBlocked: () => false,
    gotoNear: async (x, y, z, range, options) => {
      target = { x, y, z, range, options };
      return true;
    }
  });
  controller.bot = {
    food: 5,
    entity: { position: new Vec3(0, 64, 0) }
  };

  const explored = await controller.explore({ blockedTask: "hunt_food", reason: "local food search failed repeatedly" });

  assert.equal(explored, true);
  assert.deepEqual(targetOptions.distances, [12, 16, 20, 24, 32]);
  assert.equal(targetOptions.avoidRecent, true);
  assert.equal(target.options.label, "food_recovery_explore");
  assert.equal(target.options.target, "food_recovery");
  assert.equal(target.range, 3);
});

test("explore contracts recovery targets after exploration is blocked", async () => {
  let targetOptions = null;
  const safeTarget = new Vec3(8, 64, 0);
  const controller = createController({
    isNight: () => false,
    findSafeExplorationTarget: (_origin, options) => {
      targetOptions = options;
      return safeTarget;
    },
    isTaskFeedbackBlocked: (taskType) => taskType === "explore",
    gotoNear: async () => true
  });
  controller.bot = {
    food: 5,
    entity: { position: new Vec3(0, 64, 0) }
  };

  const explored = await controller.explore({ blockedTask: "hunt_food", reason: "local food search failed repeatedly" });

  assert.equal(explored, true);
  assert.deepEqual(targetOptions.distances, [6, 8, 10, 12, 16]);
  assert.equal(targetOptions.preferredDistance, 10);
});

test("collectNearbyItems uses a safe pickup stand near berry drops", async () => {
  const itemPosition = new Vec3(1, 64, 0);
  let target = null;
  const controller = createController({
    isSafeStandPosition: (position) => position.x === 0 && position.y === 64 && position.z === 0,
    findNearbyDamagingBlock: () => null,
    gotoBlock: async (position, options) => {
      target = { x: position.x, y: position.y, z: position.z, options };
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      drop: { name: "item", position: itemPosition }
    }
  };

  const collected = await controller.collectNearbyItems({ maxDistance: 4, range: 2, avoidDamagingBlocks: true });

  assert.equal(collected, true);
  assert.deepEqual({ x: target.x, y: target.y, z: target.z }, { x: 0, y: 64, z: 0 });
  assert.equal(target.options.label, "collect_item_safe");
});

test("collectNearbyItems skips berry drops when no safe pickup stand exists", async () => {
  let moved = false;
  const controller = createController({
    isSafeStandPosition: () => false,
    findNearbyDamagingBlock: () => null,
    gotoNear: async () => {
      moved = true;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      drop: { name: "item", position: new Vec3(1, 64, 0) }
    }
  };

  const collected = await controller.collectNearbyItems({ maxDistance: 4, range: 2, avoidDamagingBlocks: true });

  assert.equal(collected, false);
  assert.equal(moved, false);
});

test("collectNearbyItems escapes if item pickup touches a damaging bush", async () => {
  const hazard = { name: "sweet_berry_bush", position: new Vec3(1, 64, 0), distance: 0.2 };
  let escaped = null;
  const controller = createController({
    isSafeStandPosition: (position) => position.x === 0 && position.y === 64 && position.z === 0,
    findNearbyDamagingBlock: (position) => (position.x === 1 ? hazard : null),
    gotoBlock: async () => {
      controller.bot.entity.position = new Vec3(1, 64, 0);
      return true;
    },
    escapeHazardBlock: async (detectedHazard) => {
      escaped = detectedHazard;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      drop: { name: "item", position: new Vec3(1, 64, 0) }
    }
  };

  const collected = await controller.collectNearbyItems({ maxDistance: 4, range: 2, avoidDamagingBlocks: true });

  assert.equal(collected, false);
  assert.equal(escaped, hazard);
});

test("reachFirstSafeBerryPosition aborts when emergency damage interrupts foraging", async () => {
  let moved = false;
  const controller = createController({
    actionInterruptedUntil: Date.now() + 5000,
    gotoNear: async () => {
      moved = true;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const reached = await controller.reachFirstSafeBerryPosition([new Vec3(1, 64, 0)]);

  assert.equal(reached, null);
  assert.equal(moved, false);
});

test("evadeHostiles uses a short retreat window before fighting close threats", async () => {
  const hostile = { id: 1, name: "zombie", position: new Vec3(8, 64, 0) };
  let retreatCall = null;
  let defended = null;
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        placeBlockTimeoutMs: 1000,
        threatRadius: 20,
        safeModeThreatRadius: 28,
        immediateThreatRadius: 8,
        criticalHealth: 8,
        panicRetreatMs: 3500,
        evadeDistance: 24
      }
    },
    nearestEntity: () => hostile,
    panicRetreatFrom: async (target, durationMs, options) => {
      retreatCall = { target, durationMs, options };
      controller.bot.entity.position = new Vec3(7, 64, 0);
      return false;
    },
    defendSelf: async (target) => {
      defended = target;
    }
  });
  controller.bot = {
    health: 20,
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: "stone_sword", count: 1 }] }
  };

  await controller.evadeHostiles();

  assert.equal(retreatCall.target, hostile);
  assert.equal(retreatCall.durationMs, 1200);
  assert.equal(retreatCall.options.maxPathTimeoutMs, 1200);
  assert.equal(defended, hostile);
});

test("holdPositionSafely seals shelter blocks instead of retreating from distant night pressure", async () => {
  const originalNow = Date.now;
  let now = 0;
  let retreatCount = 0;
  let shelterCount = 0;
  const hostile = {
    name: "skeleton",
    position: new Vec3(18, 64, 0)
  };
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        placeBlockTimeoutMs: 1000,
        immediateThreatRadius: 8,
        shelterDefenseRadius: 4,
        safeModeThreatRadius: 28,
        threatRadius: 20,
        panicRetreatMs: 500
      }
    },
    isNight: () => true,
    hasUsableStarterShelterAt: () => false,
    nearestEntity: () => hostile,
    equipBestWeapon: async () => {},
    wait: async (ms) => {
      now += ms;
    },
    buildSimpleShelter: async () => {
      shelterCount++;
    },
    panicRetreatFrom: async () => {
      retreatCount++;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [{ name: "dirt", count: 8 }] },
    setControlState() {}
  };

  Date.now = () => now;
  try {
    await controller.holdPositionSafely();
  } finally {
    Date.now = originalNow;
  }

  assert.equal(retreatCount, 0);
  assert.equal(shelterCount > 0, true);
});

test("holdPositionSafely retreats from near night threats within the emergency buffer", async () => {
  const originalNow = Date.now;
  let now = 0;
  let retreatCount = 0;
  const hostile = {
    name: "zombie",
    position: new Vec3(8.8, 64, 0)
  };
  const controller = createController({
    config: {
      memory: { enabled: false, knownBlockSearchRadius: 96 },
      survival: {
        actionTimeoutMs: 1000,
        placeBlockTimeoutMs: 1000,
        immediateThreatRadius: 8,
        shelterDefenseRadius: 4,
        safeModeThreatRadius: 28,
        threatRadius: 20,
        panicRetreatMs: 500
      }
    },
    isNight: () => true,
    hasUsableStarterShelterAt: () => false,
    nearestEntity: () => hostile,
    equipBestWeapon: async () => {},
    wait: async (ms) => {
      now += ms;
    },
    panicRetreatFrom: async () => {
      retreatCount++;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] },
    setControlState() {}
  };

  Date.now = () => now;
  try {
    await controller.holdPositionSafely();
  } finally {
    Date.now = originalNow;
  }

  assert.equal(retreatCount, 1);
});

test("escapeHazard stabilizes generic hazards without random hostile evasion", async () => {
  let evaded = false;
  const controller = createController({
    findNearbyDamagingBlock: () => null,
    isSafeStandPosition: () => true,
    evadeHostiles: async () => {
      evaded = true;
    }
  });
  controller.bot = {
    entity: {
      position: new Vec3(0, 64, 0),
      isInLava: false,
      timeSinceOnGround: 100
    },
    oxygenLevel: 20,
    clearControlStates() {},
    setControlState() {}
  };

  const escaped = await controller.escapeHazard();

  assert.equal(escaped, true);
  assert.equal(evaded, false);
});

test("escapePit verifies rim movement before considering the bot escaped", async () => {
  let trapped = true;
  let gotoCalls = 0;
  let carvedDirection = null;
  let successTarget = null;
  const controller = createController({
    analyzeNavigationSituation: () => ({
      trapped: true,
      kind: "pit_or_enclosed_trap",
      summary: "navigation trap: pit",
      recommendedAction: "rim_or_stair",
      rim: new Vec3(1, 65, 0),
      routeOptions: ["rim_path", "ascending_stair"]
    }),
    isLikelyPitPosition: () => trapped,
    gotoNear: async () => {
      gotoCalls++;
      return true;
    },
    carveAscendingEscapeStair: async (direction) => {
      carvedDirection = direction;
      trapped = false;
      controller.bot.entity.position = new Vec3(1, 65, 0);
      return true;
    },
    recordActionSuccess: (_taskType, _position, details) => {
      successTarget = details.target;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const escaped = await controller.escapePit();

  assert.equal(escaped, true);
  assert.equal(gotoCalls, 1);
  assert.deepEqual({ x: carvedDirection.x, z: carvedDirection.z }, { x: 1, z: 0 });
  assert.equal(successTarget, "pit_stair");
});

test("escapePit tries another stair direction when the first carve does not escape", async () => {
  let trapped = true;
  const attemptedDirections = [];
  const controller = createController({
    analyzeNavigationSituation: () => ({
      trapped: true,
      kind: "pit_or_enclosed_trap",
      summary: "navigation trap: enclosed",
      recommendedAction: "rim_or_stair",
      rim: null,
      routeOptions: ["ascending_stair"]
    }),
    cardinalDirection: () => new Vec3(1, 0, 0),
    isLikelyPitPosition: () => trapped,
    carveAscendingEscapeStair: async (direction) => {
      attemptedDirections.push(`${direction.x},${direction.z}`);
      if (attemptedDirections.length === 2) {
        trapped = false;
        return true;
      }
      return false;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const escaped = await controller.escapePit();

  assert.equal(escaped, true);
  assert.deepEqual(attemptedDirections, ["1,0", "-1,0"]);
});

test("analyzeNavigationSituation identifies an elevated support column descent", () => {
  const controller = createController();
  const stoneAt = (position) => ({ name: "stone", position, boundingBox: "block", diggable: true });
  const airAt = (position) => ({ name: "air", position, boundingBox: "empty", diggable: false });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position) => (position.x === 0 && position.z === 0 && position.y <= 63 ? stoneAt(position) : airAt(position))
  };

  const analysis = controller.analyzeNavigationSituation(controller.bot.entity.position);

  assert.equal(analysis.trapped, true);
  assert.equal(analysis.kind, "elevated_support_column");
  assert.equal(analysis.recommendedAction, "controlled_descent");
  assert.equal(analysis.supportBlock.name, "stone");
  assert.equal(analysis.safeSupportDescent, true);
});

test("descendSupportColumn digs the support block one level at a time", async () => {
  let trapped = true;
  let dugPosition = null;
  const controller = createController({
    digBlockAt: async (position) => {
      dugPosition = position;
      controller.bot.entity.position = new Vec3(0, 63, 0);
      trapped = false;
      return true;
    },
    isLikelyPitPosition: () => trapped
  });
  const stoneAt = (position) => ({ name: "stone", position, boundingBox: "block", diggable: true });
  const airAt = (position) => ({ name: "air", position, boundingBox: "empty", diggable: false });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position) => (position.x === 0 && position.z === 0 && position.y <= 63 ? stoneAt(position) : airAt(position))
  };

  const descended = await controller.descendSupportColumn(1, {
    trapped: true,
    kind: "elevated_support_column",
    recommendedAction: "controlled_descent",
    supportColumnDepth: 4,
    safeSupportDescent: true
  });

  assert.equal(descended, true);
  assert.deepEqual({ x: dugPosition.x, y: dugPosition.y, z: dugPosition.z }, { x: 0, y: 63, z: 0 });
  assert.equal(controller.bot.entity.position.y, 63);
});

test("escapePit prefers controlled descent for elevated support columns", async () => {
  let descended = false;
  let usedRimPath = false;
  const controller = createController({
    analyzeNavigationSituation: () => ({
      trapped: true,
      kind: "elevated_support_column",
      summary: "navigation trap: elevated support column",
      recommendedAction: "controlled_descent",
      supportColumnDepth: 5,
      safeSupportDescent: true,
      routeOptions: ["controlled_descent"]
    }),
    descendSupportColumn: async () => {
      descended = true;
      return true;
    },
    gotoNear: async () => {
      usedRimPath = true;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const escaped = await controller.escapePit();

  assert.equal(escaped, true);
  assert.equal(descended, true);
  assert.equal(usedRimPath, false);
});

test("escapePit keeps focused on controlled descent when a support column needs more steps", async () => {
  let descendSteps = null;
  let usedRimPath = false;
  const controller = createController({
    analyzeNavigationSituation: () => ({
      trapped: true,
      kind: "elevated_support_column",
      summary: "navigation trap: elevated support column",
      recommendedAction: "controlled_descent",
      supportColumnDepth: 12,
      safeSupportDescent: true,
      rim: new Vec3(1, 80, 4),
      routeOptions: ["rim_path", "controlled_descent"]
    }),
    descendSupportColumn: async (maxSteps) => {
      descendSteps = maxSteps;
      return false;
    },
    gotoNear: async () => {
      usedRimPath = true;
      return true;
    }
  });
  controller.bot = {
    entity: { position: new Vec3(0, 64, 0) }
  };

  const escaped = await controller.escapePit();

  assert.equal(escaped, false);
  assert.equal(descendSteps, 12);
  assert.equal(usedRimPath, false);
});

test("forced task override switches normal decisions but keeps hard safety decisions", () => {
  const controller = createController();
  const forcedTask = controller.setForcedTask("hunt_food", { ttlMs: 30000, reason: "berry scenario" });

  assert.equal(forcedTask.taskType, "hunt_food");
  const normalDecision = controller.applyForcedTask(
    { type: "collect_stone", reason: "normal progression" },
    { type: "collect_stone", reason: "normal progression" }
  );
  assert.equal(normalDecision.type, "hunt_food");
  assert.equal(normalDecision.forced, true);
  assert.equal(normalDecision.ruleDecision, "collect_stone");

  const safetyDecision = controller.applyForcedTask(
    { type: "escape_hazard", reason: "damaging block" },
    { type: "escape_hazard", reason: "damaging block" }
  );
  assert.equal(safetyDecision.type, "escape_hazard");
});

test("priority tasks override normal decisions but not unrelated hard safety", () => {
  const controller = createController();
  controller.insertPriorityTask("explore", { priority: 100, reason: "player request", source: "chat" });

  const normalDecision = controller.selectDecisionWithPriorityTasks({}, { type: "collect_wood", reason: "need wood" });
  assert.equal(normalDecision.type, "explore");
  assert.equal(normalDecision.priorityQueued, true);
  controller.priorityTaskQueue.completeCurrent("completed");

  controller.insertPriorityTask("explore", { priority: 100, reason: "player request", source: "chat" });
  const safetyDecision = controller.selectDecisionWithPriorityTasks({}, { type: "escape_hazard", reason: "berry bush" });
  assert.equal(safetyDecision.type, "escape_hazard");
  assert.equal(safetyDecision.priorityQueued, undefined);
  assert.equal(controller.getPriorityTaskStatus().pendingTasks[0].type, "explore");
});

test("priority task can be consumed when it matches the active hard safety decision", () => {
  const controller = createController();
  controller.insertPriorityTask("escape_hazard", { priority: 100, reason: "berry escape scenario", source: "test" });

  const decision = controller.selectDecisionWithPriorityTasks({}, { type: "escape_hazard", reason: "berry bush" });

  assert.equal(decision.type, "escape_hazard");
  assert.equal(decision.priorityQueued, true);
  assert.equal(decision.source, "test");
});

test("test task pipeline overrides normal decisions without consuming ordinary priority tasks", () => {
  const controller = createController();
  controller.insertPriorityTask("collect_wood", { priority: 100, reason: "player request", source: "chat" });
  controller.insertTestTask("escape_hazard", { reason: "berry escape scenario", source: "test_pipeline" });

  const decision = controller.selectDecisionWithTestTasks({}, { type: "collect_wood", reason: "need wood" });

  assert.equal(decision.type, "escape_hazard");
  assert.equal(decision.testQueued, true);
  assert.equal(decision.source, "test_pipeline");
  assert.equal(controller.getPriorityTaskStatus().pendingTasks[0].type, "collect_wood");
});

test("test task pipeline does not override unrelated hard safety", () => {
  const controller = createController();
  controller.insertTestTask("explore", { reason: "scenario probe", source: "test_pipeline" });

  const decision = controller.selectDecisionWithTestTasks({}, { type: "escape_hazard", reason: "berry bush" });

  assert.equal(decision.type, "escape_hazard");
  assert.equal(decision.testQueued, undefined);
  assert.equal(controller.getTestTaskStatus().pendingTasks[0].type, "explore");
});

test("test task pipeline can be consumed when it matches active hard safety", () => {
  const controller = createController();
  controller.insertTestTask("escape_hazard", { reason: "berry escape scenario", source: "test_pipeline" });

  const decision = controller.selectDecisionWithTestTasks({}, { type: "escape_hazard", reason: "berry bush" });

  assert.equal(decision.type, "escape_hazard");
  assert.equal(decision.testQueued, true);
  assert.equal(decision.source, "test_pipeline");
});