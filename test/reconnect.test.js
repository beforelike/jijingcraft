const assert = require("node:assert/strict");
const test = require("node:test");
const { computeReconnectDelay } = require("../src/reconnect");

test("computes exponential reconnect delay with a maximum cap", () => {
  const config = { minDelayMs: 1000, maxDelayMs: 5000 };

  assert.equal(computeReconnectDelay(config, 1), 1000);
  assert.equal(computeReconnectDelay(config, 2), 2000);
  assert.equal(computeReconnectDelay(config, 3), 4000);
  assert.equal(computeReconnectDelay(config, 4), 5000);
});

test("keeps reconnect delay non-negative and max at least min", () => {
  assert.equal(computeReconnectDelay({ minDelayMs: -10, maxDelayMs: -1 }, 3), 0);
  assert.equal(computeReconnectDelay({ minDelayMs: 3000, maxDelayMs: 1000 }, 2), 3000);
});