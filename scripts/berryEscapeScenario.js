const mineflayer = require("mineflayer");
const { Vec3 } = require("vec3");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  return Number.isFinite(value) ? value : fallback;
}

function readNumber(name, fallback) {
  const value = Number.parseFloat(process.env[name] ?? String(fallback));
  return Number.isFinite(value) ? value : fallback;
}

function assertMinecraftUsername(username, label) {
  if (!/^[A-Za-z0-9_]{1,16}$/.test(username)) {
    throw new Error(`${label} must be 1-16 characters and only contain letters, numbers, or underscore`);
  }
}

function scenarioConfig() {
  const dashboardPort = readInteger("SCENARIO_DASHBOARD_PORT", 3000);
  const botUsername = process.env.SCENARIO_BOT_USERNAME ?? process.env.BOT_USERNAME ?? "SurvivalBot";
  const config = {
    host: process.env.MC_HOST ?? "localhost",
    port: readInteger("MC_PORT", 8000),
    botUsername,
    adminUsername: process.env.SCENARIO_ADMIN_USERNAME ?? "BerryAdmin",
    dashboardPort,
    dashboardUrl: process.env.SCENARIO_DASHBOARD_URL ?? `http://127.0.0.1:${dashboardPort}`,
    timeoutMs: readInteger("SCENARIO_TIMEOUT_MS", 70000),
    setupPauseMs: readInteger("SCENARIO_SETUP_PAUSE_MS", 30000),
    platformRadius: readInteger("SCENARIO_PLATFORM_RADIUS", 10),
    berryPatchRadius: readInteger("SCENARIO_BERRY_PATCH_RADIUS", 4),
    maxHorizontalSpeed: readNumber("SCENARIO_MAX_HORIZONTAL_SPEED", 5.2),
    testTaskType: process.env.SCENARIO_TEST_TASK ?? process.env.SCENARIO_PRIORITY_TASK ?? "escape_hazard",
    testTaskPriority: readInteger("SCENARIO_TEST_TASK_PRIORITY", readInteger("SCENARIO_PRIORITY", 100)),
    trapPosition: new Vec3(
      readInteger("SCENARIO_TRAP_X", 0),
      readInteger("SCENARIO_TRAP_Y", 80),
      readInteger("SCENARIO_TRAP_Z", 0)
    )
  };
  assertMinecraftUsername(config.botUsername, "SCENARIO_BOT_USERNAME");
  assertMinecraftUsername(config.adminUsername, "SCENARIO_ADMIN_USERNAME");
  return config;
}

function log(message) {
  console.log(`[berry-escape] ${message}`);
}

async function requestJson(dashboardUrl, pathname, payload = null, method = "POST") {
  const response = await fetch(`${dashboardUrl}${pathname}`, {
    method,
    cache: "no-store",
    headers: payload ? { "content-type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok || body.ok === false) {
    const error = body.error || `dashboard_http_${response.status}`;
    if (error === "test_control_disabled") {
      throw new Error("dashboard test control is disabled; restart the existing bot with TEST_CONTROL_ENABLED=true before running this scenario");
    }
    throw new Error(error);
  }
  return body;
}

async function fetchStatus(dashboardUrl) {
  const response = await fetch(`${dashboardUrl}/api/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`dashboard_http_${response.status}`);
  return response.json();
}

async function waitForDashboard(dashboardUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const status = await fetchStatus(dashboardUrl);
      if (status.connection?.state === "connected" && status.bot?.position) return status;
    } catch (error) {
      lastError = error;
    }
    await wait(500);
  }
  throw new Error(`dashboard_not_ready: ${lastError?.message ?? "timeout"}`);
}

function connectAdmin(config) {
  return new Promise((resolve, reject) => {
    const admin = mineflayer.createBot({ host: config.host, port: config.port, username: config.adminUsername, auth: "offline" });
    let spawned = false;
    const timeout = setTimeout(() => {
      admin.quit();
      reject(new Error("admin_spawn_timeout"));
    }, 20000);
    admin.once("spawn", () => {
      spawned = true;
      clearTimeout(timeout);
      resolve(admin);
    });
    admin.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    admin.on("kicked", (reason) => {
      log(`admin kicked: ${reason}`);
      if (!spawned) {
        clearTimeout(timeout);
        reject(new Error(`admin_kicked_before_spawn: ${reason}`));
      }
    });
    admin.on("end", (reason) => {
      if (!spawned) {
        clearTimeout(timeout);
        reject(new Error(`admin_ended_before_spawn: ${reason ?? "unknown"}`));
      }
    });
    admin.on("message", (message) => log(`chat: ${message.toString()}`));
  });
}

async function runCommand(admin, command, delayMs = 300) {
  log(`cmd ${command}`);
  admin.chat(command);
  await wait(delayMs);
}

function commandPosition(position) {
  return `${Math.floor(position.x)} ${Math.floor(position.y)} ${Math.floor(position.z)}`;
}

async function prepareScenarioWorld(admin, config) {
  const base = config.trapPosition;
  const platformRadius = Math.max(config.platformRadius, config.berryPatchRadius + 3);
  const patchRadius = config.berryPatchRadius;
  const commands = [
    "/time set day",
    "/weather clear",
    "/difficulty normal",
    `/setworldspawn ${commandPosition(base)}`,
    `/fill ${base.x - platformRadius} ${base.y - 1} ${base.z - platformRadius} ${base.x + platformRadius} ${base.y - 1} ${base.z + platformRadius} grass_block replace`,
    `/fill ${base.x - platformRadius} ${base.y} ${base.z - platformRadius} ${base.x + platformRadius} ${base.y + 4} ${base.z + platformRadius} air replace`,
    `/fill ${base.x - patchRadius} ${base.y} ${base.z - patchRadius} ${base.x + patchRadius} ${base.y} ${base.z + patchRadius} sweet_berry_bush[age=3] replace air`,
    `/execute positioned ${commandPosition(base)} run kill @e[type=!player,distance=..${platformRadius + 8}]`,
    `/tp ${config.adminUsername} ${base.x + patchRadius + 3} ${base.y} ${base.z + patchRadius + 3}`
  ];
  for (const command of commands) await runCommand(admin, command);
}

async function resetExistingBotState(config) {
  return requestJson(config.dashboardUrl, "/api/test/reset-state", {
    resetMemory: false,
    clearTestTasks: true,
    clearPriorityTasks: false,
    clearForcedTask: false,
    clearLlmQueue: false,
    interruptMs: 5000,
    pauseMs: config.setupPauseMs
  });
}

async function releaseExistingBotState(config) {
  return requestJson(config.dashboardUrl, "/api/test/reset-state", {
    resetMemory: false,
    clearTestTasks: false,
    clearPriorityTasks: false,
    clearForcedTask: false,
    clearLlmQueue: false,
    interruptMs: 0,
    pauseMs: 0,
    releasePause: true
  });
}

async function initializeScenarioBot(admin, config) {
  const base = config.trapPosition;
  const commands = [
    `/tp ${config.botUsername} ${commandPosition(base)}`,
    `/execute positioned ${commandPosition(base)} run kill @e[type=!player,distance=..${config.platformRadius + 8}]`
  ];
  for (const command of commands) await runCommand(admin, command);
  await waitForAdminObservedBotPosition(admin, config.botUsername, config.trapPosition, 20000);
}

async function insertBerryEscapeTask(config) {
  return requestJson(config.dashboardUrl, "/api/test/pipeline", {
    taskType: config.testTaskType,
    priority: config.testTaskPriority,
    ttlMs: config.timeoutMs,
    reason: "sweet berry bush escape scenario",
    source: "berry_escape_scenario",
    replace: true,
    metadata: {
      scenario: "berry_escape",
      trapPosition: { x: config.trapPosition.x, y: config.trapPosition.y, z: config.trapPosition.z },
      berryPatchRadius: config.berryPatchRadius
    }
  });
}

function recentMessages(status) {
  return (status.recentEvents ?? []).map((event) => event.message ?? "");
}

function hasEscapeEvidence(messages) {
  return messages.some((message) => /decision=escape_hazard|emergency=damage_block/.test(message))
    && messages.some((message) => /action=escape_hazard_block/.test(message));
}

function hasBerryHazardExposureEvidence(status, config) {
  return status?.world?.environmentHazard?.name === "sweet_berry_bush" && !isOutsideBerryPatch(status, config);
}

function hasBerryDamageEvidence(messages, initialHealth, minHealth) {
  return messages.some((message) => /emergency=damage_block; block=sweet_berry_bush/.test(message))
    || (Number.isFinite(initialHealth) && Number.isFinite(minHealth) && minHealth < initialHealth - 0.01);
}

function hasTestTaskEvidence(status, taskType = "escape_hazard") {
  const testTasks = status.controller?.testTasks;
  return testTasks?.currentTask?.type === taskType
    || (testTasks?.pendingTasks ?? []).some((task) => task.type === taskType)
    || (testTasks?.completedTasks ?? []).some((task) => task.type === taskType && task.status === "completed")
    || (/started|completed/.test(testTasks?.lastEvent?.type ?? "") && testTasks?.lastEvent?.task === taskType);
}

function isSafeAfterEscape(status) {
  const health = Number(status.bot?.health ?? 0);
  return health > 0 && !status.world?.environmentHazard && status.connection?.state === "connected";
}

function isOutsideBerryPatch(status, config) {
  const position = status?.bot?.position;
  if (!position || !config?.trapPosition) return false;
  const x = Math.floor(Number(position.x));
  const z = Math.floor(Number(position.z));
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  return Math.abs(x - config.trapPosition.x) > config.berryPatchRadius
    || Math.abs(z - config.trapPosition.z) > config.berryPatchRadius;
}

function isInsideBerryPatchPosition(position, config) {
  if (!position || !config?.trapPosition) return false;
  const x = Math.floor(Number(position.x));
  const z = Math.floor(Number(position.z));
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  return Math.abs(x - config.trapPosition.x) <= config.berryPatchRadius
    && Math.abs(z - config.trapPosition.z) <= config.berryPatchRadius;
}

async function waitForScenarioArmed(admin, config, timeoutMs, insertedTestTasks = null) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = null;
  const insertedTaskEvidence = hasTestTaskEvidence({ controller: { testTasks: insertedTestTasks } }, config.testTaskType);
  while (Date.now() < deadline) {
    lastStatus = await fetchStatus(config.dashboardUrl);
    const position = getObservedPlayerPosition(admin, config.botUsername, lastStatus, { allowStatusFallback: false });
    const statusTaskEvidence = hasTestTaskEvidence(lastStatus, config.testTaskType);
    if (isInsideBerryPatchPosition(position, config) && (insertedTaskEvidence || statusTaskEvidence)) return lastStatus;
    await wait(250);
  }
  throw new Error(`scenario_not_armed: testPipeline=${lastStatus?.controller?.testTasks?.lastEvent?.type ?? "none"}; pos=${lastStatus?.bot?.position?.text ?? "unknown"}`);
}

async function waitForAdminObservedBotPosition(admin, username, targetPosition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const position = getObservedPlayerPosition(admin, username, null, { allowStatusFallback: false });
    if (position) {
      const nearTarget = Math.floor(position.x) === targetPosition.x
        && Math.floor(position.y) === targetPosition.y
        && Math.floor(position.z) === targetPosition.z;
      if (nearTarget) return position;
    }
    await wait(250);
  }
  throw new Error("bot_trap_position_not_observed");
}

function getObservedPlayerPosition(admin, username, status, options = {}) {
  const entityPosition = admin.players?.[username]?.entity?.position;
  if (entityPosition && Number.isFinite(entityPosition.x) && Number.isFinite(entityPosition.y) && Number.isFinite(entityPosition.z)) {
    return { x: entityPosition.x, y: entityPosition.y, z: entityPosition.z };
  }
  if (options.allowStatusFallback === false) return null;
  const statusPosition = status?.bot?.position;
  if (statusPosition && Number.isFinite(statusPosition.x) && Number.isFinite(statusPosition.y) && Number.isFinite(statusPosition.z)) {
    return { x: statusPosition.x, y: statusPosition.y, z: statusPosition.z };
  }
  return null;
}

function horizontalSpeed(previous, current) {
  if (!previous?.position || !current?.position) return 0;
  const elapsedSeconds = (current.at - previous.at) / 1000;
  if (elapsedSeconds <= 0.1) return 0;
  const distance = Math.hypot(
    current.position.x - previous.position.x,
    current.position.z - previous.position.z
  );
  return distance / elapsedSeconds;
}

async function waitForScenarioResult(admin, config, options = {}) {
  const deadline = Date.now() + config.timeoutMs;
  let lastStatus = null;
  let previousSample = null;
  let maxHorizontalSpeed = 0;
  let minHealth = Number.isFinite(options.initialHealth) ? options.initialHealth : Infinity;
  let hazardEvidence = false;
  let damageEvidence = false;
  while (Date.now() < deadline) {
    lastStatus = await fetchStatus(config.dashboardUrl);
    const position = getObservedPlayerPosition(admin, config.botUsername, lastStatus, { allowStatusFallback: false });
    const currentSample = position ? { at: Date.now(), position } : null;
    if (currentSample && previousSample) {
      const speed = horizontalSpeed(previousSample, currentSample);
      maxHorizontalSpeed = Math.max(maxHorizontalSpeed, speed);
      if (speed > config.maxHorizontalSpeed) {
        return { ok: false, reason: "abnormal_movement_speed", status: lastStatus, maxHorizontalSpeed, speed };
      }
    }
    if (currentSample) previousSample = currentSample;

    const messages = recentMessages(lastStatus);
    const health = Number(lastStatus.bot?.health ?? 0);
    if (Number.isFinite(health) && health > 0) minHealth = Math.min(minHealth, health);
    hazardEvidence = hazardEvidence || hasBerryHazardExposureEvidence(lastStatus, config) || messages.some((message) => /emergency=damage_block; block=sweet_berry_bush/.test(message));
    damageEvidence = damageEvidence || hasBerryDamageEvidence(messages, options.initialHealth, minHealth);
    const died = messages.some((message) => /bot died/i.test(message)) || lastStatus.connection?.state === "dead";
    const queueEvidence = hasTestTaskEvidence(lastStatus, config.testTaskType);
    const outsidePatch = isOutsideBerryPatch(lastStatus, config);
    const escaped = queueEvidence && hasEscapeEvidence(messages) && isSafeAfterEscape(lastStatus) && outsidePatch;
    const queueState = lastStatus.controller?.testTasks?.currentTask?.type
      ?? lastStatus.controller?.testTasks?.pendingTasks?.[0]?.type
      ?? lastStatus.controller?.testTasks?.lastEvent?.type
      ?? "none";

    log(`observe health=${health}; minHealth=${Number.isFinite(minHealth) ? minHealth : "unknown"}; hazard=${lastStatus.world?.environmentHazard?.name ?? "none"}; damageEvidence=${damageEvidence}; hazardEvidence=${hazardEvidence}; decision=${lastStatus.decision?.type ?? "none"}; testPipeline=${queueState}; outsidePatch=${outsidePatch}; pos=${lastStatus.bot?.position?.text ?? "unknown"}; maxSpeed=${maxHorizontalSpeed.toFixed(2)}bps`);
    if (died || health <= 0) return { ok: false, reason: "bot_died", status: lastStatus, maxHorizontalSpeed, minHealth, hazardEvidence, damageEvidence };
    if (escaped && !hazardEvidence) return { ok: false, reason: "missing_berry_hazard_exposure_evidence", status: lastStatus, maxHorizontalSpeed, minHealth, hazardEvidence, damageEvidence };
    if (escaped) return { ok: true, reason: "escaped_sweet_berry_bush_test_pipeline", status: lastStatus, maxHorizontalSpeed, minHealth, hazardEvidence, damageEvidence };
    await wait(1000);
  }
  return { ok: false, reason: "scenario_timeout", status: lastStatus, maxHorizontalSpeed, minHealth, hazardEvidence, damageEvidence };
}

async function main() {
  const config = scenarioConfig();
  let admin = null;
  try {
    log(`using existing bot username=${config.botUsername}; dashboard=${config.dashboardUrl}; patch=${(config.berryPatchRadius * 2) + 1}x${(config.berryPatchRadius * 2) + 1}; testPipeline=${config.testTaskType}; maxSpeed=${config.maxHorizontalSpeed}bps`);
    const initialStatus = await waitForDashboard(config.dashboardUrl, 30000);
    if (initialStatus.connection?.username && initialStatus.connection.username !== config.botUsername) {
      log(`dashboard username is ${initialStatus.connection.username}; scenario target is ${config.botUsername}`);
    }
    await resetExistingBotState(config);
    admin = await connectAdmin(config);
    await prepareScenarioWorld(admin, config);
    await initializeScenarioBot(admin, config);
    await waitForDashboard(config.dashboardUrl, 30000);
    await resetExistingBotState(config);
    const insertedTask = await insertBerryEscapeTask(config);
    const armedStatus = await waitForScenarioArmed(admin, config, 20000, insertedTask.testTasks);
    const initialHealth = Number(armedStatus.bot?.health ?? NaN);
    await releaseExistingBotState(config);
    log("inserted test pipeline escape task before trapping the existing bot; released normal controller execution");
    const result = await waitForScenarioResult(admin, config, { initialHealth });
    const messages = recentMessages(result.status ?? {});
    console.log(JSON.stringify({
      ok: result.ok,
      reason: result.reason,
      botUsername: config.botUsername,
      health: result.status?.bot?.health ?? null,
      food: result.status?.bot?.food ?? null,
      position: result.status?.bot?.position ?? null,
      environmentHazard: result.status?.world?.environmentHazard ?? null,
      decision: result.status?.decision?.type ?? null,
      testTasks: result.status?.controller?.testTasks ?? null,
      priorityTasks: result.status?.controller?.priorityTasks ?? null,
      berryPatchSize: `${(config.berryPatchRadius * 2) + 1}x${(config.berryPatchRadius * 2) + 1}`,
      platformSize: `${(Math.max(config.platformRadius, config.berryPatchRadius + 3) * 2) + 1}x${(Math.max(config.platformRadius, config.berryPatchRadius + 3) * 2) + 1}`,
      outsideBerryPatch: isOutsideBerryPatch(result.status, config),
      initialHealth: Number.isFinite(initialHealth) ? initialHealth : null,
      minHealth: Number.isFinite(result.minHealth) ? result.minHealth : null,
      hazardEvidence: Boolean(result.hazardEvidence),
      damageEvidence: Boolean(result.damageEvidence),
      maxHorizontalSpeed: Number((result.maxHorizontalSpeed ?? 0).toFixed(2)),
      maxAllowedHorizontalSpeed: config.maxHorizontalSpeed,
      escapeEvents: messages.filter((message) => /escape_hazard|damage_block|task_queue|bot died/.test(message)).slice(0, 12)
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    if (admin) await cleanupScenarioWorld(admin, config).catch((error) => log(`cleanup skipped: ${error.message}`));
    if (admin) admin.quit();
  }
}

async function cleanupScenarioWorld(admin, config) {
  const base = config.trapPosition;
  const patchRadius = config.berryPatchRadius;
  await runCommand(admin, `/fill ${base.x - patchRadius} ${base.y} ${base.z - patchRadius} ${base.x + patchRadius} ${base.y} ${base.z + patchRadius} air replace sweet_berry_bush`, 200);
  await runCommand(admin, `/tp ${config.botUsername} ${base.x + patchRadius + 3} ${base.y} ${base.z + patchRadius + 3}`, 200);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[berry-escape] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  hasEscapeEvidence,
  hasBerryDamageEvidence,
  hasBerryHazardExposureEvidence,
  hasTestTaskEvidence,
  horizontalSpeed,
  isInsideBerryPatchPosition,
  isOutsideBerryPatch,
  isSafeAfterEscape,
  scenarioConfig
};
