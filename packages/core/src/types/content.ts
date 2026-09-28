/**
 * Content-pack data types. These are the TypeScript mirrors of the JSON
 * schemas in packages/content/schemas. Everything GW publishes lives in
 * files of these shapes; the engine interprets them and knows no faction
 * or edition by name.
 */

// ---------------------------------------------------------------------------
// Hooks — the fixed set of points where the engine consults effects.
// ---------------------------------------------------------------------------

export const HOOK_NAMES = [
  // Attack sequence
  'attack.attacksCount',
  'attack.beforeHitRoll',
  'attack.afterHitRoll',
  'attack.beforeWoundRoll',
  'attack.afterWoundRoll',
  'attack.allocate',
  'attack.beforeSaveRoll',
  'attack.afterSaveRoll',
  'attack.damage',
  'attack.feelNoPain',
  'attack.resolved',
  // Targeting / eligibility
  'eligibility.shoot',
  'eligibility.target',
  'eligibility.charge',
  'eligibility.fight',
  // Movement
  'move.distance',
  'move.advanceRoll',
  'move.chargeRoll',
  'move.fallBack',
  'move.completed',
  // Deployment & reserves
  'deploy.setup',
  'deploy.reserves',
  'reserves.arrived',
  // Command phase & morale
  'command.start',
  'command.battleShockTest',
  'command.battleShockFailed',
  // Precise stratagem/reaction windows within phases
  'shooting.unitSelected',
  'shooting.targetsSelected',
  'charge.declared',
  'charge.completed',
  'fight.unitSelected',
  'fight.unitFought',
  // Scoring
  'scoring.objectiveControl',
  'scoring.victoryPoints',
  // Lifecycle / expiry sweep points (effects rarely trigger here; the
  // engine fires them to expire durations and reset usage counters)
  'lifecycle.phaseStart',
  'lifecycle.phaseEnd',
  'lifecycle.turnStart',
  'lifecycle.turnEnd',
  'lifecycle.roundStart',
  'lifecycle.roundEnd',
  'lifecycle.battleEnd',
  // Unit lifecycle
  'unit.destroyed',
  'unit.modelDestroyed',
] as const;

export type HookName = (typeof HOOK_NAMES)[number];

// ---------------------------------------------------------------------------
// Conditions — declarative predicates evaluated against a hook context.
// ---------------------------------------------------------------------------

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  // Role of the effect's bearer in the current context. Lets a defender's
  // ability (e.g. Stealth) apply to attacks made *against* it.
  | { bearerIs: 'attacker' | 'defender' | 'activeUnit' }
  // Keyword tests
  | { attackerHasKeyword: string }
  | { targetHasKeyword: string }
  | { bearerHasKeyword: string }
  // Weapon tests
  | { weaponType: 'ranged' | 'melee' }
  | { weaponHasAbility: string }
  // Range tests (evaluated against the current attack context)
  | { targetWithinHalfRange: true }
  | { targetFurtherThan: number }
  | { targetWithin: number }
  // Turn / phase context
  | { phaseIs: string }
  | { turnIs: 'own' | 'opponent' }
  | { battleRoundAtLeast: number }
  // Unit-state tests on the bearer (or attacker/target where noted)
  | { bearerRemainedStationary: true }
  | { bearerAdvanced: true }
  | { bearerFellBack: true }
  | { bearerCharged: true }
  | { bearerBelowHalfStrength: true }
  | { bearerIsBattleShocked: true }
  | { bearerHasToken: string }
  | { attackerHasToken: string }
  | { targetHasToken: string }
  | { bearerHasNotShot: true }
  | { bearerArrivedFromReserves: true }
  | { targetBelowStartingStrength: true }
  | { targetBelowHalfStrength: true }
  | { targetModelCountAtLeast: number }
  | { targetIsAttachedUnit: true }
  // Visibility (the LoS layer sets this on the context)
  | { targetNotVisible: true }
  // Marker for conditions only a script can evaluate
  | { script: string };

// ---------------------------------------------------------------------------
// Effect primitives — the vocabulary of things an effect can do.
// ---------------------------------------------------------------------------

export type RollKind =
  | 'hit'
  | 'wound'
  | 'save'
  | 'damage'
  | 'advance'
  | 'charge'
  | 'battleShock'
  | 'desperateEscape'
  | 'hazardous';

export type Permission =
  | 'shootAfterAdvance' // Assault
  | 'chargeAfterAdvance'
  | 'shootAfterFallBack'
  | 'chargeAfterFallBack'
  | 'shootInEngagement' // Pistol / Big Guns Never Tire
  | 'targetNonVisible'; // Indirect Fire

export type EffectPrimitive =
  // --- numeric roll modifiers (subject to the edition's net cap) ---
  | { type: 'modifyRoll'; roll: RollKind; value: number }
  // --- set-value (resolve before additive modifiers; not capped) ---
  | { type: 'setCriticalHitOn'; value: number }
  | { type: 'setCriticalWoundOn'; value: number }
  | { type: 'setInvulnerableSave'; value: number }
  | { type: 'setCharacteristic'; stat: CharacteristicName; value: number }
  // --- re-rolls (not capped, not modifiers) ---
  | { type: 'reroll'; roll: RollKind; dice: 'failed' | 'ones' | 'any' }
  // --- attack count ---
  | { type: 'addAttacks'; value: number }
  | { type: 'addAttacksPerTargetModels'; per: number; value: number } // Blast
  // --- attack-sequence switches ---
  | { type: 'autoHit' } // Torrent
  | { type: 'criticalHitsAutoWound' } // Lethal Hits
  | { type: 'extraHitsOnCritical'; value: number } // Sustained Hits X
  | { type: 'criticalWoundsBecomeMortal' } // Devastating Wounds
  | { type: 'addDamage'; value: number } // Melta X (with half-range condition)
  | { type: 'ignoreCover' }
  | { type: 'grantCover' }
  | { type: 'allocatePrecision' } // Precision
  | { type: 'minimumDamage'; value: number }
  | { type: 'ignoreModifiers'; rolls: RollKind[] }
  // --- characteristics & keywords ---
  | { type: 'modifyCharacteristic'; stat: CharacteristicName; value: number }
  | { type: 'grantKeyword'; keyword: string }
  | { type: 'removeKeyword'; keyword: string }
  | { type: 'grantAbility'; abilityId: string }
  | { type: 'grantWeaponAbility'; abilityId: string }
  | { type: 'feelNoPain'; value: number }
  // --- permissions & restrictions ---
  | { type: 'grantPermission'; permission: Permission }
  | { type: 'forbid'; what: 'target' | 'shoot' | 'charge' | 'move' | 'fallBack'; reason?: string }
  // --- direct state changes ---
  | { type: 'mortalWounds'; value: number | DiceExpression }
  | { type: 'modifyCP'; value: number }
  | { type: 'addToken'; token: string; duration?: EffectDuration }
  | { type: 'removeToken'; token: string }
  | { type: 'setBattleShocked'; value: boolean }
  // --- battle-shock & morale ---
  | { type: 'autoPassBattleShock' }
  | { type: 'forceBattleShockTest' }
  // --- escape hatch: a TS function in the pack's script registry ---
  | { type: 'script'; scriptId: string };

export type CharacteristicName =
  | 'M'
  | 'T'
  | 'SV'
  | 'W'
  | 'LD'
  | 'OC'
  | 'A'
  | 'BS'
  | 'WS'
  | 'S'
  | 'AP'
  | 'D'
  | 'range';

/** e.g. "D6", "2D6+1", "D3", "6" */
export type DiceExpression = string;

/**
 * untilOwnCommandPhase: expires when the SOURCE player's next command
 * phase begins (the natural lifetime of Orders and similar buffs that
 * must survive the opponent's turn).
 */
export type EffectDuration =
  | 'instant'
  | 'phase'
  | 'turn'
  | 'round'
  | 'untilOwnCommandPhase'
  | 'battle';

export interface UsageLimit {
  count: number;
  per: 'battle' | 'round' | 'turn' | 'phase';
  /** Scope of the counter: per army (default) or per unit/model bearer. */
  scope?: 'army' | 'unit' | 'model';
}

/**
 * A declarative rule. Abilities, stratagems, detachment rules, orders and
 * enhancements are all written as one or more EffectDefs.
 */
export interface EffectDef {
  id: string;
  name?: string;
  /** Short original paraphrase for the UI — never verbatim GW prose. */
  paraphrase?: string;
  trigger: HookName;
  condition?: Condition;
  effects: EffectPrimitive[];
  duration?: EffectDuration;
  /** What the effect applies to once active. */
  scope?: 'self' | 'model' | 'unit' | 'army';
  /** Range-based application: bearer projects the effect within `range`. */
  aura?: { range: number; affects: 'friendly' | 'enemy' | 'any'; condition?: Condition };
  limit?: UsageLimit;
  /** Declared even for script effects so the UI can surface timing. */
  scriptId?: string;
}

// ---------------------------------------------------------------------------
// Weapons & datasheets
// ---------------------------------------------------------------------------

export interface WeaponProfile {
  id: string;
  name: string;
  kind: 'ranged' | 'melee';
  range: number | null; // null for melee
  attacks: DiceExpression;
  /** Hit skill (BS or WS): the roll needed, e.g. 3 means 3+. null = N/A (Torrent). */
  skill: number | null;
  strength: number;
  ap: number; // stored as a non-positive number, e.g. -2
  damage: DiceExpression;
  /** Ability ids into weapon-abilities.json, with optional X values. */
  abilities: WeaponAbilityRef[];
}

export interface WeaponAbilityRef {
  id: string;
  /** X for parameterized abilities (Rapid Fire X, Melta X, Anti-KEYWORD X+). */
  value?: number;
  keyword?: string; // Anti-KEYWORD
}

/**
 * A weapon ability definition (Rapid Fire, Sustained Hits, ...) lives in
 * the edition pack as a parameterized effect. `{value}` and `{keyword}`
 * placeholders in the effect are filled from the WeaponAbilityRef.
 */
/**
 * Structural firing-protocol rules that cannot be expressed as stat
 * modifications. The set is closed edition-pack vocabulary the engine
 * implements generically — never faction-specific.
 */
export type EngineFlag = 'oneShot' | 'pistol' | 'extraAttacks' | 'hazardous';

export interface WeaponAbilityDef {
  id: string;
  name: string;
  parameterized?: boolean;
  takesKeyword?: boolean;
  paraphrase?: string;
  /** Structural protocol flags (Pistol, One Shot, Hazardous, Extra Attacks). */
  engineFlags?: EngineFlag[];
  /**
   * Effects, with `"$X"` / `"$KEYWORD"` placeholders substituted from the
   * WeaponAbilityRef at load time for parameterized abilities.
   */
  effects: EffectDef[];
}

export interface ModelProfile {
  id: string;
  name: string;
  move: number;
  toughness: number;
  save: number;
  invulnerableSave?: number;
  wounds: number;
  leadership: number; // e.g. 6 means 6+
  objectiveControl: number;
  baseSizeMm: number; // round base diameter; oval bases use baseDimensionsMm
  baseDimensionsMm?: [number, number];
  /** Model height category for 3D representation & true-LoS. */
  heightInches: number;
}

export interface DatasheetAbilityRef {
  /** Either a core ability id (e.g. "core.deep-strike") or inline effects. */
  id: string;
  value?: number; // Scout X, Deadly Demise X, FNP X+
  keyword?: string;
}

export interface Datasheet {
  id: string;
  name: string;
  aliases?: string[];
  factionId: string;
  keywords: string[];
  factionKeywords: string[];
  models: ModelProfile[];
  /** Allowed unit sizes with points, e.g. [{models: 10, points: 90}]. */
  unitComposition: { description?: string; sizes: { models: number; points: number }[] };
  rangedWeapons: WeaponProfile[];
  meleeWeapons: WeaponProfile[];
  coreAbilities: DatasheetAbilityRef[];
  /** Datasheet-specific abilities as effects. */
  abilities: EffectDef[];
  /** Wargear option metadata for the importer (free-form, importer-matched). */
  wargearNotes?: string;
  leader?: { canLead: string[] }; // datasheet ids/names this CHARACTER can lead
  transport?: { capacity: number; restrictions?: string };
  isEpicHero?: boolean;
}

// ---------------------------------------------------------------------------
// Stratagems, detachments, factions
// ---------------------------------------------------------------------------

export interface StratagemDef {
  id: string;
  name: string;
  cost: number;
  /** Which player may use it relative to whose turn it is. */
  player: 'active' | 'reactive' | 'either';
  phase: string[]; // phase ids from edition.json; empty = any
  /** The reactive-window hook(s) this stratagem is offered in. */
  window: HookName | HookName[];
  /**
   * 'proactive' stratagems (own-turn buffs like "Your Shooting phase")
   * are used directly from the UI rather than through a reactive window.
   */
  activation?: 'window' | 'proactive';
  paraphrase?: string;
  condition?: Condition;
  /** Targeting requirements the UI uses to pick a unit. */
  target?: {
    who: 'friendly' | 'enemy';
    keyword?: string;
    condition?: Condition;
    /** Battle-shocked units cannot be stratagem targets unless set. */
    allowBattleShocked?: boolean;
    /**
     * Draw target candidates from the opening window's context (e.g.
     * Overwatch: your units near the mover; Smokescreen: the units being
     * shot). Without this, any legal unit on the board is a candidate.
     */
    fromWindowContext?: boolean;
  };
  effects: EffectDef[];
}

export interface EnhancementDef {
  id: string;
  name: string;
  points: number;
  /** Keyword constraints for who may take it. */
  eligibleKeywords: string[];
  excludeKeywords?: string[];
  paraphrase?: string;
  effects: EffectDef[];
}

export interface DetachmentDef {
  id: string;
  name: string;
  aliases?: string[];
  rule: { name: string; paraphrase?: string; effects: EffectDef[] };
  enhancements: EnhancementDef[];
  stratagems: StratagemDef[];
}

/**
 * An activated faction mechanic (an order-style buff, a spotter/guided
 * pairing): player-triggered via the useAbility action, validated and
 * limited by the engine from this data.
 */
export interface MechanicDef {
  id: string;
  name: string;
  paraphrase?: string;
  /** Shared limiter group: mechanics with the same groupId share limits
   * (an Officer issues ONE order per phase, whichever it is). */
  groupId?: string;
  timing: { phase: string[]; player: 'active' | 'either' };
  /** Who activates it (the issuer/bearer unit). */
  user: { keyword?: string; condition?: Condition };
  /** Primary target (friendly unit receiving an Order, guided unit...). */
  target?: {
    who: 'friendly' | 'enemy';
    keyword?: string;
    condition?: Condition;
    /** Max distance from the user unit, in inches. */
    within?: number;
  };
  /** Optional second selection (e.g. the spotted enemy for FTGG). */
  secondTarget?: { who: 'friendly' | 'enemy'; keyword?: string; within?: number };
  /** Usage limit keyed by groupId (scope 'unit' = per user unit). */
  limit?: UsageLimit;
  /**
   * A target can hold only one active mechanic of this group at a time
   * (a new Order replaces the previous one).
   */
  exclusiveGroup?: string;
  /** Tokens applied on use: to the target and/or second target. */
  applyTokens?: { to: 'user' | 'target' | 'secondTarget'; token: string }[];
  /** Duration of the applied tokens/effects. */
  duration: EffectDuration;
  /** Ongoing effects bound to the target while active. */
  effects: EffectDef[];
}

export interface FactionPack {
  id: string;
  name: string;
  aliases?: string[];
  editionId: string;
  version: string;
  schemaVersion: number;
  armyRule: { name: string; paraphrase?: string; effects: EffectDef[] };
  /** Faction mechanics (e.g. AM Orders) modeled as activated effects. */
  mechanics?: MechanicDef[];
}

// ---------------------------------------------------------------------------
// Edition pack
// ---------------------------------------------------------------------------

/**
 * Which engine protocol a phase/step runs. The edition pack declares this;
 * the reducer switches on kinds, never on phase ids — a future edition can
 * reorder, rename or omit phases without engine changes.
 */
export type PhaseKind = 'command' | 'movement' | 'shooting' | 'charge' | 'fight' | 'custom';
export type StepKind =
  | 'command'
  | 'battleShock'
  | 'moveUnits'
  | 'reinforcements'
  | 'shoot'
  | 'charge'
  | 'fightsFirst'
  | 'remainingCombats'
  | 'custom';

export interface PhaseDef {
  id: string;
  name: string;
  kind: PhaseKind;
  steps: { id: string; name: string; kind: StepKind }[];
}

export interface EditionDef {
  id: string;
  name: string;
  version: string;
  schemaVersion: number;
  battleRounds: number;
  phases: PhaseDef[];
  /** Core numeric parameters the interpreter reads. */
  parameters: CoreParameters;
}

export interface CoreParameters {
  engagementRangeHorizontal: number;
  engagementRangeVertical: number;
  coherencyDistanceHorizontal: number;
  coherencyDistanceVertical: number;
  /** Units of 7+ models need 2 coherency neighbours. */
  coherencyTwoNeighboursAt: number;
  objectiveControlRangeHorizontal: number;
  objectiveControlRangeVertical: number;
  chargeRange: number;
  pileInDistance: number;
  consolidateDistance: number;
  /** Net modifier caps, applied after summing. */
  modifierCaps: { hit: number; wound: number; saveImprovement: number };
  /** Benefit of Cover does not apply to saves this good or better vs AP 0. */
  coverIneligibleSaveAtOrBelow: number;
  /**
   * Big Guns Never Tire: units with these keywords may shoot while (and
   * be shot while) within Engagement Range, at the given hit penalty
   * (Pistols exempt).
   */
  bigGunsNeverTire?: { keywords: string[]; hitPenalty: number };
  cpPerCommandPhase: number;
  maxExtraCpPerRound: number;
  battleShockDice: DiceExpression;
  desperateEscapeFailOn: number; // fails on 1..N
  deepStrikeDistance: number;
  reservesMaxPointsFraction: number;
  defaultCriticalHitOn: number;
  defaultCriticalWoundOn: number;
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export interface DeploymentMapDef {
  id: string;
  name: string;
  boardSize: { width: number; height: number }; // inches; width = long edge
  zones: { player: 0 | 1; polygon: { x: number; y: number }[] }[];
  objectives: { id: string; x: number; y: number }[];
}

export interface ScoringRuleDef {
  id: string;
  name: string;
  /** When to evaluate, e.g. start of command phase from round 2. */
  cadence: {
    hook: HookName;
    fromRound?: number;
    untilRound?: number;
    player?: 'active' | 'either';
  };
  /** Declarative primary scoring (Take and Hold shape). */
  scoring: {
    perObjectiveHeld: number;
    maxPerScore: number;
    requireMinimumHeld?: number;
  };
  maxTotal?: number;
}

export interface TerrainLayoutDef {
  id: string;
  name: string;
  boardSize: { width: number; height: number };
  pieces: {
    id: string;
    name: string;
    traits: string[];
    height: number;
    footprint: { x: number; y: number }[];
  }[];
}

export interface MissionDef {
  id: string;
  name: string;
  pointsLimit: number;
  deploymentMapIds: string[];
  primaryScoring: ScoringRuleDef[];
  /** e.g. painted-army bonus. */
  bonusVP?: { id: string; name: string; value: number; auto?: boolean }[];
  firstTurn: 'attacker' | 'rollOff';
  objectiveControlNote?: string;
}

// ---------------------------------------------------------------------------
// Pack manifest (every content file family shares this header)
// ---------------------------------------------------------------------------

export interface PackHeader {
  schemaVersion: number;
  version: string;
}

/** The fully-resolved content a game runs against (loader output). */
export interface ResolvedContent {
  edition: EditionDef;
  coreRules: { abilities: EffectDef[]; coreUnitAbilities: WeaponAbilityDef[] };
  weaponAbilities: WeaponAbilityDef[];
  coreStratagems: StratagemDef[];
  factions: Map<string, ResolvedFaction>;
  missions: MissionDef[];
  deploymentMaps: DeploymentMapDef[];
}

export interface ResolvedFaction {
  pack: FactionPack;
  datasheets: Map<string, Datasheet>;
  detachments: Map<string, DetachmentDef>;
}
