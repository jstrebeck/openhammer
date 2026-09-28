import { describe, expect, it } from 'vitest';
import type { Datasheet, MissionDef } from '../types/content.js';
import type { GameState, UnitState } from '../types/state.js';
import { advanceStep, ENDED_PHASE, reduce } from './reducer.js';
import { computeObjectiveControl } from './scoring.js';
import { makeEnv, makeState, makeUnit } from '../test-helpers.js';
import type { ReducerEnv } from './env.js';

const sheet: Datasheet = {
  id: 'test/line',
  name: 'Line',
  factionId: 'test',
  keywords: ['Infantry'],
  factionKeywords: ['Test'],
  models: [
    {
      id: 'default',
      name: 'Trooper',
      move: 6,
      toughness: 4,
      save: 4,
      wounds: 1,
      leadership: 7,
      objectiveControl: 2,
      baseSizeMm: 25,
      heightInches: 1.2,
    },
  ],
  unitComposition: { sizes: [{ models: 5, points: 60 }] },
  rangedWeapons: [],
  meleeWeapons: [],
  coreAbilities: [],
  abilities: [],
};

const mission: MissionDef = {
  id: 'test-mission',
  name: 'Test Hold',
  pointsLimit: 1000,
  deploymentMapIds: ['test'],
  firstTurn: 'rollOff',
  primaryScoring: [
    {
      id: 'test.hold',
      name: 'Hold Objectives',
      cadence: { hook: 'command.start', fromRound: 2, player: 'active' },
      scoring: { perObjectiveHeld: 5, maxPerScore: 15 },
      maxTotal: 50,
    },
    {
      id: 'test.final',
      name: 'Final Hold',
      cadence: { hook: 'lifecycle.battleEnd', player: 'either' },
      scoring: { perObjectiveHeld: 5, maxPerScore: 15 },
      maxTotal: 50,
    },
  ],
  bonusVP: [{ id: 'painted-army', name: 'Painted Army', value: 10 }],
};

function env(): ReducerEnv {
  const e = makeEnv({ datasheets: { 'test/line': sheet } });
  e.content.getMission = (id) => (id === 'test-mission' ? mission : undefined);
  return e;
}

function squad(id: string, owner: 0 | 1, at: { x: number; y: number }, count = 5): UnitState {
  return makeUnit({
    id,
    owner,
    datasheetId: 'test/line',
    name: id,
    startingStrength: count,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      profileId: 'default',
      position: { x: at.x + i * 1.1, y: at.y },
      woundsRemaining: 1,
      destroyed: false,
      hasTakenWoundsThisPhase: false,
    })),
  });
}

function board(): GameState['board'] {
  return {
    width: 60,
    height: 44,
    terrain: [],
    objectives: [
      { id: 'obj-a', position: { x: 10, y: 10 } },
      { id: 'obj-b', position: { x: 30, y: 22 } },
      { id: 'obj-c', position: { x: 50, y: 40 } },
    ],
    deploymentZones: [],
  };
}

describe('objective control', () => {
  it('sums OC within range; higher total controls; ties contest', () => {
    const e = env();
    const state = makeState({
      missionId: 'test-mission',
      board: board(),
      units: {
        // 5 models × OC2 on obj-a for P0.
        a: squad('a', 0, { x: 8, y: 10 }),
        // Both sides on obj-b: P0 5×2 vs P1 5×2 → contested.
        b0: squad('b0', 0, { x: 28, y: 22 }),
        b1: squad('b1', 1, { x: 28.5, y: 23 }),
        // P1 alone on obj-c.
        c1: squad('c1', 1, { x: 48, y: 40 }),
        // A unit far from everything contributes nowhere.
        far: squad('far', 1, { x: 2, y: 42 }),
      },
    });
    const control = computeObjectiveControl(state, e);
    expect(control['obj-a']).toEqual({ controller: 0, oc: [10, 0] });
    expect(control['obj-b']!.controller).toBeNull();
    expect(control['obj-c']).toEqual({ controller: 1, oc: [0, 10] });
  });

  it('battle-shocked units count zero OC', () => {
    const e = env();
    const state = makeState({
      missionId: 'test-mission',
      board: board(),
      units: {
        a: { ...squad('a', 0, { x: 8, y: 10 }), battleShocked: true },
        b: squad('b', 1, { x: 12, y: 10 }, 1),
      },
    });
    const control = computeObjectiveControl(state, e);
    expect(control['obj-a']).toEqual({ controller: 1, oc: [0, 2] });
  });

  it('OC effect bonuses (Duty and Honour style) apply through the hook', () => {
    const e = env();
    const base = squad('a', 0, { x: 8, y: 10 }, 1);
    const state = makeState({
      missionId: 'test-mission',
      board: board(),
      units: { a: base, b: squad('b', 1, { x: 12, y: 10 }, 1) },
      activeEffects: [
        {
          instanceId: 'order',
          def: {
            id: 'order.oc',
            trigger: 'scoring.objectiveControl',
            effects: [{ type: 'modifyCharacteristic', stat: 'OC', value: 1 }],
          },
          source: { kind: 'mechanic', id: 'order', player: 0 },
          boundUnits: ['a'],
          duration: 'untilOwnCommandPhase',
          activatedAt: { round: 1, turn: 0, phase: 'command' },
        },
      ],
    });
    const control = computeObjectiveControl(state, e);
    expect(control['obj-a']).toEqual({ controller: 0, oc: [3, 2] });
  });
});

describe('primary scoring cadence', () => {
  function roundState(round: number, activePlayer: 0 | 1): GameState {
    return makeState({
      missionId: 'test-mission',
      phase: 'fight',
      step: 'remainingCombats',
      round,
      activePlayer,
      firstPlayer: 0,
      board: board(),
      fight: { selector: null, activeUnitId: null, stage: 'select', fought: [] },
      units: {
        a: squad('a', 0, { x: 8, y: 10 }),
        c: squad('c', 0, { x: 48, y: 40 }),
      },
    });
  }

  it('awards VP with logged math at the command-phase cadence (from round 2)', () => {
    const e = env();
    // P1's fight phase in round 1 ends → P... firstPlayer 0, active 1 →
    // round rolls to 2 and P0's command phase begins: P0 scores.
    const scored = advanceStep(roundState(1, 1), e);
    expect(scored.round).toBe(2);
    expect(scored.activePlayer).toBe(0);
    expect(scored.players[0].vp).toBe(10); // two objectives × 5
    expect(scored.players[0].vpLog).toHaveLength(1);
    expect(scored.players[0].vpLog[0]!.detail).toContain('2 objective(s)');
    expect(scored.log.some((l) => l.kind === 'scoring' && l.message.includes('10 VP'))).toBe(true);
  });

  it('does not score in round 1 and caps per-score awards', () => {
    const e = env();
    // Round 1 start: no scoring (fromRound 2).
    const early = advanceStep(
      { ...roundState(1, 0), phase: 'setup', step: null, round: 0, setup: { rostersLoaded: [true, true], rollOff: null, attacker: 0, deployNext: null, readyToStart: true }, fight: null },
      e,
    );
    expect(early.players[0].vp).toBe(0);

    // Four objectives held → capped at 15.
    const four = roundState(1, 1);
    const capped = advanceStep(
      {
        ...four,
        board: {
          ...four.board,
          objectives: [
            ...four.board.objectives,
            { id: 'obj-d', position: { x: 8, y: 12 } }, // same cluster as obj-a
          ],
        },
        units: {
          ...four.units,
          b: squad('b', 0, { x: 28, y: 22 }),
        },
      },
      e,
    );
    expect(capped.players[0].vp).toBe(15);
  });

  it('scores the second player at battle end and adds the painted bonus', () => {
    const e = env();
    const last = roundState(5, 1);
    const withPainted: GameState = {
      ...last,
      players: [
        { ...last.players[0], paintedArmy: true },
        { ...last.players[1], paintedArmy: true },
      ],
      units: {
        a: squad('a', 0, { x: 8, y: 10 }),
        // P1 (the second player) holds obj-c at the end.
        c1: squad('c1', 1, { x: 48, y: 40 }),
      },
    };
    const ended = advanceStep(withPainted, e);
    expect(ended.phase).toBe(ENDED_PHASE);
    // P1 = second player: 5 VP final hold + 10 painted; P0: 10 painted.
    expect(ended.players[1].vp).toBe(15);
    expect(ended.players[0].vp).toBe(10);
    expect(ended.players[1].vpLog.map((v) => v.source).sort()).toEqual([
      'painted-army',
      'primary',
    ]);
    expect(ended.result?.winner).toBe(1);
  });

  it('setPaintedArmy is a setup action', () => {
    const e = env();
    const setup = makeState({
      phase: 'setup',
      round: 0,
      setup: {
        rostersLoaded: [false, false],
        rollOff: null,
        attacker: null,
        deployNext: null,
        readyToStart: false,
      },
    });
    const result = reduce(setup, { type: 'setPaintedArmy', player: 0, painted: true }, e);
    expect(result.ok && result.state.players[0].paintedArmy).toBe(true);
  });
});
