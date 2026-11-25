import type { MeshData, Vec2, Vec3 } from "./geometry/kernel";
import type { RunResult } from "./language/run";
import type { Problem } from "./language/types";

/**
 * A run's result as plain data: meshes and numbers, no solids (they live inside
 * the 3D engine, which runs in a Web Worker), so it can be copied from the
 * worker to the page and is still good after the run's solids are freed.
 */

/**
 * What a run gives, as plain data: only what the page draws, measures, and
 * exports.
 */
export interface RunSnapshot {
  /**
   * What is drawn: one mesh for each shape at the top of the program
   */
  shapes: {
    /** The id of the top-level block that made the shape */
    id: string;
    /** What the block calls the shape */
    name: string;
    /** The shape's triangles */
    mesh: MeshData;
    /**
     * A flat shape or a sketch (drawn as a thin slab): its boundary is drawn as
     * a bright line
     */
    outline?: true;
    /**
     * Only the outline is drawn: one of the pieces a flat shape is put
     * together from (it is not a shape of its own)
     */
    linesOnly?: true;
  }[];
  /** The solids merged, which is what an export writes */
  combined: {
    /**
     * The merged solids' triangles. Absent when the merged solid is one of the
     * shapes above (a program that makes a single solid): then that shape's
     * mesh is the one (`shape` says which), and the same triangles are not
     * sent twice. Use `combinedMesh` to get it either way.
     */
    mesh?: MeshData;
    /** The index in `shapes` of the shape whose mesh is the merged solids', when `mesh` is absent */
    shape?: number;
    /** The low corner of the box around them */
    min: Vec3;
    /** The high corner of the box around them */
    max: Vec3;
    /** How much space they take up */
    volume: number;
  } | null;
  /** The flat shapes merged */
  flat: {
    /** The low corner of the box around them */
    min: Vec2;
    /** The high corner of the box around them */
    max: Vec2;
    /** How much area they cover */
    area: number;
  } | null;
  /**
   * The hidden shapes, only when the run was asked for them (an export that
   * includes them): the 3D shapes at the top of `build` whose eye is shut, and
   * every solid merged, hidden ones too
   */
  hidden?: {
    /** The hidden shapes, in order */
    shapes: { id: string; name: string; mesh: MeshData }[];
    /** The visible and the hidden solids merged, or null if there are none */
    combined: MeshData | null;
  };
  /** For each empty faces section (by block id): the faces that the hull of its solid's corners gives */
  hullFaces: RunResult["hullFaces"];
  /** The corners and faces to draw (a sketch is drawn as one of the shapes) */
  overlays: Exclude<RunResult["overlays"][number], { kind: "sketch" }>[];
  /** What each measure block found (by block id): the variables it set */
  measurements: RunResult["measurements"];
  /** The first thing that went wrong, if anything did */
  problem?: Problem;
}

/**
 * Take what the page needs from a run. The meshes are copied out of the 3D
 * engine, so the result stays good after the run's solids are freed. When the
 * merged solid is one of the shapes (a program that makes a single solid),
 * its triangles are copied once, as that shape's mesh.
 *
 * @param r What the run gave.
 * @param withHidden Include the hidden shapes' meshes (the run must have been
 *                   made with `withHidden` too).
 */
export function snapshotOf(r: RunResult, withHidden = false): RunSnapshot {
  const flat = r.flat?.bounds();
  const box = r.combined?.bounds();
  const same = r.combined ? r.shapes.findIndex((s) => s.solid === r.combined && !s.piece && !s.preview && !s.flat) : -1;
  return {
    shapes: r.shapes.map((s) => ({ id: s.id, name: s.name, mesh: s.solid.mesh(), ...(s.flat || s.preview || s.piece ? { outline: true as const } : {}), ...(s.piece ? { linesOnly: true as const } : {}) })),
    combined: r.combined && box ? { ...(same >= 0 ? { shape: same } : { mesh: r.combined.mesh() }), min: box.min, max: box.max, volume: r.combined.volume() } : null,
    flat: r.flat && flat ? { min: flat.min, max: flat.max, area: r.flat.area() } : null,
    ...(withHidden ? { hidden: { shapes: r.hiddenShapes.map((s) => ({ id: s.id, name: s.name, mesh: s.solid.mesh() })), combined: r.combinedWithHidden ? r.combinedWithHidden.mesh() : null } } : {}),
    hullFaces: r.hullFaces,
    overlays: r.overlays.flatMap((o) => (o.kind === "sketch" ? [] : [o])),
    measurements: r.measurements,
    ...(r.problem ? { problem: r.problem } : {}),
  };
}

/**
 * The buffers inside a snapshot, to hand over to the page instead of copying
 * (each once, even if meshes share one)
 */
export function buffersOf(s: RunSnapshot): ArrayBuffer[] {
  const meshes = [...s.shapes.map((x) => x.mesh), ...(s.combined?.mesh ? [s.combined.mesh] : []), ...(s.hidden ? [...s.hidden.shapes.map((x) => x.mesh), ...(s.hidden.combined ? [s.hidden.combined] : [])] : [])];
  return [...new Set(meshes.flatMap((m) => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]))];
}

/**
 * The triangles of the merged solids, which an export writes: the combined
 * mesh, or, when the run made a single solid, the mesh of the shape that is that
 * solid. Null when there is no solid.
 *
 * @param s What a run gave.
 */
export function combinedMesh(s: RunSnapshot): MeshData | null {
  if (!s.combined) return null;
  return s.combined.mesh ?? (s.combined.shape !== undefined ? s.shapes[s.combined.shape].mesh : null);
}
