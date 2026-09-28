import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { GameState } from '@openhammer/core';
import type { FactionBundle } from '@openhammer/server';
import { makeState, makeUnit } from '../../test/fixtures';
import { makeHarness, renderWithStore } from '../../test/harness';
import { ActionPanel } from './ActionPanel';

const bundle: FactionBundle = {
  id: 'testers',
  name: 'Testers',
  armyRuleName: 'Voice of Testing',
  mechanics: [
    {
      id: 'test.order',
      name: 'Test Order!',
      groupId: 'orders',
      timing: { phase: ['command'], player: 'active' },
      user: { keyword: 'Officer' },
      target: { who: 'friendly', keyword: 'Regiment', within: 6 },
      duration: 'untilOwnCommandPhase',
      effects: [],
    },
  ],
  detachments: [
    {
      id: 'testers.alpha',
      name: 'Alpha',
      rule: { name: 'Alpha Rule', effects: [] },
      enhancements: [
        {
          id: 'testers.alpha.blade',
          name: 'Test Blade',
          points: 15,
          eligibleKeywords: [],
          effects: [],
        },
      ],
      stratagems: [
        {
          id: 'testers.alpha.buff',
          name: 'Test Buff',
          cost: 1,
          player: 'active',
          phase: ['shooting'],
          window: 'shooting.unitSelected',
          activation: 'proactive',
          target: { who: 'friendly' },
          effects: [],
        },
      ],
    },
  ],
};

function withFaction(game: GameState) {
  const players: GameState['players'] = [
    { ...game.players[0], factionId: 'testers', detachmentId: 'testers.alpha' },
    game.players[1],
  ];
  return { ...game, players };
}

describe('FactionAbilities panel', () => {
  it('offers phase-matching mechanics and dispatches useAbility', () => {
    const game = withFaction(
      makeState({
        phase: 'command',
        step: 'command',
        activePlayer: 0,
        units: {
          officer: makeUnit('officer', 0, { name: 'Officer Unit' }),
          troops: makeUnit('troops', 0, { name: 'Troop Unit' }),
        },
      }),
    );
    const harness = makeHarness(game, 0, { factions: { testers: bundle } });
    renderWithStore(harness, <ActionPanel />);

    fireEvent.change(screen.getByLabelText('Test Order! user'), {
      target: { value: 'officer' },
    });
    fireEvent.change(screen.getByLabelText('Test Order! target'), {
      target: { value: 'troops' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(harness.actions()).toEqual([
      {
        type: 'useAbility',
        player: 0,
        abilityId: 'test.order',
        unitId: 'officer',
        targetUnitId: 'troops',
      },
    ]);
  });

  it('hides mechanics outside their phase', () => {
    const game = withFaction(
      makeState({
        phase: 'movement',
        step: 'moveUnits',
        activePlayer: 0,
        units: { officer: makeUnit('officer', 0) },
      }),
    );
    const harness = makeHarness(game, 0, { factions: { testers: bundle } });
    renderWithStore(harness, <ActionPanel />);
    expect(screen.queryByText('Test Order!')).toBeNull();
  });
});

describe('ProactiveStratagems panel', () => {
  it('offers own-turn stratagems in their phase and dispatches useStratagem', () => {
    const game = withFaction(
      makeState({
        phase: 'shooting',
        step: 'shoot',
        activePlayer: 0,
        units: {
          mine: makeUnit('mine', 0, { name: 'My Unit' }),
          enemy: makeUnit('enemy', 1),
        },
      }),
    );
    game.players[0].cp = 2;
    const harness = makeHarness(game, 0, { factions: { testers: bundle } });
    renderWithStore(harness, <ActionPanel />);

    fireEvent.change(screen.getByLabelText('Test Buff target'), { target: { value: 'mine' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use' }));
    expect(harness.actions()).toEqual([
      { type: 'useStratagem', player: 0, stratagemId: 'testers.alpha.buff', targetUnitId: 'mine' },
    ]);
  });

  it('hides stratagems the player cannot afford', () => {
    const game = withFaction(
      makeState({
        phase: 'shooting',
        step: 'shoot',
        activePlayer: 0,
        units: { mine: makeUnit('mine', 0) },
      }),
    );
    game.players[0].cp = 0;
    const harness = makeHarness(game, 0, { factions: { testers: bundle } });
    renderWithStore(harness, <ActionPanel />);
    expect(screen.queryByText(/Test Buff/)).toBeNull();
  });
});

describe('detachment & enhancement pickers', () => {
  it('dispatches chooseDetachment and assignEnhancement in pre-game', () => {
    const base = makeState({
      phase: 'setup',
      step: null,
      round: 0,
      setup: {
        rostersLoaded: [true, true],
        rollOff: null,
        attacker: null,
        deployNext: null,
        readyToStart: false,
      },
      units: {
        captain: makeUnit('captain', 0, { name: 'Captain' }),
      },
    });
    const game = withFaction(base);
    const harness = makeHarness(game, 0, {
      factions: { testers: bundle },
      datasheets: {
        'test/sheet': {
          id: 'test/sheet',
          name: 'Captain',
          factionId: 'testers',
          keywords: ['Infantry', 'Character'],
          factionKeywords: ['Testers'],
          models: [],
          unitComposition: { sizes: [] },
          rangedWeapons: [],
          meleeWeapons: [],
          coreAbilities: [],
          abilities: [],
        },
      },
    });
    renderWithStore(harness, <ActionPanel />);

    fireEvent.change(screen.getByLabelText('Detachment'), {
      target: { value: 'testers.alpha' },
    });
    fireEvent.change(screen.getByLabelText('Enhancement for Captain'), {
      target: { value: 'testers.alpha.blade' },
    });
    const actions = harness.actions();
    expect(actions).toContainEqual({
      type: 'chooseDetachment',
      player: 0,
      detachmentId: 'testers.alpha',
    });
    expect(actions).toContainEqual({
      type: 'assignEnhancement',
      player: 0,
      unitId: 'captain',
      enhancementId: 'testers.alpha.blade',
    });
  });
});
