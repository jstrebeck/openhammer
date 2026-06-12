import type { Point } from '../types/geometry';
import type { BaseShape } from '../types/index';
import { baseShapeDimensionsInches } from '../types/index';

export interface FormationOption {
  label: string;
  cols: number;
  rows: number;
}

/**
 * Generate the list of valid grid formation options for a given model count.
 * Returns all factor pairs (cols x rows) plus a "Line" (1×N) and "Column" (N×1).
 */
export function getFormationOptions(modelCount: number): FormationOption[] {
  if (modelCount <= 1) return [];

  const options: FormationOption[] = [];
  const seen = new Set<string>();

  // Factor pairs
  for (let cols = 1; cols <= modelCount; cols++) {
    if (modelCount % cols !== 0) continue;
    const rows = modelCount / cols;
    const key = `${cols}x${rows}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (cols === 1) {
      options.push({ label: `Column (1x${rows})`, cols: 1, rows });
    } else if (rows === 1) {
      options.push({ label: `Line (${cols}x1)`, cols, rows: 1 });
    } else {
      options.push({ label: `${cols}x${rows}`, cols, rows });
    }
  }

  return options;
}

/**
 * Compute the minimum gap between model centers to avoid base overlap.
 * For circles: diameter. For rects/ovals: max dimension + small padding.
 */
function modelSpacing(shape: BaseShape): { gapX: number; gapY: number } {
  const dims = baseShapeDimensionsInches(shape);
  const pad = 0.1; // 0.1" gap so bases don't touch
  return {
    gapX: dims.width + pad,
    gapY: dims.height + pad,
  };
}

/**
 * Calculate positions for a grid formation (cols x rows) centered on a point.
 * Returns world positions for each model.
 */
export function gridFormation(
  center: Point,
  modelCount: number,
  cols: number,
  rows: number,
  shape: BaseShape,
  facingDeg: number = 0,
): Point[] {
  const { gapX, gapY } = modelSpacing(shape);
  const positions: Point[] = [];

  // Grid is centered on `center`, oriented along the unit's facing
  const facingRad = (facingDeg - 90) * (Math.PI / 180);
  const cosF = Math.cos(facingRad);
  const sinF = Math.sin(facingRad);

  // Grid origin: top-left of the grid in local space
  const totalWidth = (cols - 1) * gapX;
  const totalHeight = (rows - 1) * gapY;

  let placed = 0;
  for (let row = 0; row < rows && placed < modelCount; row++) {
    for (let col = 0; col < cols && placed < modelCount; col++) {
      // Local position relative to grid center
      const lx = col * gapX - totalWidth / 2;
      const ly = row * gapY - totalHeight / 2;

      // Rotate to match facing and translate to world
      positions.push({
        x: center.x + lx * cosF - ly * sinF,
        y: center.y + lx * sinF + ly * cosF,
      });
      placed++;
    }
  }

  return positions;
}

/**
 * Calculate positions for the tightest possible cluster formation (hexagonal packing).
 * Models are packed in concentric rings around the center point.
 * Returns world positions for each model.
 */
export function clusterFormation(
  center: Point,
  modelCount: number,
  shape: BaseShape,
): Point[] {
  if (modelCount <= 0) return [];
  if (modelCount === 1) return [{ ...center }];

  const dims = baseShapeDimensionsInches(shape);
  // Use the larger dimension for spacing to avoid any overlap
  const diameter = Math.max(dims.width, dims.height);
  const pad = 0.05; // tight 0.05" gap
  const spacing = diameter + pad;

  // Hexagonal packing: place in concentric rings
  const positions: Point[] = [{ ...center }]; // First model at center

  let ring = 1;
  while (positions.length < modelCount) {
    // Each ring has 6 * ring positions
    const modelsInRing = 6 * ring;
    const ringRadius = spacing * ring;

    for (let i = 0; i < modelsInRing && positions.length < modelCount; i++) {
      const angle = (2 * Math.PI * i) / modelsInRing;
      positions.push({
        x: center.x + Math.cos(angle) * ringRadius,
        y: center.y + Math.sin(angle) * ringRadius,
      });
    }
    ring++;
  }

  return positions;
}
