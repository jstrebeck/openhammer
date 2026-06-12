# Combat Module Decomposition — Design Spec

**Date:** 2026-03-23
**Status:** Draft
**Addresses:** ARCHITECTURE-CONCERNS.md #3 (Combat Module Too Large)

## Problem

`packages/core/src/combat/index.ts` is a 1,253 LOC single file handling 10+ distinct domains: dice parsing, weapon/unit ability parsing, attack resolution pipeline, save rolls, engagement range, shooting eligibility, wound allocation, deployment validators, stratagem modifiers, and faction/detachment modifiers. It's hard to reason about, navigate, and extend.

## Decision

**Approach B (domain-grouped):** Split into 7 combat sub-modules + relocate deployment validators to a new `deployment/` directory. Update all internal imports to point directly to new modules (no barrel re-export within combat). Tests reorganized to match new module structure.

## Module Structure

```
packages/core/src/
├── combat/
│   ├── abilities.ts          # weapon + unit ability parsing
│   ├── attackPipeline.ts     # dice, wound threshold, attack resolution
│   ├── saves.ts              # save rolls, Feel No Pain
│   ├── shooting.ts           # engagement range, eligibility, targeting
│   ├── woundAllocation.ts    # wound targets, attached units, leader rules
│   ├── stratagems.ts         # stratagem combat modifiers
│   └── factionModifiers.ts   # faction & detachment rule modifiers
├── deployment/
│   └── validators.ts         # Deep Strike, Infiltrators, Scout, Strategic Reserves
```

The old `combat/index.ts` is deleted after migration.

## Module Contents

### `combat/abilities.ts` (~100 LOC)

Exports:
- `ParsedAbility` (interface)
- `parseWeaponAbility(raw: string): ParsedAbility`
- `parseWeaponAbilities(weapon: Weapon): ParsedAbility[]`
- `weaponHasAbility(weapon: Weapon, abilityName: string): boolean`
- `parseUnitAbility(raw: string): { name, value?, expr? }`
- `unitHasAbility(unit: Unit, abilityName: string): boolean`
- `getUnitAbilityValue(unit: Unit, abilityName: string): number | undefined`
- `unitHasStealth(unit: Unit): boolean`

Imports: types only.

### `combat/attackPipeline.ts` (~370 LOC)

Exports:
- `parseDiceExpression(expr: number | string): number`
- `getWoundThreshold(strength: number, toughness: number): number`
- `AttackContext` (interface)
- `AttackResult` (interface)
- `calculateAttacks(ctx: AttackContext): number`
- `resolveAttackSequence(numAttacks, skill, strength, toughness, ctx?): AttackResult`

Internal helpers (not exported):
- `hasAbility(ctx, name): boolean`
- `getAbilityValue(ctx, name): number | undefined`

Imports from: `combat/abilities` (ParsedAbility type), `../dice/index` (rollDice).

Note: The original `combat/index.ts` has dead imports for `getEdition` from `../rules/registry` and `countSuccesses` from `../dice/index` — these are dropped during migration.

### `combat/saves.ts` (~65 LOC)

Exports:
- `resolveSave(saveChar, ap, invuln?, options?): { saveRoll, saved }`
- `resolveFeelNoPain(damage, fnpThreshold): { woundsSuffered, woundsBlocked, rolls }`

Imports from: `../dice/index` (rollDice).

### `combat/shooting.ts` (~135 LOC)

Exports:
- `canUnitShootWithAbilities(moveType, weapons): { allowed, reason?, assaultOnly? }`
- `isUnitInEngagementRange(unit, state, engagementRange): boolean`
- `getEngagedEnemyUnits(unit, state, engagementRange): string[]`
- `getEngagementShootingMode(unit): 'none' | 'big_guns' | 'pistols' | 'both'`
- `getWeaponsForEngagementShooting(unit, mode): Weapon[]`
- `isTargetInRange(attacker, target, weapon): boolean`
- `getValidShootingTargets(attackingUnit, state): string[]`

Imports from: `combat/abilities` (weaponHasAbility), `../measurement/index` (distanceBetweenModels).

### `combat/woundAllocation.ts` (~145 LOC)

Exports:
- `getWoundAllocationTarget(unit, models): Model | null`
- `getAttachedUnitWoundTarget(leaderUnit, bodyguardUnit, models, precision): Model | null`
- `canAttachLeader(state, leaderUnitId, bodyguardUnitId): { allowed, reason? }`
- `doesAttachedUnitDestructionCountAsDestroyed(state, destroyedUnitId): boolean`
- `getRevertedStartingStrength(unit): number`

Imports: `Unit`, `Model`, `GameState` from `../types/index`.

### `combat/stratagems.ts` (~60 LOC)

Exports:
- `getSmokescreenModifiers(state, targetUnitId): { hitModifier, coverSaveModifier }`
- `getGoToGroundModifiers(state, targetUnitId): { coverSaveModifier, bonusInvulnSave }`
- `getStratagemSaveModifiers(state, targetUnitId): { coverSaveModifier, bonusInvulnSave }`
- `getStratagemHitModifier(state, targetUnitId): number`
- `isEpicChallengePrecision(state, attackingUnitId): boolean`

Imports: types only (reads `state.stratagemEffects`).

### `combat/factionModifiers.ts` (~215 LOC)

Exports:
- `applyFactionAndDetachmentRules(ctx, state, attackingUnit): { ctx, triggeredRules }`
- `applyDefensiveDetachmentRules(state, targetUnit, distanceFromAttacker): { woundRollModifier, triggeredRules }`

Imports from:
- `combat/attackPipeline` (`AttackContext` interface — which references `ParsedAbility` from abilities)
- `../detachments/registry` (`getFactionState`)
- `import type { AstraMilitarumState } from '../detachments/astra-militarum'`
- `import type { TauEmpireState } from '../detachments/tau-empire'`
- `../types/index` (`GameState`, `Unit`)

### `deployment/validators.ts` (~120 LOC)

Exports:
- `validateDeepStrikeArrival(state, unitId, positions): string[]`
- `validateInfiltratorsDeployment(state, unitId, positions): string[]`
- `validateScoutMove(unit, models, positions, maxDistance): string[]`
- `validateStrategicReservesArrival(state, unitId, positions): string[]`

Imports from: `../measurement/index` (distanceBetweenModels), `../los/index` (pointInPolygon).

## Dependency Graph

```
abilities  (leaf — types only)
    ↑
    ├── attackPipeline  (+ dice)
    └── shooting        (+ measurement)

attackPipeline
    ↑
    └── factionModifiers (+ detachments/registry, faction type imports)

saves              (leaf — dice only)
woundAllocation    (leaf — types only)
stratagems         (leaf — types only)
deployment/validators (leaf — measurement, los)
```

No circular dependencies.

## Export Strategy

### Core barrel (`packages/core/src/index.ts`)

Replace:
```typescript
export * from './combat/index';
```

With:
```typescript
export * from './combat/abilities';
export * from './combat/attackPipeline';
export * from './combat/saves';
export * from './combat/shooting';
export * from './combat/woundAllocation';
export * from './combat/stratagems';
export * from './combat/factionModifiers';
export * from './deployment/validators';
```

External consumers (`@openhammer/core`) see no breaking changes.

### Internal imports

All internal imports within `packages/core/src/` updated to point directly to new modules. Example:

```typescript
// Before (shootingReducer.ts):
import { resolveAttackSequence, resolveSave, getWoundAllocationTarget } from '../../combat/index';

// After:
import { resolveAttackSequence } from '../../combat/attackPipeline';
import { resolveSave } from '../../combat/saves';
import { getWoundAllocationTarget } from '../../combat/woundAllocation';
```

## Test Reorganization

Tests move from sprint-based files into module-aligned test files.

### New test files

```
packages/core/src/combat/__tests__/
├── abilities.test.ts
├── attackPipeline.test.ts
├── saves.test.ts
├── shooting.test.ts
├── woundAllocation.test.ts
├── stratagems.test.ts
├── factionModifiers.test.ts
packages/core/src/deployment/__tests__/
├── validators.test.ts
```

### Migration mapping

| New test file | Source | Tests moved |
|---|---|---|
| `abilities.test.ts` | sprintC | Weapon Ability Parser (8), Unit Ability Parser (5) |
| `attackPipeline.test.ts` | sprintA, sprintC, sprintF_p22 | Combat Utilities (12), calculateAttacks (3), resolveAttackSequence with abilities (6), Wound Threshold (5), Indirect Fire (1), Extra Attacks (1) |
| `saves.test.ts` | sprintA, sprintC, sprintG_24a | resolveSave (1), Feel No Pain (2), resolveSave with cover (3), resolveSave with Go to Ground (3) |
| `shooting.test.ts` | sprintC, sprintF_p22 | Assault weapon ability (4), Big Guns Never Tire (3), Pistols (3), Engagement range helpers (2) |
| `woundAllocation.test.ts` | sprintF_p22, sprintF_p23, sprintK | Wound allocation (2), Attached Units (5), Attached unit destruction VP (2), Surviving unit reverts (1), Cannot attach more than one Leader (2) |
| `stratagems.test.ts` | sprintG_24a | Smokescreen (5), Go to Ground (4), Epic Challenge (3) |
| `factionModifiers.test.ts` | factionRules | Born Soldiers (4), Mechanised Assault (2), Armoured Company (3), Fortification Network (1), Orders combat modifiers (4), T'au detachment tests (all) |
| `deployment/validators.test.ts` | sprintF_p23, sprintH_p31 | Deep Strike (3), Infiltrators (2), Scout (2+4), Strategic Reserves (4) |

### What stays in sprint test files

Tests that exercise **reducer actions** (dispatching `RESOLVE_HAZARDOUS`, `RESOLVE_SHOOTING_ATTACK`, `SCOUT_MOVE`, etc.) remain in their original sprint files. They test the reducer integration, not the combat functions directly.

## Files Modified

### New files (9)
- `packages/core/src/combat/abilities.ts`
- `packages/core/src/combat/attackPipeline.ts`
- `packages/core/src/combat/saves.ts`
- `packages/core/src/combat/shooting.ts`
- `packages/core/src/combat/woundAllocation.ts`
- `packages/core/src/combat/stratagems.ts`
- `packages/core/src/combat/factionModifiers.ts`
- `packages/core/src/deployment/validators.ts`
- 8 new test files

### New directory
- `packages/core/src/deployment/` (does not currently exist, must be created)

### Deleted files (1)
- `packages/core/src/combat/index.ts`

### Modified files (11)
- `packages/core/src/index.ts` (barrel update)
- `packages/core/src/state/reducers/shootingReducer.ts` (import paths)
- `packages/core/src/state/reducers/stratagemReducer.ts` (import paths)
- `packages/core/src/state/__tests__/sprintA.test.ts` (import paths for retained tests)
- `packages/core/src/state/__tests__/sprintC.test.ts` (import paths for retained tests)
- `packages/core/src/state/__tests__/sprintF_p22.test.ts` (import paths for retained tests)
- `packages/core/src/state/__tests__/sprintF_p23.test.ts` (import paths for retained tests)
- `packages/core/src/state/__tests__/sprintG_24a.test.ts` (import paths for retained tests)
- `packages/core/src/state/__tests__/sprintH_p31.test.ts` (import paths for retained tests)
- `packages/core/src/state/__tests__/sprintK.test.ts` (import paths for retained tests)
- `packages/core/src/state/__tests__/factionRules.test.ts` (import paths for retained tests)

## Migration Order

Create modules in dependency order to maintain a passing typecheck at each step:

1. **Leaf modules first** (no combat cross-deps): `saves.ts`, `woundAllocation.ts`, `stratagems.ts`, `deployment/validators.ts`
2. **Abilities** (shared leaf): `abilities.ts`
3. **Modules depending on abilities**: `attackPipeline.ts`, `shooting.ts`
4. **Modules depending on attackPipeline**: `factionModifiers.ts`
5. **Update barrel** (`index.ts`), **update internal imports**, **delete `combat/index.ts`**
6. **Migrate tests** to new locations

## Verification

1. `make typecheck-core` passes
2. `make test-core` passes — all 84 tests still pass
3. No `combat/index` import remains anywhere in the codebase
4. Each new module can be imported independently
