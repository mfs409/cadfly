/**
 * The commands of the Shapes tab: a part from an STL file, the box, cylinder
 * and sphere, and the solid with its vertices and faces.
 *
 * Each entry is the whole definition of one block, as a `CommandDef`.
 */

import type { Solid, Vec3 } from "../../../geometry/kernel";
import { PolyhedronError, hullFaces, parseCorners, polyhedronSolid } from "../../../geometry/polyhedron";
import { meshOfFile } from "../../../geometry/stl";
import { BlockArgs, Env, ProgramError } from "../../env";
import type { Block, Param } from "../../types";
import { expr, caption, text, flag, verticesOf } from "../helpers";
import type { CommandEntry } from "../types";
import { commandById, blankBlock, blockWith } from "../lookup";

/**
 * The faces in a solid's faces section: the vertex numbers of each face block,
 * in the order given (around the face, in either direction). Fails, against the
 * face block, for a face that has fewer than 3 vertices, names one that does
 * not exist, or lists one twice.
 *
 * @param points The solid's vertices, which the face numbers refer to (from 1).
 */
function facesOf(env: Env, holder: Block, points: Vec3[]): number[][] {
  const def = commandById("face")!;
  return (holder.inner ?? []).filter((k) => k.kind === "face").map((k) => {
    const fa = new BlockArgs(env, k, def);
    let corners: number[];
    try {
      corners = parseCorners(fa.text("corners"));
    } catch (e) {
      return fa.fail("corners", (e as Error).message);
    }
    if (corners.length < 3) fa.fail("corners", "a face needs at least 3 vertex numbers");
    const bad = corners.find((c) => c < 1 || c > points.length);
    if (bad !== undefined) fa.fail("corners", `vertex ${bad} does not exist: the vertices are numbered 1 to ${points.length}`);
    if (new Set(corners).size !== corners.length) fa.fail("corners", "lists a vertex twice");
    return corners;
  });
}

/**
 * The fields that say where a shape goes: its bottom center (x, y, and z for
 * how high its base is)
 */
function positionParams(): Param[] {
  return [expr("x", "at x", "0"), expr("y", "y", "0"), expr("z", "z", "0")];
}

/**
 * How many sides the curve of a cylinder or sphere has. A circle of 48 sides
 * has 99.71% of a true circle's area.
 */
const CURVE_SEGMENTS = 48;

/**
 * Put a shape where its position fields say: resting on the ground (its lowest
 * point at z = 0), centered in x and y, then moved by x y z
 */
function sitAt(env: Env, a: BlockArgs, solid: Solid): Solid {
  const { min, max } = solid.bounds();
  return env.kernel.place(solid, { position: [a.num("x") - (min[0] + max[0]) / 2, a.num("y") - (min[1] + max[1]) / 2, a.num("z") - min[2]] });
}

/**
 * The commands of the Shapes tab, in the order of the palette within the tab.
 */
export const shapesEntries: readonly CommandEntry[] = [
  /**
   * A part from an STL file that the project carries, as a solid. The file is
   * read once and kept for the rest of the run (`env.fileSolids`), then scaled
   * (25.4 turns inches into mm) and set on the ground like the other shapes.
   * Fails, against the file field, if none is chosen, if there is no file of
   * that name, or if it cannot be read.
   */
  {
    id: "import",
    hint: "a part from a project STL file (choose Import STL file... in its file list to add one); scale 25.4 is inches; it sits on the ground, its bottom center at x y z",
    short: "a part from a project STL file; scale 25.4 is inches",
    word: "import",
    category: "shapes",
    params: [{ id: "file", label: "", type: { kind: "file" }, default: "" }, expr("scale", "scale", "1"), ...positionParams()],
    make: (env, a) => {
      const name = a.text("file");
      const have = Object.keys(env.files);
      if (!name) a.fail("file", have.length ? `choose a file (${have.join(", ")})` : "choose a file (open its file list and choose \"Import STL file...\")");
      const data = env.files[name];
      if (data === undefined) a.fail("file", `there is no file called "${name}"` + (have.length ? ` (the files are ${have.join(", ")})` : " (open its file list and choose \"Import STL file...\" to add one)"));
      let solid = env.fileSolids.get(name);
      if (!solid) {
        try {
          solid = env.kernel.fromMesh(meshOfFile(name, data!));
        } catch (e) {
          a.fail("file", (e as Error).message);
        }
        env.fileSolids.set(name, solid!);
      }
      const factor = a.positive("scale");
      return sitAt(env, a, factor === 1 ? solid! : env.kernel.scale(solid!, factor));
    },
  },

  /**
   * A box, in mm. All three sizes must be more than 0. It rests on the ground,
   * its bottom center at x y z.
   */
  {
    id: "box",
    hint: "sits on the ground, its bottom center at x y z (all 0 at first)",
    plain: true,
    word: "box",
    category: "shapes",
    params: [caption("name"), expr("w", "width", "10"), expr("d", "depth", "10"), expr("h", "height", "10"), ...positionParams()],
    make: (env, a) => sitAt(env, a, env.kernel.box(a.positive("w"), a.positive("d"), a.positive("h"))),
  },
  /**
   * A cylinder, or with a smaller top radius a cone (a top radius of 0 makes a
   * point). The curve has `CURVE_SEGMENTS` sides. The radii may not both be 0.
   * Rests on the ground like the other solids.
   */
  {
    id: "cylinder",
    hint: "axis along z, sits on the ground, its bottom center at x y z; leave top radius empty for a cylinder, or give a smaller one for a cone (0 makes a point)",
    short: "an empty top radius is a cylinder; a smaller one is a cone (0 a point)",
    word: "cylinder",
    category: "shapes",
    params: [caption("name"), expr("r", "radius", "5"), { ...text("top", "top radius", ""), type: { kind: "text" } }, expr("h", "height", "10"), ...positionParams()],
    make: (env, a) => {
      const rLow = a.nonNegative("r");
      // left empty, the top is as wide as the bottom: a cylinder
      const rHigh = a.text("top") === "" ? rLow : a.nonNegative("top");
      if (rLow === 0 && rHigh === 0) a.fail("r", "the radius and the top radius cannot both be zero");
      return sitAt(env, a, env.kernel.cylinder(rLow, rHigh, a.positive("h"), CURVE_SEGMENTS));
    },
  },
  /**
   * A sphere of `CURVE_SEGMENTS` sides around. It rests on the ground, its
   * lowest point at z, over x y.
   */
  {
    id: "sphere",
    hint: "sits on the ground, its bottom at x y z",
    plain: true,
    word: "sphere",
    category: "shapes",
    params: [caption("name"), expr("r", "radius", "5"), ...positionParams()],
    make: (env, a) => sitAt(env, a, env.kernel.sphere(a.positive("r"), CURVE_SEGMENTS)),
  },
  /**
   * A solid from points, which holds two sections (`vertices`, and optionally
   * `faces`). Without faces it is the convex hull of the vertices (and offers
   * its faces to the "hull" button). With faces it is exactly the solid those
   * faces close. The corners and faces are drawn in the 3D view first (if their
   * sections' `show` is on), so they are there even if the solid cannot be
   * built. A problem with a face is reported on that face.
   */
  {
    id: "solid",
    hint: "a solid from points. Its vertices section lists the corners (numbered from 1): on their own they make the smallest convex solid around them (a pyramid is 5 points). Put faces in its faces section to switch to exact mode: each face lists vertex numbers in order, and together the faces must close the shape",
    short: "a solid from vertices (numbered from 1): convex around them, or with faces listing vertex numbers, exactly those faces",
    word: "solid",
    category: "shapes",
    params: [caption("name")],
    inner: ["vertices", "faces"],
    // a square pyramid to start with: five vertices, and no faces, so it is
    // the convex solid around them
    starter: (nextId) => [
      {
        ...blankBlock("vertices", nextId()),
        inner: [["-10", "-10", "0"], ["10", "-10", "0"], ["10", "10", "0"], ["-10", "10", "0"], ["0", "0", "20"]].map(([x, y, z]) => blockWith("vertex", nextId(), { x, y, z })),
      },
      blankBlock("faces", nextId()),
    ],
    make: (env, a) => {
      const inside = a.block.inner ?? [];
      const vertices = inside.filter((k) => k.kind === "vertices");
      const faces = inside.filter((k) => k.kind === "faces");
      if (vertices.length !== 1) throw new ProgramError(a.block.id, "a solid needs one vertices section (and may have one faces section)");
      if (faces.length > 1) throw new ProgramError(faces[1].id, "a solid can have only one faces section");
      const points = verticesOf(env, a, 4, vertices[0]);
      const faceBlocks = faces.length ? (faces[0].inner ?? []).filter((k) => k.kind === "face") : [];
      // no faces: the convex solid around the points. With faces: exactly those
      // faces.
      const corners = faces.length ? facesOf(env, faces[0], points) : [];
      // what to look at in the 3D view, drawn before the solid is built, so
      // that they are there even if it cannot be: a corner is a dot with its
      // number, a face a translucent polygon (each is shown when its section
      // has `show` on)
      const shows = (section: Block) => new BlockArgs(env, section, commandById(section.kind)!).flag("show");
      if (shows(vertices[0])) points.forEach((at, i) => env.overlays.push({ kind: "point", at, label: String(i + 1) }));
      if (faces.length && shows(faces[0])) corners.forEach((ring, i) => env.overlays.push({ kind: "face", blockId: faceBlocks[i].id, ring: ring.map((c) => points[c - 1]), label: `f${i + 1}` }));
      try {
        if (corners.length) return polyhedronSolid(env.kernel, points, corners);
        const hull = env.kernel.hull(points);
        // an empty faces section can be filled with what the hull is made of
        // (its "hull" button), to edit from a valid shape
        if (faces.length) env.hullFaces.set(faces[0].id, hullFaces(points, hull.mesh()));
        return hull;
      } catch (e) {
        // a problem with a face is pointed at that face, not at the whole solid
        if (e instanceof PolyhedronError && e.faces.length && faceBlocks[e.faces[0] - 1]) throw new ProgramError(faceBlocks[e.faces[0] - 1].id, e.message);
        throw e;
      }
    },
  },
  /** The section of a solid that holds its corners; its blocks are `vertex` */
  {
    id: "vertices",
    hint: "the corners of a solid, in order: they are numbered from 1 and faces refer to them by number; show draws them in the 3D view, each with its number",
    plain: true,
    word: "vertices",
    category: "shapes",
    piece: true,
    automatic: true,
    partOf: "a solid",
    params: [flag("show", "show labels")],
    viewOnly: ["show"],
    inner: ["vertex"],
  },
  /**
   * The section of a solid that holds its faces. It has a button, "hull", while
   * it is empty, which fills it with the faces of the convex solid around the
   * vertices.
   */
  {
    id: "faces",
    hint: "optional: the flat faces of a solid. With none, the solid is the convex shape around its vertices; with some, it is exactly these faces",
    plain: true,
    word: "faces",
    category: "shapes",
    piece: true,
    automatic: true,
    partOf: "a solid",
    button: { id: "hull", label: "hull", when: (b) => !(b.inner ?? []).some((k) => k.kind === "face") },
    params: [flag("show", "show labels")],
    viewOnly: ["show"],
    inner: ["face"],
  },
  /** One corner of a solid, numbered from 1 in the order of its section */
  {
    id: "vertex",
    hint: "a corner point at x y z",
    plain: true,
    word: "vertex",
    category: "shapes",
    piece: true,
    numbered: "",
    partOf: "vertices",
    params: [expr("x", "x", "0"), expr("y", "y", "0"), expr("z", "z", "0")],
  },
  /**
   * One face of a solid: the numbers of its vertices, in order around it (the
   * `corners` field is written bare in block text: `face 1 2 3 4`)
   */
  {
    id: "face",
    hint: "the vertex numbers going around one face, like 1 2 3 4 (around the edge, not across; either direction). In the 3D view each face is solid on one side and striped on the other: list the corners counterclockwise as seen from outside and the outside is the solid side",
    short: "the vertex numbers going around one face, like 1 2 3 4 (counterclockwise from outside: the outside is the solid side)",
    word: "face",
    category: "shapes",
    piece: true,
    numbered: "f",
    partOf: "faces",
    params: [{ ...text("corners", "corners", "1 2 3"), positional: true }],
  },
];
