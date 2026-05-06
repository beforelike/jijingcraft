const { Vec3 } = require("vec3");

function createEmergencyShelterPlan(base) {
  const positions = [];
  const cardinalOffsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1)
  ];
  const diagonalOffsets = [
    new Vec3(1, 0, 1),
    new Vec3(1, 0, -1),
    new Vec3(-1, 0, 1),
    new Vec3(-1, 0, -1)
  ];

  for (const offset of cardinalOffsets) positions.push(base.plus(offset));
  for (const offset of cardinalOffsets) positions.push(base.plus(offset).offset(0, 1, 0));
  for (const offset of cardinalOffsets) positions.push(base.plus(offset).offset(0, 2, 0));
  positions.push(base.offset(0, 2, 0));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset).offset(0, 1, 0));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset).offset(0, 2, 0));

  return positions;
}

function createEmergencyShelterDoorwayPlan(base) {
  return [base.offset(0, 0, -1), base.offset(0, 1, -1)];
}

function createStarterShelterPlan(base) {
  const positions = [];
  const radius = 2;

  for (let y = 0; y <= 2; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const isWall = Math.abs(x) === radius || Math.abs(z) === radius;
        const isDoorway = x === 0 && z === -radius && y <= 1;
        if (isWall && !isDoorway) positions.push(base.offset(x, y, z));
      }
    }
  }

  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      positions.push(base.offset(x, 3, z));
    }
  }

  return positions;
}

function createStarterShelterDoorwayPlan(base) {
  return [base.offset(0, 0, -2), base.offset(0, 1, -2)];
}

function createStarterShelterDoorwaySealPlan(base) {
  return createStarterShelterDoorwayPlan(base);
}

module.exports = {
  createEmergencyShelterDoorwayPlan,
  createEmergencyShelterPlan,
  createStarterShelterDoorwayPlan,
  createStarterShelterDoorwaySealPlan,
  createStarterShelterPlan
};