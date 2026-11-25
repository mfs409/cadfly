import type { Block, Category, Point, Problem, Program } from "../../language/types";
import type { PageRect } from "../dom";
import type { DropPoint, Hit, Measure, ProgramLayout, Rect } from "../layout";
import type { ModeSpec } from "../modes";
import type { Gesture } from "./gesture";
import type { Pools } from "./draw";

/**
 * The types the editor is made of: what it needs from the page it is in, what
 * a touch can land on, the gesture in progress, and the state that everything
 * in the editor shares.
 */

/** A button in the top bar. */
export interface ToolbarButton {
  /** Where it goes in the top bar: after the tabs (what acts on the blocks: undo, redo), in the middle (the mode), or at the right (the project: new, save, load, examples, STL) */
  group: "edit" | "mode" | "file";
  label: string;
  color: string;
  enabled: () => boolean;
  /** Called with where the button is on the screen (meters), so it can open something beside itself */
  action: (at: Rect) => void;
}

/**
 * What the editor needs from the page it is in, and the ways it asks the page
 * to act. Only `program`, `change`, `problem` and `buttons` are required.
 */
export interface EditorHost {
  program(): Program;
  /**
   * The person changed the program. The host takes it from there: it records
   * the change for undo (unless `undoable` is false: folding a block is a change
   * to how it is shown, not to the program), saves it, and runs it.
   */
  change(next: Program, options?: { undoable?: boolean }): void;
  problem(): Problem | undefined;
  buttons(): ToolbarButton[];
  /** The names of the STL files the project has: an import block's file field offers them */
  files?(): string[];
  /** Open the drop-down under an import block's file field (its files, and "Import STL file..."); `pick` gets the chosen name */
  chooseFile?(at: PageRect, current: string, pick: (name: string) => void): void;
  /** A block's own button was pressed (the "hull" button on the faces of a solid): `id` says which */
  pressButton?(blockId: string, id: string): void;
  /** What a measure block found the last time it ran (the variables it set), if it has run */
  measurements?(blockId: string): Record<string, number> | undefined;
  /** How much of each block to offer and show. Leave it out for everything. */
  mode?(): ModeSpec | undefined;
  /** Say something to the person (a script could not be renamed, say), where the host says such things */
  notify?(message: string): void;
}

/** What a touch landed on. */
export type Touched =
  | { kind: "button"; index: number }
  | { kind: "tab"; category: Category }
  | { kind: "palette"; blockKind: string }
  | { kind: "newScript" }
  | { kind: "work"; hit: Hit }
  | { kind: "empty" };

/**
 * A part of the screen that can be touched, outside the workspace (the toolbar
 * and the palette). The workspace's hotspots come from its layout.
 */
export interface Hotspot {
  rect: Rect;
  touched: Touched;
}

/** A finger (or the mouse) that is down */
export interface Press {
  /** Where it went down */
  at: Point;
  /** What it went down on */
  touched: Touched;
  /** Has it moved far enough to be a drag? */
  moved: boolean;
  /** How far the workspace was scrolled when it went down: a drag that scrolls is measured from there */
  scrollStart: number;
}

/** Blocks being carried */
export interface Drag {
  blocks: Block[];
  /**
   * The program the blocks started from, as the host had it. If the host's
   * program is no longer this one when the blocks are dropped, they would be
   * put back over a program that has changed, so the drag is given up.
   */
  startedFrom: Program;
  /** The program without the blocks: what they are being dragged over */
  programWithout: Program;
  /** Where the top left of the blocks is, relative to the pointer */
  grabOffset: { dx: number; dy: number };
  /** Where the pointer is */
  pointer: Point;
  /** The drop point the blocks would snap to if they were dropped now */
  snap?: DropPoint;
  /** Dropped here they would start a new script, at this place in the workspace (not near anything to join) */
  newScriptAt?: Point;
}

/** A script being moved by its header: where it was, and where it is now (meters, from the program's top left) */
export interface Move {
  /** The id of the script */
  scriptId: string;
  /** The program the move started from, as the host had it: if the host's program is no longer this one when the script is put down, the move is given up */
  startedFrom: Program;
  from: Point;
  to: Point;
  /** Where the pointer is: the workspace can scroll under a pointer that is held still, which moves the script */
  pointer: Point;
  /** The program with every script's place written down (a script with no place of its own is drawn below the one before it, so moving one would move the others) */
  programWithPlaces: Program;
}

/** What the editor knows at any moment, shared by its drawing and its handlers */
export interface EditorState {
  /** How far the workspace is scrolled down, in meters. */
  scrollY: number;
  /** The palette tab that is showing. */
  category: Category;
  /** What the finger or mouse is doing: nothing, pressing, carrying blocks or moving a script. */
  gesture: Gesture;
  /** The hotspots outside the workspace, as of the last drawing. */
  hotspots: Hotspot[];
  /** Where everything in the workspace is, as of the last layout. */
  layout: ProgramLayout;
  /**
   * The block that had the problem the last time, so the view scrolls to a
   * problem only when it is a new one.
   */
  lastProblem: string | undefined;
}

/** How to scroll a rectangle into sight: the room to leave above and below it, and where it goes when the view has to move */
export interface RevealHow {
  margin: { top: number; bottom: number };
  lead: number;
}

/** What the editor's parts are given to work with */
export interface EditorContext {
  /** The page the editor is in */
  host: EditorHost;
  /** What the editor knows */
  st: EditorState;
  /** The pools of actors that draw the workspace and the HUD */
  pools: Pools;
  /** How wide text is on screen, in meters. */
  measure: Measure;
  /** Lay out, work out where carried blocks would land, and draw everything */
  render(): void;
  /** Scroll the workspace to this position, kept within its limits, and move the camera */
  setScroll(v: number): void;
  /** The smallest size, in meters, that a thing to touch is given at the screen's size now (`MIN_TARGET_PX` of them) */
  minTarget(): number;
  /** Scroll the workspace so that a rectangle in it is in sight, if it is not */
  reveal(r: Rect, how: RevealHow): void;
}
