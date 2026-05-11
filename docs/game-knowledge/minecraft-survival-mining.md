# Minecraft Survival Mining Knowledge

This project stores compact, bot-oriented summaries of public Minecraft knowledge instead of copying full wiki pages. The controller and planner should use these notes before choosing or executing `collect_stone` and mining tasks.

Sources checked:

- https://minecraft.wiki/w/Sand
- https://minecraft.wiki/w/Gravel
- https://minecraft.wiki/w/Tutorial:Beginner%27s_guide
- https://minecraft.wiki/w/Tutorial:Mining

## Falling Blocks

- Sand, red sand, gravel, suspicious sand, suspicious gravel, and concrete powder are gravity-affected blocks.
- When support below sand or gravel is removed, the block can become a falling block entity and drop until it lands on a solid top surface.
- Falling sand or gravel can bury the player or a mob and cause suffocation damage.
- A player standing on a stack of sand or gravel can fall if the stack loses support.

## Collect Stone

- Early stone collection should use exposed stone, a cave mouth, stony shore, cliff, or rocky hillside when available.
- Mine from a safe side stand. Avoid mining the block directly below the bot unless the route is an intentional safe stair/shaft design.
- Beach, desert, riverbed, and gravel shore terrain should not use the same downward digging fallback as dirt or grass terrain.
- If the only nearby terrain is sand or gravel, the bot should relocate or search for exposed stone before starting a stair mine probe.
- Stair probes must avoid steps where the target, head space, support, or overhead column contains falling blocks.

## Beginner Survival Order

- Get wood first, then craft planks, sticks, crafting table, and a wooden pickaxe.
- Stone requires a pickaxe to produce cobblestone.
- A staircase mine is safer for returning to the surface than a straight downward shaft.
- If digging upward to escape, use a stair pattern so sand, gravel, or water does not drop directly onto the player.