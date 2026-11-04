import Module, { type CrossSection, type Manifold } from "manifold-3d";
import type { Flat, Kernel, MeshData, Solid, Vec2, Vec3 } from "./kernel";

/**
 * A wrapper that presents manifold-3d (WebAssembly) as a Kernel (kernel.ts).
 *
 * The key idea here is that this is the only file that uses manifold-3d, and by
 * wrapping it in a kernel, the underlying manifold-3d is kept private.
 *
 * Note that manifold-3d's shapes (Manifold, CrossSection) are not garbage
 * collected, so there is special machinery (Kernel.release) for reclaiming them
 * once they stop being used.
 */

/** Anything the library keeps in its own memory (a Manifold, a CrossSection) */
interface Freeable {
  delete(): void;
}

/**
 * Memory tracks whatever the kernel made that is still retained in WASM memory.
 */
class Memory {
  /** Everything made since the last `release()`, to free on next release */
  private live = new Set<Freeable>();

  /** What is kept through `release()` (see `Kernel.keep`) */
  private kept = new Set<Freeable>();

  /**
   * Remember an object to free at the next `release()`. It returns the object,
   * so a call can be wrapped: `memory.own(m.rotate(...))`.
   */
  own<T extends Freeable>(o: T): T {
    this.live.add(o);
    return o;
  }

  /** Delete everything that was remembered as "live" but not "kept" */
  release() {
    for (const o of this.live) if (!this.kept.has(o)) o.delete();
    this.live.clear();
  }

  /** Protect an object from reclamation by `release()` */
  keep(o: Freeable) { this.kept.add(o); }

  /**
   * Unmark an object, and remember it again, so the next `release()` frees it:
   * not now, since the build in progress may still be using it
   */
  drop(o: Freeable) {
    this.kept.delete(o);
    this.live.add(o); // NB: It's a set, so duplication is not possible
  }
}

/** A Solid, made of a manifold-3d Manifold */
class ManifoldSolid implements Solid {
  /**
   * Internal constructor: use the `wrap` factory method
   *
   * @param m The Manifold this Solid represents
   */
  private constructor(readonly m: Manifold) { }

  /** Make a Solid for a Manifold, and record the Manifold in `memory` */
  static wrap(m: Manifold, memory: Memory): ManifoldSolid {
    return new ManifoldSolid(memory.own(m));
  }

  /** The volume. Negative if the triangles face inward (see `fromMesh`). */
  volume() { return this.m.volume(); }

  /** The corners of the smallest box that holds the solid */
  bounds() {
    // NB: Copy the values, don't return them directly
    const b = this.m.boundingBox();
    return { min: [...b.min] as Vec3, max: [...b.max] as Vec3 };
  }

  /** Valid means the library reports no error, and there is something there */
  isValid() { return this.m.status() === "NoError" && !this.m.isEmpty(); }

  /**
   * The surface as triangles (see `MeshData`). The library may keep more than
   * x, y, z for each point (`numProp` numbers in all, such as a normal or a
   * color), so the positions are copied out three at a time, and the extras are
   * left behind. The result is plain JavaScript data, so this survives a
   * `release()`.
   */
  mesh(): MeshData {
    const mesh = this.m.getMesh();
    const n = mesh.numProp;
    const positions = new Float32Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; ++i) {
      positions.set(mesh.vertProperties.subarray(i * n, i * n + 3), i * 3);
    }
    return { positions, indices: mesh.triVerts.slice() };
  }
}

/** A Flat, made of a manifold-3d CrossSection */
class ManifoldFlat implements Flat {
  /**
   * Internal constructor: use the `wrap` factory method
   *
   * @param cs The CrossSection this Flat represents
   */
  private constructor(readonly cs: CrossSection) { }

  /** Make a Flat for a CrossSection, and record the CrossSection in `memory` */
  static wrap(cs: CrossSection, memory: Memory): ManifoldFlat {
    return new ManifoldFlat(memory.own(cs));
  }

  /** The area (the library counts a hole as taking area away) */
  area() { return this.cs.area(); }

  /** The corners of the smallest rectangle that holds the shape */
  bounds() {
    // NB: Copy the values, don't return them directly
    const b = this.cs.bounds();
    return { min: [b.min[0], b.min[1]] as Vec2, max: [b.max[0], b.max[1]] as Vec2 };
  }

  /** True if there is no area at all */
  isEmpty() { return this.cs.isEmpty(); }

  /** The outlines as lists of points, copied out of the library's arrays */
  polygons() {
    return this.cs.toPolygons().map((ring) => ring.map((p): Vec2 => [p[0], p[1]]));
  }
}

/**
 * The manifold-3d Manifold inside a Solid. It must be a Solid this file made: a
 * Solid from anywhere else has no such object inside it.
 */
function unwrap(s: Solid): Manifold {
  return (s as ManifoldSolid).m;
}

/** The manifold-3d CrossSection inside a Flat (see `unwrap`) */
function flatOf(f: Flat): CrossSection {
  return (f as ManifoldFlat).cs;
}

/**
 * The probe that `erode` and `dilate` use to measure distance (what image
 * processing calls a "structuring element"): a small solid centered on the
 * origin. Growing a solid covers everything the probe touches as its center
 * moves over the solid. Shrinking keeps only the points where the probe,
 * centered there, still fits inside the solid. The library does that work
 * (`minkowskiSum` and `minkowskiDifference`), and needs the probe as a solid to
 * do it with.
 *
 * The probe is a new Manifold, so it is recorded in `memory`, to be freed with
 * everything else at the next `release()`.
 *
 * @param M The library's Manifold class, which is only available once the
 *          module has loaded, so it is handed in rather than imported.
 * @param memory Where the kernel records what it makes (see `Memory`).
 * @param r How far to grow or shrink by: the probe's radius. For a ball that is
 *          the radius; for a diamond, the distance from its center to each of
 *          its six points.
 * @param element The probe's shape. A `"ball"` is smooth, so edges come out
 *          rounded. A `"diamond"` is an octahedron: the smallest convex shape
 *          around six points, one on each side of the origin along each axis.
 *          It has flat faces, so edges come out beveled, and it is much
 *          cheaper to work with.
 * @param detail How many segments the ball has: more is rounder, and much
 *          slower on shapes that are not convex. It is 16 if left out. A
 *          diamond always has six points, so it ignores `detail`.
 */
function structuring(M: typeof Manifold, memory: Memory, r: number, element: "ball" | "diamond", detail = 16): Manifold {
  if (element === "ball") return memory.own(M.sphere(r, detail));
  return memory.own(M.hull([[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]));
}

/** A twist is drawn with one step for about every this many degrees */
const DEGREES_PER_TWIST_STEP = 2;

/**
 * The most steps a twist is divided into. This keeps a very large twist from
 * making a huge number of triangles. 240 steps is 480 degrees at 2 degrees a
 * step. A bigger twist is still drawn, but in coarser steps: ten turns is 15
 * degrees a step.
 */
const MAX_TWIST_STEPS = 240;

/**
 * How many steps to divide the sides of an extrusion into, so that a twist is
 * drawn smoothly: about one for every `DEGREES_PER_TWIST_STEP`, at least 1, and
 * at most `MAX_TWIST_STEPS`. None if there is no twist, so that a plain
 * extrusion stays a plain prism.
 */
function twistDivisions(twist: number): number {
  if (!twist) return 0;
  const steps = Math.ceil(Math.abs(twist) / DEGREES_PER_TWIST_STEP);
  return Math.min(MAX_TWIST_STEPS, Math.max(1, steps));
}

/**
 * Load the manifold-3d WASM module and return a Kernel backed by it. The
 * module is about half a megabyte, so this takes some time. Do it once.
 *
 * @param options.wasmUrl Where to fetch manifold.wasm from. Bundlers that
 *                        cannot resolve it themselves (such as esbuild's plain
 *                        browser build) need to provide it.
 */
export async function createManifoldKernel(options: { wasmUrl?: string } = {}): Promise<Kernel> {
  const { wasmUrl } = options;
  // `locateFile` tells the library where its .wasm file is; without it, it
  // looks beside its own script
  const wasm = await Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined);
  wasm.setup(); // the library's own one-time setup, needed before any shape is made
  const { Manifold, CrossSection, Mesh } = wasm;

  /** What this kernel has made, to free when a build is over */
  const memory = new Memory();

  /** A Solid for a Manifold, recorded in `memory` */
  function wrapSolid(m: Manifold) { return ManifoldSolid.wrap(m, memory); }

  /** A Flat for a CrossSection, recorded in `memory` */
  function wrapFlat(cs: CrossSection) { return ManifoldFlat.wrap(cs, memory); }

  return {
    /** `cube` takes the size and whether to center it on the origin (it is) */
    box(w, d, h) { return wrapSolid(Manifold.cube([w, d, h], true)); },

    /**
     * The library takes the height first, then the bottom and top radii, the
     * number of sides (0: it chooses) and whether to center the cylinder on the
     * origin (it is, so z runs from -h/2 to h/2)
     */
    cylinder(rLow, rHigh, h, segments = 0) {
      return wrapSolid(Manifold.cylinder(h, rLow, rHigh, segments, true));
    },

    /** 0 sides: the library chooses */
    sphere(r, segments = 0) { return wrapSolid(Manifold.sphere(r, segments)); },

    /**
     * A Minkowski difference: the points the rolling shape (see `structuring`)
     * can reach while staying inside. Its own in-between shape is remembered.
     */
    erode(s, r, element = "ball", detail) {
      return wrapSolid(unwrap(s).minkowskiDifference(structuring(Manifold, memory, r, element, detail)));
    },

    /**
     * A Minkowski sum: everything the rolling shape touches as its center
     * moves over the solid
     */
    dilate(s, r, element = "ball", detail) {
      return wrapSolid(unwrap(s).minkowskiSum(structuring(Manifold, memory, r, element, detail)));
    },

    /** `EvenOdd` is the rule that makes an outline inside another a hole */
    flat(contours) {
      return wrapFlat(new CrossSection(contours, "EvenOdd"));
    },

    /** The library calls union `add` */
    flatUnion(a, b) { return wrapFlat(flatOf(a).add(flatOf(b))); },

    /** `a` with `b` cut out (the library's `subtract`) */
    flatSubtract(a, b) { return wrapFlat(flatOf(a).subtract(flatOf(b))); },

    /** What is in both (the library's `intersect`) */
    flatIntersect(a, b) { return wrapFlat(flatOf(a).intersect(flatOf(b))); },

    /**
     * Turn first, then move, as `place` does. The shape after the turn is a
     * shape in the library's memory too, so it is remembered.
     */
    flatPlace(f, p) {
      let cs = flatOf(f);
      if (p.rotation) cs = memory.own(cs.rotate(p.rotation));
      if (p.position) cs = memory.own(cs.translate(p.position));
      return wrapFlat(cs);
    },

    /** The library takes one number, or one for each of u and v */
    flatScale(f, factor) { return wrapFlat(flatOf(f).scale(factor)); },

    /**
     * The library takes the direction the mirror faces: [1, 0] flips u (it is
     * the line u = 0), [0, 1] flips v
     */
    flatMirror(f, axis) {
      return wrapFlat(flatOf(f).mirror(axis === 0 ? [1, 0] : [0, 1]));
    },

    /**
     * Round corners are drawn with 32 sides to a full circle. Sharp ones (the
     * library calls them "Miter") are cut off where the point would be more
     * than twice the offset away: that is the 2.
     */
    flatOffset(f, delta, corners = "round") {
      return wrapFlat(flatOf(f).offset(delta, corners === "round" ? "Round" : "Miter", 2, 32));
    },

    /**
     * The library takes the height, how many steps to divide the sides into
     * (see `twistDivisions`), the twist in degrees, and how much to scale the
     * top along u and along v
     */
    extrudeFlat(f, height, options = {}) {
      const { twist = 0, scaleTop = 1 } = options;
      return wrapSolid(Manifold.extrude(flatOf(f), height, twistDivisions(twist), twist, [scaleTop, scaleTop]));
    },

    /**
     * The library turns the shape about the Y axis and makes that the Z axis of
     * the result. The 0 is how many sides a full turn has: the library chooses.
     */
    revolveFlat(f, degrees) {
      return wrapSolid(Manifold.revolve(flatOf(f), 0, degrees));
    },

    /**
     * Points that all lie in one plane (or a line) give the library an empty
     * shape, not an error, so that is checked for here.
     */
    hull(points) {
      const s = wrapSolid(Manifold.hull(points));
      if (!s.isValid() || !(s.volume() > 0)) throw new Error("the points are all in one plane (or a line), so they do not enclose a solid");
      return s;
    },

    /**
     * Make a library mesh from the points and triangles, join the points that
     * are the same place (STL files repeat them: each triangle lists its own
     * corners), and ask for a Manifold. The library throws if the mesh is not
     * closed, which is caught here, so the message says what it means. A mesh
     * with its triangles facing inward gives a Manifold with a negative volume.
     */
    fromMesh(mesh) {
      let m: Manifold;
      try {
        const mg = new Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices });
        mg.merge();
        m = new Manifold(mg);
      } catch {
        throw new Error(
          "this STL is not a closed solid (it has holes, gaps, or edges shared by the wrong number of faces)",
        );
      }
      const s = wrapSolid(m);
      if (!s.isValid()) throw new Error("this STL has no volume");
      if (s.volume() < 0) throw new Error("this STL's faces point inward");
      return s;
    },

    /**
     * The library takes the direction the mirror faces: the x, y or z axis, for
     * 0, 1, 2
     */
    mirror(s, axis) {
      return wrapSolid(unwrap(s).mirror(axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1]));
    },

    /** The library takes one number, or one per axis, as the kernel does */
    scale(s, factor) {
      return wrapSolid(unwrap(s).scale(factor));
    },

    /**
     * Turn first, then move. The solid after the turn is a shape in the
     * library's memory too, so it is remembered.
     */
    place(s, p) {
      let m = unwrap(s);
      if (p.rotation) m = memory.own(m.rotate(p.rotation));
      if (p.position) m = memory.own(m.translate(p.position));
      return wrapSolid(m);
    },

    /** The library calls union `add` */
    union(a, b) { return wrapSolid(unwrap(a).add(unwrap(b))); },

    /** `a` with `b` cut away (the library's `subtract`) */
    subtract(a, b) { return wrapSolid(unwrap(a).subtract(unwrap(b))); },

    /**
     * What is in both (the library's `intersect`). If there is nothing in
     * common the result is an empty Manifold, which `isValid()` reports as not
     * valid.
     */
    intersect(a, b) { return wrapSolid(unwrap(a).intersect(unwrap(b))); },

    /**
     * Delete everything this kernel has made since the last release, except
     * what is kept (see `Memory`)
     */
    release() { memory.release(); },

    /**
     * Mark the solid's Manifold so that `release()` skips it. It returns the
     * solid, so a call can be wrapped: `keep(make())`.
     */
    keep(s) {
      memory.keep(unwrap(s));
      return s;
    },

    /** Unmark it, so that the next `release()` frees it (see `Memory.drop`) */
    drop(s) { memory.drop(unwrap(s)); },
  };
}
