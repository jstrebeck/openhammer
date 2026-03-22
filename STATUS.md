# OpenHammer — Project Status

## Overview

OpenHammer is a browser-based digital tabletop for playing Warhammer 40K. Built as a monorepo with three packages:

- **`packages/core`** — Pure TypeScript game state engine. Zero DOM/Canvas dependencies. All game logic lives here.
- **`packages/client`** — React 18 + PixiJS 8 frontend. Zustand for state management. Tailwind CSS for UI chrome.
- **`packages/server`** — Express + `ws` WebSocket server for multiplayer rooms.

## Current State — Sprint F (Phases 21, 22, 23) Complete

Phases 1–6 (foundation), Sprint A (gameplay enforcement), Sprint B (command & morale), Sprint C (weapon & unit abilities), Sprint D (terrain & stratagems), Sprint E (transports, aircraft, mortal wounds), and Sprint F (rules fidelity — movement/combat validation, shooting rules completion, unit abilities & attached units) implemented. 328 tests passing across 18 test files.

### What's Built

**Core Engine:**
- Game state types: Board, Model (with full 10th Ed stat line), Unit (with weapons, keywords, abilities, points), Player (with command points), TerrainPiece, DeploymentZone, ObjectiveMarker
- Pure reducer with 40+ action types — all state mutations flow through serializable actions
- RulesEdition plugin interface with 10th Edition implementation (6 phases, coherency, engagement range, wound thresholds, shooting/charge eligibility)
- Edition registry with auto-registration on import
- Measurement utilities: edge-to-edge distance (Warhammer standard), coherency checking, models-in-range
- LoS raycasting: segment-polygon intersection, point-in-polygon, blocking/dense terrain detection
- Dice rolling: rollDice, countSuccesses, countFailures, sumDice
- **Combat module**: resolveAttackSequence (hit→wound pipeline), resolveSave (normal vs invuln), parseDiceExpression (D6/D3/2D6/D3+1), getWoundThreshold (all 5 S-vs-T brackets), getValidShootingTargets, isTargetInRange
- Army list importer: parses Battlescribe JSON exports directly (not a custom schema). Handles single-model characters, multi-model units with nested sub-selections. Flow layout places units within deployment zone bounds.
- Terrain templates: 8 presets (ruins, forests, crate stacks, barricades, hills)
- Game log: typed LogEntry union (phase changes, dice rolls, CP changes, messages)
- Networking protocol: ClientMessage/ServerMessage types for multiplayer
- Rules config: enforcement levels (off/warn/enforce) per rule category
- **Phase enforcement**: actions categorized (movement/shooting/charge/fight/setup/admin) and validated against PhaseActionMap; enforce mode blocks, warn mode logs, off mode allows all
- **Turn tracking**: TurnTracking state tracks unitMovement, advanceRolls, unitsActivated, unitsCompleted, chargedUnits per turn
- **Movement enforcement**: DECLARE_MOVEMENT + COMMIT_MOVEMENT with validateMovement checking distance limits, battlefield edge, engagement range, and unit coherency
- **Structured shooting**: DECLARE_SHOOTING → ASSIGN_WEAPON_TARGETS → RESOLVE_SHOOTING_ATTACK → RESOLVE_SAVE_ROLL → APPLY_DAMAGE → COMPLETE_SHOOTING, with AttackSequence tracking and shooting eligibility checks
- **Charge phase**: DECLARE_CHARGE → ROLL_CHARGE → COMMIT_CHARGE_MOVE/FAIL_CHARGE, with charge eligibility and Charge Bonus (Fights First via chargedUnits)
- **Fight phase**: INITIALIZE_FIGHT_PHASE → SELECT_UNIT_TO_FIGHT → PILE_IN → RESOLVE_MELEE_ATTACK → CONSOLIDATE → COMPLETE_FIGHT, with Fights First/Remaining steps, alternating selection, and re-scan for eligibility
- **Command phase**: START_COMMAND_PHASE auto-grants +1 CP to both players and clears battle-shocked status for active player's units
- **Battle-shock**: RESOLVE_BATTLE_SHOCK with 2D6 vs Leadership; failed units added to battleShocked array (OC becomes 0); clears at owning player's next Command Phase
- **Objective control**: CALCULATE_OBJECTIVE_CONTROL scans models within 3" of objectives, sums OC per player (battle-shocked = 0), assigns controller (tie = contested)
- **Scoring**: UPDATE_SCORE tracks VP per player with reason logging; score persists across the game
- **Weapon ability system**: `parseWeaponAbility()` parser, `AttackContext` for ability-aware resolution, `calculateAttacks()` with Blast/Rapid Fire, `resolveAttackSequence()` rewritten with Torrent, Heavy, Lethal Hits, Sustained Hits, Lance, Anti-KEYWORD, Devastating Wounds, Twin-linked, Melta, Conversion. `canUnitShootWithAbilities()` enables Assault weapons after Advancing.
- **Unit ability system**: `parseUnitAbility()` parser, `unitHasAbility()`/`getUnitAbilityValue()` helpers, `resolveFeelNoPain()` for FNP rolls
- **Terrain & Cover**: `determineCover()` checks wholly-within and LoS-through-terrain; `applyBenefitOfCover()` applies +1 save with correct restrictions (not for 3+ vs AP 0, respects Ignores Cover)
- **Stratagems**: All 11 core stratagems defined as `CORE_STRATAGEMS`; `USE_STRATAGEM` action with full validation (same-phase restriction, CP check, battle-shocked check, phase check); `StratagemPanel` client component with phase filtering and CP badges
- **Transports**: `EMBARK`/`DISEMBARK`/`RESOLVE_DESTROYED_TRANSPORT` actions with full validation (distance, capacity, keyword restrictions, same-phase restrictions). Transport capacity, firing deck, and keyword restrictions on `Unit` type. `embarkedUnits` map on GameState. Embarked models hidden from board via off-board position sentinel. `TransportPanel` client component with embark/disembark controls integrated into MovementPanel.
- **Aircraft & Reserves**: `SET_UNIT_IN_RESERVES`/`ARRIVE_FROM_RESERVES`/`AIRCRAFT_MOVE`/`AIRCRAFT_OFF_BOARD`/`SET_HOVER_MODE` actions. `reserves` map and `hoverModeUnits` on GameState. `isAircraftUnit()`, `validateAircraftMovement()`, `canChargeAircraft()`, `canFightAircraft()` helpers. Aircraft must move exactly 20" in a straight line; off-board aircraft enter Strategic Reserves. Only FLY units can charge/fight aircraft. Hover mode disables AIRCRAFT behavior.
- **Mortal wounds**: `APPLY_MORTAL_WOUNDS` action applies damage at unit level without saves, spilling across models (sorted by wounds remaining). No save rolls allowed.
- **Re-roll tracking**: `reRolled` flag on `DiceRoll`; `canReRoll()` utility prevents double re-rolls.
- **Roll-offs**: `ROLL_OFF` action and `rollOff()` utility — both players roll D6, highest wins, ties re-roll.
- **Surge moves**: `SURGE_MOVE` action — one per phase per unit, blocked when Battle-shocked or within Engagement Range. Resets per phase.
- **Movement & combat validation (Phase 21)**: FLY keyword movement (through enemies, FLY MONSTER/VEHICLE through friendly M/V). Path-based collision detection (`doesPathCrossModel()`). Charge move validation (distance ≤ roll, ER of all targets, no non-target ER). Pile-in validation (closer to enemy, max 3", coherency). Consolidate validation (enemy or objective direction). Melee target eligibility (ER or base-to-base chain). AIRCRAFT engagement range exemption.
- **Shooting rules completion (Phase 22)**: Big Guns Never Tire (MONSTER/VEHICLE shoot in ER, target only engaged). Pistols (fire in ER at engaged). Wound allocation enforcement (already-wounded first). Hazardous (`RESOLVE_HAZARDOUS`, D6 per model, destroy on 1). One Shot tracking (`weaponsFired` on GameState). Precision (CHARACTER targeting in attached units). Ignores Cover. Indirect Fire (-1 to Hit). Extra Attacks parsing.
- **Unit abilities & attached units (Phase 23)**: Deadly Demise (`RESOLVE_DEADLY_DEMISE`, MW to units within 6"). Deep Strike validation (>9" from enemies, Round 2+). Infiltrators validation (>9" from enemy zone/models). Scout moves (`SCOUT_MOVE`, pre-game move up to X"). Stealth detection. Leader attachment (`ATTACH_LEADER`/`DETACH_LEADER`, `attachedUnits` on GameState). Attached unit wound allocation (Bodyguard absorbs first, Precision overrides). Strategic Reserves validation (6" from edge, >9" from enemies, Round 2+).

**Client:**
- PixiJS 8 canvas with board grid, pan (middle-mouse), zoom (scroll wheel toward cursor)
- Model tokens: colored circles scaled to base size, selection ring, wound counter, movement range circle on drag
- Terrain: polygon rendering color-coded by trait, placement via templates or freehand draw, right-click editing
- Deployment zones: rendered as transparent overlays, 3 mission presets (Dawn of War, Hammer and Anvil, Search and Destroy)
- Objective markers: numbered rings with control range indicator, placeable via Objective tool
- LoS tool: click two models, green/red line with CLEAR/BLOCKED label, X at intersection point
- Ruler tool: click-to-click measurement with distance label in inches
- Aura overlay: 6" purple ring on single model selection
- Selection: click, shift-click, box select, drag-to-move with multi-model support
- Turn tracker: bottom bar with round number, active player, phase pills, Next Phase/Turn button
- Dice roller: collapsible panel, configurable dice count + threshold, color-coded results
- Quick roll: full attack sequence (to-hit -> to-wound -> save) with 10th Ed wound threshold calculation
- Command point tracker: per-player +/- buttons
- Game log: collapsible panel with color-coded entries
- Army list import: multi-step dialog (load JSON -> select deployment zone -> deploy within zone bounds)
- Unit sidebar: expandable unit details with per-model wound tracking (+/- buttons), stat lines, weapons, keywords
- Save/load: download/upload full game state as JSON
- Rules config panel: per-category Off/Warn/Enforce toggles
- Touch controls: single-finger pan, pinch-to-zoom, tap-to-select
- Dark/light theme toggle (persisted to localStorage)
- Keyboard shortcuts: V (select), P (place), T (terrain), M (measure), L (LoS), O (objective), Delete, Ctrl+Z/Y

**Server:**
- Express + ws WebSocket server on port 3001
- Room management: 6-char room codes, auto-cleanup empty rooms after 60s
- Player roles: player1, player2, spectator (auto-assigned)
- Server-authoritative state: actions applied via gameReducer before broadcasting
- Reconnection: name-based player reuse (no duplicate entries on reconnect), auto-reconnect after 3s
- Chat relay with system messages for connect/disconnect
- Client gameStore.dispatch auto-forwards actions to server when in a multiplayer room

**Multiplayer Client:**
- Module-level WebSocket singleton (survives React component unmounts)
- Game creation screen: Local/Online tab, Host Game / Join Game flows
- RoomInfo panel: persistent room code display (click to copy), connection status, disconnect button
- Chat panel: collapsible, only shown in multiplayer mode

## Architecture Notes

- **GameState is pure data** — no class instances, no functions. Everything serializable to JSON.
- **Rendering is read-only** — PixiJS reads game state via a ticker loop and draws. User interactions dispatch actions.
- **Actions are the only mutation path** — the gameReducer is a pure function. Same pattern for local and multiplayer.
- **Optimistic + authoritative** — in multiplayer, client applies actions locally for instant feedback, server sends back state snapshots for reconciliation.
- **Edition-pluggable** — the RulesEdition interface allows swapping rule sets without changing the engine. Only 10th Edition is implemented.
- **Army lists use Battlescribe JSON format** — no custom schema needed. The importer parses the nested `roster.forces[].selections[]` structure directly.

## Known Issues / Rough Edges

- **Model base sizes are inferred from keywords** (Vehicle->60mm, Infantry->32mm, etc.) because Battlescribe JSON doesn't include base size data. A lookup table or per-model override UI would improve accuracy. Tracked in ROADMAP.md.
- **Rules enforcement is config-only** — the Off/Warn/Enforce settings are stored but not yet wired to actually validate moves or show warnings on the canvas. The infrastructure is in place to add this.
- **Light theme is partial** — the toggle works and changes the layout background, but most UI panels are hardcoded to dark gray. Full light theme would need `dark:` variants on all components.
- **Quick roll doesn't handle dice expressions** — weapons with attacks like "D6" or damage like "D3+1" fall back to 1. Would need a dice expression parser.
- **No army list builder** — import only. Users need Battlescribe or similar to create their list.

## How to Run

```bash
make install          # Install dependencies
make dev              # Client dev server (localhost:5173)
make dev-server       # Server dev server (localhost:3001)
make dev-all          # Both in parallel
make test             # Run all 84 tests
make typecheck        # Type-check all 3 packages
make build            # Production build
```

## File Structure

```
packages/
  core/src/
    types/           — GameState, Model, Unit, Player, Board, terrain, geometry
    rules/           — RulesEdition interface, registry
    editions/        — 10th Edition implementation
    state/           — Actions, reducer, initial state
    measurement/     — Distance, coherency, range functions
    los/             — Line of sight raycasting
    dice/            — Dice rolling utilities
    army-list/       — Battlescribe JSON parser, validator, importer
    terrain/         — Terrain templates
    networking/      — Protocol types (ClientMessage, ServerMessage)
  client/src/
    canvas/          — PixiJS layers (Board, ModelLayer, TerrainLayer, DeploymentZoneLayer, ObjectiveLayer, overlays, tools)
    components/      — React UI (GameCreation, GameLayout, ToolBar, UnitListSidebar, all panels/dialogs)
    store/           — Zustand stores (gameStore with undo/redo, uiStore)
    networking/      — useMultiplayer hook + WebSocket singleton
    hooks/           — Keyboard shortcuts
  server/src/
    index.ts         — Express + WebSocket server entry
    rooms.ts         — Room management, action handling, broadcast
```
