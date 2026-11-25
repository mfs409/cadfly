import { type Scene, stage } from "jetlag2d";
import type { PageRect } from "../dom";
import type { Rect } from "../layout";

/**
 * Where things in the game engine's scenes are on the page, in CSS pixels, so
 * that page elements (a field to type in, a pop-up) can be put over them.
 */

/**
 * Where a rectangle on a scene (in meters) is on the page, in CSS pixels.
 *
 * @param scene The scene the rectangle is in: the HUD, or the scrolling workspace.
 * @param r The rectangle.
 */
export function pageRect(scene: Scene, r: Rect): PageRect {
  const camera = scene.camera;
  const box = (stage.renderer.pixi.canvas as HTMLCanvasElement).getBoundingClientRect();
  const topLeft = camera.metersToScreen({ x: r.x, y: r.y });
  return { left: box.left + topLeft.x, top: box.top + topLeft.y, width: r.w * camera.scale, height: r.h * camera.scale };
}

/** Where a rectangle on the HUD (meters) is on the page, in CSS pixels */
export const hudPageRect = (r: Rect) => pageRect(stage.hud, r);
