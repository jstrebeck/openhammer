import { describe, expect, it } from 'vitest';
import type { Datasheet, StratagemDef } from '../types/content.js';
import type { GameState, UnitState } from '../types/state.js';
import { reduce, advanceStep } from './reducer.js';
import { continueShooting } from './shootingReducer.js';
import { makeEnv, makeState, makeUnit } from '../test-helpers.js';
import type { ReducerEnv, ScriptFn } from './env.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grunts: Datasheet = {
  id: 'test/grunts',
  name: 'Grunts',
  factionId: 'test',
  keywords: ['Infantry'],
  factionKeywords: ['Test'],
  models: [
    {
      id: 'default',
      name: 'Grunt',
      move: 6,
      toughness: 4,
      save: 4,
      wounds: 1,
      leadership: 7,
      objectiveControl: 2,
      baseSizeMm: 25,
      heightInches: 1.2,
    },
  ],
  unitComposition: { sizes: [{ models: 4, points: 60 }] },
  rangedWeapons: [],
  meleeWeapons: [],
  coreAbilities: [],
  abilities: [],
};

const insaneBravery: StratagemDef = {
  id: 'test.insane-bravery',
  name: 'Insane Bravery',
  cost: 1,
  player: 'active',
  phase: ['command'],
  window: 'command.battleShockFailed',
  target: { who: 'friendly', allowBattleShocked: true },
  effects: [
    {
      id: 'test.insane-bravery.effect',
      trigger: 'command.battleShockFailed',
      effects: [{ type: 'autoPassBattleShock' }],
      duration: 'instant',
    },
  ],
};

const overwatch: StratagemDef = {
  id: 'test.overwatch',
  name: 'Fire Overwatch',
  cost: 1,
  player: 'reactive',
  phase: ['movement', 'charge'],
  window: ['move.completed', 'charge.completed', 'reserves.arrived'],
  target: { who: 'friendly' },
  effects: [
    {
      id: 'test.overwatch.effect',
      trigger: 'move.completed',
      effects: [{ type: 'script', scriptId: 'test.overwatch' }],
      duration: 'instant',
      scriptId: 'test.overwatch',
      limit: { count: 1, per: 'turn' },
    },
  ],
};

const overwatchScript: ScriptFn = (state, env, args) => {
  const shooterId = args.targetUnitId!;
  const moverId = args.context.movedUnitId as string;
  const armed: GameState = {
    ...state,
    shooting: {
      attackerUnitId: shooterId,
      onlySixesHit: true,
      outOfPhase: true,
      remaining: Object.values(state.units[shooterId]!.weapons)
        .filter((w) => w.kind === 'ranged')
        .map((w) => ({ weaponId: w.id, targetUnitId: moverId })),
      current: null,
      usedWeaponIds: [],
    },
  };
  return continueShooting(armed, env);
};

function m3Env(stratagems: StratagemDef[] = []): ReducerEnv {
  const env = makeEnv({ datasheets: { 'test/grunts': grunts } });
  env.content.getStratagems = () => stratagems;
  env.content.getScript = (id) => (id === 'test.overwatch' ? overwatchScript : undefined);
  return env;
}

function squad(
  id: string,
  owner: 0 | 1,
  at: { x: number; y: number },
  opts: Partial<UnitState> & { count?: number; alive?: number } = {},
): UnitState {
  const count = opts.count ?? 4;
  const alive = opts.alive ?? count;
  const { count: _c, alive: _a, ...rest } = opts;
  return makeUnit({
    id,
    owner,
    datasheetId: 'test/grunts',
    name: `Squad ${id}`,
    startingStrength: count,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      profileId: 'default',
      position: i < alive ? { x: at.x + i * 1.2, y: at.y } : null,
      woundsRemaining: i < alive ? 1 : 0,
      destroyed: i >= alive,
      hasTakenWoundsThisPhase: false,
    })),
    loadout: Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`${id}-m${i}`, ['gun', 'knife']]),
    ),
    weapons: {
      gun: {
        id: 'gun',
        name: 'Gun',
        kind: 'ranged',
        range: 24,
        attacks: '1',
        skill: 4,
        strength: 4,
        ap: 0,
        damage: '1',
        abilities: [],
      },
      knife: {
        id: 'knife',
        name: 'Knife',
        kind: 'melee',
        range: null,
        attacks: '2',
        skill: 3,
        strength: 4,
        ap: 0,
        damage: '1',
        abilities: [],
      },
    },
    ...rest,
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
// Battle-shock
// ---------------------------------------------------------------------------

describe('battle-shock step', () => {
  function commandState(seed: number, stratagems: StratagemDef[] = []) {
    const env = m3Env(stratagems);
    const state = makeState({
      phase: 'command',
      step: 'command',
      round: 2,
      activePlayer: 0,
      rng: { seed, counter: 0 },
      units: {
        weak: squad('weak', 0, { x: 10, y: 10 }, { count: 4, alive: 1 }),
        strong: squad('strong', 0, { x: 20, y: 10 }),
        enemy: squad('enemy', 1, { x: 40, y: 30 }),
      },
    });
    return { env, state };
  }

  it('tests below-half-strength units on step entry and shocks failures', () => {
    // Find a seed where the 2D6 fails against Ld 7.
    for (let seed = 0; seed < 80; seed++) {
      const { env, state } = commandState(seed);
      const next = advanceStep(state, env); // -> battleShock step
      expect(next.step).toBe('battleShock');
      const log = next.log.filter((l) => l.kind === 'battleShock');
      expect(log.length).toBeGreaterThan(0); // exactly the weak squad tests
      expect(log.some((l) => (l.data?.unitId as string) === 'strong')).toBe(false);
      if (next.units['weak']!.battleShocked) {
        expect(log.some((l) => l.message.includes('FAILED'))).toBe(true);
        return;
      }
    }
    throw new Error('no seed produced a failed battle-shock test in 80 tries');
  });

  it('opens the Insane Bravery window on failure; using it prevents the shock', () => {
    for (let seed = 0; seed < 80; seed++) {
      const { env, state } = commandState(seed, [insaneBravery]);
      const withCp: GameState = {
        ...state,
        players: [
          { ...state.players[0], cp: 2 },
          { ...state.players[1], cp: 2 },
        ],
      };
      const next = advanceStep(withCp, env);
      if (next.pendingDecision?.kind === 'stratagemWindow') {
        expect(next.pendingDecision.player).toBe(0);
        // Opponent cannot answer the window.
        bad(reduce(next, { type: 'useStratagem', player: 1, stratagemId: 'test.insane-bravery', targetUnitId: 'weak' }, env));
        const used = ok(
          reduce(
            next,
            { type: 'useStratagem', player: 0, stratagemId: 'test.insane-bravery', targetUnitId: 'weak' },
            env,
          ),
        );
        expect(used.units['weak']!.battleShocked).toBe(false);
        expect(used.players[0].cp).toBe(1);
        expect(used.players[0].stratagemsUsedThisPhase).toContain('test.insane-bravery');
        return;
      }
    }
    throw new Error('no seed opened the Insane Bravery window in 80 tries');
  });

  it('passing the window applies the shock; shock clears at own next command phase', () => {
    for (let seed = 0; seed < 80; seed++) {
      const { env, state } = commandState(seed, [insaneBravery]);
      const withCp: GameState = {
        ...state,
        players: [
          { ...state.players[0], cp: 2 },
          state.players[1],
        ],
      };
      const next = advanceStep(withCp, env);
      if (next.pendingDecision?.kind === 'stratagemWindow') {
        const passed = ok(reduce(next, { type: 'passWindow', player: 0 }, env));
        expect(passed.units['weak']!.battleShocked).toBe(true);
        // Entering this player's next command phase clears it.
        const laterTurn: GameState = {
          ...passed,
          phase: 'fight',
          step: 'remainingCombats',
          activePlayer: 1,
          pendingDecision: null,
          fight: { selector: null, activeUnitId: null, stage: 'select', fought: [] },
        };
        const backAround = advanceStep(laterTurn, env); // -> P0 command? No: P1 fight end -> round rolls
        // Whoever's command phase it is, only the ACTIVE player's units clear.
        if (backAround.activePlayer === 0) {
          expect(backAround.units['weak']!.battleShocked).toBe(false);
        } else {
          expect(backAround.units['weak']!.battleShocked).toBe(true);
        }
        return;
      }
    }
    throw new Error('no seed opened the window in 80 tries');
  });
});

// ---------------------------------------------------------------------------
// Charge phase
// ---------------------------------------------------------------------------

describe('charge phase', () => {
  function chargeState(seed = 5): { env: ReducerEnv; state: GameState } {
    const env = m3Env();
    const state = makeState({
      phase: 'charge',
      step: 'charge',
      round: 1,
      activePlayer: 0,
      rng: { seed, counter: 0 },
      units: {
        chargers: squad('chargers', 0, { x: 10, y: 10 }),
        victims: squad('victims', 1, { x: 16, y: 10 }),
        bystanders: squad('bystanders', 1, { x: 16, y: 14 }),
        far: squad('far', 1, { x: 50, y: 40 }),
      },
    });
    return { env, state };
  }

  it('validates declaration: range, prior moves, engagement', () => {
    const { env, state } = chargeState();
    bad(
      reduce(state, { type: 'declareCharge', player: 0, unitId: 'chargers', targetIds: ['far'] }, env),
      /more than 12/,
    );
    const advanced: GameState = {
      ...state,
      units: {
        ...state.units,
        chargers: {
          ...state.units['chargers']!,
          turnFlags: { ...state.units['chargers']!.turnFlags, moveKind: 'advance' },
        },
      },
    };
    bad(
      reduce(advanced, { type: 'declareCharge', player: 0, unitId: 'chargers', targetIds: ['victims'] }, env),
      /Advanced/,
    );
    bad(
      reduce(state, { type: 'declareCharge', player: 1, unitId: 'victims', targetIds: ['chargers'] }, env),
    );
  });

  it('rolls 2D6, then commit must reach every target and avoid non-targets', () => {
    const { env, state } = chargeState();
    const declared = ok(
      reduce(state, { type: 'declareCharge', player: 0, unitId: 'chargers', targetIds: ['victims'] }, env),
    );
    const roll = declared.charge!.roll!;
    expect(roll).toBeGreaterThanOrEqual(2);
    expect(roll).toBeLessThanOrEqual(12);
    expect(declared.units['chargers']!.turnFlags.chargeDeclared).toBe(true);

    // Not reaching the target is rejected.
    bad(
      reduce(
        declared,
        {
          type: 'commitCharge',
          player: 0,
          unitId: 'chargers',
          positions: declared.units['chargers']!.models.map((m, i) => ({
            modelId: m.id,
            x: 10 + i * 1.2,
            y: 10, // unmoved
          })),
        },
        env,
      ),
      /within Engagement Range of every declared target/,
    );

    // Moving into the bystanders (not a target) is rejected — put every
    // model adjacent to the bystander line so the failure is unambiguous.
    if (roll >= 5) {
      bad(
        reduce(
          declared,
          {
            type: 'commitCharge',
            player: 0,
            unitId: 'chargers',
            positions: declared.units['chargers']!.models.map((m, i) => ({
              modelId: m.id,
              x: 15 + i * 1.2,
              y: 13.4,
            })),
          },
          env,
        ),
      );
    }

    // A legal commit: models line up in front of the victims.
    if (roll >= 4) {
      const committed = ok(
        reduce(
          declared,
          {
            type: 'commitCharge',
            player: 0,
            unitId: 'chargers',
            positions: declared.units['chargers']!.models.map((m, i) => ({
              modelId: m.id,
              x: 14.4 + i * 1.2,
              y: 10,
            })),
          },
          env,
        ),
      );
      expect(committed.units['chargers']!.turnFlags.fightsFirst).toBe(true);
      expect(committed.units['chargers']!.turnFlags.moveKind).toBe('charge');
      expect(committed.charge).toBeNull();
    }
  });

  it('failCharge stands the unit down without moving', () => {
    const { env, state } = chargeState();
    const declared = ok(
      reduce(state, { type: 'declareCharge', player: 0, unitId: 'chargers', targetIds: ['victims'] }, env),
    );
    const failed = ok(reduce(declared, { type: 'failCharge', player: 0, unitId: 'chargers' }, env));
    expect(failed.charge).toBeNull();
    expect(failed.units['chargers']!.models[0]!.position).toEqual({ x: 10, y: 10 });
    expect(failed.units['chargers']!.turnFlags.fightsFirst).toBe(false);
    // Cannot try again this turn.
    bad(
      reduce(failed, { type: 'declareCharge', player: 0, unitId: 'chargers', targetIds: ['victims'] }, env),
      /already attempted/,
    );
  });
});

// ---------------------------------------------------------------------------
// Fight phase
// ---------------------------------------------------------------------------

describe('fight phase', () => {
  function meleeState(): { env: ReducerEnv; state: GameState } {
    const env = m3Env();
    // Two locked combats: A0 vs B0 (engaged), and A1 charged into B1.
    const a0 = squad('a0', 0, { x: 10, y: 10 });
    const b0 = squad('b0', 1, { x: 10, y: 11 });
    const a1 = squad('a1', 0, { x: 30, y: 10 }, {});
    a1.turnFlags = { ...a1.turnFlags, moveKind: 'charge', chargeRoll: 7, fightsFirst: true };
    const b1 = squad('b1', 1, { x: 30, y: 11 });
    const state = makeState({
      phase: 'fight',
      step: 'fightsFirst',
      round: 1,
      activePlayer: 0,
      rng: { seed: 21, counter: 0 },
      units: { a0, b0, a1, b1 },
      fight: { selector: null, activeUnitId: null, stage: 'select', fought: [] },
    });
    return { env, state };
  }

  it('fights-first step only offers charged units; reactive player selects first', () => {
    const { env, state } = meleeState();
    // Recompute the selector as step entry would.
    const entered = advanceStep({ ...state, phase: 'charge', step: 'charge', fight: null }, env);
    expect(entered.phase).toBe('fight');
    expect(entered.step).toBe('fightsFirst');
    // Only a1 (charged) is eligible in this step, and it belongs to the
    // ACTIVE player — the reactive player has no fights-first units, so
    // selection falls to player 0.
    expect(entered.fight?.selector).toBe(0);
    bad(reduce(entered, { type: 'selectFighter', player: 1, unitId: 'b0' }, env));
    bad(
      reduce(entered, { type: 'selectFighter', player: 0, unitId: 'a0' }, env),
      /not eligible/,
    );
    const selected = ok(reduce(entered, { type: 'selectFighter', player: 0, unitId: 'a1' }, env));
    expect(selected.fight?.activeUnitId).toBe('a1');
    expect(selected.fight?.stage).toBe('pileIn');
  });

  it('runs a full activation: pile in, melee through saves, consolidate', () => {
    const { env, state } = meleeState();
    const entered = advanceStep({ ...state, phase: 'charge', step: 'charge', fight: null }, env);
    let s = ok(reduce(entered, { type: 'selectFighter', player: 0, unitId: 'a1' }, env));

    // Pile-in over 3" is rejected; moving away from the enemy is rejected.
    const models = s.units['a1']!.models;
    bad(
      reduce(
        s,
        {
          type: 'pileIn',
          player: 0,
          unitId: 'a1',
          positions: models.map((m) => ({ modelId: m.id, x: m.position!.x + 5, y: m.position!.y })),
        },
        env,
      ),
      /at most 3/,
    );
    bad(
      reduce(
        s,
        {
          type: 'pileIn',
          player: 0,
          unitId: 'a1',
          positions: models.map((m) => ({ modelId: m.id, x: m.position!.x, y: m.position!.y - 2 })),
        },
        env,
      ),
      /closer to the closest enemy/,
    );
    s = ok(
      reduce(
        s,
        {
          type: 'pileIn',
          player: 0,
          unitId: 'a1',
          positions: models.map((m) => ({ modelId: m.id, x: m.position!.x, y: m.position!.y })),
        },
        env,
      ),
    );
    expect(s.fight?.stage).toBe('attacks');

    // Melee attacks resolve through the shared sequence with WS.
    s = ok(
      reduce(
        s,
        {
          type: 'declareMelee',
          player: 0,
          unitId: 'a1',
          assignments: [{ weaponId: 'knife', targetUnitId: 'b1' }],
        },
        env,
      ),
    );
    // 4 models × 2 attacks on 3+ — a save decision for player 1 is all but
    // guaranteed; if the volley whiffed entirely, the stage moved on.
    if (s.pendingDecision) {
      expect(s.pendingDecision.kind).toBe('saves');
      expect(s.pendingDecision.player).toBe(1);
      s = ok(reduce(s, { type: 'resolveSaves', player: 1 }, env));
    }
    expect(s.fight?.stage).toBe('consolidate');

    s = ok(
      reduce(
        s,
        {
          type: 'consolidate',
          player: 0,
          unitId: 'a1',
          positions: s.units['a1']!.models
            .filter((m) => !m.destroyed)
            .map((m) => ({ modelId: m.id, x: m.position!.x, y: m.position!.y })),
        },
        env,
      ),
    );
    expect(s.units['a1']!.turnFlags.hasFought).toBe(true);
    expect(s.fight?.fought).toContain('a1');
    // Fights-first step: nobody else has fights-first, so selection ends.
    expect(s.fight?.selector).toBeNull();

    // Advance to remaining combats: reactive player selects first now.
    s = ok(reduce(s, { type: 'advanceStep', player: 0 }, env));
    expect(s.step).toBe('remainingCombats');
    expect(s.fight?.selector).toBe(1);
    // …and the fought list carries over (a1 cannot fight twice).
    bad(reduce({ ...s, fight: { ...s.fight!, selector: 0 } }, { type: 'selectFighter', player: 0, unitId: 'a1' }, env));
  });

  it('blocks advancing the step while fighters remain', () => {
    const { env, state } = meleeState();
    const entered = advanceStep({ ...state, phase: 'charge', step: 'charge', fight: null }, env);
    bad(reduce(entered, { type: 'advanceStep', player: 0 }, env), /select a unit to fight/);
  });
});

// ---------------------------------------------------------------------------
// Fire Overwatch through the window protocol
// ---------------------------------------------------------------------------

describe('fire overwatch window', () => {
  function moveState(): { env: ReducerEnv; state: GameState } {
    const env = m3Env([overwatch]);
    const state = makeState({
      phase: 'movement',
      step: 'moveUnits',
      round: 1,
      activePlayer: 0,
      rng: { seed: 9, counter: 0 },
      units: {
        movers: squad('movers', 0, { x: 10, y: 10 }),
        watchers: squad('watchers', 1, { x: 10, y: 30 }),
      },
      players: undefined as never, // replaced below
    });
    const withCp: GameState = {
      ...state,
      players: [
        { ...makeState().players[0], cp: 1 },
        { ...makeState().players[1], cp: 1 },
      ],
    };
    return { env, state: withCp };
  }

  it('opens for the reactive player after a move; the script fires the guns', () => {
    const { env, state } = moveState();
    let s = ok(reduce(state, { type: 'startMove', player: 0, unitId: 'movers', kind: 'normal' }, env));
    s = ok(
      reduce(
        s,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'movers',
          positions: s.units['movers']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 5,
          })),
        },
        env,
      ),
    );
    expect(s.pendingDecision?.kind).toBe('stratagemWindow');
    expect(s.pendingDecision?.player).toBe(1);

    const used = ok(
      reduce(
        s,
        { type: 'useStratagem', player: 1, stratagemId: 'test.overwatch', targetUnitId: 'watchers' },
        env,
      ),
    );
    expect(used.players[1].cp).toBe(0);
    // Overwatch resolves through the shared sequence; only 6s hit. Either
    // the mover is now rolling saves, or the volley missed and finished.
    if (used.pendingDecision) {
      expect(used.pendingDecision.kind).toBe('saves');
      expect(used.pendingDecision.player).toBe(0);
      const done = ok(reduce(used, { type: 'resolveSaves', player: 0 }, env));
      expect(done.shooting).toBeNull();
      expect(done.units['watchers']!.turnFlags.hasShot).toBe(false); // out of phase
    } else {
      expect(used.shooting).toBeNull();
      expect(used.units['watchers']!.turnFlags.hasShot).toBe(false);
    }
  });

  it('pass with dont-ask-again suppresses further windows this phase', () => {
    const { env, state } = moveState();
    const twoUnits: GameState = {
      ...state,
      units: {
        ...state.units,
        movers2: squad('movers2', 0, { x: 20, y: 10 }),
      },
    };
    let s = ok(reduce(twoUnits, { type: 'startMove', player: 0, unitId: 'movers', kind: 'normal' }, env));
    s = ok(
      reduce(
        s,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'movers',
          positions: s.units['movers']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 2,
          })),
        },
        env,
      ),
    );
    expect(s.pendingDecision?.kind).toBe('stratagemWindow');
    s = ok(reduce(s, { type: 'passWindow', player: 1, dontAskAgainThisPhase: true }, env));
    expect(s.pendingDecision).toBeNull();

    // The second unit's move does not prompt again.
    s = ok(reduce(s, { type: 'startMove', player: 0, unitId: 'movers2', kind: 'normal' }, env));
    s = ok(
      reduce(
        s,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'movers2',
          positions: s.units['movers2']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 2,
          })),
        },
        env,
      ),
    );
    expect(s.pendingDecision).toBeNull();
  });

  it('a window with zero eligible options is skipped silently', () => {
    const { env, state } = moveState();
    const broke: GameState = {
      ...state,
      players: [state.players[0], { ...state.players[1], cp: 0 }],
    };
    let s = ok(reduce(broke, { type: 'startMove', player: 0, unitId: 'movers', kind: 'normal' }, env));
    s = ok(
      reduce(
        s,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'movers',
          positions: s.units['movers']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 2,
          })),
        },
        env,
      ),
    );
    expect(s.pendingDecision).toBeNull();
    expect((s.windowQueue ?? []).length).toBe(0);
  });
});
