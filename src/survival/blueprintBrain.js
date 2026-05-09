const { createOpenAIClient } = require("../llm/client");
const {
  describePondererNbtFileForPrompt,
  summarizeBlueprintForPrompt
} = require("./pondererBlueprint");

const ALLOWED_ROOF_TYPES = new Set(["gable", "hip", "flat"]);
const ALLOWED_WALL_PATTERNS = new Set(["solid", "timber_frame"]);
const ALLOWED_RIDGE_DIRECTIONS = new Set(["x", "z"]);
const MATERIAL_ALIASES = Object.freeze({
  oak: "oak_planks",
  plank: "oak_planks",
  planks: "oak_planks",
  log: "oak_log",
  logs: "oak_log",
  cobblestone: "cobblestone",
  stone: "stone",
  brick: "bricks",
  bricks: "bricks",
  spruce: "spruce_planks",
  birch: "birch_planks",
  dark_oak: "dark_oak_planks",
  acacia: "acacia_planks",
  jungle: "jungle_planks",
  bamboo: "bamboo_planks"
});
const ALLOWED_MATERIALS = Object.freeze([
  "oak_planks",
  "oak_log",
  "spruce_planks",
  "birch_planks",
  "dark_oak_planks",
  "acacia_planks",
  "jungle_planks",
  "bamboo_planks",
  "cobblestone",
  "stone",
  "bricks"
]);

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function normalizeDesignSpec(raw = {}, fallback = {}) {
  const roofType = typeof raw.roofType === "string" && ALLOWED_ROOF_TYPES.has(raw.roofType) ? raw.roofType : null;
  const wallPattern = typeof raw.wallPattern === "string" && ALLOWED_WALL_PATTERNS.has(raw.wallPattern) ? raw.wallPattern : null;
  const ridgeDirection = typeof raw.ridgeDirection === "string" && ALLOWED_RIDGE_DIRECTIONS.has(raw.ridgeDirection) ? raw.ridgeDirection : null;
  const style = typeof raw.style === "string" && raw.style.trim().length ? raw.style.trim() : null;

  return {
    style: style ?? fallback.style ?? "compact_gabled_survival_house",
    wallPattern: wallPattern ?? fallback.wallPattern ?? "solid",
    roofType: roofType ?? fallback.roofType ?? "gable",
    roofPitch: clampInteger(raw.roofPitch, 1, 2, fallback.roofPitch ?? 1),
    windowCount: clampInteger(raw.windowCount, 0, 8, fallback.windowCount ?? 2),
    ridgeDirection: ridgeDirection ?? fallback.ridgeDirection ?? "z"
  };
}

function normalizeMaterialId(value) {
  if (typeof value !== "string") return null;
  const compact = value.trim().toLowerCase().replaceAll("minecraft:", "").replaceAll("-", "_").replaceAll(" ", "_");
  if (!compact) return null;
  if (MATERIAL_ALIASES[compact]) return MATERIAL_ALIASES[compact];
  if (ALLOWED_MATERIALS.includes(compact)) return compact;
  return null;
}

function parseRequiredElements(outline = "") {
  const lines = String(outline).split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const cleaned = lines[lineIndex].trim().replace(/[\*`#>]/g, "").trim();
    const upper = cleaned.toUpperCase().replace(/^[-\s]+/, "");
    if (!upper.startsWith("REQUIRED_ELEMENTS") && !upper.startsWith("REQUIRED ELEMENTS")) continue;

    let splitIndex = cleaned.indexOf(":");
    if (splitIndex < 0) splitIndex = cleaned.indexOf("=");
    if (splitIndex < 0) {
      splitIndex = upper.startsWith("REQUIRED_ELEMENTS") ? "REQUIRED_ELEMENTS".length : "REQUIRED ELEMENTS".length;
      while (splitIndex < cleaned.length && ":= \t".includes(cleaned[splitIndex])) splitIndex++;
      splitIndex--;
    }

    let rest = cleaned.slice(splitIndex + 1).trim();
    if (!rest) {
      const joined = [];
      for (let next = lineIndex + 1; next < lines.length; next++) {
        const candidate = lines[next].trim();
        if (!candidate) break;
        joined.push(candidate);
      }
      rest = joined.join(", ").trim();
    }
    if (!rest) return [];
    return rest.split(/[,;、]/).map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

function extractJsonFromResponse(response = "") {
  let trimmed = String(response).trim();
  const fenceMatch = /```(?:json|JSON)?\s*\n/m.exec(trimmed);
  if (fenceMatch) {
    const contentStart = fenceMatch.index + fenceMatch[0].length;
    const fenceEnd = trimmed.indexOf("```", contentStart);
    if (fenceEnd > contentStart) trimmed = trimmed.slice(contentStart, fenceEnd).trim();
  }

  const braceStart = trimmed.indexOf("{");
  if (braceStart < 0) return trimmed;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = braceStart; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) return trimmed.slice(braceStart, index + 1);
      }
    }
  }

  const braceEnd = trimmed.lastIndexOf("}");
  if (braceEnd > braceStart) return trimmed.slice(braceStart, braceEnd + 1);
  return trimmed;
}

function cleanJsonText(jsonText = "") {
  const output = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < jsonText.length; index++) {
    const char = jsonText[index];
    if (escaped) {
      escaped = false;
      output.push(char);
      continue;
    }
    if (char === "\\" && inString) {
      escaped = true;
      output.push(char);
      continue;
    }
    if (char === '"') {
      inString = !inString;
      output.push(char);
      continue;
    }
    if (!inString && char === ",") {
      let lookahead = index + 1;
      while (lookahead < jsonText.length && /\s/.test(jsonText[lookahead])) lookahead++;
      if (lookahead < jsonText.length && ["}", "]"].includes(jsonText[lookahead])) continue;
    }
    output.push(char);
  }
  return output.join("");
}

function parseJsonObject(responseText = "") {
  const extracted = extractJsonFromResponse(responseText);
  const cleaned = cleanJsonText(extracted);
  return JSON.parse(cleaned);
}

function buildRequiredMaterialMapping(requiredElements = []) {
  const mapped = [];
  for (const rawElement of requiredElements) {
    const normalized = normalizeMaterialId(rawElement);
    if (normalized && !mapped.includes(normalized)) mapped.push(normalized);
    if (mapped.length >= 6) break;
  }
  return mapped;
}

function stringHash(input = "") {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function heuristicDesignSpec(context = {}) {
  const biome = String(context?.snapshot?.terrain?.biome || "").toLowerCase();
  const coordSeed = `${context?.base?.x || 0},${context?.base?.z || 0},${biome}`;
  const seed = stringHash(coordSeed);
  const roofType = biome.includes("desert") ? "flat" : (seed % 3 === 0 ? "hip" : "gable");
  const wallPattern = biome.includes("forest") || biome.includes("taiga") ? "timber_frame" : "solid";
  const ridgeDirection = seed % 2 === 0 ? "z" : "x";
  const windowCount = 2 + (seed % 3);

  return normalizeDesignSpec({
    style: roofType === "flat" ? "compact_sandstone_survival_house" : "ponderer_balanced_starter_house",
    roofType,
    wallPattern,
    ridgeDirection,
    windowCount,
    roofPitch: roofType === "gable" ? 2 : 1
  });
}

function promptContext(context = {}) {
  const terrain = context?.snapshot?.terrain ?? {};
  const weather = {
    isNight: Boolean(context?.snapshot?.isNight),
    isBodyInWater: Boolean(context?.snapshot?.isBodyInWater),
    hasHostileNearby: Array.isArray(context?.snapshot?.entities)
      ? context.snapshot.entities.some((entity) => typeof entity?.name === "string" && ["zombie", "skeleton", "creeper", "spider"].includes(entity.name))
      : false
  };
  return {
    base: context.base ?? null,
    biome: terrain.biome ?? null,
    gradient: terrain.gradient ?? null,
    isNearWater: terrain.isNearWater ?? null,
    isNearForest: terrain.isNearForest ?? null,
    weather,
    hasStarterShelter: Boolean(context?.progress?.hasStarterShelter)
  };
}

class BlueprintBrain {
  constructor(config = {}, logger = console, dependencies = {}) {
    this.logger = logger;
    this.config = config;
    this.llmConfig = config?.llm ?? {};
    this.client = this.llmConfig.enabled ? createOpenAIClient(this.llmConfig, dependencies) : null;
    this.structureContextNbtPath = process.env.PONDERER_STARTER_STRUCTURE_NBT?.trim() || "";
  }

  async loadStructureContextSummary() {
    if (!this.structureContextNbtPath) return null;
    try {
      return await describePondererNbtFileForPrompt(this.structureContextNbtPath);
    } catch (error) {
      this.logger?.warn?.(`action=starter_shelter_design; structure_context_failed=${error.message}`);
      return null;
    }
  }

  async requestOutline(scene, fallback, structureSummary, context = {}) {
    const systemPrompt = [
      "You are a Minecraft starter house designer.",
      "Create a concise design outline for a practical and beautiful 7x7 survival house.",
      "Your response MUST include one line in this exact form:",
      "REQUIRED_ELEMENTS: element1, element2, ...",
      "Do not return JSON in this pass."
    ].join(" ");

    const userPayload = {
      task: "Design outline for starter shelter",
      context: scene,
      fallbackDesign: fallback,
      structureSummary,
      existingBlueprintSummary: summarizeBlueprintForPrompt(context?.existingBlueprint ?? null)
    };

    const response = await this.client.chatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) }
      ],
      temperature: 0.6
    });
    if (!response?.ok || !response?.content) return null;
    return {
      outline: response.content,
      usage: response.usage ?? null,
      model: response.model ?? this.llmConfig.model
    };
  }

  async requestDesignJson(scene, fallback, outline, mappedMaterials, structureSummary) {
    const systemPrompt = [
      "You are an expert Minecraft architect for survival starter houses.",
      "Return STRICT JSON only.",
      "Return keys: designSpec and materials.",
      "designSpec keys: style, roofType, roofPitch, wallPattern, ridgeDirection, windowCount.",
      "materials must be an array using only known block ids when possible.",
      "Rules: roofType in [gable, hip, flat], wallPattern in [solid, timber_frame], ridgeDirection in [x, z], roofPitch 1-2, windowCount 0-8."
    ].join(" ");

    const userPayload = {
      task: "Generate final starter shelter design JSON",
      context: scene,
      outline,
      materialMappingHint: mappedMaterials,
      structureSummary,
      fallback
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await this.client.chatCompletion({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(userPayload) },
          ...(attempt === 2
            ? [{ role: "user", content: "Previous output was invalid JSON. Return complete valid JSON object only." }]
            : [])
        ],
        temperature: 0.65,
        responseFormat: { type: "json_object" }
      });

      if (!response?.ok || !response?.content) continue;
      try {
        const parsed = parseJsonObject(response.content);
        return {
          parsed,
          usage: response.usage ?? null,
          model: response.model ?? this.llmConfig.model
        };
      } catch {
        continue;
      }
    }

    return null;
  }

  async designStarterShelter(context = {}) {
    const fallback = heuristicDesignSpec(context);
    if (!this.client) {
      return {
        source: "heuristic",
        designSpec: fallback,
        reason: this.llmConfig.disabledReason ?? "llm_unavailable"
      };
    }

    const scene = promptContext(context);
    const structureSummary = await this.loadStructureContextSummary();

    try {
      const outlineResult = await this.requestOutline(scene, fallback, structureSummary, context);
      if (!outlineResult?.outline) {
        return {
          source: "heuristic",
          designSpec: fallback,
          reason: "llm_outline_unavailable"
        };
      }

      const requiredElements = parseRequiredElements(outlineResult.outline);
      const mappedMaterials = buildRequiredMaterialMapping(requiredElements);
      const jsonResult = await this.requestDesignJson(scene, fallback, outlineResult.outline, mappedMaterials, structureSummary);
      if (!jsonResult?.parsed) {
        return {
          source: "heuristic",
          designSpec: fallback,
          reason: "llm_json_unavailable"
        };
      }

      const candidate = jsonResult.parsed?.designSpec ?? jsonResult.parsed ?? {};
      const normalized = normalizeDesignSpec(candidate, fallback);
      const rawMaterials = Array.isArray(jsonResult.parsed?.materials) ? jsonResult.parsed.materials : mappedMaterials;
      const recommendedMaterials = rawMaterials.map(normalizeMaterialId).filter(Boolean).filter((name, index, list) => list.indexOf(name) === index);
      return {
        source: "llm",
        designSpec: normalized,
        recommendedMaterials,
        outline: outlineResult.outline,
        requiredElements,
        usage: jsonResult.usage ?? outlineResult.usage,
        model: jsonResult.model ?? outlineResult.model
      };
    } catch (error) {
      this.logger?.warn?.(`action=starter_shelter_design; llm_failed=${error.message}`);
      return {
        source: "heuristic",
        designSpec: fallback,
        reason: error.message
      };
    }
  }
}

module.exports = {
  BlueprintBrain,
  heuristicDesignSpec,
  normalizeDesignSpec,
  parseRequiredElements,
  extractJsonFromResponse,
  cleanJsonText
};
