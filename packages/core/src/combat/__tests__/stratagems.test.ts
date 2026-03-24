import { describe, it, expect } from 'vitest';
import { getSmokescreenModifiers, getGoToGroundModifiers, getStratagemSaveModifiers, getStratagemHitModifier, isEpicChallengePrecision } from '../stratagems';
import { gameReducer } from '../../state/reducer';
import { createInitialGameState } from '../../state/initialState';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import type { GameState } from '../../types/index';
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

// ===============================================
// Smokescreen Combat Integration (from sprintG_24a)
// ===============================================

describe('Smokescreen Combat Integration', () => {
  describe('getSmokescreenModifiers', () => {
    it('returns -1 hit modifier and +1 cover for smokescreened unit', () => {
      let state = setupTwoPlayerGame();
      state = { ...state, stratagemEffects: { ...state.stratagemEffects, smokescreenUnits: ['target-unit'] } };

      const mods = getSmokescreenModifiers(state, 'target-unit');
      expect(mods.hitModifier).toBe(-1);
      expect(mods.coverSaveModifier).toBe(1);
    });

    it('returns zero modifiers for non-smokescreened unit', () => {
      const state = setupTwoPlayerGame();
      const mods = getSmokescreenModifiers(state, 'target-unit');
      expect(mods.hitModifier).toBe(0);
      expect(mods.coverSaveModifier).toBe(0);
    });
  });
});

// ===============================================
// Go to Ground Combat Integration (from sprintG_24a)
// ===============================================

describe('Go to Ground Combat Integration', () => {
  describe('getGoToGroundModifiers', () => {
    it('returns +1 cover and 6+ invuln for unit gone to ground', () => {
      let state = setupTwoPlayerGame();
      state = { ...state, stratagemEffects: { ...state.stratagemEffects, goToGroundUnits: ['target-unit'] } };

      const mods = getGoToGroundModifiers(state, 'target-unit');
      expect(mods.coverSaveModifier).toBe(1);
      expect(mods.bonusInvulnSave).toBe(6);
    });

    it('returns zero modifiers for non-affected unit', () => {
      const state = setupTwoPlayerGame();
      const mods = getGoToGroundModifiers(state, 'target-unit');
      expect(mods.coverSaveModifier).toBe(0);
      expect(mods.bonusInvulnSave).toBeUndefined();
    });
  });

  describe('getStratagemSaveModifiers combines Smokescreen and Go to Ground', () => {
    it('returns combined modifiers when both active', () => {
      let state = setupTwoPlayerGame();
      state = {
        ...state,
        stratagemEffects: {
          ...state.stratagemEffects,
          smokescreenUnits: ['target-unit'],
          goToGroundUnits: ['target-unit'],
        },
      };

      const mods = getStratagemSaveModifiers(state, 'target-unit');
      // Cover is not cumulative — max of 1 from either source
      expect(mods.coverSaveModifier).toBe(1);
      expect(mods.bonusInvulnSave).toBe(6);
    });
  });
});

// ===============================================
// Epic Challenge Combat Integration (from sprintG_24a)
// ===============================================

describe('Epic Challenge Combat Integration', () => {
  describe('isEpicChallengePrecision', () => {
    it('returns true for unit in epicChallengeUnits', () => {
      let state = setupTwoPlayerGame();
      state = { ...state, stratagemEffects: { ...state.stratagemEffects, epicChallengeUnits: ['champ-unit'] } };

      expect(isEpicChallengePrecision(state, 'champ-unit')).toBe(true);
    });

    it('returns false for non-affected unit', () => {
      const state = setupTwoPlayerGame();
      expect(isEpicChallengePrecision(state, 'champ-unit')).toBe(false);
    });
  });
});
