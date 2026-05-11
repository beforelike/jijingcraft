const { buildExecutableBehaviorTree, taskPriority } = require("../behavior/executableBehaviorTree");
const { HOSTILE_MOBS } = require("../survival/constants");
const { buildPlannerContext, isGeneralAgentBlockedTask, isOxygenRelevant } = require("./contextBuilder");

function normalizedBaseUrl(url) {
  return String(url || "http://127.0.0.1:3001").replace(/\/+$/, "");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizePosition(position) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
}

function normalizeBlockedTasks(blockedTasks) {
  if (Array.isArray(blockedTasks)) return blockedTasks;
  if (blockedTasks && typeof blockedTasks === "object") return Object.values(blockedTasks);
  return [];
}

function normalizeEntity(entity = {}) {
  const name = entity.name ?? "";
  return {
    name,
    distance: Number.isFinite(Number(entity.distance)) ? Number(entity.distance) : null,
    position: normalizePosition(entity.position),
    hostile: Boolean(entity.hostile) || HOSTILE_MOBS.has(name)
  };
}

function buildPythonBrainRequest(context = {}) {
  const { snapshot = {}, ruleDecision = null, taskFeedback = {}, progress = {}, memory = {}, controller = {} } = context;
  const plannerContext = buildPlannerContext({
    snapshot,
    progress,
    memory,
    decision: ruleDecision,
    skillEnvelope: context.skillEnvelope,
    dimension: context.dimension,
    controller: {
      ...controller,
      taskFeedback: {
        ...taskFeedback,
        blockedTasks: normalizeBlockedTasks(taskFeedback.blockedTasks)
      }
    }
  });
  const filteredSnapshot = {
    position: normalizePosition(snapshot.position),
    health: Number(snapshot.health ?? 20),
    food: Number(snapshot.food ?? 20),
    isDay: snapshot.isDay ?? !snapshot.isNight,
    isNight: Boolean(snapshot.isNight),
    timeOfDay: Number(snapshot.timeOfDay ?? 0),
    entities: (snapshot.entities ?? []).map(normalizeEntity),
    inventory: snapshot.inventory ?? {},
    terrain: cloneJson(snapshot.terrain),
    environmentHazard: cloneJson(snapshot.environmentHazard),
    navigationTrap: Boolean(snapshot.navigationTrap),
    navigationAnalysis: cloneJson(snapshot.navigationAnalysis),
    isInLava: Boolean(snapshot.isInLava),
    isBodyInWater: Boolean(snapshot.isBodyInWater)
  };
  if (isOxygenRelevant(snapshot)) filteredSnapshot.oxygen = Number(snapshot.oxygen);

  return {
    source: "node_survival_controller",
    snapshot: filteredSnapshot,
    ruleDecision: ruleDecision ? {
      type: ruleDecision.type,
      reason: ruleDecision.reason ?? null,
      priority: ruleDecision.priority ?? null,
      target: ruleDecision.target ?? null
    } : null,
    taskFeedback: {
      lastEvent: taskFeedback.lastEvent ?? null,
      blockedTasks: normalizeBlockedTasks(taskFeedback.blockedTasks),
      recentFailures: taskFeedback.recentFailures ?? []
    },
    progress: progress ?? {},
    memory: memory ?? {},
    controller: controller ?? {},
    plannerContext
  };
}

function planEntryToTree(entry = {}, sourcePlanId = null) {
  if (!entry || typeof entry.taskType !== "string") return null;
  const sourceAgent = entry.sourceAgent ?? "general_agent";
  const requestedBy = entry.requestedBy ?? "general_agent";
  if (isGeneralAgentBlockedTask(entry.taskType) && (sourceAgent === "general_agent" || requestedBy === "general_agent")) return null;
  try {
    return buildExecutableBehaviorTree(entry.taskType, {
      treeClass: entry.treeClass,
      taskFunction: entry.taskFunction,
      constructorArgs: entry.constructorArgs ?? entry.parameters ?? {},
      priority: taskPriority(entry.taskType),
      source: "python_brain",
      sourceAgent,
      requestedBy,
      taskRequestId: entry.taskRequestId,
      sourcePlanId,
      reason: entry.reason ?? "python_brain_plan",
      preconditions: entry.preconditions,
      postconditions: entry.postconditions,
      metadata: {
        pythonBrain: true,
        constructorArgs: entry.constructorArgs ?? entry.parameters ?? {}
      }
    });
  } catch {
    return null;
  }
}

class PythonBrainClient {
  constructor(config = {}, options = {}) {
    this.config = config ?? {};
    this.fetchImpl = options.fetchImpl ?? global.fetch;
    this.enabled = Boolean(this.config.enabled);
    this.baseUrl = normalizedBaseUrl(this.config.url);
    this.timeoutMs = Math.max(1000, Number(this.config.timeoutMs) || 30000);
    this.lastStatus = {
      enabled: this.enabled,
      status: this.enabled ? "idle" : "disabled",
      url: this.baseUrl,
      lastCallAt: null,
      lastError: null,
      lastPlan: null
    };
  }

  getStatus() {
    return { ...this.lastStatus };
  }

  publish(update = {}) {
    this.lastStatus = {
      ...this.lastStatus,
      ...update,
      enabled: this.enabled,
      url: this.baseUrl,
      updatedAt: new Date().toISOString()
    };
    return this.getStatus();
  }

  async requestPlan(context = {}) {
    if (!this.enabled || typeof this.fetchImpl !== "function") return null;
    const body = buildPythonBrainRequest(context);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    this.publish({ status: "planning", lastCallAt: new Date(startedAt).toISOString(), lastError: null });
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const error = `HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`;
        this.publish({ status: "error", lastError: error });
        return null;
      }
      const plan = await response.json();
      const sourcePlanId = `${Date.now()}:python_brain`;
      const trees = (plan.behaviorTrees ?? []).map((entry) => planEntryToTree(entry, sourcePlanId)).filter(Boolean);
      this.publish({ status: trees.length ? "planned" : "empty", lastPlan: plan, lastError: null });
      return { plan, trees, durationMs: Date.now() - startedAt, sourcePlanId };
    } catch (error) {
      clearTimeout(timer);
      const message = error.name === "AbortError" ? `timeout_${this.timeoutMs}ms` : error.message;
      this.publish({ status: "error", lastError: message });
      return null;
    }
  }

  async healthCheck(timeoutMs = 3000) {
    if (typeof this.fetchImpl !== "function") return { ok: false, error: "fetch_unavailable" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, payload };
    } catch (error) {
      clearTimeout(timer);
      return { ok: false, error: error.name === "AbortError" ? `timeout_${timeoutMs}ms` : error.message };
    }
  }
}

module.exports = {
  PythonBrainClient,
  buildPythonBrainRequest,
  planEntryToTree,
  normalizedBaseUrl
};