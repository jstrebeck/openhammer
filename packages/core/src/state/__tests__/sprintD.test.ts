import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import { CORE_STRATAGEMS } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { determineCover, applyBenefitOfCover } from '../../terrain/cover';
import type { TerrainPiece } from '../../types/terrain';
import '../../editions/index';

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
    makeModel({ id: m.id, unitId, position: { x: m.x, y: m.y } }),
  );
  const unit = makeUnit({
    id: unitId,
    playerId,
    modelIds: models.map((m) => m.id),
    ...overrides,
  });
  return gameReducer(state, { type: 'ADD_UNIT', payload: { unit, models: modelObjs } });
}

// ===============================================
// Phase 15: Terrain & Cover
// ===============================================

describe('Phase 15: Terrain & Cover', () => {
  describe('applyBenefitOfCover', () => {
    it('+1 to save when target has cover', () => {
      // 4+ save with cover = 3+ effective
      const result = applyBenefitOfCover(4, -1, true, false);
      expect(result).toBe(3); // 4 - 1 = 3 (better)
    });

    it('no modifier without cover', () => {
      const result = applyBenefitOfCover(4, -1, false, false);
      expect(result).toBe(4);
    });

    it('Ignores Cover negates cover', () => {
      const result = applyBenefitOfCover(4, -1, true, true);
      expect(result).toBe(4);
    });

    it('cover does not apply to 3+ save vs AP 0', () => {
      const result = applyBenefitOfCover(3, 0, true, false);
      expect(result).toBe(3); // No benefit — already 3+ with AP 0
    });

    it('cover DOES apply to 3+ save vs AP -1', () => {
      const result = applyBenefitOfCover(3, -1, true, false);
      expect(result).toBe(2); // 3 - 1 = 2 (cover helps when AP is nonzero)
    });

    it('cover applies to 4+ save vs AP 0', () => {
      const result = applyBenefitOfCover(4, 0, true, false);
      expect(result).toBe(3); // 4+ is worse than 3+, so cover helps
    });
  });

  describe('determineCover', () => {
    it('target wholly within dense terrain gets cover', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 30, y: 22 }]);

      // Place dense terrain around the target
      const terrain: TerrainPiece = {
        id: 't1',
        polygon: [
          { x: 28, y: 20 },
          { x: 32, y: 20 },
          { x: 32, y: 24 },
          { x: 28, y: 24 },
        ],
        height: 3,
        traits: ['dense'],
        label: 'Woods',
      };
      state = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain } });

      const cover = determineCover(state.units['u1'], state.units['u2'], state);
      expect(cover.hasCover).toBe(true);
      expect(cover.saveModifier).toBe(1);
    });

    it('target NOT within terrain gets no cover from "wholly within"', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 5 }]);
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 30, y: 22 }]);

      // Dense terrain not around the target
      const terrain: TerrainPiece = {
        id: 't1',
        polygon: [
          { x: 40, y: 40 },
          { x: 44, y: 40 },
          { x: 44, y: 44 },
          { x: 40, y: 44 },
        ],
        height: 3,
        traits: ['dense'],
        label: 'Woods',
      };
      state = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain } });

      const cover = determineCover(state.units['u1'], state.units['u2'], state);
      // No cover from wholly within, and LoS doesn't pass through either
      expect(cover.hasCover).toBe(false);
    });

    it('LoS through dense terrain grants cover', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 5, y: 22 }]);
      state = addUnit(state, 'u2', 'p2', [{ id: 'm2', x: 50, y: 22 }]);

      // Dense terrain between the two units
      const terrain: TerrainPiece = {
        id: 't1',
        polygon: [
          { x: 25, y: 20 },
          { x: 30, y: 20 },
          { x: 30, y: 24 },
          { x: 25, y: 24 },
        ],
        height: 3,
        traits: ['dense'],
        label: 'Dense Woods',
      };
      state = gameReducer(state, { type: 'PLACE_TERRAIN', payload: { terrain } });

      const cover = determineCover(state.units['u1'], state.units['u2'], state);
      expect(cover.hasCover).toBe(true);
      expect(cover.coverTerrainIds).toContain('t1');
    });
  });
});

// ===============================================
// Phase 16: Stratagems
// ===============================================

describe('Phase 16: Core Stratagems', () => {
  describe('CORE_STRATAGEMS definitions', () => {
    it('has 11 core stratagems', () => {
      expect(CORE_STRATAGEMS).toHaveLength(11);
    });

    it('Command Re-roll costs 1 CP and works in all phases', () => {
      const cr = CORE_STRATAGEMS.find(s => s.id === 'command-reroll');
      expect(cr).toBeDefined();
      expect(cr!.cpCost).toBe(1);
      expect(cr!.phases).toHaveLength(6); // all phases
    });

    it('Counter-Offensive costs 2 CP and is fight-phase only', () => {
      const co = CORE_STRATAGEMS.find(s => s.id === 'counter-offensive');
      expect(co).toBeDefined();
      expect(co!.cpCost).toBe(2);
      expect(co!.phases).toEqual(['fight']);
    });
  });

  describe('USE_STRATAGEM', () => {
    it('deducts CP and records usage', () => {
      let state = setupTwoPlayerGame();
      // Move to shooting phase for Grenade
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // movement
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // shooting

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1' },
      });

      expect(state.players['p1'].commandPoints).toBe(4); // 5 - 1
      expect(state.stratagemsUsedThisPhase).toContain('command-reroll');
    });

    it('cannot use the same stratagem twice in one phase', () => {
      let state = setupTwoPlayerGame();

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1' },
      });
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1' },
      });

      // CP should only be deducted once
      expect(state.players['p1'].commandPoints).toBe(4);
      const blocked = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('[BLOCKED]') && e.text.includes('already used'),
      );
      expect(blocked).toBeDefined();
    });

    it('blocks when not enough CP', () => {
      let state = setupTwoPlayerGame();
      // Set CP to 1 and try to use Counter-Offensive (2 CP)
      state = gameReducer(state, { type: 'SET_COMMAND_POINTS', payload: { playerId: 'p1', value: 1, reason: 'test' } });
      // Move to fight phase
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // movement
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // shooting
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // charge
      state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // fight

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'counter-offensive', playerId: 'p1' },
      });

      expect(state.players['p1'].commandPoints).toBe(1); // Not deducted
      const blocked = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('Not enough CP'),
      );
      expect(blocked).toBeDefined();
    });

    it('cannot target Battle-shocked units (except Insane Bravery)', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
      state = { ...state, battleShocked: ['u1'] };

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1', targetUnitId: 'u1' },
      });

      // Should be blocked
      expect(state.players['p1'].commandPoints).toBe(5);
      const blocked = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('Battle-shocked'),
      );
      expect(blocked).toBeDefined();
    });

    it('Insane Bravery CAN target Battle-shocked units', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);
      state = { ...state, battleShocked: ['u1'] };

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'insane-bravery', playerId: 'p1', targetUnitId: 'u1' },
      });

      // Should succeed
      expect(state.players['p1'].commandPoints).toBe(4); // 5 - 1
      expect(state.stratagemsUsedThisPhase).toContain('insane-bravery');
    });

    it('stratagemsUsedThisPhase resets on ADVANCE_PHASE', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1' },
      });
      expect(state.stratagemsUsedThisPhase).toContain('command-reroll');

      state = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(state.stratagemsUsedThisPhase).toHaveLength(0);
    });

    it('stratagemsUsedThisPhase resets on NEXT_TURN', () => {
      let state = setupTwoPlayerGame();
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1' },
      });

      state = gameReducer(state, { type: 'NEXT_TURN' });
      expect(state.stratagemsUsedThisPhase).toHaveLength(0);
    });

    it('blocks stratagem used in wrong phase', () => {
      let state = setupTwoPlayerGame();
      // We're in Command Phase (index 0), try to use Counter-Offensive (fight only)
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'counter-offensive', playerId: 'p1' },
      });

      expect(state.players['p1'].commandPoints).toBe(5); // Not deducted
      const blocked = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('cannot be used during'),
      );
      expect(blocked).toBeDefined();
    });

    it('logs the stratagem usage with unit name', () => {
      let state = setupTwoPlayerGame();
      state = addUnit(state, 'u1', 'p1', [{ id: 'm1', x: 10, y: 10 }]);

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1', targetUnitId: 'u1' },
      });

      const usageLog = state.log.entries.find(
        (e) => e.type === 'message' && 'text' in e && e.text.includes('uses Command Re-roll'),
      );
      expect(usageLog).toBeDefined();
    });
  });
});
