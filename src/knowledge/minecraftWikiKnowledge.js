const TREE_BEARING_SURFACE_PATTERN = /(_log|_wood|_leaves|_stem|_hyphae)$/;
const FALLING_BLOCK_NAMES = new Set(["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel"]);

const MINECRAFT_WIKI_KNOWLEDGE = Object.freeze({
  source: "project_mc_wiki_knowledge_base",
  version: "Minecraft Java survival 1.21.x",
  topics: {
    wood: {
      summary: "Wood comes from trees and giant fungi. For early survival, known logs/leaves in the map are stronger evidence than random exploration.",
      taskRules: [
        "For collect_wood, never move away from a known log, leaf cluster, forest, taiga, jungle, swamp, mangrove, cherry grove, or wooded area unless it is unreachable or unsafe.",
        "If the regional scan has tree cells, travel toward the nearest safe tree cell before random walking.",
        "If a nearby tree cell is across water, first find shore or a dry stand near the tree; ordinary water with oxygen is movement terrain, not a hazard.",
        "Avoid exploring toward ocean, deep ocean, river center, desert, badlands, beach, snowy ice flats, or mushroom fields when the current goal is wood unless no tree evidence exists.",
        "Prefer low reachable trunk blocks; leaves are useful as a direction signal but logs are the harvest target."
      ],
      treeBlocks: ["*_log", "*_wood", "*_leaves", "mangrove_roots", "mushroom_stem", "crimson_stem", "warped_stem"],
      likelyWoodBiomes: [
        "forest",
        "birch_forest",
        "dark_forest",
        "old_growth_birch_forest",
        "taiga",
        "old_growth_pine_taiga",
        "old_growth_spruce_taiga",
        "jungle",
        "sparse_jungle",
        "bamboo_jungle",
        "swamp",
        "mangrove_swamp",
        "cherry_grove",
        "windswept_forest",
        "wooded_badlands"
      ],
      lowWoodBiomes: ["ocean", "deep_ocean", "river", "desert", "beach", "badlands", "mushroom_fields", "ice_spikes"],
      planningHint: "When task=collect_wood and map memory has tree evidence, set targetPosition toward that tree evidence instead of choosing open water or treeless terrain."
    },
    biomes: {
      summary: "Biome choice should follow the resource goal. Tree-bearing biomes are good for wood; open water and deserts are poor wood targets.",
      rules: [
        "Forests, taigas, jungles, swamps, mangrove swamps, cherry groves, and wooded hills usually contain wood.",
        "Oceans, rivers, deserts, beaches, mushroom fields, and ice spikes usually do not solve collect_wood quickly.",
        "Plains can contain scattered trees but are weaker than visible logs/leaves or forest-like regions."
      ]
    },
    exploration: {
      summary: "Exploration is not random wandering when the map already contains task-relevant evidence.",
      rules: [
        "Use known resource positions and coarse map cells before random offsets.",
        "For a blocked task, choose exploration targets that are likely to unblock that exact task.",
        "Avoid recently unreachable positions and avoid moving farther from a visible target resource.",
        "A fallback random walk is only appropriate after known evidence has been tried or no evidence exists."
      ]
    },
    water: {
      summary: "Water is traversable while oxygen remains; it is not a damaging block by itself.",
      rules: [
        "For dry-land tasks, leave water or find shore before doing normal work.",
        "Do not classify ordinary water as collect_wood progress.",
        "Low oxygen changes priority to escape_hazard or oxygen recovery."
      ]
    },
    falling_blocks: {
      summary: "Sand, red sand, gravel, suspicious sand, suspicious gravel, and concrete powder are gravity-affected blocks.",
      taskRules: [
        "If the support below sand or gravel is removed, it can turn into a falling block and drop into the opened space.",
        "Falling sand or gravel can bury a player or mob and cause suffocation damage.",
        "Do not stand on sand or gravel while mining below or beside its support column.",
        "Do not mine a collect_stone target when sand, red_sand, gravel, suspicious_sand, suspicious_gravel, or concrete_powder is above the target column.",
        "On beach, desert, riverbed, or gravel shore terrain, search for exposed stone, stony shore, cave mouth, cliff, or rocky hillside before starting a stair mine probe."
      ],
      blockNames: ["sand", "red_sand", "gravel", "suspicious_sand", "suspicious_gravel", "*_concrete_powder"],
      planningHint: "When task=collect_stone and nearby surface blocks are sand or gravel, relocate/search for exposed stone instead of digging downward through the beach layer."
    },
    collect_stone: {
      summary: "Early stone collection should prefer exposed stone and safe side stands; sand and gravel cover means the local terrain can collapse.",
      taskRules: [
        "Use a wooden pickaxe or better for stone; fists do not collect cobblestone.",
        "Prefer exposed surface stone, cave mouths, stony shores, cliffs, or rocky hillsides before making a mine probe.",
        "Mine from a safe side stand, not from directly above the target block.",
        "Never treat sand, red_sand, gravel, or concrete_powder like dirt when digging down; they can fall after support changes.",
        "If only sand or gravel terrain is visible, explore away from the beach/desert/riverbed and try surface-stone search again."
      ],
      planningHint: "For collect_stone, reject beach downward digging and choose surface_stone_search or exploration toward rocky terrain."
    }
  }
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function listMinecraftWikiTopics() {
  return Object.keys(MINECRAFT_WIKI_KNOWLEDGE.topics);
}

function isTreeBearingSurfaceBlock(blockName) {
  return typeof blockName === "string" && (
    TREE_BEARING_SURFACE_PATTERN.test(blockName)
    || blockName === "mangrove_roots"
    || blockName === "mushroom_stem"
  );
}

function isFallingBlockName(blockName = "") {
  const normalized = String(blockName).toLowerCase();
  return FALLING_BLOCK_NAMES.has(normalized) || normalized.endsWith("_concrete_powder");
}

function woodLikelihoodForBiome(biomeName = "") {
  const normalized = String(biomeName).toLowerCase();
  const wood = MINECRAFT_WIKI_KNOWLEDGE.topics.wood;
  if (wood.likelyWoodBiomes.some((name) => normalized.includes(name))) return "high";
  if (wood.lowWoodBiomes.some((name) => normalized.includes(name))) return "low";
  if (normalized.includes("plains") || normalized.includes("savanna") || normalized.includes("meadow")) return "medium";
  return "unknown";
}

function woodLikelihoodForSurfaceBlock(blockName = "") {
  if (isTreeBearingSurfaceBlock(blockName)) return "high";
  const normalized = String(blockName).toLowerCase();
  if (/water|ice|sand|red_sand|terracotta|mushroom|snow/.test(normalized)) return "low";
  if (/grass|podzol|mycelium|dirt|mud|moss/.test(normalized)) return "medium";
  return "unknown";
}

function compactMinecraftWikiKnowledge() {
  return {
    source: MINECRAFT_WIKI_KNOWLEDGE.source,
    version: MINECRAFT_WIKI_KNOWLEDGE.version,
    topics: Object.fromEntries(Object.entries(MINECRAFT_WIKI_KNOWLEDGE.topics).map(([id, topic]) => [
      id,
      {
        summary: topic.summary,
        rules: topic.taskRules ?? topic.rules ?? [],
        planningHint: topic.planningHint ?? null
      }
    ]))
  };
}

function queryMinecraftWikiKnowledge(params = {}) {
  const topicId = params.topic ?? params.taskType ?? "exploration";
  const topic = MINECRAFT_WIKI_KNOWLEDGE.topics[topicId] ?? MINECRAFT_WIKI_KNOWLEDGE.topics.exploration;
  const result = {
    topic: MINECRAFT_WIKI_KNOWLEDGE.topics[topicId] ? topicId : "exploration",
    version: MINECRAFT_WIKI_KNOWLEDGE.version,
    summary: topic.summary,
    rules: topic.taskRules ?? topic.rules ?? [],
    planningHint: topic.planningHint ?? null
  };

  if (params.biome) result.woodLikelihoodForBiome = woodLikelihoodForBiome(params.biome);
  if (params.blockName) result.woodLikelihoodForSurfaceBlock = woodLikelihoodForSurfaceBlock(params.blockName);
  if (topicId === "wood" || params.taskType === "collect_wood") {
    result.likelyWoodBiomes = [...MINECRAFT_WIKI_KNOWLEDGE.topics.wood.likelyWoodBiomes];
    result.lowWoodBiomes = [...MINECRAFT_WIKI_KNOWLEDGE.topics.wood.lowWoodBiomes];
    result.treeBlocks = [...MINECRAFT_WIKI_KNOWLEDGE.topics.wood.treeBlocks];
  }
  if (topicId === "falling_blocks" || topicId === "collect_stone" || params.taskType === "collect_stone") {
    result.fallingBlocks = [...MINECRAFT_WIKI_KNOWLEDGE.topics.falling_blocks.blockNames];
  }

  return clone(result);
}

module.exports = {
  MINECRAFT_WIKI_KNOWLEDGE,
  compactMinecraftWikiKnowledge,
  isFallingBlockName,
  isTreeBearingSurfaceBlock,
  listMinecraftWikiTopics,
  queryMinecraftWikiKnowledge,
  woodLikelihoodForBiome,
  woodLikelihoodForSurfaceBlock
};
