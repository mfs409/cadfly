import type { MeshData } from "./geometry/kernel";
import { writeStl } from "./geometry/stl";
import { partFileNames, writeZip } from "./geometry/zip";
import { type RunSnapshot, combinedMesh } from "./snapshot";

/**
 * What an STL export writes: all the solids in one file, or each part in a
 * file of its own, in a zip. A part is one of the 3D shapes at the top of
 * `build`; a `use` there of a script that makes several solids gives one part
 * for each of them. Flat shapes and sketches are never exported. Hidden shapes
 * (the eye shut) are left out unless asked for, and then a hidden shape is a
 * part called "hidden" and its name.
 */

/** What the person chose to export */
export interface ExportChoice {
  /** Each part in its own file, in a zip (otherwise everything in one file) */
  separate: boolean;
  /** Hidden shapes too */
  withHidden: boolean;
}

/** A file to give the person */
export interface ExportFile {
  /** What it is called */
  name: string;
  /** Its media type */
  type: string;
  /** What is in it */
  data: Uint8Array<ArrayBuffer> | ArrayBuffer;
}

/** A part and its triangles */
interface PartMesh {
  /** What the part is called */
  name: string;
  /** Its triangles */
  mesh: MeshData;
}

/**
 * The parts to export, in order: the 3D shapes that are drawn as solids, then
 * the hidden ones if they are wanted and the run has them.
 *
 * @param s What a run gave.
 * @param withHidden Include the hidden shapes.
 */
export function exportParts(s: RunSnapshot, withHidden: boolean): PartMesh[] {
  const visible = s.shapes.filter((x) => !x.outline && !x.linesOnly).map((x) => ({ name: x.name, mesh: x.mesh }));
  const hidden = withHidden ? (s.hidden?.shapes ?? []).map((x) => ({ name: `hidden ${x.name}`, mesh: x.mesh })) : [];
  return [...visible, ...hidden];
}

/**
 * The file to give the person, or null when there is nothing to export. One
 * file is `part.stl`, the solids merged (with the hidden ones merged in, if
 * they are wanted and the run has them). Separate files are `parts.zip`, with
 * an STL for each part, named after it.
 *
 * @param s What a run gave.
 * @param choice What to export.
 */
export function exportFile(s: RunSnapshot, choice: ExportChoice): ExportFile | null {
  if (!choice.separate) {
    const mesh = choice.withHidden && s.hidden ? s.hidden.combined : combinedMesh(s);
    return mesh ? { name: "part.stl", type: "model/stl", data: writeStl(mesh) } : null;
  }
  const parts = exportParts(s, choice.withHidden);
  if (!parts.length) return null;
  const names = partFileNames(parts.map((p) => p.name), ".stl");
  const data = writeZip(parts.map((p, i) => ({ name: names[i], data: new Uint8Array(writeStl(p.mesh, p.name)) })));
  return { name: "parts.zip", type: "application/zip", data };
}
