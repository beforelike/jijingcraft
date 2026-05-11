const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CORPUS_PATH = path.resolve(__dirname, "..", "..", "data", "knowledge", "minecraft-survival-rag.jsonl");
const DEFAULT_WIKI_CORPUS_PATH = path.resolve(__dirname, "..", "..", "data", "knowledge", "wiki", "minecraft-wiki-rag.jsonl");

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "below", "by", "can", "do", "does", "for", "from", "has", "have",
  "how", "i", "if", "in", "into", "is", "it", "me", "my", "near", "of", "on", "or", "should", "the", "there",
  "through", "to", "under", "what", "when", "where", "why", "will", "with", "without"
]);

const CHINESE_QUERY_ALIASES = Object.freeze([
  [/沙子|沙块|沙地|沙滩/g, "sand beach"],
  [/红沙/g, "red_sand sand"],
  [/砂砾|沙砾/g, "gravel"],
  [/可疑的沙子/g, "suspicious_sand sand"],
  [/可疑的砂砾|可疑的沙砾/g, "suspicious_gravel gravel"],
  [/混凝土粉/g, "concrete_powder concrete powder"],
  [/下落方块|掉落方块/g, "falling_block falling blocks gravity"],
  [/没有支撑|无支撑|失去支撑|挖掉支撑|支撑/g, "support supporting block unsupported"],
  [/下落|掉落|坠落|塌落|塌方|坍塌/g, "fall falling gravity collapse"],
  [/卡住|埋住|掩埋|活埋/g, "buried burial body head collision suffocation"],
  [/窒息|憋死/g, "suffocation suffocate inside block damage"],
  [/掉血|扣血|伤害|生命/g, "damage health difficulty regeneration tick"],
  [/玩家|机器人|bot|BOT/g, "player bot normal_player gamemode abilities attributes"],
  [/采石|挖石头|石头|圆石/g, "collect_stone stone cobblestone surface_stone mining"],
  [/安全/g, "safe safety stable"],
  [/避免|避开/g, "avoid hazard risk"],
  [/摔落|摔伤|跌落/g, "fall fall_damage hazard"],
  [/向下挖|垂直挖|脚下挖/g, "digging downward vertical shaft unsafe"],
  [/楼梯矿|阶梯矿|矿道|采矿|挖矿|开矿/g, "stair_mine staircase mining mine hazard"],
  [/食物|饥饿|饱食度|吃/g, "food hunger saturation eat"],
  [/牛/g, "cow beef leather"],
  [/猪/g, "pig porkchop"],
  [/鸡/g, "chicken feather egg"],
  [/羊/g, "sheep mutton wool"],
  [/鱼|鳕鱼|鲑鱼|三文鱼/g, "fish cod salmon"],
  [/下界门|地狱门/g, "nether portal obsidian flint steel"],
  [/黑曜石/g, "obsidian"],
  [/打火石|燧石/g, "flint steel"],
  [/熔岩|岩浆/g, "lava"],
  [/水/g, "water"],
  [/火把/g, "torch light hostile spawn"],
  [/床/g, "bed sleep night"],
  [/门/g, "door shelter"],
  [/庇护所|避难所|房子|基地/g, "shelter house base"],
  [/怪物|敌对生物|僵尸|骷髅/g, "hostile mobs zombie skeleton"],
  [/工具|镐|斧|剑|铲/g, "tools pickaxe axe sword shovel"],
  [/红石/g, "redstone"],
  [/比较器/g, "comparator"],
  [/减法模式/g, "subtract mode"],
  [/自动分类机|分类机/g, "item sorter storage"],
  [/怎么做/g, "build craft"]
]);

const BUILTIN_CORPUS = Object.freeze([
  {
    id: "falling_blocks_support_gravity",
    title: "Falling block support and gravity",
    topic: "falling_blocks",
    tasks: ["collect_stone", "mine_advanced_materials", "explore"],
    tags: ["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel", "concrete_powder", "support", "gravity"],
    source: "local_minecraft_survival_rag_v1",
    content: "Sand, red sand, gravel, suspicious sand, suspicious gravel, and concrete powder are gravity-affected blocks. If the block directly below them is removed or becomes non-solid, they become falling entities and drop into the opened column.",
    rules: [
      "Before digging any block, check whether a falling block is directly above it.",
      "Do not remove the support block under sand, red_sand, gravel, suspicious_sand, suspicious_gravel, or concrete_powder during normal mining.",
      "A collect_stone target with falling blocks above its column is unsafe even if the stone itself is diggable."
    ]
  },
  {
    id: "falling_blocks_suffocation",
    title: "Falling sand burial and suffocation",
    topic: "falling_blocks",
    tasks: ["escape_hazard", "collect_stone"],
    tags: ["suffocation", "buried", "damage", "sand", "gravel", "health"],
    source: "local_minecraft_survival_rag_v1",
    content: "A falling block can land in the player's feet or head space. When a solid block occupies the body or head space, the player can take suffocation damage. This is normal survival damage, not a permission or attribute difference.",
    rules: [
      "If sand or gravel occupies the BOT feet or head block, stop the current task and clear or leave that block immediately.",
      "Treat falling-block burial as an escape_hazard condition even when lava, cactus, fire, and berry bushes are absent.",
      "Record active effects, gamemode, abilities, and difficulty separately before claiming a BOT has special protection."
    ]
  },
  {
    id: "collect_stone_beach_relocation",
    title: "Collect stone around beach and desert terrain",
    topic: "collect_stone",
    tasks: ["collect_stone", "explore"],
    tags: ["beach", "desert", "riverbed", "surface_stone", "stony_shore", "sand", "gravel"],
    source: "local_minecraft_survival_rag_v1",
    content: "Beach, desert, riverbed, and gravel shore surfaces are often covered by falling blocks. Early stone collection should prefer exposed surface stone, cave mouths, cliffs, rocky hillsides, or stony shores instead of digging downward through sand.",
    rules: [
      "When local ground is mostly sand or gravel, relocate before starting a stair mine probe.",
      "Prefer surface_stone_search or explore toward rocky terrain before underground probing.",
      "Never treat sand and gravel like dirt while opening a mine entrance."
    ]
  },
  {
    id: "starter_first_day_progression",
    title: "First day survival progression",
    topic: "survival_progression",
    tasks: ["collect_wood", "craft_basic_supplies", "craft_basic_tools", "hunt_food", "build_shelter"],
    tags: ["wood", "logs", "planks", "crafting_table", "pickaxe", "shelter", "food", "first_day"],
    source: "local_minecraft_survival_rag_v1",
    content: "On the first day, collect logs, craft planks, craft a crafting table, make basic tools including a pickaxe, gather stone when safe, secure food, and prepare a shelter before night. The BOT should treat this as an ordered survival progression, not random exploration.",
    rules: [
      "Start with collect_wood when the inventory lacks logs or planks.",
      "Craft planks and a crafting table before tool recipes that require a 3x3 grid.",
      "Craft a pickaxe before collecting stone, then build food reserve and shelter before open-ended exploration."
    ]
  },
  {
    id: "safe_stair_mine_probe",
    title: "Safe stair mine probe under unstable terrain",
    topic: "mining",
    tasks: ["collect_stone", "mine_advanced_materials"],
    tags: ["stair_mine", "probe", "support", "stand_position", "collapse"],
    source: "local_minecraft_survival_rag_v1",
    content: "A stair mine probe is only acceptable when the next feet/head spaces, the support block, and the stand position are free of falling-block collapse risk. Mining from a side stand is safer than standing above or below the target column.",
    rules: [
      "Reject a probe step if the next feet/head space is sand or gravel, has sand or gravel above it, or rests on sand or gravel.",
      "Reject stand positions with falling blocks above the body column or unsupported falling blocks immediately adjacent.",
      "If a remembered mine worksite cannot be extended safely, abandon it and explore for exposed stone."
    ]
  },
  {
    id: "normal_player_state_parity",
    title: "BOT must remain a normal survival player",
    topic: "player_state",
    tasks: ["diagnostics", "escape_hazard", "survival"],
    tags: ["gamemode", "effects", "abilities", "attributes", "difficulty", "normal_player"],
    source: "local_minecraft_survival_rag_v1",
    content: "The survival BOT must not receive special permissions, creative/spectator mode, invulnerability, flying, altered movement speed, or hidden damage resistance. Runtime diagnostics should observe these fields rather than modifying them.",
    rules: [
      "Do not issue gamemode, effect, attribute, fly, invulnerable, or permission commands for the BOT.",
      "Expose gamemode, active effects, abilities, movement-speed attribute, health, food, oxygen, and difficulty in status snapshots when available.",
      "If damage looks slower than a human player, check difficulty, active effects, server plugins, regeneration, tick rate, and whether the damage source is suffocation before changing BOT code."
    ]
  },
  {
    id: "suffocation_damage_context",
    title: "Slow damage during block burial",
    topic: "damage",
    tasks: ["escape_hazard", "diagnostics"],
    tags: ["suffocation", "damage_rate", "server_difficulty", "regeneration", "tick_rate"],
    source: "local_minecraft_survival_rag_v1",
    content: "Suffocation damage can look slower or different from combat damage because it is applied by block occupancy and server tick rules. Food saturation, regeneration, difficulty, potion effects, and server plugins can change the visible health curve.",
    rules: [
      "Do not assume slow damage means special BOT attributes until gamemode, effects, abilities, difficulty, and server behavior are inspected.",
      "When buried by falling blocks, the correct behavior is escape and clear body space, not accepting the damage rate.",
      "Dashboard diagnostics should flag suspicious player-state differences without applying any privileged fix."
    ]
  }
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .match(/[a-z0-9_]+|[\u4e00-\u9fff]/g) ?? [];
}

function expandQueryText(value) {
  const text = String(value ?? "");
  const expansions = [];
  for (const [pattern, replacement] of CHINESE_QUERY_ALIASES) {
    if (pattern.test(text)) expansions.push(replacement);
    pattern.lastIndex = 0;
  }
  return expansions.length ? `${text} ${[...new Set(expansions)].join(" ")}` : text;
}

function queryTokensFromText(value) {
  return [...new Set(tokenize(expandQueryText(value)).filter((token) => !STOP_WORDS.has(token) && !/^[\u4e00-\u9fff]$/.test(token)))];
}

function documentText(document) {
  return [
    document.id,
    document.title,
    document.topic,
    ...(document.tasks ?? []),
    ...(document.tags ?? []),
    document.content,
    ...(document.rules ?? [])
  ].join(" ");
}

function normalizeDocument(document) {
  const normalized = {
    id: String(document.id ?? "unknown"),
    title: String(document.title ?? document.id ?? "unknown"),
    topic: String(document.topic ?? "general"),
    tasks: Array.isArray(document.tasks) ? document.tasks.map(String) : [],
    tags: Array.isArray(document.tags) ? document.tags.map(String) : [],
    source: String(document.source ?? "local_minecraft_survival_rag"),
    content: String(document.content ?? ""),
    rules: Array.isArray(document.rules) ? document.rules.map(String) : []
  };
  for (const field of ["sourceTitle", "sourceUrl", "revisionId", "revisionTimestamp", "retrievedAt", "license", "chunk", "quality"]) {
    if (document[field] !== undefined) normalized[field] = clone(document[field]);
  }
  return normalized;
}

function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => normalizeDocument(JSON.parse(line)));
}

function loadOptionalCorpus(corpusPath) {
  if (!corpusPath || !fs.existsSync(corpusPath)) return [];
  return parseJsonl(fs.readFileSync(corpusPath, "utf8"));
}

function loadMinecraftKnowledgeCorpus(corpusPath = DEFAULT_CORPUS_PATH) {
  if (fs.existsSync(corpusPath)) {
    return parseJsonl(fs.readFileSync(corpusPath, "utf8"));
  }
  return buildMinecraftRagCorpus();
}

function scoreDocument(document, queryTokens, params = {}) {
  const textTokens = queryTokensFromText(documentText(document));
  const tokenCounts = new Map();
  for (const token of textTokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);

  let score = 0;
  for (const token of queryTokens) {
    score += tokenCounts.has(token) ? Math.min(6, tokenCounts.get(token)) : 0;
    if (document.tags.some((tag) => tag.toLowerCase() === token)) score += 3;
    if (document.topic.toLowerCase() === token) score += 4;
    if (document.tasks.some((task) => task.toLowerCase() === token)) score += 4;
    if (document.title.toLowerCase().includes(token)) score += 2;
  }

  const taskType = String(params.taskType ?? "").toLowerCase();
  const topic = String(params.topic ?? "").toLowerCase();
  if (taskType && document.tasks.some((task) => task.toLowerCase() === taskType)) score += 10;
  if (topic && document.topic.toLowerCase() === topic) score += 16;

  return score;
}

function knowledgeConfidence(scored, queryTokens) {
  const topScore = scored[0]?.score ?? 0;
  const matchedTokens = new Set();
  for (const entry of scored.slice(0, 3)) {
    const documentTokens = new Set(queryTokensFromText(documentText(entry.document)));
    for (const token of queryTokens) {
      if (documentTokens.has(token)) matchedTokens.add(token);
    }
  }
  const coverage = queryTokens.length ? matchedTokens.size / queryTokens.length : 0;
  const level = topScore >= 45 && coverage >= 0.35
    ? "high"
    : topScore >= 18 && coverage >= 0.2
      ? "medium"
      : "low";
  return {
    level,
    topScore,
    matchedQueryTokens: [...matchedTokens].sort(),
    queryTokenCount: queryTokens.length,
    coverage: Number(coverage.toFixed(3)),
    insufficientKnowledge: level === "low"
  };
}

function queryLocalMinecraftKnowledge(params = {}) {
  const limit = Math.max(1, Math.min(12, Number(params.limit) || 4));
  const corpus = loadMinecraftKnowledgeCorpus(params.corpusPath);
  const query = [params.query, params.taskType, params.topic, ...(Array.isArray(params.tags) ? params.tags : [])].filter(Boolean).join(" ");
  const expandedQuery = expandQueryText(query);
  const queryTokens = queryTokensFromText(query);
  const hasQueryText = query.trim().length > 0;
  const ranked = corpus
    .map((document) => ({ document, score: scoreDocument(document, queryTokens, params) }))
    .filter((entry) => entry.score > 0 || (!hasQueryText && !queryTokens.length && entry.document.topic === "falling_blocks"))
    .sort((left, right) => right.score - left.score || left.document.id.localeCompare(right.document.id));
  const scored = ranked
    .slice(0, limit)
    .map(({ document, score }) => ({ ...clone(document), score }));

  return {
    source: "local_minecraft_survival_rag",
    corpusPath: params.corpusPath ?? DEFAULT_CORPUS_PATH,
    totalDocuments: corpus.length,
    query,
    expandedQuery,
    queryTokens,
    confidence: knowledgeConfidence(ranked, queryTokens),
    results: scored
  };
}

function compactLocalMinecraftKnowledge(params = {}) {
  const result = queryLocalMinecraftKnowledge({ ...params, limit: params.limit ?? 4 });
  return {
    source: result.source,
    totalDocuments: result.totalDocuments,
    query: result.query,
    confidence: result.confidence,
    results: result.results.map((document) => ({
      id: document.id,
      title: document.title,
      topic: document.topic,
      tasks: document.tasks,
      tags: document.tags.slice(0, 8),
      content: document.content,
      rules: document.rules,
      score: document.score
    }))
  };
}

function buildMinecraftRagCorpus(options = {}) {
  const wikiCorpusPath = options.wikiCorpusPath ?? DEFAULT_WIKI_CORPUS_PATH;
  return [
    ...clone(BUILTIN_CORPUS).map(normalizeDocument),
    ...loadOptionalCorpus(wikiCorpusPath)
  ];
}

module.exports = {
  BUILTIN_CORPUS,
  DEFAULT_CORPUS_PATH,
  DEFAULT_WIKI_CORPUS_PATH,
  buildMinecraftRagCorpus,
  compactLocalMinecraftKnowledge,
  expandQueryText,
  loadMinecraftKnowledgeCorpus,
  queryTokensFromText,
  queryLocalMinecraftKnowledge,
  tokenize
};
