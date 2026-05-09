const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { buildPlannerContext } = require("../src/llm/contextBuilder");
const { LlmPlanner, extractJsonObject, normalizePlan } = require("../src/llm/planner");

function plannerInput() {
  return {
    snapshot: {
      health: 20,
      food: 16,
      oxygen: 20,
      position: new Vec3(1, 64, 2),
      timeOfDay: 2000,
      isNight: false,
      navigationTrap: true,
      navigationAnalysis: {
        trapped: true,
        kind: "elevated_support_column",
        summary: "isolated support column with diggable stone below",
        recommendedAction: "controlled_descent",
        sameLevelExitCount: 0,
        blockingSides: 0,
        supportColumnDepth: 5,
        safeSupportDescent: true,
        supportBlock: { name: "stone", solid: true, diggable: true },
        belowSupportBlock: { name: "stone", solid: true, diggable: true },
        routeOptions: ["controlled_descent"]
      },
      terrain: {
        sampleRadius: 6,
        primaryGround: "snow_block",
        ground: [{ name: "snow_block", count: 24 }, { name: "sand", count: 9 }],
        safeStandCount: 18,
        waterSamples: 7,
        damagingSamples: 0,
        nearbyWater: [{ name: "water", position: new Vec3(18, 63, 4) }],
        matureBerryBushes: [{ name: "sweet_berry_bush", position: new Vec3(-6, 64, 9) }],
        nearbyLogs: [{ name: "spruce_log", position: new Vec3(12, 64, -3) }],
        exactLocal: {
          radius: 5,
          width: 11,
          center: new Vec3(1, 64, 2),
          safeStandCount: 80,
          waterCount: 2,
          hazardCount: 0,
          groundCounts: [{ name: "snow_block", count: 80 }],
          cells: [{ dx: 0, dz: 0, position: new Vec3(1, 64, 2), ground: "snow_block", feet: "air", head: "air", safeStand: true, water: false, hazard: false }]
        },
        regional: {
          radius: 100,
          diameter: 200,
          step: 10,
          sampleCount: 100,
          waterCells: 12,
          hazardCells: 0,
          safeCells: 80,
          topBlocks: [{ name: "snow_block", count: 60 }, { name: "water", count: 12 }]
        },
        descent: {
          needsDescent: true,
          summary: "elevated platform: water landing 20 blocks below",
          bestTarget: { waterPosition: new Vec3(4, 60, 4), entryPosition: new Vec3(4, 61, 4), horizontalDistance: 5, drop: 20, route: "water_landing" }
        }
      },
      inventory: { spruce_log: 4, cobblestone: 8 },
      entities: [{ name: "cow", distance: 12, position: new Vec3(8, 64, 2) }]
    },
    progress: {
      stage: "stone_tools",
      summary: "5/14",
      next: { id: "starter_food", label: "starter food" },
      foodCount: 3,
      materialCount: 12,
      milestones: [{ id: "crafting_ready", achieved: true }, { id: "starter_food", achieved: false }]
    },
    memory: {
      knownBlocks: { crafting_table: [{ position: { x: 0, y: 64, z: 0 } }] },
      learning: { policyStats: {} },
      exploration: { visited: [{ position: { x: 1, y: 64, z: 2 }, dimension: "overworld" }], coarseCells: { "overworld:0:0": { position: { x: 0, y: 64, z: 0 }, topBlock: "snow_block" } } }
    },
    decision: { type: "hunt_food", reason: "food buffer is low" },
    skillEnvelope: { plan: { skillId: "starter_food_buffer", title: "启动食物储备", tasks: ["hunt_food", "eat_food"], nextTask: "hunt_food", safety: [] } },
    dimension: "overworld",
    controller: {
      busy: true,
      emergencyBusy: false,
      lastAction: { type: "hunt_food" },
      taskFeedback: {
        blockedTasks: [{ taskType: "hunt_food", reason: "safe_position_unreachable", failureCount: 2, recoveryTasks: ["explore"] }],
        recentFailures: []
      }
    }
  };
}

test("buildPlannerContext compresses runtime state for dry-run planning", () => {
  const context = buildPlannerContext(plannerInput());

  assert.equal(context.purpose, "smart_brain_task_directive_planning");
  assert.equal(context.currentRuleDecision.type, "hunt_food");
  assert.equal(context.world.navigationAnalysis.kind, "elevated_support_column");
  assert.equal(context.world.navigationAnalysis.recommendedAction, "controlled_descent");
  assert.equal(context.world.terrain.primaryGround, "snow_block");
  assert.equal(context.world.terrain.waterSamples, 7);
  assert.deepEqual(context.world.terrain.nearbyWater[0].position, { x: 18, y: 63, z: 4 });
  assert.deepEqual(context.world.terrain.matureBerryBushes[0].position, { x: -6, y: 64, z: 9 });
  assert.equal(context.world.terrain.exactLocal.width, 11);
  assert.equal(context.world.terrain.regional.diameter, 200);
  assert.equal(context.world.terrain.descent.needsDescent, true);
  assert.equal(context.world.terrain.descent.bestTarget.drop, 20);
  assert.equal(context.foodStrategy.recommendedSource, "land_animal");
  assert.equal(context.foodStrategy.decisionBasis, "nearby_land_food_visible");
  assert.equal(context.foodStrategy.environmentRisk.coldOrIcyTerrain, true);
  assert.equal(context.foodStrategy.environmentRisk.waterPressure, true);
  assert.match(context.foodStrategy.planningRule, /Do not hard-code berry priority/);
  assert.ok(context.safetyRules.some((rule) => /environment-aware choice/.test(rule)));
  assert.equal(context.compactState.gameplay.timeLabel, "morning");
  assert.equal(Object.hasOwn(context.bot, "oxygen"), false);
  assert.equal(Object.hasOwn(context.compactState.gameplay, "oxygen"), false);
  assert.equal(context.compactState.action.current, "hunt_food");
  assert.equal(context.compactState.surroundings.below, "snow_block");
  assert.equal(context.compactState.surroundings.head, "air");
  assert.equal(context.compactState.nearby.entityTypes[0].name, "cow");
  assert.ok(context.taskParameterKnowledge.commandMappings.some((mapping) => mapping.command === "!collectBlocks" && mapping.mapsTo.includes("collect_stone")));
  assert.equal(context.controller.taskFeedback.blockedTasks[0].taskType, "hunt_food");
  assert.equal(context.inventory[0].name, "cobblestone");
  assert.equal(context.memory.knownBlocks.crafting_table.count, 1);
  assert.deepEqual(context.memory.knownBlocks.crafting_table.nearest[0].position, { x: 0, y: 64, z: 0 });
  assert.equal(context.memory.exploration.coarseCellCount, 1);
  assert.ok(context.allowedTasks.includes("collect_wood"));
  assert.equal(context.allowedTasks.includes("descend_from_platform"), false);
  assert.ok(context.localRuleManagedTasks.includes("descend_from_platform"));
  assert.equal(context.agentPolicy.generalAgentCanRequestEmergencyTasks, false);
  assert.ok(context.safetyRules.some((rule) => /descend_from_platform/.test(rule)));
  assert.ok(context.safetyRules.some((rule) => /researchMissions/.test(rule)));
  assert.ok(context.researchMissions.some((mission) => mission.id === "platform_descent" && mission.tasks.includes("descend_from_platform")));
  assert.ok(context.taskTreeClasses.some((treeClass) => treeClass.taskType === "collect_wood" && treeClass.treeClass === "CollectWoodTree"));
  assert.ok(context.taskTreeClasses.some((treeClass) => treeClass.taskType === "collect_stone" && treeClass.parameterHints.patterns.includes("cobblestone_expands_to_stone")));
  assert.ok(context.taskTreeClasses.some((treeClass) => treeClass.taskType === "hunt_food" && treeClass.constructorSchema.allowAquaticHunt));
  assert.equal(context.taskTreeClasses.some((treeClass) => treeClass.taskType === "escape_hazard"), false);
  assert.ok(context.availableSkills.some((skill) => skill.id === "starter_food_buffer"));
});

test("food strategy uses local exploration context instead of hard-coded berry priority", () => {
  const plainsInput = plannerInput();
  plainsInput.snapshot.terrain = {
    sampleRadius: 6,
    primaryGround: "grass_block",
    ground: [{ name: "grass_block", count: 32 }],
    safeStandCount: 30,
    waterSamples: 0,
    damagingSamples: 0,
    nearbyWater: [],
    matureBerryBushes: [{ name: "sweet_berry_bush", position: new Vec3(3, 64, 0) }],
    nearbyLogs: [{ name: "oak_log", position: new Vec3(6, 64, 2) }]
  };
  plainsInput.snapshot.entities = [{ name: "chicken", distance: 5, position: new Vec3(5, 64, 0) }];

  const plainsContext = buildPlannerContext(plainsInput);
  assert.equal(plainsContext.foodStrategy.recommendedSource, "land_animal");
  assert.equal(plainsContext.foodStrategy.decisionBasis, "nearby_land_food_visible");
  assert.equal(plainsContext.foodStrategy.environmentRisk.coldOrIcyTerrain, false);
  assert.equal(plainsContext.foodStrategy.environmentRisk.waterPressure, false);

  const snowyLakeInput = plannerInput();
  snowyLakeInput.snapshot.entities = [{ name: "salmon", distance: 18, position: new Vec3(18, 62, 0) }];
  const snowyLakeContext = buildPlannerContext(snowyLakeInput);
  assert.equal(snowyLakeContext.foodStrategy.recommendedSource, "mature_berry_bush");
  assert.equal(snowyLakeContext.foodStrategy.decisionBasis, "berry_safer_than_aquatic_risk");
  assert.equal(snowyLakeContext.foodStrategy.environmentRisk.aquaticRisk, true);

  const unknownInput = plannerInput();
  unknownInput.snapshot.terrain = null;
  unknownInput.snapshot.entities = [];
  const unknownContext = buildPlannerContext(unknownInput);
  assert.equal(unknownContext.foodStrategy.recommendedSource, "explore_safe_food");
  assert.equal(unknownContext.foodStrategy.needsInitialExploration, true);
});

test("planner parses JSON content and validates task whitelist", async () => {
  const records = [];
  const planner = new LlmPlanner({
    config: { enabled: true, model: "test-model", baseHost: "example.test", plannerIntervalMs: 1 },
    client: {
      chatCompletion: async () => ({
        ok: true,
        durationMs: 12,
        model: "test-model",
        content: JSON.stringify({ goal: "secure food", tasks: ["hunt_food", "eat_food"], reason: "food low", constraints: ["daylight"], confidence: 0.8 }),
        toolCalls: [],
        usage: { total_tokens: 50 }
      })
    },
    recorder: { record: (record) => { records.push(record); return record; }, listRecent: () => records },
    logger: { warn() {} }
  });

  const result = await planner.runDryPlan(plannerInput());

  assert.equal(result.status, "ok");
  assert.deepEqual(result.plan.tasks, ["hunt_food", "eat_food"]);
  assert.equal(result.plan.accepted, false);
  assert.equal(result.plan.dryRun, true);
  assert.equal(records[0].status, "ok");
});

test("planner marks unknown tasks as invalid instead of accepting them", async () => {
  const planner = new LlmPlanner({
    config: { enabled: true, model: "test-model", baseHost: "example.test", plannerIntervalMs: 1 },
    client: {
      chatCompletion: async () => ({ ok: true, durationMs: 5, model: "test-model", content: "{\"goal\":\"cheat\",\"tasks\":[\"teleport_to_diamond\"]}" })
    },
    recorder: { record: (record) => record, listRecent: () => [] },
    logger: { warn() {} }
  });

  const result = await planner.runDryPlan(plannerInput());

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.plan.validation.unknownTasks, ["teleport_to_diamond"]);
});

test("extractJsonObject and normalizePlan tolerate fenced output", () => {
  const parsed = extractJsonObject("```json\n{\"goal\":\"g\",\"tasks\":[\"collect_wood\"],\"behaviorTrees\":[{\"taskType\":\"collect_wood\",\"priority\":620}],\"confidence\":2}\n```");
  const plan = normalizePlan(parsed);

  assert.equal(plan.goal, "g");
  assert.deepEqual(plan.tasks, ["collect_wood"]);
  assert.equal(plan.behaviorTrees[0].taskType, "collect_wood");
  assert.equal(plan.behaviorTrees[0].priority, 620);
  assert.equal(plan.confidence, 1);
});

test("normalizePlan converts smart brain directives into executable task requests", () => {
  const plan = normalizePlan({
    brainAgent: "general_agent",
    stageAssessment: "initial day one",
    agentDirectives: [{
      directiveId: "dir-1",
      fromAgent: "general_agent",
      toAgent: "survival_agent",
      action: "activate_agent",
      reason: "need terrain awareness",
      taskRequest: {
        requestId: "req-1",
        taskType: "safe_explore",
        objective: "安全探索 10x10",
        parameters: { area: "10x10", radius: 10 },
        successCriteria: ["map memory updated"]
      }
    }],
    confidence: 0.7
  });

  assert.equal(plan.brainAgent, "general_agent");
  assert.equal(plan.agentDirectives[0].toAgent, "survival_agent");
  assert.equal(plan.taskRequests[0].taskType, "explore");
  assert.equal(plan.taskRequests[0].treeClass, "ExploreTree");
  assert.equal(plan.taskRequests[0].priority, 120);
  assert.deepEqual(plan.taskRequests[0].constructorArgs, { radius: 10, mode: "safe_scan", area: "10x10" });
  assert.equal(plan.behaviorTrees[0].taskType, "explore");
  assert.equal(plan.behaviorTrees[0].treeClass, "ExploreTree");
  assert.equal(plan.behaviorTrees[0].taskRequestId, "req-1");
});

test("planner uses controlled tools before recording a final dry-run plan", async () => {
  const records = [];
  let calls = 0;
  const planner = new LlmPlanner({
    config: { enabled: true, model: "test-model", baseHost: "example.test", plannerIntervalMs: 1, maxToolTurns: 2 },
    client: {
      chatCompletion: async ({ messages, tools }) => {
        calls++;
        assert.ok(tools.some((tool) => tool.function.name === "query_status"));
        if (calls === 1) {
          return {
            ok: true,
            durationMs: 8,
            model: "test-model",
            content: "",
            toolCalls: [{ id: "call_status", name: "query_status", arguments: "{}" }]
          };
        }
        assert.equal(messages.at(-1).role, "tool");
        return {
          ok: true,
          durationMs: 10,
          model: "test-model",
          content: JSON.stringify({ goal: "secure food", tasks: ["hunt_food", "eat_food"], reason: "food low", constraints: ["daylight"], confidence: 0.75 }),
          toolCalls: [],
          usage: { total_tokens: 70 }
        };
      }
    },
    recorder: { record: (record) => { records.push(record); return record; }, listRecent: () => records },
    logger: { warn() {} }
  });

  const result = await planner.runDryPlan(plannerInput());

  assert.equal(result.status, "ok");
  assert.equal(calls, 2);
  assert.equal(records[0].toolCalls[0].name, "query_status");
  assert.equal(records[0].toolResults[0].result.ok, true);
});

test("planner records task queue acceptance decisions", () => {
  const records = [];
  const planner = new LlmPlanner({
    config: { enabled: true, model: "test-model", baseHost: "example.test" },
    recorder: { record: (record) => { records.push(record); return record; }, listRecent: () => records },
    logger: { warn() {} }
  });
  planner.publish({
    lastPlan: {
      goal: "secure food",
      tasks: ["hunt_food"],
      accepted: false,
      dryRun: true
    }
  });

  planner.noteQueueDecision({ accepted: true, reason: "plan_queued", taskCount: 1, planId: "plan-1", status: { active: true } });

  assert.equal(planner.getStatus().lastPlan.accepted, true);
  assert.equal(planner.getStatus().status, "queued");
  assert.equal(records[0].type, "task_queue");
  assert.equal(records[0].status, "accepted");
});

test("planner can be forced to run immediately for failure feedback", async () => {
  const planner = new LlmPlanner({
    config: { enabled: true, model: "test-model", baseHost: "example.test", plannerIntervalMs: 60000 },
    client: {
      chatCompletion: async () => ({ ok: true, durationMs: 5, model: "test-model", content: JSON.stringify({ goal: "recover", tasks: ["explore"], confidence: 0.7 }) })
    },
    recorder: { record: (record) => record, listRecent: () => [] },
    logger: { warn() {} }
  });

  const first = await planner.runDryPlan({ ...plannerInput(), force: true });
  const second = await planner.runDryPlan({ ...plannerInput(), force: true });

  assert.equal(first.status, "ok");
  assert.equal(second.status, "ok");
});

test("planner context includes oxygen only when air is actionable", () => {
  const waterInput = plannerInput();
  waterInput.snapshot.isBodyInWater = true;
  waterInput.snapshot.oxygen = 20;

  const waterContext = buildPlannerContext(waterInput);
  assert.equal(waterContext.bot.oxygen, 20);
  assert.equal(waterContext.compactState.gameplay.oxygen, 20);
  assert.equal(waterContext.agentPolicy.oxygenField, "included_when_relevant");

  const lowOxygenInput = plannerInput();
  lowOxygenInput.snapshot.oxygen = 10;
  const lowOxygenContext = buildPlannerContext(lowOxygenInput);
  assert.equal(lowOxygenContext.bot.oxygen, 10);
  assert.equal(lowOxygenContext.compactState.gameplay.oxygen, 10);
});