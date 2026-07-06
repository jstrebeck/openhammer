import { useGameStore } from '../../storeContext';

const PHASE_LABELS: Record<string, string> = {
  setup: 'Setup',
  command: 'Command Phase',
  movement: 'Movement Phase',
  shooting: 'Shooting Phase',
  charge: 'Charge Phase',
  fight: 'Fight Phase',
  ended: 'Battle Ended',
};

function label(id: string | null): string {
  if (!id) return '';
  return PHASE_LABELS[id] ?? id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

export function PhaseTracker() {
  const game = useGameStore((s) => s.game);
  const seat = useGameStore((s) => s.playerIndex);
  if (!game) return null;

  const active = game.players[game.activePlayer];
  const turnText =
    game.phase === 'setup'
      ? 'Pre-battle'
      : seat !== null && game.activePlayer === seat
        ? 'Your turn'
        : `${active.name}'s turn`;

  return (
    <section className="panel phase-tracker">
      <div className="phase-line">
        <strong>{game.phase === 'setup' ? 'Setup' : `Round ${game.round}`}</strong>
        <span>{label(game.phase)}</span>
        {game.step && game.step !== game.phase && <span className="muted">{label(game.step)}</span>}
      </div>
      <div className="turn-line">{turnText}</div>
      <div className="players-line">
        {game.players.map((p, i) => (
          <div key={i} className={`player-chip p${i} ${game.activePlayer === i ? 'active' : ''}`}>
            <span className="name">
              {p.name}
              {seat === i ? ' (you)' : ''}
            </span>
            <span>CP {p.cp}</span>
            <span>VP {p.vp}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
