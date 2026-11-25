import { Actor, BoxBody, FilledBox, TextSprite, stage } from "jetlag2d";
import { moveScript } from "../../language/edit";
import { type Measure, type ProgramLayout, type Rect, hit, layoutProgram, metricsForTouch } from "../layout";
import { FONT, PiecePool, ShapePool } from "../pool";
import { type EdgeZone, edgeScrollSpeed, edgeScrolled, isStale } from "../rules";
import { createActions } from "./actions";
import { draw } from "./draw";
import { EDGE_SPEED, EDGE_ZONE, MIN_TARGET_PX, PROBLEM_REVEAL, ROOM_BELOW, SCREEN, TEXT_SIZE, VIEW_BOTTOM, VIEW_TOP, WORK, inWorkspace, zIndex } from "./geometry";
import { NO_GESTURE, carryingPointer, giveUp, movedTo, scriptMoveTarget, startedFrom } from "./gesture";
import { hotspotAt } from "./panels";
import { createPointerHandlers, retarget } from "./pointer";
import type { EditorContext, EditorHost, EditorState, RevealHow } from "./types";

/**
 * The block editor: it draws the program as blocks on the left of the screen,
 * with the palette, the toolbar and the status bar around them, and turns what
 * the person does into changes to the program. It works out exactly what is
 * under a finger or the mouse, since the game engine only does a loose test on
 * the one invisible actor that takes touches. It never changes the program
 * itself: every edit is handed to the host as a new program.
 */

export { PALETTE_W, SCREEN, STATUS_H, TOOLBAR_H, VIEW_LEFT } from "./geometry";
export { hudPageRect } from "./page";
export type { EditorHost, ToolbarButton } from "./types";

/**
 * The block editor.  It draws a program as blocks (with actors, using
 * the block layout to say where everything goes) and turns what the user does into
 * calls to `host.change`.  JetLag decides which actor receives a touch with
 * a loose box test, so only one invisible actor takes touches; this code works
 * out exactly what was under the finger.
 *
 * The workspace is the world scene, which scrolls by moving the camera.  The
 * palette, toolbar and status bar are on the HUD, over it.
 *
 * Where the mode allows scripts, a script's header can be used: tap a named
 * script's name or inputs to edit them, tap its x to remove it, drag the header
 * to move the script, and tap "+ new script" in the palette to add one. In the
 * other modes a header is only a label, and dragging it scrolls.
 *
 * A drag or a script move works on a copy of the program, and is given up if
 * the host's program changes before it ends (the assistant answered, or Undo
 * was pressed): the change that came in is kept, and what was being carried
 * goes back.
 *
 * @param host The page the editor is in.
 */
export function createEditor(host: EditorHost) {
  const pools = { world: new PiecePool(stage.world), worldShapes: new ShapePool(stage.world), hud: new PiecePool(stage.hud), hudShapes: new ShapePool(stage.hud) };
  const st: EditorState = {
    scrollY: 0,
    category: "shapes",
    gesture: NO_GESTURE,
    hotspots: [],
    layout: { blocks: [], scripts: [], dropPoints: [], top: WORK.y, bottom: WORK.y },
    lastProblem: undefined,
  };

  // ---- measuring text ----
  /** A piece of text that is only used to measure how wide other text is on screen. */
  const sample = new TextSprite({ center: true, face: FONT, size: TEXT_SIZE, color: "#ffffff" }, "");
  /** The widths measured so far, by text. They change when the window is resized. */
  const textWidths = new Map<string, number>();
  /** How wide text is on screen, in meters. */
  const measure: Measure = (text) => {
    let w = textWidths.get(text);
    if (w === undefined) {
      w = sample.dims(stage.hud.camera, text).width;
      textWidths.set(text, w);
    }
    return w;
  };

  // ---- scrolling ----

  /**
   * The least the workspace can scroll: zero, or less when something (a script's
   * header, above its first block) reaches above the top of the view.
   */
  const minScroll = () => Math.min(0, st.layout.top - VIEW_TOP - 0.2);
  /** The most that the workspace can scroll */
  const maxScroll = () => Math.max(0, st.layout.bottom + ROOM_BELOW - VIEW_BOTTOM);
  /** Scroll the workspace to this position, kept within its limits, and move the camera. */
  const setScroll = (v: number) => {
    st.scrollY = Math.min(Math.max(minScroll(), v), maxScroll());
    stage.world.camera.setCenter({ x: SCREEN.w / 2, y: SCREEN.h / 2 + st.scrollY });
  };

  // ---- laying out and drawing ----

  /**
   * Lay out the workspace: the program, or the program without what is being
   * carried, or with the script that is being moved where it has been put.
   */
  function relayout() {
    const g = st.gesture;
    const shown = g.kind === "carrying" ? g.drag.programWithout : g.kind === "movingScript" ? moveScript(g.move.programWithPlaces, g.move.scriptId, g.move.to) : host.program();
    st.layout = layoutProgram(shown, { x: WORK.x, y: WORK.y, width: WORK.width, measure, mode: host.mode?.(), metrics: metricsForTouch(minTarget()) });
    setScroll(st.scrollY);
  }

  /** Lay out, work out where carried blocks would land, and draw everything */
  function render() {
    relayout();
    retarget(ctx);
    draw(ctx);
  }

  /**
   * Scroll the workspace so that a rectangle in it is in sight, if it is not:
   * it is out of sight when it is nearer than `margin` to the top or bottom of
   * the view. When it has to move, it is put `lead` meters below the top.
   *
   * @param r The rectangle, in the workspace.
   * @param how The room to leave above and below it, and where it goes.
   */
  function reveal(r: Rect, how: RevealHow) {
    if (r.y >= st.scrollY + VIEW_TOP + how.margin.top && r.y + r.h <= st.scrollY + VIEW_BOTTOM - how.margin.bottom) return;
    setScroll(r.y - VIEW_TOP - how.lead);
    render();
  }

  /** Where the edge zones are, for carrying the view along with a drag */
  const edgeZone: EdgeZone = { top: VIEW_TOP, bottom: VIEW_BOTTOM, depth: EDGE_ZONE, maxSpeed: EDGE_SPEED };

  /**
   * Carry the view along with blocks or a script that are being carried near
   * the top or bottom edge of the workspace. It runs once a frame, and scrolls
   * by the speed for where the pointer is times the time since the last frame,
   * so it scrolls at the same speed on any device and goes on while the pointer
   * is held still. What is carried stays under the pointer, and a script that
   * is being moved follows the scroll.
   *
   * @param seconds The time since the last frame.
   */
  function edgeScrollTick(seconds: number) {
    const g = st.gesture;
    const pointer = carryingPointer(g);
    if (!pointer) return;
    const scrolled = edgeScrolled(st.scrollY, edgeScrollSpeed(pointer.y, edgeZone), seconds, minScroll(), maxScroll());
    if (scrolled === st.scrollY) return;
    setScroll(scrolled);
    if (g.kind === "movingScript") st.gesture = movedTo(g, scriptMoveTarget(g.move, g.press, pointer, st.scrollY), pointer);
    render();
  }

  /**
   * The smallest size, in meters, that a thing to touch is given: `MIN_TARGET_PX`
   * pixels, at the size the screen is drawn at now.
   */
  function minTarget(): number {
    const canvas = stage.renderer.pixi.canvas as HTMLCanvasElement;
    const pixelsPerMeter = canvas.getBoundingClientRect().width / SCREEN.w;
    return pixelsPerMeter > 0 ? MIN_TARGET_PX / pixelsPerMeter : 0;
  }

  const ctx: EditorContext = { host, st, pools, measure, render, setScroll, minTarget, reveal };
  const actions = createActions(ctx);
  const pointer = createPointerHandlers(ctx, actions);
  // once a frame, with the seconds since the last one
  stage.hud.repeatEvents.push(edgeScrollTick);

  // The window changed size, so the text sizes measured so far are out of date: measure again and
  // draw.
  window.addEventListener("resize", () => {
    textWidths.clear();
    sample.size = TEXT_SIZE; // rebuilds the style for the new window size
    render();
  });

  new Actor({
    appearance: new FilledBox({ width: SCREEN.w, height: SCREEN.h, fillColor: "#00000000", z: zIndex(-4) }),
    rigidBody: new BoxBody({ cx: SCREEN.w / 2, cy: SCREEN.h / 2, width: SCREEN.w, height: SCREEN.h }, { scene: stage.hud }),
    // The one invisible actor takes every touch and passes it on, since it is this code, not the
    // engine, that works out what was touched.
    gestures: {
      onTouchDown: (_a, p) => (pointer.onDown(p), true),
      onPanStart: (_a, p) => (pointer.onPanStart(p), true),
      onPanMove: (_a, p) => (pointer.onPanMove(p), true),
      onPanStop: (_a, p) => (pointer.onPanStop(p), true),
      onTouchUp: (_a, p) => (pointer.onUp(p), true),
    },
  });

  // JetLag has no mouse wheel, so the workspace scrolls with the page's own wheel event
  const canvas = stage.renderer.pixi.canvas as HTMLCanvasElement;
  // The mouse wheel scrolls the workspace when the pointer is over it.
  canvas.addEventListener(
    "wheel",
    (e) => {
      const r = canvas.getBoundingClientRect();
      const perMeter = r.width / SCREEN.w;
      const at = { x: (e.clientX - r.left) / perMeter, y: (e.clientY - r.top) / perMeter };
      if (!inWorkspace(at)) return;
      e.preventDefault();
      setScroll(st.scrollY + (e.deltaY * (e.deltaMode === 1 ? 16 : 1)) / perMeter);
      render();
    },
    { passive: false },
  );

  return {
    /**
     * Where everything is, as of the last drawing: the layout, the scroll, the
     * palette tab, and the hotspots outside the workspace; and what a touch at a
     * point would find, in the workspace (`hitAt`, in workspace meters) and
     * outside it (`hotspotAt`, in screen meters).
     */
    state: () => ({ hitAt: (x: number, y: number) => hit(st.layout, x, y, minTarget()), hotspotAt: (x: number, y: number) => hotspotAt(st.hotspots, x, y, minTarget())?.touched, layout: st.layout as ProgramLayout, scrollY: st.scrollY, category: st.category, hotspots: st.hotspots.map((r) => ({ rect: r.rect, touched: r.touched })), buttons: st.hotspots.filter((r) => r.touched.kind === "button").map((r) => r.rect) }),
    /**
     * The program, the problem or the status changed: draw again. A drag or a
     * script move that started from a program that is no longer the host's is
     * given up first, so that it cannot be dropped over the change.
     */
    update() {
      if (isStale(startedFrom(st.gesture), host.program())) st.gesture = giveUp();
      render();
      // show the block that has a problem, if it is a new one
      const problem = host.problem();
      const id = problem?.blockId;
      if (id && id !== st.lastProblem) {
        const b = st.layout.blocks.find((x) => x.block.id === id);
        if (b) reveal(b.bounds, PROBLEM_REVEAL);
      }
      st.lastProblem = id;
    },
  };
}
