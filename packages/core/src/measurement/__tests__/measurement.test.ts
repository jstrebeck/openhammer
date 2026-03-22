import { describe, it, expect } from 'vitest';
import { distance, distanceBetweenModels, isWithinRange, modelsAreWithin, modelsInRange, checkCoherency } from '../index';
import { makeModel } from '../../test-helpers';

describe('distance', () => {
  it('returns 0 for same point', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('calculates horizontal distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
  });

  it('calculates diagonal distance (3-4-5 triangle)', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('distanceBetweenModels', () => {
  it('returns 0 when bases overlap', () => {
    const a = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const b = makeModel({ id: 'b', position: { x: 0, y: 0 } });
    expect(distanceBetweenModels(a, b)).toBe(0);
  });

  it('measures edge-to-edge, not center-to-center', () => {
    const a = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const b = makeModel({ id: 'b', position: { x: 10, y: 0 } });
    const expected = 10 - a.baseSizeInches;
    expect(distanceBetweenModels(a, b)).toBeCloseTo(expected, 5);
  });

  it('handles different base sizes', () => {
    const a = makeModel({ id: 'a', baseSizeMm: 25, baseSizeInches: 25 / 25.4, position: { x: 0, y: 0 } });
    const b = makeModel({ id: 'b', baseSizeMm: 40, baseSizeInches: 40 / 25.4, position: { x: 10, y: 0 } });
    const expected = 10 - (25 / 25.4) / 2 - (40 / 25.4) / 2;
    expect(distanceBetweenModels(a, b)).toBeCloseTo(expected, 5);
  });
});

describe('isWithinRange', () => {
  it('returns true when model edge is within range of point', () => {
    const model = makeModel({ position: { x: 0, y: 0 } });
    expect(isWithinRange(model, { x: 2, y: 0 }, 2)).toBe(true);
  });

  it('returns false when model edge is out of range', () => {
    const model = makeModel({ position: { x: 0, y: 0 } });
    expect(isWithinRange(model, { x: 20, y: 0 }, 2)).toBe(false);
  });
});

describe('modelsAreWithin', () => {
  it('returns true for touching bases', () => {
    const a = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const b = makeModel({ id: 'b', position: { x: 1, y: 0 } });
    expect(modelsAreWithin(a, b, 2)).toBe(true);
  });
});

describe('modelsInRange', () => {
  it('finds models within range of a source', () => {
    const source = makeModel({ id: 'src', position: { x: 0, y: 0 } });
    const near = makeModel({ id: 'near', position: { x: 3, y: 0 } });
    const far = makeModel({ id: 'far', position: { x: 30, y: 0 } });
    const result = modelsInRange(source, [source, near, far], 5);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('near');
  });

  it('excludes the source model', () => {
    const source = makeModel({ id: 'src', position: { x: 0, y: 0 } });
    const result = modelsInRange(source, [source], 100);
    expect(result).toHaveLength(0);
  });
});

describe('checkCoherency', () => {
  it('single model is always in coherency', () => {
    const model = makeModel();
    const result = checkCoherency(['model-1'], { 'model-1': model }, 2, 1);
    expect(result.inCoherency).toBe(true);
  });

  it('two close models are in coherency', () => {
    const a = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const b = makeModel({ id: 'b', position: { x: 2, y: 0 } });
    const result = checkCoherency(['a', 'b'], { a, b }, 2, 1);
    expect(result.inCoherency).toBe(true);
  });

  it('two distant models fail coherency', () => {
    const a = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const b = makeModel({ id: 'b', position: { x: 30, y: 0 } });
    const result = checkCoherency(['a', 'b'], { a, b }, 2, 1);
    expect(result.inCoherency).toBe(false);
    expect(result.failingModelIds).toContain('a');
    expect(result.failingModelIds).toContain('b');
  });

  it('checks minNeighbors=2 for large units', () => {
    const models: Record<string, ReturnType<typeof makeModel>> = {};
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = `m${i}`;
      ids.push(id);
      models[id] = makeModel({ id, position: { x: i * 2.5, y: 0 } });
    }
    const result = checkCoherency(ids, models, 2, 2);
    expect(result.inCoherency).toBe(false);
    expect(result.failingModelIds).toContain('m0');
    expect(result.failingModelIds).toContain('m5');
  });
});
