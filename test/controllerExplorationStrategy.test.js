const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { SurvivalController } = require("../src/survival/SurvivalController");

function createController(overrides = {}) {
  const controller = Object.create(SurvivalController.prototype);
  controller.config = {
    memory: { enabled: false },
    survival: {
      actionTimeoutMs: 1000,
      criticalHealth: 8,
      lowFood: 14
    }
  };
  controller.bot = {
    health: 20,
    food: 20,
    oxygenLevel: 20,
    entity: { position: new Vec3(0, 64, 0), yaw: 0, pitch: 0 },
    entities: {},
    lookAt: async () => {},
    setControlState: () => {},
    clearControlStates: () => {}
  };
  controller.logger = { info() {}, warn() {}, debug() {}, error() {} };
  controller.memory = { knownBlocks: {}, learning: { events: [], avoidedPositions: [], policyStats: {} } };
  controller.taskFeedback = { recentFailures: [], blockedTasks: {}, lastEvent: null };
  controller.explorationHistory = [];
  controller.behaviorLog = [];
  controller._exploreUnreachableTargets = new Map();
  controller._exploreUnreachableDecayMs = 90000;
  controller._exploreUnreachableMax = 24;
  controller.emergencyBusy = false;
  controller.actionInterruptedUntil = 0;
  controller.taskTrace = null;
  controller.currentDecisionType = "explore";
  controller.persistMemory = () => false;
  controller.wait = async () => {};
  controller.resetMotion = () => {};
  controller.isSafeStandPosition = (position) => position.y === 64;
  controller.findNearbyDamagingBlock = () => null;
  controller.isLearnedAvoidPosition = () => false;
  controller.isBodyInWater = () => false;
  controller.isNight = () => false;
  controller.isTaskFeedbackBlocked = () => false;
  controller.selectHuntFoodTarget = () => ({ animal: null });
  controller.cloneValidPosition = SurvivalController.prototype.cloneValidPosition.bind(controller);
  Object.assign(controller, overrides);
  return controller;
}

test("exploration target selection avoids recently unreachable targets", () => {
  const controller = createController();
  const origin = new Vec3(0, 64, 0);

  controller.rememberExplorationUnreachable(new Vec3(10, 64, 0), {
    reason: "arrived_too_far_10",
    label: "explore"
  });

  const target = controller.findSafeExplorationTarget(origin, {
    distances: [10],
    preferredDistance: 10,
    avoidRecent: false,
    avoidUnreachable: true,
    unreachableRadius: 3
  });

  assert.ok(target);
  assert.notDeepEqual(target, new Vec3(10, 64, 0));
  assert.equal(controller.isExplorationTargetUnreachable(new Vec3(10, 64, 0), 3), true);
});

test("explore marks an unreachable target and immediately tries local reposition", async () => {
  let localStepCalled = false;
  const controller = createController({
    gotoNear: async () => false,
    attemptLocalExplorationStep: async () => {
      localStepCalled = true;
      controller.bot.entity.position = new Vec3(2, 64, 0);
      return true;
    }
  });

  const moved = await controller.explore({ reason: "unit test exploration" });
  const status = controller.getExplorationStrategyStatus();

  assert.equal(moved, true);
  assert.equal(localStepCalled, true);
  assert.equal(status.unreachableTargets.length, 1);
  assert.equal(status.unreachableTargets[0].reason, "target_unreachable_no_movement");
  assert.equal(controller.behaviorLog.some((event) => event.kind === "strategy_switch"), true);
});

test("local reposition does not accept pathfinder success without real movement", async () => {
  const control = {};
  const controller = createController({
    gotoNear: async () => true,
    resetMotion: () => {
      control.forward = false;
      control.jump = false;
      control.sprint = false;
    }
  });
  controller.bot.setControlState = (name, value) => {
    control[name] = value;
  };
  controller.wait = async () => {
    if (control.forward) controller.bot.entity.position = new Vec3(1, 64, 0);
  };

  const moved = await controller.attemptLocalExplorationStep({ reason: "pathfinder_false_positive" });

  assert.equal(moved, true);
  assert.equal(controller.bot.entity.position.x, 1);
});