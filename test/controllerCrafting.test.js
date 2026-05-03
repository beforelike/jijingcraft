const assert = require("node:assert/strict");
const test = require("node:test");
const { SurvivalController } = require("../src/survival/SurvivalController");

test("craftPlanks maps carried logs to their plank recipe", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let crafted = null;
  controller.bot = {
    inventory: {
      items: () => [{ name: "spruce_log", count: 1 }]
    }
  };
  controller.craftItem = async (itemName, count, requireTable) => {
    crafted = { itemName, count, requireTable };
    return true;
  };

  await controller.craftPlanks(4);

  assert.deepEqual(crafted, {
    itemName: "spruce_planks",
    count: 1,
    requireTable: false
  });
});