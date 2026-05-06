const assert = require("node:assert/strict");
const test = require("node:test");
const { LlmTaskQueue } = require("../src/llm/taskQueue");
const { SurvivalController } = require("../src/survival/SurvivalController");

function createController() {
  const controller = Object.create(SurvivalController.prototype);
  controller.config = {
    llm: { taskQueueEnabled: true },
    survival: { criticalHealth: 8, immediateThreatRadius: 8 }
  };
  controller.emergencyBusy = false;
  controller.taskQueue = new LlmTaskQueue({ taskQueueEnabled: true });
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.llmPlanner = { publish() {}, noteQueueDecision() {} };
  return controller;
}

function safeSnapshot(overrides = {}) {
  return {
    health: 20,
    environmentHazard: null,
    navigationTrap: false,
    isInLava: false,
    entities: [],
    ...overrides
  };
}

test("controller uses a queued task when it matches the rule decision", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "wood", tasks: ["collect_wood"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "collect_wood", reason: "rule wants wood" });

  assert.equal(decision.type, "collect_wood");
  assert.equal(decision.llmQueued, true);
  assert.match(decision.reason, /LLM queued task/);
  assert.equal(controller.taskQueue.getStatus().currentTask.type, "collect_wood");
});

test("controller may replace exploration with a queued safe task", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "food", tasks: ["hunt_food"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "explore", reason: "stable" });

  assert.equal(decision.type, "hunt_food");
  assert.equal(decision.llmQueued, true);
});

test("controller pauses queued tasks when rule priority should stay in control", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "food", tasks: ["hunt_food"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "collect_wood", reason: "wood required" });

  assert.equal(decision.type, "collect_wood");
  assert.equal(decision.llmQueued, undefined);
  assert.equal(controller.taskQueue.getStatus().lastEvent.reason, "rule_collect_wood_priority");
});

test("controller skips stale queued heads when a later task matches the current rule", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "stale food then wood", tasks: ["hunt_food", "collect_wood"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "collect_wood", reason: "wood required" });
  const queueStatus = controller.taskQueue.getStatus();

  assert.equal(decision.type, "collect_wood");
  assert.equal(decision.llmQueued, true);
  assert.equal(queueStatus.currentTask.type, "collect_wood");
  assert.equal(queueStatus.completedTasks[0].type, "hunt_food");
  assert.equal(queueStatus.completedTasks[0].status, "skipped");
  assert.match(queueStatus.completedTasks[0].lastReason, /stale_hunt_food_before_collect_wood/);
});

test("controller lets LLM queued recovery task replace a blocked rule task", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.collect_wood = {
    taskType: "collect_wood",
    reason: "path_timeout",
    failureCount: 2,
    recoveryTasks: ["explore"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
  controller.taskQueue.enqueuePlan({ goal: "recover from blocked wood search", tasks: ["explore"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "collect_wood", reason: "wood required" });

  assert.equal(decision.type, "explore");
  assert.equal(decision.llmQueued, true);
});

test("controller skips blocked queued tasks to reach a recovery task", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.collect_wood = {
    taskType: "collect_wood",
    reason: "path_timeout",
    failureCount: 2,
    recoveryTasks: ["explore"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
  controller.taskQueue.enqueuePlan({ goal: "recover from blocked wood search", tasks: ["collect_wood", "explore"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "collect_wood", reason: "wood required" });
  const queueStatus = controller.taskQueue.getStatus();

  assert.equal(decision.type, "explore");
  assert.equal(decision.llmQueued, true);
  assert.equal(queueStatus.completedTasks[0].type, "collect_wood");
  assert.equal(queueStatus.completedTasks[0].status, "skipped");
  assert.equal(queueStatus.completedTasks[0].lastReason, "blocked_collect_wood");
});

test("controller skips unrelated queued tasks when a blocked rule task has explicit recovery tasks", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.collect_wood = {
    taskType: "collect_wood",
    reason: "path_timeout",
    failureCount: 2,
    recoveryTasks: ["explore"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
  controller.taskQueue.enqueuePlan({ goal: "bad model recovery order", tasks: ["collect_stone", "explore"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "collect_wood", reason: "wood required" });
  const queueStatus = controller.taskQueue.getStatus();

  assert.equal(decision.type, "explore");
  assert.equal(decision.llmQueued, true);
  assert.equal(queueStatus.completedTasks[0].type, "collect_stone");
  assert.equal(queueStatus.completedTasks[0].status, "skipped");
  assert.equal(queueStatus.currentTask.type, "explore");
});

test("controller does not let LLM replace blocked food search with unrelated work", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.hunt_food = {
    taskType: "hunt_food",
    reason: "safe_position_unreachable",
    failureCount: 2,
    recoveryTasks: ["explore"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
  controller.taskQueue.enqueuePlan({ goal: "recover from blocked food search", tasks: ["collect_wood"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot({ food: 5, inventory: {} }), { type: "hunt_food", reason: "food low" });

  assert.equal(decision.type, "hunt_food");
  assert.equal(decision.llmQueued, undefined);
  assert.equal(controller.taskQueue.getStatus().lastEvent.reason, "rule_hunt_food_priority");
});

test("controller lets LLM food recovery tasks run during starvation recovery", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "recover food", tasks: ["explore", "hunt_food"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot({ health: 7, food: 17, inventory: {} }), {
    type: "recover_starvation",
    reason: "critical health and no immediate food"
  });

  assert.equal(decision.type, "explore");
  assert.equal(decision.llmQueued, true);
  assert.equal(decision.ruleDecision, "recover_starvation");
});

test("controller blocks unrelated LLM work during starvation recovery", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "build tools", tasks: ["collect_wood"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot({ health: 7, food: 17, inventory: {} }), {
    type: "recover_starvation",
    reason: "critical health and no immediate food"
  });

  assert.equal(decision.type, "recover_starvation");
  assert.equal(decision.llmQueued, undefined);
  const queueStatus = controller.taskQueue.getStatus();
  assert.equal(queueStatus.lastEvent.type, "skipped");
  assert.equal(queueStatus.lastEvent.reason, "rule_recover_starvation_priority");
  assert.equal(queueStatus.completedTasks[0].type, "collect_wood");
  assert.equal(queueStatus.completedTasks[0].status, "skipped");
});

test("controller skips unrelated starvation queue tasks to reach food recovery", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "recover food after moving", tasks: ["collect_wood", "hunt_food"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot({ health: 7, food: 17, inventory: {} }), {
    type: "recover_starvation",
    reason: "critical health and no immediate food"
  });

  const queueStatus = controller.taskQueue.getStatus();
  assert.equal(decision.type, "hunt_food");
  assert.equal(decision.llmQueued, true);
  assert.equal(queueStatus.currentTask.type, "hunt_food");
  assert.equal(queueStatus.completedTasks[0].type, "collect_wood");
  assert.equal(queueStatus.completedTasks[0].status, "skipped");
});

test("controller does not let LLM repeat the same blocked task", () => {
  const controller = createController();
  controller.taskFeedback.blockedTasks.hunt_food = {
    taskType: "hunt_food",
    reason: "safe_position_unreachable",
    failureCount: 2,
    recoveryTasks: ["explore"],
    expiresAt: new Date(Date.now() + 60000).toISOString()
  };
  controller.taskQueue.enqueuePlan({ goal: "retry blocked food search", tasks: ["hunt_food"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot(), { type: "hunt_food", reason: "food low" });

  assert.equal(decision.type, "hunt_food");
  assert.equal(decision.llmQueued, undefined);
  const queueStatus = controller.taskQueue.getStatus();
  assert.equal(queueStatus.lastEvent.reason, "blocked_hunt_food");
  assert.equal(queueStatus.completedTasks[0].type, "hunt_food");
  assert.equal(queueStatus.completedTasks[0].status, "skipped");
});

test("controller blocks task queue during hard safety decisions", () => {
  const controller = createController();
  controller.taskQueue.enqueuePlan({ goal: "wood", tasks: ["collect_wood"] });

  const decision = controller.selectDecisionWithTaskQueue(safeSnapshot({ environmentHazard: { name: "lava", distance: 1 } }), { type: "escape_hazard", reason: "hazard" });

  assert.equal(decision.type, "escape_hazard");
  assert.equal(controller.taskQueue.getStatus().lastEvent.reason, "safety_window_closed");
});

test("controller queues a valid planner result and reports acceptance", () => {
  const controller = createController();
  let queueDecision = null;
  controller.llmPlanner = {
    publish() {},
    noteQueueDecision(result) {
      queueDecision = result;
    }
  };

  controller.handlePlannerResult({
    status: "ok",
    plan: {
      goal: "secure food",
      tasks: ["hunt_food", "eat_food"],
      validation: { ok: true, unknownTasks: [] },
      ruleDecision: "hunt_food"
    }
  });

  assert.equal(queueDecision.accepted, true);
  assert.deepEqual(queueDecision.skippedTasks, ["eat_food"]);
  assert.deepEqual(controller.taskQueue.getStatus().pendingTasks.map((task) => task.type), ["hunt_food"]);

  controller.handlePlannerResult({
    status: "ok",
    plan: {
      goal: "secure food",
      tasks: ["hunt_food", "collect_wood"],
      validation: { ok: true, unknownTasks: [] },
      ruleDecision: "hunt_food"
    }
  });

  assert.equal(queueDecision.accepted, true);
  assert.deepEqual(controller.taskQueue.getStatus().pendingTasks.map((task) => task.type), ["hunt_food", "collect_wood"]);
});