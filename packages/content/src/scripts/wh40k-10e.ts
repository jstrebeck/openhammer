import {
  appendLog,
  continueShooting,
  roll2D6,
  rollD6,
  unitDistance,
  unitVisible,
  aliveModels,
  type GameState,
  type ReducerEnv,
  type ScriptFn,
  type ShootingAssignment,
} from '@openhammer/core';

/**
 * Script registry for the wh40k-10e edition pack — the <10% of rules too
 * procedural for the effect schema. Every script is declared in
 * core-stratagems.json (trigger + timing) so the UI can surface it; the
 * functions here are pure GameState transitions.
 *
 * Not yet implemented (their stratagems are simply not offered):
 * core.heroic-intervention, core.rapid-ingress, core.grenade.
 */

/** Re-roll the roll identified by the window context (advance or charge). */
const commandReroll: ScriptFn = (state, env, args) => {
  const kind = args.context.kind as string | undefined;
  if (kind === 'advance' && state.pendingMove?.advanceRoll != null) {
    const pending = state.pendingMove;
    const draw = rollD6(state.rng, 1);
    const roll = draw.rolls[0] ?? 1;
    const oldRoll = pending.advanceRoll ?? 0;
    let next: GameState = {
      ...state,
      rng: draw.rng,
      pendingMove: {
        ...pending,
        advanceRoll: roll,
        budget: pending.budget - oldRoll + roll,
      },
    };
    next = appendLog(next, {
      kind: 'stratagem',
      player: args.player,
      message: `Command Re-roll: the Advance roll of ${oldRoll} becomes ${roll}.`,
    });
    return next;
  }
  if (kind === 'charge' && state.charge) {
    const seq = state.charge;
    const { total, rolls, rng } = roll2D6(state.rng);
    let next: GameState = {
      ...state,
      rng,
      charge: { ...seq, roll: total, rolls: [rolls[0] ?? 1, rolls[1] ?? 1] },
    };
    next = appendLog(next, {
      kind: 'stratagem',
      player: args.player,
      message: `Command Re-roll: the Charge roll of ${seq.roll} becomes ${total}.`,
    });
    return next;
  }
  return appendLog(state, {
    kind: 'stratagem',
    player: args.player,
    message: 'Command Re-roll had nothing to re-roll (window expired).',
  });
};

/**
 * Fire Overwatch: the chosen unit shoots the unit that just moved, out of
 * phase — only unmodified 6s hit. Rides the shared attack sequence, so the
 * mover still rolls their own saves interactively.
 */
const fireOverwatch: ScriptFn = (state, env, args) => {
  const shooterId = args.targetUnitId;
  const moverId = args.context.movedUnitId as string | undefined;
  if (!shooterId || !moverId) return state;
  const shooter = state.units[shooterId];
  const mover = state.units[moverId];
  if (!shooter || !mover || aliveModels(mover).length === 0) return state;

  const assignments: ShootingAssignment[] = [];
  for (const weapon of Object.values(shooter.weapons)) {
    if (weapon.kind !== 'ranged') continue;
    const carried = aliveModels(shooter).some((m) =>
      (shooter.loadout[m.id] ?? []).includes(weapon.id),
    );
    if (!carried) continue;
    if (shooter.oneShotFired.includes(weapon.id)) continue;
    const dist = unitDistance(env.content, shooter, mover);
    if (dist === null || (weapon.range !== null && dist > weapon.range)) continue;
    assignments.push({ weaponId: weapon.id, targetUnitId: moverId });
  }
  if (assignments.length === 0 || !unitVisible(state, env.content, shooter, mover)) {
    return appendLog(state, {
      kind: 'stratagem',
      player: args.player,
      message: `${shooter.name} has no weapons that can Overwatch ${mover.name}.`,
    });
  }
  let next: GameState = {
    ...state,
    shooting: {
      attackerUnitId: shooterId,
      onlySixesHit: true,
      outOfPhase: true,
      remaining: assignments,
      current: null,
      usedWeaponIds: [],
    },
  };
  next = appendLog(next, {
    kind: 'stratagem',
    player: args.player,
    message: `${shooter.name} fires Overwatch at ${mover.name} — only unmodified 6s hit.`,
  });
  return continueShooting(next, env);
};

/**
 * Tank Shock: after the Vehicle's charge, pick the rammed enemy; roll a
 * number of D6 equal to the chosen melee weapon's Strength (+2 dice if S
 * beats their Toughness); every 5+ is a mortal wound, max 6.
 */
const tankShock: ScriptFn = (state, env, args) => {
  const vehicleId = args.context.chargedUnitId as string | undefined;
  const targetId = args.targetUnitId;
  if (!vehicleId || !targetId) return state;
  const vehicle = state.units[vehicleId];
  const target = state.units[targetId];
  if (!vehicle || !target) return state;

  const melee = Object.values(vehicle.weapons).filter((w) => w.kind === 'melee');
  const strength = Math.max(1, ...melee.map((w) => w.strength));
  const targetDs = env.content.getDatasheet(target.datasheetId);
  const toughness = targetDs?.models[0]?.toughness ?? 4;
  const diceCount = strength + (strength > toughness ? 2 : 0);
  const { rolls, rng } = rollD6(state.rng, diceCount);
  const mortals = Math.min(6, rolls.filter((r) => r >= 5).length);

  let next: GameState = { ...state, rng };
  if (mortals > 0) {
    const models = target.models.map((m) => ({ ...m }));
    let remaining = mortals;
    for (const m of models) {
      while (remaining > 0 && !m.destroyed) {
        m.woundsRemaining -= 1;
        remaining -= 1;
        if (m.woundsRemaining <= 0) {
          m.woundsRemaining = 0;
          m.destroyed = true;
          m.position = null;
        }
      }
      if (remaining === 0) break;
    }
    next = { ...next, units: { ...next.units, [targetId]: { ...target, models } } };
  }
  next = appendLog(next, {
    kind: 'stratagem',
    player: args.player,
    message: `Tank Shock: ${vehicle.name} rams ${target.name} — ${diceCount}D6 [${rolls.join(' ')}] → ${mortals} mortal wound(s).`,
    data: { rolls, mortals, targetUnitId: targetId },
  });
  return next;
};

/**
 * Counter-Offensive: the paying player's chosen unit fights next,
 * overriding the alternation.
 */
const counterOffensive: ScriptFn = (state, env, args) => {
  const unitId = args.targetUnitId;
  if (!unitId || !state.fight) return state;
  const unit = state.units[unitId];
  if (!unit) return state;
  let next: GameState = {
    ...state,
    fight: {
      ...state.fight,
      selector: args.player,
      activeUnitId: unitId,
      stage: 'pileIn',
    },
  };
  next = appendLog(next, {
    kind: 'stratagem',
    player: args.player,
    message: `Counter-Offensive: ${unit.name} fights next.`,
  });
  return next;
};

export const WH40K_10E_SCRIPTS: Record<string, ScriptFn> = {
  'core.command-reroll': commandReroll,
  'core.fire-overwatch': fireOverwatch,
  'core.tank-shock': tankShock,
  'core.counter-offensive': counterOffensive,
};
