import { describe, it, expect } from 'vitest';
import {
  MM_PER_INCH,
  mmToInches,
  baseRadiusInches,
  baseCircle,
  distance,
  edgeToEdgeDistance,
  baseToPointDistance,
  basesWithin,
  baseWithinOfPoint,
  pointsWithin,
  pointToSegmentDistance,
  pointToPolygonDistance,
  baseToPolygonDistance,
  baseWithinOfPolygon,
} from './index.js';
import type { Polygon } from '../types/geometry.js';

describe('mm to inch conversion', () => {
  it('uses 25.4 mm per inch', () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(mmToInches(25.4)).toBe(1);
    expect(mmToInches(32)).toBeCloseTo(1.2598, 4);
  });

  it('baseRadiusInches halves the diameter', () => {
    expect(baseRadiusInches(25.4)).toBeCloseTo(0.5, 10);
    expect(baseRadiusInches(32)).toBeCloseTo(32 / 25.4 / 2, 10);
  });

  it('baseCircle builds an inch-radius circle from a mm diameter', () => {
    const base = baseCircle({ x: 3, y: 4 }, 40);
    expect(base.center).toEqual({ x: 3, y: 4 });
    expect(base.radius).toBeCloseTo(40 / 25.4 / 2, 10);
  });
});

describe('distance', () => {
  it('returns 0 for the same point', () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it('calculates horizontal distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
  });

  it('calculates diagonal distance (3-4-5 triangle)', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('edgeToEdgeDistance', () => {
  it('returns 0 when bases overlap', () => {
    const a = baseCircle({ x: 0, y: 0 }, 32);
    const b = baseCircle({ x: 0.5, y: 0 }, 32);
    expect(edgeToEdgeDistance(a, b)).toBe(0);
  });

  it('measures edge-to-edge, not center-to-center', () => {
    const a = baseCircle({ x: 0, y: 0 }, 32);
    const b = baseCircle({ x: 10, y: 0 }, 32);
    expect(edgeToEdgeDistance(a, b)).toBeCloseTo(10 - mmToInches(32), 5);
  });

  it('handles different base sizes (25mm vs 40mm)', () => {
    const a = baseCircle({ x: 0, y: 0 }, 25);
    const b = baseCircle({ x: 10, y: 0 }, 40);
    const expected = 10 - 25 / 25.4 / 2 - 40 / 25.4 / 2;
    expect(edgeToEdgeDistance(a, b)).toBeCloseTo(expected, 5);
  });

  it('works on diagonals', () => {
    const a = { center: { x: 0, y: 0 }, radius: 1 };
    const b = { center: { x: 3, y: 4 }, radius: 0.5 };
    expect(edgeToEdgeDistance(a, b)).toBeCloseTo(5 - 1.5, 10);
  });
});

describe('baseToPointDistance', () => {
  it('subtracts the base radius', () => {
    const base = { center: { x: 0, y: 0 }, radius: 1 };
    expect(baseToPointDistance(base, { x: 4, y: 0 })).toBeCloseTo(3, 10);
  });

  it('returns 0 for a point inside the base', () => {
    const base = { center: { x: 0, y: 0 }, radius: 1 };
    expect(baseToPointDistance(base, { x: 0.5, y: 0 })).toBe(0);
  });
});

describe('within predicates (inclusive)', () => {
  it('basesWithin treats exactly X inches as within', () => {
    const a = { center: { x: 0, y: 0 }, radius: 0.5 };
    const b = { center: { x: 3, y: 0 }, radius: 0.5 };
    // edge-to-edge is exactly 2"
    expect(basesWithin(a, b, 2)).toBe(true);
    expect(basesWithin(a, b, 1.999)).toBe(false);
  });

  it('baseWithinOfPoint is inclusive and edge-based', () => {
    const base = { center: { x: 0, y: 0 }, radius: 1 };
    expect(baseWithinOfPoint(base, { x: 3, y: 0 }, 2)).toBe(true); // edge is 2" away
    expect(baseWithinOfPoint(base, { x: 3.01, y: 0 }, 2)).toBe(false);
    expect(baseWithinOfPoint(base, { x: 0.2, y: 0 }, 0)).toBe(true); // inside
  });

  it('pointsWithin is inclusive', () => {
    expect(pointsWithin({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true);
    expect(pointsWithin({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.99)).toBe(false);
  });
});

describe('pointToSegmentDistance', () => {
  it('measures perpendicular distance to the segment interior', () => {
    expect(pointToSegmentDistance({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
  });

  it('clamps to the nearest endpoint beyond the segment ends', () => {
    expect(pointToSegmentDistance({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('handles degenerate (zero-length) segments', () => {
    expect(pointToSegmentDistance({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('pointToPolygonDistance', () => {
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('returns 0 for a point inside the polygon', () => {
    expect(pointToPolygonDistance({ x: 5, y: 5 }, square)).toBe(0);
  });

  it('measures distance to the nearest edge', () => {
    expect(pointToPolygonDistance({ x: 15, y: 5 }, square)).toBe(5);
  });

  it('measures distance to the nearest corner on diagonals', () => {
    expect(pointToPolygonDistance({ x: 13, y: 14 }, square)).toBe(5);
  });

  it('returns Infinity for an empty polygon', () => {
    expect(pointToPolygonDistance({ x: 0, y: 0 }, [])).toBe(Infinity);
  });
});

describe('baseToPolygonDistance / baseWithinOfPolygon', () => {
  const square: Polygon = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('subtracts the base radius from the polygon distance', () => {
    const base = { center: { x: 15, y: 5 }, radius: 1 };
    expect(baseToPolygonDistance(base, square)).toBeCloseTo(4, 10);
  });

  it('returns 0 when the base overlaps the polygon', () => {
    const base = { center: { x: 10.5, y: 5 }, radius: 1 };
    expect(baseToPolygonDistance(base, square)).toBe(0);
  });

  it('baseWithinOfPolygon: 3-inch objective-control style check, inclusive', () => {
    const base = { center: { x: 14, y: 5 }, radius: 1 };
    expect(baseWithinOfPolygon(base, square, 3)).toBe(true); // exactly 3"
    expect(baseWithinOfPolygon(base, square, 2.99)).toBe(false);
  });
});
