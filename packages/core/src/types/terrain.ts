import type { Point } from './geometry';

export type TerrainTrait =
  | 'obscuring'
  | 'dense'
  | 'breachable'
  | 'defensible'
  | 'unstable'
  | 'smoke';

export interface TerrainPiece {
  id: string;
  polygon: Point[];       // Vertices defining the terrain footprint (closed polygon)
  height: number;         // Height in inches for LoS purposes
  traits: TerrainTrait[];
  label: string;
}

export const TERRAIN_TRAIT_DESCRIPTIONS: Record<TerrainTrait, string> = {
  obscuring: 'Blocks line of sight through the terrain if the terrain is taller than both models',
  dense: 'Imposes a -1 hit penalty when shooting through this terrain',
  breachable: 'Infantry can move through the walls of this terrain',
  defensible: 'Units in this terrain get +1 to hit in melee when charged',
  unstable: 'Models moving over this terrain risk mortal wounds',
  smoke: 'Temporarily blocks line of sight (typically one turn)',
};
