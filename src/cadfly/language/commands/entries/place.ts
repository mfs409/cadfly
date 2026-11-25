/**
 * The commands of the Place tab: the blocks that hold the shapes they act on
 * (transform, mirror, round, fillet, chamfer, shell) and the ones that
 * arrange them (align, place against).
 *
 * Each entry is the whole definition of one block, as a `CommandDef`.
 */

import type { Flat, Solid, Vec3 } from "../../../geometry/kernel";
import { type Axis, align, placeAgainst } from "../../../geometry/arrange";
import { FinishError, finishEdges, hollow } from "../../../geometry/finish";
import { BlockArgs, type Overlay, ProgramError } from "../../env";
import { isFlat } from "../../types";
import { expr, flag, choice, singlePiece, merged, mergedSolid, solidOnly, baseAndRest } from "../helpers";
import { SHAPES } from "../types";
import type { CommandEntry } from "../types";

/** The position of each axis name in an (x, y, z) triple */
const AXIS_INDEX: Record<string, Axis> = { x: 0, y: 1, z: 2 };

/**
 * Run a finishing step (round, shell, ...), and report what is wrong with it (a
 * `FinishError`) against this block
 */
function finish<T>(a: BlockArgs, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof FinishError) throw new ProgramError(a.block.id, e.message);
    throw e;
  }
}

/**
 * For a flat shape, a number field that has no meaning in 2D must have its
 * neutral value (move z = 0, scale z = 1): otherwise the field is refused, with
 * `why`
 */
function onlyPlane(a: BlockArgs, id: string, neutral: number, why: string) {
  const v = a.num(id);
  if (v !== neutral) a.fail(id, `${why} (it is ${v})`);
}

/**
 * The commands of the Place tab, in the order of the palette within the tab.
 */
export const placeEntries: readonly CommandEntry[] = [
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
      const at = (p: Vec3): Vec3 => {
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
            const scaled = scale.some((v) => v !== 1) ? k.scale(s, scale as Vec3) : s;
            return turn.some((v) => v) || move.some((v) => v) ? k.place(scaled, { rotation: turn as Vec3, position: move as Vec3 }) : scaled;
          };
          o.solid = moved(o.solid);
          o.pieces = o.pieces.map(moved);
        }
      }
    },
    make: (env, a, kids) => {
      const shape = merged(env, a, kids);
      const k = env.kernel;
      const move: Vec3 = [a.num("x"), a.num("y"), a.num("z")];
      const turn: Vec3 = [a.num("rx"), a.num("ry"), a.num("rz")];
      const scale: Vec3 = [a.positive("sx"), a.positive("sy"), a.positive("sz")];
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
      const flat = put(shape.flat);
      return { ...shape, flat, pieces: shape.pieces.length > 1 ? shape.pieces.map(put) : [flat] };
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
      const flip = (p: Vec3): Vec3 => p.map((v, i) => (i === axis ? -v : v)) as Vec3;
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
        // a single piece is the shape itself, which is already mirrored
        const turned = original.pieces.length > 1 ? original.pieces.map((p) => env.kernel.flatMirror(p, axis as 0 | 1)) : [flipped];
        return { ...original, flat: a.flag("both") ? env.kernel.flatUnion(original.flat, flipped) : flipped, pieces: a.flag("both") ? [...original.pieces, ...turned] : turned };
      }
      const flipped = env.kernel.mirror(original, axis);
      return a.flag("both") ? env.kernel.union(original, flipped) : flipped;
    },
  },

  /**
   * Rounds the outside edges of the shapes inside by the radius. A solid is
   * rounded with a ball (slow for detailed shapes, which are
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
      return singlePiece(rounded, shape.hole);
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
      return singlePiece(env.kernel.flatOffset(env.kernel.flatOffset(shape.flat, r), -r), shape.hole);
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
   * Hollows the shapes inside, leaving walls `thickness` thick.
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

  /**
   * The first shape stays, and the others move along one axis so their low,
   * middle or high edge matches the first one's. Works on solids only. The
   * result is all the shapes, joined.
   */
  {
    id: "lineUp",
    hint: "the first shape stays; the others move so their edge or center on one axis matches the first one's",
    short: "the first shape stays; the others move to match its edge or center",
    word: "align",
    category: "place",
    params: [choice("axis", "on", ["x", "y", "z"]), choice("at", "at", ["min", "center", "max"])],
    inner: SHAPES,
    buildsInner: true,
    baseFirst: true,
    make: (env, a, kids) => {
      const pair = baseAndRest(env, a, kids, "moved to align with it", "merged");
      if ("done" in pair) return pair.done;
      const { base, rest } = pair;
      return merged(env, a, [solidOnly(a, base), ...align(env.kernel, solidOnly(a, base), rest.map((x) => solidOnly(a, x)), AXIS_INDEX[a.text("axis")], a.text("at") as "min" | "center" | "max")]);
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
];
