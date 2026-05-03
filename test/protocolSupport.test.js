const assert = require("node:assert/strict");
const test = require("node:test");
const { buildProtocolDiagnosis } = require("../src/protocolSupport");

test("marks server version unsupported when protocol library lacks it", () => {
  const diagnosis = buildProtocolDiagnosis(
    { version: { name: "26.1.1", protocol: 775 } },
    ["1.21.9", "1.21.11"]
  );

  assert.equal(diagnosis.supported, false);
  assert.equal(diagnosis.serverVersion, "26.1.1");
  assert.equal(diagnosis.protocol, 775);
  assert.equal(diagnosis.latestSupported, "1.21.11");
});

test("marks server version supported when it is in the protocol list", () => {
  const diagnosis = buildProtocolDiagnosis(
    { version: { name: "1.21.11", protocol: 774 } },
    ["1.21.9", "1.21.11"]
  );

  assert.equal(diagnosis.supported, true);
});