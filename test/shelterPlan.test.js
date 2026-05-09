const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Vec3 } = require("vec3");
const {
  createEmergencyShelterDoorwayPlan,
  createEmergencyShelterPlan,
  createStarterShelterBlueprint,
  createStarterShelterBuildPlan,
  createStarterShelterDoorwayPlan,
  createStarterShelterDoorwaySealPlan,
  createStarterShelterPlan,
  starterShelterMaterialTarget
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

test("starter shelter is a 7x7x6 gabled house shell with a double doorway", () => {
  const base = new Vec3(10, 70, 10);
  const blueprint = createStarterShelterBlueprint(base);
  const starterPlan = createStarterShelterPlan(base);
  const doorwayPlan = createStarterShelterDoorwayPlan(base);
  const sealPlan = createStarterShelterDoorwaySealPlan(base);
  const starterKeys = new Set(starterPlan.map((position) => `${position.x},${position.y},${position.z}`));

  assert.equal(blueprint.id, "ponderer_starter_house_v1");
  assert.deepEqual(blueprint.dimensions, { width: 7, depth: 7, height: 6 });
  assert.equal(blueprint.materialSummary.shelterBlocks, 148);
  assert.equal(blueprint.materialSummary.recommendedShelterBlocks, 160);
  assert.deepEqual(blueprint.materialSummary.byPhase, { foundation: 22, walls: 70, roof: 56 });
  assert.deepEqual(blueprint.route, ["foundation", "walls", "roof", "door", "utilities", "lighting"]);
  assert.equal(starterPlan.length, 148);
  assert.equal(starterKeys.has("7,70,7"), true);
  assert.equal(starterKeys.has("13,73,13"), true);
  assert.equal(starterKeys.has("10,74,10"), true);
  assert.equal(starterKeys.has("10,75,10"), true);
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

test("starter shelter build plan exposes Ponderer-style route, layers, and material checklist", () => {
  const base = new Vec3(0, 64, 0);
  const plan = createStarterShelterBuildPlan(base);
  const layerSteps = plan.buildSteps.filter((step) => step.action === "place_layer");

  assert.equal(plan.blueprintId, "ponderer_starter_house_v1");
  assert.deepEqual(plan.route, ["foundation", "walls", "roof", "door", "utilities", "lighting"]);
  assert.equal(plan.materialChecklist.shelterBlocks, 148);
  assert.equal(plan.materialChecklist.recommendedShelterBlocks, 160);
  assert.equal(starterShelterMaterialTarget(), 160);
  assert.deepEqual(layerSteps.map((step) => step.layer), [0, 1, 2, 3, 4, 5]);
  assert.equal(layerSteps.reduce((sum, step) => sum + step.blockCount, 0), 148);
  assert.equal(plan.buildSteps.at(-1).phase, "lighting");
});

test("starter shelter supports runtime design spec for style variation", () => {
  const base = new Vec3(0, 64, 0);
  const blueprint = createStarterShelterBlueprint(base, {
    designSpec: {
      style: "elegant_timber_starter_house",
      roofType: "hip",
      wallPattern: "timber_frame",
      ridgeDirection: "x",
      roofPitch: 1,
      windowCount: 4
    }
  });

  assert.equal(blueprint.source, "autodesigned_ponderer_style");
  assert.equal(blueprint.style, "elegant_timber_starter_house");
  assert.equal(blueprint.id, "ponderer_starter_house_hip_v1");
  assert.equal(blueprint.dimensions.width, 7);
  assert.equal(blueprint.dimensions.depth, 7);
  assert.equal(blueprint.materialSummary.byRole.roof_hip_ridge > 0, true);
  assert.equal(blueprint.materialSummary.byRole.timber_frame > 0, true);
  assert.deepEqual(blueprint.route, ["foundation", "walls", "roof", "door", "utilities", "lighting"]);
});

test("starter shelter blueprint can be loaded from external template JSON", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "starter-blueprint-"));
  const templatePath = path.join(tempDir, "starter_shelter_blueprint.json");
  const previousPath = process.env.PONDERER_STARTER_BLUEPRINT_JSON;
  process.env.PONDERER_STARTER_BLUEPRINT_JSON = templatePath;

  try {
    fs.writeFileSync(templatePath, JSON.stringify({
      id: "test_imported_house",
      name: "Test Imported House",
      style: "test_style",
      route: ["foundation", "walls", "door"],
      placements: [
        { offset: { x: 0, y: 0, z: 0 }, phase: "foundation", role: "base", material: "oak_planks" },
        { offset: { x: 1, y: 0, z: 0 }, phase: "foundation", role: "base", material: "oak_planks" },
        { offset: { x: 0, y: 1, z: 0 }, phase: "walls", role: "wall", material: "oak_planks" }
      ],
      materialSummary: { doors: 1, torches: 0, craftingTable: 0, furnace: 0, chest: 0, bed: 0 }
    }), "utf8");

    const base = new Vec3(20, 70, 20);
    const blueprint = createStarterShelterBlueprint(base);
    assert.equal(blueprint.id, "test_imported_house");
    assert.equal(blueprint.placements.length, 3);
    assert.equal(blueprint.placements[0].position.x, 20);
    assert.equal(blueprint.placements[0].position.y, 70);
    assert.equal(blueprint.placements[0].position.z, 20);
    assert.deepEqual(blueprint.route, ["foundation", "walls", "door"]);
  } finally {
    if (previousPath) process.env.PONDERER_STARTER_BLUEPRINT_JSON = previousPath;
    else delete process.env.PONDERER_STARTER_BLUEPRINT_JSON;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
