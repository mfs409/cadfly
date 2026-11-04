import type { Kernel, Solid, Vec2, Vec3 } from "./kernel";
import { polygonArea } from "./vec";

/**
 * Sketches: the flat shapes that a block draws, and the planes they are drawn
 * on.
 *
 * A sketch shape is a plain description (a rectangle, a circle, a polygon, a
 * letter). `shapeToContour` checks it and turns it into a polygon. Positions
 * and sizes are in the plane's own (u, v) coordinates. The numbers are expected
 * to be finite: the blocks get them from the expression evaluator, which
 * refuses anything else.
 */

/**
 * Sketches live on one of the three principal planes, offset along the
 * plane's normal. A sketch point (u, v) maps to world space as:
 *   XY: (u, v, offset)      normal +Z
 *   XZ: (u, -offset, v)     normal -Y
 *   YZ: (offset, u, v)      normal +X
 * so u points right and v points up when viewed from the normal's side.
 */
export type PlaneName = "XY" | "XZ" | "YZ";

/** The direction each plane faces, which `offset` is measured along */
const NORMALS: Record<PlaneName, Vec3> = {
  XY: [0, 0, 1],
  XZ: [0, -1, 0],
  YZ: [1, 0, 0],
};

/**
 * The rotation (degrees about X, then Y, then Z, as in `Placement`) that takes
 * the kernel's local frame (a sketch in XY, extruding along +Z) onto each plane
 */
const ROTATIONS: Record<PlaneName, Vec3> = {
  XY: [0, 0, 0],
  XZ: [90, 0, 0],
  YZ: [90, 0, 90],
};

/** The rotation that takes a shape built on the XY plane onto this plane */
export function planeRotation(plane: PlaneName): Vec3 {
  return ROTATIONS[plane];
}

/**
 * Where a plane is: the world position of its (0, 0), which is `offset` along
 * its normal from the origin. (The `+ 0` turns a negative zero into 0.)
 */
export function planeOrigin(plane: PlaneName, offset: number): Vec3 {
  const n = NORMALS[plane];
  return [n[0] * offset + 0, n[1] * offset + 0, n[2] * offset + 0];
}

/**
 * A solid built with the sketch in the XY plane and the height along +z, put
 * on the plane it was drawn on.
 *
 * @param k The kernel to build with.
 * @param s The solid, built on the XY plane.
 * @param plane The plane the sketch was drawn on.
 * @param offset How far from the origin the plane is, along its normal.
 */
export function onPlane(k: Kernel, s: Solid, plane: PlaneName, offset: number): Solid {
  return k.place(k.place(s, { rotation: planeRotation(plane) }), { position: planeOrigin(plane, offset) });
}

/** A rectangle */
interface RectShape {
  /** The type of shape */
  kind: "rect";
  /** The lower left corner (u, v), before the shape is turned by `angle` */
  at: Vec2;
  /** How wide (along u) */
  w: number;
  /** How how tall (along v) */
  h: number;
  /** Degrees, counter-clockwise, to turn it about its center */
  angle?: number;
  /** Rounds the corners by this much (at most half the shorter side) */
  radius?: number;
  /** Is it a hole */
  hole?: boolean;
}

/** A circle */
interface CircleShape {
  /** The kind of shape */
  kind: "circle";
  /** The center (u, v) */
  center: Vec2;
  /** The radius */
  r: number;
  /** Is it a hole */
  hole?: boolean;
}

/**
 * A polygon: straight lines joining the points in order, and the last back to
 * the first
 */
interface PolylineShape {
  /** The kind of shape */
  kind: "polyline";
  /** At least three, and the lines may not cross each other */
  points: Vec2[];
  /** Degrees, counter-clockwise, to turn it about its first point */
  angle?: number;
  /** Is it a hole */
  hole?: boolean;
}

/** One letter, or any shape with its own holes */
interface GlyphShape {
  /** The kind of shape */
  kind: "glyph";
  /**
   * Its outlines. An outline inside another is a hole in this shape, and one
   * inside that is solid again, and so on (the "even-odd" rule), so a letter
   * like O has its hole without cutting anything else.
   */
  contours: Vec2[][];
  /** Is it a hole */
  hole?: boolean;
}

/**
 * A closed flat shape, every dimension given explicitly. A shape marked `hole`
 * is cut out of the other shapes in its sketch, instead of adding to them.
 */
export type SketchShape = RectShape | CircleShape | PolylineShape | GlyphShape;

/** A shape that cannot be made: the message says why, in plain words */
export class SketchError extends Error {}

/**
 * A circle is drawn as a polygon with this many sides (see `Flat.polygons`).
 * Its area is then 99.84% of a true circle's.
 */
const CIRCLE_SEGMENTS = 64;

/**
 * A rounded corner is drawn as this many straight pieces for each quarter turn
 */
const CORNER_STEPS = 12;

/**
 * True if segment ab crosses segment cd: they meet at a point that is inside
 * both, not at an end of either. Segments that only touch, or that overlap
 * along a line, do not count.
 */
function crosses(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  /**
   * Which side of the line through p and q the point r is on: 1 or -1, or 0 if
   * it is on the line
   */
  const side = (p: Vec2, q: Vec2, r: Vec2) =>
    Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/**
 * Throw if any two edges of the polygon cross each other (a bow tie /
 * figure-8). It compares every pair of edges, which is fine for the few points
 * a person draws.
 */
function assertSimple(pts: Vec2[]) {
  const n = pts.length;
  for (let i = 0; i < n; ++i) {
    for (let j = i + 2; j < n; ++j) {
      if (i === 0 && j === n - 1) continue; // adjacent via the closing edge
      if (crosses(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) {
        throw new SketchError("polyline crosses itself");
      }
    }
  }
}

/** A copy of some points, sharing nothing with the original */
function copyOf(pts: Vec2[]): Vec2[] {
  return pts.map((p): Vec2 => [p[0], p[1]]);
}

/**
 * Rotate points counter-clockwise by degrees about a pivot. The result is new
 * points: the ones given are not changed or shared, even with no turn.
 */
function rotateAbout(pts: Vec2[], pivot: Vec2, degrees: number): Vec2[] {
  if (!degrees) return copyOf(pts);
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return pts.map(([x, y]): Vec2 => {
    const dx = x - pivot[0];
    const dy = y - pivot[1];
    return [pivot[0] + dx * c - dy * s, pivot[1] + dx * s + dy * c];
  });
}

/**
 * A rectangle with `corner` as its lower left corner, counter-clockwise, with
 * its corners rounded by `radius`. A radius over half of the shorter side is
 * cut down to that, and the arcs then meet, which leaves a repeated point at
 * each meeting (the library merges them).
 */
function roundedRectangle(corner: Vec2, w: number, h: number, radius: number): Vec2[] {
  const [x, y] = corner;
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 1e-9) {
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  const pts: Vec2[] = [];
  // each corner is a quarter turn about its own center, starting from the
  // bottom right and going around: its center, and the angle it starts at
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90],
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const t = ((start + (90 * i) / CORNER_STEPS) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  return pts;
}

/**
 * Turn a shape into one closed polygon, checking it as it goes. A rectangle or
 * circle comes out counter-clockwise; a polygon keeps the order it was given.
 * A letter gives its biggest outline, without its holes (see `shapeToContours`
 * for those). The points are always new: they share nothing with the shape, so
 * they can be changed freely.
 *
 * Throws a SketchError, saying why, for a size that is not a positive number,
 * a polygon with fewer than three points or no area or lines that cross, or a
 * letter with no outline.
 */
export function shapeToContour(s: SketchShape): Vec2[] {
  const positive = (v: number, what: string) => {
    if (!Number.isFinite(v) || v <= 0) throw new SketchError(`${what} must be a positive number`);
  };
  switch (s.kind) {
    case "rect":
      positive(s.w, "rectangle width");
      positive(s.h, "rectangle height");
      if (s.radius !== undefined && !(Number.isFinite(s.radius) && s.radius >= 0)) throw new SketchError("rectangle corner radius cannot be negative");
      return rotateAbout(roundedRectangle(s.at, s.w, s.h, s.radius ?? 0), [s.at[0] + s.w / 2, s.at[1] + s.h / 2], s.angle ?? 0);
    case "circle": {
      positive(s.r, "circle radius");
      const pts: Vec2[] = [];
      for (let i = 0; i < CIRCLE_SEGMENTS; ++i) {
        const t = (2 * Math.PI * i) / CIRCLE_SEGMENTS;
        pts.push([s.center[0] + s.r * Math.cos(t), s.center[1] + s.r * Math.sin(t)]);
      }
      return pts;
    }
    case "polyline": {
      if (s.points.length < 3) throw new SketchError("polyline needs at least 3 points");
      const pts = rotateAbout(s.points, s.points[0], s.angle ?? 0);
      assertSimple(pts); // first: a bow tie has zero signed area
      if (Math.abs(polygonArea(pts)) < 1e-9) throw new SketchError("polyline encloses no area");
      return pts;
    }
    case "glyph": {
      const outer = s.contours.filter((c) => c.length >= 3).sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)))[0];
      if (!outer) throw new SketchError("a letter has no outline");
      return copyOf(outer); // the biggest outline: the letter's outside
    }
  }
}

/**
 * Every outline of a shape, read even-odd (see `GlyphShape.contours`): one for
 * most shapes, and for a letter all of them, so its holes come with it. The
 * points are always new, as for `shapeToContour`.
 */
export function shapeToContours(s: SketchShape): Vec2[][] {
  if (s.kind !== "glyph") return [shapeToContour(s)];
  shapeToContour(s); // for its checks: it throws if the letter has no outline
  return s.contours.filter((c) => c.length >= 3).map(copyOf);
}
