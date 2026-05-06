const assert = require("node:assert/strict");
const test = require("node:test");
const { LlmTaskQueue } = require("../src/llm/taskQueue");

test("LLM task queue accepts valid queueable plans", () => {
  const queue = new LlmTaskQueue({ taskQueueEnabled: true, maxQueuedTasks: 2 });

  const result = queue.enqueuePlan({
    goal: "prepare stone tools",
    tasks: ["collect_wood", "craft_basic_supplies", "craft_basic_tools"],
    validation: { ok: true, unknownTasks: [] },
    ruleDecision: "collect_wood"
  });

  assert.equal(result.accepted, true);
  assert.equal(result.taskCount, 2);
  assert.equal(queue.getStatus().active, true);
  assert.deepEqual(queue.getStatus().pendingTasks.map((task) => task.type), ["collect_wood", "craft_basic_supplies"]);
});

test("LLM task queue rejects disabled, invalid, and hard-safety plans", () => {
  const disabledQueue = new LlmTaskQueue({ taskQueueEnabled: false });
  assert.equal(disabledQueue.enqueuePlan({ tasks: ["collect_wood"] }).reason, "task_queue_disabled");

  const queue = new LlmTaskQueue({ taskQueueEnabled: true });
  assert.equal(queue.enqueuePlan({ tasks: ["teleport_to_diamond"] }).reason, "invalid_task_sequence");
  assert.equal(queue.enqueuePlan({ tasks: ["eat_food"] }).reason, "non_queueable_tasks");
});

test("LLM task queue skips non-queueable safety tasks when safe tasks remain", () => {
  const queue = new LlmTaskQueue({ taskQueueEnabled: true });

  const result = queue.enqueuePlan({ tasks: ["hunt_food", "eat_food"] });

  assert.equal(result.accepted, true);
  assert.deepEqual(result.skippedTasks, ["eat_food"]);
  assert.deepEqual(queue.getStatus().pendingTasks.map((task) => task.type), ["hunt_food"]);
});

test("LLM task queue starts, completes, and records current task state", () => {
  const queue = new LlmTaskQueue({ taskQueueEnabled: true });
  queue.enqueuePlan({ goal: "food", tasks: ["hunt_food", "collect_wood"] });

  const started = queue.startNext({ ruleDecision: "hunt_food" });
  assert.equal(started.type, "hunt_food");
  assert.equal(queue.getStatus().currentTask.type, "hunt_food");

  const completed = queue.completeCurrent("completed", { reason: "rule=hunt_food" });
  assert.equal(completed.status, "completed");
  assert.equal(queue.getStatus().currentTask, null);
  assert.deepEqual(queue.getStatus().pendingTasks.map((task) => task.type), ["collect_wood"]);
  assert.equal(queue.getStatus().completedTasks[0].type, "hunt_food");
});

test("LLM task queue clears expired plans", () => {
  const queue = new LlmTaskQueue({ taskQueueEnabled: true, taskQueueMaxAgeMs: 1000 });
  queue.enqueuePlan({ goal: "old", tasks: ["collect_wood"] });
  const createdAt = Date.parse(queue.getStatus().plan.createdAt);

  assert.equal(queue.pruneExpired(createdAt + 2000), true);
  assert.equal(queue.getStatus().active, false);
  assert.equal(queue.getStatus().lastEvent.reason, "plan_expired");
});