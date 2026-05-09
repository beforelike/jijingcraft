const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BlueprintBrain,
  parseRequiredElements,
  extractJsonFromResponse,
  cleanJsonText
} = require("../src/survival/blueprintBrain");

test("blueprint brain falls back to heuristic design when llm is disabled", async () => {
  const brain = new BlueprintBrain({ llm: { enabled: false, disabledReason: "disabled_by_config" } }, console);
  const result = await brain.designStarterShelter({
    base: { x: 12, y: 70, z: 18 },
    snapshot: {
      terrain: { biome: "forest" },
      entities: []
    },
    progress: { hasStarterShelter: false }
  });

  assert.equal(result.source, "heuristic");
  assert.equal(result.designSpec.wallPattern, "timber_frame");
  assert.equal(result.designSpec.windowCount >= 2, true);
});

test("blueprint brain normalizes llm design output", async () => {
  let callCount = 0;
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      model: "test-model",
      choices: [
        {
          message: {
            content: callCount++ === 0
              ? "Outline draft\nREQUIRED_ELEMENTS: oak planks, cobblestone, torch"
              : JSON.stringify({
                designSpec: {
                  style: "showcase_house",
                  roofType: "hip",
                  roofPitch: 4,
                  wallPattern: "timber_frame",
                  ridgeDirection: "z",
                  windowCount: 12
                },
                materials: ["oak_planks", "cobblestone"]
              })
          }
        }
      ]
    })
  });

  const brain = new BlueprintBrain({
    llm: {
      enabled: true,
      baseUrl: "http://localhost:1234/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 2000
    }
  }, console, { fetchImpl: fakeFetch });

  const result = await brain.designStarterShelter({
    base: { x: 0, y: 70, z: 0 },
    snapshot: { terrain: { biome: "plains" }, entities: [] }
  });

  assert.equal(result.source, "llm");
  assert.equal(result.designSpec.style, "showcase_house");
  assert.equal(result.designSpec.roofType, "hip");
  assert.equal(result.designSpec.roofPitch, 2);
  assert.equal(result.designSpec.windowCount, 8);
  assert.deepEqual(result.recommendedMaterials, ["oak_planks", "cobblestone"]);
});

test("parseRequiredElements handles markdown style lines", () => {
  const outline = [
    "### Draft",
    "**REQUIRED_ELEMENTS:** Oak Planks, Stone,  Cobblestone"
  ].join("\n");
  const parsed = parseRequiredElements(outline);
  assert.deepEqual(parsed, ["Oak Planks", "Stone", "Cobblestone"]);
});

test("extract and clean json handles fenced json with trailing commas", () => {
  const response = [
    "Some commentary",
    "```json",
    "{\"designSpec\":{\"roofType\":\"gable\",},\"materials\":[\"oak_planks\",],}",
    "```"
  ].join("\n");
  const extracted = extractJsonFromResponse(response);
  const cleaned = cleanJsonText(extracted);
  const parsed = JSON.parse(cleaned);
  assert.equal(parsed.designSpec.roofType, "gable");
  assert.deepEqual(parsed.materials, ["oak_planks"]);
});
