import type { RngState } from '../types/state.js';

/**
 * Deterministic dice. All randomness flows through RngState so the server
 * is authoritative and any game can be replayed from (seed, action log).
 * mulberry32 — small, fast, good enough distribution for d6s.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Draw `count` d6 values. Pure: returns the rolls and the advanced state. */
export function rollD6(rng: RngState, count: number): { rolls: number[]; rng: RngState } {
  const gen = mulberry32(rng.seed);
  // Burn through previous draws to reach the current position.
  for (let i = 0; i < rng.counter; i++) gen();
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(Math.floor(gen() * 6) + 1);
  return { rolls, rng: { seed: rng.seed, counter: rng.counter + count } };
}

export function rollD3(rng: RngState, count: number): { rolls: number[]; rng: RngState } {
  const { rolls, rng: next } = rollD6(rng, count);
  return { rolls: rolls.map((r) => Math.ceil(r / 2)), rng: next };
}

export function roll2D6(rng: RngState): { total: number; rolls: number[]; rng: RngState } {
  const { rolls, rng: next } = rollD6(rng, 2);
  return { total: (rolls[0] ?? 0) + (rolls[1] ?? 0), rolls, rng: next };
}

// ---------------------------------------------------------------------------
// Dice expressions: "D6", "2D6", "D3", "D6+1", "2D6+3", "4", "D3+1"
// ---------------------------------------------------------------------------

export interface DiceExpr {
  count: number; // number of dice (0 for flat values)
  sides: 3 | 6 | 0; // 0 for flat values
  flat: number; // additive constant
}

const EXPR_RE = /^\s*(?:(\d*)[dD]([36]))?\s*([+-]\s*\d+)?\s*$/;

export function parseDiceExpression(expr: string | number): DiceExpr {
  if (typeof expr === 'number') return { count: 0, sides: 0, flat: expr };
  const trimmed = expr.trim();
  if (/^\d+$/.test(trimmed)) return { count: 0, sides: 0, flat: parseInt(trimmed, 10) };
  const m = EXPR_RE.exec(trimmed);
  if (!m || (!m[1] && !m[2] && !m[3])) {
    throw new Error(`Invalid dice expression: "${expr}"`);
  }
  const sides = m[2] ? (parseInt(m[2], 10) as 3 | 6) : 0;
  const count = m[2] ? (m[1] ? parseInt(m[1], 10) : 1) : 0;
  const flat = m[3] ? parseInt(m[3].replace(/\s/g, ''), 10) : 0;
  return { count, sides, flat };
}

/** Min/max possible results, for UI ranges. */
export function diceExprRange(expr: string | number): { min: number; max: number } {
  const e = parseDiceExpression(expr);
  return { min: e.count * (e.count ? 1 : 0) + e.flat, max: e.count * (e.sides || 0) + e.flat };
}

/** Evaluate an expression with real rolls. */
export function evalDiceExpression(
  expr: string | number,
  rng: RngState,
): { total: number; rolls: number[]; rng: RngState } {
  const e = parseDiceExpression(expr);
  if (e.count === 0) return { total: e.flat, rolls: [], rng };
  const result = e.sides === 3 ? rollD3(rng, e.count) : rollD6(rng, e.count);
  const total = result.rolls.reduce((a, b) => a + b, 0) + e.flat;
  return { total, rolls: result.rolls, rng: result.rng };
}
