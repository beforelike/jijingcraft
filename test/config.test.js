const assert = require("node:assert/strict");
const test = require("node:test");
const { isPlaceholderApiKey, loadConfig, normalizeMinecraftVersion } = require("../src/config");

const CONFIG_ENV_KEYS = [
  "LLM_ENABLED",
  "LLM_BASE_URL",
  "BASE_URL",
  "BSAE_URL",
  "LLM_API_KEY",
  "API_KEY",
  "LLM_MODEL",
  "MODEL",
  "LLM_TIMEOUT_MS",
  "LLM_PLANNER_INTERVAL_MS",
  "LLM_MAX_TOOL_TURNS",
  "LLM_TASK_QUEUE_ENABLED",
  "LLM_MAX_QUEUED_TASKS",
  "LLM_TASK_QUEUE_MAX_AGE_MS",
  "PYTHON_BRAIN_ENABLED",
  "PYTHON_BRAIN_SERVICE_ENABLED",
  "PYTHON_BRAIN_URL",
  "PYTHON_BRAIN_TIMEOUT_MS",
  "PYTHON_BRAIN_PLANNER_INTERVAL_MS",
  "PYTHON_BRAIN_AUTO_START",
  "PYTHON_BRAIN_MANAGED",
  "PYTHON_BRAIN_COMMAND",
  "PYTHON_BRAIN_ARGS",
  "BRAIN_HOST",
  "BRAIN_PORT",
  "TEST_CONTROL_ENABLED",
  "TEST_INITIAL_FORCED_TASK",
  "TEST_INITIAL_FORCED_TASK_REASON",
  "TEST_INITIAL_FORCED_TASK_TTL_MS",
  "TEST_START_PAUSED_MS",
  "NIGHT_FOOD_BUFFER",
  "PLAYBOOK_ENABLED",
  "DAY1_LOG_TARGET",
  "DAY1_COBBLESTONE_TARGET",
  "STOCKPILE_LOG_TARGET",
  "STOCKPILE_COBBLESTONE_TARGET",
  "TASK_NO_PROGRESS_MS",
  "TASK_PROGRESS_MIN_DISTANCE"
];

function withEnv(update, callback) {
  const previousEnv = { ...process.env };
  const previousArgv = [...process.argv];
  for (const key of CONFIG_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, update);
  process.argv = [process.argv[0], process.argv[1]];
  try {
    return callback();
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    process.argv = previousArgv;
  }
}

test("normalizes empty and auto Minecraft versions to undefined", () => {
  assert.equal(normalizeMinecraftVersion("", () => {}), undefined);
  assert.equal(normalizeMinecraftVersion("auto", () => {}), undefined);
});

test("keeps standard Java Minecraft versions", () => {
  assert.equal(normalizeMinecraftVersion("1.21.1", () => {}), "1.21.1");
  assert.equal(normalizeMinecraftVersion("26.1.1", () => {}), "26.1.1");
});

test("ignores malformed Minecraft versions so mineflayer can auto-detect", () => {
  assert.equal(normalizeMinecraftVersion("release-latest", () => {}), undefined);
});

test("LLM config stays disabled when only placeholder API key is present", () => withEnv({
  LLM_ENABLED: "true",
  LLM_BASE_URL: "https://example.test/v1",
  LLM_API_KEY: "your-api-key-here",
  LLM_MODEL: "test-model"
}, () => {
  const config = loadConfig();
  assert.equal(config.llm.enabled, false);
  assert.equal(config.llm.disabledReason, "missing_api_key");
  assert.equal(config.llm.baseHost, "example.test");
}));

test("LLM config supports the legacy BSAE_URL spelling", () => withEnv({
  LLM_ENABLED: "true",
  BSAE_URL: "https://legacy.example/v1",
  API_KEY: "sk-test",
  MODEL: "qwen-test"
}, () => {
  const config = loadConfig();
  assert.equal(config.llm.enabled, true);
  assert.equal(config.llm.baseUrl, "https://legacy.example/v1");
  assert.equal(config.llm.model, "qwen-test");
}));

test("LLM config defaults to a 60 second timeout for slower compatible models", () => withEnv({
  LLM_ENABLED: "true",
  LLM_BASE_URL: "https://example.test/v1",
  LLM_API_KEY: "sk-test",
  LLM_MODEL: "test-model"
}, () => {
  const config = loadConfig();
  assert.equal(config.llm.timeoutMs, 60000);
}));

test("LLM timeout can still be overridden by environment", () => withEnv({
  LLM_ENABLED: "true",
  LLM_BASE_URL: "https://example.test/v1",
  LLM_API_KEY: "sk-test",
  LLM_MODEL: "test-model",
  LLM_TIMEOUT_MS: "45000"
}, () => {
  const config = loadConfig();
  assert.equal(config.llm.timeoutMs, 45000);
}));

test("LLM task queue defaults on when LLM is enabled", () => withEnv({
  LLM_ENABLED: "true",
  LLM_BASE_URL: "https://example.test/v1",
  LLM_API_KEY: "sk-test",
  LLM_MODEL: "test-model"
}, () => {
  const config = loadConfig();
  assert.equal(config.llm.enabled, true);
  assert.equal(config.llm.taskQueueEnabled, true);
}));

test("LLM task queue can still be disabled explicitly", () => withEnv({
  LLM_ENABLED: "true",
  LLM_BASE_URL: "https://example.test/v1",
  LLM_API_KEY: "sk-test",
  LLM_MODEL: "test-model",
  LLM_TASK_QUEUE_ENABLED: "false"
}, () => {
  const config = loadConfig();
  assert.equal(config.llm.enabled, true);
  assert.equal(config.llm.taskQueueEnabled, false);
}));

test("placeholder API key detection avoids enabling dry-run planner accidentally", () => {
  assert.equal(isPlaceholderApiKey("your-api-key-here"), true);
  assert.equal(isPlaceholderApiKey("sk-realistic"), false);
});

test("LLM config exposes task queue limits", () => withEnv({
  LLM_ENABLED: "true",
  LLM_BASE_URL: "https://example.test/v1",
  LLM_API_KEY: "sk-test",
  LLM_MODEL: "test-model",
  LLM_TASK_QUEUE_ENABLED: "true",
  LLM_MAX_QUEUED_TASKS: "3",
  LLM_TASK_QUEUE_MAX_AGE_MS: "120000"
}, () => {
  const config = loadConfig();
  assert.equal(config.llm.enabled, true);
  assert.equal(config.llm.taskQueueEnabled, true);
  assert.equal(config.llm.maxQueuedTasks, 3);
  assert.equal(config.llm.taskQueueMaxAgeMs, 120000);
}));

test("test control API is opt-in only", () => withEnv({}, () => {
  assert.equal(loadConfig().testControl.enabled, false);
  process.env.TEST_CONTROL_ENABLED = "true";
  assert.equal(loadConfig().testControl.enabled, true);
}));

test("test control supports startup task lock for isolated scenarios", () => withEnv({
  TEST_CONTROL_ENABLED: "true",
  TEST_INITIAL_FORCED_TASK: "hunt_food",
  TEST_INITIAL_FORCED_TASK_REASON: "berry scenario",
  TEST_INITIAL_FORCED_TASK_TTL_MS: "120000",
  TEST_START_PAUSED_MS: "8000"
}, () => {
  const config = loadConfig();
  assert.equal(config.testControl.enabled, true);
  assert.equal(config.testControl.initialForcedTask, "hunt_food");
  assert.equal(config.testControl.initialForcedTaskReason, "berry scenario");
  assert.equal(config.testControl.initialForcedTaskTtlMs, 120000);
  assert.equal(config.testControl.startPausedMs, 8000);
}));

test("survival playbook defaults can be overridden by environment", () => withEnv({
  PLAYBOOK_ENABLED: "true",
  DAY1_LOG_TARGET: "32",
  DAY1_COBBLESTONE_TARGET: "40",
  STOCKPILE_LOG_TARGET: "128",
  STOCKPILE_COBBLESTONE_TARGET: "196"
}, () => {
  const config = loadConfig();
  assert.equal(config.survival.playbookEnabled, true);
  assert.equal(config.survival.day1LogTarget, 32);
  assert.equal(config.survival.day1CobblestoneTarget, 40);
  assert.equal(config.survival.stockpileLogTarget, 128);
  assert.equal(config.survival.stockpileCobblestoneTarget, 196);
}));

test("night food buffer can be tuned by environment", () => withEnv({
  NIGHT_FOOD_BUFFER: "17"
}, () => {
  const config = loadConfig();
  assert.equal(config.survival.nightFoodBuffer, 17);
}));

test("task no-progress watchdog can be tuned by environment", () => withEnv({
  TASK_NO_PROGRESS_MS: "9000",
  TASK_PROGRESS_MIN_DISTANCE: "0.75"
}, () => {
  const config = loadConfig();
  assert.equal(config.survival.taskNoProgressMs, 9000);
  assert.equal(config.survival.taskProgressMinDistance, 0.75);
}));

test("Python Brain service controls stay available when planner integration is off", () => withEnv({}, () => {
  const config = loadConfig();
  assert.equal(config.pythonBrain.enabled, false);
  assert.equal(config.pythonBrain.serviceEnabled, true);
  assert.equal(config.pythonBrain.command, "");
}));

test("Python Brain config is opt-in and exposes service controls", () => withEnv({
  PYTHON_BRAIN_ENABLED: "true",
  PYTHON_BRAIN_SERVICE_ENABLED: "false",
  PYTHON_BRAIN_URL: "http://127.0.0.1:3333",
  PYTHON_BRAIN_TIMEOUT_MS: "12000",
  PYTHON_BRAIN_PLANNER_INTERVAL_MS: "7000",
  PYTHON_BRAIN_AUTO_START: "true",
  PYTHON_BRAIN_COMMAND: "py",
  PYTHON_BRAIN_ARGS: "-m python_brain.main"
}, () => {
  const config = loadConfig();
  assert.equal(config.pythonBrain.enabled, true);
  assert.equal(config.pythonBrain.serviceEnabled, false);
  assert.equal(config.pythonBrain.url, "http://127.0.0.1:3333");
  assert.equal(config.pythonBrain.timeoutMs, 12000);
  assert.equal(config.pythonBrain.planningIntervalMs, 7000);
  assert.equal(config.pythonBrain.autoStart, true);
  assert.equal(config.pythonBrain.managed, true);
  assert.equal(config.pythonBrain.command, "py");
  assert.equal(config.pythonBrain.args, "-m python_brain.main");
}));