import type { Point } from '../types/geometry';
import type { Model } from '../types/index';

/** Euclidean distance between two points */
export function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distance between two model bases (closest edge to closest edge).
 * Warhammer measures base-to-base, not center-to-center.
 */
export function distanceBetweenModels(a: Model, b: Model): number {
  const centerDist = distance(a.position, b.position);
  const edgeDist = centerDist - a.baseSizeInches / 2 - b.baseSizeInches / 2;
  return Math.max(0, edgeDist);
}

/** Check if a model's base is within `inches` of a target point (edge to point) */
export function isWithinRange(model: Model, target: Point, inches: number): boolean {
  const dist = distance(model.position, target) - model.baseSizeInches / 2;
  return dist <= inches;
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
