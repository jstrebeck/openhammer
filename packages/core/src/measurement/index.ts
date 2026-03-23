import type { Point } from '../types/geometry';
import type { Model, BaseShape } from '../types/index';
import { baseShapeDimensionsInches } from '../types/index';

/** Euclidean distance between two points */
export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ─── Closest-point-on-boundary primitives ────────────────────────────

/**
 * Closest point on a model's base boundary to an external target point.
 * Handles circle, oval (ellipse), and rect shapes with facing rotation.
 */
export function closestPointOnBoundary(
  model: { position: Point; baseShape: BaseShape; facing: number },
  target: Point,
): Point {
  const dims = baseShapeDimensionsInches(model.baseShape);

  if (model.baseShape.type === 'circle') {
    return closestPointOnCircle(model.position, dims.width / 2, target);
  }

  // Transform target into the shape's local frame (undo facing rotation)
  const facingRad = (model.facing - 90) * (Math.PI / 180);
  const dx = target.x - model.position.x;
  const dy = target.y - model.position.y;
  const cos = Math.cos(-facingRad);
  const sin = Math.sin(-facingRad);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;

  let closestLocal: Point;
  if (model.baseShape.type === 'rect') {
    closestLocal = closestPointOnRect(dims.width / 2, dims.height / 2, localX, localY);
  } else {
    // oval
    closestLocal = closestPointOnEllipse(dims.width / 2, dims.height / 2, localX, localY);
  }

  // Transform back to world space
  const cosF = Math.cos(facingRad);
  const sinF = Math.sin(facingRad);
  return {
    x: model.position.x + closestLocal.x * cosF - closestLocal.y * sinF,
    y: model.position.y + closestLocal.x * sinF + closestLocal.y * cosF,
  };
}

/** Closest point on a circle boundary to an external point */
function closestPointOnCircle(center: Point, radius: number, target: Point): Point {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) {
    // Point is at center — return arbitrary edge point
    return { x: center.x + radius, y: center.y };
  }
  return {
    x: center.x + (dx / len) * radius,
    y: center.y + (dy / len) * radius,
  };
}

/** Closest point on an axis-aligned rectangle boundary to a point (in local space) */
function closestPointOnRect(hw: number, hh: number, px: number, py: number): Point {
  // If point is inside, project to nearest edge
  const cx = Math.max(-hw, Math.min(hw, px));
  const cy = Math.max(-hh, Math.min(hh, py));

  if (cx === px && cy === py) {
    // Point is inside the rect — find nearest edge
    const distToEdges = [
      { axis: 'x', val: -hw, dist: px - (-hw) },
      { axis: 'x', val: hw, dist: hw - px },
      { axis: 'y', val: -hh, dist: py - (-hh) },
      { axis: 'y', val: hh, dist: hh - py },
    ];
    distToEdges.sort((a, b) => a.dist - b.dist);
    const nearest = distToEdges[0];
    if (nearest.axis === 'x') return { x: nearest.val, y: py };
    return { x: px, y: nearest.val };
  }

  return { x: cx, y: cy };
}

/**
 * Closest point on an axis-aligned ellipse boundary to a point (in local space).
 * Uses Newton's method on the parametric form.
 * Semi-axes a (x) and b (y).
 */
function closestPointOnEllipse(a: number, b: number, px: number, py: number): Point {
  // Handle degenerate cases
  if (a === 0 && b === 0) return { x: 0, y: 0 };
  if (a === b) {
    // Circle — use simpler formula
    const len = Math.sqrt(px * px + py * py);
    if (len === 0) return { x: a, y: 0 };
    return { x: (px / len) * a, y: (py / len) * a };
  }

  // Use the sign-preserving absolute value approach for symmetry
  const absPx = Math.abs(px);
  const absPy = Math.abs(py);
  const signX = px >= 0 ? 1 : -1;
  const signY = py >= 0 ? 1 : -1;

  // Initial guess: parametric angle toward the point
  let t = Math.atan2(a * absPy, b * absPx);

  // Newton iterations to minimize distance
  for (let i = 0; i < 5; i++) {
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const ex = a * cosT;
    const ey = b * sinT;
    const dex = -a * sinT;
    const dey = b * cosT;

    // f(t) = derivative of squared distance w.r.t. t
    const fx = ex - absPx;
    const fy = ey - absPy;
    const f = fx * dex + fy * dey;
    const df = dex * dex + fx * (-a * cosT) + dey * dey + fy * (-b * sinT);

    if (Math.abs(df) < 1e-12) break;
    t -= f / df;
  }

  return {
    x: signX * a * Math.cos(t),
    y: signY * b * Math.sin(t),
  };
}

// ─── Distance-to-point (model edge to a world point) ─────────────────

/**
 * Distance from the nearest edge of a model's base to a target point.
 * Returns 0 if the point is inside the base.
 */
export function distanceToPoint(model: Model, target: Point): number {
  const closest = closestPointOnBoundary(model, target);
  const edgeDist = distance(closest, target);

  // Check if target is inside the shape — if so, distance is 0
  if (isPointInsideShape(model, target)) return 0;
  return edgeDist;
}

/** Test if a point is inside a model's base shape */
function isPointInsideShape(
  model: { position: Point; baseShape: BaseShape; facing: number },
  point: Point,
): boolean {
  const dims = baseShapeDimensionsInches(model.baseShape);
  let dx = point.x - model.position.x;
  let dy = point.y - model.position.y;

  if (model.baseShape.type === 'circle') {
    const r = dims.width / 2;
    return dx * dx + dy * dy <= r * r;
  }

  // Rotate into local frame
  const facingRad = (model.facing - 90) * (Math.PI / 180);
  const cos = Math.cos(-facingRad);
  const sin = Math.sin(-facingRad);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const hw = dims.width / 2;
  const hh = dims.height / 2;

  if (model.baseShape.type === 'rect') {
    return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
  }
  // oval
  return (lx * lx) / (hw * hw) + (ly * ly) / (hh * hh) <= 1;
}

// ─── Bounding box ────────────────────────────────────────────────────

/** Axis-aligned bounding box of a model's base at a given position */
export function getModelBoundingBox(
  model: { baseShape: BaseShape; facing: number },
  position: Point,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const dims = baseShapeDimensionsInches(model.baseShape);
  const hw = dims.width / 2;
  const hh = dims.height / 2;

  if (model.baseShape.type === 'circle') {
    return {
      minX: position.x - hw,
      maxX: position.x + hw,
      minY: position.y - hh,
      maxY: position.y + hh,
    };
  }

  // For rotated rect/oval, compute the AABB of the rotated corners/extents
  const facingRad = (model.facing - 90) * (Math.PI / 180);
  const cosF = Math.abs(Math.cos(facingRad));
  const sinF = Math.abs(Math.sin(facingRad));
  // Rotated AABB half-extents
  const extX = hw * cosF + hh * sinF;
  const extY = hw * sinF + hh * cosF;

  return {
    minX: position.x - extX,
    maxX: position.x + extX,
    minY: position.y - extY,
    maxY: position.y + extY,
  };
}

// ─── Model-to-model distance ─────────────────────────────────────────

/**
 * Distance between two model bases (closest edge to closest edge).
 * Warhammer measures base-to-base, not center-to-center.
 *
 * Uses iterative closest-point refinement for non-circular shapes.
 * For two circles, this is equivalent to center-dist - r1 - r2.
 */
export function distanceBetweenModels(a: Model, b: Model): number {
  // Fast path: both circles — use the original simple formula
  if (a.baseShape.type === 'circle' && b.baseShape.type === 'circle') {
    const centerDist = distance(a.position, b.position);
    const edgeDist = centerDist - a.baseSizeInches / 2 - b.baseSizeInches / 2;
    return Math.max(0, edgeDist);
  }

  // Quick bounding-sphere check: if far apart, single iteration suffices
  const maxRadA = a.baseSizeInches / 2;
  const maxRadB = b.baseSizeInches / 2;
  const centerDist = distance(a.position, b.position);
  if (centerDist > maxRadA + maxRadB + 1) {
    // Far apart — single iteration is sufficient
    const pA = closestPointOnBoundary(a, b.position);
    const pB = closestPointOnBoundary(b, pA);
    return Math.max(0, distance(pA, pB));
  }

  // Iterative refinement (2 full iterations for convergence on convex shapes)
  let pA = closestPointOnBoundary(a, b.position);
  let pB = closestPointOnBoundary(b, pA);
  pA = closestPointOnBoundary(a, pB);
  pB = closestPointOnBoundary(b, pA);

  // Check for overlap
  if (isPointInsideShape(a, pB) || isPointInsideShape(b, pA)) return 0;

  return Math.max(0, distance(pA, pB));
}

/** Check if a model's base is within `inches` of a target point (edge to point) */
export function isWithinRange(model: Model, target: Point, inches: number): boolean {
  return distanceToPoint(model, target) <= inches;
}

/** Check if two models are within `inches` of each other (base to base) */
export function modelsAreWithin(a: Model, b: Model, inches: number): boolean {
  return distanceBetweenModels(a, b) <= inches;
}

/** Find all models within a radius of a source model (base to base) */
export function modelsInRange(
  source: Model,
  allModels: Model[],
  inches: number,
): Model[] {
  return allModels.filter(
    (m) => m.id !== source.id && distanceBetweenModels(source, m) <= inches,
  );
}

/** Check unit coherency: every model must be within coherencyRange of at least minNeighbors other models in the unit */
export function checkCoherency(
  modelIds: string[],
  models: Record<string, Model>,
  coherencyRange: number,
  minNeighbors: number,
): { inCoherency: boolean; failingModelIds: string[] } {
  if (modelIds.length <= 1) {
    return { inCoherency: true, failingModelIds: [] };
  }

  const unitModels = modelIds
    .map((id) => models[id])
    .filter((m): m is Model => m !== undefined && m.status === 'active');

  if (unitModels.length <= 1) {
    return { inCoherency: true, failingModelIds: [] };
  }

  const failingModelIds: string[] = [];

  for (const model of unitModels) {
    const neighborsInRange = unitModels.filter(
      (other) =>
        other.id !== model.id &&
        distanceBetweenModels(model, other) <= coherencyRange,
    ).length;

    if (neighborsInRange < minNeighbors) {
      failingModelIds.push(model.id);
    }
  }

  return {
    inCoherency: failingModelIds.length === 0,
    failingModelIds,
  };
}

// ─── Path collision detection ─────────────────────────────────────────

/**
 * Check if a straight-line movement path from `start` to `end` passes through
 * a model's base (circle only for simplicity — uses line-segment vs circle intersection).
 * Returns true if the path crosses through the model's base boundary.
 */
export function doesPathCrossModel(
  start: Point,
  end: Point,
  obstacle: Model,
): boolean {
  // Use the model's base radius
  const radius = obstacle.baseSizeInches / 2;
  const cx = obstacle.position.x;
  const cy = obstacle.position.y;

  // Line segment from start to end
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = start.x - cx;
  const fy = start.y - cy;

  const a = dx * dx + dy * dy;
  if (a < 1e-10) return false; // No movement

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false; // No intersection

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  // Check if the segment [0,1] overlaps with the intersection interval [t1,t2]
  // The path crosses through if the circle is entered AND exited within the segment,
  // or if the path starts/ends inside the circle.
  // We consider it "crossing through" if any part of the segment is inside the circle.
  return t1 < 1 && t2 > 0;
}

/**
 * Find the closest enemy model to a given point (edge-to-edge distance).
 * Returns the model and distance, or null if no enemies found.
 */
export function closestEnemyModel(
  point: Point,
  sourcePlayerId: string,
  models: Record<string, Model>,
  units: Record<string, { playerId: string }>,
): { model: Model; distance: number } | null {
  let closest: { model: Model; distance: number } | null = null;

  for (const model of Object.values(models)) {
    if (model.status !== 'active') continue;
    const unit = units[model.unitId];
    if (!unit || unit.playerId === sourcePlayerId) continue;

    const dist = distanceToPoint(model, point);
    if (!closest || dist < closest.distance) {
      closest = { model, distance: dist };
    }
  }

  return closest;
}

// ===== Pivot Rules =====

/**
 * Calculate the pivot cost for a model based on its base shape and keywords.
 *
 * 10th Edition pivot rules:
 * - Round base (circle): 0" pivot cost
 * - Non-round base (oval/rect): 1" pivot cost
 * - MONSTER/VEHICLE with non-round base: 2" pivot cost
 * - Round base VEHICLE wider than 32mm with flight stand: 2" pivot cost
 *
 * The first pivot in a move costs movement; subsequent pivots are free.
 */
export function getPivotCost(
  model: Model,
  keywords: string[],
  options?: {
    /** True if this is a round-base VEHICLE on a flight stand (e.g., large flyers) */
    hasFlightStand?: boolean;
  },
): number {
  const isRound = model.baseShape.type === 'circle';
  const isMonsterOrVehicle = keywords.includes('MONSTER') || keywords.includes('VEHICLE');
  const isVehicle = keywords.includes('VEHICLE');

  if (isRound && model.baseShape.type === 'circle') {
    // Round base VEHICLE wider than 32mm with flight stand: 2" cost
    if (isVehicle && model.baseShape.diameterMm > 32 && options?.hasFlightStand) {
      return 2;
    }
    return 0;
  }

  // Non-round base
  if (isMonsterOrVehicle) {
    return 2;
  }

  return 1;
}
