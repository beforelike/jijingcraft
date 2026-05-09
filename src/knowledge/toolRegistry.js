const {
  formatSkillSummaryXml,
  getSurvivalSkill,
  listAllowedTasks,
  listSurvivalSkills,
  validateTaskSequence
} = require("./survivalSkills");
const { buildSkillPlan, recommendSkillsForTask } = require("./skillPlanner");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toolSummary(tool) {
  return {
    id: tool.id,
    summary: tool.summary,
    parameters: clone(tool.parameters ?? {}),
    schema: clone(tool.schema ?? null),
    tags: [...(tool.tags ?? [])]
  };
}

class ToolRegistry {
  constructor(tools = []) {
    this.tools = new Map();
    for (const tool of tools) this.register(tool);
  }

  register(tool) {
    if (!tool || typeof tool.id !== "string" || !tool.id) {
      throw new Error("tool id is required");
    }
    if (typeof tool.handler !== "function") {
      throw new Error(`tool ${tool.id} handler is required`);
    }
    if (this.tools.has(tool.id)) {
      throw new Error(`duplicate tool id: ${tool.id}`);
    }
    this.tools.set(tool.id, Object.freeze({ ...tool }));
    return this;
  }

  getTool(id) {
    return this.tools.get(id) ?? null;
  }

  listTools(context = {}) {
    return [...this.tools.values()]
      .filter((tool) => !tool.trigger || tool.trigger(context))
      .map(toolSummary);
  }

  async callTool(id, params = {}, context = {}) {
    const tool = this.getTool(id);
    if (!tool) {
      return { ok: false, tool: id, error: "unknown_tool" };
    }
    if (tool.trigger && !tool.trigger(context)) {
      return { ok: false, tool: id, error: "tool_not_available" };
    }

    try {
      const result = await tool.handler(params, context);
      return { ok: true, tool: id, result };
    } catch (error) {
      return { ok: false, tool: id, error: error.message };
    }
  }
}

function requireStringParam(params, name) {
  if (!params || typeof params[name] !== "string" || !params[name]) {
    throw new Error(`missing string parameter: ${name}`);
  }
  return params[name];
}

function compactSkill(skill, locale = "zh_cn") {
  return {
    id: skill.id,
    category: skill.category,
    title: skill.title?.[locale] ?? skill.title?.en_us ?? skill.id,
    description: skill.description?.[locale] ?? skill.description?.en_us ?? "",
    tasks: [...skill.tasks],
    safety: [...skill.safety]
  };
}

function createDefaultToolRegistry() {
  return new ToolRegistry([
    {
      id: "list_survival_skills",
      summary: "List controlled survival skills and a compact XML summary for LLM prompts.",
      parameters: {
        locale: "optional locale, defaults to zh_cn"
      },
      schema: {
        type: "object",
        properties: {
          locale: { type: "string", description: "optional locale, defaults to zh_cn" }
        },
        additionalProperties: false
      },
      tags: ["skill", "llm_context"],
      handler: (params = {}) => {
        const locale = params.locale ?? "zh_cn";
        const skills = listSurvivalSkills();
        return {
          summaryXml: formatSkillSummaryXml(skills, locale),
          skills: skills.map((skill) => compactSkill(skill, locale))
        };
      }
    },
    {
      id: "get_survival_skill",
      summary: "Return the full definition for one controlled survival skill.",
      parameters: {
        skillId: "required survival skill id"
      },
      schema: {
        type: "object",
        properties: {
          skillId: { type: "string", description: "required survival skill id" }
        },
        required: ["skillId"],
        additionalProperties: false
      },
      tags: ["skill", "knowledge"],
      handler: (params) => {
        const skillId = requireStringParam(params, "skillId");
        const skill = getSurvivalSkill(skillId);
        if (!skill) throw new Error(`unknown skill: ${skillId}`);
        return skill;
      }
    },
    {
      id: "plan_survival_skill",
      summary: "Build a safe task plan from a controlled survival skill without executing it directly.",
      parameters: {
        skillId: "required survival skill id",
        startAtTask: "optional task id inside the skill",
        maxTasks: "optional positive integer task limit",
        locale: "optional locale, defaults to zh_cn"
      },
      schema: {
        type: "object",
        properties: {
          skillId: { type: "string", description: "required survival skill id" },
          startAtTask: { type: "string", description: "optional task id inside the skill" },
          maxTasks: { type: "integer", minimum: 1, description: "optional positive integer task limit" },
          locale: { type: "string", description: "optional locale, defaults to zh_cn" }
        },
        required: ["skillId"],
        additionalProperties: false
      },
      tags: ["skill", "planner"],
      handler: (params = {}) => {
        const skillId = requireStringParam(params, "skillId");
        const plan = buildSkillPlan(skillId, params);
        if (!plan.ok) throw new Error(plan.error || `invalid skill plan: ${skillId}`);
        return plan;
      }
    },
    {
      id: "validate_task_sequence",
      summary: "Validate that a proposed task sequence only uses BOT safety-whitelisted tasks.",
      parameters: {
        tasks: "required array of task ids"
      },
      schema: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            description: "required array of task ids",
            items: { type: "string" }
          }
        },
        required: ["tasks"],
        additionalProperties: false
      },
      tags: ["planner", "safety"],
      handler: (params = {}) => {
        if (!Array.isArray(params.tasks)) throw new Error("tasks must be an array");
        return {
          ...validateTaskSequence(params.tasks),
          allowedTasks: listAllowedTasks()
        };
      }
    },
    {
      id: "recommend_survival_skill",
      summary: "Recommend controlled skills that contain a current low-level survival task.",
      parameters: {
        taskType: "required current decision task id",
        locale: "optional locale, defaults to zh_cn"
      },
      schema: {
        type: "object",
        properties: {
          taskType: { type: "string", description: "required current decision task id" },
          locale: { type: "string", description: "optional locale, defaults to zh_cn" }
        },
        required: ["taskType"],
        additionalProperties: false
      },
      tags: ["skill", "planner"],
      handler: (params = {}) => {
        const taskType = requireStringParam(params, "taskType");
        return recommendSkillsForTask(taskType, params);
      }
    }
  ]);
}

module.exports = {
  ToolRegistry,
  createDefaultToolRegistry
};