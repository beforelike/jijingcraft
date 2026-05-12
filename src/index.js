const { createMinecraftBot } = require("./botFactory");
const { loadConfig } = require("./config");
const { createDashboardServer } = require("./dashboard/server");
const { createDashboardState } = require("./dashboard/statusHub");
const { LlmCallRecorder } = require("./llm/callRecorder");
const { createOpenAIClient } = require("./llm/client");
const { LlmPlanner } = require("./llm/planner");
const { createLogger } = require("./logger");
const { preflightProtocol, resolveMinecraftVersion } = require("./protocolSupport");
const { computeReconnectDelay } = require("./reconnect");
const { createPythonBrainServiceManager } = require("./services/pythonBrainServiceManager");
const { SurvivalController } = require("./survival/SurvivalController");

const config = loadConfig();
const dashboardState = createDashboardState(config);
const logger = createLogger(config.logLevel, {
  sinks: [(entry) => dashboardState.recordLog(entry)]
});
const llmRecorder = new LlmCallRecorder(config.llm);
const pythonBrainServiceManager = createPythonBrainServiceManager(config.pythonBrain, logger);
const llmPlanner = new LlmPlanner({
  config: config.llm,
  client: config.llm.enabled ? createOpenAIClient(config.llm) : null,
  recorder: llmRecorder,
  logger,
  onUpdate: (llmState) => dashboardState.setLlmState(llmState)
});
dashboardState.setLlmState(llmPlanner.getStatus());
logger.info(`llm=${config.llm.enabled ? "enabled" : "disabled"}; model=${config.llm.model || "none"}; baseHost=${config.llm.baseHost || "none"}${config.llm.disabledReason ? `; reason=${config.llm.disabledReason}` : ""}`);

let stopping = false;
let activeBot = null;
let activeController = null;
let dashboardServer = null;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function stringifyReason(reason) {
  if (!reason) return "connection ended";
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function stopActiveBot() {
  activeController?.stop();
  activeController = null;

  if (!activeBot) return;
  try {
    activeBot.quit("Stopping survival bot");
  } catch (error) {
    logger.debug("failed to quit active bot", error.message);
  }
  activeBot = null;
}

function runBotSession() {
  return new Promise((resolve) => {
    dashboardState.setConnection({
      state: "connecting",
      host: config.host,
      port: config.port,
      username: config.username,
      minecraftVersion: config.version ?? "auto",
      message: "connecting to Minecraft server"
    });
    const bot = createMinecraftBot(config);
    const controller = new SurvivalController(bot, config, logger, { statusReporter: dashboardState, llmPlanner });
    let spawned = false;
    let settled = false;
    let kickedReason = null;

    activeBot = bot;
    activeController = controller;

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      controller.handleLifecycleReset?.("bot_disconnect", { pauseMs: 0, interruptMs: 8000, clearTestTasks: false });
      controller.stop();
      dashboardState.setConnection({
        state: stopping ? "stopping" : "disconnected",
        message: stringifyReason(reason)
      });
      if (activeBot === bot) activeBot = null;
      if (activeController === controller) activeController = null;
      resolve({ reason: stringifyReason(reason), spawned });
    };

    bot.once("spawn", () => {
      spawned = true;
      dashboardState.setConnection({
        state: "connected",
        minecraftVersion: bot.version,
        message: "bot spawned"
      });
      logger.info(`connected to Minecraft ${bot.version}`);
      if (config.testControl?.enabled && config.testControl.startPausedMs > 0) {
        controller.pause(config.testControl.startPausedMs);
        logger.warn(`test_control=start_paused; durationMs=${config.testControl.startPausedMs}`);
      }
      if (config.testControl?.enabled && config.testControl.initialForcedTask) {
        try {
          controller.setForcedTask(config.testControl.initialForcedTask, {
            ttlMs: config.testControl.initialForcedTaskTtlMs,
            reason: config.testControl.initialForcedTaskReason,
            source: "test_startup"
          });
        } catch (error) {
          logger.warn(`test_control=initial_force_task_failed; task=${config.testControl.initialForcedTask}; error=${error.message}`);
        }
      }
      controller.start();
    });

    bot.on("death", () => {
      dashboardState.setConnection({ state: "dead", message: "bot died; attempting respawn" });
      logger.warn("bot died; attempting respawn");
      controller.handleLifecycleReset?.("bot_death", { pauseMs: 5000, interruptMs: 8000 });
      setTimeout(() => {
        try {
          bot.respawn();
        } catch (error) {
          logger.error("respawn failed", error);
        }
      }, 1500);
    });

    bot.on("respawn", () => {
      dashboardState.setConnection({ state: "connected", message: "bot respawned" });
      controller.handleLifecycleReset?.("bot_respawn", { pauseMs: 0, interruptMs: 1500 });
      logger.info("bot respawned; survival loop continues");
    });

    bot.on("kicked", (reason) => {
      kickedReason = stringifyReason(reason);
      dashboardState.setConnection({ state: "kicked", message: kickedReason });
      logger.warn(`bot was kicked: ${kickedReason}`);
    });

    bot.on("end", (reason) => {
      const finalReason = kickedReason || stringifyReason(reason);
      logger.warn(`bot disconnected: ${finalReason}`);
      finish(finalReason);
    });

    bot.on("error", (error) => {
      logger.error("bot error", error);
      if (!spawned) finish(`connection error before spawn: ${error.message}`);
    });
  });
}

async function main() {
  if (config.pythonBrain?.serviceEnabled !== false && config.pythonBrain?.autoStart) {
    const result = await pythonBrainServiceManager.start();
    if (result.ok) logger.info(`python brain service ${result.status}${result.pid ? ` pid=${result.pid}` : ""}`);
    else logger.warn(`python brain service start skipped: ${result.error}`);
  }

  if (config.dashboard.enabled !== false) {
    dashboardServer = createDashboardServer(dashboardState, config.dashboard, logger, {
      testControlEnabled: config.testControl?.enabled === true,
      getController: () => activeController,
      getBot: () => activeBot,
      serviceManager: pythonBrainServiceManager
    });
    await dashboardServer.start();
    if (config.testControl?.enabled) logger.warn("test_control=enabled; dashboard force-task API is active");
  } else {
    logger.info("dashboard disabled");
  }

  process.once("SIGINT", () => {
    stopping = true;
    logger.info("stopping bot");
    stopActiveBot();
    pythonBrainServiceManager.stop().catch((error) => logger.debug("python brain stop failed", error.message));
    dashboardServer?.stop().catch((error) => logger.debug("dashboard stop failed", error.message));
  });

  let reconnectAttempt = 0;
  while (!stopping) {
    try {
      const diagnosis = await preflightProtocol(config, logger);
      const resolvedVersion = resolveMinecraftVersion(config.version, diagnosis);
      if (resolvedVersion !== config.version) {
        logger.warn(`minecraft_version=resolved_from_ping; configured=${config.version ?? "auto"}; server=${resolvedVersion}`);
        config.version = resolvedVersion;
      }
      const result = await runBotSession();
      if (stopping) break;

      if (!config.reconnect.enabled) {
        logger.warn(`auto reconnect disabled; bot stopped after disconnect: ${result.reason}`);
        break;
      }

      reconnectAttempt = result.spawned ? 1 : reconnectAttempt + 1;
      const delayMs = computeReconnectDelay(config.reconnect, reconnectAttempt);
      logger.warn(`reconnecting in ${delayMs}ms after disconnect: ${result.reason}`);
      await wait(delayMs);
    } catch (error) {
      if (stopping) break;
      if (error.code === "UNSUPPORTED_PROTOCOL" || !config.reconnect.enabled) throw error;

      reconnectAttempt++;
      const delayMs = computeReconnectDelay(config.reconnect, reconnectAttempt);
      logger.error(`connection setup failed: ${error.message}`);
      logger.warn(`reconnecting in ${delayMs}ms`);
      await wait(delayMs);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runBotSession, stringifyReason };