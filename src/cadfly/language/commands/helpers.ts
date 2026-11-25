/**
 * What commands share: constructors for the fields of a block (`expr`, `text`,
 * `choice`, ...), and the code that several kinds of block use to build shapes
 * (merging the shapes inside a block, drawing a flat shape from its sketch,
 * reading the vertices and faces of a solid, and so on).
 *
 * A helper that only one palette tab uses stays with that tab's commands.
 */

import type { Flat, Solid, Vec3 } from "../../geometry/kernel";
import { FontError } from "../../geometry/fonts";
import { type SketchShape, SketchError, shapeToContour, shapeToContours } from "../../geometry/sketch";
import { BlockArgs, Env, ProgramError } from "../env";
import { type Block, type FlatPiece, type Param, type Shape, isFlat } from "../types";
import { commandById } from "./lookup";
import { MAX_BUILT_BLOCKS, POINT_LIST_FLOW } from "./types";

/** A field that holds a number, or arithmetic using variables */
export function expr(id: string, label: string, def: string): Param {
  return { id, label, type: { kind: "expr" }, default: def };
}

/** The optional label of a block, which has no name shown before it */
export function caption(id: string): Param {
  return { id, label: "", type: { kind: "caption" }, default: "" };
}

/** A field that holds free text */
export function text(id: string, label: string, def: string): Param {
  return { id, label, type: { kind: "text" }, default: def };
}

/**
 * A tick. Off at first, unless `on` (a tick that is on at first is written in
 * block text only when it is turned off: show=false)
 */
export function flag(id: string, label: string, on = false): Param {
  return { id, label, type: { kind: "flag" }, default: on };
}

/**
 * A field that is one of a fixed list. Each option is shown as it is kept.
 *
 * @param options The values to choose from.
 * @param def The one chosen at first (default: the first).
 */
export function choice(id: string, label: string, options: string[], def = options[0]): Param {
  return {
    id,
    label,
    type: { kind: "choice", options: options.map((value) => ({ value, label: value })) },
    default: def,
  };
}

/**
 * The outlines a block that draws a flat shape stands for, checked to be
 * usable. Throws a ProgramError, against the block, for text that cannot be
 * drawn (`FontError`) or an outline that cannot be made (`SketchError`).
 */
export function sketchShapes(env: Env, block: Block): SketchShape[] {
  const def = commandById(block.kind)!;
  let made: SketchShape | SketchShape[];
  try {
    made = def.sketch!(env, new BlockArgs(env, block, def));
  } catch (e) {
    if (e instanceof FontError) throw new ProgramError(block.id, e.message);
    throw e;
  }
  const all = Array.isArray(made) ? made : [made];
  try {
    all.forEach((s) => shapeToContour(s));
  } catch (e) {
    if (e instanceof SketchError) throw new ProgramError(block.id, e.message);
    throw e;
  }
  return all;
}

/**
 * A flat shape made of one piece: `pieces` is just the shape itself, so the view
 * draws no outlines besides the shape's own.
 *
 * @param flat The shape.
 * @param hole Is it a hole, to be cut out of the flat shapes beside it?
 */
export function singlePiece(flat: Flat, hole?: boolean): FlatPiece {
  return { kind: "flat", flat, ...(hole ? { hole: true as const } : {}), pieces: [flat] };
}

/**
 * The flat shape that a block like rectangle or text draws: its outlines (the
 * letters of a text are several), joined, and marked `hole` if the block is
 */
export function drawFlat(env: Env, block: Block, a: BlockArgs): FlatPiece {
  const k = env.kernel;
  const flat = sketchShapes(env, block)
    .map((s) => k.flat(shapeToContours(s)))
    .reduce((x, y) => k.flatUnion(x, y));
  return singlePiece(flat, a.flag("hole"));
}

/**
 * The blocks an `if` uses this time: the ones inside it when its condition is
 * true, else what its else block holds. Only the chosen branch is looked at, so
 * the other may be wrong without harm. Throws a ProgramError, against the
 * second else, if the `if` has more than one.
 *
 * @param a The arguments of the `if` block.
 */
export function chosenBranch(a: BlockArgs): Block[] {
  const inside = a.block.inner ?? [];
  const elses = inside.filter((k) => k.kind === "else");
  if (elses.length > 1) throw new ProgramError(elses[1].id, "an if can have only one else");
  return a.truth("condition") ? inside.filter((k) => k.kind !== "else") : (elses[0]?.inner ?? []);
}

/**
 * Does this block make points of the given kind: is it one, or a `repeat` or
 * `if` with one inside it, at any depth?
 *
 * @param block The block.
 * @param kind The kind of point (`point` or `vertex`).
 */
export function makesPoints(block: Block, kind: string): boolean {
  return block.kind === kind || (POINT_LIST_FLOW.includes(block.kind) && (block.inner ?? []).some((k) => makesPoints(k, kind)));
}

/**
 * The points a list of blocks makes, in order. A block of the given kind is one
 * point, read with `read`. A `repeat` makes its points again for each pass,
 * with its counter set to the number of the pass; an `if` makes the points of
 * the branch its condition chooses; a `set` sets a variable for the blocks
 * after it (inside the list that has it, and gone when the list ends). So a
 * list of blocks can describe an outline with a formula, such as the corners
 * of a gear.
 *
 * Every block looked at counts toward the limit on what a program may build
 * (`MAX_BUILT_BLOCKS`), so that a repeat inside a repeat cannot make a run that
 * never ends. A problem is reported on the block that has it.
 *
 * @param env What the program has built and set so far.
 * @param holder The block that holds the list (the limit is reported on it).
 * @param blocks The blocks to read.
 * @param kind The kind of block that is a point (`point` or `vertex`).
 * @param read How to read one such block.
 */
export function piecesIn<T>(env: Env, holder: Block, blocks: Block[], kind: string, read: (block: Block) => T): T[] {
  const found: T[] = [];
  const repeatDef = commandById("repeat")!;
  const ifDef = commandById("if")!;
  const setDef = commandById("set")!;
  /** Read one list of blocks, in the scope that is in force. */
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (++env.blocksBuilt > MAX_BUILT_BLOCKS) throw new ProgramError(holder.id, `the program has built more than ${MAX_BUILT_BLOCKS} blocks: check how many times it repeats`);
      if (b.kind === kind) found.push(read(b));
      else if (b.kind === "set") setDef.run!(env, new BlockArgs(env, b, setDef));
      else if (b.kind === "repeat") {
        const { counter, times } = repeatDef.loop!(env, new BlockArgs(env, b, repeatDef));
        // the counter is its own variable for each pass, and gone afterwards
        for (let pass = 0; pass < times; pass++) {
          env.inNewScope(() => {
            env.scope.set(counter, pass);
            walk(b.inner ?? []);
          });
        }
      } else if (b.kind === "if") env.inNewScope(() => walk(chosenBranch(new BlockArgs(env, b, ifDef))));
      else throw new ProgramError(b.id, `a ${commandById(b.kind)?.word ?? b.kind} block cannot be among the ${kind} blocks of ${commandById(holder.kind)?.word ?? holder.kind}`);
    }
  };
  env.inNewScope(() => walk(blocks));
  return found;
}

/**
 * The corner points in a block (a solid's vertices section, or a sweep's path):
 * its vertex blocks, in order, including the ones that a `repeat` or `if` makes.
 *
 * @param a The arguments of the block that asks (errors are reported on it).
 * @param least The fewest points that make sense (4 for a solid, 2 for a path).
 * @param holder The block that holds the vertex blocks (default: the same one).
 */
export function verticesOf(env: Env, a: BlockArgs, least = 4, holder: Block = a.block): Vec3[] {
  const def = commandById("vertex")!;
  // a sweep holds a flat shape too (and its own repeats and ifs of shapes): only what makes vertices is the path
  const blocks = (holder.inner ?? []).filter((k) => holder.kind !== "sweep" || makesPoints(k, "vertex"));
  const points = piecesIn(env, holder, blocks, "vertex", (k) => {
    const va = new BlockArgs(env, k, def);
    return [va.num("x"), va.num("y"), va.num("z")] as Vec3;
  });
  if (points.length < least) throw new ProgramError(holder.id, `put at least ${least} vertex blocks inside (there ${points.length === 1 ? "is" : "are"} ${points.length})`);
  return points;
}

/**
 * The shapes inside a block, merged into one: the usual meaning of "the shapes
 * inside". Solids are joined. Flat shapes are joined, and any that are marked
 * `hole` are cut out of the others; if all of them are holes the result is one
 * hole, to be cut from something further out (a repeat of holes inside an
 * extrude). A block cannot hold both kinds.
 *
 * Throws a ProgramError, against the block, if there are no shapes, if the
 * kinds are mixed, or if the holes remove everything.
 */
export function merged(env: Env, a: BlockArgs, kids: Shape[]): Shape {
  if (!kids.length) throw new ProgramError(a.block.id, "put at least one shape inside this block");
  const k = env.kernel;
  const flats = kids.filter(isFlat);
  const solids = kids.filter((x): x is Solid => !isFlat(x));
  if (flats.length && solids.length) throw new ProgramError(a.block.id, "this block holds both flat shapes (rectangle, circle, ...) and 3D shapes: extrude the flat ones first");
  if (solids.length) return solids.reduce((x, y) => k.union(x, y));
  const add = flats.filter((f) => !f.hole);
  const cut = flats.filter((f) => f.hole);
  /** The union of the flat shapes in a list. */
  const join = (list: typeof flats) => list.map((f) => f.flat).reduce((x, y) => k.flatUnion(x, y));
  if (!add.length) return singlePiece(join(cut), true);
  // the pieces the shapes were put together from are kept (as they were before
  // any holes were cut): the view draws their outlines when there are several
  const pieces = add.flatMap((f) => f.pieces);
  if (!cut.length) {
    const flat = join(add);
    return { kind: "flat", flat, pieces: pieces.length > 1 ? pieces : [flat] };
  }
  const left = k.flatSubtract(join(add), join(cut));
  if (left.isEmpty()) throw new ProgramError(a.block.id, "the holes remove everything");
  return { kind: "flat", flat: left, pieces: pieces.length > 1 ? pieces : [left] };
}

/**
 * The shapes inside a block merged, which must be 3D: for the
 * blocks that only work on solids
 */
export function mergedSolid(env: Env, a: BlockArgs, kids: Shape[]): Solid {
  return solidOnly(a, merged(env, a, kids));
}

/**
 * The shape as a solid. Throws a ProgramError, against the block, for a flat
 * shape, which the block cannot work on.
 */
export function solidOnly(a: BlockArgs, shape: Shape): Solid {
  if (isFlat(shape)) throw new ProgramError(a.block.id, `a ${commandById(a.block.kind)?.word ?? a.block.kind} block works on 3D shapes: extrude the flat shape first`);
  return shape;
}

/**
 * For a block whose first shape inside is the base and the rest are what is
 * done to it or with it (subtract, align, place against): split them. Gives
 * `{ base, rest }`, or `{ done }` when there is nothing to do and `done` is the
 * result of the block (null for nothing): when an eye is shut on one of the
 * shapes inside, the block carries on with what is left, because that is what
 * the eye is for.
 *
 * Throws a ProgramError if there are fewer than two shapes.
 *
 * @param what What is done with the rest ("cut out of it"), for the message.
 * @param whenBaseHidden What a block whose base has its eye shut gives: nothing
 *                       (the others have nothing to cut) or the rest, merged
 *                       (nothing to line them up with, but they are still
 *                       shapes).
 */
export function baseAndRest(env: Env, a: BlockArgs, kids: Shape[], what: string, whenBaseHidden: "nothing" | "merged"): { base: Shape; rest: Shape[] } | { done: Shape | null } {
  // with the eye shut on a shape inside, carry on with what is left rather than
  // complain: that is what the eye is for (see what the cutter does by hiding
  // it). A hidden base leaves nothing to cut, or nothing to line the others up
  // with.
  const makers = (a.block.inner ?? []).filter((k) => commandById(k.kind)?.make);
  const gone = makers.filter((k) => k.hidden === true);
  if (gone.length) {
    if (gone.includes(makers[0])) return { done: whenBaseHidden === "merged" && kids.length ? merged(env, a, kids) : null };
    if (kids.length < 2) return { done: kids[0] ?? null };
  }
  if (kids.length < 2) throw new ProgramError(a.block.id, `put at least two shapes inside: the first is the base, the others are ${what}`);
  return { base: kids[0], rest: kids.slice(1) };
}
