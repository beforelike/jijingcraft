const assert = require("node:assert/strict");
const test = require("node:test");
const { convertSimplifiedStructureToBlueprint } = require("../src/survival/pondererBlueprint");

test("convertSimplifiedStructureToBlueprint maps blocks, dimensions, and route", () => {
  const simplifiedStructure = {
    size: [3, 2, 2],
    palette: [
      { Name: "minecraft:air" },
      { Name: "minecraft:oak_planks" },
      { Name: "minecraft:oak_door" },
      { Name: "minecraft:torch" }
    ],
    blocks: [
      { pos: [0, 0, 0], state: 1 },
      { pos: [1, 0, 0], state: 2 },
      { pos: [0, 1, 0], state: 3 },
      { pos: [2, 1, 1], state: 0 }
    ]
  };

  const blueprint = convertSimplifiedStructureToBlueprint(simplifiedStructure, {
    id: "imported_test",
    name: "Imported Test",
    style: "imported_style"
  });

  assert.equal(blueprint.id, "imported_test");
  assert.deepEqual(blueprint.dimensions, { width: 3, height: 2, depth: 2 });
  assert.equal(blueprint.placements.length, 3);
  assert.deepEqual(blueprint.materialSummary.byPhase, { foundation: 1, door: 1, lighting: 1 });
  assert.equal(blueprint.materialSummary.doors, 1);
  assert.equal(blueprint.materialSummary.torches, 1);
  assert.deepEqual(blueprint.route, ["foundation", "door", "lighting"]);
});