import type { FactionDefinition, FactionStateHandlers } from '../types/index';

export interface TauEmpireState {
  guidedTargets: Record<string, string>;
}

export const tauEmpireStateHandlers: FactionStateHandlers<TauEmpireState> = {
  createInitial: () => ({ guidedTargets: {} }),
  onPhaseChange: (current, ctx) => {
    if (ctx.newPhaseId === 'shooting') {
      const { [ctx.activePlayerId]: _, ...rest } = current.guidedTargets;
      return { guidedTargets: rest };
    }
    return current;
  },
  // IMPORTANT: current reducer's NEXT_TURN does NOT clear guidedTargets — preserve behavior
  onTurnChange: (current) => current,
};

export const tauEmpire: FactionDefinition = {
  id: 'tau-empire',
  name: "T'au Empire",
  factionKeyword: "T'AU EMPIRE",
  catalogueNames: ["T'au Empire", 'Tau Empire', "T'au"],
  factionRuleName: 'For the Greater Good',
  factionRuleDescription:
    "Each time a T'AU EMPIRE unit from your army is selected to shoot, after resolving those attacks you can designate that unit as a Guided unit. Until the start of your next Shooting phase, each time another friendly T'AU EMPIRE unit makes a ranged attack against the same target, improve the BS of that attack by 1.",

  detachments: [
    // --- Kauyon ---
    {
      id: 'kauyon',
      name: 'Kauyon',
      factionId: 'tau-empire',
      rules:
        "Patient Hunter: From Battle Round 3 onwards, each time a T'AU EMPIRE model from your army makes a ranged attack, you can re-roll a Hit roll of 1. From Battle Round 4 onwards, you can re-roll the Hit roll instead.",
      stratagems: [
        {
          id: 'tau-patient-ambush',
          name: 'Patient Ambush',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit. Until the end of the phase, each time a model in that unit makes a ranged attack, if it did not make a Normal move this turn, re-roll a Wound roll of 1.",
        },
        {
          id: 'tau-combat-embarkation',
          name: 'Combat Embarkation',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit that just finished shooting. That unit can embark into a friendly TRANSPORT within 3\" as if it were the Movement phase.",
          restrictions: ['INFANTRY'],
        },
        {
          id: 'tau-strike-and-fade',
          name: 'Strike and Fade',
          cpCost: 2,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit that just finished shooting. That unit can make a Normal move of up to 6\", but must end more than 9\" from all enemy units.",
        },
        {
          id: 'tau-counterfire-defence',
          name: 'Counterfire Defence',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'opponent_turn',
          description:
            "Select one T'AU EMPIRE unit that is being targeted by a ranged attack. Until the end of the phase, each time a ranged attack targets that unit, subtract 1 from the Hit roll.",
        },
        {
          id: 'tau-photon-grenades',
          name: 'Photon Grenades',
          cpCost: 1,
          phases: ['charge'],
          timing: 'opponent_turn',
          description:
            "Select one T'AU EMPIRE unit that is targeted by a charge. Until the end of the phase, subtract 2 from the Charge roll made for the charging unit.",
        },
        {
          id: 'tau-coordinate-engagement',
          name: 'Coordinate Engagement',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one enemy unit visible to a MARKERLIGHT unit. Until the end of the phase, each time a friendly T'AU EMPIRE model makes a ranged attack against that unit, re-roll a Hit roll of 1.",
        },
      ],
      enhancements: [
        {
          id: 'tau-puretide-chip',
          name: "Puretide Engram Neurochip",
          pointsCost: 25,
          eligibleKeywords: ['CHARACTER'],
          description:
            'CHARACTER only. Once per battle, at the start of your Command phase, you gain D3 Command points.',
        },
        {
          id: 'tau-through-unity',
          name: 'Through Unity, Devastation',
          pointsCost: 20,
          eligibleKeywords: ['CHARACTER'],
          description:
            "CHARACTER only. Each time a friendly T'AU EMPIRE unit within 6\" of the bearer is selected to shoot, you can select one enemy unit. Until the end of the phase, each time a model in that unit makes a ranged attack against the selected enemy, improve the AP of that attack by 1.",
        },
        {
          id: 'tau-precision-of-hunter',
          name: 'Precision of the Hunter',
          pointsCost: 20,
          eligibleKeywords: ['CHARACTER'],
          description:
            'CHARACTER only. Ranged weapons equipped by the bearer have the [PRECISION] and [LETHAL HITS] abilities.',
        },
        {
          id: 'tau-exemplar-kauyon',
          name: 'Exemplar of the Kauyon',
          pointsCost: 15,
          eligibleKeywords: ['CHARACTER'],
          description:
            'CHARACTER only. The Patient Hunter detachment rule takes effect one battle round earlier for units within 6\" of the bearer (Round 2 for re-roll 1s, Round 3 for full re-rolls).',
        },
      ],
    },

    // --- Mont'ka ---
    {
      id: 'montka',
      name: "Mont'ka",
      factionId: 'tau-empire',
      rules:
        "Killing Blow: During Battle Rounds 1-3, each time a T'AU EMPIRE model from your army makes a ranged attack that targets a unit within a certain range, improve the AP of that attack by 1. Round 1: 18\". Round 2: 12\". Round 3: 9\".",
      stratagems: [
        {
          id: 'tau-aggressive-advance',
          name: 'Aggressive Advance',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit that Advanced this turn. Until the end of the turn, ranged weapons equipped by models in that unit have the [ASSAULT] ability.",
        },
        {
          id: 'tau-dynamic-offensive',
          name: 'Dynamic Offensive',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit that made a Normal move this turn. Until the end of the phase, each time a model in that unit makes a ranged attack, re-roll a Hit roll of 1.",
        },
        {
          id: 'tau-drop-zone-clear',
          name: 'Drop Zone Clear',
          cpCost: 2,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            "Use when a T'AU EMPIRE unit arrives from Reserves. Until the end of the turn, each time a model in that unit makes a ranged attack, add 1 to the Hit roll.",
        },
        {
          id: 'tau-combat-debarkation',
          name: 'Combat Debarkation',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE TRANSPORT. One unit can disembark from it even if the TRANSPORT has already moved this phase. The disembarking unit counts as having made a Normal move.",
          restrictions: ['TRANSPORT'],
        },
        {
          id: 'tau-focused-fire',
          name: 'Focused Fire',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one enemy unit. Until the end of the phase, each time a T'AU EMPIRE model from your army makes a ranged attack against that unit, improve the AP of that attack by 1.",
        },
        {
          id: 'tau-point-blank-volley',
          name: 'Point-Blank Volley',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit within Engagement Range of an enemy unit. That unit can shoot as normal even though it is within Engagement Range. Ranged attacks must target the closest eligible enemy unit.",
        },
      ],
      enhancements: [
        {
          id: 'tau-montka-commander',
          name: "Master of the Mont'ka",
          pointsCost: 25,
          eligibleKeywords: ['CHARACTER'],
          description:
            'CHARACTER only. The Killing Blow detachment rule applies to the bearer\'s unit at 24\" range instead of the normal threshold, regardless of the battle round.',
        },
        {
          id: 'tau-onager-gauntlet',
          name: 'Onager Gauntlet',
          pointsCost: 20,
          eligibleKeywords: ['CHARACTER'],
          description:
            'CHARACTER only. Melee weapons equipped by the bearer have +3 Strength, +1 AP, and +1 Damage.',
        },
        {
          id: 'tau-strike-swiftly',
          name: 'Strike Swiftly',
          pointsCost: 15,
          eligibleKeywords: ['CHARACTER'],
          description:
            "CHARACTER only. The bearer's unit has +2\" to its Move characteristic and can shoot after Falling Back.",
        },
        {
          id: 'tau-coordinated-assault',
          name: 'Coordinated Assault',
          pointsCost: 20,
          eligibleKeywords: ['CHARACTER'],
          description:
            "CHARACTER only. Each time a friendly T'AU EMPIRE unit within 6\" of the bearer is selected to shoot at a target that is within 12\", re-roll Hit rolls of 1.",
        },
      ],
    },

    // --- Retaliation Cadre ---
    {
      id: 'retaliation-cadre',
      name: 'Retaliation Cadre',
      factionId: 'tau-empire',
      rules:
        "Bonded by Honour: Each time a T'AU EMPIRE model from your army makes a ranged attack that targets an enemy unit within 6\" of a friendly unit that was destroyed this turn, you can re-roll the Hit roll and the Wound roll.",
      stratagems: [
        {
          id: 'tau-bonded-retaliation',
          name: 'Bonded Retaliation',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit within 6\" of where a friendly unit was destroyed this turn. Until the end of the phase, ranged weapons equipped by models in that unit gain [LETHAL HITS].",
        },
        {
          id: 'tau-vengeance-for-fallen',
          name: 'Vengeance for the Fallen',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit. Until the end of the phase, each time a model in that unit makes a ranged attack that targets an enemy unit that destroyed a friendly unit this turn, add 1 to the Wound roll.",
        },
        {
          id: 'tau-shield-wall',
          name: 'Shield Wall',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'opponent_turn',
          description:
            "Select one T'AU EMPIRE BATTLESUIT unit. Until the end of the phase, that unit has a 4+ invulnerable save against ranged attacks.",
          restrictions: ['BATTLESUIT'],
        },
        {
          id: 'tau-rapid-redeploy',
          name: 'Rapid Redeploy',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            "Select one T'AU EMPIRE unit. That unit can make a Normal move of up to D6\" instead of its normal Move characteristic.",
        },
        {
          id: 'tau-heroic-sacrifice',
          name: 'Heroic Sacrifice',
          cpCost: 1,
          phases: ['fight'],
          timing: 'either_turn',
          description:
            "Use when a T'AU EMPIRE CHARACTER model is destroyed by a melee attack. Before removing it, it can shoot as if it were the Shooting phase or fight as if it were the Fight phase.",
          restrictions: ['CHARACTER'],
        },
        {
          id: 'tau-coordinated-retaliation',
          name: 'Coordinated Retaliation',
          cpCost: 2,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            "Select up to 3 T'AU EMPIRE units within 6\" of each other. Each of those units can shoot at the same target. Each time a model in those units makes a ranged attack against that target, re-roll a Wound roll of 1.",
        },
      ],
      enhancements: [
        {
          id: 'tau-sworn-protector',
          name: 'Sworn Protector',
          pointsCost: 25,
          eligibleKeywords: ['CHARACTER'],
          description:
            "CHARACTER only. While a friendly T'AU EMPIRE unit is within 6\" of the bearer, that unit has the Feel No Pain 6+ ability.",
        },
        {
          id: 'tau-unbreakable-spirit',
          name: 'Unbreakable Spirit',
          pointsCost: 15,
          eligibleKeywords: ['CHARACTER'],
          description:
            "CHARACTER only. The bearer's unit automatically passes Battle-shock tests. Friendly units within 6\" add 1 to their Leadership characteristic.",
        },
        {
          id: 'tau-hunter-contingent',
          name: 'Hunter Contingent',
          pointsCost: 20,
          eligibleKeywords: ['CHARACTER'],
          description:
            "CHARACTER only. At the start of your Shooting phase, select one enemy unit visible to the bearer. Until the end of the phase, each time a friendly T'AU EMPIRE model makes a ranged attack against that unit, improve the AP of that attack by 1.",
        },
        {
          id: 'tau-bond-of-duty',
          name: 'Bond of Duty',
          pointsCost: 15,
          eligibleKeywords: ['CHARACTER'],
          description:
            "CHARACTER only. Each time the bearer's unit is targeted by a ranged attack, if it is within 6\" of where a friendly unit was destroyed this turn, subtract 1 from the Damage characteristic of that attack (minimum 1).",
        },
      ],
    },

    // --- Kroot Hunting Pack ---
    {
      id: 'kroot-hunting-pack',
      name: 'Kroot Hunting Pack',
      factionId: 'tau-empire',
      rules:
        'Guerrilla Tactics: KROOT models from your army gain the Scouts 7" ability. Each time a KROOT model from your army makes a melee attack that targets a unit that is below its Starting Strength, you can re-roll the Hit roll of 1.',
      stratagems: [
        {
          id: 'tau-hidden-hunters',
          name: 'Hidden Hunters',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            'Select one KROOT unit. That unit can make a Normal move of up to 6\" after shooting, but must end more than 9\" from all enemy units.',
        },
        {
          id: 'tau-ambush-predators',
          name: 'Ambush Predators',
          cpCost: 1,
          phases: ['charge'],
          timing: 'your_turn',
          description:
            'Select one KROOT unit that was set up from Reserves this turn. That unit can charge even though it arrived from Reserves.',
          restrictions: ['KROOT'],
        },
        {
          id: 'tau-hunting-ground',
          name: 'Hunting Ground',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one KROOT unit within an area terrain feature. Until the end of the phase, ranged weapons equipped by models in that unit gain [IGNORES COVER].',
          restrictions: ['KROOT'],
        },
        {
          id: 'tau-feast-on-fallen',
          name: 'Feast on the Fallen',
          cpCost: 1,
          phases: ['command'],
          timing: 'your_turn',
          description:
            'Select one KROOT unit within 3\" of a destroyed enemy model. One destroyed model in that unit is returned with 1 wound remaining.',
          restrictions: ['KROOT'],
        },
        {
          id: 'tau-pack-tactics',
          name: 'Pack Tactics',
          cpCost: 1,
          phases: ['fight'],
          timing: 'either_turn',
          description:
            'Select one KROOT unit within Engagement Range of an enemy unit. Until the end of the phase, each time a model in that unit makes a melee attack, re-roll a Hit roll of 1.',
          restrictions: ['KROOT'],
        },
        {
          id: 'tau-trail-predators',
          name: 'Trail of the Predators',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            'Select one KROOT unit. That unit can make a Normal move of D6\" in addition to any other move it makes this phase.',
          restrictions: ['KROOT'],
        },
      ],
      enhancements: [
        {
          id: 'tau-kroot-master-shaper',
          name: 'Master Shaper',
          pointsCost: 25,
          eligibleKeywords: ['CHARACTER', 'KROOT'],
          description:
            'KROOT CHARACTER only. The bearer\'s unit has the Scouts 9\" ability instead of 7\". Friendly KROOT units within 6\" can re-roll Advance rolls.',
        },
        {
          id: 'tau-ritual-blade',
          name: 'Ritual Blade',
          pointsCost: 20,
          eligibleKeywords: ['CHARACTER', 'KROOT'],
          description:
            "KROOT CHARACTER only. Improve the bearer's melee weapons AP by 2 and add 1 to the Damage characteristic. Each time the bearer destroys an enemy CHARACTER in melee, gain 1CP.",
        },
        {
          id: 'tau-prey-sight',
          name: 'Prey-Sight',
          pointsCost: 15,
          eligibleKeywords: ['CHARACTER', 'KROOT'],
          description:
            "KROOT CHARACTER only. The bearer's unit has the [LETHAL HITS] ability for melee weapons when targeting a unit below its Starting Strength.",
        },
        {
          id: 'tau-beastmaster',
          name: 'Beastmaster',
          pointsCost: 10,
          eligibleKeywords: ['CHARACTER', 'KROOT'],
          description:
            'KROOT CHARACTER only. Friendly KROOT BEAST and KROOT HOUND units within 6\" of the bearer add 1 to their Attacks characteristic.',
        },
      ],
    },
  ],
};
