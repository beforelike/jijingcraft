const LEVELS = ["debug", "info", "warn", "error"];

function createLogger(level = "info") {
  const minimum = Math.max(LEVELS.indexOf(level), 0);

  function write(targetLevel, args) {
    if (LEVELS.indexOf(targetLevel) < minimum) return;
    const timestamp = new Date().toISOString();
    console[targetLevel === "debug" ? "log" : targetLevel](`[${timestamp}] [${targetLevel}]`, ...args);
  }

  return {
    debug: (...args) => write("debug", args),
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args)
  };
}

module.exports = { createLogger };