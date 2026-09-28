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

  it('dispatches resolveSaves from the auto-resolve button', () => {
    const harness = makeHarness(stateWithDecision(0), 0);
    renderWithStore(harness, <SavePrompt />);
    fireEvent.click(screen.getByRole('button', { name: /Auto-resolve/ }));
    expect(harness.actions()).toEqual([{ type: 'resolveSaves', player: 0 }]);
  });

  it('dispatches allocateWound for the chosen model', () => {
    const harness = makeHarness(stateWithDecision(0), 0);
    renderWithStore(harness, <SavePrompt />);
    fireEvent.change(screen.getByLabelText('Allocate to model'), {
      target: { value: 'u-target-m1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allocate & Roll' }));
    expect(harness.actions()).toEqual([
      { type: 'allocateWound', player: 0, modelId: 'u-target-m1' },
    ]);
  });

  it('forces the already-wounded model and disables the picker', () => {
    const base = stateWithDecision(0);
    const target = base.units['u-target']!;
    const wounded = {
      ...base,
      units: {
        ...base.units,
        'u-target': {
          ...target,
          models: target.models.map((m, i) =>
            i === 1 ? { ...m, hasTakenWoundsThisPhase: true, woundsRemaining: 1 } : m,
          ),
        },
      },
    };
    const harness = makeHarness(wounded, 0);
    renderWithStore(harness, <SavePrompt />);
    const select = screen.getByLabelText('Allocate to model') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('u-target-m1');
    fireEvent.click(screen.getByRole('button', { name: 'Allocate & Roll' }));
    expect(harness.actions()).toEqual([
      { type: 'allocateWound', player: 0, modelId: 'u-target-m1' },
    ]);
  });

  it('offers the invulnerable-save choice when one exists', () => {
    const base = stateWithDecision(0);
    const withSeq = {
      ...base,
      shooting: {
        attackerUnitId: 'u-attacker',
        remaining: [],
        current: {
          weaponId: 'w',
          weaponName: 'Pulse rifle',
          targetUnitId: 'u-target',
          woundsPending: 4,
          mortalWounds: 2,
          save: {
            ap: -1,
            damageExpr: '1',
            damageBonus: 0,
            minimumDamage: 1,
            cover: false,
            ignoresCover: false,
            invulnerableSave: 4,
            saveModifiers: [],
            feelNoPain: null,
          },
        },
      },
    };
    const harness = makeHarness(withSeq, 0);
    renderWithStore(harness, <SavePrompt />);
    fireEvent.click(screen.getByLabelText(/Use invulnerable save/));
    fireEvent.click(screen.getByRole('button', { name: 'Allocate & Roll' }));
    expect(harness.actions()).toEqual([
      { type: 'allocateWound', player: 0, modelId: 'u-target-m0', useInvulnerable: true },
    ]);
  });

  it('shows a waiting banner (no modal) when the OTHER player must decide', () => {
    const harness = makeHarness(stateWithDecision(1), 0);
    renderWithStore(harness, <SavePrompt />);
    expect(screen.queryByRole('button', { name: /Auto-resolve/ })).toBeNull();
    expect(screen.getByText(/Waiting for Bob: saves/)).toBeTruthy();
  });

  it('renders nothing without a pending saves decision', () => {
    const harness = makeHarness(makeState(), 0);
    const { container } = renderWithStore(harness, <SavePrompt />);
    expect(container.innerHTML).toBe('');
  });
});
