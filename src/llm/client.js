function chatCompletionsUrl(baseUrl) {
  const clean = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!clean) throw new Error("LLM baseUrl is required");
  if (clean.endsWith("/chat/completions")) return clean;
  return `${clean}/chat/completions`;
}

function normalizeToolCalls(toolCalls = []) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((call) => ({
    id: call.id ?? null,
    type: call.type ?? "function",
    name: call.function?.name ?? call.name ?? null,
    arguments: call.function?.arguments ?? call.arguments ?? "{}"
  }));
}

function createOpenAIClient(config = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is not available in this Node runtime");

  async function chatCompletion(request = {}) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? config.timeoutMs ?? 30000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const body = {
      model: request.model ?? config.model,
      messages: request.messages ?? []
    };
    if (request.tools) body.tools = request.tools;
    if (request.toolChoice) body.tool_choice = request.toolChoice;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.responseFormat) body.response_format = request.responseFormat;

    try {
      const response = await fetchImpl(chatCompletionsUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch (error) {
        return {
          ok: false,
          status: response.status,
          durationMs: Date.now() - startedAt,
          error: `invalid_json_response: ${error.message}`
        };
      }

      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          durationMs: Date.now() - startedAt,
          error: data?.error?.message ?? response.statusText ?? "request_failed"
        };
      }

      const message = data?.choices?.[0]?.message ?? {};
      return {
        ok: true,
        status: response.status,
        durationMs: Date.now() - startedAt,
        model: data?.model ?? body.model,
        content: message.content ?? "",
        toolCalls: normalizeToolCalls(message.tool_calls),
        finishReason: data?.choices?.[0]?.finish_reason ?? null,
        usage: data?.usage ?? null
      };
    } catch (error) {
      return {
        ok: false,
        status: null,
        durationMs: Date.now() - startedAt,
        error: error.name === "AbortError" ? `request_timeout_${timeoutMs}ms` : error.message
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { chatCompletion };
}

module.exports = {
  chatCompletionsUrl,
  createOpenAIClient,
  normalizeToolCalls
};