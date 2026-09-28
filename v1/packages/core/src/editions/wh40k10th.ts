import type { RulesEdition, PhaseActionMap } from '../rules/RulesEdition';
import type { MoveType } from '../types/index';

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
  ],

  getNextPhase(currentIndex: number): number | null {
    const next = currentIndex + 1;
    return next < this.phases.length ? next : null;
  },

  getMaxMoveDistance(moveCharacteristic: number, moveType: MoveType): number {
    switch (moveType) {
      case 'normal':
        return moveCharacteristic;
      case 'advance':
        // Advance adds D6 — return the base; caller adds the roll
        return moveCharacteristic;
      case 'fall_back':
        return moveCharacteristic;
      case 'stationary':
        return 0;
    }
  },

  getEngagementRange(): number {
    return 1; // 1 inch
  },

  getCoherencyRange(): number {
    return 2; // 2 inches
  },

  getCoherencyMinModels(unitSize: number): number {
    return unitSize >= 6 ? 2 : 1;
  },

  getPhaseActionMap(): PhaseActionMap {
    return {
      command: ['admin'],
      movement: ['movement', 'admin'],
      shooting: ['shooting', 'admin'],
      charge: ['charge', 'admin'],
      fight: ['fight', 'admin'],
    };
  },

  getWoundThreshold(strength: number, toughness: number): number {
    if (strength >= toughness * 2) return 2;
    if (strength > toughness) return 3;
    if (strength === toughness) return 4;
    if (strength * 2 <= toughness) return 6;
    return 5; // strength < toughness
  },

  canUnitShoot(moveType: MoveType | undefined): { allowed: boolean; reason?: string } {
    if (moveType === 'advance') {
      return { allowed: false, reason: 'Unit Advanced this turn and cannot shoot (unless weapon has Assault)' };
    }
    if (moveType === 'fall_back') {
      return { allowed: false, reason: 'Unit Fell Back this turn and cannot shoot' };
    }
    return { allowed: true };
  },

  canUnitCharge(moveType: MoveType | undefined): { allowed: boolean; reason?: string } {
    if (moveType === 'advance') {
      return { allowed: false, reason: 'Unit Advanced this turn and cannot charge' };
    }
    if (moveType === 'fall_back') {
      return { allowed: false, reason: 'Unit Fell Back this turn and cannot charge' };
    }
    return { allowed: true };
  },
};
