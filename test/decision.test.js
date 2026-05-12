const assert = require("node:assert/strict");
const test = require("node:test");
const { decideNextTask } = require("../src/survival/decision");

const config = {
  survival: {
    criticalHealth: 8,
    lowFood: 14,
    emergencyFood: 8,
    threatRadius: 20,
    safeModeThreatRadius: 28,
    immediateThreatRadius: 8,
    shelterDefenseRadius: 4,
    foodStockTarget: 18,
    buildShelter: true,
    shelterBlockTarget: 160,
    woolTarget: 3,
    plantCrops: true,
    cropPlotTarget: 6,
    buildAnimalPen: true,
    animalPenBlockTarget: 32,
    advancedMaterialTarget: 8,
    avoidNightExploration: true
  }
};

function snapshot(overrides = {}) {
  return {
    health: 20,
    food: 20,
    oxygen: 20,
    inventory: {},
    entities: [],
    isInLava: false,
    isNight: false,
    timeSinceOnGround: 0,
    progress: {
      hasStarterShelter: false
    },
    ...overrides
  };
}

test("eats before doing normal work when health is critical and food exists", () => {
  const decision = decideNextTask(snapshot({ health: 6, inventory: { cooked_beef: 1 } }), config);
  assert.equal(decision.type, "eat_food");
});

test("stabilizes starvation instead of random evasion when critical health has no nearby hostile", () => {
  const decision = decideNextTask(snapshot({ health: 1, food: 0, inventory: {} }), config);
  assert.equal(decision.type, "recover_starvation");
});

test("critical starvation still evades an immediate nearby hostile", () => {
  const decision = decideNextTask(snapshot({
    health: 1,
    food: 0,
    inventory: {},
    entities: [{ name: "zombie", distance: 4 }]
  }), config);
  assert.equal(decision.type, "evade_hostiles");
  assert.equal(decision.target, "zombie");
});

test("critical starvation evades night hostile pressure before passive recovery", () => {
  const decision = decideNextTask(snapshot({
    health: 1,
    food: 0,
    isNight: true,
    inventory: {},
    entities: [{ name: "skeleton", distance: 26 }]
  }), config);
  assert.equal(decision.type, "evade_hostiles");
  assert.equal(decision.target, "skeleton");
});

test("escapes damaging plant blocks before normal work", () => {
  const decision = decideNextTask(snapshot({
    environmentHazard: { name: "sweet_berry_bush", distance: 0.4 }
  }), config);
  assert.equal(decision.type, "escape_hazard");
});

test("escapes falling block entrapment before normal work", () => {
  const decision = decideNextTask(snapshot({
    inventory: { dirt: 16 },
    fallingBlockHazard: {
      name: "sand",
      reason: "body_space_occupied_by_falling_block"
    }
  }), config);

  assert.equal(decision.type, "escape_hazard");
  assert.match(decision.reason, /falling block entrapment/);
});

test("opens a daylight confined-space exit before normal resource work", () => {
  const decision = decideNextTask(snapshot({
    inventory: { spruce_log: 16 },
    terrain: {
      spatialStructure: {
        type: "sealed_cell",
        summary: "space=sealed_cell; connectedStand=2; exits=0; action=create_or_open_exit",
        recommendedAction: "create_or_open_exit"
      }
    }
  }), config);

  assert.equal(decision.type, "create_or_open_exit");
});

test("escapes a navigation pit before normal mining or crafting", () => {
  const decision = decideNextTask(snapshot({
    navigationTrap: true,
    navigationAnalysis: { summary: "navigation trap: elevated support column; recommended=controlled_descent" },
    inventory: { wooden_pickaxe: 1, cobblestone: 3, stick: 2 },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "escape_pit");
  assert.match(decision.reason, /controlled_descent/);
});

test("does not escape ordinary water while oxygen buffer remains", () => {
  const decision = decideNextTask(snapshot({ oxygen: 12, isBodyInWater: true, inventory: { oak_log: 1 } }), {
    survival: { ...config.survival, lowOxygenThreshold: 8 }
  });

  assert.notEqual(decision.type, "escape_hazard");
});

test("escapes low oxygen before waiting for drowning damage", () => {
  const decision = decideNextTask(snapshot({ oxygen: 8, isBodyInWater: true }), {
    survival: { ...config.survival, lowOxygenThreshold: 8 }
  });

  assert.equal(decision.type, "escape_hazard");
});

test("descends from an elevated platform before collecting wood", () => {
  const decision = decideNextTask(snapshot({
    terrain: {
      descent: {
        needsDescent: true,
        summary: "elevated platform: water landing 20 blocks below",
        bestTarget: {
          waterPosition: { x: 4, y: 60, z: 4 },
          entryPosition: { x: 4, y: 61, z: 4 },
          drop: 20
        }
      }
    },
    inventory: {}
  }), config);

  assert.equal(decision.type, "descend_from_platform");
  assert.deepEqual(decision.targetPosition, { x: 4, y: 61, z: 4 });
});

test("eats before platform descent when health is critical", () => {
  const decision = decideNextTask(snapshot({
    health: 6,
    inventory: { cooked_beef: 1 },
    terrain: {
      descent: {
        needsDescent: true,
        summary: "elevated platform: water landing 20 blocks below",
        bestTarget: {
          waterPosition: { x: 4, y: 60, z: 4 },
          entryPosition: { x: 4, y: 61, z: 4 },
          drop: 20
        }
      }
    }
  }), config);

  assert.equal(decision.type, "eat_food");
});

test("near-death health holds recovery before platform descent", () => {
  const decision = decideNextTask(snapshot({
    health: 0.5,
    food: 16,
    inventory: {},
    terrain: {
      descent: {
        needsDescent: true,
        summary: "elevated platform: water landing 20 blocks below",
        bestTarget: {
          waterPosition: { x: 4, y: 60, z: 4 },
          entryPosition: { x: 4, y: 61, z: 4 },
          drop: 20
        }
      }
    }
  }), config);

  assert.equal(decision.type, "recover_starvation");
});

test("evades nearby daylight hostile mobs before hunger and crafting tasks", () => {
  const decision = decideNextTask(snapshot({ entities: [{ name: "zombie", distance: 9 }] }), config);
  assert.equal(decision.type, "evade_hostiles");
});

test("continues progression when daylight hostile pressure is distant", () => {
  const decision = decideNextTask(snapshot({ entities: [{ name: "spider", distance: 17 }] }), config);
  assert.equal(decision.type, "collect_wood");
});

test("defends against daylight melee threats when armed", () => {
  const decision = decideNextTask(snapshot({
    entities: [{ name: "zombie", distance: 3 }],
    inventory: { stone_sword: 1 }
  }), config);
  assert.equal(decision.type, "defend_self");
});

test("evades immediate hostile mobs at night", () => {
  const decision = decideNextTask(snapshot({ isNight: true, entities: [{ name: "skeleton", distance: 6 }] }), config);
  assert.equal(decision.type, "evade_hostiles");
});

test("defends against close armed melee mobs at night before retreating fails", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    entities: [{ name: "zombie", distance: 6 }],
    inventory: { stone_sword: 1 }
  }), config);
  assert.equal(decision.type, "defend_self");
});

test("evades armed ranged mobs at night instead of chasing them", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    entities: [{ name: "skeleton", distance: 6 }],
    inventory: { stone_sword: 1 }
  }), config);
  assert.equal(decision.type, "evade_hostiles");
});

test("seals a temporary shelter instead of fighting when blocks are available", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    entities: [{ name: "zombie", distance: 6 }],
    inventory: { stone_sword: 1, dirt: 8 }
  }), config);
  assert.equal(decision.type, "wait_out_night");
});

test("holds distant hostile pressure at night without shelter blocks", () => {
  const decision = decideNextTask(snapshot({ isNight: true, entities: [{ name: "zombie", distance: 25 }] }), config);
  assert.equal(decision.type, "hold_position");
});

test("waits at night instead of fleeing distant mobs when shelter blocks exist", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: { dirt: 8 },
    entities: [{ name: "skeleton", distance: 25 }]
  }), config);
  assert.equal(decision.type, "wait_out_night");
});

test("does not hunt for food at night when hunger is low and no food is available", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    food: 3,
    inventory: {}
  }), config);
  assert.equal(decision.type, "hold_position");
});

test("uses temporary shelter instead of hunting for food at night when blocks are available", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    food: 3,
    inventory: { dirt: 8 }
  }), config);
  assert.equal(decision.type, "wait_out_night");
});

test("stays inside built shelter at night instead of fleeing", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    entities: [{ name: "spider", distance: 12 }],
    progress: { hasStarterShelter: true }
  }), config);
  assert.equal(decision.type, "wait_out_night");
});

test("does not treat a distant remembered shelter as current night safety", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    progress: {
      hasStarterShelter: true,
      starterShelterPosition: { x: 40, y: 64, z: 0 },
      isNearStarterShelter: false,
      isStarterShelterDefensible: false
    }
  }), config);
  assert.equal(decision.type, "wait_out_night");
  assert.match(decision.reason, /remembered starter shelter/);
});

test("holds at night when shelter completion has no remembered position", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    progress: {
      hasStarterShelter: true,
      isNearStarterShelter: false,
      isStarterShelterDefensible: false
    }
  }), config);
  assert.equal(decision.type, "hold_position");
});

test("eats carried food before night holding when the food buffer is low", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    food: 15,
    inventory: { sweet_berries: 7 }
  }), config);
  assert.equal(decision.type, "eat_food");
  assert.match(decision.reason, /night food buffer/);
});

test("uses a temporary shelter when remembered starter shelter is far away", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: { dirt: 8 },
    progress: {
      hasStarterShelter: true,
      isNearStarterShelter: false,
      isStarterShelterDefensible: false
    }
  }), config);
  assert.equal(decision.type, "wait_out_night");
});

test("defends self instead of shelter when remembered shelter is not nearby", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: { stone_sword: 1 },
    entities: [{ name: "zombie", distance: 3 }],
    progress: {
      hasStarterShelter: true,
      isNearStarterShelter: false,
      isStarterShelterDefensible: false
    }
  }), config);
  assert.equal(decision.type, "defend_self");
});

test("defends built shelter when a mob is very close", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    entities: [{ name: "zombie", distance: 3 }],
    progress: { hasStarterShelter: true }
  }), config);
  assert.equal(decision.type, "defend_shelter");
});

test("hunts food at low hunger before emergency starvation", () => {
  const decision = decideNextTask(snapshot({ food: 13 }), config);
  assert.equal(decision.type, "hunt_food");
});

test("waits out night when shelter blocks are available", () => {
  const decision = decideNextTask(snapshot({ isNight: true, inventory: { dirt: 8 } }), config);
  assert.equal(decision.type, "wait_out_night");
});

test("holds position at night when no shelter blocks are available", () => {
  const decision = decideNextTask(snapshot({ isNight: true }), config);
  assert.equal(decision.type, "hold_position");
});

test("crafts local supplies at night before idle holding", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: { spruce_log: 2 }
  }), config);
  assert.equal(decision.type, "craft_basic_supplies");
});

test("crafts local tools at night when materials are ready", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: { spruce_planks: 4, stick: 2 },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "craft_basic_tools");
});

test("recovers starvation when health is critical and no food is available", () => {
  const decision = decideNextTask(snapshot({ health: 4 }), config);
  assert.equal(decision.type, "recover_starvation");
});

test("collects wood at the start of the survival tech tree", () => {
  const decision = decideNextTask(snapshot(), config);
  assert.equal(decision.type, "collect_wood");
});

test("collects wood again when basic supplies are exhausted after death", () => {
  const decision = decideNextTask(snapshot({
    inventory: { wooden_pickaxe: 1 },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "collect_wood");
});

test("reuses a known crafting table instead of making another one", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 8,
      stick: 4
    },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "craft_basic_tools");
});

test("upgrades from wooden pickaxe to stone tools when cobblestone is available", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      wooden_pickaxe: 1,
      cobblestone: 3,
      stick: 2
    },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "craft_stone_tools");
});

test("collects stone before risky shelter material work when stone tools are missing", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      wooden_pickaxe: 1,
      wooden_sword: 1,
      crafting_table: 1,
      stick: 2,
      dirt: 160,
      cooked_beef: 18
    }
  }), config);
  assert.equal(decision.type, "collect_stone");
});

test("builds a starter food reserve before gathering house materials", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      stone_pickaxe: 1,
      stone_sword: 1,
      cobblestone: 11,
      furnace: 1,
      stick: 2,
      dirt: 16
    },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "hunt_food");
});

test("continues progression when food buffer was already achieved and hunger is stable", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      stone_pickaxe: 1,
      stone_sword: 1,
      cobblestone: 11,
      furnace: 1,
      stick: 2,
      oak_planks: 8,
      dirt: 16
    },
    progress: {
      hasCraftingTable: true,
      achievedMilestones: ["food_buffer"]
    }
  }), config);

  assert.equal(decision.type, "collect_building_materials");
});

test("rebuilds a fixed shelter when the remembered one is not usable nearby", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      stone_pickaxe: 1,
      stone_sword: 1,
      cobblestone: 11,
      furnace: 1,
      cooked_beef: 18,
      dirt: 160
    },
    progress: {
      hasCraftingTable: true,
      hasStarterShelter: true,
      isNearStarterShelter: false,
      isStarterShelterDefensible: false
    }
  }), config);
  assert.equal(decision.type, "build_shelter");
});

test("upgrades stone weapon and axe before spending all cobblestone on later goals", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      stone_pickaxe: 1,
      wooden_axe: 1,
      cobblestone: 11,
      stick: 4,
      furnace: 1
    },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "craft_stone_tools");
});

test("mines advanced materials only after base preparation", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 160,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18,
      white_bed: 1
    },
    progress: { hasStarterShelter: true, hasCropPlot: true, hasAnimalPen: true, animalsLured: 2 }
  }), config);
  assert.equal(decision.type, "mine_advanced_materials");
});

test("explores once base and advanced material goals are complete", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 160,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18,
      white_bed: 1,
      raw_iron: 8
    },
    progress: { hasStarterShelter: true, hasCropPlot: true, hasAnimalPen: true, animalsLured: 2 }
  }), config);
  assert.equal(decision.type, "explore");
});

test("hunts food before open-ended exploration when food stock is low", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 8,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1
    },
    progress: { hasStarterShelter: true }
  }), config);
  assert.equal(decision.type, "hunt_food");
});

test("collects building materials before building a starter shelter", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 8,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18
    }
  }), config);
  assert.equal(decision.type, "collect_building_materials");
});

test("builds a starter shelter before open-ended exploration", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 160,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18
    }
  }), config);
  assert.equal(decision.type, "build_shelter");
});

test("continues a remembered unfinished starter shelter before restocking a full build target", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 24,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18
    },
    progress: {
      hasStarterShelter: false,
      starterShelterPosition: { x: 10, y: 64, z: 10 }
    }
  }), config);

  assert.equal(decision.type, "build_shelter");
});

test("restocks materials for a remembered unfinished starter shelter when empty", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18
    },
    progress: {
      hasStarterShelter: false,
      starterShelterPosition: { x: 10, y: 64, z: 10 }
    }
  }), config);

  assert.equal(decision.type, "collect_building_materials");
});

test("builds a starter shelter at night when materials are ready", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: {
      oak_planks: 160,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      stone_sword: 1,
      cooked_beef: 6
    }
  }), config);
  assert.equal(decision.type, "build_shelter");
});

test("waits at night instead of gathering missing shelter materials", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: {
      oak_planks: 16,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      stone_sword: 1,
      cooked_beef: 18
    }
  }), config);

  assert.equal(decision.type, "wait_out_night");
  assert.match(decision.reason, /resource gathering/);
});

test("collects wool for a bed after the house and food reserve are ready", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 8,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18
    },
    progress: { hasStarterShelter: true }
  }), config);
  assert.equal(decision.type, "collect_wool");
});

test("crafts a bed when same-color wool and planks are ready", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 8,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18,
      white_wool: 3
    },
    progress: { hasStarterShelter: true }
  }), config);
  assert.equal(decision.type, "craft_bed");
});

test("starts crop farming before animal pen and mining", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 8,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18,
      white_bed: 1,
      wheat_seeds: 4
    },
    progress: { hasStarterShelter: true }
  }), config);
  assert.equal(decision.type, "plant_crops");
});

test("builds an animal pen after crops are started", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      oak_planks: 32,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      cobblestone: 11,
      furnace: 1,
      stone_sword: 1,
      cooked_beef: 18,
      white_bed: 1
    },
    progress: { hasStarterShelter: true, hasCropPlot: true }
  }), config);
  assert.equal(decision.type, "build_animal_pen");
});

test("playbook stockpile collects logs after shelter when enabled", () => {
  const playbookConfig = {
    survival: {
      ...config.survival,
      playbookEnabled: true,
      day1LogTarget: 20,
      day1CobblestoneTarget: 24,
      stockpileLogTarget: 64,
      stockpileCobblestoneTarget: 64,
      foodStockTarget: 12,
      buildShelter: false,
      plantCrops: false,
      buildAnimalPen: false,
      advancedMaterialTarget: 0
    }
  };

  const decision = decideNextTask(snapshot({
    inventory: {
      oak_log: 24,
      crafting_table: 1,
      stick: 4,
      stone_pickaxe: 1,
      stone_sword: 1,
      cobblestone: 24,
      furnace: 1,
      cooked_beef: 12,
      white_bed: 1
    },
    progress: {
      hasStarterShelter: true,
      isNearStarterShelter: true,
      isStarterShelterDefensible: true,
      hasCraftingTable: true
    }
  }), playbookConfig);

  assert.equal(decision.type, "collect_wood");
  assert.match(decision.reason, /stockpile logs/);
});