import { describe, it, expect } from 'vitest';
import {
  segmentsIntersect,
  segmentIntersection,
  pointInPolygon,
  segmentIntersectsPolygon,
  firstPolygonIntersection,
  segmentIntersectsCircle,
  checkLineOfSight,
  sightLinesBetweenBases,
  isBaseVisible,
  type LosBlocker,
} from './index.js';
import type { Polygon, Segment } from '../types/geometry.js';

function seg(ax: number, ay: number, bx: number, by: number): Segment {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

describe('segmentsIntersect', () => {
  it('detects crossing segments', () => {
    expect(segmentsIntersect(seg(0, 0, 10, 10), seg(10, 0, 0, 10))).toBe(true);
  });

  it('detects non-crossing segments', () => {
    expect(segmentsIntersect(seg(0, 0, 1, 0), seg(0, 1, 1, 1))).toBe(false);
  });

  it('detects T-junction (endpoint touching segment)', () => {
    expect(segmentsIntersect(seg(0, 0, 10, 0), seg(5, 0, 5, 10))).toBe(true);
  });

  it('detects collinear overlap', () => {
    expect(segmentsIntersect(seg(0, 0, 5, 0), seg(3, 0, 8, 0))).toBe(true);
  });
});

describe('segmentIntersection', () => {
  it('returns the crossing point', () => {
    const pt = segmentIntersection(seg(0, 0, 10, 10), seg(10, 0, 0, 10));
    expect(pt).not.toBeNull();
    expect(pt!.x).toBeCloseTo(5, 10);
    expect(pt!.y).toBeCloseTo(5, 10);
  });

  it('returns null for parallel segments', () => {
    expect(segmentIntersection(seg(0, 0, 10, 0), seg(0, 1, 10, 1))).toBeNull();
  });

  it('returns null when lines cross but segments do not', () => {
    expect(segmentIntersection(seg(0, 0, 1, 1), seg(10, 0, 0, 10))).toBeNull();
  });
});

describe('pointInPolygon', () => {
  const square: Polygon = [
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

  it('works on non-convex polygons', () => {
    const lShape: Polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 2, y: 8 }, lShape)).toBe(true);
    expect(pointInPolygon({ x: 8, y: 8 }, lShape)).toBe(false); // in the notch
  });
});

describe('segmentIntersectsPolygon', () => {
  const square: Polygon = [
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 5, y: 10 },
  ];

  it('detects segment crossing through polygon', () => {
    expect(segmentIntersectsPolygon(seg(0, 5, 15, 5), square)).toBe(true);
  });

  it('detects segment entirely inside polygon', () => {
    expect(segmentIntersectsPolygon(seg(6, 3, 8, 7), square)).toBe(true);
  });

  it('detects segment that misses polygon', () => {
    expect(segmentIntersectsPolygon(seg(0, 5, 3, 5), square)).toBe(false);
  });

  it('returns false for degenerate polygons (< 3 vertices)', () => {
    expect(segmentIntersectsPolygon(seg(0, 0, 10, 10), [{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(false);
  });
});

describe('firstPolygonIntersection', () => {
  it('returns the entry point closest to the segment start', () => {
    const square: Polygon = [
      { x: 5, y: -5 },
      { x: 7, y: -5 },
      { x: 7, y: 5 },
      { x: 5, y: 5 },
    ];
    const pt = firstPolygonIntersection(seg(0, 0, 20, 0), square);
    expect(pt).not.toBeNull();
    expect(pt!.x).toBeCloseTo(5, 5);
    expect(pt!.y).toBeCloseTo(0, 5);
  });
});

describe('segmentIntersectsCircle', () => {
  const circle = { center: { x: 5, y: 0 }, radius: 1 };

  it('detects a segment passing through the circle', () => {
    expect(segmentIntersectsCircle(seg(0, 0, 10, 0), circle)).toBe(true);
  });

  it('misses when the segment passes outside the radius', () => {
    expect(segmentIntersectsCircle(seg(0, 2, 10, 2), circle)).toBe(false);
  });

  it('misses when the segment ends before reaching the circle', () => {
    expect(segmentIntersectsCircle(seg(0, 0, 3, 0), circle)).toBe(false);
  });

  it('detects a segment starting inside the circle', () => {
    expect(segmentIntersectsCircle(seg(5, 0, 20, 0), circle)).toBe(true);
  });
});

describe('checkLineOfSight', () => {
  const wall: LosBlocker = {
    id: 'wall-1',
    footprint: [
      { x: 5, y: -5 },
      { x: 7, y: -5 },
      { x: 7, y: 5 },
      { x: 5, y: 5 },
    ],
  };

  it('is clear with no blockers', () => {
    const result = checkLineOfSight({ x: 0, y: 0 }, { x: 20, y: 0 }, []);
    expect(result.clear).toBe(true);
    expect(result.blockingIds).toHaveLength(0);
    expect(result.firstIntersection).toBeNull();
  });

  it('is blocked by a wall between the points', () => {
    const result = checkLineOfSight({ x: 0, y: 0 }, { x: 20, y: 0 }, [wall]);
    expect(result.clear).toBe(false);
    expect(result.blockingIds).toContain('wall-1');
    expect(result.firstIntersection).not.toBeNull();
    expect(result.firstIntersection!.x).toBeCloseTo(5, 5);
  });

  it('is not blocked by terrain off to the side', () => {
    const side: LosBlocker = {
      id: 'side',
      footprint: [
        { x: 5, y: 10 },
        { x: 7, y: 10 },
        { x: 7, y: 15 },
        { x: 5, y: 15 },
      ],
    };
    const result = checkLineOfSight({ x: 0, y: 0 }, { x: 20, y: 0 }, [side]);
    expect(result.clear).toBe(true);
  });

  it('reports all blockers and the closest intersection', () => {
    const farWall: LosBlocker = {
      id: 'wall-2',
      footprint: [
        { x: 15, y: -5 },
        { x: 17, y: -5 },
        { x: 17, y: 5 },
        { x: 15, y: 5 },
      ],
    };
    // Far wall listed first — closest intersection must still come from wall-1.
    const result = checkLineOfSight({ x: 0, y: 0 }, { x: 30, y: 0 }, [farWall, wall]);
    expect(result.clear).toBe(false);
    expect(result.blockingIds).toHaveLength(2);
    expect(result.firstIntersection!.x).toBeCloseTo(5, 5);
  });
});

describe('sightLinesBetweenBases', () => {
  it('returns center line plus both edge lines', () => {
    const a = { center: { x: 0, y: 0 }, radius: 1 };
    const b = { center: { x: 10, y: 0 }, radius: 2 };
    const lines = sightLinesBetweenBases(a, b);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual(seg(0, 0, 10, 0));
    const ys = lines.slice(1).map((l) => [l.a.y, l.b.y]);
    // Edge lines start at the observer's radius and end at the target's radius.
    expect(ys).toContainEqual([-1, -2]);
    expect(ys).toContainEqual([1, 2]);
  });

  it('returns only the center line for coincident centers', () => {
    const a = { center: { x: 3, y: 3 }, radius: 1 };
    expect(sightLinesBetweenBases(a, a)).toHaveLength(1);
  });
});

describe('isBaseVisible', () => {
  const observer = { center: { x: 0, y: 0 }, radius: 1 };
  const target = { center: { x: 10, y: 0 }, radius: 1 };

  it('is visible with nothing in between', () => {
    expect(isBaseVisible(observer, target, [])).toBe(true);
  });

  it('is visible when only the center line is blocked (edge lines clear)', () => {
    const narrowWall: LosBlocker = {
      id: 'narrow',
      footprint: [
        { x: 5, y: -0.5 },
        { x: 6, y: -0.5 },
        { x: 6, y: 0.5 },
        { x: 5, y: 0.5 },
      ],
    };
    expect(isBaseVisible(observer, target, [narrowWall])).toBe(true);
  });

  it('is not visible behind a wall covering all sight lines', () => {
    const bigWall: LosBlocker = {
      id: 'big',
      footprint: [
        { x: 5, y: -5 },
        { x: 6, y: -5 },
        { x: 6, y: 5 },
        { x: 5, y: 5 },
      ],
    };
    expect(isBaseVisible(observer, target, [bigWall])).toBe(false);
  });

  it('is not visible behind a large intervening base', () => {
    const blob = { center: { x: 5, y: 0 }, radius: 2 };
    expect(isBaseVisible(observer, target, [], [blob])).toBe(false);
  });

  it('is visible past a small intervening base that only blocks the center line', () => {
    const small = { center: { x: 5, y: 0 }, radius: 0.5 };
    expect(isBaseVisible(observer, target, [], [small])).toBe(true);
  });
});
