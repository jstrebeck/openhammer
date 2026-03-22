import type { Point } from './geometry';
import type { TerrainPiece } from './terrain';

export interface Board {
  width: number;  // inches (default 60)
  height: number; // inches (default 44)
}

/** 10th Edition model stat line */
export interface ModelStats {
  move: number;        // M — inches
  toughness: number;   // T
  save: number;        // Sv (e.g. 3 means 3+)
  wounds: number;      // W
  leadership: number;  // Ld (e.g. 6 means 6+)
  objectiveControl: number; // OC
  invulnSave?: number; // Invulnerable save (e.g. 4 means 4+), optional
}

export interface Weapon {
  id: string;
  name: string;
  type: 'melee' | 'ranged';
  range?: number;      // inches, for ranged weapons
  attacks: number | string; // number or dice expression like 'D6'
  skill: number;       // BS or WS (e.g. 3 means 3+)
  strength: number;    // S
  ap: number;          // AP (e.g. -2)
  damage: number | string; // damage or dice expression like 'D3'
  abilities: string[]; // e.g. ['LETHAL HITS', 'SUSTAINED HITS 1']
}

/** Shape of a model's base or hull footprint */
export type BaseShape =
  | { type: 'circle'; diameterMm: number }
  | { type: 'oval'; widthMm: number; heightMm: number }   // e.g. cavalry 75×42mm
  | { type: 'rect'; widthMm: number; heightMm: number };   // e.g. vehicle hull 130×80mm

/** Effective diameter in mm (longest axis) — used for backward-compat distance checks */
export function baseShapeEffectiveDiameterMm(shape: BaseShape): number {
  switch (shape.type) {
    case 'circle': return shape.diameterMm;
    case 'oval':   return Math.max(shape.widthMm, shape.heightMm);
    case 'rect':   return Math.max(shape.widthMm, shape.heightMm);
  }
}

/** Dimensions of a base shape in inches (width × height along local axes) */
export function baseShapeDimensionsInches(shape: BaseShape): { width: number; height: number } {
  switch (shape.type) {
    case 'circle': return { width: shape.diameterMm / 25.4, height: shape.diameterMm / 25.4 };
    case 'oval':   return { width: shape.widthMm / 25.4, height: shape.heightMm / 25.4 };
    case 'rect':   return { width: shape.widthMm / 25.4, height: shape.heightMm / 25.4 };
  }
}

export interface Model {
  id: string;
  unitId: string;
  name: string;
  position: Point;
  baseSizeMm: number;     // effective diameter in mm (backward compat)
  baseSizeInches: number;  // pre-computed: baseSizeMm / 25.4
  baseShape: BaseShape;    // actual shape of the model's base or hull
  facing: number;          // rotation in degrees
  wounds: number;
  maxWounds: number;
  moveCharacteristic: number; // inches
  stats: ModelStats;
  status: 'active' | 'destroyed';
}

export interface Unit {
  id: string;
  name: string;
  playerId: string;
  modelIds: string[];
  keywords: string[];
  abilities: string[];
  weapons: Weapon[];
  points?: number;
  /** Number of models when the unit was added to the army (for Battle-shock) */
  startingStrength?: number;
  /** Transport capacity (number of models this unit can carry). Only set on transports. */
  transportCapacity?: number;
  /** Number of embarked models that can shoot from this transport */
  firingDeck?: number;
  /** Keyword restrictions for which units can embark (e.g. ['INFANTRY']) */
  transportKeywordRestrictions?: string[];
}

export interface Player {
  id: string;
  name: string;
  color: string; // hex color for model tokens
  commandPoints: number;
}

export interface TurnState {
  roundNumber: number;
  activePlayerId: string;
  currentPhaseIndex: number;
}

export interface DiceRoll {
  id: string;
  dice: number[];          // individual die results
  sides: number;           // e.g. 6 for D6
  threshold?: number;      // e.g. 3 means 3+ to pass
  purpose: string;         // e.g. 'To Hit', 'To Wound', 'Save'
  timestamp: number;
  /** True if this roll was a re-roll (cannot be re-rolled again) */
  reRolled?: boolean;
}

export interface GameLog {
  entries: LogEntry[];
}

export type LogEntry =
  | { type: 'phase_change'; phase: string; roundNumber: number; playerId: string; timestamp: number }
  | { type: 'dice_roll'; roll: DiceRoll; timestamp: number }
  | { type: 'cp_change'; playerId: string; oldValue: number; newValue: number; reason: string; timestamp: number }
  | { type: 'message'; text: string; timestamp: number };

export type EnforcementLevel = 'off' | 'warn' | 'enforce';

export interface RulesConfig {
  coherency: EnforcementLevel;
  movementRange: EnforcementLevel;
  phaseRestrictions: EnforcementLevel;
  lineOfSight: EnforcementLevel;
}

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  coherency: 'warn',
  movementRange: 'enforce',
  phaseRestrictions: 'off',
  lineOfSight: 'off',
};

export interface DeploymentZone {
  id: string;
  playerId: string;
  polygon: Point[];      // Vertices defining the zone
  label: string;
  color: string;         // Hex color (usually matches player color)
}

export interface ObjectiveMarker {
  id: string;
  position: Point;
  number: number;        // Display number (1, 2, 3, etc.)
  label?: string;
  controllingPlayerId?: string;
}

// --- Turn tracking & Combat state types ---

export type MoveType = 'stationary' | 'normal' | 'advance' | 'fall_back';

/** Tracks per-unit movement declarations and results for the current turn */
export interface TurnTracking {
  /** What type of move each unit declared this turn */
  unitMovement: Record<string, MoveType>;
  /** Advance roll results (D6) per unit */
  advanceRolls: Record<string, number>;
  /** Units that have been activated (started their action) in the current phase */
  unitsActivated: Record<string, boolean>;
  /** Units that have completed activation in the current phase */
  unitsCompleted: Record<string, boolean>;
  /** Units that have successfully charged this turn */
  chargedUnits: string[];
  /** Units that embarked this phase (cannot disembark same phase) */
  embarkedThisPhase: string[];
  /** Units that disembarked this phase (cannot embark same phase) */
  disembarkedThisPhase: string[];
  /** Units that used a surge move this phase (one per phase per unit) */
  surgeMoveUsedThisPhase: Record<string, boolean>;
}

export function createEmptyTurnTracking(): TurnTracking {
  return {
    unitMovement: {},
    advanceRolls: {},
    unitsActivated: {},
    unitsCompleted: {},
    chargedUnits: [],
    embarkedThisPhase: [],
    disembarkedThisPhase: [],
    surgeMoveUsedThisPhase: {},
  };
}

/** Tracks an individual weapon's attack against a target */
export interface AttackSequence {
  id: string;
  attackingUnitId: string;
  attackingModelId: string;
  weaponId: string;
  weaponName: string;
  targetUnitId: string;
  /** Number of attacks (resolved from dice expressions) */
  numAttacks: number;
  /** Results of each step — populated as the sequence progresses */
  hitRoll?: DiceRoll;
  hits?: number;
  woundRoll?: DiceRoll;
  wounds?: number;
  /** Wounds allocated to specific models */
  woundAllocations?: Array<{ modelId: string; saveRoll?: DiceRoll; saved: boolean; damageApplied: number }>;
  resolved: boolean;
}

/** State tracking for the Shooting Phase */
export interface ShootingState {
  /** Unit currently shooting */
  activeShootingUnit: string | null;
  /** Weapon-to-target assignments for the active unit */
  weaponAssignments: Array<{ modelId: string; weaponId: string; targetUnitId: string }>;
  /** In-progress attack sequences */
  activeAttacks: AttackSequence[];
  /** Unit IDs that have finished shooting this phase */
  unitsShot: string[];
}

export function createEmptyShootingState(): ShootingState {
  return {
    activeShootingUnit: null,
    weaponAssignments: [],
    activeAttacks: [],
    unitsShot: [],
  };
}

/** State tracking for the Charge Phase */
export interface ChargeState {
  /** Declared charges: unitId → target unitIds */
  declaredCharges: Record<string, string[]>;
  /** Charge roll results (2D6 sum) per unit */
  chargeRolls: Record<string, number>;
  /** Units that completed a successful charge move */
  successfulCharges: string[];
}

export function createEmptyChargeState(): ChargeState {
  return {
    declaredCharges: {},
    chargeRolls: {},
    successfulCharges: [],
  };
}

/** State tracking for the Fight Phase */
export interface FightState {
  /** Current step of the fight phase */
  fightStep: 'fights_first' | 'remaining';
  /** Queue of unit IDs eligible to fight, in selection order */
  eligibleUnits: string[];
  /** Unit currently fighting */
  currentFighter: string | null;
  /** Unit IDs that have completed fighting */
  unitsFought: string[];
  /** Which player should select the next unit to fight */
  nextToSelect: string | null;
  /** In-progress melee attack sequences */
  activeAttacks: AttackSequence[];
}

export function createEmptyFightState(): FightState {
  return {
    fightStep: 'fights_first',
    eligibleUnits: [],
    currentFighter: null,
    unitsFought: [],
    nextToSelect: null,
    activeAttacks: [],
  };
}

// --- Persisting Effects ---

export interface PersistingEffect {
  id: string;
  /** Effect type identifier (e.g. 'smokescreen', 'stealth', 'cover_bonus') */
  type: string;
  /** Unit ID this effect applies to */
  targetUnitId: string;
  /** What created this effect (stratagem ID, ability name, etc.) */
  sourceId?: string;
  /** When the effect expires */
  expiresAt: {
    type: 'phase_end' | 'turn_end' | 'round_end' | 'manual';
    phase?: string;
    round?: number;
  };
  /** Optional extra data */
  data?: Record<string, unknown>;
}

// --- Reserves ---

export interface ReserveEntry {
  unitId: string;
  type: 'strategic' | 'aircraft' | 'deep_strike';
  /** Round number when the unit can arrive */
  availableFromRound: number;
}

// --- Stratagem types ---

export type StratagemTiming = 'your_turn' | 'opponent_turn' | 'either_turn';

export interface Stratagem {
  id: string;
  name: string;
  cpCost: number;
  /** Which phase(s) the stratagem can be used in */
  phases: string[];
  timing: StratagemTiming;
  description: string;
  /** Restrictions (e.g., unit keywords required) */
  restrictions?: string[];
}

/** The 11 core stratagems from 10th Edition */
export const CORE_STRATAGEMS: Stratagem[] = [
  // Either player's turn
  { id: 'command-reroll', name: 'Command Re-roll', cpCost: 1, phases: ['command', 'movement', 'shooting', 'charge', 'fight', 'morale'], timing: 'either_turn', description: 'Re-roll one Hit, Wound, Damage, Save, Advance, Charge, or Hazardous roll' },
  { id: 'counter-offensive', name: 'Counter-Offensive', cpCost: 2, phases: ['fight'], timing: 'either_turn', description: 'After an enemy unit fights, one of your units within Engagement Range fights next' },
  { id: 'epic-challenge', name: 'Epic Challenge', cpCost: 1, phases: ['fight'], timing: 'either_turn', description: 'One CHARACTER model\'s melee attacks gain Precision' },

  // Your turn
  { id: 'tank-shock', name: 'Tank Shock', cpCost: 1, phases: ['charge'], timing: 'your_turn', description: 'After a VEHICLE ends a Charge move, inflict mortal wounds on an enemy in Engagement Range', restrictions: ['VEHICLE'] },
  { id: 'insane-bravery', name: 'Insane Bravery', cpCost: 1, phases: ['command'], timing: 'your_turn', description: 'Auto-pass a failed Battle-shock test' },
  { id: 'grenade', name: 'Grenade', cpCost: 1, phases: ['shooting'], timing: 'your_turn', description: 'GRENADES unit: roll 6D6, each 4+ = 1 mortal wound to enemy within 8"', restrictions: ['GRENADES'] },

  // Opponent's turn
  { id: 'rapid-ingress', name: 'Rapid Ingress', cpCost: 1, phases: ['movement'], timing: 'opponent_turn', description: 'Set up one Reserves unit at end of opponent\'s Movement phase' },
  { id: 'smokescreen', name: 'Smokescreen', cpCost: 1, phases: ['shooting'], timing: 'opponent_turn', description: 'SMOKE unit gets Benefit of Cover and Stealth until end of phase', restrictions: ['SMOKE'] },
  { id: 'fire-overwatch', name: 'Fire Overwatch', cpCost: 1, phases: ['movement', 'charge'], timing: 'opponent_turn', description: 'One unit within 24" shoots as if Shooting phase; only hits on unmodified 6' },
  { id: 'go-to-ground', name: 'Go to Ground', cpCost: 1, phases: ['shooting'], timing: 'opponent_turn', description: 'INFANTRY unit gets 6+ invulnerable save and Benefit of Cover', restrictions: ['INFANTRY'] },
  { id: 'heroic-intervention', name: 'Heroic Intervention', cpCost: 2, phases: ['charge'], timing: 'opponent_turn', description: 'One of your units within 6" charges the enemy that just charged' },
];

export interface GameState {
  id: string;
  editionId: string;
  board: Board;
  models: Record<string, Model>;
  units: Record<string, Unit>;
  players: Record<string, Player>;
  terrain: Record<string, TerrainPiece>;
  deploymentZones: Record<string, DeploymentZone>;
  objectives: Record<string, ObjectiveMarker>;
  turnState: TurnState;
  turnTracking: TurnTracking;
  shootingState: ShootingState;
  chargeState: ChargeState;
  fightState: FightState;
  /** Unit IDs that are currently Battle-shocked */
  battleShocked: string[];
  /** Per-player score */
  score: Record<string, number>;
  /** Stratagem IDs used in the current phase (cannot reuse in same phase) */
  stratagemsUsedThisPhase: string[];
  /** Set to true after the first START_COMMAND_PHASE — locks free model placement */
  gameStarted: boolean;
  /** Transport unit ID → array of embarked unit IDs */
  embarkedUnits: Record<string, string[]>;
  /** Units in reserves (keyed by unit ID) */
  reserves: Record<string, ReserveEntry>;
  /** Unit IDs in hover mode (aircraft that lose AIRCRAFT keyword behavior) */
  hoverModeUnits: string[];
  /** Tracks weapons that have been fired (for One Shot). Key = "unitId:weaponId" */
  weaponsFired: Record<string, boolean>;
  /** Attached units: leader unit ID → bodyguard unit ID */
  attachedUnits: Record<string, string>;
  log: GameLog;
  rulesConfig: RulesConfig;
  /** Unit IDs with Smokescreen active (Benefit of Cover + Stealth until end of phase) */
  smokescreenUnits: string[];
  /** Unit IDs with Go to Ground active (6+ invuln + Benefit of Cover until end of phase) */
  goToGroundUnits: string[];
  /** Unit IDs with Epic Challenge active (CHARACTER melee gains Precision until end of phase) */
  epicChallengeUnits: string[];
  /** Out-of-phase action in progress (allows actions that would normally be blocked by phase validation) */
  outOfPhaseAction?: { stratagemId: string; playerId: string };
  /** Tracks non-Command-Phase CP gains per player per battle round (for CP cap of +1) */
  cpGainedThisRound: Record<string, number>;
  /** Active persisting effects (survive phase changes, embark/disembark, attach/detach) */
  persistingEffects: PersistingEffect[];
}

/** Helper to compute base size in inches from mm */
export function baseSizeToInches(mm: number): number {
  return mm / 25.4;
}
