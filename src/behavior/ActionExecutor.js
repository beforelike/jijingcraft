/**
 * Action Executor — interprets compiled action JSON from Python
 * and executes via Mineflayer with integrated monitoring/diagnosis.
 *
 * Each compiled action from Python has:
 *   { actionId, type, params, monitor, diagnose }
 *
 * The executor:
 *   1. Looks up the mineflayer handler for the action type
 *   2. Creates an ActionMonitor with the compiled monitor spec
 *   3. Starts a high-frequency progress loop
 *   4. On stall → runs ActionDiagnoser → produces FailureReport
 *   5. Returns { status, result, failureReport } to the scheduler
 */

const { ActionMonitor, ActionDiagnoser } = require("./PriorityScheduler");

const { Vec3 } = require("vec3");

// ── Action Handlers ──────────────────────────────────────────────────────────

/**
 * Each handler: async (bot, params, context) => { started: bool }
 * The monitor loop runs independently and checks actual game state.
 * Handlers just initiate the action; the monitor verifies progress.
 */
const ACTION_HANDLERS = {
  async walk(bot, params) {
    const { direction, steps = 1, speed = 1.0 } = params;
    const dirVec = DIRECTION_VECTORS[direction];
    if (!dirVec) return { started: false, error: `unknown_direction:${direction}` };

    const targetPos = bot.entity.position.offset(dirVec.x * steps, dirVec.y * steps, dirVec.z * steps);
    bot.pathfinder.setMovements(new (require("mineflayer-pathfinder").Movements)(bot));
    const { goals } = require("mineflayer-pathfinder");
    bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1));
    return { started: true, targetPosition: { x: targetPos.x, y: targetPos.y, z: targetPos.z } };
  },

  async jump(bot, params) {
    bot.setControlState("jump", true);
    setTimeout(() => bot.setControlState("jump", false), 300);
    if (params.direction) {
      const dirVec = DIRECTION_VECTORS[params.direction];
      if (dirVec) {
        const motion = new Vec3(dirVec.x * 0.3, 0, dirVec.z * 0.3);
        bot.entity.velocity = bot.entity.velocity.add(motion);
      }
    }
    return { started: true };
  },

  async swim(bot, params) {
    const { direction, distance = 1.0 } = params;
    const dirVec = DIRECTION_VECTORS[direction];
    if (!dirVec) return { started: false, error: `unknown_direction:${direction}` };
    bot.setControlState("jump", true);
    bot.setControlState("forward", true);
    const target = bot.entity.position.offset(dirVec.x * distance, dirVec.y * distance, dirVec.z * distance);
    return { started: true, targetPosition: { x: target.x, y: target.y, z: target.z } };
  },

  async sneak_to(bot, params) {
    const { position } = params;
    if (!position) return { started: false, error: "missing_position" };
    bot.setControlState("sneak", true);
    bot.pathfinder.setMovements(new (require("mineflayer-pathfinder").Movements)(bot));
    const { goals } = require("mineflayer-pathfinder");
    bot.pathfinder.setGoal(new goals.GoalNear(position.x, position.y, position.z, 1));
    return { started: true, targetPosition: position };
  },

  async mine(bot, params) {
    const { block_type, position, tool } = params;
    if (!position) return { started: false, error: "missing_position" };
    const block = bot.blockAt(new Vec3(position.x, position.y, position.z));
    if (!block) return { started: false, error: "block_not_found" };
    if (tool) {
      try {
        await bot.equip(tool, "hand");
      } catch { /* continue anyway */ }
    }
    try {
      await bot.dig(block, { forceLook: true });
      return { started: true, targetBlock: { type: block.name, position } };
    } catch (err) {
      return { started: false, error: `dig_error:${err.message}` };
    }
  },

  async place(bot, params) {
    const { block_type, position, face = "top" } = params;
    if (!position) return { started: false, error: "missing_position" };
    const refBlock = bot.blockAt(new Vec3(position.x, position.y, position.z));
    if (!refBlock) return { started: false, error: "reference_block_not_found" };

    const itemByName = bot.inventory.items().find((item) => item.name === block_type);
    if (!itemByName) return { started: false, error: "block_not_in_inventory" };

    await bot.equip(itemByName, "hand");
    try {
      await bot.placeBlock(refBlock, new Vec3(0, 0, 0));
      return { started: true, placedBlock: block_type, position };
    } catch (err) {
      return { started: false, error: `place_error:${err.message}` };
    }
  },

  async eat(bot, params) {
    const { food_item } = params;
    const foodItem = bot.inventory.items().find(
      (item) => item.name === food_item || item.name.includes(food_item)
    );
    if (!foodItem) return { started: false, error: "food_not_found" };
    try {
      await bot.equip(foodItem, "hand");
      await bot.consume();
      return { started: true, foodItem: foodItem.name };
    } catch (err) {
      return { started: false, error: `eat_error:${err.message}` };
    }
  },

  async use_item(bot, params) {
    const { item, on_block } = params;
    const useItem = bot.inventory.items().find((i) => i.name === item);
    if (!useItem) return { started: false, error: "item_not_found" };
    await bot.equip(useItem, "hand");
    if (on_block) {
      const block = bot.blockAt(new Vec3(on_block.x, on_block.y, on_block.z));
      if (block) {
        try {
          await bot.activateBlock(block);
          return { started: true };
        } catch (err) {
          return { started: false, error: `activate_error:${err.message}` };
        }
      }
    }
    try {
      await bot.activateItem();
      return { started: true };
    } catch (err) {
      return { started: false, error: `activate_error:${err.message}` };
    }
  },

  async collect(bot, params) {
    const { item_type, count = 1 } = params;
    // Trigger collection by moving toward nearest matching drop
    const drops = Object.values(bot.entities).filter(
      (e) => e.name === "item" || e.objectType === "Item"
    );
    if (drops.length === 0) return { started: false, error: "no_drops_nearby" };

    // Move to nearest drop
    const nearest = drops.reduce((closest, drop) => {
      const dist = bot.entity.position.distanceTo(drop.position);
      return dist < (closest?.dist ?? Infinity) ? { entity: drop, dist } : closest;
    }, null);

    if (nearest) {
      bot.pathfinder.setMovements(new (require("mineflayer-pathfinder").Movements)(bot));
      const { goals } = require("mineflayer-pathfinder");
      bot.pathfinder.setGoal(new goals.GoalNear(
        nearest.entity.position.x, nearest.entity.position.y, nearest.entity.position.z, 1
      ));
    }
    return { started: true, itemType: item_type, targetCount: count };
  },

  async pickup(bot, params) {
    const { radius = 3 } = params;
    const drops = Object.values(bot.entities).filter(
      (e) => e.name === "item" || e.objectType === "Item"
    );
    for (const drop of drops) {
      const dist = bot.entity.position.distanceTo(drop.position);
      if (dist <= radius) {
        try {
          await bot.collectBlock.collect(drop);
        } catch { /* continue */ }
      }
    }
    return { started: true };
  },

  async attack(bot, params) {
    const { entity } = params;
    if (!entity?.id) return { started: false, error: "no_entity_id" };
    const target = bot.entities[entity.id];
    if (!target) return { started: false, error: "entity_not_found" };
    bot.pvp.attack(target);
    return { started: true, entityId: entity.id };
  },

  async defend(bot, params) {
    const { timeout_ms = 5000 } = params;
    const hostiles = Object.values(bot.entities).filter(
      (e) => e.type === "hostile" && bot.entity.position.distanceTo(e.position) < 10
    );
    if (hostiles.length > 0) {
      bot.pvp.attack(hostiles[0]);
    }
    // Will auto-stop after timeout
    setTimeout(() => { try { bot.pvp.stop(); } catch { /* ok */ } }, timeout_ms);
    return { started: true, hostileCount: hostiles.length };
  },

  async flee(bot, params) {
    const { from_entity, distance = 20 } = params;
    if (!from_entity?.id) return { started: false, error: "no_entity_to_flee" };
    const threat = bot.entities[from_entity.id];
    if (!threat) return { started: false, error: "threat_not_found" };

    // Run opposite direction
    const threatPos = threat.position;
    const myPos = bot.entity.position;
    const fleeVec = myPos.subtract(threatPos).normalize();
    const target = myPos.add(fleeVec.scaled(distance));

    bot.pathfinder.setMovements(new (require("mineflayer-pathfinder").Movements)(bot));
    const { goals } = require("mineflayer-pathfinder");
    bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 2));
    return { started: true, fromEntity: from_entity.name };
  },

  async craft(bot, params) {
    const { item_type, count = 1 } = params;
    const mcData = require("minecraft-data")(bot.version);
    const recipes = bot.recipesAll(mcData.recipesByName?.[item_type]?.id ?? null, null);
    if (!recipes?.length) return { started: false, error: "no_recipe_found" };
    try {
      await bot.craft(recipes[0], count, null);
      return { started: true, itemType: item_type, targetCount: count };
    } catch (err) {
      return { started: false, error: `craft_error:${err.message}` };
    }
  },

  async smelt(bot, params) {
    const { input_item, fuel = "coal", count = 1 } = params;
    const furnace = bot.findBlock({
      matching: (block) => block.name === "furnace",
      maxDistance: 64,
      count: 1,
    })?.[0];
    if (!furnace) return { started: false, error: "no_furnace_found" };
    // Smelting is handled by the task layer (open furnace, insert items, wait)
    return { started: true, itemType: input_item, count };
  },

  async place_row(bot, params) {
    const { block_type, start, direction, count = 1 } = params;
    const dirVec = DIRECTION_VECTORS[direction];
    if (!dirVec || !start) return { started: false, error: "invalid_params" };
    let pos = new Vec3(start.x, start.y, start.z);
    for (let i = 0; i < count; i++) {
      const refBlock = bot.blockAt(pos.offset(0, -1, 0));
      if (!refBlock) break;
      const item = bot.inventory.items().find((it) => it.name === block_type);
      if (!item) return { started: i > 0, error: "out_of_blocks" };
      await bot.equip(item, "hand");
      try {
        await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
      } catch { break; }
      pos = pos.offset(dirVec.x, dirVec.y, dirVec.z);
    }
    return { started: true };
  },

  async place_wall(bot, params) {
    // Delegate to place_row iteratively — same logic but vertical
    return ACTION_HANDLERS.place_row(bot, params);
  },

  async fill_area(bot, params) {
    const { block_type, corner1, corner2 } = params;
    if (!corner1 || !corner2) return { started: false, error: "missing_corners" };
    const minX = Math.min(corner1.x, corner2.x);
    const maxX = Math.max(corner1.x, corner2.x);
    const minZ = Math.min(corner1.z, corner2.z);
    const maxZ = Math.max(corner1.z, corner2.z);
    const y = corner1.y;

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const item = bot.inventory.items().find((it) => it.name === block_type);
        if (!item) return { started: x > minX, error: "out_of_blocks" };
        const refBlock = bot.blockAt(new Vec3(x, y - 1, z));
        if (!refBlock) continue;
        await bot.equip(item, "hand");
        try { await bot.placeBlock(refBlock, new Vec3(0, 1, 0)); } catch { /* continue */ }
      }
    }
    return { started: true };
  },

  async scan_blocks(bot, params) {
    const { radius = 16, block_types = [] } = params;
    const results = [];
    if (block_types.length > 0) {
      for (const blockType of block_types) {
        const blocks = bot.findBlocks({
          matching: (block) => block.name === blockType,
          maxDistance: radius,
          count: 32,
        });
        for (const pos of blocks) {
          results.push({ type: blockType, position: { x: pos.x, y: pos.y, z: pos.z } });
        }
      }
    }
    return { started: true, foundCount: results.length, results };
  },

  async scan_entities(bot, params) {
    const { radius = 32, types = [], names = [] } = params;
    const entities = Object.values(bot.entities).filter((e) => {
      const dist = bot.entity.position.distanceTo(e.position);
      if (dist > radius) return false;
      if (types.length > 0 && !types.includes(e.type) && !types.includes(e.kind)) return false;
      if (names.length > 0 && !names.includes(e.name)) return false;
      return true;
    });
    return {
      started: true,
      entityCount: entities.length,
      entities: entities.map((e) => ({
        name: e.name, id: e.id, type: e.type,
        position: { x: e.position.x, y: e.position.y, z: e.position.z },
        distance: bot.entity.position.distanceTo(e.position),
      })),
    };
  },

  async check_inventory(bot, params) {
    const { items = [] } = params;
    const inventory = {};
    for (const item of bot.inventory.items()) {
      inventory[item.name] = (inventory[item.name] ?? 0) + item.count;
    }
    if (items.length > 0) {
      const filtered = {};
      for (const name of items) {
        filtered[name] = inventory[name] ?? 0;
      }
      return { started: true, inventory: filtered };
    }
    return { started: true, inventory };
  },

  async wait(bot, params) {
    const { seconds = 1 } = params;
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    return { started: true, waited: seconds };
  },

  async equip(bot, params) {
    const { item_type } = params;
    const item = bot.inventory.items().find((i) => i.name === item_type || i.name.includes(item_type));
    if (!item) return { started: false, error: "item_not_found" };
    await bot.equip(item, "hand");
    return { started: true, equipped: item.name };
  },

  async unequip(bot, _params) {
    await bot.unequip("hand");
    return { started: true };
  },

  async drop(bot, params) {
    const { item_type, count = 1 } = params;
    const items = bot.inventory.items().filter((i) => i.name === item_type);
    if (!items.length) return { started: false, error: "item_not_found" };
    let dropped = 0;
    for (const item of items) {
      const toDrop = Math.min(item.count, count - dropped);
      try { await bot.toss(item.type, null, toDrop); dropped += toDrop; } catch { break; }
      if (dropped >= count) break;
    }
    return { started: true, dropped };
  },
};

const DIRECTION_VECTORS = {
  north: { x: 0, y: 0, z: -1 },
  south: { x: 0, y: 0, z: 1 },
  east: { x: 1, y: 0, z: 0 },
  west: { x: -1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  down: { x: 0, y: -1, z: 0 },
};

// ── Metric Readers ───────────────────────────────────────────────────────────

/**
 * Read current metric value for a given action type.
 * Called by the monitor loop to check progress.
 */
function readMetric(bot, action, metric) {
  switch (metric) {
    case "position_delta": {
      if (!action._startPos) action._startPos = bot.entity.position.clone();
      return bot.entity.position.distanceTo(action._startPos);
    }
    case "block_breaking": {
      // Track via bot.digging progress (approximate by distance to block)
      return bot.targetDigBlock ? 0.5 : 0; // binary: digging or not
    }
    case "block_placed": {
      return action._blocksPlaced ?? 0;
    }
    case "inventory_count": {
      const itemType = action.params?.item_type ?? action.params?.itemType;
      if (!itemType) return bot.inventory.items().length;
      return bot.inventory.items()
        .filter((i) => i.name === itemType || i.name.includes(itemType))
        .reduce((sum, i) => sum + i.count, 0);
    }
    case "entity_health": {
      const entityId = action.params?.entity?.id ?? action._entityId;
      const entity = bot.entities[entityId];
      return entity ? (entity.health ?? entity.metadata?.find((m) => m.health)?.health ?? 20) : 0;
    }
    case "bot_health":
      return bot.health ?? 20;
    case "bot_food":
      return bot.food ?? 20;
    case "entity_proximity": {
      const entityId = action.params?.from_entity?.id ?? action._entityId;
      const entity = bot.entities[entityId];
      if (!entity) return Infinity;
      return bot.entity.position.distanceTo(entity.position);
    }
    case "item_equipped": {
      const expected = action.params?.item_type ?? action.params?.itemType;
      const held = bot.heldItem;
      if (!held) return expected ? 0 : 1;
      return (expected && (held.name === expected || held.name.includes(expected))) ? 1 : 0;
    }
    case "time_elapsed":
      return (Date.now() - (action._startTime ?? Date.now())) / 1000;
    default:
      return 0;
  }
}

// ── Executor ─────────────────────────────────────────────────────────────────

class ActionExecutor {
  constructor(bot, options = {}) {
    this.bot = bot;
    this.options = options;
    this.handlers = { ...ACTION_HANDLERS, ...(options.handlers ?? {}) };
    this._runningMonitors = new Map();
  }

  /**
   * Execute a compiled action with monitoring.
   *
   * @param {object} compiledAction — from Python ActionCompiler
   * @returns {Promise<{status: string, result: object, failureReport: object|null}>}
   */
  async execute(compiledAction) {
    const { actionId, type, params, monitor: monitorSpec, diagnose: diagnoseSpec } = compiledAction;
    const handler = this.handlers[type];
    if (!handler) return { status: "failed", error: `unknown_action:${type}` };

    // Create monitor
    const monitor = new ActionMonitor(monitorSpec ?? {});
    const diagnoser = new ActionDiagnoser(diagnoseSpec ?? [], this.bot);

    // Initiate action
    compiledAction._startTime = Date.now();
    compiledAction._blocksPlaced = 0;
    compiledAction._startPos = this.bot.entity?.position?.clone() ?? null;

    let initResult;
    try {
      initResult = await handler(this.bot, params, compiledAction);
    } catch (err) {
      return {
        status: "failed",
        result: { started: false, error: err.message },
        failureReport: {
          reason: "action_crash",
          detail: `${type}: ${err.message}`,
          suggestion: "skip_or_retry",
          context: { actionType: type, params },
        },
      };
    }

    if (!initResult.started) {
      return {
        status: "aborted",
        result: initResult,
        failureReport: {
          reason: initResult.error ?? "action_refused",
          detail: `${type} could not start: ${initResult.error ?? "unknown"}`,
          suggestion: "check_prerequisites",
          context: { actionType: type, params, error: initResult.error },
        },
      };
    }

    // Monitor loop
    const startValue = readMetric(this.bot, compiledAction, monitor.metric);
    monitor.start(startValue);

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        try {
          const currentValue = readMetric(this.bot, compiledAction, monitor.metric);
          const result = monitor.tick(currentValue);

          // Store for scheduler inspection
          compiledAction._monitorResult = result;

          if (monitor.isComplete()) {
            clearInterval(checkInterval);
            this._stopAction(type);
            resolve({
              status: "completed",
              result: { ...initResult, monitorReport: monitor.getReport() },
              failureReport: null,
            });
          } else if (result.stalled && !compiledAction._diagnoseRan) {
            compiledAction._diagnoseRan = true;
            // Stall detected — but don't immediately fail
            // Let the monitor run a bit more, then diagnose
            setTimeout(() => {
              const stillStalled = monitor.tick(readMetric(this.bot, compiledAction, monitor.metric));
              if (stillStalled.stalled) {
                clearInterval(checkInterval);
                this._stopAction(type);
                const failureReport = diagnoser.diagnose(compiledAction, {
                  monitorReport: monitor.getReport(),
                });
                resolve({
                  status: "failed",
                  result: { ...initResult, monitorReport: monitor.getReport() },
                  failureReport,
                });
              }
            }, 500);
          }
        } catch (err) {
          clearInterval(checkInterval);
          this._stopAction(type);
          resolve({
            status: "failed",
            result: { error: err.message },
            failureReport: {
              reason: "monitor_crash",
              detail: `Monitor loop crashed: ${err.message}`,
              suggestion: "skip_action",
              context: { actionType: type },
            },
          });
        }
      }, monitor.checkIntervalMs);

      // Safety timeout — prevent infinite monitoring
      const maxDuration = 60000; // 60 seconds max per action
      setTimeout(() => {
        if (checkInterval) {
          clearInterval(checkInterval);
          this._stopAction(type);
          resolve({
            status: "failed",
            result: { ...initResult, monitorReport: monitor.getReport() },
            failureReport: {
              reason: "action_timeout",
              detail: `${type} exceeded max duration (60s)`,
              suggestion: "split_into_smaller_actions",
              context: { actionType: type, elapsedMs: monitor.getReport().elapsedMs },
            },
          });
        }
      }, maxDuration);
    });
  }

  _stopAction(type) {
    // Stop pathfinder if it was a movement action
    if (["walk", "swim", "sneak_to", "flee"].includes(type)) {
      try { this.bot.pathfinder?.stop(); } catch { /* ok */ }
    }
    // Stop digging
    if (type === "mine") {
      try { this.bot.stopDigging?.(); } catch { /* ok */ }
    }
    // Stop PVP
    if (["attack", "defend"].includes(type)) {
      try { this.bot.pvp?.stop(); } catch { /* ok */ }
    }
    // Release control states
    if (["jump", "swim"].includes(type)) {
      this.bot.setControlState("jump", false);
      this.bot.setControlState("forward", false);
    }
    if (["sneak_to"].includes(type)) {
      this.bot.setControlState("sneak", false);
    }
  }
}

module.exports = {
  ActionExecutor,
  ACTION_HANDLERS,
  readMetric,
  DIRECTION_VECTORS,
};
