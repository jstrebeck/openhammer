import { useGameStore } from '../../storeContext';

/**
 * Opponent-approval undo flow. The requester sees a waiting banner; the
 * opponent gets an Approve/Deny modal that answers over the socket
 * (respondUndo) — the server rewinds and broadcasts the result.
 */
export function UndoPrompt() {
  const game = useGameStore((s) => s.game);
  const seat = useGameStore((s) => s.playerIndex);
  const prompt = useGameStore((s) => s.undoPrompt);
  const respondUndo = useGameStore((s) => s.respondUndo);

  if (!prompt || seat === null) return null;

  if (prompt.by === seat) {
    return (
      <div className="banner waiting-banner">
        Undo requested — waiting for your opponent to respond…
      </div>
    );
  }

  const name = game?.players[prompt.by].name ?? 'Your opponent';
  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-label="Undo request">
        <h3>Undo request</h3>
        <p>
          {name} asks to undo {prompt.count} action{prompt.count === 1 ? '' : 's'}.
        </p>
        <div className="modal-actions">
          <button onClick={() => respondUndo(true)}>Approve</button>
          <button onClick={() => respondUndo(false)}>Deny</button>
        </div>
      </div>
    </div>
  );
}
