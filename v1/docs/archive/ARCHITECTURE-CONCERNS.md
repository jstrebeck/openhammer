# Architecture Concerns

Identified during full repo review (2026-03-23). Tracked here to guide refactoring priorities.

## Priority Legend
- **CRITICAL** — Blocks extensibility, must fix before adding more features
- **HIGH** — Significant pain point, should fix soon
- **MEDIUM** — Improvement opportunity, fix when touching related code

---

## CRITICAL

### 1. Monolithic Reducer (4,093 LOC)
**File:** `packages/core/src/state/reducer.ts`

Single switch statement with ~194 case statements handling every action type. Movement, shooting, charging, fighting, command phase, stratagems, transports, aircraft, deployment — all interleaved in one file.

**Impact:** Can't reason about one domain without reading 4,000 lines. Every new action type or rule change touches this file. High merge conflict risk.

**Fix:** Split into domain-specific sub-reducers (movement, shooting, charge, fight, command, transport, aircraft, deployment, etc.) composed by the main reducer.

---

### 2. Faction-Specific Fields on GameState
**File:** `packages/core/src/types/index.ts`

GameState has 50+ top-level fields including faction-specific ones:
- `guidedTargets: Record<string, string>` — T'au Empire only
- `activeOrders: Record<string, string>` — Astra Militarum only
- `officersUsedThisPhase: string[]` — Astra Militarum only
- `smokescreenUnits: string[]` — Specific stratagem effect
- `goToGroundUnits: string[]` — Specific stratagem effect
- `epicChallengeUnits: string[]` — Specific stratagem effect

**Impact:** Every new faction/stratagem adds fields to the global state interface. GameState grows unbounded. Factions are coupled to the core type system.

**Fix:** Introduce a generic `factionState: Record<string, unknown>` or typed extension mechanism so faction-specific state doesn't pollute the core interface.

---

## HIGH

### 3. Combat Module Too Large (1,247 LOC)
**File:** `packages/core/src/combat/index.ts`

Single file handles: dice expression parsing, weapon ability parsing, unit ability parsing, attack sequence resolution, save resolution, wound allocation, cover application, Feel No Pain, and 20+ helper functions.

**Fix:** Split into focused modules: `dice.ts`, `weaponAbilities.ts`, `unitAbilities.ts`, `attackPipeline.ts`, `saves.ts`, `woundAllocation.ts`.

---

### 4. Phase Names Hardcoded in Client (3+ locations)
**Files:**
- `packages/client/src/canvas/BoardCanvas.tsx:295`
- `packages/client/src/components/PhaseActionPanel.tsx:10-26`
- `packages/client/src/components/PhaseActionPanel.tsx:40-65`

Phase order `['command', 'movement', 'shooting', 'charge', 'fight', 'morale']` duplicated as string arrays. Phase-to-panel mapping uses hardcoded conditionals.

**Fix:** Query phase info from the edition object. Use a component registry pattern for phase panels.

---

### 5. Stratagem Effects Hardcoded in Reducer
**Files:** `packages/core/src/types/index.ts` (descriptions), `packages/core/src/state/reducer.ts` (effects)

Core stratagems defined as static data objects in types, but their mechanical effects are scattered as switch cases in the reducer. No structured way to define what a stratagem *does*.

**Fix:** Stratagems should declare their effects as structured data (e.g., modifiers, state changes) that the reducer interprets generically.

---

### 6. Hardcoded Faction Data as TypeScript
**Files:**
- `packages/core/src/detachments/astra-militarum.ts` (425 LOC)
- `packages/core/src/detachments/tau-empire.ts` (418 LOC)

Entire faction rules written as TypeScript objects. Can't add a faction without writing code.

**Fix:** Define a data schema for faction/detachment definitions. Could remain as TS objects (type-safe) but with a clear contract that separates *data* (names, costs, descriptions) from *behavior* (rule effects).

---

## MEDIUM

### 7. Hardcoded Base Sizes (408 LOC)
**File:** `packages/core/src/army-list/baseLookup.ts`

Hand-curated mapping of unit names to base sizes in mm. Must be manually maintained.

**Fix:** Move to a JSON data file. Allow user overrides.

---

### 8. Large Client Components
| File | Lines |
|------|-------|
| `GameSetupDialog.tsx` | 933 |
| `BoardCanvas.tsx` | 840 |
| `ShootingPanel.tsx` | 646 |
| `FightPanel.tsx` | 467 |
| `UnitListSidebar.tsx` | 446 |
| `DeploymentWizard.tsx` | 347 |

**Fix:** Decompose into focused subcomponents. Extract shared patterns.

---

### 9. Duplicate Wound Threshold Logic
**Files:** `packages/core/src/editions/wh40k10th.ts` and `packages/core/src/combat/index.ts`

S vs T wound threshold calculation exists in both the edition implementation and the combat module.

**Fix:** Single source of truth — combat module should call edition method.

---

### 10. Game Logic Leaked into Client
- `BoardCanvas.tsx:429-432` — Drag permission checks phase name strings
- `ShootingPanel.tsx:16-37` — Weapon ability color coding hardcoded for 10th Ed
- `ChargePanel.tsx:47` — Distance check hardcoded as `<= 12`
- Multiple components call `rollDice()` directly instead of dispatching actions

**Fix:** Move rule queries to core helper functions. Client should ask "can I do X?" not compute it.

---

### 11. Edition System Incomplete
**File:** `packages/core/src/editions/wh40k10th.ts` (87 LOC)

Only one edition implemented. Constants like engagement range (1"), coherency (2"), aircraft move distance (20") are hardcoded in various files rather than queried from the edition.

**Fix:** Centralize all edition-specific constants in the RulesEdition interface. Modules should query the edition, not use local constants.

---

### 12. Mission Scoring Limited
**File:** `packages/core/src/missions/index.ts`

Only 3 scoring condition types (`hold_one`, `hold_two`, `hold_more`). No support for custom secondary objectives or mission-specific scoring rules.

**Fix:** Extensible scoring condition system.
