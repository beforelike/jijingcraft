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

function readFirstString(names, fallback) {
  for (const name of names) {
    const value = readString(name, undefined);
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function readInteger(name, fallback) {
  const raw = readString(name, String(fallback));
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) return fallback;
  return value;
}

function readNumber(name, fallback) {
  const raw = readString(name, String(fallback));
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return fallback;
  return value;
}

function readBoolean(name, fallback) {
  const raw = readString(name, String(fallback)).toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function isPlaceholderApiKey(apiKey) {
  if (!apiKey) return true;
  const normalized = String(apiKey).trim().toLowerCase();
  return normalized.length === 0 || normalized.includes("your-api-key") || normalized === "changeme";
}

function baseHostFromUrl(baseUrl) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

function loadLlmConfig() {
  const baseUrl = readFirstString(["LLM_BASE_URL", "BASE_URL", "BSAE_URL"], "");
  const apiKey = readFirstString(["LLM_API_KEY", "API_KEY"], "");
  const model = readFirstString(["LLM_MODEL", "MODEL"], "");
  const hasRequiredConfig = Boolean(baseUrl && apiKey && model && !isPlaceholderApiKey(apiKey));
  const requestedEnabled = readBoolean("LLM_ENABLED", hasRequiredConfig);
  const enabled = requestedEnabled && hasRequiredConfig;
  let disabledReason = null;
  if (!enabled) {
    if (!requestedEnabled) disabledReason = "disabled_by_config";
    else if (!baseUrl) disabledReason = "missing_base_url";
    else if (!model) disabledReason = "missing_model";
    else if (isPlaceholderApiKey(apiKey)) disabledReason = "missing_api_key";
  }

  return {
    enabled,
    disabledReason,
    baseUrl,
    baseHost: baseHostFromUrl(baseUrl),
    apiKey,
    model,
    timeoutMs: readInteger("LLM_TIMEOUT_MS", 60000),
    maxToolTurns: readInteger("LLM_MAX_TOOL_TURNS", 8),
    plannerIntervalMs: readInteger("LLM_PLANNER_INTERVAL_MS", 60000),
    recordsDir: path.resolve(readString("LLM_RECORDS_DIR", "data/llm/records")),
    maxRecentCalls: readInteger("LLM_MAX_RECENT_CALLS", 20),
    taskQueueEnabled: readBoolean("LLM_TASK_QUEUE_ENABLED", enabled),
    maxQueuedTasks: readInteger("LLM_MAX_QUEUED_TASKS", 5),
    taskQueueMaxAgeMs: readInteger("LLM_TASK_QUEUE_MAX_AGE_MS", 300000)
  };
}

function loadPythonBrainConfig() {
  const host = readString("BRAIN_HOST", "127.0.0.1");
  const port = readInteger("BRAIN_PORT", 3001);
  const url = readString("PYTHON_BRAIN_URL", `http://${host}:${port}`);
  const command = readString("PYTHON_BRAIN_COMMAND", "");
  const args = readString("PYTHON_BRAIN_ARGS", "-m python_brain.main");
  const enabled = readBoolean("PYTHON_BRAIN_ENABLED", false);
  return {
    enabled,
    serviceEnabled: readBoolean("PYTHON_BRAIN_SERVICE_ENABLED", true),
    url,
    host,
    port,
    timeoutMs: readInteger("PYTHON_BRAIN_TIMEOUT_MS", 30000),
    planningIntervalMs: readInteger("PYTHON_BRAIN_PLANNER_INTERVAL_MS", 30000),
    managed: readBoolean("PYTHON_BRAIN_MANAGED", true),
    autoStart: readBoolean("PYTHON_BRAIN_AUTO_START", false),
    command,
    args,
    healthTimeoutMs: readInteger("PYTHON_BRAIN_HEALTH_TIMEOUT_MS", 2500),
    maxLogLines: readInteger("PYTHON_BRAIN_MAX_LOG_LINES", 120)
  };
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
    dashboard: {
      enabled: readBoolean("DASHBOARD_ENABLED", true),
      host: readString("DASHBOARD_HOST", "127.0.0.1"),
      port: readInteger("DASHBOARD_PORT", 3000)
    },
    testControl: {
      enabled: readBoolean("TEST_CONTROL_ENABLED", false),
      initialForcedTask: readString("TEST_INITIAL_FORCED_TASK", ""),
      initialForcedTaskReason: readString("TEST_INITIAL_FORCED_TASK_REASON", "scenario startup override"),
      initialForcedTaskTtlMs: readInteger("TEST_INITIAL_FORCED_TASK_TTL_MS", 60000),
      startPausedMs: readInteger("TEST_START_PAUSED_MS", 0)
    },
    llm: loadLlmConfig(),
    pythonBrain: loadPythonBrainConfig(),
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
      lowOxygenThreshold: readInteger("LOW_OXYGEN_THRESHOLD", 8),
      nightFoodBuffer: readInteger("NIGHT_FOOD_BUFFER", 18),
      emergencyFood: readInteger("EMERGENCY_FOOD", 8),
      starterFoodTarget: readInteger("STARTER_FOOD_TARGET", 6),
      foodStockTarget: readInteger("FOOD_STOCK_TARGET", 18),
      foodSearchRadius: readInteger("FOOD_SEARCH_RADIUS", 48),
      buildShelter: readBoolean("BUILD_SHELTER", true),
      autoBlueprintDesign: readBoolean("AUTO_BLUEPRINT_DESIGN", true),
      shelterBlockTarget: readInteger("HOUSE_BLOCK_TARGET", readInteger("SHELTER_BLOCK_TARGET", 160)),
      woolTarget: readInteger("WOOL_TARGET", 3),
      plantCrops: readBoolean("PLANT_CROPS", true),
      cropPlotTarget: readInteger("CROP_PLOT_TARGET", 6),
      buildAnimalPen: readBoolean("BUILD_ANIMAL_PEN", true),
      animalPenBlockTarget: readInteger("ANIMAL_PEN_BLOCK_TARGET", 32),
      advancedMaterialTarget: readInteger("ADVANCED_MATERIAL_TARGET", 8),
      playbookEnabled: readBoolean("PLAYBOOK_ENABLED", true),
      day1LogTarget: readInteger("DAY1_LOG_TARGET", 20),
      day1CobblestoneTarget: readInteger("DAY1_COBBLESTONE_TARGET", 24),
      stockpileLogTarget: readInteger("STOCKPILE_LOG_TARGET", 96),
      stockpileCobblestoneTarget: readInteger("STOCKPILE_COBBLESTONE_TARGET", 128),
      mineSearchRadius: readInteger("MINE_SEARCH_RADIUS", 64),
      threatRadius: readInteger("THREAT_RADIUS", 20),
      safeModeThreatRadius: readInteger("SAFE_MODE_THREAT_RADIUS", 28),
      immediateThreatRadius: readInteger("IMMEDIATE_THREAT_RADIUS", 8),
      daylightThreatRadius: readInteger("DAYLIGHT_THREAT_RADIUS", 10),
      shelterDefenseRadius: readInteger("SHELTER_DEFENSE_RADIUS", 4),
      nightShelterReturnMaxDistance: readInteger("NIGHT_SHELTER_RETURN_MAX_DISTANCE", 96),
      evadeDistance: readInteger("EVADE_DISTANCE", 24),
      exploreRadius: readInteger("EXPLORE_RADIUS", 36),
      panicRetreatMs: readInteger("PANIC_RETREAT_MS", 3500),
      avoidNightExploration: readBoolean("AVOID_NIGHT_EXPLORATION", true),
      actionTimeoutMs: readInteger("ACTION_TIMEOUT_MS", 25000),
      taskNoProgressMs: readInteger("TASK_NO_PROGRESS_MS", 0),
      taskProgressMinDistance: readNumber("TASK_PROGRESS_MIN_DISTANCE", 0),
      placeBlockTimeoutMs: readInteger("PLACE_BLOCK_TIMEOUT_MS", 3000),
      exactScanRadius: readInteger("EXACT_SCAN_RADIUS", 5),
      regionalScanRadius: readInteger("REGIONAL_SCAN_RADIUS", 100),
      regionalScanStep: readInteger("REGIONAL_SCAN_STEP", 10)
    }
  };
}

module.exports = {
  baseHostFromUrl,
  isPlaceholderApiKey,
  loadConfig,
  loadLlmConfig,
  loadPythonBrainConfig,
  normalizeMinecraftVersion
};