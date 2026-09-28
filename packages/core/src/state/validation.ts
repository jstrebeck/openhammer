import type { Circle, Polygon, Vec2 } from '../types/geometry.js';
import type { GameState, ModelState, PlayerIndex, UnitId, UnitState } from '../types/state.js';
import type { RulesContent } from './env.js';
import { baseCircle, edgeToEdgeDistance } from '../measurement/index.js';
import { checkLineOfSight, pointInPolygon, type LosBlocker } from '../los/index.js';
import { evalCondition } from '../effects/conditions.js';

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

/**
 * Does any active effect grant this unit the given permission (Assault
 * from a detachment rule, shoot-after-fall-back from a stratagem...)?
 * Effect conditions are honoured with the unit as bearer.
 */
export function hasActivePermission(
  state: GameState,
  content: RulesContent,
  unitId: UnitId,
  permission: string,
): boolean {
  const unit = state.units[unitId];
  if (!unit) return false;
  const ctx = {
    state,
    content,
    activePlayer: state.activePlayer,
    phase: state.phase,
    bearerUnitId: unitId,
  };
  const defGrants = (def: { effects: { type: string; permission?: string }[]; condition?: unknown }) => {
    const grants = def.effects.some(
      (p) => p.type === 'grantPermission' && p.permission === permission,
    );
    if (!grants) return false;
    if (def.condition && !evalCondition(def.condition as never, ctx)) return false;
    return true;
  };
  // Active effects bound to the unit (or its attached leader), plus
  // army-wide effects from the unit's own player.
  for (const active of state.activeEffects) {
    const applies =
      active.boundUnits.length > 0
        ? active.boundUnits.includes(unitId) || active.boundUnits.includes(unit.leaderOf ?? '')
        : active.source.player === unit.owner;
    if (applies && defGrants(active.def)) return true;
  }
  // Innate datasheet abilities of the unit and its attached leader.
  const sheets = [unit.datasheetId, unit.leaderOf ? state.units[unit.leaderOf]?.datasheetId : undefined];
  for (const sheetId of sheets) {
    if (!sheetId) continue;
    const ds = content.getDatasheet(sheetId);
    for (const def of ds?.abilities ?? []) {
      if (defGrants(def)) return true;
    }
  }
  return false;
}

/** Net modifyRoll modifier for a roll kind from effects bound to a unit. */
export function boundRollModifier(state: GameState, unitId: UnitId, roll: string): number {
  const unit = state.units[unitId];
  if (!unit) return 0;
  let total = 0;
  for (const active of state.activeEffects) {
    const applies =
      active.boundUnits.length > 0
        ? active.boundUnits.includes(unitId)
        : active.source.player === unit.owner;
    if (!applies) continue;
    for (const p of active.def.effects) {
      if (p.type === 'modifyRoll' && p.roll === roll) total += p.value;
    }
  }
  return total;
}

/**
 * Sum of modifyCharacteristic bonuses for `stat` from active effects bound
 * to this unit (or global effects owned by the unit's owner) that fire on
 * the given trigger — e.g. Move bonuses from Orders on 'move.distance'.
 */
export function boundCharacteristicBonus(
  state: GameState,
  unitId: UnitId,
  stat: string,
  trigger: string,
): number {
  const unit = state.units[unitId];
  if (!unit) return 0;
  let bonus = 0;
  for (const active of state.activeEffects) {
    if (active.def.trigger !== trigger) continue;
    const applies =
      active.boundUnits.length > 0
        ? active.boundUnits.includes(unitId)
        : active.source.player === unit.owner;
    if (!applies) continue;
    for (const prim of active.def.effects) {
      if (prim.type === 'modifyCharacteristic' && prim.stat === stat) {
        bonus += prim.value;
      }
    }
  }
  return bonus;
}
