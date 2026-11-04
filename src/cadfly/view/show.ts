import type { RunSnapshot } from "../language/snapshot";
import type { Problem } from "../language/types";
import type { ShapeDisplay, Viewer } from "./viewer";

const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");

/**
 * What the readout over the 3D view says about a result: how many shapes, how big, how much volume (or, for flat shapes only, the area:
 * nothing is exported until they are extruded). Undefined if there is nothing to measure. This is how the result is checked against what
 * was asked for: the AI can be sure and wrong.
 */
export function readoutText(r: RunSnapshot): string | undefined {
  const shapes = r.shapes.filter((s) => !s.linesOnly).length;
  const count = `${shapes} shape${shapes === 1 ? "" : "s"}\n`;
  const box = r.combined;
  const flat = r.flat;
  if (box) return `${count}size  ${n(box.max[0] - box.min[0])} x ${n(box.max[1] - box.min[1])} x ${n(box.max[2] - box.min[2])} mm\nvolume  ${n(box.volume)} mm3`;
  if (flat) return `${count}flat  ${n(flat.max[0] - flat.min[0])} x ${n(flat.max[1] - flat.min[1])} mm\narea  ${n(flat.area)} mm2`;
  return undefined;
}

/** The shapes of a result, as the viewer draws them */
export const displayShapes = (r: RunSnapshot): ShapeDisplay[] => r.shapes.map((s) => ({ mesh: s.mesh, outline: s.outline, linesOnly: s.linesOnly }));

/**
 * The corners and faces of solids (where their sections are set to show them): drawn even if a solid could not be built, so it can be
 * seen what is wrong; a face that has the problem is red.
 */
export function showOverlays(viewer: Viewer, r: RunSnapshot, problem: Problem | undefined) {
  viewer.setOverlays(
    r.overlays.flatMap((o) => (o.kind === "point" ? [{ at: o.at, label: o.label }] : [])),
    r.overlays.flatMap((o) => (o.kind === "face" ? [{ ring: o.ring, label: o.label, broken: problem?.blockId === o.blockId }] : [])),
  );
}
