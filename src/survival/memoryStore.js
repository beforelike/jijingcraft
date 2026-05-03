const fs = require("node:fs");
const path = require("node:path");

function createDefaultProgress() {
  return {
    hasStarterShelter: false,
    starterShelterPosition: null,
    hasCropPlot: false,
    plantedCrops: 0,
    hasAnimalPen: false,
    animalPenPosition: null,
    animalsLured: 0,
    hasMiningEntry: false,
    miningTrips: 0,
    hasCraftingTable: false,
    achievedMilestones: []
  };
}

function createDefaultSurvivalMemory() {
  return {
    version: 1,
    updatedAt: null,
    progress: createDefaultProgress(),
    knownBlocks: {
      crafting_table: []
    },
    learning: {
      policyStats: {},
      avoidedPositions: []
    }
  };
}

function normalizePosition(position) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
}

function samePosition(left, right) {
  return left && right && left.x === right.x && left.y === right.y && left.z === right.z;
}

function mergeMemory(rawMemory) {
  const memory = createDefaultSurvivalMemory();
  if (!rawMemory || typeof rawMemory !== "object") return memory;

  memory.version = Number.isInteger(rawMemory.version) ? rawMemory.version : memory.version;
  memory.updatedAt = typeof rawMemory.updatedAt === "string" ? rawMemory.updatedAt : null;
  memory.progress = {
    ...memory.progress,
    ...(rawMemory.progress && typeof rawMemory.progress === "object" ? rawMemory.progress : {})
  };
  memory.progress.achievedMilestones = Array.isArray(memory.progress.achievedMilestones)
    ? [...new Set(memory.progress.achievedMilestones.filter((id) => typeof id === "string"))]
    : [];

  const knownBlocks = rawMemory.knownBlocks && typeof rawMemory.knownBlocks === "object" ? rawMemory.knownBlocks : {};
  for (const [blockName, entries] of Object.entries(knownBlocks)) {
    if (!Array.isArray(entries)) continue;
    memory.knownBlocks[blockName] = entries
      .map((entry) => ({
        position: normalizePosition(entry.position),
        dimension: typeof entry.dimension === "string" ? entry.dimension : "unknown",
        firstSeenAt: typeof entry.firstSeenAt === "string" ? entry.firstSeenAt : null,
        lastSeenAt: typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : null
      }))
      .filter((entry) => entry.position);
  }

  const learning = rawMemory.learning && typeof rawMemory.learning === "object" ? rawMemory.learning : {};
  const policyStats = learning.policyStats && typeof learning.policyStats === "object" ? learning.policyStats : {};
  for (const [key, stats] of Object.entries(policyStats)) {
    if (!stats || typeof stats !== "object") continue;
    memory.learning.policyStats[key] = {
      attempts: Math.max(0, Number(stats.attempts) || 0),
      successes: Math.max(0, Number(stats.successes) || 0),
      failures: Math.max(0, Number(stats.failures) || 0),
      lastOutcome: typeof stats.lastOutcome === "string" ? stats.lastOutcome : null,
      lastReason: typeof stats.lastReason === "string" ? stats.lastReason : null,
      cooldownUntil: typeof stats.cooldownUntil === "string" ? stats.cooldownUntil : null,
      updatedAt: typeof stats.updatedAt === "string" ? stats.updatedAt : null
    };
  }

  const avoidedPositions = Array.isArray(learning.avoidedPositions) ? learning.avoidedPositions : [];
  memory.learning.avoidedPositions = avoidedPositions
    .map((entry) => ({
      key: typeof entry.key === "string" ? entry.key : "unknown",
      action: typeof entry.action === "string" ? entry.action : "unknown",
      target: typeof entry.target === "string" ? entry.target : null,
      reason: typeof entry.reason === "string" ? entry.reason : null,
      position: normalizePosition(entry.position),
      dimension: typeof entry.dimension === "string" ? entry.dimension : "unknown",
      radius: Math.max(1, Number(entry.radius) || 4),
      failures: Math.max(1, Number(entry.failures) || 1),
      expiresAt: typeof entry.expiresAt === "string" ? entry.expiresAt : null,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null
    }))
    .filter((entry) => entry.position);

  return memory;
}

function loadSurvivalMemory(filePath, logger = console) {
  if (!filePath || !fs.existsSync(filePath)) return createDefaultSurvivalMemory();

  try {
    const rawMemory = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return mergeMemory(rawMemory);
  } catch (error) {
    logger.warn?.(`survival memory load failed: ${error.message}`);
    return createDefaultSurvivalMemory();
  }
}

function saveSurvivalMemory(filePath, memory, logger = console) {
  if (!filePath) return false;

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const nextMemory = mergeMemory({ ...memory, updatedAt: new Date().toISOString() });
    const temporaryPath = `${filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(nextMemory, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, filePath);
    return true;
  } catch (error) {
    logger.warn?.(`survival memory save failed: ${error.message}`);
    return false;
  }
}

function rememberKnownBlock(memory, blockName, position, dimension = "unknown") {
  const normalizedPosition = normalizePosition(position);
  if (!memory || !blockName || !normalizedPosition) return false;

  if (!memory.knownBlocks) memory.knownBlocks = {};
  if (!Array.isArray(memory.knownBlocks[blockName])) memory.knownBlocks[blockName] = [];

  const now = new Date().toISOString();
  const existing = memory.knownBlocks[blockName].find((entry) => samePosition(entry.position, normalizedPosition) && entry.dimension === dimension);
  if (existing) {
    existing.lastSeenAt = now;
    return false;
  }

  memory.knownBlocks[blockName].push({
    position: normalizedPosition,
    dimension,
    firstSeenAt: now,
    lastSeenAt: now
  });
  return true;
}

function forgetKnownBlock(memory, blockName, position, dimension = "unknown") {
  const normalizedPosition = normalizePosition(position);
  if (!memory?.knownBlocks?.[blockName] || !normalizedPosition) return false;

  const before = memory.knownBlocks[blockName].length;
  memory.knownBlocks[blockName] = memory.knownBlocks[blockName].filter((entry) => {
    return !(samePosition(entry.position, normalizedPosition) && entry.dimension === dimension);
  });
  return memory.knownBlocks[blockName].length !== before;
}

function updateProgressMemory(memory, progressState) {
  if (!memory || !progressState) return false;
  memory.progress = {
    ...createDefaultProgress(),
    ...progressState,
    achievedMilestones: Array.isArray(progressState.achievedMilestones)
      ? [...new Set(progressState.achievedMilestones)]
      : []
  };
  return true;
}

function pruneLearningMemory(memory, now = Date.now()) {
  if (!memory.learning) memory.learning = { policyStats: {}, avoidedPositions: [] };
  if (!memory.learning.policyStats) memory.learning.policyStats = {};
  if (!Array.isArray(memory.learning.avoidedPositions)) memory.learning.avoidedPositions = [];

  memory.learning.avoidedPositions = memory.learning.avoidedPositions.filter((entry) => {
    if (!entry.expiresAt) return true;
    const expiresAt = Date.parse(entry.expiresAt);
    return !Number.isFinite(expiresAt) || expiresAt > now;
  }).slice(-80);
}

function learningKey(action, target = "") {
  return `${action}:${target || "default"}`;
}

function recordLearningEvent(memory, event) {
  if (!memory || !event?.action) return false;
  pruneLearningMemory(memory);

  const now = new Date();
  const key = event.key || learningKey(event.action, event.target);
  const outcome = event.outcome === "success" ? "success" : "failure";
  const stats = memory.learning.policyStats[key] || {
    attempts: 0,
    successes: 0,
    failures: 0,
    lastOutcome: null,
    lastReason: null,
    cooldownUntil: null,
    updatedAt: null
  };

  stats.attempts += 1;
  if (outcome === "success") {
    stats.successes += 1;
    stats.failures = Math.max(0, stats.failures - 1);
    stats.cooldownUntil = null;
  } else {
    stats.failures += 1;
    const cooldownMs = Math.min(10 * 60 * 1000, 20_000 * stats.failures ** 2);
    stats.cooldownUntil = new Date(now.getTime() + cooldownMs).toISOString();
  }

  stats.lastOutcome = outcome;
  stats.lastReason = typeof event.reason === "string" ? event.reason : null;
  stats.updatedAt = now.toISOString();
  memory.learning.policyStats[key] = stats;

  const position = normalizePosition(event.position);
  if (outcome === "failure" && position) {
    const dimension = typeof event.dimension === "string" ? event.dimension : "unknown";
    const existing = memory.learning.avoidedPositions.find((entry) => entry.key === key && entry.dimension === dimension && samePosition(entry.position, position));
    const avoidEntry = existing || {
      key,
      action: event.action,
      target: typeof event.target === "string" ? event.target : null,
      reason: null,
      position,
      dimension,
      radius: Math.max(2, Number(event.radius) || 5),
      failures: 0,
      expiresAt: null,
      updatedAt: null
    };
    avoidEntry.failures += 1;
    avoidEntry.reason = typeof event.reason === "string" ? event.reason : null;
    avoidEntry.radius = Math.max(avoidEntry.radius, Math.max(2, Number(event.radius) || 5));
    const avoidMs = Math.min(15 * 60 * 1000, 45_000 * avoidEntry.failures ** 2);
    avoidEntry.expiresAt = new Date(now.getTime() + avoidMs).toISOString();
    avoidEntry.updatedAt = now.toISOString();
    if (!existing) memory.learning.avoidedPositions.push(avoidEntry);
  }

  return true;
}

function isLearningPositionAvoided(memory, position, options = {}) {
  const normalizedPosition = normalizePosition(position);
  if (!memory?.learning || !normalizedPosition) return false;
  pruneLearningMemory(memory);

  const dimension = options.dimension || "unknown";
  const action = options.action || null;
  const target = options.target || null;
  return memory.learning.avoidedPositions.some((entry) => {
    if (entry.dimension !== dimension) return false;
    if (action && entry.action !== action) return false;
    if (target && entry.target && entry.target !== target) return false;
    const deltaX = entry.position.x - normalizedPosition.x;
    const deltaY = entry.position.y - normalizedPosition.y;
    const deltaZ = entry.position.z - normalizedPosition.z;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ) <= entry.radius;
  });
}

module.exports = {
  createDefaultProgress,
  createDefaultSurvivalMemory,
  forgetKnownBlock,
  isLearningPositionAvoided,
  loadSurvivalMemory,
  rememberKnownBlock,
  recordLearningEvent,
  saveSurvivalMemory,
  updateProgressMemory
};