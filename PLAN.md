# OpenHammer v2 — Living Plan

**North star:** two humans play a complete, fair, friction-free game of 10th Edition in a browser — real rules enforcement, automatic dice and scoring, nothing to remember, nothing to look up.

## Legend (from v1's post-mortem — evidence or it didn't happen)

- `[x]` Done — **must** cite evidence: `file:line`, a test name, or a UI path. "Implemented in the engine" is not done; a feature is done when a player can reach it in the UI **and** it changes dice or state in a real game.
- `[~]` Partially done — cite what exists and name the gap.
- `[ ]` Not started.

Rules that bit v1 and are binding here:

1. Vertical slices, not layers. No building the whole engine before the client.
2. Test the wiring, not just the units — client dispatch → server reducer integration tests.
3. No orphaned code — exported symbols with zero importers get deleted or wired.
4. Engine knows no faction or edition by name; everything GW publishes lives in `content/`.

---

## Milestone 1 — Foundations ✅ (engine/content/server side complete)

- [x] Monorepo scaffolding: root workspaces + strict TS + vitest projects — `package.json`, `tsconfig.base.json`, `vitest.config.ts`; `packages/{core,content,server}` all build (`tsc -b` clean) and test green (148 tests across 9 files).
- [x] Deterministic dice: seeded RNG threaded through state (`RngState{seed,counter}`), D6/D3/2D6, dice-expression parser ("2D6+1", "D3", flat) — `packages/core/src/dice/index.ts`, tests `dice.test.ts` (deterministic replay, sequential-draw equivalence).
- [x] Measurement & LoS pure math ported from v1 (edge-to-edge base distance, inclusive within-semantics, point/base-to-polygon, segment-vs-polygon intersection, multi-sight-line base visibility) — `packages/core/src/measurement/`, `packages/core/src/los/`, 56 tests. Round bases only for now; oval bases deferred.
- [x] **Effect system core**: fixed hook vocabulary (`HOOK_NAMES`, `packages/core/src/types/content.ts`), declarative conditions with combinators (`effects/conditions.ts`), effect-primitive vocabulary (~30 primitives), deterministic resolution order (set-value before modifiers, active player first, then pack declaration order — `orderCandidates`, tested in `engine.test.ts` "is deterministic regardless of input order").
- [x] Net ±1 hit/wound modifier cap lives in content (`edition.json parameters.modifierCaps`) and is enforced after summing — `cappedModifier` (`effects/engine.ts`), test `pipeline.test.ts` "applies the ±1 net cap to stacked modifiers".
- [x] Duration expiry sweeps (phase/turn/round/battle, nothing lingers) — `sweepExpiredEffects`, wired into the reducer at boundaries; test `reducer.test.ts` "clears turn flags and phase/turn effects at boundaries".
- [x] Centralized once-per-X usage counters with window sweeps — `canUse`/`recordUse`/`sweepUsageCounters` (`effects/engine.ts`).
- [x] Attack pipeline stages (attacks count incl. Blast/Rapid-Fire scaling, hit incl. crits/rerolls/sustained/lethal, wound incl. S-vs-T table/anti-X/devastating, save incl. AP/invuln/cover cap, damage incl. Melta/minimum, FNP) — `packages/core/src/attack/pipeline.ts`, 26 tests in `pipeline.test.ts`.
- [x] Board/state types (units, models, tokens, reserves, attached units, pending-decision protocol scaffold, enforcement config defaulting to `enforce`) — `packages/core/src/types/state.ts`, `state/initialState.ts`.
- [x] Phase machine driven entirely by `edition.json` (reducer names no phase): step→phase→turn→round→battle-end walk with CP accrual and boundary sweeps — `packages/core/src/state/reducer.ts`; tests include a full 5-round skeleton game to a winner.
- [x] Content-pack schemas for every file type (edition, core-rules, weapon-abilities, stratagems, deployment-maps, missions, datasheet, detachment, faction) — `packages/content/schemas/*.schema.json`; consistency test locks the schema hook enum to core `HOOK_NAMES` (`loader.test.ts`).
- [x] Content loader with schema-version gate, declaration-order assignment, `$X`/`$KEYWORD` parameter substitution — `packages/content/src/loader.ts`, tests in `loader.test.ts`.
- [x] `validate-content` CLI (fails non-zero on malformed packs; run `npm run validate-content`) — `packages/content/src/cli.ts`. **TODO: wire into CI when CI exists.**
- [x] 10e edition pack: `content/editions/wh40k-10e/` — `edition.json` (phases, 20 core parameters), `weapon-abilities.json` (all 20 universal abilities as effects), `core-rules.json` (9 universal unit abilities), `core-stratagems.json` (all 11 core stratagems with timing windows from the game-flow doc), `missions/leviathan/` (3 deployment maps, Take and Hold scoring as data).
- [x] Server rooms with authoritative reducer: seat tokens, **client player-index overwritten by seat** (spoof-proof), out-of-turn/pending-decision/ended rejection codes, action log, reconnect by token, spectators read-only, chat, room persistence to disk surviving restart — `packages/server/src/rooms.ts`, `server.ts`; `rooms.test.ts` + `server.test.ts` (real two-client WebSocket session).

### Known debts carried out of milestone 1

- Script-registry effects (`scriptId`) are declared in data (6 core stratagems reference them) but the registry/execution layer does not exist yet — needed in milestone 3.
- `PendingDecision` exists in state and gates the reducer, but nothing opens windows yet (milestone 2/3).
- Blast's "cannot target units in engagement" uses a script-condition placeholder pending targeting-eligibility context (milestone 2).
- CLI `fileCount` is informational only; deployment-map polygon for Search & Destroy approximates the 9"-from-center arc with a conservative chamfer.
- Structural abilities (`Deep Strike`, `Leader`, `Scout`, …) are data with a `structural` marker; engine protocols for them land in milestone 3.

---

## Milestone 2 — First vertical slice (NEXT)

Import both sample rosters → deploy on a 3D top-down board (terrain + objectives pre-placed) → move a unit with live distance readout → shoot through the full effect-interpreter pipeline with interactive defender saves → all in a two-browser game against the real server.

- [ ] Roster importer: parse `samples/*.json` (`forces[].selections[]`, `profiles`/`characteristics` `$text`), match by name+aliases to datasheets, unmatched → stat-only tokens (warn, don't block), points validation. Round-trip both samples as tests.
- [ ] Minimal faction packs for the two sample lists (datasheets + weapons only; full rules in milestone 4) bootstrapped from BSData `wh40k-10e` via a one-time conversion script (dev tool, not engine).
- [ ] `packages/client`: React + react-three-fiber + Zustand + Tailwind; Three.js orthographic top-down board (44"×60), pan/zoom-to-cursor, deployment-zone overlays, objective markers with 3" rings, models as cylinders on correct base sizes.
- [ ] Deployment flow: attacker/defender roll-off, alternating unit placement with zone validation.
- [ ] Movement: drag with live distance readout, max-move ring, server-validated Normal/Advance/Stationary.
- [ ] Shooting slice: target declaration (range + LoS), attack pipeline server-side with dice breakdowns in the log, reactive save prompt on the defender's screen (the pending-decision protocol, for real).
- [ ] Client component tests for action panels + one scripted integration test through the client dispatch path.

## Milestone 3 — Full game loop

- [ ] Pre-game sequence as data-driven steps (terrain templates, detachment confirm, leader attach, transports, reserves; Scout moves).
- [ ] All phases per `10th-edition-game-flow.md`: battle-shock, advance/fall-back/desperate-escape, reserves arrival, charge (2D6, target-only engagement, base-to-base), fight alternation (Fights First step, pile-in 3", consolidate 3", reactive player selects first), morale, coherency end-of-turn removal.
- [ ] Script registry + the 6 scripted core stratagems; reactive stratagem windows per the timing table (skip silently when zero eligible options; standing preferences; "waiting on X" indicator).
- [ ] Undo/takeback riding the action log (free before dice/reveals, opponent-approved after).

## Milestone 4 — Factions complete

- [ ] Both faction packs fully authored: army rules (For the Greater Good as guided/spotter tokens; Voice of Command as Orders → token effects), all 4 detachments each (rule + enhancements + stratagems), every datasheet/weapon/ability in the sample lists.
- [ ] Automated content-coverage test: every unit/weapon/ability named in `samples/*.json` resolves to pack content.
- [ ] Wahapedia CSV cross-check for stats/points; alias lists absorb naming drift.

## Milestone 5 — Missions & scoring

- [ ] Automatic primary scoring at the data-defined cadence with logged math ("P1 holds 2 and 4 → 10 VP"), scoreboard UI (VP/CP/round/phase/objectives-held live), end-of-battle screen with per-round breakdown, painted-army bonus from mission data.

## Milestone 6 — Hardening

- [ ] Persistence/reconnect polish, enforcement-level setup flow (default enforce, "Casual (warn)" offered), fairness validation, scripted five-round two-client integration test, `validate-content` + orphan-export lint in CI.
