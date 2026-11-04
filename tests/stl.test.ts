import { beforeAll, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { readStl, writeStl } from "../src/cadfly/geometry/stl";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";

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
