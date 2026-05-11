const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { PythonBrainClient, buildPythonBrainRequest, planEntryToTree, normalizedBaseUrl } = require("../src/llm/pythonBrainClient");

test("Python Brain request carries compact planner context and hostile flags", () => {
  const request = buildPythonBrainRequest({
    snapshot: {
      health: 18,
      food: 11,
      oxygen: 20,
      isBodyInWater: false,
      position: new Vec3(1, 64, -2),
      isNight: false,
      navigationAnalysis: {
        trapped: true,
        kind: "subsurface_enclosure",
        recommendedAction: "surface_escape",
        subsurface: { needsSurfaceRecovery: true, surfaceExit: { x: 4, y: 64, z: 0 }, surfaceExitRise: 14 }
      },
      inventory: { oak_log: 2 },
      entities: [{ name: "zombie", distance: 5, position: new Vec3(3, 64, -2) }]
    },
    ruleDecision: { type: "collect_wood", reason: "need logs" },
    taskFeedback: { blockedTasks: {}, recentFailures: [] },
    progress: { stage: "wood_age" },
    memory: { knownBlocks: {} }
  });

  assert.deepEqual(request.snapshot.position, { x: 1, y: 64, z: -2 });
  assert.equal(request.snapshot.entities[0].hostile, true);
  assert.equal(request.ruleDecision.type, "collect_wood");
  assert.equal(request.plannerContext.purpose, "smart_brain_task_directive_planning");
  assert.equal(request.snapshot.isBodyInWater, false);
  assert.equal(request.snapshot.navigationAnalysis.kind, "subsurface_enclosure");
  assert.equal(request.plannerContext.world.navigationAnalysis.subsurface.needsSurfaceRecovery, true);
  assert.equal(Object.hasOwn(request.snapshot, "oxygen"), false);
  assert.equal(Object.hasOwn(request.plannerContext.bot, "oxygen"), false);
  assert.ok(request.plannerContext.minecraftWiki.environmentRules.some((rule) => /Water is traversable/.test(rule)));
});

test("Python Brain request keeps oxygen when the bot is in water or low on air", () => {
  const waterRequest = buildPythonBrainRequest({
    snapshot: {
      health: 20,
      food: 20,
      oxygen: 20,
      isBodyInWater: true,
      position: new Vec3(0, 62, 0),
      inventory: {},
      entities: []
    },
    ruleDecision: { type: "hunt_food" },
    progress: {},
    memory: {}
  });
  assert.equal(waterRequest.snapshot.oxygen, 20);
  assert.equal(waterRequest.plannerContext.bot.oxygen, 20);

  const lowOxygenRequest = buildPythonBrainRequest({
    snapshot: {
      health: 20,
      food: 20,
      oxygen: 8,
      isBodyInWater: false,
      position: new Vec3(0, 64, 0),
      inventory: {},
      entities: []
    },
    ruleDecision: { type: "hunt_food" },
    progress: {},
    memory: {}
  });
  assert.equal(lowOxygenRequest.snapshot.oxygen, 8);
  assert.equal(lowOxygenRequest.plannerContext.bot.oxygen, 8);
});

test("Python Brain plan entries become local executable behavior trees", () => {
  const tree = planEntryToTree({
    taskType: "collect_wood",
    sourceAgent: "survival_agent",
    reason: "need starter logs",
    constructorArgs: { count: 4, searchRadius: 48 }
  }, "plan-1");

  assert.equal(tree.taskType, "collect_wood");
  assert.equal(tree.source, "python_brain");
  assert.equal(tree.sourceAgent, "survival_agent");
  assert.equal(tree.sourcePlanId, "plan-1");
  assert.equal(tree.constructorArgs.count, 4);
  assert.equal(tree.priority, 620);
});

test("Python Brain general_agent entries cannot instantiate hard emergency tasks", () => {
  const tree = planEntryToTree({ taskType: "escape_hazard", reason: "oxygen looks weird" }, "plan-2");
  assert.equal(tree, null);

  const safetyTree = planEntryToTree({ taskType: "escape_hazard", sourceAgent: "safety_agent", requestedBy: "safety_agent" }, "plan-3");
  assert.equal(safetyTree.taskType, "escape_hazard");
  assert.equal(safetyTree.sourceAgent, "safety_agent");
});

test("Python Brain client posts to /plan and normalizes returned trees", async () => {
  let requestUrl = null;
  let requestBody = null;
  const client = new PythonBrainClient({ enabled: true, url: "http://127.0.0.1:3001/", timeoutMs: 5000 }, {
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          brainAgent: "general_agent",
          stageAssessment: "wood recovery",
          behaviorTrees: [{ taskType: "collect_wood", sourceAgent: "survival_agent", constructorArgs: { count: 4 } }],
          agentProposals: []
        })
      };
    }
  });

  const result = await client.requestPlan({
    snapshot: { health: 20, food: 20, position: new Vec3(0, 64, 0), inventory: {}, entities: [] },
    ruleDecision: { type: "collect_wood" },
    taskFeedback: { blockedTasks: {}, recentFailures: [] },
    progress: {},
    memory: {}
  });

  assert.equal(normalizedBaseUrl("http://127.0.0.1:3001/"), "http://127.0.0.1:3001");
  assert.equal(requestUrl, "http://127.0.0.1:3001/plan");
  assert.equal(requestBody.ruleDecision.type, "collect_wood");
  assert.equal(result.trees[0].taskType, "collect_wood");
  assert.equal(client.getStatus().status, "planned");
});
