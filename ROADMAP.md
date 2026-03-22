# OpenHammer Roadmap

## Phase 1: Digital Tabletop Foundation

Build a functional board where you can place and move model tokens with measurement tools.

- [x] Set up monorepo workspace structure (`packages/core`, `packages/client`, `packages/server`)
  - npm workspaces with `@openhammer/core`, `@openhammer/client`, `@openhammer/server`
  - Server has minimal Express skeleton with health endpoint
- [x] Configure TypeScript (strict mode), Vite, Vitest, Tailwind CSS
  - Shared `tsconfig.base.json` with strict mode, ES2022 target, bundler module resolution
  - Client uses Vite resolve aliases to import core source directly (no build step needed)
  - Tailwind v3 configured in client only; Vitest workspace runs core + client tests
- [x] Set up the `RulesEdition` interface and edition registry in `packages/core`
  - `RulesEdition` interface at `core/src/rules/RulesEdition.ts` with phase management, movement, coherency, engagement range methods
  - Registry at `core/src/rules/registry.ts` — simple Map-based register/get/list
- [x] Implement the 10th Edition skeleton (phase list, basic movement rules)
  - `core/src/editions/wh40k10th.ts` — 6 phases (command through morale), 1" engagement range, 2" coherency, 2-neighbor coherency for 6+ model units
  - Auto-registers via side-effect import from `core/src/editions/index.ts`
- [x] Edition selection on game creation (defaults to 10th Edition)
  - `GameCreation` component with edition dropdown, board size inputs, defaults to 60x44
- [x] Define core game state types (`GameState`, `Board`, `Model`, `Unit`, `TurnState`, `Action`)
  - `core/src/types/` — geometry (Point, Circle, Rect) and game types (GameState, Model, Unit, Player, TurnState)
  - Models track baseSizeMm + pre-computed baseSizeInches, wounds/maxWounds, moveCharacteristic, status
- [x] Implement action/dispatch state engine (pure reducer, serializable actions)
  - 12 action types: PLACE_MODEL, REMOVE_MODEL, MOVE_MODEL, SET_MODEL_WOUNDS, ROTATE_MODEL, ADD_UNIT, REMOVE_UNIT, ADD_PLAYER, ADVANCE_PHASE, NEXT_TURN, SET_BOARD_SIZE, SET_EDITION
  - Pure immutable reducer with cascading cleanup (removing last model in unit removes the unit)
  - 14 unit tests covering all actions + immutability + edge cases
- [x] Implement measurement utilities (distance, `distanceBetweenModels`, `isWithin`, `modelsInRange`)
  - Edge-to-edge distance (Warhammer standard), coherency checking with configurable range + minNeighbors
  - 12 unit tests covering geometry, base sizes, coherency pass/fail scenarios
- [x] PixiJS canvas with a 44"x60" board (configurable)
  - PixiJS 8 Application initialized async in React useEffect; 20px/inch scale factor
  - Board grid with minor (1") and major (6") lines; board auto-centered in viewport
- [x] Place circular model tokens on the board via click
  - Place tool creates 32mm base models at click position; tokens rendered as colored circles scaled to base size
- [x] Select models (click) and multi-select (box select or shift-click)
  - Click to select, shift-click to toggle, drag on empty space for box select
  - Selection ring highlight on selected models; selection state in Zustand UIStore
- [x] Drag models to move them with real-time position display
  - Optimistic visual drag (direct PixiJS token movement), dispatch on mouseup
  - Multi-model drag maintains relative offsets; positions clamped to board bounds
- [x] Movement range circle displayed while dragging (configurable radius)
  - Blue semi-transparent circle shown at drag origin using model's moveCharacteristic
- [x] Ruler/measurement tool: click two points to see distance in inches
  - Click-to-start, click-to-end ruler with distance label; uses core `distance()` function
- [x] Pan and zoom camera controls
  - Middle-mouse drag to pan; scroll wheel to zoom (0.25x–3x) toward cursor position
- [x] Undo/redo (action history)
  - Zustand gameStore with past/future stacks (max 200 entries); Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y shortcuts
- [x] Right-click context menu on models (remove, set wounds, etc.)
  - React component positioned at click coords; remove model, set wounds with inline number input
  - Click-outside to dismiss; wound values clamped and model auto-destroyed at 0
- [x] Basic UI panel: unit list sidebar, tool selection bar
  - Left sidebar: turn info (round + current phase), unit list with model counts, unattached models, selection info
  - Top toolbar: Select/Place/Measure buttons with active state, Undo/Redo buttons
  - Keyboard shortcuts: V/P/M for tools, Delete/Backspace to remove selected, Escape to deselect

## Phase 2: Terrain & Line of Sight

- [x] Place terrain as polygonal shapes with editable vertices
  - Two placement modes: Template (select preset, click to place) and Draw (click vertices, finish to close polygon)
  - `TerrainPiece` type with polygon vertices, height, traits, label stored in `GameState.terrain`
  - Terrain rendering via `TerrainLayer` with color-coded fills by trait (purple=obscuring, green=dense, amber=defensible)
  - Terrain selection via click; selected terrain shows yellow highlight outline
  - Right-click context menu on terrain for editing traits/height and removal
  - `TerrainPlacementPreview` shows the polygon being drawn in real-time
- [x] Assign terrain traits (obscuring, dense, breachable, defensible, etc.)
  - 6 traits: obscuring, dense, breachable, defensible, unstable, smoke
  - Toggle traits via right-click context menu with checkbox-style UI
  - `TERRAIN_TRAIT_DESCRIPTIONS` provides tooltip text for each trait
- [x] Terrain height metadata
  - Stored as `height` (inches) on `TerrainPiece`; displayed below terrain label on canvas
  - Editable via right-click context menu with number input
- [x] Implement LoS raycasting in `packages/core/src/los/`
  - Segment-polygon intersection using cross-product orientation method
  - `pointInPolygon` via ray-casting algorithm
  - `checkLineOfSight` returns `LoSResult` with clear/blocked status, blocking terrain IDs, dense terrain IDs, and first intersection point
  - Obscuring terrain fully blocks LoS; dense terrain is reported for hit penalty without blocking
  - 15 unit tests covering segment intersection, point-in-polygon, and full LoS scenarios
- [x] LoS tool: select two models, draw a line, check if terrain blocks it
  - LoS tool (L key): click first model (source), click second model (target) to check
  - First click highlights the source model; second click runs the check
- [x] LoS visualization (clear/blocked indicator with ray drawn on canvas)
  - Green line = clear, red line = blocked
  - "CLEAR" / "BLOCKED" label at midpoint; "(Dense)" appended when dense terrain is in the path
  - Red X marker drawn at the first intersection point when blocked
  - Endpoint circles on both models
- [x] Terrain templates: common shapes (ruins rectangle, forest oval, etc.)
  - 8 templates: Ruins (Small/Large/L-Shaped), Forest (Small/Large), Crate Stack, Barricade, Hill
  - Each template defines polygon, height, and default traits
  - `offsetPolygon` utility to place template at click position
  - Template selector panel on right side when Terrain tool is active

## Phase 3: Unit Management & Army Lists

- [x] Define unit profiles with stats (M, T, Sv, W, Ld, OC, etc.)
  - `ModelStats` interface: move, toughness, save, wounds, leadership, objectiveControl, optional invulnSave
  - `stats` field added to `Model` type; all test helpers and client code updated
- [x] Define weapon profiles with stats (A, BS/WS, S, AP, D) and abilities
  - `Weapon` interface: name, type (melee/ranged), range, attacks, skill, strength, ap, damage, abilities[]
  - Weapons stored on `Unit` (shared across the unit's models, matching 10th Ed datasheet structure)
- [x] Implement OpenHammer JSON army list schema and validation
  - `OpenHammerArmyList` schema with schemaVersion, editionId, armyName, faction, units, editionData
  - `validateArmyList()` validates all fields recursively: required strings, edition existence, model stats, weapon types
  - Returns structured `ArmyListValidationError[]` with JSON paths for precise error feedback
  - 10 validation tests covering valid lists, missing fields, bad editions, invalid models/weapons
- [x] Build army list importer (validate, transform, hydrate into game state)
  - `importArmyList()` takes validated army list + player ID, creates Units and Models in GameState
  - Models placed in a 2" spaced grid from a configurable start position (staging area)
  - Weapons mapped to `Weapon` type with auto-generated IDs; keywords and abilities preserved
  - 5 importer tests covering unit/model creation, stat correctness, grid placement, immutability
- [x] Build JSON file/paste import UI flow with validation and error feedback
  - `ImportArmyDialog` modal: file upload (.json) or paste JSON text
  - Real-time validation error display with per-field paths highlighted
  - Success message on import; auto-creates player with color assignment
  - Accessible from "Import Army List" button in the unit sidebar
- [x] Deploy units as groups: placing a unit places all its models in coherency
  - Importer places all models in a compact grid layout within the staging area
  - Models are grouped by unit with proper unitId linkage
- [x] Unit coherency checking (2" between models, special rules for 6+ model units)
  - `checkCoherency()` in measurement module with configurable range and minNeighbors
  - 10th Edition: 2" range, 1 neighbor for <6 models, 2 neighbors for 6+ models
  - Already implemented and tested in Phase 1; wired through edition interface
- [x] Wound tracking per model with automatic model removal at 0 wounds
  - Sidebar shows per-model wound counters with +/- buttons when unit is expanded
  - Reducer clamps wounds to [0, maxWounds] and auto-sets status to 'destroyed' at 0
  - Destroyed models are filtered from canvas rendering and sidebar display
  - Full stat line (M/T/Sv/W/Ld/OC), weapons, and keywords shown in expanded unit view
- [ ] (Stretch) Implement converter architecture for external formats → **moved to Phase 29**
- [ ] (Stretch) Add first external converter (Battlescribe .rosz -> OpenHammer JSON) → **moved to Phase 29**
- [ ] Improve model base size accuracy → **moved to Phase 29**

## Phase 4: Turn Structure & Dice

- [x] Turn tracker UI: round number, active player, current phase
  - Bottom-center bar showing round number, active player (name + color dot), phase sequence
  - Phase pills highlight current phase (blue), completed phases (dimmed), upcoming phases (gray)
- [x] Phase advancement with visual indicator
  - "Next Phase" button advances through phases; becomes "Next Turn" on the last phase
  - NEXT_TURN cycles through players and increments round number when the last player finishes
  - Phase changes and turn changes are logged to the game log
- [x] Wire up 10th Edition phase sequence (command, movement, shooting, charge, fight, morale)
  - 6 phases displayed in order from the 10th Edition definition; auto-sets first active player
- [x] Built-in dice roller with configurable dice pools
  - Collapsible panel (bottom-right): configurable dice count (1-50) and threshold (2+-6+)
  - Quick-select purpose buttons: To Hit, To Wound, Save, Damage, Battleshock
  - `rollDice()`, `countSuccesses()`, `countFailures()`, `sumDice()` in `core/dice/`
  - 7 dice tests covering roll ranges, success/failure counting, summing
- [x] Dice roll results displayed prominently with hit/wound/save thresholds
  - Individual dice shown as colored squares: green for pass, red for fail
  - Summary line: X pass / Y fail
  - All rolls logged to game log with full results
- [x] Command point tracker per player
  - Top-right panel: per-player CP display with +/- buttons
  - `commandPoints` field on Player type; `SET_COMMAND_POINTS` action with clamping
  - CP changes logged with old/new values and reason
- [x] Battle round summary / log panel
  - Collapsible "Game Log" panel showing phase changes, dice rolls, CP changes
  - Color-coded entries: blue for phase changes, yellow for dice, purple for CP
  - Auto-scrolls to latest entry; `GameLog` type with `LogEntry` union in core types

## Phase 5: Multiplayer

- [x] WebSocket server for game rooms (`packages/server`)
  - Express + `ws` WebSocket server on port 3001
  - `rooms.ts`: room management with `createRoom`, `joinRoom`, `handleDisconnect`, `handleAction`, `broadcast`
  - Rooms keyed by 6-character alphanumeric code; auto-cleanup after 60s when empty
  - Server applies actions via `gameReducer` (authoritative state) before broadcasting
- [x] Create room -> get shareable link
  - Host creates room and receives a 6-char room code (e.g. `ABC123`)
  - Game creation screen has Local/Online tab switcher; Online tab shows Host Game / Join Game options
- [x] Join room -> sync full game state on connect
  - Joining client sends room code + player name; receives full `STATE_SNAPSHOT` on connect
  - Server adds player to game state with auto-assigned color
- [x] Real-time action broadcasting (one player acts, other sees it live)
  - Client dispatches actions locally and sends to server via `DISPATCH_ACTION` message
  - Server validates, applies to authoritative state, broadcasts `ACTION_BROADCAST` to other clients
  - Dispatching client receives `STATE_SNAPSHOT` for reconciliation
- [x] Player role assignment (Player 1, Player 2, Spectator)
  - First player → player1, second → player2, subsequent → spectator
  - Spectators receive all state updates and chat but cannot dispatch actions
  - Role shown in lobby and system chat messages
- [x] Optimistic updates with host-authoritative reconciliation
  - Client applies actions locally for instant feedback, server sends back authoritative state snapshot
  - On `STATE_SNAPSHOT`, client replaces game state entirely (server wins on conflict)
- [x] Reconnection handling with state catch-up
  - Auto-reconnect after 3 seconds on disconnect; rejoins last known room
  - On rejoin, full state snapshot is sent to catch up; connection status indicator in lobby
  - System messages notify all players of connect/disconnect events
- [x] Chat panel for in-game communication
  - Collapsible chat panel (only visible in multiplayer); text input + send button
  - Messages broadcast to all clients in the room including sender (echo)
  - System messages for player join/disconnect events
  - 100-message rolling buffer in client store

## Phase 6: Quality of Life

- [x] Save/load game state to JSON files
  - Save button downloads full GameState as timestamped JSON file
  - Load button reads a JSON file, validates top-level structure, and replaces game state
  - Both accessible from the toolbar (Save / Load buttons)
- [x] Deployment zone overlays (configurable by mission)
  - `DeploymentZone` type with polygon, playerId, label, color stored in GameState
  - `DeploymentZoneLayer` renders zones as transparent colored polygons with labels
  - 3 mission presets: Dawn of War (long edges), Hammer and Anvil (short edges), Search and Destroy (diagonal quarters)
  - Preset selector in the unit sidebar; Clear Zones button
- [x] Objective markers (placeable, numbered)
  - `ObjectiveMarker` type with position, number, optional label and controllingPlayerId
  - `ObjectiveLayer` renders markers as numbered rings with 1.5" control range indicator
  - Objective tool (O key): click board to place auto-numbered objectives
  - Marker color changes to controlling player's color when assigned
- [x] Aura range visualization (select model, show X" aura ring)
  - `AuraOverlay` shows a purple 6" aura ring when a single model is selected (select tool)
  - Ring with label disappears when selection changes or is cleared
- [x] Quick-roll sequences: select attacking unit -> select target -> auto-roll to-hit -> to-wound -> saves
  - Collapsible Quick Roll panel appears when a unit with weapons is selected
  - Select weapon from unit's weapon list, pick target from enemy units dropdown
  - "Roll Attack Sequence" button runs full to-hit → to-wound → save chain
  - 10th Ed wound threshold calculation (S vs T: 2x=2+, greater=3+, equal=4+, less=5+, half=6+)
  - Each step shows individual dice as green/red squares with success count
  - Damage summary calculated from unsaved wounds × damage characteristic
  - All rolls logged to the game log
- [x] Rules enforcement levels (off / warn / enforce) per rule category
  - `RulesConfig` type with coherency, movementRange, phaseRestrictions, lineOfSight fields
  - `EnforcementLevel` type: 'off' | 'warn' | 'enforce'; defaults to warn for coherency/movement, off for others
  - Collapsible "Rules" panel with per-category toggle buttons (Off / Warn / Enforce)
  - `SET_RULES_CONFIG` action; config stored in GameState and synced in multiplayer
- [x] Mobile-responsive touch controls
  - Single-finger drag to pan the board
  - Two-finger pinch to zoom (0.25x–3x)
  - Tap to select models (10px movement threshold to distinguish from drag)
  - `touch-none` CSS to prevent browser gesture interference
- [x] Dark/light theme
  - Theme toggle button in toolbar (Dark/Light label)
  - Tailwind `darkMode: 'class'` with `dark:` variants on layout background
  - Preference persisted in `localStorage` and applied on page load via `<html class="dark">`

---

## Phase 7: Phase Enforcement & Turn Structure

**Goal:** Actions are restricted to the correct game phase. The foundation everything else builds on.

### Core Engine (`packages/core`)

- [x] Add per-turn tracking state to `GameState`:
  - `TurnTracking` with `unitMovement`, `advanceRolls`, `unitsActivated`, `unitsCompleted`, `chargedUnits`
  - Factory function `createEmptyTurnTracking()` for initialization and resets
- [x] Add `ShootingState`, `ChargeState`, `FightState` tracking objects to `GameState`
  - Each with factory function (`createEmptyShootingState()`, etc.)
- [x] Add phase validation to `gameReducer`:
  - `getActionCategory()` maps every action type to a category (movement/shooting/charge/fight/setup/admin)
  - `isActionAllowedInPhase()` checks category against `PhaseActionMap` from edition
  - `MOVE_MODEL`/`ROTATE_MODEL` only allowed during Movement Phase
  - Shooting/charge/fight actions restricted to their respective phases
- [x] Reset per-turn tracking state on `NEXT_TURN` and `ADVANCE_PHASE` as appropriate
  - `NEXT_TURN` resets all tracking (turnTracking, shootingState, chargeState, fightState)
  - `ADVANCE_PHASE` resets per-phase activation but preserves per-turn data (unitMovement, chargedUnits)
- [x] Update `RulesEdition` interface with `getPhaseActionMap()`, `getWoundThreshold()`, `canUnitShoot()`, `canUnitCharge()`
- [x] Implement in `wh40k10th.ts` — `PhaseActionMap` maps each phase to allowed action categories
- [x] When `rulesConfig.phaseRestrictions` is `'enforce'`, reducer rejects invalid actions with [BLOCKED] log; when `'warn'`, allows but logs [WARNING]
- [x] Add `ACTIVATE_UNIT` action — marks a unit as activated this phase
- [x] Add `COMPLETE_UNIT_ACTIVATION` action — marks unit as done for this phase

### Client (`packages/client`)

- [x] `PhaseActionPanel` — context-sensitive panel that renders the correct sub-panel based on current phase
  - Shows only during movement/shooting/charge/fight phases
  - Positioned right-center, collapsible, color-coded border per phase
- [ ] Disable UI controls based on current phase → **moved to Phase 28**
- [ ] Show visual feedback when an action is blocked → **moved to Phase 28**
- [ ] Phase-specific toolbar: show only relevant tools per phase → **moved to Phase 28**

### Tests

- [x] Phase restriction: MOVE_MODEL rejected outside Movement Phase when enforcement is on
- [x] Phase restriction: warn mode logs but allows
- [x] Phase restriction: off mode allows everything (backwards compatible)
- [x] MOVE_MODEL allowed during Movement Phase with enforcement on
- [x] Turn reset clears all per-turn tracking state
- [x] ADVANCE_PHASE preserves per-turn data but resets per-phase
- [x] Unit activation tracking works correctly

### Rules Checklist Coverage
- 1.5 Sequencing (partial — active player ordering)

---

## Phase 8: Movement Enforcement

**Goal:** Models can only move their allowed distance. Movement types (Normal, Advance, Fall Back) are enforced with all their restrictions.

### Core Engine

- [x] New action: `DECLARE_MOVEMENT` — `{ unitId, moveType }` — records move type, activates unit, logs the declaration
- [x] New action: `COMMIT_MOVEMENT` — `{ unitId, positions: Record<string, Point> }` — atomic position update with full validation
- [x] New action: `ROLL_ADVANCE` — `{ unitId, roll }` — stores advance roll bonus in `turnTracking.advanceRolls`
- [x] Movement budget tracking:
  - Normal/Fall Back: each model gets `M` inches
  - Advance: each model gets `M + advance roll` inches
- [x] `validateMovement()` function checks:
  - Total distance per model ≤ allowed distance (with floating-point epsilon)
  - No model crosses battlefield edge (checks base radius against board bounds)
  - After Normal/Advance: no model ends within Engagement Range of enemies (1")
  - Unit coherency maintained after move (builds virtual model positions for coherency check)
- [x] Movement restriction flags:
  - Advanced → `canUnitShoot()` returns false, `canUnitCharge()` returns false
  - Fell Back → `canUnitShoot()` returns false, `canUnitCharge()` returns false
  - Stationary → tracked for Heavy weapon bonus
- [ ] FLY keyword: FLY models can move through enemy models → **moved to Phase 21**
- [ ] Path-based movement validation (no moving through enemy models) → **moved to Phase 21**

### Client

- [x] `MovementPanel` — Movement declaration UI with Normal/Advance/Fall Back/Stationary buttons
  - Shows move characteristic per model, grid layout of move type buttons
  - Auto-rolls D6 for Advance, displays advance bonus
  - "Commit Movement" button to finalize positions
  - Shows completed state after movement is committed
- [ ] Movement range visualization → **moved to Phase 27**
- [ ] Engagement range warning → **moved to Phase 27**
- [ ] Coherency warning → **moved to Phase 27**
- [ ] "Undo movement" button → **moved to Phase 27**
- [ ] Movement path line → **moved to Phase 27**

### Tests

- [x] DECLARE_MOVEMENT records move type and activates unit
- [x] ROLL_ADVANCE stores the advance bonus
- [x] COMMIT_MOVEMENT applies positions and marks unit completed
- [x] Normal move: model cannot exceed M characteristic (enforcement blocks)
- [x] Movement within M characteristic allowed
- [x] Engagement range: normal move cannot end within 1" of enemy (enforcement blocks)
- [x] Battlefield edge: model cannot cross edge (enforcement blocks)
- [x] Coherency: move rejected if unit loses coherency (enforcement blocks)
- [x] Movement flags set correctly (advanced, stationary)

### Rules Checklist Coverage
- 3.1 General Movement Rules
- 3.2 Remain Stationary
- 3.3 Normal Move
- 3.4 Advance Move
- 3.5 Fall Back Move (partial — no Desperate Escape yet)
- 3.8 Flying (partial)
- 1.2 Engagement Range
- 1.3 Unit Coherency

---

## Phase 9: Structured Shooting

**Goal:** Full attack sequence UI and logic — select attackers, select targets, auto-calculate dice, resolve hits/wounds/saves/damage. This is the "shooting box" that replaces manual dice rolling.

### Core Engine

- [x] New action: `DECLARE_SHOOTING` — activates unit for shooting, checks eligibility vs movement type
- [x] New action: `ASSIGN_WEAPON_TARGETS` — stores weapon-to-target assignments
- [x] New action: `RESOLVE_SHOOTING_ATTACK` — records hit roll + wound roll results as `AttackSequence`
- [x] New action: `RESOLVE_SAVE_ROLL` — resolves save, chains into APPLY_DAMAGE if failed
- [x] New action: `APPLY_DAMAGE` — reduces wounds, auto-destroys at 0, logs damage
- [x] New action: `COMPLETE_SHOOTING` — moves unit to unitsShot, clears active state
- [x] `AttackSequence` type with full attack tracking (id, units, weapon, hits, wounds, allocations)
- [x] `ShootingState` on `GameState` with `activeShootingUnit`, `weaponAssignments`, `activeAttacks`, `unitsShot`
- [x] Shooting eligibility: blocks units that Advanced or Fell Back (via `canUnitShoot()` in edition)
- [x] Wound threshold calculation: `getWoundThreshold(S, T)` — all 5 brackets (2+/3+/4+/5+/6+)
- [x] `resolveAttackSequence()` — full hit → wound pipeline with critical hit/wound handling
- [x] `resolveSave()` — uses better of normal save (with AP) and invulnerable save
- [x] `parseDiceExpression()` — handles "D6", "D3", "D3+1", "2D6", plain numbers
- [x] `getValidShootingTargets()` — finds enemy units in range of any weapon
- [x] `isTargetInRange()` — checks edge-to-edge distance vs weapon range
- [x] Combat utilities module: `packages/core/src/combat/index.ts`
- [ ] Engagement Range shooting restrictions (Big Guns Never Tire, Pistols) → **moved to Phase 22**
- [ ] Wound allocation enforcement (must allocate to already-wounded model) → **moved to Phase 22**

### Client

- [x] **ShootingPanel** — structured shooting box with full attack sequence:
  - Declare Shooting / Skip Shooting buttons
  - Weapon selection with full stat line (range, A, BS, S, AP, D, abilities)
  - Target unit dropdown filtered to enemy units with active models
  - "Roll Attack Sequence" resolves: hit roll → wound roll → saves → damage in one action
  - Color-coded dice results: green=pass, red=fail, gold=critical 6
  - Per-weapon breakdown showing hits/wounds/saves/damage
  - Total damage summary
  - Movement restriction display (can't shoot after Advance/Fall Back)
  - "Done" button to complete and move to next unit
- [ ] Range circles: show weapon range when assigning targets → **moved to Phase 27**
- [ ] LoS integration: grey out non-visible target units → **moved to Phase 27**

### Tests

- [x] DECLARE_SHOOTING sets active unit and activates it
- [x] DECLARE_SHOOTING blocks advanced units (enforcement on)
- [x] DECLARE_SHOOTING blocks fell-back units (enforcement on)
- [x] DECLARE_SHOOTING allows normal-move units (enforcement on)
- [x] ASSIGN_WEAPON_TARGETS stores assignments
- [x] RESOLVE_SHOOTING_ATTACK creates attack sequence with hit/wound data
- [x] APPLY_DAMAGE reduces wounds and destroys at 0
- [x] APPLY_DAMAGE: no effect on already-destroyed models
- [x] COMPLETE_SHOOTING clears state and records completion
- [x] Full integration: declare → assign → resolve → save → damage
- [x] Wound threshold for all 5 S vs T brackets
- [x] parseDiceExpression handles D6, D3, D3+1, 2D6, plain numbers
- [x] resolveAttackSequence returns correct structure
- [x] resolveSave uses better of normal and invuln save

### Rules Checklist Coverage
- 5.1 Eligibility
- 5.2 Big Guns Never Tire
- 5.3 Pistols
- 5.4 Target Selection
- 5.5 Making Ranged Attacks (full attack sequence)
- 1.4 Dice rules (re-rolls, modifiers, criticals)

---

## Phase 10: Charge Phase

**Goal:** Declare charges, roll charge distance, move charging units, apply Charge Bonus.

### Core Engine

- [x] New action: `DECLARE_CHARGE` — records targets, activates unit, checks eligibility, logs declaration
- [x] Charge eligibility: `canUnitCharge()` blocks units that Advanced or Fell Back
- [x] New action: `ROLL_CHARGE` — stores 2D6 total in `chargeState.chargeRolls`
- [x] New action: `COMMIT_CHARGE_MOVE` — applies positions, records successful charge, grants Fights First via `chargedUnits`
- [x] New action: `FAIL_CHARGE` — marks unit completed without moving, logs failure
- [x] Charge Bonus: successful chargers added to `turnTracking.chargedUnits` (used by fight phase for Fights First)
- [x] `ChargeState` on `GameState`: `{ declaredCharges, chargeRolls, successfulCharges }`
- [ ] Charge move validation → **moved to Phase 21**
- [ ] FLY models can move over other models when charging → **moved to Phase 21**

### Client

- [x] **ChargePanel** — full charge workflow:
  - Shows eligible enemy units within 12" with distances
  - Multi-target selection (click to toggle)
  - "Declare Charge" button with target count
  - "Roll Charge (2D6)" button with large roll result display
  - "Commit Charge" / "Charge Failed" buttons after rolling
  - Movement restriction display (can't charge after Advance/Fall Back)
  - Completed state shows "Gains Fights First" for successful charges
- [ ] Visual indicator on units that successfully charged → **moved to Phase 27**

### Tests

- [x] DECLARE_CHARGE records targets and activates unit
- [x] DECLARE_CHARGE blocks advanced units (enforcement on)
- [x] DECLARE_CHARGE blocks fell-back units (enforcement on)
- [x] ROLL_CHARGE stores the charge roll total
- [x] COMMIT_CHARGE_MOVE applies positions and records successful charge
- [x] Charge Bonus: chargedUnits tracked for Fights First
- [x] FAIL_CHARGE marks unit as completed without moving

### Rules Checklist Coverage
- 6.1 Declare Charge
- 6.2 Charge Roll
- 6.3 Charge Move

---

## Phase 11: Fight Phase

**Goal:** Alternating fight order, Pile In, melee attacks, Consolidate.

### Core Engine

- [x] `INITIALIZE_FIGHT_PHASE` — scans all units, finds those in engagement range, separates Fights First from remaining
- [x] Fight order:
  - **Fights First step**: units in `chargedUnits` (Charge Bonus) fight first
  - **Remaining Combats**: all other eligible units
  - Non-active player selects first (`nextToSelect`), then alternate
- [x] New action: `SELECT_UNIT_TO_FIGHT` — sets `currentFighter`, removes from eligible, alternates selector
- [x] New action: `PILE_IN` — applies positions (up to 3")
- [x] New action: `RESOLVE_MELEE_ATTACK` — same as shooting attack but tracked in `fightState.activeAttacks`
- [x] New action: `CONSOLIDATE` — applies positions (up to 3")
- [x] New action: `COMPLETE_FIGHT` — moves unit to `unitsFought`, transitions fights_first → remaining when exhausted
- [x] `FightState` on `GameState`: `{ fightStep, eligibleUnits, currentFighter, unitsFought, nextToSelect, activeAttacks }`
- [x] After fights_first exhausted, re-scans for remaining eligible units in engagement range
- [ ] Pile In validation → **moved to Phase 21**
- [ ] Consolidate validation → **moved to Phase 21**
- [ ] Melee target eligibility → **moved to Phase 21**

### Client

- [x] **FightPanel** — full fight phase workflow:
  - "Initialize Fight Phase" button to scan for eligible units
  - Fights First / Remaining Combats step display
  - Player turn indicator with color dot
  - Eligible unit list with player colors, click to select fighter
  - Pile In step: confirm or skip
  - Melee weapon selection with full stat line
  - Target selection dropdown
  - "Roll Melee Attacks" with full dice results display
  - Consolidate step: confirm or skip
  - "All combats resolved" state
- [ ] Visual indicators for fought/eligible units → **moved to Phase 27**

### Tests

- [x] INITIALIZE_FIGHT_PHASE finds eligible units in engagement range
- [x] Fights First: charged units fight before others
- [x] Non-active player selects first
- [x] SELECT_UNIT_TO_FIGHT sets current fighter and alternates selector
- [x] PILE_IN moves models
- [x] RESOLVE_MELEE_ATTACK creates attack sequence
- [x] CONSOLIDATE moves models
- [x] COMPLETE_FIGHT moves unit to unitsFought and clears active attacks
- [x] Transitions from fights_first to remaining when exhausted

### Rules Checklist Coverage
- 7.1 Fight Order
- 7.2 Pile In
- 7.3 Select Melee Targets
- 7.4 Make Melee Attacks
- 7.5 Consolidate

---

## Phase 12: Command Phase & Battle-shock

**Goal:** Structured Command Phase with CP gain and Battle-shock tests.

### Core Engine

- [x] `START_COMMAND_PHASE` action: both players gain 1 CP, clears battle-shocked status for active player's units
- [x] Battle-shock tests:
  - Below Half-strength: multi-model = fewer than half Starting Strength; single model = wounds < half max
  - Added `startingStrength` to Unit type
  - `RESOLVE_BATTLE_SHOCK` action with roll and passed flag
  - Failed → added to `battleShocked` array until next Command Phase
- [x] `battleShocked: string[]` on `GameState` — persists across phases and turns, cleared by `START_COMMAND_PHASE`
- [x] `score: Record<string, number>` on `GameState` for VP tracking
- [ ] Max 1 additional CP per battle round → **moved to Phase 25**
- [ ] Battle-shocked: cannot use Stratagems, Fall Back triggers Desperate Escape → **moved to Phase 25**

### Client

- [x] `CommandPhasePanel` — integrated into PhaseActionPanel for Command Phase:
  - "Start Command Phase" button grants +1 CP to both players
  - CP display for all players with color indicators
  - Lists units below half strength needing Battle-shock tests
  - "Roll Battle-shock (2D6 vs Ld X+)" button per unit
  - Battle-shocked units list with OC=0 indicator
  - Victory Points display
- [ ] Battle-shocked visual on model tokens → **moved to Phase 25**

### Tests

- [x] Both players gain 1 CP
- [x] CP gain logged for each player
- [x] Battle-shocked clears for active player's units on START_COMMAND_PHASE
- [x] Below Half-strength detection (multi-model and single model)
- [x] Battle-shock pass when 2D6 >= Leadership
- [x] Battle-shock fail → unit becomes battle-shocked
- [x] No duplicate IDs in battleShocked array
- [x] Battle-shocked persists across phases
- [x] Battle-shocked persists across NEXT_TURN (cleared by START_COMMAND_PHASE only)

### Rules Checklist Coverage
- 2.1 Gain Command Points
- 2.2 Battle-shock Tests

---

## Phase 13: Weapon Abilities

**Goal:** Implement universal weapon special rules that modify the attack sequence.

### Core Engine

- [x] `parseWeaponAbility()` — extracts name, value, and keyword from strings like "SUSTAINED HITS 1", "ANTI-INFANTRY 4+", "MELTA 2"
- [x] `parseWeaponAbilities()` — parses all abilities on a weapon
- [x] `weaponHasAbility()` — checks if a weapon has a specific ability
- [x] `AttackContext` type — carries all info needed for ability-aware resolution (weapon, distance, target size, keywords, movement status)
- [x] `calculateAttacks()` — applies Blast (+1 per 5 models) and Rapid Fire X (+X within half range)
- [x] `resolveAttackSequence()` rewritten as ability-aware pipeline:
  - **Torrent**: auto-hit (no hit roll)
  - **Heavy**: +1 to Hit if stationary
  - **Conversion X**: critical hit on 4+ if target > X" away
  - **Lethal Hits**: critical hit auto-wounds (skips wound roll)
  - **Sustained Hits X**: critical hit scores X extra hits
  - **Lance**: +1 to Wound if charged
  - **Anti-KEYWORD X+**: critical wound on X+ vs matching keyword
  - **Devastating Wounds**: critical wound → mortal wounds
  - **Twin-linked**: re-roll failed wound rolls
  - **Melta X**: +X damage within half range
- [x] `canUnitShootWithAbilities()` — Assault weapons can fire after Advancing
- [x] Returns `triggeredAbilities: string[]` for UI display
- [ ] **Hazardous** → **moved to Phase 22**
- [ ] **One Shot** → **moved to Phase 22**
- [ ] **Pistol** → **moved to Phase 22**
- [ ] **Precision** → **moved to Phase 22**
- [ ] **Ignores Cover** → **moved to Phase 22**
- [ ] **Indirect Fire** → **moved to Phase 22**
- [ ] **Extra Attacks** → **moved to Phase 22**

### Client

- [ ] Weapon ability tags/badges in shooting panel → **moved to Phase 22**
- [ ] Highlight when abilities trigger → **moved to Phase 22**
- [ ] Half-range indicator for Rapid Fire/Melta → **moved to Phase 22**
- [ ] Hazardous resolution prompt → **moved to Phase 22**

### Tests

- [x] Weapon ability parser: simple, with value, ANTI-KEYWORD, CONVERSION
- [x] parseWeaponAbilities parses all abilities on a weapon
- [x] weaponHasAbility checks correctly
- [x] Blast: +1 attack per 5 models, no bonus under 5
- [x] Rapid Fire: +X within half range, no bonus outside
- [x] Torrent: auto-hit
- [x] Heavy: +1 to Hit when stationary
- [x] Lance: +1 to Wound when charged
- [x] Melta: +X damage within half range, no bonus outside
- [x] Assault: allows shooting after Advance, blocks Fall Back
- [x] Without context, behaves like simple version (backwards compatible)

### Rules Checklist Coverage
- Section 10: All weapon abilities

---

## Phase 14: Morale, Objective Control & Scoring

**Goal:** End-of-turn coherency cleanup, objective scoring, and Desperate Escape.

### Core Engine

- [x] `CALCULATE_OBJECTIVE_CONTROL` action: scans all models within 3" of each objective, sums OC per player, assigns control
  - Edge-to-edge distance (base radius subtracted)
  - Battle-shocked models contribute OC 0
  - Tied OC = contested (no controller)
  - No models nearby = no controller
- [x] `UPDATE_SCORE` action: adds VP to a player with reason logging, floor at 0
- [x] `score: Record<string, number>` on `GameState`
- [ ] End-of-turn coherency → **moved to Phase 25**
- [ ] Desperate Escape → **moved to Phase 25**

### Client

- [x] Objective control already renders controlling player color (ObjectiveLayer uses controllingPlayerId)
- [x] VP display in CommandPhasePanel
- [ ] OC breakdown on hover → **moved to Phase 28**
- [ ] Dedicated score tracker panel → **moved to Phase 25**
- [ ] End-of-turn coherency cleanup visualization → **moved to Phase 25**
- [ ] Desperate Escape resolution UI → **moved to Phase 25**

### Tests

- [x] OC: higher total wins
- [x] OC: tied = contested (no controller)
- [x] Battle-shocked OC = 0 in OC calculation
- [x] No models near objective = no controller
- [x] Models within 3" are counted (edge-to-edge)
- [x] UPDATE_SCORE adds VP
- [x] UPDATE_SCORE accumulates across events
- [x] Score cannot go below 0
- [x] Scoring events are logged

### Rules Checklist Coverage
- Section 8: Objective Control
- 1.3 Unit Coherency (end-of-turn)
- 3.5 Desperate Escape

---

## Phase 15: Terrain & Cover Integration

**Goal:** Terrain affects movement, visibility, and saves during gameplay.

### Core Engine

- [x] `determineCover()` — checks if target has cover from terrain:
  - Checks if target models are wholly within terrain with dense/obscuring traits
  - Checks if LoS from attacker passes through dense terrain
  - Returns `CoverResult` with hasCover, reason, saveModifier, coverTerrainIds
- [x] `applyBenefitOfCover()` — applies +1 save modifier with correct restrictions:
  - +1 to save vs ranged attacks
  - Does NOT apply to 3+ save vs AP 0
  - Respects Ignores Cover flag
  - Not cumulative
- [x] `isModelWhollyWithin()` — checks if model center is inside terrain polygon
- [ ] Terrain movement effects → **moved to Phase 26**
- [ ] Barricades: special charge rules → **moved to Phase 26**

### Client

- [ ] Cover indicator → **moved to Phase 26**
- [ ] Terrain height visualization → **moved to Phase 26**
- [ ] Movement path: show vertical cost over terrain → **moved to Phase 26**

### Tests

- [x] Benefit of Cover: +1 to save
- [x] No modifier without cover
- [x] Ignores Cover negates cover
- [x] Cover does not apply to 3+ save vs AP 0
- [x] Cover DOES apply to 3+ save vs nonzero AP
- [x] Cover applies to 4+ save vs AP 0
- [x] Target wholly within dense terrain gets cover
- [x] Target NOT within terrain gets no cover
- [x] LoS through dense terrain grants cover

### Rules Checklist Coverage
- Section 9: All terrain traits
- 9.7 Benefit of Cover
- 3.7 Moving Over Terrain

---

## Phase 16: Core Stratagems

**Goal:** The 11 core stratagems both players can use.

### Core Engine

- [x] `Stratagem` type with id, name, cpCost, phases, timing, description, restrictions
- [x] `CORE_STRATAGEMS` — all 11 core stratagems defined:
  - Command Re-roll (1 CP), Counter-Offensive (2 CP), Epic Challenge (1 CP)
  - Tank Shock (1 CP), Insane Bravery (1 CP), Grenade (1 CP)
  - Rapid Ingress (1 CP), Smokescreen (1 CP), Fire Overwatch (1 CP)
  - Go to Ground (1 CP), Heroic Intervention (2 CP)
- [x] `USE_STRATAGEM` action with full validation:
  - Cannot use same stratagem twice per phase (`stratagemsUsedThisPhase`)
  - CP validation — blocks if insufficient
  - Cannot target Battle-shocked units (except Insane Bravery)
  - Phase validation — blocks if stratagem not valid for current phase
  - Deducts CP and logs usage with unit name
- [x] `stratagemsUsedThisPhase: string[]` on GameState — reset on ADVANCE_PHASE and NEXT_TURN
- [ ] Stratagem effects → **moved to Phase 24**
- [ ] Out-of-phase action support → **moved to Phase 24**

### Client

- [x] `StratagemPanel` — collapsible panel showing available stratagems:
  - Filtered by current phase
  - CP cost badges
  - Disabled state for already-used or unaffordable stratagems
  - Target unit selector
  - Click to use
- [ ] Stratagem notifications to opponent → **moved to Phase 24**
- [ ] Re-roll UI for Command Re-roll → **moved to Phase 24**
- [ ] Interrupt prompts for Overwatch/Heroic Intervention → **moved to Phase 24**

### Tests

- [x] 11 core stratagems defined with correct costs
- [x] Command Re-roll works in all phases
- [x] Counter-Offensive is fight-phase only
- [x] USE_STRATAGEM deducts CP and records usage
- [x] Cannot use same stratagem twice per phase
- [x] Blocks when not enough CP
- [x] Cannot target Battle-shocked units
- [x] Insane Bravery CAN target Battle-shocked units
- [x] stratagemsUsedThisPhase resets on ADVANCE_PHASE
- [x] stratagemsUsedThisPhase resets on NEXT_TURN
- [x] Blocks stratagem in wrong phase
- [x] Logs usage with unit name

### Rules Checklist Coverage
- Section 12: All core stratagems

---

## Phase 17: Unit Abilities

**Goal:** Universal unit abilities that affect deployment, movement, shooting, and fighting.

### Core Engine

- [x] `parseUnitAbility()` — extracts name, value, and dice expression from ability strings
- [x] `unitHasAbility()` — checks if a unit has a specific ability
- [x] `getUnitAbilityValue()` — extracts numeric value from ability (e.g., FNP 5+ → 5, Scout 6" → 6)
- [x] `resolveFeelNoPain()` — rolls D6 per wound, blocks on threshold+, returns wounds suffered/blocked
- [ ] **Deadly Demise X** → **moved to Phase 23**
- [ ] **Deep Strike** → **moved to Phase 23**
- [ ] **Infiltrators** → **moved to Phase 23**
- [ ] **Leader** → **moved to Phase 23**
- [ ] **Scout X** → **moved to Phase 23**
- [ ] **Stealth** → **moved to Phase 23**
- [ ] Reinforcements step → **moved to Phase 23**
- [ ] Strategic Reserves → **moved to Phase 23**
- [ ] Attached units → **moved to Phase 23**

### Client

- [ ] Deep Strike placement UI → **moved to Phase 23**
- [ ] Scout move: pre-game movement → **moved to Phase 23**
- [ ] Reserves tracker panel → **moved to Phase 23**
- [ ] Feel No Pain rolls after damage → **moved to Phase 23**
- [ ] Attached unit display → **moved to Phase 23**

### Tests

- [x] Unit ability parser: DEEP STRIKE, FEEL NO PAIN 5+, SCOUT 6", DEADLY DEMISE D3
- [x] unitHasAbility checks correctly
- [x] getUnitAbilityValue extracts values
- [x] Feel No Pain: rolls correct number of dice, blocks wounds on threshold+
- [x] Feel No Pain: wounds suffered + blocked = total damage
- [ ] Deep Strike placement validation → **moved to Phase 23**
- [ ] Stealth: -1 to Hit → **moved to Phase 23**
- [ ] Attached unit wound allocation → **moved to Phase 23**

### Rules Checklist Coverage
- Section 11: All unit abilities
- 3.9 Reinforcements
- 3.10 Strategic Reserves
- Section 14: Attached Units

---

## Phase 18: Transports

**Goal:** Embark, disembark, and destroyed transport rules.

### Core Engine

- [x] Transport capacity on Unit type
  - `transportCapacity?: number`, `firingDeck?: number`, `transportKeywordRestrictions?: string[]` on `Unit`
- [x] `embarkedUnits: Record<string, string[]>` on GameState
  - Transport unit ID → array of embarked unit IDs; persists across turns
- [x] New action: `EMBARK` — all models within 3" of transport; cannot embark + disembark same phase
  - Full validation: distance, capacity, keyword restrictions, no nesting, friendly only
  - Models moved to off-board sentinel position `{ x: -1000, y: -1000 }`
  - `canEmbark()` helper in `packages/core/src/transport/index.ts`
- [x] New action: `DISEMBARK` — within 3", not in Engagement Range; before/after transport move affects what unit can do
  - Blocked when transport Advanced or Fell Back
  - Blocked when unit embarked this phase
  - `canDisembark()` helper validates all restrictions
- [x] Destroyed transport: `RESOLVE_DESTROYED_TRANSPORT` action applies pre-rolled casualties, positions survivors, Battle-shocks surviving units
- [x] Hide embarked models from board
  - `isEmbarkedPosition()` utility; `ModelLayer` skips rendering models at off-board position
- [x] Firing Deck: `firingDeck` field on Unit type; client-side restriction for shooting
- [x] `embarkedThisPhase` / `disembarkedThisPhase` on `TurnTracking` — reset on `ADVANCE_PHASE`

### Client

- [x] Embark/Disembark buttons
  - `TransportPanel` component shows embark/disembark controls in the Movement Phase
  - Integrated into `MovementPanel` for both transport units and embarked units
- [x] Transport capacity indicator
  - Shows current load / capacity in the TransportPanel and UnitListSidebar
- [x] Unit status badges in sidebar: "Embarked", "Reserves", "Hover", capacity fraction

### Tests

- [x] EMBARK: unit within 3" can embark — models move off-board, embarkedUnits updated
- [x] EMBARK: blocked when unit is outside 3"
- [x] EMBARK: blocked when transport is at capacity
- [x] EMBARK: blocked when unit has disembarked this phase
- [x] DISEMBARK: valid placement within 3" succeeds — models appear on board
- [x] DISEMBARK: blocked when transport advanced
- [x] DISEMBARK: blocked when unit embarked this phase
- [x] RESOLVE_DESTROYED_TRANSPORT: casualties applied, survivors battle-shocked
- [x] embarkedThisPhase resets on ADVANCE_PHASE
- [x] embarkedUnits persists across turns

### Rules Checklist Coverage
- Section 4: Transports

---

## Phase 19: Aircraft

**Goal:** Aircraft special movement and interaction rules.

### Core Engine

- [x] AIRCRAFT start in Reserves (unless Hover mode)
  - `SET_UNIT_IN_RESERVES` action with `reserveType: 'aircraft'` and `availableFromRound`
  - `reserves: Record<string, ReserveEntry>` on GameState
- [x] AIRCRAFT movement: exactly 20" straight, then up to 90° pivot
  - `AIRCRAFT_MOVE` action validates distance within 0.5" tolerance
  - `validateAircraftMovement()` helper in `packages/core/src/aircraft/index.ts`
- [x] Off-board → Strategic Reserves
  - `AIRCRAFT_OFF_BOARD` action moves models off-board and adds to reserves for next round
- [x] Only FLY units can charge/fight AIRCRAFT
  - `canChargeAircraft()` and `canFightAircraft()` helpers check for FLY keyword
- [x] Hover mode: M=20", loses AIRCRAFT keyword behavior
  - `SET_HOVER_MODE` action; `hoverModeUnits: string[]` on GameState
  - `isAircraftUnit()` helper checks keyword AND not in hover mode
- [x] `ARRIVE_FROM_RESERVES` action: validates round availability, applies positions, marks as normal move
- [ ] Other units can move within Engagement Range of AIRCRAFT but cannot end within it → **moved to Phase 21**

### Client

- [x] Unit status badges in sidebar: "Reserves", "Hover" indicators
- [ ] Aircraft movement tool → **moved to Phase 27**
- [ ] Aircraft arrival from reserves UI → **moved to Phase 27**

### Tests

- [x] SET_UNIT_IN_RESERVES places unit with models off-board
- [x] ARRIVE_FROM_RESERVES: arrives when round >= availableFromRound
- [x] ARRIVE_FROM_RESERVES: blocks arrival before availableFromRound
- [x] AIRCRAFT_MOVE: moves exactly 20" in a straight line
- [x] AIRCRAFT_MOVE: blocks when distance is not exactly 20"
- [x] AIRCRAFT_OFF_BOARD: moves aircraft to Strategic Reserves
- [x] SET_HOVER_MODE: hover mode tracked in state
- [x] SET_HOVER_MODE: exiting hover mode removes from list
- [x] canChargeAircraft: FLY units can charge aircraft
- [x] canChargeAircraft: non-FLY units cannot charge aircraft

### Rules Checklist Coverage
- Section 13: Aircraft

---

## Phase 20: Mortal Wounds & Edge Cases

**Goal:** Clean up remaining rules and edge cases for complete coverage.

### Core Engine

- [x] Mortal wounds: `APPLY_MORTAL_WOUNDS` action — no saves, applied at unit level, each = 1 damage, spills to next model
  - Sorts models by wounds remaining (lowest first) for efficient spill
- [x] Re-rolls: `reRolled?: boolean` flag on `DiceRoll`; `canReRoll()` utility prevents double re-rolls
- [x] Roll-offs: `ROLL_OFF` action records results; `rollOff()` utility in dice module — both D6, highest wins, tie re-rolls
- [x] Surge moves: `SURGE_MOVE` action — one per phase per unit, blocked when Battle-shocked or in Engagement Range
  - `surgeMoveUsedThisPhase` on `TurnTracking`, resets on `ADVANCE_PHASE`
- [ ] Persisting effects → **moved to Phase 26**
- [ ] Out-of-phase rules → **moved to Phase 24**

### Tests

- [x] APPLY_MORTAL_WOUNDS: directly damages without saves
- [x] APPLY_MORTAL_WOUNDS: spills to next model when first dies
- [x] APPLY_MORTAL_WOUNDS: handles exceeding all model wounds
- [x] canReRoll: returns true for normal rolls
- [x] canReRoll: returns false for re-rolled dice
- [x] ROLL_OFF: records result in log
- [x] ROLL_OFF: tie results in null winnerId
- [x] rollOff utility: produces a winner
- [x] SURGE_MOVE: succeeds when valid
- [x] SURGE_MOVE: blocked when battle-shocked
- [x] SURGE_MOVE: blocked when in engagement range
- [x] SURGE_MOVE: only one per phase per unit
- [x] surgeMoveUsedThisPhase resets on ADVANCE_PHASE

### Rules Checklist Coverage
- 5.6 Mortal Wounds
- 1.4 Dice (re-rolls, modifiers)
- 3.11 Surge Moves

---

## Phase 21: Movement & Combat Validation

**Goal:** Complete movement, charge, and fight validation rules that were deferred in earlier phases — FLY movement, path-based collision, charge distance checks, pile-in/consolidate constraints.

### Core Engine

- [x] FLY keyword movement: FLY models can move through enemy models; FLY MONSTER/VEHICLE through friendly MONSTER/VEHICLE
- [x] Path-based movement validation: no moving through enemy models (non-FLY)
- [x] Charge move validation: distance ≤ charge roll, must end in Engagement Range of all declared targets, coherency, no ending in Engagement Range of non-target enemies
- [x] Pile In validation: each model must end closer to the closest enemy model, base-to-base if possible, maintain coherency
- [x] Consolidate validation: same as Pile In, with objective marker fallback (can consolidate toward nearest objective if no enemies)
- [x] Melee target eligibility: within Engagement Range or reachable via friendly base-to-base chain
- [x] Aircraft engagement range exemption: other units can move within Engagement Range of AIRCRAFT but cannot end within it

### Tests

- [x] FLY unit can move through enemy models
- [x] Non-FLY unit blocked from moving through enemy models
- [x] Charge move blocked if distance exceeds charge roll
- [x] Charge must end in Engagement Range of all declared targets
- [x] Pile In must end closer to closest enemy
- [x] Consolidate moves toward enemy or objective
- [x] Melee target reachable via base-to-base chain
- [x] Non-FLY unit cannot end in Engagement Range of AIRCRAFT

### Rules Checklist Coverage
- 3.8 Flying
- 6.3 Charge Move (validation)
- 7.2 Pile In (validation)
- 7.5 Consolidate (validation)
- 7.3 Select Melee Targets (base-to-base chain)

---

## Phase 22: Shooting Rules Completion

**Goal:** Remaining shooting rules — engagement range shooting (Big Guns Never Tire, Pistols), wound allocation enforcement, and the remaining weapon abilities.

### Core Engine

- [x] Big Guns Never Tire: MONSTER/VEHICLE can shoot ranged weapons (except Pistols) while in Engagement Range; can only target units they are in Engagement Range with
- [x] Pistols: can fire while in Engagement Range, but only at units in Engagement Range; overrides normal "cannot shoot in engagement" restriction
- [x] Wound allocation enforcement: wounds must be allocated to already-wounded models first
- [x] **Hazardous**: D6 per model after attacks; on 1, model destroyed (one per weapon per shooting)
- [x] **One Shot**: weapon can only fire once per battle; tracking via `weaponsFired: Record<string, boolean>` on GameState
- [x] **Precision**: allocate wounds to visible CHARACTER model in Attached unit
- [x] **Ignores Cover**: skip Benefit of Cover calculation for this weapon's attacks
- [x] **Indirect Fire**: can target non-visible units, but -1 to Hit and target gets Benefit of Cover
- [x] **Extra Attacks**: additional attacks that cannot be modified by other abilities

### Client

- [ ] Weapon ability tags/badges in shooting panel (color-coded pills for each ability)
- [ ] Highlight when abilities trigger ("Lethal Hit! Auto-wound", "Sustained Hits: +2 hits")
- [ ] Half-range indicator for Rapid Fire/Melta (visual ring on canvas)
- [ ] Hazardous resolution prompt (roll D6 after attacks, destroy on 1)

### Tests

- [x] Big Guns Never Tire: VEHICLE can shoot in Engagement Range
- [x] Big Guns Never Tire: can only target engaged units
- [x] Pistols: can fire in Engagement Range at engaged unit
- [x] Pistols: non-Pistol weapons blocked in Engagement Range
- [x] Wound allocation: must allocate to already-wounded model
- [x] Hazardous: roll per model, destroy on 1
- [x] One Shot: blocks second use of same weapon
- [x] Precision: allocates to CHARACTER in Attached unit
- [x] Ignores Cover: no Benefit of Cover applied
- [x] Indirect Fire: -1 to Hit, target gets cover
- [x] Extra Attacks: unmodifiable additional attacks

### Rules Checklist Coverage
- 5.2 Big Guns Never Tire
- 5.3 Pistols
- 5.5 Wound Allocation
- Section 10: Hazardous, One Shot, Precision, Ignores Cover, Indirect Fire, Extra Attacks

---

## Phase 23: Unit Abilities & Attached Units

**Goal:** Universal unit abilities and the Attached Units system (Leader + Bodyguard).

### Core Engine

- [x] **Deadly Demise X**: on destruction, roll D6; on 6, inflict X mortal wounds to all units within 6"
- [x] **Deep Strike**: place unit in Reserves at game start; arrive Round 2+ more than 9" from enemy models; counts as Normal Move
- [x] **Infiltrators**: deploy anywhere on board more than 9" from enemy deployment zone and enemy models
- [x] **Scout X**: pre-game move up to X" (before first turn)
- [x] **Stealth**: ranged attacks against this unit get -1 to Hit (all models in unit must have it)
- [x] **Leader**: attach CHARACTER to a Bodyguard unit; Leader + Bodyguard become an Attached unit
- [x] Attached units: Leader + Bodyguard move, shoot, charge, fight as one unit
- [x] Wound allocation in Attached units: wounds allocated to Bodyguard models first; CHARACTER protected unless Precision
- [x] Reinforcements step: at end of Movement Phase, units in reserves can arrive (>9" from enemies, counts as Normal Move)
- [x] Strategic Reserves: ≤25% army points can start in reserves; Round 2+ arrival within 6" of a board edge, >9" from enemies

### Client

- [ ] Deep Strike placement UI: valid arrival zones highlighted (>9" from enemies)
- [ ] Scout move: pre-game movement dialog
- [ ] Reserves tracker panel: shows all units in reserves with round availability
- [ ] Feel No Pain rolls after damage (prompt with dice results)
- [ ] Attached unit display: combined unit card, Leader indicated

### Tests

- [x] Deadly Demise: on destruction, rolls D6, mortal wounds on 6
- [x] Deep Strike: validates >9" from enemies
- [x] Deep Strike: blocked before Round 2
- [x] Infiltrators: validates >9" from enemy zone/models
- [x] Scout: pre-game move up to X"
- [x] Stealth: -1 to Hit for ranged attacks
- [x] Leader attaches to Bodyguard unit
- [x] Attached unit wound allocation: Bodyguard absorbs before CHARACTER
- [x] Precision: overrides Attached unit allocation to hit CHARACTER
- [x] Strategic Reserves: validates 25% cap, round, distance constraints

### Rules Checklist Coverage
- Section 11: All unit abilities
- Section 14: Attached Units
- 3.9 Reinforcements
- 3.10 Strategic Reserves

---

## Phase 24: Stratagem Effects

**Goal:** Individual stratagem logic — each of the 11 core stratagems actually does something beyond spending CP.

### Core Engine

- [x] **Command Re-roll** (1 CP): `APPLY_COMMAND_REROLL` action re-rolls one Hit, Wound, Damage, Save, Advance, Charge, or Hazardous roll; validates original roll exists and hasn't been re-rolled; marks new roll with `reRolled: true`
- [x] **Counter-Offensive** (2 CP, Fight): moves target unit to front of `fightState.eligibleUnits`; validates unit is in Engagement Range
- [x] **Epic Challenge** (1 CP, Fight): adds unit to `epicChallengeUnits` array (cleared on `ADVANCE_PHASE`)
  - **Note:** state flag is tracked but not yet read during melee attack resolution to grant Precision
- [x] **Tank Shock** (1 CP, Charge): `RESOLVE_TANK_SHOCK` validates VEHICLE keyword, rolls dice, applies mortal wounds on 5+
- [x] **Insane Bravery** (1 CP, Command): removes target unit from `battleShocked` array, auto-passing failed Battle-shock test
- [x] **Grenade** (1 CP, Shooting): `RESOLVE_GRENADE` validates GRENADES keyword, rolls 6D6, applies mortal wounds on 4+
- [x] **Rapid Ingress** (1 CP, Movement — opponent's turn): sets `outOfPhaseAction` to allow reserves arrival during opponent's Movement phase
- [x] **Smokescreen** (1 CP, Shooting — opponent's turn): adds unit to `smokescreenUnits` array (cleared on `ADVANCE_PHASE`)
  - **Note:** state flag is tracked but not yet read during save calculations to grant cover/stealth
- [x] **Fire Overwatch** (1 CP, Movement/Charge — opponent's turn): `RESOLVE_OVERWATCH` sets `outOfPhaseAction`, validates hits only on unmodified 6s
- [x] **Go to Ground** (1 CP, Shooting — opponent's turn): adds unit to `goToGroundUnits` array (cleared on `ADVANCE_PHASE`)
  - **Note:** state flag is tracked but not yet read during save calculations to grant 6+ invuln and cover
- [x] **Heroic Intervention** (2 CP, Charge — opponent's turn): `RESOLVE_HEROIC_INTERVENTION` sets `outOfPhaseAction`, moves models, adds unit to `chargedUnits`
- [x] Out-of-phase action framework: `outOfPhaseAction: { stratagemId, playerId }` on GameState; `isActionAllowedInPhase()` bypasses phase validation when set; cleared after completion and on phase/turn advance

### Client

- [ ] Re-roll UI for Command Re-roll: select which roll to re-roll, show before/after → **moved to Phase 38**
- [ ] Stratagem notifications to opponent (multiplayer): popup when opponent uses stratagem → **moved to Phase 38**
- [ ] Interrupt prompts for Overwatch/Heroic Intervention during opponent's turn → **moved to Phase 38**

### Tests

- [x] Command Re-roll: re-rolls a failed save and applies new result
- [x] Command Re-roll: cannot re-roll an already-rerolled die
- [x] Counter-Offensive: interrupts fight order
- [x] Tank Shock: mortal wounds on 5+ per model
- [x] Insane Bravery: auto-passes Battle-shock
- [x] Grenade: 6D6 with 4+ mortal wounds
- [x] Fire Overwatch: only hits on unmodified 6
- [x] Smokescreen: grants cover and stealth (tracks state flag)
- [x] Go to Ground: grants 6+ invuln and cover (tracks state flag)
- [x] Heroic Intervention: charges the enemy that just charged
- [x] Out-of-phase actions skip phase validation

### Rules Checklist Coverage
- Section 12: All core stratagem effects

---

## Phase 25: Morale & Coherency Cleanup

**Goal:** End-of-turn coherency enforcement, Desperate Escape, and CP cap.

### Core Engine

- [x] End-of-turn coherency: `CHECK_END_OF_TURN_COHERENCY` action scans all units; removes non-coherent models (>2" from coherency bubble) as destroyed
- [x] Desperate Escape: `RESOLVE_DESPERATE_ESCAPE` action — roll D6 per model falling back through enemies; on 1–2, model destroyed; accepts destroyed model IDs as payload
- [x] Battle-shocked restrictions: Battle-shocked units cannot use Stratagems (except Insane Bravery); enforced in `USE_STRATAGEM` reducer
- [x] CP cap: `cpGainedThisRound: Record<string, number>` on GameState; blocks additional CP gains beyond +1 per round from non-Command-Phase sources; resets on new battle round
- [x] Dice modifier caps: hit and wound modifiers clamped to ±1 in `resolveAttackSequence()`

### Client

- [x] Battle-shocked visual on model tokens: pulsing red ring (animates via `Math.sin(Date.now() / 300)`) in `ModelLayer.ts`
- [x] Dedicated score tracker panel: `ScoreTracker.tsx` with per-player VP bars and VP history; integrated into `RightSideBar`
- [ ] End-of-turn coherency cleanup visualization: show which models would be removed → **moved to Phase 37**
- [ ] Desperate Escape resolution UI: roll D6 per model, show casualties → **moved to Phase 38**

### Tests

- [x] End-of-turn coherency: removes models until coherent
- [x] Desperate Escape: roll D6, destroy on 1–2
- [x] Battle-shocked units blocked from using stratagems (except Insane Bravery)
- [x] CP cap: excess CP beyond +1 per round is discarded

### Rules Checklist Coverage
- 1.3 Unit Coherency (end-of-turn)
- 3.5 Desperate Escape
- 2.1 Gain Command Points (CP cap)

---

## Phase 26: Terrain Movement

**Goal:** Terrain height affects movement and terrain type determines which units can pass through.

### Core Engine

- [x] Terrain height movement: ≤2" height terrain moved over with no extra cost
- [x] Terrain height movement: >2" height terrain costs vertical distance (horizontal + height); validated against movement budget
- [x] Ruins: INFANTRY can move through ruins (with height cost); VEHICLE blocked; FLY bypasses restriction
- [x] Barricades: charge paths blocked through terrain with `defensible` trait
- [x] Persisting effects framework: `PersistingEffect` type on GameState with `id`, `type`, `targetUnitId`, `sourceId`, `expiresAt`, `data`; 4 expiry types (`phase_end`, `turn_end`, `round_end`, `manual`); `ADD_PERSISTING_EFFECT` / `REMOVE_PERSISTING_EFFECT` actions; effects survive embark/disembark
- [ ] Pivot rules (general units): round base = 0", non-round = 1", MONSTER/VEHICLE non-round = 2" → **moved to GAMEPLAY-ROADMAP**

### Client

- [ ] Cover indicator: shield icon on target unit when it has Benefit of Cover → **moved to Phase 37**
- [ ] Terrain height visualization: display height prominently on terrain pieces → **moved to Phase 37**
- [ ] Movement path: show vertical cost when moving over terrain → **moved to Phase 37**

### Tests

- [x] ≤2" terrain: unit moves over as if not there
- [x] >2" terrain: vertical distance counted
- [x] INFANTRY moves through ruins
- [x] VEHICLE blocked from ruins
- [x] Cannot charge through barricade
- [x] Persisting effects survive embark/disembark
- [x] Persisting effects auto-expire

### Rules Checklist Coverage
- 3.7 Moving Over Terrain
- 9.1–9.6 Terrain traits (movement effects)
- Section 15: Persisting Effects

---

## Phase 27: UI Polish — Canvas Visualizations

**Goal:** Rich visual feedback on the game canvas for movement, range, coherency, and combat status.

### Client

- [x] Movement range visualization: `MovementRangeOverlay.ts` — circle based on declared move type and advance rolls
- [x] Movement path line: yellow line between start/end positions with circular markers during drag in `BoardCanvas.tsx`
- [x] Engagement range warning: `EngagementRangeOverlay.ts` — 1" circles around enemy model bases
- [x] Coherency warning: `CoherencyOverlay.ts` — green lines for valid coherency, dashed red lines for failures
- [ ] Range circles: show weapon range rings when assigning shooting targets → **moved to GAMEPLAY-ROADMAP**
- [ ] LoS integration: grey out non-visible target units in shooting panel → **moved to GAMEPLAY-ROADMAP**
- [x] Visual indicator on units that successfully charged: green glow ring in `ModelLayer.ts`
- [x] Visual indicators for fought/eligible units during Fight Phase: purple border ring in `ModelLayer.ts`
- [ ] "Undo movement" button: revert uncommitted positions for current unit → **moved to GAMEPLAY-ROADMAP**
- [ ] Aircraft movement tool: straight-line + pivot visualization on canvas → **moved to GAMEPLAY-ROADMAP**
- [ ] Aircraft arrival from reserves: board placement UI with valid zones → **moved to GAMEPLAY-ROADMAP**

---

## Phase 28: UI Polish — Panels & Controls

**Goal:** Context-sensitive UI panels, phase-specific toolbars, and polished workflows.

### Client

- [x] Phase-specific toolbar: `phaseToolMap` in `ToolBar.tsx` defines enabled tools per phase (command=select, movement=select/rotate/measure, shooting=select/measure/los, etc.)
- [x] Disable/grey out UI controls based on current phase: `isToolEnabledForPhase()` enforces restrictions with visual disabled state
- [ ] Show visual feedback when an action is blocked ("Can only move during Movement Phase" toast/banner) → **moved to GAMEPLAY-ROADMAP**
- [ ] OC breakdown on hover: show per-player OC totals when hovering over objectives → **moved to GAMEPLAY-ROADMAP**
- [x] Dedicated score tracker panel: `ScoreTracker.tsx` with VP bars and VP history, integrated into `RightSideBar`
- [x] Reserves tracker panel: `ReservesPanel.tsx` with type labels (Strategic Reserves, Deep Strike, Aircraft), availability round, "Arrive" button; integrated into `RightSideBar`
- [ ] Stratagem notifications to opponent in multiplayer → **moved to GAMEPLAY-ROADMAP**
- [ ] Interrupt prompts for opponent-turn stratagems → **moved to GAMEPLAY-ROADMAP**

---

## Phase 29: Stretch Goals

**Goal:** Nice-to-have features that improve usability but aren't required for rules coverage.

- [x] Battlescribe .ros XML converter: `roszConverter.ts` — full XML-to-JSON parser with DOMParser-based handling; converts roster/forces/selections/profiles/characteristics/costs/rules
- [x] Improve model base size accuracy: `baseLookup.ts` — 380+ model entries with circle/oval/rect base types; fuzzy matching (exact → substring → contained-in with longest-match preference)
- [ ] Light theme completion: full `dark:` variant coverage on all UI components → **moved to GAMEPLAY-ROADMAP**
- [ ] Army list builder (in-app, not import-only) → **moved to GAMEPLAY-ROADMAP**

---

## Implementation Priority & Dependencies

```
Phases 1–29: COMPLETE (Sprints A–I)

Remaining work tracked in GAMEPLAY-ROADMAP.md
```

### Completed Development Sprints

**Sprint A — Core Gameplay Loop (Phases 7–11)** ✅
Enforced phases, movement, shooting, charging, and fighting.

**Sprint B — Command & Morale (Phases 12, 14)** ✅
CP gain, Battle-shock, objective scoring. Complete turn cycle with victory conditions.

**Sprint C — Weapon & Unit Depth (Phases 13, 17)** ✅
Weapon and unit abilities — Lethal Hits, Sustained Hits, Deep Strike, Feel No Pain, etc.

**Sprint D — Terrain & Stratagems (Phases 15, 16)** ✅
Terrain cover mechanics. 11 core stratagems with validation.

**Sprint E — Advanced Systems (Phases 18, 19, 20)** ✅
Transports, aircraft, mortal wounds, re-rolls, roll-offs, surge moves.

**Sprint F — Rules Fidelity (Phases 21, 22, 23)** ✅
Movement/charge/fight validation, remaining weapon abilities, unit abilities, Attached Units.

**Sprint G — Stratagem & Morale Depth (Phases 24, 25)** ✅
Stratagem mechanical effects, end-of-turn coherency, Desperate Escape, CP cap, dice modifier caps.

**Sprint H — Terrain & Effects (Phase 26)** ✅
Terrain height movement, ruins/barricade restrictions, persisting effects framework.

**Sprint I — UI Polish (Phases 27, 28, 29)** ✅
Canvas overlays (coherency, engagement range, movement path, charged/fight indicators), phase toolbars, score tracker, reserves panel, Battlescribe converter, base size lookup.
