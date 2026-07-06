import { describe, expect, it } from 'vitest';
import type { EditionDef } from '../types/content.js';
import type { GameState } from '../types/state.js';
import { makeState, makeUnit, testParams } from '../test-helpers.js';
import { ENDED_PHASE, SETUP_PHASE, advanceStep, reduce } from './reducer.js';

const edition: EditionDef = {
  id: 'test-edition',
  name: 'Test Edition',
  version: '2026-01',
  schemaVersion: 1,
  battleRounds: 5,
  phases: [
    {
      id: 'command',
      name: 'Command Phase',
      steps: [
        { id: 'command', name: 'Command' },
        { id: 'battleShock', name: 'Battle-shock' },
      ],
    },
    { id: 'movement', name: 'Movement Phase', steps: [{ id: 'move', name: 'Move Units' }, { id: 'reinforcements', name: 'Reinforcements' }] },
    { id: 'shooting', name: 'Shooting Phase', steps: [{ id: 'shoot', name: 'Shoot' }] },
    { id: 'charge', name: 'Charge Phase', steps: [{ id: 'charge', name: 'Charge' }] },
    { id: 'fight', name: 'Fight Phase', steps: [{ id: 'fightsFirst', name: 'Fights First' }, { id: 'remaining', name: 'Remaining Combats' }] },
  ],
  parameters: testParams,
};

const env = { edition };

function setupState(partial: Partial<GameState> = {}): GameState {
  return makeState({ phase: SETUP_PHASE, step: null, round: 0, ...partial });
}

describe('action validation', () => {
  it('rejects advanceStep from the non-active player', () => {
    const state = makeState({ activePlayer: 0, phase: 'command', step: 'command' });
    const result = reduce(state, { type: 'advanceStep', player: 1 }, env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('OUT_OF_TURN');
  });

  it('rejects actions while a decision is pending', () => {
    const state = makeState({
      phase: 'command',
      pendingDecision: {
        id: 'd1',
        player: 1,
        kind: 'saves',
        options: [],
        context: {},
        canPass: false,
      },
    });
    const result = reduce(state, { type: 'advanceStep', player: 0 }, env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PENDING_DECISION');
  });

  it('rejects everything but concede after the battle ends', () => {
    const state = makeState({ result: { winner: 0 } });
    const result = reduce(state, { type: 'advanceStep', player: 0 }, env);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('GAME_ENDED');
  });

  it('concede ends the game in the opponent’s favour', () => {
    const state = makeState({ phase: 'movement' });
    const result = reduce(state, { type: 'concede', player: 1 }, env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.result).toEqual({ winner: 0, concededBy: 1 });
      expect(result.state.phase).toBe(ENDED_PHASE);
    }
  });
});

describe('phase machine', () => {
  it('leaves setup into round 1, first phase, first player, granting CP', () => {
    const state = setupState({ firstPlayer: 1 });
    const next = advanceStep(state, env);
    expect(next.round).toBe(1);
    expect(next.phase).toBe('command');
    expect(next.step).toBe('command');
    expect(next.activePlayer).toBe(1);
    expect(next.players[0].cp).toBe(1);
    expect(next.players[1].cp).toBe(1);
  });

  it('walks steps before phases', () => {
    let state = advanceStep(setupState(), env);
    expect([state.phase, state.step]).toEqual(['command', 'command']);
    state = advanceStep(state, env);
    expect([state.phase, state.step]).toEqual(['command', 'battleShock']);
    state = advanceStep(state, env);
    expect([state.phase, state.step]).toEqual(['movement', 'move']);
  });

  it('hands the turn to the other player after the last phase', () => {
    let state = advanceStep(setupState(), env);
    const stepsPerTurn = edition.phases.reduce((a, p) => a + p.steps.length, 0);
    for (let i = 0; i < stepsPerTurn; i++) state = advanceStep(state, env);
    expect(state.activePlayer).toBe(1);
    expect(state.round).toBe(1);
    expect(state.phase).toBe('command');
    // Second turn start grants CP again.
    expect(state.players[0].cp).toBe(2);
  });

  it('plays a full 5-round game to the end and picks the VP winner', () => {
    let state = setupState();
    state = {
      ...state,
      players: [
        { ...state.players[0], vp: 40 },
        { ...state.players[1], vp: 55 },
      ],
    };
    let guard = 0;
    while (state.phase !== ENDED_PHASE && guard++ < 500) {
      state = advanceStep(state, env);
    }
    expect(state.phase).toBe(ENDED_PHASE);
    expect(state.round).toBe(5);
    expect(state.result?.winner).toBe(1);
  });

  it('clears turn flags and phase/turn effects at boundaries', () => {
    let state = advanceStep(setupState(), env);
    state = {
      ...state,
      units: {
        u1: makeUnit({
          id: 'u1',
          owner: 0,
          turnFlags: {
            moveKind: 'advance',
            advanceRoll: 4,
            chargeRoll: null,
            chargeTargets: [],
            hasShot: true,
            hasFought: false,
            fightsFirst: true,
            arrivedFromReserves: false,
          },
        }),
      },
      activeEffects: [
        {
          instanceId: 'e-phase',
          def: { id: 'e-phase', trigger: 'attack.beforeHitRoll', effects: [] },
          source: { kind: 'test', id: 'x', player: 0 },
          boundUnits: [],
          duration: 'phase',
          activatedAt: { round: 1, turn: 0, phase: 'command' },
        },
        {
          instanceId: 'e-battle',
          def: { id: 'e-battle', trigger: 'attack.beforeHitRoll', effects: [] },
          source: { kind: 'test', id: 'x', player: 0 },
          boundUnits: [],
          duration: 'battle',
          activatedAt: { round: 1, turn: 0, phase: 'command' },
        },
      ],
    };
    // Cross the command-phase boundary (two steps).
    state = advanceStep(state, env);
    state = advanceStep(state, env);
    expect(state.phase).toBe('movement');
    expect(state.activeEffects.map((e) => e.instanceId)).toEqual(['e-battle']);
    // Flags survive until the turn ends...
    expect(state.units['u1']?.turnFlags.moveKind).toBe('advance');
    // reinforcements, shoot, charge, fight×2, then one more advance to hand over
    const stepsLeft = 1 + 1 + 1 + 2 + 1;
    for (let i = 0; i < stepsLeft; i++) state = advanceStep(state, env);
    expect(state.activePlayer).toBe(1);
    expect(state.units['u1']?.turnFlags.moveKind).toBeNull();
    expect(state.units['u1']?.turnFlags.fightsFirst).toBe(false);
  });

  it('resets once-per-phase stratagem tracking on phase entry', () => {
    let state = advanceStep(setupState(), env);
    state = {
      ...state,
      players: [
        { ...state.players[0], stratagemsUsedThisPhase: ['core.command-reroll'] },
        state.players[1],
      ],
    };
    state = advanceStep(state, env); // battleShock step — same phase
    expect(state.players[0].stratagemsUsedThisPhase).toEqual(['core.command-reroll']);
    state = advanceStep(state, env); // movement phase
    expect(state.players[0].stratagemsUsedThisPhase).toEqual([]);
  });
});
