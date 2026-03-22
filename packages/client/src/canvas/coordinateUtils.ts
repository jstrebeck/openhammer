import type { Point, BaseShape } from '@openhammer/core';
import { baseShapeDimensionsInches } from '@openhammer/core';
import { PIXELS_PER_INCH } from './constants';

/** Convert game-space inches to screen pixels */
export function toScreen(point: Point): { x: number; y: number } {
  return {
    x: point.x * PIXELS_PER_INCH,
    y: point.y * PIXELS_PER_INCH,
  };
}

/** Convert screen pixels to game-space inches */
export function toWorld(screenX: number, screenY: number): Point {
  return {
    x: screenX / PIXELS_PER_INCH,
    y: screenY / PIXELS_PER_INCH,
  };
}

/** Convert base size in inches to screen pixel radius */
export function baseRadiusToPixels(baseSizeInches: number): number {
  return (baseSizeInches / 2) * PIXELS_PER_INCH;
}

/** Convert a BaseShape to pixel dimensions (width × height) */
export function baseShapeToPixels(shape: BaseShape): { width: number; height: number } {
  const dims = baseShapeDimensionsInches(shape);
  return {
    width: dims.width * PIXELS_PER_INCH,
    height: dims.height * PIXELS_PER_INCH,
  };
}
