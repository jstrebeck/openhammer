import { Container, Graphics } from 'pixi.js';
import {
  PIXELS_PER_INCH,
  GRID_LINE_COLOR,
  GRID_MAJOR_COLOR,
} from './constants';

export function drawBoard(parent: Container, widthInches: number, heightInches: number): void {
  const w = widthInches * PIXELS_PER_INCH;
  const h = heightInches * PIXELS_PER_INCH;

  // Board background
  const bg = new Graphics();
  bg.rect(0, 0, w, h);
  bg.fill({ color: 0x1e1e3a });
  bg.label = 'board-bg';
  parent.addChild(bg);

  // Grid lines
  const grid = new Graphics();
  grid.label = 'board-grid';

  for (let x = 0; x <= widthInches; x++) {
    const px = x * PIXELS_PER_INCH;
    const isMajor = x % 6 === 0;
    grid.moveTo(px, 0);
    grid.lineTo(px, h);
    grid.stroke({ color: isMajor ? GRID_MAJOR_COLOR : GRID_LINE_COLOR, width: isMajor ? 1 : 0.5, alpha: isMajor ? 0.6 : 0.25 });
  }

  for (let y = 0; y <= heightInches; y++) {
    const py = y * PIXELS_PER_INCH;
    const isMajor = y % 6 === 0;
    grid.moveTo(0, py);
    grid.lineTo(w, py);
    grid.stroke({ color: isMajor ? GRID_MAJOR_COLOR : GRID_LINE_COLOR, width: isMajor ? 1 : 0.5, alpha: isMajor ? 0.6 : 0.25 });
  }

  parent.addChild(grid);
}
