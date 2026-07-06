import type { Circle, Polygon, Vec2 } from '../types/geometry.js';
import { pointInPolygon } from '../los/index.js';

/**
 * Pure measurement helpers. All distances are in inches (1 board unit = 1").
 *
 * Base sizes in game data are given in mm (a "32mm base" is its diameter);
 * convert once at the boundary with mmToInches/baseRadiusInches and work in
 * inches everywhere else — same convention as v1's baseSizeMm/baseSizeInches.
 *
 * Tabletop measuring conventions encoded here:
 * - Distances between models are edge-to-edge (base radius subtracted from
 *   the center-to-center distance), never negative.
 * - "Within X inches" is inclusive: exactly X counts as within (<=).
 *
 * Intentional change from v1: these helpers operate on plain geometry
 * (Circle = base position + radius in inches) instead of the Model type, and
 * the v1 oval/rect base-shape support was not ported — v2 models all round
 * bases for now.
 */

export const MM_PER_INCH = 25.4;

/** Convert millimetres to inches. */
export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

/** Radius in inches of a round base given its diameter in mm (32 → ~0.6299"). */
export function baseRadiusInches(diameterMm: number): number {
  return mmToInches(diameterMm) / 2;
}

/** Build a base Circle from a board position and a base diameter in mm. */
export function baseCircle(center: Vec2, diameterMm: number): Circle {
  return { center, radius: baseRadiusInches(diameterMm) };
}

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Edge-to-edge distance between two round bases.
 * Returns 0 if the bases touch or overlap.
 */
export function edgeToEdgeDistance(a: Circle, b: Circle): number {
  return Math.max(0, distance(a.center, b.center) - a.radius - b.radius);
}

/**
 * Distance from a round base's edge to a point.
 * Returns 0 if the point is on or inside the base.
 */
export function baseToPointDistance(base: Circle, point: Vec2): number {
  return Math.max(0, distance(base.center, point) - base.radius);
}

/** Whether two bases are within `inches` of each other, edge-to-edge (inclusive). */
export function basesWithin(a: Circle, b: Circle, inches: number): boolean {
  return edgeToEdgeDistance(a, b) <= inches;
}

/** Whether a base's edge is within `inches` of a point (inclusive). */
export function baseWithinOfPoint(base: Circle, point: Vec2, inches: number): boolean {
  return baseToPointDistance(base, point) <= inches;
}

/** Whether two points are within `inches` of each other (inclusive). */
export function pointsWithin(a: Vec2, b: Vec2, inches: number): boolean {
  return distance(a, b) <= inches;
}

/** Distance from a point to the closest point on segment (a, b). */
export function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(p, a); // degenerate segment

  // Project p onto the segment, clamped to [0, 1].
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/**
 * Distance from a point to a polygon (terrain footprint, zone, etc.).
 * Returns 0 if the point is inside the polygon; otherwise the distance to the
 * nearest edge.
 */
export function pointToPolygonDistance(point: Vec2, polygon: Polygon): number {
  const n = polygon.length;
  if (n === 0) return Infinity;
  const first = polygon[0];
  if (n === 1) return first ? distance(point, first) : Infinity;

  if (n >= 3 && pointInPolygon(point, polygon)) return 0;

  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const vi = polygon[i];
    const vj = polygon[(i + 1) % n];
    if (!vi || !vj) continue;
    min = Math.min(min, pointToSegmentDistance(point, vi, vj));
  }
  return min;
}

/**
 * Distance from a round base's edge to a polygon.
 * Returns 0 if the base touches or overlaps the polygon.
 */
export function baseToPolygonDistance(base: Circle, polygon: Polygon): number {
  return Math.max(0, pointToPolygonDistance(base.center, polygon) - base.radius);
}

/** Whether a base is within `inches` of a polygon, edge-to-edge (inclusive). */
export function baseWithinOfPolygon(base: Circle, polygon: Polygon, inches: number): boolean {
  return baseToPolygonDistance(base, polygon) <= inches;
}
