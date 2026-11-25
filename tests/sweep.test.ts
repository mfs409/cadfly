import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { createBlock } from "../src/cadfly/language/edit";
import { oneScript } from "./helpers/script-helpers";
import { runProgram } from "../src/cadfly/language/run";

/** Lofts and sweeps. */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const run = (text: string) => runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program);
const vol = (text: string) => run(text).combined!.volume();

const bounds = (text: string) => {
  const b = run(text).combined!.bounds();
  return [...b.min, ...b.max];
};

const close = (got: number[], want: number[], digits = 3) => want.forEach((v, i) => expect(got[i], `item ${i}`).toBeCloseTo(v, digits));

describe("loft", () => {
  test("a square blended into the same square is a box", () => {
    const text = "loft height=10\n  bottom\n    rectangle w=10 h=10\n  top\n    rectangle w=10 h=10";
    expect(vol(text)).toBeCloseTo(1000, 3);
    close(bounds(text), [-5, -5, 0, 5, 5, 10]);
  });
  test("a square into a smaller square is a frustum", () => {
    const text = "loft height=9\n  bottom\n    rectangle w=10 h=10\n  top\n    rectangle w=4 h=4";
    expect(vol(text)).toBeCloseTo((9 / 3) * (100 + 16 + 40), 3);
  });
  test("a square into a circle is in between the two prisms, and reaches the circle at the top", () => {
    const text = "loft height=20\n  bottom\n    rectangle w=20 h=20\n  top\n    circle u=0 v=0 r=5";
    const v = vol(text);
    expect(v).toBeGreaterThan(20 * Math.PI * 25);
    expect(v).toBeLessThan(20 * 400);
    close(bounds(text), [-10, -10, 0, 10, 10, 20], 2);
  });
  test("an L shape can be lofted (the ends are cut into triangles)", () => {
    const text = "loft height=5\n  bottom\n    polygon\n      point u=0 v=0\n      point u=4 v=0\n      point u=4 v=1\n      point u=1 v=1\n      point u=1 v=4\n      point u=0 v=4\n  top\n    rectangle u=0 v=0 w=2 h=2";
    expect(run(text).problem).toBeUndefined();
    expect(vol(text)).toBeGreaterThan(0);
  });
  test("it lands on the plane it is asked to be on", () => {
    const text = "loft height=10 plane=XZ\n  bottom\n    rectangle w=10 h=10\n  top\n    rectangle w=10 h=10";
    const b = bounds(text);
    expect(b[4]).toBeCloseTo(0, 3); // XZ: the normal is -y, so it goes from y = 0 down to -10
    expect(b[1]).toBeCloseTo(-10, 3);
  });
  test("it says what is wrong", () => {
    expect(run("loft\n  bottom\n    rectangle").problem?.message).toMatch(/one bottom block and one top/);
    expect(run("loft\n  bottom\n    rectangle\n  top").problem?.message).toMatch(/inside the top/);
    expect(run("loft\n  bottom\n    rectangle\n    circle u=30 v=0 r=2\n  top\n    circle").problem?.message).toMatch(/single outline/);
    expect(run("loft\n  bottom\n    rectangle hole\n  top\n    circle").problem?.message).toMatch(/not a hole/);
    expect(run("loft\n  bottom\n    rectangle w=20 h=20\n    circle r=3 hole\n  top\n    circle").problem?.message).toMatch(/single outline with no holes/);
  });
  test("a new loft block works as it is", () => {
    const block = createBlock([], "loft");
    const r = runProgram(k, oneScript([block]));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeGreaterThan(0);
  });
});

describe("sweep", () => {
  test("a circle along a straight path is a cylinder", () => {
    const text = "sweep\n  circle u=0 v=0 r=3\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=30";
    expect(vol(text) / (Math.PI * 9 * 30)).toBeCloseTo(1, 2);
    close(bounds(text), [-3, -3, 0, 3, 3, 30], 2);
  });
  test("along x the outline is seen with u across (y) and v up (z)", () => {
    const text = "sweep\n  rectangle w=2 h=4\n  vertex x=0 y=0 z=0\n  vertex x=10 y=0 z=0";
    close(bounds(text), [0, -1, -2, 10, 1, 2]);
    expect(vol(text)).toBeCloseTo(80, 3);
  });
  test("a bend keeps the width: an L path of a square bar has about the volume of both legs", () => {
    const text = "sweep\n  rectangle w=2 h=2\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=20\n  vertex x=20 y=0 z=20";
    // the legs 20 long each, 2 x 2: the mitre adds nothing and takes nothing for a right angle at the centreline
    expect(vol(text)).toBeCloseTo(4 * 40, 1);
  });
  test("a path that runs back on itself, or has a repeated point, is explained", () => {
    expect(run("sweep\n  circle u=0 v=0 r=1\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=10\n  vertex x=0 y=0 z=0").problem?.message).toMatch(/back on itself/);
    expect(run("sweep\n  circle u=0 v=0 r=1\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=0").problem?.message).toMatch(/same place/);
    expect(run("sweep\n  circle u=0 v=0 r=1\n  vertex x=0 y=0 z=0").problem?.message).toMatch(/at least 2/);
  });
  test("a new sweep block works as it is", () => {
    const r = runProgram(k, oneScript([createBlock([], "sweep")]));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeGreaterThan(0);
  });
});
