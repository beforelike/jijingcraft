const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const STATIC_ROOT = path.join(__dirname, "public");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, headers);
  response.end(body);
}

function sendJson(response, statusCode, value) {
  return send(response, statusCode, `${JSON.stringify(value)}\n`, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
}

function readRequestBody(request, limitBytes = 4096) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > limitBytes) {
        reject(new Error("request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function safeStaticPath(urlPath) {
  const normalizedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(STATIC_ROOT, normalizedPath));
  if (!filePath.startsWith(STATIC_ROOT)) return null;
  return filePath;
}

function createRequestHandler(statusHub, control = {}) {
  return async (request, response) => {
    const requestUrl = new URL(request.url, "http://localhost");
    if (requestUrl.pathname === "/api/status") {
      return sendJson(response, 200, statusHub.getSnapshot());
    }

    if (requestUrl.pathname === "/api/services") {
      if (request.method !== "GET") {
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }
      const snapshot = statusHub.getSnapshot();
      const services = await control.serviceManager?.getStatus?.({
        connection: snapshot.connection,
        dashboardUrl: control.dashboardUrl?.() ?? null
      });
      return sendJson(response, 200, services ?? {
        dashboard: { status: "running", url: control.dashboardUrl?.() ?? null },
        minecraftBot: { status: snapshot.connection?.state ?? "unknown" },
        pythonBrain: { enabled: false, managed: false, status: "unconfigured", health: { ok: false, error: "unconfigured" }, logs: [] }
      });
    }

    if (requestUrl.pathname === "/api/services/python-brain") {
      if (request.method !== "POST") {
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }
      if (!control.serviceManager?.handleAction) {
        return sendJson(response, 404, { ok: false, error: "service_manager_unavailable" });
      }
      try {
        const body = await readRequestBody(request);
        const payload = body ? JSON.parse(body) : {};
        const action = String(payload.action ?? "health").toLowerCase();
        const result = await control.serviceManager.handleAction(action);
        return sendJson(response, result.ok ? 200 : 400, result);
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: error.message });
      }
    }

    if (requestUrl.pathname === "/api/control/time") {
      if (request.method !== "POST") {
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }

      const bot = control.getBot?.();
      if (!bot) return sendJson(response, 409, { ok: false, error: "bot_not_ready" });
      if (typeof bot.chat !== "function") {
        return sendJson(response, 500, { ok: false, error: "chat_not_supported" });
      }

      try {
        const body = await readRequestBody(request);
        const payload = body ? JSON.parse(body) : {};
        const mode = String(payload.mode ?? payload.time ?? "").toLowerCase();
        if (mode !== "day" && mode !== "night") {
          return sendJson(response, 400, { ok: false, error: "invalid_time_mode" });
        }

        const command = mode === "day" ? "/time set day" : "/time set night";
        bot.chat(command);
        return sendJson(response, 200, {
          ok: true,
          mode,
          command,
          note: "requires server permission for /time"
        });
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: error.message });
      }
    }

    if (requestUrl.pathname === "/api/test/force-task") {
      if (!control.testControlEnabled) {
        return sendJson(response, 404, { ok: false, error: "test_control_disabled" });
      }
      if (request.method !== "POST" && request.method !== "DELETE") {
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }

      const controller = control.getController?.();
      if (!controller) return sendJson(response, 409, { ok: false, error: "controller_not_ready" });

      try {
        if (request.method === "DELETE") {
          return sendJson(response, 200, { ok: true, forcedTask: controller.clearForcedTask("api_delete") });
        }
        const body = await readRequestBody(request);
        const payload = body ? JSON.parse(body) : {};
        if (payload.taskType === null || payload.taskType === "") {
          return sendJson(response, 200, { ok: true, forcedTask: controller.clearForcedTask("api_clear") });
        }
        const forcedTask = controller.setForcedTask(payload.taskType, {
          ttlMs: payload.ttlMs,
          reason: payload.reason || "api scenario test",
          source: "dashboard_api"
        });
        return sendJson(response, 200, { ok: true, forcedTask });
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: error.message });
      }
    }

    if (requestUrl.pathname === "/api/test/tasks") {
      if (!control.testControlEnabled) {
        return sendJson(response, 404, { ok: false, error: "test_control_disabled" });
      }
      if (request.method !== "POST" && request.method !== "DELETE") {
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }

      const controller = control.getController?.();
      if (!controller) return sendJson(response, 409, { ok: false, error: "controller_not_ready" });

      try {
        if (request.method === "DELETE") {
          return sendJson(response, 200, { ok: true, event: controller.clearPriorityTasks("api_delete"), priorityTasks: controller.getPriorityTaskStatus() });
        }
        const body = await readRequestBody(request);
        const payload = body ? JSON.parse(body) : {};
        const task = controller.insertPriorityTask(payload.taskType, {
          priority: payload.priority,
          ttlMs: payload.ttlMs,
          reason: payload.reason || "api priority task",
          source: payload.source || "dashboard_api",
          replace: Boolean(payload.replace),
          metadata: payload.metadata
        });
        return sendJson(response, 200, { ok: true, task, priorityTasks: controller.getPriorityTaskStatus() });
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: error.message });
      }
    }

    if (requestUrl.pathname === "/api/test/pipeline") {
      if (!control.testControlEnabled) {
        return sendJson(response, 404, { ok: false, error: "test_control_disabled" });
      }
      if (request.method !== "POST" && request.method !== "DELETE") {
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }

      const controller = control.getController?.();
      if (!controller) return sendJson(response, 409, { ok: false, error: "controller_not_ready" });

      try {
        if (request.method === "DELETE") {
          return sendJson(response, 200, { ok: true, event: controller.clearTestTasks("api_delete"), testTasks: controller.getTestTaskStatus() });
        }
        const body = await readRequestBody(request);
        const payload = body ? JSON.parse(body) : {};
        const task = controller.insertTestTask(payload.taskType, {
          priority: payload.priority,
          ttlMs: payload.ttlMs,
          reason: payload.reason || "api test pipeline task",
          source: payload.source || "dashboard_api",
          replace: payload.replace !== false,
          metadata: payload.metadata
        });
        return sendJson(response, 200, { ok: true, task, testTasks: controller.getTestTaskStatus() });
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: error.message });
      }
    }

    if (requestUrl.pathname === "/api/test/reset-state") {
      if (!control.testControlEnabled) {
        return sendJson(response, 404, { ok: false, error: "test_control_disabled" });
      }
      if (request.method !== "POST") {
        return sendJson(response, 405, { ok: false, error: "method_not_allowed" });
      }

      const controller = control.getController?.();
      if (!controller) return sendJson(response, 409, { ok: false, error: "controller_not_ready" });

      try {
        const body = await readRequestBody(request);
        const payload = body ? JSON.parse(body) : {};
        return sendJson(response, 200, controller.resetRuntimeState(payload));
      } catch (error) {
        return sendJson(response, 400, { ok: false, error: error.message });
      }
    }

    const filePath = safeStaticPath(requestUrl.pathname);
    if (!filePath) {
      return send(response, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (requestUrl.pathname.startsWith("/api/")) {
          return sendJson(response, 404, { ok: false, error: "not_found" });
        }
        const fallbackPath = path.join(STATIC_ROOT, "index.html");
        if (requestUrl.pathname !== "/" && fs.existsSync(fallbackPath)) {
          return fs.readFile(fallbackPath, (fallbackError, fallbackContent) => {
            if (fallbackError) return send(response, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
            return send(response, 200, fallbackContent, { "content-type": MIME_TYPES[".html"] });
          });
        }
        return send(response, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
      }

      const extension = path.extname(filePath);
      return send(response, 200, content, {
        "content-type": MIME_TYPES[extension] ?? "application/octet-stream",
        "cache-control": "no-cache"
      });
    });
    return undefined;
  };
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function createDashboardServer(statusHub, config = {}, logger = console, control = {}) {
  const host = config.host ?? "127.0.0.1";
  const requestedPort = Number(config.port) || 3000;
  let activeServer = null;
  let activePort = null;

  return {
    async start() {
      if (activeServer) return this.url();

      for (let offset = 0; offset <= 10; offset++) {
        const candidatePort = requestedPort + offset;
        const server = http.createServer(createRequestHandler(statusHub, {
          ...control,
          dashboardUrl: () => this.url()
        }));
        try {
          await listen(server, host, candidatePort);
          activeServer = server;
          activePort = candidatePort;
          logger.info(`dashboard listening on ${this.url()}`);
          return this.url();
        } catch (error) {
          server.close();
          if (error.code !== "EADDRINUSE" || offset === 10) throw error;
          logger.warn(`dashboard port ${candidatePort} is busy; trying ${candidatePort + 1}`);
        }
      }
      return null;
    },

    stop() {
      if (!activeServer) return Promise.resolve(false);
      const server = activeServer;
      activeServer = null;
      activePort = null;
      return new Promise((resolve) => server.close(() => resolve(true)));
    },

    url() {
      if (!activePort) return null;
      const displayHost = host === "0.0.0.0" ? "localhost" : host;
      return `http://${displayHost}:${activePort}`;
    }
  };
}

module.exports = {
  createDashboardServer,
  createRequestHandler
};