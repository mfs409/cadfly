import type { Kernel, Solid, Vec2, Vec3 } from "./kernel";
import { add, cross, dot, mul, polygonArea, sub, turn, unit } from "./vec";

/**
 * Solids made from rings of points. A loft blends one outline into another,
 * and a sweep carries an outline along a path. Both are a stack of rings joined
 * side to side, closed at each end by a flat cap (`ringsSolid`).
 *
 * Words used here:
 * - An outline is a closed flat shape, written as the list of its corners
 *   (u, v), joined in order with the last joined back to the first. A square
 *   is four corners and a circle is many short sides. It is what a rectangle,
 *   circle or polygon block draws, and the same thing as a polygon in
 *   `Flat.polygons`. (A sweep calls the one it carries its `profile`.)
 * - A ring is an outline placed in 3D space: the same corners, each now with a
 *   position (x, y, z). A loft has two rings, one at the bottom and one at the
 *   top. A sweep has one ring at each point of its path.
 * - The solid is the rings stacked and joined, corner to corner, with a flat
 *   cap closing each end. The caps are made by cutting the end ring's outline
 *   into triangles (`triangulate`).
 */

/** Why an outline or path cannot make a solid, in words a person can act on */
export class SweepError extends Error {}

/**
 * Cut a simple polygon into triangles by clipping one corner at a time: a
 * corner is cut off, as a triangle with its two neighbors, when no other corner
 * is inside that triangle. A corner on the edge of the triangle counts as
 * inside it.
 *
 * NB: The sides of the solid have an edge at every corner. If a corner ended up
 * on the long side of a triangle, the cap would have no edge there to meet the
 * side, and there would be a gap. So every corner stays a corner of the
 * triangles, and a corner on a straight line between its neighbors is never cut
 * off.
 *
 * Throws a SweepError if no corner can be clipped, which means the outline
 * crosses itself.
 *
 * @param pts The polygon's corners, in order, either way around.
 * @returns Triangles, as three positions in `pts`, each counter-clockwise. The
 *          last is left out if it would have no area.
 */
export function triangulate(pts: Vec2[]): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  if (polygonArea(pts) < 0) idx.reverse();
  const out: [number, number, number][] = [];
  
  /** Is the point p inside the triangle a, b, c, or on its edge? */
  function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2) {
    return turn(a, b, p) >= -1e-12 && turn(b, c, p) >= -1e-12 && turn(c, a, p) >= -1e-12;
  }

  while (idx.length > 3) {
    let clipped = false;
    for (let i = 0; i < idx.length && !clipped; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (turn(pts[a], pts[b], pts[c]) <= 1e-12) continue;
      if (idx.some((j) => j !== a && j !== b && j !== c && inTriangle(pts[j], pts[a], pts[b], pts[c]))) continue;
      out.push([a, b, c]);
      idx.splice(i, 1);
      clipped = true;
    }
    if (!clipped) throw new SweepError("the outline is too tangled to close the ends of the shape (does it cross itself?)");
  }
  if (Math.abs(turn(pts[idx[0]], pts[idx[1]], pts[idx[2]])) > 1e-12) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/**
 * The solid whose sides join each ring to the next, and whose ends are closed
 * by caps. If it comes out inside-out it is turned over. Throws a SweepError
 * if the surface crosses itself so that the kernel cannot build a solid.
 *
 * @param k The kernel to build with.
 * @param rings The rings, in order from the first to the last. They all have
 *              the same number of points, in the same order, going
 *              counter-clockwise as seen from the last ring looking back at
 *              the first.
 * @param bottomCap The first ring's points as 2D points (its outline), in the
 *                  same order, to cut up into the triangles of the first end.
 * @param topCap The same for the last ring.
 */
function ringsSolid(k: Kernel, rings: Vec3[][], bottomCap: Vec2[], topCap: Vec2[]): Solid {
  const n = rings[0].length;
  const points = rings.flat();
  const tris: number[] = [];
  /** The number of point `j` of ring `r`, going around (so `n` is back at 0) */
  function at(r: number, j: number) {
    return r * n + (j % n);
  }
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let j = 0; j < n; j++) tris.push(at(r, j), at(r, j + 1), at(r + 1, j + 1), at(r, j), at(r + 1, j + 1), at(r + 1, j));
  }
  for (const [a, b, c] of triangulate(bottomCap)) tris.push(at(0, a), at(0, c), at(0, b));
  const last = rings.length - 1;
  for (const [a, b, c] of triangulate(topCap)) tris.push(at(last, a), at(last, b), at(last, c));
  // a shape drawn the wrong way around would be inside out: turn it over
  let volume = 0;
  for (let i = 0; i < tris.length; i += 3) volume += dot(points[tris[i]], cross(points[tris[i + 1]], points[tris[i + 2]])) / 6;
  if (volume < 0) for (let i = 0; i < tris.length; i += 3) [tris[i + 1], tris[i + 2]] = [tris[i + 2], tris[i + 1]];
  try {
    const s = k.fromMesh({ positions: new Float32Array(points.flat()), indices: new Uint32Array(tris) });
    if (!(s.volume() > 0)) throw new Error("no volume");
    return s;
  } catch {
    throw new SweepError("the surface crosses itself, so it is not a solid (the path may bend too sharply for the outline, or the outline crosses itself)");
  }
}

/**
 * The outline as counter-clockwise points that start where a ray going right
 * from the middle of its bounding box meets it (a corner is put in at that
 * place). A loft starts both of its outlines this way, so their starting points
 * are on the same side and the loft is not twisted. If the ray misses the
 * outline (the outline only crosses the middle height to the left of the
 * middle), the points are from the outline's own first point. The outline given
 * is not changed, but when nothing needs changing the same array comes back.
 */
function startedAtRay(outline: Vec2[]): Vec2[] {
  const pts = polygonArea(outline) < 0 ? [...outline].reverse() : outline;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let best: { x: number; i: number } | undefined;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    if ((y1 > cy) === (y2 > cy)) continue;
    const x = x1 + ((cy - y1) / (y2 - y1)) * (x2 - x1);
    if (x >= cx - 1e-9 && (!best || x < best.x)) best = { x, i };
  }
  if (!best) return pts;
  const { x, i } = best;
  const turned: Vec2[] = [[x, cy], ...pts.slice(i + 1), ...pts.slice(0, i + 1)];
  // the ray may meet a corner exactly, which is then there twice
  return turned.filter((p, j) => Math.hypot(p[0] - turned[(j + 1) % turned.length][0], p[1] - turned[(j + 1) % turned.length][1]) > 1e-9);
}

/**
 * Measure a closed outline by how far around it each corner is, as a fraction
 * of its whole length (0 to 1), so that two outlines can be compared place by
 * place.
 *
 * @returns `corners`, where corner `i` is as a fraction (the first is 0), and
 *          `pointAt`, which gives the point on the outline at any fraction.
 */
function walked(outline: Vec2[]) {
  const lengths = outline.map((p, i) => Math.hypot(outline[(i + 1) % outline.length][0] - p[0], outline[(i + 1) % outline.length][1] - p[1]));
  const total = lengths.reduce((a, b) => a + b, 0);
  const corners: number[] = [];
  let run = 0;
  for (const l of lengths) {
    corners.push(run / total);
    run += l;
  }
  /** The point `t` of the way around the outline (0 to 1) */
  function pointAt(t: number): Vec2 {
    let i = corners.length - 1;
    while (i > 0 && corners[i] > t + 1e-12) i--;
    const next = i + 1 < corners.length ? corners[i + 1] : 1;
    const f = next - corners[i] < 1e-12 ? 0 : (t - corners[i]) / (next - corners[i]);
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    return [x1 + f * (x2 - x1), y1 + f * (y2 - y1)];
  }
  return { corners, pointAt };
}

/**
 * Blend one outline into another: `height` up from the first to the second (z
 * from 0 to height). The outlines may be different shapes (a square becoming a
 * circle); each corner of either is kept. That is done by walking around both
 * outlines by the same fractions of their lengths: each ring has a point at
 * every fraction where either outline has a corner, so a corner of one is
 * matched by a point on the other.
 *
 * Throws a SweepError if an outline crosses itself.
 *
 * @param k The kernel to build with.
 * @param bottom The outline at z = 0, either way around.
 * @param top The outline at z = `height`, either way around.
 * @param height How far apart the outlines are.
 */
export function loft(k: Kernel, bottom: Vec2[], top: Vec2[], height: number): Solid {
  const a = walked(startedAtRay(bottom));
  const b = walked(startedAtRay(top));
  const ts = [...a.corners, ...b.corners].sort((x, y) => x - y).filter((t, i, all) => i === 0 || t - all[i - 1] > 1e-9);
  const lower = ts.map(a.pointAt);
  const upper = ts.map(b.pointAt);
  return ringsSolid(k, [lower.map(([u, v]): Vec3 => [u, v, 0]), upper.map(([u, v]): Vec3 => [u, v, height])], lower, upper);
}

/**
 * Rotate `v` the way `from` would have to rotate to become `to` (Rodrigues'
 * formula): the shortest rotation, about the axis at right angles to both
 * directions. Both must have length 1. If they are the same, `v` is returned as
 * it is. (For opposite directions there is no one axis: `sweep` refuses a path
 * that turns right back on itself.)
 */
function turned(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const axis = cross(from, to);
  const s = Math.hypot(...axis);
  const c = dot(from, to);
  if (s < 1e-12) return v;
  const k = mul(axis, 1 / s);
  return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c)));
}

/**
 * Carry an outline along a path of points. The outline is drawn as seen
 * looking along the first part of the path: u across, v up (along +z, u is x
 * and v is y). At each bend the outline is cut on the slant, so it keeps its
 * width around the corner.
 *
 * The outline keeps its own turn as it goes, without spinning about the path:
 * `across` and `up` start as horizontal and up, and are turned by each bend
 * along with the path (`turned`). A path that begins straight up has no
 * horizontal, so it starts with u along x.
 *
 * Throws a SweepError for a path of fewer than 2 points, two points in the
 * same place, a path that turns right back on itself (a bend of more than
 * about 177 degrees), or an outline and path that make a surface crossing
 * itself.
 *
 * @param k The kernel to build with.
 * @param profile The outline to carry, either way around.
 * @param path The points to pass through, in order.
 */
export function sweep(k: Kernel, profile: Vec2[], path: Vec3[]): Solid {
  if (path.length < 2) throw new SweepError("the path needs at least 2 points");
  const dirs = path.slice(1).map((p, i) => {
    const d = sub(p, path[i]);
    if (Math.hypot(...d) < 1e-9) throw new SweepError(`path points ${i + 1} and ${i + 2} are in the same place`);
    return unit(d);
  });
  for (let i = 1; i < dirs.length; i++) {
    if (dot(dirs[i - 1], dirs[i]) < -0.999) throw new SweepError(`the path turns right back on itself at point ${i + 1}`);
  }
  const outline = polygonArea(profile) < 0 ? [...profile].reverse() : profile;
  const d0 = dirs[0];
  let across: Vec3 = Math.hypot(d0[0], d0[1]) < 1e-9 ? [1, 0, 0] : unit(cross([0, 0, 1], d0));
  let up = cross(d0, across);
  const rings: Vec3[][] = [];
  path.forEach((p, i) => {
    const before = dirs[Math.max(0, i - 1)];
    const normal = i === 0 || i === path.length - 1 ? before : unit(add(dirs[i - 1], dirs[i]));
    rings.push(
      outline.map(([u, v]) => {
        const q = add(p, add(mul(across, u), mul(up, v)));
        // slide along the direction of travel onto the slanted plane through
        // the point
        const slide = -dot(sub(q, p), normal) / dot(before, normal);
        return add(q, mul(before, slide));
      }),
    );
    if (i < dirs.length && i > 0) {
      across = turned(across, dirs[i - 1], dirs[i]);
      up = turned(up, dirs[i - 1], dirs[i]);
    }
  });
  return ringsSolid(k, rings, outline, outline);
}
