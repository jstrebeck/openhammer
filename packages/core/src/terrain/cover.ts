import type { Model, Unit, GameState } from '../types/index';
import type { TerrainPiece } from '../types/terrain';
import { pointInPolygon } from '../los/index';
import { checkLineOfSight, isModelFullyVisible } from '../los/index';
import { distanceToPoint } from '../measurement/index';

/**
 * Cover status for a target unit against a shooting attack.
 */
export interface CoverResult {
  /** Whether the target has Benefit of Cover */
  hasCover: boolean;
  /** Why the target has cover (for UI display) */
  reason: string;
  /** Save modifier from cover (+1 to save) */
  saveModifier: number;
  /** Terrain pieces providing cover */
  coverTerrainIds: string[];
}

/**
 * Check if a model is wholly within a terrain piece's polygon.
 * "Wholly within" means the model's entire base is inside the polygon.
 * Simplified: we check the center point (a full base-in-polygon check would
 * require offsetting the polygon inward by the base radius).
 */
export function isModelWhollyWithin(model: Model, terrain: TerrainPiece): boolean {
  return pointInPolygon(model.position, terrain.polygon);
}

/**
 * Determine if a target unit has Benefit of Cover from terrain
 * when being shot at by an attacking unit.
 *
 * 10th Edition cover rules by terrain type:
 * - **Craters/Rubble (area terrain)**: Cover if wholly within
 * - **Hills**: Cover if not fully visible to every model in attacking unit
 * - **Battlefield Debris (obstacle)**: Cover if not fully visible
 * - **Woods (area terrain)**: Cover if wholly within OR LoS passes through dense;
 *   models wholly within are never considered fully visible
 * - **Ruins (area terrain)**: Cover if wholly within OR not fully visible;
 *   cannot see through/over (except AIRCRAFT/TOWERING)
 * - **Barricades (obstacle)**: Cover if within 3" and not fully visible;
 *   can fight across within 2"
 *
 * Simplified: we check if target models are inside terrain polygons
 * or if LoS passes through terrain with relevant traits.
 */
export function determineCover(
  attackingUnit: Unit,
  targetUnit: Unit,
  state: GameState,
): CoverResult {
  const result: CoverResult = {
    hasCover: false,
    reason: '',
    saveModifier: 0,
    coverTerrainIds: [],
  };

  const attackerModels = attackingUnit.modelIds
    .map((id) => state.models[id])
    .filter((m): m is Model => m != null && m.status === 'active');
  const targetModels = targetUnit.modelIds
    .map((id) => state.models[id])
    .filter((m): m is Model => m != null && m.status === 'active');

  if (attackerModels.length === 0 || targetModels.length === 0) return result;

  const terrainPieces = Object.values(state.terrain);
  const allModels = Object.values(state.models).filter(m => m.status === 'active');

  // Check 1: Craters/Rubble & any area terrain with cover traits — wholly within
  for (const target of targetModels) {
    for (const terrain of terrainPieces) {
      if (!isModelWhollyWithin(target, terrain)) continue;

      const terrainType = terrain.terrainType ?? 'area_terrain';

      // Craters/Rubble: cover if wholly within (any area terrain)
      if (terrainType === 'area_terrain') {
        // Woods, Ruins, Craters — grant cover if wholly within
        // Even craters without obscuring/dense still grant cover when wholly within
        const isCraterOrRubble = terrain.label.toLowerCase().includes('crater') ||
          terrain.label.toLowerCase().includes('rubble');
        const hasCoverTraits = terrain.traits.some(t => t === 'obscuring' || t === 'dense');

        if (hasCoverTraits || isCraterOrRubble) {
          result.hasCover = true;
          result.reason = `Wholly within ${terrain.label || 'terrain'}`;
          result.saveModifier = 1;
          if (!result.coverTerrainIds.includes(terrain.id)) {
            result.coverTerrainIds.push(terrain.id);
          }
        }
      }
    }
  }

  if (result.hasCover) return result;

  // Check 2: Hills — cover if target not fully visible
  for (const terrain of terrainPieces) {
    const terrainType = terrain.terrainType ?? 'area_terrain';
    if (terrainType !== 'hill') continue;

    // Check if any target model is near the hill and not fully visible
    for (const target of targetModels) {
      for (const attacker of attackerModels) {
        const fullyVisible = isModelFullyVisible(
          attacker, target, state.terrain, allModels, attackingUnit, targetUnit,
        );
        if (!fullyVisible) {
          result.hasCover = true;
          result.reason = `Not fully visible (${terrain.label || 'Hill'})`;
          result.saveModifier = 1;
          if (!result.coverTerrainIds.includes(terrain.id)) {
            result.coverTerrainIds.push(terrain.id);
          }
        }
      }
    }
  }

  if (result.hasCover) return result;

  // Check 3: Battlefield Debris (obstacle) — cover if not fully visible
  for (const terrain of terrainPieces) {
    const terrainType = terrain.terrainType ?? 'area_terrain';
    if (terrainType !== 'obstacle') continue;
    if (terrain.traits.includes('defensible') && terrain.label.toLowerCase().includes('barricade')) {
      // Barricades handled separately below
      continue;
    }

    for (const target of targetModels) {
      for (const attacker of attackerModels) {
        const fullyVisible = isModelFullyVisible(
          attacker, target, state.terrain, allModels, attackingUnit, targetUnit,
        );
        if (!fullyVisible) {
          result.hasCover = true;
          result.reason = `Not fully visible (${terrain.label || 'Obstacle'})`;
          result.saveModifier = 1;
          if (!result.coverTerrainIds.includes(terrain.id)) {
            result.coverTerrainIds.push(terrain.id);
          }
        }
      }
    }
  }

  if (result.hasCover) return result;

  // Check 4: Barricade — cover if within 3" AND not fully visible
  for (const terrain of terrainPieces) {
    const isBarricade = terrain.traits.includes('defensible') &&
      (terrain.terrainType === 'obstacle' || terrain.label.toLowerCase().includes('barricade'));
    if (!isBarricade) continue;

    for (const target of targetModels) {
      // Must be within 3" of the barricade
      const distToBarricade = distanceToTerrainEdge(target, terrain);
      if (distToBarricade > 3) continue;

      for (const attacker of attackerModels) {
        const fullyVisible = isModelFullyVisible(
          attacker, target, state.terrain, allModels, attackingUnit, targetUnit,
        );
        if (!fullyVisible) {
          result.hasCover = true;
          result.reason = `Within 3" of ${terrain.label || 'Barricade'} and not fully visible`;
          result.saveModifier = 1;
          if (!result.coverTerrainIds.includes(terrain.id)) {
            result.coverTerrainIds.push(terrain.id);
          }
        }
      }
    }
  }

  if (result.hasCover) return result;

  // Check 5: LoS passes through dense terrain (Woods, etc.)
  for (const attacker of attackerModels) {
    for (const target of targetModels) {
      const los = checkLineOfSight(attacker, target, state.terrain);
      if (los.denseTerrainIds.length > 0) {
        result.hasCover = true;
        result.reason = 'LoS passes through dense terrain';
        result.saveModifier = 1;
        for (const id of los.denseTerrainIds) {
          if (!result.coverTerrainIds.includes(id)) {
            result.coverTerrainIds.push(id);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Simplified distance from a model to the nearest edge of terrain.
 * Uses the closest polygon edge.
 */
function distanceToTerrainEdge(model: Model, terrain: TerrainPiece): number {
  // If model is inside terrain, distance is 0
  if (pointInPolygon(model.position, terrain.polygon)) return 0;

  let minDist = Infinity;
  const n = terrain.polygon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = pointToSegmentDistance(model.position, terrain.polygon[i], terrain.polygon[j]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Distance from a point to the closest point on a line segment */
function pointToSegmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);

  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = a.x + t * dx;
  const closestY = a.y + t * dy;
  return Math.sqrt((p.x - closestX) ** 2 + (p.y - closestY) ** 2);
}

// ===== Sprint M: Terrain Visibility Rules =====

/**
 * Check if a model in Woods terrain is "never fully visible".
 * Models wholly within Woods are never considered fully visible.
 */
export function isModelInWoods(model: Model, terrain: Record<string, TerrainPiece>): boolean {
  for (const piece of Object.values(terrain)) {
    if (!piece.traits.includes('dense')) continue;
    if (piece.terrainType !== 'area_terrain' && piece.terrainType !== undefined) continue;
    if (isModelWhollyWithin(model, piece)) return true;
  }
  return false;
}

/**
 * Check if LoS between two models passes through Ruins terrain.
 * Cannot see through/over Ruins (except AIRCRAFT/TOWERING).
 */
export function doesLoSPassThroughRuins(
  from: Model,
  to: Model,
  terrain: Record<string, TerrainPiece>,
): boolean {
  const los = checkLineOfSight(from, to, terrain);
  if (!los.clear) {
    // Check if any blocking terrain is Ruins
    for (const blockingId of los.blockingTerrainIds) {
      const piece = terrain[blockingId];
      if (piece && piece.traits.includes('ruins')) return true;
    }
  }
  return false;
}

/**
 * Check if melee combat can occur across a barricade.
 * Models can fight across a barricade if within 2".
 */
export function canFightAcrossBarricade(
  attackerModel: Model,
  targetModel: Model,
  terrain: Record<string, TerrainPiece>,
): boolean {
  for (const piece of Object.values(terrain)) {
    const isBarricade = piece.traits.includes('defensible') &&
      (piece.terrainType === 'obstacle' || piece.label.toLowerCase().includes('barricade'));
    if (!isBarricade) continue;

    // Both models must be within 2" of the barricade
    const attackerDist = distanceToTerrainEdge(attackerModel, piece);
    const targetDist = distanceToTerrainEdge(targetModel, piece);
    if (attackerDist <= 2 && targetDist <= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Apply Benefit of Cover to a save roll.
 *
 * Rules:
 * - +1 to armour save vs ranged attacks
 * - Does NOT apply to models with Save 3+ or better against AP 0 attacks
 * - Multiple instances are not cumulative
 *
 * Returns the modified save characteristic.
 */
export function applyBenefitOfCover(
  saveCharacteristic: number,
  ap: number,
  hasCover: boolean,
  ignoresCover: boolean,
): number {
  if (!hasCover) return saveCharacteristic;
  if (ignoresCover) return saveCharacteristic;

  // Cover doesn't help models with 3+ or better save vs AP 0
  if (saveCharacteristic <= 3 && ap === 0) return saveCharacteristic;

  // +1 to save (lower number = better save)
  return saveCharacteristic - 1;
}
