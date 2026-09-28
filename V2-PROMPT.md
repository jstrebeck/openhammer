# OpenHammer v2 — Build Prompt

You are building **OpenHammer v2**: a web-based client and server for hosting and playing full games of Warhammer 40k 10th Edition between two human players in the browser.

**North star:** two humans play a complete, fair, friction-free game of 10th Edition in a browser — real rules enforcement, automatic dice and scoring, nothing to remember, nothing to look up.

---

## Repository context — read these before writing code

- `10th-edition-game-flow.md` — authoritative description of the full game flow, phase by phase, including what the Active and Reactive player can do at every step and what state must be tracked. This is your spec for the game loop.
- `10th-edition-rules-checklist.md` — itemized core-rules spec. Treat it as a **spec, not a tracker** — its checkboxes are not maintained.
- `samples/tau-empire-1000.json` and `samples/astra-militarum-1000.json` — real BattleScribe/New Recruit roster JSON exports. The importer must parse exactly this format.
- `v1/` — a previous implementation. **Do not build on it or import it wholesale.** Use it as a reference quarry: its `packages/core` has well-tested pure utilities (edge-to-edge measurement, LoS segment/polygon math, dice expression parsing, wound thresholds) and 631 tests you may port and adapt. Critically, read `v1/PLAN.md` — it is the post-mortem of what went wrong (see "Lessons from v1" below) and you must not repeat those failures.

Build v2 at the repository root (e.g., `packages/` alongside `v1/`), as a fresh TypeScript monorepo. Do not modify anything inside `v1/`.

---

## The defining architectural requirement: data-driven rules

This is the reason v2 exists. In v1, faction rules, weapon abilities, stratagems, and detachments were implemented as hard-coded TypeScript (`factionModifiers.ts`, switch statements on ability names). That made every GW balance dataslate a code change and made supporting other editions impossible.

In v2, **rules are content, not code**. The engine is a generic interpreter; everything that GW publishes and changes lives in data files that a non-programmer could edit.

### Content packs

All game content ships as versioned JSON (or JSON-producing TS data modules with a JSON schema — JSON on disk preferred) organized as **content packs**:

```
content/
  editions/
    wh40k-10e/
      edition.json          # phase sequence, turn structure, core mechanic parameters
      core-rules.json       # engagement range, coherency, cover rules, battle-shock, etc. as parameters + effects
      weapon-abilities.json # Rapid Fire, Sustained Hits, Lethal Hits, Blast, Torrent, Melta, Anti-X, ... as effect definitions
      core-stratagems.json  # the 11 core stratagems as data (cost, timing window, effect)
      missions/
        leviathan/          # deployment maps, objective layouts, primary scoring rules — as data
  factions/
    wh40k-10e/
      tau-empire/
        faction.json        # army rule (For the Greater Good) as effect data
        datasheets/*.json   # one file per datasheet: statlines, weapons, abilities, keywords, points
        detachments/*.json  # detachment rule, enhancements, stratagems
      astra-militarum/
        ...                 # same shape; Orders are faction mechanics expressed as effects
```

Packs are loaded at runtime (server reads them at startup / on demand; client receives the resolved content for the game). Adding a faction, updating points after a dataslate, or adding a new edition must require **only adding/editing content files** — zero engine changes — for everything expressible in the effect system.

"Versioned" means each pack declares a `version` (e.g., the dataslate date it reflects) and the schema version it targets; the loader rejects packs targeting an incompatible schema version with a clear error. A running game pins the pack versions it started with.

### The effect system

Design a declarative effect schema that abilities, stratagems, detachment rules, orders, and enhancements are written in. Shape (adapt as needed):

```jsonc
{
  "id": "tau.for-the-greater-good.guided",
  "trigger": "beforeHitRoll",                  // a named hook the engine fires
  "condition": { "attackerHas": "guided-by-spotter", "weaponType": "ranged" },
  "effect": { "setCriticalHitOn": 5 },         // a vocabulary of primitive effects
  "duration": "phase",                          // instant | phase | round | game
  "scope": "unit"
}
```

Requirements:

- The engine exposes a fixed set of **hooks** covering the attack sequence (attacks count, hit, wound, allocate, save, damage, FNP), movement (move distance, advance, charge, fall back), targeting/eligibility, deployment, command phase, and scoring. Hooks receive a context object (attacker, defender, weapon, phase, board state) and effects are pure modifications to it.
- A vocabulary of **effect primitives**: numeric modifiers, re-rolls, set-value, critical thresholds, grant/remove keyword or ability, mortal wounds, CP changes, aura (range-based condition), once-per-X usage limits, etc. Grow the vocabulary as Tau + AM demand it — the test of a good vocabulary is that both factions' rules fit in data.
- **Resolution semantics — specify these up front, not ad hoc:**
  - A deterministic order when multiple effects fire on the same hook (e.g., set-value effects resolve before additive modifiers; ties broken by a defined ordering such as active player first, then content-pack declaration order). The same game state must always produce the same result.
  - 10th Edition's **net ±1 cap on hit-roll and wound-roll modifiers** is itself a core rule: it lives in `core-rules.json` as a parameter and the interpreter enforces it after summing modifiers. Re-rolls and critical-threshold changes are not modifiers and are not capped.
  - Durations have defined cleanup points: the engine fires explicit expiry hooks (end of phase, end of turn, end of round, end of battle) and removes expired effects there — no effect may linger because nothing swept it.
  - Once-per-X usage (once per battle, once per turn, one stratagem per phase, etc.) is tracked by the engine against the effect's declared limit, not by each effect privately.
- **Escape hatch:** some abilities are too weird for any schema. Allow an effect to reference a `scriptId` resolved against a registry of TS functions, kept inside the faction's pack directory. Budget: under ~10% of abilities should need scripts. Every script must still declare its hook and timing in data so the UI can surface it.
- **Validation:** ship JSON Schemas for every content file type and a `validate-content` CLI/test that fails CI on malformed packs. A typo in a datasheet should be a build error, not a runtime mystery.
- The edition is a content pack too: phase order, scoring cadence, and core parameters come from `edition.json`, so a future 9th/11th edition pack changes data, not the reducer.

### Roster import

Players upload BattleScribe / New Recruit roster JSON (the format in `samples/`). The importer:

1. Parses the roster structure (`roster.forces[].selections[]`, nested selections, `profiles` with `characteristics` using the `$text` convention).
2. **Matches each selection to a datasheet in the faction content pack by name** (with fuzzy/alias matching — packs may declare name aliases). The content pack is the source of truth for rules; the roster supplies unit composition, wargear choices, enhancements, and points.
3. Reports a clear, human-readable list of anything it could not match, and lets the player proceed with unmatched units as stat-only tokens (warn, don't block).
4. Validates points totals and flags mismatches.

Round-trip both sample files as importer tests.

---

## Scope for this build

- **Editions:** 10th Edition only, but through the edition-pack abstraction described above.
- **Factions:** T'au Empire and Astra Militarum only. **Hard requirement:** army rule, all four detachments each (rule + enhancements + stratagems), Orders for AM, and every datasheet/weapon/ability used by the two sample lists, verified by an automated coverage test. **Stretch goal, explicitly out of the definition of done:** the full faction indexes. Nothing in the engine may special-case "Tau" or "Astra Militarum" by name.
- **Content sourcing:** bootstrap the mechanical halves of the packs from existing community data rather than typing them by hand:
  - **Primary: BSData `wh40k-10e`** (https://github.com/BSData/wh40k-10e) — the BattleScribe/New Recruit catalogues (`.cat`/`.gst` XML). The sample rosters were exported from this data, so unit/weapon/wargear names match the importer by construction. Write a one-time conversion script (a dev tool, not part of the engine) that generates pack skeletons from it: statlines, weapon profiles, points, keywords, unit composition, detachment/enhancement listings.
  - **Cross-check: Wahapedia's data export** (https://wahapedia.ru/wh40k10ed/the-rules/data-export/) — pipe-delimited CSVs; useful for stratagem timing/phase metadata and for verifying stats. Names occasionally differ from BSData; the pack's alias list absorbs that.
  - **Effect definitions cannot be sourced — they are hand-authored.** No existing dataset encodes 40k rules as structured effects; both sources carry abilities only as prose. Translating that prose into the effect schema is the real authoring work item — budget real time for it.
  - Both sources are community transcriptions of GW IP with no formal license. Do not embed their verbatim rules prose in packs; keep numbers, keywords, and effect data, with an optional short paraphrase field for the UI.
- **Missions:** the Leviathan/standard mission structure as data — deployment zone maps (Dawn of War, Hammer and Anvil, Search and Destroy at minimum), objective layouts, and primary mission scoring (e.g., Take and Hold). Secondary missions are a stretch goal; design the mission schema so fixed and tactical secondaries can be added as data later.
- **Players:** two humans over the network (server-authoritative). No AI opponent.

## Automatic mission and score tracking

The game must know who is winning without players doing bookkeeping:

- At the cadence the mission data defines (e.g., from the second battle round, at the start of each Command Phase), the engine computes objective control (OC sums within range, battle-shocked units count 0) and awards primary VP automatically, logging the math ("Player 1 holds objectives 2 and 4 → 10 VP").
- A persistent scoreboard UI shows: current VP for both players, CP, battle round and phase, objectives held (live, with colored markers on the board), and units destroyed.
- End of battle (after round 5 or concession) shows a results screen with the final score, winner, and a per-round VP breakdown.
- Painted-army bonus and mission-specific scoring quirks come from mission/edition data, not code.

## Client and rendering

- **Use a 3D renderer (Three.js) from day one, with a top-down orthographic camera as the default view.** The deliberate reason: a future release will let players rotate/tilt the camera to judge how terrain height affects line of sight, and true-LoS needs 3D geometry. Building 2D-first (as v1 did with PixiJS) would force a rewrite. Keep the default UX strictly top-down — pan, zoom-to-cursor, no rotation required to play — but represent the board, terrain (with heights), and models (cylinders on correct base sizes, height per model category) in 3D world space, and compute LoS with 3D raycasts. Raycasts are the geometric baseline, **not the final answer**: 10th Edition terrain rules deliberately diverge from pure geometry (ruins block visibility through their footprint even where the mesh has windows or gaps; abilities like Towering override that), so terrain traits and abilities in content data must be able to override or augment the raycast result. The LoS indicator shown to players must reflect the rules answer, not raw geometry.
- Board: mission-defined dimensions (44"×60" Strike Force default), deployment zone overlays, numbered objective markers with 3" control-radius rings, terrain placement from templates (ruins, woods, hills, barricades) with traits and heights.
- Models/units: drag to move with live distance readout and max-move ring, selection shows the unit's full datasheet card, wound counters, coherency warnings.
- Phase-driven UI: the interface should make the legal next action obvious — a phase tracker, per-phase action panels (move/advance/fall back; declare targets and roll; charge; fight), and prompts on the **reactive** player's screen when it is their decision (saves, FNP, overwatch-style stratagem windows, fight-phase alternation).
- Dice: all rolls performed by the server, shown with clear breakdowns (hits → wounds → saves → damage), and a full game log.

## Server

- TypeScript, WebSocket-based rooms. The server owns the game state: a pure reducer over serializable actions, with the server validating **every** action against the rules engine and the acting player's identity/turn before applying. Reject out-of-turn or illegal actions (this was a v1 hole — any client could advance phases).
- Rules enforcement levels (off/warn/enforce) per category, but **default new games to enforce** with the setup flow offering "Casual (warn)" explicitly.
- **Reactive decision windows are a defined protocol, not an afterthought.** When a hook opens a window in which the reactive player has at least one eligible option (saves, FNP, Overwatch-style stratagems, fight interrupts), the server pauses the sequence and prompts that player; windows with zero eligible options are skipped silently, never shown. Each prompt offers the eligible actions plus "pass"; players can set standing preferences ("don't ask me about Overwatch again this phase" / "auto-roll my saves with no rerolls available") that auto-pass matching windows. No hard timeout by default — this is a two-human game — but the waiting player sees who the game is waiting on and for what.
- **Undo/takeback** rides on the action log: rewinding N actions is a replay. Free undo of your own actions before any dice are rolled or hidden information is revealed by them; after that, undo requires opponent approval (a one-click request/grant flow). Dice results are never re-rolled by an undo that doesn't reach back past them.
- Persistence: games survive a server restart (serialize room state to disk or SQLite) and a browser refresh (reconnect by session token restores the client).
- Spectators read-only; chat; reconnection.

---

## Lessons from v1 — these are requirements, not suggestions

v1's post-mortem (`v1/PLAN.md`) found nine fully-built React components that were never mounted, rules that were implemented but never invoked, and enforcement that defaulted to off. Therefore:

1. **Definition of done:** a feature is done when a player can reach it in the UI **and** the rule changes the dice or state in a real game. "Implemented in the engine" is not done. Never report a checklist item complete without citing the UI path and a test.
2. **Vertical slices, not layers.** Build thin end-to-end slices (e.g., "one unit moves and shoots one target through the full UI with server validation") before broadening. Do not build the whole engine and then start the client.
3. **Test the wiring.** Engine unit tests are necessary but v1's failures were all in the integration layer. Include client component tests for the action panels and at least one scripted full-game integration test (deployment → 5 rounds → winner) that exercises the real client-side dispatch path against the real server reducer. Add server tests for action validation (out-of-turn rejection, illegal moves).
4. **No orphaned code.** CI or a lint check should flag exported components/functions with zero importers.
5. Maintain a single living `PLAN.md` for v2 with evidence-cited checkmarks (file:line or test name), in the style of `v1/PLAN.md`'s legend.

## Suggested stack (deviate with justification)

- Monorepo: `packages/core` (pure engine + effect interpreter, zero DOM deps), `packages/content` (content packs + schemas + validator), `packages/server` (Node, ws), `packages/client` (React, Three.js via react-three-fiber, Zustand, Tailwind). Vitest everywhere.
- Keep `core` free of any faction or edition knowledge — it interprets content packs.

## Milestone order

1. **Foundations:** monorepo, content-pack schemas + validator, effect-system core with hook engine, edition pack for 10e core (phases, measurement, dice), board/state types, server rooms with authoritative reducer.
2. **First vertical slice:** import both sample rosters, deploy on a 3D top-down board with terrain and objectives, move a unit, shoot with the attack pipeline driven end-to-end through the effect interpreter (defender rolls saves interactively) — a starter set of weapon abilities is enough; the full vocabulary grows in milestone 4. All through the UI in a two-browser game. Pre-game here is minimal: attacker/defender roll-off and alternating deployment onto pre-placed terrain.
3. **Full game loop:** the complete pre-game sequence (terrain placement from templates, detachment confirmation, leader attachment declarations, transport embarkation, reserves) and all phases per `10th-edition-game-flow.md` (command/battle-shock, movement incl. advance/fall back/reserves/transports, shooting, charge, fight with alternation), morale, leaders/attached units, core stratagems with reactive-player windows.
4. **Factions complete:** both faction packs fully authored and enforced (army rules, detachments, enhancements, stratagems, Orders), datasheet coverage for both sample lists verified by an automated content-coverage test.
5. **Missions & scoring:** mission data, automatic primary scoring, scoreboard, end-of-battle screen, per-round breakdown.
6. **Hardening:** persistence/reconnect, enforcement defaults, fairness validation, the scripted five-round integration test, content `validate` in CI.

Work milestone by milestone. At the end of each, run the app and verify the slice in a real browser session before moving on, and update `PLAN.md` with evidence.
