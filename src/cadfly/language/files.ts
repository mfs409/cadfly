import { type MeshData } from "../geometry/kernel";
import { meshFromBase64, readStl, toBase64 } from "../geometry/stl";

/**
 * The STL files a project carries: what may be added, the limits on them, and
 * how they are checked. The files are kept as base64 text so that they live
 * inside the project's JSON.
 */

/**
 * The STL files a project carries, by name, each as base64 text (so they live
 * inside the project's JSON)
 */
export type Files = Record<string, string>;

/**
 * The most bytes one file may have (a limit, with the next two, so that a
 * project stays small enough to keep in the browser)
 */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
/** The most bytes all of a project's files may have together */
export const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
/** The most triangles one file may have, so that a part builds quickly */
export const MAX_TRIANGLES = 300_000;

/** What can be said about a file without building it */
export interface FileInfo {
  /** The file's name in the project (see `fileName`) */
  name: string;
  /** How big the file is, in bytes */
  bytes: number;
  /** How many triangles it has */
  triangles: number;
  /**
   * Width, depth and height of the part, in the file's own units (mm, if it
   * was made for printing)
   */
  size: [number, number, number];
}

/**
 * A name a project may keep a file under: starts with a letter or digit, then
 * letters, digits, _, . and -, up to 60 characters in all, ending in .stl
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}\.stl$/i;

/** How many bytes a base64 string stands for */
export function bytesOf(base64: string): number {
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

/**
 * A name that is safe to write in a block: the file's own name, without any
 * folder, with anything odd turned into _. Throws an Error if the result is not
 * the name of an STL file (it should end in .stl).
 *
 * @param raw The name the file has, such as the one the person picked.
 */
export function fileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  const name = base.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[._-]+/, "");
  if (!NAME.test(name)) throw new Error(`"${raw}" is not an STL file name (it should end in .stl)`);
  return name;
}

/** The width, depth and height of a mesh: how far it reaches in x, y, z */
function measure(mesh: MeshData): [number, number, number] {
  const p = mesh.positions;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], p[i + k]);
      hi[k] = Math.max(hi[k], p[i + k]);
    }
  }
  return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
}

/**
 * What is known about each file: how big it is, its triangles and its size. A
 * file is read once and then remembered (see `meshFromBase64`).
 */
export function describeFiles(files: Files): FileInfo[] {
  return Object.entries(files).map(([name, data]) => {
    const mesh = meshFromBase64(data);
    return { name, bytes: bytesOf(data), triangles: mesh.indices.length / 3, size: measure(mesh) };
  });
}

/**
 * Check an STL file and add it to the project's files. Throws an Error that
 * says what is wrong, in plain words: a bad name, a file or a set of files that
 * is too big, a file that is not an STL, or one with no triangles or too many.
 *
 * @param files The project's files so far (not changed).
 * @param rawName The name the file has, which is made safe (see `fileName`). A
 *                file of the same name is replaced.
 * @param buf The file's bytes.
 * @returns The files with this one added, and what is known about it.
 */
export function addFile(files: Files, rawName: string, buf: ArrayBuffer): { files: Files; info: FileInfo } {
  const name = fileName(rawName);
  if (buf.byteLength > MAX_FILE_BYTES) throw new Error(`${name} is ${(buf.byteLength / 1048576).toFixed(1)} MB: a file may be at most ${MAX_FILE_BYTES / 1048576} MB`);
  const others = Object.entries(files).filter(([n]) => n !== name).reduce((sum, [, d]) => sum + bytesOf(d), 0);
  if (others + buf.byteLength > MAX_TOTAL_BYTES) throw new Error(`there is only room for ${MAX_TOTAL_BYTES / 1048576} MB of files in all: remove one first`);
  let mesh: MeshData;
  try {
    mesh = readStl(buf);
  } catch {
    throw new Error(`${name} is not a valid STL file`);
  }
  const triangles = mesh.indices.length / 3;
  if (triangles === 0) throw new Error(`${name} has no triangles`);
  if (triangles > MAX_TRIANGLES) throw new Error(`${name} has ${triangles.toLocaleString("en-US")} triangles: a file may have at most ${MAX_TRIANGLES.toLocaleString("en-US")}`);
  const data = toBase64(buf);
  return { files: { ...files, [name]: data }, info: { name, bytes: buf.byteLength, triangles, size: measure(mesh) } };
}

/** The files without the one called `name` (the files given are not changed) */
export function removeFile(files: Files, name: string): Files {
  const { [name]: _gone, ...rest } = files;
  return rest;
}

/**
 * Check files read from a saved project: right kind of names, text that is
 * base64, within the limits. Throws an Error that says what is wrong.
 */
export function validateFiles(files: unknown): asserts files is Files {
  if (typeof files !== "object" || files === null || Array.isArray(files)) throw new Error("files must be a list of name and data");
  let total = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!NAME.test(name)) throw new Error(`file "${name}": not an STL file name`);
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error(`file "${name}": the data must be base64`);
    total += bytesOf(data);
    if (bytesOf(data) > MAX_FILE_BYTES) throw new Error(`file "${name}" is too big`);
  }
  if (total > MAX_TOTAL_BYTES) throw new Error("the files are too big in all");
}
