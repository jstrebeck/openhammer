import { Container, Graphics, Text } from 'pixi.js';
import type { ObjectiveMarker, Player } from '@openhammer/core';
import { PIXELS_PER_INCH } from './constants';

const OBJECTIVE_RADIUS = 1.5; // inches (3" diameter control range marker)
const OBJECTIVE_COLOR = 0xfbbf24;

interface ObjToken {
  container: Container;
  ring: Graphics;
  numberText: Text;
  labelText: Text;
}

export class ObjectiveLayer {
  private container: Container;
  private tokens: Map<string, ObjToken> = new Map();

  constructor(parent: Container) {
    this.container = new Container();
    this.container.label = 'objective-layer';
    parent.addChild(this.container);
  }

  sync(objectives: Record<string, ObjectiveMarker>, players: Record<string, Player>): void {
    for (const [id, token] of this.tokens) {
      if (!objectives[id]) {
        this.container.removeChild(token.container);
        token.container.destroy({ children: true });
        this.tokens.delete(id);
      }
    }

    for (const obj of Object.values(objectives)) {
      let token = this.tokens.get(obj.id);
      if (!token) {
        token = this.createToken(obj, players);
        this.tokens.set(obj.id, token);
      } else {
        this.updateToken(token, obj, players);
      }
    }
  }

  private createToken(obj: ObjectiveMarker, players: Record<string, Player>): ObjToken {
    const container = new Container();
    container.label = `obj-${obj.id}`;

    const px = obj.position.x * PIXELS_PER_INCH;
    const py = obj.position.y * PIXELS_PER_INCH;
    const r = OBJECTIVE_RADIUS * PIXELS_PER_INCH;

    const controlColor = obj.controllingPlayerId
      ? parseInt((players[obj.controllingPlayerId]?.color ?? '#fbbf24').replace('#', ''), 16)
      : OBJECTIVE_COLOR;

    const ring = new Graphics();
    ring.circle(px, py, r);
    ring.fill({ color: controlColor, alpha: 0.06 });
    ring.stroke({ color: controlColor, width: 2, alpha: 0.5 });
    // Inner dot
    ring.circle(px, py, 4);
    ring.fill({ color: controlColor, alpha: 0.8 });
    container.addChild(ring);

    const numberText = new Text({
      text: String(obj.number),
      style: { fontSize: 14, fill: 0xffffff, fontFamily: 'monospace', fontWeight: 'bold' },
    });
    numberText.anchor.set(0.5);
    numberText.x = px;
    numberText.y = py - 10;
    container.addChild(numberText);

    const labelText = new Text({
      text: obj.label ?? '',
      style: { fontSize: 8, fill: 0xaaaaaa, fontFamily: 'monospace' },
    });
    labelText.anchor.set(0.5);
    labelText.x = px;
    labelText.y = py + r + 8;
    labelText.visible = !!obj.label;
    container.addChild(labelText);

    this.container.addChild(container);
    return { container, ring, numberText, labelText };
  }

  private updateToken(token: ObjToken, obj: ObjectiveMarker, players: Record<string, Player>): void {
    const px = obj.position.x * PIXELS_PER_INCH;
    const py = obj.position.y * PIXELS_PER_INCH;
    const r = OBJECTIVE_RADIUS * PIXELS_PER_INCH;

    const controlColor = obj.controllingPlayerId
      ? parseInt((players[obj.controllingPlayerId]?.color ?? '#fbbf24').replace('#', ''), 16)
      : OBJECTIVE_COLOR;

    token.ring.clear();
    token.ring.circle(px, py, r);
    token.ring.fill({ color: controlColor, alpha: 0.06 });
    token.ring.stroke({ color: controlColor, width: 2, alpha: 0.5 });
    token.ring.circle(px, py, 4);
    token.ring.fill({ color: controlColor, alpha: 0.8 });

    token.numberText.text = String(obj.number);
    token.numberText.x = px;
    token.numberText.y = py - 10;

    token.labelText.text = obj.label ?? '';
    token.labelText.x = px;
    token.labelText.y = py + r + 8;
    token.labelText.visible = !!obj.label;
  }
}
