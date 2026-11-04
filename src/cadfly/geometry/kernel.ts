/**
 * The shape-making operations (the `Kernel`) and the types they use. This file
 * is only types, so importing it costs nothing. `manifold.ts` makes the one
 * Kernel, and is the only file that uses manifold-3d.
 */

/**
 * A tuple consisting of two values (conventionally x and y, or u and v for a
 * flat shape), in a form that translates to the array format that manifold-3d
 * requires
 */
export type Vec2 = [number, number];

/**
 * A tuple consisting of three values (conventionally x, y, and z), in a form
 * that translates to the array format that manifold-3d requires
 */
export type Vec3 = [number, number, number];

/**
 * A surface as triangles that share their corners: a list of points, and a list
 * of triangles that say which points they join. This is the form three.js
 * draws, an STL file is written from, and `fromMesh` reads.
 */
export interface MeshData {
  /**
   * The points: x, y, z for each one, one after another (so its length is three
   * times the number of points). A point is numbered from 0.
   */
  positions: Float32Array;
  /**
   * The triangles: three point numbers for each one, one after another (so its
   * length is three times the number of triangles). Seen from outside the
   * solid, a triangle's corners go counter-clockwise.
   */
  indices: Uint32Array;
}

/** An immutable solid produced by a Kernel */
export interface Solid {
  /** Volume in cubic model units */
  volume(): number;
  /** Axis-aligned bounds */
  bounds(): { min: Vec3; max: Vec3 };
  /**
   * True if the solid is a valid, watertight manifold with some volume. An
   * empty solid is not valid.
   */
  isValid(): boolean;
  /**
   * The mesh that represents the solid: a copy, still good after `release()`
   */
  mesh(): MeshData;
}

/**
 * A flat shape: an area in a plane, with its own (u, v) coordinates (u:across,
 * v:up). Made of outlines, and it may have holes, or be in several pieces.
 */
export interface Flat {
  /** The area, in square units */
  area(): number;
  /**
   * The smallest rectangle that holds the whole shape.
   * - Its sides are aligned along u and v
   * - `min` is the corner with the smallest u and v
   * - `max` is the corner with the largest u and v
   *
   * Note that empty shapes return large numbers in both directions.  Check
   * isEmpty first.
   */
  bounds(): { min: Vec2; max: Vec2 };
  /**
   * True if the flat shape has no area, such as when non-overlapping shapes are
   * intersected or a shape is subtracted from itself.
   */
  isEmpty(): boolean;
  /**
   * Its outlines: the outer ones run counter-clockwise, the holes clockwise. A
   * flat shape is only ever straight-sided: a curve is a polygon with many
   * short sides (e.g., 64 sides for a circle).
   */
  polygons(): Vec2[][];
}

/**
 * Where a solid goes: turned first, then moved. Either part may be left out,
 * which leaves that part as it was (no turn, or no move). Both are measured
 * from the origin, not from the solid's own center.
 */
export interface Placement {
  /**
   * How far to turn the solid about the x axis, then the y axis, then the z
   * axis, in degrees (manifold-3d works in degrees). Each turn is about that
   * axis through the origin, and is counter-clockwise looking from the
   * positive end of the axis back towards the origin (the right-hand rule).
   * Done before position.
   */
  rotation?: Vec3;
  /**
   * How far to move the solid along x, y and z, in model units. Done after the
   * rotation.
   */
  position?: Vec3;
}

/**
 * The geometry operations the language needs. Every dimension is supplied by
 * the caller, in the same units throughout (the editor says millimeters).
 * Primitives are centered on the origin, with a cylinder's or cone's axis along
 * Z. Solids and flat shapes are immutable: every operation makes a new one.
 *
 * Memory: the kernel is C++ compiled to WebAssembly, and its shapes live in
 * that WASM memory, which JavaScript's garbage collector cannot free. A shape
 * isn't freed when the code stops using it, so the kernel remembers every shape
 * it makes (including the in-between ones inside an operation), and
 * `release()` frees them all once a build is over. See `release`, `keep` and
 * `drop`.
 */
export interface Kernel {
  /**
   * A box `w` wide (along x), `d` deep (along y) and `h` tall (along z),
   * centered on the origin
   */
  box(w: number, d: number, h: number): Solid;
  /**
   * A cylinder, or a cone if the radii differ (`rLow` is at the bottom).
   * `segments` is how many sides the curve has: left out, the kernel picks.
   */
  cylinder(rLow: number, rHigh: number, h: number, segments?: number): Solid;
  /**
   * A ball of radius `r`, centered on the origin. `segments` is how many sides
   * the circle around it has on each of the three axis planes, rounded up to a
   * multiple of four: left out, the kernel picks.
   */
  sphere(r: number, segments?: number): Solid;
  /**
   * Shrink a solid: move every face inward by `r`, so what is left is every
   * point that is at least `r` from the outside. A 20 mm cube eroded by 2 is a
   * 16 mm cube, and anything thinner than twice `r` disappears. Used to hollow
   * a shape (cut the eroded copy out of it), and, followed by `dilate`, to
   * round off its outside edges.
   *
   * Distance is measured with the `element`: a `ball` (ordinary distance, so
   * curved results are smooth) or a `diamond` (an octahedron, which gives flat
   * bevels). `detail` is how many segments the ball has: more is rounder, and
   * much slower on shapes that are not convex.
   */
  erode(s: Solid, r: number, element?: "ball" | "diamond", detail?: number): Solid;
  /**
   * Grow a solid: move every face outward by `r`, so the result is every point
   * within `r` of the original. Outside edges and corners come out rounded (a
   * `ball`) or beveled (a `diamond`). Followed by `erode`, it fills in the
   * inside corners where shapes join. See `erode` for `element` and `detail`.
   */
  dilate(s: Solid, r: number, element?: "ball" | "diamond", detail?: number): Solid;
  /**
   * A flat shape from outlines read even-odd: an outline inside another is a
   * hole, one inside that is solid again, and so on
   */
  flat(contours: Vec2[][]): Flat;
  /** Everything that is in either flat shape */
  flatUnion(a: Flat, b: Flat): Flat;
  /** What is in `a` and not in `b`: `b` is cut out of `a` */
  flatSubtract(a: Flat, b: Flat): Flat;
  /** Only what is in both flat shapes: empty if they do not overlap */
  flatIntersect(a: Flat, b: Flat): Flat;
  /**
   * Turn by `rotation` degrees (counter-clockwise) about the origin, then move
   * by `position`. Either may be left out.
   */
  flatPlace(f: Flat, p: { position?: Vec2; rotation?: number }): Flat;
  /**
   * Stretch about the origin by a factor along u and a factor along v (1 leaves
   * it as it is)
   */
  flatScale(f: Flat, factor: Vec2): Flat;
  /**
   * Reflect across the line through the origin that is perpendicular to an
   * axis (0 = u: the line where u = 0)
   */
  flatMirror(f: Flat, axis: 0 | 1): Flat;
  /**
   * Grow (`delta` above 0) or shrink the outline by `delta`. When growing,
   * corners that stick out become `round` (the default) or `sharp` (pointed,
   * cut off if the point would be more than twice `delta` away).
   */
  flatOffset(f: Flat, delta: number, corners?: "round" | "sharp"): Flat;
  /**
   * Push a flat shape up from z = 0 to `height`. The top may be turned by
   * `twist` degrees and scaled by `scaleTop` (1 keeps the size, 0.5 makes the
   * top half as big), both about the origin of the flat shape's plane, with the
   * sides drawn smoothly between.
   */
  extrudeFlat(f: Flat, height: number, options?: { twist?: number; scaleTop?: number }): Solid;
  /**
   * Spin a flat shape (u >= 0) about its v axis, which becomes the z axis of
   * the result, through `degrees` (360 is a full turn; less leaves a wedge)
   */
  revolveFlat(f: Flat, degrees: number): Solid;
  /**
   * Build a solid from a triangle mesh; throws if it is not a closed solid, has
   * no volume, or its triangles face inward
   */
  fromMesh(mesh: MeshData): Solid;
  /**
   * The smallest convex solid around the points; throws if they do not enclose
   * any volume
   */
  hull(points: Vec3[]): Solid;
  /**
   * Reflect across the plane through the origin that is perpendicular to an
   * axis (0 = x: the plane where x = 0)
   */
  mirror(s: Solid, axis: 0 | 1 | 2): Solid;
  /** Scale about the origin: one factor for all axes, or one per axis */
  scale(s: Solid, factor: number | Vec3): Solid;
  /** Turn and move a solid (see `Placement`: turned first, then moved) */
  place(s: Solid, p: Placement): Solid;
  /** Everything that is in either solid, as one */
  union(a: Solid, b: Solid): Solid;
  /** What is in `a` and not in `b`: `b` is cut away from `a` */
  subtract(a: Solid, b: Solid): Solid;
  /** Only what is in both solids: empty (not valid) if they do not overlap */
  intersect(a: Solid, b: Solid): Solid;
  /**
   * Free the memory of every shape made since the last call, except the ones
   * kept. Call it when a build is over and everything made in it has been
   * copied out (a mesh is data; a Solid is not): a released shape must not be
   * used again. Without it, memory grows with every build, by about a megabyte
   * for a program of a few dozen blocks.
   */
  release(): void;
  /**
   * Keep a solid through `release()`, so that it can be reused by a later build
   * (a cache of results). Returns the solid. Free it with `drop`.
   */
  keep(s: Solid): Solid;
  /**
   * A kept solid is no longer wanted: the next `release()` frees it. (Not at
   * once, since the build in progress may still be using it.)
   */
  drop(s: Solid): void;
}
