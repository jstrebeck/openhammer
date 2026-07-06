import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { GameState } from '@openhammer/core';
import { makeState, makeUnit } from '../../test/fixtures';
import { makeHarness, renderWithStore } from '../../test/harness';
import { StratagemPrompt, humanizeHook } from './StratagemPrompt';

function windowState(owner: 0 | 1): GameState {
  return makeState({
    phase: 'movement',
    step: 'moveUnits',
    activePlayer: owner === 0 ? 1 : 0,
    units: {
      'u-a': makeUnit('u-a', owner, { name: 'Guardian Squad' }),
      'u-b': makeUnit('u-b', owner, { name: 'Support Platform' }),
    },
    pendingDecision: {
      id: 'window-3-move.completed',
      player: owner,
      kind: 'stratagemWindow',
      window: 'move.completed',
      options: [
        {
          stratagemId: 'strat.overwatch',
          name: 'Fire Overwatch',
          cost: 1,
          targets: ['u-a', 'u-b'],
          requiresTarget: true,
        },
        {
          stratagemId: 'strat.smokescreen',
          name: 'Smokescreen',
          cost: 1,
          targets: [],
          requiresTarget: false,
        },
      ],
      context: { hook: 'move.completed', followUp: { type: 'none' } },
      canPass: true,
    },
  });
}

describe('StratagemPrompt', () => {
  it('renders the humanized hook title and one card per option', () => {
    const harness = makeHarness(windowState(0), 0);
    renderWithStore(harness, <StratagemPrompt />);

    expect(humanizeHook('command.battleShockFailed')).toBe('Command: Battle Shock Failed');
    expect(screen.getByText('Move: Completed')).toBeTruthy();
    expect(screen.getByText('Fire Overwatch')).toBeTruthy();
    expect(screen.getByText('Smokescreen')).toBeTruthy();
    expect(screen.getAllByText('1 CP')).toHaveLength(2);
  });

  it('dispatches useStratagem with the chosen target', () => {
    const harness = makeHarness(windowState(0), 0);
    renderWithStore(harness, <StratagemPrompt />);

    fireEvent.change(screen.getByLabelText('Target for Fire Overwatch'), {
      target: { value: 'u-b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use Fire Overwatch' }));

    expect(harness.actions()).toEqual([
      { type: 'useStratagem', player: 0, stratagemId: 'strat.overwatch', targetUnitId: 'u-b' },
    ]);
  });

  it('disables Use until a required target is chosen; targetless options dispatch directly', () => {
    const harness = makeHarness(windowState(0), 0);
    renderWithStore(harness, <StratagemPrompt />);

    const useOverwatch = screen.getByRole('button', {
      name: 'Use Fire Overwatch',
    }) as HTMLButtonElement;
    expect(useOverwatch.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Use Smokescreen' }));
    expect(harness.actions()).toEqual([
      { type: 'useStratagem', player: 0, stratagemId: 'strat.smokescreen' },
    ]);
  });

  it('Pass dispatches passWindow without a standing preference', () => {
    const harness = makeHarness(windowState(0), 0);
    renderWithStore(harness, <StratagemPrompt />);

    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(harness.actions()).toEqual([{ type: 'passWindow', player: 0 }]);
  });

  it('Pass with the checkbox dispatches dontAskAgainThisPhase: true', () => {
    const harness = makeHarness(windowState(0), 0);
    renderWithStore(harness, <StratagemPrompt />);

    fireEvent.click(screen.getByLabelText(/Don't ask again this phase/));
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(harness.actions()).toEqual([
      { type: 'passWindow', player: 0, dontAskAgainThisPhase: true },
    ]);
  });

  it('shows a waiting banner (no controls) when the window belongs to the opponent', () => {
    const harness = makeHarness(windowState(0), 1);
    renderWithStore(harness, <StratagemPrompt />);

    expect(screen.getByText(/Waiting for Alice: reactive window \(move\.completed\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pass' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Use / })).toBeNull();
  });

  it('renders nothing without an open stratagem window', () => {
    const harness = makeHarness(makeState(), 0);
    const { container } = renderWithStore(harness, <StratagemPrompt />);
    expect(container.innerHTML).toBe('');
  });
});
