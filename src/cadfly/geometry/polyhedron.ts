import type { Kernel, MeshData, Solid, Vec3 } from "./kernel";
import { cross, dot, sub } from "./vec";

/**
 * Solids made from points and faces. A solid is listed as its corner points
 * and, if it has faces, the faces; this file checks them and turns them into a
 * triangle mesh that the kernel can build (`polyhedronMesh`). It also writes
 * out the faces of the hull of some points (`hullFaces`), so that they can be
 * edited, and cuts a single face into triangles for drawing (`faceTriangles`).
 *
 * A point that no face uses is harmless: it is left out of the solid. A corner
 * that lies on a straight line between its neighbors is kept, so that the face
 * next to it, which lists it too, still meets this one edge to edge. It leaves
 * a triangle with no area, which the library accepts.
 */

/**
 * Why a set of vertices and faces is not a solid, in words a person can act on
 */
export class PolyhedronError extends Error {
  /**
   * @param message What is wrong.
   * @param faces The faces (numbered from 1) the problem is about, if it is
   *              about some, so that the editor can point at them. Empty if it
   *              is about the solid as a whole.
   */
  constructor(message: string, readonly faces: number[] = []) {
    super(message);
  }
}

/**
 * Read "1 2 3 4" (or "1, 2, 3, 4") as vertex numbers. Throws a PolyhedronError
 * if anything is not a whole number. Whether the numbers name real vertices is
 * not checked here: `polyhedronMesh` does that.
 */
export function parseCorners(text: string): number[] {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isInteger(n))) throw new PolyhedronError(`"${text}" should be vertex numbers separated by spaces, like 1 2 3 4`);
  return numbers;
}

/**
 * The normal of a (possibly non-convex) polygon, by Newell's method. Its length
 * is twice the polygon's area.
 */
function newell(points: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/**
 * Split a flat polygon into triangles by cutting off one "ear" at a time (a
 * corner whose triangle holds no other corner). A corner on a straight line
 * between its neighbors is never cut off as an ear, so it stays an end of the
 * other triangles, and a triangle with no area can be left over (see the top
 * of this file).
 *
 * Throws a PolyhedronError for a polygon with no area, one that is not flat,
 * and one that crosses itself or is listed out of order.
 *
 * @param ring The polygon's corners, in order around it.
 * @param face The face's number (from 1), for the error messages.
 * @returns Triangles, each as three positions in `ring`, going the same way
 *          around as the ring does.
 */
function triangulate(ring: Vec3[], face: number): [number, number, number][] {
  const n = ring.length;
  if (n === 3) return [[0, 1, 2]];
  const normal = newell(ring);
  const size = Math.hypot(...normal);
  if (size < 1e-12) throw new PolyhedronError(`face ${face} has no area (its corners are in a line)`, [face]);
  // flat to within a millionth of the face's own size (the square root of its
  // area is a length that stands for how big it is)
  const reach = Math.sqrt(size);
  for (const p of ring) {
    if (Math.abs(dot(sub(p, ring[0]), normal)) / size > 1e-6 * reach) throw new PolyhedronError(`face ${face} is not flat: its corners are not all in one plane (use triangles, or split it)`, [face]);
  }

  /**
   * Is the turn from a to b to c a left turn, as seen from where `normal`
   * points?
   */
  function left(a: number, b: number, c: number) {
    return dot(cross(sub(ring[b], ring[a]), sub(ring[c], ring[a])), normal) > 0;
  }
  
  /** Is the corner p inside the triangle a, b, c (or on its edge)? */
  function inside(p: number, a: number, b: number, c: number) {
    return left(a, b, p) && left(b, c, p) && left(c, a, p);
  }
  
  const rest = ring.map((_, i) => i);
  const out: [number, number, number][] = [];
  let guard = n * n; // a safety stop: each pass either cuts an ear or gives up
  while (rest.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[(i + rest.length - 1) % rest.length];
      const b = rest[i];
      const c = rest[(i + 1) % rest.length];
      if (!left(a, b, c)) continue; // a reflex corner is not an ear
      if (rest.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push([a, b, c]);
      rest.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) throw new PolyhedronError(`face ${face} crosses itself, or its corners are listed out of order; go around the face, not across it`, [face]);
  }
  out.push([rest[0], rest[1], rest[2]]);
  return out;
}

/**
 * Make a triangle mesh of a solid from its corner points and its faces. A face
 * is the numbers (starting at 1) of its points, in order around it. Faces may
 * be listed in either direction: they are turned to agree with each other, and
 * all of them are turned if the solid came out inside-out. Faces of more than
 * three corners must be flat; they are cut into triangles.
 *
 * Throws a PolyhedronError, saying what is wrong and which faces, if there are
 * fewer than 4 points or 4 faces, a face is too short or names a point that is
 * not there or lists one twice, the faces leave a gap or meet three at an
 * edge, they cannot be turned to agree (a twisted surface), they make more
 * than one separate piece, a face is not flat or crosses itself, or the solid
 * has no volume.
 *
 * @param points The corner points.
 * @param faces The faces, each as the numbers of its points.
 */
export function polyhedronMesh(points: Vec3[], faces: number[][]): MeshData {
  if (points.length < 4) throw new PolyhedronError(`a solid needs at least 4 vertices (there ${points.length === 1 ? "is" : "are"} ${points.length})`);
  if (faces.length < 4) throw new PolyhedronError(`a solid needs at least 4 faces (there ${faces.length === 1 ? "is" : "are"} ${faces.length})`);

  // check each face, and note which faces use each edge, and in which direction
  const rings = faces.map((face, f) => {
    if (face.length < 3) throw new PolyhedronError(`face ${f + 1} needs at least 3 vertices`, [f + 1]);
    for (const v of face) {
      if (!Number.isInteger(v) || v < 1 || v > points.length) throw new PolyhedronError(`face ${f + 1} uses vertex ${v}, but the vertices are numbered 1 to ${points.length}`, [f + 1]);
    }
    if (new Set(face).size !== face.length) throw new PolyhedronError(`face ${f + 1} lists a vertex twice`, [f + 1]);
    return face.map((v) => v - 1);
  });
  const edges = new Map<string, { face: number; forward: boolean }[]>();
  rings.forEach((ring, f) => {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const uses = edges.get(key) ?? [];
      uses.push({ face: f, forward: a < b });
      edges.set(key, uses);
    });
  });
  for (const [key, uses] of edges) {
    const [a, b] = key.split(",").map((v) => Number(v) + 1);
    if (uses.length === 1) throw new PolyhedronError(`the edge between vertices ${a} and ${b} belongs to only face ${uses[0].face + 1}, so the surface has a gap there`, [uses[0].face + 1]);
    if (uses.length > 2) throw new PolyhedronError(`the edge between vertices ${a} and ${b} is shared by ${uses.length} faces (${uses.map((u) => u.face + 1).join(", ")}); at most two can meet at an edge`, uses.map((u) => u.face + 1));
  }

  // turn faces to agree: neighbors must run along their shared edge in
  // opposite directions
  const flip = new Array<boolean | undefined>(faces.length).fill(undefined);
  flip[0] = false;
  const queue = [0];
  while (queue.length) {
    const f = queue.shift()!;
    for (const uses of edges.values()) {
      const here = uses.find((u) => u.face === f);
      if (!here) continue;
      const other = uses.find((u) => u.face !== f)!;
      // `here` runs forward (as listed, unless turned); `other` must run the
      // opposite way
      const hereForward = here.forward !== flip[f]!;
      const needOtherFlip = other.forward === hereForward; // the same direction: it must be turned
      if (flip[other.face] === undefined) {
        flip[other.face] = needOtherFlip;
        queue.push(other.face);
      } else if (flip[other.face] !== needOtherFlip) {
        throw new PolyhedronError(`faces ${f + 1} and ${other.face + 1} cannot be turned to agree: the surface is twisted (like a Möbius strip) or a face is listed in a mixed-up order`, [f + 1, other.face + 1]);
      }
    }
  }
  const lonely = flip.findIndex((f) => f === undefined);
  if (lonely >= 0) throw new PolyhedronError(`face ${lonely + 1} is not connected to face 1: the faces make more than one separate piece, so use one solid block for each piece`, [lonely + 1]);

  // triangles, wound by the oriented faces
  let tris: [number, number, number][] = [];
  rings.forEach((ring, f) => {
    const ordered = flip[f] ? [...ring].reverse() : ring;
    for (const [a, b, c] of triangulate(ordered.map((i) => points[i]), f + 1)) tris.push([ordered[a], ordered[b], ordered[c]]);
  });

  // inside-out? then turn everything
  let volume = 0;
  for (const [a, b, c] of tris) volume += dot(points[a], cross(points[b], points[c])) / 6;
  if (Math.abs(volume) < 1e-9) throw new PolyhedronError("the solid has no volume: its vertices are all in one plane");
  if (volume < 0) tris = tris.map(([a, b, c]) => [a, c, b]);

  return { positions: new Float32Array(points.flat()), indices: new Uint32Array(tris.flat()) };
}

/**
 * Build the solid that a set of points and faces make, in the kernel: the mesh
 * from `polyhedronMesh`, then the kernel's solid from it. Whatever
 * `polyhedronMesh` finds wrong it says in its own words (a PolyhedronError). If
 * the kernel then refuses the mesh, the message is about the faces.
 *
 * A surface that passes through itself is not found out: the kernel takes it
 * and counts its volume as the sum of the parts that point outward minus the
 * parts that point inward.
 *
 * @param k The kernel to build with.
 * @param points The corner points.
 * @param faces The faces, each as the numbers of its points (from 1).
 */
export function polyhedronSolid(k: Kernel, points: Vec3[], faces: number[][]): Solid {
  try {
    return k.fromMesh(polyhedronMesh(points, faces));
  } catch (e) {
    if (e instanceof PolyhedronError) throw e;
    throw new Error("the faces do not make a valid solid (they may cross each other or overlap)");
  }
}

/**
 * The triangles of one face, as a best effort for showing it: cut into ears if
 * it is flat and goes around once, and a fan from its first corner if it is not
 * (a face that cannot be built is still drawn, so it can be seen what is wrong
 * with it).
 *
 * @param ring The face's corners, in order around it.
 * @returns Triangles, each as three positions in `ring`.
 */
export function faceTriangles(ring: Vec3[]): [number, number, number][] {
  try {
    return triangulate(ring, 0);
  } catch {
    return ring.slice(2).map((_, i) => [0, i + 1, i + 2] as [number, number, number]);
  }
}

/**
 * The faces of the convex hull of some points, as vertex numbers (from 1)
 * around each face counter-clockwise as seen from outside: what a solid with no
 * faces is made of, written out so it can be edited. A point that is not a
 * corner of the hull (inside it, or on an edge) is left out. Triangles that lie
 * in one plane are joined into one face (the square base of a pyramid is one
 * face, not two triangles).
 *
 * The library returns the hull's own vertices, so each is matched back to the
 * point it came from: they agree to within a tenth of a percent, since the
 * library keeps single-precision numbers.
 *
 * @param points The points the hull was made from, in the order the vertices
 *               are numbered.
 * @param mesh The hull's triangles (any vertex order).
 */
export function hullFaces(points: Vec3[], mesh: MeshData): number[][] {
  
  /** The position of vertex `v` of the hull */
  function at(v: number): Vec3 {
    return [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
  }
  
  /**
   * Are these the same place? They may differ by a tenth of a percent of how
   * far from the origin they are (and a little more near it).
   */
  function near(a: Vec3, b: Vec3) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-3 * (1 + Math.abs(b[0]) + Math.abs(b[1]) + Math.abs(b[2]));
  }
  
  const toPoint = new Map<number, number>();
  
  /**
   * The number (from 1) of the point that hull vertex `v` came from, or 0 if
   * none matches
   */
  function pointOf(v: number) {
    let found = toPoint.get(v);
    if (found === undefined) {
      found = points.findIndex((p) => near(at(v), p)) + 1; // 0 if there is none
      toPoint.set(v, found);
    }
    return found;
  }
  
  // group the triangles by the plane they lie in
  const planes: { n: Vec3; d: number; tris: [number, number, number][] }[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const tri = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map(pointOf) as [number, number, number];
    if (tri.some((p) => p === 0) || new Set(tri).size < 3) continue;
    const [a, b, c] = tri.map((p) => points[p - 1]);
    const cr = cross(sub(b, a), sub(c, a));
    const size = Math.hypot(...cr);
    if (size < 1e-12) continue;
    const n: Vec3 = [cr[0] / size, cr[1] / size, cr[2] / size];
    const d = dot(n, a);
    const same = planes.find((p) => dot(p.n, n) > 1 - 1e-6 && Math.abs(p.d - d) < 1e-6 * (1 + Math.abs(d)));
    if (same) same.tris.push(tri);
    else planes.push({ n, d, tris: [tri] });
  }
  // each plane's face: the edges that belong to only one of its triangles,
  // followed around
  return planes.map(({ tris }) => {
    const next = new Map<number, number>();
    const inside = new Set<string>();
    for (const [a, b, c] of tris) for (const [x, y] of [[a, b], [b, c], [c, a]]) inside.add(`${x},${y}`);
    for (const [a, b, c] of tris) for (const [x, y] of [[a, b], [b, c], [c, a]]) if (!inside.has(`${y},${x}`)) next.set(x, y);
    const ring = [next.keys().next().value as number];
    while (next.has(ring[ring.length - 1]) && next.get(ring[ring.length - 1]) !== ring[0] && ring.length <= next.size) ring.push(next.get(ring[ring.length - 1])!);
    return ring;
  });
}
