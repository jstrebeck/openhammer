import { describe, it, expect } from 'vitest';
import { rollDice, countSuccesses, countFailures, sumDice } from '../index';

describe('rollDice', () => {
  it('rolls the correct number of dice', () => {
    const roll = rollDice(5, 6, 'test');
    expect(roll.dice).toHaveLength(5);
    expect(roll.sides).toBe(6);
    expect(roll.purpose).toBe('test');
  });

  it('all dice are within range [1, sides]', () => {
    const roll = rollDice(100, 6, 'test');
    for (const d of roll.dice) {
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);
    }
  });

  it('stores threshold when provided', () => {
    const roll = rollDice(3, 6, 'To Hit', 3);
    expect(roll.threshold).toBe(3);
  });
});

describe('countSuccesses', () => {
  it('counts dice meeting threshold', () => {
    const roll = {
      id: 'test',
      dice: [1, 2, 3, 4, 5, 6],
      sides: 6,
      threshold: 4,
      purpose: 'test',
      timestamp: 0,
    };
    expect(countSuccesses(roll)).toBe(3); // 4, 5, 6
  });

  it('returns all dice when no threshold', () => {
    const roll = {
      id: 'test',
      dice: [1, 2, 3],
      sides: 6,
      purpose: 'test',
      timestamp: 0,
    };
    expect(countSuccesses(roll)).toBe(3);
  });
});

describe('countFailures', () => {
  it('counts dice below threshold', () => {
    const roll = {
      id: 'test',
      dice: [1, 2, 3, 4, 5, 6],
      sides: 6,
      threshold: 4,
      purpose: 'test',
      timestamp: 0,
    };
    expect(countFailures(roll)).toBe(3); // 1, 2, 3
  });
});

describe('sumDice', () => {
  it('sums all dice', () => {
    const roll = {
      id: 'test',
      dice: [1, 2, 3, 4],
      sides: 6,
      purpose: 'test',
      timestamp: 0,
    };
    expect(sumDice(roll)).toBe(10);
  });
});
