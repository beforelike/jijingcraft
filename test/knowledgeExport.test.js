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
const { compactMinecraftSurvivalGuide } = require("../src/knowledge/minecraftSurvivalGuide");
const { DEFAULT_CORPUS_PATH, expandQueryText, queryLocalMinecraftKnowledge } = require("../src/knowledge/minecraftKnowledgeBase");
const { isFallingBlockName, queryMinecraftWikiKnowledge } = require("../src/knowledge/minecraftWikiKnowledge");

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
  assert.ok(fs.existsSync(path.join(tempDir, "research-missions.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "minecraft-survival-rag.jsonl")));
  assert.ok(fs.existsSync(path.join(tempDir, "patchouli", "bot_survival_guide", "book.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "patchouli", "bot_survival_guide", "zh_cn", "entries", "progression", "early_stone_tools.json")));
  assert.ok(fs.existsSync(path.join(tempDir, "ponderer", "early_stone_tools.json")));

  const skillExport = JSON.parse(fs.readFileSync(path.join(tempDir, "survival-skills.json"), "utf8"));
  assert.ok(skillExport.tools.some((tool) => tool.id === "plan_survival_skill"));
  assert.ok(skillExport.researchMissions.some((mission) => mission.id === "platform_descent"));

  const missionExport = JSON.parse(fs.readFileSync(path.join(tempDir, "research-missions.json"), "utf8"));
  assert.ok(missionExport.missions.some((mission) => mission.id === "starter_food_buffer"));

  const ragLines = fs.readFileSync(path.join(tempDir, "minecraft-survival-rag.jsonl"), "utf8").trim().split(/\r?\n/);
  assert.ok(ragLines.length >= 6);
  assert.ok(ragLines.some((line) => /falling_blocks_support_gravity/.test(line)));
});

test("minecraft knowledge marks falling blocks and beach stone collection risk", () => {
  assert.equal(isFallingBlockName("sand"), true);
  assert.equal(isFallingBlockName("red_concrete_powder"), true);
  assert.equal(isFallingBlockName("dirt"), false);

  const wiki = queryMinecraftWikiKnowledge({ taskType: "collect_stone" });
  assert.match(wiki.summary, /stone/i);
  assert.ok(wiki.rules.some((rule) => /sand|gravel|concrete_powder/.test(rule)));
  assert.ok(wiki.fallingBlocks.includes("sand"));

  const guide = compactMinecraftSurvivalGuide();
  assert.ok(guide.sourceUrls.some((url) => url.includes("Tutorial:Mining")));
  assert.ok(guide.environmentRules.some((rule) => /gravity-affected falling blocks/.test(rule)));
  assert.ok(guide.taskNotes.collect_stone.some((note) => /covered by sand/.test(note)));

  assert.ok(fs.existsSync(DEFAULT_CORPUS_PATH));
  const rag = queryLocalMinecraftKnowledge({ taskType: "collect_stone", query: "sand gravel support falling", limit: 3 });
  assert.equal(rag.source, "local_minecraft_survival_rag");
  assert.ok(rag.results.some((entry) => entry.id === "falling_blocks_support_gravity"));
  assert.ok(rag.results.some((entry) => entry.rules.some((rule) => /support/.test(rule))));
});

test("minecraft RAG expands Chinese survival queries and reports confidence", () => {
  assert.match(expandQueryText("沙子没有支撑会不会下落并卡住玩家"), /sand/);
  assert.match(expandQueryText("沙子没有支撑会不会下落并卡住玩家"), /suffocation/);

  const fallingSand = queryLocalMinecraftKnowledge({ query: "沙子没有支撑会不会下落并卡住玩家", limit: 4 });
  assert.equal(fallingSand.confidence.insufficientKnowledge, false);
  assert.ok(fallingSand.results.some((entry) => /sand|falling/i.test(`${entry.title} ${entry.content}`)));
  assert.ok(fallingSand.results.some((entry) => /suffocation|buried|head/i.test(`${entry.content} ${(entry.rules || []).join(" ")}`)));

  const unrelated = queryLocalMinecraftKnowledge({ query: "红石比较器减法模式怎么做自动分类机", limit: 4 });
  assert.equal(unrelated.confidence.insufficientKnowledge, true);
});