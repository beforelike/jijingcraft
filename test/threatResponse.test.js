const assert = require("node:assert/strict");
const test = require("node:test");
const { chooseHostileDamageResponse } = require("../src/survival/threatResponse");

const base = {
  health: 16,
  criticalHealth: 8,
  distance: 3,
  immediateThreatRadius: 8,
  hasWeapon: true
};

test("defends when damaged by a melee hostile while armed", () => {
  assert.equal(chooseHostileDamageResponse(base), "defend");
});

test("defends against close zombie damage before retreating into bad terrain", () => {
  assert.equal(chooseHostileDamageResponse({ ...base, targetName: "zombie", distance: 6 }), "defend");
});

test("retreats first when damaged outside melee range even when armed", () => {
  assert.equal(chooseHostileDamageResponse({ ...base, targetName: "zombie", distance: 7 }), "retreat");
});

test("retreats from close ranged hostile damage instead of chasing", () => {
  assert.equal(chooseHostileDamageResponse({ ...base, targetName: "skeleton", distance: 6 }), "retreat");
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