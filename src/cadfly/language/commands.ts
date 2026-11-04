import type { Flat, Solid, Vec2 } from "../geometry/kernel";
import { PolyhedronError, hullFaces, parseCorners, polyhedronSolid } from "../geometry/polyhedron";
import { FONT_NAMES, FontError, textShapes } from "../geometry/fonts";
import { type PlaneName, type SketchShape, SketchError, onPlane, shapeToContour, shapeToContours } from "../geometry/sketch";
import { loft, sweep, SweepError } from "../geometry/sweep";
import { polygonArea } from "../geometry/vec";
import { type Axis, lineUp, placeAgainst } from "./arrange";
import { FinishError, finishEdges, hollow } from "./finish";
import { evaluateExpr, ExprError, RESERVED } from "../geometry/expr";
import { meshFromBase64 } from "../geometry/stl";
import { Args, Env, type Overlay, ProgramError, VARIABLE_NAME } from "./env";
import { type Block, type Category, type FlatPiece, type Param, type Shape, isFlat } from "./types";

/**
 * Commands: the kinds of block a program can be made of.
 *
 * A command is one kind of block: its word, its fields (`params`), and what it
 * builds. `COMMANDS` lists them all, and is the one place that says what a
 * block is. The editor draws its palette and its blocks from it, the runner
 * (`run.ts`) calls each command's `run` or `make`, the file format and the
 * assistant check programs against it, and the model is told about the blocks
 * from each one's `hint` or `short`. So adding a command here adds a block
 * everywhere.
 *
 * The file has four parts: the helpers that commands share (merging shapes,
 * sketches, finishing steps); `ENTRIES`, the table with one entry for each
 * command; `finished`, which turns each entry into a command for `COMMANDS`
 * (the color derived from the category, the fields that stay quiet, the
 * modifiers, the sketches, and which fields a partly exposed block shows); and
 * the lookups `commandById` and `blankBlock`.
 *
 * What a command builds: a program is a tree. A block with `make` builds one
 * shape, either a solid or a flat shape in its own u, v plane. If it builds its
 * inner blocks (`buildsInner`), the shapes inside are built first and handed
 * to `make` as `kids`, and `make` merges or changes them into the one shape
 * the block stands for (see `merged`). A block with `run` builds nothing, and
 * only sets something up (a variable, a part). A block with `sketch` is a flat
 * shape drawn from its fields (see `drawFlat`).
 */

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
  /** The color of the block: its category's, unless the entry says otherwise */
  color: string;
  /** The block's fields, in the order they are drawn */
  params: Param[];
  /** The kinds of block that may sit inside this one (a C-shaped block) */
  inner?: readonly string[];
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
  loop?: (env: Env, a: Args) => { counter: string; times: number };
  /**
   * The first shape inside is the base (the others are cut from it, or moved to
   * it): the editor labels it
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
   * What the block shows when it is only *partly* exposed (see modes.ts): the
   * ids of the fields still offered, in the order they are drawn. The others
   * keep their values (the defaults, for a new block). Leave it out and partial
   * means every field; an empty list hides them all, which also hides the
   * caption.
   */
  partial?: readonly string[];
  /**
   * For a block that moves what is inside it (transform, mirror): move the
   * points and faces drawn for the shapes inside the same way (change them in
   * place, or `add` new ones). They are only for looking at, so they are only
   * as exact as the move is simple.
   */
  moveOverlays?: (a: Args, overlays: Overlay[], add: (o: Overlay) => void) => void;
  /**
   * A button at the end of the block's header, shown while `when` is true:
   * pressing it asks the app to do `id` for this block (see cadfly.ts)
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
  run?: (env: Env, a: Args) => void;
  /**
   * For a block that is a shape: build it. `kids` are the shapes inside. Null
   * means "nothing to show" (hide).
   */
  make?: (env: Env, a: Args, kids: Shape[]) => Shape | null;
  /**
   * For a block that makes a flat shape (rectangle, circle, polygon, text): the
   * outlines it stands for
   */
  sketch?: (env: Env, a: Args) => SketchShape | SketchShape[];
}

/**
 * The color of the blocks about variables (set, measure), which are in the Code
 * tab. The tab holds control blocks, parts included, in yellow, and its tab is
 * the yellow.
 */
const VARIABLE_COLOR = "#e67e22";

/** The color of the blocks of each category, which is also its tab's */
const CATEGORY_COLORS: Record<Category, string> = {
  code: "#d4a017",
  shapes: "#2f7fe0",
  sketch: "#8e44ad",
  place: "#2fb34a",
  combine: "#d9363e",
};

// ---- small constructors for parameters ----

/** A field that holds a number, or arithmetic using variables */
function expr(id: string, label: string, def: string): Param {
  return { id, label, type: { kind: "expr" }, default: def };
}

/** The optional label of a block, which has no name shown before it */
function caption(id: string): Param {
  return { id, label: "", type: { kind: "caption" }, default: "" };
}

/** A field that holds free text */
function text(id: string, label: string, def: string): Param {
  return { id, label, type: { kind: "text" }, default: def };
}

/**
 * A tick. Off at first, unless `on` (a tick that is on at first is written in
 * block text only when it is turned off: show=false)
 */
function flag(id: string, label: string, on = false): Param {
  return { id, label, type: { kind: "flag" }, default: on };
}

/**
 * A field that is one of a fixed list. Each option is shown as it is kept.
 *
 * @param options The values to choose from.
 * @param def The one chosen at first (default: the first).
 */
function choice(id: string, label: string, options: string[], def = options[0]): Param {
  return {
    id,
    label,
    type: { kind: "choice", options: options.map((value) => ({ value, label: value })) },
    default: def,
  };
}

/** The planes a sketch can be drawn on, as the choices of a block's `plane` */
const PLANES: PlaneName[] = ["XY", "XZ", "YZ"];
/** The position of each axis name in an (x, y, z) triple */
const AXIS_INDEX: Record<string, Axis> = { x: 0, y: 1, z: 2 };

/**
 * The outlines a block that draws a flat shape stands for, checked to be
 * usable. Throws a ProgramError, against the block, for text that cannot be
 * drawn (`FontError`) or an outline that cannot be made (`SketchError`).
 */
function sketchShapes(env: Env, block: Block): SketchShape[] {
  const def = commandById(block.kind)!;
  let made: SketchShape | SketchShape[];
  try {
    made = def.sketch!(env, new Args(env, block, def));
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
 * The flat shape that a block like rectangle or text draws: its outlines (the
 * letters of a text are several), joined, and marked `hole` if the block is
 */
function drawFlat(env: Env, block: Block, a: Args): FlatPiece {
  const k = env.kernel;
  const flat = sketchShapes(env, block)
    .map((s) => k.flat(shapeToContours(s)))
    .reduce((x, y) => k.flatUnion(x, y));
  return { kind: "flat", flat, ...(a.flag("hole") ? { hole: true as const } : {}) };
}

/**
 * The corner points in a block (a solid's vertices section, or a sweep's path):
 * its vertex blocks, in order.
 *
 * @param a The arguments of the block that asks (errors are reported on it).
 * @param least The fewest points that make sense (4 for a solid, 2 for a path).
 * @param holder The block that holds the vertex blocks (default: the same one).
 */
function verticesOf(env: Env, a: Args, least = 4, holder: Block = a.block): [number, number, number][] {
  const def = commandById("vertex")!;
  const points = (holder.inner ?? []).filter((k) => k.kind === "vertex").map((k) => {
    const va = new Args(env, k, def);
    return [va.num("x"), va.num("y"), va.num("z")] as [number, number, number];
  });
  if (points.length < least) throw new ProgramError(holder.id, `put at least ${least} vertex blocks inside (there ${points.length === 1 ? "is" : "are"} ${points.length})`);
  return points;
}

/**
 * The faces in a solid's faces section: the vertex numbers of each face block,
 * in the order given (around the face, in either direction). Fails, against the
 * face block, for a face that has fewer than 3 vertices, names one that does
 * not exist, or lists one twice.
 *
 * @param points The solid's vertices, which the face numbers refer to (from 1).
 */
function facesOf(env: Env, holder: Block, points: [number, number, number][]): number[][] {
  const def = commandById("face")!;
  return (holder.inner ?? []).filter((k) => k.kind === "face").map((k) => {
    const fa = new Args(env, k, def);
    let corners: number[];
    try {
      corners = parseCorners(fa.text("corners"));
    } catch (e) {
      return fa.fail("corners", (e as Error).message);
    }
    if (corners.length < 3) fa.fail("corners", "a face needs at least 3 vertex numbers");
    const bad = corners.find((c) => c < 1 || c > points.length);
    if (bad !== undefined) fa.fail("corners", `vertex ${bad} does not exist: the vertices are numbered 1 to ${points.length}`);
    if (new Set(corners).size !== corners.length) fa.fail("corners", "lists a vertex twice");
    return corners;
  });
}

/**
 * The optional parts of a sketch shape: only what differs from the default (the
 * rotation, and whether it is a hole)
 */
function extras(a: Args) {
  const angle = a.num("rotate");
  return { ...(angle ? { angle } : {}), ...(a.flag("hole") ? { hole: true as const } : {}) };
}

/**
 * The outlines a loft end or a sweep profile draws: what its blocks build, as
 * one flat shape, as outer outlines (counter-clockwise) and holes (clockwise).
 *
 * @param block The block the problems are reported against.
 * @param kids The blocks that draw the shape (the ones inside `block`).
 * @param what How to refer to the block in a message ("the bottom").
 */
function profileOf(env: Env, block: Block, kids: Block[], what: string): { outers: Vec2[][]; holes: Vec2[][] } {
  const shapes = env.buildBlocks(kids);
  if (!shapes.length) throw new ProgramError(block.id, `put a rectangle, circle or polygon inside ${what}`);
  const a = new Args(env, block, commandById(block.kind)!);
  const flat = flatOf(env, a, shapes, what);
  const rings = flat.flat.polygons();
  return { outers: rings.filter((r) => polygonArea(r) > 0), holes: rings.filter((r) => polygonArea(r) < 0) };
}

/**
 * Run a loft or sweep, and report what is wrong with it (a `SweepError`)
 * against this block
 */
function swept<T>(a: Args, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof SweepError) throw new ProgramError(a.block.id, e.message);
    throw e;
  }
}

/**
 * The fields that say where a shape goes: its bottom center (x, y, and z for
 * how high its base is)
 */
function positionParams(): Param[] {
  return [expr("x", "at x", "0"), expr("y", "y", "0"), expr("z", "z", "0")];
}

/**
 * How many sides the curve of a cylinder or sphere has. A circle of 48 sides
 * has 99.71% of a true circle's area.
 */
const CURVE_SEGMENTS = 48;

/**
 * Put a shape where its position fields say: resting on the ground (its lowest
 * point at z = 0), centered in x and y, then moved by x y z
 */
function sitAt(env: Env, a: Args, solid: Solid): Solid {
  const { min, max } = solid.bounds();
  return env.kernel.place(solid, { position: [a.num("x") - (min[0] + max[0]) / 2, a.num("y") - (min[1] + max[1]) / 2, a.num("z") - min[2]] });
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
export const SHAPES = ["set", "repeat", "if", "define", "use", "import", "box", "cylinder", "sphere", "solid", "rectangle", "circle", "polygon", "text", "extrude", "revolve", "loft", "sweep", "transform", "mirror", "round", "fillet", "chamfer", "shell", "measure", "union", "intersect", "subtract", "lineUp", "placeAgainst"] as const;

/**
 * Run a finishing step (round, shell, ...), and report what is wrong with it (a
 * `FinishError`) against this block
 */
function finish<T>(a: Args, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof FinishError) throw new ProgramError(a.block.id, e.message);
    throw e;
  }
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
function merged(env: Env, a: Args, kids: Shape[]): Shape {
  if (!kids.length) throw new ProgramError(a.block.id, "put at least one shape inside this block");
  const k = env.kernel;
  const flats = kids.filter(isFlat);
  const solids = kids.filter((x): x is Solid => !isFlat(x));
  if (flats.length && solids.length) throw new ProgramError(a.block.id, "this block holds both flat shapes (rectangle, circle, ...) and 3D shapes: extrude the flat ones first");
  if (solids.length) return solids.reduce((x, y) => k.union(x, y));
  const add = flats.filter((f) => !f.hole);
  const cut = flats.filter((f) => f.hole);
  const join = (list: typeof flats) => list.map((f) => f.flat).reduce((x, y) => k.flatUnion(x, y));
  if (!add.length) return { kind: "flat", flat: join(cut), hole: true };
  const pieces = add.length > 1 ? add.flatMap((f) => f.pieces ?? [f.flat]) : add[0].pieces;
  const kept = pieces ? { pieces } : {};
  if (!cut.length) return { kind: "flat", flat: join(add), ...kept };
  const left = k.flatSubtract(join(add), join(cut));
  if (left.isEmpty()) throw new ProgramError(a.block.id, "the holes remove everything");
  return { kind: "flat", flat: left, ...kept };
}

/**
 * The shapes inside a block merged (see `merged`), which must be 3D: for the
 * blocks that only work on solids
 */
function mergedSolid(env: Env, a: Args, kids: Shape[]): Solid {
  return solidOnly(a, merged(env, a, kids));
}

/**
 * The shape as a solid. Throws a ProgramError, against the block, for a flat
 * shape, which the block cannot work on.
 */
function solidOnly(a: Args, shape: Shape): Solid {
  if (isFlat(shape)) throw new ProgramError(a.block.id, `a ${commandById(a.block.kind)?.word ?? a.block.kind} block works on 3D shapes: extrude the flat shape first`);
  return shape;
}

/**
 * The flat shape that the blocks inside make, for a block that turns flat
 * shapes into solids (extrude, revolve, loft, sweep). Throws a ProgramError if
 * there is nothing inside, a 3D shape, or only holes.
 *
 * @param what How to refer to the block in a message ("this block").
 */
function flatOf(env: Env, a: Args, kids: Shape[], what: string): FlatPiece {
  if (!kids.length) throw new ProgramError(a.block.id, `put a rectangle, circle or polygon inside ${what}`);
  const shape = merged(env, a, kids);
  if (!isFlat(shape)) throw new ProgramError(a.block.id, `${what} needs flat shapes (rectangle, circle, polygon, text) inside, but it holds a 3D shape`);
  if (shape.hole) throw new ProgramError(a.block.id, "there needs to be at least one shape that is not a hole");
  return shape;
}

/**
 * How thick the sketch of a hidden extrude or revolve is drawn, in mm: enough
 * to see
 */
const SKETCH_THICKNESS = 0.3;

/**
 * A block whose eye is shut still shows what it was working on: the sketch
 * inside an extrude or revolve, as a thin slab on its plane (which the view
 * draws as an overlay). Does nothing for a block whose eye is open.
 */
function showSketch(env: Env, a: Args, sketch: FlatPiece) {
  if (a.block.hidden !== true) return;
  const slab = (f: Flat, thickness: number) => onPlane(env.kernel, env.kernel.extrudeFlat(f, thickness), a.text("plane") as PlaneName, a.num("offset"));
  // each piece is a little taller than the one before, so its outline is
  // drawn above it
  const pieces = (sketch.pieces ?? []).map((f, i) => slab(f, SKETCH_THICKNESS * (1.3 + i * 0.3)));
  env.overlays.push({ kind: "sketch", blockId: a.block.id, solid: slab(sketch.flat, SKETCH_THICKNESS), pieces });
}

/**
 * For a flat shape, a number field that has no meaning in 2D must have its
 * neutral value (move z = 0, scale z = 1): otherwise the field is refused, with
 * `why`
 */
function onlyPlane(a: Args, id: string, neutral: number, why: string) {
  const v = a.num(id);
  if (v !== neutral) a.fail(id, `${why} (it is ${v})`);
}

/**
 * A part may be used inside another this many levels deep: it stops a part that
 * uses itself with no way to stop
 */
const MAX_PART_DEPTH = 16;

/**
 * Split "a, max(1, 2), c" at the commas that are not inside brackets (an empty
 * text is no values at all)
 */
function splitValues(text: string): string[] {
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
 * The names in an `inputs` field: "w, h". Fails, against the field, for a text
 * that is not a name, a reserved word, or a name used twice.
 */
function inputNames(a: Args): string[] {
  const names = splitValues(a.text("inputs"));
  names.forEach((n) => {
    if (!VARIABLE_NAME.test(n)) a.fail("inputs", `"${n}" is not a name: use letters, digits and _, starting with a letter, separated by commas`);
    if (RESERVED.has(n)) a.fail("inputs", `"${n}" cannot be an input name`);
  });
  if (new Set(names).size !== names.length) a.fail("inputs", "an input name is used twice");
  return names;
}

/** One block may repeat at most this many times */
const MAX_PASSES = 1000;

/**
 * A program may build at most this many blocks in all, counting every pass of
 * every repeat (`run.ts` stops it there)
 */
export const MAX_STEPS = 5000;

/**
 * For a block whose first shape inside is the base and the rest are what is
 * done to it or with it (subtract, line up, place against): split them. Gives
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
function baseAndRest(env: Env, a: Args, kids: Shape[], what: string, whenBaseHidden: "nothing" | "merged"): { base: Shape; rest: Shape[] } | { done: Shape | null } {
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

/**
 * A command as it is written in the table: the color is its category's, unless
 * it says otherwise
 */
type CommandEntry = Omit<CommandDef, "color"> & { color?: string };

/**
 * The table of commands, in the order of the palette within each tab. Each
 * entry is a `CommandDef` (see above) without its color, and is the whole
 * definition of one block: its fields, what may go inside it, and `make`,
 * `run` or `sketch` for what it builds. Each entry is made into a command by
 * `finished`, after the table, to make `COMMANDS`.
 */
const ENTRIES: readonly CommandEntry[] = [
  // ---- variables ----
  /**
   * Sets a variable to a number. It builds no shape: `run` works out the value
   * when the block is reached, so the blocks after it (and the parts defined
   * after it) see the variable. The name may not be a reserved word.
   */
  {
    id: "set",
    hint: "a number variable, like width",
    plain: true,
    word: "set",
    category: "code",
    color: VARIABLE_COLOR,
    params: [{ id: "name", label: "", type: { kind: "var" }, default: "width" }, expr("value", "=", "40")],
    run: (env, a) => {
      const name = a.variableName("name");
      env.vars.set(name, a.num("value"));
    },
  },

  // ---- a part from a file ----
  /**
   * A part from an STL file that the project carries, as a solid. The file is
   * read once and kept for the rest of the run (`env.fileSolids`), then scaled
   * (25.4 turns inches into mm) and set on the ground like the other shapes.
   * Fails, against the file field, if none is chosen, if there is no file of
   * that name, or if it cannot be read.
   */
  {
    id: "import",
    hint: "a part from a project STL file (choose Import STL file... in its file list to add one); scale 25.4 is inches; it sits on the ground, its bottom center at x y z",
    short: "a part from a project STL file; scale 25.4 is inches",
    word: "import",
    category: "shapes",
    params: [{ id: "file", label: "", type: { kind: "file" }, default: "" }, expr("scale", "scale", "1"), ...positionParams()],
    make: (env, a) => {
      const name = a.text("file");
      const have = Object.keys(env.files);
      if (!name) a.fail("file", have.length ? `choose a file (${have.join(", ")})` : "choose a file (open its file list and choose \"Import STL file...\")");
      const data = env.files[name];
      if (data === undefined) a.fail("file", `there is no file called "${name}"` + (have.length ? ` (the files are ${have.join(", ")})` : " (open its file list and choose \"Import STL file...\" to add one)"));
      let solid = env.fileSolids.get(name);
      if (!solid) {
        try {
          solid = env.kernel.fromMesh(meshFromBase64(data!));
        } catch (e) {
          a.fail("file", (e as Error).message);
        }
        env.fileSolids.set(name, solid!);
      }
      const factor = a.positive("scale");
      return sitAt(env, a, factor === 1 ? solid! : env.kernel.scale(solid!, factor));
    },
  },

  // ---- repeating ----
  /**
   * Builds what is inside once for each pass and merges the results. `loop`
   * gives the counter (a variable that exists only inside the block, and is 0,
   * 1, 2, ... in turn) and the number of passes, which must be a whole number
   * up to `MAX_PASSES`. `run.ts` does the repeating. Builds nothing if there is
   * nothing inside.
   */
  {
    id: "repeat",
    hint: "builds what is inside again and again, counting 0, 1, 2, ... in the counter variable; results are merged",
    short: "repeats what is inside, counting 0, 1, 2... in the counter variable",
    word: "repeat",
    category: "code",
    params: [expr("times", "", "3"), { id: "counter", label: "times, counting with", type: { kind: "var" }, default: "i" }],
    inner: SHAPES,
    buildsInner: true,
    loop: (_env, a) => {
      const times = a.num("times");
      if (!Number.isInteger(times) || times < 0) a.fail("times", `must be a whole number, 0 or more (it is ${times})`);
      if (times > MAX_PASSES) a.fail("times", `is too many: at most ${MAX_PASSES} passes of one block`);
      return { counter: a.variableName("counter"), times };
    },
    make: (env, a, kids) => (kids.length ? merged(env, a, kids) : null),
  },

  /**
   * Builds the shapes inside when the condition is true, and the shapes of its
   * else block when it is false. It chooses before building, so the branch not
   * taken is never built and may be wrong, or never end, without harm. The
   * condition must be a yes/no (see `evaluateExpr`). An if may have only one
   * else.
   */
  {
    id: "if",
    hint: "builds the shapes inside only when the condition is true: a comparison like i % 2 == 0, or true or false; an else block inside holds what is built when it is false",
    short: "builds the shapes inside when the condition is true; its else block when it is false",
    word: "if",
    category: "code",
    params: [expr("condition", "", "true")],
    inner: [...SHAPES, "else"],
    make: (env, a) => {
      const inside = a.block.inner ?? [];
      const elses = inside.filter((k) => k.kind === "else");
      if (elses.length > 1) throw new ProgramError(elses[1].id, "an if can have only one else");
      // only the branch that is taken is built: the other may be wrong (or
      // never end) without harm
      const chosen = a.truth("condition") ? inside.filter((k) => k.kind !== "else") : (elses[0]?.inner ?? []);
      const kids = chosen.length ? env.buildBlocks(chosen) : [];
      return kids.length ? merged(env, a, kids) : null;
    },
  },
  /** The part of an if that is built when its condition is false */
  {
    id: "else",
    hint: "inside an if: holds what is built when the condition is false",
    plain: true,
    word: "else",
    category: "code",
    piece: true,
    partOf: "an if",
    params: [],
    inner: SHAPES,
  },

  // ---- parts: make a shape once, use it as often as you like ----
  /**
   * A part: blocks that are built each time the part is used, not where it is
   * defined. Defining records the blocks and the names of its inputs (`inputs`:
   * "w, h"), and builds nothing. Parts are found by name, so a part is defined
   * above where it is used.
   */
  {
    id: "define",
    hint: 'a part to use again; its inputs are variables inside it, like inputs="w, h"; builds nothing until used',
    short: "a reusable part; its inputs are variables, like inputs=\"w, h\"",
    word: "define",
    category: "code",
    params: [text("name", "", "part"), text("inputs", "inputs", "")],
    inner: SHAPES,
    run: (env, a) => {
      const name = a.variableName("name");
      env.parts.set(name, { block: a.block, inputs: inputNames(a) });
    },
  },
  /**
   * Builds a defined part, giving each input the value written for it
   * (`values`: "40, 10", each an expression worked out here, where the part is
   * used). The part sees the variables set before this block, and its inputs
   * win over them. A problem inside the part is reported on the block that has
   * it, with which use led to it. Parts using parts are limited to
   * `MAX_PART_DEPTH` levels, to stop a part that uses itself.
   */
  {
    id: "use",
    hint: 'builds a defined part with a value for each input, like values="40, 10"',
    short: "builds a defined part, like values=\"40, 10\"",
    word: "use",
    category: "code",
    params: [text("name", "", "part"), text("values", "with", "")],
    make: (env, a) => {
      const name = a.variableName("name");
      const part = env.parts.get(name);
      if (!part) a.fail("name", `there is no part called "${name}" (define it above this block)`);
      const given = splitValues(a.text("values"));
      if (given.length !== part!.inputs.length) {
        a.fail("values", `${name} needs ${part!.inputs.length} value${part!.inputs.length === 1 ? "" : "s"}${part!.inputs.length ? ` (${part!.inputs.join(", ")})` : ""} but got ${given.length}`);
      }
      const numbers = given.map((v, i) => {
        try {
          return evaluateExpr(v, env.vars);
        } catch (e) {
          if (e instanceof ExprError) return a.fail("values", `value ${i + 1} (${v}): ${e.message}`);
          throw e;
        }
      });
      if (env.depth >= MAX_PART_DEPTH) a.fail("name", `the part "${name}" is being used more than ${MAX_PART_DEPTH} levels deep: does it have a way to stop?`);
      env.depth++;
      try {
        // the part sees the variables set above this use, and its own inputs
        // (which win)
        const kids = env.scoped(() => {
          part!.inputs.forEach((n, i) => env.vars.set(n, numbers[i]));
          return env.buildBlocks(part!.block.inner ?? []);
        });
        return kids.length ? merged(env, a, kids) : null;
      } catch (e) {
        // say which use led to a problem inside the part, once (the innermost
        // use)
        if (e instanceof ProgramError && !/\(when part /.test(e.message)) throw new ProgramError(e.blockId, `${e.message} (when part ${name} was used with ${given.join(", ") || "no values"})`);
        throw e;
      } finally {
        env.depth--;
      }
    },
  },

  // ---- shapes ----
  /**
   * A box, in mm. All three sizes must be more than 0. It rests on the ground,
   * its bottom center at x y z (see `sitAt`).
   */
  {
    id: "box",
    hint: "sits on the ground, its bottom center at x y z (all 0 at first)",
    plain: true,
    word: "box",
    category: "shapes",
    params: [caption("name"), expr("w", "width", "10"), expr("d", "depth", "10"), expr("h", "height", "10"), ...positionParams()],
    make: (env, a) => sitAt(env, a, env.kernel.box(a.positive("w"), a.positive("d"), a.positive("h"))),
  },
  /**
   * A cylinder, or with a smaller top radius a cone (a top radius of 0 makes a
   * point). The curve has `CURVE_SEGMENTS` sides. The radii may not both be 0.
   * Rests on the ground like the other solids.
   */
  {
    id: "cylinder",
    hint: "axis along z, sits on the ground, its bottom center at x y z; leave top radius empty for a cylinder, or give a smaller one for a cone (0 makes a point)",
    short: "an empty top radius is a cylinder; a smaller one is a cone (0 a point)",
    word: "cylinder",
    category: "shapes",
    params: [caption("name"), expr("r", "radius", "5"), { ...text("top", "top radius", ""), type: { kind: "text" } }, expr("h", "height", "10"), ...positionParams()],
    make: (env, a) => {
      const rLow = a.nonNegative("r");
      // left empty, the top is as wide as the bottom: a cylinder
      const rHigh = a.text("top") === "" ? rLow : a.nonNegative("top");
      if (rLow === 0 && rHigh === 0) a.fail("r", "the radius and the top radius cannot both be zero");
      return sitAt(env, a, env.kernel.cylinder(rLow, rHigh, a.positive("h"), CURVE_SEGMENTS));
    },
  },
  /**
   * A sphere of `CURVE_SEGMENTS` sides around. It rests on the ground, its
   * lowest point at z, over x y.
   */
  {
    id: "sphere",
    hint: "sits on the ground, its bottom at x y z",
    plain: true,
    word: "sphere",
    category: "shapes",
    params: [caption("name"), expr("r", "radius", "5"), ...positionParams()],
    make: (env, a) => sitAt(env, a, env.kernel.sphere(a.positive("r"), CURVE_SEGMENTS)),
  },
  /**
   * A solid from points, which holds two sections (`vertices`, and optionally
   * `faces`). Without faces it is the convex hull of the vertices (and offers
   * its faces to the "hull" button). With faces it is exactly the solid those
   * faces close. The corners and faces are drawn in the 3D view first (if their
   * sections' `show` is on), so they are there even if the solid cannot be
   * built. A problem with a face is reported on that face.
   */
  {
    id: "solid",
    hint: "a solid from points. Its vertices section lists the corners (numbered from 1): on their own they make the smallest convex solid around them (a pyramid is 5 points). Put faces in its faces section to switch to exact mode: each face lists vertex numbers in order, and together the faces must close the shape",
    short: "a solid from vertices (numbered from 1): convex around them, or with faces listing vertex numbers, exactly those faces",
    word: "solid",
    category: "shapes",
    params: [caption("name")],
    inner: ["vertices", "faces"],
    make: (env, a) => {
      const inside = a.block.inner ?? [];
      const vertices = inside.filter((k) => k.kind === "vertices");
      const faces = inside.filter((k) => k.kind === "faces");
      if (vertices.length !== 1) throw new ProgramError(a.block.id, "a solid needs one vertices section (and may have one faces section)");
      if (faces.length > 1) throw new ProgramError(faces[1].id, "a solid can have only one faces section");
      const points = verticesOf(env, a, 4, vertices[0]);
      const faceBlocks = faces.length ? (faces[0].inner ?? []).filter((k) => k.kind === "face") : [];
      // no faces: the convex solid around the points. With faces: exactly those
      // faces.
      const corners = faces.length ? facesOf(env, faces[0], points) : [];
      // what to look at in the 3D view, drawn before the solid is built, so
      // that they are there even if it cannot be: a corner is a dot with its
      // number, a face a translucent polygon (each is shown when its section
      // has `show` on)
      const shows = (section: Block) => new Args(env, section, commandById(section.kind)!).flag("show");
      if (shows(vertices[0])) points.forEach((at, i) => env.overlays.push({ kind: "point", at, label: String(i + 1) }));
      if (faces.length && shows(faces[0])) corners.forEach((ring, i) => env.overlays.push({ kind: "face", blockId: faceBlocks[i].id, ring: ring.map((c) => points[c - 1]), label: `f${i + 1}` }));
      try {
        if (corners.length) return polyhedronSolid(env.kernel, points, corners);
        const hull = env.kernel.hull(points);
        // an empty faces section can be filled with what the hull is made of
        // (its "hull" button), to edit from a valid shape
        if (faces.length) env.hullFaces.set(faces[0].id, hullFaces(points, hull.mesh()));
        return hull;
      } catch (e) {
        // a problem with a face is pointed at that face, not at the whole solid
        if (e instanceof PolyhedronError && e.faces.length && faceBlocks[e.faces[0] - 1]) throw new ProgramError(faceBlocks[e.faces[0] - 1].id, e.message);
        throw e;
      }
    },
  },
  /** The section of a solid that holds its corners; its blocks are `vertex` */
  {
    id: "vertices",
    hint: "the corners of a solid, in order: they are numbered from 1 and faces refer to them by number; show draws them in the 3D view, each with its number",
    plain: true,
    word: "vertices",
    category: "shapes",
    piece: true,
    automatic: true,
    partOf: "a solid",
    params: [flag("show", "show labels")],
    viewOnly: ["show"],
    inner: ["vertex"],
  },
  /**
   * The section of a solid that holds its faces. It has a button, "hull", while
   * it is empty, which fills it with the faces of the convex solid around the
   * vertices.
   */
  {
    id: "faces",
    hint: "optional: the flat faces of a solid. With none, the solid is the convex shape around its vertices; with some, it is exactly these faces",
    plain: true,
    word: "faces",
    category: "shapes",
    piece: true,
    automatic: true,
    partOf: "a solid",
    button: { id: "hull", label: "hull", when: (b) => !(b.inner ?? []).some((k) => k.kind === "face") },
    params: [flag("show", "show labels")],
    viewOnly: ["show"],
    inner: ["face"],
  },
  /** One corner of a solid, numbered from 1 in the order of its section */
  {
    id: "vertex",
    hint: "a corner point at x y z",
    plain: true,
    word: "vertex",
    category: "shapes",
    piece: true,
    numbered: "",
    partOf: "vertices",
    params: [expr("x", "x", "0"), expr("y", "y", "0"), expr("z", "z", "0")],
  },
  /**
   * One face of a solid: the numbers of its vertices, in order around it (the
   * `corners` field is written bare in block text: `face 1 2 3 4`)
   */
  {
    id: "face",
    hint: "the vertex numbers going around one face, like 1 2 3 4 (around the edge, not across; either direction). In the 3D view each face is solid on one side and striped on the other: list the corners counterclockwise as seen from outside and the outside is the solid side",
    short: "the vertex numbers going around one face, like 1 2 3 4 (counterclockwise from outside: the outside is the solid side)",
    word: "face",
    category: "shapes",
    piece: true,
    numbered: "f",
    partOf: "faces",
    params: [{ ...text("corners", "corners", "1 2 3"), positional: true }],
  },
  // ---- flat shapes: drawn in their own u,v plane, then extruded, revolved,
  // lofted or swept ----
  /**
   * A rectangle, in its plane's u (across) and v (up). Its center is at u, v
   * and `rotate` turns it about that center. `corner` rounds the corners by
   * that radius.
   */
  {
    id: "rectangle",
    hint: "u,v (across, up) is its center; rotate turns it about the center, in degrees; corner rounds the corners by that radius; hole cuts it out of the other pieces",
    plain: true,
    short: "u,v is its center; corner rounds it; hole cuts it out",
    word: "rectangle",
    category: "sketch",
    params: [expr("u", "across", "0"), expr("v", "up", "0"), expr("w", "width", "20"), expr("h", "height", "10"), expr("rotate", "rotate", "0"), expr("corner", "round corners", "0"), flag("hole", "hole")],
    sketch: (_env, a) => {
      const w = a.num("w");
      const h = a.num("h");
      return { kind: "rect", at: [a.num("u") - w / 2, a.num("v") - h / 2], w, h, ...(a.num("corner") ? { radius: a.num("corner") } : {}), ...extras(a) };
    },
  },
  /**
   * A circle of `r` around u, v (drawn as a polygon with many sides, see
   * sketch.ts)
   */
  {
    id: "circle",
    hint: "u,v (across, up) is its center; hole cuts it out of the other pieces",
    plain: true,
    short: "u,v is the center; hole cuts it out",
    word: "circle",
    category: "sketch",
    params: [expr("u", "across", "0"), expr("v", "up", "0"), expr("r", "radius", "3"), flag("hole", "hole")],
    sketch: (_env, a) => ({ kind: "circle", center: [a.num("u"), a.num("v")], r: a.num("r"), ...(a.flag("hole") ? { hole: true as const } : {}) }),
  },
  /**
   * Letters, each one a shape, so letters that touch are joined. The font is a
   * built-in name or a Google font (fetched when first used, so the block may
   * say it is still arriving). Fails, against the block, if the font or a
   * letter is not available.
   */
  {
    id: "text",
    hint: "letters in a font: sans, bold, serif, mono, or the name of any font on fonts.google.com, like Pacifico or Open Sans 700: u,v is the middle of the text, size is how tall a capital is; hole cuts the letters out of the other pieces (to engrave)",
    short: "letters in a font (a built-in or any Google font name); u,v is its middle; hole engraves",
    word: "text",
    category: "sketch",
    params: [{ ...text("text", "", "HELLO"), positional: true }, { ...text("font", "font", "sans"), type: { kind: "text", suggestions: FONT_NAMES } }, expr("u", "across", "0"), expr("v", "up", "0"), expr("size", "size", "10"), flag("hole", "hole")],
    sketch: (_env, a) => textShapes(a.text("text"), a.num("u"), a.num("v"), a.num("size"), a.flag("hole"), a.text("font")),
  },
  /**
   * A closed outline of the `point` blocks inside it, joined in order. Needs at
   * least three points, and the sides may not cross (the sketch checks).
   */
  {
    id: "polygon",
    hint: "a closed outline made of points, at least 3",
    short: "an outline of points (at least 3); hole cuts it out",
    word: "polygon",
    category: "sketch",
    params: [expr("rotate", "rotate", "0"), flag("hole", "hole")],
    inner: ["point"],
    sketch: (env, a) => {
      const pointDef = commandById("point")!;
      const points = (a.block.inner ?? []).map((p) => {
        const pa = new Args(env, p, pointDef);
        return [pa.num("u"), pa.num("v")] as [number, number];
      });
      if (points.length < 3) throw new ProgramError(a.block.id, "a polygon needs at least three points");
      return { kind: "polyline", points, ...extras(a) };
    },
  },
  /** One corner of a polygon, in its plane's u, v */
  {
    id: "point",
    hint: "one corner of a polygon",
    plain: true,
    word: "point",
    category: "sketch",
    piece: true,
    partOf: "a polygon",
    params: [expr("u", "across", "0"), expr("v", "up", "0")],
  },

  // ---- turning flat shapes into solids ----
  /**
   * Pushes the flat shapes inside along the plane's normal, `height` far.
   * `twist` turns the top by that many degrees and `taper` scales it (1 keeps
   * the size), about the middle of the whole sketch so that its pieces stay in
   * step. The plane and offset say where the sketch is drawn. While the block
   * is hidden its sketch is shown, as a thin slab.
   */
  {
    id: "extrude",
    hint: "pushes the flat shapes inside (rectangle, circle, polygon, text, or combinations) along the plane's normal (on XY that is up, +z); twist turns the top by that many degrees, taper scales the top (0.5 = half size)",
    short: "pushes the flat shapes inside along the plane's normal (XY: up); twist turns the top, taper scales it",
    word: "extrude",
    category: "sketch",
    params: [caption("name"), choice("plane", "on", PLANES), expr("offset", "offset", "0"), expr("height", "height", "5"), expr("twist", "twist", "0"), expr("taper", "taper", "1")],
    inner: FLAT_SHAPES,
    buildsInner: true,
    make: (env, a, kids) => {
      const k = env.kernel;
      const twist = a.num("twist");
      const taper = a.num("taper");
      if (!(taper > 0)) a.fail("taper", `must be more than 0 (it is ${taper}): 1 keeps the size, 0.5 makes the top half as big`);
      if (!Number.isFinite(twist)) a.fail("twist", "must be a number of degrees");
      const sketch = flatOf(env, a, kids, "this block");
      const flat = sketch.flat;
      // before the solid is built, so it is there even if the solid cannot be
      showSketch(env, a, sketch);
      const height = a.positive("height");
      let solid: Solid;
      if (twist === 0 && taper === 1) solid = k.extrudeFlat(flat, height);
      else {
        // the top turns and shrinks about the middle of the whole drawing, so
        // the pieces stay in step with each other
        const { min, max } = flat.bounds();
        const [cx, cy] = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2];
        solid = k.place(k.extrudeFlat(k.flatPlace(flat, { position: [-cx, -cy] }), height, { twist, scaleTop: taper }), { position: [cx, cy, 0] });
      }
      return onPlane(k, solid, a.text("plane") as PlaneName, a.num("offset"));
    },
  },
  /**
   * Spins the flat shapes inside around the plane's v axis, through `angle`
   * degrees (more than 0, at most 360). The sketch must lie on the u >= 0 side
   * of the axis. The kernel spins about z, so the result is turned to match the
   * extrude's frame (x = u, y = v, z = the normal).
   */
  {
    id: "revolve",
    hint: "spins the flat shapes inside (they need u >= 0) around the plane's v axis (on XZ that is the z axis)",
    short: "spins the flat shapes inside (u >= 0) around the plane's v axis",
    word: "revolve",
    category: "sketch",
    params: [caption("name"), choice("plane", "on", PLANES, "XZ"), expr("offset", "offset", "0"), expr("angle", "angle", "360")],
    inner: FLAT_SHAPES,
    buildsInner: true,
    make: (env, a, kids) => {
      const k = env.kernel;
      const sketch = flatOf(env, a, kids, "this block");
      const flat = sketch.flat;
      showSketch(env, a, sketch);
      const degrees = a.num("angle");
      if (!(degrees > 0 && degrees <= 360)) a.fail("angle", `must be more than 0 and at most 360 (it is ${degrees})`);
      if (flat.bounds().min[0] < -1e-9) throw new ProgramError(a.block.id, "revolve profile must lie on the u >= 0 side of the axis");
      // the kernel revolves around Z; turn that around v so the result lines
      // up with the extrude frame (x=u, y=v, z=normal)
      return onPlane(k, k.place(k.revolveFlat(flat, degrees), { rotation: [-90, 0, 0] }), a.text("plane") as PlaneName, a.num("offset"));
    },
  },
  /**
   * Blends the flat shape in its bottom block into the one in its top block,
   * `height` up from the plane. Each end must be one outline with no holes (so
   * the corners can be matched, see `loft` in sweep.ts). While it is hidden,
   * the two outlines are shown as thin slabs.
   */
  {
    id: "loft",
    hint: "blends the flat shape in its bottom block into the one in its top block, height up (the two may be different shapes: a square becoming a circle); drawn on the plane like an extrude's",
    short: "holds a bottom and a top (each one flat shape) and blends bottom into top",
    word: "loft",
    category: "sketch",
    params: [caption("name"), choice("plane", "on", PLANES), expr("offset", "offset", "0"), expr("height", "height", "20")],
    inner: ["bottom", "top"],
    make: (env, a) => {
      const ends = (a.block.inner ?? []).filter((k) => k.kind === "bottom" || k.kind === "top");
      const bottom = ends.filter((k) => k.kind === "bottom");
      const top = ends.filter((k) => k.kind === "top");
      if (bottom.length !== 1 || top.length !== 1) throw new ProgramError(a.block.id, "a loft needs one bottom block and one top block inside it");
      const [low, high] = [bottom[0], top[0]].map((end) => {
        const { outers, holes } = profileOf(env, end, end.inner ?? [], `the ${end.kind}`);
        if (outers.length !== 1 || holes.length) throw new ProgramError(end.id, `the ${end.kind} must be a single outline with no holes, but it has ${outers.length} piece${outers.length === 1 ? "" : "s"} and ${holes.length} hole${holes.length === 1 ? "" : "s"}`);
        return outers[0];
      });
      const height = a.positive("height");
      if (a.block.hidden === true) {
        // the two outlines it blends between, one on the plane and one `height`
        // along its normal
        const k = env.kernel;
        const slab = (ring: Vec2[], at: number) => k.place(k.extrudeFlat(k.flat([ring]), SKETCH_THICKNESS), { position: [0, 0, at] });
        for (const s of [slab(low, 0), slab(high, height)]) env.overlays.push({ kind: "sketch", blockId: a.block.id, solid: onPlane(k, s, a.text("plane") as PlaneName, a.num("offset")), pieces: [] });
      }
      const solid = swept(a, () => loft(env.kernel, low, high, height));
      return onPlane(env.kernel, solid, a.text("plane") as PlaneName, a.num("offset"));
    },
  },
  /** The end of a loft that is at the plane; it holds the flat shapes */
  {
    id: "bottom",
    hint: "the flat shape a loft starts from",
    plain: true,
    word: "bottom",
    category: "sketch",
    piece: true,
    automatic: true,
    partOf: "a loft",
    params: [],
    inner: FLAT_SHAPES,
  },
  /**
   * The end of a loft that is `height` from the plane; it holds the flat shapes
   */
  {
    id: "top",
    hint: "the flat shape a loft ends at",
    plain: true,
    word: "top",
    category: "sketch",
    piece: true,
    automatic: true,
    partOf: "a loft",
    params: [],
    inner: FLAT_SHAPES,
  },
  /**
   * Carries the flat shape inside along a path made of the `vertex` blocks
   * inside it (at least 2, joined by straight lines). The shape may be several
   * outlines, each swept and then joined; it may not have holes (subtract one
   * from the result). While it is hidden, the outline where the path starts and
   * ends is shown as thin slabs.
   */
  {
    id: "sweep",
    hint: "carries the flat shape inside (a rectangle, circle or polygon) along a path of vertex blocks (at least 2, joined by straight lines); the shape is drawn as seen looking along the first part of the path: u across, v up",
    short: "carries its flat shape along its vertex path",
    word: "sweep",
    category: "sketch",
    params: [caption("name")],
    inner: [...FLAT_SHAPES, "vertex"],
    make: (env, a) => {
      const path = verticesOf(env, a, 2);
      const { outers, holes } = profileOf(env, a.block, (a.block.inner ?? []).filter((k) => k.kind !== "vertex"), "this block");
      if (holes.length) throw new ProgramError(a.block.id, "the outline cannot have holes (cut one out of the result with subtract)");
      if (a.block.hidden === true) {
        // the outline where the path starts and where it ends, as thin slabs
        // facing along the path
        const first = [path[0], path[1]];
        const last = [path[path.length - 2], path[path.length - 1]];
        const toward = (from: [number, number, number], to: [number, number, number], start: boolean): [number, number, number][] => {
          const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
          const len = Math.hypot(...d) || 1;
          const edge = d.map((v) => (v / len) * SKETCH_THICKNESS) as [number, number, number];
          const at = start ? from : to;
          return start ? [at, [at[0] + edge[0], at[1] + edge[1], at[2] + edge[2]]] : [[at[0] - edge[0], at[1] - edge[1], at[2] - edge[2]], at];
        };
        for (const slabPath of [toward(first[0], first[1], true), toward(last[0], last[1], false)]) {
          for (const o of outers) env.overlays.push({ kind: "sketch", blockId: a.block.id, solid: swept(a, () => sweep(env.kernel, o, slabPath)), pieces: [] });
        }
      }
      return outers.map((o) => swept(a, () => sweep(env.kernel, o, path))).reduce((x, y) => env.kernel.union(x, y));
    },
  },

  // ---- placing: these hold the shapes they act on ----
  /**
   * Moves, turns and stretches the shapes inside as one unit, about the origin
   * and in this order: scale, then turn (degrees about x, then y, then z), then
   * move. The scales must be more than 0. A flat shape lies in its plane, so it
   * can only move in x and y, turn about z and stretch in x and y: the other
   * fields must stay at their neutral values. `moveOverlays` moves the points,
   * faces and sketch slabs drawn for the shapes inside in the same way.
   */
  {
    id: "transform",
    hint: "moves, turns and stretches the shapes inside as one unit, about the origin, in this order: scale (stretch from the origin by sx sy sz, each more than 0), then turn (degrees about x, then y, then z), then move by x y z",
    short: "scales (sx sy sz), then turns (degrees about x, y, z), then moves (x y z) the shapes inside, about the origin",
    plain: true,
    word: "transform",
    category: "place",
    params: [expr("x", "move x", "0"), expr("y", "y", "0"), expr("z", "z", "0"), expr("rx", "turn x°", "0"), expr("ry", "y°", "0"), expr("rz", "z°", "0"), expr("sx", "scale x", "1"), expr("sy", "y", "1"), expr("sz", "z", "1")],
    inner: SHAPES,
    buildsInner: true,
    moveOverlays: (a, overlays) => {
      const scale = [a.num("sx"), a.num("sy"), a.num("sz")];
      const turn = [a.num("rx"), a.num("ry"), a.num("rz")];
      const move = [a.num("x"), a.num("y"), a.num("z")];
      const at = (p: [number, number, number]): [number, number, number] => {
        let q = [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]];
        // turned about x, then y, then z (degrees), as the shapes are
        for (const [axis, deg] of turn.entries()) {
          if (!deg) continue;
          const c = Math.cos((deg * Math.PI) / 180);
          const s = Math.sin((deg * Math.PI) / 180);
          const [i, j] = [[1, 2], [2, 0], [0, 1]][axis];
          [q[i], q[j]] = [q[i] * c - q[j] * s, q[i] * s + q[j] * c];
        }
        return [q[0] + move[0], q[1] + move[1], q[2] + move[2]];
      };
      for (const o of overlays) {
        if (o.kind === "point") o.at = at(o.at);
        else if (o.kind === "face") o.ring = o.ring.map(at);
        else {
          // a sketch (a slab) is moved the way the shapes are: scaled, then
          // turned, then moved
          const k = a.env.kernel;
          const moved = (s: Solid) => {
            const scaled = scale.some((v) => v !== 1) ? k.scale(s, scale as [number, number, number]) : s;
            return turn.some((v) => v) || move.some((v) => v) ? k.place(scaled, { rotation: turn as [number, number, number], position: move as [number, number, number] }) : scaled;
          };
          o.solid = moved(o.solid);
          o.pieces = o.pieces.map(moved);
        }
      }
    },
    make: (env, a, kids) => {
      const shape = merged(env, a, kids);
      const k = env.kernel;
      const move: [number, number, number] = [a.num("x"), a.num("y"), a.num("z")];
      const turn: [number, number, number] = [a.num("rx"), a.num("ry"), a.num("rz")];
      const scale: [number, number, number] = [a.positive("sx"), a.positive("sy"), a.positive("sz")];
      if (!isFlat(shape)) {
        let s = shape;
        if (scale.some((v) => v !== 1)) s = k.scale(s, scale);
        return turn.some((v) => v) || move.some((v) => v) ? k.place(s, { rotation: turn, position: move }) : s;
      }
      // a flat shape lies in its plane: it can move in x and y, turn about z,
      // and stretch in x and y
      onlyPlane(a, "z", 0, "a flat shape lies on its plane, so it can only move in x and y (extrude has an offset to lift it)");
      onlyPlane(a, "rx", 0, "a flat shape can only be turned about z (in its own plane)");
      onlyPlane(a, "ry", 0, "a flat shape can only be turned about z (in its own plane)");
      onlyPlane(a, "sz", 1, "a flat shape has no height to stretch");
      const put = (g: Flat) => k.flatPlace(scale[0] !== 1 || scale[1] !== 1 ? k.flatScale(g, [scale[0], scale[1]]) : g, { rotation: turn[2], position: [move[0], move[1]] });
      return { ...shape, flat: put(shape.flat), ...(shape.pieces ? { pieces: shape.pieces.map(put) } : {}) };
    },
  },

  /**
   * Reflects the shapes inside across the plane through the origin that is
   * square to the axis. With `both` the original is kept too (joined). A flat
   * shape can be mirrored only across x or y.
   */
  {
    id: "mirror",
    hint: "reflects the shapes inside across the plane through the origin square to the axis; both keeps the original too",
    short: "reflects across the plane square to the axis; both keeps the original",
    word: "mirror",
    category: "place",
    params: [choice("axis", "across", ["x", "y", "z"]), flag("both", "keep the original too")],
    inner: SHAPES,
    buildsInner: true,
    moveOverlays: (a, overlays, add) => {
      const axis = AXIS_INDEX[a.text("axis")];
      const flip = (p: [number, number, number]): [number, number, number] => p.map((v, i) => (i === axis ? -v : v)) as [number, number, number];
      for (const o of overlays) {
        const copy: Overlay = o.kind === "point" ? { ...o, at: flip(o.at) } : o.kind === "face" ? { ...o, ring: o.ring.map(flip) } : { ...o, solid: a.env.kernel.mirror(o.solid, axis), pieces: o.pieces.map((p) => a.env.kernel.mirror(p, axis)) };
        if (a.flag("both")) add(copy);
        else if (o.kind === "point") o.at = copy.kind === "point" ? copy.at : o.at;
        else if (o.kind === "face") o.ring = copy.kind === "face" ? copy.ring : o.ring;
        else if (copy.kind === "sketch") [o.solid, o.pieces] = [copy.solid, copy.pieces];
      }
    },
    make: (env, a, kids) => {
      const original = merged(env, a, kids);
      const axis = AXIS_INDEX[a.text("axis")];
      if (isFlat(original)) {
        if (axis === 2) a.fail("axis", "a flat shape can be mirrored across x or y");
        const flipped = env.kernel.flatMirror(original.flat, axis as 0 | 1);
        const parts = original.pieces ?? (a.flag("both") ? [original.flat] : undefined);
        const turned = parts?.map((p) => env.kernel.flatMirror(p, axis as 0 | 1));
        return { ...original, flat: a.flag("both") ? env.kernel.flatUnion(original.flat, flipped) : flipped, ...(parts ? { pieces: a.flag("both") ? [...parts, ...turned!] : turned! } : {}) };
      }
      const flipped = env.kernel.mirror(original, axis);
      return a.flag("both") ? env.kernel.union(original, flipped) : flipped;
    },
  },

  /**
   * Rounds the outside edges of the shapes inside by the radius. A solid is
   * rounded with a ball (see `finishEdges`: slow for detailed shapes, which are
   * refused); a flat shape by shrinking it and growing it back, which is quick.
   */
  {
    id: "round",
    hint: "rounds the outside edges of the shapes inside by the radius; thin parts are lost, so use under half the thinnest size (for the inside corners, where shapes join, use fillet)",
    short: "rounds the outside edges by the radius",
    word: "round",
    category: "place",
    params: [expr("radius", "radius", "1")],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => {
      const shape = merged(env, a, kids);
      const r = a.positive("radius");
      if (!isFlat(shape)) return finish(a, () => finishEdges(env.kernel, shape, r, false, "ball"));
      // a flat shape is rounded by shrinking it and growing it back
      const rounded = env.kernel.flatOffset(env.kernel.flatOffset(shape.flat, -r), r);
      if (rounded.isEmpty()) a.fail("radius", "is too big for this shape: it would leave nothing");
      return { kind: "flat", flat: rounded, ...(shape.hole ? { hole: true as const } : {}) };
    },
  },
  /**
   * Fills the inside corners, where shapes join, with a curve of the radius. A
   * solid uses a ball like round (and is refused when too detailed); a flat
   * shape grows and shrinks back.
   */
  {
    id: "fillet",
    hint: "fills the inside corners of the shapes inside, where they join, with a curve of the radius. Put only the shapes that join inside it and cut holes afterwards: a hole or gap narrower than twice the radius is filled in",
    short: "fills the inside corners (where shapes join) with a curve of the radius; cut holes after",
    word: "fillet",
    category: "place",
    params: [expr("radius", "radius", "1")],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => {
      const shape = merged(env, a, kids);
      const r = a.positive("radius");
      if (!isFlat(shape)) return finish(a, () => finishEdges(env.kernel, shape, r, true, "ball"));
      // a flat shape is filled by growing it and shrinking it back
      return { kind: "flat", flat: env.kernel.flatOffset(env.kernel.flatOffset(shape.flat, r), -r), ...(shape.hole ? { hole: true as const } : {}) };
    },
  },
  /**
   * Bevels the outside edges (with `inside`, the inside corners) by the size,
   * using a diamond in place of a ball. Works on solids only.
   */
  {
    id: "chamfer",
    hint: "bevels the outside edges of the shapes inside by the size (with inside on: the inside corners)",
    short: "bevels the outside edges by the size",
    word: "chamfer",
    category: "place",
    params: [expr("size", "size", "1"), flag("inside", "inside corners")],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => finish(a, () => finishEdges(env.kernel, mergedSolid(env, a, kids), a.positive("size"), a.flag("inside"), "diamond")),
  },
  /**
   * Hollows the shapes inside, leaving walls `thickness` thick (see `hollow`).
   * `open` leaves the top or bottom open, like a cup. Works on solids only.
   */
  {
    id: "shell",
    hint: "hollows the shapes inside, leaving walls that thick; open leaves the top or the bottom open, like a cup",
    short: "hollows with walls that thick; open: top or bottom",
    word: "shell",
    category: "place",
    params: [expr("thickness", "wall", "2"), choice("open", "open", ["none", "top", "bottom"])],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => finish(a, () => hollow(env.kernel, mergedSolid(env, a, kids), a.positive("thickness"), a.text("open") as "none" | "top" | "bottom")),
  },

  // ---- arranging ----
  /**
   * The first shape stays, and the others move along one axis so their low,
   * middle or high edge matches the first one's. Works on solids only. The
   * result is all the shapes, joined.
   */
  {
    id: "lineUp",
    hint: "the first shape stays; the others move so their edge or center on one axis matches the first one's",
    short: "the first shape stays; the others move to match its edge or center",
    word: "line up",
    category: "place",
    params: [choice("axis", "on", ["x", "y", "z"]), choice("at", "at", ["min", "center", "max"])],
    inner: SHAPES,
    buildsInner: true,
    baseFirst: true,
    make: (env, a, kids) => {
      const pair = baseAndRest(env, a, kids, "moved to line up with it", "merged");
      if ("done" in pair) return pair.done;
      const { base, rest } = pair;
      return merged(env, a, [solidOnly(a, base), ...lineUp(env.kernel, solidOnly(a, base), rest.map((x) => solidOnly(a, x)), AXIS_INDEX[a.text("axis")], a.text("at") as "min" | "center" | "max")]);
    },
  },
  /**
   * The first shape stays, and the others move along one axis to touch its low
   * or high face (stacking, or side by side). Works on solids only. The result
   * is all the shapes, joined.
   */
  {
    id: "placeAgainst",
    hint: "the first shape stays; the others move to touch its low or high face on one axis (stacking, side by side)",
    short: "the first shape stays; the others move to touch its low or high face",
    word: "place against",
    category: "place",
    params: [choice("axis", "on", ["x", "y", "z"]), choice("side", "side", ["low", "high"], "high")],
    inner: SHAPES,
    buildsInner: true,
    baseFirst: true,
    make: (env, a, kids) => {
      const pair = baseAndRest(env, a, kids, "moved against it", "merged");
      if ("done" in pair) return pair.done;
      const { base, rest } = pair;
      return merged(env, a, [solidOnly(a, base), ...placeAgainst(env.kernel, solidOnly(a, base), rest.map((x) => solidOnly(a, x)), AXIS_INDEX[a.text("axis")], a.text("side") as "low" | "high")]);
    },
  },

  // ---- measuring ----
  /**
   * Builds the shapes inside, passes them through, and sets variables from
   * their bounding box: name_w, name_d, name_h (the size) and name_x0 name_x1
   * name_y0 name_y1 name_z0 name_z1 (the edges), rounded to 9 places. They are
   * set after the inside is built, so they are for the blocks below this one.
   * What it found is kept for the "?" on the block (`env.measured`).
   */
  {
    id: "measure",
    hint: "builds the shapes inside and sets name_w, name_d, name_h (size) and name_x0 name_x1 name_y0 name_y1 name_z0 name_z1 (edges)",
    short: "sets name_w, name_d, name_h and name_x0..name_z1 (size, edges)",
    word: "measure",
    category: "code",
    color: VARIABLE_COLOR,
    params: [{ id: "name", label: "as", type: { kind: "var" }, default: "part" }],
    inner: SHAPES,
    buildsInner: true,
    observer: true,
    make: (env, a, kids) => {
      const name = a.variableName("name");
      const shape = mergedSolid(env, a, kids);
      const { min, max } = shape.bounds();
      const sizes: [string, number][] = [["w", max[0] - min[0]], ["d", max[1] - min[1]], ["h", max[2] - min[2]], ["x0", min[0]], ["x1", max[0]], ["y0", min[1]], ["y1", max[1]], ["z0", min[2]], ["z1", max[2]]];
      // set here, after the inside has been built: the blocks below this one
      // can use them
      const found: Record<string, number> = {};
      for (const [suffix, value] of sizes) {
        found[`${name}_${suffix}`] = Math.round(value * 1e9) / 1e9;
        env.vars.set(`${name}_${suffix}`, found[`${name}_${suffix}`]);
      }
      // for the "?" on the block, which shows them
      env.measured.set(a.block.id, found);
      return shape;
    },
  },

  // ---- combining ----
  /** Merges the shapes inside into one (see `merged`) */
  {
    id: "union",
    hint: "merges the shapes inside into one",
    plain: true,
    short: "merges the shapes inside",
    word: "union",
    category: "combine",
    params: [caption("name")],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => merged(env, a, kids),
  },
  /**
   * Cuts every shape after the first out of the first (see `baseAndRest`). The
   * shapes must all be flat or all 3D, and a flat shape that is cut away
   * completely is an error.
   */
  {
    id: "subtract",
    hint: "cuts every shape after the first out of the first",
    short: "cuts every shape after the first out of the first",
    word: "subtract",
    category: "combine",
    params: [caption("name")],
    inner: SHAPES,
    buildsInner: true,
    baseFirst: true,
    make: (env, a, kids) => {
      const pair = baseAndRest(env, a, kids, "cut out of it", "nothing");
      if ("done" in pair) return pair.done;
      const { base, rest } = pair;
      const cutter = merged(env, a, rest);
      if (isFlat(base) !== isFlat(cutter)) throw new ProgramError(a.block.id, "a flat shape can only be cut from a flat shape, and a 3D shape from a 3D shape");
      if (isFlat(base) && isFlat(cutter)) {
        const left = env.kernel.flatSubtract(base.flat, cutter.flat);
        if (left.isEmpty()) throw new ProgramError(a.block.id, "what is cut out leaves nothing");
        return { kind: "flat", flat: left };
      }
      return env.kernel.subtract(base as Solid, cutter as Solid);
    },
  },
  /**
   * Keeps only where the shapes inside overlap: at least two, all flat or all
   * 3D. With an eye shut on one of them it carries on with the one left.
   */
  {
    id: "intersect",
    hint: "keeps only where the shapes inside overlap",
    plain: true,
    short: "keeps only where the shapes inside overlap",
    word: "intersect",
    category: "combine",
    params: [caption("name")],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => {
      if (kids.length < 2) {
        // an eye is shut on one of them
        if ((a.block.inner ?? []).some((k) => k.hidden === true && commandById(k.kind)?.make)) return kids[0] ?? null;
        throw new ProgramError(a.block.id, "put at least two shapes inside");
      }
      if (kids.some(isFlat) !== kids.every(isFlat)) throw new ProgramError(a.block.id, "this block holds both flat shapes and 3D shapes: extrude the flat ones first");
      const k = env.kernel;
      if (isFlat(kids[0])) return { kind: "flat", flat: (kids as FlatPiece[]).map((f) => f.flat).reduce((x, y) => k.flatIntersect(x, y)) };
      return (kids as Solid[]).reduce((x, y) => k.intersect(x, y));
    },
  },
];

/**
 * The fields that are neutral at their default (no twist, no rounding, no
 * turn, no offset), which are left out of the program the model reads
 */
const NEUTRAL_FIELDS = ["twist", "taper", "corner", "rotate", "offset", "top"];

/** The shapes that sit at the origin unless told otherwise */
const AT_ORIGIN = ["box", "cylinder", "sphere", "import"];

/**
 * Is this field of this command left out of the program the model reads while
 * it has its default? (`Param.quiet`)
 */
function isQuiet(c: CommandEntry, p: Param): boolean {
  // a transform that does not move, turn or scale says nothing of it
  if (c.id === "transform") return true;
  // a shape at the origin says nothing of its position
  if (AT_ORIGIN.includes(c.id) && ["x", "y", "z"].includes(p.id)) return true;
  return NEUTRAL_FIELDS.includes(p.id);
}

/**
 * The blocks that change what is inside them (`modifier`): disabled, they do
 * nothing, and the shapes inside pass through (joined, as a union would).
 */
const MODIFIERS = ["transform", "mirror", "round", "fillet", "chamfer", "shell", "lineUp", "placeAgainst"];

/**
 * What "partial" means for each block: the fields it still offers. A block not
 * listed has nothing to hide. Change a line to change what a partly exposed
 * block looks like in every mode.
 */
const PARTIAL: Record<string, readonly string[]> = {
  transform: ["x", "y", "z"],
  box: ["w", "d", "h"],
  cylinder: ["r", "h"],
  sphere: ["r"],
  import: ["file", "scale"],
  rectangle: ["u", "v", "w", "h", "hole"],
  circle: ["u", "v", "r", "hole"],
  polygon: ["hole"],
  text: ["text", "font", "u", "v", "size", "hole"],
  extrude: ["plane", "height"],
  revolve: ["plane", "angle"],
  loft: ["height"],
  sweep: [],
  solid: [],
  chamfer: ["size"],
  union: [],
  subtract: [],
  intersect: [],
};

/**
 * A table entry made into a command: its color filled in (the category's,
 * unless the entry set its own), its quiet fields marked, its `make` wrapped
 * if it is a modifier or made from its `sketch`, and its partial fields set.
 * The entry is not changed.
 */
function finished(c: CommandEntry): CommandDef {
  let make = c.make;
  // a block that draws a flat shape: its `sketch` says what outlines, and the
  // shape it builds is those, joined
  if (c.sketch) make = (env, a) => drawFlat(env, a.block, a);
  const modifier = MODIFIERS.includes(c.id);
  if (modifier) {
    // disabled, it does nothing and the shapes inside pass through
    const change = make!;
    make = (env, a, kids) => (a.block.disabled === true ? merged(env, a, kids) : change(env, a, kids));
  }
  return {
    ...c,
    color: c.color ?? CATEGORY_COLORS[c.category],
    params: c.params.map((p) => (isQuiet(c, p) ? { ...p, quiet: true } : p)),
    ...(modifier ? { modifier } : {}),
    ...(make ? { make } : {}),
    ...(c.id in PARTIAL ? { partial: PARTIAL[c.id] } : {}),
  };
}

/** Every command, made from the entries of `ENTRIES` (see `finished`) */
export const COMMANDS: readonly CommandDef[] = ENTRIES.map(finished);

/** The commands by id, for `commandById` */
const BY_ID = new Map(COMMANDS.map((c) => [c.id, c]));

/**
 * The command with this id (a block's `kind`), or undefined if there is none
 */
export function commandById(id: string): CommandDef | undefined {
  return BY_ID.get(id);
}

/**
 * A new block of this kind, with every field at its default (and an empty
 * `inner`, if it holds blocks). Throws an Error for a kind that is not a
 * command.
 */
export function blankBlock(kind: string, id: string): Block {
  const def = commandById(kind);
  if (!def) throw new Error(`no such command: ${kind}`);
  const block: Block = { id, kind, args: Object.fromEntries(def.params.map((p) => [p.id, p.default])) };
  if (def.inner) block.inner = [];
  return block;
}
