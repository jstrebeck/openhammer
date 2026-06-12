# Reducer Decomposition & GameState Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 4,093 LOC monolithic `gameReducer` into 12 domain sub-reducers and clean up GameState by replacing 6 faction/stratagem-specific fields with 2 generic fields.

**Architecture:** Pure refactor — extract case blocks from a single switch statement into focused sub-reducer files, composed by a thin router. No behavior changes. The `SubReducer` type returns `GameState | null` (null = "I don't handle this"). GameState cleanup replaces hardcoded faction fields with a typed plugin pattern.

**Tech Stack:** TypeScript (strict mode), Vitest, npm workspaces

**Spec:** `docs/superpowers/specs/2026-03-23-reducer-decomposition-design.md`

**Key constraint — recursive `gameReducer()` calls:** Five case blocks currently call `gameReducer()` recursively: RESOLVE_SAVE_ROLL→APPLY_DAMAGE, RESOLVE_HAZARDOUS→APPLY_DAMAGE, AIRCRAFT_MOVE→AIRCRAFT_OFF_BOARD, RESOLVE_DEADLY_DEMISE→APPLY_MORTAL_WOUNDS, END_BATTLE_ROUND→END_BATTLE. In all 5 cases, caller and callee land in the **same** sub-reducer. After extraction, these must call the sub-reducer function directly (not `gameReducer`), avoiding circular imports. Each extraction task notes where this applies.

---

## Part 1: Reducer Decomposition

### Task 1: Extract shared utilities (`actionValidation.ts` and `helpers.ts`)

**Files:**
- Create: `packages/core/src/state/actionValidation.ts`
- Create: `packages/core/src/state/helpers.ts`
- Modify: `packages/core/src/state/reducer.ts`

- [ ] **Step 1: Create `helpers.ts`**

Extract the `appendLog` function (line 4091-4093 of reducer.ts) into a new shared helpers file:

```typescript
// packages/core/src/state/helpers.ts
import type { GameLog, LogEntry } from '../types/index';

export function appendLog(log: GameLog, entry: LogEntry): GameLog {
  return { entries: [...log.entries, entry] };
}
```

- [ ] **Step 2: Create `actionValidation.ts`**

Move `getActionCategory()` (lines 27-155) and `isActionAllowedInPhase()` (lines 157-189) from reducer.ts into a new file. These functions require imports from `../rules/registry` and `../rules/RulesEdition`.

```typescript
// packages/core/src/state/actionValidation.ts
import type { GameState } from '../types/index';
import { getEdition } from '../rules/registry';
import type { ActionCategory } from '../rules/RulesEdition';

export function getActionCategory(actionType: string): ActionCategory | null {
  // ... exact copy of lines 28-155 from reducer.ts ...
}

export function isActionAllowedInPhase(state: GameState, actionType: string): { allowed: boolean; reason?: string } {
  // ... exact copy of lines 158-189 from reducer.ts ...
}
```

- [ ] **Step 3: Update `reducer.ts` to import from new files**

Remove the `appendLog`, `getActionCategory`, and `isActionAllowedInPhase` function definitions from reducer.ts. Add imports:

```typescript
import { getActionCategory, isActionAllowedInPhase } from './actionValidation';
import { appendLog } from './helpers';
```

Keep `getActionCategory` imported even though the router doesn't use it directly — it's re-exported for other consumers if needed. Remove the `ActionCategory` type import from reducer.ts if no longer needed there.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`
Expected: All all tests pass, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/actionValidation.ts packages/core/src/state/helpers.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract actionValidation and helpers from reducer"
```

---

### Task 2: Create router infrastructure and `reducers/` directory

**Files:**
- Create: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

- [ ] **Step 1: Create `reducers/index.ts`**

Create the directory and barrel export file. Start empty — sub-reducers will be added one at a time:

```typescript
// packages/core/src/state/reducers/index.ts
// Sub-reducers are re-exported here as they are extracted.
```

- [ ] **Step 2: Add `SubReducer` type to helpers.ts**

```typescript
// Add to packages/core/src/state/helpers.ts
import type { GameState } from '../types/index';
import type { GameAction } from './actions';

export type SubReducer = (state: GameState, action: GameAction) => GameState | null;
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass (no behavioral change).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/reducers/index.ts packages/core/src/state/helpers.ts
git commit -m "refactor: add reducers directory and SubReducer type"
```

---

### Task 3: Extract `setupReducer`

**Files:**
- Create: `packages/core/src/state/reducers/setupReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

This reducer handles 20 action types: PLACE_MODEL (lines 218-224), REMOVE_MODEL (226-242), SET_MODEL_WOUNDS (333-349), ROTATE_MODEL — **wait, ROTATE_MODEL is in movementReducer**. The setup cases are: PLACE_MODEL, REMOVE_MODEL, ADD_UNIT, REMOVE_UNIT, IMPORT_ARMY, ADD_PLAYER, PLACE_TERRAIN, REMOVE_TERRAIN, UPDATE_TERRAIN, ADD_DEPLOYMENT_ZONE, REMOVE_DEPLOYMENT_ZONE, PLACE_OBJECTIVE, REMOVE_OBJECTIVE, UPDATE_OBJECTIVE, SET_BOARD_SIZE, SET_EDITION, SET_RULES_CONFIG, SET_MODEL_WOUNDS, ATTACH_LEADER, DETACH_LEADER.

- [ ] **Step 1: Create `setupReducer.ts`**

Create the file with all 20 case statements copied from reducer.ts. The function signature:

```typescript
import type { GameState } from '../../types/index';
import type { GameAction } from '../actions';
import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';

export const setupReducer: SubReducer = (state, action) => {
  switch (action.type) {
    case 'PLACE_MODEL': {
      // ... exact copy of lines 218-224 ...
    }
    case 'REMOVE_MODEL': {
      // ... exact copy of lines 226-242 ...
    }
    // ... all 20 cases ...
    default:
      return null; // not handled by this reducer
  }
};
```

Import any dependencies these cases use. For ATTACH_LEADER / DETACH_LEADER, check their imports — they may reference `appendLog` or `getEdition`.

- [ ] **Step 2: Remove cases from `reducer.ts`**

Delete the 20 case blocks from the main switch in reducer.ts. Keep all other cases intact.

- [ ] **Step 3: Wire up the router**

In `reducer.ts`, add the import and router array:

```typescript
import { setupReducer } from './reducers/setupReducer';

// After the phase validation block, before the existing switch:
const setupResult = setupReducer(state, action);
if (setupResult !== null) return setupResult;

// ... existing switch statement with remaining cases ...
```

Note: During incremental extraction, use individual calls rather than the full router array. Switch to the array pattern in the final cleanup task.

- [ ] **Step 4: Update `reducers/index.ts`**

```typescript
export { setupReducer } from './setupReducer';
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`
Expected: All tests pass. Zero type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state/reducers/setupReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract setupReducer (20 action types)"
```

---

### Task 4: Extract `chargeReducer`

**Files:**
- Create: `packages/core/src/state/reducers/chargeReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

4 action types: DECLARE_CHARGE (lines 1473-1522), ROLL_CHARGE (1524-1535), COMMIT_CHARGE_MOVE (1537-1596), FAIL_CHARGE (1598-1614).

Imports needed: `appendLog` from helpers, `distanceBetweenModels`, `checkCoherency`, `isWithinRange` from `../../measurement/index`, `getEdition` from `../../rules/registry`, `isAircraftUnit`, `canChargeAircraft` from `../../aircraft/index`, `doesPathCrossModel` from `../../measurement/index`, `createEmptyChargeState` from `../../types/index`.

- [ ] **Step 1: Create `chargeReducer.ts`** — copy 4 case blocks + `validateChargeMove` helper (lines 3750-3882 of reducer.ts), add imports, return `null` for default. Note: `COMMIT_CHARGE_MOVE` calls `validateChargeMove()` which must be included.
- [ ] **Step 2: Remove 4 cases + `validateChargeMove` from `reducer.ts`**, add `chargeReducer` call before the switch
- [ ] **Step 3: Update `reducers/index.ts`** — add export
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/chargeReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract chargeReducer (4 action types)"
```

---

### Task 5: Extract `transportReducer`

**Files:**
- Create: `packages/core/src/state/reducers/transportReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

3 action types: EMBARK (lines 1908-1954), DISEMBARK (1956-2002), RESOLVE_DESTROYED_TRANSPORT (2004-2059).

Imports needed: `appendLog` from helpers, `canEmbark`, `canDisembark`, `EMBARKED_POSITION`, `getEmbarkedModelCount`, `getTransportForUnit` from `../../transport/index`, `distanceBetweenModels` from `../../measurement/index`.

- [ ] **Step 1: Create `transportReducer.ts`** — copy 3 case blocks
- [ ] **Step 2: Remove 3 cases from `reducer.ts`**, add `transportReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/transportReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract transportReducer (3 action types)"
```

---

### Task 6: Extract `aircraftReducer`

**Files:**
- Create: `packages/core/src/state/reducers/aircraftReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

5 action types: SET_UNIT_IN_RESERVES (lines 2063-2090), ARRIVE_FROM_RESERVES (2092-2147), SET_HOVER_MODE (2149-2175), AIRCRAFT_MOVE (2177-2222), AIRCRAFT_OFF_BOARD (2224-2259).

Imports needed: `appendLog` from helpers, `isAircraftUnit`, `validateAircraftMovement`, `AIRCRAFT_MOVE_DISTANCE` from `../../aircraft/index`, `EMBARKED_POSITION` from `../../transport/index`, `getEdition` from `../../rules/registry`.

- [ ] **Step 1: Create `aircraftReducer.ts`** — copy 5 case blocks. Note: AIRCRAFT_MOVE recursively calls `gameReducer` with AIRCRAFT_OFF_BOARD — since both are in this sub-reducer, change to call `aircraftReducer` directly instead.
- [ ] **Step 2: Remove 5 cases from `reducer.ts`**, add `aircraftReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/aircraftReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract aircraftReducer (5 action types)"
```

---

### Task 7: Extract `commandReducer`

**Files:**
- Create: `packages/core/src/state/reducers/commandReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

3 action types: START_COMMAND_PHASE (lines 688-725), RESOLVE_BATTLE_SHOCK (727-760), SET_COMMAND_POINTS (555-600).

Imports needed: `appendLog` from helpers, `getEdition` from `../../rules/registry`.

- [ ] **Step 1: Create `commandReducer.ts`** — copy 3 case blocks
- [ ] **Step 2: Remove 3 cases from `reducer.ts`**, add `commandReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/commandReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract commandReducer (3 action types)"
```

---

### Task 8: Extract `movementReducer`

**Files:**
- Create: `packages/core/src/state/reducers/movementReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

6 action types: MOVE_MODEL (lines 244-331), ROTATE_MODEL (351-362), DECLARE_MOVEMENT (1141-1169), ROLL_ADVANCE (1171-1183), COMMIT_MOVEMENT (1185-1243), SURGE_MOVE (2334-2413).

Imports needed: `appendLog` from helpers, `distance`, `distanceBetweenModels`, `checkCoherency`, `isWithinRange`, `getModelBoundingBox`, `doesPathCrossModel`, `closestEnemyModel`, `getPivotCost` from `../../measurement/index`, `getEdition` from `../../rules/registry`, `isAircraftUnit` from `../../aircraft/index`, `isUnitInEngagementRange` from `../../combat/index`.

Note: MOVE_MODEL (lines 244-331) contains the movement validation logic that references `validateMovement()` (lines 3586-3747). The `validateMovement` helper is defined later in reducer.ts and must also be moved. Copy it into `movementReducer.ts` as a module-private function.

Similarly, COMMIT_MOVEMENT may call `validateMovement`. SURGE_MOVE has its own validation. Copy any validation helpers used by these cases.

- [ ] **Step 1: Create `movementReducer.ts`** — copy 6 case blocks + `validateMovement` helper (lines 3586-3747)
- [ ] **Step 2: Remove 6 cases from `reducer.ts`**, add `movementReducer` call. Remove `validateMovement` if no other case uses it (check first).
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/movementReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract movementReducer (6 action types)"
```

---

### Task 9: Extract `shootingReducer`

**Files:**
- Create: `packages/core/src/state/reducers/shootingReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

9 action types: DECLARE_SHOOTING (lines 1247-1312), ASSIGN_WEAPON_TARGETS (1314-1322), RESOLVE_SHOOTING_ATTACK (1324-1382), RESOLVE_SAVE_ROLL (1384-1400), APPLY_DAMAGE (1402-1424), COMPLETE_SHOOTING (1426-1442), RESOLVE_HAZARDOUS (1446-1469), APPLY_MORTAL_WOUNDS (2263-2310), RESOLVE_DEADLY_DEMISE (2417-2459).

Imports needed: `appendLog` from helpers, `isUnitInEngagementRange`, `getEngagementShootingMode`, `getEngagedEnemyUnits`, `weaponHasAbility`, `getWoundAllocationTarget` from `../../combat/index`, `distanceBetweenModels` from `../../measurement/index`, `createEmptyShootingState` from `../../types/index`, `getEdition` from `../../rules/registry`.

- [ ] **Step 1: Create `shootingReducer.ts`** — copy 9 case blocks. Note: RESOLVE_SAVE_ROLL and RESOLVE_HAZARDOUS recursively call `gameReducer` with APPLY_DAMAGE, and RESOLVE_DEADLY_DEMISE calls `gameReducer` with APPLY_MORTAL_WOUNDS — since all are in this sub-reducer, change to call `shootingReducer` directly instead.
- [ ] **Step 2: Remove 9 cases from `reducer.ts`**, add `shootingReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/shootingReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract shootingReducer (9 action types)"
```

---

### Task 10: Extract `fightReducer`

**Files:**
- Create: `packages/core/src/state/reducers/fightReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

6 action types: INITIALIZE_FIGHT_PHASE (lines 1618-1669), SELECT_UNIT_TO_FIGHT (1671-1691), PILE_IN (1693-1741), RESOLVE_MELEE_ATTACK (1743-1798), CONSOLIDATE (1800-1848), COMPLETE_FIGHT (1850-1904).

Note: PILE_IN uses `validatePileIn` (lines 3884-3941) and CONSOLIDATE uses `validateConsolidate` (lines 3944-4023). Also `isValidMeleeTarget` (lines 4026-4089) may be used. Move these validation helpers into `fightReducer.ts`.

Imports needed: `appendLog` from helpers, `distanceBetweenModels`, `checkCoherency`, `closestEnemyModel`, `isWithinRange`, `distanceToPoint` from `../../measurement/index`, `isUnitInEngagementRange` from `../../combat/index`, `createEmptyFightState` from `../../types/index`, `getEdition` from `../../rules/registry`.

- [ ] **Step 1: Create `fightReducer.ts`** — copy 6 case blocks + `validatePileIn`, `validateConsolidate`, `isValidMeleeTarget` helpers
- [ ] **Step 2: Remove 6 cases + helpers from `reducer.ts`**, add `fightReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/fightReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract fightReducer (6 action types)"
```

---

### Task 11: Extract `stratagemReducer`

**Files:**
- Create: `packages/core/src/state/reducers/stratagemReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

8 action types: USE_STRATAGEM (lines 824-1024 — this is the largest single case at ~200 lines), APPLY_COMMAND_REROLL (2606-2646), RESOLVE_TANK_SHOCK (2648-2727), RESOLVE_GRENADE (2729-2808), RESOLVE_OVERWATCH (2810-2845), RESOLVE_HEROIC_INTERVENTION (2847-2880), ADD_PERSISTING_EFFECT (2989-3000), REMOVE_PERSISTING_EFFECT (3002-3014).

Note: USE_STRATAGEM sets `smokescreenUnits`, `goToGroundUnits`, `epicChallengeUnits`, and `outOfPhaseAction` directly on GameState. During Part 1, these stay as-is (old fields). Part 2 will migrate them.

Imports needed: `appendLog` from helpers, `CORE_STRATAGEMS` from `../../types/index`, `distanceBetweenModels`, `isWithinRange` from `../../measurement/index`, `isUnitInEngagementRange` from `../../combat/index`, `getEdition` from `../../rules/registry`.

- [ ] **Step 1: Create `stratagemReducer.ts`** — copy 8 case blocks
- [ ] **Step 2: Remove 8 cases from `reducer.ts`**, add `stratagemReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/stratagemReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract stratagemReducer (8 action types)"
```

---

### Task 12: Extract `deploymentReducer`

**Files:**
- Create: `packages/core/src/state/reducers/deploymentReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

15 action types: DESIGNATE_WARLORD (lines 3018-3031), SET_POINTS_LIMIT (3033-3044), SET_FACTION_KEYWORD (3046-3060), SELECT_DETACHMENT (3062-3076), ASSIGN_ENHANCEMENT (3078-3092), REMOVE_ENHANCEMENT (3094-3106), VALIDATE_ARMY (3108-3129), DETERMINE_ATTACKER_DEFENDER (3133-3146), BEGIN_DEPLOYMENT (3148-3188), DEPLOY_UNIT (3190-3251), DETERMINE_FIRST_TURN (3253-3269), RESOLVE_REDEPLOYMENT (3271-3293), ADVANCE_SETUP_PHASE (3295-3308), SCOUT_MOVE (2461-2488), DEPLOY_INFILTRATORS (2490-2516).

Imports needed: `appendLog` from helpers, `validateDeploymentPosition`, `validateArmy` from `../../army-list/armyValidation`, `SETUP_PHASE_ORDER` and `createEmptyDeploymentState` from `../../types/index`, `pointInPolygon` from `../../los/index`, `distanceBetweenModels` from `../../measurement/index`, `EMBARKED_POSITION` from `../../transport/index`.

- [ ] **Step 1: Create `deploymentReducer.ts`** — copy 15 case blocks
- [ ] **Step 2: Remove 15 cases from `reducer.ts`**, add `deploymentReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/deploymentReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract deploymentReducer (15 action types)"
```

---

### Task 13: Extract `lifecycleReducer`

**Files:**
- Create: `packages/core/src/state/reducers/lifecycleReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

16 action types: ADVANCE_PHASE (lines 437-487), NEXT_TURN (489-531), ROLL_DICE (547-553), SET_COMMAND_POINTS — **no, that's in commandReducer**. The 16 actions: ADVANCE_PHASE, NEXT_TURN, SET_MISSION (3312-3355), SELECT_SECONDARY (3357-3371), END_TURN (3373-3451), END_BATTLE_ROUND (3453-3518), END_BATTLE (3520-3577), CALCULATE_OBJECTIVE_CONTROL (764-805), UPDATE_SCORE (807-820), ACTIVATE_UNIT (662-672), COMPLETE_UNIT_ACTIVATION (674-684), LOG_MESSAGE (602-611), ROLL_DICE (547-553), ROLL_OFF (2312-2332), CHECK_END_OF_TURN_COHERENCY (2884-2942), RESOLVE_DESPERATE_ESCAPE (2944-2985).

Note: ADVANCE_PHASE and NEXT_TURN reset `smokescreenUnits`, `goToGroundUnits`, `epicChallengeUnits`, `activeOrders`, `officersUsedThisPhase`, and `guidedTargets`. During Part 1 these stay as direct field resets. Part 2 will migrate them.

Imports needed: `appendLog` from helpers, `createEmptyTurnTracking`, `createEmptyShootingState`, `createEmptyChargeState`, `createEmptyFightState` from `../../types/index`, `getEdition` from `../../rules/registry`, `evaluateScoring` from `../../missions/index`, `checkCoherency`, `distanceBetweenModels` from `../../measurement/index`.

- [ ] **Step 1: Create `lifecycleReducer.ts`** — copy 16 case blocks. Note: END_BATTLE_ROUND recursively calls `gameReducer` with END_BATTLE — since both are in this sub-reducer, change to call `lifecycleReducer` directly instead.
- [ ] **Step 2: Remove 16 cases from `reducer.ts`**, add `lifecycleReducer` call
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/lifecycleReducer.ts packages/core/src/state/reducers/index.ts packages/core/src/state/reducer.ts
git commit -m "refactor: extract lifecycleReducer (16 action types)"
```

---

### Task 14: Convert `reducer.ts` to thin router

**Files:**
- Modify: `packages/core/src/state/reducer.ts`

After all sub-reducers are extracted, reducer.ts should have an empty switch statement (or no switch at all). Convert it to the router pattern.

- [ ] **Step 1: Replace the switch statement with the router array**

Remove the now-empty switch. Replace with:

```typescript
import type { SubReducer } from './helpers';
import { isActionAllowedInPhase } from './actionValidation';
import { appendLog } from './helpers';
import { setupReducer } from './reducers/setupReducer';
import { movementReducer } from './reducers/movementReducer';
import { shootingReducer } from './reducers/shootingReducer';
import { chargeReducer } from './reducers/chargeReducer';
import { fightReducer } from './reducers/fightReducer';
import { commandReducer } from './reducers/commandReducer';
import { stratagemReducer } from './reducers/stratagemReducer';
import { transportReducer } from './reducers/transportReducer';
import { aircraftReducer } from './reducers/aircraftReducer';
import { deploymentReducer } from './reducers/deploymentReducer';
import { lifecycleReducer } from './reducers/lifecycleReducer';

const subReducers: SubReducer[] = [
  setupReducer,
  movementReducer,
  shootingReducer,
  chargeReducer,
  fightReducer,
  commandReducer,
  stratagemReducer,
  transportReducer,
  aircraftReducer,
  deploymentReducer,
  lifecycleReducer,
];

export function gameReducer(state: GameState, action: GameAction): GameState {
  const phaseCheck = isActionAllowedInPhase(state, action.type);
  if (!phaseCheck.allowed) {
    if (state.rulesConfig.phaseRestrictions === 'enforce') {
      return { ...state, log: appendLog(state.log, { type: 'message', text: `[BLOCKED] ${phaseCheck.reason}`, timestamp: Date.now() }) };
    }
    state = { ...state, log: appendLog(state.log, { type: 'message', text: `[WARNING] ${phaseCheck.reason}`, timestamp: Date.now() }) };
  }

  for (const reducer of subReducers) {
    const result = reducer(state, action);
    if (result !== null) return result;
  }
  return state;
}
```

- [ ] **Step 2: Clean up stale imports**

Remove any imports in reducer.ts that are no longer used (measurement, combat, transport, aircraft, missions, los, types helpers, etc.). The router file should only import from `./actionValidation`, `./helpers`, `./reducers/*`, and the `GameState`/`GameAction` types.

- [ ] **Step 3: Verify reducer.ts is now < 100 LOC**

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducer.ts
git commit -m "refactor: convert reducer.ts to thin router (~60 LOC)"
```

---

## Part 2: GameState Cleanup

### Task 15: Add new types and update GameState interface

**Files:**
- Modify: `packages/core/src/types/index.ts`
- Modify: `packages/core/src/state/initialState.ts`

- [ ] **Step 1: Add `StratagemEffects` type and factory to `types/index.ts`**

Add after the `PersistingEffect` interface (around line 302):

```typescript
/** Tracks active core stratagem effects (phase-duration) */
export interface StratagemEffects {
  smokescreenUnits: string[];
  goToGroundUnits: string[];
  epicChallengeUnits: string[];
}

export function createEmptyStratagemEffects(): StratagemEffects {
  return { smokescreenUnits: [], goToGroundUnits: [], epicChallengeUnits: [] };
}

/** Context passed to faction state handlers during lifecycle transitions */
export interface PhaseChangeContext {
  newPhaseId: string;
  activePlayerId: string;
  roundNumber: number;
}

/** Lifecycle hooks for faction-specific state */
export interface FactionStateHandlers<T = Record<string, unknown>> {
  createInitial: () => T;
  onPhaseChange: (current: T, context: PhaseChangeContext) => T;
  onTurnChange: (current: T) => T;
}

/** Type alias for the generic faction state stored on GameState */
export type FactionStateSlice = Record<string, unknown>;
```

- [ ] **Step 2: Update GameState interface**

Replace the 6 old fields with 2 new fields:

```diff
- smokescreenUnits: string[];
- goToGroundUnits: string[];
- epicChallengeUnits: string[];
- guidedTargets: Record<string, string>;
- activeOrders: Record<string, string>;
- officersUsedThisPhase: string[];
+ stratagemEffects: StratagemEffects;
+ factionState: Record<string, FactionStateSlice>;
```

- [ ] **Step 3: Update `initialState.ts`**

```diff
- smokescreenUnits: [],
- goToGroundUnits: [],
- epicChallengeUnits: [],
- guidedTargets: {},
- activeOrders: {},
- officersUsedThisPhase: [],
+ stratagemEffects: createEmptyStratagemEffects(),
+ factionState: {},
```

Add import: `import { createEmptyStratagemEffects } from '../types/index';`

- [ ] **Step 4: Run typecheck to find all broken references**

Run: `cd packages/core && npx tsc --noEmit 2>&1 | head -100`
Expected: Many type errors pointing to every file that references the old fields. This is the migration checklist.

- [ ] **Step 5: Commit (typecheck will fail — that's expected)**

Do NOT commit yet. Proceed to the next tasks to fix all references before committing.

---

### Task 16: Update detachment registry with faction state handlers

**Files:**
- Modify: `packages/core/src/detachments/registry.ts`
- Modify: `packages/core/src/detachments/astra-militarum.ts`
- Modify: `packages/core/src/detachments/tau-empire.ts`

- [ ] **Step 1: Extend the detachment registry**

Add faction state handler registration to `packages/core/src/detachments/registry.ts`:

```typescript
import type { FactionStateHandlers, FactionStateSlice, PhaseChangeContext } from '../types/index';

const factionStateHandlers = new Map<string, FactionStateHandlers>();

export function registerFactionStateHandlers(factionId: string, handlers: FactionStateHandlers): void {
  factionStateHandlers.set(factionId, handlers);
}

export function getRegisteredFactionHandlers(): Map<string, FactionStateHandlers> {
  return factionStateHandlers;
}

export function getFactionState<T>(state: { factionState: Record<string, FactionStateSlice> }, factionId: string): T | undefined {
  return state.factionState[factionId] as T | undefined;
}
```

- [ ] **Step 2: Add state handlers to Astra Militarum**

In `packages/core/src/detachments/astra-militarum.ts`, add:

```typescript
import type { FactionStateHandlers } from '../types/index';

export interface AstraMilitarumState {
  activeOrders: Record<string, string>;
  officersUsedThisPhase: string[];
}

export const astraMilitarumStateHandlers: FactionStateHandlers<AstraMilitarumState> = {
  createInitial: () => ({ activeOrders: {}, officersUsedThisPhase: [] }),
  onPhaseChange: () => ({ activeOrders: {}, officersUsedThisPhase: [] }),
  onTurnChange: () => ({ activeOrders: {}, officersUsedThisPhase: [] }),
};
```

In the registration file (`astra-militarum.register.ts`), also register the state handlers:

```typescript
import { registerFactionStateHandlers } from './registry';
import { astraMilitarumStateHandlers } from './astra-militarum';
registerFactionStateHandlers('astra-militarum', astraMilitarumStateHandlers);
```

- [ ] **Step 3: Add state handlers to T'au Empire**

In `packages/core/src/detachments/tau-empire.ts`, add:

```typescript
import type { FactionStateHandlers } from '../types/index';

export interface TauEmpireState {
  guidedTargets: Record<string, string>;
}

export const tauEmpireStateHandlers: FactionStateHandlers<TauEmpireState> = {
  createInitial: () => ({ guidedTargets: {} }),
  onPhaseChange: (current, ctx) => {
    if (ctx.newPhaseId === 'shooting') {
      const { [ctx.activePlayerId]: _, ...rest } = current.guidedTargets;
      return { guidedTargets: rest };
    }
    return current;
  },
  // Current reducer's NEXT_TURN does NOT clear guidedTargets — preserve existing behavior
  onTurnChange: (current) => current,
};
```

Register in `tau-empire.register.ts`:

```typescript
import { registerFactionStateHandlers } from './registry';
import { tauEmpireStateHandlers } from './tau-empire';
registerFactionStateHandlers('tau-empire', tauEmpireStateHandlers);
```

- [ ] **Step 4: Commit** (still won't typecheck fully — that's fine)

---

### Task 17: Migrate sub-reducer references to new fields

**Files:**
- Modify: `packages/core/src/state/reducers/stratagemReducer.ts`
- Modify: `packages/core/src/state/reducers/lifecycleReducer.ts`

- [ ] **Step 1: Update `stratagemReducer.ts`**

In `USE_STRATAGEM`, replace:
- `state.smokescreenUnits` → `state.stratagemEffects.smokescreenUnits`
- `state.goToGroundUnits` → `state.stratagemEffects.goToGroundUnits`
- `state.epicChallengeUnits` → `state.stratagemEffects.epicChallengeUnits`

When setting these fields, use:
```typescript
stratagemEffects: {
  ...state.stratagemEffects,
  smokescreenUnits: [...state.stratagemEffects.smokescreenUnits, targetUnitId],
}
```

- [ ] **Step 2: Update `lifecycleReducer.ts`**

In ADVANCE_PHASE and NEXT_TURN, replace the 6 old field resets with:

```typescript
stratagemEffects: createEmptyStratagemEffects(),
factionState: resetFactionStateForPhase(state, newPhase.id), // or resetFactionStateForTurn(state)
```

Remove the old field resets:
```diff
- smokescreenUnits: [],
- goToGroundUnits: [],
- epicChallengeUnits: [],
- activeOrders: {},
- officersUsedThisPhase: [],
- guidedTargets: ...,
+ stratagemEffects: createEmptyStratagemEffects(),
+ factionState: resetFactionStateForPhase(state, newPhase.id),
```

In END_TURN and END_BATTLE_ROUND:
```diff
- smokescreenUnits: [],
- goToGroundUnits: [],
- epicChallengeUnits: [],
+ stratagemEffects: createEmptyStratagemEffects(),
```

Add the `resetFactionStateForPhase` and `resetFactionStateForTurn` helper functions to lifecycleReducer.ts (as defined in the spec).

Import `getRegisteredFactionHandlers` from `../../detachments/registry` and `createEmptyStratagemEffects` from `../../types/index`.

- [ ] **Step 3: Run typecheck to see remaining errors**

Run: `cd packages/core && npx tsc --noEmit 2>&1 | head -50`

---

### Task 18: Extract `factionReducer` and migrate faction field references

**Files:**
- Create: `packages/core/src/state/reducers/factionReducer.ts`
- Modify: `packages/core/src/state/reducers/index.ts`
- Modify: `packages/core/src/state/reducer.ts`

- [ ] **Step 1: Create `factionReducer.ts`**

Move the ISSUE_ORDER (lines 1028-1107) and DESIGNATE_GUIDED_TARGET (lines 1111-1137) cases. Migrate to use `getFactionState` and `factionState`:

For ISSUE_ORDER, replace:
- `state.officersUsedThisPhase` → `getFactionState<AstraMilitarumState>(state, 'astra-militarum')?.officersUsedThisPhase ?? []`
- `state.activeOrders` → `getFactionState<AstraMilitarumState>(state, 'astra-militarum')?.activeOrders ?? {}`
- When setting, update via `factionState`:
```typescript
factionState: {
  ...state.factionState,
  'astra-militarum': {
    ...(getFactionState<AstraMilitarumState>(state, 'astra-militarum') ?? { activeOrders: {}, officersUsedThisPhase: [] }),
    activeOrders: { ...(amState?.activeOrders ?? {}), [targetUnitId]: orderId },
    officersUsedThisPhase: [...(amState?.officersUsedThisPhase ?? []), officerUnitId],
  },
},
```

For DESIGNATE_GUIDED_TARGET, replace:
- `state.guidedTargets` → `getFactionState<TauEmpireState>(state, 'tau-empire')?.guidedTargets ?? {}`
- When setting, update via `factionState`:
```typescript
factionState: {
  ...state.factionState,
  'tau-empire': {
    guidedTargets: { ...(tauState?.guidedTargets ?? {}), [activePlayerId]: targetUnitId },
  },
},
```

Imports needed: `appendLog` from `../helpers`, `COMBINED_REGIMENT_ORDERS` from `../../types/index`, `distanceBetweenModels` from `../../measurement/index`, `getFactionState` from `../../detachments/registry`, `AstraMilitarumState` from `../../detachments/astra-militarum`, `TauEmpireState` from `../../detachments/tau-empire`.

- [ ] **Step 2: Remove the 2 cases from `reducer.ts`**, add `factionReducer` to the router array
- [ ] **Step 3: Update `reducers/index.ts`**
- [ ] **Step 4: Run typecheck**

Run: `cd packages/core && npx tsc --noEmit 2>&1 | head -50`

---

### Task 19: Migrate combat module and client references

**Files:**
- Modify: `packages/core/src/combat/index.ts`
- Modify: `packages/client/src/components/ShootingPanel.tsx`
- Modify: `packages/client/src/components/OrdersPanel.tsx`

- [ ] **Step 1: Update `combat/index.ts`**

Replace all references to old GameState fields:
- `state.smokescreenUnits` → `state.stratagemEffects.smokescreenUnits`
- `state.goToGroundUnits` → `state.stratagemEffects.goToGroundUnits`
- `state.epicChallengeUnits` → `state.stratagemEffects.epicChallengeUnits`
- `state.guidedTargets` → `getFactionState<TauEmpireState>(state, 'tau-empire')?.guidedTargets ?? {}`
- `state.activeOrders` → `getFactionState<AstraMilitarumState>(state, 'astra-militarum')?.activeOrders ?? {}`

Add imports for `getFactionState` from `../detachments/registry`, and the faction state types.

- [ ] **Step 2: Update `ShootingPanel.tsx`**

Replace references:
- `gameState.activeOrders` → `getFactionState<AstraMilitarumState>(gameState, 'astra-militarum')?.activeOrders ?? {}`
- `gameState.guidedTargets` → `getFactionState<TauEmpireState>(gameState, 'tau-empire')?.guidedTargets ?? {}`

Add imports.

- [ ] **Step 3: Update `OrdersPanel.tsx`**

Replace references:
- `gameState.officersUsedThisPhase` → `getFactionState<AstraMilitarumState>(gameState, 'astra-militarum')?.officersUsedThisPhase ?? []`
- `gameState.activeOrders` → `getFactionState<AstraMilitarumState>(gameState, 'astra-militarum')?.activeOrders ?? {}`

Add imports.

- [ ] **Step 4: Run full typecheck across all packages**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit && cd ../client && npx tsc --noEmit`

---

### Task 20: Migrate test references

**Files:**
- Modify: `packages/core/src/state/__tests__/sprintG.test.ts`
- Modify: `packages/core/src/state/__tests__/sprintG_24a.test.ts`
- Modify: `packages/core/src/state/__tests__/factionRules.test.ts`
- Modify: `packages/core/src/state/__tests__/sprintI.test.ts`
- Modify: `packages/core/src/test-helpers.ts`

- [ ] **Step 1: Update test helper if it initializes old fields**

Check `packages/core/src/test-helpers.ts` — if `makeModel`, `makeUnit`, or any helper sets `smokescreenUnits`, `activeOrders`, etc., update to use the new field paths.

- [ ] **Step 2: Update test assertions**

In each test file, find-and-replace:
- `state.smokescreenUnits` → `state.stratagemEffects.smokescreenUnits`
- `state.goToGroundUnits` → `state.stratagemEffects.goToGroundUnits`
- `state.epicChallengeUnits` → `state.stratagemEffects.epicChallengeUnits`
- `state.guidedTargets` → `getFactionState<TauEmpireState>(state, 'tau-empire')?.guidedTargets`
- `state.activeOrders` → `getFactionState<AstraMilitarumState>(state, 'astra-militarum')?.activeOrders`
- `state.officersUsedThisPhase` → `getFactionState<AstraMilitarumState>(state, 'astra-militarum')?.officersUsedThisPhase`

Add imports to test files.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All all tests pass.

- [ ] **Step 4: Run full typecheck**

Run: `make typecheck`
Expected: Zero type errors across all packages.

- [ ] **Step 5: Commit all Part 2 changes**

```bash
git add -A
git commit -m "refactor: clean up GameState — replace 6 faction fields with stratagemEffects and factionState"
```

---

### Task 21: Final verification and cleanup

**Files:**
- Verify: all packages

- [ ] **Step 1: Run complete test suite**

Run: `make test`
Expected: All tests pass.

- [ ] **Step 2: Run full typecheck**

Run: `make typecheck`
Expected: Zero errors in core, client, and server.

- [ ] **Step 3: Verify reducer.ts is < 100 LOC**

Run: `wc -l packages/core/src/state/reducer.ts`
Expected: < 100 lines.

- [ ] **Step 4: Verify no old field references remain**

Run: `grep -rn 'smokescreenUnits\|goToGroundUnits\|epicChallengeUnits' packages/core/src/ packages/client/src/ --include='*.ts' --include='*.tsx' | grep -v 'stratagemEffects\.' | grep -v '\.test\.' | grep -v 'types/index.ts'`

Should return zero results (the fields should only appear inside the `StratagemEffects` interface definition in types/index.ts).

Run: `grep -rn 'state\.guidedTargets\|state\.activeOrders\|state\.officersUsedThisPhase' packages/core/src/ packages/client/src/ --include='*.ts' --include='*.tsx'`

Should return zero results.

- [ ] **Step 5: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "refactor: final cleanup after reducer decomposition"
```
