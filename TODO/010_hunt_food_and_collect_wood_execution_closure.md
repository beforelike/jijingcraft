# 010 Hunt Food and Collect Wood Execution Closure

## Background
- User-reported symptoms persisted in live runtime logs:
  - `hunt_food` repeatedly selected unreachable fish targets and timed out.
  - `collect_wood` entered frequent timeout/blocked loops and produced very low first-day wood throughput.
- Existing executable behavior tree had no dedicated `hunt_food` action chain and had an always-true verification fallback in `verify_task_progress`.

## Problems Found
1. Food target selection used nearest generic food mob and did not gate aquatic targets by reachability context.
2. `collectWood()` did not return success explicitly on positive wood gain and could degrade to exploration fallback without bounded recovery context.
3. Task feedback blocking policy was too aggressive for high-variance gather tasks (`hunt_food`, `collect_wood`) and triggered early long blocks.
4. Behavior tree for `hunt_food` was not decomposed into executable stages requested by the user.
5. `verify_task_progress` in executable behavior tree included `|| true`, causing false-positive progress validation.

## Changes Implemented

### 1) SurvivalController hunt target strategy
- Added `AQUATIC_FOOD_MOBS`.
- Added reusable methods:
  - `isHuntFoodTarget(entity, options)`
  - `selectHuntFoodTarget(options)`
- Updated `huntFood()` to:
  - prioritize land passive mobs first;
  - only consider fish under low-food/critical-health pressure, short range, and low vertical delta;
  - preserve phase telemetry (`search`, `track_animal`, `approach_animal`, `attack_animal`, `collect_drops`, `verify`).

### 2) collect_wood execution closure
- Updated `collectWood()` to return explicit boolean outcomes:
  - return `true` when logs increased;
  - return `false` on threat interruption/emergency interruption;
  - fallback explore uses blocked-task context (`blockedTask: "collect_wood"`) and returns movement result.

### 3) Feedback block policy tuning
- Added `taskFeedbackBlockPolicy(taskType)`:
  - `collect_wood`: threshold 4, window 180s, block 45s
  - `hunt_food`: threshold 3, window 180s, block 90s
  - other gather tasks: threshold 3, window 180s, block 120s
  - default: threshold 2, window 120s, block 180s
- Updated `recordTaskFeedbackFailure()` to use task-specific policy.
- Updated recovery mapping to better reflect practical fallback chains.

### 4) Executable behavior tree enhancement
- Added dedicated `hunt_food` template in `src/behavior/executableBehaviorTree.js`:
  - `prepare_hunt`
  - `scan_hunt_targets`
  - `track_hunt_target`
  - `approach_hunt_target`
  - `attack_hunt_target`
  - `collect_hunt_drops`
  - `verify_hunt_gain`
- Added corresponding handlers.
- Added food item metric capture (`foodItems`) and used it in `verify_hunt_food_gain`.
- Fixed `verify_task_progress` to fail with `no_observable_progress` when no metric changed.

## Test Updates
- Added/updated tests in:
  - `test/behaviorExecution.test.js`
  - `test/controllerExecution.test.js`
- New coverage includes:
  - `hunt_food` executable node-chain shape validation.
  - land-first target selection.
  - fish gating under low-hunger condition.
  - updated blocked-threshold expectation for repeated `hunt_food` failures.

## Verification
- Command run:
  - `npm test -- test/controllerExecution.test.js test/behaviorExecution.test.js`
- Result:
  - `tests 248`
  - `pass 248`
  - `fail 0`

## Expected Impact
- Reduces repeated unreachable fish pursuit loops in routine food collection.
- Keeps `collect_wood` from being prematurely blocked after a small number of transient path failures.
- Ensures behavior tree execution and verification now represent real progress rather than always-pass checks.
- Provides clearer stage-level telemetry for diagnosis and future adaptive tuning.
