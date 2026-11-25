import { ExprError, RESERVED, evaluateExpr } from "../geometry/expr";
import type { Kernel, Solid, Vec3 } from "../geometry/kernel";
import type { CommandDef } from "./commands";
import type { StlFiles } from "./files";
import type { Block, Problem, Script, Shape } from "./types";

/**
 * What the running program has to show in the 3D view besides its shapes: a dot
 * with a number (a corner of a solid), a face (the ring of its corners) with
 * the id of the face block it comes from, or a sketch.
 */
export type Overlay =
  /** A corner of a solid: where it is in the world, and its number */
  | { kind: "point"; at: Vec3; label: string }
  /** A face of a solid: the block it comes from, its corners, and its label */
  | { kind: "face"; blockId: string; ring: Vec3[]; label: string }
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
     * One thin slab for each piece the sketch is made of
     */
    pieces: Solid[];
  };

/** A problem in one block of the program */
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
 * Split "a, max(1, 2), c" at the commas that are not inside brackets (an empty
 * text is no values at all)
 */
export function splitValues(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(text.slice(start).trim());
  return out.length === 1 && out[0] === "" ? [] : out;
}

/**
 * The names in the `inputs` of a script: "w, h". Throws an Error, in words that
 * can be shown, for a text that is not a name, a reserved word, or a name used
 * twice.
 */
export function inputNames(text: string): string[] {
  const names = splitValues(text);
  names.forEach((n) => {
    if (!VARIABLE_NAME.test(n)) throw new Error(`"${n}" is not a name: use letters, digits and _, starting with a letter, separated by commas`);
    if (RESERVED.has(n)) throw new Error(`"${n}" cannot be an input name`);
  });
  if (new Set(names).size !== names.length) throw new Error("an input name is used twice");
  return names;
}

/**
 * The variables that can be seen at one point of a run, by name, with their
 * numbers. A scope may have a parent, and then it sees the parent's variables
 * too (and the parent's parent's, and so on). Setting a variable only ever
 * writes this scope, never the parent's, so a block's `set` is gone when its
 * scope ends and an inner `set` of an outer name hides it instead of changing
 * it.
 */
export class Scope {
  /** The variables set in this scope itself */
  private readonly values = new Map<string, number>();

  /**
   * @param parent The scope that this one sees through, if it has one.
   */
  constructor(private readonly parent?: Scope) { }

  /** The value of a variable, from this scope or else the nearest one up the chain that has it; undefined if there is none */
  get(name: string): number | undefined {
    return this.values.get(name) ?? this.parent?.get(name);
  }

  /** Is there a variable of this name in this scope or any scope above it? */
  has(name: string): boolean {
    return this.values.has(name) || (this.parent?.has(name) ?? false);
  }

  /** Set a variable in this scope (not in the parent) */
  set(name: string, value: number): void {
    this.values.set(name, value);
  }

  /** A new scope that sees this one's variables, and is empty of its own */
  child(): Scope {
    return new Scope(this);
  }

  /** The variables set in this scope itself, not those of its parents */
  entries(): IterableIterator<[string, number]> {
    return this.values.entries();
  }
}

/**
 * What a running program knows: its variables and scripts, the project's files,
 * what it has found to show, and the geometry kernel. A block that holds other
 * blocks gets variables of its own, so a `set` inside it does not leak out.
 */
export class Env {
  /**
   * The variables in scope at this point of the run (name to number): `set`
   * writes it, and every number field is worked out against it. It changes as
   * the run enters and leaves blocks that hold others.
   */
  scope = new Scope();
  /**
   * The variables that every script sees: what the global scripts set. A `use`
   * starts its script from a child of this (and nothing else of the caller).
   */
  globals = new Scope();
  /**
   * The named scripts that a `use` can run (all of them, from the start; not
   * `build`), by name
   */
  scripts = new Map<string, Script>();
  /** The project's STL files, by name */
  files: StlFiles = {};
  /**
   * The parts built from the project's files so far, by file name (an import
   * inside a loop reads its file once)
   */
  fileSolids = new Map<string, Solid>();
  /**
   * Builds a list of blocks into shapes, in a scope of its own: how a script
   * builds what it holds
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
   * moves what its contents made). A block hidden by its
   * eye takes what it made with it.
   */
  overlays: Overlay[] = [];
  /**
   * For each faces section with no faces in it (by block id): the faces of the
   * convex hull of its solid's vertices, for the "hull" button
   */
  hullFaces = new Map<string, number[][]>();
  /**
   * How many `use` blocks are running right now, one inside another. A script
   * that uses itself would never stop, so a `use` is refused at
   * `MAX_SCRIPT_DEPTH`.
   */
  useDepth = 0;
  /**
   * How many blocks have been built in the whole run, counting every pass of a
   * loop. A loop that never ends is stopped at `MAX_BUILT_BLOCKS`.
   */
  blocksBuilt = 0;

  /**
   * Construct the environment
   *
   * @param kernel The geometry kernel that the blocks build their shapes with.
   */
  constructor(readonly kernel: Kernel) { }

  /**
   * Run `fn` in a new scope: it starts with every variable in scope now, and
   * anything it sets is forgotten when it ends (also if `fn` throws). Gives
   * what `fn` gives.
   */
  inNewScope<T>(fn: () => T): T {
    return this.inScope(this.scope.child(), fn);
  }

  /**
   * Run `fn` with `scope` as the variables in scope, then put the old scope
   * back (also if `fn` throws). Gives what `fn` gives.
   *
   * @param scope The scope to run in. The caller makes it, from a parent of its
   *              choosing (a `use` starts from the globals, not from the scope
   *              of the block that uses it).
   * @param fn What to run.
   */
  inScope<T>(scope: Scope, fn: () => T): T {
    const old = this.scope;
    this.scope = scope;
    try {
      return fn();
    } finally {
      this.scope = old;
    }
  }
}

/**
 * The fields of one block that is running. A field is read as text, a number,
 * a yes/no or a name (falling back to the command's default when the block
 * has no value for it), and a field that is wrong stops the program with a
 * message that names the block and the field.
 */
export class BlockArgs {
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
      return evaluateExpr(String(this.raw(id)), this.env.scope, want);
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
   * variables, scripts and their inputs. It may not be one of the words that
   * mean something in an expression.
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
