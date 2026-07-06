import type { EffectCandidate, HookContext } from '../effects/context.js';
import {
  fireAttackHook,
  newAttackComputation,
  type AttackComputation,
} from '../effects/engine.js';
import {
  computeAttacks,
  rollDamage,
  rollFeelNoPain,
  rollHits,
  rollSave,
  rollWounds,
} from '../attack/pipeline.js';
import type { GameAction, ActionResult } from './actions.js';
import { reject } from './actions.js';
import type { ReducerEnv } from './env.js';
import type {
  GameState,
  SaveComputation,
  ShootingAssignment,
  UnitState,
} from '../types/state.js';
import { appendLog } from './reducer.js';
import { aliveModels, isInEngagementRange, unitDistance, unitVisible } from './validation.js';

/**
 * Shooting phase, milestone-2 scope: whole-unit weapon→target assignments,
 * hits and wounds rolled by the server through the effect interpreter,
 * then a reactive save prompt for the defender per weapon batch. Big Guns
 * Never Tire, Pistols, Hazardous, One Shot and per-model splits: milestone 3+.
 */
export function reduceShooting(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  switch (action.type) {
    case 'declareShoot': {
      if (state.phase !== 'shooting') {
        return reject('Shooting actions are only legal in the Shooting phase.');
      }
      if (action.player !== state.activePlayer) {
        return reject('You can only shoot on your own turn.', 'OUT_OF_TURN');
      }
      if (state.shooting) return reject('Another unit is still resolving its shooting.');
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (unit.turnFlags.hasShot) return reject(`${unit.name} has already shot this turn.`);
      if (unit.turnFlags.moveKind === 'fallBack') {
        return reject('A unit that Fell Back cannot shoot this turn.');
      }
      if (isInEngagementRange(state, env.content, unit.id)) {
        return reject('Units in Engagement Range cannot shoot (Pistols/Big Guns: later).');
      }
      if (action.assignments.length === 0) return reject('Declare at least one target.');

      const advanced = unit.turnFlags.moveKind === 'advance';
      for (const a of action.assignments) {
        const weapon = unit.weapons[a.weaponId];
        if (!weapon) return reject(`Unknown weapon: ${a.weaponId}`);
        if (weapon.kind !== 'ranged') return reject(`${weapon.name} is not a ranged weapon.`);
        if (modelsWithWeapon(unit, a.weaponId).length === 0) {
          return reject(`No models in ${unit.name} carry ${weapon.name}.`);
        }
        if (advanced && !weaponHasFlagOrAbility(env, unit, a.weaponId, 'assault')) {
          return reject(`${unit.name} Advanced — only Assault weapons may shoot.`);
        }
        const target = state.units[a.targetUnitId];
        if (!target || target.owner === unit.owner) return reject('Invalid target.');
        if (aliveModels(target).length === 0) return reject(`${target.name} is already destroyed.`);
        if (isInEngagementRange(state, env.content, target.id)) {
          return reject(
            `${target.name} is within Engagement Range of your units and cannot be targeted.`,
          );
        }
        const dist = unitDistance(env.content, unit, target);
        if (dist === null || (weapon.range !== null && dist > weapon.range)) {
          return reject(`${target.name} is out of range of ${weapon.name}.`);
        }
        if (!unitVisible(state, env.content, unit, target)) {
          return reject(`${target.name} is not visible to ${unit.name}.`);
        }
      }

      let next: GameState = {
        ...state,
        shooting: { attackerUnitId: unit.id, remaining: [...action.assignments], current: null },
      };
      next = appendLog(next, {
        kind: 'shoot',
        player: action.player,
        message: `${unit.name} opens fire (${action.assignments.length} weapon assignment(s)).`,
      });
      return resolveNextAssignment(next, env);
    }

    case 'resolveSaves': {
      const decision = state.pendingDecision;
      if (!decision || decision.kind !== 'saves') {
        return reject('There are no saves to resolve.');
      }
      if (action.player !== decision.player) {
        return reject('Only the defending player rolls these saves.', 'OUT_OF_TURN');
      }
      return resolveSaves(state, env);
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Assignment resolution: hits and wounds now, saves after the defender acts
// ---------------------------------------------------------------------------

function resolveNextAssignment(state: GameState, env: ReducerEnv): ActionResult {
  const seq = state.shooting;
  if (!seq) return { ok: true, state };
  const attacker = state.units[seq.attackerUnitId]!;

  const [assignment, ...rest] = seq.remaining;
  if (!assignment) {
    return finishShooting(state);
  }

  const target = state.units[assignment.targetUnitId];
  if (!target || aliveModels(target).length === 0) {
    // Target already destroyed by an earlier weapon: skip this batch.
    let next: GameState = { ...state, shooting: { ...seq, remaining: rest, current: null } };
    next = appendLog(next, {
      kind: 'shoot',
      player: attacker.owner,
      message: `Target already destroyed — remaining attacks are wasted.`,
    });
    return resolveNextAssignment(next, env);
  }

  const weapon = attacker.weapons[assignment.weaponId]!;
  const params = env.content.edition.parameters;
  const targetProfile = firstAliveProfile(env, target);
  const firing = modelsWithWeapon(attacker, assignment.weaponId);

  const comp = newAttackComputation({
    attacksExpr: String(weapon.attacks),
    hitSkill: weapon.skill,
    strength: weapon.strength,
    toughness: targetProfile.toughness,
    ap: weapon.ap,
    damageExpr: String(weapon.damage),
    params,
  });

  const candidates = collectCandidates(state, env, attacker, target, assignment.weaponId);
  const ctx: HookContext = {
    state,
    content: env.content,
    activePlayer: state.activePlayer,
    phase: state.phase,
    attackerUnitId: attacker.id,
    targetUnitId: target.id,
    weapon,
    distance: unitDistance(env.content, attacker, target) ?? undefined,
    targetVisible: true,
  };

  for (const hook of [
    'attack.attacksCount',
    'attack.beforeHitRoll',
    'attack.beforeWoundRoll',
    'attack.beforeSaveRoll',
    'attack.damage',
    'attack.feelNoPain',
  ] as const) {
    fireAttackHook(hook, candidates, ctx, comp);
  }

  let rng = state.rng;
  const attacks = computeAttacks(comp, firing.length, aliveModels(target).length, rng);
  rng = attacks.rng;
  const hits = rollHits(comp, attacks.total, params, rng);
  rng = hits.rng;
  const wounds = rollWounds(comp, hits.hits, hits.autoWounds, params, rng);
  rng = wounds.rng;

  let next: GameState = { ...state, rng };
  next = appendLog(next, {
    kind: 'attack',
    player: attacker.owner,
    message:
      `${weapon.name} → ${target.name}: ${attacks.total} attack(s)` +
      (hits.autoHit ? ' (auto-hit)' : `, ${describeDice(hits.dice)} → ${hits.hits + hits.autoWounds} hit(s)`) +
      (hits.sustainedExtra ? ` incl. ${hits.sustainedExtra} sustained` : '') +
      `, ${describeDice(wounds.dice)} → ${wounds.wounds} wound(s)` +
      (wounds.devastatingWounds ? ` + ${wounds.devastatingWounds} devastating` : '') +
      ` (wounding on ${wounds.threshold}+)`,
    data: {
      weaponId: weapon.id,
      targetUnitId: target.id,
      attacks: attacks.total,
      hitRolls: hits.dice.map((d) => d.final),
      woundRolls: wounds.dice.map((d) => d.final),
      wounds: wounds.wounds,
      devastating: wounds.devastatingWounds,
    },
  });

  if (wounds.wounds === 0 && wounds.devastatingWounds === 0) {
    next = { ...next, shooting: { ...seq, remaining: rest, current: null } };
    next = appendLog(next, {
      kind: 'attack',
      player: attacker.owner,
      message: 'No wounds inflicted.',
    });
    return resolveNextAssignment(next, env);
  }

  const save: SaveComputation = {
    ap: comp.ap,
    damageExpr: comp.damageExpr,
    damageBonus: comp.damageBonus,
    minimumDamage: comp.minimumDamage,
    cover: comp.cover,
    ignoresCover: comp.ignoresCover,
    invulnerableSave: comp.invulnerableSave,
    saveModifiers: comp.saveModifiers,
    feelNoPain: comp.feelNoPain,
  };
  next = {
    ...next,
    shooting: {
      attackerUnitId: attacker.id,
      remaining: rest,
      current: {
        weaponId: weapon.id,
        weaponName: weapon.name,
        targetUnitId: target.id,
        woundsPending: wounds.wounds,
        mortalWounds: wounds.devastatingWounds,
        save,
      },
    },
    pendingDecision: {
      id: `saves-${next.actionSeq}-${target.id}`,
      player: target.owner,
      kind: 'saves',
      options: [],
      context: {
        attackerUnitId: attacker.id,
        targetUnitId: target.id,
        weaponName: weapon.name,
        wounds: wounds.wounds,
        mortalWounds: wounds.devastatingWounds,
        ap: save.ap,
        damage: save.damageExpr,
      },
      canPass: false,
    },
  };
  return { ok: true, state: next };
}

function resolveSaves(state: GameState, env: ReducerEnv): ActionResult {
  const seq = state.shooting;
  const current = seq?.current;
  if (!seq || !current) return reject('No shooting sequence in progress.');
  const params = env.content.edition.parameters;
  const target = state.units[current.targetUnitId]!;
  const save = current.save;

  // Rebuild the save/damage half of the computation from the snapshot.
  const comp: AttackComputation = {
    ...newAttackComputation({
      attacksExpr: '1',
      hitSkill: null,
      strength: 1,
      toughness: 1,
      ap: save.ap,
      damageExpr: save.damageExpr,
      params,
    }),
    damageBonus: save.damageBonus,
    minimumDamage: save.minimumDamage,
    cover: save.cover,
    ignoresCover: save.ignoresCover,
    invulnerableSave: save.invulnerableSave,
    saveModifiers: save.saveModifiers,
  };

  let rng = state.rng;
  let models = target.models.map((m) => ({ ...m }));
  const ds = env.content.getDatasheet(target.datasheetId);
  const lines: string[] = [];
  let destroyedCount = 0;

  const allocate = () => {
    const wounded = models.find((m) => !m.destroyed && m.hasTakenWoundsThisPhase);
    return wounded ?? models.find((m) => !m.destroyed) ?? null;
  };
  const profileOf = (profileId: string) =>
    ds?.models.find((p) => p.id === profileId) ?? ds?.models[0];

  // Normal wounds: save, then damage, then Feel No Pain.
  for (let i = 0; i < current.woundsPending; i++) {
    const model = allocate();
    if (!model) break;
    const profile = profileOf(model.profileId);
    const saveResult = rollSave(comp, profile?.save ?? 7, profile?.invulnerableSave ?? null, params, rng);
    rng = saveResult.rng;
    if (saveResult.saved) {
      lines.push(
        `save ${saveResult.die} vs ${saveResult.needed}+${saveResult.usedInvulnerable ? ' (invuln)' : ''} — saved`,
      );
      continue;
    }
    const dmg = rollDamage(comp, rng);
    rng = dmg.rng;
    let taken = dmg.amount;
    if (save.feelNoPain !== null) {
      const fnp = rollFeelNoPain(save.feelNoPain, taken, rng);
      rng = fnp.rng;
      taken = fnp.taken;
      if (fnp.prevented > 0) lines.push(`feel no pain prevents ${fnp.prevented}`);
    }
    model.hasTakenWoundsThisPhase = true;
    model.woundsRemaining -= taken;
    lines.push(
      `save ${saveResult.die} vs ${saveResult.needed}+ — failed, ${taken} damage`,
    );
    if (model.woundsRemaining <= 0) {
      model.woundsRemaining = 0;
      model.destroyed = true;
      model.position = null;
      destroyedCount++;
    }
  }

  // Devastating Wounds: mortal wounds equal to the damage roll, no saves.
  for (let i = 0; i < current.mortalWounds; i++) {
    const dmg = rollDamage(comp, rng);
    rng = dmg.rng;
    let remaining = dmg.amount;
    lines.push(`devastating: ${remaining} mortal wound(s)`);
    while (remaining > 0) {
      const model = allocate();
      if (!model) break;
      let point = 1;
      if (save.feelNoPain !== null) {
        const fnp = rollFeelNoPain(save.feelNoPain, 1, rng);
        rng = fnp.rng;
        point = fnp.taken;
      }
      remaining -= 1;
      if (point === 0) continue;
      model.hasTakenWoundsThisPhase = true;
      model.woundsRemaining -= 1;
      if (model.woundsRemaining <= 0) {
        model.woundsRemaining = 0;
        model.destroyed = true;
        model.position = null;
        destroyedCount++;
      }
    }
  }

  const unitDestroyed = models.every((m) => m.destroyed);
  let next: GameState = {
    ...state,
    rng,
    units: { ...state.units, [target.id]: { ...target, models } },
    pendingDecision: null,
    shooting: { ...seq, current: null },
  };
  next = appendLog(next, {
    kind: 'saves',
    player: target.owner,
    message:
      `${target.name} resolves saves vs ${current.weaponName}: ${lines.join('; ')}` +
      (destroyedCount ? ` — ${destroyedCount} model(s) destroyed` : ''),
    data: { targetUnitId: target.id, destroyed: destroyedCount },
  });
  if (unitDestroyed) {
    next = appendLog(next, {
      kind: 'destroyed',
      player: target.owner,
      message: `${target.name} is destroyed!`,
    });
  }
  return resolveNextAssignment(next, env);
}

function finishShooting(state: GameState): ActionResult {
  const seq = state.shooting!;
  const attacker = state.units[seq.attackerUnitId]!;
  let next: GameState = {
    ...state,
    shooting: null,
    units: {
      ...state.units,
      [attacker.id]: { ...attacker, turnFlags: { ...attacker.turnFlags, hasShot: true } },
    },
  };
  next = appendLog(next, {
    kind: 'shoot',
    player: attacker.owner,
    message: `${attacker.name} finishes shooting.`,
  });
  return { ok: true, state: next };
}

// ---------------------------------------------------------------------------
// Candidate collection: weapon abilities + both units' core abilities +
// board-level active effects
// ---------------------------------------------------------------------------

function collectCandidates(
  state: GameState,
  env: ReducerEnv,
  attacker: UnitState,
  target: UnitState,
  weaponId: string,
): EffectCandidate[] {
  const out: EffectCandidate[] = [];
  const order = (id: string) => env.content.effectOrder[id] ?? 100000;

  const weapon = attacker.weapons[weaponId]!;
  for (const ref of weapon.abilities) {
    const { effects } = env.content.getWeaponAbility(ref);
    for (const def of effects) {
      out.push({
        def,
        bearerUnitId: attacker.id,
        player: attacker.owner,
        declOrder: order(def.id.split('#')[0] ?? def.id),
        sourceId: `weapon:${weapon.id}`,
      });
    }
  }

  for (const [unit, role] of [
    [attacker, 'attacker'],
    [target, 'defender'],
  ] as const) {
    const ds = env.content.getDatasheet(unit.datasheetId);
    for (const ref of ds?.coreAbilities ?? []) {
      const { effects } = env.content.getCoreAbility(ref);
      for (const def of effects) {
        out.push({
          def,
          bearerUnitId: unit.id,
          player: unit.owner,
          declOrder: order(def.id.split('#')[0] ?? def.id),
          sourceId: `${role}-ability:${ref.id}`,
        });
      }
    }
    for (const def of ds?.abilities ?? []) {
      out.push({
        def,
        bearerUnitId: unit.id,
        player: unit.owner,
        declOrder: order(def.id),
        sourceId: `datasheet:${unit.datasheetId}`,
      });
    }
  }

  for (const active of state.activeEffects) {
    if (active.boundUnits.length > 0 && !active.boundUnits.some((u) => u === attacker.id || u === target.id)) {
      continue;
    }
    out.push({
      def: active.def,
      bearerUnitId: active.boundUnits.find((u) => u === attacker.id || u === target.id),
      player: active.source.player,
      declOrder: order(active.def.id),
      sourceId: `${active.source.kind}:${active.source.id}`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function modelsWithWeapon(unit: UnitState, weaponId: string) {
  return aliveModels(unit).filter((m) => (unit.loadout[m.id] ?? []).includes(weaponId));
}

function weaponHasFlagOrAbility(
  env: ReducerEnv,
  unit: UnitState,
  weaponId: string,
  abilityId: string,
): boolean {
  return (unit.weapons[weaponId]?.abilities ?? []).some((a) => a.id === abilityId);
}

function firstAliveProfile(env: ReducerEnv, unit: UnitState) {
  const ds = env.content.getDatasheet(unit.datasheetId);
  const model = aliveModels(unit)[0];
  const profile =
    (model && ds?.models.find((p) => p.id === model.profileId)) ?? ds?.models[0];
  return {
    toughness: profile?.toughness ?? 4,
    save: profile?.save ?? 7,
    invulnerableSave: profile?.invulnerableSave ?? null,
  };
}

function describeDice(dice: { final: number }[]): string {
  if (dice.length === 0) return '—';
  return `[${dice.map((d) => d.final).join(' ')}]`;
}

export type { ShootingAssignment };
