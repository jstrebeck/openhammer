import { describe, it, expect } from 'vitest';
// Combat function imports moved to combat/__tests__/factionModifiers.test.ts
import type { GameState, Weapon, Detachment } from '../../types/index';
import { createInitialGameState } from '../../state/initialState';
import { gameReducer } from '../../state/reducer';
import { detectFactionFromRoster } from '../../army-list/importer';
import { getFaction, getDetachmentsForFaction, getFactionState } from '../../detachments/registry';
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

// makeCtx and setupGameWithFaction moved to combat/__tests__/factionModifiers.test.ts

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

// Born Soldiers, Mechanised Assault, Armoured Company, Fortification Network
// moved to combat/__tests__/factionModifiers.test.ts

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

  it('replaces existing order when a new one is issued', () => {
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
    // Second officer issues a new order to the same unit — should replace
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'off2-u1', targetUnitId: 'inf-u1', orderId: 'frfsrf' },
    });

    const amState4 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState4.activeOrders['inf-u1']).toBe('frfsrf');
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

  it('orders persist across phases (ADVANCE_PHASE)', () => {
    let state = setupOrderGame();
    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'take-aim' },
    });
    const amState6 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState6.activeOrders['inf-u1']).toBe('take-aim');
    expect(amState6.officersUsedThisPhase).toContain('officer-u1');

    state = gameReducer(state, { type: 'ADVANCE_PHASE' });

    // Orders should persist; only officersUsedThisPhase resets
    const amState7 = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amState7.activeOrders['inf-u1']).toBe('take-aim');
    expect(amState7.officersUsedThisPhase).toEqual([]);
  });

  it('orders clear at start of owning player next Command phase (NEXT_TURN)', () => {
    let state = setupOrderGame();

    // Add a second player so NEXT_TURN switches between them
    state = gameReducer(state, {
      type: 'ADD_PLAYER',
      payload: { player: { id: 'p2', name: 'Opponent', color: '#0000ff', commandPoints: 5 } },
    });
    state = { ...state, turnState: { ...state.turnState, activePlayerId: 'p1' } };

    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'take-aim' },
    });

    // Advance to opponent's turn — orders should persist
    state = gameReducer(state, { type: 'NEXT_TURN' });
    const amAfterOpponentTurn = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amAfterOpponentTurn.activeOrders['inf-u1']).toBe('take-aim');

    // Advance back to AM player's turn (their Command phase) — orders should clear
    state = gameReducer(state, { type: 'NEXT_TURN' });
    const amAfterOwnTurn = getFactionState<AstraMilitarumState>(state, 'astra-militarum')!;
    expect(amAfterOwnTurn.activeOrders).toEqual({});
  });

  it('blocks orders to Battle-shocked units', () => {
    let state = setupOrderGame();
    // Battle-shock the infantry unit
    state = { ...state, battleShocked: [...state.battleShocked, 'inf-u1'] };

    state = gameReducer(state, {
      type: 'ISSUE_ORDER',
      payload: { officerUnitId: 'officer-u1', targetUnitId: 'inf-u1', orderId: 'take-aim' },
    });

    const amState = getFactionState<AstraMilitarumState>(state, 'astra-militarum');
    expect(amState?.activeOrders['inf-u1']).toBeUndefined();
  });
});

// Combined Regiment Orders -- Combat Modifiers moved to combat/__tests__/factionModifiers.test.ts

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

// Kauyon, Mont'ka, Kroot Hunting Pack moved to combat/__tests__/factionModifiers.test.ts

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

    // Go through remaining phases: Charge, Fight
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

    // Back to T'au's turn
    state = gameReducer(state, { type: 'NEXT_TURN' });
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Movement
    state = gameReducer(state, { type: 'ADVANCE_PHASE' }); // Shooting — NOW it clears
    expect(getFactionState<TauEmpireState>(state, 'tau-empire')!.guidedTargets['tau']).toBeUndefined();
  });

  // Combat modifier tests (applyFactionAndDetachmentRules) moved to combat/__tests__/factionModifiers.test.ts
});
