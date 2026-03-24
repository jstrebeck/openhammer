import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState, Weapon } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
// weaponHasAbility, parseWeaponAbility, resolveAttackSequence, calculateAttacks moved to combat/__tests__/
// getEngagementShootingMode, isUnitInEngagementRange, getEngagedEnemyUnits moved to combat/__tests__/shooting.test.ts
// getWoundAllocationTarget moved to combat/__tests__/woundAllocation.test.ts
import { applyBenefitOfCover } from '../../terrain/cover';
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
  models: Array<{ id: string; x: number; y: number; wounds?: number; maxWounds?: number }>,
  overrides?: Partial<import('../../types/index').Unit>,
): GameState {
  const modelObjs = models.map((m) =>
    makeModel({
      id: m.id,
      unitId,
      position: { x: m.x, y: m.y },
      wounds: m.wounds ?? 2,
      maxWounds: m.maxWounds ?? 2,
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
  return { ...state, turnState: { ...state.turnState, currentPhaseIndex: phaseIndex } };
}

function enforcePhaseRestrictions(state: GameState): GameState {
  return { ...state, rulesConfig: { ...state.rulesConfig, phaseRestrictions: 'enforce' } };
}

const bolter: Weapon = {
  id: 'w-bolter', name: 'Bolt Rifle', type: 'ranged', range: 24,
  attacks: 2, skill: 3, strength: 4, ap: -1, damage: 1, abilities: [],
};

const pistol: Weapon = {
  id: 'w-pistol', name: 'Bolt Pistol', type: 'ranged', range: 12,
  attacks: 1, skill: 3, strength: 4, ap: 0, damage: 1, abilities: ['PISTOL'],
};

const oneShotWeapon: Weapon = {
  id: 'w-missile', name: 'Hunter-Killer Missile', type: 'ranged', range: 48,
  attacks: 1, skill: 3, strength: 10, ap: -3, damage: 'D6', abilities: ['ONE SHOT'],
};

const hazardousWeapon: Weapon = {
  id: 'w-plasma', name: 'Plasma Incinerator', type: 'ranged', range: 24,
  attacks: 2, skill: 3, strength: 8, ap: -3, damage: 2, abilities: ['HAZARDOUS'],
};

// ===============================================
// Phase 22: Shooting Rules Completion
// ===============================================

describe('Phase 22: Shooting Rules Completion', () => {

  // --- Big Guns Never Tire ---

  describe('Big Guns Never Tire', () => {
    it('VEHICLE can shoot ranged weapons in Engagement Range', () => {
      let state = setupTwoPlayerGame();
      state = enforcePhaseRestrictions(state);
      state = setPhase(state, 2); // Shooting phase

      // Vehicle at (10,10), enemy at (11,10) — within 1" engagement range
      state = addUnit(state, 'vehicle-unit', 'p1', [{ id: 'v-m1', x: 10, y: 10 }], {
        name: 'Leman Russ',
        keywords: ['VEHICLE'],
        weapons: [bolter],
      });
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 11, y: 10 }]);

      // VEHICLE can declare shooting while in engagement range
      const result = gameReducer(state, {
        type: 'DECLARE_SHOOTING',
        payload: { unitId: 'vehicle-unit' },
      });

      expect(result.shootingState.activeShootingUnit).toBe('vehicle-unit');
    });

    // getEngagementShootingMode test moved to combat/__tests__/shooting.test.ts

    it('regular infantry cannot shoot in Engagement Range', () => {
      let state = setupTwoPlayerGame();
      state = enforcePhaseRestrictions(state);
      state = setPhase(state, 2);

      // Infantry at (10,10), enemy at (11,10) — within engagement range
      state = addUnit(state, 'inf-unit', 'p1', [{ id: 'i-m1', x: 10, y: 10 }], {
        name: 'Intercessors',
        keywords: ['INFANTRY'],
        weapons: [bolter], // No Pistol, not MONSTER/VEHICLE
      });
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 11, y: 10 }]);

      const result = gameReducer(state, {
        type: 'DECLARE_SHOOTING',
        payload: { unitId: 'inf-unit' },
      });

      // Should be blocked
      expect(result.shootingState.activeShootingUnit).toBeNull();
      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('[BLOCKED]') && e.text.includes('Engagement Range')
      )).toBe(true);
    });
  });

  // --- Pistols ---

  describe('Pistols', () => {
    it('Pistol weapons can fire in Engagement Range at engaged units', () => {
      let state = setupTwoPlayerGame();
      state = enforcePhaseRestrictions(state);
      state = setPhase(state, 2);

      // Unit with Pistol at (10,10), enemy at (11,10)
      state = addUnit(state, 'pistol-unit', 'p1', [{ id: 'p-m1', x: 10, y: 10 }], {
        name: 'Tactical Marine',
        keywords: ['INFANTRY'],
        weapons: [pistol, bolter],
      });
      state = addUnit(state, 'enemy-unit', 'p2', [{ id: 'e-m1', x: 11, y: 10 }]);

      // Should be allowed (has Pistol)
      const result = gameReducer(state, {
        type: 'DECLARE_SHOOTING',
        payload: { unitId: 'pistol-unit' },
      });

      expect(result.shootingState.activeShootingUnit).toBe('pistol-unit');
    });

    // getEngagementShootingMode tests moved to combat/__tests__/shooting.test.ts
  });

  // --- Hazardous ---

  describe('Hazardous', () => {
    it('RESOLVE_HAZARDOUS destroys models that rolled 1', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2);

      state = addUnit(state, 'plasma-unit', 'p1', [
        { id: 'pm1', x: 10, y: 10 },
        { id: 'pm2', x: 11, y: 10 },
      ], {
        name: 'Hellblasters',
        weapons: [hazardousWeapon],
      });

      // Model pm1 rolled a 1 — destroyed. pm2 rolled 4 — survives.
      const result = gameReducer(state, {
        type: 'RESOLVE_HAZARDOUS',
        payload: {
          unitId: 'plasma-unit',
          weaponId: 'w-plasma',
          rolls: { id: 'r1', dice: [1, 4], sides: 6, purpose: 'Hazardous', timestamp: Date.now() },
          destroyedModelIds: ['pm1'],
        },
      });

      expect(result.models['pm1'].status).toBe('destroyed');
      expect(result.models['pm2'].status).toBe('active');
    });
  });

  // --- One Shot ---

  describe('One Shot', () => {
    it('One Shot weapon can fire once', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2);

      state = addUnit(state, 'tank-unit', 'p1', [{ id: 'tk1', x: 10, y: 10 }], {
        name: 'Predator',
        keywords: ['VEHICLE'],
        weapons: [oneShotWeapon],
      });
      state = addUnit(state, 'target-unit', 'p2', [{ id: 'tg1', x: 30, y: 10 }]);

      // First shot — should succeed
      state = gameReducer(state, {
        type: 'RESOLVE_SHOOTING_ATTACK',
        payload: {
          attackingUnitId: 'tank-unit',
          attackingModelId: 'tk1',
          weaponId: 'w-missile',
          weaponName: 'Hunter-Killer Missile',
          targetUnitId: 'target-unit',
          numAttacks: 1,
          hitRoll: { id: 'r1', dice: [4], sides: 6, threshold: 3, purpose: 'To Hit', timestamp: Date.now() },
          hits: 1,
          woundRoll: { id: 'r2', dice: [5], sides: 6, threshold: 3, purpose: 'To Wound', timestamp: Date.now() },
          wounds: 1,
        },
      });

      expect(state.weaponsFired['tank-unit:w-missile']).toBe(true);
    });

    it('One Shot blocks second use of same weapon', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2);

      state = addUnit(state, 'tank-unit', 'p1', [{ id: 'tk1', x: 10, y: 10 }], {
        name: 'Predator',
        keywords: ['VEHICLE'],
        weapons: [oneShotWeapon],
      });
      state = addUnit(state, 'target-unit', 'p2', [{ id: 'tg1', x: 30, y: 10 }]);

      // Mark as already fired
      state = { ...state, weaponsFired: { 'tank-unit:w-missile': true } };

      // Second shot — should be blocked
      const result = gameReducer(state, {
        type: 'RESOLVE_SHOOTING_ATTACK',
        payload: {
          attackingUnitId: 'tank-unit',
          attackingModelId: 'tk1',
          weaponId: 'w-missile',
          weaponName: 'Hunter-Killer Missile',
          targetUnitId: 'target-unit',
          numAttacks: 1,
          hitRoll: { id: 'r1', dice: [4], sides: 6, threshold: 3, purpose: 'To Hit', timestamp: Date.now() },
          hits: 1,
          woundRoll: { id: 'r2', dice: [5], sides: 6, threshold: 3, purpose: 'To Wound', timestamp: Date.now() },
          wounds: 1,
        },
      });

      expect(result.log.entries.some(e =>
        e.type === 'message' && e.text.includes('[BLOCKED]') && e.text.includes('ONE SHOT')
      )).toBe(true);
      // Attack should NOT have been added
      expect(result.shootingState.activeAttacks.length).toBe(0);
    });
  });

  // --- Ignores Cover ---

  describe('Ignores Cover', () => {
    it('Ignores Cover skips Benefit of Cover', () => {
      // applyBenefitOfCover with ignoresCover=true should NOT modify save
      const modifiedSave = applyBenefitOfCover(4, -1, true, true);
      expect(modifiedSave).toBe(4); // Unchanged

      // Without ignores cover
      const withCover = applyBenefitOfCover(4, -1, true, false);
      expect(withCover).toBe(3); // +1 to save (lower = better)
    });
  });

  // Indirect Fire, Extra Attacks, and Engagement range helpers
  // moved to combat/__tests__/attackPipeline.test.ts and combat/__tests__/shooting.test.ts
});
