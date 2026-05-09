const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { AgentOrchestrator } = require("../src/agents/agentOrchestrator");
const { BehaviorExecutionQueue } = require("../src/behavior/behaviorExecutionQueue");
const {
  ExecutableBehaviorTreeRunner,
  buildExecutableBehaviorTree,
  normalizeTaskConstructorArgs,
  taskLevel,
  taskPriority,
  taskTreeClassName,
  validateExecutableBehaviorTree
} = require("../src/behavior/executableBehaviorTree");
const { LlmTaskQueue } = require("../src/llm/taskQueue");
const { PriorityTaskQueue } = require("../src/survival/priorityTaskQueue");
const { SurvivalController } = require("../src/survival/SurvivalController");

test("executable behavior tree binds task priority and action nodes", () => {
  const tree = buildExecutableBehaviorTree("collect_wood", { sourceAgent: "survival_agent", constructorArgs: { quantity: 3, position: { x: 5, y: 64, z: 0 }, tool: "hand" } });

  assert.equal(tree.taskType, "collect_wood");
  assert.equal(tree.treeClass, "CollectWoodTree");
  assert.equal(tree.taskFunction, "collectWood");
  assert.equal(taskTreeClassName("collect_wood"), "CollectWoodTree");
  assert.deepEqual(tree.constructorArgs, { count: 3, tool: "hand", targetPosition: { x: 5, y: 64, z: 0 } });
  assert.deepEqual(tree.parameters, tree.constructorArgs);
  assert.equal(tree.parameterSchema.count.includes("logs"), true);
  assert.equal(tree.priority, taskPriority("collect_wood"));
  assert.equal(tree.level, taskLevel("collect_wood"));
  assert.equal(tree.sourceAgent, "survival_agent");
  assert.deepEqual(tree.nodes.map((node) => node.id), [
    "prepare_wood_tool",
    "collect_wood_loop"
  ]);
  assert.equal(tree.nodes[1].kind, "loop");
  assert.deepEqual(tree.nodes[1].nodes.map((node) => node.id), [
    "locate_low_log",
    "explore_if_no_wood",
    "collect_wood_batch",
    "verify_wood_gain"
  ]);
  assert.equal(validateExecutableBehaviorTree(tree).ok, true);
});

test("hunt_food executable behavior tree uses search-track-approach-attack-collect-verify chain", () => {
  const tree = buildExecutableBehaviorTree("hunt_food", { sourceAgent: "survival_agent" });

  assert.deepEqual(tree.nodes.map((node) => node.id), [
    "prepare_hunt",
    "scan_hunt_targets",
    "track_hunt_target",
    "approach_hunt_target",
    "attack_hunt_target",
    "collect_hunt_drops",
    "verify_hunt_gain"
  ]);
  assert.equal(validateExecutableBehaviorTree(tree).ok, true);
});

test("task constructor args normalize aliases like function parameters", () => {
  assert.deepEqual(normalizeTaskConstructorArgs("explore", {
    args: { area: "10x10", radius: "10" },
    target: { x: "1", y: "64", z: "2" },
    mode: "safe_scan"
  }), {
    radius: 10,
    mode: "safe_scan",
    area: "10x10",
    targetPosition: { x: 1, y: 64, z: 2 }
  });
  assert.deepEqual(normalizeTaskConstructorArgs("collect_wood", { count: 3, tool: "hand" }), {
    count: 3,
    tool: "hand"
  });
});

test("behavior execution queue orders trees by preset priority", () => {
  const queue = new BehaviorExecutionQueue();
  queue.enqueueTask("explore", { sourceAgent: "survival_agent" });
  queue.enqueueTask("escape_pit", { sourceAgent: "safety_agent" });

  assert.equal(queue.peek().taskType, "escape_pit");
  const started = queue.startNext({ ruleDecision: "escape_pit" });
  assert.equal(started.taskType, "escape_pit");
  queue.completeCurrent("completed", { reason: "verified" });
  assert.equal(queue.getStatus().completedTrees[0].taskType, "escape_pit");
});

test("behavior runner executes action nodes and verifies wood gain", async () => {
  const phases = [];
  const observations = [];
  let inventoryItems = [];
  const controller = {
    mcData: { blocksByName: { oak_log: { id: 1 } } },
    bot: {
      health: 20,
      food: 20,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => inventoryItems },
      findBlocks: () => [new Vec3(4, 64, 0)]
    },
    hasValidPosition: (position) => Number.isFinite(position?.x),
    markTaskPhase: (id, label, status) => phases.push({ id, label, status }),
    recordTaskObservation: (kind, message) => observations.push({ kind, message }),
    recordActionFailure: () => assert.fail("wood tree should not fail"),
    ensureWoodcuttingTool: async () => true,
    executePrimitive: async (decision) => {
      assert.equal(decision.type, "collect_wood");
      assert.equal(decision.targetCount, 3);
      assert.deepEqual(decision.taskParameters.targetPosition, { x: 4, y: 64, z: 0 });
      inventoryItems = [{ name: "oak_log", count: 4 }];
      return true;
    }
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("collect_wood", { constructorArgs: { count: 3, targetPosition: { x: 4, y: 64, z: 0 } } }), controller, { type: "collect_wood" });

  assert.equal(ok, true);
  assert.ok(phases.filter((phase) => phase.status === "completed").length >= 4);
  assert.ok(observations.some((observation) => /completed executable behavior tree/.test(observation.message)));
});

test("collect wood behavior tree can explore and loop before succeeding", async () => {
  let inventoryItems = [];
  let collectAttempts = 0;
  let exploreAttempts = 0;
  const controller = {
    mcData: { blocksByName: { oak_log: { id: 1 } } },
    bot: {
      health: 20,
      food: 20,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => inventoryItems },
      findBlocks: () => (exploreAttempts > 0 ? [new Vec3(8, 64, 0)] : [])
    },
    hasValidPosition: (position) => Number.isFinite(position?.x),
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: () => assert.fail("loop should recover before final failure"),
    ensureWoodcuttingTool: async () => true,
    explore: async () => {
      exploreAttempts++;
      return true;
    },
    executePrimitive: async (decision) => {
      assert.equal(decision.type, "collect_wood");
      collectAttempts++;
      if (collectAttempts >= 2) inventoryItems = [{ name: "oak_log", count: 4 }];
      return true;
    }
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("collect_wood", { constructorArgs: { count: 4 } }), controller, { type: "collect_wood" });

  assert.equal(ok, true);
  assert.equal(exploreAttempts, 1);
  assert.equal(collectAttempts, 2);
});

test("behavior runner treats inventory item changes as task progress", async () => {
  let inventoryItems = [{ name: "oak_planks", count: 3 }, { name: "stick", count: 2 }];
  const controller = {
    bot: {
      health: 20,
      food: 20,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => inventoryItems }
    },
    hasValidPosition: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: () => assert.fail("inventory-changing craft task should count as progress"),
    executePrimitive: async (decision) => {
      assert.equal(decision.type, "craft_basic_tools");
      inventoryItems = [{ name: "wooden_pickaxe", count: 1 }];
      return true;
    }
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("craft_basic_tools"), controller, { type: "craft_basic_tools" });

  assert.equal(ok, true);
});

test("behavior runner feeds failed postconditions into task feedback", async () => {
  const failures = [];
  const controller = {
    mcData: { blocksByName: { oak_log: { id: 1 } } },
    bot: {
      health: 20,
      food: 20,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => [] },
      findBlocks: () => []
    },
    hasValidPosition: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: (action, reason, position, details) => failures.push({ action, reason, position, details }),
    ensureWoodcuttingTool: async () => true,
    executePrimitive: async () => true
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("collect_wood"), controller, { type: "collect_wood" });

  assert.equal(ok, false);
  assert.equal(failures[0].action, "collect_wood");
  assert.equal(failures[0].reason, "wood_inventory_not_increased");
  assert.equal(failures[0].details.behaviorTreeId.startsWith("bt:"), true);
});

test("hunt food tree accepts controller target selection envelopes", async () => {
  const target = { id: 7, name: "cow", position: new Vec3(3, 64, 0) };
  let inventoryItems = [];
  const bot = {
    health: 20,
    food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => inventoryItems },
    entities: { 7: target },
    pvp: {
      attack: () => { delete bot.entities[7]; },
      stop: () => {}
    }
  };
  const controller = {
    bot,
    config: { survival: { actionTimeoutMs: 2000 } },
    hasValidPosition: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: () => assert.fail("hunt tree should unwrap the selected animal"),
    equipBestWeapon: async () => true,
    selectHuntFoodTarget: () => ({ animal: target, landAnimal: target, aquaticAnimal: null, candidates: [target] }),
    gotoNear: async () => true,
    collectNearbyItems: async () => { inventoryItems = [{ name: "beef", count: 1 }]; },
    wait: async () => {}
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("hunt_food"), controller, { type: "hunt_food" });

  assert.equal(ok, true);
});

test("hunt food tree uses dynamic entity tracking when controller supports it", async () => {
  const target = { id: 7, name: "cow", position: new Vec3(3, 64, 0) };
  let inventoryItems = [];
  let gotoEntityCall = null;
  const bot = {
    health: 20,
    food: 20,
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => inventoryItems },
    entities: { 7: target },
    pvp: {
      attack: () => { delete bot.entities[7]; },
      stop: () => {}
    }
  };
  const controller = {
    bot,
    config: { survival: { actionTimeoutMs: 2000 } },
    hasValidPosition: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: () => assert.fail("hunt tree should not fail"),
    ensureHuntingWeapon: async () => true,
    selectHuntFoodTarget: () => ({ animal: target, landAnimal: target, aquaticAnimal: null, candidates: [target] }),
    gotoEntity: async (entity, range, options) => {
      gotoEntityCall = { entity, range, options };
      return true;
    },
    collectNearbyItems: async () => { inventoryItems = [{ name: "beef", count: 1 }]; },
    wait: async () => {}
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("hunt_food"), controller, { type: "hunt_food" });

  assert.equal(ok, true);
  assert.equal(gotoEntityCall.entity, target);
  assert.equal(gotoEntityCall.range, 2.5);
  assert.equal(gotoEntityCall.options.target, "cow");
});

test("hunt food tree low oxygen escape failure is non-blocking feedback", async () => {
  const target = { id: 9, name: "salmon", position: new Vec3(4, 62, 0) };
  const failures = [];
  let escaped = false;
  const controller = {
    bot: {
      health: 20,
      food: 10,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => [] },
      entities: { 9: target },
      pvp: { attack: () => {}, stop: () => {} }
    },
    config: { survival: { actionTimeoutMs: 2000 } },
    hasValidPosition: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: (action, reason, position, details) => failures.push({ action, reason, position, details }),
    ensureHuntingWeapon: async () => true,
    selectHuntFoodTarget: () => ({ animal: target, landAnimal: null, aquaticAnimal: target, candidates: [target] }),
    isLowOxygen: () => true,
    escapeLowOxygen: async () => {
      escaped = true;
      return true;
    },
    collectNearbyItems: async () => {},
    wait: async () => {}
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("hunt_food"), controller, { type: "hunt_food" });

  assert.equal(ok, false);
  assert.equal(escaped, true);
  assert.equal(failures[0].reason, "low_oxygen_escape");
  assert.equal(failures[0].details.taskFeedback, false);
});

test("hunt food tree delegates to primitive when no direct target exists", async () => {
  const controller = {
    bot: {
      health: 20,
      food: 14,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => [] }
    },
    config: { survival: { foodSearchRadius: 32, actionTimeoutMs: 2000 } },
    hasValidPosition: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: () => assert.fail("hunt tree should delegate rather than fail target validation"),
    equipBestWeapon: async () => true,
    selectHuntFoodTarget: () => ({ animal: null, landAnimal: null, aquaticAnimal: null, candidates: [] }),
    executePrimitive: async (decision) => {
      assert.equal(decision.type, "hunt_food");
      return true;
    }
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("hunt_food"), controller, { type: "hunt_food" });

  assert.equal(ok, true);
});

test("passive safety behavior trees do not require movement progress", async () => {
  const controller = {
    bot: {
      health: 20,
      food: 20,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => [] }
    },
    hasValidPosition: () => true,
    markTaskPhase: () => {},
    recordTaskObservation: () => {},
    recordActionFailure: () => assert.fail("hold_position should not be blocked for staying still"),
    executePrimitive: async () => true
  };
  const runner = new ExecutableBehaviorTreeRunner();

  const ok = await runner.execute(buildExecutableBehaviorTree("hold_position"), controller, { type: "hold_position" });

  assert.equal(ok, true);
});

test("general agent wakes the survival agent and proposes a behavior tree", () => {
  const orchestrator = new AgentOrchestrator();
  const result = orchestrator.tick({
    ruleDecision: { type: "collect_wood", reason: "need logs" },
    progress: { stage: "wood_age" },
    behaviorQueue: { hasTask: () => false }
  });

  assert.equal(result.status.generalAgent.active, true);
  assert.equal(result.status.agents.find((agent) => agent.id === "survival_agent").active, true);
  assert.equal(result.proposals[0].tree.taskType, "collect_wood");
  assert.equal(result.proposals[0].tree.sourceAgent, "survival_agent");
});

test("general agent redirects blocked rule tasks to recovery behavior trees", () => {
  const orchestrator = new AgentOrchestrator();
  const result = orchestrator.tick({
    ruleDecision: { type: "hunt_food", reason: "food low" },
    progress: { stage: "food_buffer" },
    behaviorQueue: { hasTask: () => false },
    taskFeedback: {
      blockedTasks: [{ taskType: "hunt_food", reason: "no_food_source_found", recoveryTasks: ["explore", "collect_wood"] }]
    }
  });

  assert.equal(result.status.generalAgent.active, true);
  assert.equal(result.proposals[0].tree.taskType, "explore");
  assert.equal(result.proposals[0].tree.metadata.blockedTask, "hunt_food");
  assert.match(result.proposals[0].tree.reason, /blocked hunt_food to explore/);
});

test("general agent backs off recently failed behavior tree proposals", () => {
  const orchestrator = new AgentOrchestrator({ failedProposalCooldownMs: 60000 });
  orchestrator.recordFeedback({ taskType: "hunt_food", outcome: "failed", reason: "postcondition_failed" });

  const result = orchestrator.tick({
    ruleDecision: { type: "hunt_food", reason: "need food" },
    progress: { stage: "food_buffer" },
    behaviorQueue: { hasTask: () => false }
  });

  assert.deepEqual(result.proposals, []);
});

test("controller primitive execution propagates failed task results", async () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.huntFood = async () => false;

  const result = await controller.executePrimitive({ type: "hunt_food" });

  assert.equal(result, false);
});

test("controller records successful task results into map memory", () => {
  const blockPosition = new Vec3(5, 64, 0);
  const feedback = [];
  const observations = [];
  const controller = Object.create(SurvivalController.prototype);
  controller.memory = { knownBlocks: {}, learning: { policyStats: {}, avoidedPositions: [] } };
  controller.mcData = { blocksByName: { oak_log: { id: 1 }, stone: { id: 2 } } };
  controller.bot = {
    game: { dimension: "overworld" },
    entity: { position: new Vec3(0, 64, 0) },
    findBlocks: ({ matching }) => {
      assert.deepEqual(matching, [1, 2]);
      return [blockPosition];
    },
    blockAt: (position) => ({ name: "oak_log", position })
  };
  controller.logger = { info() {}, warn() {} };
  controller.progressState = {};
  controller.config = { memory: { enabled: false } };
  controller.hasValidPosition = (position) => Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z);
  controller.persistMemory = () => true;
  controller.recordTaskObservation = (kind, message, details) => observations.push({ kind, message, details });
  controller.agentOrchestrator = { recordFeedback: (entry) => feedback.push(entry) };

  const remembered = controller.recordTaskResultToMapMemory({ type: "explore", sourceAgent: "survival_agent", sourcePlanId: "plan-1" });

  assert.equal(remembered.length, 1);
  assert.equal(controller.memory.knownBlocks.oak_log[0].position.x, 5);
  assert.equal(controller.memory.knownBlocks.oak_log[0].dimension, "overworld");
  assert.equal(observations[0].kind, "map_memory");
  assert.equal(feedback[0].outcome, "map_memory_updated");
});

test("controller selects queued behavior trees before the LLM task queue", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskQueue = new LlmTaskQueue({ taskQueueEnabled: true });
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.behaviorQueue.enqueueTask("collect_wood", { sourceAgent: "survival_agent" });

  const decision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "collect_wood", reason: "need logs" });

  assert.equal(decision.type, "collect_wood");
  assert.equal(decision.behaviorTreeQueued, true);
  assert.equal(decision.behaviorTree.taskType, "collect_wood");
  assert.equal(controller.behaviorQueue.getStatus().currentTree.taskType, "collect_wood");
});

test("controller accepts LLM behavior tree plans into the behavior queue", () => {
  let queueDecision = null;
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskQueue = new LlmTaskQueue({ taskQueueEnabled: true });
  controller.llmPlanner = {
    noteQueueDecision(result) {
      queueDecision = result;
    }
  };

  controller.handlePlannerResult({
    status: "ok",
    plan: {
      id: "plan-1",
      goal: "collect starter wood",
      tasks: ["collect_wood"],
      behaviorTrees: [{ taskType: "collect_wood", priority: 620, reason: "need logs" }],
      validation: { ok: true, unknownTasks: [] },
      ruleDecision: "collect_wood"
    }
  });

  assert.equal(queueDecision.accepted, true);
  assert.equal(controller.behaviorQueue.getStatus().pendingTrees[0].taskType, "collect_wood");
  assert.equal(controller.taskQueue.getStatus().pendingTasks.length, 0);
});

test("controller accepts Python Brain behavior tree plans into the behavior queue", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.config = { llm: { model: "test", baseHost: "example.test" } };
  controller.logger = { warn() {} };
  controller.pythonBrainClient = { publish: (update) => ({ enabled: true, ...update }) };
  let llmState = null;
  controller.statusReporter = { setLlmState: (state) => { llmState = state; } };

  const result = controller.handlePythonBrainPlanResult({
    plan: { stageAssessment: "need logs", behaviorTrees: [{ taskType: "collect_wood" }] },
    trees: [buildExecutableBehaviorTree("collect_wood", { source: "python_brain", sourceAgent: "survival_agent" })]
  });

  assert.deepEqual(result.acceptedTasks, ["collect_wood"]);
  assert.equal(controller.behaviorQueue.getStatus().pendingTrees[0].taskType, "collect_wood");
  assert.equal(llmState.status, "python_brain_queued");
});

test("LLM behavior tree priority is forced to the preset task priority", () => {
  const queue = new BehaviorExecutionQueue();

  const result = queue.enqueuePlan({
    behaviorTrees: [{ taskType: "wait_out_night", priority: 9999, reason: "model requested high priority" }]
  }, { source: "llm_planner", sourcePlanId: "plan-priority" });

  assert.equal(result.accepted, true);
  assert.equal(queue.getStatus().pendingTrees[0].priority, taskPriority("wait_out_night"));
});

test("behavior queue skips non-recovery trees when the rule task is blocked", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskFeedback = {
    recentFailures: [],
    blockedTasks: {
      collect_wood: {
        taskType: "collect_wood",
        reason: "path_timeout",
        failureCount: 2,
        recoveryTasks: ["explore"],
        expiresAt: new Date(Date.now() + 60000).toISOString()
      }
    },
    lastEvent: null
  };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.agentOrchestrator = { recordFeedback() {} };
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [
    { taskType: "collect_stone", reason: "bad model recovery would still need wood tools" },
    { taskType: "explore", reason: "move to a new wood search area" }
  ] }, { source: "llm_planner", sourcePlanId: "plan-recovery" });

  const decision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "collect_wood", reason: "need logs" });
  const status = controller.behaviorQueue.getStatus();

  assert.equal(decision.type, "explore");
  assert.equal(decision.behaviorTreeQueued, true);
  assert.equal(status.completedTrees[0].taskType, "collect_stone");
  assert.equal(status.completedTrees[0].status, "skipped");
  assert.equal(status.currentTree.taskType, "explore");
});

test("behavior queue skips stale rule-bound safety trees to reach the active rule tree", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.agentOrchestrator = { recordFeedback() {} };
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [
    { taskType: "evade_hostiles", reason: "model advisory from distant hostiles" },
    { taskType: "defend_self", reason: "model last resort advisory" },
    { taskType: "collect_stone", reason: "active local rule needs stone" }
  ] }, { source: "llm_planner", sourcePlanId: "plan-stale-safety" });

  const decision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "collect_stone", reason: "stone tools required" });
  const status = controller.behaviorQueue.getStatus();
  const skippedTypes = status.completedTrees.map((tree) => tree.taskType).sort();

  assert.equal(decision.type, "collect_stone");
  assert.equal(decision.behaviorTreeQueued, true);
  assert.equal(status.currentTree.taskType, "collect_stone");
  assert.deepEqual(skippedTypes, ["defend_self", "evade_hostiles"]);
});

test("behavior queue skips stale higher-priority head trees to reach the current rule tree", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.agentOrchestrator = { recordFeedback() {} };
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [
    { taskType: "hunt_food", reason: "stale food plan before wood became the active rule" }
  ] }, { source: "llm_planner", sourcePlanId: "plan-stale-food-1" });
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [
    { taskType: "hunt_food", reason: "second stale food plan" }
  ] }, { source: "llm_planner", sourcePlanId: "plan-stale-food-2" });
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [
    { taskType: "collect_wood", reason: "active local rule needs logs" }
  ] }, { source: "llm_planner", sourcePlanId: "plan-active-wood" });

  const decision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "collect_wood", reason: "day1 logs required" });
  const status = controller.behaviorQueue.getStatus();

  assert.equal(decision.type, "collect_wood");
  assert.equal(decision.behaviorTreeQueued, true);
  assert.equal(status.currentTree.taskType, "collect_wood");
  assert.deepEqual(status.completedTrees.map((tree) => tree.taskType), ["hunt_food", "hunt_food"]);
  assert.match(status.completedTrees[0].lastReason, /stale_hunt_food_before_collect_wood/);
});

test("behavior queue skips stale LLM advisory trees even without a runnable tree behind", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.agentOrchestrator = { recordFeedback() {} };
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [
    { taskType: "collect_building_materials", reason: "future daytime task from smart brain" }
  ] }, { source: "llm_planner", sourcePlanId: "plan-future-materials" });

  const decision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "collect_wood", reason: "active local rule needs logs" });
  const status = controller.behaviorQueue.getStatus();

  assert.equal(decision.type, "collect_wood");
  assert.equal(decision.behaviorTreeQueued, undefined);
  assert.equal(status.currentTree, null);
  assert.equal(status.pendingTrees.length, 0);
  assert.equal(status.completedTrees[0].taskType, "collect_building_materials");
  assert.equal(status.completedTrees[0].status, "skipped");
  assert.match(status.completedTrees[0].lastReason, /stale_collect_building_materials_before_collect_wood/);
});

test("behavior queue releases stale current tree before starting the active rule tree", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.agentOrchestrator = { recordFeedback() {} };
  controller.behaviorQueue.enqueueTask("collect_building_materials", {
    source: "llm_planner",
    sourcePlanId: "plan-stale-current",
    reason: "stale in-progress future plan"
  });
  controller.behaviorQueue.startNext({ ruleDecision: "collect_building_materials" });
  controller.behaviorQueue.enqueueTask("collect_wood", {
    source: "llm_planner",
    sourcePlanId: "plan-active-wood",
    reason: "current local rule needs logs"
  });

  const decision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "collect_wood", reason: "active local rule needs logs" });
  const status = controller.behaviorQueue.getStatus();

  assert.equal(decision.type, "collect_wood");
  assert.equal(decision.behaviorTreeQueued, true);
  assert.equal(status.currentTree.taskType, "collect_wood");
  assert.equal(status.completedTrees[0].taskType, "collect_building_materials");
  assert.equal(status.completedTrees[0].status, "failed");
  assert.match(status.completedTrees[0].lastReason, /stale_collect_building_materials_before_collect_wood/);
});

test("behavior queue discards stale hard safety trees during starvation recovery", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.agentOrchestrator = { recordFeedback() {} };
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [
    { taskType: "eat_food", reason: "stale planner expected food" },
    { taskType: "recover_starvation", reason: "active starvation recovery" }
  ] }, { source: "llm_planner", sourcePlanId: "plan-starvation" });

  const decision = controller.selectDecisionWithBehaviorQueue({ health: 1, food: 0, inventory: {} }, { type: "recover_starvation", reason: "no food" });
  const status = controller.behaviorQueue.getStatus();

  assert.equal(decision.type, "recover_starvation");
  assert.equal(decision.behaviorTreeQueued, true);
  assert.equal(status.currentTree.taskType, "recover_starvation");
  assert.equal(status.completedTrees[0].taskType, "eat_food");
  assert.equal(status.completedTrees[0].status, "skipped");
  assert.match(status.completedTrees[0].lastReason, /hard_safety_recover_starvation_priority/);
});

test("behavior queue interrupts an in-progress tree when hard safety takes over", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.config = { survival: { lowFood: 14 } };
  controller.logger = { warn() {} };
  controller.agentOrchestrator = { recordFeedback() {} };
  controller.behaviorQueue.enqueueTask("collect_wood", { sourceAgent: "survival_agent" });

  const firstDecision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "collect_wood", reason: "need logs" });
  controller.behaviorQueue.enqueueTask("evade_hostiles", { sourceAgent: "combat_agent" });
  const safetyDecision = controller.selectDecisionWithBehaviorQueue({ food: 20, inventory: {} }, { type: "evade_hostiles", reason: "zombie pressure" });
  const status = controller.behaviorQueue.getStatus();

  assert.equal(firstDecision.type, "collect_wood");
  assert.equal(safetyDecision.type, "evade_hostiles");
  assert.equal(status.currentTree.taskType, "evade_hostiles");
  assert.equal(status.completedTrees[0].taskType, "collect_wood");
  assert.equal(status.completedTrees[0].status, "failed");
  assert.match(status.completedTrees[0].lastReason, /hard_safety_evade_hostiles_priority/);
});

test("behavior queue accepts smart brain task requests as tree instances", () => {
  const queue = new BehaviorExecutionQueue();

  const result = queue.enqueuePlan({
    brainAgent: "general_agent",
    stageAssessment: "initial day one",
    taskRequests: [{
      requestId: "req-explore-10x10",
      fromAgent: "general_agent",
      assignedAgent: "survival_agent",
      taskType: "explore",
      priority: 9999,
      reason: "initial terrain scan",
      constructorArgs: { area: "10x10", radius: 10, targetPosition: { x: 8, y: 64, z: 4 } }
    }]
  }, { source: "llm_planner", sourcePlanId: "plan-smart-brain" });

  const tree = queue.getStatus().pendingTrees[0];
  assert.equal(result.accepted, true);
  assert.equal(tree.taskType, "explore");
  assert.equal(tree.priority, taskPriority("explore"));
  assert.equal(tree.level, taskLevel("explore"));
  assert.equal(tree.treeClass, "ExploreTree");
  assert.equal(tree.taskFunction, "explore");
  assert.equal(tree.sourceAgent, "survival_agent");
  assert.equal(tree.requestedBy, "general_agent");
  assert.equal(tree.taskRequestId, "req-explore-10x10");
  assert.deepEqual(tree.constructorArgs, { radius: 10, mode: "safe_scan", area: "10x10", targetPosition: { x: 8, y: 64, z: 4 } });
});

test("behavior queue discards superseded pending planner trees without touching current work", () => {
  const queue = new BehaviorExecutionQueue();
  queue.enqueueTask("collect_wood", { source: "llm_planner", sourcePlanId: "plan-current" });
  queue.startNext({ ruleDecision: "collect_wood" });
  queue.enqueueTask("explore", { source: "llm_planner", sourcePlanId: "plan-old" });
  queue.enqueueTask("hunt_food", { source: "agent_orchestrator", sourcePlanId: "local-food" });

  const event = queue.discardPendingBySource("llm_planner", "planner_superseded", { planId: "plan-new" });
  const status = queue.getStatus();

  assert.equal(event.removed, 1);
  assert.equal(status.currentTree.taskType, "collect_wood");
  assert.deepEqual(status.pendingTrees.map((tree) => tree.taskType), ["hunt_food"]);
  assert.equal(status.completedTrees[0].taskType, "explore");
  assert.equal(status.completedTrees[0].status, "skipped");
  assert.equal(status.completedTrees[0].lastReason, "planner_superseded");
});

test("controller rejects stale planner behavior plans when the live rule is no longer queueable", () => {
  const decisions = [];
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskQueue = new LlmTaskQueue({ taskQueueEnabled: true });
  controller.llmPlanner = { noteQueueDecision: (decision) => decisions.push(decision), publish() {} };
  controller.logger = { warn() {}, debug() {} };
  controller.config = { survival: { criticalHealth: 6, lowOxygenThreshold: 8, immediateThreatRadius: 8, lowFood: 14 } };
  controller.emergencyBusy = false;
  controller.getLivePlannerQueueContext = () => ({
    ok: true,
    snapshot: { health: 20, food: 20, oxygen: 20, environmentHazard: false, navigationTrap: false, isInLava: false, entities: [], inventory: {} },
    ruleDecision: { type: "wait_out_night", reason: "night safety" }
  });

  controller.handlePlannerResult({
    status: "ok",
    plan: { id: "plan-stale-day", ruleDecision: "collect_wood", behaviorTrees: [{ taskType: "collect_wood" }] }
  });

  assert.equal(controller.behaviorQueue.getStatus().pendingTrees.length, 0);
  assert.equal(decisions[0].accepted, false);
  assert.match(decisions[0].reason, /live_rule_wait_out_night_not_queueable/);
});

test("controller supersedes old pending planner trees before queuing the newest live plan", () => {
  const decisions = [];
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskQueue = new LlmTaskQueue({ taskQueueEnabled: true });
  controller.llmPlanner = { noteQueueDecision: (decision) => decisions.push(decision), publish() {} };
  controller.logger = { warn() {}, debug() {} };
  controller.config = { survival: { criticalHealth: 6, lowOxygenThreshold: 8, immediateThreatRadius: 8, lowFood: 14 } };
  controller.emergencyBusy = false;
  controller.getLivePlannerQueueContext = () => ({
    ok: true,
    snapshot: { health: 20, food: 20, oxygen: 20, environmentHazard: false, navigationTrap: false, isInLava: false, entities: [], inventory: {} },
    ruleDecision: { type: "collect_wood", reason: "need logs" }
  });
  controller.behaviorQueue.enqueuePlan({ behaviorTrees: [{ taskType: "explore" }] }, { source: "llm_planner", sourcePlanId: "plan-old" });

  controller.handlePlannerResult({
    status: "ok",
    plan: { id: "plan-new", ruleDecision: "collect_wood", behaviorTrees: [{ taskType: "collect_wood" }] }
  });
  const status = controller.behaviorQueue.getStatus();

  assert.deepEqual(status.pendingTrees.map((tree) => tree.taskType), ["collect_wood"]);
  assert.equal(status.completedTrees[0].taskType, "explore");
  assert.equal(status.completedTrees[0].status, "skipped");
  assert.equal(status.completedTrees[0].lastReason, "planner_superseded");
  assert.equal(decisions[0].accepted, true);
});

test("controller releases all active queue types when current work is interrupted", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.taskQueue = new LlmTaskQueue({ taskQueueEnabled: true });
  controller.priorityTaskQueue = new PriorityTaskQueue({ allowedTasks: new Set(["explore", "collect_wood"]) });
  controller.testTaskQueue = new PriorityTaskQueue({ allowedTasks: new Set(["explore", "collect_wood"]) });
  controller.reportBehaviorTreeFeedback = () => {};
  controller.publishTaskQueueStatus = () => {};
  controller.logger = { warn() {} };

  controller.behaviorQueue.enqueueTask("collect_wood");
  controller.behaviorQueue.startNext({ ruleDecision: "collect_wood" });
  controller.taskQueue.enqueuePlan({ tasks: ["explore"] });
  controller.taskQueue.startNext({ ruleDecision: "explore" });
  controller.priorityTaskQueue.insert("explore");
  controller.priorityTaskQueue.startNext({ ruleDecision: "explore" });
  controller.testTaskQueue.insert("collect_wood");
  controller.testTaskQueue.startNext({ ruleDecision: "collect_wood" });

  const released = controller.releaseCurrentQueuedWork("busy_trace_stale", { ruleDecision: "collect_wood" });

  assert.equal(released, true);
  assert.equal(controller.behaviorQueue.getStatus().currentTree, null);
  assert.equal(controller.taskQueue.getStatus().currentTask, null);
  assert.equal(controller.priorityTaskQueue.getStatus().currentTask, null);
  assert.equal(controller.testTaskQueue.getStatus().currentTask, null);
  assert.equal(controller.behaviorQueue.getStatus().completedTrees[0].status, "failed");
  assert.equal(controller.priorityTaskQueue.getStatus().completedTasks[0].status, "failed");
  assert.equal(controller.testTaskQueue.getStatus().completedTasks[0].status, "failed");
});

test("busy watchdog gives long safety tasks a wider running stale window", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.behaviorQueue = new BehaviorExecutionQueue();
  controller.behaviorQueue.enqueueTask("wait_out_night");
  controller.behaviorQueue.startNext({ ruleDecision: "wait_out_night" });
  controller.config = { survival: { busyTraceStaleMs: 15000 } };
  controller.emergencyBusy = false;
  controller.busyWatchdogLastWarnAt = 0;
  controller.lastAction = { type: "wait_out_night", startedAt: Date.now() - 30000 };
  controller.taskTrace = { status: "running", taskType: "wait_out_night", updatedAt: new Date(Date.now() - 30000).toISOString() };
  controller.publishControllerState = () => {};
  controller.recordTaskObservation = () => {};
  controller.markCurrentActionInterrupted = () => {};
  controller.resetMotion = () => {};
  controller.cancelCollectTask = async () => {};
  controller.logger = { warn() {} };

  const interrupted = controller.checkBusyWatchdog();

  assert.equal(interrupted, false);
  assert.equal(controller.behaviorQueue.getStatus().currentTree.taskType, "wait_out_night");
});

test("evade hostile behavior tree accepts stable distance outside the immediate buffer", async () => {
  const runner = new ExecutableBehaviorTreeRunner();
  const tree = buildExecutableBehaviorTree("evade_hostiles");
  const hostile = { name: "spider", position: new Vec3(20, 64, 0) };
  const controller = {
    config: { survival: { immediateThreatRadius: 8, safeModeThreatRadius: 28 } },
    bot: {
      health: 20,
      food: 20,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => [] }
    },
    hasValidPosition: (position) => Boolean(position),
    nearestEntity: () => hostile,
    executePrimitive: async () => true,
    recordTaskObservation() {},
    markTaskPhase() {},
    recordActionFailure() {}
  };

  const result = await runner.execute(tree, controller, { type: "evade_hostiles" });

  assert.equal(result, true);
});

test("controller keeps passive behavior trees open while their rule remains active", () => {
  const controller = Object.create(SurvivalController.prototype);

  assert.equal(controller.shouldKeepPassiveBehaviorTreeOpen(
    { type: "wait_out_night", behaviorTreeQueued: true },
    { type: "wait_out_night" },
    { isNight: true }
  ), true);
  assert.equal(controller.shouldKeepPassiveBehaviorTreeOpen(
    { type: "wait_out_night", behaviorTreeQueued: true },
    { type: "wait_out_night" },
    { isNight: false }
  ), false);
  assert.equal(controller.shouldKeepPassiveBehaviorTreeOpen(
    { type: "hold_position", behaviorTreeQueued: true },
    { type: "hold_position" },
    {}
  ), true);
});
