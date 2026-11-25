/**
 * The commands of the Sketch tab: the flat shapes (rectangle, circle, text,
 * polygon, point) and what turns them into solids (extrude, revolve, loft,
 * sweep).
 *
 * Each entry is the whole definition of one block, as a `CommandDef`.
 */

import type { Flat, Solid, Vec2, Vec3 } from "../../../geometry/kernel";
import { FONT_NAMES, textShapes } from "../../../geometry/fonts";
import { type PlaneName, onPlane } from "../../../geometry/sketch";
import { loft, sweep, SweepError } from "../../../geometry/sweep";
import { polygonArea } from "../../../geometry/vec";
import { BlockArgs, Env, ProgramError } from "../../env";
import { type Block, type FlatPiece, type Shape, isFlat } from "../../types";
import { expr, caption, text, flag, choice, makesPoints, piecesIn, verticesOf, merged } from "../helpers";
import { FLAT_SHAPES } from "../types";
import type { CommandEntry } from "../types";
import { commandById, blankBlock, blockWith } from "../lookup";

/** The planes a sketch can be drawn on, as the choices of a block's `plane` */
const PLANES: PlaneName[] = ["XY", "XZ", "YZ"];

/**
 * The optional parts of a sketch shape: only what differs from the default (the
 * rotation, and whether it is a hole)
 */
function extras(a: BlockArgs) {
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
  const a = new BlockArgs(env, block, commandById(block.kind)!);
  const flat = flatOf(env, a, shapes, what);
  const rings = flat.flat.polygons();
  return { outers: rings.filter((r) => polygonArea(r) > 0), holes: rings.filter((r) => polygonArea(r) < 0) };
}

/**
 * Run a loft or sweep, and report what is wrong with it (a `SweepError`)
 * against this block
 */
function swept<T>(a: BlockArgs, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof SweepError) throw new ProgramError(a.block.id, e.message);
    throw e;
  }
}

/**
 * The flat shape that the blocks inside make, for a block that turns flat
 * shapes into solids (extrude, revolve, loft, sweep). Throws a ProgramError if
 * there is nothing inside, a 3D shape, or only holes.
 *
 * @param what How to refer to the block in a message ("this block").
 */
function flatOf(env: Env, a: BlockArgs, kids: Shape[], what: string): FlatPiece {
  if (!kids.length) throw new ProgramError(a.block.id, `put a rectangle, circle or polygon inside ${what}`);
  const shape = merged(env, a, kids);
  if (!isFlat(shape)) throw new ProgramError(a.block.id, `${what} needs flat shapes (rectangle, circle, polygon, text) inside, but it holds a 3D shape`);
  if (shape.hole) throw new ProgramError(a.block.id, "there needs to be at least one shape that is not a hole");
  return shape;
}

/**
 * A block whose eye is shut still shows what it was working on: the sketch
 * inside an extrude or revolve, as a thin slab on its plane (which the view
 * draws as an overlay). Does nothing for a block whose eye is open.
 */
function showSketch(env: Env, a: BlockArgs, sketch: FlatPiece) {
  if (a.block.hidden !== true) return;
  /** A flat shape as a thin slab on the sketch's plane, so it can be drawn. */
  const slab = (f: Flat, thickness: number) => onPlane(env.kernel, env.kernel.extrudeFlat(f, thickness), a.text("plane") as PlaneName, a.num("offset"));
  // each piece is a little taller than the one before, so its outline is
  // drawn above it
  const pieces = (sketch.pieces.length > 1 ? sketch.pieces : []).map((f, i) => slab(f, SKETCH_THICKNESS * (1.3 + i * 0.3)));
  env.overlays.push({ kind: "sketch", blockId: a.block.id, solid: slab(sketch.flat, SKETCH_THICKNESS), pieces });
}

/**
 * How thick the sketch of a hidden extrude or revolve is drawn, in mm: enough
 * to see
 */
const SKETCH_THICKNESS = 0.3;

/**
 * The commands of the Sketch tab, in the order of the palette within the tab.
 */
export const sketchEntries: readonly CommandEntry[] = [
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
   * A circle of `r` around u, v (drawn as a polygon with many sides)
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
   * A closed outline of the points inside it, joined in order. The points are
   * its `point` blocks, and the ones that a `repeat` or `if` inside it makes
   * (with `set` for a variable that a pass needs), so an outline can be
   * described by a formula. Needs at least three points, and the sides may not
   * cross (the sketch checks).
   */
  {
    id: "polygon",
    hint: "a closed outline made of points, at least 3",
    short: "an outline of points (at least 3); hole cuts it out",
    word: "polygon",
    category: "sketch",
    params: [expr("rotate", "rotate", "0"), flag("hole", "hole")],
    inner: ["point", "repeat", "if", "set"],
    starter: (nextId) => [blockWith("point", nextId(), { u: "0", v: "0" }), blockWith("point", nextId(), { u: "10", v: "0" }), blockWith("point", nextId(), { u: "0", v: "10" })],
    sketch: (env, a) => {
      const pointDef = commandById("point")!;
      const points = piecesIn(env, a.block, a.block.inner ?? [], "point", (p) => {
        const pa = new BlockArgs(env, p, pointDef);
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
    starter: (nextId) => [blockWith("rectangle", nextId(), {})],
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
    starter: (nextId) => [blockWith("rectangle", nextId(), { u: "2", v: "0", w: "3", h: "10" })],
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
   * the corners can be matched). While it is hidden,
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
    starter: (nextId) => [
      { ...blankBlock("bottom", nextId()), inner: [blockWith("rectangle", nextId(), { u: "-10", v: "-10", w: "20", h: "20" })] },
      { ...blankBlock("top", nextId()), inner: [blockWith("circle", nextId(), { u: "0", v: "0", r: "5" })] },
    ],
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
        /** An outline as a thin slab at this height along the sketch's normal. */
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
    starter: (nextId) => [
      blockWith("circle", nextId(), { u: "0", v: "0", r: "3" }),
      blockWith("vertex", nextId(), { x: "0", y: "0", z: "0" }),
      blockWith("vertex", nextId(), { x: "0", y: "0", z: "30" }),
      blockWith("vertex", nextId(), { x: "25", y: "0", z: "50" }),
    ],
    make: (env, a) => {
      const path = verticesOf(env, a, 2);
      const { outers, holes } = profileOf(env, a.block, (a.block.inner ?? []).filter((k) => !makesPoints(k, "vertex")), "this block");
      if (holes.length) throw new ProgramError(a.block.id, "the outline cannot have holes (cut one out of the result with subtract)");
      if (a.block.hidden === true) {
        // the outline where the path starts and where it ends, as thin slabs
        // facing along the path
        const first = [path[0], path[1]];
        const last = [path[path.length - 2], path[path.length - 1]];
        /**
         * A short line at one end of the path, along the way the path faces
         * there, so the end of the path can be drawn.
         */
        const toward = (from: Vec3, to: Vec3, start: boolean): Vec3[] => {
          const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
          const len = Math.hypot(...d) || 1;
          const edge = d.map((v) => (v / len) * SKETCH_THICKNESS) as Vec3;
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
];
