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
import { rollD6 } from '../dice/index.js';
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
import { phaseStepKind } from './kinds.js';
import { enqueueWindows, processWindowQueue, type FollowUpResolvers } from './windows.js';
import { applyBattleShock } from './battleShock.js';
import {
  aliveModels,
  enemyOf,
  hasActivePermission,
  isInEngagementRange,
  unitDistance,
  unitVisible,
} from './validation.js';

/**
 * The shared attack sequence. Shooting declares targets, opens the
 * reactive "targets selected" window (Smokescreen / Go to Ground), then
 * resolves weapon by weapon with a defender save prompt per batch. Melee
 * activations from the Fight phase enter via beginMeleeSequence and end
 * by handing back to the fight sequencer (consolidate stage).
 */

// Local resolvers to avoid an import cycle with windowReducer.
function localResolvers(): FollowUpResolvers {
  return {
    resolveShooting: (s, e) => continueShooting(s, e),
    applyBattleShock: (s, e, unitId, roll) => applyBattleShock(s, e, unitId, roll),
    // Charge rolls never follow from shooting-owned windows.
    rollCharge: (s) => s,
  };
}

export function reduceShooting(
  state: GameState,
  action: GameAction,
  env: ReducerEnv,
): ActionResult | null {
  switch (action.type) {
    case 'declareShoot': {
      if (phaseStepKind(env, state).phase !== 'shooting') {
        return reject('Shooting actions are only legal in the Shooting phase.');
      }
      if (action.player !== state.activePlayer) {
        return reject('You can only shoot on your own turn.', 'OUT_OF_TURN');
      }
      if (state.shooting) return reject('Another unit is still resolving its shooting.');
      const unit = state.units[action.unitId];
      if (!unit || unit.owner !== action.player) return reject('Not your unit.');
      if (unit.turnFlags.hasShot) return reject(`${unit.name} has already shot this turn.`);
      if (
        unit.turnFlags.moveKind === 'fallBack' &&
        !hasActivePermission(state, env.content, unit.id, 'shootAfterFallBack')
      ) {
        return reject('A unit that Fell Back cannot shoot this turn.');
      }
      if (action.assignments.length === 0) return reject('Declare at least one target.');

      const inER = isInEngagementRange(state, env.content, unit.id);
      const advanced = unit.turnFlags.moveKind === 'advance';
      const er = env.content.edition.parameters.engagementRangeHorizontal;

      for (const a of action.assignments) {
        const weapon = unit.weapons[a.weaponId];
        if (!weapon) return reject(`Unknown weapon: ${a.weaponId}`);
        if (weapon.kind !== 'ranged') return reject(`${weapon.name} is not a ranged weapon.`);
        if (modelsWithWeapon(unit, a.weaponId).length === 0) {
          return reject(`No models in ${unit.name} carry ${weapon.name}.`);
        }
        const flags = weaponFlags(env, weapon.abilities);
        if (
          advanced &&
          !weapon.abilities.some((x) => x.id === 'assault') &&
          !hasActivePermission(state, env.content, unit.id, 'shootAfterAdvance')
        ) {
          return reject(`${unit.name} Advanced — only Assault weapons may shoot.`);
        }
        if (flags.includes('oneShot') && unit.oneShotFired.includes(weapon.id)) {
          return reject(`${weapon.name} has already been fired this battle (One Shot).`);
        }
        const target = state.units[a.targetUnitId];
        if (!target || target.owner === unit.owner) return reject('Invalid target.');
        if (aliveModels(target).length === 0) return reject(`${target.name} is already destroyed.`);
        if (target.attachedTo !== null) {
          return reject(`${target.name} is attached to a bodyguard unit — target the unit instead.`);
        }
        const dist = unitDistance(env.content, unit, target);
        if (inER) {
          // Pistols only, at a unit within Engagement Range.
          if (!flags.includes('pistol')) {
            return reject(
              'Units in Engagement Range can only fire Pistols (Big Guns Never Tire: later).',
            );
          }
          if (dist === null || dist > er) {
            return reject('Pistols fired from combat must target a unit within Engagement Range.');
          }
        } else {
          if (isInEngagementRange(state, env.content, target.id)) {
            return reject(
              `${target.name} is within Engagement Range of your units and cannot be targeted.`,
            );
          }
        }
        if (dist === null || (weapon.range !== null && dist > weapon.range)) {
          return reject(`${target.name} is out of range of ${weapon.name}.`);
        }
        if (!unitVisible(state, env.content, unit, target)) {
          return reject(`${target.name} is not visible to ${unit.name}.`);
        }
      }

      let next: GameState = {
        ...state,
        shooting: {
          attackerUnitId: unit.id,
          remaining: [...action.assignments],
          current: null,
          usedWeaponIds: [],
        },
      };
      next = appendLog(next, {
        kind: 'shoot',
        player: action.player,
        message: `${unit.name} opens fire (${action.assignments.length} weapon assignment(s)).`,
      });
      // Reactive window BEFORE any dice: Smokescreen / Go to Ground apply
      // to the incoming attack. Candidates: the units being targeted.
      const targetIds = [...new Set(action.assignments.map((a) => a.targetUnitId))];
      next = enqueueWindows(next, [
        {
          hook: 'shooting.targetsSelected',
          player: enemyOf(action.player),
          followUp: { type: 'resolveShooting' },
          context: { attackerUnitId: unit.id, candidateUnitIds: targetIds },
        },
      ]);
      next = processWindowQueue(next, env, localResolvers());
      return { ok: true, state: next };
    }

    case 'resolveSaves': {
      const decision = state.pendingDecision;
      if (!decision || decision.kind !== 'saves') {
        return reject('There are no saves to resolve.');
      }
      if (action.player !== decision.player) {
        return reject('Only the defending player rolls these saves.', 'OUT_OF_TURN');
      }
      return { ok: true, state: resolveSaves(state, env) };
    }

    default:
      return null;
  }
}

/** Entry point for fight-phase melee attacks (validated by fightReducer). */
export function beginMeleeSequence(
  state: GameState,
  env: ReducerEnv,
  unitId: string,
  assignments: ShootingAssignment[],
): ActionResult {
  const unit = state.units[unitId]!;
  let next: GameState = {
    ...state,
    shooting: {
      attackerUnitId: unitId,
      melee: true,
      remaining: [...assignments],
      current: null,
      usedWeaponIds: [],
    },
  };
  next = appendLog(next, {
    kind: 'fight',
    player: unit.owner,
    message: `${unit.name} makes its melee attacks.`,
  });
  // Same reactive pre-resolution window as shooting (Stimm Injectors,
  // Trench Fighters...). Shooting-only stratagems are phase-gated out.
  const targetIds = [...new Set(assignments.map((a) => a.targetUnitId))];
  next = enqueueWindows(next, [
    {
      hook: 'shooting.targetsSelected',
      player: enemyOf(unit.owner),
      followUp: { type: 'resolveShooting' },
      context: { attackerUnitId: unitId, candidateUnitIds: targetIds },
    },
  ]);
  next = processWindowQueue(next, env, localResolvers());
  return { ok: true, state: next };
}

// ---------------------------------------------------------------------------
// Batch resolution
// ---------------------------------------------------------------------------

/** Resolve batches until a save decision opens or the sequence finishes. */
export function continueShooting(state: GameState, env: ReducerEnv): GameState {
  const seq = state.shooting;
  if (!seq) return state;
  const attacker = state.units[seq.attackerUnitId]!;

  const [assignment, ...rest] = seq.remaining;
  if (!assignment) {
    return finishSequence(state, env);
  }

  const target = state.units[assignment.targetUnitId];
  if (!target || aliveModels(target).length === 0) {
    let next: GameState = { ...state, shooting: { ...seq, remaining: rest, current: null } };
    next = appendLog(next, {
      kind: 'attack',
      player: attacker.owner,
      message: `Target already destroyed — remaining attacks are wasted.`,
    });
    return continueShooting(next, env);
  }

  const weapon = attacker.weapons[assignment.weaponId]!;
  const params = env.content.edition.parameters;
  const targetProfile = firstAliveProfile(env, target);
  const firing = modelsWithWeapon(attacker, assignment.weaponId);

  const comp = newAttackComputation({
    attacksExpr: String(weapon.attacks),
    hitSkill: seq.onlySixesHit ? 7 : weapon.skill,
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
    'attack.allocate',
    'attack.beforeSaveRoll',
    'attack.damage',
    'attack.feelNoPain',
  ] as const) {
    fireAttackHook(hook, candidates, ctx, comp);
  }
  if (seq.onlySixesHit) {
    comp.autoHit = false;
    comp.hitSkill = 7;
  }

  let rng = state.rng;
  const attacks = computeAttacks(comp, firing.length, aliveModels(target).length, rng);
  rng = attacks.rng;
  const hits = rollHits(comp, attacks.total, params, rng);
  rng = hits.rng;
  const wounds = rollWounds(comp, hits.hits, hits.autoWounds, params, rng);
  rng = wounds.rng;

  let next: GameState = {
    ...state,
    rng,
    shooting: {
      ...seq,
      usedWeaponIds: [...(seq.usedWeaponIds ?? []), weapon.id],
    },
  };
  next = markOneShot(next, env, attacker.id, weapon.id);
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
    next = { ...next, shooting: { ...next.shooting!, remaining: rest, current: null } };
    next = appendLog(next, {
      kind: 'attack',
      player: attacker.owner,
      message: 'No wounds inflicted.',
    });
    return continueShooting(next, env);
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
      ...next.shooting!,
      remaining: rest,
      current: {
        weaponId: weapon.id,
        weaponName: weapon.name,
        targetUnitId: target.id,
        woundsPending: wounds.wounds,
        mortalWounds: wounds.devastatingWounds,
        save,
        precision: comp.precision || undefined,
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
  return next;
}

function resolveSaves(state: GameState, env: ReducerEnv): GameState {
  const seq = state.shooting;
  const current = seq?.current;
  if (!seq || !current) return state;
  const params = env.content.edition.parameters;
  const target = state.units[current.targetUnitId]!;
  const save = current.save;

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
  // Precision against an attached unit may bleed into the leader's models.
  const leaderUnit =
    current.precision && target.leaderOf ? state.units[target.leaderOf] : undefined;
  let targetModels = target.models.map((m) => ({ ...m }));
  let leaderModels = leaderUnit ? leaderUnit.models.map((m) => ({ ...m })) : null;
  const ds = env.content.getDatasheet(target.datasheetId);
  const leaderDs = leaderUnit ? env.content.getDatasheet(leaderUnit.datasheetId) : undefined;
  const lines: string[] = [];
  let destroyedCount = 0;

  const allocate = (): { model: (typeof targetModels)[0]; leader: boolean } | null => {
    // Precision: the attacker may put wounds on the visible leader.
    if (leaderModels) {
      const leaderAlive = leaderModels.find((m) => !m.destroyed);
      if (leaderAlive) return { model: leaderAlive, leader: true };
    }
    const wounded = targetModels.find((m) => !m.destroyed && m.hasTakenWoundsThisPhase);
    if (wounded) return { model: wounded, leader: false };
    const first = targetModels.find((m) => !m.destroyed);
    return first ? { model: first, leader: false } : null;
  };
  const profileOf = (m: { profileId: string }, leader: boolean) => {
    const sheet = leader ? leaderDs : ds;
    return sheet?.models.find((p) => p.id === m.profileId) ?? sheet?.models[0];
  };

  const applyDamage = (model: (typeof targetModels)[0], amount: number) => {
    model.hasTakenWoundsThisPhase = true;
    model.woundsRemaining -= amount;
    if (model.woundsRemaining <= 0) {
      model.woundsRemaining = 0;
      model.destroyed = true;
      model.position = null;
      destroyedCount++;
    }
  };

  for (let i = 0; i < current.woundsPending; i++) {
    const alloc = allocate();
    if (!alloc) break;
    const profile = profileOf(alloc.model, alloc.leader);
    const saveResult = rollSave(
      comp,
      profile?.save ?? 7,
      profile?.invulnerableSave ?? null,
      params,
      rng,
    );
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
    applyDamage(alloc.model, taken);
    lines.push(
      `save ${saveResult.die} vs ${saveResult.needed}+ — failed, ${taken} damage${alloc.leader ? ' (Precision: leader)' : ''}`,
    );
  }

  for (let i = 0; i < current.mortalWounds; i++) {
    const dmg = rollDamage(comp, rng);
    rng = dmg.rng;
    let remaining = dmg.amount;
    lines.push(`devastating: ${remaining} mortal wound(s)`);
    while (remaining > 0) {
      const alloc = allocate();
      if (!alloc) break;
      let point = 1;
      if (save.feelNoPain !== null) {
        const fnp = rollFeelNoPain(save.feelNoPain, 1, rng);
        rng = fnp.rng;
        point = fnp.taken;
      }
      remaining -= 1;
      if (point === 0) continue;
      applyDamage(alloc.model, 1);
    }
  }

  const unitDestroyed = targetModels.every((m) => m.destroyed);
  let next: GameState = {
    ...state,
    rng,
    units: {
      ...state.units,
      [target.id]: { ...target, models: targetModels },
      ...(leaderUnit && leaderModels
        ? { [leaderUnit.id]: { ...leaderUnit, models: leaderModels } }
        : {}),
    },
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
    next = detachOnDestruction(next, target.id);
  }
  return continueShooting(next, env);
}

function finishSequence(state: GameState, env: ReducerEnv): GameState {
  const seq = state.shooting!;
  const attacker = state.units[seq.attackerUnitId]!;

  // Hazardous: test per model that used a Hazardous weapon this sequence.
  let next: GameState = state;
  let rng = state.rng;
  const hazardousWeaponIds = (seq.usedWeaponIds ?? []).filter((id) => {
    const weapon = attacker.weapons[id];
    return weapon && weaponFlags(env, weapon.abilities).includes('hazardous');
  });
  if (hazardousWeaponIds.length > 0) {
    const models = attacker.models.map((m) => ({ ...m }));
    const bearers = models.filter(
      (m) => !m.destroyed && hazardousWeaponIds.some((w) => (attacker.loadout[m.id] ?? []).includes(w)),
    );
    const lines: string[] = [];
    const keywords = env.content.getUnitKeywords(state, attacker.id).map((k) => k.toLowerCase());
    const bigModel = ['character', 'monster', 'vehicle'].some((k) => keywords.includes(k));
    for (const model of bearers) {
      const draw = rollD6(rng, 1);
      rng = draw.rng;
      const die = draw.rolls[0] ?? 6;
      if (die === 1) {
        if (bigModel) {
          model.woundsRemaining = Math.max(0, model.woundsRemaining - 3);
          if (model.woundsRemaining === 0) {
            model.destroyed = true;
            model.position = null;
          }
          lines.push(`rolled 1 — 3 mortal wounds`);
        } else {
          model.destroyed = true;
          model.woundsRemaining = 0;
          model.position = null;
          lines.push(`rolled 1 — model destroyed`);
        }
      } else {
        lines.push(`rolled ${die} — safe`);
      }
    }
    if (bearers.length > 0) {
      next = {
        ...next,
        rng,
        units: { ...next.units, [attacker.id]: { ...attacker, models } },
      };
      next = appendLog(next, {
        kind: 'hazardous',
        player: attacker.owner,
        message: `${attacker.name} Hazardous tests: ${lines.join('; ')}.`,
      });
    }
  }

  const finalAttacker = next.units[seq.attackerUnitId]!;
  if (seq.melee) {
    next = {
      ...next,
      shooting: null,
      fight: next.fight ? { ...next.fight, stage: 'consolidate' } : next.fight,
    };
    next = appendLog(next, {
      kind: 'fight',
      player: finalAttacker.owner,
      message: `${finalAttacker.name} finishes its attacks — consolidate up to 3".`,
    });
    return next;
  }

  next = {
    ...next,
    shooting: null,
    units: seq.outOfPhase
      ? next.units
      : {
          ...next.units,
          [finalAttacker.id]: {
            ...finalAttacker,
            turnFlags: { ...finalAttacker.turnFlags, hasShot: true },
          },
        },
  };
  next = appendLog(next, {
    kind: 'shoot',
    player: finalAttacker.owner,
    message: `${finalAttacker.name} finishes shooting.`,
  });
  return next;
}

/** When an attached unit dies, its leader (or bodyguard) becomes its own unit. */
function detachOnDestruction(state: GameState, destroyedUnitId: string): GameState {
  const units = { ...state.units };
  let changed = false;
  for (const [id, unit] of Object.entries(units)) {
    if (unit.attachedTo === destroyedUnitId) {
      units[id] = { ...unit, attachedTo: null };
      changed = true;
    }
    if (unit.leaderOf === destroyedUnitId) {
      units[id] = { ...units[id]!, leaderOf: null };
      changed = true;
    }
  }
  return changed ? { ...state, units } : state;
}

// ---------------------------------------------------------------------------
// Candidate collection
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

  const contributors: [UnitState, string, string][] = [
    [attacker, 'attacker', attacker.id],
    [target, 'defender', target.id],
  ];
  // An attached leader's abilities serve the unit it leads, on both sides.
  if (target.leaderOf && state.units[target.leaderOf]) {
    contributors.push([state.units[target.leaderOf]!, 'defender-leader', target.id]);
  }
  if (attacker.leaderOf && state.units[attacker.leaderOf]) {
    contributors.push([state.units[attacker.leaderOf]!, 'attacker-leader', attacker.id]);
  }
  for (const [unit, role, bearerId] of contributors) {
    const ds = env.content.getDatasheet(unit.datasheetId);
    for (const ref of ds?.coreAbilities ?? []) {
      const { effects } = env.content.getCoreAbility(ref);
      for (const def of effects) {
        out.push({
          def,
          bearerUnitId: bearerId,
          player: unit.owner,
          declOrder: order(def.id.split('#')[0] ?? def.id),
          sourceId: `${role}-ability:${ref.id}`,
        });
      }
    }
    for (const def of ds?.abilities ?? []) {
      out.push({
        def,
        bearerUnitId: bearerId,
        player: unit.owner,
        declOrder: order(def.id),
        sourceId: `datasheet:${unit.datasheetId}`,
      });
    }
  }

  // Effects bound to a unit in this exchange — including effects bound to
  // an attached leader, which bear on the unit it leads.
  const sideOf = new Map<string, string>([
    [attacker.id, attacker.id],
    [target.id, target.id],
    ...(attacker.leaderOf ? ([[attacker.leaderOf, attacker.id]] as [string, string][]) : []),
    ...(target.leaderOf ? ([[target.leaderOf, target.id]] as [string, string][]) : []),
  ]);
  for (const active of state.activeEffects) {
    if (
      active.boundUnits.length > 0 &&
      !active.boundUnits.some((u) => sideOf.has(u))
    ) {
      continue;
    }
    // Global effects (army/detachment rules) bear on the SOURCE player's
    // unit in this exchange — so bearerIs/bearer-token conditions read
    // "my unit", never the opponent's.
    const boundMatch = active.boundUnits.find((u) => sideOf.has(u));
    const bearerUnitId =
      active.boundUnits.length > 0
        ? boundMatch
          ? sideOf.get(boundMatch)
          : undefined
        : attacker.owner === active.source.player
          ? attacker.id
          : target.owner === active.source.player
            ? target.id
            : undefined;
    out.push({
      def: active.def,
      bearerUnitId,
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

function weaponFlags(env: ReducerEnv, refs: UnitState['weapons'][string]['abilities']): string[] {
  return refs.flatMap((ref) => env.content.getWeaponAbility(ref).flags);
}

function markOneShot(
  state: GameState,
  env: ReducerEnv,
  unitId: string,
  weaponId: string,
): GameState {
  const unit = state.units[unitId]!;
  const weapon = unit.weapons[weaponId];
  if (!weapon || !weaponFlags(env, weapon.abilities).includes('oneShot')) return state;
  if (unit.oneShotFired.includes(weaponId)) return state;
  return {
    ...state,
    units: {
      ...state.units,
      [unitId]: { ...unit, oneShotFired: [...unit.oneShotFired, weaponId] },
    },
  };
}

function modelsWithWeapon(unit: UnitState, weaponId: string) {
  return aliveModels(unit).filter((m) => (unit.loadout[m.id] ?? []).includes(weaponId));
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
