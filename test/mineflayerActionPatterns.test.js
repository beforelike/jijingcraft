const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectBlockSearchNames,
  compactMineflayerActionPatterns,
  isReplaceablePlacementBlock,
  movementProfileFromPathProbe,
  placementFaceOrder,
  shouldRepositionBeforePlacement
} = require("../src/knowledge/mineflayerActionPatterns");
const { compactMindcraftTaskKnowledge, taskParameterHintsForTask } = require("../src/knowledge/mindcraftTaskKnowledge");

test("collectBlock search names expand safe resource aliases", () => {
  assert.deepEqual(collectBlockSearchNames("cobblestone"), ["cobblestone", "stone"]);
  assert.deepEqual(collectBlockSearchNames("iron"), ["iron", "iron_ore"]);
  assert.deepEqual(collectBlockSearchNames("iron_ore"), ["iron_ore", "deepslate_iron_ore"]);
  assert.deepEqual(collectBlockSearchNames("dirt"), ["dirt", "grass_block"]);
});

test("placement face order follows requested side then safe fallbacks", () => {
  const sideFaces = placementFaceOrder("side");
  assert.deepEqual(sideFaces.slice(0, 4).map((entry) => entry.label), ["north", "south", "east", "west"]);
  assert.deepEqual(placementFaceOrder("bottom")[0].face, { x: 0, y: 1, z: 0 });
  assert.equal(new Set(sideFaces.map((entry) => `${entry.face.x},${entry.face.y},${entry.face.z}`)).size, 6);
});

test("placement helpers keep collision and replaceable checks explicit", () => {
  assert.equal(isReplaceablePlacementBlock("air"), true);
  assert.equal(isReplaceablePlacementBlock("stone"), false);
  assert.equal(shouldRepositionBeforePlacement({ itemName: "oak_planks", feetDistance: 0.8, headDistance: 2 }), true);
  assert.equal(shouldRepositionBeforePlacement({ itemName: "torch", feetDistance: 0.8, headDistance: 2 }), false);
});

test("goToGoal path probe helper chooses the least destructive profile", () => {
  assert.equal(movementProfileFromPathProbe({ nonDestructiveStatus: "success" }).profile, "non_destructive");
  assert.equal(movementProfileFromPathProbe({ nonDestructiveStatus: "timeout", destructiveStatus: "success" }).profile, "destructive");
  assert.equal(movementProfileFromPathProbe({ nonDestructiveStatus: "timeout", destructiveStatus: "timeout" }).profile, "destructive_fallback_attempt");
});

test("Mindcraft command and skill catalog translates to Smart Brain parameter knowledge", () => {
  const knowledge = compactMindcraftTaskKnowledge();
  const collectBlocks = knowledge.commandMappings.find((mapping) => mapping.command === "!collectBlocks");
  assert.ok(collectBlocks.mapsTo.includes("collect_wood"));
  assert.equal(collectBlocks.parameterBridge.num, "constructorArgs.count");
  assert.ok(knowledge.alwaysVisibleSkillDocs.some((doc) => doc.skill === "skills.placeBlock"));
  assert.equal(knowledge.primitivePatterns.collectBlock.examples.cobblestone[1], "stone");
  assert.ok(taskParameterHintsForTask("build_shelter").patterns.includes("placeBlock_face_fallback"));
  assert.deepEqual(compactMineflayerActionPatterns().goToGoal.outputs, ["non_destructive", "destructive", "destructive_fallback_attempt"]);
});