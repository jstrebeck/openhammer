import { useState } from 'react';
import type { GameState, PlayerIndex, UnitState } from '@openhammer/core';
import { useGameStore } from '../../storeContext';
import { aliveModels } from '../interaction';

/**
 * Contextual actions for the current phase. Everything here only PROPOSES
 * actions — the server accepts or rejects; the UI merely disables what is
 * obviously out of turn.
 */
export function ActionPanel() {
  const game = useGameStore((s) => s.game);
  const seat = useGameStore((s) => s.playerIndex);
  const spectator = useGameStore((s) => s.spectator);

  if (!game) return null;
  if (spectator || seat === null) {
    return (
      <section className="panel action-panel">
        <h2>Actions</h2>
        <p className="muted">Spectating — read only.</p>
      </section>
    );
  }
  return (
    <section className="panel action-panel">
      <h2>Actions</h2>
      <PanelBody game={game} seat={seat} />
    </section>
  );
}

function PanelBody({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  if (game.result !== null) return <p className="muted">The battle has ended.</p>;
  if (game.phase === 'setup') return <SetupActions game={game} seat={seat} />;
  return (
    <>
      {game.phase === 'movement' && <MovementActions game={game} seat={seat} />}
      {game.phase === 'shooting' && <ShootingActions game={game} seat={seat} />}
      <AdvanceStepButton game={game} seat={seat} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Setup: roll-off, role choice, deployment list, first-turn roll, begin
// ---------------------------------------------------------------------------

function SetupActions({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const dispatch = useGameStore((s) => s.dispatch);
  const setInteraction = useGameStore((s) => s.setInteraction);
  const selectUnit = useGameStore((s) => s.selectUnit);
  const interaction = useGameStore((s) => s.interaction);
  const setup = game.setup;
  if (!setup) return null;

  const bothLoaded = setup.rostersLoaded[0] && setup.rostersLoaded[1];
  if (!bothLoaded) {
    return <p className="muted">Waiting for both rosters to be uploaded…</p>;
  }

  // 1) Attacker/defender roll-off.
  if (setup.attacker === null) {
    const rollOff = setup.rollOff;
    if (!rollOff || rollOff.purpose !== 'attackerChoice') {
      return (
        <button onClick={() => dispatch({ type: 'performRollOff', player: seat })}>
          Roll Off
        </button>
      );
    }
    // 2) Role choice — ONLY the roll-off winner chooses.
    if (rollOff.winner === seat) {
      return (
        <div className="stack">
          <p>
            You won the roll-off ({rollOff.rolls[0]} vs {rollOff.rolls[1]}).
          </p>
          <button onClick={() => dispatch({ type: 'chooseRole', player: seat, role: 'attacker' })}>
            Claim Attacker
          </button>
          <button onClick={() => dispatch({ type: 'chooseRole', player: seat, role: 'defender' })}>
            Claim Defender
          </button>
        </div>
      );
    }
    return (
      <p className="muted">
        {game.players[rollOff.winner].name} won the roll-off and is choosing a role…
      </p>
    );
  }

  // 3) Alternating deployment.
  if (setup.deployNext !== null) {
    const myTurn = setup.deployNext === seat;
    const undeployed = Object.values(game.units).filter(
      (u) =>
        u.owner === seat &&
        u.reserves === 'none' &&
        aliveModels(u).length > 0 &&
        u.models.every((m) => m.position === null),
    );
    return (
      <div className="stack">
        <p>{myTurn ? 'Your turn to deploy.' : `${game.players[setup.deployNext].name} is deploying…`}</p>
        {undeployed.map((u) => (
          <button
            key={u.id}
            disabled={!myTurn}
            className={interaction.mode === 'deploying' && interaction.unitId === u.id ? 'active' : ''}
            onClick={() => {
              selectUnit(u.id);
              setInteraction({ mode: 'deploying', unitId: u.id });
            }}
          >
            Deploy {u.name}
          </button>
        ))}
        {interaction.mode === 'deploying' && (
          <p className="muted">Click the board to place the unit.</p>
        )}
      </div>
    );
  }

  // 4) First-turn roll-off — both players may roll.
  if (!setup.readyToStart) {
    return (
      <button onClick={() => dispatch({ type: 'performRollOff', player: seat })}>
        Roll Off for First Turn
      </button>
    );
  }

  // 5) Begin battle — only the first player (activePlayer) advances.
  return (
    <button
      disabled={game.activePlayer !== seat}
      onClick={() => dispatch({ type: 'advanceStep', player: seat })}
    >
      Begin Battle
    </button>
  );
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

const MOVE_KINDS: { kind: 'normal' | 'advance' | 'fallBack' | 'stationary'; label: string }[] = [
  { kind: 'normal', label: 'Normal Move' },
  { kind: 'advance', label: 'Advance' },
  { kind: 'fallBack', label: 'Fall Back' },
  { kind: 'stationary', label: 'Remain Stationary' },
];

function MovementActions({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const dispatch = useGameStore((s) => s.dispatch);
  const setInteraction = useGameStore((s) => s.setInteraction);
  const selectedUnitId = useGameStore((s) => s.selectedUnitId);
  const myTurn = game.activePlayer === seat;

  const pending = game.pendingMove;
  if (pending) {
    const unit = game.units[pending.unitId];
    if (unit && unit.owner === seat) {
      return (
        <div className="stack">
          <p>
            Moving <strong>{unit.name}</strong> — up to {pending.budget}"
            {pending.advanceRoll !== null ? ` (advance roll ${pending.advanceRoll})` : ''}. Click
            the board to commit.
          </p>
          <button
            disabled={pending.kind === 'advance' || !myTurn}
            onClick={() => dispatch({ type: 'cancelMove', player: seat, unitId: pending.unitId })}
          >
            Cancel Move
          </button>
        </div>
      );
    }
    return <p className="muted">Opponent is moving a unit…</p>;
  }

  const unit = selectedUnitId ? game.units[selectedUnitId] : undefined;
  if (!unit || unit.owner !== seat) {
    return <p className="muted">Select one of your units to move.</p>;
  }
  if (unit.turnFlags.moveKind !== null) {
    return (
      <p className="muted">
        {unit.name} has already {unit.turnFlags.moveKind === 'stationary' ? 'remained stationary' : 'moved'} this turn.
      </p>
    );
  }
  return (
    <div className="stack">
      <p>
        Move <strong>{unit.name}</strong>:
      </p>
      {MOVE_KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          disabled={!myTurn}
          onClick={() => {
            if (kind !== 'stationary') setInteraction({ mode: 'moving', unitId: unit.id, kind });
            dispatch({ type: 'startMove', player: seat, unitId: unit.id, kind });
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shooting
// ---------------------------------------------------------------------------

function ShootingActions({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const selectedUnitId = useGameStore((s) => s.selectedUnitId);
  const unit = selectedUnitId ? game.units[selectedUnitId] : undefined;
  if (!unit || unit.owner !== seat) {
    return <p className="muted">Select one of your units to shoot with.</p>;
  }
  if (unit.turnFlags.hasShot) {
    return <p className="muted">{unit.name} has already shot this turn.</p>;
  }
  // Key by unit so target choices reset when the selection changes.
  return <ShootingControls key={unit.id} game={game} seat={seat} unit={unit} />;
}

function ShootingControls({
  game,
  seat,
  unit,
}: {
  game: GameState;
  seat: PlayerIndex;
  unit: UnitState;
}) {
  const dispatch = useGameStore((s) => s.dispatch);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const myTurn = game.activePlayer === seat;

  const carried = new Set(
    aliveModels(unit).flatMap((m) => unit.loadout[m.id] ?? []),
  );
  const weapons = Object.values(unit.weapons).filter(
    (w) => w.kind === 'ranged' && carried.has(w.id),
  );
  const enemies = Object.values(game.units).filter(
    (u) => u.owner !== seat && aliveModels(u).some((m) => m.position !== null),
  );
  const assignments = weapons
    .filter((w) => targets[w.id])
    .map((w) => ({ weaponId: w.id, targetUnitId: targets[w.id]! }));

  if (weapons.length === 0) {
    return <p className="muted">{unit.name} has no ranged weapons.</p>;
  }
  return (
    <div className="stack">
      <p>
        <strong>{unit.name}</strong> — assign targets:
      </p>
      {weapons.map((w) => (
        <label key={w.id} className="weapon-row">
          <span>
            {w.name} <span className="muted">(R{w.range}")</span>
          </span>
          <select
            aria-label={`Target for ${w.name}`}
            value={targets[w.id] ?? ''}
            onChange={(e) =>
              setTargets((prev) => ({ ...prev, [w.id]: e.target.value }))
            }
          >
            <option value="">— no target —</option>
            {enemies.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        disabled={!myTurn || assignments.length === 0 || game.shooting !== null}
        onClick={() =>
          dispatch({ type: 'declareShoot', player: seat, unitId: unit.id, assignments })
        }
      >
        Fire
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic step advance
// ---------------------------------------------------------------------------

function AdvanceStepButton({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const dispatch = useGameStore((s) => s.dispatch);
  const blocked =
    game.activePlayer !== seat ||
    game.pendingDecision !== null ||
    game.pendingMove !== null ||
    game.shooting !== null;
  return (
    <button
      className="end-phase"
      disabled={blocked}
      onClick={() => dispatch({ type: 'advanceStep', player: seat })}
    >
      End Step / Phase
    </button>
  );
}
