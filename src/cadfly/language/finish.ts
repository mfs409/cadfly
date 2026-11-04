import type { Kernel, Solid } from "../geometry/kernel";

/**
 * Finishing a solid: hollowing it (`hollow`) and rounding or beveling its edges
 * (`finishEdges`). Both work by shrinking or growing the shape with a ball (or
 * a diamond), which is slow for a detailed shape, so a shape that would take
 * too long is refused (`checkSize`), and the results are remembered
 * (`remember`) so that an edit elsewhere in a program does not redo them.
 */

/**
 * Hollowing or rounding a shape that is not convex takes a long time, which
 * grows with its triangles (the ball is added to every convex part of it), and
 * nothing can stop it once it has started, except ending the engine's worker,
 * which the app does after 20 seconds.
 *
 * Measured on one (busy) computer, for a plate with one round hole in it, in
 * seconds. The times wander a lot from run to run, so these are rough.
 *
 *   triangles   round   fillet   chamfer   shell
 *         208       4        4         2       1
 *         272      15        9         3       1
 *         416       9        7         4       1
 *         616       -        -         7       1
 *         816       -        -        10       2
 *        1016       -        -        22       6
 *
 * So each operation has its own limit, set where it still finishes in about ten
 * seconds at worst (a plate with one round hole, 272 triangles, must round): a
 * shape that is not convex with more triangles than that is refused
 * at once, and the message says what to do instead. A convex shape is one
 * hull, which is quick however many triangles it has (up to the last limit).
 */
const MAX_TRIANGLES = {
  round: 300,
  fillet: 420,
  chamfer: 600,
  shell: 800,
};

/**
 * The most triangles a convex shape may have, for any operation. A convex
 * shape is quick however many it has, but not without end.
 */
const MAX_CONVEX_TRIANGLES = 20000;

/**
 * How coarse the ball (or diamond) is for a shape with this many triangles: the
 * number of segments in its curves. It is coarser for a more complicated shape,
 * to keep the work to a few seconds at worst.
 */
function detailFor(tris: number): number {
  return tris <= 200 ? 16 : tris <= 600 ? 12 : 8;
}

/**
 * Results already worked out, so that changing something elsewhere in a
 * program does not do it all again: keyed by the shape's exact triangles and
 * what was done to it (see `key`). Per kernel, and only a few (`REMEMBER`),
 * since each is a whole solid, kept in the kernel's memory.
 */
const remembered = new WeakMap<Kernel, Map<string, Solid>>();

/** How many results to keep for each kernel, before the oldest is let go */
const REMEMBER = 12;

/**
 * A name for a shape and what was done to it, for looking up a result
 * (`remember`): a hash of the shape's exact triangles (positions to 4 decimal
 * places, and indices), their counts, and the details of the operation. The
 * same shape and operation always give the same key.
 *
 * @param s The shape the operation is done to.
 * @param what The operation and its settings (such as "hollow", 2, "top").
 */
function key(s: Solid, ...what: (string | number | boolean)[]): string {
  const m = s.mesh();
  let h = 2166136261;
  for (const v of m.positions) h = Math.imul(h ^ Math.round(v * 1e4), 16777619);
  for (const v of m.indices) h = Math.imul(h ^ v, 16777619);
  return `${h >>> 0}:${m.positions.length}:${m.indices.length}:${what.join(",")}`;
}

/**
 * The result of `make`, worked out only if this kernel has not already done the
 * work for `id`. The kernel keeps the last `REMEMBER` results used, and lets go
 * of the one used longest ago when it has more.
 *
 * @param k The kernel the results belong to.
 * @param id What the result is of (see `key`).
 * @param make Does the work, when it has to be done.
 */
function remember(k: Kernel, id: string, make: () => Solid): Solid {
  let cache = remembered.get(k);
  if (!cache) remembered.set(k, (cache = new Map()));
  const have = cache.get(id);
  if (have) {
    cache.delete(id); // most recently used last
    cache.set(id, have);
    return have;
  }
  // kept through the kernel's release() (which frees what a build made), and
  // dropped when it is pushed out
  const made = k.keep(make());
  cache.set(id, made);
  if (cache.size > REMEMBER) {
    const oldest = cache.keys().next().value!;
    k.drop(cache.get(oldest)!);
    cache.delete(oldest);
  }
  return made;
}

/**
 * What went wrong with a finishing step, in words that say what to change (the
 * block that asked adds the field's name)
 */
export class FinishError extends Error {}

/** How many triangles a solid is made of */
function triangles(s: Solid): number {
  return s.mesh().indices.length / 3;
}

/**
 * Is the shape convex (no dent anywhere)? Its volume is then the volume of the
 * hull of its corners. (False if the hull cannot be made.)
 */
function isConvex(k: Kernel, s: Solid): boolean {
  const m = s.mesh();
  const points: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) points.push([m.positions[i], m.positions[i + 1], m.positions[i + 2]]);
  try {
    return s.volume() >= k.hull(points).volume() * 0.995;
  } catch {
    return false;
  }
}

/**
 * Refuse a shape that would take too long to build (see `MAX_TRIANGLES`),
 * saying what to do instead
 *
 * @param what Which operation it is, which sets the limit and is named in the
 *             message.
 * @param instead What to do about it (the message ends with this).
 */
function checkSize(k: Kernel, s: Solid, what: keyof typeof MAX_TRIANGLES, instead: string) {
  const n = triangles(s);
  const most = MAX_TRIANGLES[what];
  const verb = what === "shell" ? "hollow out" : what;
  const limit = n <= most || isConvex(k, s) ? MAX_CONVEX_TRIANGLES : most;
  if (n > limit) {
    const shown = n.toLocaleString("en-US");
    throw new FinishError(
      limit === MAX_CONVEX_TRIANGLES
        ? `this shape is too detailed to ${verb} (${shown} triangles)`
        : `this shape is too detailed to ${verb}: it has ${shown} triangles and it is not convex (it has a dent or a hole), and above ${most} of those it would take too long. ${instead}`,
    );
  }
}

/**
 * Hollow out a solid, leaving walls `thickness` thick all round. `open` leaves
 * one face open (the top or the bottom), like a cup or a box without its lid:
 * the inside is carried through that face.
 *
 * Throws a FinishError if the shape is too detailed (see `checkSize`), if the
 * walls are too thick to leave anything inside, or if nothing is left after
 * hollowing. The result is remembered (see `remember`).
 *
 * @param k The kernel to build with.
 * @param s The solid to hollow out.
 * @param thickness How thick the walls are.
 * @param open Which face to leave open, if any.
 */
export function hollow(k: Kernel, s: Solid, thickness: number, open: "none" | "top" | "bottom"): Solid {
  checkSize(k, s, "shell", "Use fewer sides on the curves, or hollow it with a subtract of a smaller copy of the shape.");
  return remember(k, key(s, "hollow", thickness, open), () => hollowOut(k, s, thickness, open));
}

/**
 * The work of `hollow`, done: the inside is the solid shrunk by `thickness`,
 * and it is cut out of the solid (after being carried through the open face,
 * if there is one).
 */
function hollowOut(k: Kernel, s: Solid, thickness: number, open: "none" | "top" | "bottom"): Solid {
  const inner = k.erode(s, thickness, "ball", detailFor(triangles(s)));
  if (!(inner.volume() > 1e-9)) {
    throw new FinishError(`the walls are too thick for this shape: nothing is left inside. Use less than half of its thinnest size`);
  }
  let cutter = inner;
  if (open !== "none") {
    const outer = s.bounds();
    const ib = inner.bounds();
    const need = open === "top" ? outer.max[2] - ib.max[2] + 1 : ib.min[2] - outer.min[2] + 1; // how far to carry the inside out through the wall
    const height = ib.max[2] - ib.min[2];
    const step = Math.max(height / 2, 0.5);
    // carry the inside outwards in overlapping steps, so a curved inside is
    // carried as it is and not filled in
    for (let d = step; d < need + step; d += step) {
      const shift = Math.min(d, need) * (open === "top" ? 1 : -1);
      cutter = k.union(cutter, k.place(inner, { position: [0, 0, shift] }));
    }
  }
  const result = k.subtract(s, cutter);
  if (!(result.volume() > 1e-9)) throw new FinishError("nothing is left after hollowing");
  return result;
}

/**
 * Round (`element` ball) or bevel (`element` diamond) the edges of a solid by
 * `size`: the outside edges, or, with `inside`, the inside corners. Parts
 * thinner than twice the size are lost when rounding outside edges, so that is
 * an error.
 *
 * Throws a FinishError if the shape is too detailed (see `checkSize`), if the
 * size is too big for the shape, or if the result is not a valid solid. The
 * result is remembered (see `remember`).
 *
 * @param k The kernel to build with.
 * @param s The solid to finish.
 * @param size How far the rounding or bevel reaches.
 * @param inside Finish the inside corners (a fillet) and not the outside edges.
 * @param element A ball rounds; a diamond bevels.
 */
export function finishEdges(k: Kernel, s: Solid, size: number, inside: boolean, element: "ball" | "diamond"): Solid {
  checkSize(k, s, element === "ball" ? (inside ? "fillet" : "round") : "chamfer", element === "ball" ? "Round the flat sketch before it is extruded (put a round block around its rectangle or circle: the sides of the shape are then rounded, quickly), or use fewer sides on the curves, or round fewer shapes at once." : "Use fewer sides on the curves, or bevel fewer shapes at once.");
  return remember(k, key(s, "edges", size, inside, element), () => finishEdgesNow(k, s, size, inside, element));
}

/**
 * The work of `finishEdges`, done. Outside edges: shrink the shape by `size`
 * and grow it back, which leaves its edges rounded (or beveled). Inside
 * corners: the same, growing first and then shrinking.
 */
function finishEdgesNow(k: Kernel, s: Solid, size: number, inside: boolean, element: "ball" | "diamond"): Solid {
  const detail = detailFor(triangles(s));
  const work = inside ? k.dilate(s, size, element, detail) : k.erode(s, size, element, detail);
  if (!(work.volume() > 1e-9)) {
    throw new FinishError(`the size is too big for this shape: it is thinner than twice that. Use less than half of its thinnest size`);
  }
  const result = inside ? k.erode(work, size, element, detail) : k.dilate(work, size, element, detail);
  if (!result.isValid()) throw new FinishError("this shape could not be rounded");
  return result;
}
