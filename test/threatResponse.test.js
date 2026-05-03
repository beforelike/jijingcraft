const assert = require("node:assert/strict");
const test = require("node:test");
const { chooseHostileDamageResponse } = require("../src/survival/threatResponse");

const base = {
  health: 16,
  criticalHealth: 8,
  distance: 5,
  immediateThreatRadius: 8,
  hasWeapon: true
};

test("retreats first when damaged by a close hostile even when armed", () => {
  assert.equal(chooseHostileDamageResponse(base), "retreat");
});

test("retreats from damage when unarmed", () => {
  assert.equal(chooseHostileDamageResponse({ ...base, hasWeapon: false }), "retreat");
});

test("retreats from damage when health is critical", () => {
  assert.equal(chooseHostileDamageResponse({ ...base, health: 6 }), "retreat");
});

test("retreats from distant hostile damage instead of chasing", () => {
  assert.equal(chooseHostileDamageResponse({ ...base, distance: 18 }), "retreat");
});