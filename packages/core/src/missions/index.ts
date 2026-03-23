import type { Mission, ScoringCondition, GameState, ScoringLogEntry } from '../types/index';

// ─── Scoring Condition Evaluators ─────────────────────────────────────────

/**
 * Count how many objectives a player controls.
 */
function countControlledObjectives(state: GameState, playerId: string): number {
  return Object.values(state.objectives).filter(o => o.controllingPlayerId === playerId).length;
}

/**
 * Evaluate a single scoring condition for a player.
 * Returns VP to award (0 if condition not met).
 */
export function evaluateScoringCondition(
  state: GameState,
  condition: ScoringCondition,
  playerId: string,
): number {
  switch (condition.conditionId) {
    case 'hold_one': {
      return countControlledObjectives(state, playerId) >= 1 ? condition.vpAwarded : 0;
    }
    case 'hold_two': {
      return countControlledObjectives(state, playerId) >= 2 ? condition.vpAwarded : 0;
    }
    case 'hold_more': {
      const playerIds = Object.keys(state.players);
      const myCount = countControlledObjectives(state, playerId);
      const maxOther = Math.max(
        0,
        ...playerIds.filter(p => p !== playerId).map(p => countControlledObjectives(state, p)),
      );
      return myCount > maxOther ? condition.vpAwarded : 0;
    }
    default:
      return 0;
  }
}

/**
 * Evaluate all scoring conditions for the given timing across all players.
 * Returns scoring log entries and a score delta map.
 */
export function evaluateScoring(
  state: GameState,
  timing: ScoringCondition['timing'],
): { entries: ScoringLogEntry[]; scoreDeltas: Record<string, number> } {
  const mission = state.mission;
  if (!mission) return { entries: [], scoreDeltas: {} };

  const entries: ScoringLogEntry[] = [];
  const scoreDeltas: Record<string, number> = {};
  const playerIds = Object.keys(state.players);

  for (const condition of mission.scoringConditions) {
    if (condition.timing !== timing) continue;

    for (const playerId of playerIds) {
      // Check if this is a secondary the player has selected (or primary which applies to all)
      if (condition.type === 'secondary') {
        const selected = state.secondaryObjectives[playerId] ?? [];
        if (!selected.includes(condition.id)) continue;
      }

      // Check maxVp cap
      if (condition.maxVp != null) {
        const alreadyScored = state.scoringLog
          .filter(e => e.conditionId === condition.id && e.playerId === playerId)
          .reduce((sum, e) => sum + e.vpScored, 0);
        if (alreadyScored >= condition.maxVp) continue;
      }

      const vp = evaluateScoringCondition(state, condition, playerId);
      if (vp > 0) {
        // Clamp to maxVp if needed
        let vpToAward = vp;
        if (condition.maxVp != null) {
          const alreadyScored = state.scoringLog
            .filter(e => e.conditionId === condition.id && e.playerId === playerId)
            .reduce((sum, e) => sum + e.vpScored, 0);
          vpToAward = Math.min(vp, condition.maxVp - alreadyScored);
        }
        if (vpToAward > 0) {
          entries.push({
            roundNumber: state.turnState.roundNumber,
            playerId,
            conditionId: condition.id,
            conditionName: condition.name,
            vpScored: vpToAward,
            timestamp: Date.now(),
          });
          scoreDeltas[playerId] = (scoreDeltas[playerId] ?? 0) + vpToAward;
        }
      }
    }
  }

  return { entries, scoreDeltas };
}

// ─── Starter Missions ─────────────────────────────────────────────────────

// Standard 60×44 board scoring conditions
const PRIMARY_HOLD_ONE: ScoringCondition = {
  id: 'primary-hold-one',
  name: 'Hold One',
  description: 'Score 2 VP if you control at least one objective marker.',
  timing: 'end_of_round',
  type: 'primary',
  vpAwarded: 2,
  maxVp: 10,
  conditionId: 'hold_one',
};

const PRIMARY_HOLD_TWO: ScoringCondition = {
  id: 'primary-hold-two',
  name: 'Hold Two',
  description: 'Score 3 VP if you control at least two objective markers.',
  timing: 'end_of_round',
  type: 'primary',
  vpAwarded: 3,
  maxVp: 15,
  conditionId: 'hold_two',
};

const PRIMARY_HOLD_MORE: ScoringCondition = {
  id: 'primary-hold-more',
  name: 'Hold More',
  description: 'Score 5 VP if you control more objective markers than your opponent.',
  timing: 'end_of_round',
  type: 'primary',
  vpAwarded: 5,
  maxVp: 25,
  conditionId: 'hold_more',
};

/**
 * Only War — Dawn of War deployment (long edges).
 * 4 objectives in no man's land. Simple hold-based scoring.
 */
export const MISSION_ONLY_WAR: Mission = {
  id: 'only-war',
  name: 'Only War',
  battlefieldSize: { width: 60, height: 44 },
  deploymentMap: [
    {
      role: 'attacker',
      polygon: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 12 }, { x: 0, y: 12 }],
      label: 'Attacker Deployment Zone',
    },
    {
      role: 'defender',
      polygon: [{ x: 0, y: 32 }, { x: 60, y: 32 }, { x: 60, y: 44 }, { x: 0, y: 44 }],
      label: 'Defender Deployment Zone',
    },
  ],
  objectivePlacements: [
    { position: { x: 15, y: 17 }, number: 1, label: 'Objective 1' },
    { position: { x: 45, y: 17 }, number: 2, label: 'Objective 2' },
    { position: { x: 15, y: 27 }, number: 3, label: 'Objective 3' },
    { position: { x: 45, y: 27 }, number: 4, label: 'Objective 4' },
  ],
  maxBattleRounds: 5,
  scoringConditions: [PRIMARY_HOLD_ONE, PRIMARY_HOLD_TWO, PRIMARY_HOLD_MORE],
  firstTurnRule: 'attacker_first',
};

/**
 * Take and Hold — Hammer and Anvil deployment (short edges).
 * 5 objectives (4 quadrants + center). Progressive control.
 */
export const MISSION_TAKE_AND_HOLD: Mission = {
  id: 'take-and-hold',
  name: 'Take and Hold',
  battlefieldSize: { width: 60, height: 44 },
  deploymentMap: [
    {
      role: 'attacker',
      polygon: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 18, y: 44 }, { x: 0, y: 44 }],
      label: 'Attacker Deployment Zone',
    },
    {
      role: 'defender',
      polygon: [{ x: 42, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 44 }, { x: 42, y: 44 }],
      label: 'Defender Deployment Zone',
    },
  ],
  objectivePlacements: [
    { position: { x: 12, y: 22 }, number: 1, label: 'Attacker Home' },
    { position: { x: 48, y: 22 }, number: 2, label: 'Defender Home' },
    { position: { x: 30, y: 11 }, number: 3, label: 'North' },
    { position: { x: 30, y: 33 }, number: 4, label: 'South' },
    { position: { x: 30, y: 22 }, number: 5, label: 'Center' },
  ],
  maxBattleRounds: 5,
  scoringConditions: [PRIMARY_HOLD_ONE, PRIMARY_HOLD_TWO, PRIMARY_HOLD_MORE],
  firstTurnRule: 'roll_off',
};

/**
 * Sweep and Clear — Search and Destroy deployment (diagonal quarters).
 * 6 objectives spread across the board. 4 battle rounds.
 */
export const MISSION_SWEEP_AND_CLEAR: Mission = {
  id: 'sweep-and-clear',
  name: 'Sweep and Clear',
  battlefieldSize: { width: 60, height: 44 },
  deploymentMap: [
    {
      role: 'attacker',
      // Top-left triangle quarter
      polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 22 }, { x: 0, y: 22 }],
      label: 'Attacker Deployment Zone',
    },
    {
      role: 'defender',
      // Bottom-right triangle quarter
      polygon: [{ x: 30, y: 22 }, { x: 60, y: 22 }, { x: 60, y: 44 }, { x: 30, y: 44 }],
      label: 'Defender Deployment Zone',
    },
  ],
  objectivePlacements: [
    { position: { x: 10, y: 11 }, number: 1, label: 'Attacker Zone 1' },
    { position: { x: 20, y: 11 }, number: 2, label: 'Attacker Zone 2' },
    { position: { x: 50, y: 33 }, number: 3, label: 'Defender Zone 1' },
    { position: { x: 40, y: 33 }, number: 4, label: 'Defender Zone 2' },
    { position: { x: 20, y: 33 }, number: 5, label: 'No Man\'s Land 1' },
    { position: { x: 40, y: 11 }, number: 6, label: 'No Man\'s Land 2' },
  ],
  maxBattleRounds: 4,
  scoringConditions: [PRIMARY_HOLD_ONE, PRIMARY_HOLD_TWO, PRIMARY_HOLD_MORE],
  firstTurnRule: 'attacker_first',
};

/** All available missions */
export const MISSIONS: Mission[] = [
  MISSION_ONLY_WAR,
  MISSION_TAKE_AND_HOLD,
  MISSION_SWEEP_AND_CLEAR,
];

/** Look up a mission by ID */
export function getMission(missionId: string): Mission | undefined {
  return MISSIONS.find(m => m.id === missionId);
}
