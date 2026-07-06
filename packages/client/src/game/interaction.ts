import type { Datasheet, ModelState, UnitState, Vec2 } from '@openhammer/core';

/**
 * Client-side interaction state machine. Only DEPLOYING carries real client
 * state: moving is derived from the authoritative state.pendingMove, and the
 * mode here just remembers what the user asked for so the UI can label it.
 */
export type Interaction =
  | { mode: 'idle' }
  | { mode: 'deploying'; unitId: string }
  | { mode: 'moving'; unitId: string; kind: 'normal' | 'advance' | 'fallBack' }
  | { mode: 'targeting'; unitId: string };

export const IDLE: Interaction = { mode: 'idle' };

export function baseRadiusInches(baseSizeMm: number): number {
  return baseSizeMm / 25.4 / 2;
}

export function profileFor(
  datasheet: Datasheet | undefined,
  model: ModelState,
): Datasheet['models'][number] | undefined {
  return datasheet?.models.find((p) => p.id === model.profileId) ?? datasheet?.models[0];
}

export function baseDiameterInches(datasheet: Datasheet | undefined, model: ModelState): number {
  return (profileFor(datasheet, model)?.baseSizeMm ?? 25) / 25.4;
}

export function aliveModels(unit: UnitState): ModelState[] {
  return unit.models.filter((m) => !m.destroyed);
}

/**
 * Deploy ghost: alive models in a row centered on the cursor,
 * spacing = base diameter + 0.2".
 */
export function deployFormation(
  unit: UnitState,
  datasheet: Datasheet | undefined,
  cursor: Vec2,
): { modelId: string; x: number; y: number }[] {
  const alive = aliveModels(unit);
  if (alive.length === 0) return [];
  const diameter = baseDiameterInches(datasheet, alive[0]!);
  const spacing = diameter + 0.2;
  const width = (alive.length - 1) * spacing;
  return alive.map((m, i) => ({
    modelId: m.id,
    x: cursor.x - width / 2 + i * spacing,
    y: cursor.y,
  }));
}

export function unitCentroid(unit: UnitState): Vec2 | null {
  const placed = aliveModels(unit).filter((m) => m.position !== null);
  if (placed.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const m of placed) {
    x += m.position!.x;
    y += m.position!.y;
  }
  return { x: x / placed.length, y: y / placed.length };
}

/**
 * Move ghost: each model keeps its offset from the unit centroid; the whole
 * formation follows the cursor. The server validates distances.
 */
export function moveFormation(
  unit: UnitState,
  cursor: Vec2,
): { modelId: string; x: number; y: number }[] {
  const centroid = unitCentroid(unit);
  if (!centroid) return [];
  return aliveModels(unit)
    .filter((m) => m.position !== null)
    .map((m) => ({
      modelId: m.id,
      x: cursor.x + (m.position!.x - centroid.x),
      y: cursor.y + (m.position!.y - centroid.y),
    }));
}

/** Live distance readout: max over models of |from -> to|. */
export function maxMoveDistance(
  unit: UnitState,
  positions: { modelId: string; x: number; y: number }[],
): number {
  let max = 0;
  const byId = new Map(positions.map((p) => [p.modelId, p]));
  for (const m of aliveModels(unit)) {
    const to = byId.get(m.id);
    if (!to || !m.position) continue;
    const d = Math.hypot(to.x - m.position.x, to.y - m.position.y);
    if (d > max) max = d;
  }
  return max;
}
