import { describe, it, expect } from 'vitest';
import {
  checkLineOfSight,
  segmentsIntersect,
  pointInPolygon,
  segmentIntersectsPolygon,
} from '../index';
import { makeModel } from '../../test-helpers';
import type { TerrainPiece } from '../../types/terrain';

function makeTerrain(overrides: Partial<TerrainPiece> = {}): TerrainPiece {
  return {
    id: 'terrain-1',
    polygon: [
      { x: 5, y: -5 },
      { x: 7, y: -5 },
      { x: 7, y: 5 },
      { x: 5, y: 5 },
    ],
    height: 5,
    traits: ['obscuring'],
    label: 'Wall',
    ...overrides,
  };
}

describe('segmentsIntersect', () => {
  it('detects crossing segments', () => {
    expect(segmentsIntersect(
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 10, y: 0 }, { x: 0, y: 10 },
    )).toBe(true);
  });

  it('detects non-crossing segments', () => {
    expect(segmentsIntersect(
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 0, y: 1 }, { x: 1, y: 1 },
    )).toBe(false);
  });

  it('detects T-junction (endpoint touching segment)', () => {
    expect(segmentsIntersect(
      { x: 0, y: 0 }, { x: 10, y: 0 },
      { x: 5, y: 0 }, { x: 5, y: 10 },
    )).toBe(true);
  });
});

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('detects point inside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('detects point outside', () => {
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it('detects point far outside', () => {
    expect(pointInPolygon({ x: -10, y: -10 }, square)).toBe(false);
  });
});

describe('segmentIntersectsPolygon', () => {
  const square = [
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 5, y: 10 },
  ];

  it('detects segment crossing through polygon', () => {
    expect(segmentIntersectsPolygon(
      [{ x: 0, y: 5 }, { x: 15, y: 5 }],
      square,
    )).toBe(true);
  });

  it('detects segment entirely inside polygon', () => {
    expect(segmentIntersectsPolygon(
      [{ x: 6, y: 3 }, { x: 8, y: 7 }],
      square,
    )).toBe(true);
  });

  it('detects segment that misses polygon', () => {
    expect(segmentIntersectsPolygon(
      [{ x: 0, y: 5 }, { x: 3, y: 5 }],
      square,
    )).toBe(false);
  });
});

describe('checkLineOfSight', () => {
  it('clear LoS with no terrain', () => {
    const from = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const to = makeModel({ id: 'b', position: { x: 20, y: 0 } });
    const result = checkLineOfSight(from, to, {});
    expect(result.clear).toBe(true);
    expect(result.blockingTerrainIds).toHaveLength(0);
    expect(result.intersectionPoint).toBeNull();
  });

  it('blocked by obscuring terrain between models', () => {
    const from = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const to = makeModel({ id: 'b', position: { x: 20, y: 0 } });
    const wall = makeTerrain();
    const result = checkLineOfSight(from, to, { [wall.id]: wall });
    expect(result.clear).toBe(false);
    expect(result.blockingTerrainIds).toContain('terrain-1');
    expect(result.intersectionPoint).not.toBeNull();
    expect(result.intersectionPoint!.x).toBeCloseTo(5, 1);
  });

  it('not blocked when terrain is off to the side', () => {
    const from = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const to = makeModel({ id: 'b', position: { x: 20, y: 0 } });
    const wall = makeTerrain({
      polygon: [
        { x: 5, y: 10 },
        { x: 7, y: 10 },
        { x: 7, y: 15 },
        { x: 5, y: 15 },
      ],
    });
    const result = checkLineOfSight(from, to, { [wall.id]: wall });
    expect(result.clear).toBe(true);
  });

  it('reports dense terrain without blocking', () => {
    const from = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const to = makeModel({ id: 'b', position: { x: 20, y: 0 } });
    const forest = makeTerrain({ id: 'forest-1', traits: ['dense'] });
    const result = checkLineOfSight(from, to, { [forest.id]: forest });
    expect(result.clear).toBe(true);
    expect(result.denseTerrainIds).toContain('forest-1');
  });

  it('reports both blocking and dense traits', () => {
    const from = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const to = makeModel({ id: 'b', position: { x: 20, y: 0 } });
    const mixed = makeTerrain({ id: 'mixed-1', traits: ['obscuring', 'dense'] });
    const result = checkLineOfSight(from, to, { [mixed.id]: mixed });
    expect(result.clear).toBe(false);
    expect(result.blockingTerrainIds).toContain('mixed-1');
    expect(result.denseTerrainIds).toContain('mixed-1');
  });

  it('handles multiple terrain pieces', () => {
    const from = makeModel({ id: 'a', position: { x: 0, y: 0 } });
    const to = makeModel({ id: 'b', position: { x: 30, y: 0 } });
    const wall1 = makeTerrain({ id: 't1' });
    const wall2 = makeTerrain({
      id: 't2',
      polygon: [
        { x: 15, y: -5 },
        { x: 17, y: -5 },
        { x: 17, y: 5 },
        { x: 15, y: 5 },
      ],
    });
    const result = checkLineOfSight(from, to, { t1: wall1, t2: wall2 });
    expect(result.clear).toBe(false);
    expect(result.blockingTerrainIds).toHaveLength(2);
    expect(result.intersectionPoint!.x).toBeCloseTo(5, 1);
  });
});
