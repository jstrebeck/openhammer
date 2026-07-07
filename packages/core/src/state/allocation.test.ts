import { describe, expect, it } from 'vitest';
import type { Datasheet } from '../types/content.js';
import type { GameState, UnitState } from '../types/state.js';
import { reduce } from './reducer.js';
import { makeEnv, makeState, makeUnit } from '../test-helpers.js';
import type { ReducerEnv } from './env.js';

// ---------------------------------------------------------------------------
// Fixtures: a heavy volley against a tough squad with an invulnerable save
// ---------------------------------------------------------------------------

const guardSheet: Datasheet = {
  id: 'test/guards',
  name: 'Guards',
  factionId: 'test',
  keywords: ['Infantry'],
  factionKeywords: ['Test'],
  models: [
    {
      id: 'default',
      name: 'Guard',
      move: 6,
      toughness: 3,
      save: 3,
      invulnerableSave: 5,
      wounds: 2,
      leadership: 7,
      objectiveControl: 2,
      baseSizeMm: 28,
      heightInches: 1.2,
    },
  ],
  unitComposition: { sizes: [{ models: 4, points: 60 }] },
  rangedWeapons: [],
  meleeWeapons: [],
  coreAbilities: [],
  abilities: [],
};

function env(): ReducerEnv {
  return makeEnv({ datasheets: { 'test/guards': guardSheet } });
}

function squad(id: string, owner: 0 | 1, at: { x: number; y: number }): UnitState {
  return makeUnit({
    id,
    owner,
    datasheetId: 'test/guards',
    name: id,
    startingStrength: 4,
    models: Array.from({ length: 4 }, (_, i) => ({
      id: `${id}-m${i}`,
      profileId: 'default',
      position: { x: at.x + i * 1.2, y: at.y },
      woundsRemaining: 2,
      destroyed: false,
      hasTakenWoundsThisPhase: false,
    })),
    loadout: Object.fromEntries(
      Array.from({ length: 4 }, (_, i) => [`${id}-m${i}`, ['gun']]),
    ),
    weapons: {
      gun: {
        id: 'gun',
        name: 'Gun',
        kind: 'ranged',
        range: 24,
        attacks: '3',
        skill: 2,
        strength: 8,
        ap: 0, // armour 3+ stays better than the 5++ — the choice matters
        damage: '1',
        abilities: [],
      },
    },
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

/** Find a seed whose volley leaves at least `minWounds` pending saves. */
function volleyState(minWounds: number): GameState {
  const e = env();
  for (let seed = 1; seed < 120; seed++) {
    const base = makeState({
      phase: 'shooting',
      step: 'shoot',
      activePlayer: 0,
      rng: { seed, counter: 0 },
      units: {
        shooters: squad('shooters', 0, { x: 10, y: 10 }),
        guards: squad('guards', 1, { x: 20, y: 10 }),
      },
    });
    const result = reduce(
      base,
      {
        type: 'declareShoot',
        player: 0,
        unitId: 'shooters',
        assignments: [{ weaponId: 'gun', targetUnitId: 'guards' }],
      },
      e,
    );
    if (
      result.ok &&
      result.state.pendingDecision?.kind === 'saves' &&
      (result.state.pendingDecision.context.wounds as number) >= minWounds
    ) {
      return result.state;
    }
  }
  throw new Error(`no seed produced ${minWounds}+ pending wounds in 120 tries`);
}

describe('per-wound allocation', () => {
  it('resolves one wound at a time, keeping the decision open with updated counts', () => {
    const e = env();
    const state = volleyState(3);
    const before = state.pendingDecision!.context.wounds as number;

    const next = ok(
      reduce(state, { type: 'allocateWound', player: 1, modelId: 'guards-m2' }, e),
    );
    expect(next.pendingDecision?.kind).toBe('saves');
    expect(next.pendingDecision?.context.wounds).toBe(before - 1);
    expect(next.shooting?.current?.woundsPending).toBe(before - 1);
    // A per-wound log entry was written.
    expect(next.log.some((l) => l.kind === 'saves' && /left to allocate/.test(l.message))).toBe(
      true,
    );
  });

  it('enforces the wounded-model-first rule on subsequent allocations', () => {
    const e = env();
    // Walk one deterministic game: keep allocating to m2 until a save
    // fails while wounds are still pending, then assert the rule.
    let state = volleyState(4);
    let guard = 0;
    while (state.pendingDecision?.kind === 'saves' && guard++ < 20) {
      state = ok(reduce(state, { type: 'allocateWound', player: 1, modelId: 'guards-m2' }, e));
      const m2 = state.units['guards']!.models.find((m) => m.id === 'guards-m2')!;
      const pending = (state.shooting?.current?.woundsPending ?? 0) > 0;
      if (m2.hasTakenWoundsThisPhase && !m2.destroyed && pending) {
        // A different, unwounded model is illegal now.
        bad(
          reduce(state, { type: 'allocateWound', player: 1, modelId: 'guards-m0' }, e),
          /already-wounded model first/,
        );
        // The wounded model is legal.
        const again = ok(
          reduce(state, { type: 'allocateWound', player: 1, modelId: 'guards-m2' }, e),
        );
        expect(again.pendingDecision === null || again.pendingDecision.kind === 'saves').toBe(
          true,
        );
        return;
      }
      if (m2.destroyed) break; // rare with W2/D1 but possible
    }
    throw new Error('the volley never left m2 wounded with saves still pending');
  });

  it('honors an explicit (worse) invulnerable-save choice', () => {
    const e = env();
    const state = volleyState(2);
    const next = ok(
      reduce(
        state,
        { type: 'allocateWound', player: 1, modelId: 'guards-m0', useInvulnerable: true },
        e,
      ),
    );
    // Armour is 3+, invuln 5+ — the log must show the 5+ invuln was used.
    const line = next.log.filter((l) => l.kind === 'saves').at(-1)!;
    expect(line.message).toContain('vs 5+');
    expect(line.message).toContain('(invuln)');
  });

  it('mixes manual allocation with auto-resolve for the remainder', () => {
    const e = env();
    const state = volleyState(3);
    const one = ok(reduce(state, { type: 'allocateWound', player: 1, modelId: 'guards-m1' }, e));
    expect(one.pendingDecision).not.toBeNull();
    const done = ok(reduce(one, { type: 'resolveSaves', player: 1 }, e));
    expect(done.pendingDecision).toBeNull();
    expect(done.shooting).toBeNull();
    expect(done.units['shooters']!.turnFlags.hasShot).toBe(true);
  });

  it('completing the last wound manually finishes the batch', () => {
    const e = env();
    let state = volleyState(2);
    let guard = 0;
    while (state.pendingDecision?.kind === 'saves' && guard++ < 20) {
      const pool = state.units['guards']!.models;
      const wounded = pool.find((m) => !m.destroyed && m.hasTakenWoundsThisPhase);
      const pick = wounded ?? pool.find((m) => !m.destroyed)!;
      state = ok(reduce(state, { type: 'allocateWound', player: 1, modelId: pick.id }, e));
    }
    expect(state.pendingDecision).toBeNull();
    expect(state.shooting).toBeNull();
    expect(state.units['shooters']!.turnFlags.hasShot).toBe(true);
  });

  it('rejects the attacker and dead/foreign models', () => {
    const e = env();
    const state = volleyState(2);
    const wrongPlayer = reduce(
      state,
      { type: 'allocateWound', player: 0, modelId: 'guards-m0' },
      e,
    );
    expect(!wrongPlayer.ok && wrongPlayer.code).toBe('OUT_OF_TURN');
    bad(reduce(state, { type: 'allocateWound', player: 1, modelId: 'shooters-m0' }, e));
    bad(reduce(state, { type: 'allocateWound', player: 1, modelId: 'nonsense' }, e));
  });
});
