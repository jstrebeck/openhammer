import { describe, expect, it } from 'vitest';
import type { EffectDef } from '../types/content.js';
import type { ActiveEffect } from '../types/state.js';
import {
  cappedModifier,
  fireAttackHook,
  mergeReroll,
  newAttackComputation,
  orderCandidates,
  sweepExpiredEffects,
  woundThreshold,
} from './engine.js';
import type { EffectCandidate, HookContext } from './context.js';
import { testParams, makeContext } from '../test-helpers.js';

function def(partial: Partial<EffectDef> & Pick<EffectDef, 'id' | 'trigger' | 'effects'>): EffectDef {
  return { ...partial };
}

function cand(
  d: EffectDef,
  opts: Partial<Omit<EffectCandidate, 'def'>> = {},
): EffectCandidate {
  return { def: d, player: 0, declOrder: 0, sourceId: d.id, ...opts };
}

describe('woundThreshold', () => {
  it.each([
    [8, 4, 2], // S >= 2T
    [8, 5, 3], // S > T
    [4, 4, 4], // S == T
    [4, 5, 5], // S < T
    [3, 6, 6], // S <= T/2
    [3, 7, 6],
  ])('S%i vs T%i needs %i+', (s, t, expected) => {
    expect(woundThreshold(s, t)).toBe(expected);
  });
});

describe('cappedModifier', () => {
  it('clamps the net sum to ±cap', () => {
    expect(cappedModifier([1, 1, 1], 1)).toBe(1);
    expect(cappedModifier([-1, -1], 1)).toBe(-1);
    expect(cappedModifier([1, -1], 1)).toBe(0);
    expect(cappedModifier([], 1)).toBe(0);
    expect(cappedModifier([2, -1], 1)).toBe(1);
  });
});

describe('mergeReroll', () => {
  it('keeps the most permissive mode', () => {
    expect(mergeReroll('none', 'ones')).toBe('ones');
    expect(mergeReroll('failed', 'ones')).toBe('failed');
    expect(mergeReroll('any', 'failed')).toBe('any');
  });
});

describe('orderCandidates', () => {
  it('puts set-value effects before modifiers, active player first, then declaration order', () => {
    const setCrit = def({ id: 'set', trigger: 'attack.beforeHitRoll', effects: [{ type: 'setCriticalHitOn', value: 5 }] });
    const plusOneP1 = def({ id: 'mod-p1', trigger: 'attack.beforeHitRoll', effects: [{ type: 'modifyRoll', roll: 'hit', value: 1 }] });
    const plusOneP0a = def({ id: 'mod-p0a', trigger: 'attack.beforeHitRoll', effects: [{ type: 'modifyRoll', roll: 'hit', value: 1 }] });
    const plusOneP0b = def({ id: 'mod-p0b', trigger: 'attack.beforeHitRoll', effects: [{ type: 'modifyRoll', roll: 'hit', value: -1 }] });
    const ordered = orderCandidates(
      [
        cand(plusOneP1, { player: 1, declOrder: 0 }),
        cand(plusOneP0b, { player: 0, declOrder: 5 }),
        cand(setCrit, { player: 1, declOrder: 9 }),
        cand(plusOneP0a, { player: 0, declOrder: 2 }),
      ],
      0,
    );
    expect(ordered.map((c) => c.def.id)).toEqual(['set', 'mod-p0a', 'mod-p0b', 'mod-p1']);
  });

  it('is deterministic regardless of input order', () => {
    const a = def({ id: 'a', trigger: 'attack.beforeHitRoll', effects: [{ type: 'modifyRoll', roll: 'hit', value: 1 }] });
    const b = def({ id: 'b', trigger: 'attack.beforeHitRoll', effects: [{ type: 'modifyRoll', roll: 'hit', value: 1 }] });
    const fwd = orderCandidates([cand(a, { declOrder: 1 }), cand(b, { declOrder: 2 })], 0);
    const rev = orderCandidates([cand(b, { declOrder: 2 }), cand(a, { declOrder: 1 })], 0);
    expect(fwd.map((c) => c.def.id)).toEqual(rev.map((c) => c.def.id));
  });
});

describe('fireAttackHook', () => {
  const baseComp = () =>
    newAttackComputation({
      attacksExpr: '1',
      hitSkill: 4,
      strength: 4,
      toughness: 4,
      ap: 0,
      damageExpr: '1',
      params: testParams,
    });

  it('only applies effects whose trigger matches the hook', () => {
    const ctx = makeContext();
    const comp = baseComp();
    const wrongHook = def({ id: 'x', trigger: 'attack.beforeWoundRoll', effects: [{ type: 'modifyRoll', roll: 'wound', value: 1 }] });
    const rightHook = def({ id: 'y', trigger: 'attack.beforeHitRoll', effects: [{ type: 'modifyRoll', roll: 'hit', value: 1 }] });
    const fired = fireAttackHook('attack.beforeHitRoll', [cand(wrongHook), cand(rightHook)], ctx, comp);
    expect(fired.map((f) => f.effectId)).toEqual(['y']);
    expect(comp.hitModifiers).toEqual([1]);
    expect(comp.woundModifiers).toEqual([]);
  });

  it('skips effects whose condition fails', () => {
    const ctx = makeContext(); // no weapon in context
    const comp = baseComp();
    const gated = def({
      id: 'melta',
      trigger: 'attack.beforeHitRoll',
      condition: { targetWithinHalfRange: true },
      effects: [{ type: 'addDamage', value: 2 }],
    });
    const fired = fireAttackHook('attack.beforeHitRoll', [cand(gated)], ctx, comp);
    expect(fired).toHaveLength(0);
    expect(comp.damageBonus).toBe(0);
  });

  it('applies attack-sequence switches (torrent, lethal, sustained, devastating)', () => {
    const ctx = makeContext();
    const comp = baseComp();
    const candidates = [
      cand(def({ id: 't', trigger: 'attack.beforeHitRoll', effects: [{ type: 'autoHit' }] })),
      cand(def({ id: 'l', trigger: 'attack.beforeHitRoll', effects: [{ type: 'criticalHitsAutoWound' }] })),
      cand(def({ id: 's', trigger: 'attack.beforeHitRoll', effects: [{ type: 'extraHitsOnCritical', value: 2 }] })),
      cand(def({ id: 'd', trigger: 'attack.beforeHitRoll', effects: [{ type: 'criticalWoundsBecomeMortal' }] })),
    ];
    fireAttackHook('attack.beforeHitRoll', candidates, ctx, comp);
    expect(comp.autoHit).toBe(true);
    expect(comp.lethalHits).toBe(true);
    expect(comp.sustainedHits).toBe(2);
    expect(comp.devastatingWounds).toBe(true);
  });

  it('keeps the best invulnerable save when several apply', () => {
    const ctx = makeContext();
    const comp = baseComp();
    fireAttackHook(
      'attack.beforeSaveRoll',
      [
        cand(def({ id: 'i5', trigger: 'attack.beforeSaveRoll', effects: [{ type: 'setInvulnerableSave', value: 5 }] })),
        cand(def({ id: 'i4', trigger: 'attack.beforeSaveRoll', effects: [{ type: 'setInvulnerableSave', value: 4 }] })),
      ],
      ctx,
      comp,
    );
    expect(comp.invulnerableSave).toBe(4);
  });
});

describe('sweepExpiredEffects', () => {
  const active = (id: string, duration: ActiveEffect['duration']): ActiveEffect => ({
    instanceId: id,
    def: { id, trigger: 'attack.beforeHitRoll', effects: [] },
    source: { kind: 'test', id, player: 0 },
    boundUnits: [],
    duration,
    activatedAt: { round: 1, turn: 0, phase: 'shooting' },
  });

  it('expires phase effects at phase end but keeps longer durations', () => {
    const effects = [active('p', 'phase'), active('t', 'turn'), active('r', 'round'), active('b', 'battle')];
    expect(sweepExpiredEffects(effects, 'phase').map((e) => e.instanceId)).toEqual(['t', 'r', 'b']);
    expect(sweepExpiredEffects(effects, 'turn').map((e) => e.instanceId)).toEqual(['r', 'b']);
    expect(sweepExpiredEffects(effects, 'round').map((e) => e.instanceId)).toEqual(['b']);
    expect(sweepExpiredEffects(effects, 'battle')).toEqual([]);
  });
});
