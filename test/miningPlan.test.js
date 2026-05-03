const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const {
  createAscendingStairPlan,
  createDescendingStairPlan,
  normalizeCardinalDirection,
  sortMiningTargets
} = require("../src/survival/miningPlan");

test("creates descending stair mine steps instead of a vertical shaft", () => {
  const plan = createDescendingStairPlan(new Vec3(10, 64, 10), new Vec3(1, 0, 0), 6);

  assert.deepEqual(plan.map((step) => [step.feet.x, step.feet.y, step.feet.z]), [
    [11, 64, 10],
    [12, 63, 10],
    [13, 63, 10],
    [14, 62, 10],
    [15, 62, 10],
    [16, 61, 10]
  ]);
  assert.ok(plan.every((step) => step.head.y === step.feet.y + 1));
  assert.ok(plan.every((step) => step.support.y === step.feet.y - 1));
});

test("creates ascending escape stair steps out of a pit", () => {
  const plan = createAscendingStairPlan(new Vec3(10, 60, 10), new Vec3(0, 0, -1), 4);

  assert.deepEqual(plan.map((step) => [step.feet.x, step.feet.y, step.feet.z]), [
    [10, 61, 9],
    [10, 62, 8],
    [10, 63, 7],
    [10, 64, 6]
  ]);
});

test("normalizes diagonal mining directions to a cardinal axis", () => {
  assert.deepEqual(normalizeCardinalDirection(new Vec3(4, 0, 2)), new Vec3(1, 0, 0));
  assert.deepEqual(normalizeCardinalDirection(new Vec3(0, 0, -7)), new Vec3(0, 0, -1));
});

test("prefers exposed surface stone over closer underground stone", () => {
  const origin = new Vec3(0, 64, 0);
  const targets = [
    { position: new Vec3(1, 60, 0), isSurface: false, name: "underground" },
    { position: new Vec3(8, 65, 0), isSurface: true, name: "surface" }
  ];

  const sorted = sortMiningTargets(targets, origin, { preferSurface: true, maxMineBelow: 0 });
  assert.equal(sorted[0].name, "surface");
});