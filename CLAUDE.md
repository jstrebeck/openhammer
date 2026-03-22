# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
make install            # Install all workspace dependencies
make dev                # Client dev server (Vite, localhost:5173)
make dev-server         # Server dev server (tsx watch, localhost:3001)
make dev-all            # Both in parallel (needs concurrently)
make test               # Run all tests (84 tests across 9 files)
make test-core          # Core tests only
make test-client        # Client tests only
make typecheck          # Type-check all three packages
make typecheck-core     # Type-check core only
make typecheck-client   # Type-check client only
make typecheck-server   # Type-check server only
make build              # Production build (core → client → server)
```

Run a single test file:
```bash
npx vitest run packages/core/src/state/__tests__/reducer.test.ts
```

Run tests matching a name:
```bash
npx vitest run -t "places a model"
```

## Architecture

Three-package npm workspace monorepo. No Nx/Turborepo.

### `packages/core` — Pure game engine

Zero DOM/Canvas/React/Node dependencies. Everything is pure TypeScript operating on plain JSON-serializable data.

**State flow:** All mutations go through `gameReducer(state, action) → newState`. The `GameAction` discriminated union has 25+ action types. The reducer is immutable — it returns new objects or the same reference if nothing changed.

**GameState** holds: `models`, `units`, `players`, `terrain`, `deploymentZones`, `objectives`, `turnState`, `log`, `rulesConfig` — all as `Record<string, T>` keyed by ID.

**Rules are edition-pluggable.** `RulesEdition` is an interface; `packages/core/src/editions/wh40k10th.ts` implements it for 10th Edition. Editions auto-register via a side-effect import in the core barrel (`src/index.ts` imports `./editions/index`). Never import editions separately — importing `@openhammer/core` handles registration.

**Army list import** parses Battlescribe JSON exports directly (the `roster.forces[].selections[]` structure). No custom schema. The importer handles `type: "model"` and `type: "unit"` selections with nested sub-selections for multi-model units.

**Coordinate system:** Continuous floating-point, 1 unit = 1 inch. Board origin is top-left (0,0). Standard board is 60x44. Distances between models are edge-to-edge (base radius subtracted from center-to-center distance).

### `packages/client` — React + PixiJS frontend

**PixiJS integration pattern:** `BoardCanvas.tsx` creates a PixiJS `Application` in a `useEffect`, manages it imperatively (no @pixi/react). A ticker loop reads `gameStore` and `uiStore` each frame and syncs layer objects. The `resizeTo` option is NOT used (caused StrictMode crashes) — manual resize via `app.renderer.resize()`.

**Two Zustand stores:**
- `gameStore`: wraps the core reducer with undo/redo history. `dispatch()` applies actions locally AND forwards to the server if `useMultiplayerStore.roomId` is set.
- `uiStore`: local-only state (selected models, active tool, camera, context menu, theme). Not synced in multiplayer.

**Canvas layers** are imperative PixiJS objects (`ModelLayer`, `TerrainLayer`, `DeploymentZoneLayer`, `ObjectiveLayer`, etc.) created once and synced via the ticker. They are NOT React components.

**Multiplayer networking** uses a module-level WebSocket singleton in `src/networking/useMultiplayer.ts` (not tied to React component lifecycle — this is intentional, as previous ref-based approaches broke when components unmounted). The `useMultiplayer()` hook just returns the module-level functions.

### `packages/server` — Multiplayer relay

Express + `ws`. Server is authoritative: it applies actions via `gameReducer` on the server-side `Room.state`, then broadcasts. Clients get `STATE_SNAPSHOT` for reconciliation. Rooms are identified by 6-char alphanumeric codes. Reconnection matches by player name to avoid duplicate player entries.

## Key Patterns

- **Model base sizes** are stored in mm (`baseSizeMm`) with a pre-computed `baseSizeInches` field. All game logic uses inches.
- **IDs** use `crypto.randomUUID()` everywhere.
- **Test helpers** live in `packages/core/src/test-helpers.ts` (`makeModel`, `makeUnit`, `makePlayer` with sensible defaults).
- **Player.commandPoints** must be included when creating players (it was added in Phase 4).
- **The `GameState.log`** and **`GameState.rulesConfig`** fields exist on all states — `createInitialGameState()` initializes them.
- When adding new fields to `GameState`, update: the type, `createInitialGameState()`, and the test helpers.

### Sprint A: Gameplay Enforcement (Phases 7–11)

**Phase enforcement:** Every action type maps to a category (`movement`, `shooting`, `charge`, `fight`, `setup`, `admin`) via `getActionCategory()`. The `PhaseActionMap` from the edition defines which categories are allowed per phase. The reducer checks this before processing any action. Controlled by `rulesConfig.phaseRestrictions` (off/warn/enforce).

**Turn tracking:** `GameState.turnTracking` persists across phases within a turn (e.g., `unitMovement` survives from Movement to Shooting). `ADVANCE_PHASE` resets only per-phase data (`unitsActivated`, `unitsCompleted`). `NEXT_TURN` resets everything.

**Movement flow:** `DECLARE_MOVEMENT` → optional `ROLL_ADVANCE` → `COMMIT_MOVEMENT`. The `validateMovement()` function checks distance, edge, engagement range, and coherency. Enforcement level from `rulesConfig.movementRange`.

**Shooting flow:** `DECLARE_SHOOTING` → `ASSIGN_WEAPON_TARGETS` → `RESOLVE_SHOOTING_ATTACK` → `RESOLVE_SAVE_ROLL` → `APPLY_DAMAGE` → `COMPLETE_SHOOTING`. The combat module (`packages/core/src/combat/index.ts`) provides `resolveAttackSequence()`, `resolveSave()`, `parseDiceExpression()`, `getWoundThreshold()`.

**Charge flow:** `DECLARE_CHARGE` → `ROLL_CHARGE` → `COMMIT_CHARGE_MOVE` or `FAIL_CHARGE`. Successful charges add to `turnTracking.chargedUnits` for Fights First in the Fight Phase.

**Fight flow:** `INITIALIZE_FIGHT_PHASE` → `SELECT_UNIT_TO_FIGHT` → `PILE_IN` → `RESOLVE_MELEE_ATTACK` → `CONSOLIDATE` → `COMPLETE_FIGHT`. Uses `fightState` with `fights_first`/`remaining` steps and alternating player selection.

### Sprint B: Command & Morale (Phases 12, 14)

**Command Phase:** `START_COMMAND_PHASE` grants +1 CP to both players and clears `battleShocked` for the active player's units. Battle-shock persists across phases and turns — only cleared at the owning player's next Command Phase.

**Battle-shock:** `RESOLVE_BATTLE_SHOCK` accepts a roll and passed flag. Failed units are added to `GameState.battleShocked: string[]`. Battle-shocked units have effective OC=0 (checked during objective control calculation).

**Objective Control:** `CALCULATE_OBJECTIVE_CONTROL` scans all models within 3" (edge-to-edge) of each objective, sums OC per player (battle-shocked = 0), and assigns `controllingPlayerId`. Tied OC = contested (undefined).

**Scoring:** `UPDATE_SCORE` adds VP to `GameState.score: Record<string, number>`. Score persists across the entire game. `Unit.startingStrength` tracks the original model count for Battle-shock detection.

### Sprint C: Weapon & Unit Abilities (Phases 13, 17)

**Weapon ability parser:** `parseWeaponAbility()` parses strings like "SUSTAINED HITS 1", "ANTI-INFANTRY 4+", "MELTA 2" into `{ name, value?, keyword? }`. `weaponHasAbility()` does quick checks.

**Ability-aware attack pipeline:** `resolveAttackSequence()` now accepts an optional `AttackContext` with weapon, distance, target info, and movement status. Without context, it behaves exactly as before (backwards compatible). With context, abilities modify each step:
- **Calculate attacks:** Blast (+1 per 5 models), Rapid Fire X (+X within half range)
- **Hit roll:** Torrent (auto-hit), Heavy (+1 if stationary), Conversion X (crit on 4+ if far)
- **Critical hits:** Lethal Hits (auto-wound), Sustained Hits X (extra hits)
- **Wound roll:** Lance (+1 if charged), Anti-KEYWORD X+ (crit wound), Twin-linked (re-roll)
- **Critical wounds:** Devastating Wounds (mortal wounds instead)
- **Damage:** Melta X (+X within half range)
- Returns `triggeredAbilities: string[]` for UI display

**Assault:** `canUnitShootWithAbilities()` checks if any weapon has Assault — if so, the unit can shoot after Advancing (Assault weapons only).

**Unit ability helpers:** `parseUnitAbility()`, `unitHasAbility()`, `getUnitAbilityValue()` for parsing abilities like "FEEL NO PAIN 5+", "SCOUT 6\"", "DEEP STRIKE". `resolveFeelNoPain()` rolls D6 per wound and blocks on threshold+.

### Sprint D: Terrain & Stratagems (Phases 15, 16)

**Terrain & Cover:** `determineCover()` in `packages/core/src/terrain/cover.ts` checks if a target unit has Benefit of Cover by: (1) checking if target models are wholly within terrain polygons with dense/obscuring traits, (2) checking if LoS from attacker passes through dense terrain. `applyBenefitOfCover()` returns the modified save characteristic (+1 to save, but NOT for 3+ save vs AP 0, and respects Ignores Cover flag).

**Stratagems:** `CORE_STRATAGEMS` array in types defines all 11 core stratagems with id, name, cpCost, phases, timing, description, and restrictions. `USE_STRATAGEM` action validates: cannot reuse in same phase (`stratagemsUsedThisPhase`), CP check, battle-shocked restriction (except Insane Bravery), phase validation. `stratagemsUsedThisPhase` resets on `ADVANCE_PHASE` and `NEXT_TURN`. `StratagemPanel` client component shows available stratagems filtered by current phase.

### Sprint E: Advanced Systems (Phases 18, 19, 20)

**Transports:** `Unit` has optional `transportCapacity`, `firingDeck`, and `transportKeywordRestrictions` fields. `GameState.embarkedUnits: Record<string, string[]>` maps transport ID → embarked unit IDs. `EMBARK` action validates distance (3"), capacity, keyword restrictions, and same-phase restrictions. `DISEMBARK` validates transport hasn't Advanced/Fell Back and unit didn't embark same phase. `RESOLVE_DESTROYED_TRANSPORT` applies casualties and Battle-shocks survivors. Embarked models use off-board position `{ x: -1000, y: -1000 }` — `isEmbarkedPosition()` checks this. `embarkedThisPhase`/`disembarkedThisPhase` on `TurnTracking` reset per phase. Transport validation helpers live in `packages/core/src/transport/index.ts`.

**Aircraft & Reserves:** `GameState.reserves: Record<string, ReserveEntry>` tracks units in reserves with type and `availableFromRound`. `GameState.hoverModeUnits: string[]` tracks aircraft in hover mode. `SET_UNIT_IN_RESERVES` moves models off-board. `ARRIVE_FROM_RESERVES` validates round availability. `AIRCRAFT_MOVE` validates exactly 20" movement distance. `AIRCRAFT_OFF_BOARD` sends aircraft to Strategic Reserves. `SET_HOVER_MODE` toggles AIRCRAFT behavior. `canChargeAircraft()`/`canFightAircraft()` require FLY keyword. Helpers in `packages/core/src/aircraft/index.ts`.

**Mortal Wounds:** `APPLY_MORTAL_WOUNDS` targets a unit (not model), applies damage without saves, spilling across models sorted by wounds remaining (lowest first). Each mortal wound = 1 damage.

**Re-roll Tracking:** `DiceRoll.reRolled?: boolean` flag marks re-rolls. `canReRoll()` in dice module returns false for already-rerolled dice. Re-rolls happen before modifiers.

**Roll-offs:** `ROLL_OFF` action logs results. `rollOff()` utility resolves ties by re-rolling. No modifiers or re-rolls allowed on roll-off dice.

**Surge Moves:** `SURGE_MOVE` action — one per phase per unit, blocked when Battle-shocked or in Engagement Range. `surgeMoveUsedThisPhase` on `TurnTracking` resets per phase.

### Sprint F: Rules Fidelity (Phases 21, 22, 23)

**Movement & Combat Validation (Phase 21):** `doesPathCrossModel()` in measurement module checks line-segment vs circle intersection for path collision. `validateMovement()` enhanced: FLY units skip path collision through enemies; non-FLY blocked; FLY MONSTER/VEHICLE through friendly MONSTER/VEHICLE. AIRCRAFT engagement range exemption (can't end within ER). `validateChargeMove()` checks distance ≤ charge roll, must end in ER of all declared targets, coherency, no ER of non-target enemies. `validatePileIn()` enforces max 3", must end closer to closest enemy, coherency. `validateConsolidate()` same as pile-in + objective marker fallback. `isValidMeleeTarget()` checks Engagement Range or friendly base-to-base chain (BFS). All validation gated by `rulesConfig.movementRange` (off/warn/enforce).

**Shooting Rules Completion (Phase 22):** Big Guns Never Tire: `isUnitInEngagementRange()`, `getEngagementShootingMode()`, `getEngagedEnemyUnits()` — MONSTER/VEHICLE can shoot ranged (non-Pistol) in ER targeting only engaged units. Pistols: can fire in ER at engaged units. `getWoundAllocationTarget()` enforces already-wounded models first. `RESOLVE_HAZARDOUS` action — D6 per model, destroy on 1. One Shot tracking via `GameState.weaponsFired: Record<string, boolean>` (key = "unitId:weaponId"). Precision wound allocation via `getAttachedUnitWoundTarget()`. Ignores Cover via `applyBenefitOfCover()` flag. Indirect Fire: -1 to Hit modifier in `resolveAttackSequence()`.

**Unit Abilities & Attached Units (Phase 23):** `RESOLVE_DEADLY_DEMISE` — on destruction, inflicts mortal wounds to all units within 6". `validateDeepStrikeArrival()` — >9" from enemies, Round 2+. `validateInfiltratorsDeployment()` — >9" from enemy models and deployment zones. `validateScoutMove()` — max X" pre-game move. `unitHasStealth()` — detect Stealth ability for -1 to Hit. `ATTACH_LEADER`/`DETACH_LEADER` actions — CHARACTER attaches to Bodyguard via `GameState.attachedUnits: Record<string, string>`. `getAttachedUnitWoundTarget()` — Bodyguard absorbs first, CHARACTER protected unless Precision. `validateStrategicReservesArrival()` — within 6" of board edge, >9" from enemies, Round 2+.

## TypeScript

Strict mode everywhere. Client and server resolve `@openhammer/core` via tsconfig `paths` pointing to `../core/src/index.ts` (no build step needed for dev). Vite uses a matching resolve alias. The core package has `composite: true` for declaration emit.
