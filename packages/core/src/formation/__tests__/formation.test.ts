import { describe, it, expect } from 'vitest';
import { getFormationOptions, gridFormation, clusterFormation } from '../index';
import type { BaseShape } from '../../types/index';

const circle32: BaseShape = { type: 'circle', diameterMm: 32 };
const rect: BaseShape = { type: 'rect', widthMm: 130, heightMm: 80 };

describe('getFormationOptions', () => {
  it('returns empty for 1 model', () => {
    expect(getFormationOptions(1)).toEqual([]);
  });

  it('returns correct options for 10 models', () => {
    const opts = getFormationOptions(10);
    const labels = opts.map((o) => o.label);
    expect(labels).toContain('Column (1x10)');
    expect(labels).toContain('2x5');
    expect(labels).toContain('5x2');
    expect(labels).toContain('Line (10x1)');
  });

  it('returns correct options for 6 models', () => {
    const opts = getFormationOptions(6);
    const labels = opts.map((o) => o.label);
    expect(labels).toContain('Column (1x6)');
    expect(labels).toContain('2x3');
    expect(labels).toContain('3x2');
    expect(labels).toContain('Line (6x1)');
  });

  it('handles prime numbers (5 models)', () => {
    const opts = getFormationOptions(5);
    const labels = opts.map((o) => o.label);
    // 5 is prime: only 1x5 and 5x1
    expect(labels).toContain('Column (1x5)');
    expect(labels).toContain('Line (5x1)');
    expect(opts.length).toBe(2);
  });
});

describe('gridFormation', () => {
  it('returns correct number of positions', () => {
    const positions = gridFormation({ x: 10, y: 10 }, 10, 5, 2, circle32);
    expect(positions).toHaveLength(10);
  });

  it('positions are centered around the given center', () => {
    const center = { x: 10, y: 10 };
    const positions = gridFormation(center, 4, 2, 2, circle32, 90);
    const avgX = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const avgY = positions.reduce((s, p) => s + p.y, 0) / positions.length;
    expect(avgX).toBeCloseTo(center.x, 3);
    expect(avgY).toBeCloseTo(center.y, 3);
  });

  it('models do not overlap (circle bases)', () => {
    const positions = gridFormation({ x: 10, y: 10 }, 10, 5, 2, circle32, 0);
    const diameter = 32 / 25.4;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThan(diameter - 0.01);
      }
    }
  });

  it('models do not overlap (rect bases)', () => {
    const positions = gridFormation({ x: 10, y: 10 }, 4, 2, 2, rect, 90);
    // For rects facing the same direction, minimum distance between centers
    // is the larger of width or height + pad
    const minDist = Math.max(130, 80) / 25.4; // ~5.12"
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // At least one axis should be >= minDist
        expect(Math.max(Math.abs(dx), Math.abs(dy))).toBeGreaterThan(minDist * 0.5 - 0.01);
      }
    }
  });
});

describe('clusterFormation', () => {
  it('returns 1 position at center for single model', () => {
    const positions = clusterFormation({ x: 5, y: 5 }, 1, circle32);
    expect(positions).toHaveLength(1);
    expect(positions[0].x).toBe(5);
    expect(positions[0].y).toBe(5);
  });

  it('returns correct number of positions', () => {
    const positions = clusterFormation({ x: 10, y: 10 }, 10, circle32);
    expect(positions).toHaveLength(10);
  });

  it('first model is at center', () => {
    const positions = clusterFormation({ x: 10, y: 10 }, 7, circle32);
    expect(positions[0]).toEqual({ x: 10, y: 10 });
  });

  it('models do not overlap (circle bases)', () => {
    const positions = clusterFormation({ x: 10, y: 10 }, 10, circle32);
    const diameter = 32 / 25.4;
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        expect(dist).toBeGreaterThan(diameter - 0.01);
      }
    }
  });

  it('cluster is tighter than a grid', () => {
    const center = { x: 10, y: 10 };
    const count = 10;
    const cluster = clusterFormation(center, count, circle32);
    const grid = gridFormation(center, count, 5, 2, circle32, 0);

    // Compute max distance from center for both
    const maxCluster = Math.max(...cluster.map((p) => Math.sqrt((p.x - center.x) ** 2 + (p.y - center.y) ** 2)));
    const maxGrid = Math.max(...grid.map((p) => Math.sqrt((p.x - center.x) ** 2 + (p.y - center.y) ** 2)));

    expect(maxCluster).toBeLessThanOrEqual(maxGrid);
  });
});
