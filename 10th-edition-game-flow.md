# Warhammer 40K 10th Edition — Complete Game Flow Reference

This document describes the full flow of a Warhammer 40K 10th Edition game from pre-game setup through every phase of every turn. For each step, it specifies exactly what the **Active Player** (the player whose turn it is) and the **Reactive Player** (the opponent) can and cannot do.

Use this as the authoritative reference for implementing game logic, UI state, and phase transitions in OpenHammer.

---

## Table of Contents

1. [Pre-Game Setup](#1-pre-game-setup)
2. [Battle Round Structure](#2-battle-round-structure)
3. [Command Phase](#3-command-phase)
4. [Movement Phase](#4-movement-phase)
5. [Shooting Phase](#5-shooting-phase)
6. [Charge Phase](#6-charge-phase)
7. [Fight Phase](#7-fight-phase)
8. [End of Turn](#8-end-of-turn)
9. [End of Battle Round](#9-end-of-battle-round)
10. [End of Battle](#10-end-of-battle)
11. [Stratagem Windows](#11-stratagem-windows)
12. [State Tracking Summary](#12-state-tracking-summary)

---

## 1. Pre-Game Setup

Pre-game setup happens before the first battle round begins. The mission being played determines most of these steps, but the core sequence is consistent.

### 1.1 Muster Armies

Each player builds their army:

- Select an Army Faction (all units must share a Faction keyword).
- Choose a Detachment (determines Detachment rules, Stratagems, and Enhancements).
- Select units up to the mission's points limit.
- Designate one model as the Warlord.
- Assign any Enhancements to eligible CHARACTER models (max 1 per model, each Enhancement used only once).
- Attach any Leader CHARACTER units to their eligible Bodyguard units to form Attached units.
- Declare which units (if any) are placed into Strategic Reserves (cannot exceed 25% of total points; no Fortifications).
- Declare any units using deployment abilities (Deep Strike, Infiltrators, etc.).

**OpenHammer state to track:** Army list loaded and validated, Leader attachments formed, Reserves designations recorded, Starting Strength calculated for every unit (including Attached unit combined totals).

### 1.2 Create the Battlefield

- Set up the battlefield to the mission's specified size (e.g., 44"×60" for Strike Force).
- Place terrain features.
- Place objective markers per the mission map.

**OpenHammer state to track:** Board dimensions, terrain piece positions with types/traits/heights, objective marker positions.

### 1.3 Determine Attacker and Defender

- Players roll off. The winner chooses to be either the Attacker or Defender.
- The mission specifies what each role means for deployment zones and other setup steps.

### 1.4 Place Objective Markers

- Place objective markers per the mission instructions.
- No model can end a move on top of an objective marker.

### 1.5 Deploy Armies

- The mission tells you who deploys first (usually the Attacker).
- Players alternate deploying one unit at a time within their deployment zone.
- Units with **Infiltrators** can be set up anywhere on the battlefield more than 9" from the enemy deployment zone and all enemy models (deployed during the normal deployment alternation).
- Units in Reserves (Deep Strike, Strategic Reserves, AIRCRAFT without Hover) are not placed on the battlefield.

**OpenHammer state to track:** All model positions, which units are in Reserves, which units are on the battlefield.

### 1.6 Resolve Redeployments

- After all units are deployed, resolve any redeployment abilities (e.g., Huron Blackheart's Red Corsairs ability).
- Players alternate resolving redeployments, Attacker first.

### 1.7 Determine First Turn

- The mission determines how first turn is decided (typically the Attacker goes first, or players roll off).
- The player who goes first is Player 1 for the entire game — they always take the first turn in every battle round.

### 1.8 Resolve Scout Moves

- After first turn is determined, units with **Scout X"** can make a pre-game move of up to X inches.
- Must end more than 9" horizontally from all enemy models.
- Dedicated Transports inherit Scout if the embarked unit has it.

**OpenHammer state to track:** Updated model positions after Scout moves.

---

## 2. Battle Round Structure

The game is played in a series of **battle rounds** (typically 5 for a standard mission). Each battle round consists of two **player turns** — Player 1's turn, then Player 2's turn.

```
Battle Round N
├── Player 1's Turn (Player 1 = Active, Player 2 = Reactive)
│   ├── Command Phase
│   ├── Movement Phase
│   ├── Shooting Phase
│   ├── Charge Phase
│   └── Fight Phase
├── Player 2's Turn (Player 2 = Active, Player 1 = Reactive)
│   ├── Command Phase
│   ├── Movement Phase
│   ├── Shooting Phase
│   ├── Charge Phase
│   └── Fight Phase
└── End of Battle Round
```

At the start and end of each battle round, check for any mission-specific rules that trigger (e.g., scoring VP at the end of a battle round).

---

## 3. Command Phase

The Command Phase is the first phase of each player's turn. It has two steps.

### 3.1 Step 1: Command

**What happens:**
- Both players gain 1 Command Point (CP).
- Resolve any abilities that trigger "in the Command phase" or "at the start of your Command phase."

**Active Player CAN:**
- Gain 1 CP.
- Use any abilities that trigger in the Command phase.

**Reactive Player CAN:**
- Gain 1 CP.

**Reactive Player CANNOT:**
- Use the Active Player's Command phase triggers (only the Active Player resolves their own Command phase abilities).

**CP cap rule:** Outside of the 1 CP gained at the start of the Command Phase, each player can only gain a maximum of 1 additional CP per battle round total, regardless of source.

**OpenHammer state to track:** CP count for both players, any persisting effects that expire "at the start of your Command phase" should be cleared now.

### 3.2 Step 2: Battle-shock

**What happens:**
- The Active Player must take a Battle-shock test for each of their units on the battlefield that is **Below Half-strength**.

**How Below Half-strength works:**
- Multi-model unit: fewer than half of Starting Strength models remaining.
- Single model unit: remaining wounds less than half of Wounds characteristic.
- Attached unit: uses the combined Starting Strength.

**Battle-shock test:**
- Roll 2D6. If the result >= the unit's best Leadership (Ld) characteristic, the test is **passed**.
- If the result < the Ld, the test is **failed** and the unit is **Battle-shocked** until the start of the Active Player's next Command Phase.

**Battle-shocked effects (persist until cleared):**
- All models in the unit have OC 0.
- The controlling player cannot use Stratagems to affect the unit.
- If the unit Falls Back, take a Desperate Escape test for every model.

**Active Player CAN:**
- Use the **Insane Bravery (1 CP)** Stratagem immediately after failing a Battle-shock test to treat it as passed.

**Active Player CANNOT:**
- Skip Battle-shock tests for eligible units.

**Reactive Player CANNOT:**
- Do anything during this step (it is entirely the Active Player's step).

**OpenHammer state to track:** Battle-shocked status per unit, which units were tested. Clear any Battle-shocked status from the Active Player's units that was applied during their previous turn's Command Phase (the "until the start of your next Command phase" expiry).

---

## 4. Movement Phase

The Movement Phase is where the Active Player maneuvers their army. It has two steps.

### 4.1 Step 1: Move Units

The Active Player selects one unit at a time and chooses how it moves. After finishing that unit's move, they select another, until all units have been handled.

**For each unit, the Active Player must choose one of the following:**

#### If the unit is NOT within Engagement Range of any enemy:
| Move Type | Distance | Restrictions Applied This Turn |
|---|---|---|
| **Remain Stationary** | 0" | None — can shoot and charge normally. Heavy weapons get +1 to Hit. |
| **Normal Move** | Up to M" | Cannot move within Engagement Range of any enemy. |
| **Advance** | Up to M+D6" (roll once per unit) | Cannot move within Engagement Range. **Cannot shoot** (unless Assault weapons). **Cannot charge.** |

#### If the unit IS within Engagement Range of any enemy:
| Move Type | Distance | Restrictions Applied This Turn |
|---|---|---|
| **Remain Stationary** | 0" | None. |
| **Fall Back** | Up to M" | Can move through enemy Engagement Range but must end outside it. **Cannot shoot.** **Cannot charge.** Desperate Escape tests may apply. |

**Movement rules that always apply:**
- No part of a model's base can move through an enemy model.
- No part of a model's base can cross the battlefield edge.
- Models can move through friendly models but cannot end on top of them.
- MONSTER/VEHICLE cannot move through friendly MONSTER/VEHICLE.
- Terrain 2" or less: move freely over it.
- Terrain taller than 2": climb up/down, vertical distance counts toward total movement.
- Cannot end a move mid-climb.
- Pivoting: first pivot in a move subtracts the pivot value (0", 1", or 2" depending on model type); subsequent pivots in the same move cost nothing additional.

**FLY models (Normal, Advance, or Fall Back only):**
- Can move over enemy models as if they were not there.
- Can move within Engagement Range during the move (but cannot end within it unless the move type allows it — none do for Normal/Advance/Fall Back).
- FLY MONSTER/VEHICLE can also move over friendly MONSTER/VEHICLE.
- When starting or ending on terrain, measure distance "through the air" (diagonal).

**Fall Back — Desperate Escape tests:**
- For each model that moves over an enemy model during a Fall Back (except TITANIC or FLY), roll D6 before any models move. On 1–2, one model from the unit is destroyed (owning player chooses which).
- If the unit is Battle-shocked, take a Desperate Escape test for EVERY model in the unit (even those not moving over enemies).

**Transports — Embark:**
- A unit can embark into a friendly Transport if all its models end a Normal, Advance, or Fall Back move within 3" of that Transport.
- Cannot embark and disembark in the same phase.

**Transports — Disembark:**
- Only if the Transport has not Advanced or Fallen Back.
- Set up wholly within 3" of the Transport, not within Engagement Range of enemies.
- Disembark before Transport moves → unit acts normally.
- Disembark after Transport moves → unit cannot move or charge this turn, but can shoot and fight.
- Units that disembark do NOT count as having Remained Stationary.

**Active Player CAN:**
- Move each of their units one at a time in any order they choose.
- Choose different move types for different units.
- Embark/disembark from Transports.

**Active Player CANNOT:**
- Move the same unit more than once (unless a special rule grants a surge move).
- Make a Normal Move or Advance into Engagement Range of enemy models.
- Advance and then shoot (unless Assault weapons) or charge.
- Fall Back and then shoot or charge.

**Reactive Player CAN:**
- Use **Fire Overwatch (1 CP)** when an enemy unit is set up, starts, or ends a Normal, Advance, Fall Back, or Charge move — one of their units within 24" shoots as if it were the Reactive Player's Shooting Phase (only hits on unmodified 6s; once per turn).

**Reactive Player CANNOT:**
- Move any of their own units.
- Interfere with the Active Player's movement choices.

**OpenHammer state to track per unit:** Movement type chosen (stationary / normal / advance / fall back), updated positions, which units embarked/disembarked, Advance roll result, remaining movement budget during drag.

### 4.2 Step 2: Reinforcements

**What happens:**
- The Active Player selects Reserves units one at a time and sets them up on the battlefield.

**Rules:**
- Set up per the unit's ability (e.g., Deep Strike: more than 9" horizontally from all enemy models).
- Strategic Reserves: wholly within 6" of a battlefield edge; Round 2 cannot be in enemy deployment zone; Round 3+ any edge; always more than 9" from enemies.
- Reserves units count as having made a Normal Move (so they cannot make additional moves but CAN shoot unless the specific ability says otherwise).
- Any Reserves unit not set up by end of battle counts as destroyed.
- AIRCRAFT that are in Reserves can arrive starting Round 2 (follow Aircraft-specific placement rules).

**Active Player CAN:**
- Set up any or all of their Reserves units that are eligible to arrive this round.
- Choose not to set up some Reserves units (they stay in Reserves for a later round).

**Reactive Player CAN:**
- Use **Rapid Ingress (1 CP)** at the END of the Active Player's Movement Phase — set up one of the Reactive Player's own Reserves units as if it were the Reactive Player's Reinforcements step. Cannot arrive in a round the unit normally wouldn't be able to.

**Reactive Player CANNOT:**
- Prevent or modify the Active Player's Reserves placement.

**OpenHammer state to track:** Which Reserves units have arrived, their positions, mark them as having made a Normal Move.

---

## 5. Shooting Phase

The Active Player selects their units one at a time to shoot.

### 5.1 Select an Eligible Unit

A unit is **eligible to shoot** if:
- It did NOT Advance this turn (unless it has Assault weapons).
- It did NOT Fall Back this turn (unless a special rule allows it).
- It is NOT within Engagement Range of any enemy units (exception: Big Guns Never Tire / Pistols).

### 5.2 Select Targets for All Weapons

Before resolving any attacks, the Active Player declares ALL targets for ALL of the selected unit's weapons:
- For each weapon's attacks, at least one model in the target unit must be **visible** to the attacking model AND within the weapon's **range**.
- Different weapons on the same model can target different units.
- Different models in the same unit can target different units.
- Cannot split attacks from a single weapon profile across multiple targets.
- **Pistols**: can fire within Engagement Range but must target a unit within Engagement Range. Cannot fire alongside non-Pistol weapons (unless the model is a MONSTER or VEHICLE).
- **Big Guns Never Tire**: MONSTER and VEHICLE units can shoot while within Engagement Range. Subtract 1 from Hit roll for ranged attacks made by or targeting such units in Engagement Range (unless using a Pistol).

### 5.3 Resolve Attacks (per weapon, per target)

For each batch of attacks against a target:

**Step 1 — Hit Roll:** Roll D6 per attack. Must equal or beat the weapon's BS.
- Unmodified 6 = Critical Hit (always succeeds).
- Unmodified 1 = always fails.
- Hit roll can never be modified by more than +1 or -1.

**Step 2 — Wound Roll:** Roll D6 per hit. Compare weapon's Strength (S) to target's Toughness (T):
| Comparison | Required Roll |
|---|---|
| S >= 2× T | 2+ |
| S > T | 3+ |
| S = T | 4+ |
| S < T | 5+ |
| S <= ½ T | 6+ |

- Unmodified 6 = Critical Wound (always succeeds).
- Unmodified 1 = always fails.
- Wound roll can never be modified by more than +1 or -1.

**Step 3 — Allocate Attack:** The Reactive Player (target's controller) allocates each successful wound one at a time. If a model has already lost wounds or had attacks allocated to it this phase, subsequent attacks MUST go to that model first.

**Step 4 — Saving Throw:** The Reactive Player rolls D6, modified by the attack's AP (negative modifier). Must equal or beat the model's Save characteristic.
- Unmodified 1 = always fails.
- Saving throws can never be improved by more than +1.
- **Invulnerable Save**: never modified by AP. The Reactive Player chooses whether to use the Invulnerable Save or normal Save for each attack.

**Step 5 — Inflict Damage:** If the save fails, reduce the model's wounds by the attack's Damage characteristic.
- If the model is destroyed, excess damage is **lost** (does not carry over to another model).
- **Mortal Wounds** from attacks: apply after normal damage, even if the normal damage was saved. No saving throws against mortal wounds.
- **Feel No Pain X+**: for each wound the model would lose (including mortal wounds), roll D6; on X+, that wound is not lost.

### 5.4 Weapon Ability Interactions During Shooting

These modify the attack sequence:
- **Assault**: unit can shoot this weapon even if it Advanced.
- **Blast**: +1 attack per 5 models in target unit (round down). Cannot target units in Engagement Range.
- **Heavy**: +1 to Hit if the unit Remained Stationary.
- **Ignores Cover**: target does not get Benefit of Cover.
- **Indirect Fire**: can target non-visible units. -1 to Hit and target gets Benefit of Cover.
- **Lance**: +1 to Wound if the unit made a Charge move this turn.
- **Lethal Hits**: Critical Hits auto-wound (skip Wound roll).
- **Melta X**: +X damage at half range or less.
- **One Shot**: can only fire once per battle (track usage).
- **Rapid Fire X**: +X attacks when target is within half range.
- **Sustained Hits X**: Critical Hits generate X extra hits.
- **Torrent**: auto-hit (skip Hit roll).
- **Twin-linked**: can re-roll the Wound roll.
- **Devastating Wounds**: Critical Wounds become mortal wounds and the attack sequence ends for that attack.
- **Anti-KEYWORD X+**: scores a Critical Wound on X+ against matching keyword targets.
- **Conversion X**: if target is more than X" away, unmodified 4+ to hit is a Critical Hit.
- **Hazardous**: after the unit finishes ALL its attacks, roll D6 per model that used a Hazardous weapon. On a 1, that model is destroyed (CHARACTER/MONSTER/VEHICLE suffer 3 mortal wounds instead).
- **Precision**: when targeting an Attached unit, attacks can be allocated to a visible CHARACTER model (overrides normal allocation).

### 5.5 Benefit of Cover

+1 to armour saves against ranged attacks. Granted by terrain traits or abilities. Does NOT apply to models with Save 3+ or better against AP 0 attacks. Not cumulative.

**Active Player CAN:**
- Select units to shoot in any order.
- Choose any legal targets for each weapon.
- Use Stratagems that trigger in the Shooting phase (e.g., Grenade).

**Active Player CANNOT:**
- Shoot with units that Advanced (except Assault weapons) or Fell Back.
- Shoot from inside Engagement Range (except MONSTER/VEHICLE via Big Guns Never Tire, or Pistols).
- Target units within Engagement Range of friendly units (except via Big Guns Never Tire targeting MONSTER/VEHICLE).
- Split a single weapon's attacks across multiple targets.

**Reactive Player CAN:**
- Allocate incoming attacks to their models (subject to the "already-wounded model first" rule).
- Choose between Invulnerable Save and normal Save for each attack.
- Use Stratagems that trigger in the opponent's Shooting phase (e.g., Smokescreen, Go to Ground).

**Reactive Player CANNOT:**
- Shoot any of their own units.
- Move any models.
- Prevent the Active Player from selecting targets (beyond ensuring LoS/range rules are followed).

**OpenHammer state to track:** Which units have shot, wound tracking per model, one-shot weapon usage, which units gained Benefit of Cover, Hazardous test results.

---

## 6. Charge Phase

The Active Player selects units one at a time to attempt charges.

### 6.1 Declare Charge

**Eligibility:**
- The unit must NOT have Advanced this turn.
- The unit must NOT have Fallen Back this turn.
- The unit must NOT have been set up as Reinforcements this turn (they count as Normal Move, not prevented from charging per se — but specific abilities like Deep Strike state "counts as having made a Normal Move" which does NOT prevent charging unless the unit Advanced or Fell Back).
- **Correction/clarification**: a unit that Remained Stationary or made a Normal Move CAN charge. A unit that Advanced or Fell Back CANNOT.

**Selecting Targets:**
- All declared charge targets must be within 12" of the charging unit.
- Charge targets do NOT need to be visible.
- A unit can declare a charge against multiple enemy units.

### 6.2 Charge Roll

- Roll 2D6. This is the maximum distance each model in the unit can move during its Charge move.
- **The charge fails if** the unit cannot satisfy BOTH:
  1. At least one model ends within Engagement Range (1") of every declared target unit.
  2. The unit ends in Unit Coherency.
- If the charge fails, no models move. The unit stays where it is.

### 6.3 Charge Move

If the charge is successful:
- Each model can move up to the Charge roll distance in inches.
- Models **cannot** move within Engagement Range of any unit that was NOT a declared target of the charge.
- Models **must** move into base-to-base contact with an enemy model if possible.
- Normal terrain movement rules apply (climb, etc.).
- FLY models can move over other models during the Charge.
- Units that complete a successful Charge gain the **Fights First** ability until end of turn (this is the "Charge Bonus").

**Active Player CAN:**
- Select units to charge in any order.
- Declare charges against multiple targets.
- Use **Tank Shock (1 CP)** after a VEHICLE ends a Charge move.

**Active Player CANNOT:**
- Charge with units that Advanced or Fell Back.
- Move charging models within Engagement Range of non-target units.
- Decline to move into base-to-base if it's physically possible.

**Reactive Player CAN:**
- Use **Fire Overwatch (1 CP)** when the Active Player's unit starts or ends a Charge move — the Reactive Player's unit within 24" shoots (only unmodified 6s hit; once per turn).
- Use **Heroic Intervention (2 CP)** after an Active Player's unit ends a Charge move — one of the Reactive Player's units within 6" declares and resolves a charge against that unit (only WALKERs eligible for VEHICLE; no Charge Bonus granted).

**Reactive Player CANNOT:**
- Move any of their own models (except via Heroic Intervention Stratagem).
- Prevent the Active Player from declaring charge targets.

**OpenHammer state to track:** Which units charged and their targets, Charge roll result, updated model positions, Charge Bonus (Fights First) status, Tank Shock mortal wound results.

---

## 7. Fight Phase

The Fight Phase is unique because **both players** activate units. It is the only phase where the Reactive Player's units take offensive actions.

### 7.1 Fight Order

The Fight Phase is split into two steps:

**Step 1 — Fights First:**
- All units with the Fights First ability are eligible. This includes:
  - Units that successfully charged this turn (Charge Bonus).
  - Units with a permanent Fights First ability.
  - Units granted Fights First by any other rule.
- **The Reactive Player (non-active player) selects first.** Then players alternate.
- If a player has eligible units with Fights First, they MUST select one (cannot pass).
- If only one player has Fights First units, that player keeps selecting until they have none left.

**Step 2 — Remaining Combats:**
- All remaining eligible units fight. This includes:
  - Units within Engagement Range of enemy units that haven't fought yet.
  - Fights First units that were NOT eligible during Step 1 but became eligible later (e.g., an enemy Consolidation moved into their Engagement Range).
- Same alternating selection, Reactive Player first.
- If a player has eligible units, they MUST select one.

**Eligibility to fight:**
- A unit is eligible if it is within Engagement Range of an enemy unit (any model within 1" horizontally and 5" vertically), OR if it charged this turn.
- A unit that charged but is no longer within Engagement Range (due to casualties removing nearby enemy models) is STILL eligible because it charged. It can Pile In and Consolidate but may not be able to make any attacks if it can't reach.
- After each unit's Consolidation move, re-check if previously ineligible units have become eligible (new models now within 1"). If so, they can be selected.

### 7.2 Fighting with a Unit (3-step sequence)

When a unit is selected to fight, it resolves the following three steps in order:

#### Step A: Pile In (up to 3")

- Each model in the unit may move up to 3".
- Every model that moves **must** end closer to the nearest enemy model than it started.
- If a model is already in base-to-base contact with an enemy, it cannot move (but counts as having piled in).
- Must end in base-to-base contact with the closest enemy model if possible.
- The unit must end in Unit Coherency.
- The unit must end within Engagement Range of at least one enemy unit. **If this is not possible, no models can Pile In.**

#### Step B: Make Melee Attacks

**Which models can attack:**
- A model can attack if it is within Engagement Range of an enemy unit (within 1" horizontally, 5" vertically).
- OR if it is in base-to-base contact with a friendly model from its own unit that is itself in base-to-base contact with an enemy model. (This is the "daisy chain" reach rule.)

**Selecting weapons and targets:**
- Each eligible model selects ONE melee weapon.
- Select targets for ALL attacks before resolving any.
- Attacks against one target unit must all be resolved before moving to the next.
- Attacks with the same weapon profile must be resolved before switching to a different weapon profile.

**Resolving attacks:**
- Same attack sequence as shooting, but use **WS** (Weapon Skill) instead of BS.
- All declared attacks are resolved against the target even if no models remain in Engagement Range at the point of resolution (casualties don't cancel pending attacks).

**The Reactive Player allocates wounds** to their models using the same rules as Shooting (wounded model first, choose between Invulnerable and normal Save, etc.).

#### Step C: Consolidate (up to 3")

- Same movement rules as Pile In: must end closer to nearest enemy model, base-to-base if possible, maintain coherency.
- Must end within Engagement Range of at least one enemy unit if possible.
- **If ending in Engagement Range is not possible**: each model can instead move toward the closest objective marker, but must end within range of it (3" horizontally, 5" vertically) and in Unit Coherency.
- **If neither option is possible**: no models can Consolidate.

After Consolidation, check if any previously ineligible units are now eligible to fight (new Engagement Range contacts). If so, those units can be selected in subsequent activations.

### 7.3 Player Permissions During the Fight Phase

**Active Player CAN:**
- Select their eligible units to fight during their alternation.
- Choose Pile In directions (subject to "must end closer to nearest enemy" constraint).
- Choose melee weapon, targets.
- Use Fight phase Stratagems (e.g., Epic Challenge, Counter-Offensive, Tank Shock if applicable).

**Active Player CANNOT:**
- Skip selecting an eligible unit (must select if they have one).
- Move models during Pile In/Consolidate away from nearest enemy.
- Choose not to fight with models that are eligible.

**Reactive Player CAN:**
- Select their eligible units to fight during their alternation (Reactive Player picks FIRST in each step).
- Pile In, attack, and Consolidate with their units.
- Allocate incoming wounds to their models.
- Use **Counter-Offensive (2 CP)** after an enemy unit fights to make one of their units fight next.
- Use **Epic Challenge (1 CP)** when selecting their CHARACTER to fight.

**Reactive Player CANNOT:**
- Skip selecting an eligible unit if they have one.
- Refuse to Pile In or Consolidate (but models that are already in base-to-base don't move).

**OpenHammer state to track:** Fight order queue, which units have fought, Pile In/Consolidate positions, Fights First status, Charge Bonus expiry (end of turn), eligibility rechecks after each Consolidation.

---

## 8. End of Turn

After the Fight Phase completes, the Active Player's turn ends. Before transitioning:

### 8.1 Unit Coherency Check

- Each player checks all their units for Unit Coherency.
- If any unit is out of coherency, the controlling player removes models one at a time until the unit forms a single coherent group.
- Removed models count as destroyed but do NOT trigger any "when destroyed" rules.

### 8.2 Clear Turn-scoped Effects

- The **Charge Bonus** (Fights First from charging) expires.
- Any other effects that last "until the end of the turn" expire.
- Movement flags (Advanced, Fell Back, Remained Stationary, Normal Move) are still relevant for some persisting effects but are cleared for new-turn tracking purposes.

### 8.3 Check Objective Control

- At the end of each player's turn (and often at the end of phases, depending on the mission), check objective control.
- For each objective marker, sum OC of all models within 3" horizontally and 5" vertically for each player.
- Player with higher total controls it. If tied, it is contested.
- Battle-shocked models have OC 0.

**OpenHammer state to track:** Updated objective control state, removed incoherent models, cleared turn-scoped flags.

---

## 9. End of Battle Round

After both players have completed their turns:

- The battle round ends.
- Score VP per the mission rules (many missions score at the end of each battle round).
- Clear any effects that last "until the end of the battle round."
- Increment the battle round counter.
- Check if this was the final battle round (typically round 5). If so, proceed to End of Battle.
- Otherwise, begin the next battle round with Player 1's turn.

**OpenHammer state to track:** Battle round number, VP totals, which end-of-round scoring conditions were met.

---

## 10. End of Battle

After the final battle round:

- Any Reserves units that were never set up count as destroyed.
- Perform final VP scoring per the mission rules.
- The player with the most VP wins. If tied, the game is a draw.

**OpenHammer state to track:** Final VP totals, game result.

---

## 11. Stratagem Windows

Stratagems can only be used at specific moments. This section maps every Core Stratagem to the exact timing window and which player can use it. This is critical for UI — the game must prompt for Stratagem usage at the correct moments.

**General Stratagem rules:**
- The same Stratagem cannot be used more than once in the same phase.
- Cannot use Stratagems on Battle-shocked units (exception: Insane Bravery).
- Stratagems cost CP (deducted when used).

### Timing Windows

| Stratagem | CP | Whose Turn | Phase | Exact Trigger | Who Uses It |
|---|---|---|---|---|---|
| **Command Re-roll** | 1 | Either | Any | Just after making a Hit, Wound, Damage, Save, Advance, Charge, Desperate Escape, or Hazardous roll | Either player (on their own roll) |
| **Counter-Offensive** | 2 | Either | Fight | Just after an enemy unit has fought | Reactive Player (typically) |
| **Epic Challenge** | 1 | Either | Fight | When a CHARACTER unit within Engagement Range of an Attached unit is selected to fight | Either player (on their own CHARACTER) |
| **Tank Shock** | 1 | Active | Charge | After a VEHICLE ends a Charge move | Active Player |
| **Insane Bravery** | 1 | Active | Command (Battle-shock step) | Just after failing a Battle-shock test | Active Player |
| **Grenade** | 1 | Active | Shooting | When selecting a GRENADES unit to shoot (unit must not be in Engagement Range, not yet selected to shoot) | Active Player |
| **Rapid Ingress** | 1 | Reactive | End of opponent's Movement | End of opponent's Movement phase | Reactive Player |
| **Smokescreen** | 1 | Reactive | Shooting | Just after an enemy unit selects targets (targeting a SMOKE unit) | Reactive Player |
| **Fire Overwatch** | 1 | Reactive | Movement or Charge | When an enemy unit is set up, starts, or ends a move | Reactive Player |
| **Go to Ground** | 1 | Reactive | Shooting | Just after an enemy unit selects targets (targeting an INFANTRY unit) | Reactive Player |
| **Heroic Intervention** | 2 | Reactive | Charge | Just after an enemy unit ends a Charge move | Reactive Player |

**OpenHammer implementation note:** At each trigger point, the game should check if the eligible player has CP and eligible units, and if so, prompt for Stratagem usage before proceeding. This is the most timing-sensitive part of the game logic.

---

## 12. State Tracking Summary

This section consolidates every piece of game state that OpenHammer must track, organized by scope.

### Per-Game State
- Battle round number (1–5 typically)
- Which player is Player 1 (first turn each round)
- VP totals for each player
- Mission rules / scoring conditions active

### Per-Battle-Round State
- Additional CP gained this round (max 1 per player outside Command Phase)
- Which Stratagems have been used (for once-per-phase enforcement — resets each phase)

### Per-Turn State
- Active Player / Reactive Player
- Current phase and step

### Per-Phase State
- Which units have acted (shot, charged, fought)
- Which models have had attacks allocated to them (for the "wounded model" rule in Shooting/Fight)
- Stratagem usage tracking (same Stratagem cannot be used twice in a phase)

### Per-Unit State (persistent)
- Position of every model
- Current wounds on every model
- Battle-shocked status (and when it expires)
- Starting Strength
- Which Reserves pool they're in (if any)
- One-shot weapon usage
- Leader attachment status

### Per-Unit State (turn-scoped, cleared at end of turn)
- Movement type this turn: Remained Stationary / Normal Move / Advanced / Fell Back / Charged
- Charge Bonus (Fights First from charging)
- Has this unit shot this turn?
- Has this unit fought this turn?
- Advance roll result (if applicable)
- Charge roll result (if applicable)
- Charge targets declared

### Per-Unit State (phase-scoped, cleared at end of phase)
- Which model is currently taking wounds (for attack allocation)
- Ongoing attack resolution state

### Objective State
- Position of each objective marker
- Current controlling player (or contested)
- Level of Control per player per marker

### Terrain State
- Position, shape (polygon), height, and traits of each terrain piece
- Traits determine movement, visibility, and cover behavior per the terrain rules
