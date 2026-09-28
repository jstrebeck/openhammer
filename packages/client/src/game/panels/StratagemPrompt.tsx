import { useState } from 'react';
import type { GameState, PendingDecision, PlayerIndex, StratagemOption } from '@openhammer/core';
import { useGameStore } from '../../storeContext';

/**
 * Reactive stratagem window. Modal for the player who owns the window
 * (option cards + pass); a passive banner for everyone else. Purely
 * proposes actions — eligibility already came from the server.
 */

/** "command.battleShockFailed" -> "Command: Battle Shock Failed". */
export function humanizeHook(hook: string): string {
  if (!hook) return 'Reactive window';
  return hook
    .split('.')
    .map((part) =>
      part
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (c) => c.toUpperCase()),
    )
    .join(': ');
}

export function StratagemPrompt() {
  const game = useGameStore((s) => s.game);
  const seat = useGameStore((s) => s.playerIndex);

  const decision = game?.pendingDecision;
  if (!game || !decision || decision.kind !== 'stratagemWindow') return null;

  const hook = String(decision.context.hook ?? decision.window ?? '');
  if (seat === null || decision.player !== seat) {
    return (
      <div className="banner waiting-banner">
        Waiting for {game.players[decision.player].name}: reactive window ({hook})
      </div>
    );
  }
  // Key by decision id so target/checkbox state resets per window.
  return <StratagemPromptBody key={decision.id} game={game} seat={seat} decision={decision} hook={hook} />;
}

function StratagemPromptBody({
  game,
  seat,
  decision,
  hook,
}: {
  game: GameState;
  seat: PlayerIndex;
  decision: PendingDecision;
  hook: string;
}) {
  const dispatch = useGameStore((s) => s.dispatch);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [dontAsk, setDontAsk] = useState(false);

  const options = decision.options as StratagemOption[];

  return (
    <div className="modal-overlay">
      <div className="modal stratagem-modal" role="dialog" aria-label="Stratagem window">
        <h3>{humanizeHook(hook)}</h3>
        <p className="muted">Reactive stratagem window — use a stratagem or pass.</p>
        {options.map((o) => {
          const chosen = targets[o.stratagemId] ?? '';
          return (
            <div key={o.stratagemId} className="strat-card">
              <div className="strat-head">
                <strong>{o.name}</strong>
                <span className="muted">{o.cost} CP</span>
              </div>
              {o.targets.length > 0 && (
                <select
                  aria-label={`Target for ${o.name}`}
                  value={chosen}
                  onChange={(e) =>
                    setTargets((prev) => ({ ...prev, [o.stratagemId]: e.target.value }))
                  }
                >
                  <option value="">— choose target —</option>
                  {o.targets.map((id) => (
                    <option key={id} value={id}>
                      {game.units[id]?.name ?? id}
                    </option>
                  ))}
                </select>
              )}
              <button
                disabled={o.requiresTarget && chosen === ''}
                onClick={() =>
                  dispatch({
                    type: 'useStratagem',
                    player: seat,
                    stratagemId: o.stratagemId,
                    ...(chosen !== '' ? { targetUnitId: chosen } : {}),
                  })
                }
              >
                Use {o.name}
              </button>
            </div>
          );
        })}
        <label className="dont-ask">
          <input
            type="checkbox"
            checked={dontAsk}
            onChange={(e) => setDontAsk(e.target.checked)}
          />
          Don't ask again this phase
        </label>
        <button
          className="pass-btn"
          onClick={() =>
            dispatch({
              type: 'passWindow',
              player: seat,
              ...(dontAsk ? { dontAskAgainThisPhase: true } : {}),
            })
          }
        >
          Pass
        </button>
      </div>
    </div>
  );
}
