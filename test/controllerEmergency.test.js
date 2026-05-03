const assert = require("node:assert/strict");
const test = require("node:test");
const { Vec3 } = require("vec3");
const { SurvivalController } = require("../src/survival/SurvivalController");

test("unknown damage response repositions to a nearby safe stand position", async () => {
  const controller = Object.create(SurvivalController.prototype);
  let target = null;
  controller.bot = {
    entity: {
      position: new Vec3(0, 64, 0)
    }
  };
  controller.config = {
    survival: {
      actionTimeoutMs: 25000
    }
  };
  controller.logger = {
    warn: () => {}
  };
  controller.isSafeStandPosition = (position) => position.x === 4 && position.y === 64 && position.z === 0;
  controller.findNearbyDamagingBlock = () => null;
  controller.gotoNear = async (x, y, z, range) => {
    target = { x, y, z, range };
    return true;
  };

  await controller.respondToUnknownDamage(20, 16);

  assert.deepEqual(target, { x: 4, y: 64, z: 0, range: 1 });
});

test("remembered starter shelter is not usable when the bot is far away", () => {
  const controller = Object.create(SurvivalController.prototype);
  controller.progressState = {
    hasStarterShelter: true,
    starterShelterPosition: { x: 0, y: 64, z: 0 }
  };
  controller.bot = {
    entity: {
      position: new Vec3(32, 64, 0)
    },
    blockAt: () => {
      throw new Error("far shelter structure should not be inspected");
    }
  };

  const status = controller.getStarterShelterStatus(controller.bot.entity.position);

  assert.equal(status.isNear, false);
  assert.equal(status.usable, false);
});