const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getResearchMission,
  listResearchMissions,
  missionToTestTask,
  validateResearchMission
} = require("../src/knowledge/researchMissionCatalog");

test("research missions expose Malmo-style evaluation fields for allowed tasks", () => {
  const missions = listResearchMissions();
  assert.ok(missions.length >= 5);
  assert.ok(missions.every((mission) => mission.validation.ok));

  const platform = getResearchMission("platform_descent");
  assert.equal(platform.firstTask, "descend_from_platform");
  assert.ok(platform.observations.includes("world.terrain.descent"));
  assert.ok(platform.rewards.includes("left_platform"));
  assert.ok(platform.quitConditions.includes("platform_left"));
  assert.equal(validateResearchMission({ taskPipeline: [{ taskType: "teleport_to_diamond" }] }).ok, false);
});

test("research mission converts to a controlled test pipeline task", () => {
  const task = missionToTestTask("berry_escape", {
    ttlMs: 30000,
    metadata: { trapPosition: { x: 0, y: 80, z: 0 } }
  });

  assert.equal(task.taskType, "escape_hazard");
  assert.equal(task.source, "research_mission");
  assert.equal(task.replace, true);
  assert.equal(task.ttlMs, 30000);
  assert.equal(task.metadata.researchMissionId, "berry_escape");
  assert.deepEqual(task.metadata.trapPosition, { x: 0, y: 80, z: 0 });
  assert.ok(task.metadata.rewards.includes("hazard_clear"));
});

test("unknown research mission is rejected", () => {
  assert.equal(getResearchMission("unknown_mission"), null);
  assert.throws(() => missionToTestTask("unknown_mission"), /unknown research mission/);
});