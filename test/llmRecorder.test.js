const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { LlmCallRecorder, sanitizeRecord } = require("../src/llm/callRecorder");

test("sanitizeRecord keeps audit fields and excludes API keys", () => {
  const record = sanitizeRecord({
    type: "planner",
    status: "ok",
    model: "test-model",
    baseUrl: "https://example.test/v1",
    apiKey: "sk-secret",
    promptSummary: "stage=food_buffer",
    responseSummary: "ok",
    toolCalls: [{ id: "1", name: "tool", arguments: "{}" }],
    toolResults: [{ id: "1", name: "tool", result: { ok: true, result: { health: 20 } } }]
  });

  assert.equal(record.baseHost, "example.test");
  assert.equal(JSON.stringify(record).includes("sk-secret"), false);
  assert.equal(record.toolCalls[0].name, "tool");
  assert.match(record.toolResults[0].result, /health/);
});

test("LlmCallRecorder writes JSONL records and keeps recent calls", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-llm-records-"));
  const recorder = new LlmCallRecorder({ recordsDir: tempDir, maxRecentCalls: 1 });

  const saved = recorder.record({ type: "planner", status: "ok", model: "test-model", responseSummary: "{}" });
  recorder.record({ type: "planner", status: "error", model: "test-model", error: "bad" });

  const files = fs.readdirSync(tempDir).filter((file) => file.endsWith(".jsonl"));
  assert.equal(files.length, 1);
  const lines = fs.readFileSync(path.join(tempDir, files[0]), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).timestamp, saved.timestamp);
  assert.equal(recorder.listRecent().length, 1);
  assert.equal(recorder.listRecent()[0].status, "error");
});