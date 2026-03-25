import { describe, it, expect } from 'vitest';
import { gameReducer } from '../reducer';
import { createInitialGameState } from '../initialState';
import type { GameState } from '../../types/index';
import type { DiceRoll } from '../../types/index';
import { makeModel, makeUnit, makePlayer } from '../../test-helpers';
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

/** Set the current phase index (0=command, 1=movement, 2=shooting, 3=charge, 4=fight) */
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

// ===============================================
// Phase 24: Stratagem Effects
// ===============================================

describe('Phase 24: Stratagem Effects', () => {
  // --- Command Re-roll ---

  describe('Command Re-roll', () => {
    it('re-rolls a failed save and applies new result', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      // Use the stratagem
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'command-reroll', playerId: 'p1' },
      });

      expect(state.players['p1'].commandPoints).toBe(4); // 5 - 1 CP

      // Create the original roll (failed save — rolled a 2 on 3+)
      const originalRoll = makeDiceRoll([2], 'Save', 3);

      // Log the original roll
      state = gameReducer(state, { type: 'ROLL_DICE', payload: { roll: originalRoll } });

      // Apply command re-roll with a new roll
      const newRoll = makeDiceRoll([5], 'Save (re-roll)', 3);
      const result = gameReducer(state, {
        type: 'APPLY_COMMAND_REROLL',
        payload: { originalRollId: originalRoll.id, newRoll },
      });

      // New roll should be logged as a re-roll
      const diceEntries = result.log.entries.filter(e => e.type === 'dice_roll');
      const lastDiceEntry = diceEntries[diceEntries.length - 1];
      expect(lastDiceEntry.type).toBe('dice_roll');
      if (lastDiceEntry.type === 'dice_roll') {
        expect(lastDiceEntry.roll.reRolled).toBe(true);
        expect(lastDiceEntry.roll.dice).toEqual([5]);
      }
    });

    it('cannot re-roll an already-rerolled die', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      // Log an already re-rolled die
      const reRolledDie = makeDiceRoll([2], 'Save (re-roll)', 3, true);
      state = gameReducer(state, { type: 'ROLL_DICE', payload: { roll: reRolledDie } });

      // Try to re-roll it again
      const anotherRoll = makeDiceRoll([5], 'Save (re-roll 2)', 3);
      const result = gameReducer(state, {
        type: 'APPLY_COMMAND_REROLL',
        payload: { originalRollId: reRolledDie.id, newRoll: anotherRoll },
      });

      // Should be blocked
      const lastEntry = result.log.entries[result.log.entries.length - 1];
      expect(lastEntry.type).toBe('message');
      if (lastEntry.type === 'message') {
        expect(lastEntry.text).toContain('BLOCKED');
        expect(lastEntry.text).toContain('already re-rolled');
      }
    });
  });

  // --- Counter-Offensive ---

  describe('Counter-Offensive', () => {
    it('interrupts fight order by inserting unit at front of eligible list', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 4); // Fight phase

      // P1 unit and P2 unit in engagement range (very close)
      state = addUnit(state, 'p1-unit', 'p1', [{ id: 'p1-m1', x: 10, y: 10 }], {
        name: 'Assault Marines',
      });
      state = addUnit(state, 'p2-unit', 'p2', [{ id: 'p2-m1', x: 10.5, y: 10 }], {
        name: 'Ork Boyz',
      });

      // Initialize fight phase
      state = gameReducer(state, { type: 'INITIALIZE_FIGHT_PHASE' });

      // P2 uses Counter-Offensive on their unit
      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'counter-offensive', playerId: 'p2', targetUnitId: 'p2-unit' },
      });

      // P2's unit should be at the front of the eligible list
      expect(result.fightState.eligibleUnits[0]).toBe('p2-unit');
      // P2 should select next
      expect(result.fightState.nextToSelect).toBe('p2');
      // CP deducted (2 CP for Counter-Offensive)
      expect(result.players['p2'].commandPoints).toBe(3);
    });
  });

  // --- Tank Shock ---

  describe('Tank Shock', () => {
    it('inflicts mortal wounds on 5+ per model in target unit', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 3); // Charge phase

      state = addUnit(state, 'tank', 'p1', [{ id: 'tank-m1', x: 10, y: 10, wounds: 10, maxWounds: 10 }], {
        name: 'Leman Russ',
        keywords: ['VEHICLE'],
      });
      state = addUnit(state, 'target', 'p2', [
        { id: 'target-m1', x: 11, y: 10 },
        { id: 'target-m2', x: 11.5, y: 10 },
        { id: 'target-m3', x: 12, y: 10 },
      ], { name: 'Guardsmen' });

      // Use Tank Shock stratagem first
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'tank-shock', playerId: 'p1', targetUnitId: 'tank' },
      });

      // Resolve: roll D6 per model in target (3 models) — dice: [5, 3, 6] → 2 mortal wounds
      const roll = makeDiceRoll([5, 3, 6], 'Tank Shock');
      const result = gameReducer(state, {
        type: 'RESOLVE_TANK_SHOCK',
        payload: { unitId: 'tank', targetUnitId: 'target', roll },
      });

      // 2 mortal wounds applied — one model destroyed (2W each, 2 MW kills 1)
      const activeTargets = ['target-m1', 'target-m2', 'target-m3']
        .filter(id => result.models[id].status === 'active');
      expect(activeTargets.length).toBe(2);

      // Log should mention Tank Shock
      const messages = result.log.entries.filter(e => e.type === 'message');
      const tankShockMsg = messages.find(e => e.type === 'message' && e.text.includes('Tank Shock'));
      expect(tankShockMsg).toBeDefined();
    });
  });

  // --- Insane Bravery ---

  describe('Insane Bravery', () => {
    it('auto-passes Battle-shock and removes from battleShocked', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 0); // Command phase

      state = addUnit(state, 'shocked-unit', 'p1', [{ id: 'sh-m1', x: 10, y: 10 }], {
        name: 'Battered Squad',
      });

      // Make the unit battle-shocked
      state = { ...state, battleShocked: ['shocked-unit'] };

      // Use Insane Bravery
      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'insane-bravery', playerId: 'p1', targetUnitId: 'shocked-unit' },
      });

      // Unit should no longer be battle-shocked
      expect(result.battleShocked).not.toContain('shocked-unit');
      // CP deducted
      expect(result.players['p1'].commandPoints).toBe(4);
      // Log message
      const messages = result.log.entries.filter(e => e.type === 'message');
      const braveryMsg = messages.find(e => e.type === 'message' && e.text.includes('Insane Bravery'));
      expect(braveryMsg).toBeDefined();
    });
  });

  // --- Grenade ---

  describe('Grenade', () => {
    it('rolls 6D6 and inflicts mortal wounds on 4+', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      state = addUnit(state, 'grenadier', 'p1', [{ id: 'gren-m1', x: 10, y: 10 }], {
        name: 'Grenadiers',
        keywords: ['INFANTRY', 'GRENADES'],
      });
      state = addUnit(state, 'target', 'p2', [
        { id: 'target-m1', x: 15, y: 10 },
        { id: 'target-m2', x: 15.5, y: 10 },
      ], { name: 'Xenos' });

      // Use Grenade stratagem
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'grenade', playerId: 'p1', targetUnitId: 'grenadier' },
      });

      // Roll 6D6: [4, 2, 5, 1, 6, 3] → 3 mortal wounds (4, 5, 6 pass)
      const roll = makeDiceRoll([4, 2, 5, 1, 6, 3], 'Grenade', 4);
      const result = gameReducer(state, {
        type: 'RESOLVE_GRENADE',
        payload: { unitId: 'grenadier', targetUnitId: 'target', roll },
      });

      // 3 mortal wounds: first model takes 2 (destroyed), second takes 1
      expect(result.models['target-m1'].status).toBe('destroyed');
      expect(result.models['target-m2'].wounds).toBe(1);
    });
  });

  // --- Fire Overwatch ---

  describe('Fire Overwatch', () => {
    it('only hits on unmodified 6', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1); // Movement phase (opponent's turn)

      state = addUnit(state, 'defender', 'p2', [{ id: 'def-m1', x: 10, y: 10 }], {
        name: 'Devastators',
      });
      state = addUnit(state, 'attacker', 'p1', [{ id: 'att-m1', x: 20, y: 10 }], {
        name: 'Charging Unit',
      });

      // Use Fire Overwatch
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'fire-overwatch', playerId: 'p2', targetUnitId: 'defender' },
      });

      // Should set outOfPhaseAction
      expect(state.outOfPhaseAction).toEqual({
        stratagemId: 'fire-overwatch',
        playerId: 'p2',
      });

      // Resolve overwatch: hit roll [3, 6, 5, 6] — only 6s count → 2 hits
      const hitRoll = makeDiceRoll([3, 6, 5, 6], 'Overwatch Hit', 6);
      const woundRoll = makeDiceRoll([4, 5], 'Overwatch Wound', 4);
      const result = gameReducer(state, {
        type: 'RESOLVE_OVERWATCH',
        payload: {
          attackingUnitId: 'defender',
          targetUnitId: 'attacker',
          hitRoll,
          hits: 2,
          woundRoll,
          wounds: 2,
        },
      });

      // Out-of-phase action should be cleared
      expect(result.outOfPhaseAction).toBeUndefined();

      // Log should mention Fire Overwatch with correct hit count
      const messages = result.log.entries.filter(e => e.type === 'message');
      const owMsg = messages.find(e => e.type === 'message' && e.text.includes('Fire Overwatch') && e.text.includes('hit'));
      expect(owMsg).toBeDefined();
      if (owMsg && owMsg.type === 'message') {
        expect(owMsg.text).toContain('2 hit(s)');
      }
    });
  });

  // --- Smokescreen ---

  describe('Smokescreen', () => {
    it('grants cover and stealth (adds unit to smokescreenUnits)', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      state = addUnit(state, 'smoke-unit', 'p2', [{ id: 'smoke-m1', x: 10, y: 10 }], {
        name: 'Smoky Squad',
        keywords: ['INFANTRY', 'SMOKE'],
      });

      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'smokescreen', playerId: 'p2', targetUnitId: 'smoke-unit' },
      });

      expect(result.stratagemEffects.smokescreenUnits).toContain('smoke-unit');
      expect(result.players['p2'].commandPoints).toBe(4);
    });

    it('clears smokescreenUnits on phase advance', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2);
      state = { ...state, stratagemEffects: { ...state.stratagemEffects, smokescreenUnits: ['some-unit'] } };

      const result = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(result.stratagemEffects.smokescreenUnits).toEqual([]);
    });
  });

  // --- Go to Ground ---

  describe('Go to Ground', () => {
    it('grants 6+ invuln and cover (adds unit to goToGroundUnits)', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      state = addUnit(state, 'ground-unit', 'p2', [{ id: 'ground-m1', x: 10, y: 10 }], {
        name: 'Prone Squad',
        keywords: ['INFANTRY'],
      });

      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'go-to-ground', playerId: 'p2', targetUnitId: 'ground-unit' },
      });

      expect(result.stratagemEffects.goToGroundUnits).toContain('ground-unit');
      expect(result.players['p2'].commandPoints).toBe(4);
    });

    it('clears goToGroundUnits on phase advance', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2);
      state = { ...state, stratagemEffects: { ...state.stratagemEffects, goToGroundUnits: ['some-unit'] } };

      const result = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(result.stratagemEffects.goToGroundUnits).toEqual([]);
    });
  });

  // --- Epic Challenge ---

  describe('Epic Challenge', () => {
    it('adds unit to epicChallengeUnits for Precision', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 4); // Fight phase

      state = addUnit(state, 'champ-unit', 'p1', [{ id: 'champ-m1', x: 10, y: 10 }], {
        name: 'Chapter Champion',
        keywords: ['INFANTRY', 'CHARACTER'],
      });

      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'epic-challenge', playerId: 'p1', targetUnitId: 'champ-unit' },
      });

      expect(result.stratagemEffects.epicChallengeUnits).toContain('champ-unit');
    });

    it('clears epicChallengeUnits on phase advance', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 3); // charge phase
      state = { ...state, stratagemEffects: { ...state.stratagemEffects, epicChallengeUnits: ['some-unit'] } };

      const result = gameReducer(state, { type: 'ADVANCE_PHASE' });
      expect(result.stratagemEffects.epicChallengeUnits).toEqual([]);
    });
  });

  // --- Heroic Intervention ---

  describe('Heroic Intervention', () => {
    it('charges the enemy that just charged', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 3); // Charge phase

      state = addUnit(state, 'hero-unit', 'p2', [{ id: 'hero-m1', x: 10, y: 10 }], {
        name: 'Heroes',
      });
      state = addUnit(state, 'enemy-charger', 'p1', [{ id: 'charger-m1', x: 14, y: 10 }], {
        name: 'Chargers',
      });

      // Use Heroic Intervention
      state = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'heroic-intervention', playerId: 'p2', targetUnitId: 'hero-unit' },
      });

      expect(state.outOfPhaseAction).toEqual({
        stratagemId: 'heroic-intervention',
        playerId: 'p2',
      });

      // Resolve the heroic intervention charge move
      const result = gameReducer(state, {
        type: 'RESOLVE_HEROIC_INTERVENTION',
        payload: {
          unitId: 'hero-unit',
          targetUnitId: 'enemy-charger',
          positions: { 'hero-m1': { x: 13, y: 10 } },
        },
      });

      // Model moved
      expect(result.models['hero-m1'].position).toEqual({ x: 13, y: 10 });
      // Tracked as charge
      expect(result.turnTracking.chargedUnits).toContain('hero-unit');
      // Out-of-phase cleared
      expect(result.outOfPhaseAction).toBeUndefined();
    });
  });

  // --- Rapid Ingress ---

  describe('Rapid Ingress', () => {
    it('sets outOfPhaseAction for reserves arrival', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1); // Movement phase

      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'rapid-ingress', playerId: 'p2' },
      });

      expect(result.outOfPhaseAction).toEqual({
        stratagemId: 'rapid-ingress',
        playerId: 'p2',
      });
    });
  });

  // --- Out-of-phase action support ---

  describe('Out-of-phase actions', () => {
    it('skips phase validation when outOfPhaseAction is set', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 1); // Movement phase
      state = { ...state, rulesConfig: { ...state.rulesConfig, phaseRestrictions: 'enforce' } };

      // Without outOfPhaseAction, shooting action should be blocked
      state = addUnit(state, 'unit1', 'p1', [{ id: 'u1-m1', x: 10, y: 10 }], {
        name: 'Shooters',
      });

      const blocked = gameReducer(state, {
        type: 'DECLARE_SHOOTING',
        payload: { unitId: 'unit1' },
      });
      const blockedLog = blocked.log.entries[blocked.log.entries.length - 1];
      expect(blockedLog.type).toBe('message');
      if (blockedLog.type === 'message') {
        expect(blockedLog.text).toContain('BLOCKED');
      }

      // With outOfPhaseAction, it should be allowed
      state = { ...state, outOfPhaseAction: { stratagemId: 'fire-overwatch', playerId: 'p1' } };
      const allowed = gameReducer(state, {
        type: 'DECLARE_SHOOTING',
        payload: { unitId: 'unit1' },
      });
      // Should not be blocked — the shooting state should have changed
      expect(allowed.shootingState.activeShootingUnit).toBe('unit1');
    });
  });

  // --- Battle-shocked stratagem restrictions ---

  describe('Battle-shocked stratagem restrictions', () => {
    it('blocks Battle-shocked units from using stratagems (except Insane Bravery)', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      state = addUnit(state, 'bs-unit', 'p1', [{ id: 'bs-m1', x: 10, y: 10 }], {
        name: 'Shocked Squad',
        keywords: ['INFANTRY', 'GRENADES'],
      });

      // Make the unit battle-shocked
      state = { ...state, battleShocked: ['bs-unit'] };

      // Try to use Grenade on the battle-shocked unit (should be blocked)
      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'grenade', playerId: 'p1', targetUnitId: 'bs-unit' },
      });

      const lastEntry = result.log.entries[result.log.entries.length - 1];
      expect(lastEntry.type).toBe('message');
      if (lastEntry.type === 'message') {
        expect(lastEntry.text).toContain('BLOCKED');
      }

      // CP should NOT have been deducted
      expect(result.players['p1'].commandPoints).toBe(5);
    });

    it('allows Insane Bravery on Battle-shocked units', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 0); // Command phase

      state = addUnit(state, 'bs-unit', 'p1', [{ id: 'bs-m1', x: 10, y: 10 }], {
        name: 'Shocked Squad',
      });

      state = { ...state, battleShocked: ['bs-unit'] };

      const result = gameReducer(state, {
        type: 'USE_STRATAGEM',
        payload: { stratagemId: 'insane-bravery', playerId: 'p1', targetUnitId: 'bs-unit' },
      });

      // Should succeed — unit no longer battle-shocked
      expect(result.battleShocked).not.toContain('bs-unit');
      expect(result.players['p1'].commandPoints).toBe(4);
    });
  });
});

// ===============================================
// Phase 25: End-of-Turn Coherency Cleanup
// ===============================================

describe('Phase 25: End-of-Turn Coherency Cleanup', () => {
  // --- End-of-turn coherency ---

  describe('End-of-turn coherency', () => {
    it('removes models until unit is coherent', () => {
      let state = setupTwoPlayerGame();

      // Create a 3-model unit with one model far out of coherency (> 2" from others)
      state = addUnit(state, 'spread-unit', 'p1', [
        { id: 'sp-m1', x: 10, y: 10 },
        { id: 'sp-m2', x: 11, y: 10 },   // ~1" from m1 — in coherency
        { id: 'sp-m3', x: 20, y: 20 },    // far away — out of coherency
      ], { name: 'Spread Squad' });

      const result = gameReducer(state, { type: 'CHECK_END_OF_TURN_COHERENCY' });

      // The far model should be destroyed
      expect(result.models['sp-m3'].status).toBe('destroyed');
      // The other two should remain
      expect(result.models['sp-m1'].status).toBe('active');
      expect(result.models['sp-m2'].status).toBe('active');

      // Log should mention coherency removal
      const messages = result.log.entries.filter(e => e.type === 'message');
      const coherencyMsg = messages.find(e => e.type === 'message' && e.text.includes('coherency'));
      expect(coherencyMsg).toBeDefined();
    });

    it('does not remove models from coherent units', () => {
      let state = setupTwoPlayerGame();

      // All models within 2" of each other
      state = addUnit(state, 'tight-unit', 'p1', [
        { id: 'tight-m1', x: 10, y: 10 },
        { id: 'tight-m2', x: 11, y: 10 },
        { id: 'tight-m3', x: 10.5, y: 11 },
      ], { name: 'Tight Squad' });

      const result = gameReducer(state, { type: 'CHECK_END_OF_TURN_COHERENCY' });

      // All models should remain active
      expect(result.models['tight-m1'].status).toBe('active');
      expect(result.models['tight-m2'].status).toBe('active');
      expect(result.models['tight-m3'].status).toBe('active');
    });
  });

  // --- Desperate Escape ---

  describe('Desperate Escape', () => {
    it('destroys models on roll of 1-2', () => {
      let state = setupTwoPlayerGame();

      state = addUnit(state, 'fb-unit', 'p1', [
        { id: 'fb-m1', x: 10, y: 10 },
        { id: 'fb-m2', x: 11, y: 10 },
        { id: 'fb-m3', x: 12, y: 10 },
      ], { name: 'Falling Back Squad' });

      // Roll D6 per model: [1, 4, 2] → models m1 and m3 fail (1 and 2)
      const roll = makeDiceRoll([1, 4, 2], 'Desperate Escape', 3);
      const result = gameReducer(state, {
        type: 'RESOLVE_DESPERATE_ESCAPE',
        payload: { unitId: 'fb-unit', roll, destroyedModelIds: ['fb-m1', 'fb-m3'] },
      });

      expect(result.models['fb-m1'].status).toBe('destroyed');
      expect(result.models['fb-m2'].status).toBe('active');
      expect(result.models['fb-m3'].status).toBe('destroyed');

      // Log message
      const messages = result.log.entries.filter(e => e.type === 'message');
      const deMsg = messages.find(e => e.type === 'message' && e.text.includes('Desperate Escape'));
      expect(deMsg).toBeDefined();
      if (deMsg && deMsg.type === 'message') {
        expect(deMsg.text).toContain('2 model(s)');
      }
    });

    it('reports no casualties when all pass', () => {
      let state = setupTwoPlayerGame();

      state = addUnit(state, 'fb-unit', 'p1', [
        { id: 'fb-m1', x: 10, y: 10 },
        { id: 'fb-m2', x: 11, y: 10 },
      ], { name: 'Lucky Squad' });

      const roll = makeDiceRoll([5, 4], 'Desperate Escape', 3);
      const result = gameReducer(state, {
        type: 'RESOLVE_DESPERATE_ESCAPE',
        payload: { unitId: 'fb-unit', roll, destroyedModelIds: [] },
      });

      expect(result.models['fb-m1'].status).toBe('active');
      expect(result.models['fb-m2'].status).toBe('active');

      const messages = result.log.entries.filter(e => e.type === 'message');
      const deMsg = messages.find(e => e.type === 'message' && e.text.includes('Desperate Escape'));
      expect(deMsg).toBeDefined();
      if (deMsg && deMsg.type === 'message') {
        expect(deMsg.text).toContain('no casualties');
      }
    });
  });

  // --- CP Cap ---

  describe('CP cap', () => {
    it('blocks excess CP beyond +1 per round from non-Command-Phase sources', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 2); // Shooting phase

      // First gain: should succeed (+1 CP, from 5 to 6)
      state = gameReducer(state, {
        type: 'SET_COMMAND_POINTS',
        payload: { playerId: 'p1', value: 6, reason: 'Stratagem refund' },
      });
      expect(state.players['p1'].commandPoints).toBe(6);
      expect(state.cpGainedThisRound['p1']).toBe(1);

      // Second gain: should be blocked (already gained 1 this round)
      const result = gameReducer(state, {
        type: 'SET_COMMAND_POINTS',
        payload: { playerId: 'p1', value: 7, reason: 'Another refund' },
      });
      expect(result.players['p1'].commandPoints).toBe(6); // unchanged

      const lastEntry = result.log.entries[result.log.entries.length - 1];
      expect(lastEntry.type).toBe('message');
      if (lastEntry.type === 'message') {
        expect(lastEntry.text).toContain('CP cap');
      }
    });

    it('Command Phase CP gain is always allowed (exempt from cap)', () => {
      let state = setupTwoPlayerGame();
      state = setPhase(state, 0); // Command phase

      // START_COMMAND_PHASE grants +1 CP to both players (always, not subject to cap)
      const result = gameReducer(state, { type: 'START_COMMAND_PHASE' });

      expect(result.players['p1'].commandPoints).toBe(6); // 5 + 1
      expect(result.players['p2'].commandPoints).toBe(6); // 5 + 1

      // cpGainedThisRound should NOT be incremented by Command Phase CP
      expect(result.cpGainedThisRound['p1'] ?? 0).toBe(0);
      expect(result.cpGainedThisRound['p2'] ?? 0).toBe(0);
    });

    it('resets cpGainedThisRound on new battle round', () => {
      let state = setupTwoPlayerGame();
      state = { ...state, cpGainedThisRound: { p1: 1, p2: 1 } };

      // NEXT_TURN for last player → new round → reset
      state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p2' } };
      const result = gameReducer(state, { type: 'NEXT_TURN' });

      expect(result.cpGainedThisRound).toEqual({});
    });
  });
});
