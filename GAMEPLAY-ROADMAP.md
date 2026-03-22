# OpenHammer — Gameplay Roadmap

Remaining work to reach full 10th Edition rules coverage. Cross-referenced against `10th-edition-game-flow.md`, `10th-edition-rules-checklist.md`, and verified against actual codebase state.

**Completed:** Phases 1–29 (Sprints A–I). See `ROADMAP.md` for full history.

**Known gaps in "completed" phases** (carried forward below):
- Smokescreen, Go to Ground, Epic Challenge — state flags tracked but not read during combat resolution
- General unit pivot rules (only aircraft pivots implemented)
- Weapon range circles on canvas
- Blocked action toast/notification system
- OC hover breakdown on objectives
- Stratagem interrupt prompts for multiplayer

---

## Sprint G — Stratagem Combat Integration

**Goal:** Wire the three stratagem state flags (Smokescreen, Go to Ground, Epic Challenge) into actual combat resolution, and add general pivot rules.

### Phase 24a: Stratagem Effects Completion

**Core Engine**

- [ ] **Smokescreen integration**: read `smokescreenUnits` array during `resolveSave()` — grant Benefit of Cover (+1 save) and Stealth (-1 to Hit) for the affected unit until end of phase
- [ ] **Go to Ground integration**: read `goToGroundUnits` array during `resolveSave()` — grant 6+ invulnerable save and Benefit of Cover for the affected unit until end of phase
- [ ] **Epic Challenge integration**: read `epicChallengeUnits` array during melee attack resolution — grant Precision to the CHARACTER model's melee attacks for that fight activation

### Phase 24b: Pivot Rules

**Core Engine**

- [ ] **General pivot rules**: first pivot in a move subtracts pivot cost from remaining movement; subsequent pivots free
  - Round base models: 0" pivot cost
  - Non-round base models: 1" pivot cost
  - MONSTER/VEHICLE non-round base: 2" pivot cost
  - Round base VEHICLE wider than 32mm with flight stand: 2" pivot cost
- [ ] Store base shape (round/non-round) on Model type or derive from base size data

**Tests**

- [ ] Smokescreen: target unit gets +1 save and -1 to Hit during shooting resolution
- [ ] Go to Ground: target unit gets 6+ invuln and +1 save during shooting resolution
- [ ] Epic Challenge: CHARACTER's melee attacks gain Precision (bypass Bodyguard allocation)
- [ ] Pivot: round base = 0", non-round = 1", MONSTER/VEHICLE non-round = 2"

---

## Sprint H — Pre-Game Setup

**Goal:** Full pre-game setup sequence — muster armies, attacker/defender, alternating deployment, scout moves. Transforms freeform model placement into the structured 10th Edition deployment flow.

*Game flow refs: §1.1–1.8*

### Phase 30: Army Construction & Validation

**Core Engine**

- [ ] **Faction validation**: all units must share a Faction keyword; warn/block on import
- [ ] **Warlord designation**: `warlordModelId` on GameState; must be a CHARACTER if one exists
- [ ] **Points limit**: `pointsLimit` on GameState (set by mission or manually); validate army total
- [ ] **Detachment selection**: `Detachment` type with name, rules, stratagems, enhancements; store on player/army state
- [ ] **Enhancements**: `Enhancement` type with name, points cost, eligibility (CHARACTER only, keyword restrictions); max 1 per model, each used only once
- [ ] **Strategic Reserves points cap**: validate ≤25% of total army points; no Fortifications

**Client**

- [ ] Army validation panel: show faction conflicts, points overages, reserves cap issues
- [ ] Warlord selection: click to designate, visual indicator on canvas and sidebar
- [ ] Detachment selector dropdown
- [ ] Enhancement assignment dialog

**Tests**

- [ ] Faction validation: shared keyword → pass; mixed → warn/block
- [ ] Points limit: under → pass; over → warn
- [ ] Strategic Reserves: ≤25% → pass; >25% → block
- [ ] Enhancement: max 1 per model, each used only once
- [ ] Warlord designation stored and retrievable

### Phase 31: Deployment Sequence

**Core Engine**

- [ ] **Attacker/Defender**: `DETERMINE_ROLES` action — roll-off, winner chooses role; store `attackerId`/`defenderId`
- [ ] **Alternating deployment**: `deploymentState` tracking whose turn it is, units remaining; `DEPLOY_UNIT` action places one unit within deployment zone; alternate (mission determines who first)
- [ ] **Infiltrators deployment**: during alternation, Infiltrators placed >9" from enemy zone and models
- [ ] **Reserves declaration**: declare which units start in Reserves during muster
- [ ] **First turn determination**: `DETERMINE_FIRST_TURN` action — mission-dependent (typically Attacker first, or roll-off); set `player1Id`
- [ ] **Scout moves**: `RESOLVE_SCOUT_MOVES` action — after first turn determined, units with Scout X" make pre-game move; must end >9" from enemies; Dedicated Transports inherit Scout
- [ ] **Redeployment**: `RESOLVE_REDEPLOYMENT` action — after all deployed, resolve redeployment abilities (Attacker first)
- [ ] **Setup state machine**: `setupPhase` enum: `muster → createBattlefield → determineRoles → placeObjectives → deploy → redeployments → determineFirstTurn → scoutMoves → ready`

**Client**

- [ ] Game setup wizard: step-by-step UI walking both players through setup
- [ ] Alternating deployment UI: highlight whose turn, show remaining units, valid zone highlighted
- [ ] Infiltrators placement: show valid zones (>9" from enemy zone/models)
- [ ] Scout move dialog: list Scout units, execute pre-game moves
- [ ] Roll-off UI for Attacker/Defender and First Turn

**Tests**

- [ ] Attacker/Defender: roll-off assigns roles
- [ ] Alternating deployment: players alternate one unit at a time
- [ ] Deployment: unit must be within player's deployment zone
- [ ] Infiltrators: placed >9" from enemy zone and models
- [ ] First turn: player1Id set correctly
- [ ] Scout moves: pre-game move up to X", ends >9" from enemies
- [ ] Scout on transport: Dedicated Transport inherits Scout
- [ ] Setup state machine: phases progress correctly

---

## Sprint I — Mission System & Game Lifecycle

**Goal:** Missions define the game. End-of-turn / end-of-round / end-of-battle sequences fully automated.

*Game flow refs: §2, §8, §9, §10*

### Phase 32: Mission Framework

**Core Engine**

- [ ] **Mission type**: `Mission` with id, name, battlefieldSize, deploymentMap, objectivePlacements, maxBattleRounds, scoringConditions, firstTurnRule
- [ ] **Mission library**: at least 3 starter missions with predefined deployment zones, objectives, and scoring
- [ ] **Scoring conditions**: `ScoringCondition` type — when to score, what to check, VP awarded
- [ ] **Mission selection**: `SET_MISSION` action applies deployment zones, objectives, battlefield size, and scoring rules
- [ ] **Primary & Secondary objectives**: mission defines primary scoring; players may select secondaries

**Client**

- [ ] Mission selection screen: pick mission, see deployment map preview, objective positions, scoring summary
- [ ] Scoring conditions display: persistent panel showing active conditions and what's been scored

**Tests**

- [ ] Mission setup: deployment zones and objectives match mission definition
- [ ] SET_MISSION applies battlefield size, zones, objectives
- [ ] Scoring conditions stored on GameState

### Phase 33: End-of-Turn, End-of-Round & End-of-Battle

**Core Engine**

- [ ] **End-of-turn sequence**: (1) coherency check, (2) clear turn-scoped effects (Charge Bonus, movement flags), (3) calculate objective control
- [ ] **End-of-battle-round**: (1) score VP per mission, (2) clear round-scoped effects, (3) increment round counter, (4) check final round
- [ ] **End-of-battle**: (1) unset-up Reserves count as destroyed, (2) final VP scoring, (3) determine winner (highest VP wins, tie = draw), (4) set `gameResult` on GameState
- [ ] **Battle round counter**: track current round (1–5); `maxBattleRounds` from mission
- [ ] **Two turns per round**: `NEXT_TURN` cycles Player 1 → Player 2, then advances round

**Client**

- [ ] End-of-turn summary popup: coherency removals, OC changes, VP scored
- [ ] End-of-round summary: VP scored this round, running totals
- [ ] End-of-battle screen: final VP, winner announcement, game statistics
- [ ] Battle round tracker: prominent display (e.g., "Round 2/5")

**Tests**

- [ ] End-of-turn: Charge Bonus cleared, movement flags cleared, OC recalculated
- [ ] End-of-round: VP scored, round-scoped effects cleared, counter incremented
- [ ] End-of-battle: undeployed Reserves destroyed, winner by VP, tie = draw
- [ ] Two turns per round: Player 1 then Player 2, then next round

---

## Sprint J — Visibility & Targeting Completion

**Goal:** "Fully visible" concept, LoS through own unit, ER targeting restrictions.

*Game flow refs: §1.6, §5.1–5.4*

### Phase 34: Visibility System

**Core Engine**

- [ ] **Fully Visible**: every part of model visible → fully visible; every model in unit fully visible → unit fully visible; can see through models in the observed unit for this check
- [ ] **See through own unit**: model not blocked by other models in its own unit
- [ ] **AIRCRAFT/TOWERING exception**: can see and be seen through/over terrain that normally blocks LoS
- [ ] **ER targeting restriction**: cannot target enemy units in Engagement Range of friendly units with ranged attacks (except Big Guns Never Tire on MONSTER/VEHICLE, and Pistols)
- [ ] **Blast ER restriction**: Blast weapons cannot target units in ER of friendly units

**Client**

- [ ] LoS tool: show "Fully Visible" / "Partially Visible" / "Not Visible"
- [ ] Target selection: grey out invalid targets in shooting panel

**Tests**

- [ ] Fully Visible: all parts visible → true; any hidden → false
- [ ] See through own unit: model not blocked by friendly unit members
- [ ] AIRCRAFT sees over ruins
- [ ] Cannot target unit in ER of friendlies with ranged (non-Pistol, non-BGNT)
- [ ] Blast blocked when target in ER of friendlies

---

## Sprint K — Aircraft & Transport Completion

**Goal:** Remaining aircraft interaction rules and transport destruction detail.

*Game flow refs: §4, §13, §14*

### Phase 35: Aircraft, Transport & Attached Unit Rules

**Core Engine**

- [ ] **AIRCRAFT cannot charge**: block from declaring charges, Pile In, Consolidate
- [ ] **AIRCRAFT can only fight FLY**: melee attacks only against FLY units
- [ ] **Ignore AIRCRAFT for Pile In/Consolidate**: when finding closest enemy, ignore AIRCRAFT (unless piling-in model has FLY)
- [ ] **AIRCRAFT edge behavior**: cannot complete 20" straight-line → goes to Strategic Reserves
- [ ] **Destroyed transport distance tiers**: D6 per model — within 3" destroyed on 1; within 6" destroyed on 1–3
- [ ] **Attached unit destruction VP**: destroying Leader or Bodyguard counts as destroying a unit
- [ ] **Attached unit split**: surviving unit reverts to original Starting Strength
- [ ] **One Leader cap**: enforce max one Leader CHARACTER per Attached unit

**Tests**

- [ ] AIRCRAFT blocked from charging
- [ ] AIRCRAFT can only fight FLY
- [ ] Pile In ignores AIRCRAFT (unless FLY)
- [ ] AIRCRAFT to Strategic Reserves when crossing board edge
- [ ] Destroyed transport: within-3" = destroyed on 1, within-6" = destroyed on 1–3
- [ ] Destroying Leader counts as destroying a unit
- [ ] Surviving unit reverts to original Starting Strength
- [ ] Cannot attach more than one Leader

---

## Sprint L — Sequencing & Edge Cases

**Goal:** Simultaneous rule resolution, out-of-phase restrictions, excess damage.

*Game flow refs: §1.5, §15*

### Phase 36: Sequencing & Out-of-Phase Rules

**Core Engine**

- [ ] **Simultaneous rules (during turn)**: active player chooses resolution order
- [ ] **Simultaneous rules (between turns/rounds)**: players roll off for order
- [ ] **Out-of-phase restrictions**: out-of-phase actions (e.g., Fire Overwatch) do NOT trigger other rules for that phase
- [ ] **Reinforcements as Normal Move**: Reserves arrivals can shoot and charge but not make additional moves
- [ ] **Excess damage lost**: verify `APPLY_DAMAGE` does not carry excess damage to next model

**Tests**

- [ ] Active player's simultaneous rule order respected
- [ ] Out-of-phase: Fire Overwatch doesn't trigger "start of Shooting Phase" abilities
- [ ] Reinforcements count as Normal Move
- [ ] Excess damage from single attack lost when model destroyed

---

## Sprint M — Terrain Traits Completion

**Goal:** Complete terrain trait coverage for all terrain types in the rules.

*Game flow refs: §9.1–9.7*

### Phase 36b: Terrain Trait Rules

**Core Engine**

- [ ] **Craters & Rubble** (Area Terrain): Benefit of Cover if wholly within
- [ ] **Hills**: Benefit of Cover if not fully visible to every model in attacking unit
- [ ] **Battlefield Debris** (Obstacle): can move over but cannot end on top; Benefit of Cover if not fully visible
- [ ] **Woods** (Area Terrain): models wholly within never considered fully visible; looking through/over = not fully visible (except AIRCRAFT/TOWERING); Benefit of Cover if wholly within or not fully visible
- [ ] **Ruins** (Area Terrain — visibility): can see into/out of; cannot see through/over (except AIRCRAFT/TOWERING); Benefit of Cover if wholly within or not fully visible
- [ ] **Barricades** (Obstacle — fighting): can fight across within 2"; Benefit of Cover if within 3" and not fully visible

**Tests**

- [ ] Woods: wholly within = not fully visible
- [ ] Hills: cover when not fully visible
- [ ] Ruins: cannot see through/over
- [ ] Barricade: can fight across within 2"
- [ ] Craters: cover if wholly within

---

## Sprint N — UI Polish: Canvas

**Goal:** Remaining canvas visualizations not yet implemented.

### Phase 37: Canvas Visualizations

**Client**

- [ ] Weapon range circles: show range rings when assigning shooting targets
- [ ] LoS integration: grey out non-visible target units in shooting panel
- [ ] "Undo movement" button: revert uncommitted positions for current unit
- [ ] Aircraft movement tool: straight-line + pivot visualization
- [ ] Aircraft arrival from reserves: board placement UI with valid zones
- [ ] Deep Strike placement UI: valid arrival zones highlighted (>9" from enemies)
- [ ] Warlord visual indicator on model token (crown/star icon)
- [ ] End-of-turn coherency cleanup visualization: show which models would be removed
- [ ] Cover indicator: shield icon on target unit when it has Benefit of Cover
- [ ] Terrain height visualization: display height prominently
- [ ] Movement path: show vertical cost when moving over terrain

---

## Sprint O — UI Polish: Panels

**Goal:** Remaining panel features not yet implemented.

### Phase 38: Panel & Control Polish

**Client**

- [ ] Blocked action toast/banner: "Can only move during Movement Phase" feedback
- [ ] OC breakdown on hover: per-player OC totals when hovering over objectives
- [ ] Weapon ability tags/badges in shooting panel (color-coded pills)
- [ ] Ability trigger highlights ("Lethal Hit! Auto-wound", "Sustained Hits: +2 hits")
- [ ] Half-range indicator for Rapid Fire/Melta (visual ring)
- [ ] Hazardous resolution prompt (roll D6, show destruction on 1)
- [ ] Attached unit display: combined unit card, Leader indicated
- [ ] Feel No Pain rolls after damage (prompt with dice results)
- [ ] Scout move: pre-game movement dialog
- [ ] Re-roll UI for Command Re-roll: select which roll, show before/after
- [ ] Stratagem notifications to opponent in multiplayer
- [ ] Stratagem interrupt prompts for opponent-turn stratagems (Overwatch/Heroic Intervention)
- [ ] Desperate Escape resolution UI: roll D6 per model, show casualties

---

## Sprint P — Stretch Goals

### Phase 39: Polish & Extras

- [ ] Light theme completion: full `dark:` variant coverage on all UI components
- [ ] Army list builder (in-app, not import-only)
- [ ] Detachment data: implement at least one full detachment with stratagems and enhancements
- [ ] Replay mode: step through game action history with forward/back controls
- [ ] Spectator improvements: read-only view with full state visibility

---

## Implementation Priority & Dependencies

```
Phases 1–29: COMPLETE (Sprints A–I in ROADMAP.md)

Sprint G  — Stratagem Combat Integration (24a–24b)  ← small, high-impact; needs existing combat module
Sprint H  — Pre-Game Setup (30–31)                   ← needs Phase 23 (Scout, Infiltrators, Reserves)
Sprint I  — Mission & Lifecycle (32–33)              ← needs Sprint H (setup), Phase 14 (scoring)
Sprint J  — Visibility & Targeting (34)              ← needs Phase 2 (LoS), Phase 22 (shooting)
Sprint K  — Aircraft & Transport (35)                ← needs Phases 18-19
Sprint L  — Sequencing & Edge Cases (36)             ← needs Sprint G (out-of-phase)
Sprint M  — Terrain Traits (36b)                     ← needs Sprint J (fully visible concept)
Sprint N  — UI Canvas (37)                           ← benefits from all rules being in place
Sprint O  — UI Panels (38)                           ← benefits from all rules being in place
Sprint P  — Stretch Goals (39)                       ← independent
```

### Suggested Development Order

1. **Sprint G** — Stratagem Combat Integration. Three state flags need wiring + pivot rules. Smallest sprint, highest correctness impact.
2. **Sprint H** — Pre-Game Setup. Structured deployment transforms the experience from sandbox to game.
3. **Sprint I** — Mission System. Games have win conditions. Enables "playing a real game."
4. **Sprint J** — Visibility. "Fully visible" concept and ER targeting restrictions.
5. **Sprint K** — Aircraft & Transport. Remaining subsystem edge cases.
6. **Sprint L** — Sequencing. Simultaneous rules and out-of-phase restrictions.
7. **Sprint M** — Terrain Traits. Complete terrain type coverage.
8. **Sprints N–O** — UI Polish. Canvas and panel refinements.
9. **Sprint P** — Stretch Goals.
