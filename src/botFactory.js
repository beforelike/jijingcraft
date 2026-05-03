const mineflayer = require("mineflayer");
const { pathfinder } = require("mineflayer-pathfinder");
const collectBlock = require("mineflayer-collectblock").plugin;
const pvp = require("mineflayer-pvp").plugin;
const tool = require("mineflayer-tool").plugin;

function createMinecraftBot(config) {
  const options = {
    host: config.host,
    port: config.port,
    username: config.username,
    disableChatSigning: true,
    checkTimeoutInterval: 60 * 1000,
    hideErrors: config.hideProtocolErrors
  };

  if (config.auth && config.auth !== "offline") options.auth = config.auth;
  if (config.version) options.version = config.version;

  const bot = mineflayer.createBot(options);
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(collectBlock);
  bot.loadPlugin(pvp);
  bot.loadPlugin(tool);
  return bot;
}

module.exports = { createMinecraftBot };