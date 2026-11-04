import type { Vec2, Vec3 } from "./kernel";

/** The sum of two vectors: `a` moved by `b` */
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** The vector from `b` to `a` (`a` minus `b`) */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** A vector made `s` times as long (and turned around, if `s` is negative) */
export function mul(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/**
 * The dot product: the lengths multiplied by the cosine of the angle between
 * them. Zero for vectors at right angles.
 */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * The cross product: a vector at right angles to both, whose length is the area
 * of the parallelogram they make. Looking from where it points, `b` is
 * counter-clockwise from `a`. Zero if they point the same way or opposite ways.
 */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * A vector of length 1 pointing the same way as `a`. (NaN if `a` has length 0.)
 */
export function unit(a: Vec3): Vec3 {
  return mul(a, 1 / Math.hypot(...a));
}

/**
 * The 2D cross product: positive when `b` is counter-clockwise from `a`, negative
 * when it is clockwise, and zero if they point the same way or opposite ways.
 * It is the length of the 3D cross product's z (for vectors with z = 0), and so
 * the area of the parallelogram they make, signed.
 */
export function cross2(a: Vec2, b: Vec2): number {
  return a[0] * b[1] - a[1] * b[0];
}

/**
 * Twice the signed area of the triangle a, b, c: positive when the turn from a
 * to b to c is to the left (c is on the left of the line from a to b), negative
 * when it is to the right, and zero when the three are on one line. This is
 * `cross2(b - a, c - a)`, written out so that no vectors are made, since the
 * triangulation asks it very often.
 */
export function turn(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/**
 * The signed area of a polygon (the shoelace formula): positive when the points
 * run counter-clockwise, negative when clockwise
 */
export function polygonArea(pts: Vec2[]): number {
  // each edge, from a point to the next (wrapping around to the first after
  // the last), adds the signed area of the triangle it makes with the origin
  const twice = pts.reduce((sum, p, i) => sum + cross2(p, pts[(i + 1) % pts.length]), 0);
  return twice / 2;
}
