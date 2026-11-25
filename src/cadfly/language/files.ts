import { type MeshData } from "../geometry/kernel";
import { meshOfFile, meshSize, readBase64Stl, readStl, toBase64 } from "../geometry/stl";

/**
 * The STL files that are included in a project.  The files are kept as base64
 * text so that they live inside the project's JSON.
 */

/**
 * All of a project's STL files in a format that is easy to serialize and
 * deserialize as JSON without knowing the key names in advance.  The first
 * field is the name of the file, the second is the STL file contents as base64
 * text.
 */
export type StlFiles = Record<string, string>;

/**
 * A binary STL file can be no more than this big.  Note that the base64
 * encoding will be larger. 3 MB holds about 62,000 triangles of a binary STL at
 * 50 bytes per triangle.
 */
export const MAX_STL_FILE_BYTES = 3 * 1024 * 1024;

/**
 * A limit on the number of total bytes for all of the STL files in a project.
 * This is rather arbitrary, but 8 times the max for one file seems pretty
 * generous.
 */
export const MAX_STL_TOTAL_BYTES = 8 * MAX_STL_FILE_BYTES;

/**
 * Information about an STL file that can be determined without actually
 * building a mesh from the file
 */
export interface StlFileInfo {
  /** The file's name in the project (letters, digits, _, . and - only) */
  name: string;
  /** How big the file is, in bytes */
  bytes: number;
  /** How many triangles are in the file */
  triangles: number;
  /**
   * How far the part reaches in x (`width`), y (`depth`) and z (`height`), in
   * the file's own units (mm, if it was made for printing). The names are the
   * ones the box block uses for its w, d, and h.
   */
  size: { width: number; depth: number; height: number };
}

/**
 * Rules for a file's name
 * - Upper and lower cases are allowed for the name and the extension
 * - Starts with a letter or digit
 * - Subsequent characters are letters, digits, _, . and -
 * - Last four characters are '.stl' in any case
 * - 64 characters max, including the extension
 */
const STL_FILENAME_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,59}\.stl$/i;

/** What base64 text looks like: the characters of the alphabet, then up to two = */
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

/** Compute the real size of a string that is a base64-encoded file */
export function bytesOf(base64: string): number {
  return Math.floor((base64.length * 3) / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}

/**
 * Transform an STL file's name into something that can be used as the first
 * field of a Record in StlFiles.
 *
 * Making a name safe involves coercing it into a form that is acceptable to
 * STL_FILENAME_REGEX.  This includes verifying the extension and the length
 * constraint. If the name cannot be coerced, throw an Error.
 *
 * @param raw The name the file has, such as the one the person picked.
 */
export function toSafeStlName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  const name = base.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[._-]+/, "");
  if (!STL_FILENAME_REGEX.test(name)) throw new Error(`"${raw}" is not an STL file name (it should end in .stl)`);
  return name;
}

/**
 * Throw an Error if one file consumes too many bytes
 *
 * @param label How to refer to the file in the message.
 * @param bytes The file's size, in bytes (of the file, not of its base64 text).
 */
function checkFileBytes(label: string, bytes: number): void {
  if (bytes > MAX_STL_FILE_BYTES) throw new Error(`${label} is ${(bytes / 1048576).toFixed(1)} MB: a file may be at most ${MAX_STL_FILE_BYTES / 1048576} MB`);
}

/**
 * Throw an Error if a project's files, together, consume too many bytes
 *
 * @param total The size of all of the files, in bytes.
 * @param advice What to do about it, if there is something (added to the end of
 *               the message).
 */
function checkTotalBytes(total: number, advice = ""): void {
  if (total > MAX_STL_TOTAL_BYTES) throw new Error(`there is only room for ${MAX_STL_TOTAL_BYTES / 1048576} MB of files in all${advice}`);
}

/**
 * Read the mesh of one file, with `parse`, and throw an Error if it is not a
 * usable STL (i.e., it doesn't parse or it doesn't have any triangles)
 *
 * @param label How to refer to the file in the message.
 * @param parse Gives the file's mesh, or throws if the file is not an STL.
 */
function readChecked(label: string, parse: () => MeshData): MeshData {
  let mesh: MeshData;
  try {
    mesh = parse();
  } catch {
    throw new Error(`${label} is not a valid STL file`);
  }
  if (mesh.indices.length === 0) throw new Error(`${label} has no triangles`);
  return mesh;
}

/**
 * The StlFileInfo of one file, from its mesh
 *
 * @param name The file's name in the project.
 * @param bytes The file's size, in bytes (of the file, not of its base64 text).
 * @param mesh The file's mesh.
 */
function summarizeMesh(name: string, bytes: number, mesh: MeshData): StlFileInfo {
  return { name, bytes, triangles: mesh.indices.length / 3, size: meshSize(mesh) };
}

/**
 * Compute the StlFileInfo for a collection of StlFiles.
 *
 * Each file's mesh is read, which is slow for a big file, but the reading is
 * cached, so it should be OK.
 *
 * If a file's data is not valid, this will throw an Error
 *
 * @param files The project's files.
 * @returns One entry for each file, in the order the files were added.
 */
export function summarizeStlFiles(files: StlFiles): StlFileInfo[] {
  return Object.entries(files).map(([name, data]) => summarizeMesh(name, bytesOf(data), meshOfFile(name, data)));
}

/**
 * Check an STL file and add it to the project's files. Throws an Error if the
 * name is invalid, the file is invalid, the file has no triangles, or the the
 * file/files require too much memory
 *
 * @param files The project's files so far (not changed).
 * @param rawName The name the file has, which is made safe
 *                (letters, digits, _, . and - only). A file of the same name is replaced.
 * @param bytes The contents of the STL file, as they are on disk (not base64:
 *              this function makes the base64 that goes into the files).
 * @returns The files with this one added, and what is known about it.
 */
export function addStlFile(files: StlFiles, rawName: string, bytes: ArrayBuffer): { files: StlFiles; info: StlFileInfo } {
  const name = toSafeStlName(rawName);
  checkFileBytes(name, bytes.byteLength);
  const others = Object.entries(files).filter(([n]) => n !== name).reduce((sum, [, d]) => sum + bytesOf(d), 0);
  checkTotalBytes(others + bytes.byteLength, ": remove one first");
  const mesh = readChecked(name, () => readStl(bytes));
  return { files: { ...files, [name]: toBase64(bytes) }, info: summarizeMesh(name, bytes.byteLength, mesh) };
}

/**
 * Produce a new StlFiles object that is identical to `files`, except that if
 * there was an entry with the name `name`, that entry will not be in the
 * returned object.
 */
export function removeFile(files: StlFiles, name: string): StlFiles {
  const { [name]: _gone, ...rest } = files;
  return rest;
}

/**
 * Do two sets of files hold the same files? They do when they have the same
 * names and the data under each name is the very same text (compared by value,
 * which is quick when it is the same string).
 *
 * @param a One set of files.
 * @param b Another set of files.
 */
export function sameFiles(a: StlFiles, b: StlFiles): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => name in b && a[name] === b[name]);
}

/**
 * Make sure that the StlFiles of a saved project (or of the browser's
 * storage) is sound. Throws an Error if it's not.
 *
 * This can be slow, since a big file can take about .2s, and there can be as
 * many as 8 big files.
 */
export function validateStlFiles(files: unknown): asserts files is StlFiles {
  if (typeof files !== "object" || files === null || Array.isArray(files)) throw new Error("files must be an object of names and data");
  let total = 0;
  for (const [name, data] of Object.entries(files)) {
    if (!STL_FILENAME_REGEX.test(name)) throw new Error(`file "${name}": not an STL file name`);
    if (typeof data !== "string" || !BASE64_REGEX.test(data)) throw new Error(`file "${name}": the data must be base64`);
    checkFileBytes(`file "${name}"`, bytesOf(data));
    total += bytesOf(data);
  }
  checkTotalBytes(total);
  for (const [name, data] of Object.entries(files as StlFiles)) readChecked(`file "${name}"`, () => readBase64Stl(data));
}
