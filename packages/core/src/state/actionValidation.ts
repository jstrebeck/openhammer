import type { GameState } from '../types/index';
import { getEdition } from '../rules/registry';
import type { ActionCategory } from '../rules/RulesEdition';

/** Map each action type to its action category */
export function getActionCategory(actionType: string): ActionCategory | null {
  switch (actionType) {
    // Movement actions
    case 'MOVE_MODEL':
    case 'ROTATE_MODEL':
    case 'DECLARE_MOVEMENT':
    case 'ROLL_ADVANCE':
    case 'COMMIT_MOVEMENT':
    case 'EMBARK':
    case 'DISEMBARK':
    case 'AIRCRAFT_MOVE':
    case 'AIRCRAFT_OFF_BOARD':
    case 'SET_HOVER_MODE':
    case 'SURGE_MOVE':
      return 'movement';

    // Shooting actions
    case 'DECLARE_SHOOTING':
    case 'ASSIGN_WEAPON_TARGETS':
    case 'RESOLVE_SHOOTING_ATTACK':
    case 'RESOLVE_SAVE_ROLL':
    case 'APPLY_DAMAGE':
    case 'COMPLETE_SHOOTING':
    case 'RESOLVE_HAZARDOUS':
      return 'shooting';

    // Charge actions
    case 'DECLARE_CHARGE':
    case 'ROLL_CHARGE':
    case 'COMMIT_CHARGE_MOVE':
    case 'FAIL_CHARGE':
      return 'charge';

    // Fight actions
    case 'INITIALIZE_FIGHT_PHASE':
    case 'SELECT_UNIT_TO_FIGHT':
    case 'PILE_IN':
    case 'RESOLVE_MELEE_ATTACK':
    case 'CONSOLIDATE':
    case 'COMPLETE_FIGHT':
      return 'fight';

    // Setup/placement actions — always allowed
    case 'PLACE_MODEL':
    case 'REMOVE_MODEL':
    case 'ADD_UNIT':
    case 'REMOVE_UNIT':
    case 'IMPORT_ARMY':
    case 'ADD_PLAYER':
    case 'PLACE_TERRAIN':
    case 'REMOVE_TERRAIN':
    case 'UPDATE_TERRAIN':
    case 'ADD_DEPLOYMENT_ZONE':
    case 'REMOVE_DEPLOYMENT_ZONE':
    case 'PLACE_OBJECTIVE':
    case 'REMOVE_OBJECTIVE':
    case 'UPDATE_OBJECTIVE':
      return 'setup';

    // Admin actions — always allowed
    case 'ADVANCE_PHASE':
    case 'NEXT_TURN':
    case 'SET_BOARD_SIZE':
    case 'SET_EDITION':
    case 'ROLL_DICE':
    case 'SET_COMMAND_POINTS':
    case 'LOG_MESSAGE':
    case 'SET_RULES_CONFIG':
    case 'SET_MODEL_WOUNDS':
    case 'ACTIVATE_UNIT':
    case 'COMPLETE_UNIT_ACTIVATION':
    case 'START_COMMAND_PHASE':
    case 'RESOLVE_BATTLE_SHOCK':
    case 'CALCULATE_OBJECTIVE_CONTROL':
    case 'UPDATE_SCORE':
    case 'USE_STRATAGEM':
    case 'SET_UNIT_IN_RESERVES':
    case 'ARRIVE_FROM_RESERVES':
    case 'RESOLVE_DESTROYED_TRANSPORT':
    case 'APPLY_MORTAL_WOUNDS':
    case 'ROLL_OFF':
    case 'RESOLVE_DEADLY_DEMISE':
    case 'SCOUT_MOVE':
    case 'DEPLOY_INFILTRATORS':
    case 'ATTACH_LEADER':
    case 'DETACH_LEADER':
    case 'APPLY_COMMAND_REROLL':
    case 'RESOLVE_TANK_SHOCK':
    case 'RESOLVE_PENDING_SAVES':
    case 'RESOLVE_GRENADE':
    case 'CHECK_END_OF_TURN_COHERENCY':
    case 'RESOLVE_DESPERATE_ESCAPE':
    case 'ADD_PERSISTING_EFFECT':
    case 'REMOVE_PERSISTING_EFFECT':
    case 'ISSUE_ORDER':
    case 'DESIGNATE_GUIDED_TARGET':
    // Sprint H: Pre-Game Setup
    case 'DESIGNATE_WARLORD':
    case 'SET_POINTS_LIMIT':
    case 'SET_FACTION_KEYWORD':
    case 'SELECT_DETACHMENT':
    case 'ASSIGN_ENHANCEMENT':
    case 'REMOVE_ENHANCEMENT':
    case 'VALIDATE_ARMY':
    case 'DETERMINE_ATTACKER_DEFENDER':
    case 'BEGIN_DEPLOYMENT':
    case 'DEPLOY_UNIT':
    case 'DETERMINE_FIRST_TURN':
    case 'RESOLVE_REDEPLOYMENT':
    case 'ADVANCE_SETUP_PHASE':
    // Sprint I: Mission System & Game Lifecycle
    case 'SET_MISSION':
    case 'SELECT_SECONDARY':
    case 'END_TURN':
    case 'END_BATTLE_ROUND':
    case 'END_BATTLE':
      return 'admin';

    // Overwatch uses shooting actions out-of-phase
    case 'RESOLVE_OVERWATCH':
      return 'shooting';

    // Heroic Intervention uses charge actions out-of-phase
    case 'RESOLVE_HEROIC_INTERVENTION':
      return 'charge';

    default:
      return null;
  }
}

/** Check if an action is allowed in the current phase */
export function isActionAllowedInPhase(state: GameState, actionType: string): { allowed: boolean; reason?: string } {
  if (state.rulesConfig.phaseRestrictions === 'off') {
    return { allowed: true };
  }

  // Out-of-phase actions (triggered by stratagems like Overwatch, Heroic Intervention, Rapid Ingress) bypass phase validation
  if (state.outOfPhaseAction) {
    return { allowed: true };
  }

  const category = getActionCategory(actionType);
  if (!category || category === 'admin' || category === 'setup') {
    return { allowed: true };
  }

  const edition = getEdition(state.editionId);
  if (!edition) return { allowed: true };

  const phaseActionMap = edition.getPhaseActionMap();
  const currentPhase = edition.phases[state.turnState.currentPhaseIndex];
  if (!currentPhase) return { allowed: true };

  const allowedCategories = phaseActionMap[currentPhase.id] ?? [];
  if (allowedCategories.includes(category)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `${actionType} (${category}) is not allowed during ${currentPhase.name}`,
  };
}
