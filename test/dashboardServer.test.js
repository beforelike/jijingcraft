const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const test = require("node:test");
const { createRequestHandler } = require("../src/dashboard/server");

function invoke(handler, options = {}) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(options.body ? [options.body] : []);
    request.url = options.url ?? "/api/status";
    request.method = options.method ?? "GET";
    request.headers = {};
    const response = {
      statusCode: null,
      headers: null,
      body: "",
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(body = "") {
        this.body += body;
        resolve(this);
      }
    };

    Promise.resolve(handler(request, response)).catch(reject);
  });
}

test("force task API stays unavailable unless test control is enabled", async () => {
  const handler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, { testControlEnabled: false });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/test/force-task",
    body: JSON.stringify({ taskType: "hunt_food" })
  });

  assert.equal(response.statusCode, 404);
  assert.equal(JSON.parse(response.body).error, "test_control_disabled");
});

test("force task API switches the active controller task when enabled", async () => {
  let forced = null;
  const controller = {
    setForcedTask(taskType, options) {
      forced = { taskType, options };
      return { taskType, reason: options.reason, source: options.source };
    }
  };
  const handler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, {
    testControlEnabled: true,
    getController: () => controller
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/test/force-task",
    body: JSON.stringify({ taskType: "hunt_food", ttlMs: 45000, reason: "berry scenario" })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).forcedTask.taskType, "hunt_food");
  assert.equal(forced.taskType, "hunt_food");
  assert.equal(forced.options.ttlMs, 45000);
  assert.equal(forced.options.reason, "berry scenario");
});

test("priority task API inserts high priority tasks when test control is enabled", async () => {
  let inserted = null;
  const controller = {
    insertPriorityTask(taskType, options) {
      inserted = { taskType, options };
      return { type: taskType, priority: options.priority, source: options.source };
    },
    getPriorityTaskStatus() {
      return { active: true, pendingTasks: [{ type: inserted.taskType, priority: inserted.options.priority }] };
    }
  };
  const handler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, {
    testControlEnabled: true,
    getController: () => controller
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/test/tasks",
    body: JSON.stringify({ taskType: "escape_hazard", priority: 100, ttlMs: 30000, reason: "berry escape" })
  });

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.task.type, "escape_hazard");
  assert.equal(inserted.options.priority, 100);
  assert.equal(inserted.options.reason, "berry escape");
});

test("test pipeline API inserts isolated scenario tasks when test control is enabled", async () => {
  let inserted = null;
  const controller = {
    insertTestTask(taskType, options) {
      inserted = { taskType, options };
      return { type: taskType, priority: options.priority, source: options.source };
    },
    getTestTaskStatus() {
      return { active: true, pendingTasks: [{ type: inserted.taskType, priority: inserted.options.priority }] };
    }
  };
  const handler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, {
    testControlEnabled: true,
    getController: () => controller
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/test/pipeline",
    body: JSON.stringify({ taskType: "escape_hazard", priority: 100, ttlMs: 30000, reason: "berry escape", replace: true })
  });

  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 200);
  assert.equal(body.task.type, "escape_hazard");
  assert.equal(body.testTasks.pendingTasks[0].type, "escape_hazard");
  assert.equal(inserted.options.replace, true);
  assert.equal(inserted.options.reason, "berry escape");
});

test("reset state API delegates to controller runtime reset", async () => {
  let payload = null;
  const controller = {
    resetRuntimeState(options) {
      payload = options;
      return { ok: true, resetMemory: options.resetMemory };
    }
  };
  const handler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, {
    testControlEnabled: true,
    getController: () => controller
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/test/reset-state",
    body: JSON.stringify({ resetMemory: true, pauseMs: 4000 })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).resetMemory, true);
  assert.equal(payload.pauseMs, 4000);
});

test("time control API sends day/night commands to bot chat", async () => {
  const commands = [];
  const bot = {
    chat(command) {
      commands.push(command);
    }
  };
  const handler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, {
    getBot: () => bot
  });

  const dayResponse = await invoke(handler, {
    method: "POST",
    url: "/api/control/time",
    body: JSON.stringify({ mode: "day" })
  });
  const nightResponse = await invoke(handler, {
    method: "POST",
    url: "/api/control/time",
    body: JSON.stringify({ mode: "night" })
  });

  assert.equal(dayResponse.statusCode, 200);
  assert.equal(nightResponse.statusCode, 200);
  assert.deepEqual(commands, ["/time set day", "/time set night"]);
});

test("time control API validates mode and bot availability", async () => {
  const noBotHandler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, {
    getBot: () => null
  });
  const noBotResponse = await invoke(noBotHandler, {
    method: "POST",
    url: "/api/control/time",
    body: JSON.stringify({ mode: "day" })
  });

  assert.equal(noBotResponse.statusCode, 409);
  assert.equal(JSON.parse(noBotResponse.body).error, "bot_not_ready");

  const invalidModeHandler = createRequestHandler({ getSnapshot: () => ({ ok: true }) }, {
    getBot: () => ({ chat() {} })
  });
  const invalidModeResponse = await invoke(invalidModeHandler, {
    method: "POST",
    url: "/api/control/time",
    body: JSON.stringify({ mode: "sunrise" })
  });

  assert.equal(invalidModeResponse.statusCode, 400);
  assert.equal(JSON.parse(invalidModeResponse.body).error, "invalid_time_mode");
});

test("service status API exposes dashboard bot and Python Brain state", async () => {
  const serviceManager = {
    async getStatus(extra) {
      return {
        dashboard: { status: "running", url: extra.dashboardUrl },
        minecraftBot: { status: extra.connection.state, username: extra.connection.username },
        pythonBrain: { enabled: true, status: "reachable", health: { ok: true }, logs: [] }
      };
    }
  };
  const handler = createRequestHandler({
    getSnapshot: () => ({ connection: { state: "connected", username: "TestBot" } })
  }, {
    serviceManager,
    dashboardUrl: () => "http://127.0.0.1:3000"
  });

  const response = await invoke(handler, { method: "GET", url: "/api/services" });
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.dashboard.status, "running");
  assert.equal(body.minecraftBot.status, "connected");
  assert.equal(body.pythonBrain.health.ok, true);
});

test("Python Brain service API delegates control actions", async () => {
  let actionSeen = null;
  const handler = createRequestHandler({ getSnapshot: () => ({ connection: { state: "connected" } }) }, {
    serviceManager: {
      async handleAction(action) {
        actionSeen = action;
        return { ok: true, status: "started" };
      }
    }
  });

  const response = await invoke(handler, {
    method: "POST",
    url: "/api/services/python-brain",
    body: JSON.stringify({ action: "start" })
  });

  assert.equal(response.statusCode, 200);
  assert.equal(actionSeen, "start");
  assert.equal(JSON.parse(response.body).status, "started");
});

test("dashboard static resources include the Agent mind map monitor", async () => {
  const handler = createRequestHandler({ getSnapshot: () => ({ ok: true }) });

  const page = await invoke(handler, { method: "GET", url: "/" });
  const script = await invoke(handler, { method: "GET", url: "/dashboard.js" });
  const stylesheet = await invoke(handler, { method: "GET", url: "/dashboard.css" });

  assert.equal(page.statusCode, 200);
  assert.match(page.body, /服务管理/);
  assert.match(page.body, /data-python-brain-action="start"/);
  assert.match(page.body, /Agent 思维导图/);
  assert.match(page.body, /agentMindMap/);
  assert.equal(script.statusCode, 200);
  assert.match(script.body, /renderAgentMindMap/);
  assert.match(script.body, /general_agent/);
  assert.match(script.body, /具体传递/);
  assert.match(script.body, /ruleDecision\.type/);
  assert.match(script.body, /constructorArgs/);
  assert.match(script.body, /队列 -> Controller -> 反馈/);
  assert.match(script.body, /renderServices/);
  assert.match(script.body, /\/api\/services\/python-brain/);
  assert.equal(stylesheet.statusCode, 200);
  assert.match(stylesheet.body, /service-grid/);
  assert.match(stylesheet.body, /service-state/);
  assert.match(stylesheet.body, /agent-map-flow/);
  assert.match(stylesheet.body, /agent-map-node\.edge/);
});