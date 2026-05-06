const fs = require("node:fs");
const path = require("node:path");
const { listSurvivalSkills, formatSkillSummaryXml } = require("./survivalSkills");
const { listResearchMissions } = require("./researchMissionCatalog");
const { createDefaultToolRegistry } = require("./toolRegistry");

const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, "..", "..", "data", "knowledge");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function skillText(skill, field, locale = "zh_cn") {
  return skill[field]?.[locale] ?? skill[field]?.en_us ?? "";
}

function buildPatchouliBook() {
  return {
    name: "BOT Survival Guide",
    landing_text: "Minecraft survival bot skill guide generated from the controlled survival skill registry.",
    version: 1,
    show_progress: false,
    use_resource_pack: true
  };
}

function buildPatchouliCategory(category, locale = "zh_cn") {
  const names = {
    progression: { zh_cn: "生存进度", en_us: "Survival Progression" },
    survival: { zh_cn: "食物与生命", en_us: "Food and Health" },
    base: { zh_cn: "基地建设", en_us: "Base Building" },
    safety: { zh_cn: "安全底座", en_us: "Safety Rules" },
    mining: { zh_cn: "采矿", en_us: "Mining" }
  };
  return {
    name: names[category]?.[locale] ?? category,
    description: locale === "zh_cn"
      ? "由当前 Mineflayer BOT 技能库导出的可检索知识。"
      : "Searchable knowledge exported from the current Mineflayer bot skill registry.",
    icon: "minecraft:book",
    sortnum: 0
  };
}

function buildPatchouliEntry(skill, locale = "zh_cn") {
  return {
    name: skillText(skill, "title", locale),
    icon: skill.icon,
    category: `bot_survival:${skill.category}`,
    pages: [
      {
        type: "patchouli:text",
        text: skillText(skill, "description", locale)
      },
      {
        type: "patchouli:text",
        title: locale === "zh_cn" ? "任务顺序" : "Task Flow",
        text: skill.tasks.join(" -> ")
      },
      {
        type: "patchouli:text",
        title: locale === "zh_cn" ? "成功条件" : "Success",
        text: skill.success.join(", ")
      },
      {
        type: "patchouli:text",
        title: locale === "zh_cn" ? "安全规则" : "Safety",
        text: skill.safety.join(", ")
      }
    ]
  };
}

function buildPondererScene(skill) {
  const taskSteps = skill.tasks.slice(0, 6).flatMap((task, index) => ([
    {
      type: "show_controls",
      duration: 50,
      point: [index + 0.5, 1.6, 0.5],
      direction: "down",
      action: "right",
      item: skill.icon,
      attachKeyFrame: index === 0
    },
    {
      type: "text",
      duration: 70,
      text: {
        en_us: task,
        zh_cn: task
      },
      point: [index + 0.5, 2.0, 0.5],
      color: index === 0 ? "green" : "input",
      placeNearTarget: true
    },
    { type: "idle", duration: 15 }
  ]));

  return {
    id: `bot_survival:${skill.id}`,
    items: [skill.icon],
    title: skill.title,
    structures: [],
    tags: ["bot_survival", skill.category],
    scenes: [
      {
        id: `${skill.id}_flow`,
        title: skill.title,
        steps: [
          {
            type: "text",
            duration: 90,
            text: skill.description,
            point: [0.5, 1.5, 0.5],
            color: "green",
            placeNearTarget: true,
            attachKeyFrame: true
          },
          { type: "idle", duration: 30 },
          ...taskSteps
        ]
      }
    ]
  };
}

function exportKnowledge(outputRoot = DEFAULT_OUTPUT_ROOT) {
  const skills = listSurvivalSkills();
  const researchMissions = listResearchMissions();
  const tools = createDefaultToolRegistry().listTools();
  const files = [];

  const write = (relativePath, value) => {
    const filePath = path.join(outputRoot, relativePath);
    writeJson(filePath, value);
    files.push(filePath);
  };

  write("survival-skills.json", {
    generatedFrom: ["TouhouLittleMaid skill registry", "Patchouli book format", "Ponderer scene DSL", "Voyager skill loop", "Malmo mission pattern", "Minecraft_AI query feedback"],
    skillSummaryXml: formatSkillSummaryXml(skills),
    tools,
    skills,
    researchMissions
  });

  write("research-missions.json", {
    generatedFrom: ["Project Malmo mission observations/rewards/quits", "Minecraft_AI action feedback loop", "current Mineflayer test pipeline"],
    missions: researchMissions
  });

  write(path.join("patchouli", "bot_survival_guide", "book.json"), buildPatchouliBook());
  for (const category of [...new Set(skills.map((skill) => skill.category))]) {
    write(path.join("patchouli", "bot_survival_guide", "zh_cn", "categories", `${category}.json`), buildPatchouliCategory(category, "zh_cn"));
    write(path.join("patchouli", "bot_survival_guide", "en_us", "categories", `${category}.json`), buildPatchouliCategory(category, "en_us"));
  }

  for (const skill of skills) {
    write(path.join("patchouli", "bot_survival_guide", "zh_cn", "entries", skill.category, `${skill.id}.json`), buildPatchouliEntry(skill, "zh_cn"));
    write(path.join("patchouli", "bot_survival_guide", "en_us", "entries", skill.category, `${skill.id}.json`), buildPatchouliEntry(skill, "en_us"));
    write(path.join("ponderer", `${skill.id}.json`), buildPondererScene(skill));
  }

  return files;
}

if (require.main === module) {
  const outputRoot = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUTPUT_ROOT;
  const files = exportKnowledge(outputRoot);
  console.log(`exported ${files.length} knowledge files to ${outputRoot}`);
}

module.exports = {
  buildPatchouliBook,
  buildPatchouliCategory,
  buildPatchouliEntry,
  buildPondererScene,
  exportKnowledge
};