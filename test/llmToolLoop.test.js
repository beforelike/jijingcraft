const assert = require("node:assert/strict");
const test = require("node:test");
const { ToolRegistry, createDefaultToolRegistry } = require("../src/knowledge/toolRegistry");
const {
  createPlannerToolRegistry,
  openAIToolsFromRegistry,
  parseToolArguments,
  runToolCallingLoop
} = require("../src/llm/toolLoop");

test("openAIToolsFromRegistry exposes JSON schemas for controlled tools", () => {
  const registry = createPlannerToolRegistry(createDefaultToolRegistry());
  const tools = openAIToolsFromRegistry(registry, {});
  const validateTool = tools.find((tool) => tool.function.name === "validate_task_sequence");
  const statusTool = tools.find((tool) => tool.function.name === "query_status");
  const compactStateTool = tools.find((tool) => tool.function.name === "query_compact_state");
  const parameterKnowledgeTool = tools.find((tool) => tool.function.name === "query_task_parameter_knowledge");
  const minecraftKnowledgeTool = tools.find((tool) => tool.function.name === "query_minecraft_knowledge");

  assert.equal(validateTool.function.parameters.properties.tasks.type, "array");
  assert.deepEqual(validateTool.function.parameters.required, ["tasks"]);
  assert.equal(statusTool.function.parameters.additionalProperties, false);
  assert.equal(compactStateTool.function.parameters.additionalProperties, false);
  assert.equal(parameterKnowledgeTool.function.parameters.additionalProperties, false);
  assert.equal(minecraftKnowledgeTool.function.parameters.additionalProperties, false);
});

test("parseToolArguments accepts JSON objects and rejects invalid payloads", () => {
  assert.deepEqual(parseToolArguments("{\"tasks\":[\"collect_wood\"]}"), { tasks: ["collect_wood"] });
  assert.deepEqual(parseToolArguments(""), {});
  assert.throws(() => parseToolArguments("[]"), /decode to an object/);
  assert.throws(() => parseToolArguments("not-json"), /Unexpected token/);
});

test("runToolCallingLoop executes tool calls and feeds results back to the model", async () => {
  const registry = new ToolRegistry([
    {
      id: "query_status",
      summary: "status",
      schema: { type: "object", properties: {}, additionalProperties: false },
      handler: () => ({ health: 20 })
    }
  ]);
  const seenMessages = [];
  const client = {
    chatCompletion: async ({ messages, tools }) => {
      seenMessages.push(messages);
      assert.equal(tools[0].function.name, "query_status");
      if (seenMessages.length === 1) {
        return {
          ok: true,
          content: "",
          toolCalls: [{ id: "call_1", name: "query_status", arguments: "{}" }],
          usage: { total_tokens: 10 }
        };
      }
      assert.equal(messages.at(-1).role, "tool");
      assert.match(messages.at(-1).content, /health/);
      return {
        ok: true,
        content: JSON.stringify({ goal: "stay safe", tasks: ["hold_position"] }),
        toolCalls: [],
        usage: { total_tokens: 8 }
      };
    }
  };

  const result = await runToolCallingLoop({
    client,
    toolRegistry: registry,
    messages: [{ role: "user", content: "plan" }],
    config: { maxToolTurns: 2 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.toolTurnCount, 1);
  assert.equal(result.toolResults[0].result.ok, true);
  assert.match(result.response.content, /stay safe/);
});

test("runToolCallingLoop returns bad argument feedback as a tool result", async () => {
  const registry = new ToolRegistry([
    {
      id: "validate_task_sequence",
      summary: "validate",
      schema: { type: "object", properties: { tasks: { type: "array", items: { type: "string" } } }, required: ["tasks"], additionalProperties: false },
      handler: () => ({ ok: true })
    }
  ]);
  const client = {
    calls: 0,
    async chatCompletion() {
      this.calls++;
      if (this.calls === 1) {
        return { ok: true, content: "", toolCalls: [{ id: "bad_args", name: "validate_task_sequence", arguments: "[]" }] };
      }
      return { ok: true, content: JSON.stringify({ goal: "repair", tasks: ["hold_position"] }), toolCalls: [] };
    }
  };

  const result = await runToolCallingLoop({
    client,
    toolRegistry: registry,
    messages: [{ role: "user", content: "plan" }],
    config: { maxToolTurns: 2 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.toolResults[0].result.ok, false);
  assert.match(result.toolResults[0].result.error, /invalid_tool_arguments/);
});

test("runToolCallingLoop stops repeated tool batches", async () => {
  const registry = new ToolRegistry([
    { id: "query_status", summary: "status", handler: () => ({ ok: true }) }
  ]);
  const client = {
    async chatCompletion() {
      return { ok: true, content: "", toolCalls: [{ id: "same", name: "query_status", arguments: "{}" }] };
    }
  };

  const result = await runToolCallingLoop({
    client,
    toolRegistry: registry,
    messages: [{ role: "user", content: "plan" }],
    config: { maxToolTurns: 3 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "repeated_tool_batch");
  assert.equal(result.toolResults.length, 1);
});

test("runToolCallingLoop enforces max tool turns", async () => {
  const registry = new ToolRegistry([
    { id: "query_status", summary: "status", handler: () => ({ ok: true }) }
  ]);
  const client = {
    async chatCompletion() {
      return { ok: true, content: "", toolCalls: [{ id: "call", name: "query_status", arguments: "{}" }] };
    }
  };

  const result = await runToolCallingLoop({
    client,
    toolRegistry: registry,
    messages: [{ role: "user", content: "plan" }],
    config: { maxToolTurns: 0 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "max_tool_turns_exceeded");
});