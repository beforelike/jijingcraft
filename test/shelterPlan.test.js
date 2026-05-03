const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const {
  createEmergencyShelterPlan,
  createStarterShelterDoorwayPlan,
  createStarterShelterDoorwaySealPlan,
  createStarterShelterPlan
} = require("../src/survival/shelterPlan");

test("emergency shelter plan encloses the bot with walls and roof", () => {
  const base = new Vec3(0, 64, 0);
  const plan = createEmergencyShelterPlan(base);
  const keys = new Set(plan.map((position) => `${position.x},${position.y},${position.z}`));

  assert.equal(plan.length, 25);
  assert.equal(keys.has("0,64,0"), false);
  assert.equal(keys.has("0,65,0"), false);
  assert.equal(keys.has("0,66,0"), true);
  assert.equal(keys.has("1,64,1"), true);
  assert.equal(keys.has("-1,65,-1"), true);
});

test("starter shelter reserves a doorway and keeps a seal plan for emergencies", () => {
  const base = new Vec3(10, 70, 10);
  const starterPlan = createStarterShelterPlan(base);
  const doorwayPlan = createStarterShelterDoorwayPlan(base);
  const sealPlan = createStarterShelterDoorwaySealPlan(base);
  const starterKeys = new Set(starterPlan.map((position) => `${position.x},${position.y},${position.z}`));

  assert.equal(starterKeys.has("10,70,8"), false);
  assert.equal(starterKeys.has("10,71,8"), false);
  assert.deepEqual(doorwayPlan.map((position) => [position.x, position.y, position.z]), [
    [10, 70, 8],
    [10, 71, 8]
  ]);
  assert.deepEqual(sealPlan.map((position) => [position.x, position.y, position.z]), [
    [10, 70, 8],
    [10, 71, 8]
  ]);
});
