const assert = require("node:assert/strict");
const test = require("node:test");
const { chatCompletionsUrl, createOpenAIClient } = require("../src/llm/client");

test("chatCompletionsUrl appends the OpenAI compatible endpoint", () => {
  assert.equal(chatCompletionsUrl("https://example.test/v1/"), "https://example.test/v1/chat/completions");
  assert.equal(chatCompletionsUrl("https://example.test/v1/chat/completions"), "https://example.test/v1/chat/completions");
});

test("OpenAI client sends model, messages, tools, and authorization", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        model: "test-model",
        choices: [{
          message: {
            content: "{\"goal\":\"collect wood\",\"tasks\":[\"collect_wood\"]}",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "validate_task_sequence", arguments: "{}" } }]
          },
          finish_reason: "stop"
        }],
        usage: { prompt_tokens: 10, completion_tokens: 6 }
      })
    };
  };
  const client = createOpenAIClient({ baseUrl: "https://example.test/v1", apiKey: "sk-test", model: "test-model" }, { fetchImpl });

  const response = await client.chatCompletion({
    messages: [{ role: "user", content: "hello" }],
    tools: [{ type: "function", function: { name: "validate_task_sequence" } }],
    responseFormat: { type: "json_object" }
  });

  assert.equal(request.url, "https://example.test/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer sk-test");
  assert.equal(request.body.model, "test-model");
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.equal(response.ok, true);
  assert.equal(response.content.includes("collect wood"), true);
  assert.equal(response.toolCalls[0].name, "validate_task_sequence");
  assert.deepEqual(response.usage, { prompt_tokens: 10, completion_tokens: 6 });
});

test("OpenAI client returns sanitized errors for non-OK responses", async () => {
  const client = createOpenAIClient({ baseUrl: "https://example.test/v1", apiKey: "sk-test", model: "test-model" }, {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: { message: "bad key" } })
    })
  });

  const response = await client.chatCompletion({ messages: [] });

  assert.equal(response.ok, false);
  assert.equal(response.status, 401);
  assert.equal(response.error, "bad key");
});