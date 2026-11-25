import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { shapeToContour } from "../src/cadfly/geometry/sketch";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { runProgram } from "../src/cadfly/language/run";

/** Rounded corners, and twisted and tapered extrusions. */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** Build a program from block text and run it */
const run = (text: string) => {
  const { program } = applyOps([], [{ op: "append", blocks: text }]);
  return runProgram(k, program);
};

const vol = (text: string) => run(text).combined!.volume();

const bounds = (text: string) => {
  const b = run(text).combined!.bounds();
  return [...b.min, ...b.max];
};

const close = (got: number[], want: number[], digits = 4) => want.forEach((v, i) => expect(got[i], `item ${i}`).toBeCloseTo(v, digits));
const pi = Math.PI;

describe("rounded corners on a rectangle", () => {
  test("the outline is rounded: more points, less area, still inside the rectangle", () => {
    const plain = shapeToContour({ kind: "rect", at: [0, 0], w: 60, h: 40 });
    const rounded = shapeToContour({ kind: "rect", at: [0, 0], w: 60, h: 40, radius: 6 });
    expect(plain).toHaveLength(4);
    expect(rounded.length).toBeGreaterThan(40);
    for (const [x, y] of rounded) expect(x >= -1e-9 && x <= 60 + 1e-9 && y >= -1e-9 && y <= 40 + 1e-9).toBe(true);
  });

  test("a plate with rounded corners has the right volume (each corner loses r squared less a quarter circle)", () => {
    const r = 6;
    const lost = 4 * (r * r - (pi * r * r) / 4);
    const v = vol(`extrude height=5\n  rectangle w=60 h=40 corner=${r}`);
    expect(v / ((60 * 40 - lost) * 5)).toBeCloseTo(1, 3);
    close(bounds(`extrude height=5\n  rectangle w=60 h=40 corner=${r}`), [-30, -20, 0, 30, 20, 5]);
  });

  test("the radius is cut down to fit: a big one makes a stadium, and a rotated one turns with the rectangle", () => {
    const stadium = vol("extrude height=1\n  rectangle w=40 h=10 corner=999");
    expect(stadium / ((40 * 10 - (100 - 25 * pi)) * 1)).toBeCloseTo(1, 2); // two half circles of radius 5 on a 30 by 10 body: area 300 + 25 pi
    const turned = bounds("extrude height=1\n  rectangle w=40 h=10 corner=2 rotate=90");
    expect(turned[3] - turned[0]).toBeCloseTo(10, 3);
    expect(turned[4] - turned[1]).toBeCloseTo(40, 3);
  });

  test("no corner is the same rectangle as before, and a negative radius is refused", () => {
    expect(vol("extrude height=5\n  rectangle w=10 h=10 corner=0")).toBeCloseTo(500);
    expect(run("extrude height=5\n  rectangle w=10 h=10 corner=-1").problem!.message).toMatch(/corner radius cannot be negative/);
  });

  test("holes can be rounded too, and a rounded hole is cut out", () => {
    const v = vol("extrude height=2\n  rectangle w=40 h=40\n  rectangle u=10 v=10 w=20 h=20 corner=10 hole");
    expect(v).toBeGreaterThan(1600 * 2 - 400 * 2 - 1);
    expect(v).toBeLessThan(1600 * 2 - 300 * 2); // a rounded hole (a circle of radius 10, about 314) removes less than a square one
  });
});

describe("twisted and tapered extrusions", () => {
  test("taper scales the top: a pillar 20 square and 30 tall that ends half as wide", () => {
    const text = "extrude height=30 taper=0.5\n  rectangle w=20 h=20";
    expect(vol(text) / (10 * (400 + 100 + 200))).toBeCloseTo(1, 4); // h / 3 * (A1 + A2 + sqrt(A1 A2))
    close(bounds(text), [-10, -10, 0, 10, 10, 30]);
  });

  test("the top shrinks towards the middle of the sketch, not towards its corner", () => {
    const b = bounds("extrude height=30 taper=0.5\n  rectangle u=10 v=10 w=20 h=20"); // a square off to one side: its middle is (10, 10)
    close(b, [0, 0, 0, 20, 20, 30]);
    // at the top the shape is 10 wide, centred on x = 10: slice by intersecting with a thin slab near the top
    const top = run("intersect\n  extrude height=30 taper=0.5\n    rectangle u=10 v=10 w=20 h=20\n  transform z=29.9\n    box w=100 d=100 h=0.2").combined!.bounds();
    expect(top.min[0]).toBeCloseTo(5.0, 0);
    expect(top.max[0]).toBeCloseTo(15.0, 0);
  });

  test("twist turns the top: about the same volume, and the top is a square turned by the twist", () => {
    const text = "extrude height=40 twist=45\n  rectangle w=20 h=20";
    expect(vol(text) / (400 * 40)).toBeGreaterThan(0.99);
    expect(vol(text) / (400 * 40)).toBeLessThan(1.03);
    // a square turned 45 degrees reaches out to the corner: half the diagonal
    const slab = run("intersect\n  extrude height=40 twist=45\n    rectangle w=20 h=20\n  transform z=39.9\n    box w=100 d=100 h=0.2").combined!.bounds();
    expect(slab.max[0]).toBeCloseTo(Math.SQRT2 * 10, 0);
  });

  test("twist and taper together, and a twist the other way", () => {
    const v = vol("extrude height=30 twist=-90 taper=0.5\n  rectangle w=20 h=20");
    expect(v / 7000).toBeGreaterThan(0.97);
    expect(v / 7000).toBeLessThan(1.02);
  });

  test("shapes in one sketch turn and shrink together, holes included", () => {
    const v = vol("extrude height=30 twist=90\n  rectangle w=40 h=40\n  circle r=8 hole");
    expect(v / ((1600 - pi * 64) * 30)).toBeCloseTo(1, 1);
  });

  test("a bad taper or twist is said plainly", () => {
    expect(run("extrude height=5 taper=0\n  rectangle w=10 h=10").problem!.message).toMatch(/taper: must be more than 0/);
    expect(run("extrude height=5 taper=-1\n  rectangle w=10 h=10").problem!.message).toMatch(/taper: must be more than 0/);
    expect(run("extrude height=5 twist=oops\n  rectangle w=10 h=10").problem!.message).toMatch(/unknown variable "oops"/);
  });

  test("with neither, it is the plain extrusion it was", () => {
    expect(vol("extrude height=5\n  rectangle w=10 h=10")).toBeCloseTo(500);
  });
});
