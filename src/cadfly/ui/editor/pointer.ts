import { commandById } from "../../language/commands";
import { createBlock, dropBlocks as dropIntoProgram, insertBlocks, moveScript, takeBlock } from "../../language/edit";
import { findBlock } from "../../language/program";
import type { Point, Program } from "../../language/types";
import { type Hit, hit } from "../layout";
import { allowsScripts } from "../modes";
import { dropPlan, isStale, movedEnough } from "../rules";
import type { Actions } from "./actions";
import { PALETTE_GRAB, SNAP, WORK, inWorkspace, overPalette } from "./geometry";
import { hotspotAt } from "./panels";
import {
  type Gesture,
  aimedAt,
  beginCarrying,
  beginMoving,
  carriedTo,
  giveUp,
  markMoved,
  movedTo,
  panScrollTarget,
  release,
  scriptMoveTarget,
  scrollsWorkspace,
  startPress,
} from "./gesture";
import type { Drag, EditorContext, Move, Touched } from "./types";

/**
 * What the finger or the mouse does: going down, moving far enough to be a
 * drag, carrying blocks or a script about, and coming up. It decides what each
 * of those means from the gesture in progress, keeps the gesture's state, and
 * hands taps on.
 */

/** The kinds of hit that are on a script's header: a drag that starts on any of them moves the script */
const HEADER_HITS = new Set<Hit["kind"]>(["scriptFold", "scriptName", "scriptInputs", "scriptRemove", "scriptHeader"]);

/** The handlers for the engine's gestures */
export interface PointerHandlers {
  /** A finger or the mouse went down at `p`. */
  onDown(p: Point): void;
  /** The pointer moved far enough from where it went down to be a drag. */
  onPanStart(p: Point): void;
  /** The pointer moved during a drag. */
  onPanMove(p: Point): void;
  /** The drag ended. */
  onPanStop(p: Point): void;
  /** The finger or mouse came up. */
  onUp(p: Point): void;
}

/**
 * Work out where the carried blocks would land if they were dropped now, and
 * note it in the gesture: on the nearest drop point that takes them, in open
 * space if they may start a script, or nowhere. Does nothing when nothing is
 * being carried.
 *
 * @param ctx The editor.
 */
export function retarget(ctx: EditorContext) {
  const { st, host } = ctx;
  const g = st.gesture;
  if (g.kind !== "carrying") return;
  const d = g.drag;
  const corner = { x: d.pointer.x + d.grabOffset.dx, y: d.pointer.y + d.grabOffset.dy + st.scrollY };
  // near nothing to join, a drop in the workspace starts a global script of its own, right there, if that is allowed; otherwise the blocks go back
  st.gesture = aimedAt(g, dropPlan(st.layout, d.programWithout, d.blocks, corner, inWorkspace(d.pointer), WORK, host.mode?.(), SNAP));
}

/**
 * The handlers for one editor's gestures.
 *
 * @param ctx The editor.
 * @param actions What a tap does.
 */
export function createPointerHandlers(ctx: EditorContext, actions: Actions): PointerHandlers {
  const { host, st } = ctx;

  /**
   * Find what a touch landed on: a button, a tab or a palette block, something
   * in the workspace, or nothing.
   *
   * @param p Where the touch is on the screen.
   */
  function classify(p: Point): Touched {
    const min = ctx.minTarget();
    const hotspot = hotspotAt(st.hotspots, p.x, p.y, min);
    if (hotspot) return hotspot.touched;
    if (inWorkspace(p)) {
      const h = hit(st.layout, p.x, p.y + st.scrollY, min);
      if (h) return { kind: "work", hit: h };
    }
    return { kind: "empty" };
  }

  /**
   * Start carrying blocks: a new block of this kind from the palette, or an
   * existing block taken out of the program (and what is inside it). Does
   * nothing for a block that is part of another, which cannot be pulled out.
   *
   * @param blockKind The kind to make, when the drag started on the palette.
   * @param blockId The block to take, when the drag started on a block.
   * @param p Where the pointer is.
   */
  function startCarrying(blockKind: string | undefined, blockId: string | undefined, p: Point) {
    const program = host.program();
    let drag: Drag | undefined;
    if (blockKind) {
      const blocks = [createBlock(program, blockKind)];
      drag = { blocks, startedFrom: program, programWithout: program, grabOffset: PALETTE_GRAB, pointer: p };
    } else if (blockId) {
      // the sections of a solid and the ends of a loft are parts of it: they cannot be pulled out (a drag there scrolls instead)
      const kind = findBlock(program, blockId)?.block.kind;
      if (kind !== undefined && commandById(kind)?.automatic) return;
      const taken = takeBlock(program, blockId);
      if (!taken.blocks.length) return;
      // where the block was drawn, in screen coordinates
      const was = st.layout.blocks.find((b) => b.block.id === blockId)!.bounds;
      drag = { blocks: taken.blocks, startedFrom: program, programWithout: taken.program, grabOffset: { dx: was.x - p.x, dy: was.y - st.scrollY - p.y }, pointer: p };
    }
    if (drag) st.gesture = beginCarrying(st.gesture, drag);
  }

  /**
   * Start carrying a script by its header, if the mode has scripts to move.
   *
   * @param scriptId The id of the script.
   * @param p Where the pointer is.
   */
  function startMovingScript(scriptId: string, p: Point) {
    if (!allowsScripts(host.mode?.())) return;
    const places = new Map(st.layout.scripts.map((l) => [l.scriptId, l.blocksAt]));
    const at = places.get(scriptId);
    if (!at) return;
    /** A place to two decimals. */
    const round = (v: number) => Math.round(v * 100) / 100;
    const program = host.program();
    const programWithPlaces = program.map((s) => (s.at ? s : { ...s, at: { x: round(places.get(s.id)?.x ?? 0), y: round(places.get(s.id)?.y ?? 0) } }));
    const move: Move = { scriptId, startedFrom: program, from: at, to: at, pointer: p, programWithPlaces };
    st.gesture = beginMoving(st.gesture, move);
  }

  /**
   * Put down the script that was being carried: where it was left, if that is
   * somewhere else. It is a change to how the program is shown, not to what it
   * builds, so Undo does not take it back. A script left where it started, or
   * moved less than the step a place is kept to, changes nothing.
   *
   * @param m The move that ended.
   */
  function dropScript(m: Move) {
    if (isStale(m.startedFrom, host.program()) || !movedEnough(m.from, m.to)) ctx.render();
    else host.change(moveScript(m.programWithPlaces, m.scriptId, m.to), { undoable: false });
  }

  /**
   * Put down the carried blocks: on the palette they are thrown away, at a drop
   * point they go there (wrapping the blocks after it, if they are an empty
   * holder), in open space they start a script, anywhere else they go back. The
   * change is made only if it is different from the program as it was, and
   * not at all if the program has changed since the blocks were picked up.
   *
   * @param d The drag that ended.
   * @param p Where the pointer is.
   */
  function dropBlocks(d: Drag, p: Point) {
    let next: Program | undefined;
    if (isStale(d.startedFrom, host.program())) next = undefined;
    else if (overPalette(p)) next = d.programWithout; // carried back to the palette: thrown away
    else if (d.snap) next = dropIntoProgram(d.programWithout, d.snap, d.blocks);
    else if (d.newScriptAt) next = insertBlocks(d.programWithout, { newScript: { at: d.newScriptAt } }, d.blocks);
    // dropped nowhere: put back as it was
    if (next && JSON.stringify(next) !== JSON.stringify(host.program())) host.change(next);
    else ctx.render();
  }

  /**
   * The gesture ended: the state goes back to nothing, and what the gesture
   * leaves is done.
   *
   * @param g The gesture that ended.
   * @param how The end of a drag, or the pointer coming up.
   * @param p Where the pointer is.
   */
  function finish(g: Gesture, how: "panStop" | "up", p: Point) {
    st.gesture = giveUp();
    const r = release(g, how);
    if (r.then === "dropScript" && g.kind === "movingScript") dropScript(g.move);
    else if (r.then === "dropBlocks" && g.kind === "carrying") dropBlocks(g.drag, p);
    else if (r.then === "tap") actions.onTap(r.touched);
  }

  /**
   * The pointer moved during a drag: move what is carried, or scroll the
   * workspace if nothing is carried. (Near the top or bottom edge the workspace
   * also scrolls as time passes, whether the pointer moves or not.)
   *
   * @param p Where the pointer is.
   */
  function onPanMove(p: Point) {
    const g = st.gesture;
    if (g.kind === "movingScript") {
      st.gesture = movedTo(g, scriptMoveTarget(g.move, g.press, p, st.scrollY), p);
      ctx.render();
    } else if (g.kind === "carrying") {
      st.gesture = carriedTo(g, p);
      ctx.render();
    } else if (g.kind === "pressing" && scrollsWorkspace(g.press)) {
      ctx.setScroll(panScrollTarget(g.press, p));
      ctx.render();
    }
  }

  return {
    onDown(p) {
      st.gesture = startPress(classify(p), p, st.scrollY);
    },

    /**
     * The pointer moved far enough to be a drag. A drag that starts on the
     * palette or on a block carries it, one that starts on a script's header
     * moves the script, and any other drag scrolls the workspace.
     */
    onPanStart(p) {
      const g = st.gesture;
      if (g.kind !== "pressing") return;
      st.gesture = markMoved(g);
      const t = g.press.touched;
      if (t.kind === "palette") startCarrying(t.blockKind, undefined, g.press.at);
      else if (t.kind === "work") {
        // a script's header takes hold of the whole script (where scripts are a thing: otherwise it scrolls, like empty space); anything else is a block
        if ("scriptId" in t.hit && HEADER_HITS.has(t.hit.kind)) startMovingScript(t.hit.scriptId, g.press.at);
        else if ("blockId" in t.hit) startCarrying(undefined, t.hit.blockId, g.press.at);
      }
      // anything else that is dragged inside the workspace scrolls it
      onPanMove(p);
    },

    onPanMove,

    onPanStop(p) {
      finish(st.gesture, "panStop", p);
    },

    onUp(p) {
      finish(st.gesture, "up", p);
    },
  };
}
