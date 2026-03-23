import type { Point } from '../types/geometry';
import type { TerrainTrait, TerrainType } from '../types/terrain';

export interface TerrainTemplate {
  name: string;
  polygon: Point[];       // Vertices at origin — caller offsets to placement position
  height: number;
  traits: TerrainTrait[];
  terrainType?: TerrainType;
}

/** Create a rectangle polygon centered at origin */
function rect(w: number, h: number): Point[] {
  const hw = w / 2;
  const hh = h / 2;
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];
}

/** Create an approximate ellipse polygon centered at origin */
function ellipse(rx: number, ry: number, segments = 12): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (2 * Math.PI * i) / segments;
    points.push({
      x: Math.cos(angle) * rx,
      y: Math.sin(angle) * ry,
    });
  }
  return points;
}

/** Create an L-shaped ruin polygon centered roughly at origin */
function lShape(w: number, h: number, thickness: number): Point[] {
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 + thickness },
    { x: -w / 2 + thickness, y: -h / 2 + thickness },
    { x: -w / 2 + thickness, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
}

export const TERRAIN_TEMPLATES: TerrainTemplate[] = [
  {
    name: 'Ruins (Small)',
    polygon: rect(6, 4),
    height: 5,
    traits: ['obscuring', 'breachable', 'defensible', 'ruins'],
    terrainType: 'area_terrain',
  },
  {
    name: 'Ruins (Large)',
    polygon: rect(10, 6),
    height: 8,
    traits: ['obscuring', 'breachable', 'defensible', 'ruins'],
    terrainType: 'area_terrain',
  },
  {
    name: 'Ruins (L-Shaped)',
    polygon: lShape(8, 6, 3),
    height: 6,
    traits: ['obscuring', 'breachable', 'defensible', 'ruins'],
    terrainType: 'area_terrain',
  },
  {
    name: 'Forest (Small)',
    polygon: ellipse(4, 3),
    height: 3,
    traits: ['dense', 'breachable'],
    terrainType: 'area_terrain',
  },
  {
    name: 'Forest (Large)',
    polygon: ellipse(6, 5),
    height: 3,
    traits: ['dense', 'breachable'],
    terrainType: 'area_terrain',
  },
  {
    name: 'Crate Stack',
    polygon: rect(3, 3),
    height: 3,
    traits: ['obscuring'],
    terrainType: 'obstacle',
  },
  {
    name: 'Barricade',
    polygon: rect(6, 1),
    height: 2,
    traits: ['defensible'],
    terrainType: 'obstacle',
  },
  {
    name: 'Hill',
    polygon: ellipse(5, 4),
    height: 2,
    traits: [],
    terrainType: 'hill',
  },
  // Sprint M: Additional terrain types
  {
    name: 'Crater',
    polygon: ellipse(3, 3),
    height: 0,
    traits: [],
    terrainType: 'area_terrain',
  },
  {
    name: 'Rubble',
    polygon: rect(4, 3),
    height: 1,
    traits: [],
    terrainType: 'area_terrain',
  },
  {
    name: 'Battlefield Debris',
    polygon: rect(5, 2),
    height: 2,
    traits: [],
    terrainType: 'obstacle',
  },
  {
    name: 'Woods (Small)',
    polygon: ellipse(4, 3),
    height: 3,
    traits: ['dense', 'breachable'],
    terrainType: 'area_terrain',
  },
  {
    name: 'Woods (Large)',
    polygon: ellipse(7, 5),
    height: 3,
    traits: ['dense', 'breachable'],
    terrainType: 'area_terrain',
  },
];

/** Offset a template polygon to a given center position */
export function offsetPolygon(polygon: Point[], center: Point): Point[] {
  return polygon.map((p) => ({ x: p.x + center.x, y: p.y + center.y }));
}
