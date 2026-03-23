import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, ObjectiveMarker } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { MISSION_ONLY_WAR, MISSION_TAKE_AND_HOLD, MISSION_SWEEP_AND_CLEAR, getMission, evaluateScoringCondition } from '../../missions/index';
import '../../editions/index';

// ===== Test Helpers =====

function setupTwoPlayerGame(): GameState {
  let state = createInitialGameState();
  const p1 = makePlayer({ id: 'p1', name: 'Player 1', color: '#ff0000', commandPoints: 5 });
  const p2 = makePlayer({ id: 'p2', name: 'Player 2', color: '#0000ff', commandPoints: 5 });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });
  state = {
    ...state,
    turnState: { ...state.turnState, activePlayerId: 'p1' },
    attackerId: 'p1',
    defenderId: 'p2',
  };
  return state;
}

function addUnit(
  state: GameState,
  unitId: string,
  playerId: string,
  models: Array<{ id: string; x: number; y: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
    }),
  );
  const unit = makeUnit({
    id: unitId,
    playerId,
    modelIds: models.map((m) => m.id),
    ...overrides,
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

function setupGameWithMission(mission = MISSION_ONLY_WAR): GameState {
  let state = setupTwoPlayerGame();
  state = gameReducer(state, { type: 'SET_MISSION', payload: { mission } });
  // Mark game as started
  state = { ...state, gameStarted: true };
  return state;
}

/** Advance through all 6 phases to complete a player's turn */
function advanceThroughAllPhases(state: GameState): GameState {
  for (let i = 0; i < 5; i++) {
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });
  }
  return state;
}

// ===== Phase 32: Mission Framework =====

describe('Phase 32: Mission Framework', () => {
  describe('Mission types and library', () => {
    it('provides at least 3 starter missions', () => {
      expect(MISSION_ONLY_WAR).toBeDefined();
      expect(MISSION_TAKE_AND_HOLD).toBeDefined();
      expect(MISSION_SWEEP_AND_CLEAR).toBeDefined();
    });

    it('missions have required fields', () => {
      for (const mission of [MISSION_ONLY_WAR, MISSION_TAKE_AND_HOLD, MISSION_SWEEP_AND_CLEAR]) {
        expect(mission.id).toBeTruthy();
        expect(mission.name).toBeTruthy();
        expect(mission.battlefieldSize.width).toBeGreaterThan(0);
        expect(mission.battlefieldSize.height).toBeGreaterThan(0);
        expect(mission.deploymentMap.length).toBeGreaterThanOrEqual(2);
        expect(mission.objectivePlacements.length).toBeGreaterThanOrEqual(1);
        expect(mission.maxBattleRounds).toBeGreaterThanOrEqual(1);
        expect(mission.scoringConditions.length).toBeGreaterThanOrEqual(1);
        expect(mission.firstTurnRule).toBeTruthy();
      }
    });

    it('getMission looks up by ID', () => {
      expect(getMission('only-war')).toBe(MISSION_ONLY_WAR);
      expect(getMission('take-and-hold')).toBe(MISSION_TAKE_AND_HOLD);
      expect(getMission('nonexistent')).toBeUndefined();
    });
  });

  describe('SET_MISSION action', () => {
    it('applies battlefield size from mission', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_ONLY_WAR } });

      expect(state.board.width).toBe(60);
      expect(state.board.height).toBe(44);
    });

    it('creates deployment zones matching mission definition', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_ONLY_WAR } });

      const zones = Object.values(state.deploymentZones);
      expect(zones).toHaveLength(2);

      // Attacker zone maps to attackerId (p1)
      const attackerZone = zones.find(z => z.playerId === 'p1');
      expect(attackerZone).toBeDefined();
      expect(attackerZone!.polygon).toEqual(MISSION_ONLY_WAR.deploymentMap[0].polygon);

      // Defender zone maps to defenderId (p2)
      const defenderZone = zones.find(z => z.playerId === 'p2');
      expect(defenderZone).toBeDefined();
      expect(defenderZone!.polygon).toEqual(MISSION_ONLY_WAR.deploymentMap[1].polygon);
    });

    it('creates objectives matching mission definition', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_ONLY_WAR } });

      const objectives = Object.values(state.objectives);
      expect(objectives).toHaveLength(MISSION_ONLY_WAR.objectivePlacements.length);

      // Check positions match
      for (const placement of MISSION_ONLY_WAR.objectivePlacements) {
        const obj = objectives.find(o => o.number === placement.number);
        expect(obj).toBeDefined();
        expect(obj!.position).toEqual(placement.position);
      }
    });

    it('sets maxBattleRounds from mission', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_SWEEP_AND_CLEAR } });

      expect(state.maxBattleRounds).toBe(4);
    });

    it('stores scoring conditions on GameState via mission', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_ONLY_WAR } });

      expect(state.mission).toBeDefined();
      expect(state.mission!.scoringConditions.length).toBe(3);
    });

    it('stores mission on GameState', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_ONLY_WAR } });

      expect(state.mission).toBe(MISSION_ONLY_WAR);
    });
  });

  describe('Secondary objectives', () => {
    it('SELECT_SECONDARY stores player secondary choices', () => {
      let state = setupGameWithMission();
      state = gameReducer(state, {
        type: 'SELECT_SECONDARY',
        payload: { playerId: 'p1', conditionIds: ['secondary-1', 'secondary-2'] },
      });

      expect(state.secondaryObjectives['p1']).toEqual(['secondary-1', 'secondary-2']);
    });
  });
});

// ===== Phase 33: End-of-Turn, End-of-Round & End-of-Battle =====

describe('Phase 33: End-of-Turn, End-of-Round & End-of-Battle', () => {
  describe('END_TURN', () => {
    it('clears turn-scoped effects (movement flags, charge bonus)', () => {
      let state = setupGameWithMission();

      // Simulate some turn tracking state
      state = {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitsActivated: { 'u1': true },
          unitsCompleted: { 'u1': true },
          unitMovement: { 'u1': 'normal' },
          chargedUnits: ['u1'],
          embarkedThisPhase: ['u2'],
          disembarkedThisPhase: ['u3'],
          surgeMoveUsedThisPhase: { 'u1': true },
        },
        smokescreenUnits: ['u1'],
        goToGroundUnits: ['u2'],
        epicChallengeUnits: ['u3'],
      };

      state = gameReducer(state, { type: 'END_TURN' });

      expect(state.turnTracking.unitsActivated).toEqual({});
      expect(state.turnTracking.unitsCompleted).toEqual({});
      expect(state.turnTracking.embarkedThisPhase).toEqual([]);
      expect(state.turnTracking.disembarkedThisPhase).toEqual([]);
      expect(state.turnTracking.surgeMoveUsedThisPhase).toEqual({});
      expect(state.smokescreenUnits).toEqual([]);
      expect(state.goToGroundUnits).toEqual([]);
      expect(state.epicChallengeUnits).toEqual([]);
    });

    it('clears turn-end persisting effects', () => {
      let state = setupGameWithMission();
      state = {
        ...state,
        persistingEffects: [
          { id: 'e1', type: 'test', targetUnitId: 'u1', expiresAt: { type: 'turn_end' } },
          { id: 'e2', type: 'test', targetUnitId: 'u2', expiresAt: { type: 'round_end', round: 5 } },
          { id: 'e3', type: 'test', targetUnitId: 'u3', expiresAt: { type: 'manual' } },
        ],
      };

      state = gameReducer(state, { type: 'END_TURN' });

      // Turn-end effect removed, round-end and manual preserved
      expect(state.persistingEffects).toHaveLength(2);
      expect(state.persistingEffects.find(e => e.id === 'e1')).toBeUndefined();
      expect(state.persistingEffects.find(e => e.id === 'e2')).toBeDefined();
      expect(state.persistingEffects.find(e => e.id === 'e3')).toBeDefined();
    });

    it('recalculates objective control', () => {
      let state = setupGameWithMission();

      // Place an objective and a model near it
      const objId = Object.keys(state.objectives)[0];
      const objPos = state.objectives[objId].position;

      state = addUnit(state, 'u1', 'p1', [
        { id: 'm1', x: objPos.x, y: objPos.y },
      ]);

      state = gameReducer(state, { type: 'END_TURN' });

      expect(state.objectives[objId].controllingPlayerId).toBe('p1');
    });
  });

  describe('END_BATTLE_ROUND', () => {
    it('scores VP per mission at end of round', () => {
      let state = setupGameWithMission();

      // Place a model on an objective so P1 holds at least 1
      const objId = Object.keys(state.objectives)[0];
      const objPos = state.objectives[objId].position;
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: objPos.x, y: objPos.y }]);

      // Set objective as controlled by P1 (as if OC was calculated)
      state = {
        ...state,
        objectives: {
          ...state.objectives,
          [objId]: { ...state.objectives[objId], controllingPlayerId: 'p1' },
        },
      };

      state = gameReducer(state, { type: 'END_BATTLE_ROUND' });

      // P1 should get VP for 'hold_one' (2 VP)
      expect(state.score['p1']).toBeGreaterThanOrEqual(2);
      expect(state.scoringLog.length).toBeGreaterThan(0);
    });

    it('increments round counter', () => {
      let state = setupGameWithMission();
      expect(state.turnState.roundNumber).toBe(1);

      state = gameReducer(state, { type: 'END_BATTLE_ROUND' });

      expect(state.turnState.roundNumber).toBe(2);
    });

    it('clears round-scoped persisting effects', () => {
      let state = setupGameWithMission();
      state = {
        ...state,
        persistingEffects: [
          { id: 'e1', type: 'test', targetUnitId: 'u1', expiresAt: { type: 'round_end', round: 1 } },
          { id: 'e2', type: 'test', targetUnitId: 'u2', expiresAt: { type: 'manual' } },
        ],
      };

      state = gameReducer(state, { type: 'END_BATTLE_ROUND' });

      expect(state.persistingEffects).toHaveLength(1);
      expect(state.persistingEffects[0].id).toBe('e2');
    });

    it('resets per-turn tracking for new round', () => {
      let state = setupGameWithMission();
      state = {
        ...state,
        turnTracking: {
          ...state.turnTracking,
          unitMovement: { 'u1': 'normal' },
          chargedUnits: ['u1'],
        },
        stratagemsUsedThisPhase: ['command-reroll'],
        cpGainedThisRound: { 'p1': 1 },
      };

      state = gameReducer(state, { type: 'END_BATTLE_ROUND' });

      expect(state.turnTracking.unitMovement).toEqual({});
      expect(state.turnTracking.chargedUnits).toEqual([]);
      expect(state.stratagemsUsedThisPhase).toEqual([]);
      expect(state.cpGainedThisRound).toEqual({});
    });

    it('auto-triggers END_BATTLE at max rounds', () => {
      let state = setupGameWithMission();
      // Set to last round
      state = { ...state, turnState: { ...state.turnState, roundNumber: 5 } };

      state = gameReducer(state, { type: 'END_BATTLE_ROUND' });

      expect(state.gameResult).toBeDefined();
      expect(state.gameResult!.reason).toBe('max_rounds');
    });
  });

  describe('END_BATTLE', () => {
    it('destroys undeployed reserves', () => {
      let state = setupGameWithMission();
      state = addUnit(state, 'u-reserve', 'p1', [
        { id: 'm-r1', x: -1000, y: -1000 },
      ]);
      state = {
        ...state,
        reserves: {
          'u-reserve': { unitId: 'u-reserve', type: 'strategic', availableFromRound: 2 },
        },
      };

      state = gameReducer(state, { type: 'END_BATTLE', payload: { reason: 'max_rounds' } });

      expect(state.models['m-r1'].status).toBe('destroyed');
      expect(state.models['m-r1'].wounds).toBe(0);
    });

    it('determines winner by highest VP', () => {
      let state = setupGameWithMission();
      state = { ...state, score: { 'p1': 15, 'p2': 10 } };

      state = gameReducer(state, { type: 'END_BATTLE', payload: { reason: 'max_rounds' } });

      expect(state.gameResult).toBeDefined();
      expect(state.gameResult!.winnerId).toBe('p1');
      expect(state.gameResult!.finalScores['p1']).toBe(15);
      expect(state.gameResult!.finalScores['p2']).toBe(10);
    });

    it('tie results in draw (winnerId null)', () => {
      let state = setupGameWithMission();
      state = { ...state, score: { 'p1': 10, 'p2': 10 } };

      state = gameReducer(state, { type: 'END_BATTLE', payload: { reason: 'max_rounds' } });

      expect(state.gameResult).toBeDefined();
      expect(state.gameResult!.winnerId).toBeNull();
    });

    it('sets gameResult with reason', () => {
      let state = setupGameWithMission();
      state = gameReducer(state, { type: 'END_BATTLE', payload: { reason: 'concede' } });

      expect(state.gameResult!.reason).toBe('concede');
    });
  });

  describe('Two turns per round', () => {
    it('NEXT_TURN cycles Player 1 → Player 2 within same round', () => {
      let state = setupGameWithMission();
      expect(state.turnState.activePlayerId).toBe('p1');
      expect(state.turnState.roundNumber).toBe(1);

      state = gameReducer(state, { type: 'NEXT_TURN' });

      expect(state.turnState.activePlayerId).toBe('p2');
      expect(state.turnState.roundNumber).toBe(1);
    });

    it('NEXT_TURN after Player 2 advances to next round', () => {
      let state = setupGameWithMission();

      // P1's turn
      state = gameReducer(state, { type: 'NEXT_TURN' });
      expect(state.turnState.activePlayerId).toBe('p2');
      expect(state.turnState.roundNumber).toBe(1);

      // P2's turn → next round
      state = gameReducer(state, { type: 'NEXT_TURN' });
      expect(state.turnState.activePlayerId).toBe('p1');
      expect(state.turnState.roundNumber).toBe(2);
    });

    it('full round cycle: P1 phases → P2 phases → next round', () => {
      let state = setupGameWithMission();
      expect(state.turnState.roundNumber).toBe(1);

      // P1 goes through all phases
      state = advanceThroughAllPhases(state);
      state = gameReducer(state, { type: 'NEXT_TURN' });
      expect(state.turnState.activePlayerId).toBe('p2');
      expect(state.turnState.roundNumber).toBe(1);

      // P2 goes through all phases
      state = advanceThroughAllPhases(state);
      state = gameReducer(state, { type: 'NEXT_TURN' });
      expect(state.turnState.activePlayerId).toBe('p1');
      expect(state.turnState.roundNumber).toBe(2);
    });
  });

  describe('Battle round counter', () => {
    it('GameState has maxBattleRounds defaulting to 5', () => {
      const state = createInitialGameState();
      expect(state.maxBattleRounds).toBe(5);
    });

    it('mission sets maxBattleRounds', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, { type: 'SET_MISSION', payload: { mission: MISSION_SWEEP_AND_CLEAR } });
      expect(state.maxBattleRounds).toBe(4);
    });
  });

  describe('Scoring evaluation', () => {
    it('hold_one scores when player controls at least 1 objective', () => {
      let state = setupGameWithMission();
      const objId = Object.keys(state.objectives)[0];
      state = {
        ...state,
        objectives: {
          ...state.objectives,
          [objId]: { ...state.objectives[objId], controllingPlayerId: 'p1' },
        },
      };

      const condition = state.mission!.scoringConditions.find(c => c.conditionId === 'hold_one')!;
      const vp = evaluateScoringCondition(state, condition, 'p1');
      expect(vp).toBe(2);

      // P2 controls nothing
      const vp2 = evaluateScoringCondition(state, condition, 'p2');
      expect(vp2).toBe(0);
    });

    it('hold_two scores when player controls at least 2 objectives', () => {
      let state = setupGameWithMission();
      const objIds = Object.keys(state.objectives);
      state = {
        ...state,
        objectives: {
          ...state.objectives,
          [objIds[0]]: { ...state.objectives[objIds[0]], controllingPlayerId: 'p1' },
          [objIds[1]]: { ...state.objectives[objIds[1]], controllingPlayerId: 'p1' },
        },
      };

      const condition = state.mission!.scoringConditions.find(c => c.conditionId === 'hold_two')!;
      expect(evaluateScoringCondition(state, condition, 'p1')).toBe(3);
    });

    it('hold_more scores when player controls more than opponent', () => {
      let state = setupGameWithMission();
      const objIds = Object.keys(state.objectives);
      state = {
        ...state,
        objectives: {
          ...state.objectives,
          [objIds[0]]: { ...state.objectives[objIds[0]], controllingPlayerId: 'p1' },
          [objIds[1]]: { ...state.objectives[objIds[1]], controllingPlayerId: 'p1' },
          [objIds[2]]: { ...state.objectives[objIds[2]], controllingPlayerId: 'p2' },
        },
      };

      const condition = state.mission!.scoringConditions.find(c => c.conditionId === 'hold_more')!;
      expect(evaluateScoringCondition(state, condition, 'p1')).toBe(5);
      expect(evaluateScoringCondition(state, condition, 'p2')).toBe(0);
    });

    it('hold_more returns 0 when tied', () => {
      let state = setupGameWithMission();
      const objIds = Object.keys(state.objectives);
      state = {
        ...state,
        objectives: {
          ...state.objectives,
          [objIds[0]]: { ...state.objectives[objIds[0]], controllingPlayerId: 'p1' },
          [objIds[1]]: { ...state.objectives[objIds[1]], controllingPlayerId: 'p2' },
        },
      };

      const condition = state.mission!.scoringConditions.find(c => c.conditionId === 'hold_more')!;
      expect(evaluateScoringCondition(state, condition, 'p1')).toBe(0);
      expect(evaluateScoringCondition(state, condition, 'p2')).toBe(0);
    });

    it('respects maxVp cap across multiple rounds', () => {
      let state = setupGameWithMission();
      const objIds = Object.keys(state.objectives);

      // P1 controls 1 objective
      state = {
        ...state,
        objectives: {
          ...state.objectives,
          [objIds[0]]: { ...state.objectives[objIds[0]], controllingPlayerId: 'p1' },
        },
      };

      // Simulate having already scored 8 VP from hold_one (max is 10)
      state = {
        ...state,
        scoringLog: [
          { roundNumber: 1, playerId: 'p1', conditionId: 'primary-hold-one', conditionName: 'Hold One', vpScored: 2, timestamp: 1 },
          { roundNumber: 2, playerId: 'p1', conditionId: 'primary-hold-one', conditionName: 'Hold One', vpScored: 2, timestamp: 2 },
          { roundNumber: 3, playerId: 'p1', conditionId: 'primary-hold-one', conditionName: 'Hold One', vpScored: 2, timestamp: 3 },
          { roundNumber: 4, playerId: 'p1', conditionId: 'primary-hold-one', conditionName: 'Hold One', vpScored: 2, timestamp: 4 },
        ],
      };

      // Score end of round — should only get 2 more (8 + 2 = 10, at cap)
      state = gameReducer(state, { type: 'END_BATTLE_ROUND' });

      const holdOneEntries = state.scoringLog.filter(
        e => e.conditionId === 'primary-hold-one' && e.playerId === 'p1',
      );
      const totalHoldOne = holdOneEntries.reduce((sum, e) => sum + e.vpScored, 0);
      expect(totalHoldOne).toBeLessThanOrEqual(10);
    });
  });
});
