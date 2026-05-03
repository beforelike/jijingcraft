const minecraftData = require("minecraft-data");
const { Movements, goals } = require("mineflayer-pathfinder");
const { Vec3 } = require("vec3");
const {
  ADVANCED_MATERIAL_ITEMS,
  ADVANCED_ORE_BLOCKS,
  BED_ITEMS,
  AXES,
  CROP_BLOCKS,
  CROP_PLANT_ITEMS,
  DAMAGING_BLOCKS,
  DOOR_ITEMS,
  FOOD_ITEMS,
  FOOD_MOBS,
  HOES,
  HOSTILE_MOBS,
  LOG_BLOCKS,
  LOG_TO_PLANKS,
  PICKAXES,
  PLANK_ITEMS,
  PLANK_TO_DOOR,
  SHELTER_BLOCK_ITEMS,
  STONE_OR_BETTER_AXES,
  STONE_OR_BETTER_PICKAXES,
  STONE_OR_BETTER_WEAPONS,
  WATER_BLOCKS,
  WEAPONS,
  WOOL_ITEMS
} = require("./constants");
const { decideNextTask } = require("./decision");
const { countItems, firstInventoryItem, hasAny, inventoryFromBot } = require("./inventory");
const {
  CARDINAL_DIRECTIONS,
  createAscendingStairPlan,
  createDescendingStairPlan,
  normalizeCardinalDirection,
  sortMiningTargets
} = require("./miningPlan");
const {
  createEmergencyShelterPlan,
  createStarterShelterDoorwayPlan,
  createStarterShelterDoorwaySealPlan,
  createStarterShelterPlan
} = require("./shelterPlan");
const {
  createDefaultProgress,
  createDefaultSurvivalMemory,
  forgetKnownBlock,
  isLearningPositionAvoided,
  loadSurvivalMemory,
  rememberKnownBlock,
  recordLearningEvent,
  saveSurvivalMemory,
  updateProgressMemory
} = require("./memoryStore");
const { assessProgress, buildingMaterialCount } = require("./progress");
const { chooseHostileDamageResponse } = require("./threatResponse");

const { GoalNear, GoalLookAtBlock, GoalBlock } = goals;
const DAMAGING_BLOCK_NAMES = new Set(DAMAGING_BLOCKS);
const WATER_BLOCK_NAMES = new Set(WATER_BLOCKS);

class SurvivalController {
  constructor(bot, config, logger) {
    this.bot = bot;
    this.config = config;
    this.logger = logger;
    this.mcData = null;
    this.loop = null;
    this.busy = false;
    this.pausedUntil = 0;
    this.invalidPositionTicks = 0;
    this.memory = config.memory?.enabled === false
      ? createDefaultSurvivalMemory()
      : loadSurvivalMemory(config.memory.filePath, logger);
    this.progressState = {
      ...createDefaultProgress(),
      ...this.memory.progress,
      achievedMilestones: Array.isArray(this.memory.progress?.achievedMilestones)
        ? [...this.memory.progress.achievedMilestones]
        : []
    };
    this.loggedProgressMilestones = new Set();
    this.lastProgressStage = null;
    this.handleHealthChange = null;
    this.emergencyBusy = false;
    this.lastHealth = null;
    this.lastValidPosition = null;
    this.lastAction = null;
    this.surfaceStoneSearchAttempts = 0;
  }

  start() {
    this.mcData = minecraftData(this.bot.version);
    const movements = new Movements(this.bot, this.mcData);
    movements.canDig = true;
    movements.allow1by1towers = false;
    this.configureMovementAvoidance(movements);
    this.bot.pathfinder.setMovements(movements);

    this.lastHealth = this.bot.health ?? 20;
    this.handleHealthChange = () => {
      const currentHealth = this.bot.health ?? 20;
      const previousHealth = this.lastHealth ?? currentHealth;
      this.lastHealth = currentHealth;
      if (currentHealth >= previousHealth) return;
      this.handleEmergencyDamage(previousHealth, currentHealth).catch((error) => this.logger.debug("emergency damage handler failed", error.message));
    };
    this.bot.on("health", this.handleHealthChange);

    this.logger.info(`survival controller started on ${this.config.host}:${this.config.port} as ${this.config.username}`);
    if (this.config.memory?.enabled !== false) {
      this.logger.info(`survival memory loaded from ${this.config.memory.filePath}`);
    }
    this.loop = setInterval(() => this.tick().catch((error) => this.logger.error("control tick failed", error)), this.config.controlIntervalMs);
    this.tick().catch((error) => this.logger.error("initial control tick failed", error));
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    if (this.handleHealthChange) this.bot.off("health", this.handleHealthChange);
    this.persistMemory();
    this.loop = null;
    this.handleHealthChange = null;
  }

  configureMovementAvoidance(movements) {
    for (const blockName of DAMAGING_BLOCKS) {
      const block = this.mcData.blocksByName[blockName];
      if (block) movements.blocksToAvoid.add(block.id);
    }
    for (const blockName of WATER_BLOCKS) {
      const block = this.mcData.blocksByName[blockName];
      if (block) movements.blocksToAvoid.add(block.id);
    }

    movements.exclusionAreasStep.push((block) => (block && DAMAGING_BLOCK_NAMES.has(block.name) ? 100 : 0));
    movements.exclusionAreasStep.push((block) => (block && WATER_BLOCK_NAMES.has(block.name) ? 80 : 0));
    movements.exclusionAreasBreak.push((block) => (block && DAMAGING_BLOCK_NAMES.has(block.name) ? 100 : 0));
  }

  currentDimension() {
    return this.bot.game?.dimension || this.bot.game?.dimensionName || "unknown";
  }

  persistMemory() {
    if (this.config.memory?.enabled === false) return false;
    updateProgressMemory(this.memory, this.progressState);
    return saveSurvivalMemory(this.config.memory.filePath, this.memory, this.logger);
  }

  rememberBlock(blockName, position) {
    const changed = rememberKnownBlock(this.memory, blockName, position, this.currentDimension());
    if (changed) {
      this.logger.info(`memory=remember_block; block=${blockName}; pos=${this.formatPosition(position)}`);
      this.persistMemory();
    }
    return changed;
  }

  forgetBlock(blockName, position) {
    const changed = forgetKnownBlock(this.memory, blockName, position, this.currentDimension());
    if (changed) {
      this.logger.warn(`memory=forget_block; block=${blockName}; pos=${this.formatPosition(position)}`);
      this.persistMemory();
    }
    return changed;
  }

  recordActionFailure(action, reason, position = this.bot.entity?.position, details = {}) {
    const changed = recordLearningEvent(this.memory, {
      action,
      target: details.target,
      reason,
      outcome: "failure",
      position,
      dimension: this.currentDimension(),
      radius: details.radius
    });
    if (changed) {
      this.logger.warn(`learning=failure; action=${action}; target=${details.target ?? "default"}; reason=${reason}; pos=${this.formatPosition(position)}`);
      this.persistMemory();
    }
  }

  recordActionSuccess(action, position = this.bot.entity?.position, details = {}) {
    const changed = recordLearningEvent(this.memory, {
      action,
      target: details.target,
      reason: "success",
      outcome: "success",
      position,
      dimension: this.currentDimension(),
      radius: details.radius
    });
    if (changed) this.persistMemory();
  }

  isLearnedAvoidPosition(position, action, target = null) {
    return isLearningPositionAvoided(this.memory, position, {
      action,
      target,
      dimension: this.currentDimension()
    });
  }

  refreshKnownCraftingTables(position) {
    if (!this.mcData || !this.hasValidPosition(position)) return;
    const craftingTableId = this.mcData.blocksByName.crafting_table?.id;
    if (craftingTableId === undefined) return;

    const tablePositions = this.bot.findBlocks({ matching: craftingTableId, maxDistance: 32, count: 8 });
    let changed = false;
    for (const tablePosition of tablePositions) {
      changed = rememberKnownBlock(this.memory, "crafting_table", tablePosition, this.currentDimension()) || changed;
    }
    this.progressState.hasCraftingTable = this.hasCraftingTableAccess(position);
    if (changed) this.persistMemory();
  }

  hasCraftingTableAccess(position = this.bot.entity?.position) {
    if (firstInventoryItem(this.bot, "crafting_table")) return true;
    if (!this.hasValidPosition(position)) return false;

    const nearbyTable = this.findNearbyBlock("crafting_table", 8);
    if (nearbyTable) return true;

    return Boolean(this.nearestKnownBlockEntry("crafting_table", position, this.config.memory?.knownBlockSearchRadius ?? 96));
  }

  nearestKnownBlockEntry(blockName, position, maxDistance) {
    if (!this.hasValidPosition(position)) return null;
    const entries = this.memory.knownBlocks?.[blockName] ?? [];
    const dimension = this.currentDimension();
    return entries
      .filter((entry) => entry.dimension === dimension && this.hasValidPosition(entry.position))
      .map((entry) => ({
        ...entry,
        distance: this.distanceBetweenPositions(entry.position, position)
      }))
      .filter((entry) => entry.distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance)[0] ?? null;
  }

  findNearbyBlock(blockName, maxDistance) {
    const blockId = this.mcData?.blocksByName[blockName]?.id;
    if (blockId === undefined) return null;
    return this.bot.findBlock({ matching: blockId, maxDistance });
  }

  async handleEmergencyDamage(previousHealth = this.lastHealth, currentHealth = this.bot.health ?? 20) {
    if (this.emergencyBusy || !this.bot.entity || !this.hasValidPosition(this.bot.entity.position)) return;
    const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.5);
    const hostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius);

    this.emergencyBusy = true;
    this.pause(5000);
    try {
      await this.cancelCollectTask();
      this.resetMotion();
      if (hazard) {
        this.logger.warn(`emergency=damage_block; block=${hazard.name}; distance=${hazard.distance.toFixed(1)}; escaping`);
        await this.escapeHazardBlock(hazard);
      }
      if (hostile && this.hasValidPosition(this.bot.entity.position)) {
        await this.respondToHostileDamage(hostile, previousHealth, currentHealth);
      } else if (!hazard && this.hasValidPosition(this.bot.entity.position)) {
        await this.respondToUnknownDamage(previousHealth, currentHealth);
      }
    } finally {
      this.emergencyBusy = false;
    }
  }

  async respondToHostileDamage(hostile, previousHealth, currentHealth) {
    if (!hostile || !this.hasValidPosition(hostile.position)) return;
    const distance = hostile.position.distanceTo(this.bot.entity.position);
    const response = chooseHostileDamageResponse({
      health: currentHealth,
      criticalHealth: this.config.survival.criticalHealth,
      distance,
      immediateThreatRadius: this.config.survival.immediateThreatRadius,
      hasWeapon: Boolean(firstInventoryItem(this.bot, WEAPONS))
    });

    this.logger.warn(`emergency=hostile_damage; target=${hostile.name}; distance=${distance.toFixed(1)}; hp=${previousHealth}->${currentHealth}; response=${response}`);
    if (response === "defend") {
      await this.defendSelf(hostile);
      return;
    }
    const escaped = await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
    const currentDistance = this.hasValidPosition(hostile.position) && this.hasValidPosition(this.bot.entity.position)
      ? hostile.position.distanceTo(this.bot.entity.position)
      : Infinity;
    if (!escaped && currentDistance <= this.config.survival.immediateThreatRadius + 2) {
      this.logger.warn("emergency=hostile_damage; retreat failed, fighting as last resort");
      await this.defendSelf(hostile);
    }
  }

  async respondToUnknownDamage(previousHealth, currentHealth) {
    const origin = this.bot.entity.position;
    this.logger.warn(`emergency=unknown_damage; hp=${previousHealth}->${currentHealth}; repositioning`);
    const directions = [
      ...CARDINAL_DIRECTIONS,
      new Vec3(1, 0, 1),
      new Vec3(1, 0, -1),
      new Vec3(-1, 0, 1),
      new Vec3(-1, 0, -1)
    ];

    for (const distance of [4, 7, 10]) {
      for (const direction of directions) {
        for (const yOffset of [0, 1, -1, 2, -2]) {
          const candidate = new Vec3(
            Math.floor(origin.x + direction.x * distance),
            Math.floor(origin.y + yOffset),
            Math.floor(origin.z + direction.z * distance)
          );
          if (!this.isSafeStandPosition(candidate) || this.findNearbyDamagingBlock(candidate, 1.2)) continue;
          const reached = await this.gotoNear(candidate.x, candidate.y, candidate.z, 1, {
            label: "damage_reposition",
            timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 6000)
          });
          if (reached) return;
        }
      }
    }

    this.logger.warn("emergency=unknown_damage; no safe reposition target found");
  }

  async tick() {
    if (this.busy || this.emergencyBusy || !this.bot.entity) return;
    if (Date.now() < this.pausedUntil) return;
    if (!this.hasValidPosition(this.bot.entity.position)) {
      this.invalidPositionTicks++;
      this.resetMotion();
      this.logger.warn(`control tick skipped; waiting for a valid bot position (${this.invalidPositionTicks})`);
      if (this.invalidPositionTicks >= 3) {
        this.logger.warn("invalid position persisted; reconnecting to recover entity state");
        this.invalidPositionTicks = 0;
        this.pause(10000);
        this.recordActionFailure(this.lastAction?.type || "position_recovery", "invalid_position", this.lastValidPosition, {
          target: this.lastAction?.type || "position_recovery",
          radius: 8
        });
        try {
          this.bot.quit("Invalid position recovery");
        } catch (error) {
          this.logger.debug("invalid position reconnect failed", error.message);
        }
      }
      return;
    }
    this.invalidPositionTicks = 0;
    this.lastValidPosition = this.bot.entity.position.floored();

    this.busy = true;
    try {
      const snapshot = this.createSnapshot();
      this.logSurvivalProgress(snapshot);
      const decision = decideNextTask(snapshot, this.config);
      this.lastAction = { type: decision.type, position: snapshot.position.floored(), startedAt: Date.now() };
      this.logger.info(`decision=${decision.type}; hp=${snapshot.health}; food=${snapshot.food}; time=${snapshot.timeOfDay}; night=${snapshot.isNight}; pos=${this.formatPosition(snapshot.position)}; reason=${decision.reason}`);
      await this.execute(decision);
    } finally {
      this.busy = false;
    }
  }

  pause(milliseconds) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + milliseconds);
  }

  resetMotion() {
    try {
      this.bot.clearControlStates();
      this.bot.pathfinder?.setGoal(null);
      this.bot.pvp?.stop();
    } catch (error) {
      this.logger.debug("failed to reset bot motion", error.message);
    }
  }

  createSnapshot() {
    const position = this.bot.entity.position;
    this.refreshKnownCraftingTables(position);
    this.refreshStarterShelterProgress(position);
    this.refreshCropProgress(position);
    const starterShelterStatus = this.getStarterShelterStatus(position);
    const entities = Object.values(this.bot.entities)
      .filter((entity) => entity !== this.bot.entity && entity.name)
      .map((entity) => ({
        name: entity.name,
        distance: entity.position.distanceTo(position),
        position: entity.position
      }));

    return {
      health: this.bot.health ?? 20,
      food: this.bot.food ?? 20,
      oxygen: this.bot.oxygenLevel ?? 20,
      environmentHazard: this.findNearbyDamagingBlock(position, 1.5),
      navigationTrap: this.isLikelyPitPosition(position),
      inventory: inventoryFromBot(this.bot),
      entities,
      position,
      timeOfDay: this.bot.time?.timeOfDay ?? 0,
      isNight: this.isNight(),
      isInLava: this.bot.entity.isInLava,
      timeSinceOnGround: this.bot.entity.timeSinceOnGround || 0,
      experience: this.bot.experience,
      progress: {
        ...this.progressState,
        hasCraftingTable: this.hasCraftingTableAccess(position),
        isNearStarterShelter: starterShelterStatus.isNear,
        isStarterShelterDefensible: starterShelterStatus.defensible,
        usableStarterShelter: starterShelterStatus.usable,
        achievedMilestones: [...this.progressState.achievedMilestones]
      }
    };
  }

  refreshStarterShelterProgress(position) {
    if (this.progressState.hasStarterShelter || !this.progressState.starterShelterPosition || !this.hasValidPosition(position)) return;

    const base = new Vec3(
      this.progressState.starterShelterPosition.x,
      this.progressState.starterShelterPosition.y,
      this.progressState.starterShelterPosition.z
    );
    const plan = this.createStarterShelterPlan(base);
    const completed = plan.filter((targetPosition) => this.isDefensiveShelterBlock(targetPosition)).length;

    if (completed >= Math.ceil(plan.length * 0.9) && this.isStarterShelterDoorwayDefensible(base)) {
      this.progressState.hasStarterShelter = true;
      this.progressState.starterShelterPosition = { x: base.x, y: base.y, z: base.z };
      this.persistMemory();
    }
  }

  starterShelterBase() {
    if (!this.progressState.starterShelterPosition) return null;
    const position = this.progressState.starterShelterPosition;
    if (!this.hasValidPosition(position)) return null;
    return new Vec3(position.x, position.y, position.z);
  }

  getStarterShelterStatus(position = this.bot.entity?.position) {
    const base = this.starterShelterBase();
    if (!this.progressState.hasStarterShelter || !base || !this.hasValidPosition(position)) {
      return { hasMemory: false, isNear: false, defensible: false, usable: false, distance: Infinity };
    }

    const current = position.floored();
    const horizontalDistance = Math.hypot(current.x - base.x, current.z - base.z);
    const verticalDistance = Math.abs(current.y - base.y);
    const isNear = horizontalDistance <= 6 && verticalDistance <= 6;
    if (!isNear) {
      return { hasMemory: true, isNear: false, defensible: false, usable: false, distance: horizontalDistance };
    }

    const plan = this.createStarterShelterPlan(base);
    const completed = plan.filter((targetPosition) => this.isDefensiveShelterBlock(targetPosition)).length;
    const doorwayDefensible = this.isStarterShelterDoorwayDefensible(base);
    const defensible = completed >= Math.ceil(plan.length * 0.9) && doorwayDefensible;
    if (!defensible) this.logger.warn(`starter_shelter=not_defensible; completed=${completed}/${plan.length}; pos=${this.formatPosition(base)}`);
    return { hasMemory: true, isNear: true, defensible, usable: defensible, distance: horizontalDistance };
  }

  hasUsableStarterShelterAt(position = this.bot.entity?.position) {
    return this.getStarterShelterStatus(position).usable;
  }

  refreshCropProgress(position) {
    if (this.progressState.hasCropPlot || !this.mcData || !this.hasValidPosition(position)) return;

    const cropIds = CROP_BLOCKS
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);
    if (cropIds.length === 0) return;

    const planted = this.bot.findBlocks({ matching: cropIds, maxDistance: 14, count: this.config.survival.cropPlotTarget });
    if (planted.length >= Math.max(2, Math.ceil((this.config.survival.cropPlotTarget ?? 6) / 2))) {
      this.progressState.hasCropPlot = true;
      this.progressState.plantedCrops = Math.max(this.progressState.plantedCrops, planted.length);
      this.persistMemory();
    }
  }

  logSurvivalProgress(snapshot) {
    let progress = assessProgress(snapshot, this.config);
    let updatedHistory = false;

    for (const milestone of progress.milestones) {
      if (!milestone.achieved || this.loggedProgressMilestones.has(milestone.id)) continue;
      this.loggedProgressMilestones.add(milestone.id);
      if (!this.progressState.achievedMilestones.includes(milestone.id)) {
        this.progressState.achievedMilestones.push(milestone.id);
        updatedHistory = true;
      }
      this.logger.info(`progress=${milestone.id}; label=${milestone.label}; summary=${progress.summary}`);
    }

    if (updatedHistory) {
      snapshot.progress.achievedMilestones = [...this.progressState.achievedMilestones];
      this.persistMemory();
      progress = assessProgress(snapshot, this.config);
    }

    if (progress.stage !== this.lastProgressStage) {
      this.lastProgressStage = progress.stage;
      const nextGoal = progress.next ? progress.next.label : "Phase 1 survival loop stable";
      this.logger.info(`progress_stage=${progress.stage}; next=${nextGoal}; food=${progress.foodCount}; building_blocks=${progress.materialCount}`);
    }
  }

  async execute(decision) {
    switch (decision.type) {
      case "escape_hazard":
        await this.escapeHazard();
        return;
      case "escape_pit":
        await this.escapePit();
        return;
      case "evade_hostiles":
        await this.evadeHostiles();
        return;
      case "defend_shelter":
        await this.defendShelter();
        return;
      case "defend_self":
        await this.defendSelf();
        return;
      case "hold_position":
        await this.holdPositionSafely();
        return;
      case "eat_food":
        await this.eatFood();
        return;
      case "hunt_food":
        await this.huntFood();
        return;
      case "wait_out_night":
        await this.waitOutNight();
        return;
      case "collect_wood":
        await this.collectWood();
        return;
      case "craft_basic_supplies":
        await this.craftBasicSupplies();
        return;
      case "craft_basic_tools":
        await this.craftBasicTools();
        return;
      case "craft_stone_tools":
        await this.craftStoneTools();
        return;
      case "collect_stone":
        await this.collectStone();
        return;
      case "craft_furnace":
        await this.craftFurnace();
        return;
      case "craft_weapon":
        await this.craftWeapon();
        return;
      case "collect_building_materials":
        await this.collectBuildingMaterials(decision.targetCount);
        return;
      case "build_shelter":
        await this.buildStarterShelter();
        return;
      case "collect_wool":
        await this.collectWool();
        return;
      case "craft_bed":
        await this.craftBed();
        return;
      case "collect_crop_seeds":
        await this.collectCropSeeds();
        return;
      case "plant_crops":
        await this.plantCrops();
        return;
      case "build_animal_pen":
        await this.buildAnimalPen();
        return;
      case "lure_animals":
        await this.lureAnimals();
        return;
      case "mine_advanced_materials":
        await this.mineAdvancedMaterials();
        return;
      default:
        await this.explore();
    }
  }

  async escapeHazard() {
    const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.5);
    if (hazard) {
      await this.escapeHazardBlock(hazard);
      return;
    }

    this.bot.clearControlStates();
    this.bot.setControlState("jump", true);
    await this.wait(700);
    this.bot.setControlState("jump", false);
    await this.evadeHostiles();
  }

  async escapePit() {
    this.resetMotion();
    const origin = this.bot.entity.position;
    if (!this.hasValidPosition(origin)) return false;

    const rim = this.findPitRimCandidate(origin);
    if (rim) {
      const reached = await this.gotoNear(rim.x, rim.y, rim.z, 1, {
        label: "escape_pit_rim",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 7000),
        learnPosition: rim,
        target: "pit_rim"
      });
      if (reached) return true;
    }

    const direction = rim
      ? normalizeCardinalDirection(new Vec3(rim.x - origin.x, 0, rim.z - origin.z))
      : this.cardinalDirection();

    this.logger.warn(`action=escape_pit; carving stair direction=${this.formatPosition(direction)}`);
    const carved = await this.carveAscendingEscapeStair(direction, 5);
    if (carved) return true;

    this.recordActionFailure("escape_pit", "stair_escape_failed", origin, { target: "pit", radius: 8 });
    return false;
  }

  async escapeHazardBlock(hazard) {
    this.resetMotion();
    const origin = this.bot.entity.position;
    if (!this.hasValidPosition(origin)) return;

    await this.quickRetreatFromHazard(hazard, 1200);
    const currentPosition = this.bot.entity.position;
    if (!this.hasValidPosition(currentPosition) || !this.findNearbyDamagingBlock(currentPosition, 1.2)) return;

    const awayX = origin.x - hazard.position.x;
    const awayZ = origin.z - hazard.position.z;
    const length = Math.max(Math.sqrt(awayX * awayX + awayZ * awayZ), 1);
    const fallbackDirection = this.cardinalDirection();
    const unitX = Math.abs(awayX) + Math.abs(awayZ) > 0.1 ? awayX / length : fallbackDirection.x;
    const unitZ = Math.abs(awayX) + Math.abs(awayZ) > 0.1 ? awayZ / length : fallbackDirection.z;

    this.logger.warn(`action=escape_hazard_block; block=${hazard.name}; pos=${this.formatPosition(hazard.position)}`);
    for (const distance of [4, 7, 10]) {
      const target = new Vec3(origin.x + unitX * distance, origin.y, origin.z + unitZ * distance);
      if (!this.isSafeStandPosition(target)) continue;
      await this.gotoNear(target.x, target.y, target.z, 1);
      return;
    }

    await this.gotoNear(origin.x + this.randomOffset() / 3, origin.y, origin.z + this.randomOffset() / 3, 3);
  }

  async quickRetreatFromHazard(hazard, durationMs) {
    const deadline = Date.now() + Math.min(durationMs, 1200);

    while (Date.now() < deadline && this.hasValidPosition(this.bot.entity.position)) {
      const origin = this.bot.entity.position;
      const direction = this.retreatDirectionFrom(origin, hazard.position);
      if (!this.findForwardSafeStandPosition(origin, direction.x, direction.z)) break;
      const lookTarget = new Vec3(origin.x + direction.x * 10, origin.y + 1.6, origin.z + direction.z * 10);

      await this.bot.lookAt(lookTarget, true);
      this.bot.setControlState("sprint", true);
      this.bot.setControlState("forward", true);
      await this.wait(200);
    }

    this.bot.clearControlStates();
  }

  async evadeHostiles() {
    const hostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius);
    const origin = this.bot.entity.position;

    if (hostile) {
      this.logger.warn(`action=evade_hostiles; immediate retreat from ${hostile.name} at ${hostile.position.distanceTo(origin).toFixed(1)} blocks`);
      const escaped = await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
      const currentDistance = this.hasValidPosition(hostile.position) && this.hasValidPosition(this.bot.entity.position)
        ? hostile.position.distanceTo(this.bot.entity.position)
        : Infinity;
      if (!escaped && currentDistance <= this.config.survival.immediateThreatRadius + 2) {
        this.logger.warn("action=evade_hostiles; retreat failed, fighting as last resort");
        await this.defendSelf(hostile);
        return;
      }
    }

    const currentPosition = this.bot.entity.position;
    if (!this.hasValidPosition(currentPosition)) {
      this.logger.warn("action=evade_hostiles; skipped path target because position is invalid after retreat");
      return;
    }

    let targetX = currentPosition.x + this.randomOffset();
    let targetZ = currentPosition.z + this.randomOffset();

    if (hostile) {
      const awayX = currentPosition.x - hostile.position.x;
      const awayZ = currentPosition.z - hostile.position.z;
      const length = Math.max(Math.sqrt(awayX * awayX + awayZ * awayZ), 1);
      targetX = currentPosition.x + (awayX / length) * this.config.survival.evadeDistance;
      targetZ = currentPosition.z + (awayZ / length) * this.config.survival.evadeDistance;
    }

    await this.gotoNear(targetX, currentPosition.y, targetZ, 3);
  }

  async panicRetreatFrom(hostile, durationMs) {
    this.resetMotion();
    if (!hostile || !this.hasValidPosition(this.bot.entity.position)) return false;

    const safeTarget = this.findSafeRetreatTargetFrom(hostile);
    if (safeTarget) {
      this.logger.warn(`action=panic_retreat; mode=path; target=${this.formatPosition(safeTarget)}`);
      const reached = await this.gotoNear(safeTarget.x, safeTarget.y, safeTarget.z, 2, {
        label: "retreat",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, Math.max(durationMs + 2500, 5000))
      });
      if (reached) return true;
    }

    this.logger.warn("action=panic_retreat; mode=manual; no safe path target found");
    return this.manualRetreatFrom(hostile, Math.min(durationMs, 1400));
  }

  async manualRetreatFrom(hostile, durationMs) {
    const deadline = Date.now() + durationMs;
    let moved = false;

    while (Date.now() < deadline && this.hasValidPosition(this.bot.entity.position)) {
      const currentHostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.safeModeThreatRadius) || hostile;
      const origin = this.bot.entity.position;
      const direction = this.retreatDirectionFrom(origin, currentHostile.position);
      if (!this.findForwardSafeStandPosition(origin, direction.x, direction.z)) {
        this.logger.warn("action=panic_retreat; manual retreat stopped before unsafe step");
        break;
      }
      const lookTarget = new Vec3(origin.x + direction.x * 12, origin.y + 1.6, origin.z + direction.z * 12);

      await this.bot.lookAt(lookTarget, true);
      this.bot.setControlState("sprint", true);
      this.bot.setControlState("forward", true);
      this.bot.setControlState("jump", false);
      moved = true;
      await this.wait(250);
    }

    this.bot.clearControlStates();
    return moved;
  }

  findSafeRetreatTargetFrom(hostile) {
    const origin = this.bot.entity.position;
    if (!this.hasValidPosition(origin) || !this.hasValidPosition(hostile?.position)) return null;

    const direction = this.retreatDirectionFrom(origin, hostile.position);
    const perpendicular = new Vec3(-direction.z, 0, direction.x);
    const currentDistance = origin.distanceTo(hostile.position);

    for (const distance of [6, 10, 14, 18]) {
      for (const lateral of [0, 3, -3, 6, -6]) {
        for (const yOffset of [0, -1, 1, -2, 2]) {
          const candidate = new Vec3(
            Math.floor(origin.x + direction.x * distance + perpendicular.x * lateral),
            Math.floor(origin.y + yOffset),
            Math.floor(origin.z + direction.z * distance + perpendicular.z * lateral)
          );
          if (!this.isSafeStandPosition(candidate)) continue;
          if (this.findNearbyDamagingBlock(candidate, 1.2)) continue;
          if (candidate.distanceTo(hostile.position) <= currentDistance + 3) continue;
          return candidate;
        }
      }
    }

    return null;
  }

  retreatDirectionFrom(origin, threatPosition) {
    if (!this.hasValidPosition(origin) || !this.hasValidPosition(threatPosition)) {
      return this.cardinalDirection();
    }

    const awayX = origin.x - threatPosition.x;
    const awayZ = origin.z - threatPosition.z;
    const length = Math.sqrt(awayX * awayX + awayZ * awayZ);
    if (length < 0.1) return this.cardinalDirection();
    return new Vec3(awayX / length, 0, awayZ / length);
  }

  findForwardSafeStandPosition(origin, unitX, unitZ) {
    if (!this.hasValidPosition(origin)) return null;
    let stepX = Math.abs(unitX) >= 0.35 ? Math.sign(unitX) : 0;
    let stepZ = Math.abs(unitZ) >= 0.35 ? Math.sign(unitZ) : 0;
    if (stepX === 0 && stepZ === 0) {
      const fallback = this.cardinalDirection();
      stepX = fallback.x;
      stepZ = fallback.z;
    }

    const base = origin.floored().offset(stepX, 0, stepZ);
    for (const yOffset of [0, -1, 1]) {
      const candidate = base.offset(0, yOffset, 0);
      if (this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2)) return candidate;
    }

    return null;
  }

  async holdPositionSafely() {
    this.resetMotion();
    await this.equipBestWeapon();
    this.bot.setControlState("sneak", false);
    this.logger.info(`action=hold_position; pos=${this.formatPosition(this.bot.entity.position)}; scanning for threats`);

    const deadline = Date.now() + 8000;
    const hasUsableStarterShelter = this.isNight() && this.hasUsableStarterShelterAt(this.bot.entity.position);
    const scanRadius = hasUsableStarterShelter
      ? this.config.survival.shelterDefenseRadius
      : this.config.survival.safeModeThreatRadius;
    try {
      while (Date.now() < deadline) {
        const hostile = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), scanRadius);
        if (hostile) {
          const distance = hostile.position.distanceTo(this.bot.entity.position);
          this.logger.warn(`action=hold_position; threat detected=${hostile.name}; distance=${distance.toFixed(1)}; switching to ${hasUsableStarterShelter ? "defense" : "shelter hold"}`);
          const shelterBlock = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
          if (hasUsableStarterShelter) {
            await this.defendShelter(hostile);
          } else if (this.isNight() && shelterBlock && distance > this.config.survival.immediateThreatRadius) {
            await this.buildSimpleShelter();
            await this.wait(1000);
            continue;
          } else if (this.isNight() && distance > this.config.survival.immediateThreatRadius) {
            if (!shelterBlock && distance <= this.config.survival.threatRadius) {
              this.logger.warn(`action=hold_position; no shelter blocks and ${hostile.name} is approaching, retreating before contact`);
              const escaped = await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
              const currentDistance = this.hasValidPosition(hostile.position) && this.hasValidPosition(this.bot.entity.position)
                ? hostile.position.distanceTo(this.bot.entity.position)
                : Infinity;
              if (!escaped && currentDistance <= this.config.survival.immediateThreatRadius + 2) await this.defendSelf(hostile);
              return;
            }
            await this.wait(1000);
            continue;
          } else if (this.isNight() && shelterBlock) {
            await this.buildSimpleShelter();
            await this.wait(1000);
            continue;
          } else {
            const escaped = await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
            const currentDistance = this.hasValidPosition(hostile.position) && this.hasValidPosition(this.bot.entity.position)
              ? hostile.position.distanceTo(this.bot.entity.position)
              : Infinity;
            if (!escaped && firstInventoryItem(this.bot, WEAPONS) && currentDistance <= this.config.survival.immediateThreatRadius + 2) {
              await this.defendSelf(hostile);
            }
          }
          return;
        }
        await this.wait(1000);
      }
    } finally {
      this.bot.setControlState("sneak", false);
    }
  }

  async defendShelter(target = null) {
    this.resetMotion();
    await this.equipBestWeapon();
    const hostile = target || this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.shelterDefenseRadius);
    if (!hostile) {
      await this.holdPositionSafely();
      return;
    }

    this.logger.warn(`action=defend_shelter; target=${hostile.name}; distance=${hostile.position.distanceTo(this.bot.entity.position).toFixed(1)}`);
    const deadline = Date.now() + Math.min(this.config.survival.actionTimeoutMs, 8000);
    this.bot.pvp.attack(hostile);
    try {
      while (Date.now() < deadline && this.bot.entities[hostile.id]) {
        const distance = hostile.position.distanceTo(this.bot.entity.position);
        if (distance > this.config.survival.shelterDefenseRadius + 2) break;
        if ((this.bot.health ?? 20) <= this.config.survival.criticalHealth) {
          this.logger.warn("action=defend_shelter; health critical, retreating");
          this.bot.pvp.stop();
          await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
          return;
        }
        await this.bot.lookAt(hostile.position.offset(0, 1, 0), true);
        if (distance <= 4.2) this.bot.attack(hostile);
        await this.wait(500);
      }
    } finally {
      this.bot.pvp.stop();
      this.resetMotion();
    }
  }

  async defendSelf(target = null) {
    this.resetMotion();
    await this.equipBestWeapon();
    const targetStillVisible = target && this.bot.entities[target.id] && this.hasValidPosition(target.position);
    const hostile = targetStillVisible
      ? target
      : this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.immediateThreatRadius + 2);
    if (!hostile) {
      await this.holdPositionSafely();
      return;
    }

    this.logger.warn(`action=defend_self; target=${hostile.name}; distance=${hostile.position.distanceTo(this.bot.entity.position).toFixed(1)}`);
    const deadline = Date.now() + Math.min(this.config.survival.actionTimeoutMs, 10000);
    this.bot.pvp.attack(hostile);
    try {
      while (Date.now() < deadline && this.bot.entities[hostile.id]) {
        if ((this.bot.health ?? 20) <= this.config.survival.criticalHealth) {
          this.logger.warn("action=defend_self; health critical, retreating");
          this.bot.pvp.stop();
          await this.panicRetreatFrom(hostile, this.config.survival.panicRetreatMs);
          return;
        }
        await this.wait(500);
      }
    } finally {
      this.bot.pvp.stop();
      this.resetMotion();
    }

    await this.collectNearbyItems({ maxDistance: 6, range: 1, avoidDamagingBlocks: true });
  }

  async eatFood() {
    const item = firstInventoryItem(this.bot, FOOD_ITEMS);
    if (!item) {
      this.logger.warn("wanted to eat but no edible item was found");
      return;
    }

    await this.bot.equip(item, "hand");
    await this.bot.consume();
  }

  async huntFood() {
    const beforeFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    const animal = this.nearestEntity((entity) => FOOD_MOBS.has(entity.name), this.config.survival.foodSearchRadius);
    if (!animal) {
      const foraged = await this.forageNearbyFood();
      if (foraged) return;
      this.logger.info("action=hunt_food; no nearby food mobs, exploring for animals");
      await this.explore();
      return;
    }

    await this.equipBestWeapon();
    this.logger.info(`action=hunt_food; target=${animal.name}; distance=${animal.position.distanceTo(this.bot.entity.position).toFixed(1)}; food=${beforeFood}`);
    await this.gotoNear(animal.position.x, animal.position.y, animal.position.z, 3);

    const attackDeadline = Date.now() + this.config.survival.actionTimeoutMs;
    this.bot.pvp.attack(animal);
    try {
      while (Date.now() < attackDeadline && this.bot.entities[animal.id]) {
        const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
        if (threat) {
          this.logger.warn(`action=hunt_food; interrupted by ${threat.name}`);
          this.bot.pvp.stop();
          await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
          return;
        }
        await this.wait(500);
      }
    } finally {
      this.bot.pvp.stop();
    }

    await this.collectNearbyItems();
    const afterFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    this.logger.info(`action=hunt_food; food=${beforeFood}->${afterFood}`);
  }

  async forageNearbyFood() {
    const berryBlock = this.mcData.blocksByName.sweet_berry_bush;
    if (!berryBlock) return false;

    const positions = this.bot.findBlocks({ matching: berryBlock.id, maxDistance: this.config.survival.foodSearchRadius, count: 12 });
    const bushes = positions
      .map((position) => this.bot.blockAt(position))
      .filter((block) => block && this.isMatureBerryBush(block))
      .slice(0, 4);
    if (bushes.length === 0) return false;

    const beforeFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    this.logger.info(`action=forage_food; mature_berry_bushes=${bushes.length}; food=${beforeFood}`);
    let failedHarvestAttempts = 0;

    for (const bush of bushes) {
      if (this.isLearnedAvoidPosition(bush.position, "forage_food", "sweet_berry_bush")) {
        this.logger.info(`action=forage_food; skipped learned risky bush at ${this.formatPosition(bush.position)}`);
        continue;
      }

      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=forage_food; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }

      const safePositions = this.findSafeAdjacentStandPositions(bush.position)
        .filter((position) => !this.isLearnedAvoidPosition(position, "forage_food", "sweet_berry_bush"))
        .slice(0, 3);
      if (safePositions.length === 0) {
        this.logger.warn(`action=forage_food; skipped bush without safe adjacent position at ${this.formatPosition(bush.position)}`);
        this.recordActionFailure("forage_food", "no_safe_adjacent_position", bush.position, { target: "sweet_berry_bush", radius: 5 });
        continue;
      }

      const safePosition = await this.reachFirstSafeBerryPosition(safePositions);
      if (!safePosition) {
        failedHarvestAttempts++;
        if (failedHarvestAttempts >= 2) {
          this.logger.warn("action=forage_food; repeated safe-position failures, switching strategy");
          break;
        }
        continue;
      }
      const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.2);
      if (hazard) {
        this.logger.warn(`action=forage_food; stood in hazard=${hazard.name}; escaping before harvest`);
        this.recordActionFailure("forage_food", `stood_in_${hazard.name}`, bush.position, { target: "sweet_berry_bush", radius: 6 });
        await this.escapeHazardBlock(hazard);
        continue;
      }

      const currentBush = this.bot.blockAt(bush.position);
      if (!currentBush || !this.isMatureBerryBush(currentBush)) continue;
      await this.bot.lookAt(currentBush.position.offset(0.5, 0.8, 0.5), true);
      await this.bot.activateBlock(currentBush);
      await this.wait(500);
      await this.collectNearbyItems({ maxDistance: 4, range: 2, avoidDamagingBlocks: true });
      this.recordActionSuccess("forage_food", bush.position, { target: "sweet_berry_bush" });
      if (countItems(inventoryFromBot(this.bot), FOOD_ITEMS) >= this.config.survival.foodStockTarget) break;
    }

    const afterFood = countItems(inventoryFromBot(this.bot), FOOD_ITEMS);
    this.logger.info(`action=forage_food; food=${beforeFood}->${afterFood}`);
    return afterFood > beforeFood;
  }

  isMatureBerryBush(block) {
    if (block.name !== "sweet_berry_bush") return false;
    const properties = typeof block.getProperties === "function" ? block.getProperties() : {};
    return Number(properties.age ?? 0) >= 2;
  }

  async collectWool() {
    const beforeWool = this.maxStackCount(inventoryFromBot(this.bot), WOOL_ITEMS);
    const sheep = this.nearestEntity((entity) => entity.name === "sheep", this.config.survival.foodSearchRadius);
    if (!sheep) {
      this.logger.info("action=collect_wool; no nearby sheep, exploring for wool source");
      await this.explore();
      return;
    }

    await this.equipBestWeapon();
    this.logger.info(`action=collect_wool; target=sheep; distance=${sheep.position.distanceTo(this.bot.entity.position).toFixed(1)}; wool=${beforeWool}`);
    await this.gotoNear(sheep.position.x, sheep.position.y, sheep.position.z, 3);

    const attackDeadline = Date.now() + this.config.survival.actionTimeoutMs;
    this.bot.pvp.attack(sheep);
    try {
      while (Date.now() < attackDeadline && this.bot.entities[sheep.id]) {
        const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
        if (threat) {
          this.logger.warn(`action=collect_wool; interrupted by ${threat.name}`);
          this.bot.pvp.stop();
          await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
          return;
        }
        await this.wait(500);
      }
    } finally {
      this.bot.pvp.stop();
    }

    await this.collectNearbyItems();
    const afterWool = this.maxStackCount(inventoryFromBot(this.bot), WOOL_ITEMS);
    this.logger.info(`action=collect_wool; wool=${beforeWool}->${afterWool}`);
  }

  async craftBed() {
    await this.craftBasicSupplies();
    let inventory = inventoryFromBot(this.bot);
    if (countItems(inventory, PLANK_ITEMS) < 3) {
      await this.craftPlanks(3);
      inventory = inventoryFromBot(this.bot);
    }

    if (countItems(inventory, PLANK_ITEMS) < 3 || this.maxStackCount(inventory, WOOL_ITEMS) < this.config.survival.woolTarget) {
      this.logger.warn("action=craft_bed; missing planks or same-color wool");
      await this.collectWool();
      return;
    }

    await this.ensurePlacedBlock("crafting_table");
    for (const bedName of BED_ITEMS) {
      if (await this.craftItem(bedName, 1, true)) return;
    }
    this.logger.warn("action=craft_bed; no bed recipe matched current wool colors");
  }

  async collectCropSeeds() {
    const beforeSeeds = countItems(inventoryFromBot(this.bot), CROP_PLANT_ITEMS);
    const forageBlocks = ["short_grass", "tall_grass", "fern", "large_fern", "grass", "wheat", "carrots", "potatoes", "beetroots"];
    this.logger.info(`action=collect_crop_seeds; plantables=${beforeSeeds}`);
    const result = await this.collectBlocks(forageBlocks, 10, 48);
    if (result.interruptedByThreat) return;
    await this.collectNearbyItems();
    const afterSeeds = countItems(inventoryFromBot(this.bot), CROP_PLANT_ITEMS);
    this.logger.info(`action=collect_crop_seeds; plantables=${beforeSeeds}->${afterSeeds}`);
    if (!result.collected && afterSeeds <= beforeSeeds) {
      this.logger.info("action=collect_crop_seeds; no reachable seed source, exploring for farmland inputs");
      await this.explore();
    }
  }

  async craftHoe() {
    if (hasAny(inventoryFromBot(this.bot), HOES)) return true;
    await this.craftBasicSupplies();
    await this.ensurePlacedBlock("crafting_table");
    if (countItems(inventoryFromBot(this.bot), "cobblestone") >= 2) {
      if (await this.craftItem("stone_hoe", 1, true)) return true;
    }
    return this.craftItem("wooden_hoe", 1, true);
  }

  async plantCrops() {
    if (!(await this.craftHoe())) {
      this.logger.warn("action=plant_crops; could not craft hoe");
      await this.collectWood();
      return;
    }

    if (!firstInventoryItem(this.bot, CROP_PLANT_ITEMS)) {
      await this.collectCropSeeds();
      return;
    }

    const soilIds = ["grass_block", "dirt", "coarse_dirt"]
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);
    if (soilIds.length === 0) return;

    const positions = this.bot.findBlocks({ matching: soilIds, maxDistance: 16, count: 32 });
    const soils = positions
      .map((position) => this.bot.blockAt(position))
      .filter((block) => block && this.bot.blockAt(block.position.offset(0, 1, 0))?.name === "air")
      .slice(0, this.config.survival.cropPlotTarget);

    if (soils.length === 0) {
      this.logger.info("action=plant_crops; no open soil nearby, exploring for a farm spot");
      await this.explore();
      return;
    }

    let planted = 0;
    for (const soil of soils) {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=plant_crops; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }

      const plantItem = firstInventoryItem(this.bot, CROP_PLANT_ITEMS);
      if (!plantItem) break;
      await this.gotoNear(soil.position.x, soil.position.y, soil.position.z, 3);
      const hoe = firstInventoryItem(this.bot, HOES);
      if (!hoe) break;
      await this.bot.equip(hoe, "hand");
      try {
        await this.withTimeout(this.bot.activateBlock(soil), this.config.survival.placeBlockTimeoutMs, null);
      } catch (error) {
        this.logger.debug("till soil failed", error.message);
        continue;
      }

      await this.wait(250);
      const farmland = this.bot.blockAt(soil.position);
      if (!farmland || farmland.name !== "farmland") continue;
      await this.bot.equip(plantItem, "hand");
      try {
        await this.withTimeout(this.bot.placeBlock(farmland, new Vec3(0, 1, 0)), this.config.survival.placeBlockTimeoutMs, null);
        planted++;
        await this.wait(250);
      } catch (error) {
        this.logger.debug("plant crop failed", error.message);
      }
    }

    if (planted > 0) {
      this.progressState.plantedCrops += planted;
      this.progressState.hasCropPlot = this.progressState.plantedCrops >= Math.max(2, Math.ceil(this.config.survival.cropPlotTarget / 2));
      this.persistMemory();
    }
    this.logger.info(`action=plant_crops; planted=${planted}; total=${this.progressState.plantedCrops}`);
  }

  async buildAnimalPen() {
    if (!this.hasValidPosition(this.bot.entity.position)) return false;
    await this.craftPlanks(Math.min(24, this.config.survival.animalPenBlockTarget));
    const beforeMaterials = buildingMaterialCount(inventoryFromBot(this.bot));
    if (beforeMaterials < Math.min(8, this.config.survival.animalPenBlockTarget)) {
      await this.collectBuildingMaterials(this.config.survival.animalPenBlockTarget);
      return false;
    }

    const base = this.bot.entity.position.floored();
    const plan = this.createAnimalPenPlan(base);
    let completed = 0;
    let placed = 0;
    this.logger.info(`action=build_animal_pen; origin=${this.formatPosition(base)}; plan=${plan.length}; materials=${beforeMaterials}`);

    for (const position of plan) {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=build_animal_pen; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }
      const result = await this.placeBuildingBlockAt(position);
      if (result.completed) completed++;
      if (result.placed) placed++;
      if (!firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS) && completed < plan.length) break;
    }

    const success = completed >= Math.ceil(plan.length * 0.7);
    if (success) {
      this.progressState.hasAnimalPen = true;
      this.progressState.animalPenPosition = { x: base.x, y: base.y, z: base.z };
      this.persistMemory();
    }
    this.logger.info(`action=build_animal_pen; placed=${placed}; completed=${completed}/${plan.length}; success=${success}`);
    return success;
  }

  createAnimalPenPlan(base) {
    const positions = [];
    const radius = 3;
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        const isWall = Math.abs(x) === radius || Math.abs(z) === radius;
        if (isWall) positions.push(base.offset(x, 0, z));
      }
    }
    return positions;
  }

  async lureAnimals() {
    const animal = this.nearestEntity((entity) => FOOD_MOBS.has(entity.name), this.config.survival.foodSearchRadius);
    if (!animal) {
      this.logger.info("action=lure_animals; no nearby passive animals, continuing base work");
      return;
    }

    const bait = this.baitForAnimal(animal.name);
    if (!bait) {
      this.logger.info(`action=lure_animals; no bait for ${animal.name}`);
      return;
    }

    const pen = this.progressState.animalPenPosition || this.bot.entity.position;
    await this.bot.equip(bait, "hand");
    this.logger.info(`action=lure_animals; target=${animal.name}; bait=${bait.name}`);
    await this.gotoNear(animal.position.x, animal.position.y, animal.position.z, 2);
    await this.wait(1200);
    await this.gotoNear(pen.x, pen.y, pen.z, 2);
    await this.wait(1500);

    if (this.bot.entities[animal.id] && animal.position.distanceTo(new Vec3(pen.x, pen.y, pen.z)) <= 7) {
      this.progressState.animalsLured++;
      this.persistMemory();
      this.logger.info(`action=lure_animals; animals_lured=${this.progressState.animalsLured}`);
    }
  }

  async mineAdvancedMaterials() {
    if (!hasAny(inventoryFromBot(this.bot), PICKAXES)) await this.craftBasicTools();
    await this.equipBestWeapon();
    await this.equipBestTool("stone");

    const before = countItems(inventoryFromBot(this.bot), ADVANCED_MATERIAL_ITEMS);
    const needed = Math.max(2, Math.min(8, this.config.survival.advancedMaterialTarget - before));
    this.logger.info(`action=mine_advanced_materials; materials=${before}/${this.config.survival.advancedMaterialTarget}; needed=${needed}`);

    const result = await this.collectBlocks(ADVANCED_ORE_BLOCKS, needed, this.config.survival.mineSearchRadius, {
      action: "mine_advanced_materials",
      safeMining: true,
      maxMineBelow: 1
    });
    if (result.interruptedByThreat) return;
    await this.collectNearbyItems();
    const after = countItems(inventoryFromBot(this.bot), ADVANCED_MATERIAL_ITEMS);
    if (result.collected || after > before) {
      this.logger.info(`action=mine_advanced_materials; materials=${before}->${after}`);
      return;
    }

    this.logger.info("action=mine_advanced_materials; no safe exposed ore found, digging a stair mine probe");
    await this.excavateMineProbe();
  }

  async excavateMineProbe() {
    if (!this.hasValidPosition(this.bot.entity.position)) return;
    const origin = this.bot.entity.position.floored();
    let dug = 0;
    let moved = 0;

    for (const direction of this.prioritizedCardinalDirections()) {
      let directionDug = 0;
      let directionMoved = 0;

      for (const stair of createDescendingStairPlan(origin, direction, 8)) {
        const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
        if (threat) {
          this.logger.warn(`action=dig_mine_probe; interrupted by ${threat.name}`);
          await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
          break;
        }

        if (!this.hasSolidSupport(stair.support)) {
          this.logger.warn(`action=dig_mine_probe; direction=${this.formatPosition(direction)} unsupported at ${this.formatPosition(stair.feet)}`);
          break;
        }

        if (await this.digBlockAt(stair.feet)) directionDug++;
        if (await this.digBlockAt(stair.head)) directionDug++;
        if (!this.isSafeStandPosition(stair.feet)) break;

        const reached = await this.gotoNear(stair.feet.x, stair.feet.y, stair.feet.z, 1, {
          label: "mine_stair",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
          learnPosition: stair.feet,
          target: "stair_probe",
          radius: 6
        });
        if (!reached) break;
        directionMoved++;
        await this.collectNearbyItems({ maxDistance: 5, range: 1, avoidDamagingBlocks: true });
      }

      dug += directionDug;
      moved += directionMoved;
      if (directionMoved > 0) break;
    }

    if (dug > 0) {
      this.progressState.hasMiningEntry = true;
      this.progressState.miningTrips++;
      this.persistMemory();
      await this.collectNearbyItems();
    }
    this.logger.info(`action=dig_mine_probe; mode=stair; dug=${dug}; moved=${moved}; trips=${this.progressState.miningTrips}`);
  }

  async collectWood() {
    this.logger.info("action=collect_wood; searching for nearby logs");
    if (!(await this.ensureWoodcuttingTool())) {
      await this.unequipHandIfHolding([...PICKAXES, ...HOES, ...WEAPONS.filter((name) => !AXES.includes(name))]);
    }
    const result = await this.collectBlocks(LOG_BLOCKS, 4, 64);
    if (result.interruptedByThreat) return;
    if (!result.collected) {
      this.logger.info("action=collect_wood; no reachable logs found, exploring for trees");
      await this.explore();
    }
  }

  async waitOutNight() {
    this.resetMotion();
    const hasUsableStarterShelter = this.hasUsableStarterShelterAt(this.bot.entity.position);
    const fortified = hasUsableStarterShelter ? await this.fortifyStarterShelterForNight() : false;
    if (!hasUsableStarterShelter || !fortified) {
      if (this.progressState.hasStarterShelter && !hasUsableStarterShelter) {
        this.logger.warn("action=wait_out_night; remembered starter shelter is not usable here, building emergency shelter if possible");
      }
      await this.buildSimpleShelter();
    }
    this.logger.info(`action=wait_out_night; time=${this.bot.time?.timeOfDay ?? "unknown"}; holding position until safer`);
    await this.holdPositionSafely();
  }

  async buildSimpleShelter() {
    const shelterItem = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
    if (!shelterItem || !this.hasValidPosition(this.bot.entity.position)) return false;

    await this.bot.equip(shelterItem, "hand");
    const base = this.bot.entity.position.floored();
    const plan = createEmergencyShelterPlan(base);

    let placed = 0;
    let completed = 0;
    for (const position of plan) {
      if (!firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS)) break;
      const target = this.bot.blockAt(position);
      if (target?.boundingBox === "block") {
        completed++;
        continue;
      }
      const result = await this.placeBuildingBlockAt(position);
      if (result.placed) placed++;
      if (result.completed || this.bot.blockAt(position)?.boundingBox === "block") completed++;
    }

    const success = completed >= Math.ceil(plan.length * 0.84);
    if (placed > 0 || completed > 0) this.logger.info(`action=build_simple_shelter; mode=sealed; placed=${placed}; completed=${completed}/${plan.length}; success=${success}`);
    return success;
  }

  async fortifyStarterShelterForNight() {
    if (!this.progressState.starterShelterPosition) return false;
    if (!this.getStarterShelterStatus(this.bot.entity.position).isNear) return false;
    const base = new Vec3(
      this.progressState.starterShelterPosition.x,
      this.progressState.starterShelterPosition.y,
      this.progressState.starterShelterPosition.z
    );
    const doorwayPlan = createStarterShelterDoorwaySealPlan(base);
    const planByKey = new Map();
    for (const position of [...doorwayPlan, ...this.createStarterShelterPlan(base)]) {
      planByKey.set(`${position.x},${position.y},${position.z}`, position);
    }
    const plan = [...planByKey.values()];
    if (!this.isStarterShelterDoorwayDefensible(base)) await this.installStarterShelterDoor(base);
    const existingCompleted = plan.filter((position) => this.isDefensiveShelterBlock(position)).length;
    const requiredCompleted = Math.ceil(plan.length * 0.9);
    if (existingCompleted >= requiredCompleted) return true;

    const item = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
    if (!item) return false;

    let placed = 0;
    let completed = existingCompleted;
    await this.bot.equip(item, "hand");
    for (const position of plan) {
      if (this.isDefensiveShelterBlock(position)) continue;
      const result = await this.placeBuildingBlockAt(position);
      if (result.placed) placed++;
      if (result.completed) completed++;
    }
    if (placed > 0 || completed > 0) this.logger.info(`action=fortify_starter_shelter; placed=${placed}; completed=${completed}/${plan.length}; success=${completed >= requiredCompleted}`);
    return completed >= requiredCompleted;
  }

  async collectBuildingMaterials(targetCount = this.config.survival.shelterBlockTarget) {
    const before = buildingMaterialCount(inventoryFromBot(this.bot));
    const needed = Math.max(4, Math.min(16, targetCount - before));
    this.logger.info(`action=collect_building_materials; blocks=${before}/${targetCount}; needed=${needed}`);

    const surfaceBlocks = ["dirt", "grass_block", ...LOG_BLOCKS];
    const mineableBlocks = hasAny(inventoryFromBot(this.bot), PICKAXES)
      ? ["dirt", "grass_block", "stone", "cobblestone", "deepslate", ...LOG_BLOCKS]
      : surfaceBlocks;

    const result = await this.collectBlocks(mineableBlocks, needed, 48);
    if (result.interruptedByThreat) return;
    if (!result.collected) {
      this.logger.info("action=collect_building_materials; no reachable materials, exploring for build blocks");
      await this.explore();
    }
  }

  async buildStarterShelter() {
    if (!this.hasValidPosition(this.bot.entity.position)) return false;

    await this.craftPlanks(Math.min(24, this.config.survival.shelterBlockTarget));
    const beforeMaterials = buildingMaterialCount(inventoryFromBot(this.bot));
    if (beforeMaterials <= 0) {
      this.logger.warn("action=build_starter_shelter; no usable blocks found");
      return false;
    }

    this.resetMotion();
    const base = this.bot.entity.position.floored();
    const plan = this.createStarterShelterPlan(base);
    let completed = 0;
    let placed = 0;

    this.logger.info(`action=build_starter_shelter; origin=${this.formatPosition(base)}; plan=${plan.length}; materials=${beforeMaterials}`);

    for (const position of plan) {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=build_starter_shelter; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        break;
      }

      const result = await this.placeBuildingBlockAt(position);
      if (result.completed) completed++;
      if (result.placed) placed++;
      if (!firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS) && completed < plan.length) break;
    }

    const doorInstalled = await this.installStarterShelterDoor(base);
    const success = completed >= Math.ceil(plan.length * 0.9) && doorInstalled;
    if (success) {
      this.progressState.hasStarterShelter = true;
      this.progressState.starterShelterPosition = { x: base.x, y: base.y, z: base.z };
      this.persistMemory();
    }

    this.logger.info(`action=build_starter_shelter; placed=${placed}; completed=${completed}/${plan.length}; door=${doorInstalled}; success=${success}`);
    return success;
  }

  createStarterShelterPlan(base) {
    return createStarterShelterPlan(base);
  }

  async craftDoor() {
    if (firstInventoryItem(this.bot, DOOR_ITEMS)) return true;
    await this.craftBasicSupplies();
    const inventory = inventoryFromBot(this.bot);
    const plankName = Object.keys(PLANK_TO_DOOR).find((name) => (inventory[name] || 0) >= 6);
    if (!plankName) return false;
    const table = await this.ensurePlacedBlock("crafting_table");
    if (!table) return false;
    return this.craftItem(PLANK_TO_DOOR[plankName], 1, true);
  }

  isDoorBlock(block) {
    return Boolean(block && (DOOR_ITEMS.includes(block.name) || block.name.endsWith("_door")));
  }

  isDefensiveShelterBlock(position) {
    const block = this.bot.blockAt(position);
    return Boolean(block && (block.boundingBox === "block" || this.isDoorBlock(block)));
  }

  isStarterShelterDoorwayDefensible(base) {
    return createStarterShelterDoorwayPlan(base).every((position) => this.isDefensiveShelterBlock(position));
  }

  async installStarterShelterDoor(base) {
    if (this.isStarterShelterDoorwayDefensible(base)) return true;
    if (!(await this.craftDoor())) return false;
    const doorItem = firstInventoryItem(this.bot, DOOR_ITEMS);
    if (!doorItem) return false;

    const [lower, upper] = createStarterShelterDoorwayPlan(base);
    for (const position of [lower, upper]) {
      const block = this.bot.blockAt(position);
      if (block && block.name !== "air" && !this.isDoorBlock(block)) await this.digBlockAt(position);
    }

    const floor = this.bot.blockAt(lower.offset(0, -1, 0));
    if (!floor || floor.boundingBox !== "block") return false;

    await this.bot.equip(doorItem, "hand");
    try {
      await this.withTimeout(this.bot.placeBlock(floor, new Vec3(0, 1, 0)), this.config.survival.placeBlockTimeoutMs, null);
      await this.wait(250);
    } catch (error) {
      this.logger.warn(`action=install_starter_door; failed=${error.message}`);
      return false;
    }

    const installed = this.isStarterShelterDoorwayDefensible(base);
    this.logger.info(`action=install_starter_door; success=${installed}`);
    return installed;
  }

  async craftBasicSupplies() {
    await this.craftPlanks();
    let inventory = inventoryFromBot(this.bot);
    if (!this.hasCraftingTableAccess() && countItems(inventory, PLANK_ITEMS) >= 4) {
      await this.craftItem("crafting_table", 1, false);
    }

    inventory = inventoryFromBot(this.bot);
    if (countItems(inventory, "stick") < 2 && countItems(inventory, PLANK_ITEMS) >= 2) {
      await this.craftItem("stick", 1, false);
    }
  }

  async craftBasicTools() {
    await this.craftBasicSupplies();
    let inventory = inventoryFromBot(this.bot);
    if (!this.hasCraftingTableAccess() || countItems(inventory, PLANK_ITEMS) < 3 || countItems(inventory, "stick") < 2) {
      this.logger.warn("action=craft_basic_tools; missing table, planks, or sticks; collecting more wood");
      await this.collectWood();
      return;
    }

    const table = await this.ensurePlacedBlock("crafting_table");
    if (!table) {
      this.logger.warn("action=craft_basic_tools; failed to place or find crafting table");
      await this.explore();
      return;
    }

    const craftedWoodenPickaxe = await this.craftItem("wooden_pickaxe", 1, true);
    if (!craftedWoodenPickaxe) {
      this.logger.warn("action=craft_basic_tools; wooden pickaxe recipe unavailable; collecting more wood");
      await this.collectWood();
      return;
    }
    if (countItems(inventoryFromBot(this.bot), "cobblestone") >= 3) {
      await this.craftItem("stone_pickaxe", 1, true);
    }
    await this.ensureWoodcuttingTool();
    await this.craftStoneTools();
  }

  async craftStoneTools() {
    await this.craftBasicSupplies();
    if (!this.hasCraftingTableAccess()) {
      this.logger.warn("action=craft_stone_tools; missing crafting table access");
      return false;
    }

    const table = await this.ensurePlacedBlock("crafting_table");
    if (!table) {
      this.logger.warn("action=craft_stone_tools; failed to place or find crafting table");
      return false;
    }

    let crafted = false;
    let inventory = inventoryFromBot(this.bot);

    if (!hasAny(inventory, STONE_OR_BETTER_PICKAXES) && countItems(inventory, "cobblestone") >= 3 && countItems(inventory, "stick") >= 2) {
      crafted = await this.craftItem("stone_pickaxe", 1, true) || crafted;
      inventory = inventoryFromBot(this.bot);
    }

    if (!hasAny(inventory, STONE_OR_BETTER_WEAPONS) && countItems(inventory, "cobblestone") >= 2 && countItems(inventory, "stick") >= 1) {
      crafted = await this.craftItem("stone_sword", 1, true) || crafted;
      inventory = inventoryFromBot(this.bot);
    }

    if (!hasAny(inventory, STONE_OR_BETTER_AXES) && countItems(inventory, "cobblestone") >= 3 && countItems(inventory, "stick") >= 2) {
      crafted = await this.craftItem("stone_axe", 1, true) || crafted;
    }

    if (!crafted) this.logger.info("action=craft_stone_tools; no stone upgrade craftable yet");
    return crafted;
  }

  async ensureWoodcuttingTool() {
    if (hasAny(inventoryFromBot(this.bot), AXES)) return true;

    await this.craftBasicSupplies();
    let inventory = inventoryFromBot(this.bot);
    if (!this.hasCraftingTableAccess()) return false;

    if (countItems(inventory, "stick") < 2 && countItems(inventory, PLANK_ITEMS) >= 2) {
      await this.craftItem("stick", 1, false);
      inventory = inventoryFromBot(this.bot);
    }

    if (countItems(inventory, "cobblestone") >= 3 && countItems(inventory, "stick") >= 2) {
      const table = await this.ensurePlacedBlock("crafting_table");
      if (table && await this.craftItem("stone_axe", 1, true)) return true;
    }

    if (countItems(inventory, PLANK_ITEMS) < 3) {
      await this.craftPlanks(3);
      inventory = inventoryFromBot(this.bot);
    }

    if (countItems(inventory, PLANK_ITEMS) >= 3 && countItems(inventory, "stick") >= 2) {
      const table = await this.ensurePlacedBlock("crafting_table");
      if (table && await this.craftItem("wooden_axe", 1, true)) return true;
    }

    this.logger.info("action=ensure_woodcutting_tool; no axe craftable yet, chopping by hand instead of using a pickaxe");
    return false;
  }

  async collectStone() {
    if (!hasAny(inventoryFromBot(this.bot), PICKAXES)) {
      await this.craftBasicTools();
    }

    await this.equipBestTool("stone");
    const result = await this.collectBlocks(["stone", "cobblestone", "deepslate"], 11, 48, {
      action: "collect_stone",
      safeMining: true,
      maxMineBelow: 0,
      surfaceOnly: true,
      preferSurface: true
    });
    if (result.interruptedByThreat) return;
    if (result.collected) {
      this.surfaceStoneSearchAttempts = 0;
      return;
    }

    this.surfaceStoneSearchAttempts++;
    if (this.surfaceStoneSearchAttempts <= 3) {
      this.logger.info(`action=collect_stone; no surface stone found, exploring for easier exposed stone (${this.surfaceStoneSearchAttempts}/3)`);
      await this.exploreForSurfaceStone();
      return;
    }

    this.logger.info("action=collect_stone; surface stone search exhausted, digging a stair mine probe");
    await this.excavateMineProbe();
  }

  async exploreForSurfaceStone() {
    const candidate = this.findPreferredMineableBlock(["stone", "cobblestone", "deepslate"], this.config.survival.mineSearchRadius, {
      action: "collect_stone",
      maxMineBelow: 0,
      surfaceOnly: true,
      preferSurface: true,
      safeMining: true
    });

    if (candidate) {
      const standPosition = this.findSafeMiningStandPositions(candidate.position)[0];
      if (standPosition) {
        this.logger.info(`action=explore_surface_stone; target=${candidate.name}; pos=${this.formatPosition(candidate.position)}; stand=${this.formatPosition(standPosition)}`);
        const reached = await this.gotoNear(standPosition.x, standPosition.y, standPosition.z, 2, {
          label: "surface_stone",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 10000),
          learnPosition: standPosition,
          target: candidate.name,
          radius: 8
        });
        if (reached) return true;
      }
    }

    await this.explore();
    return false;
  }

  async craftFurnace() {
    await this.ensurePlacedBlock("crafting_table");
    await this.craftItem("furnace", 1, true);
  }

  async craftWeapon() {
    await this.craftBasicSupplies();
    await this.ensurePlacedBlock("crafting_table");
    if (countItems(inventoryFromBot(this.bot), "cobblestone") >= 2) {
      await this.craftItem("stone_sword", 1, true);
    } else {
      await this.craftItem("wooden_sword", 1, true);
    }
  }

  async explore() {
    if (this.config.survival.avoidNightExploration !== false && this.isNight()) {
      await this.holdPositionSafely();
      return;
    }

    const origin = this.bot.entity.position;
    if (!this.hasValidPosition(origin)) {
      this.logger.warn("action=explore; skipped because position is not valid yet");
      return;
    }

    const target = {
      x: origin.x + this.randomOffset(),
      y: origin.y,
      z: origin.z + this.randomOffset()
    };
    this.logger.info(`action=explore; from=${this.formatPosition(origin)}; target=${this.formatPosition(target)}`);
    await this.gotoNear(target.x, target.y, target.z, 4, {
      label: "explore",
      learnPosition: new Vec3(target.x, target.y, target.z),
      target: "random_walk",
      radius: 10
    });
    this.logger.info(`action=explore; arrived=${this.formatPosition(this.bot.entity.position)}`);
  }

  async craftPlanks(targetPlanks = 8) {
    const inventory = inventoryFromBot(this.bot);
    const currentPlanks = countItems(inventory, PLANK_ITEMS);
    if (currentPlanks >= targetPlanks) return;

    const logName = Object.keys(LOG_TO_PLANKS).find((name) => inventory[name] > 0);
    if (!logName) return;
    const logsToCraft = Math.min(inventory[logName], Math.ceil((targetPlanks - currentPlanks) / 4));
    await this.craftItem(LOG_TO_PLANKS[logName], logsToCraft, false);
  }

  async craftItem(itemName, count, requireTable) {
    const item = this.mcData.itemsByName[itemName];
    if (!item) {
      this.logger.warn(`unknown item: ${itemName}`);
      return false;
    }

    const table = requireTable ? await this.ensurePlacedBlock("crafting_table") : null;
    if (requireTable && !table) return false;

    const recipe = this.bot.recipesFor(item.id, null, 1, table)[0];
    if (!recipe) {
      this.logger.warn(`no available recipe for ${itemName}`);
      return false;
    }

    try {
      await this.bot.craft(recipe, count, table);
      this.logger.info(`action=craft_item; item=${itemName}; count=${count}`);
      return true;
    } catch (error) {
      this.logger.warn(`action=craft_item; item=${itemName}; failed=${error.message}`);
      this.recordActionFailure("craft_item", error.message, table?.position ?? this.bot.entity?.position, {
        target: itemName,
        radius: 6
      });
      return false;
    }
  }

  async collectBlocks(blockNames, count, maxDistance, options = {}) {
    const action = options.action ?? "collect_blocks";
    const blockIds = blockNames
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);

    if (blockIds.length === 0) return { collected: false, interruptedByThreat: false };
    const positions = this.bot.findBlocks({ matching: blockIds, maxDistance, count: Math.max(count * 4, 16) });
    const blocks = this.rankMineableBlocks(positions, { ...options, action })
      .slice(0, count);
    if (blocks.length === 0) return { collected: false, interruptedByThreat: false };

    if (options.safeMining) {
      return this.collectMineableBlocksSafely(blocks, count, { ...options, action });
    }

    await this.equipToolForBlock(blocks[0]);
    const heldTool = this.bot.heldItem?.name ?? "empty_hand";
    this.logger.info(`action=collect_blocks; targets=${blocks.map((block) => block.name).join(",")}; count=${blocks.length}; tool=${heldTool}`);
    let interruptedByThreat = null;
    let interruptedByHazard = null;
    let rejectForThreat = null;
    const threatPromise = new Promise((_, reject) => {
      rejectForThreat = reject;
    });
    const monitor = setInterval(() => {
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (!threat || interruptedByThreat) return;
      interruptedByThreat = threat;
      this.logger.warn(`action=collect_blocks; interrupted by ${threat.name} at ${threat.position.distanceTo(this.bot.entity.position).toFixed(1)} blocks`);
      void this.cancelCollectTask();
      this.resetMotion();
      rejectForThreat(new Error(`collection interrupted by ${threat.name}`));
      return;
    }, 500);
    const hazardMonitor = setInterval(() => {
      const hazard = this.findNearbyDamagingBlock(this.bot.entity.position, 1.5);
      if (!hazard || interruptedByHazard) return;
      interruptedByHazard = hazard;
      this.logger.warn(`action=collect_blocks; interrupted by damaging block=${hazard.name} at ${hazard.distance.toFixed(1)} blocks`);
      void this.cancelCollectTask();
      this.resetMotion();
      rejectForThreat(new Error(`collection interrupted by ${hazard.name}`));
    }, 500);

    try {
      await this.withTimeout(
        Promise.race([
          this.bot.collectBlock.collect(blocks, { ignoreNoPath: true, count }),
          threatPromise
        ]),
        this.config.survival.actionTimeoutMs,
        async () => {
          this.logger.warn(`action=collect_blocks; timed out after ${this.config.survival.actionTimeoutMs}ms`);
          await this.cancelCollectTask();
          this.resetMotion();
        }
      );
      this.recordActionSuccess(action, blocks[0].position, { target: blocks[0].name });
      return { collected: !interruptedByThreat, interruptedByThreat: Boolean(interruptedByThreat) };
    } catch (error) {
      if (blocks[0]) {
        this.recordActionFailure(action, error.message, blocks[0].position, {
          target: blocks[0].name,
          radius: 8
        });
      }
      if (interruptedByHazard) {
        await this.escapeHazardBlock(interruptedByHazard);
        return { collected: false, interruptedByThreat: false, interruptedByHazard: true };
      }
      if (interruptedByThreat) {
        await this.panicRetreatFrom(interruptedByThreat, this.config.survival.panicRetreatMs);
        return { collected: false, interruptedByThreat: true };
      }
      this.logger.warn(`action=collect_blocks; failed=${error.message}`);
      return { collected: false, interruptedByThreat: false };
    } finally {
      clearInterval(monitor);
      clearInterval(hazardMonitor);
    }
  }

  async cancelCollectTask() {
    try {
      const cancelTask = this.bot.collectBlock?.cancelTask?.();
      if (cancelTask && typeof cancelTask.then === "function") {
        await Promise.race([cancelTask, this.wait(500)]);
      }
    } catch (error) {
      this.logger.debug("collect cancel failed", error.message);
    }
  }

  findPreferredMineableBlock(blockNames, maxDistance, options = {}) {
    const blockIds = blockNames
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id) => id !== undefined);
    if (blockIds.length === 0 || !this.hasValidPosition(this.bot.entity?.position)) return null;

    const positions = this.bot.findBlocks({ matching: blockIds, maxDistance, count: 96 });
    return this.rankMineableBlocks(positions, options)[0] ?? null;
  }

  rankMineableBlocks(positions, options = {}) {
    if (!this.hasValidPosition(this.bot.entity?.position)) return [];
    const action = options.action ?? "collect_blocks";
    const candidates = positions
      .map((position) => this.bot.blockAt(position))
      .filter((block) => block && !this.isDamagingBlock(block) && !this.isLearnedAvoidPosition(block.position, action, block.name))
      .map((block) => ({
        block,
        position: block.position,
        isSurface: (options.preferSurface || options.surfaceOnly) ? this.isSurfaceMiningTarget(block) : false
      }))
      .filter((candidate) => !options.safeMining || this.isSafeMiningTarget(candidate.block, options))
      .filter((candidate) => !options.surfaceOnly || candidate.isSurface);

    return sortMiningTargets(candidates, this.bot.entity.position, options).map((candidate) => candidate.block);
  }

  async collectMineableBlocksSafely(blocks, count, options = {}) {
    const action = options.action ?? "collect_blocks";
    let collected = 0;

    for (const plannedBlock of blocks) {
      if (collected >= count) break;
      const threat = this.nearestEntity((entity) => HOSTILE_MOBS.has(entity.name), this.config.survival.threatRadius);
      if (threat) {
        this.logger.warn(`action=${action}; interrupted by ${threat.name}`);
        await this.panicRetreatFrom(threat, this.config.survival.panicRetreatMs);
        return { collected: collected > 0, interruptedByThreat: true };
      }

      const block = this.bot.blockAt(plannedBlock.position);
      if (!block || block.name === "air" || this.isDamagingBlock(block) || !this.isSafeMiningTarget(block, options)) continue;

      const standPositions = this.findSafeMiningStandPositions(block.position)
        .filter((position) => !this.isLearnedAvoidPosition(position, action, block.name))
        .slice(0, 3);
      if (standPositions.length === 0) {
        this.recordActionFailure(action, "no_safe_mining_stand", block.position, { target: block.name, radius: 6 });
        continue;
      }

      let reachedStand = false;
      for (const standPosition of standPositions) {
        const reached = await this.gotoNear(standPosition.x, standPosition.y, standPosition.z, 1, {
          label: `${action}_stand`,
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
          learnPosition: standPosition,
          target: block.name,
          radius: 6
        });
        if (reached && this.distanceBetweenPositions(this.bot.entity.position, standPosition) <= 2.2) {
          reachedStand = true;
          break;
        }
      }

      if (!reachedStand) {
        this.recordActionFailure(action, "safe_mining_stand_unreachable", block.position, { target: block.name, radius: 8 });
        continue;
      }

      await this.equipToolForBlock(block);
      this.logger.info(`action=${action}; target=${block.name}; pos=${this.formatPosition(block.position)}; mode=safe_side_dig`);
      if (await this.digBlockAt(block.position)) {
        collected++;
        this.recordActionSuccess(action, block.position, { target: block.name });
        await this.collectNearbyItems({ maxDistance: 5, range: 1, avoidDamagingBlocks: true });
      } else {
        this.recordActionFailure(action, "dig_failed", block.position, { target: block.name, radius: 6 });
      }
    }

    return { collected: collected > 0, interruptedByThreat: false };
  }

  isSafeMiningTarget(block, options = {}) {
    if (!block || block.name === "air" || this.isDamagingBlock(block) || block.diggable === false) return false;
    if (this.isWaterBlock(block) || this.isWaterBlock(this.bot.blockAt(block.position.offset(0, 1, 0)))) return false;
    if (!this.hasValidPosition(this.bot.entity?.position)) return false;

    const botFeet = this.bot.entity.position.floored();
    const maxMineBelow = options.maxMineBelow ?? 0;
    if (block.position.y < botFeet.y - maxMineBelow) return false;
    if (this.sameBlockPosition(block.position, botFeet.offset(0, -1, 0))) return false;
    if (options.surfaceOnly && !this.isSurfaceMiningTarget(block)) return false;

    return this.findSafeMiningStandPositions(block.position).length > 0;
  }

  isSurfaceMiningTarget(block) {
    if (!block || block.name === "air" || this.isDamagingBlock(block)) return false;
    const aboveTarget = block.position.offset(0, 1, 0);
    if (this.isPassableBlockAt(aboveTarget) && this.hasOpenSkyColumn(aboveTarget, 18)) return true;

    return this.findSafeMiningStandPositions(block.position).some((standPosition) => {
      return standPosition.y >= block.position.y && this.hasOpenSkyColumn(standPosition.offset(0, 1, 0), 18);
    });
  }

  hasOpenSkyColumn(position, maxHeight = 18) {
    if (!this.hasValidPosition(position)) return false;
    const base = position.floored();
    for (let y = 0; y <= maxHeight; y++) {
      const block = this.bot.blockAt(base.offset(0, y, 0));
      if (!block) return false;
      if (block.boundingBox === "block") return false;
    }
    return true;
  }

  isPassableBlockAt(position) {
    const block = this.bot.blockAt(position);
    return Boolean(block && block.boundingBox !== "block" && !this.isDamagingBlock(block) && !this.isWaterBlock(block));
  }

  findSafeMiningStandPositions(blockPosition) {
    const offsets = [];
    for (const direction of CARDINAL_DIRECTIONS) {
      for (const yOffset of [0, -1, 1]) {
        offsets.push(direction.offset(0, yOffset, 0));
      }
    }

    return offsets
      .map((offset) => blockPosition.plus(offset))
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2))
      .sort((left, right) => this.distanceBetweenPositions(this.bot.entity.position, left) - this.distanceBetweenPositions(this.bot.entity.position, right));
  }

  isLikelyPitPosition(position = this.bot.entity?.position) {
    if (!this.hasValidPosition(position)) return false;
    const base = position.floored();
    const sameLevelExit = CARDINAL_DIRECTIONS.some((direction) => {
      return [0, 1].some((yOffset) => this.isSafeStandPosition(base.plus(direction).offset(0, yOffset, 0)));
    });
    if (sameLevelExit) return false;

    const rim = this.findPitRimCandidate(base);
    if (!rim) return false;

    const recentMiningAction = ["collect_stone", "mine_advanced_materials", "craft_stone_tools", "escape_pit"].includes(this.lastAction?.type);
    if (!recentMiningAction && rim.y - base.y < 3) return false;

    const blockingSides = CARDINAL_DIRECTIONS.filter((direction) => {
      const feet = this.bot.blockAt(base.plus(direction));
      const head = this.bot.blockAt(base.plus(direction).offset(0, 1, 0));
      return this.isDiggableSolidBlock(feet) || this.isDiggableSolidBlock(head);
    }).length;

    return blockingSides >= 2;
  }

  findPitRimCandidate(position = this.bot.entity?.position, maxRise = 5, radius = 5) {
    if (!this.hasValidPosition(position)) return null;
    const base = position.floored();

    for (let yOffset = 1; yOffset <= maxRise; yOffset++) {
      const candidates = [];
      for (let x = -radius; x <= radius; x++) {
        for (let z = -radius; z <= radius; z++) {
          if (Math.abs(x) !== radius && Math.abs(z) !== radius && Math.max(Math.abs(x), Math.abs(z)) > yOffset + 1) continue;
          if (x === 0 && z === 0) continue;
          candidates.push(base.offset(x, yOffset, z));
        }
      }

      const safe = candidates
        .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.2))
        .sort((left, right) => this.distanceBetweenPositions(base, left) - this.distanceBetweenPositions(base, right))[0];
      if (safe) return safe;
    }

    return null;
  }

  async carveAscendingEscapeStair(direction, steps = 5) {
    const cardinal = normalizeCardinalDirection(direction);
    const start = this.bot.entity.position.floored();
    let moved = 0;

    for (const stair of createAscendingStairPlan(start, cardinal, steps)) {
      if (!this.hasSolidSupport(stair.support)) {
        const placedSupport = await this.placeEmergencySupport(stair.support);
        if (!placedSupport) break;
      }

      await this.digBlockAt(stair.feet);
      await this.digBlockAt(stair.head);
      if (!this.isSafeStandPosition(stair.feet)) break;

      const reached = await this.gotoNear(stair.feet.x, stair.feet.y, stair.feet.z, 1, {
        label: "escape_pit_stair",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
        learnPosition: stair.feet,
        target: "pit_stair",
        radius: 6
      });
      if (!reached) break;
      moved++;

      const rim = this.findPitRimCandidate(this.bot.entity.position, 2, 4);
      if (!this.isLikelyPitPosition(this.bot.entity.position)) return true;
      if (rim) {
        const reachedRim = await this.gotoNear(rim.x, rim.y, rim.z, 1, {
          label: "escape_pit_rim",
          timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 7000),
          learnPosition: rim,
          target: "pit_rim"
        });
        if (reachedRim) return true;
      }
    }

    this.logger.warn(`action=escape_pit; stair_moved=${moved}/${steps}`);
    return moved > 0 && !this.isLikelyPitPosition(this.bot.entity.position);
  }

  async placeEmergencySupport(position) {
    const item = firstInventoryItem(this.bot, ["dirt", "cobblestone", ...PLANK_ITEMS, ...LOG_BLOCKS]);
    if (!item) return false;
    await this.bot.equip(item, "hand");
    return this.placeBlockAt(position);
  }

  hasSolidSupport(position) {
    const block = this.bot.blockAt(position);
    return Boolean(block && block.boundingBox === "block" && !this.isDamagingBlock(block));
  }

  isDiggableSolidBlock(block) {
    return Boolean(block && block.boundingBox === "block" && block.diggable !== false && !this.isDamagingBlock(block));
  }

  async ensurePlacedBlock(itemName) {
    const blockId = this.mcData.blocksByName[itemName]?.id;
    if (!blockId) return null;

    const existing = this.findNearbyBlock(itemName, 16);
    if (existing) {
      if (itemName === "crafting_table") this.rememberBlock("crafting_table", existing.position);
      try {
        await this.withTimeout(
          this.bot.pathfinder.goto(new GoalLookAtBlock(existing.position, this.bot.world)),
          this.config.survival.placeBlockTimeoutMs,
          () => this.resetMotion()
        );
      } catch (error) {
        this.logger.debug("look at crafting table failed", error.message);
      }
      return existing;
    }

    if (itemName === "crafting_table") {
      const knownTable = this.nearestKnownBlockEntry("crafting_table", this.bot.entity.position, this.config.memory?.knownBlockSearchRadius ?? 96);
      if (knownTable) {
        this.logger.info(`memory=use_known_block; block=crafting_table; pos=${this.formatPosition(knownTable.position)}; distance=${knownTable.distance.toFixed(1)}`);
        await this.gotoNear(knownTable.position.x, knownTable.position.y, knownTable.position.z, 2);
        const rememberedBlock = this.bot.blockAt(new Vec3(knownTable.position.x, knownTable.position.y, knownTable.position.z));
        if (rememberedBlock?.name === "crafting_table") {
          this.rememberBlock("crafting_table", rememberedBlock.position);
          return rememberedBlock;
        }
        this.forgetBlock("crafting_table", knownTable.position);
      }
    }

    const item = firstInventoryItem(this.bot, itemName);
    if (!item) return null;

    const placement = this.findPlacementReference();
    if (!placement) return null;

    await this.bot.equip(item, "hand");
    try {
      await this.withTimeout(
        this.bot.placeBlock(placement.block, placement.face),
        this.config.survival.placeBlockTimeoutMs,
        () => this.resetMotion()
      );
    } catch (error) {
      this.logger.debug("place crafting table failed", error.message);
      return null;
    }
    await this.wait(500);
    const placedBlock = this.findNearbyBlock(itemName, 6);
    if (placedBlock && itemName === "crafting_table") this.rememberBlock("crafting_table", placedBlock.position);
    return placedBlock;
  }

  async placeBlockAt(targetPosition) {
    const target = this.bot.blockAt(targetPosition);
    if (!target || target.boundingBox === "block") return false;

    if (target.name !== "air") {
      try {
        await this.withTimeout(this.bot.dig(target, true), this.config.survival.placeBlockTimeoutMs, null);
        await this.wait(100);
      } catch (error) {
        this.logger.debug("clear target before placing failed", error.message);
      }
    }

    const faces = [
      new Vec3(0, 1, 0),
      new Vec3(0, -1, 0),
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1)
    ];

    for (const face of faces) {
      const reference = this.bot.blockAt(targetPosition.minus(face));
      if (!reference || reference.name === "air" || reference.boundingBox !== "block") continue;
      try {
        await this.withTimeout(this.bot.placeBlock(reference, face), this.config.survival.placeBlockTimeoutMs, null);
        await this.wait(150);
        return true;
      } catch (error) {
        this.logger.debug("place block failed", error.message);
      }
    }

    return false;
  }

  async placeBuildingBlockAt(targetPosition) {
    const target = this.bot.blockAt(targetPosition);
    if (target && target.boundingBox === "block") return { completed: true, placed: false };
    if (!target) return { completed: false, placed: false };

    const item = firstInventoryItem(this.bot, SHELTER_BLOCK_ITEMS);
    if (!item) return { completed: false, placed: false };

    await this.bot.equip(item, "hand");
    const placed = await this.placeBlockAt(targetPosition);
    return { completed: placed, placed };
  }

  findPlacementReference() {
    const base = this.bot.entity.position.floored();
    const offsets = [
      new Vec3(1, -1, 0),
      new Vec3(-1, -1, 0),
      new Vec3(0, -1, 1),
      new Vec3(0, -1, -1)
    ];

    for (const offset of offsets) {
      const ground = this.bot.blockAt(base.plus(offset));
      const target = this.bot.blockAt(base.plus(offset).offset(0, 1, 0));
      if (ground && target && ground.boundingBox === "block" && target.name === "air") {
        return { block: ground, face: new Vec3(0, 1, 0) };
      }
    }

    return null;
  }

  async equipBestWeapon() {
    const item = firstInventoryItem(this.bot, WEAPONS);
    if (item) await this.bot.equip(item, "hand");
  }

  async equipToolForBlock(block) {
    if (!block) return;

    if (LOG_BLOCKS.includes(block.name)) {
      const axe = firstInventoryItem(this.bot, AXES);
      if (axe) {
        await this.bot.equip(axe, "hand");
        return;
      }
      await this.unequipHandIfHolding([...PICKAXES, ...HOES, ...WEAPONS.filter((name) => !AXES.includes(name))]);
      return;
    }

    await this.equipBestTool(block.name);
  }

  async unequipHandIfHolding(itemNames) {
    const held = this.bot.heldItem;
    if (!held || !itemNames.includes(held.name)) return;
    try {
      await this.bot.unequip("hand");
    } catch (error) {
      this.logger.debug(`unequip hand failed: ${error.message}`);
    }
  }

  baitForAnimal(animalName) {
    const baitByAnimal = {
      cow: ["wheat"],
      sheep: ["wheat"],
      pig: ["carrot", "potato"],
      chicken: ["wheat_seeds", "beetroot_seeds"],
      rabbit: ["carrot"]
    };
    return firstInventoryItem(this.bot, baitByAnimal[animalName] || []);
  }

  async digBlockAt(position) {
    const block = this.bot.blockAt(position);
    if (!block || block.name === "air" || block.name.includes("water") || this.isDamagingBlock(block) || block.diggable === false) {
      return false;
    }

    await this.equipBestTool(block.name);
    try {
      await this.withTimeout(this.bot.dig(block, true), this.config.survival.actionTimeoutMs, () => this.resetMotion());
      return true;
    } catch (error) {
      this.logger.debug(`dig block failed at ${this.formatPosition(position)}: ${error.message}`);
      return false;
    }
  }

  async equipBestTool(blockName) {
    if (this.bot.tool && this.mcData.blocksByName[blockName]) {
      const block = this.bot.findBlock({ matching: this.mcData.blocksByName[blockName].id, maxDistance: 16 });
      if (block) await this.bot.tool.equipForBlock(block);
    }
  }

  isDamagingBlock(block) {
    return Boolean(block && DAMAGING_BLOCK_NAMES.has(block.name));
  }

  isWaterBlock(block) {
    return Boolean(block && WATER_BLOCK_NAMES.has(block.name));
  }

  findNearbyDamagingBlock(position, radius = 1.5) {
    if (!this.mcData || !this.hasValidPosition(position)) return null;

    const base = position.floored();
    const searchRadius = Math.ceil(radius);
    let nearest = null;

    for (let x = -searchRadius; x <= searchRadius; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -searchRadius; z <= searchRadius; z++) {
          const block = this.bot.blockAt(base.offset(x, y, z));
          if (!this.isDamagingBlock(block)) continue;
          const distance = block.position.offset(0.5, 0.5, 0.5).distanceTo(position);
          if (distance > radius + 0.75 || !this.isTouchingDamagingBlock(block, base)) continue;
          if (!nearest || distance < nearest.distance) {
            nearest = { name: block.name, position: block.position, distance };
          }
        }
      }
    }

    return nearest;
  }

  isTouchingDamagingBlock(block, feetPosition) {
    if (!block || !feetPosition) return false;
    const headPosition = feetPosition.offset(0, 1, 0);
    const groundPosition = feetPosition.offset(0, -1, 0);

    if (["sweet_berry_bush", "wither_rose"].includes(block.name)) {
      return this.sameBlockPosition(block.position, feetPosition) || this.sameBlockPosition(block.position, headPosition);
    }

    if (block.name === "magma_block") {
      return this.sameBlockPosition(block.position, groundPosition);
    }

    if (["fire", "soul_fire", "lava", "pointed_dripstone"].includes(block.name)) {
      return [feetPosition, headPosition, groundPosition].some((position) => this.sameBlockPosition(block.position, position));
    }

    if (block.name === "cactus") {
      const sameHeight = block.position.y === feetPosition.y || block.position.y === headPosition.y;
      const touchingX = Math.abs(block.position.x - feetPosition.x) <= 1 && block.position.z === feetPosition.z;
      const touchingZ = Math.abs(block.position.z - feetPosition.z) <= 1 && block.position.x === feetPosition.x;
      return sameHeight && (touchingX || touchingZ);
    }

    return this.sameBlockPosition(block.position, feetPosition) || this.sameBlockPosition(block.position, headPosition);
  }

  sameBlockPosition(left, right) {
    return Boolean(left && right && left.x === right.x && left.y === right.y && left.z === right.z);
  }

  isSafeStandPosition(position) {
    if (!this.hasValidPosition(position)) return false;
    const base = position.floored();
    const feet = this.bot.blockAt(base);
    const head = this.bot.blockAt(base.offset(0, 1, 0));
    const ground = this.bot.blockAt(base.offset(0, -1, 0));
    if (this.isWaterBlock(feet) || this.isWaterBlock(head) || this.isWaterBlock(ground)) return false;
    if (this.isDamagingBlock(feet) || this.isDamagingBlock(head) || this.isDamagingBlock(ground)) return false;
    if (feet?.boundingBox === "block" || head?.boundingBox === "block") return false;
    return Boolean(ground && ground.boundingBox === "block");
  }

  findSafeAdjacentStandPosition(blockPosition) {
    return this.findSafeAdjacentStandPositions(blockPosition)[0] ?? null;
  }

  findSafeAdjacentStandPositions(blockPosition) {
    const offsets = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(1, 0, 1),
      new Vec3(1, 0, -1),
      new Vec3(-1, 0, 1),
      new Vec3(-1, 0, -1)
    ];

    return offsets
      .map((offset) => blockPosition.plus(offset))
      .filter((candidate) => this.isSafeStandPosition(candidate) && !this.findNearbyDamagingBlock(candidate, 1.1))
      .sort((left, right) => this.distanceBetweenPositions(this.bot.entity.position, left) - this.distanceBetweenPositions(this.bot.entity.position, right));
  }

  async reachFirstSafeBerryPosition(safePositions) {
    for (const safePosition of safePositions) {
      const reached = await this.gotoNear(safePosition.x, safePosition.y, safePosition.z, 1, {
        label: "forage_berry",
        timeoutMs: Math.min(this.config.survival.actionTimeoutMs, 8000),
        learnPosition: safePosition,
        target: "sweet_berry_bush"
      });
      if (reached && this.distanceBetweenPositions(this.bot.entity.position, safePosition) <= 2.1) return safePosition;

      this.recordActionFailure("forage_food", "safe_position_unreachable", safePosition, {
        target: "sweet_berry_bush",
        radius: 5
      });
    }

    return null;
  }

  async collectNearbyItems(options = {}) {
    const maxDistance = options.maxDistance ?? 12;
    const range = options.range ?? 1;
    const item = this.nearestEntity((entity) => {
      if (entity.name !== "item") return false;
      return !options.avoidDamagingBlocks || !this.findNearbyDamagingBlock(entity.position, 1.2);
    }, maxDistance);
    if (!item) return false;
    await this.gotoNear(item.position.x, item.position.y, item.position.z, range);
    return true;
  }

  maxStackCount(inventory, names) {
    return names.reduce((largest, name) => Math.max(largest, inventory[name] || 0), 0);
  }

  distanceBetweenPositions(left, right) {
    if (!this.hasValidPosition(left) || !this.hasValidPosition(right)) return Number.POSITIVE_INFINITY;
    const deltaX = left.x - right.x;
    const deltaY = left.y - right.y;
    const deltaZ = left.z - right.z;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
  }

  cardinalDirection() {
    const yaw = this.bot.entity?.yaw ?? 0;
    const x = Math.round(-Math.sin(yaw));
    const z = Math.round(-Math.cos(yaw));
    if (x === 0 && z === 0) return new Vec3(1, 0, 0);
    return new Vec3(x, 0, z);
  }

  prioritizedCardinalDirections() {
    const preferred = normalizeCardinalDirection(this.cardinalDirection());
    return [
      preferred,
      ...CARDINAL_DIRECTIONS.filter((direction) => direction.x !== preferred.x || direction.z !== preferred.z)
    ];
  }

  nearestEntity(predicate, maxDistance) {
    const position = this.bot.entity.position;
    if (!this.hasValidPosition(position)) return null;
    return Object.values(this.bot.entities)
      .filter((entity) => entity !== this.bot.entity && entity.name && this.hasValidPosition(entity.position) && predicate(entity))
      .map((entity) => ({ entity, distance: entity.position.distanceTo(position) }))
      .filter(({ distance }) => distance <= maxDistance)
      .sort((left, right) => left.distance - right.distance)[0]?.entity;
  }

  async gotoNear(x, y, z, range, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.config.survival.actionTimeoutMs;
    const label = options.label ?? "goto";
    try {
      await this.withTimeout(
        this.bot.pathfinder.goto(new GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), range)),
        timeoutMs,
        () => {
          this.logger.warn(`action=${label}; timed out after ${timeoutMs}ms`);
          this.resetMotion();
        }
      );
      return true;
    } catch (error) {
      this.logger.warn(`pathfinder ${label} failed=${error.message}`);
      if (options.learnPosition) {
        this.recordActionFailure(label, error.message, options.learnPosition, {
          target: options.target,
          radius: options.radius ?? 6
        });
      }
      return false;
    }
  }

  async gotoBlock(position, options = {}) {
    const timeoutMs = options.timeoutMs ?? this.config.survival.actionTimeoutMs;
    const label = options.label ?? "goto_block";
    try {
      await this.withTimeout(
        this.bot.pathfinder.goto(new GoalBlock(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z))),
        timeoutMs,
        () => {
          this.logger.warn(`action=${label}; timed out after ${timeoutMs}ms`);
          this.resetMotion();
        }
      );
      return true;
    } catch (error) {
      this.logger.warn(`pathfinder ${label} failed=${error.message}`);
      if (options.learnPosition !== false) {
        this.recordActionFailure(label, error.message, position, {
          target: options.target,
          radius: options.radius ?? 6
        });
      }
      return false;
    }
  }

  withTimeout(promise, timeoutMs, onTimeout) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(async () => {
        try {
          await onTimeout?.();
        } catch (error) {
          this.logger.debug("timeout cleanup failed", error.message);
        }
        reject(new Error(`action timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  randomOffset() {
    const radius = this.config.survival.exploreRadius;
    const sign = Math.random() > 0.5 ? 1 : -1;
    return sign * Math.floor(radius / 2 + Math.random() * radius);
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  formatPosition(position) {
    if (!this.hasValidPosition(position)) return "unknown";
    return `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`;
  }

  hasValidPosition(position) {
    return position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  }

  isNight() {
    const timeOfDay = this.bot.time?.timeOfDay;
    return typeof timeOfDay === "number" && timeOfDay >= 12541 && timeOfDay <= 23458;
  }
}

module.exports = { SurvivalController };