import type { Vec2 } from './geometry.js';
import type {
  Condition,
  EffectDuration,
  EffectDef,
  HookName,
  WeaponProfile,
} from './content.js';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export type PlayerIndex = 0 | 1;
export type UnitId = string;
export type ModelId = string;

// ---------------------------------------------------------------------------
// Dice / RNG — deterministic, server-owned
// ---------------------------------------------------------------------------

export interface RngState {
  seed: number;
  /** Number of draws so far; replaying actions reproduces every roll. */
  counter: number;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export type TerrainTrait =
  | 'areaTerrain'
  | 'obstacle'
  | 'hill'
  | 'woods'
  | 'ruins'
  | 'craters'
  | 'barricade';

export interface TerrainPiece {
  id: string;
  name: string;
  footprint: Vec2[]; // polygon in board space
  height: number; // inches
  traits: TerrainTrait[];
}

export interface ObjectiveMarker {
  id: string;
  position: Vec2;
}

export interface BoardState {
  width: number; // inches, long edge (x axis)
  height: number; // inches (y axis)
  terrain: TerrainPiece[];
  objectives: ObjectiveMarker[];
  deploymentZones: { player: PlayerIndex; polygon: Vec2[] }[];
}

// ---------------------------------------------------------------------------
// Units & models (instance state; static stats come from the datasheet)
// ---------------------------------------------------------------------------

export interface ModelState {
  id: ModelId;
  profileId: string; // index into datasheet models
  position: Vec2 | null; // null while in reserves / embarked
  woundsRemaining: number;
  destroyed: boolean;
  /** Phase-scoped: this model must take subsequent allocations. */
  hasTakenWoundsThisPhase: boolean;
}

export type MoveKind = 'stationary' | 'normal' | 'advance' | 'fallBack' | 'charge';

export interface UnitTurnFlags {
  moveKind: MoveKind | null;
  advanceRoll: number | null;
  chargeRoll: number | null;
  chargeTargets: UnitId[];
  hasShot: boolean;
  hasFought: boolean;
  fightsFirst: boolean; // charge bonus or granted
  arrivedFromReserves: boolean;
}

export interface UnitState {
  id: UnitId;
  owner: PlayerIndex;
  datasheetId: string;
  name: string;
  models: ModelState[];
  startingStrength: number;
  /** Weapon loadout per model id (weapon profile ids from the datasheet). */
  loadout: Record<ModelId, string[]>;
  /** Resolved weapons keyed by id (importer may add roster-only weapons). */
  weapons: Record<string, WeaponProfile>;
  battleShocked: boolean;
  /** Tokens are markers content packs use (e.g. "guided", "order:fix-bayonets"). */
  tokens: string[];
  reserves: 'none' | 'strategic' | 'deepStrike' | 'embarked';
  embarkedIn: UnitId | null;
  attachedTo: UnitId | null; // leader -> bodyguard unit
  leaderOf: UnitId | null;
  enhancementId: string | null;
  isWarlord: boolean;
  /** One Shot weapon ids already fired. */
  oneShotFired: string[];
  turnFlags: UnitTurnFlags;
  /** Unmatched roster imports become stat-only tokens; flag for the UI. */
  unmatched?: boolean;
}

// ---------------------------------------------------------------------------
// Active effects & usage tracking (engine-owned, content-driven)
// ---------------------------------------------------------------------------

export interface ActiveEffect {
  /** Unique instance id (sourceId + sequence). */
  instanceId: string;
  def: EffectDef;
  /** What turned it on: datasheet, stratagem use, order, enhancement... */
  source: { kind: string; id: string; player: PlayerIndex };
  /** Unit(s) it is bound to; empty = army/global. */
  boundUnits: UnitId[];
  duration: EffectDuration;
  /** Round/turn/phase stamp at activation, for expiry. */
  activatedAt: { round: number; turn: PlayerIndex; phase: string };
}

export interface UsageCounters {
  /** key = `${limiterId}:${scopeKey}:${per}` -> count this window. */
  counts: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface PlayerState {
  index: PlayerIndex;
  name: string;
  factionId: string;
  detachmentId: string;
  cp: number;
  /** Extra CP gained this round outside the command phase (capped). */
  extraCpThisRound: number;
  vp: number;
  vpLog: { round: number; source: string; amount: number; detail: string }[];
  /** Stratagem ids used in the current phase (once-per-phase rule). */
  stratagemsUsedThisPhase: string[];
  paintedArmy: boolean;
}

// ---------------------------------------------------------------------------
// Pending decisions (reactive windows protocol)
// ---------------------------------------------------------------------------

export interface PendingDecision {
  id: string;
  /** Who must act before the sequence continues. */
  player: PlayerIndex;
  kind:
    | 'saves'
    | 'feelNoPain'
    | 'allocate'
    | 'stratagemWindow'
    | 'fightSelect'
    | 'deployment'
    | 'rollOff'
    | 'custom';
  window?: HookName;
  /** Eligible options offered (action payload templates) + implicit pass. */
  options: unknown[];
  context: Record<string, unknown>;
  canPass: boolean;
}

// ---------------------------------------------------------------------------
// In-flight sequences (all serializable — games survive restarts mid-step)
// ---------------------------------------------------------------------------

/** Minimal pre-game flow: roll-off → role choice → alternating deployment. */
export interface SetupState {
  rostersLoaded: [boolean, boolean];
  rollOff: {
    purpose: 'attackerChoice' | 'firstTurn';
    rolls: [number, number];
    winner: PlayerIndex;
  } | null;
  attacker: PlayerIndex | null;
  deployNext: PlayerIndex | null;
  readyToStart: boolean;
}

export interface PendingMove {
  unitId: UnitId;
  kind: 'normal' | 'advance' | 'fallBack';
  /** Per-model distance budget in inches (M, +D6 if advancing). */
  budget: number;
  advanceRoll: number | null;
}

/** Serializable snapshot of the save/damage half of an attack computation. */
export interface SaveComputation {
  ap: number;
  damageExpr: string;
  damageBonus: number;
  minimumDamage: number;
  cover: boolean;
  ignoresCover: boolean;
  invulnerableSave: number | null;
  saveModifiers: number[];
  feelNoPain: number | null;
}

export interface ShootingAssignment {
  weaponId: string;
  targetUnitId: UnitId;
}

/** One unit's shooting, resolved weapon by weapon with defender saves between. */
export interface ShootingSequence {
  attackerUnitId: UnitId;
  remaining: ShootingAssignment[];
  current: {
    weaponId: string;
    weaponName: string;
    targetUnitId: UnitId;
    woundsPending: number;
    mortalWounds: number;
    save: SaveComputation;
  } | null;
}

// ---------------------------------------------------------------------------
// Game log
// ---------------------------------------------------------------------------

export interface LogEntry {
  seq: number;
  round: number;
  phase: string;
  player: PlayerIndex | null;
  kind: string;
  message: string;
  /** Structured payload for dice breakdowns etc. */
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Game state root
// ---------------------------------------------------------------------------

export type GamePhase = string; // ids from edition.json, plus 'setup' | 'ended'

export type EnforcementLevel = 'off' | 'warn' | 'enforce';

export interface EnforcementConfig {
  movement: EnforcementLevel;
  targeting: EnforcementLevel;
  coherency: EnforcementLevel;
  stratagems: EnforcementLevel;
}

export interface GameState {
  /** Pack versions pinned at game creation. */
  contentVersions: Record<string, string>;
  editionId: string;
  missionId: string;
  deploymentMapId: string;
  enforcement: EnforcementConfig;

  phase: GamePhase;
  step: string | null;
  round: number; // 0 during setup, 1..N during battle
  activePlayer: PlayerIndex;
  /** Player who takes the first turn each round. */
  firstPlayer: PlayerIndex;

  players: [PlayerState, PlayerState];
  units: Record<UnitId, UnitState>;
  board: BoardState;

  activeEffects: ActiveEffect[];
  usage: UsageCounters;

  setup: SetupState | null;
  pendingMove: PendingMove | null;
  shooting: ShootingSequence | null;
  pendingDecision: PendingDecision | null;

  rng: RngState;
  log: LogEntry[];
  /** Monotonic action sequence (undo replays to a point). */
  actionSeq: number;

  result: { winner: PlayerIndex | 'draw' | null; concededBy?: PlayerIndex } | null;
}

// ---------------------------------------------------------------------------
// Conditions evaluation context (what the engine hands to the evaluator)
// ---------------------------------------------------------------------------

export interface HookContextBase {
  hook: HookName;
  state: GameState;
  /** Unit carrying the effect under evaluation (set per-effect). */
  bearerUnitId?: UnitId;
}

export type ConditionFn = (cond: Condition, ctx: HookContextBase) => boolean;
