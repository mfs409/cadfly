import { stage } from "jetlag2d";
import type { Problem } from "../language/types";
import type { RunSnapshot } from "../snapshot";
import { PALETTE_W, SCREEN, STATUS_H, TOOLBAR_H, VIEW_LEFT } from "../ui/editor";
import { el } from "../ui/dom";
import { createGizmo } from "../ui/view/gizmo";
import { readoutText, showOverlays } from "../ui/view/show";
import { Viewer } from "../ui/view/viewer";

/**
 * The 3D view of the result: a page element laid over the right-hand part of
 * the game engine's canvas, with the readout of how big the result is, the Fit
 * button and the axes. It shows a build's result, keeps what is drawn when a
 * later build fails, and frames the model when the first shape appears.
 */

/** What the 3D view offers. */
export interface View3d {
  /** The page element the 3D view is drawn in */
  element: HTMLElement;
  /**
   * Show the result of a build: the readout, the corners and faces, and the
   * shapes. A result that made no shapes because of a problem does not replace
   * the shapes on screen (a typo that makes everything fail should not blank
   * the view).
   *
   * @param result What the build gave.
   * @param problem What is wrong with the program, if anything.
   * @returns True if the shapes of the result are now on screen.
   */
  show(result: RunSnapshot, problem: Problem | undefined): boolean;
  /** Frame the model again when the next shape appears (the program was replaced). */
  reframe(): void;
  /**
   * Put the 3D view, the assistant's bar and the message box where they belong
   * over the canvas. It is to be called on every frame, since the canvas
   * follows the window.
   *
   * @param bar The assistant's bar, if there is one.
   * @param barHeight How tall the bar is now (px): more when its conversation is open.
   * @param toast The message box, if there is one.
   */
  place(bar: HTMLElement | undefined, barHeight: number, toast: HTMLElement | undefined): void;
}

/**
 * Make the 3D view. It is added to the page, and it is placed by `place`.
 */
export function createView3d(): View3d {
  // the page is exactly the window: the canvas, the 3D view and the assistant's bar are all placed over it, so it never scrolls
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  /** The element the 3D view is drawn in. It is placed over the right-hand part of the canvas. */
  const holder = el("div", "position:fixed;overflow:hidden");
  document.body.appendChild(holder);
  const viewer = new Viewer(holder);
  /** How big the result is, so it can be checked against what was asked for (the AI can be sure and wrong) */
  const readout = el("div", "position:absolute;left:8px;top:8px;padding:4px 8px;border-radius:6px;background:rgba(20,27,45,.82);color:#e6ebf5;font:12px/1.4 monospace;pointer-events:none;white-space:pre");
  holder.appendChild(readout);
  /** "Fit" frames the model: it belongs with the view, next to the axes gizmo, not in the toolbar */
  const fitButton = el("button", "position:absolute;right:10px;bottom:10px;padding:5px 12px;border:1px solid #00000030;border-radius:6px;background:rgba(20,27,45,.82);color:#e6ebf5;font:13px sans-serif;cursor:pointer", "Fit");
  fitButton.title = "Frame the whole model in the view";
  fitButton.onclick = () => viewer.fitToView();
  holder.appendChild(fitButton);
  createGizmo(viewer);
  /**
   * Has the view been framed around the current model? It is framed once, when
   * the first shape appears, and again after the program is replaced.
   */
  let framed = false;

  return {
    element: holder,
    show(result, problem) {
      const shown = result.shapes.length > 0 || !problem;
      if (shown) {
        const text = readoutText(result);
        readout.style.display = text === undefined ? "none" : "";
        if (text !== undefined) readout.textContent = text;
      }
      showOverlays(viewer, result, problem);
      if (shown) viewer.setShapes(result.shapes); // a snapshot's shapes have what a ShapeDisplay needs (and an id and a name besides)
      if (result.shapes.length && !framed) {
        viewer.fitToView();
        framed = true;
      } else if (!result.shapes.length && !problem) {
        framed = false;
      }
      return shown;
    },
    reframe() {
      framed = false;
    },
    place(bar, barHeight, toast) {
      const canvas = stage.renderer.pixi.canvas as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      const perMeter = box.width / SCREEN.w;
      const px = (v: number) => `${Math.round(v)}px`;
      const height = SCREEN.h * perMeter;
      holder.style.left = px(box.left + VIEW_LEFT * perMeter);
      // the toolbar runs across the whole top, so the 3D view starts under it
      const toolbar = TOOLBAR_H * perMeter;
      holder.style.top = px(box.top + toolbar);
      holder.style.width = px((SCREEN.w - VIEW_LEFT) * perMeter);
      // the 3D view takes the room between the toolbar and the assistant's bar along the bottom
      const status = STATUS_H * perMeter;
      holder.style.height = px(height - toolbar - status);
      if (bar) {
        // the assistant's bar runs across the whole bottom; when its conversation is open it grows upward over the rest
        bar.style.left = px(box.left);
        bar.style.width = px(box.width);
        bar.style.top = px(box.top + height - Math.max(status, barHeight));
        bar.style.height = px(Math.max(status, barHeight));
      }
      if (toast) {
        // messages about the program sit at the bottom of the workspace, above the bar
        toast.style.left = px(box.left + (PALETTE_W + 0.25) * perMeter);
        toast.style.bottom = px(window.innerHeight - (box.top + height - status) + 8);
        toast.style.maxWidth = px((VIEW_LEFT - PALETTE_W - 0.5) * perMeter);
      }
    },
  };
}
