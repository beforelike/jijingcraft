const RESOURCE_ORE_BASES = new Set(["coal", "diamond", "emerald", "iron", "gold", "lapis_lazuli", "redstone"]);

const EMPTY_PLACEMENT_BLOCKS = Object.freeze([
  "air",
  "water",
  "lava",
  "grass",
  "short_grass",
  "tall_grass",
  "snow",
  "dead_bush",
  "fern"
]);

const PLACEMENT_NO_REPOSITION_ITEMS = Object.freeze([
  "torch",
  "redstone_torch",
  "redstone",
  "lever",
  "button",
  "rail",
  "detector_rail",
  "powered_rail",
  "activator_rail",
  "tripwire_hook",
  "tripwire",
  "water_bucket",
  "string"
]);

const FACE_BY_PLACE_ON = Object.freeze({
  bottom: { x: 0, y: 1, z: 0 },
  top: { x: 0, y: -1, z: 0 },
  north: { x: 0, y: 0, z: 1 },
  south: { x: 0, y: 0, z: -1 },
  east: { x: -1, y: 0, z: 0 },
  west: { x: 1, y: 0, z: 0 }
});

const SIDE_PLACE_ON = Object.freeze(["north", "south", "east", "west"]);
const DEFAULT_PLACE_ON_ORDER = Object.freeze(["bottom", "top", "east", "west", "south", "north"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function vectorKey(vector) {
  return `${vector.x},${vector.y},${vector.z}`;
}

function collectBlockSearchNames(blockType) {
  if (typeof blockType !== "string" || !blockType.trim()) return [];
  const primary = blockType.trim();
  const names = [primary];
  if (RESOURCE_ORE_BASES.has(primary)) names.push(`${primary}_ore`);
  if (primary.endsWith("ore")) names.push(`deepslate_${primary}`);
  if (primary === "dirt") names.push("grass_block");
  if (primary === "cobblestone") names.push("stone");
  return [...new Set(names)];
}

function isReplaceablePlacementBlock(blockName) {
  return EMPTY_PLACEMENT_BLOCKS.includes(blockName);
}

function placementFaceOrder(placeOn = "bottom") {
  const preferred = placeOn === "side"
    ? SIDE_PLACE_ON
    : (FACE_BY_PLACE_ON[placeOn] ? [placeOn] : ["bottom"]);
  const orderedLabels = [...preferred, ...DEFAULT_PLACE_ON_ORDER];
  const seen = new Set();
  return orderedLabels
    .map((label) => ({ label, face: FACE_BY_PLACE_ON[label] }))
    .filter((entry) => {
      if (!entry.face) return false;
      const key = vectorKey(entry.face);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((entry) => ({
      label: entry.label,
      face: clone(entry.face),
      referenceOffset: { x: -entry.face.x, y: -entry.face.y, z: -entry.face.z }
    }));
}

function shouldRepositionBeforePlacement({ itemName, feetDistance, headDistance } = {}) {
  if (PLACEMENT_NO_REPOSITION_ITEMS.includes(itemName)) return false;
  const feet = Number(feetDistance);
  const head = Number(headDistance);
  return (Number.isFinite(feet) && feet < 1.1) || (Number.isFinite(head) && head < 1.1);
}

function movementProfileFromPathProbe({ nonDestructiveStatus, destructiveStatus } = {}) {
  if (nonDestructiveStatus === "success") {
    return {
      profile: "non_destructive",
      pathFound: true,
      canBreak: false,
      reason: "non_destructive_path_found"
    };
  }
  if (destructiveStatus === "success") {
    return {
      profile: "destructive",
      pathFound: true,
      canBreak: true,
      reason: "destructive_path_found"
    };
  }
  return {
    profile: "destructive_fallback_attempt",
    pathFound: false,
    canBreak: true,
    reason: "path_probe_failed_try_pathfinder_anyway"
  };
}

function compactMineflayerActionPatterns() {
  return {
    source: "mindcraft_ce_skills_static_translation",
    goToGoal: {
      plannerHint: "Probe a non-destructive path first, allow destructive fallback only when a safe rule window permits movement work.",
      helper: "movementProfileFromPathProbe",
      outputs: ["non_destructive", "destructive", "destructive_fallback_attempt"]
    },
    collectBlock: {
      plannerHint: "Expand friendly resource names before searching and require safe break/reachable stand checks in controller code.",
      helper: "collectBlockSearchNames",
      examples: {
        cobblestone: collectBlockSearchNames("cobblestone"),
        iron: collectBlockSearchNames("iron"),
        dirt: collectBlockSearchNames("dirt")
      }
    },
    placeBlock: {
      plannerHint: "Prefer the requested placement side, fall back through adjacent faces, clear replaceable blockers only, and step away when placing into the bot body.",
      helpers: ["placementFaceOrder", "isReplaceablePlacementBlock", "shouldRepositionBeforePlacement"],
      emptyBlocks: [...EMPTY_PLACEMENT_BLOCKS],
      noRepositionItems: [...PLACEMENT_NO_REPOSITION_ITEMS]
    }
  };
}

module.exports = {
  EMPTY_PLACEMENT_BLOCKS,
  PLACEMENT_NO_REPOSITION_ITEMS,
  collectBlockSearchNames,
  compactMineflayerActionPatterns,
  isReplaceablePlacementBlock,
  movementProfileFromPathProbe,
  placementFaceOrder,
  shouldRepositionBeforePlacement
};