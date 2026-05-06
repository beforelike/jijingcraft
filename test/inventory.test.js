const assert = require("node:assert/strict");
const test = require("node:test");
const { FOOD_ITEMS } = require("../src/survival/constants");
const { countItems, inventoryFromBot } = require("../src/survival/inventory");

test("inventoryFromBot counts a held food item that is not listed in inventory slots", () => {
  const inventory = inventoryFromBot({
    heldItem: { name: "chicken", count: 1, slot: 36 },
    inventory: { items: () => [] }
  });

  assert.equal(inventory.chicken, 1);
  assert.equal(countItems(inventory, FOOD_ITEMS), 1);
});

test("inventoryFromBot does not double count the held slot when it is already listed", () => {
  const heldItem = { name: "chicken", count: 1, slot: 36 };
  const inventory = inventoryFromBot({
    heldItem,
    inventory: { items: () => [heldItem] }
  });

  assert.equal(inventory.chicken, 1);
});