import type { Circle, Polygon, Segment, Vec2 } from '../types/geometry.js';

/**
 * Pure 2D line-of-sight math. No game-state or rules knowledge here:
 * callers decide *which* terrain blocks sight (by trait/height) and pass the
 * footprints in as blockers. All coordinates are in inches.
 *
 * Ported from v1 packages/core/src/los. Intentional changes from v1:
 * - Operates on plain geometry (Vec2/Circle/Polygon/Segment) instead of
 *   Model/TerrainPiece, so trait handling ("obscuring"/"dense") lives in the
 *   rules layer, not here.
 * - checkLineOfSight reports the globally closest intersection point across
 *   all blockers (v1 kept the first blocking piece in iteration order).
 * - isBaseVisible samples three sight lines (center + both base edges)
 *   instead of v1's single center-to-center ray.
 */

const EPSILON = 1e-10;

/** Cross product of vectors (b - a) and (c - a). */
function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Check if point p lies on segment (a, b), assuming the three are collinear. */
function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) <= p.x + EPSILON &&
    p.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.y, b.y) <= p.y + EPSILON &&
    p.y <= Math.max(a.y, b.y) + EPSILON
  );
}

/** Whether two segments intersect (including endpoint touches and collinear overlap). */
export function segmentsIntersect(s1: Segment, s2: Segment): boolean {
  const d1 = cross(s2.a, s2.b, s1.a);
  const d2 = cross(s2.a, s2.b, s1.b);
  const d3 = cross(s1.a, s1.b, s2.a);
  const d4 = cross(s1.a, s1.b, s2.b);

  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    return true;
  }

  // Collinear / endpoint-touching cases
  if (d1 === 0 && onSegment(s2.a, s2.b, s1.a)) return true;
  if (d2 === 0 && onSegment(s2.a, s2.b, s1.b)) return true;
  if (d3 === 0 && onSegment(s1.a, s1.b, s2.a)) return true;
  if (d4 === 0 && onSegment(s1.a, s1.b, s2.b)) return true;

  return false;
}

/**
 * Intersection point of two segments, or null if they don't intersect.
 * Parallel (including collinear-overlapping) segments return null.
 */
export function segmentIntersection(s1: Segment, s2: Segment): Vec2 | null {
  const dx1 = s1.b.x - s1.a.x;
  const dy1 = s1.b.y - s1.a.y;
  const dx2 = s2.b.x - s2.a.x;
  const dy2 = s2.b.y - s2.a.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < EPSILON) return null; // parallel

  const t = ((s2.a.x - s1.a.x) * dy2 - (s2.a.y - s1.a.y) * dx2) / denom;
  const u = ((s2.a.x - s1.a.x) * dy1 - (s2.a.y - s1.a.y) * dx1) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: s1.a.x + t * dx1, y: s1.a.y + t * dy1 };
  }
  return null;
}

/** Point-in-polygon test (ray casting). Points exactly on an edge may go either way. */
export function pointInPolygon(point: Vec2, polygon: Polygon): boolean {
  const n = polygon.length;
  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const vi = polygon[i];
    const vj = polygon[j];
    if (!vi || !vj) continue;

    if (
      (vi.y > point.y) !== (vj.y > point.y) &&
      point.x < ((vj.x - vi.x) * (point.y - vi.y)) / (vj.y - vi.y) + vi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Whether a segment intersects a closed polygon: crosses any edge, or has
 * either endpoint inside (covers segments fully contained in the polygon).
 */
export function segmentIntersectsPolygon(seg: Segment, polygon: Polygon): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  for (let i = 0; i < n; i++) {
    const vi = polygon[i];
    const vj = polygon[(i + 1) % n];
    if (!vi || !vj) continue;
    if (segmentsIntersect(seg, { a: vi, b: vj })) return true;
  }

  return pointInPolygon(seg.a, polygon) || pointInPolygon(seg.b, polygon);
}

/** Closest intersection point (to seg.a) of a segment with a polygon's edges, or null. */
export function firstPolygonIntersection(seg: Segment, polygon: Polygon): Vec2 | null {
  let closest: Vec2 | null = null;
  let closestDistSq = Infinity;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const vi = polygon[i];
    const vj = polygon[(i + 1) % n];
    if (!vi || !vj) continue;

    const pt = segmentIntersection(seg, { a: vi, b: vj });
    if (pt) {
      const dx = pt.x - seg.a.x;
      const dy = pt.y - seg.a.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < closestDistSq) {
        closestDistSq = distSq;
        closest = pt;
      }
    }
  }
  return closest;
}

/**
 * Whether a segment passes through a circle's interior (line-segment vs
 * circle via the quadratic). Mere tangent grazes are not counted.
 */
export function segmentIntersectsCircle(seg: Segment, circle: Circle): boolean {
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const fx = seg.a.x - circle.center.x;
  const fy = seg.a.y - circle.center.y;

  const a = dx * dx + dy * dy;
  if (a < EPSILON) {
    // Degenerate segment: a point. Inside the circle counts as intersecting.
    return fx * fx + fy * fy < circle.radius * circle.radius;
  }

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - circle.radius * circle.radius;

  let discriminant = b * b - 4 * a * c;
  if (discriminant <= 0) return false; // miss or tangent

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  // Some part of [0,1] lies strictly inside the circle.
  return t1 < 1 && t2 > 0;
}

// ---------------------------------------------------------------------------
// Line of sight
// ---------------------------------------------------------------------------

/** A piece of sight-blocking terrain: id + footprint polygon (in inches). */
export interface LosBlocker {
  id: string;
  footprint: Polygon;
}

export interface LosResult {
  clear: boolean;
  /** Ids of every blocker the sight line passes through. */
  blockingIds: string[];
  /** Closest point (to `from`) where the sight line enters a blocker, if blocked. */
  firstIntersection: Vec2 | null;
}

/** Check a single sight line from `from` to `to` against blocking footprints. */
export function checkLineOfSight(
  from: Vec2,
  to: Vec2,
  blockers: readonly LosBlocker[],
): LosResult {
  const seg: Segment = { a: from, b: to };
  const blockingIds: string[] = [];
  let firstIntersection: Vec2 | null = null;
  let bestDistSq = Infinity;

  for (const blocker of blockers) {
    if (!segmentIntersectsPolygon(seg, blocker.footprint)) continue;
    blockingIds.push(blocker.id);

    const pt = firstPolygonIntersection(seg, blocker.footprint);
    if (pt) {
      const dx = pt.x - from.x;
      const dy = pt.y - from.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        firstIntersection = pt;
      }
    }
  }

  return { clear: blockingIds.length === 0, blockingIds, firstIntersection };
}

/**
 * Sample sight lines between two round bases: center-to-center plus the two
 * edge-to-edge lines perpendicular to the center line. If the centers
 * coincide, only the (degenerate) center line is returned.
 */
export function sightLinesBetweenBases(observer: Circle, target: Circle): Segment[] {
  const centerLine: Segment = { a: observer.center, b: target.center };

  const dx = target.center.x - observer.center.x;
  const dy = target.center.y - observer.center.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < EPSILON) return [centerLine];

  // Unit vector perpendicular to the center line.
  const px = -dy / len;
  const py = dx / len;

  const left: Segment = {
    a: { x: observer.center.x + px * observer.radius, y: observer.center.y + py * observer.radius },
    b: { x: target.center.x + px * target.radius, y: target.center.y + py * target.radius },
  };
  const right: Segment = {
    a: { x: observer.center.x - px * observer.radius, y: observer.center.y - py * observer.radius },
    b: { x: target.center.x - px * target.radius, y: target.center.y - py * target.radius },
  };

  return [centerLine, left, right];
}

/**
 * Whether any part of the target base can be seen from the observer base:
 * true if at least one sampled sight line is clear of every blocking
 * footprint and every intervening base (e.g. other models' bases).
 */
export function isBaseVisible(
  observer: Circle,
  target: Circle,
  blockers: readonly LosBlocker[],
  interveningBases: readonly Circle[] = [],
): boolean {
  for (const line of sightLinesBetweenBases(observer, target)) {
    const terrainBlocked = blockers.some((b) =>
      segmentIntersectsPolygon(line, b.footprint),
    );
    if (terrainBlocked) continue;

    const baseBlocked = interveningBases.some((c) => segmentIntersectsCircle(line, c));
    if (!baseBlocked) return true;
  }
  return false;
}
