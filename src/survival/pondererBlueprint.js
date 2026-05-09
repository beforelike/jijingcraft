const fs = require("node:fs");
const nbt = require("prismarine-nbt");

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function normalizeBlockName(blockName) {
  if (typeof blockName !== "string" || blockName.length === 0) return "air";
  return blockName.includes(":") ? blockName.split(":").pop() : blockName;
}

function inferPlacementPhase(offsetY, minY, maxY, blockName) {
  if (blockName.includes("door")) return "door";
  if (blockName.includes("torch") || blockName.includes("lantern") || blockName.includes("light")) return "lighting";
  if (blockName === "crafting_table" || blockName === "furnace" || blockName.includes("chest") || blockName.endsWith("_bed")) return "utilities";
  if (offsetY === minY) return "foundation";
  if (offsetY === maxY) return "roof";
  return "walls";
}

function inferPlacementRole(blockName) {
  if (blockName.includes("door")) return "doorway";
  if (blockName.includes("torch") || blockName.includes("lantern") || blockName.includes("light")) return "lighting";
  if (blockName === "crafting_table" || blockName === "furnace" || blockName.includes("chest") || blockName.endsWith("_bed")) return "utility";
  if (blockName.includes("stairs") || blockName.includes("slab")) return "roof_detail";
  return "structure";
}

function deriveRouteFromPlacements(placements) {
  const orderedPhases = ["foundation", "walls", "roof", "door", "utilities", "lighting"];
  const present = new Set(placements.map((placement) => placement.phase));
  return orderedPhases.filter((phase) => present.has(phase));
}

function computeDimensionsFromPlacements(placements) {
  if (!placements.length) return { width: 0, depth: 0, height: 0 };
  const xs = placements.map((placement) => placement.offset.x);
  const ys = placements.map((placement) => placement.offset.y);
  const zs = placements.map((placement) => placement.offset.z);
  return {
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...zs) - Math.min(...zs) + 1,
    height: Math.max(...ys) - Math.min(...ys) + 1
  };
}

function convertSimplifiedStructureToBlueprint(simplifiedStructure, options = {}) {
  const size = Array.isArray(simplifiedStructure?.size) ? simplifiedStructure.size : [0, 0, 0];
  const palette = Array.isArray(simplifiedStructure?.palette) ? simplifiedStructure.palette : [];
  const blocks = Array.isArray(simplifiedStructure?.blocks) ? simplifiedStructure.blocks : [];
  const minY = 0;
  const maxY = Math.max(0, (Number(size[1]) || 0) - 1);

  const placements = blocks
    .map((blockEntry) => {
      const pos = Array.isArray(blockEntry?.pos) ? blockEntry.pos : [0, 0, 0];
      const stateIndex = Number.isInteger(blockEntry?.state) ? blockEntry.state : -1;
      const paletteEntry = palette[stateIndex] ?? null;
      const blockName = normalizeBlockName(paletteEntry?.Name ?? "air");
      if (blockName === "air" || blockName === "structure_void") return null;

      const offset = {
        x: Number(pos[0]) || 0,
        y: Number(pos[1]) || 0,
        z: Number(pos[2]) || 0
      };
      const phase = inferPlacementPhase(offset.y, minY, maxY, blockName);
      return {
        offset,
        phase,
        role: inferPlacementRole(blockName),
        layer: offset.y,
        material: blockName,
        blockName
      };
    })
    .filter(Boolean);

  const byPhase = countBy(placements, (placement) => placement.phase);
  const byRole = countBy(placements, (placement) => placement.role);
  const byBlock = countBy(placements, (placement) => placement.blockName);
  const dimensions = {
    width: Number(size[0]) || computeDimensionsFromPlacements(placements).width,
    height: Number(size[1]) || computeDimensionsFromPlacements(placements).height,
    depth: Number(size[2]) || computeDimensionsFromPlacements(placements).depth
  };

  return {
    id: options.id ?? "ponderer_imported_blueprint",
    name: options.name ?? "Imported Ponderer Blueprint",
    style: options.style ?? "ponderer_imported_structure",
    source: options.source ?? "ponderer_nbt",
    dimensions,
    route: options.route ?? deriveRouteFromPlacements(placements),
    materialSummary: {
      shelterBlocks: placements.length,
      recommendedShelterBlocks: placements.length,
      byPhase,
      byRole,
      byBlock,
      doors: placements.filter((placement) => placement.blockName.includes("door")).length,
      craftingTable: placements.filter((placement) => placement.blockName === "crafting_table").length,
      furnace: placements.filter((placement) => placement.blockName === "furnace").length,
      chest: placements.filter((placement) => placement.blockName.includes("chest")).length,
      torches: placements.filter((placement) => placement.blockName.includes("torch")).length,
      bed: placements.filter((placement) => placement.blockName.endsWith("_bed")).length
    },
    placements
  };
}

function describeSimplifiedStructureForPrompt(simplifiedStructure) {
  const size = Array.isArray(simplifiedStructure?.size) ? simplifiedStructure.size : [0, 0, 0];
  const palette = Array.isArray(simplifiedStructure?.palette) ? simplifiedStructure.palette : [];
  const blocks = Array.isArray(simplifiedStructure?.blocks) ? simplifiedStructure.blocks : [];

  const paletteNames = palette.map((entry) => {
    const name = String(entry?.Name || "minecraft:air");
    const properties = entry?.Properties && typeof entry.Properties === "object" ? entry.Properties : null;
    if (!properties || Object.keys(properties).length === 0) return name;
    const props = Object.entries(properties).map(([key, value]) => `${key}=${value}`).join(",");
    return `${name}[${props}]`;
  });

  const layerBlocks = new Map();
  const blockTypes = [];
  for (const block of blocks) {
    const pos = Array.isArray(block?.pos) ? block.pos : [0, 0, 0];
    const stateIndex = Number.isInteger(block?.state) ? block.state : -1;
    const blockName = stateIndex >= 0 && stateIndex < paletteNames.length ? paletteNames[stateIndex] : "minecraft:unknown";
    if (blockName === "minecraft:air") continue;

    const x = Number(pos[0]) || 0;
    const y = Number(pos[1]) || 0;
    const z = Number(pos[2]) || 0;
    const entries = layerBlocks.get(y) ?? [];
    entries.push(`[${x},${y},${z}] ${blockName}`);
    layerBlocks.set(y, entries);

    const baseName = blockName.includes("[") ? blockName.slice(0, blockName.indexOf("[")) : blockName;
    if (!blockTypes.includes(baseName)) blockTypes.push(baseName);
  }

  const sizeX = Number(size[0]) || 0;
  const sizeY = Number(size[1]) || 0;
  const sizeZ = Number(size[2]) || 0;

  const lines = [];
  lines.push(`Structure size: ${sizeX}x${sizeY}x${sizeZ}`);
  lines.push(`Block types: ${blockTypes.join(", ")}`);
  for (let y = 0; y < sizeY; y++) {
    const layer = layerBlocks.get(y);
    if (!layer || layer.length === 0) {
      lines.push(`--- Y=${y} (empty) ---`);
      continue;
    }
    lines.push(`--- Y=${y} ---`);
    for (const entry of layer) lines.push(`  ${entry}`);
  }

  return {
    sizeX,
    sizeY,
    sizeZ,
    textDescription: lines.join("\n"),
    blockTypes
  };
}

async function describePondererNbtFileForPrompt(nbtFilePath) {
  const nbtBuffer = await fs.promises.readFile(nbtFilePath);
  const parsed = await nbt.parse(nbtBuffer);
  const simplified = nbt.simplify(parsed.parsed ?? parsed);
  return describeSimplifiedStructureForPrompt(simplified);
}

function summarizeBlueprintForPrompt(blueprint) {
  if (!blueprint || typeof blueprint !== "object") return null;
  const dimensions = blueprint.dimensions ?? null;
  const route = Array.isArray(blueprint.route) ? blueprint.route : [];
  const materialSummary = blueprint.materialSummary ?? {};
  return {
    id: blueprint.id ?? null,
    style: blueprint.style ?? null,
    dimensions,
    route,
    blocks: materialSummary.shelterBlocks ?? null,
    byPhase: materialSummary.byPhase ?? null,
    byRole: materialSummary.byRole ?? null
  };
}

async function convertPondererNbtFileToBlueprint(nbtFilePath, options = {}) {
  const nbtBuffer = await fs.promises.readFile(nbtFilePath);
  const parsed = await nbt.parse(nbtBuffer);
  const simplified = nbt.simplify(parsed.parsed ?? parsed);
  return convertSimplifiedStructureToBlueprint(simplified, options);
}

module.exports = {
  convertPondererNbtFileToBlueprint,
  convertSimplifiedStructureToBlueprint,
  describePondererNbtFileForPrompt,
  describeSimplifiedStructureForPrompt,
  deriveRouteFromPlacements,
  normalizeBlockName,
  summarizeBlueprintForPrompt
};