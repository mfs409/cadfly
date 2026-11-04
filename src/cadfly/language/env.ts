import { ExprError, RESERVED, evaluateExpr } from "../geometry/expr";
import type { Kernel, Solid } from "../geometry/kernel";
import type { CommandDef } from "./commands";
import type { Files } from "./files";
import type { Block, Problem, Shape } from "./types";

/**
 * What the running program has to show in the 3D view besides its shapes: a dot
 * with a number (a corner of a solid), a face (the ring of its corners) with
 * the id of the face block it comes from, or a sketch.
 */
export type Overlay =
  /** A corner of a solid: where it is in the world, and its number */
  | { kind: "point"; at: [number, number, number]; label: string }
  /** A face of a solid: the block it comes from, its corners, and its label */
  | { kind: "face"; blockId: string; ring: [number, number, number][]; label: string }
  /**
   * The sketch of an extrude or revolve whose eye is shut: a thin slab on the
   * plane it was drawn on, shown in place of the 3D shape
   */
  | {
    kind: "sketch";
    /** The extrude or revolve block that the sketch belongs to */
    blockId: string;
    /** The slab for the whole sketch */
    solid: Solid;
    /**
     * One thin slab for each piece the sketch is made of (see
     * `FlatPiece.pieces`)
     */
    pieces: Solid[];
  };

/** A problem in one block of the program, which the editor marks */
export class ProgramError extends Error {
  /**
   * @param blockId The id of the block that the problem is with.
   * @param message What is wrong, in words a person can act on.
   */
  constructor(readonly blockId: string, message: string) {
    super(message);
  }
}

/** Variable names: letters, digits and _, starting with a letter */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A part made with `define`: the block that holds its shapes, and the names of
 * its inputs
 */
export interface Part {
  /** The `define` block, which holds the shapes the part is built from */
  block: Block;
  /** The names of the part's inputs, in order: the variables a `use` sets */
  inputs: string[];
}

/**
 * What a running program knows: its variables and parts, the project's files,
 * what it has found to show, and the geometry kernel. A block that holds other
 * blocks gets variables of its own (see `scoped`), so a `set` inside it does
 * not leak out.
 */
export class Env {
  /** The variables, by name, with their values now */
  vars = new Map<string, number>();
  /** The parts defined so far (and visible here), by name */
  parts = new Map<string, Part>();
  /** The project's STL files, by name */
  files: Files = {};
  /**
   * The parts built from the project's files so far, by file name (an import
   * inside a loop reads its file once)
   */
  fileSolids = new Map<string, Solid>();
  /**
   * Builds a list of blocks into shapes, in a scope of its own: how a part
   * builds what it holds (set by the runner)
   */
  buildBlocks: (blocks: Block[]) => Shape[] = () => [];
  /**
   * What each measure block found the last time it ran (by block id): the
   * variables it set, for showing
   */
  measured = new Map<string, Record<string, number>>();
  /**
   * What to draw in the 3D view besides the shapes: the corners of a solid (a
   * dot and its number) and its faces (a translucent polygon), where they are
   * in the world as far as the blocks around them have moved them (a transform
   * moves what its contents made; see `moveOverlays`). A block hidden by its
   * eye takes what it made with it.
   */
  overlays: Overlay[] = [];
  /**
   * For each faces section with no faces in it (by block id): the faces of the
   * convex hull of its solid's vertices, for the "hull" button
   */
  hullFaces = new Map<string, number[][]>();
  /**
   * How many parts are being built inside one another right now (a part that
   * uses itself is stopped at a limit)
   */
  depth = 0;
  /**
   * How many blocks have been built so far, counting every pass of a loop (a
   * loop that never ends is stopped)
   */
  steps = 0;

  /**
   * @param kernel The geometry kernel that the blocks build their shapes with.
   */
  constructor(readonly kernel: Kernel) { }

  /**
   * Run `fn` with a copy of the variables and parts, then put the old ones
   * back (also if `fn` throws). Gives what `fn` gives.
   */
  scoped<T>(fn: () => T): T {
    const { vars, parts } = this;
    this.vars = new Map(vars);
    this.parts = new Map(parts);
    try {
      return fn();
    } finally {
      this.vars = vars;
      this.parts = parts;
    }
  }
}

/**
 * Reads the fields of the block that is running, and says what is wrong with
 * them
 */
export class Args {
  /**
   * @param env What the program knows (the variables to work expressions out
   *            with, in particular).
   * @param block The block that is running, whose fields are read.
   * @param def The block's command, which says what its fields are and their
   *            defaults.
   */
  constructor(readonly env: Env, readonly block: Block, private def: CommandDef) { }

  /** What to call a field in a message: its label, else its id */
  private label(id: string) {
    const p = this.def.params.find((x) => x.id === id);
    return p?.label || p?.id || id;
  }

  /**
   * Stop the program here, with a message that starts with the field's label.
   * Throws a ProgramError for this block.
   */
  fail(id: string, message: string): never {
    throw new ProgramError(this.block.id, `${this.label(id)}: ${message}`);
  }

  /** What a field holds as it was typed: the block's value, else the default */
  private raw(id: string): string | boolean {
    const p = this.def.params.find((x) => x.id === id);
    return this.block.args[id] ?? p?.default ?? "";
  }

  /** The text a field holds, without spaces at either end */
  text(id: string): string {
    return String(this.raw(id)).trim();
  }

  /** Is a tick field on? */
  flag(id: string): boolean {
    return this.raw(id) === true;
  }

  /**
   * The number a field holds, working out arithmetic and variables. Stops the
   * program, saying what is wrong, if it is not a number.
   */
  num(id: string): number {
    return this.evaluate(id, "number");
  }

  /**
   * Is what a field holds a yes? (A field that wants a yes/no, such as `if`'s.)
   * Stops the program, saying what is wrong, if it is a number or is not
   * complete.
   */
  truth(id: string): boolean {
    return this.evaluate(id, "truth") !== 0;
  }

  /**
   * What a field holds, worked out as the kind of value it wants (yes is 1 and
   * no is 0). An expression that is wrong stops the program, with its message.
   */
  private evaluate(id: string, want: "number" | "truth"): number {
    try {
      return evaluateExpr(String(this.raw(id)), this.env.vars, want);
    } catch (e) {
      if (e instanceof ExprError) this.fail(id, e.message);
      throw e;
    }
  }

  /** The number a field holds, which must be more than zero */
  positive(id: string): number {
    const v = this.num(id);
    if (!(v > 0)) this.fail(id, `must be more than zero (it is ${v})`);
    return v;
  }

  /** The number a field holds, which must be zero or more */
  nonNegative(id: string): number {
    const v = this.num(id);
    if (v < 0) this.fail(id, `cannot be negative (it is ${v})`);
    return v;
  }

  /**
   * A name made of letters, digits and _, starting with a letter: for
   * variables, parts and their inputs. It may not be one of the words that mean
   * something in an expression (see `RESERVED`).
   */
  variableName(id: string): string {
    const name = this.text(id);
    if (!VARIABLE_NAME.test(name)) this.fail(id, "a variable name uses letters, digits and _, and starts with a letter");
    if (RESERVED.has(name)) this.fail(id, `"${name}" is built in to expressions (${[...RESERVED].join(", ")}), so it cannot be a name`);
    return name;
  }
}

/**
 * What an error says is wrong, and where.
 *
 * @param e What was thrown: a ProgramError names its own block.
 * @param fallbackBlockId The block to name for any other error.
 */
export function toProblem(e: unknown, fallbackBlockId: string): Problem {
  if (e instanceof ProgramError) return { blockId: e.blockId, message: e.message };
  return { blockId: fallbackBlockId, message: (e as Error).message };
}
