# Warhammer 40K 10th Edition — Rules Implementation Checklist

This document lists every enforceable rule from the 10th Edition core rules that OpenHammer should implement. Each rule includes a brief description of the behavior and an implementation status. Rules are organized by game phase/system.

Use this as a reference to track what has been implemented and what remains.

**Status Key:**
- `[ ]` — Not started
- `[~]` — Partially implemented
- `[x]` — Fully implemented

---

## 1. Core Concepts & General Rules

### 1.1 Measuring Distances
- [ ] All distances are measured in inches
- [ ] Distance between models is measured between closest points of their bases (edge to edge)
- [ ] "Within X inches" means any distance that is not more than X inches away (i.e. less than or equal to)

### 1.2 Engagement Range
- [ ] Engagement Range is within 1" horizontally and 5" vertically of an enemy model
- [ ] Models cannot be set up or end a Normal, Advance, or Fall Back move within Engagement Range of any enemy models
- [ ] If a model cannot satisfy this after a move, that model is destroyed

### 1.3 Unit Coherency
- [ ] Units of 2–6 models: every model must be within 2" horizontally and 5" vertically of at least one other model in the unit
- [ ] Units of 7+ models: every model must be within 2" horizontally and 5" vertically of at least two other models in the unit
- [ ] Coherency must be maintained when setting up and at the end of any kind of move
- [ ] If a unit cannot be set up in coherency, it cannot be set up
- [ ] If a unit cannot end a move in coherency, the move cannot be made and models return to previous positions
- [ ] At the end of every turn, remove models one at a time from any unit out of coherency until a single coherent group remains (removed models count as destroyed but don't trigger "destroyed" rules)

### 1.4 Dice
- [ ] All dice are D6; D3 is D6 halved rounding up
- [ ] Re-rolls: a dice can never be re-rolled more than once
- [ ] Re-rolls happen before modifiers are applied
- [ ] "Unmodified" dice result = after re-rolls but before modifiers
- [ ] Roll-offs: both players roll D6, highest wins; ties re-roll; no re-rolls or modifiers allowed on roll-offs
- [ ] Hit/Wound rolls can never be modified by more than -1 or +1
- [ ] Saving throws can never be improved by more than +1
- [ ] Unmodified hit roll of 1 always fails
- [ ] Unmodified wound roll of 1 always fails
- [ ] Unmodified saving throw of 1 always fails
- [ ] Unmodified hit roll of 6 always succeeds (Critical Hit)
- [ ] Unmodified wound roll of 6 always succeeds (Critical Wound)

### 1.5 Sequencing
- [ ] When two or more rules trigger simultaneously during a turn, the active player chooses resolution order
- [ ] When simultaneous rules trigger before/after battle or at start/end of battle round, players roll off to decide order

### 1.6 Determining Visibility (Line of Sight)
- [ ] True line of sight: look from any part of the observing model to any part of the target model
- [ ] A model can see through other models in its own unit
- [ ] Model Visible: any part of the model can be seen
- [ ] Unit Visible: at least one model in the unit is visible
- [ ] Model Fully Visible: every facing part of the model can be seen
- [ ] Unit Fully Visible: every model in the unit is fully visible (can see through models in the observed unit for this check)

---

## 2. Command Phase

### 2.1 Gain Command Points
- [ ] At the start of each player's Command phase, both players gain 1 CP
- [ ] Outside of the Command phase CP gain, each player can only gain 1 additional CP per battle round total (regardless of source)

### 2.2 Battle-shock Tests
- [ ] Each unit that is Below Half-strength must take a Battle-shock test
- [ ] Below Half-strength (multi-model unit): fewer than half of Starting Strength models remaining
- [ ] Below Half-strength (single model unit): remaining wounds are less than half of Wounds characteristic
- [ ] Starting Strength = number of models in the unit when added to the army
- [ ] Attached unit Starting Strength = combined Starting Strength of Leader + Bodyguard
- [ ] Test: roll 2D6, result must be >= unit's best Leadership characteristic to pass
- [ ] Failed test: unit is Battle-shocked until start of your next Command phase
- [ ] Battle-shocked effects: OC becomes 0 for all models in the unit
- [ ] Battle-shocked effects: controlling player cannot use Stratagems on the unit
- [ ] Battle-shocked effects: if the unit Falls Back, take Desperate Escape test for every model

---

## 3. Movement Phase

### 3.1 General Movement Rules
- [ ] Each unit selects one of: Normal Move, Advance, Remain Stationary (if not in Engagement Range)
- [ ] Units within Engagement Range can only: Fall Back or Remain Stationary
- [ ] Models move in any combination of straight lines and pivots
- [ ] No part of a model's base can move through an enemy model
- [ ] No part of a model's base can cross the battlefield edge
- [ ] Models can move through friendly models but cannot end on top of them
- [ ] MONSTER/VEHICLE models cannot move through friendly MONSTER/VEHICLE models
- [ ] A model cannot end a move somewhere the physical model cannot be placed (base must fit)

### 3.2 Remain Stationary
- [ ] If a unit Remains Stationary, none of its models can move for the rest of the phase

### 3.3 Normal Move
- [ ] Each model moves up to its Move (M) characteristic in inches
- [ ] Cannot move within Engagement Range of any enemy model
- [ ] A unit cannot make more than one Normal move per phase

### 3.4 Advance Move
- [ ] Roll 1D6 for the unit (Advance roll)
- [ ] Each model can move up to M + Advance roll in inches
- [ ] Cannot move within Engagement Range of any enemy model
- [ ] Unit that Advanced cannot shoot this turn
- [ ] Unit that Advanced cannot declare a charge this turn

### 3.5 Fall Back Move
- [ ] Each model moves up to its M characteristic in inches
- [ ] Models can move within Engagement Range of enemy models during the move but cannot end within Engagement Range
- [ ] If ending outside Engagement Range is not possible, the unit cannot Fall Back
- [ ] Unit that Fell Back cannot shoot this turn
- [ ] Unit that Fell Back cannot declare a charge this turn
- [ ] Models can move over enemy models when Falling Back (as if they were not there)
- [ ] Desperate Escape test required for each model that moves over an enemy model (except TITANIC or FLY models)
- [ ] If the unit is Battle-shocked when selected to Fall Back, Desperate Escape test for every model in the unit
- [ ] Desperate Escape test: roll D6, on 1–2 one model from the unit is destroyed (owning player chooses which)
- [ ] A model can only trigger one Desperate Escape test per phase

### 3.6 Pivots
- [ ] Pivoting rotates a model around its central axis
- [ ] First pivot in a move subtracts the model's pivot value from remaining movement
- [ ] Subsequent pivots during the same move do not subtract additional distance
- [ ] Pivot values: most models on round bases = 0"; non-round base models = 1"; MONSTER/VEHICLE non-round = 2"; round base VEHICLE wider than 32mm with flight stand = 2"

### 3.7 Moving Over Terrain
- [ ] Models move over terrain 2" or less in height as if it were not there
- [ ] Terrain taller than 2": models climb up/down, vertical distance counts as movement
- [ ] Models cannot end a move mid-climb

### 3.8 Flying (FLY keyword)
- [ ] FLY models can move over enemy models during Normal, Advance, and Fall Back moves
- [ ] FLY models can move within Engagement Range during those moves (but cannot end within it)
- [ ] FLY MONSTER/VEHICLE can also move over friendly MONSTER/VEHICLE models
- [ ] FLY models that start or end on terrain measure distance "through the air" (diagonal)

### 3.9 Reinforcements
- [ ] Reserves units can be set up during the Reinforcements step of the Movement phase
- [ ] Set up per unit's specific rules (e.g. Deep Strike = more than 9" horizontally from all enemies)
- [ ] Reserves units always count as having made a Normal Move in the turn they are set up
- [ ] Any Reserves unit not set up by end of battle counts as destroyed

### 3.10 Strategic Reserves
- [ ] Cannot exceed 25% of army's total points value
- [ ] Cannot include Fortifications
- [ ] Cannot arrive before Battle Round 2
- [ ] Round 2: set up wholly within 6" of any battlefield edge, NOT in enemy deployment zone
- [ ] Round 3+: set up wholly within 6" of any battlefield edge
- [ ] Cannot be set up within 9" of any enemy models

### 3.11 Surge Moves
- [ ] Each unit can only make one surge move per phase
- [ ] Cannot make a surge move while Battle-shocked
- [ ] Cannot make a surge move while within Engagement Range of enemy units

---

## 4. Transports

### 4.1 Transport Capacity
- [ ] Each transport has a capacity that limits the number and type of models that can embark

### 4.2 Embark
- [ ] To embark, all models in the unit must end a Normal, Advance, or Fall Back move within 3" of a friendly Transport
- [ ] Cannot embark and disembark in the same phase

### 4.3 Disembark
- [ ] Units can only disembark if their Transport has not Advanced or Fallen Back this phase
- [ ] Set up wholly within 3" of the Transport and not within Engagement Range of enemy models
- [ ] If cannot satisfy placement, the unit cannot disembark
- [ ] Disembark before Transport moves: unit can act normally for the rest of the turn
- [ ] Disembark after Transport moves: unit cannot move or charge this turn but can otherwise act normally
- [ ] Units that disembark do not count as having Remained Stationary

### 4.4 Destroyed Transports
- [ ] When a Transport is destroyed, roll D6 for each embarked model
- [ ] Models that can set up wholly within 3": destroyed on a roll of 1
- [ ] Models that must set up wholly within 6": destroyed on a roll of 1–3
- [ ] Surviving unit counts as having made a Normal Move and is Battle-shocked

---

## 5. Shooting Phase

### 5.1 Eligibility
- [ ] A unit must be eligible to shoot based on its movement this turn (cannot have Advanced or Fallen Back unless special rules apply)
- [ ] A unit cannot shoot while within Engagement Range of enemy units (exception: Big Guns Never Tire and Pistols)
- [ ] A unit cannot target enemy units that are within Engagement Range of friendly units (exception: Big Guns Never Tire and Pistols)

### 5.2 Big Guns Never Tire
- [ ] MONSTER and VEHICLE units can shoot while within Engagement Range of enemy units
- [ ] MONSTER and VEHICLE units can be targeted by shooting while within Engagement Range
- [ ] When shooting from/at units in Engagement Range, subtract 1 from Hit roll (unless using a Pistol)

### 5.3 Pistols
- [ ] A unit can fire Pistol weapons while within Engagement Range
- [ ] Must target an enemy unit within Engagement Range
- [ ] Cannot fire Pistols alongside non-Pistol weapons (unless the firing model is a MONSTER or VEHICLE)

### 5.4 Target Selection
- [ ] Choose targets for all of a unit's ranged weapons before making any attacks
- [ ] For each attack, at least one model in the target unit must be visible to the attacking model AND within range of the weapon
- [ ] Models with multiple ranged weapons can shoot them at different targets
- [ ] Cannot split attacks from a single weapon across multiple targets
- [ ] Different models in the same unit can shoot at different targets

### 5.5 Making Ranged Attacks (Attack Sequence)
- [ ] **Hit Roll**: roll D6 per attack, must equal or beat the weapon's Ballistic Skill (BS)
- [ ] **Wound Roll**: roll D6 per hit, compare weapon Strength (S) vs target Toughness (T):
  - S is >= 2x T → 2+
  - S > T → 3+
  - S == T → 4+
  - S < T → 5+
  - S is <= half T → 6+
- [ ] **Allocate Attack**: controlling player of target unit allocates attacks one at a time
- [ ] If a model has already lost wounds or had attacks allocated this phase, new attacks must go to that model
- [ ] **Saving Throw**: roll D6, modify by attack's AP; if result < model's Save, the model suffers the attack's damage
- [ ] **Invulnerable Save**: never modified by AP; controlling player chooses whether to use Invulnerable or normal Save
- [ ] **Inflict Damage**: reduce the model's wounds by the damage amount
- [ ] If a model is destroyed by an attack, excess damage from that attack is lost (does not carry over)

### 5.6 Mortal Wounds
- [ ] No saving throws can be made against mortal wounds
- [ ] Mortal wounds inflicted by an attack apply after any normal damage from that attack, even if the normal damage was saved
- [ ] Each mortal wound inflicts 1 point of damage

---

## 6. Charge Phase

### 6.1 Declare Charge
- [ ] Unit must be eligible to charge (did not Advance, Fall Back, or Remain Stationary if it was forced to this turn — context dependent)
- [ ] All charge targets must be within 12" of the charging unit (do not need to be visible)
- [ ] Normal movement over terrain rules apply during charges

### 6.2 Charge Roll
- [ ] Roll 2D6 — models can move up to this many inches
- [ ] Charge fails if the unit cannot both: move within Engagement Range of all declared target units AND maintain Unit Coherency
- [ ] FLY models can move over other models when charging

### 6.3 Charge Move
- [ ] Each model makes a Charge move up to the Charge roll distance in inches
- [ ] Cannot move within Engagement Range of any unit that was NOT a target of the charge
- [ ] Must move into base-to-base contact with an enemy model if possible
- [ ] Units that complete a successful Charge gain the Fights First ability until end of turn (Charge Bonus)

---

## 7. Fight Phase

### 7.1 Fight Order
- [ ] Starting with the non-active player, players alternate selecting eligible units to fight
- [ ] If a player has eligible units they must select one (cannot pass)
- [ ] **Fights First step**: all eligible units with Fights First fight first (includes units with Charge Bonus)
- [ ] **Remaining Combats step**: all other eligible units fight, plus any Fights First units that became eligible after the first step
- [ ] After an enemy unit consolidates, check if previously ineligible units are now eligible — they can then be selected

### 7.2 Pile In (up to 3")
- [ ] Every model that pile-in moves must end closer to the closest enemy model
- [ ] Must end in base-to-base contact with closest enemy model if possible
- [ ] The unit must end in Unit Coherency
- [ ] The unit must end within Engagement Range of at least one enemy unit (if it cannot satisfy this, no models can Pile In)

### 7.3 Select Melee Targets
- [ ] A model can fight an enemy unit if it is within Engagement Range of that unit
- [ ] OR if it is in base-to-base contact with a friendly model that is itself in base-to-base contact with an enemy model
- [ ] Each model that can fight selects one of its melee weapons
- [ ] Select targets for all attacks before any are resolved

### 7.4 Make Melee Attacks
- [ ] Same attack sequence as shooting but use Weapon Skill (WS) instead of BS
- [ ] Resolve all attacks against one target unit before moving to the next
- [ ] Resolve all attacks with the same melee weapon profile before switching profiles
- [ ] All declared attacks against a target are resolved even if no models in that target remain in Engagement Range at time of resolution

### 7.5 Consolidate (up to 3")
- [ ] Same rules as Pile In: must end closer to closest enemy model, base-to-base if possible, maintain coherency
- [ ] Must end within Engagement Range of at least one enemy unit
- [ ] If the above is not possible, each model can instead move toward the closest objective marker, but must end within range of it and in coherency
- [ ] If neither option is possible, no models can Consolidate

---

## 8. Objective Control

- [ ] A model is within range of an objective marker if within 3" horizontally and 5" vertically
- [ ] Level of Control = sum of OC characteristics of all of a player's models within range
- [ ] Objective controlled by the player with the highest Level of Control
- [ ] If tied, the objective is contested (no one controls it)
- [ ] Battle-shocked models have OC 0

---

## 9. Terrain Rules

### 9.1 Terrain Trait: Craters and Rubble (Area Terrain)
- [ ] Move: normal rules
- [ ] Visibility: normal rules
- [ ] Benefit of Cover: if wholly within

### 9.2 Terrain Trait: Hills (Hill)
- [ ] Move: normal rules
- [ ] Visibility: normal rules
- [ ] Benefit of Cover: if not fully visible to every model in attacking unit

### 9.3 Terrain Trait: Battlefield Debris (Obstacle)
- [ ] Move: can move up, over, and down; cannot set up or end move on top
- [ ] Visibility: normal rules
- [ ] Benefit of Cover: if not fully visible to every model in attacking unit

### 9.4 Terrain Trait: Woods (Area Terrain)
- [ ] Move: normal rules
- [ ] Visibility: models wholly within are never considered fully visible
- [ ] Visibility: models looking through or over woods never consider the target fully visible (except AIRCRAFT or TOWERING)
- [ ] Visibility: models wholly within can see out normally
- [ ] Benefit of Cover: if wholly within OR not fully visible to every model in firing unit

### 9.5 Terrain Trait: Ruins (Area Terrain)
- [ ] Move: INFANTRY, BEASTS, FLY move through normally and can be set up/moved onto (if no overhanging bases)
- [ ] Visibility: can see into and out of normally
- [ ] Visibility: cannot see through or over (except AIRCRAFT and TOWERING)
- [ ] Benefit of Cover: if wholly within OR not fully visible to every model in firing unit

### 9.6 Terrain Trait: Barricades and Fuel Pipes (Obstacle)
- [ ] Move: can move up, over, and down; cannot set up or end move on top
- [ ] Shooting: visibility normal rules
- [ ] Fighting: can Charge if enemy is within 1", charge must end as close as possible to terrain and within 2" of enemy unit; eligible to fight targets on the other side within 2"
- [ ] Benefit of Cover: if within 3" AND not fully visible to every model in attacking unit

### 9.7 Benefit of Cover
- [ ] +1 to armour saving throws against ranged attacks
- [ ] Does not apply to models with Save of 3+ or better against AP 0 attacks
- [ ] Multiple instances of Benefit of Cover are not cumulative

---

## 10. Weapon Abilities (Universal Special Rules)

- [ ] **Assault**: can Advance and still shoot with this weapon
- [ ] **Blast**: +1 attack per 5 models in target unit (round down); cannot fire at units within Engagement Range
- [ ] **Conversion X**: unmodified hit roll of 4+ scores a Critical Hit if target is more than X" away
- [ ] **Devastating Wounds**: on a Critical Wound, damage is converted to mortal wounds and attack sequence ends
- [ ] **Extra Attacks**: bearer makes additional attacks with this weapon; number cannot be modified
- [ ] **Hazardous**: after unit finishes attacks, roll D6 per model that used a Hazardous weapon; on a 1, that model is destroyed (CHARACTERS, MONSTERS, VEHICLES suffer 3 mortal wounds instead)
- [ ] **Heavy**: +1 to Hit roll if bearer's unit Remained Stationary
- [ ] **Ignores Cover**: target does not receive Benefit of Cover against this attack
- [ ] **Indirect Fire**: can target models that are not visible; subtract 1 from Hit roll and target gets Benefit of Cover when doing so
- [ ] **Lance**: +1 to Wound roll if the bearer's unit made a Charge move this turn
- [ ] **Lethal Hits**: Critical Hits automatically wound the target (skip the Wound roll)
- [ ] **Melta X**: add X to damage when target is within half the weapon's range
- [ ] **One Shot**: weapon can only be fired once per battle
- [ ] **Pistol**: can fire within Engagement Range (must target unit in Engagement Range); cannot fire alongside non-Pistol weapons unless MONSTER/VEHICLE
- [ ] **Precision**: when targeting an Attached unit, attacks can be allocated to a visible CHARACTER model
- [ ] **Rapid Fire X**: increase number of attacks by X when target is within half range
- [ ] **Sustained Hits X**: Critical Hits score X additional hit(s)
- [ ] **Torrent**: attacks automatically hit (no Hit roll required)
- [ ] **Twin-linked**: can re-roll the Wound roll
- [ ] **Anti-KEYWORD X+**: scores a Critical Wound on a Wound roll of X+ against a target with that keyword

---

## 11. Unit Abilities (Universal Special Rules)

- [ ] **Deadly Demise X**: when model is destroyed, roll D6; on a 6, each unit within 6" suffers X mortal wounds
- [ ] **Deep Strike**: unit can be set up in Reserves; arrives more than 9" horizontally from all enemy models
- [ ] **Feel No Pain X+**: each time the model would lose a wound, roll D6; on X+, wound is not lost
- [ ] **Fights First**: unit fights in the Fights First step of the Fight phase (requires all models to have the ability)
- [ ] **Firing Deck X**: X models embarked on this Transport can fire ranged weapons
- [ ] **Infiltrators**: during deployment, can set up anywhere on the battlefield more than 9" from enemy deployment zone and all enemy models
- [ ] **Leader**: CHARACTER can attach to a Bodyguard unit to form an Attached unit; attacks cannot be allocated to the CHARACTER model unless the weapon has Precision
- [ ] **Scout X**: after deployment (pre-game), unit makes a move of up to X"; Dedicated Transport inherits if occupied by a Scout unit; must end more than 9" from enemy models
- [ ] **Stealth**: if every model in the unit has Stealth, -1 to Hit roll for ranged attacks targeting this unit

---

## 12. Core Stratagems

### 12.1 Either Player's Turn
- [ ] **Command Re-roll (1 CP)**: re-roll one Hit, Wound, Damage, Save, Advance, Charge, Desperate Escape, or Hazardous roll/test, or number of attacks roll
- [ ] **Counter-Offensive (2 CP)**: Fight phase, after an enemy unit fights — one of your units within Engagement Range (that hasn't fought) fights next
- [ ] **Epic Challenge (1 CP)**: Fight phase, one CHARACTER model's melee attacks gain Precision

### 12.2 Your Turn
- [ ] **Tank Shock (1 CP)**: Charge phase, after a VEHICLE ends a Charge move — select enemy in Engagement Range and a melee weapon; roll D6 equal to weapon's S (plus 2 extra D6 if S > target T); each 5+ inflicts 1 mortal wound (max 6)
- [ ] **Insane Bravery (1 CP)**: after failing a Battle-shock test, treat it as passed instead (can target Battle-shocked unit)
- [ ] **Grenade (1 CP)**: Shooting phase, one GRENADES unit not in Engagement Range; select enemy unit within 8" and visible, not in Engagement Range of friendlies; roll 6D6, each 4+ = 1 mortal wound

### 12.3 Opponent's Turn
- [ ] **Rapid Ingress (1 CP)**: end of opponent's Movement phase, set up one of your Reserves units as if it were your Reinforcements step (cannot arrive in a round it normally wouldn't)
- [ ] **Smokescreen (1 CP)**: opponent's Shooting phase, one SMOKE unit targeted gets Benefit of Cover and Stealth until end of phase
- [ ] **Fire Overwatch (1 CP)**: opponent's Movement or Charge phase, one unit within 24" can shoot as if it were your Shooting phase; only hits on unmodified 6; once per turn
- [ ] **Go to Ground (1 CP)**: opponent's Shooting phase, one targeted INFANTRY unit gets 6+ invulnerable save and Benefit of Cover until end of phase
- [ ] **Heroic Intervention (2 CP)**: opponent's Charge phase, after enemy ends Charge move, one of your units within 6" declares and resolves a charge against that enemy unit; only WALKER vehicles eligible; no Charge Bonus

### 12.4 Stratagem General Rules
- [ ] The same Stratagem cannot be used more than once in the same phase
- [ ] Cannot use Stratagems on Battle-shocked units (except Insane Bravery)

---

## 13. Aircraft

- [ ] AIRCRAFT start the battle in Reserves (unless in Hover mode)
- [ ] Hover mode: Move becomes 20", model loses AIRCRAFT keyword, deploys to table or Strategic Reserves
- [ ] AIRCRAFT can only make Normal Moves; can move within Engagement Range during that move
- [ ] AIRCRAFT must move exactly 20" in a straight line, then may pivot once up to 90°
- [ ] If AIRCRAFT crosses battlefield edge or cannot complete 20" move, it goes into Strategic Reserves
- [ ] Other units can make Normal/Advance moves within Engagement Range of AIRCRAFT but cannot end within Engagement Range
- [ ] Other units can move below AIRCRAFT
- [ ] Only FLY units can charge or fight AIRCRAFT
- [ ] AIRCRAFT cannot Charge, Pile In, or Consolidate; can only fight against FLY units
- [ ] Ignore AIRCRAFT when determining closest enemy model for Pile In / Consolidate (unless model can FLY)

---

## 14. Attached Units

- [ ] A CHARACTER with Leader ability can attach to a Bodyguard unit before the battle
- [ ] An Attached unit can only contain one Leader
- [ ] Attacks cannot be allocated to the CHARACTER model in an Attached unit (unless the weapon has Precision)
- [ ] Starting Strength of an Attached unit = Leader Starting Strength + Bodyguard Starting Strength
- [ ] If either the Leader or Bodyguard unit is destroyed, the surviving unit reverts to its original Starting Strength
- [ ] Destroying either the Leader or Bodyguard counts as destroying a unit for rule purposes (e.g. VP scoring)

---

## 15. Persisting Effects & Out-of-Phase Rules

- [ ] Persisting effects that apply to a unit continue if that unit embarks/disembarks from a Transport
- [ ] Persisting effects continue if an Attached unit splits (Leader or Bodyguard destroyed)
- [ ] Out-of-phase rules (e.g. Fire Overwatch) only allow the specified action — they do not trigger any other rules normally triggered in that phase

---

## 16. Army Construction (Muster Your Army)

- [ ] Each army must have a Warlord (one model designated as the army's leader)
- [ ] Army must be from a single faction (all units share a Faction keyword)
- [ ] Points limit set by mission
- [ ] Detachment rules (faction-specific) may impose additional restrictions
- [ ] Strategic Reserves cannot exceed 25% of total army points
