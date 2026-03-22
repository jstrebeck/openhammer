import type { Point } from '../types/geometry';
import type { Model, Unit, Player, DiceRoll, DeploymentZone, ObjectiveMarker, RulesConfig } from '../types/index';
import type { TerrainPiece } from '../types/terrain';

export type GameAction =
  | { type: 'PLACE_MODEL'; payload: { model: Model } }
  | { type: 'REMOVE_MODEL'; payload: { modelId: string } }
  | { type: 'MOVE_MODEL'; payload: { modelId: string; position: Point } }
  | { type: 'SET_MODEL_WOUNDS'; payload: { modelId: string; wounds: number } }
  | { type: 'ROTATE_MODEL'; payload: { modelId: string; facing: number } }
  | { type: 'ADD_UNIT'; payload: { unit: Unit; models: Model[] } }
  | { type: 'REMOVE_UNIT'; payload: { unitId: string } }
  | { type: 'ADD_PLAYER'; payload: { player: Player } }
  | { type: 'PLACE_TERRAIN'; payload: { terrain: TerrainPiece } }
  | { type: 'REMOVE_TERRAIN'; payload: { terrainId: string } }
  | { type: 'UPDATE_TERRAIN'; payload: { terrainId: string; changes: Partial<Pick<TerrainPiece, 'traits' | 'height' | 'label' | 'polygon'>> } }
  | { type: 'ADVANCE_PHASE' }
  | { type: 'NEXT_TURN' }
  | { type: 'SET_BOARD_SIZE'; payload: { width: number; height: number } }
  | { type: 'SET_EDITION'; payload: { editionId: string } }
  | { type: 'ROLL_DICE'; payload: { roll: DiceRoll } }
  | { type: 'SET_COMMAND_POINTS'; payload: { playerId: string; value: number; reason: string } }
  | { type: 'LOG_MESSAGE'; payload: { text: string } }
  | { type: 'ADD_DEPLOYMENT_ZONE'; payload: { zone: DeploymentZone } }
  | { type: 'REMOVE_DEPLOYMENT_ZONE'; payload: { zoneId: string } }
  | { type: 'PLACE_OBJECTIVE'; payload: { objective: ObjectiveMarker } }
  | { type: 'REMOVE_OBJECTIVE'; payload: { objectiveId: string } }
  | { type: 'UPDATE_OBJECTIVE'; payload: { objectiveId: string; changes: Partial<Pick<ObjectiveMarker, 'position' | 'label' | 'controllingPlayerId'>> } }
  | { type: 'SET_RULES_CONFIG'; payload: { config: Partial<RulesConfig> } };
