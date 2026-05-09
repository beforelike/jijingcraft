const assert = require("node:assert/strict");
const test = require("node:test");
const { PriorityTaskQueue } = require("../src/survival/priorityTaskQueue");

test("priority task queue orders pending tasks by priority", () => {
  const queue = new PriorityTaskQueue({ allowedTasks: new Set(["explore", "escape_hazard"]) });

  queue.insert("explore", { priority: 10, reason: "low" });
  queue.insert("escape_hazard", { priority: 100, reason: "high" });

  assert.equal(queue.peek().type, "escape_hazard");
  const started = queue.startNext({ ruleDecision: "escape_hazard" });
  assert.equal(started.type, "escape_hazard");
  queue.completeCurrent("completed", { reason: "verified" });
  assert.equal(queue.getStatus().completedTasks[0].type, "escape_hazard");
});

test("priority task queue rejects unknown tasks", () => {
  const queue = new PriorityTaskQueue({ allowedTasks: new Set(["explore"]) });

  assert.throws(() => queue.insert("unknown_task"), /unknown priority task/);
});

test("priority task queue can replace existing scenario tasks", () => {
  const queue = new PriorityTaskQueue({ allowedTasks: new Set(["explore", "escape_hazard"]) });

  queue.insert("explore", { priority: 20 });
  queue.insert("escape_hazard", { priority: 100, replace: true });

  const status = queue.getStatus();
  assert.equal(status.pendingTasks.length, 1);
  assert.equal(status.pendingTasks[0].type, "escape_hazard");
});