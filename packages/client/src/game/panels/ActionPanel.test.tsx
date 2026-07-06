import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { GameState } from '@openhammer/core';
import { makeState, makeUnit, makeWeapon } from '../../test/fixtures';
import { makeHarness, renderWithStore } from '../../test/harness';
import { ActionPanel } from './ActionPanel';

function movementState(activePlayer: 0 | 1 = 0): GameState {
  return makeState({
    phase: 'movement',
    step: 'moveUnits',
    activePlayer,
    units: {
      'u-mine': makeUnit('u-mine', 0),
      'u-enemy': makeUnit('u-enemy', 1),
    },
  });
}

function shootingState(): GameState {
  return makeState({
    phase: 'shooting',
    step: 'shoot',
    activePlayer: 0,
    units: {
      'u-mine': makeUnit('u-mine', 0, {
        weapons: {
          'pulse-rifle': makeWeapon('pulse-rifle', { name: 'Pulse rifle', range: 30 }),
          'pulse-pistol': makeWeapon('pulse-pistol', { name: 'Pulse pistol', range: 12 }),
        },
      }),
      'u-enemy-1': makeUnit('u-enemy-1', 1, { name: 'Enemy Alpha' }),
      'u-enemy-2': makeUnit('u-enemy-2', 1, { name: 'Enemy Beta' }),
    },
  });
}

describe('ActionPanel — movement phase', () => {
  it('dispatches startMove with the selected kind', () => {
    const harness = makeHarness(movementState(), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Advance' }));
    expect(harness.actions()).toEqual([
      { type: 'startMove', player: 0, unitId: 'u-mine', kind: 'advance' },
    ]);
  });

  it('dispatches each move kind from its own button', () => {
    const harness = makeHarness(movementState(), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Normal Move' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remain Stationary' }));
    expect(harness.actions().map((a) => (a.type === 'startMove' ? a.kind : a.type))).toEqual([
      'normal',
      'stationary',
    ]);
  });

  it('disables move and end-phase buttons when it is not my turn', () => {
    const harness = makeHarness(movementState(1), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);

    const normal = screen.getByRole('button', { name: 'Normal Move' }) as HTMLButtonElement;
    const advance = screen.getByRole('button', { name: 'Advance' }) as HTMLButtonElement;
    const end = screen.getByRole('button', { name: 'End Step / Phase' }) as HTMLButtonElement;
    expect(normal.disabled).toBe(true);
    expect(advance.disabled).toBe(true);
    expect(end.disabled).toBe(true);

    fireEvent.click(normal);
    fireEvent.click(end);
    expect(harness.actions()).toEqual([]);
  });

  it('offers cancel for a pending normal move but not for an advance', () => {
    const pendingNormal = makeState({
      ...movementState(),
      pendingMove: { unitId: 'u-mine', kind: 'normal', budget: 6, advanceRoll: null },
    });
    const harness = makeHarness(pendingNormal, 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);
    const cancel = screen.getByRole('button', { name: 'Cancel Move' }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
    fireEvent.click(cancel);
    expect(harness.actions()).toEqual([
      { type: 'cancelMove', player: 0, unitId: 'u-mine' },
    ]);
  });
});

describe('ActionPanel — shooting phase', () => {
  it('dispatches declareShoot with the chosen weapon-to-target assignments', () => {
    const harness = makeHarness(shootingState(), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);

    fireEvent.change(screen.getByLabelText('Target for Pulse rifle'), {
      target: { value: 'u-enemy-1' },
    });
    fireEvent.change(screen.getByLabelText('Target for Pulse pistol'), {
      target: { value: 'u-enemy-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));

    expect(harness.actions()).toEqual([
      {
        type: 'declareShoot',
        player: 0,
        unitId: 'u-mine',
        assignments: [
          { weaponId: 'pulse-rifle', targetUnitId: 'u-enemy-1' },
          { weaponId: 'pulse-pistol', targetUnitId: 'u-enemy-2' },
        ],
      },
    ]);
  });

  it('omits weapons left without a target', () => {
    const harness = makeHarness(shootingState(), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);

    fireEvent.change(screen.getByLabelText('Target for Pulse rifle'), {
      target: { value: 'u-enemy-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fire' }));

    const actions = harness.actions();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: 'declareShoot',
      assignments: [{ weaponId: 'pulse-rifle', targetUnitId: 'u-enemy-2' }],
    });
  });

  it('disables Fire until a target is chosen', () => {
    const harness = makeHarness(shootingState(), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);
    const fire = screen.getByRole('button', { name: 'Fire' }) as HTMLButtonElement;
    expect(fire.disabled).toBe(true);
  });
});

describe('ActionPanel — setup phase', () => {
  function setupState(overrides: Partial<NonNullable<GameState['setup']>> = {}): GameState {
    return makeState({
      phase: 'setup',
      step: null,
      round: 0,
      setup: {
        rostersLoaded: [true, true],
        rollOff: null,
        attacker: null,
        deployNext: null,
        readyToStart: false,
        ...overrides,
      },
    });
  }

  it('shows the roll-off button to both seats once rosters are loaded', () => {
    for (const seat of [0, 1] as const) {
      const harness = makeHarness(setupState(), seat);
      const view = renderWithStore(harness, <ActionPanel />);
      fireEvent.click(screen.getByRole('button', { name: 'Roll Off' }));
      expect(harness.actions()).toEqual([{ type: 'performRollOff', player: seat }]);
      view.unmount();
    }
  });

  it('only offers the role choice to the roll-off winner', () => {
    const state = setupState({
      rollOff: { purpose: 'attackerChoice', rolls: [6, 2], winner: 0 },
    });

    const winner = makeHarness(state, 0);
    const winnerView = renderWithStore(winner, <ActionPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Claim Attacker' }));
    expect(winner.actions()).toEqual([{ type: 'chooseRole', player: 0, role: 'attacker' }]);
    winnerView.unmount();

    const loser = makeHarness(state, 1);
    renderWithStore(loser, <ActionPanel />);
    expect(screen.queryByRole('button', { name: 'Claim Attacker' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Claim Defender' })).toBeNull();
  });

  it('enables Begin Battle only for the first player', () => {
    const ready = makeState({
      phase: 'setup',
      step: null,
      round: 0,
      activePlayer: 1,
      firstPlayer: 1,
      setup: {
        rostersLoaded: [true, true],
        rollOff: { purpose: 'firstTurn', rolls: [1, 5], winner: 1 },
        attacker: 0,
        deployNext: null,
        readyToStart: true,
      },
    });
    const harness = makeHarness(ready, 0);
    renderWithStore(harness, <ActionPanel />);
    const begin = screen.getByRole('button', { name: 'Begin Battle' }) as HTMLButtonElement;
    expect(begin.disabled).toBe(true);
  });
});

describe('ActionPanel — spectator', () => {
  it('renders no action buttons for spectators', () => {
    const harness = makeHarness(movementState(), null, { spectator: true });
    renderWithStore(harness, <ActionPanel />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/read only/i)).toBeTruthy();
  });
});
