import type { Flat, Solid } from "../geometry/kernel";

/**
 * One block of a program: a command with the values in its fields. A block may
 * hold more blocks (a "C-shaped" block such as extrude, which holds its
 * sketch).
 */
export interface Block {
  /** Unique within the program; the editor uses it to point at a block */
  id: string;

  /** Which command this is (see commands.ts) */
  kind: string;

  /**
   * What was typed or chosen in the block's fields, by parameter id. Numbers
   * are kept as the text typed ("width / 4"), so they round-trip exactly; a
   * flag is a boolean.
   */
  args: Record<string, string | boolean>;

  /**
   * The blocks held inside this one, in order, for a block that holds others
   * (the sketch inside an extrude, the shapes inside a union, an else inside an
   * if). Absent for a block that holds nothing, and for one that holds others
   * but has none yet.
   */
  inner?: Block[];

  /**
   * The eye on the block: it is built (its problems show) but contributes
   * nothing to the picture, the export or the block around it
   */
  hidden?: boolean;

  /**
   * The power switch of a block that changes what is inside it (transform,
   * round, fillet, ...): while true it does nothing, and the shapes inside it
   * pass through as they were. (`hidden` hides the result, the shapes inside
   * with it.)
   */
  disabled?: boolean;

  /**
   * A partly exposed block (see modes.ts) shows all of its fields while this is
   * true.
   */
  expanded?: boolean;

  /**
   * The editor shows only the header of a block that holds others; it makes no
   * difference to what the program builds
   */
  collapsed?: boolean;

  /**
   * Top-level blocks only. A block with `at` starts a stack that floats at that
   * place in the editor (meters, from the workspace's top left); the blocks
   * after it with no `at` are the rest of that stack. With no `at` anywhere,
   * the program is one stack.
   */
  at?: { x: number; y: number };

  /**
   * The first block of a stack only: the editor shows just that block and a
   * strip standing for the rest
   */
  stackCollapsed?: boolean;
}

/** A block program is a list of blocks */
export type Program = Block[];

/** The group a command belongs to / a tab of the editor's palette */
export type Category = "code" | "shapes" | "sketch" | "place" | "combine";

/** What kind of thing a block's field holds */
export type ParamType =
  /** A number, or arithmetic using variables */
  | { kind: "expr" }
  /** The name of a variable */
  | { kind: "var" }
  /**
   * An optional label for a block, for people to read: empty unless someone
   * adds one, not unique, and nothing refers to it
   */
  | { kind: "caption" }
  /**
   * Free text, such as the vertex numbers of a face: 1 2 3 4. `suggestions` are
   * offered while typing; anything else may still be typed.
   */
  | { kind: "text"; suggestions?: readonly string[] }
  /** The name of an STL file that the project has loaded */
  | { kind: "file" }
  /** One of a fixed list: `value` is what is kept, `label` what is shown */
  | { kind: "choice"; options: readonly { value: string; label: string }[] }
  /** A tick that is on or off */
  | { kind: "flag" };

/** One field of a command: what it holds, how it is shown, and its default */
export interface Param {
  /** The key of the field in a block's `args`, and its name in block text */
  id: string;
  /**
   * In block text the value may come without the name, straight after the
   * kind: `face 1 2 3 4`
   */
  positional?: boolean;
  /**
   * The program shown to the model leaves this field out while it has its
   * default (a neutral value, like no twist)
   */
  quiet?: boolean;
  /** Shown before the field */
  label: string;
  /** What kind of thing the field holds, which decides how it is edited */
  type: ParamType;
  /**
   * What a new block starts with, and what a block that has no value for the
   * field uses: text for most kinds of field, a boolean for a flag
   */
  default: string | boolean;
}

/** Why the program stopped, and where */
export interface Problem {
  /** The block the problem is with, which the editor marks in red */
  blockId: string;
  /** What is wrong, in words a person can act on */
  message: string;
}

/**
 * What a block can build: a solid (3D), or a flat shape (2D, in its own u,v
 * plane). A flat shape may be marked `hole`: it is then cut out of the flat
 * shapes beside it when they are merged, and is not a shape of its own.
 */
export interface FlatPiece {
  /** Tells a flat shape from a solid (see `isFlat`) */
  kind: "flat";
  /** The shape itself */
  flat: Flat;
  /** Is it a hole, to be cut out of the flat shapes beside it */
  hole?: boolean;
  /**
   * The pieces it was put together from, lowest first (a rectangle with a
   * circle in the middle: two), when there are several: so the view can draw
   * each one's outline, which the joined shape does not show. Absent when the
   * shape is one piece.
   */
  pieces?: Flat[];
}

/** Anything a block can build: a solid, or a flat shape */
export type Shape = Solid | FlatPiece;

/** Is this shape a flat one (and not a solid)? */
export function isFlat(s: Shape): s is FlatPiece {
  return (s as FlatPiece).kind === "flat";
}
