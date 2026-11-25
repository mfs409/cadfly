import { beforeAll, expect, test, describe } from "vitest";
import type { Kernel, MeshData } from "../src/cadfly/geometry/kernel";
import { keepOnlyMeshesNamed, meshOfFile, meshSize, readBase64Stl, readStl, toBase64, writeStl } from "../src/cadfly/geometry/stl";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { box } from "./helpers/blocks";

/** Reading and writing STL files, and the remembered meshes of a project's files. */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** Signed volume of an indexed triangle mesh */
function meshVolume(m: { positions: Float32Array; indices: Uint32Array }) {
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((i) => m.indices[t + i] * 3);
    const p = m.positions;
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
}

/** Base64 text of a binary STL of a box with this width (so each width is a different file) */
const boxText = (w: number) => toBase64(writeStl(k.box(w, 2, 3).mesh()));

/** The base64 text of the same file, as a different string object (what a structured clone gives) */
const copyOf = (s: string) => Buffer.from(s, "latin1").toString("latin1");

test("STL round trip preserves triangle count and volume", () => {
  const solid = k.subtract(k.box(10, 10, 10), k.cylinder(2, 2, 12, 48));
  const mesh = solid.mesh();
  const buf = writeStl(mesh);
  expect(buf.byteLength).toBe(84 + (mesh.indices.length / 3) * 50);
  const back = readStl(buf);
  expect(back.indices.length).toBe(mesh.indices.length);
  expect(meshVolume(back)).toBeCloseTo(solid.volume(), 2);
  // welding restores shared vertices, so the mesh stays closed
  expect(back.positions.length / 3).toBe(mesh.positions.length / 3);
});

test("readStl rejects non-binary input", () => {
  expect(() => readStl(new TextEncoder().encode("solid x\nendsolid x\n".padEnd(200)).buffer as ArrayBuffer)).toThrow();
});

test("meshSize gives how far a mesh reaches in x, y and z, not where it is", () => {
  const moved = k.place(k.box(2, 3, 4), { position: [100, -50, 7] });
  expect(meshSize(moved.mesh())).toEqual({ width: expect.closeTo(2, 4), depth: expect.closeTo(3, 4), height: expect.closeTo(4, 4) });
  expect(meshSize({ positions: new Float32Array([1, 2, 3]), indices: new Uint32Array(0) })).toEqual({ width: 0, depth: 0, height: 0 });
});

test("parsed files are remembered, and every file of a project is kept, however many", () => {
  const texts = [1, 2, 3, 4, 5, 6, 7].map(boxText);
  const first = texts.map((t, i) => meshOfFile(`f${i}.stl`, t));
  // none was pushed out by the later ones: asking again gives the very same mesh
  texts.forEach((t, i) => expect(meshOfFile(`f${i}.stl`, t)).toBe(first[i]));
  keepOnlyMeshesNamed([]);
});

test("an equal copy of the text gives the same mesh, and then the copy is the one remembered", () => {
  const a = boxText(1);
  const mesh = meshOfFile("a.stl", a);
  const clone = copyOf(a);
  expect(clone).toBe(a); // equal text...
  expect(meshOfFile("a.stl", clone)).toBe(mesh); // ...so the same mesh, not a new parse
  expect(meshOfFile("a.stl", clone)).toBe(mesh);
  keepOnlyMeshesNamed([]);
});

test("other text under the same name is parsed again, never given the old mesh", () => {
  const old = meshOfFile("a.stl", boxText(1));
  const next = meshOfFile("a.stl", boxText(2));
  expect(next).not.toBe(old);
  expect(meshSize(next).width).toBeCloseTo(2, 4);
  expect(meshOfFile("a.stl", boxText(2))).toBe(next); // the replaced entry is the one kept
  keepOnlyMeshesNamed([]);
});

test("keepOnlyMeshesNamed frees the files that are no longer in the project, and only those", () => {
  const [a, b, c] = [1, 2, 3].map(boxText);
  const ma = meshOfFile("a.stl", a);
  const mb = meshOfFile("b.stl", b);
  const mc = meshOfFile("c.stl", c);
  keepOnlyMeshesNamed(["a.stl", "c.stl"]);
  expect(meshOfFile("a.stl", a)).toBe(ma);
  expect(meshOfFile("c.stl", c)).toBe(mc);
  expect(meshOfFile("b.stl", b)).not.toBe(mb); // parsed again, since it was freed
  keepOnlyMeshesNamed([]);
});

test("readBase64Stl reads a file without remembering it", () => {
  keepOnlyMeshesNamed([]);
  const a = boxText(9);
  const once = readBase64Stl(a);
  expect(readBase64Stl(a)).not.toBe(once);
  const kept = meshOfFile("a.stl", a);
  expect(readBase64Stl(a)).not.toBe(kept);
  expect(meshOfFile("a.stl", a)).toBe(kept); // reading it with readBase64Stl did not touch what is kept
  keepOnlyMeshesNamed([]);
});

test("a string that is not an STL is refused, by either way of reading it", () => {
  expect(() => meshOfFile("x.stl", "QQ==")).toThrow();
});

test("a base64 string that is not an STL is refused", () => {
  expect(() => readBase64Stl("QQ==")).toThrow();
});

describe("STL parsing", () => {
  test("ASCII STL reads the same as binary", () => {
    const ascii = `solid cube
facet normal 0 0 0
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
facet normal 0 0 0
 outer loop
  vertex 1 0 0
  vertex 1 1 0
  vertex 0 1 0
 endloop
endfacet
endsolid cube`;
    const m = readStl(new TextEncoder().encode(ascii).buffer as ArrayBuffer);
    expect(m.indices.length).toBe(6);
    expect(m.positions.length / 3).toBe(4); // shared corners are welded
  });

  test("a binary STL that starts with 'solid' is still binary", () => {
    const buf = writeStl(k.box(2, 2, 2).mesh(), "solid exported by cadfly");
    expect(readStl(buf).indices.length).toBe(36);
  });

  test("garbage is rejected", () => {
    expect(() => readStl(new TextEncoder().encode("hello").buffer as ArrayBuffer)).toThrow(/not a valid STL/);
    expect(() => readStl(new ArrayBuffer(10))).toThrow(/not a valid STL/);
  });
});

describe("meshes that are not closed solids", () => {
  const box = (): MeshData => k.box(2, 2, 2).mesh();

  test("a mesh with a missing face is rejected with an explanation", () => {
    const m = box();
    const open: MeshData = { positions: m.positions, indices: m.indices.slice(0, m.indices.length - 3) };
    expect(() => k.fromMesh(open)).toThrow(/not a closed solid/);
  });

  test("a mesh with its faces turned inside out is rejected", () => {
    const m = box();
    const flipped = m.indices.slice();
    for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
    expect(() => k.fromMesh({ positions: m.positions, indices: flipped })).toThrow();
  });

  test("an empty mesh is rejected", () => {
    expect(() => k.fromMesh({ positions: new Float32Array(0), indices: new Uint32Array(0) })).toThrow();
  });
});
