import type { Block, Point, Program } from "../language/types";
import { type DropPoint, type ProgramLayout, acceptingPoints, nearestPoint } from "./layout";
import { type ModeSpec, canDropFree } from "./modes";

/**
 * Small decisions the interface makes, written as plain functions of plain
 * values so that they can be checked without a screen: whether a gesture has
 * gone stale, where carried blocks would land, whether a moved script has
 * really moved, and what a field edit leaves in the field.
 */

/**
 * Has the program changed since something (a drag, a proposed answer) started
 * from it? Programs are never changed in place, so a different object is a
 * different program. What was built on the old one (blocks carried out of it,
 * a change worked out for it) must not be put back over the new one.
 *
 * @param startedFrom The program the gesture or request started from, if there
 *                    is one.
 * @param current The program now.
 */
export function isStale(startedFrom: Program | undefined, current: Program): boolean {
  return startedFrom !== undefined && startedFrom !== current;
}

/** Where carried blocks would land if they were dropped now */
export interface DropPlan {
  /** The drop point they would snap to, if one is near enough and takes them */
  snap?: DropPoint;
  /**
   * Where they would start a new script of their own, in the workspace (meters
   * from its top left), when there is nothing to snap to and the mode lets them
   */
  newScriptAt?: Point;
}

/**
 * Work out where carried blocks would land: on the nearest drop point that
 * takes all of them, if one is near enough, and otherwise, if they may start a
 * script, in open space right where they are. Nothing lands when the pointer is
 * outside the workspace.
 *
 * @param layout The layout of the program the blocks are being dragged over.
 * @param program That program (the one without the carried blocks).
 * @param blocks The blocks being carried.
 * @param corner Where the top left of the blocks is, in the workspace.
 * @param pointerInWorkspace Is the pointer over the part of the screen that shows the program?
 * @param workOrigin Where the workspace's top left is.
 * @param mode The mode in use, if any.
 * @param snapDistance How near a drop point has to be to count.
 */
export function dropPlan(layout: ProgramLayout, program: Program, blocks: Block[], corner: Point, pointerInWorkspace: boolean, workOrigin: Point, mode: ModeSpec | undefined, snapDistance: number): DropPlan {
  if (!pointerInWorkspace) return {};
  const snap = nearestPoint(
    acceptingPoints(
      layout,
      program,
      blocks.map((b) => b.kind),
    ),
    corner.x,
    corner.y,
    snapDistance,
  );
  if (snap) return { snap };
  if (!canDropFree(mode, blocks)) return {};
  return { newScriptAt: { x: Math.max(0, corner.x - workOrigin.x), y: Math.max(0, corner.y - workOrigin.y) } };
}

/** Where the edge zones of the workspace are, and how fast the view scrolls in them */
export interface EdgeZone {
  /** The top of the workspace, on the screen (meters) */
  top: number;
  /** The bottom of the workspace, on the screen (meters) */
  bottom: number;
  /** How far in from each edge the zone reaches (meters) */
  depth: number;
  /** How fast the view scrolls at the very edge, and beyond it (meters per second) */
  maxSpeed: number;
}

/**
 * How fast the view scrolls for a pointer at this height, in meters per second:
 * negative to scroll up (the pointer is near the top), positive to scroll down
 * (near the bottom), zero in between. The speed grows in a straight line with
 * how far into the zone the pointer is, from nothing at the zone's inner side
 * to `maxSpeed` at the edge, and stays at `maxSpeed` beyond it.
 *
 * @param pointerY Where the pointer is on the screen (meters).
 * @param zone Where the edge zones are.
 */
export function edgeScrollSpeed(pointerY: number, zone: EdgeZone): number {
  const into = (v: number) => Math.min(1, Math.max(0, v / zone.depth));
  const above = into(zone.top + zone.depth - pointerY);
  const below = into(pointerY - (zone.bottom - zone.depth));
  return zone.maxSpeed * (below - above);
}

/** The longest time one step may count as (seconds): after a stall, the view jumps by no more than this */
const LONGEST_STEP = 0.1;

/**
 * Where the view is after scrolling at a speed for a time, kept within its
 * limits. The distance is the speed times the time, so it is the same however
 * the time is cut into steps (frames), and does not depend on how often the
 * pointer moves.
 *
 * @param scrollY How far the view is scrolled now (meters).
 * @param speed How fast it scrolls, in meters per second (down is positive).
 * @param seconds The time since the last step. A step longer than a tenth of a
 *                second counts as a tenth, so a stalled page does not jump.
 * @param least The least the view can scroll to.
 * @param most The most the view can scroll to.
 */
export function edgeScrolled(scrollY: number, speed: number, seconds: number, least: number, most: number): number {
  return Math.min(Math.max(least, scrollY + speed * Math.min(seconds, LONGEST_STEP)), Math.max(least, most));
}

/** A place to two decimals, and not less than 0: how a script's place is kept */
const placeStep = (v: number) => Math.max(0, Math.round(v * 100) / 100);

/**
 * Has a script that was moved ended up somewhere else? A move shorter than the
 * step a place is kept to (two decimals) changes nothing.
 *
 * @param from Where the script was.
 * @param to Where it was left.
 */
export function movedEnough(from: Point, to: Point): boolean {
  return placeStep(from.x) !== placeStep(to.x) || placeStep(from.y) !== placeStep(to.y);
}

/**
 * What a field edit leaves in the field: the new text, or undefined if the
 * field is to keep what it had. A field that offers suggestions starts empty
 * (the old value is only a hint), and keeps the old value if nothing was typed.
 *
 * @param typed What is in the box when the edit ends.
 * @param original What the field held when the edit began.
 * @param offersSuggestions Does the field offer suggestions as you type?
 */
export function valueToKeep(typed: string, original: string, offersSuggestions: boolean): string | undefined {
  const value = typed || (offersSuggestions ? original : "");
  return value === original ? undefined : value;
}
