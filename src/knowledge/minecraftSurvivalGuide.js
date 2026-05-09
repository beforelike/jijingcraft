const MINECRAFT_SURVIVAL_GUIDE = Object.freeze({
  source: "project_mc_wiki_summary",
  gameVersion: "Minecraft Java survival 1.21.x",
  purpose: "Compact wiki-style facts for Smart Brain task selection. The controller still owns execution and safety priority.",
  environmentRules: [
    "Water is traversable and not a damaging block while air/oxygen remains.",
    "Treat water as a movement medium: swim up for air, look for shore or dry stand, then continue dry-land work.",
    "If low oxygen happens under an ice ceiling, break the overhead ice to open a breathing hole before treating the ice ceiling as a normal surface.",
    "Only request escape_hazard for water when the bot is in water and oxygen is at or below the configured low oxygen threshold.",
    "Do not request escape_pit just because the bot is underwater; water columns are swimmable unless blocked by solid terrain and low oxygen is active.",
    "Lava, damaging plants, cactus, fire, and magma-like damage sources are true hazards and should interrupt ordinary tasks."
  ],
  vitals: {
    health: "Critical health requires eating, retreating, or passive starvation recovery depending on food and threats.",
    hunger: "Low food should prefer safe visible food, then exploration for food sources; avoid night hunting unless starvation recovery allows it.",
    oxygen: "Oxygen has a buffer. Above the low oxygen threshold, water should not cancel normal planning by itself. At or below the threshold, swim up or move to shore."
  },
  progressionOrder: [
    "Get logs from reachable trees on dry land.",
    "Craft planks, sticks, crafting table, and a wooden pickaxe.",
    "Collect exposed stone from a safe side stand before digging stair probes.",
    "Craft stone pickaxe and stone sword, then furnace and cooked food path.",
    "Build or verify a nearby defensible shelter before open-ended night exploration.",
    "After shelter and food are stable, collect wool, start crops, build animal pen, then mine advanced materials."
  ],
  taskNotes: {
    explore: [
      "Exploration should change position or gather terrain information.",
      "If starting in water, first surface or reach shore; do not treat this as failed exploration."
    ],
    collect_wood: [
      "Requires reachable log blocks and a dry stand near the trunk.",
      "If no reachable logs exist, explore toward forest or safe land instead of digging underwater blocks."
    ],
    collect_stone: [
      "Prefer exposed stone with safe side stands.",
      "Only dig stair probes after repeated surface search failures; never dig straight down as a generic escape."
    ],
    wait_out_night: [
      "Use nearby shelter or a simple emergency shelter.",
      "Do not chase distant remembered shelters if the current spawn/location is far away and pathing immediately fails."
    ],
    build_shelter: [
      "A fixed starter shelter is a surface 7x7x5 house, not a deep underground hole or winding cave.",
      "It should have a double door, roof, usable interior, crafting table, furnace, chest, and torches when fuel is available; add a bed later."
    ],
    escape_hazard: [
      "Use for real hazards or low oxygen, not ordinary water with oxygen remaining."
    ],
    escape_pit: [
      "Use for enclosed solid pits or elevated support columns, not swimmable water columns."
    ]
  }
});

function compactMinecraftSurvivalGuide() {
  return MINECRAFT_SURVIVAL_GUIDE;
}

module.exports = {
  MINECRAFT_SURVIVAL_GUIDE,
  compactMinecraftSurvivalGuide
};