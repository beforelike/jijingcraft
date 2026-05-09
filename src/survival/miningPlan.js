const { Vec3 } = require("vec3");

const CARDINAL_DIRECTIONS = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1)
];

function toBlockPosition(position) {
  return new Vec3(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z));
}

function normalizeCardinalDirection(direction) {
  if (!direction) return new Vec3(1, 0, 0);
  const x = Math.abs(direction.x) >= Math.abs(direction.z) ? Math.sign(direction.x) : 0;
  const z = x === 0 ? Math.sign(direction.z) : 0;
  if (x === 0 && z === 0) return new Vec3(1, 0, 0);
  return new Vec3(x, 0, z);
}

function createDescendingStairPlan(origin, direction, steps = 8) {
  const base = toBlockPosition(origin);
  const cardinal = normalizeCardinalDirection(direction);
  const plan = [];

  for (let step = 1; step <= steps; step++) {
    const down = Math.floor(step / 2);
    const feet = base.offset(cardinal.x * step, -down, cardinal.z * step);
    plan.push({
      step,
      feet,
      head: feet.offset(0, 1, 0),
      support: feet.offset(0, -1, 0)
    });
  }

  return plan;
}

function createAscendingStairPlan(origin, direction, steps = 5) {
  const base = toBlockPosition(origin);
  const cardinal = normalizeCardinalDirection(direction);
  const plan = [];

  for (let step = 1; step <= steps; step++) {
    const feet = base.offset(cardinal.x * step, step, cardinal.z * step);
    plan.push({
      step,
      feet,
      head: feet.offset(0, 1, 0),
      support: feet.offset(0, -1, 0)
    });
  }

  return plan;
}

function miningTargetScore(candidate, origin, options = {}) {
  const position = candidate.position || candidate.block?.position;
  const base = toBlockPosition(origin);
  const distance = position ? position.distanceTo(base) : Number.POSITIVE_INFINITY;
  let score = distance;

  if (options.preferSurface && candidate.isSurface) score -= options.surfacePreference ?? 1000;
  if (candidate.isOwnSupport && options.deferOwnSupportTarget !== false) score += options.ownSupportPenalty ?? 0.75;
  if (position && Object.prototype.hasOwnProperty.call(options, "maxMineBelow") && position.y < base.y - options.maxMineBelow) {
    score += (options.belowPenalty ?? 250) * (base.y - position.y);
  }

  return score;
}

function sortMiningTargets(candidates, origin, options = {}) {
  return [...candidates].sort((left, right) => {
    return miningTargetScore(left, origin, options) - miningTargetScore(right, origin, options);
  });
}

module.exports = {
  CARDINAL_DIRECTIONS,
  createAscendingStairPlan,
  createDescendingStairPlan,
  miningTargetScore,
  sortMiningTargets,
  normalizeCardinalDirection
};