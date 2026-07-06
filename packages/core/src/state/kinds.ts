import type { PhaseKind, StepKind } from '../types/content.js';
import type { GameState } from '../types/state.js';
import type { ReducerEnv } from './env.js';

/**
 * Resolve the engine protocol kinds for the current phase/step from the
 * edition pack. Reducers switch on kinds, never on phase ids — the data
 * decides what protocol each phase runs.
 */
export function phaseStepKind(
  env: ReducerEnv,
  state: GameState,
): { phase: PhaseKind | null; step: StepKind | null } {
  const phase = env.content.edition.phases.find((p) => p.id === state.phase);
  if (!phase) return { phase: null, step: null };
  const step = state.step ? phase.steps.find((s) => s.id === state.step) : undefined;
  return { phase: phase.kind, step: step?.kind ?? null };
}
