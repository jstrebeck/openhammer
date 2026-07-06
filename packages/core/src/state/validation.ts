import type { Circle, Polygon, Vec2 } from '../types/geometry.js';
import type { GameState, ModelState, PlayerIndex, UnitId, UnitState } from '../types/state.js';
import type { RulesContent } from './env.js';
import { baseCircle, edgeToEdgeDistance } from '../measurement/index.js';
import { checkLineOfSight, pointInPolygon, type LosBlocker } from '../los/index.js';

/**
 * Spatial game checks shared by the setup/movement/shooting reducers.
 * All 2D for now (heights land with true-LoS work); distances in inches.
 */

export function modelBase(
  content: RulesContent,
  unit: UnitState,
  model: ModelState,
  position?: Vec2,
): Circle | null {
  const pos = position ?? model.position;
  if (!pos) return null;
  const ds = content.getDatasheet(unit.datasheetId);
  const profile = ds?.models.find((p) => p.id === model.profileId) ?? ds?.models[0];
  const diameter = profile?.baseSizeMm ?? 25;
  return baseCircle(pos, diameter);
}

export function aliveModels(unit: UnitState): ModelState[] {
  return unit.models.filter((m) => !m.destroyed);
}

export function unitBases(
  content: RulesContent,
  unit: UnitState,
): { model: ModelState; base: Circle }[] {
  const out: { model: ModelState; base: Circle }[] = [];
  for (const model of aliveModels(unit)) {
    const base = modelBase(content, unit, model);
    if (base) out.push({ model, base });
  }
  return out;
}

export function unitIsOnBattlefield(unit: UnitState): boolean {
  return aliveModels(unit).some((m) => m.position !== null);
}

/** Minimum edge-to-edge distance between two units' deployed models. */
export function unitDistance(
  content: RulesContent,
  a: UnitState,
  b: UnitState,
): number | null {
  let min: number | null = null;
  for (const { base: ba } of unitBases(content, a)) {
    for (const { base: bb } of unitBases(content, b)) {
      const d = edgeToEdgeDistance(ba, bb);
      if (min === null || d < min) min = d;
    }
  }
  return min;
}

export function isInEngagementRange(
  state: GameState,
  content: RulesContent,
  unitId: UnitId,
): boolean {
  const unit = state.units[unitId];
  if (!unit) return false;
  const er = content.edition.parameters.engagementRangeHorizontal;
  for (const other of Object.values(state.units)) {
    if (other.owner === unit.owner || !unitIsOnBattlefield(other)) continue;
    const d = unitDistance(content, unit, other);
    if (d !== null && d <= er) return true;
  }
  return false;
}

/** Would these proposed positions put the unit within ER of any enemy? */
export function positionsInEngagementRange(
  state: GameState,
  content: RulesContent,
  unit: UnitState,
  positions: { modelId: string; x: number; y: number }[],
): boolean {
  const er = content.edition.parameters.engagementRangeHorizontal;
  for (const p of positions) {
    const model = unit.models.find((m) => m.id === p.modelId);
    if (!model || model.destroyed) continue;
    const base = modelBase(content, unit, model, { x: p.x, y: p.y });
    if (!base) continue;
    for (const other of Object.values(state.units)) {
      if (other.owner === unit.owner) continue;
      for (const { base: enemyBase } of unitBases(content, other)) {
        if (edgeToEdgeDistance(base, enemyBase) <= er) return true;
      }
    }
  }
  return false;
}

/** Base centers must sit inside the zone polygon (edge overhang: later). */
export function positionsInZone(
  positions: { x: number; y: number }[],
  zone: Polygon,
): boolean {
  return positions.every((p) => pointInPolygon({ x: p.x, y: p.y }, zone));
}

export function positionsOnBoard(
  state: GameState,
  positions: { x: number; y: number }[],
): boolean {
  return positions.every(
    (p) => p.x >= 0 && p.x <= state.board.width && p.y >= 0 && p.y <= state.board.height,
  );
}

/** Overlap against every other deployed model (and within the batch). */
export function positionsOverlap(
  state: GameState,
  content: RulesContent,
  unit: UnitState,
  positions: { modelId: string; x: number; y: number }[],
): boolean {
  const proposed: Circle[] = [];
  for (const p of positions) {
    const model = unit.models.find((m) => m.id === p.modelId);
    if (!model || model.destroyed) continue;
    const base = modelBase(content, unit, model, { x: p.x, y: p.y });
    if (base) proposed.push(base);
  }
  for (let i = 0; i < proposed.length; i++) {
    for (let j = i + 1; j < proposed.length; j++) {
      if (edgeToEdgeDistance(proposed[i]!, proposed[j]!) < -1e-6) return true;
    }
  }
  for (const other of Object.values(state.units)) {
    for (const { model, base } of unitBases(content, other)) {
      // Skip the moving unit's own models being replaced by new positions.
      if (other.id === unit.id && positions.some((p) => p.modelId === model.id)) continue;
      for (const c of proposed) {
        if (edgeToEdgeDistance(c, base) < -1e-6) return true;
      }
    }
  }
  return false;
}

/**
 * Unit coherency at proposed positions: every model within the coherency
 * distance (edge-to-edge) of ≥1 other model (≥2 for units of 7+ models).
 */
export function checkCoherency(
  content: RulesContent,
  unit: UnitState,
  positions: { modelId: string; x: number; y: number }[],
): boolean {
  const params = content.edition.parameters;
  const bases: Circle[] = [];
  for (const p of positions) {
    const model = unit.models.find((m) => m.id === p.modelId);
    if (!model || model.destroyed) continue;
    const base = modelBase(content, unit, model, { x: p.x, y: p.y });
    if (base) bases.push(base);
  }
  if (bases.length <= 1) return true;
  const needed = bases.length >= params.coherencyTwoNeighboursAt ? 2 : 1;
  return bases.every((base, i) => {
    let neighbours = 0;
    bases.forEach((other, j) => {
      if (i !== j && edgeToEdgeDistance(base, other) <= params.coherencyDistanceHorizontal) {
        neighbours++;
      }
    });
    return neighbours >= needed;
  });
}

/**
 * 10e visibility, milestone-2 form: center-to-center sight line blocked by
 * the footprint of terrain with the `ruins` trait (ruins block through
 * their footprint regardless of the mesh). Heights/Towering come later.
 */
export function unitVisible(
  state: GameState,
  content: RulesContent,
  fromUnit: UnitState,
  toUnit: UnitState,
): boolean {
  const ruins = state.board.terrain.filter((t) => t.traits.includes('ruins'));
  for (const { base: from } of unitBases(content, fromUnit)) {
    for (const { base: to } of unitBases(content, toUnit)) {
      // A ruin blocks only when the sight line crosses a footprint that
      // contains NEITHER endpoint (you can see into and out of ruins,
      // never through them).
      const relevant: LosBlocker[] = ruins
        .filter(
          (t) =>
            !pointInPolygon(from.center, t.footprint) &&
            !pointInPolygon(to.center, t.footprint),
        )
        .map((t) => ({ id: t.id, footprint: t.footprint }));
      if (checkLineOfSight(from.center, to.center, relevant).clear) return true;
    }
  }
  return false;
}

export function enemyOf(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}
