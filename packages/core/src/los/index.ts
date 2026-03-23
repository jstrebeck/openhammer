import type { Point } from '../types/geometry';
import type { Model, Unit, GameState } from '../types/index';
import type { TerrainPiece } from '../types/terrain';
import { distanceBetweenModels } from '../measurement/index';

export interface LoSResult {
  clear: boolean;
  blockingTerrainIds: string[];
  denseTerrainIds: string[];   // Terrain that imposes penalties but doesn't fully block
  intersectionPoint: Point | null; // First point where LoS is blocked
}

/** Visibility status for a model or unit */
export type VisibilityStatus = 'fully_visible' | 'partially_visible' | 'not_visible';

export interface VisibilityResult {
  status: VisibilityStatus;
  /** Per-model visibility (for unit checks) */
  modelVisibility?: Record<string, VisibilityStatus>;
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

// ===== Sprint J: Visibility & Targeting =====

/**
 * Check if a unit has AIRCRAFT or TOWERING keyword.
 * AIRCRAFT/TOWERING models can see and be seen through/over terrain that normally blocks LoS.
 */
function isAircraftOrTowering(unit: Unit): boolean {
  return unit.keywords.some(k => k === 'AIRCRAFT' || k === 'TOWERING');
}

/**
 * Check line of sight between two models, with AIRCRAFT/TOWERING exceptions.
 * AIRCRAFT/TOWERING models ignore terrain for LoS purposes (can see through/over).
 *
 * @param from - Observing model
 * @param to - Target model
 * @param terrain - All terrain on the board
 * @param fromUnit - Unit of the observing model (for keyword checks)
 * @param toUnit - Unit of the target model (for keyword checks)
 */
export function checkLineOfSightWithKeywords(
  from: Model,
  to: Model,
  terrain: Record<string, TerrainPiece>,
  fromUnit?: Unit,
  toUnit?: Unit,
): LoSResult {
  // If either model is AIRCRAFT/TOWERING, terrain doesn't block LoS
  if ((fromUnit && isAircraftOrTowering(fromUnit)) ||
      (toUnit && isAircraftOrTowering(toUnit))) {
    return {
      clear: true,
      blockingTerrainIds: [],
      denseTerrainIds: [],
      intersectionPoint: null,
    };
  }
  return checkLineOfSight(from, to, terrain);
}

/**
 * Check if a model is "fully visible" from an observer model.
 * A model is fully visible if every part of it is visible — simplified as:
 * LoS from observer to the target center is clear and no obscuring terrain blocks.
 *
 * Models in the observed unit do NOT block LoS to their own unit members.
 * Models in the observing unit do NOT block LoS from their own unit members.
 *
 * @param observer - The observing model
 * @param target - The target model being observed
 * @param terrain - Terrain on the board
 * @param allModels - All models in game (for intervening model checks)
 * @param observerUnit - Unit of the observer (for see-through-own-unit)
 * @param targetUnit - Unit of the target (for see-through-target-unit)
 */
export function isModelFullyVisible(
  observer: Model,
  target: Model,
  terrain: Record<string, TerrainPiece>,
  allModels: Model[],
  observerUnit?: Unit,
  targetUnit?: Unit,
): boolean {
  // AIRCRAFT/TOWERING: can see/be seen through terrain
  if ((observerUnit && isAircraftOrTowering(observerUnit)) ||
      (targetUnit && isAircraftOrTowering(targetUnit))) {
    return true;
  }

  // Check terrain LoS
  const los = checkLineOfSight(observer, target, terrain);
  if (!los.clear) return false;

  // Check if any intervening models block LoS (simplified: model base blocks)
  // Skip models in the observer's or target's own unit
  for (const model of allModels) {
    if (model.id === observer.id || model.id === target.id) continue;
    if (model.status !== 'active') continue;

    // Models in the observer's own unit don't block
    if (observerUnit && observerUnit.modelIds.includes(model.id)) continue;
    // Models in the target's own unit don't block (can see through for visibility check)
    if (targetUnit && targetUnit.modelIds.includes(model.id)) continue;

    // Check if this model's base intersects the LoS line
    const radius = model.baseSizeInches / 2;
    if (doesCircleIntersectSegment(model.position, radius, observer.position, target.position)) {
      return false;
    }
  }

  // If LoS passes through dense terrain (but not obscuring), model is visible but not "fully"
  // Dense terrain means you can see the target but not every part
  if (los.denseTerrainIds.length > 0) return false;

  return true;
}

/**
 * Check if a circle (model base) intersects a line segment (LoS ray).
 */
function doesCircleIntersectSegment(
  center: Point,
  radius: number,
  segStart: Point,
  segEnd: Point,
): boolean {
  const dx = segEnd.x - segStart.x;
  const dy = segEnd.y - segStart.y;
  const fx = segStart.x - center.x;
  const fy = segStart.y - center.y;

  const a = dx * dx + dy * dy;
  if (a < 1e-10) return false;

  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - radius * radius;

  let discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;

  discriminant = Math.sqrt(discriminant);
  const t1 = (-b - discriminant) / (2 * a);
  const t2 = (-b + discriminant) / (2 * a);

  return t1 < 1 && t2 > 0;
}

/**
 * Determine the visibility status of a target unit from an attacking unit.
 * "Fully Visible" = every model in the target unit is fully visible from every model in the attacking unit.
 * "Partially Visible" = at least one model is visible.
 * "Not Visible" = no models are visible.
 */
export function checkUnitVisibility(
  attackingUnit: Unit,
  targetUnit: Unit,
  state: GameState,
): VisibilityResult {
  const attackerModels = attackingUnit.modelIds
    .map(id => state.models[id])
    .filter((m): m is Model => m != null && m.status === 'active');
  const targetModels = targetUnit.modelIds
    .map(id => state.models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  if (attackerModels.length === 0 || targetModels.length === 0) {
    return { status: 'not_visible', modelVisibility: {} };
  }

  const allModels = Object.values(state.models).filter(m => m.status === 'active');
  const modelVis: Record<string, VisibilityStatus> = {};
  let allFullyVisible = true;
  let anyVisible = false;

  for (const target of targetModels) {
    let thisModelFullyVisible = true;
    let thisModelVisible = false;

    for (const attacker of attackerModels) {
      const los = checkLineOfSightWithKeywords(
        attacker, target, state.terrain, attackingUnit, targetUnit,
      );
      if (los.clear) {
        thisModelVisible = true;
        // Check full visibility (no intervening models, no dense terrain)
        const fullyVis = isModelFullyVisible(
          attacker, target, state.terrain, allModels, attackingUnit, targetUnit,
        );
        if (!fullyVis) {
          thisModelFullyVisible = false;
        }
      } else {
        thisModelFullyVisible = false;
      }
    }

    if (thisModelVisible) {
      anyVisible = true;
      modelVis[target.id] = thisModelFullyVisible ? 'fully_visible' : 'partially_visible';
    } else {
      modelVis[target.id] = 'not_visible';
    }
    if (!thisModelFullyVisible) allFullyVisible = false;
  }

  let status: VisibilityStatus;
  if (allFullyVisible && anyVisible) {
    status = 'fully_visible';
  } else if (anyVisible) {
    status = 'partially_visible';
  } else {
    status = 'not_visible';
  }

  return { status, modelVisibility: modelVis };
}

// ===== Engagement Range Targeting Restrictions =====

/**
 * Check if a target unit is a valid ranged attack target considering ER restrictions.
 *
 * Rules:
 * - Cannot target enemy units in Engagement Range of friendly units with ranged attacks
 * - Exception: Big Guns Never Tire (MONSTER/VEHICLE can shoot ranged at engaged enemies)
 * - Exception: Pistols can fire at enemies in ER
 * - Blast weapons cannot target units in ER of friendly units
 *
 * @returns Object with `allowed` flag and optional `reason` for denial
 */
export function canTargetWithRangedWeapon(
  attackingUnit: Unit,
  targetUnit: Unit,
  state: GameState,
  weapon: { abilities: string[]; type: string },
  engagementRange: number,
): { allowed: boolean; reason?: string } {
  // Only applies to ranged weapons
  if (weapon.type === 'melee') return { allowed: true };

  // Check if the target unit is in ER of any friendly (to the attacker) unit
  const targetModels = targetUnit.modelIds
    .map(id => state.models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  const targetInFriendlyER = isTargetInFriendlyEngagementRange(
    attackingUnit.playerId, targetModels, state, engagementRange,
  );

  if (!targetInFriendlyER) return { allowed: true };

  // Target IS in ER of friendly units — check exceptions

  // Check Blast restriction first — Blast weapons NEVER target units in ER of friendlies
  const isBlast = weapon.abilities.some(a => a.toUpperCase().includes('BLAST'));
  if (isBlast) {
    return { allowed: false, reason: 'Blast weapons cannot target units in Engagement Range of friendly units' };
  }

  // Pistol exception: can fire at enemies in ER
  const isPistol = weapon.abilities.some(a => a.toUpperCase().includes('PISTOL'));
  if (isPistol) return { allowed: true };

  // Big Guns Never Tire: MONSTER/VEHICLE can shoot ranged at engaged enemies
  const isBGNT = attackingUnit.keywords.some(k => k === 'MONSTER' || k === 'VEHICLE');
  if (isBGNT) return { allowed: true };

  return { allowed: false, reason: 'Cannot target units in Engagement Range of friendly units with ranged attacks' };
}

/**
 * Check if any model in targetModels is within engagement range of a friendly unit
 * (friendly to the attacking player).
 */
function isTargetInFriendlyEngagementRange(
  attackerPlayerId: string,
  targetModels: Model[],
  state: GameState,
  engagementRange: number,
): boolean {
  for (const targetModel of targetModels) {
    for (const otherModel of Object.values(state.models)) {
      if (otherModel.status !== 'active') continue;
      if (otherModel.id === targetModel.id) continue;
      const otherUnit = state.units[otherModel.unitId];
      if (!otherUnit) continue;
      // "Friendly" means belonging to the attacker's player
      if (otherUnit.playerId !== attackerPlayerId) continue;
      if (distanceBetweenModels(targetModel, otherModel) <= engagementRange) {
        return true;
      }
    }
  }
  return false;
}
