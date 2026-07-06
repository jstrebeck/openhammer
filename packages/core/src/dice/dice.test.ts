import { describe, expect, it } from 'vitest';
import {
  evalDiceExpression,
  parseDiceExpression,
  rollD3,
  rollD6,
  roll2D6,
} from './index.js';

describe('rollD6', () => {
  it('is deterministic for the same seed and counter', () => {
    const a = rollD6({ seed: 42, counter: 0 }, 10);
    const b = rollD6({ seed: 42, counter: 0 }, 10);
    expect(a.rolls).toEqual(b.rolls);
  });

  it('advances the counter so sequential draws differ from a fresh start', () => {
    const first = rollD6({ seed: 7, counter: 0 }, 5);
    const second = rollD6(first.rng, 5);
    expect(second.rng.counter).toBe(10);
    // Drawing 10 at once must equal the two sequential batches concatenated.
    const all = rollD6({ seed: 7, counter: 0 }, 10);
    expect(all.rolls).toEqual([...first.rolls, ...second.rolls]);
  });

  it('produces values in 1..6 only', () => {
    const { rolls } = rollD6({ seed: 1, counter: 0 }, 1000);
    expect(rolls.every((r) => r >= 1 && r <= 6)).toBe(true);
    // Sanity: all faces appear over 1000 rolls.
    for (let face = 1; face <= 6; face++) expect(rolls).toContain(face);
  });
});

describe('rollD3', () => {
  it('halves a d6 rounding up', () => {
    const d6 = rollD6({ seed: 99, counter: 0 }, 50);
    const d3 = rollD3({ seed: 99, counter: 0 }, 50);
    expect(d3.rolls).toEqual(d6.rolls.map((r) => Math.ceil(r / 2)));
    expect(d3.rolls.every((r) => r >= 1 && r <= 3)).toBe(true);
  });
});

describe('roll2D6', () => {
  it('sums two dice', () => {
    const { total, rolls } = roll2D6({ seed: 3, counter: 0 });
    expect(rolls).toHaveLength(2);
    expect(total).toBe((rolls[0] ?? 0) + (rolls[1] ?? 0));
  });
});

describe('parseDiceExpression', () => {
  it.each([
    ['D6', { count: 1, sides: 6, flat: 0 }],
    ['2D6', { count: 2, sides: 6, flat: 0 }],
    ['D3', { count: 1, sides: 3, flat: 0 }],
    ['D6+1', { count: 1, sides: 6, flat: 1 }],
    ['2D6+3', { count: 2, sides: 6, flat: 3 }],
    ['D3+1', { count: 1, sides: 3, flat: 1 }],
    ['4', { count: 0, sides: 0, flat: 4 }],
    ['d6', { count: 1, sides: 6, flat: 0 }],
  ])('parses %s', (expr, expected) => {
    expect(parseDiceExpression(expr)).toEqual(expected);
  });

  it('accepts numbers directly', () => {
    expect(parseDiceExpression(3)).toEqual({ count: 0, sides: 0, flat: 3 });
  });

  it('rejects garbage', () => {
    expect(() => parseDiceExpression('banana')).toThrow();
    expect(() => parseDiceExpression('D8')).toThrow();
  });
});

describe('evalDiceExpression', () => {
  it('returns flat values without consuming rng', () => {
    const rng = { seed: 5, counter: 0 };
    const r = evalDiceExpression('3', rng);
    expect(r.total).toBe(3);
    expect(r.rng.counter).toBe(0);
  });

  it('applies the flat bonus to rolled dice', () => {
    const r = evalDiceExpression('2D6+3', { seed: 11, counter: 0 });
    expect(r.rolls).toHaveLength(2);
    expect(r.total).toBe((r.rolls[0] ?? 0) + (r.rolls[1] ?? 0) + 3);
  });
});
