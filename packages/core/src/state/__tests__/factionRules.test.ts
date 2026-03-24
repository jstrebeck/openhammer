import { describe, it, expect } from 'vitest';
import {
  resolveAttackSequence,
  applyFactionAndDetachmentRules,
  applyDefensiveDetachmentRules,
} from '../../combat/index';
import type { AttackContext } from '../../combat/index';
import type { GameState, Unit, Weapon, Detachment } from '../../types/index';
import { createInitialGameState } from '../../state/initialState';
import { gameReducer } from '../../state/reducer';
import { detectFactionFromRoster } from '../../army-list/importer';
import { getFaction, getDetachmentsForFaction, getAllFactions, getFactionState } from '../../detachments/registry';
import type { AstraMilitarumState } from '../../detachments/astra-militarum';
import type { TauEmpireState } from '../../detachments/tau-empire';
import '../../editions/index';
import '../../detachments/index';

// --- Test Helpers ---

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'w1',
    name: 'Lasgun',
    type: 'ranged',
    range: 24,
    attacks: 1,
    skill: 4,
    strength: 3,
    ap: 0,
    damage: 1,
    abilities: [],
    ...overrides,
  };
}

function makeCtx(overrides: Partial<AttackContext> = {}): AttackContext {
  return {
    weapon: makeWeapon(),
    abilities: [],
    distanceToTarget: 12,
    targetUnitSize: 5,
    targetKeywords: ['INFANTRY'],
    attackerStationary: false,
    attackerCharged: false,
    attackerModelCount: 10,
    ...overrides,
  };
}

function setupGameWithFaction(factionKeyword: string, detachmentId?: string): {
  state: GameState;
  playerId: string;
  unit: Unit;
} {
  let state = createInitialGameState();
  const playerId = 'p1';

  state = gameReducer(state, {
    type: 'ADD_PLAYER',
    payload: { player: { id: playerId, name: 'Test Player', color: '#ff0000', commandPoints: 0 } },
  });

  const unit: Unit = {
    id: 'u1',
    name: 'Infantry Squad',
    playerId,
    modelIds: ['m1', 'm2', 'm3'],
    keywords: ['INFANTRY', factionKeyword],
    abilities: [],
    weapons: [makeWeapon()],
  };

  state = gameReducer(state, {
    type: 'SET_FACTION_KEYWORD',
    payload: { playerId, keyword: factionKeyword },
  });

  if (detachmentId) {
    // Find the detachment across all registered factions
    const allFactions = getAllFactions();
    for (const faction of allFactions) {
      const detachment = faction.detachments.find(d => d.id === detachmentId);
      if (detachment) {
        state = gameReducer(state, {
          type: 'SELECT_DETACHMENT',
          payload: { playerId, detachment },
        });
        break;
      }
    }
  }

  return { state, playerId, unit };
}

// ===============================================
// Faction Registry Tests
// ===============================================

describe('Faction & Detachment Registry', () => {
  it('Astra Militarum faction is registered', () => {
    const faction = getFaction('astra-militarum');
    expect(faction).toBeDefined();
    expect(faction!.name).toBe('Astra Militarum');
    expect(faction!.factionKeyword).toBe('ASTRA MILITARUM');
  });

  it('has 4 detachments', () => {
    const detachments = getDetachmentsForFaction('astra-militarum');
    expect(detachments).toHaveLength(4);
    expect(detachments.map(d => d.id)).toContain('combined-regiment');
    expect(detachments.map(d => d.id)).toContain('mechanised-assault');
    expect(detachments.map(d => d.id)).toContain('armoured-company');
    expect(detachments.map(d => d.id)).toContain('fortification-network');
  });

  it('each detachment has stratagems and enhancements', () => {
    const detachments = getDetachmentsForFaction('astra-militarum');
    for (const d of detachments) {
      expect(d.stratagems).toBeDefined();
      expect(d.stratagems!.length).toBeGreaterThan(0);
      expect(d.enhancements).toBeDefined();
      expect(d.enhancements!.length).toBeGreaterThan(0);
    }
  });

  it('can look up by catalogue name', () => {
    const faction = getFaction('astra-militarum');
    expect(faction).toBeDefined();
    // getFactionByCatalogueName is tested via detectFactionFromRoster
  });
});

// ===============================================
// Faction Detection Tests
// ===============================================

describe('Faction Detection from Roster', () => {
  it('detects Astra Militarum from catalogueName', () => {
    const roster = {
      roster: {
        name: 'My Guard Army',
        forces: [{ catalogueName: 'Astra Militarum', selections: [] }],
      },
    };
    expect(detectFactionFromRoster(roster)).toBe('astra-militarum');
  });

  it('detects Astra Militarum from Faction: category', () => {
    const roster = {
      roster: {
        name: 'My Guard Army',
        forces: [{
          selections: [{
            name: 'Infantry Squad',
            type: 'unit' as const,
            categories: [{ name: 'Faction: Astra Militarum', primary: false }],
          }],
        }],
      },
    };
    expect(detectFactionFromRoster(roster)).toBe('astra-militarum');
  });

  it('returns undefined for unknown factions', () => {
    const roster = {
      roster: {
        name: 'Unknown Army',
        forces: [{ catalogueName: 'Space Wolves', selections: [] }],
      },
    };
    expect(detectFactionFromRoster(roster)).toBeUndefined();
  });
});

// ===============================================
// Born Soldiers (Faction Rule) Tests
// ===============================================

describe('Born Soldiers — Astra Militarum Faction Rule', () => {
  it('critical hit threshold is lowered to 5 for stationary ranged attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM');
    const ctx = makeCtx({ attackerStationary: true, weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBe(5);
    expect(triggeredRules).toContain('Born Soldiers (crit on 5+)');
  });

  it('does not apply when unit moved (not stationary)', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM');
    const ctx = makeCtx({ attackerStationary: false, weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBeUndefined();
    expect(triggeredRules).not.toContain('Born Soldiers (crit on 5+)');
  });

  it('does not apply to melee attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM');
    const ctx = makeCtx({
      attackerStationary: true,
      weapon: makeWeapon({ type: 'melee', name: 'Bayonet', range: undefined }),
    });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBeUndefined();
  });

  it('does not apply to non-AM factions', () => {
    const { state, unit } = setupGameWithFaction('ADEPTUS ASTARTES');
    const ctx = makeCtx({ attackerStationary: true, weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.criticalHitThreshold).toBeUndefined();
  });

  it('resolveAttackSequence respects criticalHitThreshold (5+ crits)', () => {
    // Run many attacks to statistically verify that 5s count as crits
    // With criticalHitThreshold=5, a roll of 5 should be a crit
    const ctx = makeCtx({
      attackerStationary: true,
      weapon: makeWeapon({ type: 'ranged', abilities: ['SUSTAINED HITS 1'] }),
      abilities: [{ name: 'SUSTAINED HITS', value: 1 }],
      criticalHitThreshold: 5,
    });

    // Run 1000 attacks to check that crits happen more often with threshold 5
    let critsAt5 = 0;
    let critsAt6 = 0;
    const trials = 500;

    for (let i = 0; i < trials; i++) {
      const result5 = resolveAttackSequence(1, 4, 3, 3, { ...ctx, criticalHitThreshold: 5 });
      if (result5.triggeredAbilities.some(t => t.startsWith('Sustained Hits'))) critsAt5++;

      const result6 = resolveAttackSequence(1, 4, 3, 3, { ...ctx, criticalHitThreshold: 6 });
      if (result6.triggeredAbilities.some(t => t.startsWith('Sustained Hits'))) critsAt6++;
    }

    // With threshold 5, crits should happen ~2/6 = 33% of the time (5 or 6)
    // With threshold 6, crits should happen ~1/6 = 17% of the time (6 only)
    // So critsAt5 should be roughly double critsAt6
    expect(critsAt5).toBeGreaterThan(critsAt6);
  });
});

// ===============================================
// Detachment Rule Tests
// ===============================================

describe('Mechanised Assault — Armoured Spearhead', () => {
  it('improves AP by 1 for TRANSPORT units', () => {
    const { state } = setupGameWithFaction('ASTRA MILITARUM', 'mechanised-assault');
    const transportUnit: Unit = {
      id: 'u2',
      name: 'Chimera',
      playerId: 'p1',
      modelIds: ['m10'],
      keywords: ['VEHICLE', 'TRANSPORT', 'ASTRA MILITARUM'],
      abilities: [],
      weapons: [makeWeapon({ ap: 0 })],
    };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged', ap: 0 }) });
    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, transportUnit);

    expect(modified.weapon.ap).toBe(-1); // AP improved by 1
    expect(triggeredRules).toContain('Armoured Spearhead (AP +1)');
  });

  it('does not apply to non-TRANSPORT/MOUNTED units', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'mechanised-assault');

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged', ap: 0 }) });
    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.weapon.ap).toBe(0); // Unchanged
    expect(triggeredRules).not.toContain('Armoured Spearhead (AP +1)');
  });
});

describe('Armoured Company — Rolling Fortress (defensive)', () => {
  it('applies -1 to Wound for attacks targeting VEHICLE from >12"', () => {
    const { state } = setupGameWithFaction('ASTRA MILITARUM', 'armoured-company');
    const vehicleUnit: Unit = {
      id: 'u2',
      name: 'Leman Russ',
      playerId: 'p1',
      modelIds: ['m10'],
      keywords: ['VEHICLE', 'ASTRA MILITARUM'],
      abilities: [],
      weapons: [],
    };

    const { woundRollModifier, triggeredRules } = applyDefensiveDetachmentRules(state, vehicleUnit, 18);

    expect(woundRollModifier).toBe(-1);
    expect(triggeredRules).toContain('Rolling Fortress (-1 to Wound)');
  });

  it('does not apply within 12"', () => {
    const { state } = setupGameWithFaction('ASTRA MILITARUM', 'armoured-company');
    const vehicleUnit: Unit = {
      id: 'u2',
      name: 'Leman Russ',
      playerId: 'p1',
      modelIds: ['m10'],
      keywords: ['VEHICLE', 'ASTRA MILITARUM'],
      abilities: [],
      weapons: [],
    };

    const { woundRollModifier } = applyDefensiveDetachmentRules(state, vehicleUnit, 10);

    expect(woundRollModifier).toBe(0);
  });

  it('does not apply to non-VEHICLE units', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'armoured-company');

    const { woundRollModifier } = applyDefensiveDetachmentRules(state, unit, 18);

    expect(woundRollModifier).toBe(0);
  });
});

describe('Fortification Network — Siege Warfare', () => {
  it('applies re-roll wound 1s', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'fortification-network');
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, unit);

    expect(modified.rerollWoundRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Siege Warfare (re-roll wound 1s)');
  });
});

// ===============================================
// Per-Player Detachments
// ===============================================

describe('Per-Player Detachments', () => {
  it('two players can have different detachments', () => {
    let state = createInitialGameState();

    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: 'p1', name: 'AM Player', color: '#ff0000', commandPoints: 0 } },
    });
    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: 'p2', name: 'SM Player', color: '#0000ff', commandPoints: 0 } },
    });

    const amDetachments = getDetachmentsForFaction('astra-militarum');
    state = gameReducer(state, {
      type: 'SELECT_DETACHMENT',
      payload: { playerId: 'p1', detachment: amDetachments[0] },
    });

    const mockSmDetachment: Detachment = {
      id: 'gladius',
      name: 'Gladius Task Force',
      factionId: 'space-marines',
      rules: 'Combat Doctrines',
    };
    state = gameReducer(state, {
      type: 'SELECT_DETACHMENT',
      payload: { playerId: 'p2', detachment: mockSmDetachment },
    });

    expect(state.playerDetachments['p1'].id).toBe('combined-regiment');
    expect(state.playerDetachments['p2'].id).toBe('gladius');
  });

  it('detachment stratagems are usable via USE_STRATAGEM', () => {
    let state = createInitialGameState({ editionId: 'wh40k-10th' });

    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: 'p1', name: 'AM Player', color: '#ff0000', commandPoints: 5 } },
    });

    const amDetachments = getDetachmentsForFaction('astra-militarum');
    state = gameReducer(state, {
      type: 'SELECT_DETACHMENT',
      payload: { playerId: 'p1', detachment: amDetachments[0] },
    });

    // Set active player, start the game, and advance to shooting phase (index 2)
    state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1', currentPhaseIndex: 2 }, gameStarted: true };

    // Use a detachment stratagem (Fields of Fire — shooting phase)
    const before = state.players['p1'].commandPoints;
    state = gameReducer(state, {
      type: 'USE_STRATAGEM',
      payload: { stratagemId: 'am-fields-of-fire', playerId: 'p1' },
    });

    // Should have deducted 1 CP
    expect(state.players['p1'].commandPoints).toBe(before - 1);
    expect(state.stratagemsUsedThisPhase).toContain('am-fields-of-fire');
  });
});

// ===============================================
// Combined Regiment Orders Tests
// ===============================================

describe('Combined Regiment Orders — ISSUE_ORDER', () => {
  function setupOrderGame() {
    let state = createInitialGameState({ editionId: 'wh40k-10th' });

    // Add player with Combined Regiment
    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: 'p1', name: 'AM Player', color: '#ff0000', commandPoints: 5 } },
    });
    state = gameReducer(state, {
      type: 'SET_FACTION_KEYWORD',
      payload: { playerId: 'p1', keyword: 'ASTRA MILITARUM' },
    });
    const detachments = getDetachmentsForFaction('astra-militarum');
    const combinedRegiment = detachments.find(d => d.id === 'combined-regiment')!;
    state = gameReducer(state, {
      type: 'SELECT_DETACHMENT',
      payload: { playerId: 'p1', detachment: combinedRegiment },
    });

    // Place officer and infantry at nearby positions
    state = gameReducer(state, {
      type: 'PLACE_MODEL',
      payload: { model: { id: 'officer-m1', unitId: 'officer-u1', name: 'Company Commander', position: { x: 10, y: 10 }, baseSizeMm: 28, baseSizeInches: 28/25.4, baseShape: { type: 'circle', diameterMm: 28 }, facing: 0, wounds: 3, maxWounds: 3, moveCharacteristic: 6, stats: { move: 6, toughness: 3, save: 5, wounds: 3, leadership: 7, objectiveControl: 1 }, status: 'active' } },
    });
    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'officer-u1', name: 'Company Commander', playerId: 'p1', modelIds: ['officer-m1'], keywords: ['INFANTRY', 'CHARACTER', 'OFFICER', 'ASTRA MILITARUM'], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, {
      type: 'PLACE_MODEL',
      payload: { model: { id: 'inf-m1', unitId: 'inf-u1', name: 'Guardsman', position: { x: 13, y: 10 }, baseSizeMm: 28, baseSizeInches: 28/25.4, baseShape: { type: 'circle', diameterMm: 28 }, facing: 0, wounds: 1, maxWounds: 1, moveCharacteristic: 6, stats: { move: 6, toughness: 3, save: 5, wounds: 1, leadership: 7, objectiveControl: 2 }, status: 'active' } },
    });
    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'inf-u1', name: 'Infantry Squad', playerId: 'p1', modelIds: ['inf-m1'], keywords: ['INFANTRY', 'ASTRA MILITARUM'], abilities: [], weapons: [makeWeapon()] },
        models: [],
      },
    });

    // Far away unit (>6")
    state = gameReducer(state, {
      type: 'PLACE_MODEL',
      payload: { model: { id: 'far-m1', unitId: 'far-u1', name: 'Distant Guardsman', position: { x: 30, y: 30 }, baseSizeMm: 28, baseSizeInches: 28/25.4, baseShape: { type: 'circle', diameterMm: 28 }, facing: 0, wounds: 1, maxWounds: 1, moveCharacteristic: 6, stats: { move: 6, toughness: 3, save: 5, wounds: 1, leadership: 7, objectiveControl: 2 }, status: 'active' } },
    });
    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'far-u1', name: 'Distant Squad', playerId: 'p1', modelIds: ['far-m1'], keywords: ['INFANTRY', 'ASTRA MILITARUM'], abilities: [], weapons: [makeWeapon()] },
        models: [],
      },
    });

    return state;
  }

  it('issues Take Aim order to a nearby unit', () => {
    let state = setupOrderGame();
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'take-aim' },
    });

    const amState1 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState1.activeOrders['inf-u1']).toBe('take-aim');
    expect(amState1.officersUsedThisPhase).toContain('officer-u1');
  });

  it('blocks order to unit out of range (>6")', () => {
    let state = setupOrderGame();
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'far-u1', orderId: 'take-aim' },
    });

    const amState2 = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
    expect(amState2?.activeOrders['far-u1']).toBeUndefined();
    expect(amState2?.officersUsedThisPhase ?? []).not.toContain('officer-u1');
  });

  it('blocks officer from issuing two orders in same phase', () => {
    let state = setupOrderGame();
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'take-aim' },
    });
    // Try to issue another order from same officer — should be blocked
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'officer-u1', orderId: 'fix-bayonets' },
    });

    const amState3 = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
    expect(amState3?.activeOrders['officer-u1']).toBeUndefined();
  });

  it('blocks unit from receiving two orders', () => {
    let state = setupOrderGame();

    // Add a second officer near the infantry
    state = gameReducer(state, {
      type: 'PLACE_MODEL',
      payload: { model: { id: 'off2-m1', unitId: 'off2-u1', name: 'Platoon Commander', position: { x: 11, y: 10 }, baseSizeMm: 28, baseSizeInches: 28/25.4, baseShape: { type: 'circle', diameterMm: 28 }, facing: 0, wounds: 3, maxWounds: 3, moveCharacteristic: 6, stats: { move: 6, toughness: 3, save: 5, wounds: 3, leadership: 7, objectiveControl: 1 }, status: 'active' } },
    });
    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'off2-u1', name: 'Platoon Commander', playerId: 'p1', modelIds: ['off2-m1'], keywords: ['INFANTRY', 'CHARACTER', 'OFFICER', 'ASTRA MILITARUM'], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'take-aim' },
    });
    // Second officer tries to give same unit another order
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'off2-u1', targetUnitId: 'inf-u1', orderId: 'frfsrf' },
    });

    // Should still have Take Aim, not FRFSRF
    const amState4 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState4.activeOrders['inf-u1']).toBe('take-aim');
  });

  it('blocks non-OFFICER units from issuing orders', () => {
    let state = setupOrderGame();
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'inf-u1', targetUnitId: 'officer-u1', orderId: 'take-aim' },
    });

    const amState5 = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
    expect(amState5?.activeOrders['officer-u1']).toBeUndefined();
  });

  it('clears orders on ADVANCE_PHASE', () => {
    let state = setupOrderGame();
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'take-aim' },
    });
    const amState6 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState6.activeOrders['inf-u1']).toBe('take-aim');

    state = gameReducer(state, { type: 'ADVANCE_PHASE' });

    const amState7 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState7.activeOrders).toEqual({});
    expect(amState7.officersUsedThisPhase).toEqual([]);
  });

  it('Duty and Honour creates a persisting effect', () => {
    let state = setupOrderGame();
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'duty-and-honour' },
    });

    const amState8 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState8.activeOrders['inf-u1']).toBe('duty-and-honour');
    const effect = state.persistingEffects.find(e => e.type === 'duty-and-honour' && e.targetUnitId === 'inf-u1');
    expect(effect).toBeDefined();
    expect(effect!.expiresAt.type).toBe('turn_end');
    expect(effect!.data?.invulnSave).toBe(4);
  });
});

describe('Combined Regiment Orders — Combat Modifiers', () => {
  it('Take Aim applies rerollHitRollsOf1 for ranged attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'take-aim' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.rerollHitRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Take Aim! (re-roll hit 1s)');
  });

  it('FRFSRF applies bonusAP for ranged attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'frfsrf' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged', ap: 0 }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.bonusAP).toBe(-1);
    expect(triggeredRules).toContain('FRFSRF (AP +1)');
  });

  it('Fix Bayonets applies rerollHitRollsOf1 for melee attacks only', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'fix-bayonets' }, officersUsedThisPhase: [] } } };

    // Melee — should apply
    const meleeCtx = makeCtx({ weapon: makeWeapon({ type: 'melee', name: 'Bayonet' }) });
    const { ctx: meleeModified } = applyFactionAndDetachmentRules(meleeCtx, stateWithOrder, unit);
    expect(meleeModified.rerollHitRollsOf1).toBe(true);

    // Ranged — should NOT apply
    const rangedCtx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });
    const { ctx: rangedModified } = applyFactionAndDetachmentRules(rangedCtx, stateWithOrder, unit);
    expect(rangedModified.rerollHitRollsOf1).toBeUndefined();
  });

  it('Take Aim does not apply to melee attacks', () => {
    const { state, unit } = setupGameWithFaction('ASTRA MILITARUM', 'combined-regiment');
    const stateWithOrder = { ...state, factionState: { ...state.factionState, 'astra-militarum': { activeOrders: { [unit.id]: 'take-aim' }, officersUsedThisPhase: [] } } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithOrder, unit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });
});

// ===============================================
// T'au Empire Tests
// ===============================================

describe("T'au Empire — Faction & Detachment Registry", () => {
  it("T'au Empire faction is registered", () => {
    const faction = getFaction('tau-empire');
    expect(faction).toBeDefined();
    expect(faction!.name).toBe("T'au Empire");
    expect(faction!.factionKeyword).toBe("T'AU EMPIRE");
  });

  it('has 4 detachments', () => {
    const detachments = getDetachmentsForFaction('tau-empire');
    expect(detachments).toHaveLength(4);
    expect(detachments.map(d => d.id)).toContain('kauyon');
    expect(detachments.map(d => d.id)).toContain('montka');
    expect(detachments.map(d => d.id)).toContain('retaliation-cadre');
    expect(detachments.map(d => d.id)).toContain('kroot-hunting-pack');
  });

  it('each detachment has stratagems and enhancements', () => {
    const detachments = getDetachmentsForFaction('tau-empire');
    for (const d of detachments) {
      expect(d.stratagems).toBeDefined();
      expect(d.stratagems!.length).toBeGreaterThan(0);
      expect(d.enhancements).toBeDefined();
      expect(d.enhancements!.length).toBeGreaterThan(0);
    }
  });

  it("detects T'au Empire from catalogueName", () => {
    const roster = {
      roster: {
        name: "My T'au Army",
        forces: [{ catalogueName: "T'au Empire", selections: [] }],
      },
    };
    expect(detectFactionFromRoster(roster)).toBe('tau-empire');
  });
});

describe("Kauyon — Patient Hunter", () => {
  it('applies re-roll hit 1s from Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kauyon');
    const stateR3 = { ...state, turnState: { ...state.turnState, roundNumber: 3 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateR3, unit);

    expect(modified.rerollHitRollsOf1).toBe(true);
    expect(triggeredRules.some(r => r.includes('Patient Hunter'))).toBe(true);
  });

  it('does not apply before Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kauyon');
    const stateR2 = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR2, unit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });

  it('does not apply to melee', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kauyon');
    const stateR3 = { ...state, turnState: { ...state.turnState, roundNumber: 3 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR3, unit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });
});

describe("Mont'ka — Killing Blow", () => {
  it('applies AP+1 within 18" in Round 1', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR1 = { ...state, turnState: { ...state.turnState, roundNumber: 1 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 15 });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateR1, unit);

    expect(modified.bonusAP).toBe(-1);
    expect(triggeredRules.some(r => r.includes('Killing Blow'))).toBe(true);
  });

  it('does not apply outside threshold range', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR2 = { ...state, turnState: { ...state.turnState, roundNumber: 2 } };
    // Round 2 threshold is 12", target at 15"
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 15 });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR2, unit);

    expect(modified.bonusAP).toBeUndefined();
  });

  it('applies AP+1 within 9" in Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR3 = { ...state, turnState: { ...state.turnState, roundNumber: 3 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 8 });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR3, unit);

    expect(modified.bonusAP).toBe(-1);
  });

  it('does not apply after Round 3', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'montka');
    const stateR4 = { ...state, turnState: { ...state.turnState, roundNumber: 4 } };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), distanceToTarget: 5 });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateR4, unit);

    expect(modified.bonusAP).toBeUndefined();
  });
});

describe("Kroot Hunting Pack — Guerrilla Tactics", () => {
  it('applies re-roll hit 1s for KROOT melee attacks', () => {
    const { state } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const krootUnit: Unit = {
      id: 'kroot-u1',
      name: 'Kroot Carnivores',
      playerId: 'p1',
      modelIds: ['km1'],
      keywords: ['INFANTRY', 'KROOT', "T'AU EMPIRE"],
      abilities: [],
      weapons: [makeWeapon({ type: 'melee', name: 'Kroot Rifle (melee)' })],
    };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, state, krootUnit);

    expect(modified.rerollHitRollsOf1).toBe(true);
    expect(triggeredRules).toContain('Guerrilla Tactics (re-roll hit 1s)');
  });

  it('does not apply to non-KROOT units', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, unit);

    // unit has keywords ['INFANTRY', "T'AU EMPIRE"] — no KROOT
    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });

  it('does not apply to ranged attacks', () => {
    const { state } = setupGameWithFaction("T'AU EMPIRE", 'kroot-hunting-pack');
    const krootUnit: Unit = {
      id: 'kroot-u1',
      name: 'Kroot Carnivores',
      playerId: 'p1',
      modelIds: ['km1'],
      keywords: ['INFANTRY', 'KROOT', "T'AU EMPIRE"],
      abilities: [],
      weapons: [makeWeapon({ type: 'ranged' })],
    };
    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }) });

    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, state, krootUnit);

    expect(modified.rerollHitRollsOf1).toBeUndefined();
  });
});

// ===============================================
// T'au Empire: For the Greater Good (Guided Targets)
// ===============================================

describe("For the Greater Good — Guided Targets", () => {
  function setupTauGame() {
    let state = createInitialGameState({ editionId: 'wh40k-10th' });

    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: 'tau', name: "T'au Player", color: '#00cccc', commandPoints: 5 } },
    });
    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: 'enemy', name: 'Enemy', color: '#ff0000', commandPoints: 5 } },
    });
    state = gameReducer(state, {
      type: 'SET_FACTION_KEYWORD',
      payload: { playerId: 'tau', keyword: "T'AU EMPIRE" },
    });

    // Set active player to T'au, in shooting phase (index 2)
    state = {
      ...state,
      turnState: { ...state.turnState, activePlayerId: 'tau', currentPhaseIndex: 2 },
      gameStarted: true,
    };

    return state;
  }

  it('DESIGNATE_GUIDED_TARGET stores the guided target', () => {
    let state = setupTauGame();

    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'enemy-u1', name: 'Enemy Squad', playerId: 'enemy', modelIds: [], keywords: ['INFANTRY'], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, {
      type: 'DESIGNATE_GUIDED_TARGET',
      payload: { targetUnitId: 'enemy-u1' },
    });

    const tauState1 = getFactionState<TauEmpireState>(state, 'tau-empire')!;
    expect(tauState1.guidedTargets['tau']).toBe('enemy-u1');
  });

  it('blocks designating a friendly unit', () => {
    let state = setupTauGame();

    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'tau-u1', name: 'Friendly Squad', playerId: 'tau', modelIds: [], keywords: ['INFANTRY'], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, {
      type: 'DESIGNATE_GUIDED_TARGET',
      payload: { targetUnitId: 'tau-u1' },
    });

    const tauState2 = getFactionState<TauEmpireState>(state, 'tau-empire');
    expect(tauState2?.guidedTargets['tau']).toBeUndefined();
  });

  it('replaces previous guided target when designating a new one', () => {
    let state = setupTauGame();

    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'e1', name: 'Enemy 1', playerId: 'enemy', modelIds: [], keywords: [], abilities: [], weapons: [] },
        models: [],
      },
    });
    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'e2', name: 'Enemy 2', playerId: 'enemy', modelIds: [], keywords: [], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, { type: 'DESIGNATE_GUIDED_TARGET', payload: { targetUnitId: 'e1' } });
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBe('e1');

    state = gameReducer(state, { type: 'DESIGNATE_GUIDED_TARGET', payload: { targetUnitId: 'e2' } });
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBe('e2');
  });

  it('guided target persists across non-shooting phase advances', () => {
    let state = setupTauGame();

    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'e1', name: 'Enemy', playerId: 'enemy', modelIds: [], keywords: [], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, { type: 'DESIGNATE_GUIDED_TARGET', payload: { targetUnitId: 'e1' } });
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBe('e1');

    // Advance to Charge phase — guided target should survive
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBe('e1');
  });

  it('guided target survives through opponent turn', () => {
    let state = setupTauGame();

    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'e1', name: 'Enemy', playerId: 'enemy', modelIds: [], keywords: [], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, { type: 'DESIGNATE_GUIDED_TARGET', payload: { targetUnitId: 'e1' } });

    // Advance through remaining phases
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → Charge
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → Fight
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // → Morale

    // Next turn switches to enemy
    state = gameReducer(state, { type: 'NEXT_TURN' });
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBe('e1');
  });

  it('guided target clears when entering own Shooting phase next turn', () => {
    let state = setupTauGame();

    state = gameReducer(state, {
      type: 'ADD_UNIT',
      payload: {
        unit: { id: 'e1', name: 'Enemy', playerId: 'enemy', modelIds: [], keywords: [], abilities: [], weapons: [] },
        models: [],
      },
    });

    state = gameReducer(state, { type: 'DESIGNATE_GUIDED_TARGET', payload: { targetUnitId: 'e1' } });

    // Go through remaining phases: Charge, Fight, Morale
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });
    state = gameReducer(state, { type: 'ADVANCE_PHASE' });

    // Enemy turn
    state = gameReducer(state, { type: 'NEXT_TURN' });
    // Go through all enemy phases
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Shooting (enemy's — tau guided should persist)
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBe('e1');

    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Charge
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Fight
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Morale

    // Back to T'au's turn
    state = gameReducer(state, { type: 'NEXT_TURN' });
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Shooting — NOW it clears
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBeUndefined();
  });

  it('applies +1 BS modifier when shooting a guided target', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE");
    const stateWithGuided = { ...state, factionState: { ...state.factionState, 'tau-empire': { guidedTargets: { p1: 'enemy-u1' } } } };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'enemy-u1' });
    const { ctx: modified, triggeredRules } = applyFactionAndDetachmentRules(ctx, stateWithGuided, unit);

    expect(modified.targetHitModifier).toBe(1);
    expect(triggeredRules).toContain('For the Greater Good (+1 BS)');
  });

  it('does not apply +1 BS to non-guided targets', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE");
    const stateWithGuided = { ...state, factionState: { ...state.factionState, 'tau-empire': { guidedTargets: { p1: 'enemy-u1' } } } };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'ranged' }), targetUnitId: 'different-enemy' });
    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithGuided, unit);

    expect(modified.targetHitModifier).toBeUndefined();
  });

  it('does not apply to melee attacks against guided target', () => {
    const { state, unit } = setupGameWithFaction("T'AU EMPIRE");
    const stateWithGuided = { ...state, factionState: { ...state.factionState, 'tau-empire': { guidedTargets: { p1: 'enemy-u1' } } } };

    const ctx = makeCtx({ weapon: makeWeapon({ type: 'melee' }), targetUnitId: 'enemy-u1' });
    const { ctx: modified } = applyFactionAndDetachmentRules(ctx, stateWithGuided, unit);

    expect(modified.targetHitModifier).toBeUndefined();
  });
});
