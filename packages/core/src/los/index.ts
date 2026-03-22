import type { Point } from '../types/geometry';
import type { Model } from '../types/index';
import type { TerrainPiece } from '../types/terrain';

export interface LoSResult {
  clear: boolean;
  blockingTerrainIds: string[];
  denseTerrainIds: string[];   // Terrain that imposes penalties but doesn't fully block
  intersectionPoint: Point | null; // First point where LoS is blocked
}

/**
 * Check line of sight between two models considering terrain.
 *
 * LoS is drawn center-to-center. Terrain blocks LoS based on traits:
 * - "obscuring": Fully blocks LoS if terrain height >= both models' effective height
 *   (models are assumed to be ground level — height = 0 for simplicity in 2D).
 *   In practice, obscuring terrain blocks LoS if the ray passes through it and
 *   both models are not taller than the terrain (we use a simple 2D check:
 *   if terrain is obscuring and the segment intersects the polygon, it blocks).
 * - "dense": Does not block LoS but the terrain ID is reported for hit penalty application.
 */
export function checkLineOfSight(
  from: Model,
  to: Model,
  terrain: Record<string, TerrainPiece>,
): LoSResult {
  const result: LoSResult = {
    clear: true,
    blockingTerrainIds: [],
    denseTerrainIds: [],
    intersectionPoint: null,
  };

  const seg: [Point, Point] = [from.position, to.position];

  for (const piece of Object.values(terrain)) {
    if (!segmentIntersectsPolygon(seg, piece.polygon)) continue;

    if (piece.traits.includes('obscuring')) {
      result.clear = false;
      result.blockingTerrainIds.push(piece.id);
      if (!result.intersectionPoint) {
        result.intersectionPoint = firstIntersectionPoint(seg, piece.polygon);
      }
    }

    if (piece.traits.includes('dense')) {
      result.denseTerrainIds.push(piece.id);
    }
  }

  return result;
}

/**
 * Test whether a line segment intersects a closed polygon.
 * Uses edge-by-edge segment intersection test.
 * Also returns true if either endpoint is inside the polygon.
 */
export function segmentIntersectsPolygon(
  seg: [Point, Point],
  polygon: Point[],
): boolean {
  const n = polygon.length;
  if (n < 3) return false;

  // Check if segment crosses any polygon edge
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (segmentsIntersect(seg[0], seg[1], polygon[i], polygon[j])) {
      return true;
    }
  }

  // Check if either endpoint is inside the polygon
  if (pointInPolygon(seg[0], polygon) || pointInPolygon(seg[1], polygon)) {
    return true;
  }

  return false;
}

/**
 * Test whether two line segments (p1-p2) and (p3-p4) intersect.
 * Uses the cross-product orientation method.
 */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  // Collinear cases
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;

  return false;
}

/** Point-in-polygon test using ray casting */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  const n = polygon.length;
  let inside = false;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    if ((yi > point.y) !== (yj > point.y) &&
        point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

/** Find the first intersection point of a segment with a polygon (closest to seg[0]) */
function firstIntersectionPoint(seg: [Point, Point], polygon: Point[]): Point | null {
  let closest: Point | null = null;
  let closestDist = Infinity;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const pt = segmentIntersectionPoint(seg[0], seg[1], polygon[i], polygon[j]);
    if (pt) {
      const dx = pt.x - seg[0].x;
      const dy = pt.y - seg[0].y;
      const dist = dx * dx + dy * dy;
      if (dist < closestDist) {
        closestDist = dist;
        closest = pt;
      }
    }
  }

  return closest;
}

/** Compute the intersection point of two segments, or null if they don't intersect */
function segmentIntersectionPoint(
  p1: Point, p2: Point, p3: Point, p4: Point,
): Point | null {
  const dx1 = p2.x - p1.x;
  const dy1 = p2.y - p1.y;
  const dx2 = p4.x - p3.x;
  const dy2 = p4.y - p3.y;

  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null; // parallel

  const t = ((p3.x - p1.x) * dy2 - (p3.y - p1.y) * dx2) / denom;
  const u = ((p3.x - p1.x) * dy1 - (p3.y - p1.y) * dx1) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1.x + t * dx1,
      y: p1.y + t * dy1,
    };
  }

  return null;
}

/** Cross product of vectors (b-a) and (c-a) */
function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** Check if point p is on segment (a, b), assuming collinearity */
function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a.x, b.x) <= p.x + 1e-10 &&
    p.x <= Math.max(a.x, b.x) + 1e-10 &&
    Math.min(a.y, b.y) <= p.y + 1e-10 &&
    p.y <= Math.max(a.y, b.y) + 1e-10
  );
}
