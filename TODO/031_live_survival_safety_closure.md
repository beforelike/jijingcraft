# Live Survival Safety Closure

## Implemented

- Added protected hostile fleeing that keeps running until nearby hostile pressure is actually clear, and made damage during an active flee continue the flee instead of resetting motion or falling back to ordinary repositioning.
- Suppressed ordinary collection, crafting, exploration, queued behavior trees, and pathfinder goals while protected fleeing is active; environmental emergencies such as low oxygen, falling-block/body obstruction, and damaging blocks can still preempt the flee.
- Added flee-time route opening for soft obstructions such as leaves and dirt-like blocks, with verification and short failure cooldowns so the bot does not repeatedly dig the same unbroken block.
- Added tiny safe-window scavenging during flee so the bot can collect nearby dirt/log-like building material when it has briefly opened distance from hostile mobs.
- Hardened near-death recovery: when health is around half a heart and hunger is still adequate, `recover_starvation` no longer performs long-range `hunt_food`, exploratory movement, emergency radius hunts, or platform descent; it only uses inventory food, nearby safe food, hostile retreat, or local hold.
- Reordered critical decision gates so inventory food and near-death recovery beat platform descent/navigation work, preventing low-health states from being dragged into risky movement.
- Added spatial structure sensing for sealed cells, enclosed rooms, dead ends, corridors, water columns, and open areas. The controller now exposes `spatialStructure`, local 3D volume samples, exit directions, blocked sides, sky access, and recommended local actions.
- Added `create_or_open_exit` as a safety task and behavior tree so daylight confined spaces can open an existing door or carve a small exit before normal navigation-heavy work.
- Added a Dashboard 3D spatial viewport and sanitized status payload fields for local volume, spatial structure, exits, and recommended actions.
- Improved task-progress supervision with short trajectory history, water-stuck timing, and inventory-sensitive collection validation so resource tasks cannot claim progress merely by moving around or being pushed by water.
- Blocked repeated dry-resource collection after failed water exits, rejected unsafe wet stone targets, and preferred local dry stone recovery before chasing remote worksites.
- Made unfinished starter shelter work resumable by preventing partial shelter postcondition failures from permanently blocking `build_shelter`, and by prioritizing remembered unfinished shelter continuation or restocking.

## Verified

- `node --check src/survival/SurvivalController.js`
- `node --check src/survival/decision.js`
- Targeted regression suite: `node --test test/decision.test.js test/controllerExecution.test.js test/controllerEmergency.test.js test/behaviorExecution.test.js test/threatResponse.test.js` passed 338/338.
- Full suite: `npm test` passed 504/504.
- Live validation on Minecraft 1.21.1 / protocol 767:
  - Night run installed a shelter door and stayed in `wait_out_night` / `shelter_hold`.
  - Creeper pressure moved from about 25 blocks to about 13 blocks while the bot stayed inside the sealed shelter at full health and full hunger.
  - No repeated half-heart long-range hunting, no near-death platform descent, and no ordinary task takeover during protected safety handling was observed in the latest validated run.

## Follow-Ups

- Keep a longer live run around dawn/day transition to verify the bot resumes shelter construction and material stockpiling after the hostile pressure clears.
- Replace remaining deprecated `physicTick` listener usage with `physicsTick` to remove Mineflayer warnings.
- Add a focused scenario script for hostile chase through leaves/dirt corridors so flee-time route opening can be validated without waiting for random live terrain.
- Consider separating active flee metrics from ordinary task feedback in the Dashboard so protected safety loops are easier to audit after long runs.