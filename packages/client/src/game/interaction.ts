import type {
  Datasheet,
  GameState,
  ModelPlacement,
  ModelState,
  UnitState,
  Vec2,
} from '@openhammer/core';

/**
 * Client-side interaction state machine. Placement modes (deploying,
 * placingReserves, scouting) carry real client state; moving/charging/
 * engagement are derived from the authoritative state (pendingMove, charge,
 * fight) — the mode remembers what the user asked for plus any positions
 * staged by clicking the board, pending an explicit commit.
 */
export type Interaction =
  | { mode: 'idle' }
  | { mode: 'deploying'; unitId: string }
  | { mode: 'moving'; unitId: string; kind: 'normal' | 'advance' | 'fallBack' }
  | { mode: 'targeting'; unitId: string }
  | { mode: 'charging'; unitId: string; staged: ModelPlacement[] | null }
  | {
      mode: 'engagement';
      unitId: string;
      stage: 'pileIn' | 'consolidate';
      staged: ModelPlacement[] | null;
    }
  | { mode: 'scouting'; unitId: string; budget: number }
  | { mode: 'placingReserves'; unitId: string };

export const IDLE: Interaction = { mode: 'idle' };

/** Client-side prefilters only — the server measures authoritatively. */
export const CHARGE_RANGE_PREFILTER = 12.5;
export const ENGAGEMENT_RANGE_PREFILTER = 1.1;

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

/** The unit's alive, placed models as a "stay put" placements array. */
export function currentPositions(unit: UnitState): ModelPlacement[] {
  return aliveModels(unit)
    .filter((m) => m.position !== null)
    .map((m) => ({ modelId: m.id, x: m.position!.x, y: m.position!.y }));
}

/**
 * Approximate minimum edge-to-edge distance between two units' deployed
 * models (base radii from the content map; 25mm fallback). Prefilter only.
 */
export function unitEdgeDistance(
  a: UnitState,
  b: UnitState,
  datasheets: Record<string, Datasheet>,
): number | null {
  let min: number | null = null;
  const dsA = datasheets[a.datasheetId];
  const dsB = datasheets[b.datasheetId];
  for (const ma of aliveModels(a)) {
    if (!ma.position) continue;
    const ra = baseDiameterInches(dsA, ma) / 2;
    for (const mb of aliveModels(b)) {
      if (!mb.position) continue;
      const rb = baseDiameterInches(dsB, mb) / 2;
      const d =
        Math.hypot(mb.position.x - ma.position.x, mb.position.y - ma.position.y) - ra - rb;
      if (min === null || d < min) min = d;
    }
  }
  return min;
}

/** Enemy units with at least one model within `range` (edge-to-edge). */
export function enemiesWithin(
  game: GameState,
  unit: UnitState,
  datasheets: Record<string, Datasheet>,
  range: number,
): UnitState[] {
  return Object.values(game.units).filter((u) => {
    if (u.owner === unit.owner) return false;
    const d = unitEdgeDistance(unit, u, datasheets);
    return d !== null && d <= range;
  });
}

/** Charge-declaration prefilter (server validates authoritatively). */
export function canDeclareCharge(unit: UnitState): boolean {
  const f = unit.turnFlags;
  return (
    !f.chargeDeclared &&
    f.moveKind !== 'advance' &&
    f.moveKind !== 'fallBack' &&
    aliveModels(unit).some((m) => m.position !== null)
  );
}

/** Fight-selection prefilter, permissive mirror of the server's rules. */
export function canFightThisStep(
  game: GameState,
  unit: UnitState,
  datasheets: Record<string, Datasheet>,
): boolean {
  if (!aliveModels(unit).some((m) => m.position !== null)) return false;
  if (unit.turnFlags.hasFought) return false;
  if (game.fight?.fought.includes(unit.id)) return false;
  const engaged = enemiesWithin(game, unit, datasheets, ENGAGEMENT_RANGE_PREFILTER).length > 0;
  if (!engaged && unit.turnFlags.moveKind !== 'charge') return false;
  if (game.step === 'fightsFirst') {
    const ds = datasheets[unit.datasheetId];
    return (
      unit.turnFlags.fightsFirst ||
      (ds?.coreAbilities ?? []).some((a) => a.id === 'core.fights-first')
    );
  }
  return true;
}
