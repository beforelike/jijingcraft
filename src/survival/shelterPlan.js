const fs = require("node:fs");
const path = require("node:path");
const { Vec3 } = require("vec3");

const STARTER_SHELTER_ROUTE = Object.freeze(["foundation", "walls", "roof", "door", "utilities", "lighting"]);
const STARTER_SHELTER_BUFFER_BLOCKS = 12;
const STARTER_SHELTER_BLUEPRINT_PATH_ENV = "PONDERER_STARTER_BLUEPRINT_JSON";
const DEFAULT_STARTER_SHELTER_BLUEPRINT_PATH = path.resolve(process.cwd(), "data", "blueprints", "starter_shelter_blueprint.json");

let cachedStarterShelterTemplate = null;
let cachedStarterShelterTemplatePath = null;

function createEmergencyShelterPlan(base) {
  const positions = [];
  const cardinalOffsets = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1)
  ];
  const diagonalOffsets = [
    new Vec3(1, 0, 1),
    new Vec3(1, 0, -1),
    new Vec3(-1, 0, 1),
    new Vec3(-1, 0, -1)
  ];

  for (const offset of cardinalOffsets) positions.push(base.plus(offset));
  for (const offset of cardinalOffsets) positions.push(base.plus(offset).offset(0, 1, 0));
  for (const offset of cardinalOffsets) positions.push(base.plus(offset).offset(0, 2, 0));
  positions.push(base.offset(0, 2, 0));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset).offset(0, 1, 0));
  for (const offset of diagonalOffsets) positions.push(base.plus(offset).offset(0, 2, 0));

  return positions;
}

function createEmergencyShelterDoorwayPlan(base) {
  return [base.offset(0, 0, -1), base.offset(0, 1, -1)];
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeStarterShelterDesignSpec(spec = {}) {
  const normalized = {
    style: typeof spec.style === "string" ? spec.style : "compact_gabled_survival_house",
    wallPattern: typeof spec.wallPattern === "string" ? spec.wallPattern : "solid",
    roofType: typeof spec.roofType === "string" ? spec.roofType : "gable",
    roofPitch: clampInteger(spec.roofPitch, 1, 2, 1),
    windowCount: clampInteger(spec.windowCount, 0, 8, 2),
    ridgeDirection: spec.ridgeDirection === "x" ? "x" : "z"
  };
  return normalized;
}

function createStarterShelterPlan(base, options = {}) {
  return createStarterShelterBlueprint(base, options).placements.map((placement) => placement.position);
}

function uniquePlacements(placements) {
  const seen = new Set();
  return placements.filter((placement) => {
    const position = placement.position;
    const key = `${position.x},${position.y},${position.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pushPlacement(placements, base, offset, phase, role) {
  placements.push({
    position: base.plus(offset),
    offset: { x: offset.x, y: offset.y, z: offset.z },
    phase,
    role,
    layer: offset.y,
    material: "shelter_block"
  });
}

function countBy(items, key) {
  return items.reduce((counts, item) => {
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function resolveStarterShelterTemplatePath() {
  const configuredPath = process.env[STARTER_SHELTER_BLUEPRINT_PATH_ENV]?.trim();
  return configuredPath || DEFAULT_STARTER_SHELTER_BLUEPRINT_PATH;
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

function loadStarterShelterTemplate() {
  const templatePath = resolveStarterShelterTemplatePath();
  if (templatePath === cachedStarterShelterTemplatePath) return cachedStarterShelterTemplate;

  cachedStarterShelterTemplatePath = templatePath;
  cachedStarterShelterTemplate = null;
  if (!fs.existsSync(templatePath)) return null;

  try {
    const parsed = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    if (!parsed || !Array.isArray(parsed.placements) || parsed.placements.length === 0) return null;
    cachedStarterShelterTemplate = parsed;
  } catch {
    cachedStarterShelterTemplate = null;
  }
  return cachedStarterShelterTemplate;
}

function normalizeImportedPlacement(placement, fallbackIndex = 0) {
  const offset = placement?.offset ?? placement?.position ?? {};
  const numericOffset = {
    x: Number(offset?.x ?? 0),
    y: Number(offset?.y ?? 0),
    z: Number(offset?.z ?? 0)
  };
  return {
    offset: numericOffset,
    phase: typeof placement?.phase === "string" ? placement.phase : (numericOffset.y === 0 ? "foundation" : "walls"),
    role: typeof placement?.role === "string" ? placement.role : `imported_${fallbackIndex}`,
    layer: Number.isFinite(placement?.layer) ? placement.layer : numericOffset.y,
    material: typeof placement?.material === "string" ? placement.material : "shelter_block"
  };
}

function buildBlueprintFromPlacements(base, blueprintMeta, placements) {
  const positioned = uniquePlacements(placements.map((placement) => ({
    ...placement,
    position: base.plus(new Vec3(placement.offset.x, placement.offset.y, placement.offset.z))
  })));

  const dimensions = blueprintMeta.dimensions ?? computeDimensionsFromPlacements(placements);
  const blueprint = {
    id: blueprintMeta.id,
    name: blueprintMeta.name,
    style: blueprintMeta.style,
    source: blueprintMeta.source,
    dimensions,
    route: blueprintMeta.route,
    materialSummary: {
      shelterBlocks: positioned.length,
      recommendedShelterBlocks: positioned.length + STARTER_SHELTER_BUFFER_BLOCKS,
      byPhase: countBy(positioned, "phase"),
      byRole: countBy(positioned, "role"),
      doors: blueprintMeta.doors ?? 2,
      craftingTable: blueprintMeta.craftingTable ?? 1,
      furnace: blueprintMeta.furnace ?? 1,
      chest: blueprintMeta.chest ?? 1,
      torches: blueprintMeta.torches ?? 2,
      bed: blueprintMeta.bed ?? 1
    },
    placements: positioned
  };
  blueprint.materialChecklist = createStarterShelterMaterialChecklist(blueprint);
  blueprint.buildSteps = createStarterShelterBuildSteps(blueprint);
  return blueprint;
}

function createStarterShelterBlueprintFromTemplate(base, template) {
  const normalizedPlacements = template.placements.map((placement, index) => normalizeImportedPlacement(placement, index));
  return buildBlueprintFromPlacements(base, {
    id: template.id ?? "ponderer_imported_starter_house",
    name: template.name ?? "Imported Ponderer Starter House",
    style: template.style ?? "ponderer_imported_structure",
    source: template.source ?? "ponderer_imported_template",
    dimensions: template.dimensions,
    route: Array.isArray(template.route) && template.route.length ? template.route : [...STARTER_SHELTER_ROUTE],
    doors: template.materialSummary?.doors,
    craftingTable: template.materialSummary?.craftingTable,
    furnace: template.materialSummary?.furnace,
    chest: template.materialSummary?.chest,
    torches: template.materialSummary?.torches,
    bed: template.materialSummary?.bed
  }, normalizedPlacements);
}

function starterShelterWindowOffsets(windowCount = 2) {
  const candidates = [
    new Vec3(-3, 2, 0),
    new Vec3(3, 2, 0),
    new Vec3(0, 2, 3),
    new Vec3(1, 2, 3),
    new Vec3(-1, 2, 3),
    new Vec3(-3, 2, 1),
    new Vec3(3, 2, -1),
    new Vec3(2, 2, 3)
  ];
  const requested = Math.max(0, Math.min(windowCount, candidates.length));
  const selected = new Set();
  for (let i = 0; i < requested; i++) {
    const offset = candidates[i];
    selected.add(`${offset.x},${offset.y},${offset.z}`);
  }
  return selected;
}

function applyStarterShelterWallPattern(role, wallPattern, x, z) {
  if (wallPattern !== "timber_frame") return role;
  const frameLine = x === -3 || x === 3 || z === -3 || z === 3;
  const crossBeam = x === 0 || z === 0;
  if (frameLine && crossBeam) return "timber_frame";
  return role;
}

function createStarterShelterBlueprintFromDesign(base, rawSpec = {}) {
  const spec = normalizeStarterShelterDesignSpec(rawSpec);
  const placements = [];
  const radius = 3;
  const wallHeight = 4;
  const baseRoofY = wallHeight;
  const windowOffsets = starterShelterWindowOffsets(spec.windowCount);

  for (let y = 0; y < wallHeight; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const isWall = Math.abs(x) === radius || Math.abs(z) === radius;
        const isDoorway = (x === 0 || x === 1) && z === -radius && y <= 1;
        const isWindow = y === 2 && windowOffsets.has(`${x},${y},${z}`);
        if (isWall && !isDoorway && !isWindow) {
          const defaultRole = Math.abs(x) === radius && Math.abs(z) === radius ? "corner_post" : "wall";
          const role = applyStarterShelterWallPattern(defaultRole, spec.wallPattern, x, z);
          pushPlacement(placements, base, new Vec3(x, y, z), y === 0 ? "foundation" : "walls", role);
        }
      }
    }
  }

  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      pushPlacement(placements, base, new Vec3(x, baseRoofY, z), "roof", spec.roofType === "flat" ? "roof_flat" : "roof_plate");
    }
  }

  if (spec.roofType === "gable") {
    if (spec.ridgeDirection === "x") {
      for (let x = -radius; x <= radius; x++) {
        const y = baseRoofY + spec.roofPitch;
        pushPlacement(placements, base, new Vec3(x, y, 0), "roof", "roof_ridge");
      }
    } else {
      for (let z = -radius; z <= radius; z++) {
        const y = baseRoofY + spec.roofPitch;
        pushPlacement(placements, base, new Vec3(0, y, z), "roof", "roof_ridge");
      }
    }
  }

  if (spec.roofType === "hip") {
    for (let x = -radius + 1; x <= radius - 1; x++) {
      pushPlacement(placements, base, new Vec3(x, baseRoofY + 1, 0), "roof", "roof_hip_ridge");
    }
    for (let z = -radius + 1; z <= radius - 1; z++) {
      pushPlacement(placements, base, new Vec3(0, baseRoofY + 1, z), "roof", "roof_hip_ridge");
    }
  }

  return buildBlueprintFromPlacements(base, {
    id: `ponderer_starter_house_${spec.roofType}_v1`,
    name: "Ponderer Designed Starter House",
    style: spec.style,
    source: "autodesigned_ponderer_style",
    dimensions: { width: 7, depth: 7, height: 6 + (spec.roofType === "flat" ? 0 : spec.roofPitch) },
    route: [...STARTER_SHELTER_ROUTE],
    doors: 2,
    craftingTable: 1,
    furnace: 1,
    chest: 1,
    torches: 2,
    bed: 1
  }, placements);
}

function groupPlacementsByLayer(placements) {
  return Object.values(placements.reduce((layers, placement) => {
    const layer = placement.layer ?? placement.position.y;
    if (!layers[layer]) layers[layer] = {
      layer,
      count: 0,
      phases: {},
      roles: {}
    };
    layers[layer].count++;
    layers[layer].phases[placement.phase] = (layers[layer].phases[placement.phase] ?? 0) + 1;
    layers[layer].roles[placement.role] = (layers[layer].roles[placement.role] ?? 0) + 1;
    return layers;
  }, {})).sort((left, right) => left.layer - right.layer);
}

function createStarterShelterBuildSteps(blueprint) {
  const layerSteps = groupPlacementsByLayer(blueprint.placements).map((layer) => ({
    id: `layer_y${layer.layer}`,
    phase: layer.layer === 0 ? "foundation" : (layer.layer >= 4 ? "roof" : "walls"),
    action: "place_layer",
    layer: layer.layer,
    blockCount: layer.count,
    roles: layer.roles
  }));

  return [
    {
      id: "site_clearance",
      phase: "foundation",
      action: "select_surface_site",
      description: "Find a flat open-sky 7x7 footprint before placing the blueprint."
    },
    ...layerSteps,
    {
      id: "double_door",
      phase: "door",
      action: "install_double_door",
      blockCount: 4,
      itemCount: 2
    },
    {
      id: "core_utilities",
      phase: "utilities",
      action: "place_utilities",
      items: ["crafting_table", "furnace", "chest", "bed_optional"]
    },
    {
      id: "lighting",
      phase: "lighting",
      action: "place_torches",
      itemCount: blueprint.materialSummary.torches
    }
  ];
}

function createStarterShelterMaterialChecklist(blueprint) {
  const shelterBlocks = blueprint.materialSummary.shelterBlocks;
  return {
    shelterBlocks,
    recommendedShelterBlocks: shelterBlocks + STARTER_SHELTER_BUFFER_BLOCKS,
    doors: blueprint.materialSummary.doors,
    craftingTable: blueprint.materialSummary.craftingTable,
    furnace: blueprint.materialSummary.furnace,
    chest: blueprint.materialSummary.chest,
    torches: blueprint.materialSummary.torches,
    optionalBed: blueprint.materialSummary.bed,
    notes: [
      "Any safe building block can fill shelterBlocks; planks, logs, cobblestone, stone, dirt, and grass blocks are accepted by the controller.",
      "Keep extra blocks so pathing mistakes, doorway sealing, and repairs do not stall the build.",
      "Furnace and chest are utility requirements; torch and bed improve usability when materials exist."
    ]
  };
}

function createStarterShelterBlueprint(base, options = {}) {
  const designSpec = options?.designSpec;
  if (designSpec) return createStarterShelterBlueprintFromDesign(base, designSpec);

  const externalTemplate = loadStarterShelterTemplate();
  if (externalTemplate) return createStarterShelterBlueprintFromTemplate(base, externalTemplate);

  const placements = [];
  const radius = 3;
  const wallHeight = 4;
  const roofY = 4;

  for (let y = 0; y < wallHeight; y++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const isWall = Math.abs(x) === radius || Math.abs(z) === radius;
        const isDoorway = (x === 0 || x === 1) && z === -radius && y <= 1;
        if (isWall && !isDoorway) {
          const role = Math.abs(x) === radius && Math.abs(z) === radius ? "corner_post" : "wall";
          pushPlacement(placements, base, new Vec3(x, y, z), y === 0 ? "foundation" : "walls", role);
        }
      }
    }
  }

  for (let x = -radius; x <= radius; x++) {
    for (let z = -radius; z <= radius; z++) {
      pushPlacement(placements, base, new Vec3(x, roofY, z), "roof", "roof_plate");
    }
  }

  for (let x = -radius; x <= radius; x++) {
    pushPlacement(placements, base, new Vec3(x, roofY + 1, 0), "roof", "roof_ridge");
  }

  return buildBlueprintFromPlacements(base, {
    id: "ponderer_starter_house_v1",
    name: "Ponderer Starter House",
    style: "compact_gabled_survival_house",
    source: "ported_from_ponderer_structure_planning",
    dimensions: { width: 7, depth: 7, height: 6 },
    route: [...STARTER_SHELTER_ROUTE],
    doors: 2,
    craftingTable: 1,
    furnace: 1,
    chest: 1,
    torches: 2,
    bed: 1
  }, placements);
}

function createStarterShelterBuildPlan(base, options = {}) {
  const blueprint = createStarterShelterBlueprint(base, options);
  return {
    id: `${blueprint.id}:build_plan`,
    blueprintId: blueprint.id,
    name: blueprint.name,
    style: blueprint.style,
    dimensions: blueprint.dimensions,
    route: blueprint.route,
    materialChecklist: blueprint.materialChecklist,
    buildSteps: blueprint.buildSteps,
    placements: blueprint.placements
  };
}

function starterShelterMaterialTarget() {
  const blueprint = createStarterShelterBlueprint(new Vec3(0, 0, 0));
  return blueprint.materialSummary.recommendedShelterBlocks;
}

function starterShelterPlanBounds(base, options = {}) {
  const positions = [
    ...createStarterShelterPlan(base, options),
    ...createStarterShelterDoorwayPlan(base)
  ];
  return positions.reduce((bounds, position) => ({
    minX: Math.min(bounds.minX, position.x - base.x),
    maxX: Math.max(bounds.maxX, position.x - base.x),
    minY: Math.min(bounds.minY, position.y - base.y),
    maxY: Math.max(bounds.maxY, position.y - base.y),
    minZ: Math.min(bounds.minZ, position.z - base.z),
    maxZ: Math.max(bounds.maxZ, position.z - base.z)
  }), { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 });
}

function createStarterShelterDoorwayPlan(base) {
  return [
    base.offset(0, 0, -3),
    base.offset(0, 1, -3),
    base.offset(1, 0, -3),
    base.offset(1, 1, -3)
  ];
}

function createStarterShelterDoorwaySealPlan(base) {
  return createStarterShelterDoorwayPlan(base);
}

module.exports = {
  createStarterShelterBlueprint,
  createStarterShelterBuildPlan,
  createEmergencyShelterDoorwayPlan,
  createEmergencyShelterPlan,
  createStarterShelterDoorwayPlan,
  createStarterShelterDoorwaySealPlan,
  createStarterShelterPlan,
  starterShelterMaterialTarget,
  starterShelterPlanBounds
};
