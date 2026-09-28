import { describe, expect, it } from 'vitest';
import type { Datasheet } from '../types/content.js';
import type { GameState, UnitState } from '../types/state.js';
import { reduce, advanceStep, ENDED_PHASE } from './reducer.js';
import { makeEnv, makeState, makeUnit } from '../test-helpers.js';
import type { ReducerEnv } from './env.js';

// ---------------------------------------------------------------------------
// Fixtures: a leader-capable character, deep-strikers, scouts, a line squad
// ---------------------------------------------------------------------------

function sheet(id: string, overrides: Partial<Datasheet> = {}): Datasheet {
  return {
    id,
    name: id,
    factionId: 'test',
    keywords: ['Infantry'],
    factionKeywords: ['Test'],
    models: [
      {
        id: 'default',
        name: 'Model',
        move: 6,
        toughness: 4,
        save: 4,
        wounds: 2,
        leadership: 7,
        objectiveControl: 2,
        baseSizeMm: 25,
        heightInches: 1.2,
      },
    ],
    unitComposition: { sizes: [{ models: 3, points: 60 }] },
    rangedWeapons: [],
    meleeWeapons: [],
    coreAbilities: [],
    abilities: [],
    ...overrides,
  };
}

const datasheets: Record<string, Datasheet> = {
  'test/line': sheet('test/line'),
  'test/captain': sheet('test/captain', {
    keywords: ['Infantry', 'Character'],
    coreAbilities: [{ id: 'core.leader' }],
    leader: { canLead: [] },
  }),
  'test/droppers': sheet('test/droppers', { coreAbilities: [{ id: 'core.deep-strike' }] }),
  'test/scouts': sheet('test/scouts', { coreAbilities: [{ id: 'core.scout', value: 7 }] }),
};

function m3Env(): ReducerEnv {
  const env = makeEnv({ datasheets });
  env.content.getCoreAbility = (ref) => {
    const structural: Record<string, string> = {
      'core.leader': 'leader',
      'core.deep-strike': 'deepStrike',
      'core.scout': 'scout',
    };
    return { effects: [], structural: structural[ref.id] };
  };
  env.content.getWeaponAbility = (ref) =>
    ref.id === 'precision'
      ? {
          effects: [
            {
              id: 'precision.allocate',
              trigger: 'attack.allocate',
              condition: { targetIsAttachedUnit: true },
              effects: [{ type: 'allocatePrecision' }],
            },
          ],
          flags: [],
        }
      : { effects: [], flags: [] };
  return env;
}

function unit(
  id: string,
  owner: 0 | 1,
  datasheetId: string,
  at: { x: number; y: number } | null,
  opts: Partial<UnitState> = {},
): UnitState {
  const count = datasheetId === 'test/captain' ? 1 : 3;
  return makeUnit({
    id,
    owner,
    datasheetId,
    name: id,
    startingStrength: count,
    points: 60,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      profileId: 'default',
      position: at ? { x: at.x + i * 1.2, y: at.y } : null,
      woundsRemaining: 2,
      destroyed: false,
      hasTakenWoundsThisPhase: false,
    })),
    ...opts,
  });
}

function ok(result: ReturnType<typeof reduce>): GameState {
  if (!result.ok) throw new Error(`expected ok: ${result.error}`);
  return result.state;
}

function bad(result: ReturnType<typeof reduce>, pattern?: RegExp): void {
  expect(result.ok).toBe(false);
  if (!result.ok && pattern) expect(result.error).toMatch(pattern);
}

// ---------------------------------------------------------------------------
// Reserves declaration + arrival
// ---------------------------------------------------------------------------

describe('reserves', () => {
  function setupState(): { env: ReducerEnv; state: GameState } {
    const env = m3Env();
    const state = makeState({
      phase: 'setup',
      step: null,
      round: 0,
      setup: {
        rostersLoaded: [true, true],
        rollOff: null,
        attacker: null,
        deployNext: null,
        readyToStart: false,
      },
      units: {
        line: unit('line', 0, 'test/line', null),
        droppers: unit('droppers', 0, 'test/droppers', null),
        enemy: unit('enemy', 1, 'test/line', null),
      },
    });
    return { env, state };
  }

  it('deep strike needs the ability; strategic reserves respect the 25% cap', () => {
    const { env, state } = setupState();
    bad(
      reduce(state, { type: 'setReserves', player: 0, unitId: 'line', kind: 'deepStrike' }, env),
      /does not have Deep Strike/,
    );
    const dropped = ok(
      reduce(state, { type: 'setReserves', player: 0, unitId: 'droppers', kind: 'deepStrike' }, env),
    );
    expect(dropped.units['droppers']!.reserves).toBe('deepStrike');
    // Army total 120 pts → 25% cap is 30 → a 60-pt unit cannot go strategic.
    bad(
      reduce(dropped, { type: 'setReserves', player: 0, unitId: 'line', kind: 'strategic' }, env),
      /cannot exceed/,
    );
  });

  it('reserves arrive from round 2, >9" out, counting as a normal move', () => {
    const env = m3Env();
    const inReserve = unit('droppers', 0, 'test/droppers', null, { reserves: 'deepStrike' });
    const round1 = makeState({
      phase: 'movement',
      step: 'reinforcements',
      round: 1,
      activePlayer: 0,
      units: {
        droppers: inReserve,
        enemy: unit('enemy', 1, 'test/line', { x: 30, y: 22 }),
      },
    });
    const positions = inReserve.models.map((m, i) => ({ modelId: m.id, x: 5 + i * 1.4, y: 5 }));
    bad(
      reduce(round1, { type: 'deployReserves', player: 0, unitId: 'droppers', positions }, env),
      /round 2/,
    );

    const round2: GameState = { ...round1, round: 2 };
    // Too close to the enemy.
    bad(
      reduce(
        round2,
        {
          type: 'deployReserves',
          player: 0,
          unitId: 'droppers',
          positions: inReserve.models.map((m, i) => ({ modelId: m.id, x: 25 + i * 1.4, y: 22 })),
        },
        env,
      ),
      /more than 9"/,
    );
    const arrived = ok(
      reduce(round2, { type: 'deployReserves', player: 0, unitId: 'droppers', positions }, env),
    );
    const dropped = arrived.units['droppers']!;
    expect(dropped.reserves).toBe('none');
    expect(dropped.turnFlags.moveKind).toBe('normal');
    expect(dropped.turnFlags.arrivedFromReserves).toBe(true);
    expect(dropped.models[0]!.position).toEqual({ x: 5, y: 5 });
  });

  it('reserves that never arrive are destroyed at the end of the battle', () => {
    const env = m3Env();
    const state = makeState({
      phase: 'fight',
      step: 'remainingCombats',
      round: 5,
      activePlayer: 1,
      firstPlayer: 0,
      fight: { selector: null, activeUnitId: null, stage: 'select', fought: [] },
      units: {
        droppers: unit('droppers', 0, 'test/droppers', null, { reserves: 'deepStrike' }),
      },
    });
    const ended = advanceStep(state, env);
    expect(ended.phase).toBe(ENDED_PHASE);
    expect(ended.units['droppers']!.models.every((m) => m.destroyed)).toBe(true);
    expect(ended.log.some((l) => l.message.includes('never arrived'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Leader attachment
// ---------------------------------------------------------------------------

describe('leader attachment', () => {
  function preGame(): { env: ReducerEnv; state: GameState } {
    const env = m3Env();
    const state = makeState({
      phase: 'setup',
      step: null,
      round: 0,
      setup: {
        rostersLoaded: [true, true],
        rollOff: null,
        attacker: null,
        deployNext: null,
        readyToStart: false,
      },
      units: {
        captain: unit('captain', 0, 'test/captain', null),
        line: unit('line', 0, 'test/line', null),
        captain2: unit('captain2', 0, 'test/captain', null),
        enemy: unit('enemy', 1, 'test/line', null),
      },
    });
    return { env, state };
  }

  it('attaches a Leader to a bodyguard unit (and can detach)', () => {
    const { env, state } = preGame();
    bad(
      reduce(state, { type: 'attachLeader', player: 0, leaderUnitId: 'line', bodyguardUnitId: 'captain' }, env),
      /does not have the Leader ability/,
    );
    bad(
      reduce(state, { type: 'attachLeader', player: 0, leaderUnitId: 'captain', bodyguardUnitId: 'captain2' }, env),
      /not another Character/,
    );
    const attached = ok(
      reduce(state, { type: 'attachLeader', player: 0, leaderUnitId: 'captain', bodyguardUnitId: 'line' }, env),
    );
    expect(attached.units['captain']!.attachedTo).toBe('line');
    expect(attached.units['line']!.leaderOf).toBe('captain');
    const detached = ok(
      reduce(attached, { type: 'attachLeader', player: 0, leaderUnitId: 'captain', bodyguardUnitId: null }, env),
    );
    expect(detached.units['captain']!.attachedTo).toBeNull();
    expect(detached.units['line']!.leaderOf).toBeNull();
  });

  it('attached leaders cannot be targeted; Precision bleeds wounds onto them', () => {
    const env = m3Env();
    const shooterWeapons: Partial<UnitState> = {
      loadout: { 'shooters-m0': ['sniper'], 'shooters-m1': ['sniper'], 'shooters-m2': ['sniper'] },
      weapons: {
        sniper: {
          id: 'sniper',
          name: 'Sniper rifle',
          kind: 'ranged',
          range: 36,
          attacks: '2',
          skill: 2,
          strength: 5,
          ap: -2,
          damage: '2',
          abilities: [{ id: 'precision' }],
        },
      },
    };
    for (let seed = 1; seed < 60; seed++) {
      const base = makeState({
        phase: 'shooting',
        step: 'shoot',
        round: 1,
        activePlayer: 1,
        rng: { seed, counter: 0 },
        units: {
          captain: unit('captain', 0, 'test/captain', { x: 10, y: 10 }, { attachedTo: 'line' }),
          line: unit('line', 0, 'test/line', { x: 12, y: 10 }, { leaderOf: 'captain' }),
          shooters: unit('shooters', 1, 'test/line', { x: 12, y: 30 }, shooterWeapons),
        },
      });
      // The leader unit itself is untargetable while attached.
      bad(
        reduce(
          base,
          {
            type: 'declareShoot',
            player: 1,
            unitId: 'shooters',
            assignments: [{ weaponId: 'sniper', targetUnitId: 'captain' }],
          },
          env,
        ),
        /attached/,
      );
      const declared = ok(
        reduce(
          base,
          {
            type: 'declareShoot',
            player: 1,
            unitId: 'shooters',
            assignments: [{ weaponId: 'sniper', targetUnitId: 'line' }],
          },
          env,
        ),
      );
      if (declared.pendingDecision?.kind !== 'saves') continue; // whiffed
      const resolved = ok(reduce(declared, { type: 'resolveSaves', player: 0 }, env));
      const captain = resolved.units['captain']!;
      const tookDamage = captain.models[0]!.woundsRemaining < 2 || captain.models[0]!.destroyed;
      if (tookDamage) {
        const savesLog = resolved.log.find((l) => l.kind === 'saves');
        expect(savesLog?.message).toContain('Precision: leader');
        return;
      }
      // All saves made — try another seed.
    }
    throw new Error('no seed produced a failed save against the sniper volley in 60 tries');
  });
});

// ---------------------------------------------------------------------------
// Scout moves
// ---------------------------------------------------------------------------

describe('scout moves', () => {
  it('allows a pre-game move up to X", ending >9" from enemies', () => {
    const env = m3Env();
    const state = makeState({
      phase: 'setup',
      step: null,
      round: 0,
      setup: {
        rostersLoaded: [true, true],
        rollOff: null,
        attacker: 0,
        deployNext: null,
        readyToStart: true,
      },
      units: {
        scouts: unit('scouts', 0, 'test/scouts', { x: 10, y: 10 }),
        line: unit('line', 0, 'test/line', { x: 20, y: 6 }),
        enemy: unit('enemy', 1, 'test/line', { x: 30, y: 38 }),
      },
    });
    bad(
      reduce(
        state,
        {
          type: 'scoutMove',
          player: 0,
          unitId: 'line',
          positions: state.units['line']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 3,
          })),
        },
        env,
      ),
      /does not have Scout/,
    );
    bad(
      reduce(
        state,
        {
          type: 'scoutMove',
          player: 0,
          unitId: 'scouts',
          positions: state.units['scouts']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 8,
          })),
        },
        env,
      ),
      /Scout 7/,
    );
    const moved = ok(
      reduce(
        state,
        {
          type: 'scoutMove',
          player: 0,
          unitId: 'scouts',
          positions: state.units['scouts']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 7,
          })),
        },
        env,
      ),
    );
    expect(moved.units['scouts']!.models[0]!.position).toEqual({ x: 10, y: 17 });

    // Ending too close to the enemy is illegal (start within reach).
    const nearEnemy: GameState = {
      ...state,
      units: {
        ...state.units,
        scouts: unit('scouts', 0, 'test/scouts', { x: 30, y: 26 }),
      },
    };
    bad(
      reduce(
        nearEnemy,
        {
          type: 'scoutMove',
          player: 0,
          unitId: 'scouts',
          positions: nearEnemy.units['scouts']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 6,
          })),
        },
        env,
      ),
      /9"/,
    );
  });
});
