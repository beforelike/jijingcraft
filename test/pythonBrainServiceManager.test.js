const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const { PythonBrainServiceManager, defaultPythonCommand, isHealthCheckAccessLog, splitArgs } = require("../src/services/pythonBrainServiceManager");

test("splitArgs keeps the module startup command stable", () => {
  assert.deepEqual(splitArgs("-m python_brain.main"), ["-m", "python_brain.main"]);
});

test("service manager prefers project virtualenv Python by default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brain-venv-"));
  const pythonPath = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(pythonPath, "");

  assert.equal(defaultPythonCommand(root), pythonPath);
});

test("service manager reports reachable Python Brain health", async () => {
  const manager = new PythonBrainServiceManager({ enabled: true, url: "http://brain.test" }, console, {
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", url })
    })
  });

  const status = await manager.getStatus({ connection: { state: "connected", username: "Bot" }, dashboardUrl: "http://127.0.0.1:3000" });

  assert.equal(status.dashboard.status, "running");
  assert.equal(status.minecraftBot.status, "connected");
  assert.equal(status.pythonBrain.status, "reachable");
  assert.equal(status.pythonBrain.health.ok, true);
});

test("service manager can start and stop a managed child process", async () => {
  let spawned = null;
  const fakeChild = new EventEmitter();
  fakeChild.stdout = new PassThrough();
  fakeChild.stderr = new PassThrough();
  fakeChild.pid = 1234;
  fakeChild.kill = () => fakeChild.emit("exit", 0, null);
  const manager = new PythonBrainServiceManager({ enabled: true, command: "python", args: "-m python_brain.main" }, console, {
    fetchImpl: async () => { throw new Error("not reachable"); },
    spawnImpl: (command, args, options) => {
      spawned = { command, args, shell: options.shell };
      return fakeChild;
    }
  });

  const started = await manager.start();
  const stopped = await manager.stop();

  assert.equal(started.ok, true);
  assert.equal(started.pid, 1234);
  assert.deepEqual(spawned, { command: "python", args: ["-m", "python_brain.main"], shell: false });
  assert.equal(stopped.status, "stopping");
});

test("service manager can start the service while planner integration is disabled", async () => {
  const fakeChild = new EventEmitter();
  fakeChild.stdout = new PassThrough();
  fakeChild.stderr = new PassThrough();
  fakeChild.pid = 4321;
  fakeChild.kill = () => fakeChild.emit("exit", 0, null);
  const manager = new PythonBrainServiceManager({ enabled: false, serviceEnabled: true, command: "python", args: "-m python_brain.main" }, console, {
    fetchImpl: async () => { throw new Error("not reachable"); },
    spawnImpl: () => fakeChild
  });

  const started = await manager.start();
  const status = await manager.getStatus({ connection: { state: "connected" } });

  assert.equal(started.ok, true);
  assert.equal(started.pid, 4321);
  assert.equal(status.pythonBrain.enabled, true);
  assert.equal(status.pythonBrain.plannerEnabled, false);
});

test("service manager can explicitly disable web service control", async () => {
  const manager = new PythonBrainServiceManager({ enabled: true, serviceEnabled: false }, console, {});

  const started = await manager.start();

  assert.equal(started.ok, false);
  assert.equal(started.error, "python_brain_service_disabled");
});

test("service manager filters repeated Python Brain health access logs", () => {
  const manager = new PythonBrainServiceManager({ enabled: true }, console, {});

  manager.appendLog("info", 'INFO: 127.0.0.1:5491 - "GET /health HTTP/1.1" 200 OK');
  manager.appendLog("info", "Python Smart Brain started");

  assert.equal(isHealthCheckAccessLog('INFO: 127.0.0.1:5491 - "GET /health HTTP/1.1" 200 OK'), true);
  assert.equal(manager.logs.length, 1);
  assert.equal(manager.logs[0].message, "Python Smart Brain started");
});