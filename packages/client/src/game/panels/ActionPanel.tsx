import { useState } from 'react';
import type { GameState, PlayerIndex, UnitState } from '@openhammer/core';
import { useGameStore } from '../../storeContext';
import {
  aliveModels,
  canDeclareCharge,
  canFightThisStep,
  CHARGE_RANGE_PREFILTER,
  currentPositions,
  enemiesWithin,
  ENGAGEMENT_RANGE_PREFILTER,
  unitEdgeDistance,
} from '../interaction';

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
      {game.phase === 'charge' && <ChargeActions game={game} seat={seat} />}
      {game.phase === 'fight' && <FightActions game={game} seat={seat} />}
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

  // 1) Attacker/defender roll-off. Before it, units can still be put in
  //    Reserves and Leaders attached (PreGamePrep).
  if (setup.attacker === null) {
    const rollOff = setup.rollOff;
    if (!rollOff || rollOff.purpose !== 'attackerChoice') {
      return (
        <div className="stack">
          <PreGamePrep game={game} seat={seat} />
          <button onClick={() => dispatch({ type: 'performRollOff', player: seat })}>
            Roll Off
          </button>
        </div>
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

  // 5) Scout moves, then Begin Battle — only the first player advances.
  return (
    <div className="stack">
      <ScoutMoves game={game} seat={seat} />
      <button
        disabled={game.activePlayer !== seat}
        onClick={() => dispatch({ type: 'advanceStep', player: seat })}
      >
        Begin Battle
      </button>
    </div>
  );
}

/**
 * Pre-roll-off unit prep: Reserves declaration and Leader attachment.
 * The server rejects illegal choices (Deep Strike without the ability,
 * over-cap Strategic Reserves…) — rejections surface as a toast.
 */
function PreGamePrep({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const dispatch = useGameStore((s) => s.dispatch);
  const datasheets = useGameStore((s) => s.datasheets);
  const mine = Object.values(game.units).filter(
    (u) => u.owner === seat && aliveModels(u).length > 0,
  );
  if (mine.length === 0) return null;

  const isCharacter = (u: UnitState): boolean =>
    (datasheets[u.datasheetId]?.keywords ?? []).some((k) => k.toLowerCase() === 'character');
  const bodyguardOptions = (leader: UnitState): UnitState[] =>
    mine.filter((u) => u.id !== leader.id && !isCharacter(u) && !datasheets[u.datasheetId]?.leader);

  return (
    <div className="stack pregame-prep">
      <p className="muted">Reserves &amp; Leaders (before the roll-off):</p>
      {mine.map((u) => {
        const ds = datasheets[u.datasheetId];
        return (
          <div key={u.id} className="prep-row">
            <span className="prep-name">{u.name}</span>
            <select
              aria-label={`Reserves for ${u.name}`}
              value={u.reserves === 'embarked' ? 'none' : u.reserves}
              onChange={(e) =>
                dispatch({
                  type: 'setReserves',
                  player: seat,
                  unitId: u.id,
                  kind: e.target.value as 'none' | 'strategic' | 'deepStrike',
                })
              }
            >
              <option value="none">Deploy normally</option>
              <option value="strategic">Strategic Reserves</option>
              <option value="deepStrike">Deep Strike</option>
            </select>
            {ds?.leader && (
              <select
                aria-label={`Attach ${u.name}`}
                value={u.attachedTo ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === '' && u.attachedTo === null) return;
                  dispatch({
                    type: 'attachLeader',
                    player: seat,
                    leaderUnitId: u.id,
                    bodyguardUnitId: value === '' ? null : value,
                  });
                }}
              >
                <option value="">Unattached</option>
                {bodyguardOptions(u).map((b) => (
                  <option key={b.id} value={b.id}>
                    Attach to {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Post-first-turn-roll, pre-battle Scout moves for units with core.scout. */
function ScoutMoves({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const datasheets = useGameStore((s) => s.datasheets);
  const setInteraction = useGameStore((s) => s.setInteraction);
  const selectUnit = useGameStore((s) => s.selectUnit);
  const interaction = useGameStore((s) => s.interaction);

  const scouts = Object.values(game.units).filter((u) => {
    if (u.owner !== seat) return false;
    if (!aliveModels(u).some((m) => m.position !== null)) return false;
    return (datasheets[u.datasheetId]?.coreAbilities ?? []).some((a) => a.id === 'core.scout');
  });
  if (scouts.length === 0) return null;

  return (
    <div className="stack">
      {scouts.map((u) => {
        const ref = datasheets[u.datasheetId]!.coreAbilities.find((a) => a.id === 'core.scout');
        const budget = ref?.value ?? 6;
        return (
          <button
            key={u.id}
            className={
              interaction.mode === 'scouting' && interaction.unitId === u.id ? 'active' : ''
            }
            onClick={() => {
              selectUnit(u.id);
              setInteraction({ mode: 'scouting', unitId: u.id, budget });
            }}
          >
            Scout move: {u.name} ({budget}")
          </button>
        );
      })}
      {interaction.mode === 'scouting' && (
        <p className="muted">Click the board to make the Scout move (end 9"+ from enemies).</p>
      )}
    </div>
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

  if (game.step === 'reinforcements') {
    return <ReinforcementActions game={game} seat={seat} />;
  }

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

/** Movement — Reinforcements step: bring on units held in Reserves. */
function ReinforcementActions({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const setInteraction = useGameStore((s) => s.setInteraction);
  const selectUnit = useGameStore((s) => s.selectUnit);
  const interaction = useGameStore((s) => s.interaction);
  const myTurn = game.activePlayer === seat;

  const reserves = Object.values(game.units).filter(
    (u) =>
      u.owner === seat &&
      (u.reserves === 'strategic' || u.reserves === 'deepStrike') &&
      aliveModels(u).length > 0 &&
      u.models.every((m) => m.position === null),
  );
  if (reserves.length === 0) {
    return <p className="muted">No units in Reserves.</p>;
  }
  return (
    <div className="stack">
      <p>{myTurn ? 'Bring on Reserves:' : 'Opponent may bring on Reserves…'}</p>
      {reserves.map((u) => (
        <button
          key={u.id}
          disabled={!myTurn}
          className={
            interaction.mode === 'placingReserves' && interaction.unitId === u.id ? 'active' : ''
          }
          onClick={() => {
            selectUnit(u.id);
            setInteraction({ mode: 'placingReserves', unitId: u.id });
          }}
        >
          Deploy {u.name} ({u.reserves === 'deepStrike' ? 'Deep Strike' : 'Strategic Reserves'})
        </button>
      ))}
      {interaction.mode === 'placingReserves' && (
        <p className="muted">Click the board to place the unit (more than 9" from enemies).</p>
      )}
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
// Charge
// ---------------------------------------------------------------------------

function ChargeActions({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const dispatch = useGameStore((s) => s.dispatch);
  const selectUnit = useGameStore((s) => s.selectUnit);
  const selectedUnitId = useGameStore((s) => s.selectedUnitId);
  const interaction = useGameStore((s) => s.interaction);
  const datasheets = useGameStore((s) => s.datasheets);
  const myTurn = game.activePlayer === seat;

  // A charge is rolled and awaiting its move (or the concession).
  const seq = game.charge;
  if (seq) {
    const unit = game.units[seq.unitId];
    if (!unit || unit.owner !== seat) {
      return <p className="muted">Opponent is resolving a charge…</p>;
    }
    const staged =
      interaction.mode === 'charging' && interaction.unitId === unit.id
        ? interaction.staged
        : null;
    return (
      <div className="stack">
        <p>
          <strong>{unit.name}</strong> rolled{' '}
          <strong>
            {seq.rolls[0]}+{seq.rolls[1]} = {seq.roll}"
          </strong>{' '}
          to charge. Click the board to position the move, then commit.
        </p>
        <button
          disabled={!myTurn || staged === null}
          onClick={() =>
            dispatch({ type: 'commitCharge', player: seat, unitId: unit.id, positions: staged! })
          }
        >
          Commit Charge
        </button>
        <button
          disabled={!myTurn}
          onClick={() => dispatch({ type: 'failCharge', player: seat, unitId: unit.id })}
        >
          Charge Fails
        </button>
      </div>
    );
  }

  const eligible = Object.values(game.units).filter(
    (u) =>
      u.owner === seat &&
      canDeclareCharge(u) &&
      enemiesWithin(game, u, datasheets, ENGAGEMENT_RANGE_PREFILTER).length === 0 &&
      enemiesWithin(game, u, datasheets, CHARGE_RANGE_PREFILTER).length > 0,
  );

  const unit = selectedUnitId ? game.units[selectedUnitId] : undefined;
  if (unit && unit.owner === seat && eligible.some((u) => u.id === unit.id)) {
    return <ChargeControls key={unit.id} game={game} seat={seat} unit={unit} />;
  }
  if (eligible.length === 0) {
    return <p className="muted">No units are eligible to charge.</p>;
  }
  return (
    <div className="stack">
      <p>Declare a charge:</p>
      {eligible.map((u) => (
        <button key={u.id} disabled={!myTurn} onClick={() => selectUnit(u.id)}>
          Charge with {u.name}
        </button>
      ))}
    </div>
  );
}

function ChargeControls({
  game,
  seat,
  unit,
}: {
  game: GameState;
  seat: PlayerIndex;
  unit: UnitState;
}) {
  const dispatch = useGameStore((s) => s.dispatch);
  const datasheets = useGameStore((s) => s.datasheets);
  const [targets, setTargets] = useState<Record<string, boolean>>({});
  const myTurn = game.activePlayer === seat;

  const candidates = enemiesWithin(game, unit, datasheets, CHARGE_RANGE_PREFILTER);
  const targetIds = candidates.filter((u) => targets[u.id]).map((u) => u.id);

  return (
    <div className="stack">
      <p>
        <strong>{unit.name}</strong> — select charge targets (within 12"):
      </p>
      {candidates.map((u) => {
        const d = unitEdgeDistance(unit, u, datasheets);
        return (
          <label key={u.id} className="charge-target">
            <input
              type="checkbox"
              aria-label={`Charge target ${u.name}`}
              checked={targets[u.id] ?? false}
              onChange={(e) => setTargets((prev) => ({ ...prev, [u.id]: e.target.checked }))}
            />
            {u.name}
            {d !== null && <span className="muted"> (~{d.toFixed(1)}")</span>}
          </label>
        );
      })}
      <button
        disabled={!myTurn || targetIds.length === 0}
        onClick={() => dispatch({ type: 'declareCharge', player: seat, unitId: unit.id, targetIds })}
      >
        Declare Charge
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fight
// ---------------------------------------------------------------------------

function FightActions({ game, seat }: { game: GameState; seat: PlayerIndex }) {
  const dispatch = useGameStore((s) => s.dispatch);
  const datasheets = useGameStore((s) => s.datasheets);
  const fight = game.fight;
  const stepLabel = game.step === 'fightsFirst' ? 'Fights First' : 'Remaining Combats';

  if (!fight) {
    return <p className="muted">Fight phase — {stepLabel}.</p>;
  }

  // An activation is in progress.
  const active = fight.activeUnitId ? game.units[fight.activeUnitId] : undefined;
  if (active && fight.stage !== 'select') {
    if (active.owner !== seat) {
      return (
        <p className="muted">
          {game.players[active.owner].name}'s {active.name} is fighting…
        </p>
      );
    }
    if (fight.stage === 'pileIn' || fight.stage === 'consolidate') {
      return (
        <EngagementMove key={`${active.id}-${fight.stage}`} seat={seat} unit={active} stage={fight.stage} />
      );
    }
    return <MeleeControls key={active.id} game={game} seat={seat} unit={active} />;
  }

  // Selection stage.
  if (fight.selector === null) {
    return <p className="muted">{stepLabel} — no combats remain. End the step.</p>;
  }
  if (fight.selector !== seat) {
    return (
      <p className="muted">
        {stepLabel} — {game.players[fight.selector].name} is selecting a unit to fight…
      </p>
    );
  }
  const eligible = Object.values(game.units).filter(
    (u) => u.owner === seat && canFightThisStep(game, u, datasheets),
  );
  if (eligible.length === 0) {
    return <p className="muted">{stepLabel} — none of your units can fight.</p>;
  }
  return (
    <div className="stack">
      <p>{stepLabel} — your selection:</p>
      {eligible.map((u) => (
        <button
          key={u.id}
          onClick={() => dispatch({ type: 'selectFighter', player: seat, unitId: u.id })}
        >
          Fight with {u.name}
        </button>
      ))}
    </div>
  );
}

/** Pile In / Consolidate: 3" board-staged move with an explicit confirm. */
function EngagementMove({
  seat,
  unit,
  stage,
}: {
  seat: PlayerIndex;
  unit: UnitState;
  stage: 'pileIn' | 'consolidate';
}) {
  const dispatch = useGameStore((s) => s.dispatch);
  const interaction = useGameStore((s) => s.interaction);
  const label = stage === 'pileIn' ? 'Pile In' : 'Consolidate';
  const staged =
    interaction.mode === 'engagement' &&
    interaction.unitId === unit.id &&
    interaction.stage === stage
      ? interaction.staged
      : null;
  const commit = (positions: { modelId: string; x: number; y: number }[]) =>
    dispatch({ type: stage, player: seat, unitId: unit.id, positions });
  return (
    <div className="stack">
      <p>
        <strong>{unit.name}</strong> — {label}: up to 3", each moving model must end closer to
        the nearest enemy. Click the board to position, or stay put.
      </p>
      <button onClick={() => commit(staged ?? currentPositions(unit))}>Confirm {label}</button>
      <button onClick={() => commit(currentPositions(unit))}>Stay Put</button>
    </div>
  );
}

/** Melee attack assignment for the active fighter. */
function MeleeControls({
  game,
  seat,
  unit,
}: {
  game: GameState;
  seat: PlayerIndex;
  unit: UnitState;
}) {
  const dispatch = useGameStore((s) => s.dispatch);
  const datasheets = useGameStore((s) => s.datasheets);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const carried = new Set(aliveModels(unit).flatMap((m) => unit.loadout[m.id] ?? []));
  const weapons = Object.values(unit.weapons).filter(
    (w) => w.kind === 'melee' && carried.has(w.id),
  );
  const enemies = enemiesWithin(game, unit, datasheets, ENGAGEMENT_RANGE_PREFILTER);
  const assignments = weapons
    .filter((w) => targets[w.id])
    .map((w) => ({ weaponId: w.id, targetUnitId: targets[w.id]! }));
  const busy = game.shooting !== null;

  return (
    <div className="stack">
      <p>
        <strong>{unit.name}</strong> — assign melee attacks:
      </p>
      {weapons.length === 0 && <p className="muted">{unit.name} has no melee weapons.</p>}
      {weapons.map((w) => (
        <label key={w.id} className="weapon-row">
          <span>{w.name}</span>
          <select
            aria-label={`Melee target for ${w.name}`}
            value={targets[w.id] ?? ''}
            onChange={(e) => setTargets((prev) => ({ ...prev, [w.id]: e.target.value }))}
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
        disabled={busy || assignments.length === 0}
        onClick={() =>
          dispatch({ type: 'declareMelee', player: seat, unitId: unit.id, assignments })
        }
      >
        Fight
      </button>
      <button
        disabled={busy}
        onClick={() =>
          dispatch({ type: 'declareMelee', player: seat, unitId: unit.id, assignments: [] })
        }
      >
        No Attacks
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
    game.shooting !== null ||
    game.charge !== null ||
    (game.windowQueue?.length ?? 0) > 0 ||
    (game.fight !== null &&
      (game.fight.stage !== 'select' || game.fight.selector !== null));
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
