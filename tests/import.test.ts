import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, MeshData } from "../src/cadfly/geometry/kernel";
import { readStl, writeStl } from "../src/cadfly/geometry/stl";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
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
