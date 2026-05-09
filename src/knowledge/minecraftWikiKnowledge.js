const TREE_BEARING_SURFACE_PATTERN = /(_log|_wood|_leaves|_stem|_hyphae)$/;

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

  return clone(result);
}

module.exports = {
  MINECRAFT_WIKI_KNOWLEDGE,
  compactMinecraftWikiKnowledge,
  isTreeBearingSurfaceBlock,
  listMinecraftWikiTopics,
  queryMinecraftWikiKnowledge,
  woodLikelihoodForBiome,
  woodLikelihoodForSurfaceBlock
};
