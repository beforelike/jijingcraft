#!/usr/bin/env node
const { queryLocalMinecraftKnowledge } = require("../src/knowledge/minecraftKnowledgeBase");

const CASES = [
  {
    id: "falling_sand_support",
    query: "If I dig the block below sand, will sand fall and can it bury the bot?",
    taskType: "collect_stone",
    topic: "falling_blocks",
    expect: [/support|supporting block/i, /fall|falling/i, /suffocation|bury|buried/i]
  },
  {
    id: "sand_chinese_without_context",
    query: "沙子没有支撑会不会下落并卡住玩家",
    expect: [/sand/i, /fall|falling/i, /support/i, /suffocation|buried|head/i]
  },
  {
    id: "concrete_powder_water",
    query: "混凝土粉掉进水里会发生什么",
    topic: "falling_blocks",
    expect: [/concrete powder/i, /water/i, /solidifies|concrete/i]
  },
  {
    id: "beach_collect_stone",
    query: "BOT 在沙滩要采石头，能不能直接向下挖沙子",
    taskType: "collect_stone",
    expect: [/beach|sand|gravel/i, /exposed stone|relocate|surface/i, /digging downward|downward|probe/i]
  },
  {
    id: "suffocation_damage_rate",
    query: "BOT 被沙子埋住掉血很慢，需要检查哪些普通玩家状态",
    taskType: "escape_hazard",
    topic: "damage",
    expect: [/suffocation/i, /difficulty|effects|regeneration|tick/i, /gamemode|abilities|attribute|protection/i]
  },
  {
    id: "beginner_first_day",
    query: "新手第一天应该先做什么，原木、工作台、镐子、庇护所、食物怎么排",
    topic: "survival_progression",
    expect: [/wood|logs/i, /crafting table|pickaxe/i, /shelter|food/i]
  },
  {
    id: "mining_safe_method",
    query: "安全开矿应该用什么方法避免熔岩、下落沙子和摔落",
    taskType: "collect_stone",
    topic: "mining",
    expect: [/mine|mining/i, /stair|side|branch|safe/i, /hazard|lava|fall|sand|gravel/i]
  },
  {
    id: "nether_portal_coverage",
    query: "下界门需要黑曜石和打火石怎么搭建",
    topic: "nether",
    expect: [/nether|portal/i, /obsidian/i, /flint|steel/i]
  },
  {
    id: "animal_food_coverage",
    query: "牛猪鸡羊和鱼能提供什么食物",
    topic: "food",
    expect: [/cow|pig|chicken|sheep|fish|cod|salmon|beef|pork|mutton/i]
  },
  {
    id: "out_of_scope_redstone",
    query: "红石比较器减法模式怎么做自动分类机",
    expect: [/comparator|redstone|sorter/i],
    expectedWeak: true
  }
];

function compact(entry) {
  return {
    id: entry.id,
    title: entry.title,
    source: entry.source,
    topic: entry.topic,
    score: entry.score,
    snippet: entry.content.slice(0, 240).replace(/\s+/g, " ")
  };
}

function evaluateCase(testCase) {
  const result = queryLocalMinecraftKnowledge({
    query: testCase.query,
    taskType: testCase.taskType,
    topic: testCase.topic,
    tags: testCase.tags,
    limit: 6
  });
  const text = result.results.map((entry) => `${entry.title}\n${entry.content}\n${(entry.rules || []).join("\n")}`).join("\n");
  const matched = testCase.expect.map((pattern) => pattern.test(text));
  return {
    id: testCase.id,
    ok: matched.every(Boolean),
    expectedWeak: Boolean(testCase.expectedWeak),
    matched,
    resultCount: result.results.length,
    wikiHits: result.results.filter((entry) => entry.source === "minecraft_wiki_local_crawl").length,
    confidence: result.confidence,
    top: result.results.slice(0, 3).map(compact)
  };
}

function runEvaluation() {
  const report = CASES.map(evaluateCase);
  const strong = report.filter((item) => !item.expectedWeak);
  const weak = report.filter((item) => item.expectedWeak);
  return {
    summary: {
      cases: report.length,
      pass: report.filter((item) => item.ok).length,
      fail: report.filter((item) => !item.ok).length,
      strongCases: strong.length,
      strongPass: strong.filter((item) => item.ok).length,
      weakCases: weak.length,
      weakLowConfidence: weak.filter((item) => item.confidence.insufficientKnowledge).length
    },
    report
  };
}

if (require.main === module) {
  const evaluation = runEvaluation();
  console.log(JSON.stringify(evaluation, null, 2));
  if (evaluation.summary.strongPass !== evaluation.summary.strongCases) process.exitCode = 1;
}

module.exports = { CASES, runEvaluation };