import { useState } from 'react';
import { useGameStore } from '../../storeContext';

/**
 * Reactive save window (shooting and melee alike — the copy only relies
 * on context.weaponName). The defender allocates each wound to a model
 * of their choice (the already-wounded model is forced first, per the
 * core rules), picks armour vs invulnerable, and can auto-resolve the
 * remainder at any point. A passive banner shows for everyone else.
 */
export function SavePrompt() {
  const game = useGameStore((s) => s.game);
  const seat = useGameStore((s) => s.playerIndex);
  const dispatch = useGameStore((s) => s.dispatch);
  const datasheets = useGameStore((s) => s.datasheets);
  const [chosenModel, setChosenModel] = useState('');
  const [useInvuln, setUseInvuln] = useState(false);

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
  const target = context.targetUnitId ? game.units[context.targetUnitId] : undefined;
  const targetName = target?.name ?? 'your unit';

  if (seat === null || decision.player !== seat) {
    return (
      <div className="banner waiting-banner">
        Waiting for {game.players[decision.player].name}: saves…
      </div>
    );
  }

  // Allocation pool: with Precision live the leader soaks first (the
  // server enforces it; mirror that here so the UI only offers legal picks).
  const seqCurrent = game.shooting?.current;
  const leaderUnit =
    seqCurrent?.precision && target?.leaderOf ? game.units[target.leaderOf] : undefined;
  const leaderAlive = leaderUnit?.models.some((m) => !m.destroyed) ?? false;
  const poolUnit = leaderAlive ? leaderUnit! : target;
  const pool = (poolUnit?.models ?? []).filter((m) => !m.destroyed);
  const forced = pool.find((m) => m.hasTakenWoundsThisPhase);
  const poolSheet = poolUnit ? datasheets[poolUnit.datasheetId] : undefined;
  const profileOf = (profileId: string) =>
    poolSheet?.models.find((p) => p.id === profileId) ?? poolSheet?.models[0];
  const effectInvuln = seqCurrent?.save.invulnerableSave ?? null;

  const selectedId = forced ? forced.id : chosenModel || (pool[0]?.id ?? '');
  const selected = pool.find((m) => m.id === selectedId);
  const selectedProfile = selected ? profileOf(selected.profileId) : undefined;
  const invulnAvailable =
    (selectedProfile?.invulnerableSave ?? null) !== null || effectInvuln !== null;
  const invulnValue = Math.min(
    selectedProfile?.invulnerableSave ?? 99,
    effectInvuln ?? 99,
  );

  return (
    <div className="modal-overlay">
      <div className="modal" role="dialog" aria-label="Roll saves">
        <h3>Incoming attacks</h3>
        <p>
          {weaponName} hits {targetName}: {wounds} wound{wounds === 1 ? '' : 's'}
          {mortalWounds > 0 ? ` (+${mortalWounds} devastating)` : ''} incoming.
        </p>
        {pool.length > 0 && (
          <div className="allocate-row">
            <label>
              Allocate to
              <select
                aria-label="Allocate to model"
                value={selectedId}
                disabled={forced !== undefined}
                onChange={(e) => setChosenModel(e.target.value)}
              >
                {pool.map((m) => {
                  const profile = profileOf(m.profileId);
                  return (
                    <option key={m.id} value={m.id}>
                      {profile?.name ?? m.id} — {m.woundsRemaining}W
                      {m.hasTakenWoundsThisPhase ? ' (wounded)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            {forced && (
              <p className="muted">The already-wounded model must take this wound.</p>
            )}
            {invulnAvailable && (
              <label className="invuln-toggle">
                <input
                  type="checkbox"
                  checked={useInvuln}
                  onChange={(e) => setUseInvuln(e.target.checked)}
                />
                Use invulnerable save ({invulnValue}+)
              </label>
            )}
            <button
              disabled={!selected}
              onClick={() =>
                dispatch({
                  type: 'allocateWound',
                  player: seat,
                  modelId: selectedId,
                  ...(useInvuln ? { useInvulnerable: true } : {}),
                })
              }
            >
              Allocate &amp; Roll
            </button>
          </div>
        )}
        <button
          className="auto-resolve"
          onClick={() => dispatch({ type: 'resolveSaves', player: seat })}
        >
          Auto-resolve {wounds > 1 ? 'all' : ''} ({wounds + mortalWounds})
        </button>
      </div>
    </div>
  );
}
