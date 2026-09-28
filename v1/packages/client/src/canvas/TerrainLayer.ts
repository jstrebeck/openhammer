import { Container, Graphics, Text } from 'pixi.js';
import type { TerrainPiece } from '@openhammer/core';
import { PIXELS_PER_INCH } from './constants';

const TERRAIN_FILL_COLORS: Record<string, number> = {
  obscuring: 0x8b5cf6,
  dense: 0x22c55e,
  defensible: 0xf59e0b,
  default: 0x6b7280,
};

const TERRAIN_FILL_ALPHA = 0.25;
const TERRAIN_STROKE_ALPHA = 0.6;
const TERRAIN_SELECTED_COLOR = 0xfbbf24;

interface TerrainTokenState {
  container: Container;
  fill: Graphics;
  label: Text;
  heightLabel: Text;
  selectionOutline: Graphics;
}

export class TerrainLayer {
  private container: Container;
  private tokens: Map<string, TerrainTokenState> = new Map();

  constructor(parent: Container) {
    this.container = new Container();
    this.container.label = 'terrain-layer';
    parent.addChild(this.container);
  }

  sync(terrain: Record<string, TerrainPiece>, selectedTerrainId: string | null): void {
    // Remove tokens for deleted terrain
    for (const [id, token] of this.tokens) {
      if (!terrain[id]) {
        this.container.removeChild(token.container);
        token.container.destroy({ children: true });
        this.tokens.delete(id);
      }
    }

    // Add or update
    for (const piece of Object.values(terrain)) {
      let token = this.tokens.get(piece.id);
      if (!token) {
        token = this.createToken(piece);
        this.tokens.set(piece.id, token);
      } else {
        this.updateToken(token, piece);
      }
      token.selectionOutline.visible = piece.id === selectedTerrainId;
    }
  }

  /** Hit-test a world-space point against terrain polygons. Returns terrain ID or null. */
  hitTest(worldX: number, worldY: number, terrain: Record<string, TerrainPiece>): string | null {
    // Iterate in reverse for top-most first
    const pieces = Object.values(terrain);
    for (let i = pieces.length - 1; i >= 0; i--) {
      if (pointInPolygonSimple(worldX, worldY, pieces[i].polygon)) {
        return pieces[i].id;
      }
    }
    return null;
  }

  private createToken(piece: TerrainPiece): TerrainTokenState {
    const container = new Container();
    container.label = `terrain-${piece.id}`;

    const color = this.getColor(piece);

    // Selection outline
    const selectionOutline = new Graphics();
    this.drawPolygon(selectionOutline, piece.polygon, {
      fillColor: TERRAIN_SELECTED_COLOR,
      fillAlpha: 0.08,
      strokeColor: TERRAIN_SELECTED_COLOR,
      strokeWidth: 2,
      strokeAlpha: 0.8,
    });
    selectionOutline.visible = false;
    container.addChild(selectionOutline);

    // Fill
    const fill = new Graphics();
    this.drawPolygon(fill, piece.polygon, {
      fillColor: color,
      fillAlpha: TERRAIN_FILL_ALPHA,
      strokeColor: color,
      strokeWidth: 1.5,
      strokeAlpha: TERRAIN_STROKE_ALPHA,
    });
    container.addChild(fill);

    // Center label
    const center = polygonCenter(piece.polygon);
    const label = new Text({
      text: piece.label,
      style: { fontSize: 10, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' },
    });
    label.anchor.set(0.5);
    label.x = center.x * PIXELS_PER_INCH;
    label.y = center.y * PIXELS_PER_INCH;
    label.alpha = 0.7;
    container.addChild(label);

    // Height label (smaller, below main label)
    const heightLabel = new Text({
      text: `${piece.height}"`,
      style: { fontSize: 8, fill: 0xaaaaaa, fontFamily: 'monospace' },
    });
    heightLabel.anchor.set(0.5);
    heightLabel.x = center.x * PIXELS_PER_INCH;
    heightLabel.y = center.y * PIXELS_PER_INCH + 12;
    heightLabel.alpha = 0.6;
    container.addChild(heightLabel);

    this.container.addChild(container);
    return { container, fill, label, heightLabel, selectionOutline };
  }

  private updateToken(token: TerrainTokenState, piece: TerrainPiece): void {
    const color = this.getColor(piece);

    token.fill.clear();
    this.drawPolygon(token.fill, piece.polygon, {
      fillColor: color,
      fillAlpha: TERRAIN_FILL_ALPHA,
      strokeColor: color,
      strokeWidth: 1.5,
      strokeAlpha: TERRAIN_STROKE_ALPHA,
    });

    token.selectionOutline.clear();
    this.drawPolygon(token.selectionOutline, piece.polygon, {
      fillColor: TERRAIN_SELECTED_COLOR,
      fillAlpha: 0.08,
      strokeColor: TERRAIN_SELECTED_COLOR,
      strokeWidth: 2,
      strokeAlpha: 0.8,
    });

    const center = polygonCenter(piece.polygon);
    token.label.text = piece.label;
    token.label.x = center.x * PIXELS_PER_INCH;
    token.label.y = center.y * PIXELS_PER_INCH;
    token.heightLabel.text = `${piece.height}"`;
    token.heightLabel.x = center.x * PIXELS_PER_INCH;
    token.heightLabel.y = center.y * PIXELS_PER_INCH + 12;
  }

  private drawPolygon(
    g: Graphics,
    polygon: { x: number; y: number }[],
    opts: { fillColor: number; fillAlpha: number; strokeColor: number; strokeWidth: number; strokeAlpha: number },
  ): void {
    if (polygon.length < 3) return;
    const flat = polygon.flatMap((p) => [p.x * PIXELS_PER_INCH, p.y * PIXELS_PER_INCH]);
    g.poly(flat, true);
    g.fill({ color: opts.fillColor, alpha: opts.fillAlpha });
    g.stroke({ color: opts.strokeColor, width: opts.strokeWidth, alpha: opts.strokeAlpha });
  }

  private getColor(piece: TerrainPiece): number {
    for (const trait of piece.traits) {
      if (trait in TERRAIN_FILL_COLORS) return TERRAIN_FILL_COLORS[trait];
    }
    return TERRAIN_FILL_COLORS.default;
  }
}

function polygonCenter(polygon: { x: number; y: number }[]): { x: number; y: number } {
  let cx = 0, cy = 0;
  for (const p of polygon) {
    cx += p.x;
    cy += p.y;
  }
  return { x: cx / polygon.length, y: cy / polygon.length };
}

function pointInPolygonSimple(px: number, py: number, polygon: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
