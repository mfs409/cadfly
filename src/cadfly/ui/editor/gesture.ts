import type { Point, Program } from "../../language/types";
import type { DropPlan } from "../rules";
import type { Drag, Move, Press, Touched } from "./types";

/**
 * What a finger or the mouse is doing, as one value and the steps between
 * values. There is only ever one gesture, so there is only one state: nothing
 * going on, a press that has not yet become a drag, blocks being carried, or a
 * script being moved. Every step is a function that takes a state and gives the
 * next one, so the rules of a gesture can be checked without a screen, and a
 * gesture that is given up leaves nothing behind.
 */

/** The gesture in progress */
export type Gesture =
  | { kind: "none" }
  | { kind: "pressing"; press: Press }
  | { kind: "carrying"; press: Press; drag: Drag }
  | { kind: "movingScript"; press: Press; move: Move };

/** What a release is to do, and what it takes: put down blocks, put down a script, answer a tap, or nothing */
export type Release = { then: "dropBlocks" } | { then: "dropScript" } | { then: "tap"; touched: Touched } | { then: "nothing" };

/** No gesture: the state at the start, after one ends, and after one is given up */
export const NO_GESTURE: Gesture = { kind: "none" };

/**
 * A finger or the mouse went down. Whatever gesture was going is replaced:
 * a press that comes while an earlier gesture is still going means that
 * gesture's release was lost (the browser took the touch, say).
 *
 * @param touched What it went down on.
 * @param at Where it went down.
 * @param scrollStart How far the workspace is scrolled.
 */
export function startPress(touched: Touched, at: Point, scrollStart: number): Gesture {
  return { kind: "pressing", press: { at, touched, moved: false, scrollStart } };
}

/**
 * The pointer moved far enough to be a drag: a press is no longer a tap. Other
 * states are unchanged.
 *
 * @param g The gesture now.
 */
export function markMoved(g: Gesture): Gesture {
  return g.kind === "pressing" ? { kind: "pressing", press: { ...g.press, moved: true } } : g;
}

/**
 * Blocks have been picked up. Only a press can turn into this; any other state
 * is unchanged.
 *
 * @param g The gesture now.
 * @param drag The blocks being carried.
 */
export function beginCarrying(g: Gesture, drag: Drag): Gesture {
  return g.kind === "pressing" ? { kind: "carrying", press: g.press, drag } : g;
}

/**
 * A script has been picked up by its header. Only a press can turn into this;
 * any other state is unchanged.
 *
 * @param g The gesture now.
 * @param move The script being moved.
 */
export function beginMoving(g: Gesture, move: Move): Gesture {
  return g.kind === "pressing" ? { kind: "movingScript", press: g.press, move } : g;
}

/**
 * Carried blocks follow the pointer. Other states are unchanged.
 *
 * @param g The gesture now.
 * @param pointer Where the pointer is.
 */
export function carriedTo(g: Gesture, pointer: Point): Gesture {
  return g.kind === "carrying" ? { ...g, drag: { ...g.drag, pointer } } : g;
}

/**
 * Carried blocks are aimed at where they would land if they were dropped now.
 * Other states are unchanged.
 *
 * @param g The gesture now.
 * @param plan Where they would land.
 */
export function aimedAt(g: Gesture, plan: DropPlan): Gesture {
  return g.kind === "carrying" ? { ...g, drag: { ...g.drag, snap: plan.snap, newScriptAt: plan.newScriptAt } } : g;
}

/**
 * A script being moved is at a new place, with the pointer at a new place.
 * Other states are unchanged.
 *
 * @param g The gesture now.
 * @param to Where the script is now.
 * @param pointer Where the pointer is.
 */
export function movedTo(g: Gesture, to: Point, pointer: Point): Gesture {
  return g.kind === "movingScript" ? { ...g, move: { ...g.move, to, pointer } } : g;
}

/**
 * Where the pointer is, for a gesture that carries something (blocks or a
 * script): the workspace scrolls when it is near an edge, even if the pointer
 * is held still.
 *
 * @param g The gesture now.
 * @returns The pointer, or undefined when nothing is being carried.
 */
export function carryingPointer(g: Gesture): Point | undefined {
  return g.kind === "carrying" ? g.drag.pointer : g.kind === "movingScript" ? g.move.pointer : undefined;
}

/**
 * The program the gesture started from, if it took something out of it (blocks
 * or a script's places): what it must be dropped onto, unchanged.
 *
 * @param g The gesture now.
 */
export function startedFrom(g: Gesture): Program | undefined {
  return g.kind === "carrying" ? g.drag.startedFrom : g.kind === "movingScript" ? g.move.startedFrom : undefined;
}

/**
 * The gesture is given up: what was carried goes back where it was, a script
 * that was being moved stays where it was, and nothing changes.
 */
export function giveUp(): Gesture {
  return NO_GESTURE;
}

/**
 * The gesture ended, and what it leaves to be done. The state afterwards is
 * always `NO_GESTURE`. When the pointer is released after a drag the engine
 * reports the end of the drag first and the release second, so the release of
 * a gesture that already ended does nothing.
 *
 * @param g The gesture now.
 * @param how The end of a drag (`panStop`), or the pointer coming up (`up`).
 */
export function release(g: Gesture, how: "panStop" | "up"): Release {
  if (g.kind === "movingScript") return { then: "dropScript" };
  if (g.kind === "carrying") return { then: "dropBlocks" };
  if (how === "up" && g.kind === "pressing" && !g.press.moved) return { then: "tap", touched: g.press.touched };
  return { then: "nothing" };
}

/**
 * Where a script that is being moved is, given where the pointer is: the script
 * keeps the offset the pointer had from it when the move began, and the
 * workspace may have scrolled since.
 *
 * @param move The script being moved.
 * @param press The press the move began with.
 * @param p Where the pointer is.
 * @param scrollY How far the workspace is scrolled now.
 */
export function scriptMoveTarget(move: Move, press: Press, p: Point, scrollY: number): Point {
  return { x: move.from.x + (p.x - press.at.x), y: move.from.y + (p.y + scrollY - (press.at.y + press.scrollStart)) };
}

/**
 * How far the workspace is scrolled when a drag that carries nothing moves the
 * pointer: the pointer drags the workspace along with it.
 *
 * @param press The press the drag began with.
 * @param p Where the pointer is.
 */
export function panScrollTarget(press: Press, p: Point): number {
  return press.scrollStart - (p.y - press.at.y);
}

/**
 * Does a drag that carries nothing scroll the workspace? Only a drag that began
 * on empty space or on the workspace does.
 *
 * @param press The press the drag began with.
 */
export function scrollsWorkspace(press: Press): boolean {
  return press.touched.kind === "empty" || press.touched.kind === "work";
}
