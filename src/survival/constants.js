const HOSTILE_MOBS = new Set([
  "blaze",
  "cave_spider",
  "creeper",
  "drowned",
  "elder_guardian",
  "endermite",
  "evoker",
  "ghast",
  "guardian",
  "hoglin",
  "husk",
  "magma_cube",
  "phantom",
  "piglin_brute",
  "pillager",
  "ravager",
  "shulker",
  "silverfish",
  "skeleton",
  "slime",
  "spider",
  "stray",
  "vex",
  "vindicator",
  "warden",
  "witch",
  "wither_skeleton",
  "zoglin",
  "zombie",
  "zombie_villager",
  "zombified_piglin"
]);

const FOOD_MOBS = new Set(["cow", "pig", "sheep", "chicken", "rabbit", "salmon", "cod", "tropical_fish"]);

const LOG_BLOCKS = [
  "oak_log",
  "birch_log",
  "spruce_log",
  "jungle_log",
  "acacia_log",
  "dark_oak_log",
  "mangrove_log",
  "cherry_log"
];

const LOG_TO_PLANKS = {
  oak_log: "oak_planks",
  birch_log: "birch_planks",
  spruce_log: "spruce_planks",
  jungle_log: "jungle_planks",
  acacia_log: "acacia_planks",
  dark_oak_log: "dark_oak_planks",
  mangrove_log: "mangrove_planks",
  cherry_log: "cherry_planks"
};

const PLANK_ITEMS = Object.values(LOG_TO_PLANKS);
const PLANK_TO_DOOR = {
  oak_planks: "oak_door",
  birch_planks: "birch_door",
  spruce_planks: "spruce_door",
  jungle_planks: "jungle_door",
  acacia_planks: "acacia_door",
  dark_oak_planks: "dark_oak_door",
  mangrove_planks: "mangrove_door",
  cherry_planks: "cherry_door"
};
const DOOR_ITEMS = Object.values(PLANK_TO_DOOR);
const SHELTER_BLOCK_ITEMS = [
  "dirt",
  "cobblestone",
  "stone",
  "oak_planks",
  "spruce_planks",
  "birch_planks",
  "jungle_planks",
  "acacia_planks",
  "dark_oak_planks",
  "mangrove_planks",
  "cherry_planks",
  ...LOG_BLOCKS
];

const FOOD_ITEMS = [
  "cooked_beef",
  "cooked_porkchop",
  "cooked_mutton",
  "cooked_chicken",
  "cooked_rabbit",
  "cooked_cod",
  "cooked_salmon",
  "bread",
  "baked_potato",
  "beef",
  "porkchop",
  "mutton",
  "chicken",
  "rabbit",
  "cod",
  "salmon",
  "apple",
  "carrot",
  "potato",
  "sweet_berries"
];

const PICKAXES = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe", "wooden_pickaxe"];
const AXES = ["netherite_axe", "diamond_axe", "iron_axe", "stone_axe", "wooden_axe"];
const HOES = ["netherite_hoe", "diamond_hoe", "iron_hoe", "stone_hoe", "wooden_hoe"];
const STONE_OR_BETTER_PICKAXES = ["netherite_pickaxe", "diamond_pickaxe", "iron_pickaxe", "stone_pickaxe"];
const STONE_OR_BETTER_AXES = ["netherite_axe", "diamond_axe", "iron_axe", "stone_axe"];
const STONE_OR_BETTER_WEAPONS = ["netherite_sword", "diamond_sword", "iron_sword", "stone_sword", "netherite_axe", "diamond_axe", "iron_axe", "stone_axe"];
const WEAPONS = [
  "netherite_sword",
  "diamond_sword",
  "iron_sword",
  "stone_sword",
  "wooden_sword",
  "netherite_axe",
  "diamond_axe",
  "iron_axe",
  "stone_axe",
  "wooden_axe"
];

const WOOL_ITEMS = [
  "white_wool",
  "orange_wool",
  "magenta_wool",
  "light_blue_wool",
  "yellow_wool",
  "lime_wool",
  "pink_wool",
  "gray_wool",
  "light_gray_wool",
  "cyan_wool",
  "purple_wool",
  "blue_wool",
  "brown_wool",
  "green_wool",
  "red_wool",
  "black_wool"
];

const BED_ITEMS = [
  "white_bed",
  "orange_bed",
  "magenta_bed",
  "light_blue_bed",
  "yellow_bed",
  "lime_bed",
  "pink_bed",
  "gray_bed",
  "light_gray_bed",
  "cyan_bed",
  "purple_bed",
  "blue_bed",
  "brown_bed",
  "green_bed",
  "red_bed",
  "black_bed"
];

const CROP_ITEMS = ["wheat", "carrot", "potato", "beetroot"];
const CROP_SEED_ITEMS = ["wheat_seeds", "beetroot_seeds"];
const CROP_PLANT_ITEMS = ["wheat_seeds", "beetroot_seeds", "carrot", "potato"];
const CROP_BLOCKS = ["wheat", "carrots", "potatoes", "beetroots"];
const ANIMAL_BAIT_ITEMS = ["wheat", "wheat_seeds", "carrot", "potato"];
const ADVANCED_ORE_BLOCKS = [
  "coal_ore",
  "deepslate_coal_ore",
  "iron_ore",
  "deepslate_iron_ore",
  "copper_ore",
  "deepslate_copper_ore"
];
const ADVANCED_MATERIAL_ITEMS = ["coal", "raw_iron", "iron_ingot", "raw_copper", "copper_ingot"];
const DAMAGING_BLOCKS = [
  "sweet_berry_bush",
  "cactus",
  "wither_rose",
  "pointed_dripstone",
  "magma_block",
  "fire",
  "soul_fire",
  "lava"
];

const WATER_BLOCKS = ["water", "bubble_column"];

module.exports = {
  ADVANCED_MATERIAL_ITEMS,
  ADVANCED_ORE_BLOCKS,
  ANIMAL_BAIT_ITEMS,
  AXES,
  BED_ITEMS,
  CROP_BLOCKS,
  CROP_ITEMS,
  CROP_PLANT_ITEMS,
  CROP_SEED_ITEMS,
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
  WOOL_ITEMS,
  WATER_BLOCKS,
  WEAPONS
};