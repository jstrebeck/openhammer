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

export interface Model {
  id: string;
  unitId: string;
  name: string;
  position: Point;
  baseSizeMm: number;     // base diameter in mm (25, 32, 40, etc.)
  baseSizeInches: number;  // pre-computed: baseSizeMm / 25.4
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
  movementRange: 'warn',
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
  log: GameLog;
  rulesConfig: RulesConfig;
}

/** Helper to compute base size in inches from mm */
export function baseSizeToInches(mm: number): number {
  return mm / 25.4;
}
