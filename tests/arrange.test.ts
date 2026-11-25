import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, Solid } from "../src/cadfly/geometry/kernel";
import { align, placeAgainst } from "../src/cadfly/geometry/arrange";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { box, three } from "./helpers/blocks";

/** Lining up solids along an axis and placing one against another. */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** A box (w x d x h) whose bottom center is at x, y, z (the kernel's box is centered on the origin) */
function boxAt(w: number, d: number, h: number, x: number, y: number, z = 0): Solid {
  return k.place(k.box(w, d, h), { position: [x, y, z + h / 2] });
}

/** The bounds of a solid, as [minx, miny, minz, maxx, maxy, maxz], rounded to 3 places */
function box6(s: Solid): number[] {
  const { min, max } = s.bounds();
  return [...min, ...max].map((v) => Math.round(v * 1e3) / 1e3);
}

describe("align and placeAgainst work on a list of solids", () => {
  const anchor = () => boxAt(10, 10, 10, 0, 0);
  const three = () => [boxAt(2, 2, 2, 30, -20), boxAt(4, 4, 4, -25, 15, 3), boxAt(6, 2, 8, 12, 40)];

  test("align at center: every solid matches the anchor on the axis, and only on it", () => {
    const out = align(k, anchor(), three(), 0, "center");
    expect(out).toHaveLength(3);
    expect(box6(out[0])).toEqual([-1, -21, 0, 1, -19, 2]); // x now centered on 0; y and z as they were
    expect(box6(out[1])).toEqual([-2, 13, 3, 2, 17, 7]);
    expect(box6(out[2])).toEqual([-3, 39, 0, 3, 41, 8]);
  });

  test("align at min and max match the low and the high faces", () => {
    expect(align(k, anchor(), three(), 1, "min").map((s) => box6(s)[1])).toEqual([-5, -5, -5]);
    expect(align(k, anchor(), three(), 1, "max").map((s) => box6(s)[4])).toEqual([5, 5, 5]);
  });

  test("placeAgainst puts each solid on the high or the low side of the anchor, on one axis", () => {
    const up = placeAgainst(k, anchor(), three(), 2, "high");
    expect(up.map((s) => box6(s)[2])).toEqual([10, 10, 10]);
    const down = placeAgainst(k, anchor(), three(), 2, "low");
    expect(down.map((s) => box6(s)[5])).toEqual([0, 0, 0]);
  });

  test("the solids given, and the anchor, are not changed; the results are in the same order", () => {
    const a = anchor();
    const list = three();
    const before = list.map(box6);
    const out = align(k, a, list, 0, "center");
    expect(list.map(box6)).toEqual(before);
    expect(box6(a)).toEqual([-5, -5, 0, 5, 5, 10]);
    expect(out.map((s) => box6(s)[4] - box6(s)[1])).toEqual(before.map((v) => v[4] - v[1]));
  });

  test("an empty list gives an empty list", () => {
    expect(align(k, anchor(), [], 0, "center")).toEqual([]);
  });
});
