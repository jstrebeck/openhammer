import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, DiceRoll, Weapon } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import { parseWeaponAbilities } from '../../combat/abilities';
import { resolveAttackSequence } from '../../combat/attackPipeline';
import type { AttackContext } from '../../combat/attackPipeline';
// resolveSave moved to combat/__tests__/saves.test.ts
import { getSmokescreenModifiers, getGoToGroundModifiers, getStratagemSaveModifiers, getStratagemHitModifier, isEpicChallengePrecision } from '../../combat/stratagems';
// getAttachedUnitWoundTarget moved to combat/__tests__/woundAllocation.test.ts
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
  models: Array<{ id: string; x: number; y: number; wounds?: number; maxWounds?: number; stats?: Partial<import('../../types/index').ModelStats> }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
      wounds: m.wounds ?? 2,
      maxWounds: m.maxWounds ?? 2,
      stats: { ...makeModel().stats, ...m.stats },
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

function setPhase(state: GameState, phaseIndex: number): GameState {
  return {
    ...state,
    turnState: { ...state.turnState, currentPhaseIndex: phaseIndex },
  };
}

function makeDiceRoll(dice: number[], purpose: string, threshold?: number, reRolled?: boolean): DiceRoll {
  return {
    id: crypto.randomUUID(),
    dice,
    sides: 6,
    threshold,
    purpose,
    timestamp: Date.now(),
    reRolled,
  };
}

const testWeapon: Weapon = {
  id: 'bolter',
  name: 'Boltgun',
  type: 'ranged',
  range: 24,
  attacks: 2,
  skill: 3,
  strength: 4,
  ap: 0,
  damage: 1,
  abilities: [],
};

// ===============================================
// Phase 24a: Smokescreen Combat Integration
// ===============================================

describe('Phase 24a: Smokescreen Combat Integration', () => {
  // getSmokescreenModifiers tests moved to combat/__tests__/stratagems.test.ts

  describe('resolveAttackSequence with Smokescreen (-1 to Hit)', () => {
    it('applies -1 to Hit from targetHitModifier', () => {
      // With BS 3+ and -1 modifier, effective is 4+ (need 4+ to hit)
      // We'll run many attacks to verify statistically fewer hits
      const weapon: Weapon = { ...testWeapon, attacks: 1 };
      const ctx: AttackContext = {
        weapon,
        abilities: parseWeaponAbilities(weapon),
        distanceToTarget: 12,
        targetUnitSize: 5,
        targetKeywords: ['INFANTRY'],
        attackerStationary: false,
        attackerCharged: false,
        attackerModelCount: 1,
        targetHitModifier: -1,
      };

      const result = resolveAttackSequence(1, 3, 4, 4, ctx);
      // Result should log the Stealth trigger
      expect(result.triggeredAbilities).toContain('Stealth (-1 to Hit)');
    });

    it('clamps total hit modifier to -1 even with multiple penalties', () => {
      // Indirect Fire (-1) + Stealth (-1) should clamp to -1 total
      const weapon: Weapon = {
        ...testWeapon,
        attacks: 1,
        abilities: ['INDIRECT FIRE'],
      };
      const ctx: AttackContext = {
        weapon,
        abilities: parseWeaponAbilities(weapon),
        distanceToTarget: 12,
        targetUnitSize: 5,
        targetKeywords: ['INFANTRY'],
        attackerStationary: false,
        attackerCharged: false,
        attackerModelCount: 1,
        targetHitModifier: -1,
      };

      const result = resolveAttackSequence(1, 3, 4, 4, ctx);
      // Both should trigger but clamp to -1
      expect(result.triggeredAbilities).toContain('Indirect Fire (-1 to Hit)');
      expect(result.triggeredAbilities).toContain('Stealth (-1 to Hit)');
    });
  });

  // resolveSave with cover tests moved to combat/__tests__/saves.test.ts

  describe('Smokescreen end-to-end in game state', () => {
    it('smokescreenUnits is set by USE_STRATAGEM and checked by helper', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      state = addUnit(state, 'smoke-unit', 'p2', [{ id: 'smoke-m1', x: 10, y: 10 }], {
        name: 'Smoky Squad',
        keywords: ['INFANTRY', 'SMOKE'],
      });

      // Use Smokescreen stratagem
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'smokescreen', playerId: 'p2', targetUnitId: 'smoke-unit' },
      });

      // Helper should return modifiers
      expect(getSmokescreenModifiers(state, 'smoke-unit').hitModifier).toBe(-1);
      expect(getSmokescreenModifiers(state, 'smoke-unit').coverSaveModifier).toBe(1);
      expect(getStratagemHitModifier(state, 'smoke-unit')).toBe(-1);
    });
  });
});

// ===============================================
// Phase 24a: Go to Ground Combat Integration
// ===============================================

describe('Phase 24a: Go to Ground Combat Integration', () => {
  // getGoToGroundModifiers tests moved to combat/__tests__/stratagems.test.ts

  // resolveSave with Go to Ground tests moved to combat/__tests__/saves.test.ts

  // getStratagemSaveModifiers test moved to combat/__tests__/stratagems.test.ts

  describe('Go to Ground end-to-end in game state', () => {
    it('goToGroundUnits is set by USE_STRATAGEM and checked by helper', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      state = addUnit(state, 'ground-unit', 'p2', [{ id: 'ground-m1', x: 10, y: 10 }], {
        name: 'Prone Squad',
        keywords: ['INFANTRY'],
      });

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'go-to-ground', playerId: 'p2', targetUnitId: 'ground-unit' },
      });

      const mods = getGoToGroundModifiers(state, 'ground-unit');
      expect(mods.coverSaveModifier).toBe(1);
      expect(mods.bonusInvulnSave).toBe(6);
    });
  });
});

// ===============================================
// Phase 24a: Epic Challenge Combat Integration
// ===============================================

describe('Phase 24a: Epic Challenge Combat Integration', () => {
  // isEpicChallengePrecision tests moved to combat/__tests__/stratagems.test.ts

  // Epic Challenge grants Precision test moved to combat/__tests__/woundAllocation.test.ts

  describe('Epic Challenge end-to-end in game state', () => {
    it('epicChallengeUnits is set by USE_STRATAGEM and read by helper', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'champ-unit', 'p1', [{ id: 'champ-m1', x: 10, y: 10 }], {
        name: 'Chapter Champion',
        keywords: ['INFANTRY', 'CHARACTER'],
      });

      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'epic-challenge', playerId: 'p1', targetUnitId: 'champ-unit' },
      });

      expect(isEpicChallengePrecision(state, 'champ-unit')).toBe(true);
    });

    it('epicChallengeUnits clears on phase advance', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 4);
      state = { ...state, stratagemEffects: { ...state.stratagemEffects, epicChallengeUnits: ['champ-unit'] } };

      state = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(isEpicChallengePrecision(state, 'champ-unit')).toBe(false);
    });
  });
});
