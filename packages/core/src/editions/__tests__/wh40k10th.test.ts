import { describe, it, expect } from 'vitest';
import { wh40k10thEdition } from '../wh40k10th';

describe('Warhammer 40K 10th Edition', () => {
  it('has correct metadata', () => {
    expect(wh40k10thEdition.id).toBe('wh40k-10th');
    expect(wh40k10thEdition.gameSystem).toBe('40k');
  });

  it('has 6 phases in correct order', () => {
    expect(wh40k10thEdition.phases).toHaveLength(6);
    expect(wh40k10thEdition.phases.map((p) => p.id)).toEqual([
      'command',
      'movement',
      'shooting',
      'charge',
      'fight',
      'morale',
    ]);
  });

  it('advances phases correctly', () => {
    expect(wh40k10thEdition.getNextPhase(0)).toBe(1);
    expect(wh40k10thEdition.getNextPhase(4)).toBe(5);
    expect(wh40k10thEdition.getNextPhase(5)).toBeNull(); // last phase
  });

  it('returns correct movement distance', () => {
    expect(wh40k10thEdition.getMaxMoveDistance(6, 'normal')).toBe(6);
    expect(wh40k10thEdition.getMaxMoveDistance(12, 'fall_back')).toBe(12);
  });

  it('has 1" engagement range', () => {
    expect(wh40k10thEdition.getEngagementRange()).toBe(1);
  });

  it('has 2" coherency range', () => {
    expect(wh40k10thEdition.getCoherencyRange()).toBe(2);
  });

  it('requires 2 neighbors for units of 6+', () => {
    expect(wh40k10thEdition.getCoherencyMinModels(5)).toBe(1);
    expect(wh40k10thEdition.getCoherencyMinModels(6)).toBe(2);
    expect(wh40k10thEdition.getCoherencyMinModels(20)).toBe(2);
  });
});
