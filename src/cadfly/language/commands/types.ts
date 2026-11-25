/**
 * What a command is: the `CommandDef` that every kind of block is described by,
 * and the limits and lists that the commands are written against.
 *
 * A command is one kind of block: its word, its fields (`params`), and what it
 * builds. What a command builds: a program is a tree. A block with `make`
 * builds one shape, either a solid or a flat shape in its own u, v plane. If it
 * builds its inner blocks (`buildsInner`), the shapes inside are built first and
 * handed to `make` as `kids`, and `make` merges or changes them into the one
 * shape the block stands for. A block with `run`
 * builds nothing, and only sets something up (a variable). A block with
 * `sketch` is a flat shape drawn from its fields.
 */

import type { SketchShape } from "../../geometry/sketch";
import { BlockArgs, Env, type Overlay } from "../env";
import type { Block, Category, Param, Shape } from "../types";

/**
 * One command, as the rest of the program sees it. Only `id`, `word`,
 * `category`, `color` and `params` are always present; the others describe what
 * kind of block it is and how it behaves.
 */
export interface CommandDef {
  /** The block's `kind`: unique, and what programs and block text call it */
  id: string;
  /** The word the block starts with */
  word: string;
  /**
   * One line saying what the block means, for people and for the model that
   * writes programs
   */
  hint: string;
  /** The palette tab the block is offered in */
  category: Category;
  /** The color of the block: its category's, unless `COLOR_OVERRIDES` says otherwise */
  color: string;
  /** The block's fields, in the order they are drawn */
  params: Param[];
  /** The kinds of block that may sit inside this one (a C-shaped block) */
  inner?: readonly string[];
  /**
   * The blocks a new block of this kind starts out holding, so that it works
   * straight away (an extrude starts with a rectangle, for example). Absent for
   * a kind that starts out empty. Only for a block that has `inner`.
   *
   * @param nextId Gives a new id each time it is called, one for each block
   *               made (the ones inside others too).
   */
  starter?: (nextId: () => string) => Block[];
  /**
   * The blocks inside are built before this block is, and `make` is handed the
   * shapes they made (`kids`). A block that has `inner` but not this (if,
   * solid, polygon, ...) reads or builds its inner blocks itself.
   */
  buildsInner?: boolean;
  /**
   * For a block that runs what is inside it again and again: the name of the
   * counter, and how many passes
   */
  loop?: (env: Env, a: BlockArgs) => { counter: string; times: number };
  /**
   * The first shape inside is the base (the others are cut from it, or moved to
   * it): it is labeled as the base
   */
  baseFirst?: boolean;
  /**
   * A piece of a bigger block: it may only appear inside a block that lists it
   * in `inner`
   */
  piece?: boolean;
  /**
   * For a piece: what it belongs to, for the palette ("a sketch" if not said)
   */
  partOf?: string;
  /**
   * The word and the fields say it all: a model with a small window is not told
   * the hint
   */
  plain?: boolean;
  /**
   * For a block that moves what is inside it (transform, mirror): move the
   * points and faces drawn for the shapes inside the same way (change them in
   * place, or `add` new ones). They are only for looking at, so they are only
   * as exact as the move is simple.
   */
  moveOverlays?: (a: BlockArgs, overlays: Overlay[], add: (o: Overlay) => void) => void;
  /**
   * A button at the end of the block's header, shown while `when` is true:
   * pressing it asks for `id` to be done for this block
   */
  button?: { id: string; label: string; when: (block: Block) => boolean };
  /**
   * Fields that only change how the block is shown, not what the program makes
   * (the points and faces of a solid shown in the view): changing one is not an
   * edit to the design
   */
  viewOnly?: readonly string[];
  /**
   * A piece that is a fixed part of its parent: made with it, not in the
   * palette, and it cannot be pulled out (the sections of a solid, the ends of
   * a loft)
   */
  automatic?: boolean;
  /**
   * Its header starts with a number badge: how many of its kind come before it
   * in its block, plus one, after this prefix (the vertices of a solid, which
   * faces refer to, are 1 2 3; the faces are f1 f2 f3)
   */
  numbered?: string;
  /**
   * The block only reports on what is inside it and passes it through unchanged
   * (measure): it has no eye or power switch, and a "?" shows what it found
   */
  observer?: boolean;
  /**
   * The block changes the shapes inside it (transform, round, fillet, ...)
   * rather than making or combining them. It has a power switch
   * (`Block.disabled`) besides its eye: disabled, it does nothing and the
   * shapes inside pass through as they were.
   */
  modifier?: boolean;
  /**
   * A shorter hint, for a model with a small window (used instead of `hint`; a
   * block with neither is told nothing)
   */
  short?: string;
  /** For a block that does something but makes no shape (`set`) */
  run?: (env: Env, a: BlockArgs) => void;
  /**
   * For a block that is a shape: build it. `kids` are the shapes inside. Null
   * means "nothing to show" (hide).
   */
  make?: (env: Env, a: BlockArgs, kids: Shape[]) => Shape | null;
  /**
   * For a block that makes a flat shape (rectangle, circle, polygon, text): the
   * outlines it stands for
   */
  sketch?: (env: Env, a: BlockArgs) => SketchShape | SketchShape[];
}

/**
 * A command as it is written in the table: everything but its
 * color, which `finished` fills in from its category, or from
 * `COLOR_OVERRIDES`.
 */
export type CommandEntry = Omit<CommandDef, "color">;

/**
 * May a block of this kind be hidden (the eye)? Only a block that makes a shape
 * of its own can be: not one that sets a variable, one that only reports on what
 * is inside it, or a piece of a bigger block.
 *
 * @param def The command the block is of.
 */
export function canHide(def: CommandDef): boolean {
  return !!def.make && !def.observer && !def.piece;
}

/**
 * May a block of this kind be switched off (the power switch)? Only a block
 * that changes what is inside it can be: switched off, the shapes inside pass
 * through as they were.
 *
 * @param def The command the block is of.
 */
export function canDisable(def: CommandDef): boolean {
  return def.modifier === true;
}

/**
 * What a block that works on flat shapes (extrude, revolve, a loft's ends, a
 * sweep) may hold: the blocks that can make or change a flat shape
 */
export const FLAT_SHAPES = ["set", "repeat", "if", "use", "rectangle", "circle", "polygon", "text", "transform", "mirror", "round", "union", "intersect", "subtract"] as const;

/**
 * Every kind of block that makes a shape, or sets a variable: what a block that
 * holds shapes may hold
 */
export const SHAPES = ["set", "repeat", "if", "use", "import", "box", "cylinder", "sphere", "solid", "rectangle", "circle", "polygon", "text", "extrude", "revolve", "loft", "sweep", "transform", "mirror", "round", "fillet", "chamfer", "shell", "measure", "union", "intersect", "subtract", "lineUp", "placeAgainst"] as const;

/**
 * A program may build at most this many blocks in all, counting every pass of
 * every repeat (a run stops there)
 */
export const MAX_BUILT_BLOCKS = 5000;

/**
 * The blocks that hold a list of points, by kind of holder, with the kind of
 * block that is one point of the list: a polygon's `point`, a solid's section
 * of `vertex` blocks, and a sweep's path (its `vertex` blocks, beside the flat
 * shape it carries). `repeat`, `if` and `set` may be used in such a list to
 * make the points: see `POINT_LIST_FLOW`.
 */
export const POINT_HOLDERS: Readonly<Record<string, string>> = { polygon: "point", vertices: "vertex", sweep: "vertex" };

/**
 * The blocks that pass a list of points through, inside a block that holds one:
 * a `repeat` makes its points again for each pass, an `if` chooses between its
 * own points and its else block's, and an `else` holds the points of the other
 * branch.
 */
export const POINT_LIST_FLOW: readonly string[] = ["repeat", "if", "else"];
