require("dotenv").config({ quiet: true });
const path = require("node:path");

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return undefined;
}

function readString(name, fallback) {
  return readArg(name.toLowerCase().replaceAll("_", "-")) || process.env[name] || fallback;
}

function readInteger(name, fallback) {
  const raw = readString(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return fallback;
  return value;
}

function readBoolean(name, fallback) {
  const raw = readString(name, String(fallback)).toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeMinecraftVersion(rawVersion, warn = console.warn) {
  if (!rawVersion || rawVersion.trim().length === 0) return undefined;

  const version = rawVersion.trim();
  if (version.toLowerCase() === "auto") return undefined;

  const looksLikeJavaVersion = /^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
  if (!looksLikeJavaVersion) {
    warn(`[config] Ignoring MC_VERSION=${version}. Use a Java Edition version such as 1.21.1 or 26.1.1; auto-detection will be used.`);
    return undefined;
  }

  return version;
}

function loadConfig() {
  const rawVersion = readString("MC_VERSION", "");
  return {
    host: readString("MC_HOST", "localhost"),
    port: readInteger("MC_PORT", 8000),
    username: readString("BOT_USERNAME", "SurvivalBot"),
    auth: readString("MC_AUTH", "offline"),
    version: normalizeMinecraftVersion(rawVersion),
    controlIntervalMs: readInteger("CONTROL_INTERVAL_MS", 5000),
    logLevel: readString("LOG_LEVEL", "info"),
    hideProtocolErrors: readBoolean("HIDE_PROTOCOL_ERRORS", true),
    reconnect: {
      enabled: readBoolean("AUTO_RECONNECT", true),
      minDelayMs: readInteger("RECONNECT_MIN_DELAY_MS", 5000),
      maxDelayMs: readInteger("RECONNECT_MAX_DELAY_MS", 60000)
    },
    memory: {
      enabled: readBoolean("SURVIVAL_MEMORY_ENABLED", true),
      filePath: path.resolve(readString("SURVIVAL_MEMORY_FILE", "data/survival-memory.json")),
      knownBlockSearchRadius: readInteger("KNOWN_BLOCK_SEARCH_RADIUS", 96)
    },
    survival: {
      criticalHealth: readInteger("CRITICAL_HEALTH", 8),
      lowFood: readInteger("LOW_FOOD", 14),
      emergencyFood: readInteger("EMERGENCY_FOOD", 8),
      starterFoodTarget: readInteger("STARTER_FOOD_TARGET", 6),
      foodStockTarget: readInteger("FOOD_STOCK_TARGET", 18),
      foodSearchRadius: readInteger("FOOD_SEARCH_RADIUS", 48),
      buildShelter: readBoolean("BUILD_SHELTER", true),
      shelterBlockTarget: readInteger("HOUSE_BLOCK_TARGET", readInteger("SHELTER_BLOCK_TARGET", 80)),
      woolTarget: readInteger("WOOL_TARGET", 3),
      plantCrops: readBoolean("PLANT_CROPS", true),
      cropPlotTarget: readInteger("CROP_PLOT_TARGET", 6),
      buildAnimalPen: readBoolean("BUILD_ANIMAL_PEN", true),
      animalPenBlockTarget: readInteger("ANIMAL_PEN_BLOCK_TARGET", 32),
      advancedMaterialTarget: readInteger("ADVANCED_MATERIAL_TARGET", 8),
      mineSearchRadius: readInteger("MINE_SEARCH_RADIUS", 64),
      threatRadius: readInteger("THREAT_RADIUS", 20),
      safeModeThreatRadius: readInteger("SAFE_MODE_THREAT_RADIUS", 28),
      immediateThreatRadius: readInteger("IMMEDIATE_THREAT_RADIUS", 8),
      shelterDefenseRadius: readInteger("SHELTER_DEFENSE_RADIUS", 4),
      evadeDistance: readInteger("EVADE_DISTANCE", 24),
      exploreRadius: readInteger("EXPLORE_RADIUS", 36),
      panicRetreatMs: readInteger("PANIC_RETREAT_MS", 3500),
      avoidNightExploration: readBoolean("AVOID_NIGHT_EXPLORATION", true),
      actionTimeoutMs: readInteger("ACTION_TIMEOUT_MS", 25000),
      placeBlockTimeoutMs: readInteger("PLACE_BLOCK_TIMEOUT_MS", 3000)
    }
  };
}

module.exports = {
  loadConfig,
  normalizeMinecraftVersion
};