import type { Kernel, Solid, Vec3 } from "./kernel";

/**
 * Compute new solids by shifting existing solids, along one axis, to a position
 * relative to an "anchor" solid, which stays where it is. A solid is never
 * changed in place: each function gives shifted copies and leaves the solids it
 * was given alone.
 */

/**
 * An axis: 0 = x, 1 = y, 2 = z. The numbers are chosen so that an axis can be
 * used directly as an index into a `Vec3` (`bounds.min[axis]`).
 */
export type Axis = 0 | 1 | 2;

/** Create a copy of solid `s`, shifted by `delta` along one `axis` */
function shifted(k: Kernel, s: Solid, axis: Axis, delta: number): Solid {
  const by: Vec3 = [0, 0, 0];
  by[axis] = delta;
  return k.place(s, { position: by });
}

/**
 * Given an anchor and a list of solids, produce a list with new solids that are
 * clones of the original list, except they are aligned with the anchor on one
 * axis. The axis stands for the plane across it (x means the YZ plane). The
 * mode picks which plane of each solid's bounding box is used: its low face
 * (min), its middle (center) or its high face (max). Each solid moves along the
 * axis until that plane is where the anchor's is. Nothing moves in the other
 * two directions.
 *
 * @param k The kernel to make the shifted copies with.
 * @param anchor The solid to align with (it stays where it is).
 * @param solids The solids to give shifted copies of.
 * @param axis The axis to align them on.
 * @param mode Which plane of the bounding boxes to match: the low face, the
 *             middle, or the high face.
 * @returns The shifted copies, in the order of `solids`.
 */
export function align(k: Kernel, anchor: Solid, solids: Solid[], axis: Axis, mode: "min" | "center" | "max"): Solid[] {
  const b = anchor.bounds();
  return solids.map((o) => {
    const { min, max } = o.bounds();
    const delta = mode === "min" ? b.min[axis] - min[axis] : mode === "max" ? b.max[axis] - max[axis] : (b.min[axis] + b.max[axis]) / 2 - (min[axis] + max[axis]) / 2;
    return shifted(k, o, axis, delta);
  });
}

/**
 * Given an anchor and a list of solids, produce a list with new solids that are
 * clones of the original list, except tat they touch the anchor on one axis.
 * The axis stands for the plane across it (x means the YZ plane). The side
 * picks which face of the anchor's bounding box the solids meet: with "high"
 * each solid's low face is put against the anchor's high face, so the solid
 * sits beyond the anchor; with "low" each solid's high face is put against the
 * anchor's low face, so it sits before the anchor. Each solid moves along the
 * axis only, and nothing moves in the other two directions.
 *
 * @param k The kernel to make the shifted copies with.
 * @param anchor The solid to touch (it stays where it is).
 * @param solids The solids to give shifted copies of.
 * @param axis The axis to place them on.
 * @param side Which side of the anchor they go on: "high" (beyond its high
 *             face) or "low" (before its low face).
 * @returns The shifted copies, in the order of `solids`.
 */
export function placeAgainst(k: Kernel, anchor: Solid, solids: Solid[], axis: Axis, side: "low" | "high"): Solid[] {
  const b = anchor.bounds();
  return solids.map((o) => {
    const { min, max } = o.bounds();
    return shifted(k, o, axis, side === "high" ? b.max[axis] - min[axis] : b.min[axis] - max[axis]);
  });
}
