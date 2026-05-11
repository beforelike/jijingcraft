const assert = require("node:assert/strict");
const test = require("node:test");
const { buildSkillPlan, recommendSkillsForTask, skillEnvelopeForDecision } = require("../src/knowledge/skillPlanner");
const { ToolRegistry, createDefaultToolRegistry } = require("../src/knowledge/toolRegistry");

test("skill planner builds bounded task plans from known survival skills", () => {
  const plan = buildSkillPlan("early_stone_tools", { maxTasks: 2 });

  assert.equal(plan.ok, true);
  assert.equal(plan.skillId, "early_stone_tools");
  assert.deepEqual(plan.tasks, ["collect_wood", "craft_basic_supplies"]);
  assert.equal(plan.nextTask, "collect_wood");
  assert.ok(plan.safety.includes("do_not_dig_vertical_shafts"));
});

test("skill planner rejects unknown skills and invalid start tasks", () => {
  assert.deepEqual(buildSkillPlan("missing_skill"), {
    ok: false,
    skillId: "missing_skill",
    error: "unknown_skill",
    tasks: [],
    nextTask: null
  });

  const invalidStart = buildSkillPlan("early_stone_tools", { startAtTask: "build_shelter" });
  assert.equal(invalidStart.ok, false);
  assert.equal(invalidStart.error, "start_task_not_in_skill");
});

test("skill planner recommends all skills that contain a low-level task", () => {
  const recommendation = recommendSkillsForTask("collect_stone");

  assert.equal(recommendation.primarySkillId, "early_stone_tools");
  assert.deepEqual(recommendation.skillIds, ["early_stone_tools", "surface_stone_search"]);
  assert.equal(recommendation.plans.length, 2);
});

test("skill envelope links controller decisions to a skill plan", () => {
  const envelope = skillEnvelopeForDecision({ type: "wait_out_night" });

  assert.equal(envelope.taskType, "wait_out_night");
  assert.equal(envelope.primarySkillId, "reusable_shelter");
  assert.equal(envelope.plan.skillId, "reusable_shelter");
});

test("tool registry registers tools and blocks duplicate ids", () => {
  const registry = new ToolRegistry();
  const tool = {
    id: "example_tool",
    summary: "example",
    handler: () => ({ ok: true })
  };

  registry.register(tool);

  assert.equal(registry.getTool("example_tool").summary, "example");
  assert.throws(() => registry.register(tool), /duplicate tool id/);
});

test("tool registry respects trigger guards", async () => {
  const registry = new ToolRegistry([
    {
      id: "guarded_tool",
      summary: "guarded",
      trigger: (context) => context.enabled === true,
      handler: () => "called"
    }
  ]);

  assert.deepEqual(registry.listTools({ enabled: false }), []);
  assert.deepEqual(await registry.callTool("guarded_tool", {}, { enabled: false }), {
    ok: false,
    tool: "guarded_tool",
    error: "tool_not_available"
  });
  assert.deepEqual(await registry.callTool("guarded_tool", {}, { enabled: true }), {
    ok: true,
    tool: "guarded_tool",
    result: "called"
  });
});

test("default tool registry exposes safe survival skill tools", async () => {
  const registry = createDefaultToolRegistry();
  const tools = registry.listTools();

  assert.deepEqual(tools.map((tool) => tool.id), [
    "list_survival_skills",
    "get_survival_skill",
    "query_minecraft_knowledge",
    "plan_survival_skill",
    "validate_task_sequence",
    "recommend_survival_skill"
  ]);

  const planResult = await registry.callTool("plan_survival_skill", { skillId: "early_stone_tools", maxTasks: 3 });
  assert.equal(planResult.ok, true);
  assert.deepEqual(planResult.result.tasks, ["collect_wood", "craft_basic_supplies", "craft_basic_tools"]);

  const invalidSequence = await registry.callTool("validate_task_sequence", { tasks: ["collect_wood", "teleport_to_diamond"] });
  assert.equal(invalidSequence.ok, true);
  assert.equal(invalidSequence.result.ok, false);
  assert.deepEqual(invalidSequence.result.unknownTasks, ["teleport_to_diamond"]);

  const recommendation = await registry.callTool("recommend_survival_skill", { taskType: "collect_stone" });
  assert.equal(recommendation.result.primarySkillId, "early_stone_tools");

  const knowledge = await registry.callTool("query_minecraft_knowledge", { taskType: "collect_stone", query: "sand support falling block" });
  assert.equal(knowledge.ok, true);
  assert.ok(knowledge.result.results.some((entry) => entry.id === "falling_blocks_support_gravity"));
});

test("default tool registry reports bad calls without throwing to callers", async () => {
  const registry = createDefaultToolRegistry();

  assert.deepEqual(await registry.callTool("missing_tool"), {
    ok: false,
    tool: "missing_tool",
    error: "unknown_tool"
  });

  const unknownSkill = await registry.callTool("get_survival_skill", { skillId: "missing_skill" });
  assert.equal(unknownSkill.ok, false);
  assert.match(unknownSkill.error, /unknown skill/);
});