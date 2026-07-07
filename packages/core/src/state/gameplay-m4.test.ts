import { describe, expect, it } from 'vitest';
import type {
  Datasheet,
  DetachmentDef,
  FactionPack,
  MechanicDef,
  StratagemDef,
} from '../types/content.js';
import type { GameState, UnitState } from '../types/state.js';
import { reduce, advanceStep } from './reducer.js';
import { makeEnv, makeState, makeUnit } from '../test-helpers.js';
import type { ReducerEnv } from './env.js';

// ---------------------------------------------------------------------------
// Fixtures: a faction with an Orders-like mechanic and one detachment
// ---------------------------------------------------------------------------

const officerSheet: Datasheet = {
  id: 'testfaction/officer',
  name: 'Officer',
  factionId: 'testfaction',
  keywords: ['Infantry', 'Character', 'Officer'],
  factionKeywords: ['Testers'],
  models: [
    {
      id: 'default',
      name: 'Officer',
      move: 6,
      toughness: 3,
      save: 4,
      wounds: 3,
      leadership: 6,
      objectiveControl: 1,
      baseSizeMm: 28,
      heightInches: 1.3,
    },
  ],
  unitComposition: { sizes: [{ models: 1, points: 60 }] },
  rangedWeapons: [],
  meleeWeapons: [],
  coreAbilities: [],
  abilities: [],
};

const troopSheet: Datasheet = {
  ...officerSheet,
  id: 'testfaction/troops',
  name: 'Troops',
  keywords: ['Infantry'],
  unitComposition: { sizes: [{ models: 5, points: 60 }] },
};

const takeAim: MechanicDef = {
  id: 'test.take-aim',
  name: 'Take Aim!',
  groupId: 'test.orders',
  timing: { phase: ['command'], player: 'active' },
  user: { keyword: 'Officer' },
  target: { who: 'friendly', keyword: 'Infantry', within: 6 },
  limit: { count: 1, per: 'turn', scope: 'unit' },
  applyTokens: [{ to: 'target', token: 'order:take-aim' }],
  duration: 'untilOwnCommandPhase',
  effects: [
    {
      id: 'test.take-aim.bonus',
      trigger: 'attack.beforeHitRoll',
      condition: { bearerIs: 'attacker' },
      effects: [{ type: 'modifyRoll', roll: 'hit', value: 1 }],
    },
  ],
};

const testFaction: FactionPack = {
  id: 'testfaction',
  name: 'Testers',
  editionId: 'test-edition',
  version: 'test',
  schemaVersion: 1,
  armyRule: {
    name: 'Test Doctrine',
    effects: [
      {
        id: 'testfaction.doctrine',
        trigger: 'attack.beforeWoundRoll',
        condition: { bearerIs: 'attacker' },
        effects: [{ type: 'reroll', roll: 'wound', dice: 'ones' }],
      },
    ],
  },
  mechanics: [takeAim],
};

const detachmentStratagem: StratagemDef = {
  id: 'test.det-strat',
  name: 'Detachment Trick',
  cost: 1,
  player: 'reactive',
  phase: ['movement'],
  window: 'move.completed',
  target: { who: 'friendly' },
  effects: [
    {
      id: 'test.det-strat.effect',
      trigger: 'attack.beforeHitRoll',
      effects: [{ type: 'modifyRoll', roll: 'hit', value: -1 }],
      duration: 'phase',
      scope: 'unit',
    },
  ],
};

const testDetachment: DetachmentDef = {
  id: 'testfaction.alpha',
  name: 'Alpha Strike',
  rule: {
    name: 'Alpha Doctrine',
    effects: [
      {
        id: 'testfaction.alpha.rule',
        trigger: 'attack.beforeHitRoll',
        condition: { bearerIs: 'attacker' },
        effects: [{ type: 'modifyRoll', roll: 'hit', value: 1 }],
      },
    ],
  },
  enhancements: [
    {
      id: 'testfaction.alpha.blade',
      name: 'Alpha Blade',
      points: 15,
      eligibleKeywords: ['Officer'],
      effects: [
        {
          id: 'testfaction.alpha.blade.effect',
          trigger: 'attack.beforeWoundRoll',
          condition: { bearerIs: 'attacker' },
          effects: [{ type: 'modifyRoll', roll: 'wound', value: 1 }],
        },
      ],
    },
  ],
  stratagems: [detachmentStratagem],
};

function m4Env(): ReducerEnv {
  const env = makeEnv({
    datasheets: {
      'testfaction/officer': officerSheet,
      'testfaction/troops': troopSheet,
    },
  });
  env.content.getFaction = (id) => (id === 'testfaction' ? testFaction : undefined);
  env.content.getFactionMechanics = (id) => (id === 'testfaction' ? [takeAim] : []);
  env.content.getDetachment = (id) => (id === 'testfaction.alpha' ? testDetachment : undefined);
  env.content.getDetachmentsFor = (id) => (id === 'testfaction' ? [testDetachment] : []);
  env.content.getStratagemsFor = (state, player) =>
    state.players[player as 0 | 1].detachmentId === 'testfaction.alpha'
      ? [detachmentStratagem]
      : [];
  return env;
}

function unit(
  id: string,
  owner: 0 | 1,
  datasheetId: string,
  at: { x: number; y: number } | null,
  opts: Partial<UnitState> = {},
): UnitState {
  const count = datasheetId.endsWith('officer') ? 1 : 5;
  return makeUnit({
    id,
    owner,
    datasheetId,
    name: id,
    startingStrength: count,
    models: Array.from({ length: count }, (_, i) => ({
      id: `${id}-m${i}`,
      profileId: 'default',
      position: at ? { x: at.x + i * 1.2, y: at.y } : null,
      woundsRemaining: 3,
      destroyed: false,
      hasTakenWoundsThisPhase: false,
    })),
    ...opts,
  });
}

function ok(result: ReturnType<typeof reduce>): GameState {
  if (!result.ok) throw new Error(`expected ok: ${result.error}`);
  return result.state;
}

function bad(result: ReturnType<typeof reduce>, pattern?: RegExp): void {
  expect(result.ok).toBe(false);
  if (!result.ok && pattern) expect(result.error).toMatch(pattern);
}

// ---------------------------------------------------------------------------
// Activated mechanics (Orders)
// ---------------------------------------------------------------------------

describe('activated faction mechanics (useAbility)', () => {
  function commandState(): { env: ReducerEnv; state: GameState } {
    const env = m4Env();
    const base = makeState({
      phase: 'command',
      step: 'command',
      round: 1,
      activePlayer: 0,
      units: {
        officer: unit('officer', 0, 'testfaction/officer', { x: 10, y: 10 }),
        troops: unit('troops', 0, 'testfaction/troops', { x: 12, y: 10 }),
        farTroops: unit('farTroops', 0, 'testfaction/troops', { x: 40, y: 30 }),
        enemy: unit('enemy', 1, 'testfaction/troops', { x: 40, y: 40 }),
      },
    });
    const players: GameState['players'] = [
      { ...base.players[0], factionId: 'testfaction' },
      base.players[1],
    ];
    return { env, state: { ...base, players } };
  }

  it('issues an order: keyword, range, phase and per-unit limits enforced', () => {
    const { env, state } = commandState();
    // Wrong user (no Officer keyword).
    bad(
      reduce(state, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'troops', targetUnitId: 'troops' }, env),
      /needs Officer/,
    );
    // Out of range target.
    bad(
      reduce(state, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'farTroops' }, env),
      /more than 6/,
    );
    // Enemy target.
    bad(
      reduce(state, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'enemy' }, env),
      /friendly/,
    );
    // Wrong phase.
    bad(
      reduce({ ...state, phase: 'shooting', step: 'shoot' }, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'troops' }, env),
      /cannot be used in this phase/,
    );

    const issued = ok(
      reduce(state, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'troops' }, env),
    );
    expect(issued.units['troops']!.tokens).toContain('order:take-aim');
    expect(issued.activeEffects.some((e) => e.source.kind === 'mechanic')).toBe(true);

    // The same officer cannot issue a second order this turn (shared group).
    bad(
      reduce(issued, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'troops' }, env),
      /already used/,
    );
  });

  it('order effects persist through the opponent turn and expire at the owner’s next command phase', () => {
    const { env, state } = commandState();
    let s = ok(
      reduce(state, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'troops' }, env),
    );
    // Walk the full round: P0's remaining steps, all of P1's turn.
    let hops = 0;
    while (hops++ < 30) {
      s = advanceStep(s, env);
      if (s.phase === 'command' && s.activePlayer === 1) break;
    }
    // Opponent's command phase: the order is still live.
    expect(s.units['troops']!.tokens).toContain('order:take-aim');
    expect(s.activeEffects.some((e) => e.source.kind === 'mechanic')).toBe(true);

    // Continue to P0's next command phase: it expires.
    hops = 0;
    while (hops++ < 30) {
      s = advanceStep(s, env);
      if (s.phase === 'command' && s.activePlayer === 0 && s.round === 2) break;
    }
    expect(s.units['troops']!.tokens).not.toContain('order:take-aim');
    expect(s.activeEffects.some((e) => e.source.kind === 'mechanic')).toBe(false);
  });

  it('battle-shocked units can neither issue nor receive orders', () => {
    const { env, state } = commandState();
    const shockedOfficer: GameState = {
      ...state,
      units: {
        ...state.units,
        officer: { ...state.units['officer']!, battleShocked: true },
      },
    };
    bad(
      reduce(shockedOfficer, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'troops' }, env),
      /Battle-shocked/,
    );
    const shockedTroops: GameState = {
      ...state,
      units: {
        ...state.units,
        troops: { ...state.units['troops']!, battleShocked: true },
      },
    };
    bad(
      reduce(shockedTroops, { type: 'useAbility', player: 0, abilityId: 'test.take-aim', unitId: 'officer', targetUnitId: 'troops' }, env),
      /Battle-shocked/,
    );
  });
});

// ---------------------------------------------------------------------------
// Detachment choice, enhancements, battle-start materialization
// ---------------------------------------------------------------------------

describe('detachments and enhancements', () => {
  function setupState(): { env: ReducerEnv; state: GameState } {
    const env = m4Env();
    const base = makeState({
      phase: 'setup',
      step: null,
      round: 0,
      firstPlayer: 0,
      activePlayer: 0,
      setup: {
        rostersLoaded: [true, true],
        rollOff: null,
        attacker: null,
        deployNext: null,
        readyToStart: false,
      },
      units: {
        officer: unit('officer', 0, 'testfaction/officer', null),
        troops: unit('troops', 0, 'testfaction/troops', null),
        enemy: unit('enemy', 1, 'testfaction/troops', null),
      },
    });
    const players: GameState['players'] = [
      { ...base.players[0], factionId: 'testfaction' },
      base.players[1],
    ];
    return { env, state: { ...base, players } };
  }

  it('chooseDetachment validates against the faction and records the choice', () => {
    const { env, state } = setupState();
    bad(
      reduce(state, { type: 'chooseDetachment', player: 0, detachmentId: 'nonsense' }, env),
      /not a detachment/,
    );
    const chosen = ok(
      reduce(state, { type: 'chooseDetachment', player: 0, detachmentId: 'testfaction.alpha' }, env),
    );
    expect(chosen.players[0].detachmentId).toBe('testfaction.alpha');
  });

  it('assignEnhancement enforces character/eligibility/uniqueness', () => {
    const { env, state } = setupState();
    const chosen = ok(
      reduce(state, { type: 'chooseDetachment', player: 0, detachmentId: 'testfaction.alpha' }, env),
    );
    bad(
      reduce(chosen, { type: 'assignEnhancement', player: 0, unitId: 'troops', enhancementId: 'testfaction.alpha.blade' }, env),
      /Character/,
    );
    const assigned = ok(
      reduce(chosen, { type: 'assignEnhancement', player: 0, unitId: 'officer', enhancementId: 'testfaction.alpha.blade' }, env),
    );
    expect(assigned.units['officer']!.enhancementId).toBe('testfaction.alpha.blade');
  });

  it('battle start materializes army rule, detachment rule and enhancements', () => {
    const { env, state } = setupState();
    let s = ok(
      reduce(state, { type: 'chooseDetachment', player: 0, detachmentId: 'testfaction.alpha' }, env),
    );
    s = ok(
      reduce(s, { type: 'assignEnhancement', player: 0, unitId: 'officer', enhancementId: 'testfaction.alpha.blade' }, env),
    );
    const ready: GameState = {
      ...s,
      setup: { ...s.setup!, attacker: 0, deployNext: null, readyToStart: true },
    };
    const battle = advanceStep(ready, env);
    expect(battle.round).toBe(1);
    const kinds = battle.activeEffects.map((e) => e.source.kind);
    expect(kinds).toContain('armyRule');
    expect(kinds).toContain('detachment');
    expect(kinds).toContain('enhancement');
    const enhancement = battle.activeEffects.find((e) => e.source.kind === 'enhancement')!;
    expect(enhancement.boundUnits).toEqual(['officer']);
    expect(enhancement.duration).toBe('battle');
  });

  it('detachment stratagems are only offered to their owner', () => {
    const { env, state } = setupState();
    // Player 0 has the detachment; player 1 does not. Open the same window
    // for each and compare eligibility.
    const chosen = ok(
      reduce(state, { type: 'chooseDetachment', player: 0, detachmentId: 'testfaction.alpha' }, env),
    );
    const inMovement: GameState = {
      ...chosen,
      phase: 'movement',
      step: 'moveUnits',
      round: 1,
      activePlayer: 1, // detachment stratagem is 'reactive' → P0 can use it
      setup: null,
      players: [
        { ...chosen.players[0], cp: 2 },
        { ...chosen.players[1], cp: 2 },
      ],
      units: {
        ...chosen.units,
        officer: unit('officer', 0, 'testfaction/officer', { x: 10, y: 10 }),
        troops: unit('troops', 0, 'testfaction/troops', { x: 12, y: 10 }),
        enemy: unit('enemy', 1, 'testfaction/troops', { x: 30, y: 30 }),
      },
    };
    // P1 (no detachment) moves; P0's window offers the detachment stratagem.
    let s = ok(reduce(inMovement, { type: 'startMove', player: 1, unitId: 'enemy', kind: 'normal' }, env));
    s = ok(
      reduce(
        s,
        {
          type: 'commitMove',
          player: 1,
          unitId: 'enemy',
          positions: s.units['enemy']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 2,
          })),
        },
        env,
      ),
    );
    expect(s.pendingDecision?.kind).toBe('stratagemWindow');
    expect(s.pendingDecision?.player).toBe(0);
    const optionIds = (s.pendingDecision?.options as { stratagemId: string }[]).map(
      (o) => o.stratagemId,
    );
    expect(optionIds).toContain('test.det-strat');

    // Mirror: if P0 moves, P1's window has NO options (no detachment) —
    // so no window opens at all.
    const p0Turn: GameState = { ...inMovement, activePlayer: 0 };
    let t = ok(reduce(p0Turn, { type: 'startMove', player: 0, unitId: 'troops', kind: 'normal' }, env));
    t = ok(
      reduce(
        t,
        {
          type: 'commitMove',
          player: 0,
          unitId: 'troops',
          positions: t.units['troops']!.models.map((m) => ({
            modelId: m.id,
            x: m.position!.x,
            y: m.position!.y + 2,
          })),
        },
        env,
      ),
    );
    expect(t.pendingDecision).toBeNull();
  });
});
