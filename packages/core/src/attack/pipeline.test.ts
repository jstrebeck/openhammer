import { describe, expect, it } from 'vitest';
import { newAttackComputation, type AttackComputation } from '../effects/engine.js';
import { testParams } from '../test-helpers.js';
import {
  computeAttacks,
  rollDamage,
  rollFeelNoPain,
  rollHits,
  rollSave,
  rollWounds,
} from './pipeline.js';

const rng0 = { seed: 1234, counter: 0 };

function comp(overrides: Partial<AttackComputation> = {}): AttackComputation {
  return {
    ...newAttackComputation({
      attacksExpr: '1',
      hitSkill: 4,
      strength: 4,
      toughness: 4,
      ap: 0,
      damageExpr: '1',
      params: testParams,
    }),
    ...overrides,
  };
}

describe('computeAttacks', () => {
  it('sums flat attacks across firing models', () => {
    const r = computeAttacks(comp({ attacksExpr: '2' }), 5, 10, rng0);
    expect(r.total).toBe(10);
    expect(r.rng.counter).toBe(0); // flat: no dice consumed
  });

  it('rolls random attacks per firing model', () => {
    const r = computeAttacks(comp({ attacksExpr: 'D6' }), 3, 1, rng0);
    expect(r.perModelRolls).toHaveLength(3);
    expect(r.rng.counter).toBe(3);
    expect(r.total).toBe(r.perModelRolls.reduce((a, m) => a + m.total, 0));
  });

  it('applies blast scaling per 5 models in the target', () => {
    const c = comp({ attacksExpr: '2', attacksPerTargetModels: [{ per: 5, value: 1 }] });
    const r = computeAttacks(c, 2, 11, rng0);
    // 2 models × 2 attacks + floor(11/5)=2 blast bonus per model × 2 models
    expect(r.blastBonus).toBe(4);
    expect(r.total).toBe(8);
  });

  it('applies rapid-fire style flat bonus per model', () => {
    const c = comp({ attacksExpr: '1', attacksFlatBonus: 1 });
    const r = computeAttacks(c, 10, 1, rng0);
    expect(r.total).toBe(20);
  });
});

describe('rollHits', () => {
  it('torrent auto-hits without consuming dice', () => {
    const r = rollHits(comp({ autoHit: true }), 7, testParams, rng0);
    expect(r.hits).toBe(7);
    expect(r.rng.counter).toBe(0);
    expect(r.dice).toHaveLength(0);
  });

  it('applies the ±1 net cap to stacked modifiers', () => {
    const c = comp({ hitModifiers: [1, 1, 1] });
    const r = rollHits(c, 100, testParams, rng0);
    expect(r.netModifier).toBe(1);
  });

  it('unmodified 1 always misses even with +1', () => {
    const c = comp({ hitSkill: 2, hitModifiers: [1] });
    const r = rollHits(c, 200, testParams, rng0);
    const ones = r.dice.filter((d) => d.final === 1);
    expect(ones.length).toBeGreaterThan(0);
    expect(ones.every((d) => !d.success)).toBe(true);
  });

  it('unmodified 6 always hits even with -1 against an impossible skill', () => {
    const c = comp({ hitSkill: 6, hitModifiers: [-1] });
    const r = rollHits(c, 200, testParams, rng0);
    const sixes = r.dice.filter((d) => d.final === 6);
    expect(sixes.length).toBeGreaterThan(0);
    expect(sixes.every((d) => d.success && d.critical)).toBe(true);
    // 5s with -1 vs 6+ fail
    const fives = r.dice.filter((d) => d.final === 5);
    expect(fives.every((d) => !d.success)).toBe(true);
  });

  it('sustained hits add extra hits per critical', () => {
    const c = comp({ sustainedHits: 2 });
    const r = rollHits(c, 300, testParams, rng0);
    const crits = r.dice.filter((d) => d.critical).length;
    expect(r.sustainedExtra).toBe(crits * 2);
    const ordinarySuccesses = r.dice.filter((d) => d.success).length;
    expect(r.hits).toBe(ordinarySuccesses + r.sustainedExtra);
  });

  it('lethal hits divert criticals to auto-wounds', () => {
    const c = comp({ lethalHits: true });
    const r = rollHits(c, 300, testParams, rng0);
    const crits = r.dice.filter((d) => d.critical).length;
    expect(r.autoWounds).toBe(crits);
    expect(r.hits).toBe(r.dice.filter((d) => d.success).length - crits);
  });

  it('lowered crit threshold makes 5s critical', () => {
    const c = comp({ critHitOn: 5 });
    const r = rollHits(c, 300, testParams, rng0);
    const fivesAndSixes = r.dice.filter((d) => d.final >= 5);
    expect(fivesAndSixes.every((d) => d.critical)).toBe(true);
  });

  it('reroll ones rerolls exactly the 1s once', () => {
    const c = comp({ rerollHit: 'ones' });
    const r = rollHits(c, 300, testParams, rng0);
    expect(r.dice.filter((d) => d.rerolled).every((d) => d.initial === 1)).toBe(true);
    expect(r.dice.filter((d) => d.initial === 1 && !d.rerolled)).toHaveLength(0);
  });

  it('reroll failed rerolls failures and keeps successes', () => {
    const c = comp({ hitSkill: 4, rerollHit: 'failed' });
    const r = rollHits(c, 300, testParams, rng0);
    for (const d of r.dice) {
      if (d.rerolled) expect(d.initial).toBeLessThan(4);
      else expect(d.initial).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('rollWounds', () => {
  it('auto-wounds bypass the wound roll', () => {
    const r = rollWounds(comp(), 0, 5, testParams, rng0);
    expect(r.wounds).toBe(5);
    expect(r.rng.counter).toBe(0);
  });

  it('uses the S vs T threshold', () => {
    const c = comp({ strength: 8, toughness: 4 });
    const r = rollWounds(c, 100, 0, testParams, rng0);
    expect(r.threshold).toBe(2);
  });

  it('devastating wounds convert criticals to mortals', () => {
    const c = comp({ devastatingWounds: true });
    const r = rollWounds(c, 300, 0, testParams, rng0);
    const crits = r.dice.filter((d) => d.critical).length;
    expect(r.devastatingWounds).toBe(crits);
    expect(r.wounds).toBe(r.dice.filter((d) => d.success).length - crits);
  });

  it('anti-x style lowered crit wound threshold', () => {
    const c = comp({ critWoundOn: 4, strength: 2, toughness: 10 });
    const r = rollWounds(c, 300, 0, testParams, rng0);
    // S2 vs T10 needs 6s, but crit-on-4 means any 4+ succeeds as critical.
    const fourPlus = r.dice.filter((d) => d.final >= 4);
    expect(fourPlus.every((d) => d.success && d.critical)).toBe(true);
  });
});

describe('rollSave', () => {
  it('applies AP to the armour save', () => {
    const c = comp({ ap: -2 });
    const r = rollSave(c, 3, null, testParams, rng0);
    expect(r.needed).toBe(5);
    expect(r.usedInvulnerable).toBe(false);
  });

  it('prefers the invulnerable save when AP makes it better', () => {
    const c = comp({ ap: -4 });
    const r = rollSave(c, 3, 4, testParams, rng0);
    expect(r.usedInvulnerable).toBe(true);
    expect(r.needed).toBe(4);
  });

  it('cover improves the save by 1 against AP', () => {
    const c = comp({ ap: -1, cover: true });
    const r = rollSave(c, 4, null, testParams, rng0);
    expect(r.coverApplied).toBe(true);
    expect(r.needed).toBe(4); // 4 +1(ap) -1(cover)
  });

  it('cover does not apply to 3+ saves against AP 0', () => {
    const c = comp({ ap: 0, cover: true });
    const r = rollSave(c, 3, null, testParams, rng0);
    expect(r.coverApplied).toBe(false);
    expect(r.needed).toBe(3);
  });

  it('ignores cover removes the benefit', () => {
    const c = comp({ ap: -1, cover: true, ignoresCover: true });
    const r = rollSave(c, 4, null, testParams, rng0);
    expect(r.coverApplied).toBe(false);
    expect(r.needed).toBe(5);
  });

  it('save improvement is capped at +1 even with cover plus other bonuses', () => {
    const c = comp({ ap: -1, cover: true, saveModifiers: [1] });
    const r = rollSave(c, 4, null, testParams, rng0);
    expect(r.needed).toBe(4); // 4 +1(ap) -1(capped improvement)
  });

  it('a roll of 1 always fails', () => {
    // Find a seed that yields a 1 and assert failure even on a 2+ save.
    for (let seed = 0; seed < 50; seed++) {
      const r = rollSave(comp(), 2, null, testParams, { seed, counter: 0 });
      if (r.die === 1) {
        expect(r.saved).toBe(false);
        return;
      }
    }
    throw new Error('no seed produced a 1 in 50 tries');
  });
});

describe('rollDamage / rollFeelNoPain', () => {
  it('adds damage bonus and respects minimum damage', () => {
    const c = comp({ damageExpr: '1', damageBonus: 2 });
    expect(rollDamage(c, rng0).amount).toBe(3);
    const m = comp({ damageExpr: '1', minimumDamage: 3 });
    expect(rollDamage(m, rng0).amount).toBe(3);
  });

  it('feel no pain prevents on threshold and reports taken damage', () => {
    const r = rollFeelNoPain(5, 6, rng0);
    expect(r.rolls).toHaveLength(6);
    expect(r.prevented).toBe(r.rolls.filter((d) => d >= 5).length);
    expect(r.taken).toBe(6 - r.prevented);
  });
});
