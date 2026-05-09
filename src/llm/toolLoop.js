const { createDefaultToolRegistry } = require("../knowledge/toolRegistry");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function truncate(value, maxLength = 4000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function schemaFromParameterDescriptions(parameters = {}) {
  return {
    type: "object",
    properties: Object.fromEntries(Object.entries(parameters).map(([name, description]) => [
      name,
      { type: "string", description: String(description) }
    ])),
    additionalProperties: false
  };
}

function openAIToolsFromRegistry(toolRegistry, context = {}) {
  if (!toolRegistry?.listTools) return [];
  return toolRegistry.listTools(context).map((tool) => ({
    type: "function",
    function: {
      name: tool.id,
      description: tool.summary,
      parameters: tool.schema ?? schemaFromParameterDescriptions(tool.parameters)
    }
  }));
}

function parseToolArguments(rawArguments) {
  if (rawArguments === null || rawArguments === undefined || rawArguments === "") return {};
  if (typeof rawArguments === "object") return rawArguments;
  if (typeof rawArguments !== "string") throw new Error("tool arguments must be a JSON object string");
  const parsed = JSON.parse(rawArguments);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("tool arguments must decode to an object");
  return parsed;
}

function normalizedLoopToolCalls(toolCalls = [], turn = 0) {
  return toolCalls.map((call, index) => ({
    id: call.id || `call_${turn}_${index}`,
    type: call.type ?? "function",
    name: call.name,
    arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {})
  })).filter((call) => typeof call.name === "string" && call.name.length > 0);
}

function assistantMessageForToolCalls(response, toolCalls) {
  return {
    role: "assistant",
    content: response.content || null,
    tool_calls: toolCalls.map((call) => ({
      id: call.id,
      type: call.type,
      function: {
        name: call.name,
        arguments: call.arguments
      }
    }))
  };
}

function toolCallBatchSignature(toolCalls) {
  return JSON.stringify(toolCalls.map((call) => ({ name: call.name, arguments: call.arguments })));
}

function toolResultMessage(call, result) {
  return {
    role: "tool",
    tool_call_id: call.id,
    name: call.name,
    content: truncate(result)
  };
}

async function executeToolCall(toolRegistry, call, toolContext = {}) {
  try {
    const params = parseToolArguments(call.arguments);
    const result = await toolRegistry.callTool(call.name, params, toolContext);
    return {
      id: call.id,
      name: call.name,
      arguments: params,
      result
    };
  } catch (error) {
    return {
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      result: {
        ok: false,
        tool: call.name,
        error: `invalid_tool_arguments: ${error.message}`
      }
    };
  }
}

async function runToolCallingLoop({
  client,
  toolRegistry,
  messages,
  config = {},
  request = {},
  toolContext = {}
} = {}) {
  const maxToolTurns = Math.max(0, Number(config.maxToolTurns ?? 8));
  const toolMessages = clone(messages ?? []);
  const openAITools = openAIToolsFromRegistry(toolRegistry, toolContext);
  const toolCalls = [];
  const toolResults = [];
  const usageByTurn = [];
  const seenBatches = new Set();
  let toolTurnCount = 0;

  for (let turn = 0; turn <= maxToolTurns + 1; turn++) {
    const response = await client.chatCompletion({
      ...request,
      messages: toolMessages,
      tools: openAITools.length ? openAITools : undefined,
      toolChoice: openAITools.length ? request.toolChoice ?? "auto" : undefined,
      timeoutMs: request.timeoutMs ?? config.timeoutMs
    });
    if (response.usage) usageByTurn.push(response.usage);

    if (!response.ok) {
      return {
        ok: false,
        status: "error",
        error: response.error,
        response,
        messages: toolMessages,
        toolCalls,
        toolResults,
        usageByTurn
      };
    }

    const currentToolCalls = normalizedLoopToolCalls(response.toolCalls, turn);
    if (!currentToolCalls.length) {
      return {
        ok: true,
        status: "ok",
        response,
        messages: toolMessages,
        toolCalls,
        toolResults,
        usageByTurn,
        toolTurnCount
      };
    }

    toolCalls.push(...currentToolCalls);
    if (toolTurnCount >= maxToolTurns) {
      return {
        ok: false,
        status: "max_tool_turns_exceeded",
        error: `max_tool_turns_exceeded_${maxToolTurns}`,
        response,
        messages: toolMessages,
        toolCalls,
        toolResults,
        usageByTurn,
        toolTurnCount
      };
    }

    const signature = toolCallBatchSignature(currentToolCalls);
    if (seenBatches.has(signature)) {
      return {
        ok: false,
        status: "repeated_tool_batch",
        error: "repeated_tool_batch",
        response,
        messages: toolMessages,
        toolCalls,
        toolResults,
        usageByTurn,
        toolTurnCount
      };
    }
    seenBatches.add(signature);

    toolMessages.push(assistantMessageForToolCalls(response, currentToolCalls));
    for (const call of currentToolCalls) {
      const result = await executeToolCall(toolRegistry, call, toolContext);
      toolResults.push(result);
      toolMessages.push(toolResultMessage(call, result.result));
    }
    toolTurnCount++;
  }

  return {
    ok: false,
    status: "tool_loop_exhausted",
    error: "tool_loop_exhausted",
    messages: toolMessages,
    toolCalls,
    toolResults,
    usageByTurn,
    toolTurnCount
  };
}

function createPlannerToolRegistry(baseRegistry = createDefaultToolRegistry()) {
  const registry = baseRegistry;
  const addIfMissing = (tool) => {
    if (!registry.getTool(tool.id)) registry.register(tool);
  };

  addIfMissing({
    id: "query_status",
    summary: "Return the current compact bot status, world state, active rule decision, and controller safety state.",
    parameters: {},
    schema: { type: "object", properties: {}, additionalProperties: false },
    tags: ["context", "status"],
    handler: (_params, context = {}) => {
      const plannerContext = context.plannerContext ?? {};
      return {
        bot: plannerContext.bot ?? null,
        world: plannerContext.world ?? null,
        compactState: plannerContext.compactState ?? null,
        currentRuleDecision: plannerContext.currentRuleDecision ?? null,
        currentSkillPlan: plannerContext.currentSkillPlan ?? null,
        controller: plannerContext.controller ?? null,
        nearbyEntities: plannerContext.nearbyEntities ?? []
      };
    }
  });

  addIfMissing({
    id: "query_compact_state",
    summary: "Return the Mindcraft-style compact full_state payload for quick planning.",
    parameters: {},
    schema: { type: "object", properties: {}, additionalProperties: false },
    tags: ["context", "status", "compact_state"],
    handler: (_params, context = {}) => context.plannerContext?.compactState ?? null
  });

  addIfMissing({
    id: "query_task_parameter_knowledge",
    summary: "Return allowed behavior-tree task classes, constructor argument hints, and the translated Mindcraft command/skill catalog.",
    parameters: {},
    schema: { type: "object", properties: {}, additionalProperties: false },
    tags: ["context", "tasks", "parameters"],
    handler: (_params, context = {}) => ({
      allowedTasks: context.plannerContext?.allowedTasks ?? [],
      taskTreeClasses: context.plannerContext?.taskTreeClasses ?? [],
      taskParameterKnowledge: context.plannerContext?.taskParameterKnowledge ?? null
    })
  });

  addIfMissing({
    id: "query_progress",
    summary: "Return survival milestone progress and the current next milestone.",
    parameters: {},
    schema: { type: "object", properties: {}, additionalProperties: false },
    tags: ["context", "progress"],
    handler: (_params, context = {}) => context.plannerContext?.progress ?? null
  });

  addIfMissing({
    id: "query_memory",
    summary: "Return compact survival memory counts and recent learning outcomes.",
    parameters: {},
    schema: { type: "object", properties: {}, additionalProperties: false },
    tags: ["context", "memory"],
    handler: (_params, context = {}) => context.plannerContext?.memory ?? null
  });

  return registry;
}

module.exports = {
  createPlannerToolRegistry,
  executeToolCall,
  openAIToolsFromRegistry,
  parseToolArguments,
  runToolCallingLoop,
  toolCallBatchSignature
};