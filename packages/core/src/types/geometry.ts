/** All distances are in inches (the game's native unit). */
export interface Vec2 {
  x: number;
  y: number;
}

/** z is height above the battlefield surface, in inches. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Closed polygon in board space (footprints of terrain, deployment zones). */
export type Polygon = Vec2[];

export interface Circle {
  center: Vec2;
  radius: number;
}

export interface Segment {
  a: Vec2;
  b: Vec2;
}
