# Interactive Save Rolls

**Date:** 2026-03-24
**Status:** Approved
**Scope:** Change save rolls from automatic (attacker-resolved) to interactive (defender-resolved) for both shooting and melee

## Problem

Save rolls are currently resolved automatically by the attacking player's client. In `ShootingPanel.tsx`, the `handleResolve()` function rolls hits, wounds, AND saves in one batch, then dispatches pre-calculated results. The defending player has no involvement — saves just happen.

This isn't fun. In tabletop play, the defender picks up their dice and rolls saves. This feature brings that experience to both local and multiplayer games.

## Goals

- **Local game**: Prompt the defending player to roll saves via a modal with a "Roll Saves" button
- **Multiplayer**: Defender sees a save roll panel; attacker sees "Waiting for [player] to roll saves..." with live results appearing as the defender rolls
- **Both phases**: Shooting and Fight phases use the same interactive save flow
- **Click-to-roll batch**: One click per weapon's worth of wounds — all saves rolled at once, results displayed

## Constraints

- All state flows through `gameReducer` — no out-of-band signaling
- Multiplayer sync uses existing `ACTION_BROADCAST` / `STATE_SNAPSHOT` pattern — no new message types
- Existing action flow structure preserved (declare → assign → resolve → complete)
- `RESOLVE_SAVE_ROLL` action removed, replaced by new `RESOLVE_PENDING_SAVES`

## Design

### Part 1: Core State Changes

#### New Types

```typescript
interface PendingSave {
  id: string;                     // crypto.randomUUID()
  attackSequenceId: string;       // links to the AttackSequence that produced these wounds
  attackingPlayerId: string;      // who attacked
  defendingPlayerId: string;      // who needs to roll saves
  targetUnitId: string;           // defending unit
  weaponName: string;             // for display in UI
  wounds: number;                 // number of save rolls needed
  ap: number;                     // raw weapon AP value (negative, e.g. -2), matching Weapon.ap convention
  damage: string;                 // damage expression (e.g. "D6", "2")
  coverSaveModifier?: number;     // +1 from terrain cover
  fnpThreshold?: number;          // Feel No Pain threshold (e.g. 5 for 5+), from unit abilities
  mortalWounds: number;           // devastating wounds — skip saves, applied automatically
  resolved: boolean;              // has defender rolled?
  results?: PendingSaveResult[];  // populated after defender rolls
}

interface PendingSaveResult {
  targetModelId: string;
  saveRoll: DiceRoll;
  saved: boolean;
  fnpRolls?: DiceRoll[];          // FNP rolls on unsaved wounds (if unit has FNP)
  damageApplied: number;          // final damage after saves and FNP
}
```

**Note on per-model stats:** `saveCharacteristic` and `invulnSave` are NOT stored on `PendingSave` because different models in a unit can have different save profiles (e.g. a Sergeant vs infantry). Instead, `SaveRollPanel` looks up each model's `stats.save` and `stats.invulnSave` at roll time via `getWoundAllocationTarget()`, which determines the correct target model before each save roll.

#### State Additions

```typescript
// Added to ShootingState
shootingState: {
  // ... existing fields ...
  pendingSaves: PendingSave[];    // NEW
}

// Added to FightState
fightState: {
  // ... existing fields ...
  pendingSaves: PendingSave[];    // NEW
}
```

### Part 2: Action Changes

#### Modified: `RESOLVE_SHOOTING_ATTACK`

Payload unchanged (hitRoll, hits, woundRoll, wounds). Behavior change: the reducer now creates a `PendingSave` entry from the wounds instead of expecting follow-up `RESOLVE_SAVE_ROLL` dispatches. The `PendingSave` is populated with target unit save characteristics, weapon AP/damage, and player IDs.

#### Modified: `RESOLVE_MELEE_ATTACK`

Same change as `RESOLVE_SHOOTING_ATTACK` — creates `PendingSave` entries after wound rolls.

#### New: `RESOLVE_PENDING_SAVES`

Dispatched by the defending player:

```typescript
{
  type: 'RESOLVE_PENDING_SAVES';
  payload: {
    pendingSaveId: string;
    results: PendingSaveResult[];
  }
}
```

**Reducer routing:** The reducer searches both `shootingState.pendingSaves` and `fightState.pendingSaves` by `pendingSaveId` to find the matching entry. No `phase` field needed in the payload — the ID-based lookup is unambiguous since IDs are UUIDs.

**Action category:** `RESOLVE_PENDING_SAVES` is categorized as `'admin'` in `getActionCategory()` so it bypasses phase restrictions. This is necessary because the defending (non-active) player dispatches it during the attacker's phase.

The reducer:
1. Validates the pending save exists and is unresolved
2. Validates correct number of save rolls matches `wounds` count
3. For attached units, uses `getAttachedUnitWoundTarget()` to route wounds to bodyguard first (unless Precision)
4. Applies damage to models (wounds reduced, status set to `destroyed` if ≤ 0)
5. Cascades damage to next model when one is destroyed (wound allocation order: already-wounded first via `getWoundAllocationTarget()`)
6. Applies mortal wounds (no save roll, auto-applied)
7. Marks the `PendingSave` as `resolved: true` with results
8. Updates the linked `AttackSequence` (via `attackSequenceId`): populates `woundAllocations` and sets `resolved: true`
9. Logs save roll results

#### Removed: `RESOLVE_SAVE_ROLL`

Replaced entirely by `RESOLVE_PENDING_SAVES`. All existing tests and client code using this action will be migrated.

#### Modified: `COMPLETE_SHOOTING` / `COMPLETE_FIGHT`

The reducer rejects these actions if any `pendingSaves` entries are unresolved for the active unit. This prevents the attacker from skipping past the defender's save rolls.

#### Phase transitions: `ADVANCE_PHASE`

`ADVANCE_PHASE` already resets `shootingState` and `fightState` via their empty-state constructors, so pending saves are cleared automatically. However, `ADVANCE_PHASE` should also be gated: reject if any unresolved pending saves exist, preventing the active player from advancing past the defender's saves.

### Part 3: Client UI Changes

#### ShootingPanel.tsx

`handleResolve()` is split — it now only rolls hits and wounds, then dispatches `RESOLVE_SHOOTING_ATTACK`. It no longer rolls saves or dispatches `RESOLVE_SAVE_ROLL`.

After dispatching, if `shootingState.pendingSaves` has unresolved entries, the panel shows contextual UI based on game mode.

#### New: SaveRollPanel Component

A reusable component for both shooting and fight phases. Reads pending saves from either `shootingState.pendingSaves` or `fightState.pendingSaves`.

**Props:**
- `pendingSave: PendingSave` — the save to resolve
- `phase: 'shooting' | 'fight'` — which state to read from

**Defender view (local or multiplayer defender):**
- Header: "[Player]: Roll saves against [weapon name]"
- Info: "[X] wounds, AP-[Y], D[Z]" and target unit save/invuln stats
- "Roll Saves" button
- On click: rolls all saves (RNG), computes damage with model cascading, dispatches `RESOLVE_PENDING_SAVES`
- Results display: per-model rows showing roll value, saved/failed, damage applied, model destroyed indicator

**Attacker view (multiplayer only):**
- "Waiting for [defender name] to roll saves..."
- When `RESOLVE_PENDING_SAVES` arrives via `ACTION_BROADCAST`, results appear live in the same result format

**Local game:**
- Modal/overlay: "Player [N]: Roll your saves against [weapon] — [X] wounds at AP-[Y], D[Z]"
- "Roll Saves" button
- Results display after rolling
- Both players see the same screen

#### Fight Phase Integration

The same `SaveRollPanel` is used in the fight phase. After `RESOLVE_MELEE_ATTACK` creates pending saves, the panel appears for the defender before the attacker can proceed to `CONSOLIDATE` or `COMPLETE_FIGHT`.

### Part 4: Determining Who Acts

No new turn-control system. The presence of unresolved `pendingSaves` in state is the signal:

- **Local game**: UI checks `defendingPlayerId` on the pending save and shows the prompt addressed to that player. No gating — both players share the screen.
- **Multiplayer**: Client compares `myPlayerId` (from `useMultiplayerStore`) against `pendingSave.defendingPlayerId`. Match = show `SaveRollPanel`. No match = show "Waiting..." with live results.

### Part 5: Edge Cases

- **Multiple weapons**: Pending saves are a list, processed sequentially. Attacker resolves weapon A → defender rolls saves → attacker resolves weapon B → defender rolls again.
- **Model cascading**: When a failed save destroys a model, remaining wounds cascade to the next model. `SaveRollPanel` handles allocation using `getWoundAllocationTarget()`.
- **Wound allocation order**: Already-wounded models allocated first (existing logic reused).
- **Feel No Pain**: `PendingSave.fnpThreshold` is populated at creation time from the unit's abilities. When the defender clicks "Roll Saves", the `SaveRollPanel` rolls saves first, then automatically rolls FNP (D6 per unsaved wound, blocking on threshold+) in the same click. Results include both save and FNP rolls in `PendingSaveResult`. If the unit has no FNP, the field is undefined and FNP is skipped.
- **Devastating Wounds (mortal wounds)**: Tracked in `PendingSave.mortalWounds`. Applied immediately by the reducer when `RESOLVE_PENDING_SAVES` is processed — no save roll needed. Displayed in the results panel as auto-applied damage. Mortal wounds ARE subject to FNP if the unit has it.
- **Attached units**: When the target unit has an attached leader (via `gameState.attachedUnits`), `SaveRollPanel` uses `getAttachedUnitWoundTarget()` to allocate wounds to bodyguard models first, with the leader protected unless the weapon has Precision.
- **Completion gating**: `COMPLETE_SHOOTING`, `COMPLETE_FIGHT`, and `ADVANCE_PHASE` are blocked while unresolved pending saves exist.
- **Undo/redo**: Undo is disabled while unresolved pending saves exist — the attacker cannot undo the attack while waiting for saves. This prevents orphaned pending saves.

### Part 6: Testing Strategy

- **Core reducer tests**: `RESOLVE_SHOOTING_ATTACK` creates `PendingSave` entries with correct AP sign, target unit ID, and player IDs. `RESOLVE_PENDING_SAVES` applies damage correctly with model cascading and wound allocation order.
- **Completion gating**: `COMPLETE_SHOOTING`, `COMPLETE_FIGHT`, and `ADVANCE_PHASE` blocked with unresolved pending saves.
- **Per-model saves**: Test that models with different save profiles in the same unit get correct thresholds (e.g. Sergeant 3+ vs infantry 4+).
- **Attached units**: Bodyguard absorbs wounds first; Precision bypasses to leader; `getAttachedUnitWoundTarget()` integration.
- **Migration**: All existing tests using `RESOLVE_SAVE_ROLL` migrated to the new `RESOLVE_PENDING_SAVES` flow.
- **Melee parity**: Same tests for fight phase pending saves.
- **Edge cases**: Mortal wounds, FNP, invuln saves, cover modifier, multi-damage weapons with model cascading, AP sign handling.
- **Bug fix validation**: Verify wound cascading uses current state (not stale closure state), fixing the existing bug where `ShootingPanel` reads pre-dispatch model state for destruction checks.

### Part 7: Damage Trust Model

Damage dice (e.g. "D6") are rolled by the defending player's client and included in `PendingSaveResult.damageApplied`. The reducer trusts these values — it does not re-roll. This matches the current trust model where the attacker's client pre-rolls everything. The server is authoritative for state transitions but does not independently verify RNG. This is acceptable for a cooperative tabletop simulation; competitive anti-cheat is out of scope.
