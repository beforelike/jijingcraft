const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const {
  createEmergencyShelterDoorwayPlan,
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

test("emergency shelter has a predictable doorway position for optional doors", () => {
  const base = new Vec3(0, 64, 0);
  const doorwayPlan = createEmergencyShelterDoorwayPlan(base);

  assert.deepEqual(doorwayPlan.map((position) => [position.x, position.y, position.z]), [
    [0, 64, -1],
    [0, 65, -1]
  ]);
});

test("starter shelter is a 7x7x5 house shell with a double doorway", () => {
  const base = new Vec3(10, 70, 10);
  const starterPlan = createStarterShelterPlan(base);
  const doorwayPlan = createStarterShelterDoorwayPlan(base);
  const sealPlan = createStarterShelterDoorwaySealPlan(base);
  const starterKeys = new Set(starterPlan.map((position) => `${position.x},${position.y},${position.z}`));

  assert.equal(starterPlan.length, 141);
  assert.equal(starterKeys.has("7,70,7"), true);
  assert.equal(starterKeys.has("13,73,13"), true);
  assert.equal(starterKeys.has("10,74,10"), true);
  assert.equal(starterKeys.has("10,70,7"), false);
  assert.equal(starterKeys.has("10,71,7"), false);
  assert.equal(starterKeys.has("11,70,7"), false);
  assert.equal(starterKeys.has("11,71,7"), false);
  assert.deepEqual(doorwayPlan.map((position) => [position.x, position.y, position.z]), [
    [10, 70, 7],
    [10, 71, 7],
    [11, 70, 7],
    [11, 71, 7]
  ]);
  assert.deepEqual(sealPlan.map((position) => [position.x, position.y, position.z]), [
    [10, 70, 7],
    [10, 71, 7],
    [11, 70, 7],
    [11, 71, 7]
  ]);
});
