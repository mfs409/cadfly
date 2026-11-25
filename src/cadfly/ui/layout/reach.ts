import type { Rect } from "./types";

/**
 * How far a thing that can be touched reaches. A finger is bigger than a small
 * button, so a button smaller than a comfortable size is given a larger area to
 * touch than the one it is drawn in, wherever there is free room around it.
 * The drawing does not change. All of it is plain numbers (meters, y down).
 */

/**
 * The room one rectangle has to grow along one axis, and how much it takes of
 * it.
 *
 * The rectangle grows equally on both sides, as far as the room on each side
 * allows, and what one side cannot give the other makes up, until it has the
 * size wanted or there is no room left. The room on a side is the way to the
 * limit, or to the nearest other rectangle in line with it. When that other
 * rectangle is itself too small, and so also wants room, the free space between
 * them is shared equally, so that two small neighbors never grow into each
 * other.
 *
 * @param lo Where the rectangle starts along the axis.
 * @param hi Where it ends.
 * @param min The size it is to have.
 * @param limit Where it may not go beyond: its start and end.
 * @param neighbors The other rectangles in line with it: where each starts and
 *                  ends along the axis, and whether it is too small too.
 * @returns Where the rectangle starts and ends after growing.
 */
function grownAlong(lo: number, hi: number, min: number, limit: [number, number], neighbors: { lo: number; hi: number; small: boolean }[]): [number, number] {
  if (hi - lo >= min) return [lo, hi];
  let roomLow = Math.max(0, lo - limit[0]);
  let roomHigh = Math.max(0, limit[1] - hi);
  for (const n of neighbors) {
    if (n.hi <= lo) roomLow = Math.min(roomLow, (lo - n.hi) / (n.small ? 2 : 1));
    else if (n.lo >= hi) roomHigh = Math.min(roomHigh, (n.lo - hi) / (n.small ? 2 : 1));
    else roomLow = roomHigh = 0; // it already overlaps another: it cannot grow into it
  }
  const need = min - (hi - lo);
  const takeLow = Math.min(roomLow, need / 2);
  const takeHigh = Math.min(roomHigh, need / 2);
  const rest = need - takeLow - takeHigh;
  const moreLow = Math.min(roomLow - takeLow, rest);
  const moreHigh = Math.min(roomHigh - takeHigh, rest - moreLow);
  return [lo - takeLow - moreLow, hi + takeHigh + moreHigh];
}

/** Do two stretches overlap by more than a touch? */
const overlaps = (aLo: number, aHi: number, bLo: number, bHi: number) => aLo < bHi && bLo < aHi;

/**
 * Give each rectangle that is smaller than `min` (in width, in height, or both)
 * the larger area to touch it by. It grows first sideways and then up and down,
 * only into room that no other rectangle in the list takes up, and never
 * beyond its limit, so no two grown rectangles overlap if no two overlapped to
 * begin with. A rectangle that cannot reach `min`, because there is not room,
 * gets as much as there is.
 *
 * @param rects The rectangles, which are the things that can be touched and
 *              also whatever else takes room beside them.
 * @param limits Where each may grow to at most, in the order of `rects`.
 * @param min The size every one is to have, in meters (the same across and up
 *            and down).
 * @param grows Which of the rectangles are to grow, in the order of `rects`
 *              (default: all of them). The others, such as a word that nothing
 *              answers a touch on, stay as they are and only take up room.
 * @returns The rectangles after growing, in the same order.
 */
export function grownRects(rects: Rect[], limits: Rect[], min: number, grows: boolean[] = rects.map(() => true)): Rect[] {
  // across first, among the rectangles it is level with
  const wider = rects.map((r, i) => {
    if (!grows[i]) return r;
    const level = rects.flatMap((o, j) => (j !== i && overlaps(r.y, r.y + r.h, o.y, o.y + o.h) ? [{ lo: o.x, hi: o.x + o.w, small: grows[j] && o.w < min }] : []));
    const [lo, hi] = grownAlong(r.x, r.x + r.w, min, [limits[i].x, limits[i].x + limits[i].w], level);
    return { ...r, x: lo, w: hi - lo };
  });
  // then up and down, among the rectangles it is now above or below
  return wider.map((r, i) => {
    if (!grows[i]) return r;
    const level = wider.flatMap((o, j) => (j !== i && overlaps(r.x, r.x + r.w, o.x, o.x + o.w) ? [{ lo: o.y, hi: o.y + o.h, small: grows[j] && o.h < min }] : []));
    const [lo, hi] = grownAlong(r.y, r.y + r.h, min, [limits[i].y, limits[i].y + limits[i].h], level);
    return { ...r, y: lo, h: hi - lo };
  });
}

/**
 * Of the things whose area to touch could answer a point, the one whose middle
 * is nearest to it. (Areas that do not overlap give at most one candidate; the
 * nearest one decides when they do.)
 *
 * @param found The candidates: where each one's area to touch is, and what it
 *              answers.
 * @param x Where the pointer is.
 * @param y Where the pointer is.
 * @returns What the nearest candidate answers, or undefined if none has the
 *          point in its area.
 */
export function nearestReaching<T>(found: { area: Rect; answer: T }[], x: number, y: number): T | undefined {
  const inside = (r: Rect) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  const far = (r: Rect) => (x - (r.x + r.w / 2)) ** 2 + (y - (r.y + r.h / 2)) ** 2;
  return found.filter((f) => inside(f.area)).sort((a, b) => far(a.area) - far(b.area))[0]?.answer;
}
