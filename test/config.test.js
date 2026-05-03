const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeMinecraftVersion } = require("../src/config");

test("normalizes empty and auto Minecraft versions to undefined", () => {
  assert.equal(normalizeMinecraftVersion("", () => {}), undefined);
  assert.equal(normalizeMinecraftVersion("auto", () => {}), undefined);
});

test("keeps standard Java Minecraft versions", () => {
  assert.equal(normalizeMinecraftVersion("1.21.1", () => {}), "1.21.1");
  assert.equal(normalizeMinecraftVersion("26.1.1", () => {}), "26.1.1");
});

test("ignores malformed Minecraft versions so mineflayer can auto-detect", () => {
  assert.equal(normalizeMinecraftVersion("release-latest", () => {}), undefined);
});