const {
  findSkillsForTask,
  getSurvivalSkill,
  primarySkillForTask,
  validateTaskSequence
} = require("./survivalSkills");

function localize(value, locale = "zh_cn") {
  if (!value || typeof value !== "object") return value;
  return value[locale] ?? value.en_us ?? Object.values(value)[0];
}

function buildSkillPlan(skillId, options = {}) {
  const skill = getSurvivalSkill(skillId);
  if (!skill) {
    return {
      ok: false,
      skillId,
      error: "unknown_skill",
      tasks: [],
      nextTask: null
    };
  }

  const validation = validateTaskSequence(skill.tasks);
  const startIndex = options.startAtTask ? skill.tasks.indexOf(options.startAtTask) : 0;
  if (options.startAtTask && startIndex === -1) {
    return {
      ok: false,
      skillId,
      error: "start_task_not_in_skill",
      tasks: [],
      nextTask: null
    };
  }

  const maxTasks = Number.isInteger(options.maxTasks) && options.maxTasks > 0 ? options.maxTasks : skill.tasks.length;
  const tasks = skill.tasks.slice(startIndex, startIndex + maxTasks);

  return {
    ok: validation.ok,
    skillId: skill.id,
    category: skill.category,
    title: localize(skill.title, options.locale),
    description: localize(skill.description, options.locale),
    tasks,
    nextTask: tasks[0] ?? null,
    taskCount: tasks.length,
    preconditions: skill.preconditions,
    success: skill.success,
    safety: skill.safety,
    sourcePatterns: skill.sourcePatterns,
    unknownTasks: validation.unknownTasks
  };
}

function recommendSkillsForTask(taskType, options = {}) {
  const skillIds = findSkillsForTask(taskType);
  return {
    taskType,
    primarySkillId: primarySkillForTask(taskType),
    skillIds,
    plans: skillIds.map((skillId) => buildSkillPlan(skillId, options))
  };
}

function skillEnvelopeForDecision(decision, options = {}) {
  const taskType = typeof decision === "string" ? decision : decision?.type;
  const recommendation = recommendSkillsForTask(taskType, options);
  return {
    taskType,
    primarySkillId: recommendation.primarySkillId,
    skillIds: recommendation.skillIds,
    plan: recommendation.primarySkillId ? buildSkillPlan(recommendation.primarySkillId, options) : null
  };
}

module.exports = {
  buildSkillPlan,
  recommendSkillsForTask,
  skillEnvelopeForDecision
};