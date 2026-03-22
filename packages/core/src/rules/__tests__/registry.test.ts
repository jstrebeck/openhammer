import { describe, it, expect, beforeEach } from 'vitest';
import { registerEdition, getEdition, listEditions } from '../registry';
import type { RulesEdition } from '../RulesEdition';

const mockEdition: RulesEdition = {
  id: 'test-edition',
  name: 'Test Edition',
  gameSystem: 'test',
  phases: [{ id: 'phase1', name: 'Phase 1' }],
  getNextPhase(currentIndex) {
    return currentIndex + 1 < this.phases.length ? currentIndex + 1 : null;
  },
  getMaxMoveDistance(mc, _type) {
    return mc;
  },
  getEngagementRange() {
    return 1;
  },
  getCoherencyRange() {
    return 2;
  },
  getCoherencyMinModels(_unitSize) {
    return 1;
  },
};

describe('Edition Registry', () => {
  it('registers and retrieves an edition', () => {
    registerEdition(mockEdition);
    expect(getEdition('test-edition')).toBe(mockEdition);
  });

  it('returns undefined for unknown edition', () => {
    expect(getEdition('nonexistent')).toBeUndefined();
  });

  it('lists all registered editions', () => {
    registerEdition(mockEdition);
    const editions = listEditions();
    expect(editions.some((e) => e.id === 'test-edition')).toBe(true);
  });
});
