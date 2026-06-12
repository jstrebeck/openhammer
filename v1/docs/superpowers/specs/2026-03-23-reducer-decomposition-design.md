# Reducer Decomposition & GameState Cleanup

**Date:** 2026-03-23
**Status:** Approved
**Scope:** Split monolithic reducer into domain sub-reducers; remove faction-specific fields from GameState

## Problem

Two critical architecture issues block extensibility:

1. **Monolithic reducer** (`packages/core/src/state/reducer.ts`, 4,093 LOC) — contains `getActionCategory()` with ~80 case mappings and the main `gameReducer` switch with ~95 distinct case implementations. All game domains are interleaved in one file. Impossible to reason about one domain without reading 4,000 lines.

2. **Faction-specific fields on GameState** — 6 fields (`smokescreenUnits`, `goToGroundUnits`, `epicChallengeUnits`, `guidedTargets`, `activeOrders`, `officersUsedThisPhase`) that are specific to core stratagems or individual factions (T'au, Astra Militarum). Every new faction or stratagem would add more fields.

## Constraints

- All 328+ existing tests must pass after each change — zero behavior changes.
- Incremental migration — one sub-reducer at a time, not a big bang.
- No changes to the `GameAction` union or action payload shapes.
- No changes to the client dispatch pattern (`gameStore.dispatch(action)`).
- No changes to the server relay (`gameReducer` call site stays the same).
- The public API of `gameReducer(state, action) => state` is unchanged.

## Design

### Part 1: Reducer Decomposition

#### File Structure

```
packages/core/src/state/
├── reducer.ts                ← thin router (~80 LOC)
├── actions.ts                ← unchanged
├── initialState.ts           ← updated for new fields
├── actionValidation.ts       ← extracted: getActionCategory(), isActionAllowedInPhase()
├── helpers.ts                ← shared: appendLog(), common lookups
└── reducers/
    ├── index.ts              ← re-exports all sub-reducers
    ├── setupReducer.ts       ← model/unit/terrain/zone/objective placement
    ├── movementReducer.ts    ← movement declaration, advance, commit, surge
    ├── shootingReducer.ts    ← shooting declaration, attacks, saves, damage
    ├── chargeReducer.ts      ← charge declaration, roll, commit, fail
    ├── fightReducer.ts       ← fight init, selection, pile-in, melee, consolidate
    ├── commandReducer.ts     ← command phase, battle-shock, CP management
    ├── stratagemReducer.ts   ← stratagem use, command reroll, tank shock, grenade, overwatch, heroic intervention
    ├── transportReducer.ts   ← embark, disembark, destroyed transport
    ├── aircraftReducer.ts    ← reserves, aircraft move, hover mode
    ├── deploymentReducer.ts  ← deploy unit, setup phases, scout moves, infiltrators
    ├── lifecycleReducer.ts   ← advance phase, next turn, end turn/round/battle, mission, scoring
    └── factionReducer.ts     ← issue order, designate guided target (delegates to faction handlers)
```

#### Sub-Reducer Signature

```typescript
// Each sub-reducer handles a subset of actions.
// Returns the new state if it handles the action, or null if it doesn't.
type SubReducer = (state: GameState, action: GameAction) => GameState | null;
```

Returning `null` means "I don't handle this action." The router tries the next reducer. Each sub-reducer owns its action types via its own switch statement.

#### Router (`reducer.ts`)

```typescript
import { isActionAllowedInPhase } from './actionValidation';
import { appendLog } from './helpers';
import { setupReducer } from './reducers/setupReducer';
import { movementReducer } from './reducers/movementReducer';
// ... etc

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
  factionReducer,
];

export function gameReducer(state: GameState, action: GameAction): GameState {
  // Phase restriction check (shared across all sub-reducers)
  const phaseCheck = isActionAllowedInPhase(state, action.type);
  if (!phaseCheck.allowed) {
    if (state.rulesConfig.phaseRestrictions === 'enforce') {
      return {
        ...state,
        log: appendLog(state.log, {
          type: 'message',
          text: `[BLOCKED] ${phaseCheck.reason}`,
          timestamp: Date.now(),
        }),
      };
    }
    state = {
      ...state,
      log: appendLog(state.log, {
        type: 'message',
        text: `[WARNING] ${phaseCheck.reason}`,
        timestamp: Date.now(),
      }),
    };
  }

  for (const reducer of subReducers) {
    const result = reducer(state, action);
    if (result !== null) return result;
  }
  return state; // unhandled action
}
```

#### Action-to-Reducer Mapping

| Sub-Reducer | Action Types |
|---|---|
| `setupReducer` | PLACE_MODEL, REMOVE_MODEL, ADD_UNIT, REMOVE_UNIT, IMPORT_ARMY, ADD_PLAYER, PLACE_TERRAIN, REMOVE_TERRAIN, UPDATE_TERRAIN, ADD_DEPLOYMENT_ZONE, REMOVE_DEPLOYMENT_ZONE, PLACE_OBJECTIVE, REMOVE_OBJECTIVE, UPDATE_OBJECTIVE, SET_BOARD_SIZE, SET_EDITION, SET_RULES_CONFIG, SET_MODEL_WOUNDS, ATTACH_LEADER, DETACH_LEADER |
| `movementReducer` | MOVE_MODEL, ROTATE_MODEL, DECLARE_MOVEMENT, ROLL_ADVANCE, COMMIT_MOVEMENT, SURGE_MOVE |
| `shootingReducer` | DECLARE_SHOOTING, ASSIGN_WEAPON_TARGETS, RESOLVE_SHOOTING_ATTACK, RESOLVE_SAVE_ROLL, APPLY_DAMAGE, COMPLETE_SHOOTING, RESOLVE_HAZARDOUS, APPLY_MORTAL_WOUNDS, RESOLVE_DEADLY_DEMISE |
| `chargeReducer` | DECLARE_CHARGE, ROLL_CHARGE, COMMIT_CHARGE_MOVE, FAIL_CHARGE |
| `fightReducer` | INITIALIZE_FIGHT_PHASE, SELECT_UNIT_TO_FIGHT, PILE_IN, RESOLVE_MELEE_ATTACK, CONSOLIDATE, COMPLETE_FIGHT |
| `commandReducer` | START_COMMAND_PHASE, RESOLVE_BATTLE_SHOCK, SET_COMMAND_POINTS |
| `stratagemReducer` | USE_STRATAGEM, APPLY_COMMAND_REROLL, RESOLVE_TANK_SHOCK, RESOLVE_GRENADE, RESOLVE_OVERWATCH, RESOLVE_HEROIC_INTERVENTION, ADD_PERSISTING_EFFECT, REMOVE_PERSISTING_EFFECT |
| `transportReducer` | EMBARK, DISEMBARK, RESOLVE_DESTROYED_TRANSPORT |
| `aircraftReducer` | SET_UNIT_IN_RESERVES, ARRIVE_FROM_RESERVES, AIRCRAFT_MOVE, AIRCRAFT_OFF_BOARD, SET_HOVER_MODE |
| `deploymentReducer` | DETERMINE_ATTACKER_DEFENDER, BEGIN_DEPLOYMENT, DEPLOY_UNIT, DETERMINE_FIRST_TURN, RESOLVE_REDEPLOYMENT, ADVANCE_SETUP_PHASE, SCOUT_MOVE, DEPLOY_INFILTRATORS, DESIGNATE_WARLORD, SET_POINTS_LIMIT, SET_FACTION_KEYWORD, SELECT_DETACHMENT, ASSIGN_ENHANCEMENT, REMOVE_ENHANCEMENT, VALIDATE_ARMY |
| `lifecycleReducer` | ADVANCE_PHASE, NEXT_TURN, SET_MISSION, SELECT_SECONDARY, END_TURN, END_BATTLE_ROUND, END_BATTLE, CALCULATE_OBJECTIVE_CONTROL, UPDATE_SCORE, ACTIVATE_UNIT, COMPLETE_UNIT_ACTIVATION, LOG_MESSAGE, ROLL_DICE, ROLL_OFF, CHECK_END_OF_TURN_COHERENCY, RESOLVE_DESPERATE_ESCAPE |
| `factionReducer` | ISSUE_ORDER, DESIGNATE_GUIDED_TARGET (plus any future faction-specific actions) |

#### Shared Utilities

Extracted from the current reducer into shared files:

**`actionValidation.ts`:**
- `getActionCategory(actionType: string): ActionCategory | null`
- `isActionAllowedInPhase(state: GameState, actionType: string): { allowed: boolean; reason?: string }`

**`helpers.ts`:**
- `appendLog(log: GameLog, entry: LogEntry): GameLog`
- Any repeated patterns (model lookup, unit ownership checks, etc.)

Each sub-reducer imports what it needs from these shared modules and from domain modules (`../measurement`, `../combat`, `../transport`, etc.).

#### Extraction Order

Sub-reducers are extracted one at a time. After each extraction, all tests must pass.

1. Extract `actionValidation.ts` and `helpers.ts` (no behavioral change)
2. `setupReducer` (simplest actions, good proof-of-concept)
3. `chargeReducer` (small, self-contained)
4. `transportReducer` (small, self-contained)
5. `aircraftReducer` (small, self-contained)
6. `commandReducer` (small)
7. `movementReducer` (medium, well-bounded)
8. `shootingReducer` (medium, more complex)
9. `fightReducer` (medium)
10. `stratagemReducer` (medium, touches stratagem effects)
11. `deploymentReducer` (medium, many setup actions)
12. `lifecycleReducer` (phase transitions, resets — do after stratagemReducer since it resets stratagem state)
13. `factionReducer` (last — depends on Part 2 GameState changes)

---

### Part 2: GameState Cleanup — Typed Faction Plugin State

#### New Types

```typescript
/** Tracks active core stratagem effects (phase-duration) */
interface StratagemEffects {
  smokescreenUnits: string[];
  goToGroundUnits: string[];
  epicChallengeUnits: string[];
}

function createEmptyStratagemEffects(): StratagemEffects {
  return { smokescreenUnits: [], goToGroundUnits: [], epicChallengeUnits: [] };
}

/** Context passed to faction state handlers during phase/turn transitions */
interface PhaseChangeContext {
  newPhaseId: string;
  activePlayerId: string;
  roundNumber: number;
}

/** Lifecycle hooks for faction-specific state */
interface FactionStateHandlers<T = Record<string, unknown>> {
  createInitial: () => T;
  onPhaseChange: (current: T, context: PhaseChangeContext) => T;
  onTurnChange: (current: T) => T;
}

/** Type alias for the generic faction state stored on GameState */
type FactionStateSlice = Record<string, unknown>;
```

#### GameState Changes

```diff
  // Remove 6 fields:
- smokescreenUnits: string[];
- goToGroundUnits: string[];
- epicChallengeUnits: string[];
- guidedTargets: Record<string, string>;
- activeOrders: Record<string, string>;
- officersUsedThisPhase: string[];

  // Add 2 fields:
+ stratagemEffects: StratagemEffects;
+ factionState: Record<string, FactionStateSlice>;
```

#### Faction State Registration

Each faction definition adds state handlers alongside its existing `FactionDefinition`:

```typescript
// detachments/astra-militarum.ts
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

```typescript
// detachments/tau-empire.ts
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

Handlers register via the existing detachment registry (`detachments/registry.ts`), extending it to hold both `FactionDefinition` and `FactionStateHandlers`.

#### Reading Faction State

```typescript
// Type-safe accessor (in a shared helper or the registry):
function getFactionState<T>(state: GameState, factionId: string): T | undefined {
  return state.factionState[factionId] as T | undefined;
}

// In factionReducer:
const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
if (!amState) return null;

// In client components:
const amState = getFactionState<AstraMilitarumState>(gameState, 'astra-militarum');
```

#### Lifecycle Integration

In `lifecycleReducer`, four actions must reset stratagem effects and call faction handlers:

- **ADVANCE_PHASE** — clears `stratagemEffects`, calls `onPhaseChange` for all registered factions
- **NEXT_TURN** — clears `stratagemEffects`, calls `onTurnChange` for all registered factions
- **END_TURN** — clears `stratagemEffects` (matches current behavior: lines 3437-3439 of reducer.ts)
- **END_BATTLE_ROUND** — clears `stratagemEffects` (matches current behavior: lines 3490-3492 of reducer.ts)

Note: `END_TURN` and `END_BATTLE_ROUND` currently do NOT reset `activeOrders`, `officersUsedThisPhase`, or `guidedTargets` — only `ADVANCE_PHASE` and `NEXT_TURN` do. The faction handlers replicate this: `onPhaseChange` (called from ADVANCE_PHASE) and `onTurnChange` (called from NEXT_TURN) handle faction resets. END_TURN and END_BATTLE_ROUND only clear `stratagemEffects`.

```typescript
// Shared helper used by ADVANCE_PHASE:
function resetFactionStateForPhase(state: GameState, newPhaseId: string): Record<string, FactionStateSlice> {
  const newFactionState = { ...state.factionState };
  for (const [factionId, handlers] of getRegisteredFactionHandlers()) {
    const current = state.factionState[factionId] ?? handlers.createInitial();
    newFactionState[factionId] = handlers.onPhaseChange(current, {
      newPhaseId,
      activePlayerId: state.turnState.activePlayerId,
      roundNumber: state.turnState.roundNumber,
    });
  }
  return newFactionState;
}

// Shared helper used by NEXT_TURN:
function resetFactionStateForTurn(state: GameState): Record<string, FactionStateSlice> {
  const newFactionState = { ...state.factionState };
  for (const [factionId, handlers] of getRegisteredFactionHandlers()) {
    const current = state.factionState[factionId] ?? handlers.createInitial();
    newFactionState[factionId] = handlers.onTurnChange(current);
  }
  return newFactionState;
}

// In ADVANCE_PHASE:
return {
  ...state,
  stratagemEffects: createEmptyStratagemEffects(),
  factionState: resetFactionStateForPhase(state, newPhase.id),
  // ... other resets
};

// In END_TURN / END_BATTLE_ROUND (stratagem effects only, no faction reset):
return {
  ...state,
  stratagemEffects: createEmptyStratagemEffects(),
  // ... other resets
};
```

#### Cross-Cutting Concern: `outOfPhaseAction`

The `outOfPhaseAction` field on GameState is set by `USE_STRATAGEM` (in `stratagemReducer`) and cleared by `RESOLVE_OVERWATCH` and `RESOLVE_HEROIC_INTERVENTION` (also in `stratagemReducer`), as well as by `ADVANCE_PHASE`, `NEXT_TURN`, `END_TURN`, and `END_BATTLE_ROUND` (all in `lifecycleReducer`). Since phase validation is extracted to `actionValidation.ts` and checks `state.outOfPhaseAction` directly, this works without coordination between sub-reducers.

#### Migration of Existing Code

Every reference to the old fields must be updated:

| Old Field | New Location | Affected Files |
|---|---|---|
| `state.smokescreenUnits` | `state.stratagemEffects.smokescreenUnits` | Reducer: USE_STRATAGEM, ADVANCE_PHASE, NEXT_TURN, END_TURN, END_BATTLE_ROUND. Combat: `packages/core/src/combat/index.ts`. Tests: `sprintG.test.ts`, `sprintG_24a.test.ts`, `sprintI.test.ts` |
| `state.goToGroundUnits` | `state.stratagemEffects.goToGroundUnits` | Same as above |
| `state.epicChallengeUnits` | `state.stratagemEffects.epicChallengeUnits` | Same as above |
| `state.guidedTargets` | `getFactionState<TauEmpireState>(state, 'tau-empire')?.guidedTargets` | Reducer: DESIGNATE_GUIDED_TARGET, ADVANCE_PHASE. Combat: `packages/core/src/combat/index.ts`. Client: `ShootingPanel.tsx` (lines 267, 512, 611). Tests: `factionRules.test.ts` |
| `state.activeOrders` | `getFactionState<AstraMilitarumState>(state, 'astra-militarum')?.activeOrders` | Reducer: ISSUE_ORDER, ADVANCE_PHASE. Combat: `packages/core/src/combat/index.ts`. Client: `ShootingPanel.tsx` (line 257), `OrdersPanel.tsx` (lines 32, 73). Tests: `factionRules.test.ts` |
| `state.officersUsedThisPhase` | `getFactionState<AstraMilitarumState>(state, 'astra-militarum')?.officersUsedThisPhase` | Reducer: ISSUE_ORDER, ADVANCE_PHASE. Client: `OrdersPanel.tsx` (line 29). Tests: `factionRules.test.ts` |

#### `initialState.ts` Changes

```diff
  export function createInitialGameState(...): GameState {
    return {
      ...
-     smokescreenUnits: [],
-     goToGroundUnits: [],
-     epicChallengeUnits: [],
-     guidedTargets: {},
-     activeOrders: {},
-     officersUsedThisPhase: [],
+     stratagemEffects: createEmptyStratagemEffects(),
+     factionState: {},
      ...
    };
  }
```

## Ordering: Part 1 vs Part 2

Part 1 (reducer decomposition) is done first, steps 1-12. Sub-reducers initially reference the old GameState fields (`smokescreenUnits`, `activeOrders`, etc.) as they exist today.

Part 2 (GameState cleanup) is done after all sub-reducers are extracted. At that point, migrating field references is simpler because each field is used in a small, focused file rather than scattered across a 4,000-line monolith. The `factionReducer` (step 13) is extracted as part of the Part 2 migration since it depends on the new `factionState` field.

## Testing Strategy

- **No new tests required** — this is a pure refactor with zero behavior changes.
- All 328+ existing tests must pass after each extraction step.
- Run `make test` after every sub-reducer extraction.
- Run `make typecheck` after the GameState field migration to catch all references.
- Test files that reference old fields and need updating during Part 2: `sprintG.test.ts`, `sprintG_24a.test.ts`, `factionRules.test.ts`, `sprintI.test.ts`.

## What This Does NOT Include

- Combat module split (tracked in ARCHITECTURE-CONCERNS.md #3)
- Client component decomposition (#8)
- Stratagem system redesign (#5)
- Edition constant centralization (#11)
- Phase name hardcoding in client (#4)

These remain tracked for future work.
