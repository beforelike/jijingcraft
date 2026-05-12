const { buildExecutableBehaviorTree, taskLevel, taskPriority } = require("../behavior/executableBehaviorTree");

const SAFETY_TASKS = new Set(["escape_hazard", "escape_pit", "descend_from_platform", "create_or_open_exit", "eat_food", "recover_starvation"]);
const COMBAT_TASKS = new Set(["evade_hostiles", "defend_shelter", "defend_self"]);
const SURVIVAL_TASKS = new Set(["hunt_food", "collect_wood", "explore", "wait_out_night", "hold_position"]);
const ENGINEERING_TASKS = new Set([
  "craft_basic_supplies",
  "craft_basic_tools",
  "collect_stone",
  "craft_stone_tools",
  "craft_furnace",
  "craft_weapon",
  "collect_building_materials",
  "build_shelter",
  "collect_wool",
  "craft_bed",
  "collect_crop_seeds",
  "plant_crops",
  "build_animal_pen",
  "lure_animals",
  "mine_advanced_materials"
]);

function nowIso() {
  return new Date().toISOString();
}

function agentStatus(id, active, reason = null) {
  return { id, active, reason, updatedAt: nowIso() };
}

function blockedTaskEntry(context = {}, taskType = null) {
  if (!taskType) return null;
  const blockedTasks = context.taskFeedback?.blockedTasks;
  if (Array.isArray(blockedTasks)) return blockedTasks.find((task) => task?.taskType === taskType) ?? null;
  if (blockedTasks && typeof blockedTasks === "object") return blockedTasks[taskType] ?? null;
  return null;
}

function recoveryTaskForBlockedTask(context = {}, blockedTask = null) {
  for (const taskType of blockedTask?.recoveryTasks ?? []) {
    if (taskType !== blockedTask.taskType && !blockedTaskEntry(context, taskType)) return taskType;
  }
  return null;
}

function parseTimeMs(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

class AgentOrchestrator {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.failedProposalCooldownMs = Math.max(0, Number(options.failedProposalCooldownMs ?? 45000));
    this.lastStatus = {
      enabled: this.enabled,
      generalAgent: agentStatus("general_agent", true, "always_on"),
      agents: [],
      lastProposals: [],
      feedback: [],
      updatedAt: nowIso()
    };
  }

  tick(context = {}) {
    if (!this.enabled) return this.getStatus();
    const taskType = context.ruleDecision?.type ?? null;
    const activeAgents = [agentStatus("general_agent", true, "always_on")];
    if (SAFETY_TASKS.has(taskType)) activeAgents.push(agentStatus("safety_agent", true, taskType));
    else activeAgents.push(agentStatus("safety_agent", false, "no_immediate_safety_task"));

    if (COMBAT_TASKS.has(taskType)) activeAgents.push(agentStatus("combat_agent", true, taskType));
    else activeAgents.push(agentStatus("combat_agent", false, "no_combat_task"));

    if (SURVIVAL_TASKS.has(taskType)) activeAgents.push(agentStatus("survival_agent", true, taskType));
    else activeAgents.push(agentStatus("survival_agent", false, "survival_not_needed"));

    if (ENGINEERING_TASKS.has(taskType)) activeAgents.push(agentStatus("engineering_agent", true, taskType));
    else activeAgents.push(agentStatus("engineering_agent", false, "engineering_not_needed"));

    const proposals = this.createProposals(taskType, activeAgents, context);
    this.lastStatus = {
      enabled: this.enabled,
      generalAgent: activeAgents[0],
      agents: activeAgents.slice(1),
      lastProposals: proposals.map((proposal) => ({
        treeId: proposal.tree.id,
        taskType: proposal.tree.taskType,
        level: proposal.tree.level ?? taskLevel(proposal.tree.taskType),
        priority: proposal.tree.priority,
        sourceAgent: proposal.tree.sourceAgent,
        reason: proposal.tree.reason,
        at: proposal.at
      })),
      feedback: this.lastStatus.feedback,
      updatedAt: nowIso()
    };
    return { status: this.getStatus(), proposals };
  }

  createProposals(taskType, activeAgents, context) {
    if (!taskType) return [];
    const activeAgent = activeAgents.find((agent) => agent.id !== "general_agent" && agent.active);
    if (!activeAgent) return [];

    const blockedTask = blockedTaskEntry(context, taskType);
    const proposalTaskType = blockedTask ? recoveryTaskForBlockedTask(context, blockedTask) : taskType;
    if (!proposalTaskType || context.behaviorQueue?.hasTask?.(proposalTaskType)) return [];
    if (this.isRecentlyFailedProposal(proposalTaskType, context)) return [];

    const tree = buildExecutableBehaviorTree(proposalTaskType, {
      priority: taskPriority(proposalTaskType),
      source: "agent_orchestrator",
      sourceAgent: activeAgent.id,
      reason: blockedTask
        ? `general_agent redirected ${activeAgent.id} from blocked ${taskType} to ${proposalTaskType}`
        : `general_agent activated ${activeAgent.id} for ${taskType}`,
      metadata: {
        ruleDecision: taskType,
        blockedTask: blockedTask?.taskType ?? null,
        blockedReason: blockedTask?.reason ?? null,
        progressStage: context.progress?.stage ?? null
      }
    });
    return [{ tree, at: nowIso() }];
  }

  isRecentlyFailedProposal(taskType, context = {}) {
    if (!taskType || this.failedProposalCooldownMs <= 0) return false;
    const queueFeedback = context.behaviorQueue?.getStatus?.().feedback ?? [];
    const feedback = [...queueFeedback, ...(this.lastStatus.feedback ?? [])]
      .filter((entry) => entry?.taskType === taskType && ["failed", "skipped"].includes(entry.outcome));
    const newestAt = feedback
      .map((entry) => parseTimeMs(entry.at))
      .filter((time) => time !== null)
      .sort((left, right) => right - left)[0];
    return newestAt !== undefined && Date.now() - newestAt < this.failedProposalCooldownMs;
  }

  recordFeedback(feedback = {}) {
    this.lastStatus.feedback.unshift({ ...feedback, at: feedback.at ?? nowIso() });
    this.lastStatus.feedback = this.lastStatus.feedback.slice(0, 24);
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.lastStatus));
  }
}

module.exports = {
  AgentOrchestrator,
  blockedTaskEntry,
  COMBAT_TASKS,
  ENGINEERING_TASKS,
  recoveryTaskForBlockedTask,
  SAFETY_TASKS,
  SURVIVAL_TASKS
};