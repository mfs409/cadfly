import type { RunSnapshot } from "../../snapshot";
import type { Problem } from "../../language/types";
import { oneDecimal } from "../numbers";
import type { Viewer } from "./viewer";

/**
 * What goes over the 3D view for a run's result: the readout text
 * (`readoutText`) and the corners and faces of solids (`showOverlays`). The
 * shapes themselves need no conversion: a snapshot's `shapes` can be drawn
 * as they are.
 */

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
  if (box) return `${count}size  ${oneDecimal(box.max[0] - box.min[0])} x ${oneDecimal(box.max[1] - box.min[1])} x ${oneDecimal(box.max[2] - box.min[2])} mm\nvolume  ${oneDecimal(box.volume)} mm3`;
  if (flat) return `${count}flat  ${oneDecimal(flat.max[0] - flat.min[0])} x ${oneDecimal(flat.max[1] - flat.min[1])} mm\narea  ${oneDecimal(flat.area)} mm2`;
  return undefined;
}

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
