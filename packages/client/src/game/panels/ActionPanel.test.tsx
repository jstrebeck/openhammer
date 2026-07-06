import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { GameState } from '@openhammer/core';
import { makeModel, makeState, makeUnit, makeWeapon } from '../../test/fixtures';
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

describe('ActionPanel — charge phase', () => {
  function chargeState(overrides: Partial<GameState> = {}): GameState {
    return makeState({
      phase: 'charge',
      step: 'charge',
      activePlayer: 0,
      units: {
        'u-mine': makeUnit('u-mine', 0),
        'u-near': makeUnit('u-near', 1, {
          name: 'Near Enemy',
          models: [
            makeModel('u-near-m0', { position: { x: 10, y: 14 } }),
            makeModel('u-near-m1', { position: { x: 11.5, y: 14 } }),
          ],
        }),
        'u-far': makeUnit('u-far', 1, {
          name: 'Far Enemy',
          models: [makeModel('u-far-m0', { position: { x: 10, y: 40 } })],
        }),
      },
      ...overrides,
    });
  }

  it('dispatches declareCharge with the checked targets (12" prefilter)', () => {
    const harness = makeHarness(chargeState(), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);

    // The 26"-away enemy is prefiltered out.
    expect(screen.queryByLabelText('Charge target Far Enemy')).toBeNull();
    fireEvent.click(screen.getByLabelText('Charge target Near Enemy'));
    fireEvent.click(screen.getByRole('button', { name: 'Declare Charge' }));

    expect(harness.actions()).toEqual([
      { type: 'declareCharge', player: 0, unitId: 'u-mine', targetIds: ['u-near'] },
    ]);
  });

  it('disables Declare Charge until a target is checked', () => {
    const harness = makeHarness(chargeState(), 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);
    const declare = screen.getByRole('button', { name: 'Declare Charge' }) as HTMLButtonElement;
    expect(declare.disabled).toBe(true);
  });

  it('shows the roll while my charge is pending and dispatches failCharge', () => {
    const state = chargeState({
      charge: { unitId: 'u-mine', targetIds: ['u-near'], roll: 7, rolls: [3, 4] },
    });
    const harness = makeHarness(state, 0);
    renderWithStore(harness, <ActionPanel />);

    expect(screen.getByText('3+4 = 7"')).toBeTruthy();
    const commit = screen.getByRole('button', { name: 'Commit Charge' }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true); // nothing staged on the board yet
    fireEvent.click(screen.getByRole('button', { name: 'Charge Fails' }));
    expect(harness.actions()).toEqual([{ type: 'failCharge', player: 0, unitId: 'u-mine' }]);
  });

  it('excludes units that advanced this turn', () => {
    const state = chargeState();
    state.units['u-mine']!.turnFlags.moveKind = 'advance';
    const harness = makeHarness(state, 0, { selectedUnitId: 'u-mine' });
    renderWithStore(harness, <ActionPanel />);
    expect(screen.getByText('No units are eligible to charge.')).toBeTruthy();
  });
});

describe('ActionPanel — fight phase', () => {
  function fightState(
    fight: NonNullable<GameState['fight']>,
    overrides: Partial<GameState> = {},
  ): GameState {
    return makeState({
      phase: 'fight',
      step: 'remainingCombats',
      activePlayer: 1, // my unit fights on the OPPONENT's turn
      units: {
        'u-mine': makeUnit('u-mine', 0, {
          weapons: {
            chainsword: makeWeapon('chainsword', {
              name: 'Chainsword',
              kind: 'melee',
              range: null,
            }),
          },
        }),
        'u-enemy': makeUnit('u-enemy', 1, {
          name: 'Enemy Blob',
          models: [
            makeModel('u-enemy-m0', { position: { x: 10, y: 11.8 } }),
            makeModel('u-enemy-m1', { position: { x: 11.5, y: 11.8 } }),
          ],
        }),
      },
      fight,
      ...overrides,
    });
  }

  it('offers selectFighter when I am the selector', () => {
    const harness = makeHarness(
      fightState({ selector: 0, activeUnitId: null, stage: 'select', fought: [] }),
      0,
    );
    renderWithStore(harness, <ActionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Fight with Unit u-mine' }));
    expect(harness.actions()).toEqual([{ type: 'selectFighter', player: 0, unitId: 'u-mine' }]);
  });

  it('shows only a waiting note when the OTHER player selects', () => {
    const harness = makeHarness(
      fightState({ selector: 1, activeUnitId: null, stage: 'select', fought: [] }),
      0,
    );
    renderWithStore(harness, <ActionPanel />);

    expect(screen.queryByRole('button', { name: /Fight with/ })).toBeNull();
    expect(screen.getByText(/Bob is selecting a unit to fight/)).toBeTruthy();
  });

  it('dispatches declareMelee with the chosen weapon-to-target assignment', () => {
    const harness = makeHarness(
      fightState({ selector: 0, activeUnitId: 'u-mine', stage: 'attacks', fought: [] }),
      0,
    );
    renderWithStore(harness, <ActionPanel />);

    fireEvent.change(screen.getByLabelText('Melee target for Chainsword'), {
      target: { value: 'u-enemy' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Fight' }));

    expect(harness.actions()).toEqual([
      {
        type: 'declareMelee',
        player: 0,
        unitId: 'u-mine',
        assignments: [{ weaponId: 'chainsword', targetUnitId: 'u-enemy' }],
      },
    ]);
  });

  it('No Attacks dispatches declareMelee with an empty assignment list', () => {
    const harness = makeHarness(
      fightState({ selector: 0, activeUnitId: 'u-mine', stage: 'attacks', fought: [] }),
      0,
    );
    renderWithStore(harness, <ActionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'No Attacks' }));
    expect(harness.actions()).toEqual([
      { type: 'declareMelee', player: 0, unitId: 'u-mine', assignments: [] },
    ]);
  });

  it('Confirm Pile In / Stay Put dispatch pileIn with the current positions', () => {
    const harness = makeHarness(
      fightState({ selector: 0, activeUnitId: 'u-mine', stage: 'pileIn', fought: [] }),
      0,
    );
    renderWithStore(harness, <ActionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Stay Put' }));
    expect(harness.actions()).toEqual([
      {
        type: 'pileIn',
        player: 0,
        unitId: 'u-mine',
        positions: [
          { modelId: 'u-mine-m0', x: 10, y: 10 },
          { modelId: 'u-mine-m1', x: 11.5, y: 10 },
        ],
      },
    ]);
  });
});

describe('ActionPanel — setup prep & reinforcements', () => {
  it('dispatches setReserves from the pre-roll-off reserves select', () => {
    const state = makeState({
      phase: 'setup',
      step: null,
      round: 0,
      units: {
        'u-mine': makeUnit('u-mine', 0, {
          models: [makeModel('u-mine-m0', { position: null })],
        }),
      },
      setup: {
        rostersLoaded: [true, true],
        rollOff: null,
        attacker: null,
        deployNext: null,
        readyToStart: false,
      },
    });
    const harness = makeHarness(state, 0);
    renderWithStore(harness, <ActionPanel />);

    fireEvent.change(screen.getByLabelText('Reserves for Unit u-mine'), {
      target: { value: 'deepStrike' },
    });
    expect(harness.actions()).toEqual([
      { type: 'setReserves', player: 0, unitId: 'u-mine', kind: 'deepStrike' },
    ]);
  });

  it('lists my reserves in the reinforcements step and enters placement mode', () => {
    const state = makeState({
      phase: 'movement',
      step: 'reinforcements',
      round: 2,
      activePlayer: 0,
      units: {
        'u-res': makeUnit('u-res', 0, {
          reserves: 'deepStrike',
          models: [
            makeModel('u-res-m0', { position: null }),
            makeModel('u-res-m1', { position: null }),
          ],
        }),
        'u-enemy': makeUnit('u-enemy', 1),
      },
    });
    const harness = makeHarness(state, 0);
    renderWithStore(harness, <ActionPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Deploy Unit u-res (Deep Strike)' }));
    expect(harness.store.getState().interaction).toEqual({
      mode: 'placingReserves',
      unitId: 'u-res',
    });
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
