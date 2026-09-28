import { describe, expect, it } from 'vitest';
import type { Datasheet, EffectDef } from '../types/content.js';
import type { GameState, UnitState } from '../types/state.js';
import { createInitialGameState } from './initialState.js';
import { reduce } from './reducer.js';
import { makeEnv, makeState, makeUnit, testEdition } from '../test-helpers.js';
import type { ReducerEnv } from './env.js';

// ---------------------------------------------------------------------------
// Fixtures: two tiny datasheets and a content stub with Rapid Fire wired up
// ---------------------------------------------------------------------------

const marineSheet: Datasheet = {
  id: 'test/marines',
  name: 'Test Marines',
  factionId: 'test',
  keywords: ['Infantry'],
  factionKeywords: ['Test Faction'],
  models: [
    {
      id: 'default',
      name: 'Marine',
      move: 6,
      toughness: 4,
      save: 3,
      wounds: 2,
      leadership: 6,
      objectiveControl: 2,
      baseSizeMm: 32,
      heightInches: 1.4,
    },
  ],
  unitComposition: { sizes: [{ models: 2, points: 40 }] },
  rangedWeapons: [],
  meleeWeapons: [],
  coreAbilities: [],
  abilities: [],
};

const guardSheet: Datasheet = {
  ...marineSheet,
  id: 'test/guards',
  name: 'Test Guards',
  models: [
    { ...marineSheet.models[0]!, name: 'Guard', toughness: 3, save: 5, wounds: 1, move: 6 },
  ],
  unitComposition: { sizes: [{ models: 5, points: 60 }] },
};

const rapidFireEffect: EffectDef = {
  id: 'rapid-fire.bonus',
  trigger: 'attack.attacksCount',
  condition: { targetWithinHalfRange: true },
  effects: [{ type: 'addAttacks', value: 1 }],
};

function env(): ReducerEnv {
  return makeEnv({
    datasheets: { 'test/marines': marineSheet, 'test/guards': guardSheet },
    getWeaponAbility: (ref) =>
      ref.id === 'rapid-fire'
        ? { effects: [rapidFireEffect], flags: [] }
        : { effects: [], flags: [] },
  });
}

function marineUnit(id: string, owner: 0 | 1, positions: ({ x: number; y: number } | null)[]): UnitState {
  return makeUnit({
    id,
    owner,
    datasheetId: 'test/marines',
    name: `Marines ${id}`,
    startingStrength: positions.length,
    models: positions.map((p, i) => ({
      id: `${id}-m${i}`,
      profileId: 'default',
      position: p,
      woundsRemaining: 2,
      destroyed: false,
      hasTakenWoundsThisPhase: false,
    })),
    loadout: Object.fromEntries(positions.map((_, i) => [`${id}-m${i}`, ['bolter']])),
    weapons: {
      bolter: {
        id: 'bolter',
        name: 'Boltgun',
        kind: 'ranged',
        range: 24,
        attacks: '2',
        skill: 3,
        strength: 4,
        ap: 0,
        damage: '1',
        abilities: [{ id: 'rapid-fire', value: 1 }],
      },
    },
  });
}

function guardUnit(id: string, owner: 0 | 1, at: { x: number; y: number }): UnitState {
  return makeUnit({
    id,
    owner,
    datasheetId: 'test/guards',
    name: `Guards ${id}`,
    startingStrength: 5,
    models: Array.from({ length: 5 }, (_, i) => ({
      id: `${id}-m${i}`,
      profileId: 'default',
      position: { x: at.x + i * 1.3, y: at.y },
      woundsRemaining: 1,
      destroyed: false,
      hasTakenWoundsThisPhase: false,
    })),
    loadout: {},
    weapons: {},
  });
}

function expectOk(result: ReturnType<typeof reduce>): GameState {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.state;
}

function expectRejected(result: ReturnType<typeof reduce>, pattern?: RegExp): void {
  expect(result.ok).toBe(false);
  if (!result.ok && pattern) expect(result.error).toMatch(pattern);
}

// ---------------------------------------------------------------------------
// Setup flow
// ---------------------------------------------------------------------------

describe('setup flow through reduce()', () => {
  const board = {
    width: 60,
    height: 44,
    terrain: [],
    objectives: [],
    deploymentZones: [
      {
        player: 0 as const,
        polygon: [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
          { x: 60, y: 12 },
          { x: 0, y: 12 },
        ],
      },
      {
        player: 1 as const,
        polygon: [
          { x: 0, y: 32 },
          { x: 60, y: 32 },
          { x: 60, y: 44 },
          { x: 0, y: 44 },
        ],
      },
    ],
  };

  function freshGame(): GameState {
    return createInitialGameState({
      editionId: 'test-edition',
      missionId: 'test',
      deploymentMapId: 'test',
      contentVersions: {},
      board,
      players: [
        { name: 'Alice', factionId: 'test', detachmentId: 'test' },
        { name: 'Bob', factionId: 'test', detachmentId: 'test' },
      ],
      rngSeed: 7,
    });
  }

  it('runs roll-off → role choice → alternating deployment → first turn', () => {
    const e = env();
    let state = freshGame();

    // Rosters (one unit each).
    state = expectOk(reduce(state, { type: 'loadRoster', player: 0, units: [marineUnit('a', 0, [null, null])] }, e));
    expectRejected(reduce(state, { type: 'performRollOff', player: 1 }, e), /Both players/);
    state = expectOk(reduce(state, { type: 'loadRoster', player: 1, units: [marineUnit('b', 1, [null, null])] }, e));

    // Roll off, winner takes attacker.
    state = expectOk(reduce(state, { type: 'performRollOff', player: 0 }, e));
    const winner = state.setup!.rollOff!.winner;
    const loser = winner === 0 ? 1 : 0;
    expectRejected(
      reduce(state, { type: 'chooseRole', player: loser, role: 'attacker' }, e),
    );
    state = expectOk(reduce(state, { type: 'chooseRole', player: winner, role: 'attacker' }, e));
    const attacker = state.setup!.attacker!;
    expect(attacker).toBe(winner);
    expect(state.setup!.deployNext).toBe(attacker);

    // Defender cannot deploy first.
    const defender = attacker === 0 ? 1 : 0;
    const defUnit = defender === 0 ? 'p0-a' : 'p1-b';
    expectRejected(
      reduce(
        state,
        { type: 'deployUnit', player: defender, unitId: defUnit, positions: [] },
        e,
      ),
      /turn to deploy/,
    );

    // Attacker deploys into their zone (zone player index === player index).
    const atkUnit = attacker === 0 ? 'p0-a' : 'p1-b';
    const atkY = attacker === 0 ? 6 : 38;
    // Out-of-zone placement is rejected.
    expectRejected(
      reduce(
        state,
        {
          type: 'deployUnit',
          player: attacker,
          unitId: atkUnit,
          positions: [
            { modelId: `${attacker === 0 ? 'a' : 'b'}-m0`, x: 30, y: 22 },
            { modelId: `${attacker === 0 ? 'a' : 'b'}-m1`, x: 31.5, y: 22 },
          ],
        },
        e,
      ),
      /deployment zone/,
    );
    state = expectOk(
      reduce(
        state,
        {
          type: 'deployUnit',
          player: attacker,
          unitId: atkUnit,
          positions: [
            { modelId: `${attacker === 0 ? 'a' : 'b'}-m0`, x: 10, y: atkY },
            { modelId: `${attacker === 0 ? 'a' : 'b'}-m1`, x: 11.5, y: atkY },
          ],
        },
        e,
      ),
    );
    expect(state.setup!.deployNext).toBe(defender);

    const defY = defender === 0 ? 6 : 38;
    state = expectOk(
      reduce(
        state,
        {
          type: 'deployUnit',
          player: defender,
          unitId: defUnit,
          positions: [
            { modelId: `${defender === 0 ? 'a' : 'b'}-m0`, x: 10, y: defY },
            { modelId: `${defender === 0 ? 'a' : 'b'}-m1`, x: 11.5, y: defY },
          ],
        },
        e,
      ),
    );
    expect(state.setup!.deployNext).toBeNull();

    // First-turn roll-off, then the first player begins the battle.
    state = expectOk(reduce(state, { type: 'performRollOff', player: 0 }, e));
    expect(state.setup!.readyToStart).toBe(true);
    const first = state.firstPlayer;
    const notFirst = first === 0 ? 1 : 0;
    expectRejected(reduce(state, { type: 'advanceStep', player: notFirst }, e));
    state = expectOk(reduce(state, { type: 'advanceStep', player: first }, e));
    expect(state.round).toBe(1);
    expect(state.phase).toBe('command');
  });

  it('enforces coherency at deployment when set to enforce', () => {
    const e = env();
    let state = freshGame();
    state = expectOk(reduce(state, { type: 'loadRoster', player: 0, units: [marineUnit('a', 0, [null, null])] }, e));
    state = expectOk(reduce(state, { type: 'loadRoster', player: 1, units: [marineUnit('b', 1, [null, null])] }, e));
    state = expectOk(reduce(state, { type: 'performRollOff', player: 0 }, e));
    const winner = state.setup!.rollOff!.winner;
    state = expectOk(reduce(state, { type: 'chooseRole', player: winner, role: 'attacker' }, e));
    const attacker = state.setup!.attacker!;
    const prefix = attacker === 0 ? 'a' : 'b';
    const y = attacker === 0 ? 6 : 38;
    // 10" apart — far beyond 2" coherency for a 2-model unit.
    expectRejected(
      reduce(
        state,
        {
          type: 'deployUnit',
          player: attacker,
          unitId: `p${attacker}-${prefix}`,
          positions: [
            { modelId: `${prefix}-m0`, x: 10, y },
            { modelId: `${prefix}-m1`, x: 25, y },
          ],
        },
        e,
      ),
      /coherency/,
    );
  });
});

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

describe('movement through reduce()', () => {
  function movementState(): GameState {
    return makeState({
      phase: 'movement',
      step: 'moveUnits',
      round: 1,
      activePlayer: 0,
      units: {
        'u-a': marineUnit('u-a', 0, [{ x: 10, y: 10 }, { x: 11.5, y: 10 }]),
        'u-b': guardUnit('u-b', 1, { x: 40, y: 10 }),
      },
    });
  }

  it('normal move: start, distance-check, commit', () => {
    const e = env();
    let state = movementState();
    state = expectOk(reduce(state, { type: 'startMove', player: 0, unitId: 'u-a', kind: 'normal' }, e));
    expect(state.pendingMove?.budget).toBe(6);
    // 10" is too far for M6.
    expectRejected(
      reduce(
        state,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'u-a',
          positions: [
            { modelId: 'u-a-m0', x: 20, y: 10 },
            { modelId: 'u-a-m1', x: 21.5, y: 10 },
          ],
        },
        e,
      ),
      /maximum/,
    );
    state = expectOk(
      reduce(
        state,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'u-a',
          positions: [
            { modelId: 'u-a-m0', x: 15, y: 10 },
            { modelId: 'u-a-m1', x: 16.5, y: 10 },
          ],
        },
        e,
      ),
    );
    expect(state.units['u-a']?.turnFlags.moveKind).toBe('normal');
    expect(state.units['u-a']?.models[0]?.position).toEqual({ x: 15, y: 10 });
    // Cannot move twice.
    expectRejected(
      reduce(state, { type: 'startMove', player: 0, unitId: 'u-a', kind: 'normal' }, e),
      /already moved/,
    );
  });

  it('advance rolls a D6 and extends the budget; cancel is forbidden after', () => {
    const e = env();
    let state = movementState();
    state = expectOk(reduce(state, { type: 'startMove', player: 0, unitId: 'u-a', kind: 'advance' }, e));
    const roll = state.pendingMove?.advanceRoll;
    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(6);
    expect(state.pendingMove?.budget).toBe(6 + (roll ?? 0));
    expectRejected(reduce(state, { type: 'cancelMove', player: 0, unitId: 'u-a' }, e), /cannot be cancelled/);
    state = expectOk(
      reduce(
        state,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'u-a',
          positions: [
            { modelId: 'u-a-m0', x: 10 + 6 + (roll ?? 0), y: 10 },
            { modelId: 'u-a-m1', x: 11.5 + 6 + (roll ?? 0), y: 10 },
          ],
        },
        e,
      ),
    );
    expect(state.units['u-a']?.turnFlags.moveKind).toBe('advance');
  });

  it('rejects the reactive player and wrong phases', () => {
    const e = env();
    const state = movementState();
    const wrongPlayer = reduce(state, { type: 'startMove', player: 1, unitId: 'u-b', kind: 'normal' }, e);
    expect(!wrongPlayer.ok && wrongPlayer.code).toBe('OUT_OF_TURN');
    const shooting = makeState({ ...movementState(), phase: 'shooting' });
    expectRejected(
      reduce(shooting, { type: 'startMove', player: 0, unitId: 'u-a', kind: 'normal' }, e),
      /Movement phase/,
    );
  });

  it('normal move cannot end within engagement range', () => {
    const e = env();
    let state = movementState();
    state = expectOk(reduce(state, { type: 'startMove', player: 0, unitId: 'u-a', kind: 'normal' }, e));
    // u-b guard at x=40; moving adjacent (within 1" edge-to-edge) is illegal.
    state = {
      ...state,
      units: {
        ...state.units,
        'u-a': {
          ...state.units['u-a']!,
          models: state.units['u-a']!.models.map((m, i) => ({
            ...m,
            position: { x: 36 + i * 1.5, y: 10 },
          })),
        },
      },
    };
    expectRejected(
      reduce(
        state,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'u-a',
          positions: [
            { modelId: 'u-a-m0', x: 38.5, y: 10 },
            { modelId: 'u-a-m1', x: 37, y: 10 },
          ],
        },
        e,
      ),
      /Engagement Range/,
    );
  });
});

// ---------------------------------------------------------------------------
// Shooting with the reactive save window
// ---------------------------------------------------------------------------

describe('shooting through reduce()', () => {
  function shootingState(seed = 1): GameState {
    return makeState({
      phase: 'shooting',
      step: 'shoot',
      round: 1,
      activePlayer: 0,
      rng: { seed, counter: 0 },
      units: {
        'u-a': marineUnit('u-a', 0, [{ x: 10, y: 10 }, { x: 11.5, y: 10 }]),
        'u-b': guardUnit('u-b', 1, { x: 18, y: 10 }),
      },
    });
  }

  it('resolves hits and wounds, then pauses for the defender to save', () => {
    const e = env();
    // Find a seed producing at least one wound so the save window opens.
    let state: GameState | null = null;
    for (let seed = 1; seed < 60; seed++) {
      const candidate = shootingState(seed);
      const result = reduce(
        candidate,
        {
          type: 'declareShoot',
          player: 0,
          unitId: 'u-a',
          assignments: [{ weaponId: 'bolter', targetUnitId: 'u-b' }],
        },
        e,
      );
      if (result.ok && result.state.pendingDecision) {
        state = result.state;
        break;
      }
    }
    expect(state).not.toBeNull();
    const decision = state!.pendingDecision!;
    expect(decision.kind).toBe('saves');
    expect(decision.player).toBe(1);
    expect((decision.context.wounds as number) + (decision.context.mortalWounds as number)).toBeGreaterThan(0);

    // Rapid Fire 1 at ~8" (half of 24" range): 2 models × (2+1) = 6 attacks.
    const attackLog = state!.log.find((l) => l.kind === 'attack');
    expect(attackLog?.data?.attacks).toBe(6);

    // The attacker cannot advance the phase while the defender decides.
    const blocked = reduce(state!, { type: 'advanceStep', player: 0 }, e);
    expect(!blocked.ok && blocked.code).toBe('PENDING_DECISION');
    // And the attacker cannot roll the defender's saves.
    const wrong = reduce(state!, { type: 'resolveSaves', player: 0 }, e);
    expect(!wrong.ok && wrong.code).toBe('OUT_OF_TURN');

    // Defender resolves: damage lands, sequence completes, unit marked shot.
    const done = expectOk(reduce(state!, { type: 'resolveSaves', player: 1 }, e));
    expect(done.pendingDecision).toBeNull();
    expect(done.shooting).toBeNull();
    expect(done.units['u-a']?.turnFlags.hasShot).toBe(true);
    const woundsBefore = 5;
    const aliveAfter = done.units['u-b']!.models.filter((m) => !m.destroyed).length;
    expect(aliveAfter).toBeLessThanOrEqual(woundsBefore);
    const savesLog = done.log.find((l) => l.kind === 'saves');
    expect(savesLog?.message).toContain('resolves saves');
  });

  it('rejects shooting twice, out of range, and after advancing with non-assault weapons', () => {
    const e = env();
    let state = shootingState();

    // Out of range: move the target across the board.
    const farState: GameState = {
      ...state,
      units: {
        ...state.units,
        'u-b': guardUnit('u-b', 1, { x: 50, y: 40 }),
      },
    };
    expectRejected(
      reduce(
        farState,
        { type: 'declareShoot', player: 0, unitId: 'u-a', assignments: [{ weaponId: 'bolter', targetUnitId: 'u-b' }] },
        e,
      ),
      /out of range/,
    );

    // Advanced without Assault.
    const advanced: GameState = {
      ...state,
      units: {
        ...state.units,
        'u-a': {
          ...state.units['u-a']!,
          turnFlags: { ...state.units['u-a']!.turnFlags, moveKind: 'advance' },
        },
      },
    };
    expectRejected(
      reduce(
        advanced,
        { type: 'declareShoot', player: 0, unitId: 'u-a', assignments: [{ weaponId: 'bolter', targetUnitId: 'u-b' }] },
        e,
      ),
      /Advanced/,
    );

    // hasShot set → second declaration rejected.
    const shot: GameState = {
      ...state,
      units: {
        ...state.units,
        'u-a': {
          ...state.units['u-a']!,
          turnFlags: { ...state.units['u-a']!.turnFlags, hasShot: true },
        },
      },
    };
    expectRejected(
      reduce(
        shot,
        { type: 'declareShoot', player: 0, unitId: 'u-a', assignments: [{ weaponId: 'bolter', targetUnitId: 'u-b' }] },
        e,
      ),
      /already shot/,
    );
  });

  it('ruins block visibility through their footprint', () => {
    const e = env();
    const state: GameState = {
      ...shootingState(),
      board: {
        width: 60,
        height: 44,
        terrain: [
          {
            id: 'wall',
            name: 'Ruins',
            footprint: [
              { x: 14, y: 5 },
              { x: 16, y: 5 },
              { x: 16, y: 15 },
              { x: 14, y: 15 },
            ],
            height: 4,
            traits: ['ruins'],
          },
        ],
        objectives: [],
        deploymentZones: [],
      },
    };
    expectRejected(
      reduce(
        state,
        { type: 'declareShoot', player: 0, unitId: 'u-a', assignments: [{ weaponId: 'bolter', targetUnitId: 'u-b' }] },
        e,
      ),
      /not visible/,
    );
  });

  it('the same seed and actions always produce the same outcome', () => {
    const e = env();
    const run = () => {
      let s = shootingState(11);
      const r = reduce(
        s,
        { type: 'declareShoot', player: 0, unitId: 'u-a', assignments: [{ weaponId: 'bolter', targetUnitId: 'u-b' }] },
        e,
      );
      if (!r.ok) return 'rejected';
      s = r.state;
      if (s.pendingDecision) {
        const done = reduce(s, { type: 'resolveSaves', player: 1 }, e);
        if (done.ok) s = done.state;
      }
      return JSON.stringify({
        rng: s.rng,
        models: s.units['u-b']!.models.map((m) => [m.destroyed, m.woundsRemaining]),
      });
    };
    expect(run()).toEqual(run());
  });
});
