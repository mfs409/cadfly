import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, Vec2 } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const rect = (w: number, h: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

describe("extrudeFlat", () => {
  test("20x10 rectangle extruded by 5", () => {
    const s = k.extrudeFlat(k.flat([rect(20, 10)]), 5);
    expect(s.isValid()).toBe(true);
    expect(s.volume()).toBeCloseTo(1000);
    expect(s.bounds()).toEqual({ min: [0, 0, 0], max: [20, 10, 5] });
  });

  test("subtracting a cylinder removes about pi r^2 h", () => {
    const plate = k.extrudeFlat(k.flat([rect(20, 10)]), 5);
    const hole = k.place(k.cylinder(2, 2, 5, 128), { position: [10, 5, 2.5] });
    const s = k.subtract(plate, hole);
    expect(s.isValid()).toBe(true);
    expect(s.volume()).toBeCloseTo(1000 - Math.PI * 4 * 5, 0);
  });

  test("a contour inside another becomes a hole", () => {
    const hole = rect(4, 4).map(([x, y]): Vec2 => [x + 8, y + 3]);
    const s = k.extrudeFlat(k.flat([rect(20, 10), hole]), 5);
    expect(s.volume()).toBeCloseTo((200 - 16) * 5);
  });
});

describe("primitives", () => {
  test("box volume and centered bounds", () => {
    const s = k.box(2, 4, 6);
    expect(s.volume()).toBeCloseTo(48);
    expect(s.bounds()).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
  });

  test("cylinder volume", () => {
    const s = k.cylinder(3, 3, 10, 256);
    expect(s.volume()).toBeCloseTo(Math.PI * 9 * 10, 0);
  });

  test("cone volume", () => {
    const s = k.cylinder(3, 0, 10, 256);
    expect(s.volume()).toBeCloseTo((Math.PI * 9 * 10) / 3, 0);
  });

  test("sphere volume", () => {
    const s = k.sphere(5, 128);
    expect(s.volume() / ((4 / 3) * Math.PI * 125)).toBeCloseTo(1, 2);
  });

  test("placement translates and rotates", () => {
    const s = k.place(k.box(2, 4, 6), {
      rotation: [0, 90, 0],
      position: [10, 0, 0],
    });
    const { min, max } = s.bounds();
    // 90 degrees about Y swaps the X and Z extents
    expect(min[0]).toBeCloseTo(7);
    expect(max[0]).toBeCloseTo(13);
    expect(min[2]).toBeCloseTo(-1);
    expect(max[2]).toBeCloseTo(1);
  });
});

describe("flush and coplanar booleans", () => {
  test("hole cut flush through a face stays valid", () => {
    const block = k.box(10, 10, 10);
    // cutter exactly as tall as the block: its end faces are coplanar with block faces
    const cutter = k.cylinder(2, 2, 10, 64);
    const s = k.subtract(block, cutter);
    expect(s.isValid()).toBe(true);
    expect(s.volume()).toBeCloseTo(1000 - k.cylinder(2, 2, 10, 64).volume());
  });

  test("union of touching boxes has the combined volume", () => {
    const a = k.box(10, 10, 10);
    const b = k.place(k.box(10, 10, 10), { position: [10, 0, 0] });
    const s = k.union(a, b);
    expect(s.isValid()).toBe(true);
    expect(s.volume()).toBeCloseTo(2000);
  });

  test("intersect of overlapping boxes", () => {
    const a = k.box(10, 10, 10);
    const b = k.place(k.box(10, 10, 10), { position: [5, 0, 0] });
    expect(k.intersect(a, b).volume()).toBeCloseTo(500);
  });
});

// A shape lives in the kernel's own memory, which JavaScript cannot free: release() frees what a build made, so a long session does not grow
describe("releasing memory", () => {
  test("a released solid or flat shape cannot be used any more", () => {
    const solid = k.box(1, 1, 1);
    const flat = k.flat([rect(2, 2)]);
    expect(solid.volume()).toBeCloseTo(1);
    k.release();
    expect(() => solid.volume()).toThrow();
    expect(() => flat.area()).toThrow();
  });

  test("what an operation makes along the way is freed too, and what was made before a release is not freed twice", () => {
    const placed = k.place(k.box(1, 1, 1), { rotation: [0, 0, 45], position: [1, 2, 3] });
    expect(placed.volume()).toBeCloseTo(1);
    k.release();
    k.release();
    expect(() => placed.volume()).toThrow();
  });

  test("a kept solid survives a release, and is freed by the first release after it is dropped", () => {
    const kept = k.keep(k.box(2, 2, 2));
    k.release();
    expect(kept.volume()).toBeCloseTo(8);
    k.release();
    expect(kept.volume()).toBeCloseTo(8);
    k.drop(kept);
    expect(kept.volume()).toBeCloseTo(8); // not at once: the build in progress may still be using it
    k.release();
    expect(() => kept.volume()).toThrow();
  });

  test("a kept solid can be used in later builds", () => {
    const kept = k.keep(k.box(2, 2, 2));
    k.release();
    const bigger = k.union(kept, k.place(k.box(2, 2, 2), { position: [1, 0, 0] }));
    expect(bigger.volume()).toBeCloseTo(12);
    k.release();
    expect(kept.volume()).toBeCloseTo(8);
    k.drop(kept);
    k.release();
  });
});
