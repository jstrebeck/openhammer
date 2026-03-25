# Interactive Save Rolls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change save rolls from automatic (attacker-resolved) to interactive (defender-resolved) for both shooting and melee phases.

**Architecture:** Add a `pendingSaves` array to `ShootingState` and `FightState`. After wound rolls, the reducer creates `PendingSave` entries. A new `RESOLVE_PENDING_SAVES` action lets the defending player batch-roll saves per weapon. A new `SaveRollPanel` React component handles the defender UI. Multiplayer sync works via existing `ACTION_BROADCAST` — no new message types.

**Tech Stack:** TypeScript, Vitest (tests), React (client UI), Zustand (state), WebSocket (multiplayer)

**Spec:** `docs/superpowers/specs/2026-03-24-interactive-save-rolls-design.md`

---

## File Map

### Core (packages/core/src/)

| File | Action | Responsibility |
|------|--------|----------------|
| `types/index.ts` | Modify | Add `PendingSave`, `PendingSaveResult` types; add `pendingSaves` to `ShootingState` and `FightState` |
| `state/actions.ts` | Modify | Add `RESOLVE_PENDING_SAVES` action; remove `RESOLVE_SAVE_ROLL` |
| `state/actionValidation.ts` | Modify | Add `RESOLVE_PENDING_SAVES` as `'admin'`; remove `RESOLVE_SAVE_ROLL` |
| `state/reducers/shootingReducer.ts` | Modify | Create `PendingSave` in `RESOLVE_SHOOTING_ATTACK`; add `RESOLVE_PENDING_SAVES` handler; gate `COMPLETE_SHOOTING`; remove `RESOLVE_SAVE_ROLL` |
| `state/reducers/fightReducer.ts` | Modify | Create `PendingSave` in `RESOLVE_MELEE_ATTACK`; gate `COMPLETE_FIGHT` |
| `state/reducers/pendingSavesReducer.ts` | Create | Shared `RESOLVE_PENDING_SAVES` handler that searches both shooting and fight state |
| `state/reducers/lifecycleReducer.ts` | Modify | Gate `ADVANCE_PHASE` and `NEXT_TURN` on unresolved pending saves |
| `state/reducer.ts` | Modify | Register `pendingSavesReducer` in sub-reducer list |
| `state/initialState.ts` | Modify | Add `pendingSaves: []` to `createEmptyShootingState()` and `createEmptyFightState()` |
| `combat/__tests__/pendingSaves.test.ts` | Create | Tests for the new pending saves flow |

### Client (packages/client/src/)

| File | Action | Responsibility |
|------|--------|----------------|
| `components/ShootingPanel.tsx` | Modify | Remove save roll loop from `handleResolve()`; show pending saves UI or waiting state |
| `components/FightPanel.tsx` | Modify | Remove save roll loop from `handleResolveAttack()`; show pending saves UI or waiting state |
| `components/SaveRollPanel.tsx` | Create | Reusable defender save roll component for both phases |
| `store/gameStore.ts` | Modify | Disable undo while unresolved pending saves exist |

---

## Task 1: Add PendingSave types and update state shapes

**Files:**
- Modify: `packages/core/src/types/index.ts:199-237` (AttackSequence, ShootingState, createEmptyShootingState)
- Modify: `packages/core/src/types/index.ts:258-282` (FightState, createEmptyFightState)

- [ ] **Step 1: Add PendingSave and PendingSaveResult interfaces**

In `packages/core/src/types/index.ts`, add after the `AttackSequence` interface (after line 216):

```typescript
/** A pending save roll awaiting the defending player */
export interface PendingSave {
  id: string;
  attackSequenceId: string;
  attackingPlayerId: string;
  defendingPlayerId: string;
  targetUnitId: string;
  weaponName: string;
  wounds: number;
  ap: number; // Raw weapon AP (negative, e.g. -2)
  damage: string; // Dice expression e.g. "1", "D6"
  coverSaveModifier?: number;
  fnpThreshold?: number;
  mortalWounds: number;
  resolved: boolean;
  results?: PendingSaveResult[];
}

/** Result of a single model's save roll within a PendingSave */
export interface PendingSaveResult {
  targetModelId: string;
  saveRoll: DiceRoll;
  saved: boolean;
  fnpRolls?: DiceRoll[];
  damageApplied: number;
}
```

- [ ] **Step 2: Add pendingSaves to ShootingState**

In `packages/core/src/types/index.ts`, update `ShootingState` (line 219) to add the field:

```typescript
export interface ShootingState {
  activeShootingUnit: string | null;
  weaponAssignments: Array<{ modelId: string; weaponId: string; targetUnitId: string }>;
  activeAttacks: AttackSequence[];
  unitsShot: string[];
  pendingSaves: PendingSave[];
}
```

Update `createEmptyShootingState()` (line 230) to include `pendingSaves: []`:

```typescript
export function createEmptyShootingState(): ShootingState {
  return {
    activeShootingUnit: null,
    weaponAssignments: [],
    activeAttacks: [],
    unitsShot: [],
    pendingSaves: [],
  };
}
```

- [ ] **Step 3: Add pendingSaves to FightState**

In `packages/core/src/types/index.ts`, update `FightState` (line 258) to add the field:

```typescript
export interface FightState {
  fightStep: 'fights_first' | 'remaining';
  eligibleUnits: string[];
  currentFighter: string | null;
  unitsFought: string[];
  nextToSelect: string | null;
  activeAttacks: AttackSequence[];
  pendingSaves: PendingSave[];
}
```

Update `createEmptyFightState()` (line 273) to include `pendingSaves: []`:

```typescript
export function createEmptyFightState(): FightState {
  return {
    fightStep: 'fights_first',
    eligibleUnits: [],
    currentFighter: null,
    unitsFought: [],
    nextToSelect: null,
    activeAttacks: [],
    pendingSaves: [],
  };
}
```

- [ ] **Step 4: Run typecheck to verify no type errors**

Run: `make typecheck-core`
Expected: PASS (new fields have defaults in factory functions; no consumers reference them yet)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types/index.ts
git commit -m "feat: add PendingSave types and pendingSaves to ShootingState/FightState"
```

---

## Task 2: Add RESOLVE_PENDING_SAVES action type and update validation

**Files:**
- Modify: `packages/core/src/state/actions.ts:57` (RESOLVE_SAVE_ROLL line)
- Modify: `packages/core/src/state/actionValidation.ts:26,66`

**Note:** We ADD `RESOLVE_PENDING_SAVES` alongside `RESOLVE_SAVE_ROLL` in this task. `RESOLVE_SAVE_ROLL` is removed later in Task 7 after all its usages are migrated. This keeps the build green at each commit.

- [ ] **Step 1: Add RESOLVE_PENDING_SAVES to the action union in actions.ts**

In `packages/core/src/state/actions.ts`, add a new line after line 57 (after `RESOLVE_SAVE_ROLL`):

```typescript
  | { type: 'RESOLVE_PENDING_SAVES'; payload: { pendingSaveId: string; results: import('../types/index').PendingSaveResult[] } }
```

Keep `RESOLVE_SAVE_ROLL` for now — it will be removed in Task 7.

- [ ] **Step 2: Add RESOLVE_PENDING_SAVES to actionValidation.ts**

In `packages/core/src/state/actionValidation.ts`, add `'RESOLVE_PENDING_SAVES'` to the admin category (after line 93):

```typescript
    case 'RESOLVE_PENDING_SAVES':
```

- [ ] **Step 3: Run typecheck**

Run: `make typecheck-core`
Expected: PASS — both action types coexist

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/state/actions.ts packages/core/src/state/actionValidation.ts
git commit -m "feat: add RESOLVE_PENDING_SAVES action type"
```

---

## Task 3: Create PendingSave in RESOLVE_SHOOTING_ATTACK and remove RESOLVE_SAVE_ROLL handler

**Files:**
- Modify: `packages/core/src/state/reducers/shootingReducer.ts:88-164`
- Test: `packages/core/src/combat/__tests__/pendingSaves.test.ts` (create)

- [ ] **Step 1: Write failing tests for PendingSave creation from shooting**

Create `packages/core/src/combat/__tests__/pendingSaves.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { rollDice } from '../../dice/index';
import type { GameState } from '../../types/index';

function setupShootingState(): GameState {
  let state = createInitialGameState();
  const attacker = makePlayer({ id: 'p1', name: 'Attacker' });
  const defender = makePlayer({ id: 'p2', name: 'Defender' });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: attacker } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: defender } });

  const attackerModel = makeModel({
    id: 'am1', unitId: 'au1', name: 'Marine', position: { x: 10, y: 10 },
  });
  const attackerUnit = makeUnit({
    id: 'au1', name: 'Intercessors', playerId: 'p1', modelIds: ['am1'],
    weapons: [{ id: 'w1', name: 'Bolt Rifle', type: 'ranged', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' }],
  });
  state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: attackerUnit, models: [attackerModel] } });

  const defenderModel1 = makeModel({
    id: 'dm1', unitId: 'du1', name: 'Ork Boy', position: { x: 20, y: 10 },
    stats: { move: 6, toughness: 4, save: 5, wounds: 1, leadership: 7, objectiveControl: 1 },
    wounds: 1, maxWounds: 1,
  });
  const defenderModel2 = makeModel({
    id: 'dm2', unitId: 'du1', name: 'Ork Boy', position: { x: 20, y: 12 },
    stats: { move: 6, toughness: 4, save: 5, wounds: 1, leadership: 7, objectiveControl: 1 },
    wounds: 1, maxWounds: 1,
  });
  const defenderUnit = makeUnit({
    id: 'du1', name: 'Boyz', playerId: 'p2', modelIds: ['dm1', 'dm2'],
  });
  state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: defenderUnit, models: [defenderModel1, defenderModel2] } });

  // Declare shooting
  state = gameReducer(state, { type: 'DECLARE_SHOOTING', payload: { unitId: 'au1' } });
  state = gameReducer(state, {
    type: 'ASSIGN_WEAPON_TARGETS',
    payload: { assignments: [{ modelId: 'am1', weaponId: 'w1', targetUnitId: 'du1' }] },
  });

  return state;
}

describe('Pending Saves - Shooting', () => {
  it('RESOLVE_SHOOTING_ATTACK creates a PendingSave entry', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1',
        attackingModelId: 'am1',
        weaponId: 'w1',
        weaponName: 'Bolt Rifle',
        targetUnitId: 'du1',
        numAttacks: 2,
        hitRoll,
        hits: 2,
        woundRoll,
        wounds: 2,
      },
    });

    expect(state.shootingState.pendingSaves).toHaveLength(1);
    const ps = state.shootingState.pendingSaves[0];
    expect(ps.wounds).toBe(2);
    expect(ps.ap).toBe(-1);
    expect(ps.damage).toBe('1');
    expect(ps.targetUnitId).toBe('du1');
    expect(ps.attackingPlayerId).toBe('p1');
    expect(ps.defendingPlayerId).toBe('p2');
    expect(ps.resolved).toBe(false);
    expect(ps.weaponName).toBe('Bolt Rifle');
  });

  it('RESOLVE_SHOOTING_ATTACK with 0 wounds does not create PendingSave', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(0, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1',
        attackingModelId: 'am1',
        weaponId: 'w1',
        weaponName: 'Bolt Rifle',
        targetUnitId: 'du1',
        numAttacks: 2,
        hitRoll,
        hits: 0,
        woundRoll,
        wounds: 0,
      },
    });

    expect(state.shootingState.pendingSaves).toHaveLength(0);
  });

  it('COMPLETE_SHOOTING is blocked with unresolved pending saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    // Try to complete — should be blocked
    const stateAfter = gameReducer(state, { type: 'COMPLETE_SHOOTING', payload: { unitId: 'au1' } });
    // activeShootingUnit should still be set (not cleared)
    expect(stateAfter.shootingState.activeShootingUnit).toBe('au1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts`
Expected: FAIL — `RESOLVE_SAVE_ROLL` type error and `pendingSaves` doesn't exist yet in the handler

- [ ] **Step 3: Modify RESOLVE_SHOOTING_ATTACK to create PendingSave**

In `packages/core/src/state/reducers/shootingReducer.ts`, update the `RESOLVE_SHOOTING_ATTACK` case (line 88). After creating the `attack` object and updating `weaponsFired`, add PendingSave creation:

Replace the return statement at lines 133-145 with:

```typescript
      // Create PendingSave if there are wounds to save against
      let newPendingSaves = state.shootingState.pendingSaves;
      if (wounds > 0) {
        const weapon = attackerUnit?.weapons.find(w => w.id === weaponId);
        const targetUnit = state.units[targetUnitId];

        // Populate fnpThreshold from target unit abilities (e.g. "FEEL NO PAIN 5+")
        let fnpThreshold: number | undefined;
        if (targetUnit) {
          const fnpValue = getUnitAbilityValue(targetUnit, 'FEEL NO PAIN');
          if (fnpValue !== undefined) fnpThreshold = fnpValue;
        }

        newPendingSaves = [
          ...state.shootingState.pendingSaves,
          {
            id: generateUUID(),
            attackSequenceId: attack.id,
            attackingPlayerId: attackerUnit?.playerId ?? '',
            defendingPlayerId: targetUnit?.playerId ?? '',
            targetUnitId,
            weaponName,
            wounds,
            ap: weapon?.ap ?? 0,
            damage: weapon?.damage ?? '1',
            fnpThreshold,
            mortalWounds: 0,
            resolved: false,
          },
        ];
      }

      return {
        ...state,
        weaponsFired: newWeaponsFired,
        shootingState: {
          ...state.shootingState,
          activeAttacks: [...state.shootingState.activeAttacks, attack],
          pendingSaves: newPendingSaves,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${weaponName}: ${numAttacks} attacks → ${hits} hits → ${wounds} wounds`,
          timestamp: Date.now(),
        }),
      };
```

Add `import { getUnitAbilityValue } from '../../combat/abilities';` at the top of the file.


- [ ] **Step 4: Remove the RESOLVE_SAVE_ROLL handler**

In `packages/core/src/state/reducers/shootingReducer.ts`, delete the entire `case 'RESOLVE_SAVE_ROLL':` block (lines 148-164).

- [ ] **Step 5: Gate COMPLETE_SHOOTING on unresolved pending saves**

In `packages/core/src/state/reducers/shootingReducer.ts`, update the `COMPLETE_SHOOTING` case (line 190). Add a guard at the top:

```typescript
    case 'COMPLETE_SHOOTING': {
      const { unitId } = action.payload;

      // Block if there are unresolved pending saves
      const hasUnresolvedSaves = state.shootingState.pendingSaves.some(ps => !ps.resolved);
      if (hasUnresolvedSaves) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: '[BLOCKED] Cannot complete shooting — pending saves must be resolved first',
            timestamp: Date.now(),
          }),
        };
      }

      return {
        ...state,
        shootingState: {
          ...state.shootingState,
          activeShootingUnit: null,
          weaponAssignments: [],
          activeAttacks: [],
          unitsShot: [...state.shootingState.unitsShot, unitId],
          pendingSaves: [],
        },
        turnTracking: {
          ...state.turnTracking,
          unitsCompleted: { ...state.turnTracking.unitsCompleted, [unitId]: true },
        },
      };
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/state/reducers/shootingReducer.ts packages/core/src/combat/__tests__/pendingSaves.test.ts
git commit -m "feat: RESOLVE_SHOOTING_ATTACK creates PendingSave; remove RESOLVE_SAVE_ROLL"
```

---

## Task 4: Create PendingSave in RESOLVE_MELEE_ATTACK and gate COMPLETE_FIGHT

**Files:**
- Modify: `packages/core/src/state/reducers/fightReducer.ts:347-402,454-508`
- Test: `packages/core/src/combat/__tests__/pendingSaves.test.ts` (append)

- [ ] **Step 1: Write failing tests for PendingSave creation from melee**

Append to `packages/core/src/combat/__tests__/pendingSaves.test.ts`:

```typescript
describe('Pending Saves - Fight', () => {
  it('RESOLVE_MELEE_ATTACK creates a PendingSave entry in fightState', () => {
    let state = createInitialGameState();
    const p1 = makePlayer({ id: 'p1', name: 'Attacker' });
    const p2 = makePlayer({ id: 'p2', name: 'Defender' });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });

    const am = makeModel({ id: 'am1', unitId: 'au1', position: { x: 10, y: 10 } });
    const au = makeUnit({
      id: 'au1', playerId: 'p1', modelIds: ['am1'],
      weapons: [{ id: 'mw1', name: 'Chainsword', type: 'melee', attacks: '3', skill: 3, strength: 4, ap: -1, damage: '1' }],
    });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: au, models: [am] } });

    const dm = makeModel({ id: 'dm1', unitId: 'du1', position: { x: 11, y: 10 }, wounds: 2, maxWounds: 2 });
    const du = makeUnit({ id: 'du1', playerId: 'p2', modelIds: ['dm1'] });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: du, models: [dm] } });

    const hitRoll = rollDice(3, 6, 'To Hit', 3);
    const woundRoll = rollDice(3, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_MELEE_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'mw1',
        weaponName: 'Chainsword', targetUnitId: 'du1',
        numAttacks: 3, hitRoll, hits: 3, woundRoll, wounds: 2,
      },
    });

    expect(state.fightState.pendingSaves).toHaveLength(1);
    const ps = state.fightState.pendingSaves[0];
    expect(ps.wounds).toBe(2);
    expect(ps.ap).toBe(-1);
    expect(ps.defendingPlayerId).toBe('p2');
  });

  it('COMPLETE_FIGHT is blocked with unresolved pending saves', () => {
    let state = createInitialGameState();
    const p1 = makePlayer({ id: 'p1', name: 'Attacker' });
    const p2 = makePlayer({ id: 'p2', name: 'Defender' });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });

    const am = makeModel({ id: 'am1', unitId: 'au1', position: { x: 10, y: 10 } });
    const au = makeUnit({
      id: 'au1', playerId: 'p1', modelIds: ['am1'],
      weapons: [{ id: 'mw1', name: 'Chainsword', type: 'melee', attacks: '3', skill: 3, strength: 4, ap: -1, damage: '1' }],
    });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: au, models: [am] } });

    const dm = makeModel({ id: 'dm1', unitId: 'du1', position: { x: 11, y: 10 } });
    const du = makeUnit({ id: 'du1', playerId: 'p2', modelIds: ['dm1'] });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: du, models: [dm] } });

    // Set up fight state with current fighter
    state = {
      ...state,
      fightState: { ...state.fightState, currentFighter: 'au1' },
    };

    const hitRoll = rollDice(3, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_MELEE_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'mw1',
        weaponName: 'Chainsword', targetUnitId: 'du1',
        numAttacks: 3, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const stateAfter = gameReducer(state, { type: 'COMPLETE_FIGHT', payload: { unitId: 'au1' } });
    // Fight should not have completed — currentFighter still set
    expect(stateAfter.fightState.activeAttacks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts`
Expected: FAIL — fightReducer doesn't create pendingSaves yet

- [ ] **Step 3: Modify RESOLVE_MELEE_ATTACK to create PendingSave**

In `packages/core/src/state/reducers/fightReducer.ts`, update the `RESOLVE_MELEE_ATTACK` case (around line 375). After creating the `attack` object, replace the return statement at lines 390-401:

```typescript
      // Create PendingSave if there are wounds to save against
      const meleeUnit = state.units[attackingUnitId];
      let newPendingSaves = state.fightState.pendingSaves;
      if (wounds > 0) {
        const weapon = meleeUnit?.weapons.find(w => w.id === weaponId);
        const targetUnit = state.units[targetUnitId];

        // Populate fnpThreshold from target unit abilities
        let fnpThreshold: number | undefined;
        if (targetUnit) {
          const fnpValue = getUnitAbilityValue(targetUnit, 'FEEL NO PAIN');
          if (fnpValue !== undefined) fnpThreshold = fnpValue;
        }

        newPendingSaves = [
          ...state.fightState.pendingSaves,
          {
            id: generateUUID(),
            attackSequenceId: attack.id,
            attackingPlayerId: meleeUnit?.playerId ?? '',
            defendingPlayerId: targetUnit?.playerId ?? '',
            targetUnitId,
            weaponName,
            wounds,
            ap: weapon?.ap ?? 0,
            damage: weapon?.damage ?? '1',
            fnpThreshold,
            mortalWounds: 0,
            resolved: false,
          },
        ];
      }

      return {
        ...state,
        fightState: {
          ...state.fightState,
          activeAttacks: [...state.fightState.activeAttacks, attack],
          pendingSaves: newPendingSaves,
        },
        log: appendLog(state.log, {
          type: 'message',
          text: `${weaponName} (melee): ${numAttacks} attacks → ${hits} hits → ${wounds} wounds`,
          timestamp: Date.now(),
        }),
      };
```

Add `import { getUnitAbilityValue } from '../../combat/abilities';` at the top of the file if not already imported.

- [ ] **Step 4: Gate COMPLETE_FIGHT on unresolved pending saves**

In `packages/core/src/state/reducers/fightReducer.ts`, update the `COMPLETE_FIGHT` case (line 454). Add a guard at the top:

```typescript
    case 'COMPLETE_FIGHT': {
      const { unitId } = action.payload;

      // Block if there are unresolved pending saves
      const hasUnresolvedSaves = state.fightState.pendingSaves.some(ps => !ps.resolved);
      if (hasUnresolvedSaves) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: '[BLOCKED] Cannot complete fight — pending saves must be resolved first',
            timestamp: Date.now(),
          }),
        };
      }

      // ... rest of existing handler unchanged, but clear pendingSaves in the newFightState:
```

Also ensure `pendingSaves: []` is included when constructing `newFightState`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state/reducers/fightReducer.ts packages/core/src/combat/__tests__/pendingSaves.test.ts
git commit -m "feat: RESOLVE_MELEE_ATTACK creates PendingSave; gate COMPLETE_FIGHT"
```

---

## Task 5: Create pendingSavesReducer to handle RESOLVE_PENDING_SAVES

**Files:**
- Create: `packages/core/src/state/reducers/pendingSavesReducer.ts`
- Modify: `packages/core/src/state/reducer.ts:19-32`
- Test: `packages/core/src/combat/__tests__/pendingSaves.test.ts` (append)

- [ ] **Step 1: Write failing tests for RESOLVE_PENDING_SAVES**

Append to `packages/core/src/combat/__tests__/pendingSaves.test.ts`:

```typescript
import { resolveSave } from '../saves';
import { parseDiceExpression } from '../attackPipeline';
import { getWoundAllocationTarget } from '../woundAllocation';

describe('RESOLVE_PENDING_SAVES', () => {
  it('resolves saves and applies damage to models', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];

    // Build results: both saves fail, 1 damage each
    const saveRoll1 = rollDice(1, 6, 'Save', 4);
    const saveRoll2 = rollDice(1, 6, 'Save', 4);
    const results: import('../../types/index').PendingSaveResult[] = [
      { targetModelId: 'dm1', saveRoll: saveRoll1, saved: false, damageApplied: 1 },
      { targetModelId: 'dm2', saveRoll: saveRoll2, saved: false, damageApplied: 1 },
    ];

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: { pendingSaveId: pendingSave.id, results },
    });

    // Both models should be destroyed (1W each, 1 damage each)
    expect(state.models['dm1'].status).toBe('destroyed');
    expect(state.models['dm2'].status).toBe('destroyed');

    // PendingSave should be marked resolved
    const resolved = state.shootingState.pendingSaves.find(ps => ps.id === pendingSave.id);
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.results).toHaveLength(2);
  });

  it('saved rolls do not apply damage', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll1 = rollDice(1, 6, 'Save', 4);
    const saveRoll2 = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll: saveRoll1, saved: true, damageApplied: 0 },
          { targetModelId: 'dm2', saveRoll: saveRoll2, saved: true, damageApplied: 0 },
        ],
      },
    });

    expect(state.models['dm1'].status).toBe('active');
    expect(state.models['dm2'].status).toBe('active');
    expect(state.models['dm1'].wounds).toBe(1);
  });

  it('COMPLETE_SHOOTING succeeds after all saves resolved', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll, saved: true, damageApplied: 0 },
          { targetModelId: 'dm2', saveRoll, saved: true, damageApplied: 0 },
        ],
      },
    });

    // Now COMPLETE_SHOOTING should work
    state = gameReducer(state, { type: 'COMPLETE_SHOOTING', payload: { unitId: 'au1' } });
    expect(state.shootingState.activeShootingUnit).toBeNull();
    expect(state.shootingState.unitsShot).toContain('au1');
  });

  it('resolves pending saves in fightState (melee)', () => {
    let state = createInitialGameState();
    const p1 = makePlayer({ id: 'p1', name: 'Attacker' });
    const p2 = makePlayer({ id: 'p2', name: 'Defender' });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
    state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });

    const am = makeModel({ id: 'am1', unitId: 'au1', position: { x: 10, y: 10 } });
    const au = makeUnit({
      id: 'au1', playerId: 'p1', modelIds: ['am1'],
      weapons: [{ id: 'mw1', name: 'Chainsword', type: 'melee', attacks: '3', skill: 3, strength: 4, ap: 0, damage: '1' }],
    });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: au, models: [am] } });

    const dm = makeModel({ id: 'dm1', unitId: 'du1', position: { x: 11, y: 10 }, wounds: 2, maxWounds: 2 });
    const du = makeUnit({ id: 'du1', playerId: 'p2', modelIds: ['dm1'] });
    state = gameReducer(state, { type: 'ADD_UNIT', payload: { unit: du, models: [dm] } });

    const hitRoll = rollDice(3, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_MELEE_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'mw1',
        weaponName: 'Chainsword', targetUnitId: 'du1',
        numAttacks: 3, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.fightState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 3);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 },
          { targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 },
        ],
      },
    });

    // 2 wounds of 1 damage each on a 2W model = destroyed
    expect(state.models['dm1'].status).toBe('destroyed');
    expect(state.fightState.pendingSaves[0].resolved).toBe(true);
  });

  it('rejects RESOLVE_PENDING_SAVES for non-existent ID', () => {
    let state = setupShootingState();
    const saveRoll = rollDice(1, 6, 'Save', 4);

    const stateBefore = state;
    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: 'non-existent-id',
        results: [{ targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 }],
      },
    });

    // Models should be unchanged
    expect(state.models['dm1'].wounds).toBe(stateBefore.models['dm1'].wounds);
  });

  it('rejects RESOLVE_PENDING_SAVES for already-resolved saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 1, woundRoll, wounds: 1,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 4);

    // Resolve once
    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [{ targetModelId: 'dm1', saveRoll, saved: true, damageApplied: 0 }],
      },
    });

    // Try to resolve again — should be blocked
    const stateAfter = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [{ targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 }],
      },
    });

    // Model should still be active (second resolve blocked)
    expect(stateAfter.models['dm1'].status).toBe('active');
  });

  it('marks the linked AttackSequence as resolved', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 2,
      },
    });

    const pendingSave = state.shootingState.pendingSaves[0];
    const saveRoll = rollDice(1, 6, 'Save', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_PENDING_SAVES',
      payload: {
        pendingSaveId: pendingSave.id,
        results: [
          { targetModelId: 'dm1', saveRoll, saved: false, damageApplied: 1 },
          { targetModelId: 'dm2', saveRoll, saved: true, damageApplied: 0 },
        ],
      },
    });

    const attack = state.shootingState.activeAttacks.find(a => a.id === pendingSave.attackSequenceId);
    expect(attack?.resolved).toBe(true);
    expect(attack?.woundAllocations).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts`
Expected: FAIL — `RESOLVE_PENDING_SAVES` is not handled by any reducer

- [ ] **Step 3: Create pendingSavesReducer.ts**

Create `packages/core/src/state/reducers/pendingSavesReducer.ts`:

```typescript
import type { SubReducer } from '../helpers';
import { appendLog } from '../helpers';
import type { PendingSave, PendingSaveResult } from '../../types/index';

export const pendingSavesReducer: SubReducer = (state, action) => {
  switch (action.type) {
    case 'RESOLVE_PENDING_SAVES': {
      const { pendingSaveId, results } = action.payload;

      // Search both shootingState and fightState for the pending save
      let phase: 'shooting' | 'fight' | null = null;
      let pendingSave: PendingSave | undefined;

      pendingSave = state.shootingState.pendingSaves.find(ps => ps.id === pendingSaveId);
      if (pendingSave) {
        phase = 'shooting';
      } else {
        pendingSave = state.fightState.pendingSaves.find(ps => ps.id === pendingSaveId);
        if (pendingSave) {
          phase = 'fight';
        }
      }

      if (!pendingSave || !phase) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Pending save ${pendingSaveId} not found`,
            timestamp: Date.now(),
          }),
        };
      }

      if (pendingSave.resolved) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: `[BLOCKED] Pending save already resolved`,
            timestamp: Date.now(),
          }),
        };
      }

      // Apply damage for each failed save
      let newModels = { ...state.models };
      const logEntries: string[] = [];

      for (const result of results) {
        if (!result.saved && result.damageApplied > 0) {
          const model = newModels[result.targetModelId];
          if (model && model.status === 'active') {
            const newWounds = Math.max(0, model.wounds - result.damageApplied);
            newModels = {
              ...newModels,
              [result.targetModelId]: {
                ...model,
                wounds: newWounds,
                status: newWounds === 0 ? 'destroyed' : 'active',
              },
            };
            const destroyed = newWounds === 0 ? ' — DESTROYED' : ` (${newWounds}W remaining)`;
            logEntries.push(`${model.name} takes ${result.damageApplied} damage${destroyed}`);
          }
        }
      }

      // Apply mortal wounds (subject to FNP if the unit has it)
      if (pendingSave.mortalWounds > 0) {
        const targetUnit = state.units[pendingSave.targetUnitId];
        if (targetUnit) {
          let remainingMortals = pendingSave.mortalWounds;

          // FNP applies to mortal wounds too
          if (pendingSave.fnpThreshold) {
            // Each mortal wound = 1 damage, roll FNP for each
            let blocked = 0;
            for (let i = 0; i < pendingSave.mortalWounds; i++) {
              const roll = Math.ceil(Math.random() * 6);
              if (roll >= pendingSave.fnpThreshold) blocked++;
            }
            remainingMortals -= blocked;
            if (blocked > 0) {
              logEntries.push(`Feel No Pain blocked ${blocked} of ${pendingSave.mortalWounds} mortal wound(s)`);
            }
          }

          // Apply remaining mortal wounds, spilling across models
          const activeModelIds = targetUnit.modelIds.filter(id => {
            const m = newModels[id];
            return m && m.status === 'active';
          });
          for (const modelId of activeModelIds) {
            if (remainingMortals <= 0) break;
            const model = newModels[modelId];
            if (!model) continue;
            const dmg = Math.min(remainingMortals, model.wounds);
            const newWounds = model.wounds - dmg;
            remainingMortals -= dmg;
            newModels = {
              ...newModels,
              [modelId]: {
                ...model,
                wounds: Math.max(0, newWounds),
                status: newWounds <= 0 ? 'destroyed' : 'active',
              },
            };
          }
          logEntries.push(`${pendingSave.mortalWounds} mortal wound(s) applied to ${targetUnit.name}`);
        }
      }

      // Mark the PendingSave as resolved
      const updatedPendingSave: PendingSave = {
        ...pendingSave,
        resolved: true,
        results,
      };

      // Update the linked AttackSequence
      const updateAttacks = (attacks: import('../../types/index').AttackSequence[]) =>
        attacks.map(a =>
          a.id === pendingSave!.attackSequenceId
            ? {
                ...a,
                resolved: true,
                woundAllocations: results.map(r => ({
                  modelId: r.targetModelId,
                  saveRoll: r.saveRoll,
                  saved: r.saved,
                  damageApplied: r.damageApplied,
                })),
              }
            : a,
        );

      // Build log
      let newLog = state.log;
      for (const result of results) {
        newLog = appendLog(newLog, { type: 'dice_roll', roll: result.saveRoll, timestamp: Date.now() });
      }
      for (const msg of logEntries) {
        newLog = appendLog(newLog, { type: 'message', text: msg, timestamp: Date.now() });
      }

      if (phase === 'shooting') {
        return {
          ...state,
          models: newModels,
          shootingState: {
            ...state.shootingState,
            pendingSaves: state.shootingState.pendingSaves.map(ps =>
              ps.id === pendingSaveId ? updatedPendingSave : ps,
            ),
            activeAttacks: updateAttacks(state.shootingState.activeAttacks),
          },
          log: newLog,
        };
      } else {
        return {
          ...state,
          models: newModels,
          fightState: {
            ...state.fightState,
            pendingSaves: state.fightState.pendingSaves.map(ps =>
              ps.id === pendingSaveId ? updatedPendingSave : ps,
            ),
            activeAttacks: updateAttacks(state.fightState.activeAttacks),
          },
          log: newLog,
        };
      }
    }

    default:
      return null;
  }
};
```

- [ ] **Step 4: Register pendingSavesReducer in reducer.ts**

In `packages/core/src/state/reducer.ts`, add the import and register it:

```typescript
import { pendingSavesReducer } from './reducers/pendingSavesReducer';
```

Add `pendingSavesReducer` to the `subReducers` array (after `shootingReducer`):

```typescript
const subReducers: SubReducer[] = [
  setupReducer,
  movementReducer,
  shootingReducer,
  pendingSavesReducer,
  chargeReducer,
  // ...
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/state/reducers/pendingSavesReducer.ts packages/core/src/state/reducer.ts packages/core/src/combat/__tests__/pendingSaves.test.ts
git commit -m "feat: add pendingSavesReducer to handle RESOLVE_PENDING_SAVES"
```

---

## Task 6: Gate ADVANCE_PHASE and NEXT_TURN on unresolved pending saves

**Files:**
- Modify: `packages/core/src/state/reducers/lifecycleReducer.ts:41`
- Test: `packages/core/src/combat/__tests__/pendingSaves.test.ts` (append)

- [ ] **Step 1: Write failing tests**

Append to `packages/core/src/combat/__tests__/pendingSaves.test.ts`:

```typescript
describe('Phase/turn transition gating', () => {
  it('blocks ADVANCE_PHASE with unresolved shooting pending saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 1,
      },
    });

    const phaseBefore = state.turnState.currentPhaseIndex;
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });
    expect(state.turnState.currentPhaseIndex).toBe(phaseBefore);
  });

  it('blocks NEXT_TURN with unresolved pending saves', () => {
    let state = setupShootingState();
    const hitRoll = rollDice(2, 6, 'To Hit', 3);
    const woundRoll = rollDice(2, 6, 'To Wound', 4);

    state = gameReducer(state, {
      type: 'RESOLVE_SHOOTING_ATTACK',
      payload: {
        attackingUnitId: 'au1', attackingModelId: 'am1', weaponId: 'w1',
        weaponName: 'Bolt Rifle', targetUnitId: 'du1',
        numAttacks: 2, hitRoll, hits: 2, woundRoll, wounds: 1,
      },
    });

    const turnBefore = state.turnState.turnNumber;
    state = gameReducer(state, { type: 'NEXT_TURN' });
    expect(state.turnState.turnNumber).toBe(turnBefore);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts -t "Phase/turn transition gating"`
Expected: FAIL — neither ADVANCE_PHASE nor NEXT_TURN check pending saves

- [ ] **Step 3: Add guards to ADVANCE_PHASE and NEXT_TURN in lifecycleReducer**

In `packages/core/src/state/reducers/lifecycleReducer.ts`, create a helper at the top of the file and use it in both cases:

```typescript
function hasUnresolvedPendingSaves(state: GameState): boolean {
  return (
    state.shootingState.pendingSaves.some(ps => !ps.resolved) ||
    state.fightState.pendingSaves.some(ps => !ps.resolved)
  );
}
```

At the top of `case 'ADVANCE_PHASE':` (line 41), add:

```typescript
      if (hasUnresolvedPendingSaves(state)) {
        return {
          ...state,
          log: appendLog(state.log, {
            type: 'message',
            text: '[BLOCKED] Cannot advance phase — pending saves must be resolved first',
            timestamp: Date.now(),
          }),
        };
      }
```

Add the same guard at the top of `case 'NEXT_TURN':` with message "Cannot advance turn".

Add `import { appendLog } from '../helpers';` if not already imported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/src/combat/__tests__/pendingSaves.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/state/reducers/lifecycleReducer.ts packages/core/src/combat/__tests__/pendingSaves.test.ts
git commit -m "feat: gate ADVANCE_PHASE and NEXT_TURN on unresolved pending saves"
```

---

## Task 7: Remove RESOLVE_SAVE_ROLL and migrate all references

**Files:**
- Modify: `packages/core/src/state/actions.ts:57` (remove RESOLVE_SAVE_ROLL)
- Modify: `packages/core/src/state/actionValidation.ts:26` (remove RESOLVE_SAVE_ROLL)
- Modify: `packages/core/src/state/__tests__/sprintA.test.ts`
- Check: `packages/core/src/rules/RulesEdition.ts`, any other files

- [ ] **Step 1: Find all RESOLVE_SAVE_ROLL usages**

Run: `grep -rn 'RESOLVE_SAVE_ROLL' packages/`

Note each occurrence.

- [ ] **Step 2: Migrate tests in sprintA.test.ts**

For each test that dispatches `RESOLVE_SAVE_ROLL`, change the flow to:

1. Ensure a `RESOLVE_SHOOTING_ATTACK` was dispatched first (creates the PendingSave)
2. Read the pending save ID from `state.shootingState.pendingSaves[0].id`
3. Dispatch `RESOLVE_PENDING_SAVES` with the save results instead of `RESOLVE_SAVE_ROLL`

For example, transform:

```typescript
// OLD
state = gameReducer(state, {
  type: 'RESOLVE_SAVE_ROLL',
  payload: { targetModelId: 'm2', saveRoll, saved: false, damageToApply: 1 },
});
```

Into:

```typescript
// NEW
const pendingSaveId = state.shootingState.pendingSaves[0].id;
state = gameReducer(state, {
  type: 'RESOLVE_PENDING_SAVES',
  payload: {
    pendingSaveId,
    results: [{ targetModelId: 'm2', saveRoll, saved: false, damageApplied: 1 }],
  },
});
```

- [ ] **Step 3: Update all other RESOLVE_SAVE_ROLL references**

For `RulesEdition.ts`, `actionValidation.ts`, and any other files: replace or remove `RESOLVE_SAVE_ROLL` references.

- [ ] **Step 4: Remove RESOLVE_SAVE_ROLL from actions.ts**

In `packages/core/src/state/actions.ts`, delete line 57 (`RESOLVE_SAVE_ROLL`).

In `packages/core/src/state/actionValidation.ts`, remove `'RESOLVE_SAVE_ROLL'` from the shooting category.

- [ ] **Step 5: Run typecheck and full test suite**

Run: `make typecheck && make test`
Expected: PASS — no remaining references to the removed action, build is green

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove RESOLVE_SAVE_ROLL and migrate all references to RESOLVE_PENDING_SAVES"
```

---

## Task 8: Export PendingSave types from core barrel

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports for new types**

In `packages/core/src/index.ts`, ensure `PendingSave` and `PendingSaveResult` are exported from the types re-export. The types barrel typically re-exports everything from `types/index.ts`, so this may already work. Verify:

Run: `grep -n 'PendingSave' packages/core/src/index.ts`

If not present, add to the types export line.

- [ ] **Step 2: Run typecheck**

Run: `make typecheck`
Expected: PASS

- [ ] **Step 3: Commit (if changes needed)**

```bash
git add packages/core/src/index.ts
git commit -m "feat: export PendingSave types from core barrel"
```

---

## Task 9: Create SaveRollPanel client component

**Files:**
- Create: `packages/client/src/components/SaveRollPanel.tsx`

- [ ] **Step 1: Create the SaveRollPanel component**

Create `packages/client/src/components/SaveRollPanel.tsx`:

```tsx
import React from 'react';
import { useGameStore } from '../store/gameStore';
import { useMultiplayerStore } from '../networking/useMultiplayer';
import { parseDiceExpression } from '@openhammer/core';
import { resolveSave, resolveFeelNoPain } from '@openhammer/core';
import { getWoundAllocationTarget, getAttachedUnitWoundTarget } from '@openhammer/core';
import type { PendingSave, PendingSaveResult, Model } from '@openhammer/core';

interface SaveRollPanelProps {
  pendingSave: PendingSave;
}

export function SaveRollPanel({ pendingSave }: SaveRollPanelProps) {
  const { gameState, dispatch } = useGameStore();
  const { playerId: myPlayerId, roomId } = useMultiplayerStore();

  const isMultiplayer = !!roomId;
  const isDefender = !isMultiplayer || myPlayerId === pendingSave.defendingPlayerId;

  const targetUnit = gameState.units[pendingSave.targetUnitId];
  const defendingPlayer = Object.values(gameState.players).find(p => p.id === pendingSave.defendingPlayerId);

  const handleRollSaves = () => {
    if (!targetUnit) return;

    const results: PendingSaveResult[] = [];
    let tempModels = { ...gameState.models };

    // Check if this unit is part of an attached pair (Leader/Bodyguard)
    const attachedLeaderId = Object.entries(gameState.attachedUnits).find(
      ([, bodyguardId]) => bodyguardId === pendingSave.targetUnitId,
    )?.[0];
    const isBodyguard = !!attachedLeaderId;
    const leaderUnit = attachedLeaderId ? gameState.units[attachedLeaderId] : undefined;

    // If the target IS the leader, check if it has a bodyguard attached
    const bodyguardUnitId = gameState.attachedUnits[pendingSave.targetUnitId];
    const bodyguardUnit = bodyguardUnitId ? gameState.units[bodyguardUnitId] : undefined;

    for (let i = 0; i < pendingSave.wounds; i++) {
      // Find next wound allocation target, accounting for attached units
      let target: Model | null = null;

      if (leaderUnit && isBodyguard) {
        // Target is bodyguard, leader is attached — bodyguard absorbs first
        target = getAttachedUnitWoundTarget(leaderUnit, targetUnit, tempModels, false);
      } else if (bodyguardUnit) {
        // Target is leader, bodyguard is attached — bodyguard absorbs first
        target = getAttachedUnitWoundTarget(targetUnit, bodyguardUnit, tempModels, false);
      } else {
        // Normal unit — standard wound allocation
        target = getWoundAllocationTarget(
          { ...targetUnit, modelIds: targetUnit.modelIds.filter(id => tempModels[id]?.status === 'active') },
          tempModels,
        );
      }
      if (!target) break;

      // Get this specific model's save stats (handles mixed-save units)
      const saveChar = target.stats.save;
      const invuln = target.stats.invulnSave;

      // Roll save
      const { saveRoll, saved } = resolveSave(
        saveChar,
        pendingSave.ap,
        invuln,
        pendingSave.coverSaveModifier ? { coverSaveModifier: pendingSave.coverSaveModifier } : undefined,
      );

      let damageApplied = 0;
      let fnpRolls: import('@openhammer/core').DiceRoll[] | undefined;

      if (!saved) {
        let damage = parseDiceExpression(pendingSave.damage);

        // Feel No Pain
        if (pendingSave.fnpThreshold) {
          const fnp = resolveFeelNoPain(damage, pendingSave.fnpThreshold);
          fnpRolls = [fnp.rolls];
          damage = fnp.woundsSuffered;
        }

        damageApplied = damage;

        // Update temp models for cascading
        if (damageApplied > 0) {
          const newWounds = Math.max(0, target.wounds - damageApplied);
          tempModels = {
            ...tempModels,
            [target.id]: {
              ...target,
              wounds: newWounds,
              status: newWounds === 0 ? 'destroyed' : 'active',
            },
          };
        }
      }

      results.push({
        targetModelId: target.id,
        saveRoll,
        saved,
        fnpRolls,
        damageApplied,
      });
    }

    dispatch({
      type: 'RESOLVE_PENDING_SAVES',
      payload: { pendingSaveId: pendingSave.id, results },
    });
  };

  // Resolved — show results
  if (pendingSave.resolved && pendingSave.results) {
    const totalDamage = pendingSave.results.reduce((sum, r) => sum + r.damageApplied, 0);
    const savesMade = pendingSave.results.filter(r => r.saved).length;

    return (
      <div style={{ padding: '12px', border: '1px solid #555', borderRadius: '8px', marginBottom: '8px' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
          {pendingSave.weaponName} — Saves Resolved
        </div>
        <div style={{ fontSize: '14px', marginBottom: '4px' }}>
          {savesMade}/{pendingSave.wounds} saves made, {totalDamage} damage dealt
        </div>
        {pendingSave.results.map((r, idx) => {
          const model = gameState.models[r.targetModelId];
          return (
            <div key={idx} style={{ fontSize: '13px', color: r.saved ? '#4ade80' : '#f87171' }}>
              {model?.name ?? 'Model'}: rolled {r.saveRoll.dice[0]} — {r.saved ? 'SAVED' : `${r.damageApplied} damage`}
              {!r.saved && (gameState.models[r.targetModelId]?.status === 'destroyed' ? ' (DESTROYED)' : '')}
            </div>
          );
        })}
      </div>
    );
  }

  // Waiting state for attacker in multiplayer
  if (!isDefender) {
    return (
      <div style={{ padding: '12px', border: '1px solid #555', borderRadius: '8px', marginBottom: '8px' }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
          Waiting for {defendingPlayer?.name ?? 'opponent'} to roll saves...
        </div>
        <div style={{ fontSize: '14px', color: '#aaa' }}>
          {pendingSave.weaponName}: {pendingSave.wounds} wound(s), AP{pendingSave.ap}, D{pendingSave.damage}
        </div>
      </div>
    );
  }

  // Defender prompt
  return (
    <div style={{ padding: '12px', border: '2px solid #facc15', borderRadius: '8px', marginBottom: '8px' }}>
      <div style={{ fontWeight: 'bold', marginBottom: '8px', color: '#facc15' }}>
        {!isMultiplayer && `${defendingPlayer?.name ?? 'Defender'}: `}Roll saves against {pendingSave.weaponName}
      </div>
      <div style={{ fontSize: '14px', marginBottom: '12px' }}>
        {pendingSave.wounds} wound(s) — AP{pendingSave.ap}, D{pendingSave.damage}
        {targetUnit && ` — ${targetUnit.name} (Sv ${gameState.models[targetUnit.modelIds[0]]?.stats.save}+)`}
      </div>
      <button
        onClick={handleRollSaves}
        style={{
          padding: '8px 24px',
          backgroundColor: '#facc15',
          color: '#000',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 'bold',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        Roll Saves
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck**

Run: `make typecheck-client`
Expected: PASS (or note import issues to fix — verify that `resolveSave`, `parseDiceExpression`, `resolveFeelNoPain`, `getWoundAllocationTarget` are exported from `@openhammer/core`)

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/components/SaveRollPanel.tsx
git commit -m "feat: add SaveRollPanel component for interactive defender saves"
```

---

## Task 10: Update ShootingPanel to use SaveRollPanel

**Files:**
- Modify: `packages/client/src/components/ShootingPanel.tsx:161-201`

- [ ] **Step 1: Remove save roll loop from handleResolve()**

In `packages/client/src/components/ShootingPanel.tsx`, in the `handleResolve()` function:

Delete the save roll loop (lines 161-201) — everything from `// Save rolls` through the `saveResults` / `totalDamage` / `currentTargetIdx` logic. Also remove the `saveResults` and `totalDamage` fields from the `results.push()` call.

The `handleResolve` for each weapon should end after `dispatch({ type: 'RESOLVE_SHOOTING_ATTACK', ... })`. The component will transition to showing `SaveRollPanel` when pending saves appear in state.

- [ ] **Step 2: Add SaveRollPanel rendering for pending saves**

Import `SaveRollPanel` at the top:

```tsx
import { SaveRollPanel } from './SaveRollPanel';
```

In the component's render, after the attack results section, check for pending saves:

```tsx
{gameState.shootingState.pendingSaves.map(ps => (
  <SaveRollPanel key={ps.id} pendingSave={ps} />
))}
```

- [ ] **Step 3: Remove RESOLVE_SAVE_ROLL import/usage**

Remove any remaining references to `RESOLVE_SAVE_ROLL` from this file. The `rollDice` import for save rolls can also be removed if not used elsewhere in the component.

- [ ] **Step 4: Run typecheck**

Run: `make typecheck-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/ShootingPanel.tsx
git commit -m "refactor: remove save rolls from ShootingPanel, integrate SaveRollPanel"
```

---

## Task 11: Update FightPanel to use SaveRollPanel

**Files:**
- Modify: `packages/client/src/components/FightPanel.tsx:127-158`

- [ ] **Step 1: Remove save roll loop from handleResolveAttack()**

In `packages/client/src/components/FightPanel.tsx`, in the `handleResolveAttack()` function:

Delete the save roll loop (lines 127-158) — everything from `const saveResults` through the `RESOLVE_SAVE_ROLL` dispatch and cascade logic. Remove `saveResults` and `totalDamage` from the result object.

The function should end after `dispatch({ type: 'RESOLVE_MELEE_ATTACK', ... })`.

- [ ] **Step 2: Add SaveRollPanel rendering for fight pending saves**

Import `SaveRollPanel` and render pending saves from `fightState`:

```tsx
import { SaveRollPanel } from './SaveRollPanel';

// In render:
{gameState.fightState.pendingSaves.map(ps => (
  <SaveRollPanel key={ps.id} pendingSave={ps} />
))}
```

- [ ] **Step 3: Remove RESOLVE_SAVE_ROLL references**

Remove all `RESOLVE_SAVE_ROLL` dispatches and related save calculation code.

- [ ] **Step 4: Run typecheck**

Run: `make typecheck-client`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/FightPanel.tsx
git commit -m "refactor: remove save rolls from FightPanel, integrate SaveRollPanel"
```

---

## Task 12: Disable undo while pending saves are unresolved

**Files:**
- Modify: `packages/client/src/store/gameStore.ts`

- [ ] **Step 1: Add pending saves check to the undo function**

In `packages/client/src/store/gameStore.ts`, find the `undo` method. Add a guard that checks if the current state has unresolved pending saves:

```typescript
undo: () => {
  set((state) => {
    // Block undo while pending saves are unresolved
    const hasPending =
      state.gameState.shootingState.pendingSaves.some(ps => !ps.resolved) ||
      state.gameState.fightState.pendingSaves.some(ps => !ps.resolved);
    if (hasPending) return state;

    // ... rest of existing undo logic
  });
},
```

- [ ] **Step 2: Run typecheck**

Run: `make typecheck-client`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/store/gameStore.ts
git commit -m "feat: disable undo while pending saves are unresolved"
```

---

## Task 13: Full integration test

**Files:** None (testing only)

- [ ] **Step 1: Run full test suite**

Run: `make test`
Expected: ALL PASS

- [ ] **Step 2: Run full typecheck**

Run: `make typecheck`
Expected: PASS across all three packages

- [ ] **Step 3: Fix any failures**

If any tests fail, investigate and fix. Common issues:
- Tests that still reference `RESOLVE_SAVE_ROLL`
- Missing `pendingSaves` in manually constructed state objects
- Import path issues for new types

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration test failures for interactive save rolls"
```
