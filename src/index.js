const { createMinecraftBot } = require("./botFactory");
const { loadConfig } = require("./config");
const { createLogger } = require("./logger");
const { preflightProtocol } = require("./protocolSupport");
const { computeReconnectDelay } = require("./reconnect");
const { SurvivalController } = require("./survival/SurvivalController");

const config = loadConfig();
const logger = createLogger(config.logLevel);

let stopping = false;
let activeBot = null;
let activeController = null;

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
    const bot = createMinecraftBot(config);
    const controller = new SurvivalController(bot, config, logger);
    let spawned = false;
    let settled = false;
    let kickedReason = null;

    activeBot = bot;
    activeController = controller;

    const finish = (reason) => {
      if (settled) return;
      settled = true;
      controller.stop();
      if (activeBot === bot) activeBot = null;
      if (activeController === controller) activeController = null;
      resolve({ reason: stringifyReason(reason), spawned });
    };

    bot.once("spawn", () => {
      spawned = true;
      logger.info(`connected to Minecraft ${bot.version}`);
      controller.start();
    });

    bot.on("death", () => {
      logger.warn("bot died; attempting respawn");
      controller.pause(5000);
      controller.resetMotion();
      setTimeout(() => {
        try {
          bot.respawn();
        } catch (error) {
          logger.error("respawn failed", error);
        }
      }, 1500);
    });

    bot.on("respawn", () => {
      controller.pause(2500);
      controller.resetMotion();
      logger.info("bot respawned; survival loop continues");
    });

    bot.on("kicked", (reason) => {
      kickedReason = stringifyReason(reason);
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
  process.once("SIGINT", () => {
    stopping = true;
    logger.info("stopping bot");
    stopActiveBot();
  });

  let reconnectAttempt = 0;
  while (!stopping) {
    try {
      await preflightProtocol(config, logger);
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