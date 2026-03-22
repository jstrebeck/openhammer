import type { Model, Unit, GameState } from '../types/index';
import type { TerrainPiece } from '../types/terrain';
import { pointInPolygon } from '../los/index';
import { checkLineOfSight } from '../los/index';

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
 * - **Woods (area terrain)**: Cover if wholly within OR LoS passes through
 * - **Ruins (area terrain)**: Cover if wholly within OR LoS passes through
 * - **Barricades (obstacle)**: Cover if within 3" AND not fully visible
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

  // Check 1: Is any target model wholly within area terrain that grants cover?
  for (const target of targetModels) {
    for (const terrain of terrainPieces) {
      if (!isModelWhollyWithin(target, terrain)) continue;

      // Woods, Ruins, Craters — grant cover if wholly within
      const grantsCover = terrain.traits.some((t) =>
        t === 'obscuring' || t === 'dense',
      );

      if (grantsCover) {
        result.hasCover = true;
        result.reason = `Wholly within ${terrain.label || 'terrain'}`;
        result.saveModifier = 1;
        if (!result.coverTerrainIds.includes(terrain.id)) {
          result.coverTerrainIds.push(terrain.id);
        }
      }
    }
  }

  // Check 2: Does LoS from any attacker to any target pass through dense terrain?
  if (!result.hasCover) {
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
  }

  return result;
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
