import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { makeState } from '../../test/fixtures';
import { makeHarness, renderWithStore } from '../../test/harness';
import { UndoPrompt } from './UndoPrompt';

describe('undo store handling', () => {
  it('requestUndo sends a requestUndo frame', () => {
    const harness = makeHarness(makeState(), 0);
    harness.store.getState().requestUndo(1);
    expect(harness.sent).toContainEqual({ type: 'requestUndo', count: 1 });
  });

  it('receiving undoRequested sets the prompt state', () => {
    const harness = makeHarness(makeState(), 0);
    harness.receive({ type: 'undoRequested', by: 1, count: 2 });
    expect(harness.store.getState().undoPrompt).toEqual({ by: 1, count: 2 });
  });

  it('receiving undoResolved clears the prompt and records the result', () => {
    const harness = makeHarness(makeState(), 0);
    harness.receive({ type: 'undoRequested', by: 1, count: 1 });
    harness.receive({ type: 'undoResolved', performed: true, approved: true });
    const s = harness.store.getState();
    expect(s.undoPrompt).toBeNull();
    expect(s.undoResult?.performed).toBe(true);
    expect(s.undoResult?.approved).toBe(true);
  });
});

describe('UndoPrompt', () => {
  it('shows Approve/Deny to the opponent and approving sends respondUndo', () => {
    const harness = makeHarness(makeState(), 0);
    harness.receive({ type: 'undoRequested', by: 1, count: 2 });
    renderWithStore(harness, <UndoPrompt />);

    expect(screen.getByText(/Bob asks to undo 2 actions/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(harness.sent).toContainEqual({ type: 'respondUndo', approve: true });
    expect(harness.store.getState().undoPrompt).toBeNull();
  });

  it('denying sends respondUndo approve:false', () => {
    const harness = makeHarness(makeState(), 0);
    harness.receive({ type: 'undoRequested', by: 1, count: 1 });
    renderWithStore(harness, <UndoPrompt />);

    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(harness.sent).toContainEqual({ type: 'respondUndo', approve: false });
  });

  it('shows a waiting banner to the requester (no Approve button)', () => {
    const harness = makeHarness(makeState(), 0);
    harness.receive({ type: 'undoRequested', by: 0, count: 1 });
    renderWithStore(harness, <UndoPrompt />);

    expect(screen.getByText(/waiting for your opponent/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
