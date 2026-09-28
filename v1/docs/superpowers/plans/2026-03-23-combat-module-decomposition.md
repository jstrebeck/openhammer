# Combat Module Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the monolithic 1,253 LOC `packages/core/src/combat/index.ts` into 7 focused combat sub-modules + a relocated `deployment/validators.ts`, with tests reorganized to match.

**Architecture:** Extract functions from the single combat file into domain-grouped modules following the dependency order: leaf modules first, then shared `abilities.ts`, then modules that depend on it. The old file is deleted once all imports are redirected. See `docs/superpowers/specs/2026-03-23-combat-module-decomposition-design.md` for the full spec.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Extract `combat/saves.ts` (leaf module)

**Files:**
- Create: `packages/core/src/combat/saves.ts`
- Source: `packages/core/src/combat/index.ts:442-664` (resolveSave + resolveFeelNoPain)

- [ ] **Step 1: Create `saves.ts` with the two functions**

Extract lines 442-664 from `combat/index.ts`. The file needs:

```typescript
import type { DiceRoll } from '../types/index';
import { rollDice } from '../dice/index';

// resolveSave function (lines 444-487)
// resolveFeelNoPain function (lines 654-664)
```

Copy the `resolveSave` function (lines 444-487) and `resolveFeelNoPain` function (lines 654-664) exactly as-is, with their JSDoc comments and export keywords.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/combat/saves.ts
git commit -m "refactor: extract combat/saves.ts (resolveSave, resolveFeelNoPain)"
```

---

### Task 2: Extract `combat/woundAllocation.ts` (leaf module)

**Files:**
- Create: `packages/core/src/combat/woundAllocation.ts`
- Source: `packages/core/src/combat/index.ts:625-1046`

- [ ] **Step 1: Create `woundAllocation.ts` with all 5 functions**

Extract the following functions from `combat/index.ts`:

```typescript
import type { Unit, Model, GameState } from '../types/index';

// getWoundAllocationTarget (lines 631-647)
// getAttachedUnitWoundTarget (lines 833-869)
// canAttachLeader (lines 989-1021)
// doesAttachedUnitDestructionCountAsDestroyed (lines 1027-1037)
// getRevertedStartingStrength (lines 1043-1045)
```

Copy each function exactly as-is with its JSDoc and export keyword.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/combat/woundAllocation.ts
git commit -m "refactor: extract combat/woundAllocation.ts (5 wound allocation helpers)"
```

---

### Task 3: Extract `combat/stratagems.ts` (leaf module)

**Files:**
- Create: `packages/core/src/combat/stratagems.ts`
- Source: `packages/core/src/combat/index.ts:918-981`

- [ ] **Step 1: Create `stratagems.ts` with all 5 functions**

```typescript
import type { GameState } from '../types/index';

// getSmokescreenModifiers (lines 924-932)
// getGoToGroundModifiers (lines 938-946)
// isEpicChallengePrecision (lines 952-954)
// getStratagemSaveModifiers (lines 960-972)
// getStratagemHitModifier (lines 978-981)
```

Copy each function exactly as-is with its JSDoc and export keyword.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/combat/stratagems.ts
git commit -m "refactor: extract combat/stratagems.ts (5 stratagem combat helpers)"
```

---

### Task 4: Extract `deployment/validators.ts` (leaf module, new directory)

**Files:**
- Create: `packages/core/src/deployment/validators.ts`
- Source: `packages/core/src/combat/index.ts:710-916`

- [ ] **Step 1: Create the `deployment` directory**

```bash
mkdir -p packages/core/src/deployment
```

- [ ] **Step 2: Create `validators.ts` with all 4 functions**

```typescript
import type { Unit, Model, GameState } from '../types/index';
import type { Point } from '../types/geometry';
import { distanceBetweenModels } from '../measurement/index';
import { pointInPolygon } from '../los/index';

// validateDeepStrikeArrival (lines 715-748)
// validateInfiltratorsDeployment (lines 753-791)
// validateScoutMove (lines 796-819)
// validateStrategicReservesArrival (lines 874-916)
```

Copy each function exactly as-is. Note that the `Point` type is used as `import('../types/geometry').Point` inline in the source — replace those with a proper top-level import of `Point` from `'../types/geometry'`.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/deployment/validators.ts
git commit -m "refactor: extract deployment/validators.ts (Deep Strike, Infiltrators, Scout, Strategic Reserves)"
```

---

### Task 5: Extract `combat/abilities.ts` (shared leaf)

**Files:**
- Create: `packages/core/src/combat/abilities.ts`
- Source: `packages/core/src/combat/index.ts:36-89,666-827`

- [ ] **Step 1: Create `abilities.ts` with all ability parsing functions**

```typescript
import type { Weapon, Unit } from '../types/index';

// --- Weapon Ability Parser ---
// ParsedAbility interface (lines 38-42)
// parseWeaponAbility (lines 52-75)
// parseWeaponAbilities (lines 80-82)
// weaponHasAbility (lines 87-89)

// --- Unit Ability Helpers ---
// parseUnitAbility (lines 675-691)
// unitHasAbility (lines 696-698)
// getUnitAbilityValue (lines 703-708)
// unitHasStealth (lines 825-827)
```

Copy each function and the `ParsedAbility` interface exactly as-is.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/combat/abilities.ts
git commit -m "refactor: extract combat/abilities.ts (weapon + unit ability parsing)"
```

---

### Task 6: Extract `combat/attackPipeline.ts` (depends on abilities)

**Files:**
- Create: `packages/core/src/combat/attackPipeline.ts`
- Source: `packages/core/src/combat/index.ts:10-34,91-440`

- [ ] **Step 1: Create `attackPipeline.ts`**

```typescript
import type { DiceRoll, Weapon } from '../types/index';
import { rollDice } from '../dice/index';
import type { ParsedAbility } from './abilities';

// parseDiceExpression (lines 15-34)
// getWoundThreshold (lines 93-99)

// AttackContext interface (lines 103-134)
// AttackResult interface (lines 146-159)

// hasAbility — internal helper, NOT exported (lines 136-138)
// getAbilityValue — internal helper, NOT exported (lines 140-142)

// calculateAttacks (lines 164-181)
// resolveAttackSequence (lines 186-440)
```

**Important:** Do NOT import `getEdition` or `countSuccesses` — these were dead imports in the original file. Drop them.

Copy the functions and interfaces exactly as-is. The `hasAbility` and `getAbilityValue` helpers must remain non-exported (no `export` keyword).

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/combat/attackPipeline.ts
git commit -m "refactor: extract combat/attackPipeline.ts (dice, wound threshold, attack resolution)"
```

---

### Task 7: Extract `combat/shooting.ts` (depends on abilities)

**Files:**
- Create: `packages/core/src/combat/shooting.ts`
- Source: `packages/core/src/combat/index.ts:489-623`

- [ ] **Step 1: Create `shooting.ts`**

```typescript
import type { Weapon, Model, Unit, GameState, MoveType } from '../types/index';
import { weaponHasAbility } from './abilities';
import { distanceBetweenModels } from '../measurement/index';

// canUnitShootWithAbilities (lines 494-510)
// isUnitInEngagementRange (lines 517-531)
// getEngagedEnemyUnits (lines 536-553)
// getEngagementShootingMode (lines 560-568)
// getWeaponsForEngagementShooting (lines 575-584)
// isTargetInRange (lines 588-592)
// getValidShootingTargets (lines 594-623)
```

Copy each function exactly as-is.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/combat/shooting.ts
git commit -m "refactor: extract combat/shooting.ts (engagement range, eligibility, targeting)"
```

---

### Task 8: Extract `combat/factionModifiers.ts` (depends on attackPipeline)

**Files:**
- Create: `packages/core/src/combat/factionModifiers.ts`
- Source: `packages/core/src/combat/index.ts:1047-1253`

- [ ] **Step 1: Create `factionModifiers.ts`**

```typescript
import type { GameState, Unit } from '../types/index';
import type { AttackContext } from './attackPipeline';
import { getFactionState } from '../detachments/registry';
import type { AstraMilitarumState } from '../detachments/astra-militarum';
import type { TauEmpireState } from '../detachments/tau-empire';

// applyFactionAndDetachmentRules (lines 1055-1216)
// applyDefensiveDetachmentRules (lines 1224-1252)
```

Copy both functions exactly as-is. Note `applyFactionAndDetachmentRules` uses `hasAbility` internally — but this is the module-scoped `hasAbility` from the `AttackContext` helpers. Since those are non-exported in `attackPipeline.ts`, you need to inline the logic or re-create these two small helpers locally in `factionModifiers.ts`:

Check whether `applyFactionAndDetachmentRules` actually calls `hasAbility` or `getAbilityValue`. If it does NOT (it uses `ctx.abilities.some(...)` patterns instead), just copy as-is. If it does, add local copies of the two helpers.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p packages/core/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/combat/factionModifiers.ts
git commit -m "refactor: extract combat/factionModifiers.ts (faction & detachment rule modifiers)"
```

---

### Task 9: Update barrel exports and internal imports

**Files:**
- Modify: `packages/core/src/index.ts:19`
- Modify: `packages/core/src/state/reducers/shootingReducer.ts:5-9`
- Modify: `packages/core/src/state/reducers/stratagemReducer.ts:6`

- [ ] **Step 1: Update the core barrel (`index.ts`)**

Replace line 19:
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

- [ ] **Step 2: Update `shootingReducer.ts` imports**

Replace lines 5-9:
```typescript
import {
  isUnitInEngagementRange,
  getEngagementShootingMode,
  weaponHasAbility,
} from '../../combat/index';
```

With:
```typescript
import { isUnitInEngagementRange, getEngagementShootingMode } from '../../combat/shooting';
import { weaponHasAbility } from '../../combat/abilities';
```

- [ ] **Step 3: Update `stratagemReducer.ts` imports**

Replace line 6:
```typescript
import { isUnitInEngagementRange } from '../../combat/index';
```

With:
```typescript
import { isUnitInEngagementRange } from '../../combat/shooting';
```

- [ ] **Step 4: Delete `combat/index.ts`**

```bash
rm packages/core/src/combat/index.ts
```

- [ ] **Step 5: Verify typecheck passes**

Run: `make typecheck-core`
Expected: PASS (0 errors)

- [ ] **Step 6: Verify no `combat/index` imports remain**

Run: `grep -r "from.*combat/index" packages/core/src/ --include="*.ts" | grep -v __tests__ | grep -v ".d.ts"`
Expected: No output (no non-test files referencing the old path)

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/state/reducers/shootingReducer.ts packages/core/src/state/reducers/stratagemReducer.ts
git add -u packages/core/src/combat/index.ts
git commit -m "refactor: update barrel exports and reducer imports, delete combat/index.ts"
```

---

### Task 10: Update test file imports (sprint test files)

**Files:**
- Modify: `packages/core/src/state/__tests__/sprintA.test.ts:8`
- Modify: `packages/core/src/state/__tests__/sprintC.test.ts:2-16`
- Modify: `packages/core/src/state/__tests__/sprintF_p22.test.ts:6-15`
- Modify: `packages/core/src/state/__tests__/sprintF_p23.test.ts:6-17`
- Modify: `packages/core/src/state/__tests__/sprintG_24a.test.ts:6-17`
- Modify: `packages/core/src/state/__tests__/sprintH_p31.test.ts:7`
- Modify: `packages/core/src/state/__tests__/sprintK.test.ts:15-19`
- Modify: `packages/core/src/state/__tests__/factionRules.test.ts:2-7`

- [ ] **Step 1: Update `sprintA.test.ts`**

Replace line 8:
```typescript
import { getWoundThreshold, parseDiceExpression, resolveAttackSequence, resolveSave } from '../../combat/index';
```

With:
```typescript
import { getWoundThreshold, parseDiceExpression, resolveAttackSequence } from '../../combat/attackPipeline';
import { resolveSave } from '../../combat/saves';
```

- [ ] **Step 2: Update `sprintC.test.ts`**

Replace lines 2-16:
```typescript
import {
  parseWeaponAbility,
  parseWeaponAbilities,
  weaponHasAbility,
  calculateAttacks,
  resolveAttackSequence,
  resolveFeelNoPain,
  parseUnitAbility,
  unitHasAbility,
  getUnitAbilityValue,
  canUnitShootWithAbilities,
  getWoundThreshold,
} from '../../combat/index';
import type { Weapon, Unit } from '../../types/index';
import type { AttackContext } from '../../combat/index';
```

With:
```typescript
import { parseWeaponAbility, parseWeaponAbilities, weaponHasAbility, parseUnitAbility, unitHasAbility, getUnitAbilityValue } from '../../combat/abilities';
import { calculateAttacks, resolveAttackSequence, getWoundThreshold } from '../../combat/attackPipeline';
import type { AttackContext } from '../../combat/attackPipeline';
import { resolveFeelNoPain } from '../../combat/saves';
import { canUnitShootWithAbilities } from '../../combat/shooting';
import type { Weapon, Unit } from '../../types/index';
```

- [ ] **Step 3: Update `sprintF_p22.test.ts`**

Replace lines 6-15:
```typescript
import {
  resolveAttackSequence,
  getEngagementShootingMode,
  getWoundAllocationTarget,
  isUnitInEngagementRange,
  getEngagedEnemyUnits,
  weaponHasAbility,
  parseWeaponAbility,
  calculateAttacks,
} from '../../combat/index';
```

With:
```typescript
import { weaponHasAbility, parseWeaponAbility } from '../../combat/abilities';
import { resolveAttackSequence, calculateAttacks } from '../../combat/attackPipeline';
import { getEngagementShootingMode, isUnitInEngagementRange, getEngagedEnemyUnits } from '../../combat/shooting';
import { getWoundAllocationTarget } from '../../combat/woundAllocation';
```

- [ ] **Step 4: Update `sprintF_p23.test.ts`**

Replace lines 6-17:
```typescript
import {
  validateDeepStrikeArrival,
  validateInfiltratorsDeployment,
  validateScoutMove,
  unitHasStealth,
  getAttachedUnitWoundTarget,
  validateStrategicReservesArrival,
  unitHasAbility,
  getUnitAbilityValue,
  resolveAttackSequence,
  parseWeaponAbility,
} from '../../combat/index';
```

With:
```typescript
import { unitHasStealth, unitHasAbility, getUnitAbilityValue, parseWeaponAbility } from '../../combat/abilities';
import { resolveAttackSequence } from '../../combat/attackPipeline';
import { getAttachedUnitWoundTarget } from '../../combat/woundAllocation';
import { validateDeepStrikeArrival, validateInfiltratorsDeployment, validateScoutMove, validateStrategicReservesArrival } from '../../deployment/validators';
```

- [ ] **Step 5: Update `sprintG_24a.test.ts`**

Replace lines 6-17:
```typescript
import {
  resolveAttackSequence,
  resolveSave,
  parseWeaponAbilities,
  getSmokescreenModifiers,
  getGoToGroundModifiers,
  getStratagemSaveModifiers,
  getStratagemHitModifier,
  isEpicChallengePrecision,
  getAttachedUnitWoundTarget,
} from '../../combat/index';
import type { AttackContext } from '../../combat/index';
```

With:
```typescript
import { parseWeaponAbilities } from '../../combat/abilities';
import { resolveAttackSequence } from '../../combat/attackPipeline';
import type { AttackContext } from '../../combat/attackPipeline';
import { resolveSave } from '../../combat/saves';
import { getSmokescreenModifiers, getGoToGroundModifiers, getStratagemSaveModifiers, getStratagemHitModifier, isEpicChallengePrecision } from '../../combat/stratagems';
import { getAttachedUnitWoundTarget } from '../../combat/woundAllocation';
```

- [ ] **Step 6: Update `sprintH_p31.test.ts`**

Replace line 7:
```typescript
import { validateScoutMove } from '../../combat/index';
```

With:
```typescript
import { validateScoutMove } from '../../deployment/validators';
```

- [ ] **Step 7: Update `sprintK.test.ts`**

Replace lines 15-19:
```typescript
import {
  canAttachLeader,
  doesAttachedUnitDestructionCountAsDestroyed,
  getRevertedStartingStrength,
} from '../../combat/index';
```

With:
```typescript
import { canAttachLeader, doesAttachedUnitDestructionCountAsDestroyed, getRevertedStartingStrength } from '../../combat/woundAllocation';
```

- [ ] **Step 8: Update `factionRules.test.ts`**

Replace lines 2-7:
```typescript
import {
  resolveAttackSequence,
  applyFactionAndDetachmentRules,
  applyDefensiveDetachmentRules,
} from '../../combat/index';
import type { AttackContext } from '../../combat/index';
```

With:
```typescript
import { resolveAttackSequence } from '../../combat/attackPipeline';
import type { AttackContext } from '../../combat/attackPipeline';
import { applyFactionAndDetachmentRules, applyDefensiveDetachmentRules } from '../../combat/factionModifiers';
```

- [ ] **Step 9: Verify all tests pass**

Run: `make test-core`
Expected: All 84 tests pass

- [ ] **Step 10: Verify no `combat/index` imports remain anywhere**

Run: `grep -r "from.*combat/index" packages/ --include="*.ts"`
Expected: No output

- [ ] **Step 11: Commit**

```bash
git add packages/core/src/state/__tests__/sprintA.test.ts \
        packages/core/src/state/__tests__/sprintC.test.ts \
        packages/core/src/state/__tests__/sprintF_p22.test.ts \
        packages/core/src/state/__tests__/sprintF_p23.test.ts \
        packages/core/src/state/__tests__/sprintG_24a.test.ts \
        packages/core/src/state/__tests__/sprintH_p31.test.ts \
        packages/core/src/state/__tests__/sprintK.test.ts \
        packages/core/src/state/__tests__/factionRules.test.ts
git commit -m "refactor: update all test imports to new combat sub-modules"
```

---

### Task 11: Create `combat/__tests__/abilities.test.ts`

**Files:**
- Create: `packages/core/src/combat/__tests__/abilities.test.ts`
- Source tests from: `sprintC.test.ts` — "Weapon Ability Parser" describe block (8 tests) + "Unit Ability Parser" describe block (5 tests)

- [ ] **Step 0: Create the `combat/__tests__` directory**

```bash
mkdir -p packages/core/src/combat/__tests__
```

- [ ] **Step 1: Create `abilities.test.ts`**

Read `sprintC.test.ts` and copy the following describe blocks into the new file:
- `describe('Phase 13: Weapon Ability Parser', ...)` — all `it` blocks inside
- `describe('Phase 17: Unit Ability Parser', ...)` — all `it` blocks inside

The new file imports:
```typescript
import { describe, it, expect } from 'vitest';
import { parseWeaponAbility, parseWeaponAbilities, weaponHasAbility, parseUnitAbility, unitHasAbility, getUnitAbilityValue } from '../abilities';
import type { Weapon, Unit } from '../../types/index';
```

Rename the top-level describe blocks to remove sprint/phase prefixes:
- `'Phase 13: Weapon Ability Parser'` → `'Weapon Ability Parser'`
- `'Phase 17: Unit Ability Parser'` → `'Unit Ability Parser'`

- [ ] **Step 2: Remove the copied tests from `sprintC.test.ts`**

Delete the two describe blocks from `sprintC.test.ts`. Also remove any imports that are no longer used after deletion (e.g., `parseWeaponAbility`, `parseWeaponAbilities`, `weaponHasAbility`, `parseUnitAbility`, `unitHasAbility`, `getUnitAbilityValue` if they're no longer referenced).

- [ ] **Step 3: Run the new test file**

Run: `npx vitest run packages/core/src/combat/__tests__/abilities.test.ts`
Expected: 13 tests pass

- [ ] **Step 4: Run original test file to confirm nothing broke**

Run: `npx vitest run packages/core/src/state/__tests__/sprintC.test.ts`
Expected: remaining tests still pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/combat/__tests__/abilities.test.ts packages/core/src/state/__tests__/sprintC.test.ts
git commit -m "refactor: migrate ability parser tests to combat/__tests__/abilities.test.ts"
```

---

### Task 12: Create `combat/__tests__/attackPipeline.test.ts`

**Files:**
- Create: `packages/core/src/combat/__tests__/attackPipeline.test.ts`
- Source tests from:
  - `sprintA.test.ts` — "Combat Utilities" describe block (11 tests, excluding `resolveSave` which goes to `saves.test.ts`), "10th Edition: getWoundThreshold" describe block (1 test)
  - `sprintC.test.ts` — "calculateAttacks" (3 tests), "resolveAttackSequence with abilities" (6 tests), "Wound Threshold" (5 tests)
  - `sprintF_p22.test.ts` — "Indirect Fire" (1 test), "Extra Attacks" (1 test)

- [ ] **Step 1: Create `attackPipeline.test.ts`**

Imports:
```typescript
import { describe, it, expect } from 'vitest';
import { parseDiceExpression, getWoundThreshold, calculateAttacks, resolveAttackSequence } from '../attackPipeline';
import type { AttackContext } from '../attackPipeline';
import { parseWeaponAbility } from '../abilities';
import type { Weapon } from '../../types/index';
```

Copy the relevant describe/it blocks from each source file. Rename top-level describes to remove sprint/phase prefixes.

**Important:** The `resolveSave` test inside "Combat Utilities" does NOT come here — it goes to `saves.test.ts` in Task 13. Also include the standalone `'10th Edition: getWoundThreshold'` describe block from sprintA (~line 900).

- [ ] **Step 2: Remove copied tests from source files**

Remove the copied describe blocks from `sprintA.test.ts`, `sprintC.test.ts`, and `sprintF_p22.test.ts`. Clean up unused imports.

- [ ] **Step 3: Run the new test file**

Run: `npx vitest run packages/core/src/combat/__tests__/attackPipeline.test.ts`
Expected: 27 tests pass

- [ ] **Step 4: Run all source test files to confirm nothing broke**

Run: `make test-core`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/combat/__tests__/attackPipeline.test.ts \
        packages/core/src/state/__tests__/sprintA.test.ts \
        packages/core/src/state/__tests__/sprintC.test.ts \
        packages/core/src/state/__tests__/sprintF_p22.test.ts
git commit -m "refactor: migrate attack pipeline tests to combat/__tests__/attackPipeline.test.ts"
```

---

### Task 13: Create `combat/__tests__/saves.test.ts`

**Files:**
- Create: `packages/core/src/combat/__tests__/saves.test.ts`
- Source tests from:
  - `sprintA.test.ts` — resolveSave test (1)
  - `sprintC.test.ts` — "Feel No Pain" (2 tests)
  - `sprintG_24a.test.ts` — "resolveSave with cover" (3 tests), "resolveSave with Go to Ground" (3 tests)

- [ ] **Step 1: Create `saves.test.ts`**

Imports:
```typescript
import { describe, it, expect } from 'vitest';
import { resolveSave, resolveFeelNoPain } from '../saves';
```

Copy the relevant describe/it blocks. Rename top-level describes to remove sprint/phase prefixes.

- [ ] **Step 2: Remove copied tests from source files**

Clean up `sprintA.test.ts`, `sprintC.test.ts`, and `sprintG_24a.test.ts`.

- [ ] **Step 3: Run the new test file**

Run: `npx vitest run packages/core/src/combat/__tests__/saves.test.ts`
Expected: 9 tests pass

- [ ] **Step 4: Run all tests**

Run: `make test-core`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/combat/__tests__/saves.test.ts \
        packages/core/src/state/__tests__/sprintA.test.ts \
        packages/core/src/state/__tests__/sprintC.test.ts \
        packages/core/src/state/__tests__/sprintG_24a.test.ts
git commit -m "refactor: migrate save tests to combat/__tests__/saves.test.ts"
```

---

### Task 14: Create `combat/__tests__/shooting.test.ts`

**Files:**
- Create: `packages/core/src/combat/__tests__/shooting.test.ts`
- Source tests from:
  - `sprintC.test.ts` — "Assault weapon ability" (4 tests)
  - `sprintF_p22.test.ts` — "Big Guns Never Tire" (3), "Pistols" (3), "Engagement range helpers" (2)

- [ ] **Step 1: Create `shooting.test.ts`**

Imports:
```typescript
import { describe, it, expect } from 'vitest';
import { canUnitShootWithAbilities, isUnitInEngagementRange, getEngagedEnemyUnits, getEngagementShootingMode } from '../shooting';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState, Weapon } from '../../types/index';
import '../../editions/index';
```

Copy relevant describe blocks. The Big Guns, Pistols, and engagement helpers tests use game state — copy the `setupTwoPlayerGame` helper function from the source test file into this new file.

- [ ] **Step 2: Remove copied tests from source files**

Clean up `sprintC.test.ts` and `sprintF_p22.test.ts`.

- [ ] **Step 3: Run and verify**

Run: `npx vitest run packages/core/src/combat/__tests__/shooting.test.ts`
Expected: 12 tests pass

- [ ] **Step 4: Run all tests**

Run: `make test-core`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/combat/__tests__/shooting.test.ts \
        packages/core/src/state/__tests__/sprintC.test.ts \
        packages/core/src/state/__tests__/sprintF_p22.test.ts
git commit -m "refactor: migrate shooting tests to combat/__tests__/shooting.test.ts"
```

---

### Task 15: Create `combat/__tests__/woundAllocation.test.ts`

**Files:**
- Create: `packages/core/src/combat/__tests__/woundAllocation.test.ts`
- Source tests from:
  - `sprintF_p22.test.ts` — "Wound allocation" (2 tests)
  - `sprintF_p23.test.ts` — "Attached Units" (5 tests)
  - `sprintK.test.ts` — "Attached unit destruction VP" (2), "Surviving unit reverts" (1), "Cannot attach more than one Leader" (2)

- [ ] **Step 1: Create `woundAllocation.test.ts`**

Imports:
```typescript
import { describe, it, expect } from 'vitest';
import { getWoundAllocationTarget, getAttachedUnitWoundTarget, canAttachLeader, doesAttachedUnitDestructionCountAsDestroyed, getRevertedStartingStrength } from '../woundAllocation';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState } from '../../types/index';
import '../../editions/index';
```

Copy relevant describe blocks plus any `setupTwoPlayerGame` helpers needed.

- [ ] **Step 2: Remove copied tests from source files**

Clean up `sprintF_p22.test.ts`, `sprintF_p23.test.ts`, and `sprintK.test.ts`.

- [ ] **Step 3: Run and verify**

Run: `npx vitest run packages/core/src/combat/__tests__/woundAllocation.test.ts`
Expected: 12 tests pass

- [ ] **Step 4: Run all tests**

Run: `make test-core`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/combat/__tests__/woundAllocation.test.ts \
        packages/core/src/state/__tests__/sprintF_p22.test.ts \
        packages/core/src/state/__tests__/sprintF_p23.test.ts \
        packages/core/src/state/__tests__/sprintK.test.ts
git commit -m "refactor: migrate wound allocation tests to combat/__tests__/woundAllocation.test.ts"
```

---

### Task 16: Create `combat/__tests__/stratagems.test.ts`

**Files:**
- Create: `packages/core/src/combat/__tests__/stratagems.test.ts`
- Source tests from: `sprintG_24a.test.ts` — Smokescreen (5), Go to Ground (4), Epic Challenge (3)

- [ ] **Step 1: Create `stratagems.test.ts`**

Imports:
```typescript
import { describe, it, expect } from 'vitest';
import { getSmokescreenModifiers, getGoToGroundModifiers, getStratagemSaveModifiers, getStratagemHitModifier, isEpicChallengePrecision } from '../stratagems';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState } from '../../types/index';
import '../../editions/index';
```

Copy the Smokescreen, Go to Ground, and Epic Challenge describe blocks. These tests use game state — copy the `setupTwoPlayerGame` helper from the source test file.

- [ ] **Step 2: Remove copied tests from `sprintG_24a.test.ts`**

Clean up unused imports.

- [ ] **Step 3: Run and verify**

Run: `npx vitest run packages/core/src/combat/__tests__/stratagems.test.ts`
Expected: 12 tests pass

- [ ] **Step 4: Run all tests**

Run: `make test-core`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/combat/__tests__/stratagems.test.ts \
        packages/core/src/state/__tests__/sprintG_24a.test.ts
git commit -m "refactor: migrate stratagem combat tests to combat/__tests__/stratagems.test.ts"
```

---

### Task 17: Create `combat/__tests__/factionModifiers.test.ts`

**Files:**
- Create: `packages/core/src/combat/__tests__/factionModifiers.test.ts`
- Source tests from: `factionRules.test.ts` — Born Soldiers (5), Mechanised Assault (2), Armoured Company (3), Fortification Network (1), Orders combat modifiers (4), Kauyon (3), Mont'ka (4), Kroot Hunting Pack (3), For the Greater Good combat modifier tests only (3)
- Tests that STAY in `factionRules.test.ts`: Faction & Detachment Registry (4), Faction Detection (3), Per-Player Detachments (2), T'au Registry (4), Guided Targets reducer tests (6)

- [ ] **Step 1: Create `factionModifiers.test.ts`**

Imports:
```typescript
import { describe, it, expect } from 'vitest';
import { applyFactionAndDetachmentRules, applyDefensiveDetachmentRules } from '../factionModifiers';
import { resolveAttackSequence } from '../attackPipeline';
import type { AttackContext } from '../attackPipeline';
import type { GameState, Unit, Weapon, Detachment } from '../../types/index';
import { createInitialGameState } from '../../state/initialState';
import { gameReducer } from '../../state/reducer';
import { getFactionState } from '../../detachments/registry';
import type { AstraMilitarumState } from '../../detachments/astra-militarum';
import type { TauEmpireState } from '../../detachments/tau-empire';
import '../../editions/index';
```

Copy the relevant describe blocks that directly test `applyFactionAndDetachmentRules` and `applyDefensiveDetachmentRules`. Tests that are purely about the faction registry or roster detection (not combat modifiers) stay in `factionRules.test.ts`.

- [ ] **Step 2: Remove copied tests from `factionRules.test.ts`**

Clean up unused imports.

- [ ] **Step 3: Run and verify**

Run: `npx vitest run packages/core/src/combat/__tests__/factionModifiers.test.ts`
Expected: Tests pass

- [ ] **Step 4: Run all tests**

Run: `make test-core`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/combat/__tests__/factionModifiers.test.ts \
        packages/core/src/state/__tests__/factionRules.test.ts
git commit -m "refactor: migrate faction modifier tests to combat/__tests__/factionModifiers.test.ts"
```

---

### Task 18: Create `deployment/__tests__/validators.test.ts`

**Files:**
- Create: `packages/core/src/deployment/__tests__/validators.test.ts`
- Source tests from:
  - `sprintF_p23.test.ts` — Deep Strike (3), Infiltrators (2), Scout (2), Strategic Reserves (4)
  - `sprintH_p31.test.ts` — Scout (4)

- [ ] **Step 1: Create `deployment/__tests__` directory**

```bash
mkdir -p packages/core/src/deployment/__tests__
```

- [ ] **Step 2: Create `validators.test.ts`**

Imports:
```typescript
import { describe, it, expect } from 'vitest';
import { validateDeepStrikeArrival, validateInfiltratorsDeployment, validateScoutMove, validateStrategicReservesArrival } from '../validators';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState, DeploymentZone } from '../../types/index';
import '../../editions/index';
```

Copy the relevant describe blocks plus any `setupTwoPlayerGame` helpers needed.

- [ ] **Step 3: Remove copied tests from source files**

Clean up `sprintF_p23.test.ts` and `sprintH_p31.test.ts`.

- [ ] **Step 4: Run and verify**

Run: `npx vitest run packages/core/src/deployment/__tests__/validators.test.ts`
Expected: 15 tests pass

- [ ] **Step 5: Run all tests**

Run: `make test-core`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/deployment/__tests__/validators.test.ts \
        packages/core/src/state/__tests__/sprintF_p23.test.ts \
        packages/core/src/state/__tests__/sprintH_p31.test.ts
git commit -m "refactor: migrate deployment validator tests to deployment/__tests__/validators.test.ts"
```

---

### Task 19: Final verification

- [ ] **Step 1: Full typecheck**

Run: `make typecheck-core`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `make test-core`
Expected: All 84 tests pass (same count as before — tests moved, not added or removed)

- [ ] **Step 3: Verify no `combat/index` references remain**

Run: `grep -r "combat/index" packages/ --include="*.ts"`
Expected: No output

- [ ] **Step 4: Verify `combat/index.ts` is deleted**

Run: `ls packages/core/src/combat/index.ts 2>&1`
Expected: "No such file or directory"

- [ ] **Step 5: Verify new module structure**

Run: `ls packages/core/src/combat/*.ts packages/core/src/deployment/*.ts`
Expected:
```
packages/core/src/combat/abilities.ts
packages/core/src/combat/attackPipeline.ts
packages/core/src/combat/factionModifiers.ts
packages/core/src/combat/saves.ts
packages/core/src/combat/shooting.ts
packages/core/src/combat/stratagems.ts
packages/core/src/combat/woundAllocation.ts
packages/core/src/deployment/validators.ts
```

- [ ] **Step 6: Commit any remaining cleanup**

If any files need final cleanup (unused imports in sprint test files, etc.):

```bash
git add -A
git commit -m "refactor: final cleanup after combat module decomposition"
```
