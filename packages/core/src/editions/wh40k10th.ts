import type { RulesEdition } from '../rules/RulesEdition';

export const wh40k10thEdition: RulesEdition = {
  id: 'wh40k-10th',
  name: 'Warhammer 40,000 — 10th Edition',
  gameSystem: '40k',

  phases: [
    { id: 'command', name: 'Command Phase' },
    { id: 'movement', name: 'Movement Phase' },
    { id: 'shooting', name: 'Shooting Phase' },
    { id: 'charge', name: 'Charge Phase' },
    { id: 'fight', name: 'Fight Phase' },
    { id: 'morale', name: 'Morale Phase' },
  ],

  getNextPhase(currentIndex: number): number | null {
    const next = currentIndex + 1;
    return next < this.phases.length ? next : null;
  },

  getMaxMoveDistance(moveCharacteristic: number, moveType: 'normal' | 'advance' | 'fall_back'): number {
    switch (moveType) {
      case 'normal':
        return moveCharacteristic;
      case 'advance':
        // Advance adds D6 — return the base; caller adds the roll
        return moveCharacteristic;
      case 'fall_back':
        return moveCharacteristic;
    }
  },

  getEngagementRange(): number {
    return 1; // 1 inch
  },

  getCoherencyRange(): number {
    return 2; // 2 inches
  },

  getCoherencyMinModels(unitSize: number): number {
    // In 10th edition, units of 6+ models must have each model within 2" of 2 other models
    return unitSize >= 6 ? 2 : 1;
  },
};
