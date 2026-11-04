import type { MeshData, Vec2, Vec3 } from "../geometry/kernel";
import type { Files } from "./files";
import type { RunResult } from "./run";
import type { Problem } from "./types";

/**
 * What a run gives, as plain data: no solids (they live inside the 3D engine,
 * which runs in a Web Worker), only what the page draws, measures, and
 * exports. It can be copied from the worker to the page.
 */
export interface RunSnapshot {
  /**
   * What is drawn: one mesh for each shape at the top of the program (see
   * `RunResult.shapes`)
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
    /** The merged solids' triangles */
    mesh: MeshData;
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
  /** For each empty faces section (by block id): see `RunResult.hullFaces` */
  hullFaces: RunResult["hullFaces"];
  /** The corners and faces to draw (a sketch is drawn as one of the shapes) */
  overlays: Exclude<RunResult["overlays"][number], { kind: "sketch" }>[];
  /** What each measure block found (by block id): see `RunResult` */
  measurements: RunResult["measurements"];
  /** The first thing that went wrong, if anything did */
  problem?: Problem;
}

/**
 * Take what the page needs from a run. The meshes are copied out of the 3D
 * engine, so the result stays good after the run's solids are freed.
 */
export function snapshot(r: RunResult): RunSnapshot {
  const flat = r.flat?.bounds();
  const box = r.combined?.bounds();
  return {
    shapes: r.shapes.map((s) => ({ id: s.id, name: s.name, mesh: s.solid.mesh(), ...(s.flat || s.preview || s.piece ? { outline: true as const } : {}), ...(s.piece ? { linesOnly: true as const } : {}) })),
    combined: r.combined && box ? { mesh: r.combined.mesh(), min: box.min, max: box.max, volume: r.combined.volume() } : null,
    flat: r.flat && flat ? { min: flat.min, max: flat.max, area: r.flat.area() } : null,
    hullFaces: r.hullFaces,
    overlays: r.overlays.flatMap((o) => (o.kind === "sketch" ? [] : [o])),
    measurements: r.measurements,
    ...(r.problem ? { problem: r.problem } : {}),
  };
}

/**
 * The messages the page sends to the worker that runs the 3D engine: run a
 * program (with the project's files), or fetch a Google font (see
 * `installGoogleFont`). The `id` comes back in the answer.
 */
export type ToWorker = { type: "run"; id: number; program: unknown; files: Files } | { type: "font"; id: number; input: string };

/**
 * The messages the worker sends to the page: the engine is ready, a run is done
 * (with its snapshot), or a font request has finished (it worked or failed: the
 * font's status says which)
 */
export type FromWorker = { type: "ready" } | { type: "ran"; id: number; result: RunSnapshot } | { type: "fonted"; id: number };

/**
 * The buffers inside a snapshot, to hand over to the page instead of copying
 * (each once, even if meshes share one)
 */
export function buffersOf(s: RunSnapshot): ArrayBuffer[] {
  const meshes = [...s.shapes.map((x) => x.mesh), ...(s.combined ? [s.combined.mesh] : [])];
  return [...new Set(meshes.flatMap((m) => [m.positions.buffer as ArrayBuffer, m.indices.buffer as ArrayBuffer]))];
}
