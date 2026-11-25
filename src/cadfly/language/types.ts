import type { Flat, Solid } from "../geometry/kernel";

/**
 * The types that define a block program: `Block`, `Script` (a column of blocks:
 * `build`, a function, or a group of globals), `Program` (a list of scripts),
 * `Param`, `Shape` and the other types the rest of the language is written in.
 */

/** A place in the workspace, in meters from its top left */
export interface Point {
  /** How far across, from the left */
  x: number;
  /** How far down, from the top */
  y: number;
}

/**
 * A block of a program holds a command and the values in its fields. A block may
 * hold more blocks (e.g., "extrude").
 */
export interface Block {
  /** Unique within the program; it is how a block is pointed at */
  id: string;

  /** Which command this is */
  kind: string;

  /**
   * What was typed or chosen in the block's fields, by parameter id. Numbers
   * are kept as the text typed ("width / 4"), so they round-trip exactly; a
   * flag is a boolean.
   */
  args: Record<string, string | boolean>;

  /**
   * The blocks held inside this one, in order, for a block that holds others.
   * Absent for a block that holds nothing, and for one that holds others but
   * has none yet.
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
   * pass through as they were.
   */
  disabled?: boolean;

  /** In some modes of the UI, this can toggle some of a block's details */
  expanded?: boolean;

  /** Should this block display just its header, or the full block? */
  collapsed?: boolean;
}

/** The name of the script that every program has, and that runs by itself */
export const BUILD = "build";

/**
 * A column of blocks that connect one to the next, and run one after another,
 * from the first to the last. There are three kinds of script, told apart by
 * `name`:
 *
 * - A *global script* has no name and can only hold `set` blocks.  These define
 *   global variables.  They must have at least one block.
 * - A *named script* has a `name` and (optionally) `inputs`. It is a function
 *   that is invoked via a `use` block. It may hold any legal top-level block,
 *   and it can be empty.
 * - `build` is the named script called "build". Every program has exactly one.
 *   It has no inputs, it cannot be removed (though it may be empty), and it
 *   runs by itself.
 */
export interface Script {
  /**
   * Unique among the scripts of a program (s1, s2, ...), and never changes.
   * Unlike the name, which may be edited, or absent, and which a person reads,
   * the id is only for pointing at the script: it is how an operation says
   * which script it means, and it stays right when
   * other scripts are added, removed or moved. Blocks have their own ids (b1,
   * b2, ...), and the two do not share a namespace.
   */
  id: string;

  /**
   * What the script is called (no name means a global script). Names
   * are unique in a program, and are made like variable names.
   */
  name?: string;

  /**
   * The names of the inputs of a named script, in order, as text: "w, h". Each
   * is a variable inside the script, set by the `use` that runs it. Never set
   * for a global script or for `build`.
   */
  inputs?: string;

  /**
   * The top-left coordinate of the script on the workspace, in meters from the
   * workspace's top left. When it is absent, the script is placed for you:
   * below the script before it in the program's list (the first one goes at the
   * top left). It is optional because whoever makes a script without knowing
   * coordinates (the "new script" button, `addScript`) cannot say where it goes:
   * only the drawing of the scripts knows how tall the others are.
   */
  at?: Point;

  /** Should the details of this script be hidden? */
  collapsed?: boolean;

  /**
   * The blocks, from top to bottom. A global script has at least one; a named
   * script may have none.
   */
  blocks: Block[];
}

/**
 * A block program is a list of scripts
 *
 * What happens when it runs:
 * 1. The global scripts run, each on its own, starting with no variables. What
 *    they set is the variables that every script can see (the globals). A
 *    global may use another global only from the same script, below the block
 *    that sets it. Two global scripts may not set the same name.
 * 2. `build` runs, seeing the globals. A `set` inside any named script gives a
 *    variable that only that script (and the blocks inside it) can see.
 * 3. A `use` block runs the named script it names, which sees the globals, its
 *    own inputs and its own variables, and nothing of the script that used it.
 *
 * A program with nothing in it is a single, empty `build` script.
 */
export type Program = Script[];

/** The group a command belongs to / a tab of the palette */
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
  /** The block the problem is with, which is marked in red */
  blockId: string;
  /** Text for an error message */
  message: string;
}

/**
 * A flat shape: 2D, in its own u,v plane. A block like rectangle or circle
 * builds one, and a block like extrude or revolve turns one into a solid.
 */
export interface FlatPiece {
  /** Tells a flat shape from a solid */
  kind: "flat";
  /** The shape itself */
  flat: Flat;
  /** Is it a hole, to be cut out of the flat shapes beside it */
  hole?: boolean;
  /**
   * The shapes that were put together to make `flat`, lowest first (a
   * rectangle with a circle in the middle: two), so the view can draw each
   * one's outline, which the joined shape does not show. Always has at least
   * one entry: when `flat` is a single piece, the list is just `[flat]`.
   */
  pieces: Flat[];
}

/**
 * What a block can build: a solid (3D), or a flat shape (2D, in its own u,v
 * plane)
 */
export type Shape = Solid | FlatPiece;

/** Is this shape a flat one (and not a solid)? */
export function isFlat(s: Shape): s is FlatPiece {
  return (s as FlatPiece).kind === "flat";
}
