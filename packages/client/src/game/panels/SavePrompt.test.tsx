import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { GameState } from '@openhammer/core';
import { makeState, makeUnit } from '../../test/fixtures';
import { makeHarness, renderWithStore } from '../../test/harness';
import { SavePrompt } from './SavePrompt';

function stateWithDecision(defender: 0 | 1): GameState {
  return makeState({
    phase: 'shooting',
    step: 'shoot',
    activePlayer: defender === 0 ? 1 : 0,
    units: {
      'u-attacker': makeUnit('u-attacker', defender === 0 ? 1 : 0, { name: 'Strike Team' }),
      'u-target': makeUnit('u-target', defender, { name: 'Shock Troops' }),
    },
    pendingDecision: {
      id: 'saves-1',
      player: defender,
      kind: 'saves',
      options: [],
      context: {
        weaponName: 'Pulse rifle',
        wounds: 4,
        mortalWounds: 2,
        targetUnitId: 'u-target',
        attackerUnitId: 'u-attacker',
      },
      canPass: false,
    },
  });
}

describe('SavePrompt', () => {
  it('renders the wound counts from pendingDecision.context', () => {
    const harness = makeHarness(stateWithDecision(0), 0);
    renderWithStore(harness, <SavePrompt />);
    expect(
      screen.getByText(/Pulse rifle hits Shock Troops: 4 wounds \(\+2 devastating\) incoming/),
    ).toBeTruthy();
  });

  it('dispatches resolveSaves when Roll Saves is clicked', () => {
    const harness = makeHarness(stateWithDecision(0), 0);
    renderWithStore(harness, <SavePrompt />);
    fireEvent.click(screen.getByRole('button', { name: 'Roll Saves' }));
    expect(harness.actions()).toEqual([{ type: 'resolveSaves', player: 0 }]);
  });

  it('shows a waiting banner (no modal) when the OTHER player must decide', () => {
    const harness = makeHarness(stateWithDecision(1), 0);
    renderWithStore(harness, <SavePrompt />);
    expect(screen.queryByRole('button', { name: 'Roll Saves' })).toBeNull();
    expect(screen.getByText(/Waiting for Bob: saves/)).toBeTruthy();
  });

  it('renders nothing without a pending saves decision', () => {
    const harness = makeHarness(makeState(), 0);
    const { container } = renderWithStore(harness, <SavePrompt />);
    expect(container.innerHTML).toBe('');
  });
});
