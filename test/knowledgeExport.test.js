const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  findSkillsForTask,
  formatSkillSummaryXml,
  getSurvivalSkill,
  primarySkillForTask,
  validateTaskSequence
} = require("../src/knowledge/survivalSkills");
const { buildPatchouliEntry, buildPondererScene, exportKnowledge } = require("../src/knowledge/exportKnowledge");

test("survival skills expose safe task summaries for future LLM/tool use", () => {
  assert.equal(primarySkillForTask("collect_stone"), "early_stone_tools");
  assert.deepEqual(findSkillsForTask("wait_out_night"), ["reusable_shelter", "night_safety_hold"]);

  const invalidPlan = validateTaskSequence(["collect_wood", "teleport_to_diamond"]);
  assert.equal(invalidPlan.ok, false);
  assert.deepEqual(invalidPlan.unknownTasks, ["teleport_to_diamond"]);

  const summary = formatSkillSummaryXml([getSurvivalSkill("reusable_shelter")]);
  assert.match(summary, /^<available_skills>/);
  assert.match(summary, /reusable_shelter/);
});

test("knowledge exporters build Patchouli and Ponderer compatible JSON shapes", () => {
  const skill = getSurvivalSkill("early_stone_tools");
  const entry = buildPatchouliEntry(skill, "zh_cn");
  const scene = buildPondererScene(skill);

  assert.equal(entry.category, "bot_survival:progression");
  assert.equal(entry.icon, "minecraft:stone_pickaxe");
  assert.ok(entry.pages.some((page) => page.type === "patchouli:text"));

  assert.equal(scene.id, "bot_survival:early_stone_tools");
  assert.deepEqual(scene.items, ["minecraft:stone_pickaxe"]);
  assert.ok(scene.scenes[0].steps.some((step) => step.type === "show_controls"));
});

test("exportKnowledge writes generated skill, Patchouli, and Ponderer files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-survival-knowledge-"));
  const files = exportKnowledge(tempDir);

  assert.ok(files.length >= 20);
  assert.ok(fs.existsSync(path.join(tempDir, "survival-skills.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "patchouli", "bot_survival_guide", "book.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "patchouli", "bot_survival_guide", "zh_cn", "entries", "progression", "early_stone_tools.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "ponderer", "early_stone_tools.json")));

  const skillExport = JSON.parse(fs.readFileSync(path.join(tempDir, "survival-skills.json"), "utf8"));
  assert.ok(skillExport.tools.some((tool) => tool.id === "plan_survival_skill"));
});