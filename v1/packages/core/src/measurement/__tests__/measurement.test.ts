import { describe, it, expect } from 'vitest';
import { distance, distanceBetweenModels, isWithinRange, modelsAreWithin, modelsInRange, checkCoherency, closestPointOnBoundary, getModelBoundingBox } from '../index';
import { makeModel } from '../../test-helpers';
import type { BaseShape } from '../../types/index';
import { baseShapeEffectiveDiameterMm, baseSizeToInches } from '../../types/index';

/** Helper to make a model with a specific base shape */
function makeShapedModel(
  id: string,
  position: { x: number; y: number },
  shape: BaseShape,
  facing: number = 0,
) {
  const effectiveMm = baseShapeEffectiveDiameterMm(shape);
  return makeModel({
    id,
    position,
    baseShape: shape,
    baseSizeMm: effectiveMm,
    baseSizeInches: baseSizeToInches(effectiveMm),
    facing,
  });
}

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

// ─── Non-circular shape tests ────────────────────────────────────────

describe('closestPointOnBoundary', () => {
  it('circle: returns point on edge toward target', () => {
    const model = makeShapedModel('a', { x: 0, y: 0 }, { type: 'circle', diameterMm: 50.8 }); // 2" diameter
    const closest = closestPointOnBoundary(model, { x: 10, y: 0 });
    expect(closest.x).toBeCloseTo(1, 3); // radius = 1"
    expect(closest.y).toBeCloseTo(0, 5);
  });

  it('rect (facing 0°/up): closest point on right edge', () => {
    // 4" wide x 2" tall rect, facing up (0°), target to the right
    const model = makeShapedModel('a', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 0);
    const closest = closestPointOnBoundary(model, { x: 10, y: 0 });
    // Facing 0° = up: width is along local-x, but after rotation by -90°,
    // the shape's width axis aligns differently. Let's just check distance.
    // The right edge should be 2" from center (half of 4" width) in the direction toward target.
    // Actually with facing 0° (up), the rect is rotated -90° visually, so:
    // local x-axis becomes world y-axis (up), local y-axis becomes world -x-axis
    // Wait, let me think: facing=0 means "up", rotation is (0-90)° = -90°
    // So the width (local x) rotates to point upward, height (local y) rotates to point rightward
    // Target is at (10,0) = to the right = along height axis
    // Closest point should be at height/2 = 1" to the right
    expect(closest.x).toBeCloseTo(1, 1); // half of height (2") = 1"
    expect(closest.y).toBeCloseTo(0, 1);
  });

  it('rect (facing 90°/right): closest point on right edge', () => {
    // 4" wide x 2" tall rect, facing right (90°), target to the right
    const model = makeShapedModel('a', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    const closest = closestPointOnBoundary(model, { x: 10, y: 0 });
    // Facing 90° = right: rotation is (90-90)° = 0°, so width aligns with world x
    // Closest point on right edge = hw = 2"
    expect(closest.x).toBeCloseTo(2, 1); // half of 4" width
    expect(closest.y).toBeCloseTo(0, 1);
  });

  it('oval: closest point on edge toward target', () => {
    // 3" wide x 2" tall oval at origin, target to the right, facing right (90°)
    const model = makeShapedModel('a', { x: 0, y: 0 },
      { type: 'oval', widthMm: 3 * 25.4, heightMm: 2 * 25.4 }, 90);
    const closest = closestPointOnBoundary(model, { x: 10, y: 0 });
    // Semi-major axis = 1.5" along x after rotation
    expect(closest.x).toBeCloseTo(1.5, 1);
    expect(closest.y).toBeCloseTo(0, 1);
  });
});

describe('distanceBetweenModels — rect shapes', () => {
  it('two rects facing the same direction, side by side', () => {
    // Two 4"×2" rects both facing right (90°), separated along x-axis
    // Centers 10" apart along x, each extends 2" (half-width) toward the other
    const a = makeShapedModel('a', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    const b = makeShapedModel('b', { x: 10, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    // Edge-to-edge: 10 - 2 - 2 = 6"
    expect(distanceBetweenModels(a, b)).toBeCloseTo(6, 1);
  });

  it('rect and circle: edge-to-edge distance', () => {
    // 4"×2" rect facing right at origin, 32mm circle at (10, 0)
    const tank = makeShapedModel('tank', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    const marine = makeShapedModel('marine', { x: 10, y: 0 },
      { type: 'circle', diameterMm: 32 });
    // Tank right edge at x=2, marine left edge at x = 10 - 32/25.4/2 ≈ 9.37
    const expected = 10 - 2 - (32 / 25.4 / 2);
    expect(distanceBetweenModels(tank, marine)).toBeCloseTo(expected, 1);
  });

  it('returns 0 for overlapping shapes', () => {
    const a = makeShapedModel('a', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    const b = makeShapedModel('b', { x: 1, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    expect(distanceBetweenModels(a, b)).toBe(0);
  });

  it('rect rotated 45°: closer than axis-aligned on the diagonal', () => {
    // 4"×2" rect at origin facing 135° (rotated 45° from right)
    // Compare to same rect facing right — the rotated version's corner is closer
    const rotated = makeShapedModel('a', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 135);
    const axisAligned = makeShapedModel('a2', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    const target = makeShapedModel('b', { x: 10, y: 0 },
      { type: 'circle', diameterMm: 25.4 }); // 1" circle
    const distRotated = distanceBetweenModels(rotated, target);
    const distAligned = distanceBetweenModels(axisAligned, target);
    // Rotated rect's corner extends further toward target than the flat edge
    expect(distRotated).toBeLessThan(distAligned);
    expect(distRotated).toBeGreaterThan(0);
  });
});

describe('distanceBetweenModels — oval shapes', () => {
  it('oval to circle: edge-to-edge along major axis', () => {
    // 3"×2" oval facing right at origin, circle at (10,0)
    const oval = makeShapedModel('oval', { x: 0, y: 0 },
      { type: 'oval', widthMm: 3 * 25.4, heightMm: 2 * 25.4 }, 90);
    const circle = makeShapedModel('c', { x: 10, y: 0 },
      { type: 'circle', diameterMm: 25.4 }); // 1" diameter
    // Oval extends 1.5" to the right, circle extends 0.5" to the left
    const expected = 10 - 1.5 - 0.5;
    expect(distanceBetweenModels(oval, circle)).toBeCloseTo(expected, 1);
  });
});

describe('isWithinRange — non-circular', () => {
  it('rect model: point within range of edge', () => {
    // 4"×2" rect facing right, point 3" to the right of center
    // Edge is at 2", so point is 1" from edge
    const tank = makeShapedModel('tank', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    expect(isWithinRange(tank, { x: 3, y: 0 }, 2)).toBe(true);  // 1" away, range 2"
    expect(isWithinRange(tank, { x: 3, y: 0 }, 0.5)).toBe(false); // 1" away, range 0.5"
  });

  it('point inside rect is within any range', () => {
    const tank = makeShapedModel('tank', { x: 0, y: 0 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    expect(isWithinRange(tank, { x: 1, y: 0 }, 0)).toBe(true); // inside the rect
  });
});

describe('getModelBoundingBox', () => {
  it('circle: symmetric AABB', () => {
    const model = makeShapedModel('a', { x: 5, y: 5 }, { type: 'circle', diameterMm: 50.8 }); // 2" diameter
    const bbox = getModelBoundingBox(model, model.position);
    expect(bbox.minX).toBeCloseTo(4, 3);
    expect(bbox.maxX).toBeCloseTo(6, 3);
    expect(bbox.minY).toBeCloseTo(4, 3);
    expect(bbox.maxY).toBeCloseTo(6, 3);
  });

  it('rect facing right: AABB matches shape', () => {
    // 4"×2" rect facing right (90°) at (5,5)
    const model = makeShapedModel('a', { x: 5, y: 5 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 90);
    const bbox = getModelBoundingBox(model, model.position);
    expect(bbox.minX).toBeCloseTo(3, 1); // 5 - 2
    expect(bbox.maxX).toBeCloseTo(7, 1); // 5 + 2
    expect(bbox.minY).toBeCloseTo(4, 1); // 5 - 1
    expect(bbox.maxY).toBeCloseTo(6, 1); // 5 + 1
  });

  it('rect facing up: AABB swaps width/height', () => {
    // 4"×2" rect facing up (0°) at (5,5)
    const model = makeShapedModel('a', { x: 5, y: 5 },
      { type: 'rect', widthMm: 4 * 25.4, heightMm: 2 * 25.4 }, 0);
    const bbox = getModelBoundingBox(model, model.position);
    // Facing up = rotated -90°: width becomes vertical, height becomes horizontal
    expect(bbox.minX).toBeCloseTo(4, 1); // 5 - 1 (height/2)
    expect(bbox.maxX).toBeCloseTo(6, 1); // 5 + 1
    expect(bbox.minY).toBeCloseTo(3, 1); // 5 - 2 (width/2)
    expect(bbox.maxY).toBeCloseTo(7, 1); // 5 + 2
  });
});
