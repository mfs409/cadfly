import type { ListPoint } from "../../language/program";
import type { CommandDef } from "../../language/commands";
import type { Block, Param, Point } from "../../language/types";
import type { ModeSpec } from "../modes";

/**
 * The shapes of what the layout works out: rectangles, the sizes it is made
 * from, and the result for each block, script and program. Everything is plain
 * numbers (meters, y down), so a layout can be tested and drawn with no
 * screen.
 */

/** A rectangle: its top left corner, and its size */
export interface Rect {
  /** Left edge */
  x: number;
  /** Top edge (y points down) */
  y: number;
  /** Width */
  w: number;
  /** Height */
  h: number;
}

/** How wide a piece of text is, in the block text size */
export type Measure = (text: string) => number;

/** The sizes the layout is made from, all in meters */
export interface Metrics {
  /** Height of one row of a block's header */
  rowH: number;
  /** Space at the left and right inside a header */
  padX: number;
  /** Space between the parts of a header */
  gap: number;
  /** Space added to each side of a field's text, inside its chip */
  chipPad: number;
  /** The narrowest a field chip gets */
  minChipW: number;
  /** How far blocks inside a block are moved to the right */
  indent: number;
  /** Height of the bar under a C-shaped block */
  footH: number;
  /** Height of the gap that shows a C-shaped block with nothing inside yet */
  emptyH: number;
  /** A wrapped header's later rows start this far in from the left */
  wrapIndent: number;
  /** Height of the caption line above a block that has one */
  captionH: number;
  /** Width of the small +/- button that folds a block that holds others */
  foldW: number;
  /** Height of the strip that a folded script leaves */
  foldH: number;
  /** Height of the line above a script that has a header (with its button and chips) */
  scriptHeaderH: number;
}

/** The sizes used unless others are given */
export const DEFAULT_METRICS: Metrics = {
  rowH: 0.52,
  padX: 0.14,
  gap: 0.1,
  chipPad: 0.1,
  minChipW: 0.42,
  indent: 0.32,
  footH: 0.2,
  emptyH: 0.3,
  wrapIndent: 0.25,
  captionH: 0.34,
  foldW: 0.36,
  foldH: 0.3,
  scriptHeaderH: 0.42,
};

/**
 * The sizes to lay out with when a finger has to be able to touch what is
 * drawn: every row of a block's header is at least `minTouch` tall, so that a
 * field or button on it has room to be given an area to touch of that size
 * without taking room from the row above or below. Rows are never shorter than
 * the default, so a screen that is big enough for them is not changed.
 *
 * @param minTouch The smallest size a thing to touch is given, in meters (0 for none).
 * @returns The default sizes, with taller rows if they need to be.
 */
export function metricsForTouch(minTouch: number): Metrics {
  return { ...DEFAULT_METRICS, rowH: Math.max(DEFAULT_METRICS.rowH, minTouch) };
}

/** What kind of thing a part of a block's header is */
export type PartKind = "word" | "label" | "field" | "flag" | "caption" | "fold" | "power" | "eye" | "info" | "number" | "button";

/** One thing in a block's header: a word, a field, a button, and so on */
export interface Part {
  /**
   * What the part is, which decides how it is drawn and what a tap on it does:
   * the block's `word`; a `label` before a field; a `field` or a `flag` (tick);
   * the `caption` line above the block; the `fold` button; the `power` switch
   * and the `eye`; the `info` "?" of a block that reports on what is inside it; a vertex's `number`; a block's own `button`.
   */
  kind: PartKind;
  /** Text bounds for a word or label; the chip itself for a field or flag */
  rect: Rect;
  /**
   * What to draw: the text of a word or label or caption, the value in a field,
   * "✓" in a ticked flag
   */
  text: string;
  /** The field this part shows and edits: for a field, a flag or a caption */
  param?: Param;
  /**
   * For the word of a block that has a caption: the caption's field, which
   * tapping the word edits too (the word has no field of its own)
   */
  captionParam?: Param;
}

/** Where one block goes, and the parts of its header */
export interface BlockLayout {
  /** The block this is the layout of */
  block: Block;
  /** The command the block is an instance of */
  def: CommandDef;
  /** How many blocks it is inside of: 0 at the top of the program */
  depth: number;
  /** The header: one rectangle per row (a long header wraps onto more rows) */
  rows: Rect[];
  /** The words, fields and buttons of the header, in drawing order */
  parts: Part[];
  /** Everything the block takes up, including what is inside it */
  bounds: Rect;
  /** C-shaped blocks: the gap that stands for "nothing inside yet" */
  empty?: Rect;
  /** C-shaped blocks: the bar down the left side */
  spine?: Rect;
  /** C-shaped blocks: the bar underneath */
  footer?: Rect;
}

/**
 * A place where dragged blocks could be dropped: a place in a list of blocks
 * (an `index` of 0 is above the first block, which makes what is dropped there
 * the first blocks of a script), and where it is drawn
 */
export type DropPoint = ListPoint & {
  /** Where the left edge of the first of the blocks would be */
  x: number;
  /** Where the top of the first of the blocks would be */
  y: number;
};

/** What every script header has, whether or not its name and inputs can be edited */
interface ScriptLayoutBase {
  /** The id of the script */
  scriptId: string;
  /**
   * The first block of the script: the one that a tap on the strip of a folded
   * script takes hold of. None for a script with no blocks.
   */
  firstId?: string;
  /**
   * Where the script's first block is, in meters from the program's top left
   * (the header is above it): what the script's `at` would be to leave it where
   * it is, since a script with no `at` is placed below the one before it
   */
  blocksAt: Point;
  /** The whole line above the script */
  header: Rect;
  /** The +/- button, at the left of the header (a script of several blocks) */
  button?: Rect;
  /**
   * What the header says: the script's name and inputs ("bracket(w, h)"),
   * "global" for a global script, and "3 blocks", or "2 more" when the rest is
   * folded away. (When the name and inputs are chips, they are shown by those,
   * and the text of `text` is only the count.)
   */
  label: string;
  /** The plain text drawn in the header, and where: `label`, or only the count if the name has chips */
  text: { rect: Rect; text: string };
  /** Is the script folded, so that only its first block shows */
  collapsed: boolean;
  /** How many blocks the script has */
  count: number;
  /**
   * A folded script: the thin strip under its first block that stands for the
   * others
   */
  strip?: Rect;
}

/** A header that is only text: "build", "global", or a name with its inputs */
export interface PlainScriptLayout extends ScriptLayoutBase {
  kind: "plain";
}

/**
 * A header of a named script (other than `build`) in a mode that has scripts:
 * its name and inputs are chips to tap and edit, and there is a button to
 * remove the script.
 */
export interface EditableScriptLayout extends ScriptLayoutBase {
  kind: "editable";
  /** The chip with the script's name, to tap and rename it */
  nameChip: { rect: Rect; text: string };
  /** The chip with the script's inputs, "(w, h)" or "( )" */
  inputsChip: { rect: Rect; text: string };
  /** The button at the right of the header that removes the script */
  remove: Rect;
}

/**
 * The header of a script, above its first block: a +/- button with a count
 * (when it has several blocks), and its name. It is `plain`, or `editable`
 * where the mode has scripts and the script is a named one other than `build`.
 */
export type ScriptLayout = PlainScriptLayout | EditableScriptLayout;

/** Where everything in a program goes */
export interface ProgramLayout {
  /**
   * Every block that is laid out, each one before the blocks inside it. (A
   * block inside a folded block is not laid out.)
   */
  blocks: BlockLayout[];
  /** One for each script that has a header, in the order they are in the program */
  scripts: ScriptLayout[];
  /** Every place dragged blocks could go */
  dropPoints: DropPoint[];
  /** The highest point (smallest y) that anything reaches: a script's header is above its first block, so it can be above `y` */
  top: number;
  /** The lowest y that anything reaches */
  bottom: number;
}

/** What `layoutProgram` needs besides the program */
export interface LayoutOptions {
  /** Where the left edge of the program is */
  x: number;
  /** Where the top of the program is */
  y: number;
  /** How wide the blocks may be, before a header wraps onto another row */
  width: number;
  /** How wide text is */
  measure: Measure;
  /** The sizes to lay out with (default: `DEFAULT_METRICS`) */
  metrics?: Metrics;
  /** The mode in use, which decides whether the eye and power switch show */
  mode?: ModeSpec;
}
