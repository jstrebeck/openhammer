# OpenHammer — Gameplay Roadmap

Remaining work to reach full 10th Edition rules coverage. Cross-referenced against `10th-edition-game-flow.md`, `10th-edition-rules-checklist.md`, and verified against actual codebase state.

**Completed:** Phases 1–38 (Sprints A–O). See `ROADMAP.md` for full history.

**Known gaps in "completed" phases**: All previously identified gaps have been addressed in Sprints G–O.

---

## Sprint G — Stratagem Combat Integration

**Goal:** Wire the three stratagem state flags (Smokescreen, Go to Ground, Epic Challenge) into actual combat resolution, and add general pivot rules.

### Phase 24a: Stratagem Effects Completion

**Core Engine**

- [x] **Smokescreen integration**: read `smokescreenUnits` array during `resolveSave()` — grant Benefit of Cover (+1 save) and Stealth (-1 to Hit) for the affected unit until end of phase
- [x] **Go to Ground integration**: read `goToGroundUnits` array during `resolveSave()` — grant 6+ invulnerable save and Benefit of Cover for the affected unit until end of phase
- [x] **Epic Challenge integration**: read `epicChallengeUnits` array during melee attack resolution — grant Precision to the CHARACTER model's melee attacks for that fight activation

### Phase 24b: Pivot Rules

**Core Engine**

- [x] **General pivot rules**: first pivot in a move subtracts pivot cost from remaining movement; subsequent pivots free
  - Round base models: 0" pivot cost
  - Non-round base models: 1" pivot cost
  - MONSTER/VEHICLE non-round base: 2" pivot cost
  - Round base VEHICLE wider than 32mm with flight stand: 2" pivot cost
- [x] Store base shape (round/non-round) on Model type or derive from base size data

**Tests**

- [x] Smokescreen: target unit gets +1 save and -1 to Hit during shooting resolution
- [x] Go to Ground: target unit gets 6+ invuln and +1 save during shooting resolution
- [x] Epic Challenge: CHARACTER's melee attacks gain Precision (bypass Bodyguard allocation)
- [x] Pivot: round base = 0", non-round = 1", MONSTER/VEHICLE non-round = 2"

---

## Sprint H — Pre-Game Setup

**Goal:** Full pre-game setup sequence — muster armies, attacker/defender, alternating deployment, scout moves. Transforms freeform model placement into the structured 10th Edition deployment flow.

*Game flow refs: §1.1–1.8*

### Phase 30: Army Construction & Validation

**Core Engine**

- [x] **Faction validation**: all units must share a Faction keyword; warn/block on import
- [x] **Warlord designation**: `warlordModelId` on GameState; must be a CHARACTER if one exists
- [x] **Points limit**: `pointsLimit` on GameState (set by mission or manually); validate army total
- [x] **Detachment selection**: `Detachment` type with name, rules, stratagems, enhancements; store on player/army state
- [x] **Enhancements**: `Enhancement` type with name, points cost, eligibility (CHARACTER only, keyword restrictions); max 1 per model, each used only once
- [x] **Strategic Reserves points cap**: validate ≤25% of total army points; no Fortifications

**Client**

- [x] Army validation panel: show faction conflicts, points overages, reserves cap issues
- [x] Warlord selection: click to designate, visual indicator on canvas and sidebar
- [x] Detachment selector dropdown
- [x] Enhancement assignment dialog

**Tests**

- [x] Faction validation: shared keyword → pass; mixed → warn/block
- [x] Points limit: under → pass; over → warn
- [x] Strategic Reserves: ≤25% → pass; >25% → block
- [x] Enhancement: max 1 per model, each used only once
- [x] Warlord designation stored and retrievable

### Phase 31: Deployment Sequence

**Core Engine**

- [x] **Attacker/Defender**: `DETERMINE_ATTACKER_DEFENDER` action — roll-off, winner chooses role; store `attackerId`/`defenderId`
- [x] **Alternating deployment**: `deploymentState` tracking whose turn it is, units remaining; `DEPLOY_UNIT` action places one unit within deployment zone; alternate (mission determines who first)
- [x] **Infiltrators deployment**: during alternation, Infiltrators separated and placed via `DEPLOY_UNIT`
- [x] **Reserves declaration**: units in reserves excluded from deployment via `BEGIN_DEPLOYMENT`
- [x] **First turn determination**: `DETERMINE_FIRST_TURN` action — mission-dependent (typically Attacker first, or roll-off); sets `firstTurnPlayerId` and `activePlayerId`
- [x] **Scout moves**: `SCOUT_MOVE` action (existing) — pre-game move; `validateScoutMove()` checks distance; Dedicated Transports inherit Scout
- [x] **Redeployment**: `RESOLVE_REDEPLOYMENT` action — after all deployed, resolve redeployment abilities
- [x] **Setup state machine**: `setupPhase` enum: `muster → createBattlefield → determineRoles → placeObjectives → deploy → redeployments → determineFirstTurn → scoutMoves → ready`

**Client**

- [x] Game setup wizard: step-by-step UI walking both players through setup
- [x] Alternating deployment UI: highlight whose turn, show remaining units, valid zone highlighted
- [x] Infiltrators placement: show valid zones (>9" from enemy zone/models)
- [x] Scout move dialog: list Scout units, execute pre-game moves
- [x] Roll-off UI for Attacker/Defender and First Turn

**Tests**

- [x] Attacker/Defender: roll-off assigns roles
- [x] Alternating deployment: players alternate one unit at a time
- [x] Deployment: unit must be within player's deployment zone
- [x] Infiltrators: separated during BEGIN_DEPLOYMENT, placed via DEPLOY_UNIT
- [x] First turn: firstTurnPlayerId and activePlayerId set correctly
- [x] Scout moves: pre-game move up to X", validates distance
- [x] Scout on transport: Dedicated Transport inherits Scout
- [x] Setup state machine: phases progress correctly

---

## Sprint I — Mission System & Game Lifecycle

**Goal:** Missions define the game. End-of-turn / end-of-round / end-of-battle sequences fully automated.

*Game flow refs: §2, §8, §9, §10*

### Phase 32: Mission Framework

**Core Engine**

- [x] **Mission type**: `Mission` with id, name, battlefieldSize, deploymentMap, objectivePlacements, maxBattleRounds, scoringConditions, firstTurnRule
- [x] **Mission library**: at least 3 starter missions with predefined deployment zones, objectives, and scoring
- [x] **Scoring conditions**: `ScoringCondition` type — when to score, what to check, VP awarded
- [x] **Mission selection**: `SET_MISSION` action applies deployment zones, objectives, battlefield size, and scoring rules
- [x] **Primary & Secondary objectives**: mission defines primary scoring; players may select secondaries

**Client**

- [x] Mission selection screen: pick mission, see deployment map preview, objective positions, scoring summary
- [x] Scoring conditions display: persistent panel showing active conditions and what's been scored

**Tests**

- [x] Mission setup: deployment zones and objectives match mission definition
- [x] SET_MISSION applies battlefield size, zones, objectives
- [x] Scoring conditions stored on GameState

### Phase 33: End-of-Turn, End-of-Round & End-of-Battle

**Core Engine**

- [x] **End-of-turn sequence**: (1) coherency check, (2) clear turn-scoped effects (Charge Bonus, movement flags), (3) calculate objective control
- [x] **End-of-battle-round**: (1) score VP per mission, (2) clear round-scoped effects, (3) increment round counter, (4) check final round
- [x] **End-of-battle**: (1) unset-up Reserves count as destroyed, (2) final VP scoring, (3) determine winner (highest VP wins, tie = draw), (4) set `gameResult` on GameState
- [x] **Battle round counter**: track current round (1–5); `maxBattleRounds` from mission
- [x] **Two turns per round**: `NEXT_TURN` cycles Player 1 → Player 2, then advances round

**Client**

- [x] End-of-turn summary popup: coherency removals, OC changes, VP scored
- [x] End-of-round summary: VP scored this round, running totals
- [x] End-of-battle screen: final VP, winner announcement, game statistics
- [x] Battle round tracker: prominent display (e.g., "Round 2/5")

**Tests**

- [x] End-of-turn: Charge Bonus cleared, movement flags cleared, OC recalculated
- [x] End-of-round: VP scored, round-scoped effects cleared, counter incremented
- [x] End-of-battle: undeployed Reserves destroyed, winner by VP, tie = draw
- [x] Two turns per round: Player 1 then Player 2, then next round

---

## Sprint J — Visibility & Targeting Completion

**Goal:** "Fully visible" concept, LoS through own unit, ER targeting restrictions.

*Game flow refs: §1.6, §5.1–5.4*

### Phase 34: Visibility System

**Core Engine**

- [x] **Fully Visible**: every part of model visible → fully visible; every model in unit fully visible → unit fully visible; can see through models in the observed unit for this check
- [x] **See through own unit**: model not blocked by other models in its own unit
- [x] **AIRCRAFT/TOWERING exception**: can see and be seen through/over terrain that normally blocks LoS
- [x] **ER targeting restriction**: cannot target enemy units in Engagement Range of friendly units with ranged attacks (except Big Guns Never Tire on MONSTER/VEHICLE, and Pistols)
- [x] **Blast ER restriction**: Blast weapons cannot target units in ER of friendly units

**Client**

- [x] LoS tool: show "Fully Visible" / "Partially Visible" / "Not Visible"
- [x] Target selection: grey out invalid targets in shooting panel

**Tests**

- [x] Fully Visible: all parts visible → true; any hidden → false
- [x] See through own unit: model not blocked by friendly unit members
- [x] AIRCRAFT sees over ruins
- [x] Cannot target unit in ER of friendlies with ranged (non-Pistol, non-BGNT)
- [x] Blast blocked when target in ER of friendlies

---

## Sprint K — Aircraft & Transport Completion

**Goal:** Remaining aircraft interaction rules and transport destruction detail.

*Game flow refs: §4, §13, §14*

### Phase 35: Aircraft, Transport & Attached Unit Rules

**Core Engine**

- [x] **AIRCRAFT cannot charge**: block from declaring charges, Pile In, Consolidate
- [x] **AIRCRAFT can only fight FLY**: melee attacks only against FLY units
- [x] **Ignore AIRCRAFT for Pile In/Consolidate**: when finding closest enemy, ignore AIRCRAFT (unless piling-in model has FLY)
- [x] **AIRCRAFT edge behavior**: cannot complete 20" straight-line → goes to Strategic Reserves
- [x] **Destroyed transport distance tiers**: D6 per model — within 3" destroyed on 1; within 6" destroyed on 1–3
- [x] **Attached unit destruction VP**: destroying Leader or Bodyguard counts as destroying a unit
- [x] **Attached unit split**: surviving unit reverts to original Starting Strength
- [x] **One Leader cap**: enforce max one Leader CHARACTER per Attached unit

**Tests**

- [x] AIRCRAFT blocked from charging
- [x] AIRCRAFT can only fight FLY
- [x] Pile In ignores AIRCRAFT (unless FLY)
- [x] AIRCRAFT to Strategic Reserves when crossing board edge
- [x] Destroyed transport: within-3" = destroyed on 1, within-6" = destroyed on 1–3
- [x] Destroying Leader counts as destroying a unit
- [x] Surviving unit reverts to original Starting Strength
- [x] Cannot attach more than one Leader

---

## Sprint L — Sequencing & Edge Cases

**Goal:** Simultaneous rule resolution, out-of-phase restrictions, excess damage.

*Game flow refs: §1.5, §15*

### Phase 36: Sequencing & Out-of-Phase Rules

**Core Engine**

- [x] **Simultaneous rules (during turn)**: active player chooses resolution order
- [x] **Simultaneous rules (between turns/rounds)**: players roll off for order
- [x] **Out-of-phase restrictions**: out-of-phase actions (e.g., Fire Overwatch) do NOT trigger other rules for that phase
- [x] **Reinforcements as Normal Move**: Reserves arrivals can shoot and charge but not make additional moves
- [x] **Excess damage lost**: verify `APPLY_DAMAGE` does not carry excess damage to next model

**Tests**

- [x] Active player's simultaneous rule order respected
- [x] Out-of-phase: Fire Overwatch doesn't trigger "start of Shooting Phase" abilities
- [x] Reinforcements count as Normal Move
- [x] Excess damage from single attack lost when model destroyed

---

## Sprint M — Terrain Traits Completion

**Goal:** Complete terrain trait coverage for all terrain types in the rules.

*Game flow refs: §9.1–9.7*

### Phase 36b: Terrain Trait Rules

**Core Engine**

- [x] **Craters & Rubble** (Area Terrain): Benefit of Cover if wholly within
- [x] **Hills**: Benefit of Cover if not fully visible to every model in attacking unit
- [x] **Battlefield Debris** (Obstacle): can move over but cannot end on top; Benefit of Cover if not fully visible
- [x] **Woods** (Area Terrain): models wholly within never considered fully visible; looking through/over = not fully visible (except AIRCRAFT/TOWERING); Benefit of Cover if wholly within or not fully visible
- [x] **Ruins** (Area Terrain — visibility): can see into/out of; cannot see through/over (except AIRCRAFT/TOWERING); Benefit of Cover if wholly within or not fully visible
- [x] **Barricades** (Obstacle — fighting): can fight across within 2"; Benefit of Cover if within 3" and not fully visible

**Tests**

- [x] Woods: wholly within = not fully visible
- [x] Hills: cover when not fully visible
- [x] Ruins: cannot see through/over
- [x] Barricade: can fight across within 2"
- [x] Craters: cover if wholly within

---

## Sprint N — UI Polish: Canvas

**Goal:** Remaining canvas visualizations not yet implemented.

### Phase 37: Canvas Visualizations

**Client**

- [x] Weapon range circles: show range rings when assigning shooting targets
- [x] LoS integration: grey out non-visible target units in shooting panel
- [x] "Undo movement" button: revert uncommitted positions for current unit
- [x] Aircraft movement tool: straight-line + pivot visualization
- [x] Aircraft arrival from reserves: board placement UI with valid zones
- [x] Deep Strike placement UI: valid arrival zones highlighted (>9" from enemies)
- [x] Warlord visual indicator on model token (crown/star icon)
- [x] End-of-turn coherency cleanup visualization: show which models would be removed
- [x] Cover indicator: shield icon on target unit when it has Benefit of Cover
- [x] Terrain height visualization: display height prominently
- [x] Movement path: show vertical cost when moving over terrain

---

## Sprint O — UI Polish: Panels

**Goal:** Remaining panel features not yet implemented.

### Phase 38: Panel & Control Polish

**Client**

- [x] Blocked action toast/banner: "Can only move during Movement Phase" feedback
- [x] OC breakdown on hover: per-player OC totals when hovering over objectives
- [x] Weapon ability tags/badges in shooting panel (color-coded pills)
- [x] Ability trigger highlights ("Lethal Hit! Auto-wound", "Sustained Hits: +2 hits")
- [x] Half-range indicator for Rapid Fire/Melta (visual ring)
- [x] Hazardous resolution prompt (roll D6, show destruction on 1)
- [x] Attached unit display: combined unit card, Leader indicated
- [x] Feel No Pain rolls after damage (prompt with dice results)
- [x] Scout move: pre-game movement dialog
- [x] Re-roll UI for Command Re-roll: select which roll, show before/after
- [x] Stratagem notifications to opponent in multiplayer
- [x] Stratagem interrupt prompts for opponent-turn stratagems (Overwatch/Heroic Intervention)
- [x] Desperate Escape resolution UI: roll D6 per model, show casualties

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
Phases 1–38: COMPLETE (Sprints A–O)

Sprint G  — Stratagem Combat Integration (24a–24b)  ✅ COMPLETE
Sprint H  — Pre-Game Setup (30–31)                   ✅ COMPLETE
Sprint I  — Mission & Lifecycle (32–33)              ✅ COMPLETE
Sprint J  — Visibility & Targeting (34)              ✅ COMPLETE
Sprint K  — Aircraft & Transport (35)                ✅ COMPLETE
Sprint L  — Sequencing & Edge Cases (36)             ✅ COMPLETE
Sprint M  — Terrain Traits (36b)                     ✅ COMPLETE
Sprint N  — UI Canvas (37)                           ✅ COMPLETE
Sprint O  — UI Panels (38)                           ✅ COMPLETE
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
