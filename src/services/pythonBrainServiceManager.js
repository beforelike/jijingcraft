const { spawn } = require("node:child_process");
const path = require("node:path");

function splitArgs(rawArgs) {
  if (Array.isArray(rawArgs)) return rawArgs;
  return String(rawArgs || "-m python_brain.main")
    .match(/(?:[^\s"]+|"[^"]*")+/g)
    ?.map((part) => part.replace(/^"|"$/g, "")) ?? ["-m", "python_brain.main"];
}

function nowIso() {
  return new Date().toISOString();
}

function isHealthCheckAccessLog(message) {
  return /"GET \/health(?:\?[^" ]*)? HTTP\/1\.[01]" 200 OK/.test(String(message ?? ""));
}

class PythonBrainServiceManager {
  constructor(config = {}, logger = console, options = {}) {
    this.config = config ?? {};
    this.logger = logger;
    this.fetchImpl = options.fetchImpl ?? global.fetch;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.cwd = options.cwd ?? process.cwd();
    this.child = null;
    this.logs = [];
    this.lastExit = null;
    this.lastAction = null;
  }

  get enabled() {
    return this.config.serviceEnabled !== false;
  }

  get plannerEnabled() {
    return Boolean(this.config.enabled);
  }

  get managed() {
    return this.config.managed !== false;
  }

  get url() {
    return String(this.config.url || "http://127.0.0.1:3001").replace(/\/+$/, "");
  }

  appendLog(level, message) {
    const text = String(message ?? "").trim();
    if (!text || isHealthCheckAccessLog(text)) return;
    this.logs.unshift({ at: nowIso(), level, message: text });
    this.logs = this.logs.slice(0, Number(this.config.maxLogLines) || 120);
  }

  async healthCheck(timeoutMs = 2500) {
    if (typeof this.fetchImpl !== "function") return { ok: false, error: "fetch_unavailable" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.url}/health`, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, payload, checkedAt: nowIso() };
    } catch (error) {
      clearTimeout(timer);
      return { ok: false, error: error.name === "AbortError" ? `timeout_${timeoutMs}ms` : error.message, checkedAt: nowIso() };
    }
  }

  async getStatus(extra = {}) {
    const health = this.enabled ? await this.healthCheck(Number(this.config.healthTimeoutMs) || 2500) : { ok: false, error: "disabled" };
    return {
      dashboard: {
        status: "running",
        url: extra.dashboardUrl ?? null,
        updatedAt: nowIso()
      },
      minecraftBot: {
        status: extra.connection?.state ?? "unknown",
        host: extra.connection?.host ?? null,
        port: extra.connection?.port ?? null,
        username: extra.connection?.username ?? null,
        message: extra.connection?.message ?? null
      },
      pythonBrain: {
        enabled: this.enabled,
        plannerEnabled: this.plannerEnabled,
        managed: this.managed,
        status: this.child ? "process_running" : (health.ok ? "reachable" : (this.enabled ? "stopped" : "disabled")),
        url: this.url,
        command: this.config.command ?? "python",
        pid: this.child?.pid ?? null,
        health,
        lastExit: this.lastExit,
        lastAction: this.lastAction,
        logs: this.logs.slice(0, 40)
      }
    };
  }

  async start() {
    if (!this.enabled) return { ok: false, error: "python_brain_service_disabled" };
    if (!this.managed) return { ok: false, error: "python_brain_not_managed" };
    if (this.child) return { ok: true, status: "already_running", pid: this.child.pid };
    const reachable = await this.healthCheck(1200);
    if (reachable.ok) return { ok: true, status: "already_reachable", health: reachable };

    const command = this.config.command || "python";
    const args = splitArgs(this.config.args);
    const env = {
      ...process.env,
      BRAIN_HOST: this.config.host || "127.0.0.1",
      BRAIN_PORT: String(this.config.port || 3001)
    };
    const child = this.spawnImpl(command, args, {
      cwd: path.resolve(this.cwd),
      env,
      shell: process.platform === "win32",
      windowsHide: true
    });
    this.child = child;
    this.lastExit = null;
    this.lastAction = { action: "start", at: nowIso() };
    this.appendLog("info", `start ${command} ${args.join(" ")}`);

    child.stdout?.on("data", (chunk) => this.appendLog("info", chunk.toString().trim()));
    child.stderr?.on("data", (chunk) => this.appendLog("warn", chunk.toString().trim()));
    child.on("error", (error) => {
      this.appendLog("error", error.message);
      this.lastExit = { code: null, signal: null, error: error.message, at: nowIso() };
      if (this.child === child) this.child = null;
    });
    child.on("exit", (code, signal) => {
      this.appendLog(code === 0 ? "info" : "warn", `exit code=${code} signal=${signal ?? "none"}`);
      this.lastExit = { code, signal, at: nowIso() };
      if (this.child === child) this.child = null;
    });
    return { ok: true, status: "started", pid: child.pid };
  }

  async stop() {
    if (!this.child) return { ok: true, status: "not_running" };
    const child = this.child;
    this.lastAction = { action: "stop", at: nowIso() };
    this.appendLog("info", `stop pid=${child.pid}`);
    child.kill();
    this.child = null;
    return { ok: true, status: "stopping", pid: child.pid };
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  async handleAction(action) {
    if (action === "start") return this.start();
    if (action === "stop") return this.stop();
    if (action === "restart") return this.restart();
    if (action === "health") return { ok: true, health: await this.healthCheck() };
    return { ok: false, error: "unknown_service_action" };
  }
}

function createPythonBrainServiceManager(config, logger, options = {}) {
  return new PythonBrainServiceManager(config, logger, options);
}

module.exports = {
  PythonBrainServiceManager,
  createPythonBrainServiceManager,
  isHealthCheckAccessLog,
  splitArgs
};