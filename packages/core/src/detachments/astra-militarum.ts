import type { FactionDefinition, FactionStateHandlers } from '../types/index';

export interface AstraMilitarumState {
  activeOrders: Record<string, string>;
  officersUsedThisPhase: string[];
}

export const astraMilitarumStateHandlers: FactionStateHandlers<AstraMilitarumState> = {
  createInitial: () => ({ activeOrders: {}, officersUsedThisPhase: [] }),
  onPhaseChange: () => ({ activeOrders: {}, officersUsedThisPhase: [] }),
  onTurnChange: () => ({ activeOrders: {}, officersUsedThisPhase: [] }),
};

export const astraMilitarum: FactionDefinition = {
  id: 'astra-militarum',
  name: 'Astra Militarum',
  factionKeyword: 'ASTRA MILITARUM',
  catalogueNames: ['Astra Militarum', 'Imperial Guard'],
  factionRuleName: 'Born Soldiers',
  factionRuleDescription:
    'Ranged attacks made by ASTRA MILITARUM units that Remained Stationary this turn score Critical Hits on unmodified Hit rolls of 5+, instead of only 6.',

  detachments: [
    // --- Combined Regiment ---
    {
      id: 'combined-regiment',
      name: 'Combined Regiment',
      factionId: 'astra-militarum',
      rules:
        'Orders: At the start of your Shooting phase, each OFFICER model can issue one Order to a friendly ASTRA MILITARUM unit within 6". Choose one: Take Aim (re-roll Hit rolls of 1), First Rank Fire! Second Rank Fire! (ranged weapons gain AP improved by 1), Move! Move! Move! (+2" to Move characteristic), Fix Bayonets! (re-roll melee Hit rolls of 1), Duty and Honour! (4+ invulnerable save until start of your next turn).',
      stratagems: [
        {
          id: 'am-fields-of-fire',
          name: 'Fields of Fire',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Use after an ASTRA MILITARUM unit shoots at an enemy unit. Until the end of the phase, each time another friendly ASTRA MILITARUM unit shoots at the same target, improve the AP of those attacks by 1.',
        },
        {
          id: 'am-inspired-command',
          name: 'Inspired Command',
          cpCost: 1,
          phases: ['command'],
          timing: 'your_turn',
          description:
            'Select one OFFICER model. That model can issue one additional Order this turn.',
          restrictions: ['OFFICER'],
        },
        {
          id: 'am-reinforcements',
          name: 'Reinforcements!',
          cpCost: 2,
          phases: ['command'],
          timing: 'your_turn',
          description:
            'Select one destroyed ASTRA MILITARUM INFANTRY unit (excluding CHARACTER). Set it up again at Starting Strength, wholly within 6" of a board edge and more than 9" from enemy models.',
          restrictions: ['INFANTRY'],
        },
        {
          id: 'am-jury-rigged-repairs',
          name: 'Jury-Rigged Repairs',
          cpCost: 1,
          phases: ['command'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM VEHICLE model. That model regains up to D3 lost wounds.',
          restrictions: ['VEHICLE'],
        },
        {
          id: 'am-suppressive-fire',
          name: 'Suppressive Fire',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Use after an ASTRA MILITARUM unit shoots at an enemy unit. The target must take a Battle-shock test.',
        },
        {
          id: 'am-volley-fire',
          name: 'Volley Fire',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM INFANTRY unit that is receiving the Take Aim order. Until the end of the phase, each time a model in that unit makes a ranged attack, an unmodified Hit roll of 5+ scores a Critical Hit.',
          restrictions: ['INFANTRY'],
        },
      ],
      enhancements: [
        {
          id: 'am-drill-commander',
          name: 'Drill Commander',
          pointsCost: 20,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. The bearer can issue one additional Order each turn.',
        },
        {
          id: 'am-grand-strategist',
          name: 'Grand Strategist',
          pointsCost: 25,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. Once per battle, when the bearer issues an Order, that Order affects all friendly ASTRA MILITARUM units within 6" instead of one.',
        },
        {
          id: 'am-kurovs-aquila',
          name: "Kurov's Aquila",
          pointsCost: 40,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. Each time your opponent uses a Stratagem, roll one D6: on a 5+, you gain 1CP.',
        },
        {
          id: 'am-blade-of-conquest',
          name: 'Blade of Conquest',
          pointsCost: 15,
          eligibleKeywords: ['OFFICER'],
          description:
            "OFFICER only. Improve the bearer's melee weapons AP by 1 and add 1 to the Damage characteristic.",
        },
      ],
    },

    // --- Mechanised Assault ---
    {
      id: 'mechanised-assault',
      name: 'Mechanised Assault',
      factionId: 'astra-militarum',
      rules:
        'Armoured Spearhead: Each time a model in an ASTRA MILITARUM TRANSPORT or MOUNTED unit makes a ranged attack, improve the AP of that attack by 1. ASTRA MILITARUM units that disembark from a TRANSPORT this turn can still shoot.',
      stratagems: [
        {
          id: 'am-rolling-gunline',
          name: 'Rolling Gunline',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM unit that disembarked this turn. Until the end of the phase, ranged weapons equipped by models in that unit have the [LETHAL HITS] ability.',
        },
        {
          id: 'am-armoured-assault',
          name: 'Armoured Assault',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM TRANSPORT that Advanced. Units can still disembark from it this turn (but the disembarking unit counts as having Advanced).',
          restrictions: ['TRANSPORT'],
        },
        {
          id: 'am-mobile-fortress',
          name: 'Mobile Fortress',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'opponent_turn',
          description:
            'Select one ASTRA MILITARUM TRANSPORT. Until the end of the phase, each time an attack targets that unit, subtract 1 from the Wound roll.',
          restrictions: ['TRANSPORT'],
        },
        {
          id: 'am-outflank',
          name: 'Outflank',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM TRANSPORT in Strategic Reserves. It can arrive from any board edge (not just your own).',
          restrictions: ['TRANSPORT'],
        },
        {
          id: 'am-rapid-embark',
          name: 'Rapid Embark',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM INFANTRY unit within 3" of a friendly TRANSPORT. That unit can embark even if it has already moved this turn.',
          restrictions: ['INFANTRY'],
        },
        {
          id: 'am-dismount',
          name: 'Dismount!',
          cpCost: 1,
          phases: ['charge'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM TRANSPORT that made a Charge move. One unit can disembark after the Charge move and is eligible to declare a charge this phase.',
          restrictions: ['TRANSPORT'],
        },
      ],
      enhancements: [
        {
          id: 'am-mechanised-commander',
          name: 'Mechanised Commander',
          pointsCost: 25,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. While the bearer is embarked in a TRANSPORT, that TRANSPORT has the [LETHAL HITS] ability for its ranged weapons.',
        },
        {
          id: 'am-armourbane',
          name: 'Armourbane',
          pointsCost: 20,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. Ranged weapons equipped by the bearer gain the [MELTA 2] ability.',
        },
        {
          id: 'am-rapid-deployment',
          name: 'Rapid Deployment',
          pointsCost: 15,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. Units that disembark from a TRANSPORT within 6" of the bearer can make a Normal move of up to 3" after disembarking.',
        },
        {
          id: 'am-steel-commissar',
          name: 'Steel Commissar',
          pointsCost: 15,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. While the bearer is embarked, all models using Firing Deck from that TRANSPORT re-roll Hit rolls of 1.',
        },
      ],
    },

    // --- Armoured Company ---
    {
      id: 'armoured-company',
      name: 'Armoured Company',
      factionId: 'astra-militarum',
      rules:
        'Rolling Fortress: Each time a ranged attack targets an ASTRA MILITARUM VEHICLE unit from your army, if the attacker is more than 12" away, subtract 1 from the Wound roll.',
      stratagems: [
        {
          id: 'am-concentrated-fire',
          name: 'Concentrated Fire',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM VEHICLE. Until the end of the phase, each time a model in that unit makes a ranged attack, re-roll a Wound roll of 1.',
          restrictions: ['VEHICLE'],
        },
        {
          id: 'am-armoured-might',
          name: 'Armoured Might',
          cpCost: 2,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM VEHICLE that Remained Stationary. Until the end of the phase, ranged weapons equipped by that model gain [DEVASTATING WOUNDS].',
          restrictions: ['VEHICLE'],
        },
        {
          id: 'am-hull-down',
          name: 'Hull Down',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'opponent_turn',
          description:
            'Select one ASTRA MILITARUM VEHICLE that is not within Engagement Range. Until the end of the phase, that unit has a 4+ invulnerable save against ranged attacks.',
          restrictions: ['VEHICLE'],
        },
        {
          id: 'am-flanking-manoeuvre',
          name: 'Flanking Manoeuvre',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM VEHICLE that made a Normal move. That unit counts as having Remained Stationary for the purposes of shooting this turn.',
          restrictions: ['VEHICLE'],
        },
        {
          id: 'am-steel-phalanx',
          name: 'Steel Phalanx',
          cpCost: 1,
          phases: ['charge'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM VEHICLE that made a Charge move. Until the end of the turn, melee weapons equipped by that model gain +1 Strength and +1 AP.',
          restrictions: ['VEHICLE'],
        },
        {
          id: 'am-emergency-repairs',
          name: 'Emergency Repairs',
          cpCost: 1,
          phases: ['command'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM VEHICLE. It regains up to D3+1 lost wounds.',
          restrictions: ['VEHICLE'],
        },
      ],
      enhancements: [
        {
          id: 'am-master-of-armour',
          name: 'Master of Armour',
          pointsCost: 35,
          eligibleKeywords: ['OFFICER', 'VEHICLE'],
          description:
            'OFFICER or VEHICLE only. The bearer has a 5+ invulnerable save. Friendly ASTRA MILITARUM VEHICLE units within 6" also have a 6+ invulnerable save.',
        },
        {
          id: 'am-predatory-instinct',
          name: 'Predatory Instinct',
          pointsCost: 20,
          eligibleKeywords: ['VEHICLE'],
          description:
            'VEHICLE only. Each time the bearer makes a ranged attack targeting the closest eligible enemy unit, re-roll the Hit roll.',
        },
        {
          id: 'am-ironclad-resolve',
          name: 'Ironclad Resolve',
          pointsCost: 15,
          eligibleKeywords: ['VEHICLE'],
          description:
            'VEHICLE only. Each time an attack is allocated to the bearer, subtract 1 from the Damage characteristic of that attack (minimum 1).',
        },
        {
          id: 'am-experienced-eye',
          name: 'Experienced Eye',
          pointsCost: 15,
          eligibleKeywords: ['VEHICLE'],
          description:
            'VEHICLE only. Once per battle, in your Shooting phase, the bearer can use this ability. If it does, until the end of the phase, ranged weapons equipped by the bearer gain [LETHAL HITS] and [SUSTAINED HITS 1].',
        },
      ],
    },

    // --- Fortification Network ---
    {
      id: 'fortification-network',
      name: 'Fortification Network',
      factionId: 'astra-militarum',
      rules:
        'Siege Warfare: Each time an ASTRA MILITARUM model from your army makes a ranged attack that targets a unit within range of an objective marker, re-roll a Wound roll of 1.',
      stratagems: [
        {
          id: 'am-dig-in',
          name: 'Dig In!',
          cpCost: 1,
          phases: ['movement'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM INFANTRY unit within range of an objective marker. Until the start of your next turn, that unit has the Benefit of Cover and a 5+ invulnerable save.',
          restrictions: ['INFANTRY'],
        },
        {
          id: 'am-overlapping-fields-of-fire',
          name: 'Overlapping Fields of Fire',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM unit within range of an objective marker. Until the end of the phase, each time a model in that unit makes a ranged attack, re-roll a Hit roll of 1.',
        },
        {
          id: 'am-hold-at-all-costs',
          name: 'Hold at All Costs',
          cpCost: 2,
          phases: ['fight'],
          timing: 'either_turn',
          description:
            'Select one ASTRA MILITARUM unit within range of an objective marker. Until the end of the phase, each time a model in that unit is destroyed by a melee attack, if it has not fought this phase, roll one D6: on a 4+, do not remove it from play. The model can fight after the attacker\'s unit has finished making its attacks, and is then removed.',
        },
        {
          id: 'am-fortified-position',
          name: 'Fortified Position',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'opponent_turn',
          description:
            'Select one ASTRA MILITARUM unit within range of an objective marker. Until the end of the phase, each time a ranged attack targets that unit, subtract 1 from the Hit roll.',
        },
        {
          id: 'am-interlocking-fire',
          name: 'Interlocking Fire',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one enemy unit within range of an objective marker. Until the end of the phase, each time a friendly ASTRA MILITARUM model makes a ranged attack against that enemy unit, improve the AP of that attack by 1.',
        },
        {
          id: 'am-call-in-support',
          name: 'Call in Support',
          cpCost: 1,
          phases: ['shooting'],
          timing: 'your_turn',
          description:
            'Select one ASTRA MILITARUM unit that is within range of an objective marker. Until the end of the phase, each time a model in that unit makes a ranged attack, add 1 to the Wound roll.',
        },
      ],
      enhancements: [
        {
          id: 'am-fortification-expert',
          name: 'Fortification Expert',
          pointsCost: 25,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. While the bearer is within range of an objective marker, friendly ASTRA MILITARUM units within 6" have a 5+ invulnerable save.',
        },
        {
          id: 'am-siege-master',
          name: 'Siege Master',
          pointsCost: 20,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. Each time a friendly ASTRA MILITARUM model within 6" of the bearer makes a ranged attack that targets a unit within range of an objective marker, re-roll the Wound roll.',
        },
        {
          id: 'am-vox-officer',
          name: 'Vox Officer',
          pointsCost: 10,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. Increase the range of the bearer\'s Orders by 3" (to 9").',
        },
        {
          id: 'am-last-line',
          name: 'Last Line of Defence',
          pointsCost: 15,
          eligibleKeywords: ['OFFICER'],
          description:
            'OFFICER only. While the bearer is within range of an objective marker you control, the bearer\'s unit automatically passes Battle-shock tests.',
        },
      ],
    },
  ],
};
