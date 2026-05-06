const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { createBehaviorTree, flattenBehaviorTree } = require("../src/dashboard/behaviorTree");
const { createDashboardState } = require("../src/dashboard/statusHub");

test("behavior tree marks the active decision node", () => {
  const tree = createBehaviorTree("wait_out_night");
  const activeNodes = flattenBehaviorTree(tree).filter((node) => node.active);

  assert.equal(activeNodes.length, 1);
  assert.equal(activeNodes[0].id, "wait_out_night");
  assert.equal(activeNodes[0].groupId, "night");
});

test("behavior tree exposes active phases for detailed tasks", () => {
  const tree = createBehaviorTree("hunt_food", {
    taskType: "hunt_food",
    activePhaseId: "attack_animal",
    phaseEvents: [
      { id: "prepare", status: "completed" },
      { id: "attack_animal", status: "active" }
    ]
  });
  const activeNode = flattenBehaviorTree(tree).find((node) => node.id === "hunt_food");

  assert.equal(activeNode.active, true);
  assert.equal(activeNode.phases.find((phase) => phase.id === "prepare").status, "completed");
  assert.equal(activeNode.phases.find((phase) => phase.id === "attack_animal").active, true);
});

test("behavior tree exposes terrain escape phases", () => {
  const tree = createBehaviorTree("escape_pit", {
    taskType: "escape_pit",
    activePhaseId: "controlled_descent",
    phaseEvents: [
      { id: "scan_environment", status: "completed" },
      { id: "controlled_descent", status: "active" }
    ]
  });
  const activeNode = flattenBehaviorTree(tree).find((node) => node.id === "escape_pit");

  assert.equal(activeNode.label, "脱离地形陷阱");
  assert.equal(activeNode.phases.find((phase) => phase.id === "scan_environment").status, "completed");
  assert.equal(activeNode.phases.find((phase) => phase.id === "controlled_descent").active, true);
});

test("dashboard state publishes sanitized bot status", () => {
  const dashboard = createDashboardState({ host: "localhost", port: 8000, username: "TestBot" });
  dashboard.setConnection({ state: "connected", minecraftVersion: "1.21.11" });
  dashboard.publishTick({
    snapshot: {
      health: 18,
      food: 12,
      oxygen: 20,
      position: new Vec3(1.25, 64, -2.75),
      timeOfDay: 14500,
      isNight: true,
      environmentHazard: null,
      navigationTrap: false,
      navigationAnalysis: {
        trapped: true,
        kind: "elevated_support_column",
        summary: "support column can be descended safely",
        recommendedAction: "controlled_descent",
        sameLevelExitCount: 0,
        blockingSides: 0,
        supportColumnDepth: 6,
        safeSupportDescent: true,
        supportBlock: { name: "stone", solid: true, diggable: true },
        belowSupportBlock: { name: "stone", solid: true, diggable: true },
        routeOptions: ["controlled_descent"]
      },
      isInLava: false,
      timeSinceOnGround: 0,
      inventory: { sweet_berries: 3, cobblestone: 12 },
      entities: [
        { name: "zombie", distance: 7.42, position: new Vec3(4, 64, 0) },
        { name: "cow", distance: 11.1, position: new Vec3(8, 64, 3) }
      ],
      botPerspective: {
        heading: "东",
        yaw: 1.57,
        pitch: -0.2,
        eye: new Vec3(1.25, 65.6, -2.75),
        direction: new Vec3(0.98, 0.2, 0.01),
        targetEntity: { name: "zombie", distance: 7.42, position: new Vec3(4, 64, 0) },
        frontBlocks: [
          { distance: 1, name: "air", solid: false, diggable: false, position: new Vec3(2, 65, -3) },
          { distance: 2, name: "spruce_log", solid: true, diggable: true, position: new Vec3(3, 65, -3) }
        ]
      },
      experience: { level: 1 },
      progress: { hasStarterShelter: false, achievedMilestones: ["wood_age"] }
    },
    decision: { type: "wait_out_night", reason: "nighttime is too dangerous" },
    skillEnvelope: {
      taskType: "wait_out_night",
      primarySkillId: "reusable_shelter",
      skillIds: ["reusable_shelter"],
      plan: {
        ok: true,
        skillId: "reusable_shelter",
        title: "Reusable shelter",
        tasks: ["collect_building_materials", "build_shelter", "wait_out_night"],
        nextTask: "wait_out_night",
        taskCount: 3
      }
    },
    progress: {
      stage: "starter_shelter",
      summary: "8/14",
      next: { id: "starter_shelter", label: "Starter house built" },
      foodCount: 3,
      materialCount: 12,
      milestones: [
        { id: "wood_age", label: "Wood acquired", achieved: true },
        { id: "starter_shelter", label: "Starter house built", achieved: false }
      ]
    },
    memory: {
      knownBlocks: { crafting_table: [{ position: { x: 1, y: 64, z: 1 } }] },
      learning: { policyStats: {}, avoidedPositions: [] }
    },
    dimension: "overworld",
    controller: {
      busy: true,
      emergencyBusy: false,
      lastAction: { type: "wait_out_night", skillId: "reusable_shelter", position: new Vec3(1, 64, -3), startedAt: 100 },
      forcedTask: { taskType: "hunt_food", reason: "berry scenario", source: "dashboard_api", remainingMs: 30000 },
      taskFeedback: {
        blockedTasks: [{ taskType: "hunt_food", reason: "safe_position_unreachable", failureCount: 2, recoveryTasks: ["explore"] }],
        recentFailures: [{ taskType: "hunt_food", action: "forage_food", reason: "safe_position_unreachable", position: new Vec3(4, 80, 4) }]
      },
      testTasks: { pendingTasks: [{ type: "escape_hazard", status: "pending", priority: 100 }] },
      behaviorQueue: {
        active: true,
        currentTree: { id: "bt-1", taskType: "collect_wood", priority: 620, status: "in_progress", sourceAgent: "survival_agent", nodes: [{ id: "locate_low_log", label: "定位低位可达树干", kind: "sense" }] },
        pendingTrees: [],
        completedTrees: [],
        feedback: [{ taskType: "collect_wood", outcome: "started" }]
      },
      agents: {
        generalAgent: { id: "general_agent", active: true },
        agents: [{ id: "survival_agent", active: true, reason: "collect_wood" }],
        lastProposals: [{ taskType: "collect_wood", sourceAgent: "survival_agent" }]
      }
    }
  });

  const status = dashboard.getSnapshot();
  assert.equal(status.connection.state, "connected");
  assert.equal(status.bot.position.text, "1.3, 64, -2.7");
  assert.equal(status.decision.type, "wait_out_night");
  assert.equal(status.skillPlan.primarySkillId, "reusable_shelter");
  assert.equal(status.progress.summary, "8/14");
  assert.equal(status.inventory.totalKinds, 2);
  assert.equal(status.entities[0].name, "zombie");
  assert.equal(status.memory.knownBlocks.crafting_table, 1);
  assert.equal(status.botPerspective.heading, "东");
  assert.equal(status.botPerspective.targetEntity.name, "zombie");
  assert.equal(status.botPerspective.frontBlocks[1].name, "spruce_log");
  assert.equal(status.controller.forcedTask.taskType, "hunt_food");
  assert.equal(status.controller.taskFeedback.blockedTasks[0].taskType, "hunt_food");
  assert.equal(status.controller.taskFeedback.recentFailures[0].position.text, "4, 80, 4");
  assert.equal(status.controller.testTasks.pendingTasks[0].type, "escape_hazard");
  assert.equal(status.controller.behaviorQueue.currentTree.taskType, "collect_wood");
  assert.equal(status.controller.agents.agents[0].id, "survival_agent");
  assert.equal(status.world.navigationAnalysis.kind, "elevated_support_column");
  assert.equal(status.world.navigationAnalysis.recommendedAction, "controlled_descent");
  assert.equal(status.diagnostics.overall, "warning");
  assert.equal(status.diagnostics.signalCounts.warning > 0, true);
  assert.equal(status.diagnostics.signals.some((signal) => signal.code === "blocked_tasks_present"), true);
  assert.equal(status.diagnostics.recommendations.some((item) => item.code === "blocked_tasks_present"), true);
  assert.equal(status.diagnosticsHistory.length > 0, true);
  assert.equal(flattenBehaviorTree(status.behaviorTree).find((node) => node.active).id, "wait_out_night");
});

test("dashboard state publishes detailed task traces", () => {
  const dashboard = createDashboardState();

  const fullPhaseEvents = Array.from({ length: 30 }, (_, index) => ({
    id: `phase_${index}`,
    label: `阶段 ${index}`,
    status: index === 29 ? "failed" : "completed",
    at: `2026-05-03T00:00:${String(index).padStart(2, "0")}.000Z`,
    details: { index, position: new Vec3(index, 64, 0) }
  }));

  const fullObservations = Array.from({ length: 30 }, (_, index) => ({
    kind: index === 29 ? "result" : "step",
    level: index === 29 ? "error" : "info",
    message: index === 29 ? "failed" : `observation ${index}`,
    at: `2026-05-03T00:00:${String(index).padStart(2, "0")}.500Z`,
    details: { index, decision: "hunt_food" }
  }));

  dashboard.setTaskTrace({
    id: "trace-1",
    taskType: "hunt_food",
    skillId: "starter_food_buffer",
    status: "running",
    reason: "food buffer low",
    activePhaseId: "risk_response",
    activePhaseLabel: "躲避怪物或植物伤害",
    phaseEvents: [
      { id: "prepare", label: "准备武器与状态", status: "completed", at: "2026-05-03T00:00:00.000Z", details: { food: 1 } },
      { id: "risk_response", label: "躲避怪物或植物伤害", status: "risk", at: "2026-05-03T00:00:01.000Z", details: { threat: "zombie", position: new Vec3(2, 64, 0) } }
    ],
    observations: [
      { kind: "risk", level: "warn", message: "hunt_food interrupted by hostile", details: { threat: "zombie" } }
    ]
  });

  let status = dashboard.getSnapshot();
  let activeNode = flattenBehaviorTree(status.behaviorTree).find((node) => node.id === "hunt_food");
  assert.equal(status.taskTrace.taskType, "hunt_food");
  assert.equal(status.taskTrace.activePhaseId, "risk_response");
  assert.equal(status.taskTrace.risks[0].message, "hunt_food interrupted by hostile");
  assert.equal(status.taskTrace.phaseEvents[1].details.position.text, "2, 64, 0");
  assert.equal(activeNode.active, true);
  assert.equal(activeNode.phases.find((phase) => phase.id === "risk_response").status, "risk");

  dashboard.setTaskTrace({
    id: "trace-1",
    taskType: "hunt_food",
    skillId: "starter_food_buffer",
    status: "failed",
    reason: "food buffer low",
    activePhaseId: "verify",
    activePhaseLabel: "验证食物增加",
    startedAt: "2026-05-03T00:00:00.000Z",
    updatedAt: "2026-05-03T00:00:09.000Z",
    phaseEvents: fullPhaseEvents,
    observations: fullObservations
  });

  status = dashboard.getSnapshot();
  assert.equal(status.taskTraceHistory.length >= 1, true);
  assert.equal(status.taskTraceHistory[0].taskType, "hunt_food");
  assert.equal(status.taskTraceHistory[0].status, "failed");
  assert.equal(Number.isFinite(status.taskTraceHistory[0].durationMs), true);
  assert.equal(status.taskTrace.phaseEvents.length, 24);
  assert.equal(status.taskTrace.observations.length, 16);
  assert.equal(status.taskTraceHistory[0].phaseEventCount, 30);
  assert.equal(status.taskTraceHistory[0].observationCount, 30);
  assert.equal(status.taskTraceHistory[0].phaseEvents.length, 30);
  assert.equal(status.taskTraceHistory[0].observations.length, 30);
  assert.equal(status.taskTraceHistory[0].phaseEvents[29].details.position.text, "29, 64, 0");
});

test("dashboard diagnostics reports low health starvation and night hostile pressure", () => {
  const dashboard = createDashboardState();
  dashboard.setConnection({ state: "connected" });
  dashboard.publishTick({
    snapshot: {
      health: 1,
      food: 0,
      oxygen: 20,
      position: new Vec3(0, 64, 0),
      timeOfDay: 18000,
      isNight: true,
      environmentHazard: null,
      navigationTrap: false,
      navigationAnalysis: null,
      isInLava: false,
      timeSinceOnGround: 0,
      inventory: {},
      entities: [{ name: "zombie", distance: 24, position: new Vec3(24, 64, 0) }]
    },
    decision: { type: "recover_starvation", reason: "critical health and no food" },
    skillEnvelope: {},
    progress: {},
    memory: {},
    dimension: "overworld",
    controller: {
      busy: true,
      emergencyBusy: false,
      behaviorQueue: {
        active: true,
        currentTree: null,
        pendingTrees: [{ id: "bt-eat", taskType: "eat_food", status: "pending" }],
        completedTrees: [],
        feedback: [],
        lastEvent: { type: "paused", reason: "hard_safety_behavior_queue", details: { queuedTask: "eat_food", ruleDecision: "recover_starvation" } }
      }
    }
  });

  const status = dashboard.getSnapshot();
  const codes = status.diagnostics.signals.map((signal) => signal.code);

  assert.equal(status.diagnostics.overall, "critical");
  assert.equal(codes.includes("critical_health"), true);
  assert.equal(codes.includes("starvation_empty_food"), true);
  assert.equal(codes.includes("night_hostile_pressure"), true);
  assert.equal(codes.includes("behavior_queue_safety_paused"), true);
});

test("dashboard state sanitizes complex trace details before publishing", () => {
  const dashboard = createDashboardState();
  const block = { name: "grass_block", position: new Vec3(1, 64, 2) };
  block.self = block;

  dashboard.setTaskTrace({
    id: "trace-complex-details",
    taskType: "collect_building_materials",
    status: "running",
    phaseEvents: [
      {
        id: "act",
        label: "采集方块",
        status: "active",
        details: {
          blocks: [block],
          apiKey: "should-not-leak"
        }
      }
    ],
    observations: [
      {
        kind: "behavior_tree",
        message: "complex details recorded",
        details: { block }
      }
    ]
  });

  const status = dashboard.getSnapshot();
  const details = status.taskTrace.phaseEvents[0].details;
  assert.equal(details.apiKey, "[redacted]");
  assert.equal(details.blocks[0].name, "grass_block");
  assert.equal(details.blocks[0].position.text, "1, 64, 2");
  assert.equal(details.blocks[0].self, "[Circular]");
  assert.equal(JSON.stringify(status).includes("should-not-leak"), false);
});

test("dashboard state exposes sanitized LLM planner status", () => {
  const dashboard = createDashboardState({ llm: { enabled: true, model: "test-model", baseHost: "example.test" } });

  dashboard.setLlmState({
    status: "ok",
    lastCallAt: "2026-05-03T00:00:00.000Z",
    lastPlan: {
      brainAgent: "general_agent",
      stageAssessment: "initial day one",
      goal: "secure food",
      tasks: ["hunt_food", "eat_food"],
      agentDirectives: [{
        directiveId: "dir-1",
        fromAgent: "general_agent",
        toAgent: "survival_agent",
        action: "activate_agent",
        reason: "need food",
        taskRequest: { requestId: "req-1", assignedAgent: "survival_agent", taskType: "hunt_food", treeClass: "HuntFoodTree", taskFunction: "huntFood", level: "B", priority: 680, constructorArgs: { count: 2 } }
      }],
      taskRequests: [{ requestId: "req-1", fromAgent: "general_agent", assignedAgent: "survival_agent", taskType: "hunt_food", treeClass: "HuntFoodTree", taskFunction: "huntFood", level: "B", priority: 680, objective: "hunt food", constructorArgs: { count: 2 } }],
      behaviorTrees: [{ taskType: "hunt_food", treeClass: "HuntFoodTree", taskFunction: "huntFood", level: "B", priority: 680, sourceAgent: "survival_agent", requestedBy: "general_agent", taskRequestId: "req-1", constructorArgs: { count: 2 } }],
      reason: "food buffer low",
      constraints: ["daylight"],
      confidence: 0.8,
      validation: { ok: true, unknownTasks: [] },
      dryRun: true,
      accepted: false,
      queue: { accepted: false, reason: "task_queue_disabled" },
      ruleDecision: "hunt_food"
    },
    taskQueue: {
      enabled: true,
      active: true,
      plan: { goal: "secure food" },
      currentTask: { type: "hunt_food", status: "in_progress" },
      pendingTasks: [{ type: "collect_wood", status: "pending" }],
      completedTasks: [],
      lastEvent: { type: "started", task: "hunt_food" }
    },
    recentCalls: [{ status: "ok", model: "test-model", baseHost: "example.test", promptSummary: "stage=food" }]
  });

  const status = dashboard.getSnapshot();
  assert.equal(status.llm.enabled, true);
  assert.equal(status.llm.status, "ok");
  assert.equal(status.llm.lastPlan.goal, "secure food");
  assert.equal(status.llm.lastPlan.stageAssessment, "initial day one");
  assert.deepEqual(status.llm.lastPlan.tasks, ["hunt_food", "eat_food"]);
  assert.equal(status.llm.lastPlan.agentDirectives[0].toAgent, "survival_agent");
  assert.equal(status.llm.lastPlan.taskRequests[0].level, "B");
  assert.equal(status.llm.lastPlan.taskRequests[0].treeClass, "HuntFoodTree");
  assert.equal(status.llm.lastPlan.behaviorTrees[0].constructorArgs.count, 2);
  assert.equal(status.llm.lastPlan.queue.reason, "task_queue_disabled");
  assert.equal(status.llm.taskQueue.currentTask.type, "hunt_food");
  assert.equal(status.llm.taskQueue.pendingTasks[0].type, "collect_wood");
  assert.equal(JSON.stringify(status.llm).includes("apiKey"), false);
});

test("dashboard state records recent log events", () => {
  const dashboard = createDashboardState();

  dashboard.recordLog({ timestamp: "2026-05-03T00:00:00.000Z", level: "warn", args: ["action=collect_item_safe; touched hazard"] });

  const status = dashboard.getSnapshot();
  assert.equal(status.recentEvents.length, 1);
  assert.equal(status.recentEvents[0].level, "warn");
  assert.match(status.recentEvents[0].message, /touched hazard/);
});

test("dashboard diagnostics turns critical when connection and position are missing", () => {
  const dashboard = createDashboardState();

  const initial = dashboard.getSnapshot();
  assert.equal(initial.diagnostics.overall, "critical");
  assert.equal(initial.diagnostics.signals.some((signal) => signal.code === "connection_not_ready"), true);
  assert.equal(initial.diagnostics.signals.some((signal) => signal.code === "position_unavailable"), true);
  assert.equal(initial.diagnostics.recommendations.some((item) => item.code === "connection_not_ready"), true);

  dashboard.setConnection({ state: "connected" });
  dashboard.publishTick({
    snapshot: {
      health: 20,
      food: 20,
      oxygen: 20,
      position: new Vec3(0, 64, 0),
      timeOfDay: 1000,
      isNight: false,
      environmentHazard: null,
      navigationTrap: false,
      navigationAnalysis: null,
      isInLava: false,
      timeSinceOnGround: 0,
      inventory: {},
      entities: []
    },
    decision: { type: "collect_wood", reason: "progress" },
    skillEnvelope: {},
    progress: {},
    memory: {},
    dimension: "overworld",
    controller: { busy: false, emergencyBusy: false }
  });

  const recovered = dashboard.getSnapshot();
  assert.equal(recovered.diagnostics.overall, "warning");
  assert.equal(recovered.diagnosticsHistory.length >= 2, true);
  assert.equal(recovered.diagnosticsHistory[0].overall, "warning");
  assert.equal(recovered.diagnosticsHistory[1].overall, "critical");
});