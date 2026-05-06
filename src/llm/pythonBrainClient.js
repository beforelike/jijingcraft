/**
 * pythonBrainClient.js
 *
 * Drop-in adapter that lets SurvivalController delegate LLM planning to the
 * Python Smart Brain service instead of the JS AgentOrchestrator.
 *
 * When PYTHON_BRAIN_ENABLED=true in .env this module handles planning.
 * Falls back silently to the JS orchestrator on any error so the bot keeps
 * working even if the Python process is not running.
 */

"use strict";

const { buildExecutableBehaviorTree, taskPriority } = require("../behavior/executableBehaviorTree");

const BRAIN_URL = process.env.PYTHON_BRAIN_URL || "http://127.0.0.1:3001";
const ENABLED = process.env.PYTHON_BRAIN_ENABLED === "true";
const TIMEOUT_MS = Number(process.env.PYTHON_BRAIN_TIMEOUT_MS) || 30_000;

// Track consecutive failures to log warnings without spamming.
let _consecutiveFailures = 0;
const _MAX_LOG_CONSECUTIVE = 3;

function _log(msg, ...args) {
  const ts = new Date().toISOString();
  console.log(`[python_brain] ${ts} ${msg}`, ...args);
}

function _warn(msg, ...args) {
  const ts = new Date().toISOString();
  console.warn(`[python_brain] ${ts} WARN ${msg}`, ...args);
}

/**
 * Build the snapshot payload from the same context object that
 * SurvivalController / contextBuilder already produces.
 */
function buildSnapshot(context = {}) {
  const { snapshot = {}, ruleDecision = null, taskFeedback = {}, progress = {} } = context;

  const entities = (snapshot.entities ?? []).map((e) => ({
    name: e.name ?? "",
    distance: e.distance ?? null,
    position: e.position ?? null,
    hostile: e.hostile ?? false
  }));

  return {
    position: snapshot.position ?? null,
    health: snapshot.health ?? 20,
    food: snapshot.food ?? 20,
    isDay: snapshot.isDay ?? true,
    timeOfDay: snapshot.timeOfDay ?? 0,
    entities,
    inventory: snapshot.inventory ?? {},
    ruleDecision: ruleDecision
      ? { type: ruleDecision.type, reason: ruleDecision.reason ?? null, priority: ruleDecision.priority ?? null }
      : null,
    taskFeedback: {
      lastEvent: taskFeedback.lastEvent ?? null,
      blockedTasks: taskFeedback.blockedTasks ?? [],
      recentFailures: taskFeedback.recentFailures ?? []
    },
    memory: progress.memory ?? {},
    terrain: snapshot.terrain ?? null
  };
}

/**
 * Convert a single behaviorTree entry from the Python response into a JS
 * executable behavior tree.  Unrecognised task types are silently dropped
 * (the JS whitelist in buildExecutableBehaviorTree will throw).
 */
function _treeFromEntry(entry) {
  try {
    const tree = buildExecutableBehaviorTree(entry.taskType, {
      priority: taskPriority(entry.taskType),
      source: "python_brain",
      sourceAgent: entry.sourceAgent ?? "general_agent",
      reason: entry.reason ?? null,
      metadata: {
        constructorArgs: entry.constructorArgs ?? {}
      }
    });
    return tree;
  } catch {
    return null;
  }
}

/**
 * Ask the Python Brain for a plan.  Returns an array of executable JS
 * behavior trees (already validated against the whitelist), or null on failure.
 *
 * @param {object} context - same context object passed to AgentOrchestrator.tick()
 * @returns {Promise<{trees: object[], planMeta: object} | null>}
 */
async function requestPlan(context = {}) {
  if (!ENABLED) return null;

  const snapshot = buildSnapshot(context);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${BRAIN_URL}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      _warn(`HTTP ${resp.status} from Python Brain: ${text.slice(0, 200)}`);
      _consecutiveFailures++;
      return null;
    }

    const plan = await resp.json();
    _consecutiveFailures = 0;

    const trees = (plan.behaviorTrees ?? [])
      .map(_treeFromEntry)
      .filter(Boolean);

    return {
      trees,
      planMeta: {
        stageAssessment: plan.stageAssessment ?? "",
        agentProposals: plan.agentProposals ?? [],
        confidence: plan.confidence ?? 0,
        durationMs: plan.durationMs ?? 0
      }
    };
  } catch (err) {
    clearTimeout(timer);
    _consecutiveFailures++;
    if (_consecutiveFailures <= _MAX_LOG_CONSECUTIVE) {
      _warn(`Failed to reach Python Brain (${err.message}). Falling back to JS orchestrator.`);
    }
    return null;
  }
}

/** Quick health check – used on startup to detect if Python Brain is up. */
async function healthCheck() {
  try {
    const resp = await fetch(`${BRAIN_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

module.exports = { requestPlan, buildSnapshot, healthCheck, ENABLED };
