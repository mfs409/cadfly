import type { MeshData } from "./kernel";

/**
 * An STL is a list of triangles and nothing else (no units, no colors), in one
 * of two forms. The binary form is what this file writes. Both forms are read,
 * welding the triangles' shared corners back together so the result is an
 * indexed `MeshData`.
 *
 * This file also turns an STL into base64 text and back, so that an imported
 * file can live inside a JSON project file.
 */

/**
 * A binary STL starts with an 80-byte header, then the number of triangles in 4
 * bytes
 */
const HEADER_BYTES = 84;

/**
 * Each triangle in a binary STL is 50 bytes: its normal (3 numbers), its 3
 * corners (3 numbers each), all 4 bytes each, and 2 bytes nobody uses
 */
const TRIANGLE_BYTES = 50;

/**
 * Serialize a mesh as a binary STL file.
 *
 * Each triangle's normal is worked out from its corners, so that it points out
 * of a solid whose triangles go counter-clockwise as seen from outside (a
 * triangle with no area gets a zero normal).
 *
 * @param mesh The triangles to write.
 * @param name Written into the file's 80-byte header, cut off if longer. Do not
 *             start it with "solid": some programs take that as the start of a
 *             text STL.
 */
export function writeStl(mesh: MeshData, name = "cadfly"): ArrayBuffer {
  const { positions: p, indices: idx } = mesh;
  const tris = idx.length / 3;
  const buf = new ArrayBuffer(HEADER_BYTES + tris * TRIANGLE_BYTES);
  const view = new DataView(buf);
  const header = new TextEncoder().encode(name).subarray(0, 80);
  new Uint8Array(buf).set(header, 0);
  view.setUint32(80, tris, true);
  let off = HEADER_BYTES;
  for (let t = 0; t < tris; ++t) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz, ...p.subarray(a, a + 3), ...p.subarray(b, b + 3), ...p.subarray(c, c + 3)]) {
      view.setFloat32(off, v, true);
      off += 4;
    }
    view.setUint16(off, 0, true);
    off += 2;
  }
  return buf;
}

/**
 * Collects triangles one corner at a time, welding corners that are exactly the
 * same place, so that the mesh is indexed (each point is stored once, and the
 * triangles refer to it by number)
 */
class MeshBuilder {
  /** The number of each point seen so far, by its coordinates written out */
  private lookup = new Map<string, number>();
  private positions: number[] = [];
  private indices: number[] = [];

  /** Add one corner of a triangle. Three calls in a row make a triangle. */
  vertex(x: number, y: number, z: number) {
    const key = `${x},${y},${z}`;
    let id = this.lookup.get(key);
    if (id === undefined) {
      id = this.positions.length / 3;
      this.lookup.set(key, id);
      this.positions.push(x, y, z);
    }
    this.indices.push(id);
  }

  /** The mesh of everything added */
  build(): MeshData {
    return { positions: new Float32Array(this.positions), indices: new Uint32Array(this.indices) };
  }
}

/**
 * Read the triangles of a binary STL. Each is 3 numbers for its normal, which
 * is skipped (the library works out its own), 9 for its corners, and 2 bytes of
 * attributes, which are skipped too.
 *
 * @param view The whole file.
 * @param tris How many triangles it says it has (the caller has checked that
 *             the file is that long).
 */
function readBinary(view: DataView, tris: number): MeshData {
  const m = new MeshBuilder();
  let off = HEADER_BYTES;
  for (let t = 0; t < tris; ++t) {
    off += 12; // skip the stored normal
    for (let v = 0; v < 3; ++v) {
      m.vertex(view.getFloat32(off, true), view.getFloat32(off + 4, true), view.getFloat32(off + 8, true));
      off += 12;
    }
    off += 2;
  }
  return m.build();
}

/**
 * Read the triangles of a text STL. Only the `vertex x y z` lines are used,
 * three to a triangle: the normals and the "outer loop" lines around them are
 * skipped. Each number is rounded to the single-precision number a binary file
 * would hold, so that the same shape reads the same from either form.
 *
 * Throws an Error if a vertex is not a number, or if there are no vertices or
 * their number is not a multiple of 3.
 */
function readAscii(text: string): MeshData {
  const m = new MeshBuilder();
  let count = 0;
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const [x, y, z] = [match[1], match[2], match[3]].map(Number);
    if (![x, y, z].every(Number.isFinite)) throw new Error("STL has a vertex that is not a number");
    m.vertex(Math.fround(x), Math.fround(y), Math.fround(z));
    count++;
  }
  if (count === 0 || count % 3 !== 0) throw new Error("not a valid STL file");
  return m.build();
}

/**
 * Parse a binary or ASCII STL, welding identical vertices so the mesh is
 * indexed. Throws Error with a readable message if it is neither.
 *
 * It is binary if the file is exactly as long as its triangle count says. Some
 * binary files start with "solid" (as a text file does), so the header is not
 * trusted; the size is. A binary file with extra bytes on the end is therefore
 * refused. Otherwise it is text if it starts with "solid" and has a "facet".
 */
export function readStl(buf: ArrayBuffer): MeshData {
  if (buf.byteLength >= HEADER_BYTES) {
    const view = new DataView(buf);
    const tris = view.getUint32(80, true);
    if (buf.byteLength === HEADER_BYTES + tris * TRIANGLE_BYTES) return readBinary(view, tris);
  }
  const text = new TextDecoder().decode(buf);
  if (/^\s*solid/i.test(text) && /facet/i.test(text)) return readAscii(text);
  throw new Error("not a valid STL file");
}

/** Bytes to base64, so an STL can live inside a JSON project file */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** Base64 back to bytes. Throws if it is not base64. */
function fromBase64(data: string): ArrayBuffer {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; ++i) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

/**
 * How many parsed STLs to keep. Reading a big file takes a while, and
 * rebuilding the part asks for the same imported files again each time.
 */
const MAX_CACHED = 4;

/**
 * The parsed files, by their base64 text. When it is full, the one added
 * longest ago is dropped (not the least recently used).
 */
const cache = new Map<string, MeshData>();

/**
 * The mesh in a base64 STL, parsed once and reused. The same object is handed
 * back every time, so it must not be changed.
 */
export function meshFromBase64(data: string): MeshData {
  let m = cache.get(data);
  if (!m) {
    m = readStl(fromBase64(data));
    if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
    cache.set(data, m);
  }
  return m;
}
