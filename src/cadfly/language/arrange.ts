import type { Kernel, Solid, Vec3 } from "../geometry/kernel";

/**
 * Moving solids against one another, for the lineUp and placeAgainst blocks.
 * Each function gives new solids and leaves the ones given as they were.
 */

/** 0 = x, 1 = y, 2 = z */
export type Axis = 0 | 1 | 2;

/** The solid moved by `delta` along one axis */
function shifted(k: Kernel, s: Solid, axis: Axis, delta: number): Solid {
  const by: Vec3 = [0, 0, 0];
  by[axis] = delta;
  return k.place(s, { position: by });
}

/**
 * Move each of the others so its min edge, center or max edge on `axis`
 * matches the base's
 *
 * @param k The kernel to move the solids with.
 * @param base The solid to line up with (it does not move).
 * @param others The solids to move.
 * @param axis The direction to line them up in.
 * @param mode Which edge to match: the low edge, the middle, or the high edge.
 * @returns The moved solids, in the order of `others`.
 */
export function lineUp(k: Kernel, base: Solid, others: Solid[], axis: Axis, mode: "min" | "center" | "max"): Solid[] {
  const b = base.bounds();
  return others.map((o) => {
    const { min, max } = o.bounds();
    const delta = mode === "min" ? b.min[axis] - min[axis] : mode === "max" ? b.max[axis] - max[axis] : (b.min[axis] + b.max[axis]) / 2 - (min[axis] + max[axis]) / 2;
    return shifted(k, o, axis, delta);
  });
}

/**
 * Move each of the others so it touches the base: on the base's high side (the
 * other's low edge meets the base's high edge) or its low side (the other's
 * high edge meets the base's low edge).
 *
 * @param k The kernel to move the solids with.
 * @param base The solid to touch (it does not move).
 * @param others The solids to move.
 * @param axis The direction to move them in.
 * @param side Which side of the base they go on.
 * @returns The moved solids, in the order of `others`.
 */
export function placeAgainst(k: Kernel, base: Solid, others: Solid[], axis: Axis, side: "low" | "high"): Solid[] {
  const b = base.bounds();
  return others.map((o) => {
    const { min, max } = o.bounds();
    return shifted(k, o, axis, side === "high" ? b.max[axis] - min[axis] : b.min[axis] - max[axis]);
  });
}
