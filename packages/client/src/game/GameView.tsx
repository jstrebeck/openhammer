import { useEffect } from 'react';
import { useGameStore, useStoreApi } from '../storeContext';
import { BoardCanvas } from './BoardCanvas';
import { ActionPanel } from './panels/ActionPanel';
import { LogPanel } from './panels/LogPanel';
import { PhaseTracker } from './panels/PhaseTracker';
import { SavePrompt } from './panels/SavePrompt';
import { StratagemPrompt } from './panels/StratagemPrompt';
import { Toast } from './panels/Toast';
import { UndoPrompt } from './panels/UndoPrompt';
import { UnitPanel } from './panels/UnitPanel';

export function GameView() {
  const store = useStoreApi();
  const game = useGameStore((s) => s.game);
  const seat = useGameStore((s) => s.playerIndex);
  const spectator = useGameStore((s) => s.spectator);
  const status = useGameStore((s) => s.status);

  // Escape cancels an in-progress move (not an advance — the die is rolled).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = store.getState();
      const pending = s.game?.pendingMove;
      if (
        pending &&
        pending.kind !== 'advance' &&
        s.playerIndex !== null &&
        s.game?.units[pending.unitId]?.owner === s.playerIndex
      ) {
        s.dispatch({ type: 'cancelMove', player: s.playerIndex, unitId: pending.unitId });
      }
      if (s.interaction.mode !== 'idle') s.setInteraction({ mode: 'idle' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  if (!game) return null;

  return (
    <div className="game-layout">
      <header className="top-bar">
        <span className="brand">OpenHammer</span>
        {spectator && <span className="banner spectator-banner">Spectating — read only</span>}
        {status !== 'connected' && <span className="banner conn-banner">Reconnecting…</span>}
        {seat !== null && game.result === null && (
          <button
            className="undo-btn"
            disabled={game.actionSeq === 0}
            onClick={() => store.getState().requestUndo(1)}
          >
            Undo
          </button>
        )}
        <details className="menu">
          <summary>Menu</summary>
          <div className="menu-body">
            {seat !== null && game.result === null && (
              <button
                onClick={() => {
                  store.getState().dispatch({ type: 'concede', player: seat });
                }}
              >
                Concede
              </button>
            )}
          </div>
        </details>
      </header>
      <main className="game-main">
        <BoardCanvas />
        <aside className="side-panels">
          <PhaseTracker />
          <ActionPanel />
          <UnitPanel />
          <LogPanel />
        </aside>
      </main>
      <SavePrompt />
      <StratagemPrompt />
      <UndoPrompt />
      <Toast />
      {game.result !== null && <EndScreen />}
    </div>
  );
}

function EndScreen() {
  const game = useGameStore((s) => s.game);
  if (!game || game.result === null) return null;
  const { winner, concededBy } = game.result;
  const title =
    winner === 'draw' || winner === null
      ? 'The battle ends in a draw'
      : `${game.players[winner].name} wins!`;
  return (
    <div className="modal-overlay">
      <div className="modal end-screen">
        <h2>{title}</h2>
        {concededBy !== undefined && <p>{game.players[concededBy].name} conceded.</p>}
        <p>
          Final score — {game.players[0].name}: {game.players[0].vp} VP · {game.players[1].name}:{' '}
          {game.players[1].vp} VP
        </p>
        <div className="vp-breakdown">
          {game.players.map((p) => (
            <div key={p.index}>
              <h3>{p.name}</h3>
              {p.vpLog.length === 0 ? (
                <p className="muted">No victory points scored.</p>
              ) : (
                <ul>
                  {p.vpLog.map((entry, i) => (
                    <li key={i}>
                      R{entry.round}: +{entry.amount} VP — {entry.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
