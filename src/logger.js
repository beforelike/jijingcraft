const LEVELS = ["debug", "info", "warn", "error"];

function createLogger(level = "info", options = {}) {
  const minimum = Math.max(LEVELS.indexOf(level), 0);
  const sinks = Array.isArray(options.sinks) ? options.sinks : [];

  function write(targetLevel, args) {
    if (LEVELS.indexOf(targetLevel) < minimum) return;
    const timestamp = new Date().toISOString();
    console[targetLevel === "debug" ? "log" : targetLevel](`[${timestamp}] [${targetLevel}]`, ...args);
    const entry = {
      timestamp,
      level: targetLevel,
      args,
      message: args.map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg instanceof Error) return arg.message;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }).join(" ")
    };
    for (const sink of sinks) {
      try {
        sink(entry);
      } catch {
        // Logging sinks are observers only; console output must never fail because of them.
      }
    }
  }

  return {
    debug: (...args) => write("debug", args),
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args)
  };
}

module.exports = { createLogger };