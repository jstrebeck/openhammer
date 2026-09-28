import { describe, expect, it } from 'vitest';
import type { Datasheet } from '../types/content.js';
import type { GameState, UnitState } from '../types/state.js';
import { reduce } from './reducer.js';
import { makeEnv, makeState, makeUnit, testEdition } from '../test-helpers.js';
import type { ReducerEnv } from './env.js';

// ---------------------------------------------------------------------------
// Fixtures: infantry and a vehicle (for Big Guns Never Tire)
// ---------------------------------------------------------------------------

function sheet(id: string, keywords: string[]): Datasheet {
  return {
    id,
    name: id,
    factionId: 'test',
    keywords,
    factionKeywords: ['Test'],
    models: [
      {
        id: 'default',
        name: 'Model',
        move: 6,
        toughness: 6,
        save: 3,
        wounds: 6,
        leadership: 7,
        objectiveControl: 2,
        baseSizeMm: 32,
        heightInches: 1.5,
      },
    ],
    unitComposition: { sizes: [{ models: 3, points: 60 }] },
    rangedWeapons: [],
    meleeWeapons: [],
    coreAbilities: [],
    abilities: [],
  };
}

const datasheets = {
  'test/infantry': sheet('test/infantry', ['Infantry']),
  'test/tank': sheet('test/tank', ['Vehicle', 'Smoke']),
};

function bgntEnv(): ReducerEnv {
  const env = makeEnv({ datasheets });
  env.content.edition = {
    ...testEdition,
    parameters: {
      ...testEdition.parameters,
      bigGunsNeverTire: { keywords: ['Monster', 'Vehicle'], hitPenalty: -1 },
    },
  };
  return env;
}

function unit(
  id: string,
  owner: 0 | 1,
  datasheetId: string,
  at: { x: number; y: number },
  opts: Partial<UnitState> = {},
): UnitState {
  return makeUnit({
    id,
    owner,
    datasheetId,
    name: id,
    startingStrength: 1,
    models: [
      {
        id: `${id}-m0`,
        profileId: 'default',
        position: at,
        woundsRemaining: 6,
        destroyed: false,
        hasTakenWoundsThisPhase: false,
      },
    ],
    loadout: { [`${id}-m0`]: ['cannon'] },
    weapons: {
      cannon: {
        id: 'cannon',
        name: 'Cannon',
        kind: 'ranged',
        range: 48,
        attacks: '3',
        skill: 3,
        strength: 8,
        ap: -1,
        damage: '2',
        abilities: [],
      },
    },
    ...opts,
  });
}

function ok(result: ReturnType<typeof reduce>): GameState {
  if (!result.ok) throw new Error(`expected ok: ${result.error}`);
  return result.state;
}

// ---------------------------------------------------------------------------
// Casual (warn) enforcement
// ---------------------------------------------------------------------------

describe('casual enforcement (warn)', () => {
  function movementState(level: 'enforce' | 'warn'): GameState {
    const base = makeState({
      phase: 'movement',
      step: 'moveUnits',
      activePlayer: 0,
      units: {
        mover: unit('mover', 0, 'test/infantry', { x: 10, y: 10 }),
        enemy: unit('enemy', 1, 'test/infantry', { x: 40, y: 30 }),
      },
    });
    return {
      ...base,
      enforcement: { movement: level, targeting: level, coherency: level, stratagems: level },
    };
  }

  it('strict games reject an over-budget move; casual games warn and allow', () => {
    const env = makeEnv({ datasheets });
    // Strict: 20" on M6 is rejected.
    let strict = ok(
      reduce(movementState('enforce'), { type: 'startMove', player: 0, unitId: 'mover', kind: 'normal' }, env),
    );
    const rejected = reduce(
      strict,
      { type: 'commitMove', player: 0, unitId: 'mover', positions: [{ modelId: 'mover-m0', x: 30, y: 10 }] },
      env,
    );
    expect(rejected.ok).toBe(false);

    // Casual: same move goes through with a warning in the log.
    let casual = ok(
      reduce(movementState('warn'), { type: 'startMove', player: 0, unitId: 'mover', kind: 'normal' }, env),
    );
    casual = ok(
      reduce(
        casual,
        { type: 'commitMove', player: 0, unitId: 'mover', positions: [{ modelId: 'mover-m0', x: 30, y: 10 }] },
        env,
      ),
    );
    expect(casual.units['mover']!.models[0]!.position).toEqual({ x: 30, y: 10 });
    expect(
      casual.log.some((l) => l.kind === 'warning' && /maximum/.test(l.message)),
    ).toBe(true);
  });

  it('casual games warn-and-allow out-of-range shooting', () => {
    const env = makeEnv({ datasheets });
    const base = makeState({
      phase: 'shooting',
      step: 'shoot',
      activePlayer: 0,
      units: {
        shooter: unit('shooter', 0, 'test/infantry', { x: 2, y: 2 }),
        enemy: unit('enemy', 1, 'test/infantry', { x: 58, y: 42 }), // ~69" away
      },
    });
    const casual: GameState = {
      ...base,
      enforcement: { movement: 'warn', targeting: 'warn', coherency: 'warn', stratagems: 'warn' },
    };
    const result = ok(
      reduce(
        casual,
        {
          type: 'declareShoot',
          player: 0,
          unitId: 'shooter',
          assignments: [{ weaponId: 'cannon', targetUnitId: 'enemy' }],
        },
        env,
      ),
    );
    expect(result.log.some((l) => l.kind === 'warning' && /out of range/.test(l.message))).toBe(true);
    // The sequence still resolved (dice were rolled or saves are pending).
    expect(result.log.some((l) => l.kind === 'attack')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Big Guns Never Tire
// ---------------------------------------------------------------------------

describe('big guns never tire', () => {
  function meleeLockState(shooterSheet: string): GameState {
    return makeState({
      phase: 'shooting',
      step: 'shoot',
      activePlayer: 0,
      rng: { seed: 3, counter: 0 },
      units: {
        shooter: unit('shooter', 0, shooterSheet, { x: 10, y: 10 }),
        // An enemy base-to-base with the shooter (locked in melee).
        blocker: unit('blocker', 1, 'test/infantry', { x: 11.5, y: 10 }),
        // A second enemy across the field.
        far: unit('far', 1, 'test/infantry', { x: 30, y: 10 }),
      },
    });
  }

  it('infantry locked in melee cannot shoot; vehicles can, at -1', () => {
    const env = bgntEnv();
    const infantry = reduce(
      meleeLockState('test/infantry'),
      { type: 'declareShoot', player: 0, unitId: 'shooter', assignments: [{ weaponId: 'cannon', targetUnitId: 'far' }] },
      env,
    );
    expect(infantry.ok).toBe(false);

    const vehicle = ok(
      reduce(
        meleeLockState('test/tank'),
        { type: 'declareShoot', player: 0, unitId: 'shooter', assignments: [{ weaponId: 'cannon', targetUnitId: 'far' }] },
        env,
      ),
    );
    // The attack resolved out of melee with the -1 penalty applied: with
    // skill 3 and -1, dice showing 3 miss (3-1=2 < 3), dice showing 4 hit.
    const attackLog = vehicle.log.find((l) => l.kind === 'attack')!;
    const hitRolls = attackLog.data!.hitRolls as number[];
    const message = attackLog.message;
    const hitCount = Number(/→ (\d+) hit/.exec(message)?.[1] ?? -1);
    const expected = hitRolls.filter((r) => r >= 4 || r === 6).length;
    expect(hitCount).toBe(expected);
  });

  it('enemy vehicles locked in melee CAN be targeted (unlike infantry)', () => {
    const env = bgntEnv();
    const base = makeState({
      phase: 'shooting',
      step: 'shoot',
      activePlayer: 0,
      rng: { seed: 5, counter: 0 },
      units: {
        shooter: unit('shooter', 0, 'test/infantry', { x: 10, y: 30 }),
        // My own melee unit tied up with the enemy tank.
        brawler: unit('brawler', 0, 'test/infantry', { x: 30, y: 10 }),
        tank: unit('tank', 1, 'test/tank', { x: 31.5, y: 10 }),
        troops: unit('troops', 1, 'test/infantry', { x: 28.6, y: 10.5 }),
      },
    });
    // Infantry in that melee: still protected.
    const infantry = reduce(
      base,
      { type: 'declareShoot', player: 0, unitId: 'shooter', assignments: [{ weaponId: 'cannon', targetUnitId: 'troops' }] },
      env,
    );
    expect(infantry.ok).toBe(false);
    // The tank: legal target at -1.
    const tank = reduce(
      base,
      { type: 'declareShoot', player: 0, unitId: 'shooter', assignments: [{ weaponId: 'cannon', targetUnitId: 'tank' }] },
      env,
    );
    expect(tank.ok).toBe(true);
  });
});
