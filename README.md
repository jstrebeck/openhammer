# OpenHammer

**OpenHammer is a test project for evaluating foundational models.** It exists to put frontier and open-source models from every major provider through the same non-trivial engineering task and compare how they perform. The task is deliberately hard to fake: build a working, rules-enforcing, two-player Warhammer 40,000 10th Edition game in the browser, from a written specification, without hand-holding.

The domain was chosen because it stresses the things that separate strong models from weak ones:

- **A large, precise rulebook** with hundreds of interacting edge cases. Getting the attack sequence, modifier caps, or objective-control math subtly wrong is easy and testable.
- **A long-horizon build** across six milestones, where the model has to keep a plan honest, carry debts forward, and not declare victory early.
- **Architecture discipline.** The spec demands rules-as-data, a faction-neutral engine, and vertical slices. Models that drift back into hard-coded switch statements or build an engine nobody can reach from the UI are caught by tests and lints.
- **Real verification.** "Done" means a player can reach the feature in a two-browser session against the real server and it changes dice or state.

The repository holds two attempts at the same goal. `v1/` is an earlier implementation kept read-only as a reference and a post-mortem. The root of the repo is **v2**, built from scratch against `V2-PROMPT.md`. `PLAN.md` is the living tracker for v2 and records evidence for every checked item.

---

## What the game does

Two humans play a complete game of 10th Edition over the network with a server-authoritative rules engine:

- Upload BattleScribe / New Recruit roster JSON; units are matched to datasheets in a content pack.
- Roll-off, attacker/defender choice, alternating deployment, reserves, leader attachment, Scout moves.
- Full turn loop: Command (CP, battle-shock), Movement (normal/advance/fall back, Desperate Escape, reinforcements), Shooting (full attack pipeline with interactive defender saves and per-wound allocation), Charge (2D6 rolls, overwatch and reactive windows), Fight (fights-first ordering, pile-in, consolidate).
- Reactive stratagem windows for both players, core and detachment stratagems, army rules (For the Greater Good, Voice of Command orders), enhancements.
- Automatic primary scoring at the mission's declared cadence, live objective control on the board, end-of-battle results with a per-round breakdown.
- Undo/takeback with opponent approval when dice were consumed.
- A 3D top-down board (Three.js) with terrain heights, deployment zones, objective rings, live move distance, and rules-aware line of sight.

Scope is the two factions used by the sample rosters (T'au Empire and Astra Militarum), all four detachments each, and the Leviathan mission structure.

---

## Architecture

### The defining rule: rules are content, not code

v1 encoded faction rules as TypeScript (`factionModifiers.ts`, switch statements on ability names). Every balance dataslate was a code change and other editions were impossible. v2 inverts this: the engine is a **generic interpreter** and everything Games Workshop publishes lives in JSON content packs under `content/`.

```
content/
  editions/wh40k-10e/
    edition.json            # phase/step sequence (by kind), core parameters, modifier caps
    core-rules.json         # universal unit abilities as effects
    weapon-abilities.json   # Rapid Fire, Blast, Lethal Hits, Melta, Anti-X, ... as effects
    core-stratagems.json    # the 11 core stratagems with timing windows
    missions/leviathan/     # deployment maps, terrain layouts, primary scoring as data
  factions/wh40k-10e/
    tau-empire/
      faction.json          # army rule + faction mechanics as effect data
      datasheets/*.json     # statlines, weapons, abilities, keywords, points
      detachments/*.json    # detachment rule, enhancements, stratagems
    astra-militarum/        # same shape
```

Every content file type has a JSON Schema in `packages/content/schemas/`, and `validate-content` fails CI on a malformed pack. Packs declare a `version` and a `schemaVersion`; the loader rejects incompatible packs. An **engine-neutrality test** fails if `packages/core` ever names a faction.

### The effect system

Abilities, stratagems, orders, enhancements and detachment rules are all written in one declarative effect schema:

```jsonc
{
  "id": "tau.ftgg.guided-bs",
  "trigger": "attack.beforeHitRoll",          // a hook the engine fires
  "condition": { "all": [ { "weaponType": "ranged" }, { "targetHasToken": "spotted" } ] },
  "effects": [ { "type": "modifyCharacteristic", "stat": "BS", "value": -1 } ]
}
```

Key design decisions, all specified up front rather than ad hoc:

- **Fixed hook vocabulary** covering the attack sequence, movement, targeting/eligibility, deployment, command phase and scoring.
- **Deterministic resolution order.** Set-value effects resolve before additive modifiers; ties break by active player, then pack declaration order. Same state and seed always produce the same result.
- **The ±1 net modifier cap** is a parameter in `edition.json`, enforced after summing. Re-rolls and critical thresholds are not modifiers and are not capped.
- **Durations with explicit expiry sweeps** at phase, turn, round and battle boundaries. Nothing lingers.
- **Centralized once-per-X usage counters** tracked by the engine, not by each effect.
- **Script escape hatch.** Abilities too odd for the schema reference a `scriptId` resolved from a registry in the content package. Scripts still declare their hook and timing in data. Deferred scripts are marked `todo.*` and are never offered in play.

### Monorepo layout

npm workspaces, strict TypeScript, vitest projects. Each package has its own tests.

| Package | Role |
| --- | --- |
| `packages/core` | Pure rules engine. No I/O, no faction names. Seeded RNG, dice expressions, edge-to-edge measurement and LoS geometry, the effect interpreter, the attack pipeline, and the phase-driven reducer (`reducer.ts` plus per-phase reducers for setup, movement, shooting, charge, fight, windows and abilities). Scoring and battle-shock live here too. |
| `packages/content` | Loads and validates packs (Ajv), substitutes `$X`/`$KEYWORD` parameters, imports rosters with alias matching, hosts the script registry, and ships the `validate-content` CLI and a coverage test that gates both sample lists. |
| `packages/server` | WebSocket server (`ws`). Rooms with seat tokens, spoof-proof player indices, out-of-turn and pending-decision rejection, action log, reconnect, spectators, chat, undo by replay, and room persistence to disk. Materializes imported rosters into unit state. |
| `packages/client` | React + react-three-fiber + Zustand. Lobby, orthographic top-down board, contextual per-phase action panels, save and stratagem prompts, faction ability panels, scoreboard, log, end screen. Component tests plus a real-wire integration test. |
| `scripts/check-orphans.mjs` | Lint that fails CI on exported symbols nothing imports. Written because v1 shipped nine React components that were never mounted. |

### Data flow

```
Roster JSON ──► importer (content) ──► materialize (server) ──► GameState
                                                                    │
Browser ──action──► ws ──► room validates seat/turn ──► core reducer ──► new state
   ▲                                                       │
   └──────────────── state broadcast to both seats + spectators ◄──┘
```

Clients only ever **propose** actions. The server applies them through the reducer against the sender's real seat, rolls all dice server-side from a seeded RNG, and broadcasts the resulting state. Pending decisions (saves, stratagem windows, undo approvals) block the reducer until the correct player answers.

### Rendering and line of sight

The client uses Three.js from day one with a locked top-down orthographic camera. Terrain has real heights and models are cylinders on correct base sizes, so a future release can tilt the camera for true-LoS judgement. Raycasts are the geometric baseline only: terrain traits from content (for example ruins blocking visibility through their footprint) override the raw geometry, and the indicator shown to players reflects the rules answer.

---

## Build lessons enforced by the codebase

These come from the v1 post-mortem (`v1/PLAN.md`) and are binding in v2:

1. **Vertical slices, not layers.** No building the whole engine before the client.
2. **Test the wiring, not just the units.** Client dispatch to server reducer integration tests, plus two-browser verification for each milestone.
3. **No orphaned code.** The orphan-export lint runs in CI.
4. **The engine knows no faction or edition by name.** Enforced by test.
5. **Evidence or it did not happen.** Every `[x]` in `PLAN.md` cites a file, test, or UI path.

---

## Getting started

Requires Node 22.

```bash
npm ci
npm run validate-content        # schema-check every content pack
npm run typecheck
npm test                        # full vitest suite across all packages
npm run check-orphans
```

Run the game locally in two terminals:

```bash
npm run dev -w packages/server  # ws://localhost:8787 (PORT to override)
npm run dev -w packages/client  # http://localhost:5173 (VITE_WS_URL to point elsewhere)
```

Open the client in two browsers, create a room in one and join from the other, then upload `samples/tau-empire-1000.json` and `samples/astra-militarum-1000.json`.

CI (`.github/workflows/ci.yml`) runs content validation, both typechecks, the orphan lint, the full test suite and the client build on every push and pull request.

---

## Repository map

| Path | Purpose |
| --- | --- |
| `V2-PROMPT.md` | The build specification given to the model. |
| `PLAN.md` | Living milestone tracker with evidence for every completed item and a ledger of carried debts. |
| `10th-edition-game-flow.md` | Authoritative phase-by-phase description of the game loop. |
| `10th-edition-rules-checklist.md` | Itemized core-rules spec. |
| `content/` | All editions, factions, missions and rules as versioned JSON. |
| `packages/` | The v2 monorepo (core, content, server, client). |
| `samples/` | Real roster exports the importer must parse exactly. |
| `scripts/` | Repo-level tooling (orphan lint). |
| `v1/` | Previous implementation. Read-only reference and post-mortem. Do not build on it. |

## Status

All six milestones from the build prompt are complete, plus per-wound allocation choice. The remaining backlog is feature work beyond the original definition of done and is listed at the end of `PLAN.md`: deferred stratagem scripts, transports and FLY, oval bases, sticky objectives, and a BSData converter for full faction indexes.

## Content licensing note

Content packs contain numbers, keywords and effect data only, with short paraphrases for the UI. No verbatim rules prose from Games Workshop or community transcriptions is stored.
