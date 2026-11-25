import { Actor, BoxBody, FilledPolygon, FilledRoundedBox, Scene, TextSprite, ZIndex } from "jetlag2d";

/**
 * Pools of the game engine's actors that draw the editor. The engine never
 * really deletes an actor, so a screen that is drawn again at every change
 * reuses the same actors: a pool hands them out in order, and hides the ones
 * that were not needed this time. One pool draws boxes with text, the other
 * draws filled shapes. Everything is measured in meters.
 */

/** The font that every piece of text uses (needs Arimo-Regular.ttf in the assets) */
export const FONT = "Arimo Regular";

/** How to draw one rectangle with some text on it.  Everything is in meters. */
export interface Look {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Colors are "#rrggbb" or "#rrggbbaa".  With no fill the box is invisible, which is how plain text is drawn. */
  fill?: string;
  line?: string;
  lineWidth?: number;
  radius?: number;
  boxZ?: ZIndex;
  text?: string;
  textColor?: string;
  textSize?: number;
  textZ?: ZIndex;
}

/** An actor that can be shown anywhere, as a box with text on it */
interface BoxPiece {
  actor: Actor;
  box: FilledRoundedBox;
  text: TextSprite;
  label: { value: string };
  shown: boolean;
}

/** A fully transparent color: how a box with no fill or line is drawn */
const CLEAR = "#00000000";

/**
 * The bookkeeping that the two pools share: after `begin()`, pieces are handed
 * out in order, and `end()` hides the ones that were not handed out. A pool
 * never deletes a piece, because the engine never really deletes an actor.
 */
abstract class Pool<P extends { actor: Actor; shown: boolean }> {
  private pieces: P[] = [];
  private used = 0;

  constructor(protected scene: Scene) { }

  /** Make a new piece, shown and waiting to be drawn on. */
  protected abstract make(): P;

  /** Start a drawing: every piece is available again. */
  begin() {
    this.used = 0;
  }

  /** The next piece to draw on: one that is already made, or a new one */
  protected take(): P {
    const piece = (this.pieces[this.used] ??= this.make());
    this.used++;
    return piece;
  }

  /** Show a piece that was hidden */
  protected show(piece: P) {
    if (!piece.shown) {
      piece.actor.enabled = true;
      piece.shown = true;
    }
  }

  /** Hide every piece that was not drawn since `begin()` */
  end() {
    for (let i = this.used; i < this.pieces.length; i++) {
      const piece = this.pieces[i];
      if (piece.shown) {
        piece.actor.enabled = false;
        piece.shown = false;
      }
    }
  }
}

/**
 * A screen that is redrawn whenever anything changes needs a pool.  JetLag
 * never really deletes an actor (it only disables it), so making new ones for
 * every redraw would pile up forever.  Instead, a pool hands out the same few
 * pieces again: `begin()`, then `draw()` for each thing to show, then `end()`,
 * which hides the pieces that were not needed this time.
 */
export class PiecePool extends Pool<BoxPiece> {
  /** A new rounded box with a text sprite on it, kept far off screen until it is first drawn. */
  protected make(): BoxPiece {
    const label = { value: "" };
    const box = new FilledRoundedBox({ width: 1, height: 1, radius: 0.1, fillColor: CLEAR, lineWidth: 0.02, lineColor: CLEAR });
    const text = new TextSprite({ center: true, face: FONT, size: 20, color: "#ffffff", z: 2 }, () => label.value);
    const actor = new Actor({
      appearance: [box, text],
      rigidBody: new BoxBody({ cx: -50, cy: -50, width: 0.1, height: 0.1 }, { scene: this.scene }),
    });
    return { actor, box, text, label, shown: true };
  }

  /** Show one box with text, where and how `look` says */
  draw(look: Look) {
    const piece = this.take();
    const { box, text } = piece;
    box.width = look.w;
    box.height = look.h;
    box.radius = look.radius ?? Math.min(0.1, look.h / 2);
    box.fillColor = look.fill ?? CLEAR;
    box.lineWidth = look.lineWidth ?? 0.02;
    box.lineColor = look.line ?? CLEAR;
    box.z = look.boxZ ?? 0;
    piece.label.value = look.text ?? "";
    // changing these rebuilds the text's style, so only do it when they differ
    const color = look.textColor ?? "#ffffff";
    if (text.color !== color) text.color = color;
    const size = look.textSize ?? 20;
    if (text.size !== size) text.size = size;
    text.z = look.textZ ?? 2;
    piece.actor.rigidBody.setCenter(look.x + look.w / 2, look.y + look.h / 2);
    this.show(piece);
  }
}

/** How to draw one filled shape with any outline, concave ones included. Everything is in meters. */
export interface ShapeLook {
  points: { x: number; y: number }[];
  fill?: string;
  line?: string;
  lineWidth?: number;
  z?: ZIndex;
}

/** One polygon actor in a `ShapePool`, and whether it is showing. */
interface ShapePiece {
  actor: Actor;
  polygon: FilledPolygon;
  shown: boolean;
}

/**
 * Like PiecePool, but its pieces are polygons, so one block can be drawn as one shape (a C-shaped block has a notch, which
 * is not a rectangle). A polygon's points are relative to its actor's centre, so each draw puts the centre in the middle of the
 * shape's bounds. Pixi fills a concave polygon, which Box2D would not accept, but nothing here is physical.
 */
export class ShapePool extends Pool<ShapePiece> {
  /** A new polygon actor, kept far off screen until it is first drawn. */
  protected make(): ShapePiece {
    const polygon = new FilledPolygon({ vertices: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0, y: 0.5 }], fillColor: CLEAR, lineWidth: 0.02, lineColor: CLEAR });
    // a big body, so that a big shape is not skipped when its middle is just off screen (the body decides what counts as "on screen")
    const actor = new Actor({ appearance: [polygon], rigidBody: new BoxBody({ cx: -50, cy: -50, width: 20, height: 20 }, { scene: this.scene }) });
    return { actor, polygon, shown: true };
  }

  /** Show one filled shape, where and how `look` says. */
  draw(look: ShapeLook) {
    const piece = this.take();
    const xs = look.points.map((p) => p.x);
    const ys = look.points.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const { polygon } = piece;
    polygon.vertices = look.points.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    polygon.width = Math.max(...xs) - Math.min(...xs);
    polygon.height = Math.max(...ys) - Math.min(...ys);
    polygon.fillColor = look.fill ?? CLEAR;
    polygon.lineWidth = look.lineWidth ?? 0.02;
    polygon.lineColor = look.line ?? CLEAR;
    polygon.z = look.z ?? 0;
    piece.actor.rigidBody.setCenter(cx, cy);
    this.show(piece);
  }
}
