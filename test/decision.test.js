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
    shelterBlockTarget: 80,
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

test("escapes damaging plant blocks before normal work", () => {
  const decision = decideNextTask(snapshot({
    environmentHazard: { name: "sweet_berry_bush", distance: 0.4 }
  }), config);
  assert.equal(decision.type, "escape_hazard");
});

test("escapes a navigation pit before normal mining or crafting", () => {
  const decision = decideNextTask(snapshot({
    navigationTrap: true,
    inventory: { wooden_pickaxe: 1, cobblestone: 3, stick: 2 },
    progress: { hasCraftingTable: true }
  }), config);
  assert.equal(decision.type, "escape_pit");
});

test("evades hostile mobs before hunger and crafting tasks", () => {
  const decision = decideNextTask(snapshot({ entities: [{ name: "zombie", distance: 18 }] }), config);
  assert.equal(decision.type, "evade_hostiles");
});

test("evades immediate hostile mobs at night", () => {
  const decision = decideNextTask(snapshot({ isNight: true, entities: [{ name: "skeleton", distance: 6 }] }), config);
  assert.equal(decision.type, "evade_hostiles");
});

test("evades armed hostile mobs at night before they are in melee range", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    entities: [{ name: "zombie", distance: 6 }],
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

test("holds position for distant hostile mobs at night without shelter blocks", () => {
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
      isNearStarterShelter: false,
      isStarterShelterDefensible: false
    }
  }), config);
  assert.equal(decision.type, "hold_position");
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

test("evades when health is critical and no food is available", () => {
  const decision = decideNextTask(snapshot({ health: 4 }), config);
  assert.equal(decision.type, "evade_hostiles");
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
      dirt: 80,
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

test("rebuilds a fixed shelter when the remembered one is not usable nearby", () => {
  const decision = decideNextTask(snapshot({
    inventory: {
      stone_pickaxe: 1,
      stone_sword: 1,
      cobblestone: 11,
      furnace: 1,
      cooked_beef: 18,
      dirt: 80
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
      oak_planks: 80,
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
      oak_planks: 80,
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
      cobblestone: 11,
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
      oak_planks: 80,
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

test("builds a starter shelter at night when materials are ready", () => {
  const decision = decideNextTask(snapshot({
    isNight: true,
    inventory: {
      oak_planks: 80,
      stick: 4,
      crafting_table: 1,
      stone_pickaxe: 1,
      stone_sword: 1,
      cooked_beef: 6
    }
  }), config);
  assert.equal(decision.type, "build_shelter");
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