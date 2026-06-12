# OpenHammer — Master Plan

**The single living plan.** All prior plan documents (`ROADMAP.md`, `GAMEPLAY-ROADMAP.md`, `ARMY-ROADMAP.md`, `ARCHITECTURE-CONCERNS.md`) are consolidated here and archived in `docs/archive/`. Iterate on this file: check items off, add evidence, append new milestones at the bottom. `10th-edition-game-flow.md` and `10th-edition-rules-checklist.md` remain as rules reference (the checklist's checkboxes are not maintained — treat it as a spec, not a tracker).

**North star:** the best possible way to play a full, fair, friction-free game of Warhammer 40k 10th Edition in a browser — two humans, real rules enforcement, nothing to remember, nothing to look up.

**Legend:** `[ ]` todo · `[~]` partial · `[x]` done. Every claim of "done" should cite evidence (file:line or test). Past roadmaps marked things complete that were never wired into gameplay — **a feature is done when a player can reach it in the UI and the rule actually changes the dice/state in a real game.** That is this plan's definition of done.

---

## Verified Current State (full repo review, 2026-06-12)

What's genuinely solid:

- **Core engine** (`packages/core`): 631 tests across 41 files, all passing; typecheck clean on all three packages. Pure reducer decomposed into domain sub-reducers (`state/reducer.ts` is a 93-line dispatcher; sub-reducers total ~4,300 lines). Combat decomposed into `attackPipeline.ts` / `saves.ts` / `abilities.ts` / `woundAllocation.ts` / `factionModifiers.ts` / `stratagems.ts`. Full five-round scripted game runs in `src/__tests__/fullGame.test.ts`.
- **Main phase loop is playable in the UI**: Movement (declare/advance/commit + transports), Shooting (ability-aware pipeline with real distances, faction/detachment rules, defender-interactive saves), Charge (declare/roll/commit), Fight (alternating selection, pile-in/consolidate), Command (CP + battle-shock), with canvas overlays and a working setup wizard + deployment wizard + sample 1000-pt T'au and Astra Militarum armies.
- **Factions**: T'au Empire and Astra Militarum fully enforced (faction rule + 4 detachments each, wired into actual combat).
- **Multiplayer plumbing**: rooms, server-authoritative reducer, snapshots, reconnection by name, chat. Defender save prompts and alternating fight selection work across clients.

What the review found broken or hollow (details + evidence in milestones below):

1. **Nine completed components are never mounted** — no file imports them: `WarlordSelector`, `EnhancementAssignment`, `EndOfBattleScreen`, `EndOfTurnSummary`, `EndOfRoundSummary`, `HazardousPrompt`, `FeelNoPainPrompt`, `AttachedUnitDisplay`, `DesperateEscapePrompt`. The game has no end screen; hazardous/FNP/desperate-escape never prompt; leaders can never be attached (no UI dispatches `ATTACH_LEADER`).
2. **Several "complete" rules don't affect play**: Epic Challenge precision hardcoded off (`SaveRollPanel.tsx:45,48` passes `false`); engagement-range targeting restrictions (`canTargetWithRangedWeapon`, `los/index.ts:410`) never invoked; Desperate Escape never auto-triggers on Fall Back; visibility/fully-visible system not used for target validation.
3. **Rules enforcement defaults are off**: `DEFAULT_RULES_CONFIG` (`core/src/types/index.ts:135`) = coherency `warn`, phaseRestrictions `off`, lineOfSight `off`. A default game enforces almost nothing, and setup never offers to turn enforcement on.
4. **Multiplayer is not fair-play safe**: server applies any non-spectator action regardless of turn (`server/src/rooms.ts:150`); any player can `ADVANCE_PHASE`/`NEXT_TURN`; undo/redo is local-only and silently desyncs clients (`client/src/store/gameStore.ts:47`); rooms are in-memory (server restart loses every game); no opponent-turn stratagem prompts (Overwatch etc. are unreachable at the moment they matter).
5. **Zero client tests, zero server tests.** All 631 tests are core. The wiring layer — exactly where this review found the failures — is untested.
6. **No local persistence**: F5 in a local game loses everything.

---

## Milestone 1 — Make "complete" true: rules that exist but don't fire

*Smallest work, highest integrity payoff. Every item here was previously claimed done.*

- [ ] **Epic Challenge grants Precision.** Thread `isEpicChallengePrecision()` (or equivalent) into wound allocation instead of the hardcoded `false` at `client/src/components/SaveRollPanel.tsx:45,48`. Test: melee attack from an Epic-Challenged CHARACTER can be allocated to the enemy Leader.
- [ ] **Engagement-range targeting restrictions enforced.** Call `canTargetWithRangedWeapon()` (`core/src/los/index.ts:410`) in `ASSIGN_WEAPON_TARGETS` reducer validation and grey out illegal targets in `ShootingPanel`. Covers: can't target enemies in ER of friendlies (except Pistol/BGNT), Blast can't target units in ER of friendlies, can't shoot while in ER (except Pistol/BGNT).
- [ ] **Desperate Escape auto-triggers.** When a Fall Back path crosses enemy models, or a battle-shocked unit Falls Back, the reducer/UI must require `RESOLVE_DESPERATE_ESCAPE` before the move commits — mount `DesperateEscapePrompt` and gate `COMMIT_MOVEMENT` on it.
- [ ] **Hazardous prompts after attacks.** Mount `HazardousPrompt`; after a unit shoots/fights with a Hazardous weapon, require resolution (D6 per model; CHARACTER/MONSTER/VEHICLE take 3 MW instead of dying — verify core implements the 3-MW variant).
- [ ] **Feel No Pain visible.** Mount `FeelNoPainPrompt` (or surface FNP results inside SaveRollPanel explicitly) so defenders see and confirm FNP rolls instead of silent resolution.
- [ ] **Wound-allocation validated core-side.** `RESOLVE_PENDING_SAVES` currently trusts whatever model IDs the client sends. Validate allocations in the reducer (already-wounded-first, bodyguard-first, precision override) so a buggy/cheating client can't misallocate.
- [ ] **Visibility used for targeting.** `lineOfSight` enforcement level should gate target selection (`getValidShootingTargets` + visibility) in `DECLARE_SHOOTING`/`ASSIGN_WEAPON_TARGETS`, not just the LoS tool.
- [ ] **Smokescreen/Go-to-Ground audit.** Save-side bonuses are wired via `computeDefensiveSaveModifiers()` and the hit-side via `getStratagemHitModifier()` in `ShootingPanel.tsx:140` — confirm both apply in the FightPanel/melee path where relevant, and that effects expire at end of phase. Add an integration test that shoots a Smokescreened unit through the real client-side pipeline functions.
- [ ] **Verify every Sprint G–O claim with an integration test.** Pattern: extend `fullGame.test.ts` (or add scenario tests) so each claimed rule changes an actual game outcome at least once.

## Milestone 2 — Mount the orphaned UI & finish core flows

*The components exist; put them in the tree and close the loops.*

- [ ] **EndOfBattleScreen** mounted in `GameLayout`, shown when `gameResult` is set. A game must end with a winner screen.
- [ ] **EndOfTurnSummary / EndOfRoundSummary** mounted and triggered by the lifecycle sequence (coherency removals, OC changes, VP scored this round).
- [ ] **WarlordSelector + EnhancementAssignment** added to the setup wizard (after detachment selection). Warlord required before deployment when enforcement is on.
- [ ] **Leader attachment UI.** Nothing dispatches `ATTACH_LEADER` today. Add attach/detach controls during setup/deployment (and mount `AttachedUnitDisplay` in the sidebar for attached pairs).
- [ ] **Stratagem resolution feedback.** 9 of 11 core stratagems deduct CP with no visible effect. For each: a toast/log entry stating the effect, plus dedicated flows where rules need input — Tank Shock (select weapon, roll, MW), Grenade (target selection within 8"+visible), Command Re-roll (pick which logged roll to re-roll, show before/after).
- [ ] **Opponent-turn stratagem interrupts.** Window-of-opportunity prompts on the non-active player's client: Fire Overwatch (enemy ends a move/charge within 24"), Smokescreen/Go to Ground (when targeted), Rapid Ingress (end of enemy Movement), Heroic Intervention (after enemy charge ends within 6"). Without these, half the stratagems are unreachable at the moment they're legal.
- [ ] **Aircraft hover-mode toggle** in the UI (`SET_HOVER_MODE` has no UI today) and reserve-type threat-zone hints (9"/6" rings) during arrival placement.
- [ ] **"Begin battle" handoff.** Explicit transition when deployment completes (setupPhase → ready): banner/modal "Round 1 — <Player>'s Command Phase", instead of the wizard silently disappearing.
- [ ] **Enforcement preset at setup.** Setup wizard offers "Casual (warn) / Strict (enforce all)" and sets `rulesConfig` accordingly; default new games to enforce for a real game. Today `phaseRestrictions`/`lineOfSight` default `off` and nothing in setup mentions it.

## Milestone 3 — Multiplayer integrity

*Blockers for a fair two-human game.*

- [ ] **Server-side turn & ownership enforcement.** In `server/src/rooms.ts` `handleAction`: reject actions whose category requires the active player when `client.playerId !== state.turnState.activePlayerId` (with an allowlist for legitimately out-of-turn actions: save rolls, fight selection when `nextToSelect`, deployment when `currentDeployingPlayerId`, opponent-turn stratagems via `outOfPhaseAction`, chat/admin). Reject actions targeting units the sender doesn't own.
- [ ] **Phase/turn advancement restricted** to the active player (or mutual confirm). Today anyone can `ADVANCE_PHASE`/`NEXT_TURN` mid-resolution.
- [ ] **Multiplayer-safe undo.** Local undo (`gameStore.ts:47-61`) silently desyncs clients. Either: disable undo in multiplayer (quick), or implement server-mediated undo (proposal + opponent consent), restoring from server-side action history.
- [ ] **Pending-interaction gating.** Block `ADVANCE_PHASE` while a `PendingSave`, battle-shock test, or desperate escape is unresolved (enforce in reducer so it holds server-side too).
- [ ] **Room persistence.** Persist room state (periodic JSON snapshot to disk is enough for v1; Redis/Postgres later) so a server restart doesn't kill every game. Restore rooms on boot.
- [ ] **Turn-handoff UX.** Prominent "Your turn / Waiting for <name>" state, notification (title flash/sound) when it becomes your turn or a prompt needs you.
- [ ] **Identity hardening.** Reconnection matches by player name — two identical names collide. Issue a session token on join; match reconnection by token.
- [ ] **Unresponsive-opponent fallback.** Timeout / "nudge" / host-resolve option when a defender never rolls saves, so a game can't deadlock.
- [ ] **Server-authoritative dice.** Every roll today happens client-side and is reported to the server as a result — a modified client can fabricate any roll. In multiplayer, dice must be rolled server-side (the action carries intent, the server rolls and broadcasts) or use commit-reveal. Local games keep client rolls.
- [ ] **WS URL via env** (`VITE_WS_SERVER_URL`) instead of hardcoded server address; align `infrastructure/` (compose/k8s) with it, add k8s probes/resource limits.

## Milestone 4 — Full-game experience

*From "all the pieces exist" to "the best way to play."*

- [ ] **Guided turn flow / "what's next" engine.** A persistent indicator that computes the current required step from state (e.g. "3 units still to move", "Battle-shock test needed for X", "Saves pending"). The single biggest UX gap: players must know 40k's sequence themselves today.
- [ ] **Per-unit activation tracker** in each phase panel: list of eligible units with done/pending status; auto-select next.
- [ ] **Local game persistence.** Autosave `gameState` to localStorage on every dispatch; offer resume on load. (Save/load to file already works.)
- [ ] **Drag-to-move integration with declared movement.** Audit: dragging on canvas should be constrained by (or at minimum validated against) the declared move budget in real time, not just blocked at commit. Show remaining inches during drag.
- [ ] **Split fire / per-model targeting fidelity.** One weapon-profile → one target per activation is implemented; verify different weapons can target different units in a single shooting activation end-to-end, and document the (intentional) abstraction that models within a unit don't individually split.
- [ ] **Melee multi-target**: a unit in ER of two enemies should be able to split attacks (currently single target per activation in FightPanel).
- [ ] **Onboarding**: first-run tooltip tour or "demo game" script using the sample armies; rules hints inline ("why is this blocked?" links log explanations).
- [ ] **Light theme completion** (panels hardcoded dark) — low priority polish.
- [ ] **Performance pass at 100+ models**: verify ModelLayer sync skips clean models; fix the unremoved `resize` listener in `BoardCanvas.tsx` cleanup.

## Milestone 5 — Test & infra hardening

- [ ] **Client tests (currently zero).** Priority order: SaveRollPanel (wound allocation incl. attached/precision), ShootingPanel pipeline assembly (AttackContext correctness), setup wizard state machine, FightPanel alternation, gameStore undo/multiplayer forwarding.
- [ ] **Server tests (currently zero).** Room lifecycle, permission enforcement (after M3), reconnection, two-client action ordering, snapshot reconciliation.
- [ ] **Two-client integration test**: scripted multiplayer game over real WebSockets (spin server in-process), covering defender saves, fight alternation, opponent stratagem.
- [ ] **Full-game UI smoke test** (Playwright): load sample armies, play one full round through the panels.
- [ ] **CI**: run test + typecheck on push (no CI config exists in repo).

## Milestone 6 — Architecture debt (from ARCHITECTURE-CONCERNS, re-verified 2026-06)

Resolved since the original review: monolithic reducer (now 93-line dispatcher + domain sub-reducers ✅), combat module decomposition ✅.

- [ ] **Faction state generalization.** `guidedTargets`, `activeOrders`, `officersUsedThisPhase`, `smokescreenUnits`, `goToGroundUnits`, `epicChallengeUnits` still live as top-level GameState fields. Introduce a namespaced `effectState`/`factionState` container before adding faction #3 — prerequisite for Milestones 7–8.
- [ ] **Data-driven stratagem/detachment effects.** Effects are switch-cases in `stratagemReducer.ts` and TS objects in `detachments/*.ts`. Define a declarative effect schema (modifier descriptors interpreted by the pipeline) so new factions are data, not reducer edits. This schema is the foundation Milestone 7 extends for datasheet abilities — prerequisite for Milestones 7–8.
- [ ] **Phase names still hardcoded in client** (`BoardCanvas.tsx:~296`, `PhaseActionPanel.tsx:10-26`) — query the edition.
- [ ] **Edition constants centralized** (1" ER, 2" coherency, 20" aircraft scattered as literals).
- [ ] **Wound threshold single source** (duplicated in `wh40k10th.ts` and combat).
- [ ] **Base size lookup → JSON data file** with user override UI.
- [ ] **Large components decomposed** (`GameSetupDialog` 950+, `BoardCanvas` 840, `ShootingPanel` 640) — opportunistic, when touching them.
- [ ] **Extensible mission scoring** (only 3 condition types; no real secondary objectives — Tactical/Fixed missions need a richer condition system).

## Milestone 7 — Datasheet abilities & enhancement effects

*The biggest content gap. Faction and detachment rules are maybe 20% of 40k's rules content by volume — the rest lives on datasheets. Every unit has 1–3 unique abilities (auras, "While this model is leading a unit...", once-per-battle effects, wargear rules). Today the importer carries these as free text; only parseable universal abilities (FNP, Deep Strike, Stealth, Scout...) do anything. Even the supported T'au vs AM matchup plays without most of its datasheet rules. Depends on Milestone 6's data-driven-effects schema — build them together.*

- [ ] **Declarative ability-effect schema.** Extend the M6 effect descriptors to cover what datasheet abilities need: hit/wound/save/damage modifiers, re-rolls, FNP variants, conditional triggers (charged, below half, near objective, target keyword), aura ranges, granted weapon abilities, and once-per-battle/phase usage limits. The attack pipeline and reducers interpret descriptors generically.
- [ ] **Datasheet ability library.** Data file keyed by unit name (same pattern as `baseLookup.ts`, but JSON per M6). Seed it with every unit in the two sample armies so a T'au vs AM game is fully rules-faithful — that's the acceptance test for the schema.
- [ ] **Leader-granted abilities.** "While this model is leading a unit..." effects apply to the attached unit while the leader lives, and stop when it dies. (Requires M2's attach UI.)
- [ ] **Aura abilities** evaluated at resolution time from real board positions (friendly and enemy-affecting).
- [ ] **Once-per-battle / once-per-turn abilities**: tracked in state, activated from the unit's panel, visible to the opponent in the log.
- [ ] **Enhancement effects enforced.** M2 mounts the assignment UI; this item makes enhancements actually do things — same effect schema, attached to the model.
- [ ] **Importer mapping + graceful fallback.** Map Battlescribe ability text to library entries; abilities with no mapping surface in the unit card as reference text with a "manual effect" affordance (player applies a modifier by hand) instead of silently doing nothing. Show a per-army "X of Y abilities automated" indicator at import.
- [ ] **Tests:** every automated sample-army datasheet ability changes a real game outcome in a scenario test; importer mapping coverage test against both sample armies.

## Milestone 8 — Faction expansion

T'au Empire and Astra Militarum are complete at the faction/detachment level (faction rule + all 4 detachments, combat-enforced, sample armies). Remaining 25 factions, ~114 detachments — plus their datasheets via the Milestone 7 library. Detailed per-detachment rule text preserved in `docs/archive/ARMY-ROADMAP.md` — pull from there when implementing.

**Do Milestone 6's faction-state + data-driven-effects items and Milestone 7's ability schema first**, then add factions in this order (popularity / mechanic-coverage spread):

| Priority | Faction | Faction rule | Why this order |
|---|---|---|---|
| 1 | Space Marines | Oath of Moment | Most-played; rule is simple (re-roll hit/wound vs marked target); 8 detachments shared across 5 chapter factions |
| 2 | Necrons | Reanimation Protocols | Tests start-of-phase regeneration mechanics |
| 3 | Orks | Waaagh! | Tests once-per-battle army-wide buff |
| 4 | Tyranids | Shadow in the Warp | Tests army-wide battle-shock interaction |
| 5 | Chaos Space Marines | Dark Pacts | Tests opt-in risk/reward at activation |
| 6 | Aeldari | Strands of Fate | Tests dice-pool substitution (shared mechanic with Sororitas Miracle dice) |
| 7+ | Remaining 21 | — | Chapter variants (Blood/Dark Angels, Templars, Wolves, Deathwatch) are cheap once SM detachments exist |

Per-faction definition of done: faction rule enforced in the live pipeline + ≥1 detachment fully enforced + datasheet abilities for a sample army in the M7 library + tests + a sample army in `samples/` loadable from setup.

- [ ] Space Marines (+ shared-detachment infrastructure for chapter factions)
- [ ] Necrons
- [ ] Orks
- [ ] Tyranids
- [ ] Chaos Space Marines
- [ ] Aeldari
- [ ] Remaining factions (see archive for full list and rule text)

## Milestone 9 — Stretch

- [ ] In-app army list builder (currently import-only)
- [ ] Replay mode (step through action history — the action log makes this cheap)
- [ ] Spectator polish (read-only view, follow-active-player camera)
- [ ] Mobile layout for panels (canvas touch already works)
- [ ] Crusade / narrative mode (XP, battle honours, persistent rosters)
- [ ] Chess clock / turn timers for tournament play

---

## Scope decisions (explicit calls, not omissions — revisit deliberately)

A "full 40k system" forces three decisions this plan makes explicitly rather than discovering later:

1. **The 2D abstraction.** The engine is flat polygons: no ruin floors/levels, no 5" vertical engagement range, no true-LoS model silhouettes, simplified TOWERING/wholly-within-at-height. Competitive 10th leans heavily on multi-level ruin play. **Current stance: accept the abstraction and document it in-app as a built-in house rule** ("all play is at ground level; obscuring terrain blocks LoS regardless of height"). Implementing height levels is a large engine+UI project — revisit after Milestone 4 if real games keep hitting it.
2. **Living rules data.** GW ships quarterly balance dataslates, points changes (Munitorum Field Manual), and errata. **Goal: by the end of Milestones 6–7, all rules content (points, abilities, detachments, stratagems, missions) is versioned data files, not code**, so an update is a data drop. Stamp army lists and saves with the data version they were built against, and warn on mismatch. Until then, updates are code changes — acceptable for two factions, not for twenty-seven.
3. **Mission deck placement.** Pariah-Nexus-style matched play (fixed vs tactical secondaries drawn per turn, gambits, mission rules) is core to how 40k is actually played, not a stretch goal. **Decision: secondary/mission-deck support graduates out of stretch and into mission-system work as soon as M6's extensible scoring lands** — sequence it alongside Milestone 7. Until then the 3 starter missions with primary-only scoring are the supported mode.

---

## Suggested execution order

1. **M1** (rules truth) — small diffs, makes the engine honest. Do first.
2. **M2** (mount orphaned UI) — mostly wiring; ends with a game that ends.
3. **M3** (multiplayer integrity, incl. server dice) — required before anyone plays a real opponent.
4. **M5 partially** (server/client tests) — land alongside M3, not after.
5. **M4** (guided flow) — the experience milestone; biggest perceived-quality jump.
6. **M6 + M7** — data-driven effect schema, then datasheet abilities on top of it (these interleave; the sample-army ability library is the proving ground). Mission deck work starts when M6 scoring lands.
7. **M8** — scale factions on the now-data-driven plumbing.
8. **M9** as desired.

## Review log

- **2026-06-12** — Full repo review (this document's founding audit). 631/631 core tests pass; typecheck clean. Found: 9 unmounted components, 4 unenforced "complete" rules, multiplayer permission/undo/persistence blockers, zero client/server tests. Prior plan docs archived to `docs/archive/`.
- **2026-06-12 (amended)** — Gap analysis against "full 40k system": added Milestone 7 (datasheet abilities & enhancement effects — the largest content gap, ~80% of rules volume lives on datasheets), server-authoritative dice to M3, and the Scope decisions section (2D abstraction, living rules data, mission deck). Faction expansion renumbered to M8, stretch to M9.
