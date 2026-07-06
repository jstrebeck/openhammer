import { useGameStore } from '../../storeContext';

/**
 * Reactive save window (shooting and melee alike — the copy only relies
 * on context.weaponName). Modal for the player who must roll; a passive
 * banner for everyone else.
 */
export function SavePrompt() {
  const game = useGameStore((s) => s.game);
  const seat = useGameStore((s) => s.playerIndex);
  const dispatch = useGameStore((s) => s.dispatch);

  const decision = game?.pendingDecision;
  if (!game || !decision || decision.kind !== 'saves') return null;

  const context = decision.context as {
    weaponName?: string;
    wounds?: number;
    mortalWounds?: number;
    targetUnitId?: string;
    attackerUnitId?: string;
  };
  const weaponName = context.weaponName ?? 'Attack';
  const wounds = context.wounds ?? 0;
  const mortalWounds = context.mortalWounds ?? 0;
  const targetName = context.targetUnitId
    ? (game.units[context.targetUnitId]?.name ?? context.targetUnitId)
    : 'your unit';

  if (seat === null || decision.player !== seat) {
    return (
      <div className="banner waiting-banner">
        Waiting for {game.players[decision.player].name}: saves…
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-label="Roll saves">
        <h3>Incoming attacks</h3>
        <p>
          {weaponName} hits {targetName}: {wounds} wound{wounds === 1 ? '' : 's'}
          {mortalWounds > 0 ? ` (+${mortalWounds} devastating)` : ''} incoming.
        </p>
        <button onClick={() => dispatch({ type: 'resolveSaves', player: seat })}>
          Roll Saves
        </button>
      </div>
    </div>
  );
}
