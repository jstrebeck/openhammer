import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, DiceRoll, DeploymentZone } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { validateDeploymentPosition } from '../../army-list/armyValidation';
// validateScoutMove moved to deployment/__tests__/validators.test.ts
import '../../editions/index';

// ===== Test Helpers =====

function setupTwoPlayerGame(): GameState {
  let state = createInitialGameState();
  const p1 = makePlayer({ id: 'p1', name: 'Player 1', color: '#ff0000', commandPoints: 5 });
  const p2 = makePlayer({ id: 'p2', name: 'Player 2', color: '#0000ff', commandPoints: 5 });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p1 } });
  state = gameReducer(state, { type: 'ADD_PLAYER', payload: { player: p2 } });
  state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1' } };
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

function addDeploymentZones(state: GameState): GameState {
  // Dawn of War style: P1 gets bottom third, P2 gets top third
  const p1Zone: DeploymentZone = {
    id: 'zone-p1',
    playerId: 'p1',
    polygon: [
      { x: 0, y: 30 },
      { x: 60, y: 30 },
      { x: 60, y: 44 },
      { x: 0, y: 44 },
    ],
    label: 'Player 1 Zone',
    color: '#ff0000',
  };
  const p2Zone: DeploymentZone = {
    id: 'zone-p2',
    playerId: 'p2',
    polygon: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 14 },
      { x: 0, y: 14 },
    ],
    label: 'Player 2 Zone',
    color: '#0000ff',
  };
  state = gameReducer(state, { type: 'ADD_DEPLOYMENT_ZONE', payload: { zone: p1Zone } });
  state = gameReducer(state, { type: 'ADD_DEPLOYMENT_ZONE', payload: { zone: p2Zone } });
  return state;
}

function makeDiceRoll(dice: number[], purpose: string): DiceRoll {
  return {
    id: crypto.randomUUID(),
    dice,
    sides: 6,
    purpose,
    timestamp: Date.now(),
  };
}

// ===============================================
// Phase 31: Deployment Sequence
// ===============================================

describe('Phase 31: Deployment Sequence', () => {

  // --- Attacker/Defender ---

  describe('Attacker/Defender Determination', () => {
    it('assigns attacker and defender via DETERMINE_ATTACKER_DEFENDER', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, {
        type: 'DETERMINE_ATTACKER_DEFENDER',
        payload: {
          attackerId: 'p1',
          defenderId: 'p2',
          roll: {
            player1Roll: makeDiceRoll([5], 'roll-off'),
            player2Roll: makeDiceRoll([3], 'roll-off'),
          },
        },
      });

      expect(state.attackerId).toBe('p1');
      expect(state.defenderId).toBe('p2');
    });

    it('stores roles from roll-off (winner chooses)', () => {
      let state = setupTwoPlayerGame();
      // P2 wins roll-off and chooses to be defender
      state = gameReducer(state, {
        type: 'DETERMINE_ATTACKER_DEFENDER',
        payload: {
          attackerId: 'p1',
          defenderId: 'p2',
        },
      });

      expect(state.attackerId).toBe('p1');
      expect(state.defenderId).toBe('p2');

      // Log should mention roles
      const lastLog = state.log.entries[state.log.entries.length - 1];
      expect(lastLog.type).toBe('message');
      if (lastLog.type === 'message') {
        expect(lastLog.text).toContain('Attacker');
        expect(lastLog.text).toContain('Defender');
      }
    });

    it('rejects invalid player IDs', () => {
      let state = setupTwoPlayerGame();
      const before = state;
      state = gameReducer(state, {
        type: 'DETERMINE_ATTACKER_DEFENDER',
        payload: { attackerId: 'invalid', defenderId: 'p2' },
      });
      expect(state).toBe(before); // No change
    });
  });

  // --- Alternating Deployment ---

  describe('Alternating Deployment', () => {
    it('BEGIN_DEPLOYMENT initializes deployment state', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 0, y: 0 }]);
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 0, y: 0 }]);
      state = addUnit(state, 'u3', 'p2', [{ id: 'm3', x: 0, y: 0 }]);

      state = gameReducer(state, {
        type: 'BEGIN_DEPLOYMENT',
        payload: { firstDeployingPlayerId: 'p1' },
      });

      expect(state.deploymentState.currentDeployingPlayerId).toBe('p1');
      expect(state.deploymentState.unitsRemaining['p1']).toContain('u1');
      expect(state.deploymentState.unitsRemaining['p1']).toContain('u2');
      expect(state.deploymentState.unitsRemaining['p2']).toContain('u3');
      expect(state.deploymentState.deploymentStarted).toBe(false);
    });

    it('DEPLOY_UNIT places a unit and alternates to next player', () => {
      let state = setupTwoPlayerGame();
      state = addDeploymentZones(state);
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 0, y: 0 }]);
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 0, y: 0 }]);

      state = gameReducer(state, {
        type: 'BEGIN_DEPLOYMENT',
        payload: { firstDeployingPlayerId: 'p1' },
      });

      // P1 deploys u1
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId: 'u1', positions: { 'm1': { x: 30, y: 35 } } },
      });

      // Model should be placed
      expect(state.models['m1'].position).toEqual({ x: 30, y: 35 });
      // Should alternate to P2
      expect(state.deploymentState.currentDeployingPlayerId).toBe('p2');
      expect(state.deploymentState.deploymentStarted).toBe(true);
      // u1 removed from remaining
      expect(state.deploymentState.unitsRemaining['p1']).not.toContain('u1');
    });

    it('players alternate one unit at a time', () => {
      let state = setupTwoPlayerGame();
      state = addDeploymentZones(state);
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 0, y: 0 }]);
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 0, y: 0 }]);
      state = addUnit(state, 'u3', 'p2', [{ id: 'm3', x: 0, y: 0 }]);
      state = addUnit(state, 'u4', 'p2', [{ id: 'm4', x: 0, y: 0 }]);

      state = gameReducer(state, {
        type: 'BEGIN_DEPLOYMENT',
        payload: { firstDeployingPlayerId: 'p1' },
      });

      // P1 deploys first
      expect(state.deploymentState.currentDeployingPlayerId).toBe('p1');
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId: 'u1', positions: { 'm1': { x: 30, y: 35 } } },
      });

      // P2's turn
      expect(state.deploymentState.currentDeployingPlayerId).toBe('p2');
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId: 'u3', positions: { 'm3': { x: 30, y: 5 } } },
      });

      // Back to P1
      expect(state.deploymentState.currentDeployingPlayerId).toBe('p1');
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId: 'u2', positions: { 'm2': { x: 35, y: 35 } } },
      });

      // Back to P2
      expect(state.deploymentState.currentDeployingPlayerId).toBe('p2');
    });

    it('excludes units in reserves from deployment', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 0, y: 0 }]);
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 0, y: 0 }]);

      // Put u2 in reserves
      state = {
        ...state,
        reserves: { 'u2': { unitId: 'u2', type: 'deep_strike', availableFromRound: 2 } },
      };

      state = gameReducer(state, {
        type: 'BEGIN_DEPLOYMENT',
        payload: { firstDeployingPlayerId: 'p1' },
      });

      // Only u1 should be in remaining (u2 is in reserves)
      expect(state.deploymentState.unitsRemaining['p1']).toContain('u1');
      expect(state.deploymentState.unitsRemaining['p1']).not.toContain('u2');
    });

    it('separates infiltrators from regular deployment', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 0, y: 0 }]);
      state = addUnit(state, 'u2', 'p1', [{ id: 'm2', x: 0, y: 0 }], {
        abilities: ['Infiltrators'],
      });

      state = gameReducer(state, {
        type: 'BEGIN_DEPLOYMENT',
        payload: { firstDeployingPlayerId: 'p1' },
      });

      // u1 in regular remaining, u2 in infiltrators
      expect(state.deploymentState.unitsRemaining['p1']).toContain('u1');
      expect(state.deploymentState.unitsRemaining['p1']).not.toContain('u2');
      expect(state.deploymentState.infiltratorUnits).toContain('u2');
    });
  });

  // --- Deployment Zone Validation ---

  describe('Deployment Zone Validation', () => {
    it('passes when unit is placed within deployment zone', () => {
      let state = setupTwoPlayerGame();
      state = addDeploymentZones(state);
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 35 }]);

      const errors = validateDeploymentPosition(state, 'u1', { 'm1': { x: 30, y: 35 } });
      expect(errors).toHaveLength(0);
    });

    it('fails when unit is placed outside deployment zone', () => {
      let state = setupTwoPlayerGame();
      state = addDeploymentZones(state);
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 22 }]);

      // P1 zone is y: 30-44, so y=22 is outside
      const errors = validateDeploymentPosition(state, 'u1', { 'm1': { x: 30, y: 22 } });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('fails when unit is placed in enemy deployment zone', () => {
      let state = setupTwoPlayerGame();
      state = addDeploymentZones(state);
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 5 }]);

      // P1 trying to deploy in P2's zone (y: 0-14)
      const errors = validateDeploymentPosition(state, 'u1', { 'm1': { x: 30, y: 5 } });
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // --- Infiltrators Placement ---

  describe('Infiltrators Placement', () => {
    it('infiltrators can be deployed via DEPLOY_UNIT during deployment', () => {
      let state = setupTwoPlayerGame();
      state = addDeploymentZones(state);
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 0, y: 0 }], {
        abilities: ['Infiltrators'],
      });

      state = gameReducer(state, {
        type: 'BEGIN_DEPLOYMENT',
        payload: { firstDeployingPlayerId: 'p1' },
      });

      // Deploy infiltrators unit in no-man's land (middle of board)
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId: 'u1', positions: { 'm1': { x: 30, y: 22 } } },
      });

      expect(state.models['m1'].position).toEqual({ x: 30, y: 22 });
      expect(state.deploymentState.infiltratorUnits).not.toContain('u1');
    });
  });

  // --- First Turn Determination ---

  describe('First Turn Determination', () => {
    it('DETERMINE_FIRST_TURN sets the first player', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, {
        type: 'DETERMINE_FIRST_TURN',
        payload: { playerId: 'p1' },
      });

      expect(state.firstTurnPlayerId).toBe('p1');
      expect(state.turnState.activePlayerId).toBe('p1');
    });

    it('sets active player for the first turn', () => {
      let state = setupTwoPlayerGame();
      // P2 goes first
      state = gameReducer(state, {
        type: 'DETERMINE_FIRST_TURN',
        payload: {
          playerId: 'p2',
          roll: {
            player1Roll: makeDiceRoll([2], 'first turn'),
            player2Roll: makeDiceRoll([5], 'first turn'),
          },
        },
      });

      expect(state.firstTurnPlayerId).toBe('p2');
      expect(state.turnState.activePlayerId).toBe('p2');
    });

    it('logs first turn determination', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, {
        type: 'DETERMINE_FIRST_TURN',
        payload: { playerId: 'p1' },
      });

      const lastLog = state.log.entries[state.log.entries.length - 1];
      expect(lastLog.type).toBe('message');
      if (lastLog.type === 'message') {
        expect(lastLog.text).toContain('first turn');
      }
    });
  });

  // --- Scout Moves ---

  describe('Scout Moves', () => {
    it('SCOUT_MOVE updates model positions', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 35 }], {
        abilities: ['SCOUT 6"'],
      });

      state = gameReducer(state, {
        type: 'SCOUT_MOVE',
        payload: {
          unitId: 'u1',
          positions: { 'm1': { x: 30, y: 29 } },
        },
      });

      expect(state.models['m1'].position).toEqual({ x: 30, y: 29 });
    });

    // validateScoutMove unit tests moved to deployment/__tests__/validators.test.ts
  });

  // --- Redeployment ---

  describe('Redeployment', () => {
    it('RESOLVE_REDEPLOYMENT moves unit to new positions', () => {
      let state = setupTwoPlayerGame();
      state = addDeploymentZones(state);
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 35 }]);

      state = gameReducer(state, {
        type: 'RESOLVE_REDEPLOYMENT',
        payload: {
          unitId: 'u1',
          positions: { 'm1': { x: 40, y: 40 } },
        },
      });

      expect(state.models['m1'].position).toEqual({ x: 40, y: 40 });
    });

    it('logs redeployment', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 30, y: 35 }], { name: 'Intercessors' });

      state = gameReducer(state, {
        type: 'RESOLVE_REDEPLOYMENT',
        payload: {
          unitId: 'u1',
          positions: { 'm1': { x: 40, y: 40 } },
        },
      });

      const lastLog = state.log.entries[state.log.entries.length - 1];
      expect(lastLog.type).toBe('message');
      if (lastLog.type === 'message') {
        expect(lastLog.text).toContain('redeployed');
      }
    });
  });

  // --- Full Deployment Flow ---

  describe('Full Setup Flow Integration', () => {
    it('completes a full pre-game setup sequence', () => {
      let state = setupTwoPlayerGame();

      // Phase: muster
      expect(state.setupPhase).toBe('muster');
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 0, y: 0 }], {
        keywords: ['INFANTRY', 'CHARACTER', 'ADEPTUS ASTARTES'],
        points: 100,
      });
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 0, y: 0 }], {
        keywords: ['INFANTRY', 'ADEPTUS ASTARTES'],
        points: 100,
      });
      state = gameReducer(state, { type: 'DESIGNATE_WARLORD', payload: { modelId: 'm1' } });
      state = gameReducer(state, { type: 'SET_FACTION_KEYWORD', payload: { playerId: 'p1', keyword: 'ADEPTUS ASTARTES' } });
      state = gameReducer(state, { type: 'SET_POINTS_LIMIT', payload: { pointsLimit: 500 } });

      // Advance to createBattlefield
      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('createBattlefield');
      state = addDeploymentZones(state);

      // Advance to determineRoles
      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('determineRoles');
      state = gameReducer(state, {
        type: 'DETERMINE_ATTACKER_DEFENDER',
        payload: { attackerId: 'p1', defenderId: 'p2' },
      });

      // Advance to placeObjectives
      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('placeObjectives');

      // Advance to deploy
      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' });
      expect(state.setupPhase).toBe('deploy');

      // Begin alternating deployment
      state = gameReducer(state, {
        type: 'BEGIN_DEPLOYMENT',
        payload: { firstDeployingPlayerId: 'p1' },
      });

      // P1 deploys
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId: 'u1', positions: { 'm1': { x: 30, y: 35 } } },
      });
      expect(state.deploymentState.currentDeployingPlayerId).toBe('p2');

      // P2 deploys
      state = gameReducer(state, {
        type: 'DEPLOY_UNIT',
        payload: { unitId: 'u2', positions: { 'm2': { x: 30, y: 5 } } },
      });

      // Advance through remaining phases
      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' }); // redeployments
      expect(state.setupPhase).toBe('redeployments');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' }); // determineFirstTurn
      expect(state.setupPhase).toBe('determineFirstTurn');
      state = gameReducer(state, {
        type: 'DETERMINE_FIRST_TURN',
        payload: { playerId: 'p1' },
      });

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' }); // scoutMoves
      expect(state.setupPhase).toBe('scoutMoves');

      state = gameReducer(state, { type: 'ADVANCE_SETUP_PHASE' }); // ready
      expect(state.setupPhase).toBe('ready');

      // Verify final state
      expect(state.attackerId).toBe('p1');
      expect(state.defenderId).toBe('p2');
      expect(state.firstTurnPlayerId).toBe('p1');
      expect(state.turnState.activePlayerId).toBe('p1');
      expect(state.warlordModelId).toBe('m1');
      expect(state.models['m1'].position).toEqual({ x: 30, y: 35 });
      expect(state.models['m2'].position).toEqual({ x: 30, y: 5 });
    });
  });
});
