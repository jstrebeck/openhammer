import type { Point } from '../types/geometry';
import type { Model, Unit, Player, DiceRoll, DeploymentZone, ObjectiveMarker, RulesConfig, MoveType, ReserveEntry, Detachment, Enhancement, Mission } from '../types/index';
import type { TerrainPiece } from '../types/terrain';

export type GameAction =
  // --- Existing actions ---
  | { type: 'PLACE_MODEL'; payload: { model: Model } }
  | { type: 'REMOVE_MODEL'; payload: { modelId: string } }
  | { type: 'MOVE_MODEL'; payload: { modelId: string; position: Point } }
  | { type: 'SET_MODEL_WOUNDS'; payload: { modelId: string; wounds: number } }
  | { type: 'ROTATE_MODEL'; payload: { modelId: string; facing: number } }
  | { type: 'ADD_UNIT'; payload: { unit: Unit; models: Model[] } }
  | { type: 'REMOVE_UNIT'; payload: { unitId: string } }
  | { type: 'IMPORT_ARMY'; payload: { units: Array<{ unit: Unit; models: Model[] }> } }
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
  | { type: 'SET_RULES_CONFIG'; payload: { config: Partial<RulesConfig> } }

  // --- Phase 7: Phase Enforcement ---
  | { type: 'ACTIVATE_UNIT'; payload: { unitId: string } }
  | { type: 'COMPLETE_UNIT_ACTIVATION'; payload: { unitId: string } }

  // --- Phase 8: Movement ---
  | { type: 'DECLARE_MOVEMENT'; payload: { unitId: string; moveType: MoveType } }
  | { type: 'ROLL_ADVANCE'; payload: { unitId: string; roll: DiceRoll } }
  | { type: 'COMMIT_MOVEMENT'; payload: { unitId: string; positions: Record<string, Point>; facings?: Record<string, number> } }

  // --- Phase 9: Shooting ---
  | { type: 'DECLARE_SHOOTING'; payload: { unitId: string } }
  | { type: 'ASSIGN_WEAPON_TARGETS'; payload: { assignments: Array<{ modelId: string; weaponId: string; targetUnitId: string }> } }
  | { type: 'RESOLVE_SHOOTING_ATTACK'; payload: {
      attackingUnitId: string;
      attackingModelId: string;
      weaponId: string;
      weaponName: string;
      targetUnitId: string;
      numAttacks: number;
      hitRoll: DiceRoll;
      hits: number;
      woundRoll: DiceRoll;
      wounds: number;
    } }
  | { type: 'RESOLVE_SAVE_ROLL'; payload: { targetModelId: string; saveRoll: DiceRoll; saved: boolean; damageToApply: number } }
  | { type: 'APPLY_DAMAGE'; payload: { modelId: string; damage: number; source: string } }
  | { type: 'COMPLETE_SHOOTING'; payload: { unitId: string } }

  // --- Phase 10: Charge ---
  | { type: 'DECLARE_CHARGE'; payload: { unitId: string; targetUnitIds: string[] } }
  | { type: 'ROLL_CHARGE'; payload: { unitId: string; roll: DiceRoll; total: number } }
  | { type: 'COMMIT_CHARGE_MOVE'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'FAIL_CHARGE'; payload: { unitId: string } }

  // --- Phase 16: Stratagems ---
  | { type: 'USE_STRATAGEM'; payload: { stratagemId: string; playerId: string; targetUnitId?: string } }

  // --- Phase 12: Command & Battle-shock ---
  | { type: 'START_COMMAND_PHASE' }
  | { type: 'RESOLVE_BATTLE_SHOCK'; payload: { unitId: string; roll: DiceRoll; passed: boolean } }

  // --- Phase 14: Objective Control ---
  | { type: 'CALCULATE_OBJECTIVE_CONTROL' }
  | { type: 'UPDATE_SCORE'; payload: { playerId: string; delta: number; reason: string } }

  // --- Phase 11: Fight ---
  | { type: 'INITIALIZE_FIGHT_PHASE' }
  | { type: 'SELECT_UNIT_TO_FIGHT'; payload: { unitId: string } }
  | { type: 'PILE_IN'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'RESOLVE_MELEE_ATTACK'; payload: {
      attackingUnitId: string;
      attackingModelId: string;
      weaponId: string;
      weaponName: string;
      targetUnitId: string;
      numAttacks: number;
      hitRoll: DiceRoll;
      hits: number;
      woundRoll: DiceRoll;
      wounds: number;
    } }
  | { type: 'CONSOLIDATE'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'COMPLETE_FIGHT'; payload: { unitId: string } }

  // --- Phase 18: Transports ---
  | { type: 'EMBARK'; payload: { unitId: string; transportId: string } }
  | { type: 'DISEMBARK'; payload: { unitId: string; transportId: string; positions: Record<string, Point> } }
  | { type: 'RESOLVE_DESTROYED_TRANSPORT'; payload: { transportId: string; casualties: string[]; survivorPositions: Record<string, Point> } }

  // --- Phase 19: Aircraft & Reserves ---
  | { type: 'SET_UNIT_IN_RESERVES'; payload: { unitId: string; reserveType: 'strategic' | 'aircraft' | 'deep_strike'; availableFromRound: number } }
  | { type: 'ARRIVE_FROM_RESERVES'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'SET_HOVER_MODE'; payload: { unitId: string; hover: boolean } }
  | { type: 'AIRCRAFT_MOVE'; payload: { unitId: string; endPosition: Point; pivotAngle: number } }
  | { type: 'AIRCRAFT_OFF_BOARD'; payload: { unitId: string } }

  // --- Phase 20: Mortal Wounds & Edge Cases ---
  | { type: 'APPLY_MORTAL_WOUNDS'; payload: { targetUnitId: string; mortalWounds: number; source: string } }
  | { type: 'ROLL_OFF'; payload: { player1Id: string; player2Id: string; player1Roll: DiceRoll; player2Roll: DiceRoll; winnerId: string | null } }
  | { type: 'SURGE_MOVE'; payload: { unitId: string; positions: Record<string, Point> } }

  // --- Phase 22: Shooting Rules Completion ---
  | { type: 'RESOLVE_HAZARDOUS'; payload: { unitId: string; weaponId: string; rolls: DiceRoll; destroyedModelIds: string[] } }

  // --- Phase 23: Unit Abilities & Attached Units ---
  | { type: 'RESOLVE_DEADLY_DEMISE'; payload: { unitId: string; roll: DiceRoll; mortalWounds: number } }
  | { type: 'SCOUT_MOVE'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'DEPLOY_INFILTRATORS'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'ATTACH_LEADER'; payload: { leaderUnitId: string; bodyguardUnitId: string } }
  | { type: 'DETACH_LEADER'; payload: { leaderUnitId: string } }

  // --- Phase 24: Stratagem Effects ---
  | { type: 'APPLY_COMMAND_REROLL'; payload: { originalRollId: string; newRoll: DiceRoll } }
  | { type: 'RESOLVE_TANK_SHOCK'; payload: { unitId: string; targetUnitId: string; roll: DiceRoll } }
  | { type: 'RESOLVE_GRENADE'; payload: { unitId: string; targetUnitId: string; roll: DiceRoll } }
  | { type: 'RESOLVE_OVERWATCH'; payload: { attackingUnitId: string; targetUnitId: string; hitRoll: DiceRoll; hits: number; woundRoll: DiceRoll; wounds: number } }
  | { type: 'RESOLVE_HEROIC_INTERVENTION'; payload: { unitId: string; targetUnitId: string; positions: Record<string, Point> } }

  // --- Phase 25: Morale & Coherency Cleanup ---
  | { type: 'CHECK_END_OF_TURN_COHERENCY' }
  | { type: 'RESOLVE_DESPERATE_ESCAPE'; payload: { unitId: string; roll: DiceRoll; destroyedModelIds: string[] } }

  // --- Phase 26: Persisting Effects ---
  | { type: 'ADD_PERSISTING_EFFECT'; payload: { effect: import('../types/index').PersistingEffect } }
  | { type: 'REMOVE_PERSISTING_EFFECT'; payload: { effectId: string } }

  // --- Phase 30: Army Construction & Validation ---
  | { type: 'DESIGNATE_WARLORD'; payload: { modelId: string } }
  | { type: 'SET_POINTS_LIMIT'; payload: { pointsLimit: number } }
  | { type: 'SET_FACTION_KEYWORD'; payload: { keyword: string } }
  | { type: 'SELECT_DETACHMENT'; payload: { detachment: Detachment } }
  | { type: 'ASSIGN_ENHANCEMENT'; payload: { enhancement: Enhancement; modelId: string } }
  | { type: 'REMOVE_ENHANCEMENT'; payload: { enhancementId: string } }
  | { type: 'VALIDATE_ARMY'; payload: { playerId: string } }

  // --- Phase 31: Deployment Sequence ---
  | { type: 'DETERMINE_ATTACKER_DEFENDER'; payload: { attackerId: string; defenderId: string; roll?: { player1Roll: DiceRoll; player2Roll: DiceRoll } } }
  | { type: 'BEGIN_DEPLOYMENT'; payload: { firstDeployingPlayerId: string } }
  | { type: 'DEPLOY_UNIT'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'DETERMINE_FIRST_TURN'; payload: { playerId: string; roll?: { player1Roll: DiceRoll; player2Roll: DiceRoll } } }
  | { type: 'RESOLVE_REDEPLOYMENT'; payload: { unitId: string; positions: Record<string, Point> } }
  | { type: 'ADVANCE_SETUP_PHASE' }

  // --- Sprint I: Mission System & Game Lifecycle ---
  | { type: 'SET_MISSION'; payload: { mission: Mission } }
  | { type: 'SELECT_SECONDARY'; payload: { playerId: string; conditionIds: string[] } }
  | { type: 'END_TURN' }
  | { type: 'END_BATTLE_ROUND' }
  | { type: 'END_BATTLE'; payload: { reason: 'max_rounds' | 'concede' | 'tabled' } };
