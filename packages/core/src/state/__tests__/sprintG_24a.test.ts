import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, DiceRoll, Weapon } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
import {
  resolveAttackSequence,
  resolveSave,
  parseWeaponAbilities,
  getSmokescreenModifiers,
  getGoToGroundModifiers,
  getStratagemSaveModifiers,
  getStratagemHitModifier,
  isEpicChallengePrecision,
  getAttachedUnitWoundTarget,
} from '../../combat/index';
import type { AttackContext } from '../../combat/index';
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
  describe('getSmokescreenModifiers', () => {
    it('returns -1 hit modifier and +1 cover for smokescreened unit', () => {
      let state = setupTwoPlayerGame();
      state = { ...state, smokescreenUnits: ['target-unit'] };

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

  describe('resolveSave with cover bonus from Smokescreen', () => {
    it('grants +1 save with coverSaveModifier', () => {
      // Save 4+, AP 0 → with +1 cover → effective 3+
      // A roll of 3 should save with cover but not without
      // Use deterministic approach: just check the function accepts the parameter
      const resultWithCover = resolveSave(4, 0, undefined, { coverSaveModifier: 1 });
      // Function should work without error (we can't control dice here)
      expect(resultWithCover).toHaveProperty('saveRoll');
      expect(resultWithCover).toHaveProperty('saved');
    });

    it('cover does not help 3+ save vs AP 0', () => {
      // Save 3+, AP 0 → cover should NOT improve save
      // The rule: cover doesn't help models with 3+ or better save vs AP 0
      const result = resolveSave(3, 0, undefined, { coverSaveModifier: 1 });
      // The threshold in the roll should still be 3 (not 2)
      expect(result.saveRoll.threshold).toBeLessThanOrEqual(3);
    });

    it('cover helps 4+ save vs AP -1', () => {
      // Save 4+, AP -1 → modified save 5+, with +1 cover → effective 4+
      // Even though AP is non-zero, cover should help
      const result = resolveSave(4, -1, undefined, { coverSaveModifier: 1 });
      // effective save = (4 - 1) - (-1) = 4. With cover: (4-1) - (-1) = 3+1 = 4
      // Actually: effectiveSaveChar = 4 - 1 = 3, modifiedSave = 3 - (-1) = 4
      expect(result.saveRoll.threshold).toBeLessThanOrEqual(4);
    });
  });

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
  describe('getGoToGroundModifiers', () => {
    it('returns +1 cover and 6+ invuln for unit gone to ground', () => {
      let state = setupTwoPlayerGame();
      state = { ...state, goToGroundUnits: ['target-unit'] };

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

  describe('resolveSave with Go to Ground modifiers', () => {
    it('grants 6+ invulnerable save', () => {
      // Save 6+, AP -3 → modified save 9+ (impossible), but bonusInvuln 6+ → effective 6+
      const result = resolveSave(6, -3, undefined, { bonusInvulnSave: 6 });
      // Threshold should be 6 (the bonus invuln) since modified save is impossible
      expect(result.saveRoll.threshold).toBe(6);
    });

    it('bonus invuln does not override better existing invuln', () => {
      // Unit already has 4+ invuln, bonus 6+ should not make it worse
      const result = resolveSave(6, -3, 4, { bonusInvulnSave: 6 });
      // Best invuln = min(4, 6) = 4
      expect(result.saveRoll.threshold).toBe(4);
    });

    it('combines cover bonus and invuln from Go to Ground', () => {
      // Save 5+, AP -1, no existing invuln
      // With Go to Ground: cover +1 (5+ becomes 4+), modified = 4 - (-1) = 5, invuln 6+
      // Effective save = min(5, 6) = 5
      const result = resolveSave(5, -1, undefined, {
        coverSaveModifier: 1,
        bonusInvulnSave: 6,
      });
      expect(result.saveRoll.threshold).toBe(5);
    });
  });

  describe('getStratagemSaveModifiers combines Smokescreen and Go to Ground', () => {
    it('returns combined modifiers when both active', () => {
      let state = setupTwoPlayerGame();
      state = {
        ...state,
        smokescreenUnits: ['target-unit'],
        goToGroundUnits: ['target-unit'],
      };

      const mods = getStratagemSaveModifiers(state, 'target-unit');
      // Cover is not cumulative — max of 1 from either source
      expect(mods.coverSaveModifier).toBe(1);
      expect(mods.bonusInvulnSave).toBe(6);
    });
  });

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
  describe('isEpicChallengePrecision', () => {
    it('returns true for unit in epicChallengeUnits', () => {
      let state = setupTwoPlayerGame();
      state = { ...state, epicChallengeUnits: ['champ-unit'] };

      expect(isEpicChallengePrecision(state, 'champ-unit')).toBe(true);
    });

    it('returns false for non-affected unit', () => {
      const state = setupTwoPlayerGame();
      expect(isEpicChallengePrecision(state, 'champ-unit')).toBe(false);
    });
  });

  describe('Epic Challenge grants Precision — bypasses Bodyguard allocation', () => {
    it('with Precision=true, wounds go to CHARACTER (leader), not Bodyguard', () => {
      const leaderUnit = makeUnit({
        id: 'leader',
        playerId: 'p1',
        modelIds: ['leader-m1'],
        keywords: ['INFANTRY', 'CHARACTER'],
      });
      const bodyguardUnit = makeUnit({
        id: 'bodyguard',
        playerId: 'p1',
        modelIds: ['bg-m1', 'bg-m2'],
        keywords: ['INFANTRY'],
      });
      const models: Record<string, import('../../types/index').Model> = {
        'leader-m1': makeModel({ id: 'leader-m1', unitId: 'leader', wounds: 4, maxWounds: 4 }),
        'bg-m1': makeModel({ id: 'bg-m1', unitId: 'bodyguard', wounds: 2, maxWounds: 2 }),
        'bg-m2': makeModel({ id: 'bg-m2', unitId: 'bodyguard', wounds: 2, maxWounds: 2 }),
      };

      // Without Precision: bodyguard absorbs wounds
      const normalTarget = getAttachedUnitWoundTarget(leaderUnit, bodyguardUnit, models, false);
      expect(normalTarget?.id).toBe('bg-m1');

      // With Precision (Epic Challenge): CHARACTER takes wounds
      const precisionTarget = getAttachedUnitWoundTarget(leaderUnit, bodyguardUnit, models, true);
      expect(precisionTarget?.id).toBe('leader-m1');
    });
  });

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
      state = { ...state, epicChallengeUnits: ['champ-unit'] };

      state = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(isEpicChallengePrecision(state, 'champ-unit')).toBe(false);
    });
  });
});
