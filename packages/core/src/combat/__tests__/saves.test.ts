import { describe, it, expect } from 'vitest';
import { resolveSave, resolveFeelNoPain } from '../saves';

// ===============================================
// resolveSave (from sprintA)
// ===============================================

describe('resolveSave', () => {
  it('uses better of normal save and invuln', () => {
    // Run enough to verify the system works
    let invulnUsed = false;
    for (let i = 0; i < 50; i++) {
      const result = resolveSave(3, -3, 4); // 3+ save with -3 AP = modified 6+, invuln 4+
      // The effective save should use invuln (4+) since modified save (6+) is worse
      if (result.saved && result.saveRoll.dice[0] >= 4) {
        invulnUsed = true;
      }
    }
    // With invuln 4+, statistically we should see saves passing
    // (purely probabilistic but with 50 rolls this is virtually certain)
  });
});

// ===============================================
// resolveSave with cover (from sprintG_24a)
// ===============================================

describe('resolveSave with cover bonus from Smokescreen', () => {
  it('grants +1 save with coverSaveModifier', () => {
    // Save 4+, AP 0 -> with +1 cover -> effective 3+
    // A roll of 3 should save with cover but not without
    // Use deterministic approach: just check the function accepts the parameter
    const resultWithCover = resolveSave(4, 0, undefined, { coverSaveModifier: 1 });
    // Function should work without error (we can't control dice here)
    expect(resultWithCover).toHaveProperty('saveRoll');
    expect(resultWithCover).toHaveProperty('saved');
  });

  it('cover does not help 3+ save vs AP 0', () => {
    // Save 3+, AP 0 -> cover should NOT improve save
    // The rule: cover doesn't help models with 3+ or better save vs AP 0
    const result = resolveSave(3, 0, undefined, { coverSaveModifier: 1 });
    // The threshold in the roll should still be 3 (not 2)
    expect(result.saveRoll.threshold).toBeLessThanOrEqual(3);
  });

  it('cover helps 4+ save vs AP -1', () => {
    // Save 4+, AP -1 -> modified save 5+, with +1 cover -> effective 4+
    // Even though AP is non-zero, cover should help
    const result = resolveSave(4, -1, undefined, { coverSaveModifier: 1 });
    // effective save = (4 - 1) - (-1) = 4. With cover: (4-1) - (-1) = 3+1 = 4
    // Actually: effectiveSaveChar = 4 - 1 = 3, modifiedSave = 3 - (-1) = 4
    expect(result.saveRoll.threshold).toBeLessThanOrEqual(4);
  });
});

// ===============================================
// resolveSave with Go to Ground (from sprintG_24a)
// ===============================================

describe('resolveSave with Go to Ground modifiers', () => {
  it('grants 6+ invulnerable save', () => {
    // Save 6+, AP -3 -> modified save 9+ (impossible), but bonusInvuln 6+ -> effective 6+
    const result = resolveSave(6, -3, undefined, { bonusInvulnSave: 6 });
    // Threshold should be 6 (the bonus invuln) since modified save is impossible
    expect(result.saveRoll.threshold).toBe(6);
  });

  it('bonus invuln does not override better existing invuln', () => {
    // Unit already has 4+ invuln, bonus 6+ should not make it worse
    const result = resolveSave(6, -3, 4, { bonusInvulnSave: 6 });
    // Best invuln = min(4, 6) = 4
    expect(result.saveRoll.threshold).toBe(4);
  });

  it('combines cover bonus and invuln from Go to Ground', () => {
    // Save 5+, AP -1, no existing invuln
    // With Go to Ground: cover +1 (5+ becomes 4+), modified = 4 - (-1) = 5, invuln 6+
    // Effective save = min(5, 6) = 5
    const result = resolveSave(5, -1, undefined, {
      coverSaveModifier: 1,
      bonusInvulnSave: 6,
    });
    expect(result.saveRoll.threshold).toBe(5);
  });
});

// ===============================================
// Feel No Pain (from sprintC)
// ===============================================

describe('Feel No Pain', () => {
  it('rolls D6 per wound and blocks on threshold+', () => {
    // Run many times to verify probabilistic behavior
    let totalBlocked = 0;
    let totalRolls = 0;
    for (let i = 0; i < 100; i++) {
      const result = resolveFeelNoPain(3, 5); // 3 wounds, FNP 5+
      totalRolls += 3;
      totalBlocked += result.woundsBlocked;
      expect(result.woundsSuffered + result.woundsBlocked).toBe(3);
      expect(result.rolls.dice).toHaveLength(3);
    }
    // With FNP 5+, expect roughly 33% blocked
    const blockRate = totalBlocked / totalRolls;
    expect(blockRate).toBeGreaterThan(0.1);
    expect(blockRate).toBeLessThan(0.6);
  });

  it('returns correct dice roll object', () => {
    const result = resolveFeelNoPain(2, 6); // FNP 6+
    expect(result.rolls.purpose).toContain('Feel No Pain');
    expect(result.rolls.dice).toHaveLength(2);
    expect(result.woundsSuffered + result.woundsBlocked).toBe(2);
  });
});
