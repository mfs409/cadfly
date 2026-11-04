import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { runProgram } from "../src/cadfly/language/run";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const run = (text: string) => runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program);
const area = (text: string) => run(text).flat!.area();
const vol = (text: string) => run(text).combined!.volume();
const bounds = (text: string) => {
  const b = run(text).combined!.bounds();
  return [...b.min, ...b.max];
};
const close = (got: number[], want: number[], digits = 3) => want.forEach((v, i) => expect(got[i], `item ${i}`).toBeCloseTo(v, digits));
const disc = (r: number) => 0.5 * 64 * r * r * Math.sin((2 * Math.PI) / 64);

describe("drawing without extruding", () => {
  test("a flat shape at the top is a shape of its own: it is drawn, but it is not a solid and is not exported", () => {
    const r = run("rectangle w=40 h=20");
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(1);
    expect(r.shapes[0].flat).toBeDefined();
    expect(r.flat!.area()).toBeCloseTo(800, 3);
    expect(r.combined).toBeNull();
    // what is drawn is a thin slab on the ground
    const b = r.shapes[0].solid.bounds();
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeGreaterThan(0);
    expect(b.max[2]).toBeLessThan(1);
  });

  test("flat shapes and solids can both be at the top: only the solids are in the export", () => {
    const r = run("rectangle w=10 h=10\nbox w=4 d=4 h=4");
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(2);
    expect(r.combined!.volume()).toBeCloseTo(64, 3);
    expect(r.flat!.area()).toBeCloseTo(100, 3);
  });

  test("a hole alone at the top is refused, saying how to cut", () => {
    const r = run("circle r=3 hole");
    expect(r.problem!.message).toMatch(/a hole cuts a piece out of the pieces beside it/);
    expect(r.problem!.blockId).toBe("b1");
  });
});

describe("combining flat shapes", () => {
  test("union, subtract and intersect work on areas", () => {
    expect(area("union\n  rectangle w=10 h=10\n  rectangle u=5 v=0 w=10 h=10")).toBeCloseTo(150, 3);
    expect(area("subtract\n  rectangle w=10 h=10\n  rectangle u=5 v=0 w=10 h=10")).toBeCloseTo(50, 3);
    expect(area("intersect\n  rectangle w=10 h=10\n  rectangle u=5 v=0 w=10 h=10")).toBeCloseTo(50, 3);
  });

  test("a screw hole is area taken out of the inside: an inner outline, not a notch in the border", () => {
    const r = run("subtract\n  rectangle w=40 h=30\n  circle r=5");
    expect(r.flat!.area()).toBeCloseTo(1200 - disc(5), 3);
    const rings = r.flat!.polygons();
    expect(rings).toHaveLength(2); // the border, and the hole
    // a hole that crosses the edge notches the border instead: one outline
    expect(run("subtract\n  rectangle w=40 h=30\n  circle u=20 v=0 r=5").flat!.polygons()).toHaveLength(1);
  });

  test("subtract then extrude is the same as extruding with a hole piece", () => {
    const a = vol("extrude height=5\n  subtract\n    rectangle w=40 h=30\n    circle r=5");
    const b = vol("extrude height=5\n  rectangle w=40 h=30\n  circle r=5 hole");
    expect(a).toBeCloseTo(b, 3);
    expect(a).toBeCloseTo((1200 - disc(5)) * 5, 2);
  });

  test("hole pieces, also repeated, are cut from the pieces beside them, however deep they are", () => {
    const v = vol("extrude height=2\n  rectangle w=100 h=30\n  repeat times=4 counter=i\n    circle u=\"i * 20 - 30\" v=0 r=3 hole");
    expect(v).toBeCloseTo((3000 - 4 * disc(3)) * 2, 2);
    const moved = vol("extrude height=2\n  rectangle w=100 h=30\n  transform x=10\n    circle r=3 hole");
    expect(moved).toBeCloseTo((3000 - disc(3)) * 2, 2);
  });

  test("a block cannot mix flat shapes and solids; the message says to extrude first", () => {
    expect(run("union\n  rectangle w=4 h=4\n  box").problem!.message).toMatch(/both flat shapes .* and 3D shapes: extrude the flat ones first/);
    expect(run("subtract\n  rectangle w=4 h=4\n  box").problem!.message).toMatch(/a flat shape can only be cut from a flat shape/);
  });

  test("a cut that leaves nothing is said so", () => {
    expect(run("subtract\n  rectangle w=4 h=4\n  rectangle w=10 h=10").problem!.message).toMatch(/leaves nothing/);
  });
});

describe("placing flat shapes", () => {
  test("move, rotate, scale and mirror work in the plane", () => {
    const at = (text: string) => run(text).flat!.bounds();
    expect(at("transform x=10 y=5\n  rectangle w=4 h=2")).toEqual({ min: [8, 4], max: [12, 6] });
    const turned = at("transform rz=90\n  rectangle u=10 v=0 w=4 h=2");
    expect(turned.min[0]).toBeCloseTo(-1, 6);
    expect(turned.max[1]).toBeCloseTo(12, 6);
    expect(at("transform sx=2 sy=3\n  rectangle w=4 h=2")).toEqual({ min: [-4, -3], max: [4, 3] });
    const flipped = at("mirror axis=x\n  rectangle u=10 v=0 w=4 h=2");
    expect(flipped.min[0]).toBeCloseTo(-12, 6);
    expect(at("mirror axis=y both\n  rectangle u=0 v=5 w=4 h=2").min[1]).toBeCloseTo(-6, 6);
  });

  test("a flat shape only has a plane: z moves, x and y turns, and z stretches are refused, and why", () => {
    expect(run("transform z=5\n  rectangle").problem!.message).toMatch(/can only move in x and y/);
    expect(run("transform rx=45\n  rectangle").problem!.message).toMatch(/only be turned about z/);
    expect(run("transform sz=2\n  rectangle").problem!.message).toMatch(/no height to stretch/);
    expect(run("mirror axis=z\n  rectangle").problem!.message).toMatch(/mirrored across x or y/);
  });

  test("round takes the outside corners off a flat shape, and fillet fills the inside ones", () => {
    const sq = area("round radius=3\n  rectangle w=20 h=20");
    expect(sq).toBeLessThan(400);
    expect(sq).toBeGreaterThan(400 - 4 * (9 - Math.PI * 9 / 4) - 1); // each corner loses r squared less a quarter circle
    const L = "union\n  rectangle w=30 h=10\n  rectangle u=-10 v=15 w=10 h=20";
    expect(area(`fillet radius=2\n  ${L.replaceAll("\n", "\n  ")}`)).toBeGreaterThan(area(L)); // the inner corner is filled
    expect(run("round radius=50\n  rectangle w=20 h=20").problem!.message).toMatch(/too big for this shape/);
  });

  test("the eye works on a flat shape, and the blocks that only work on solids say so", () => {
    expect(run("rectangle hidden").shapes).toEqual([]);
    for (const text of ["shell\n  rectangle", "chamfer\n  rectangle", "measure\n  rectangle"]) {
      expect(run(text).problem!.message, text).toMatch(/works on 3D shapes: extrude the flat shape first/);
    }
  });
});

describe("what takes flat shapes", () => {
  test("extrude takes any flat shape made by the blocks, on any plane", () => {
    const r = run("extrude plane=XZ offset=4 height=3\n  union\n    rectangle w=10 h=10\n    circle u=5 v=5 r=3");
    expect(r.problem).toBeUndefined();
    const b = r.combined!.bounds();
    expect(b.min[1]).toBeCloseTo(-7, 3); // on XZ the normal is -y: from y = -4 to -7
    expect(b.max[1]).toBeCloseTo(-4, 3);
  });

  test("twist and taper turn about the middle of what is drawn", () => {
    const text = "extrude height=30 taper=0.5\n  rectangle u=10 v=10 w=20 h=20";
    expect(bounds(text)).toEqual(expect.arrayContaining([expect.any(Number)]));
    close(bounds(text), [0, 0, 0, 20, 20, 30]);
  });

  test("a revolve takes a profile made by subtracting, and says if it crosses the axis", () => {
    const ring = vol("revolve\n  subtract\n    rectangle u=5 v=5 w=6 h=10\n    rectangle u=5 v=5 w=2 h=4");
    expect(ring).toBeGreaterThan(0);
    expect(run("revolve\n  rectangle u=0 v=0 w=4 h=4").problem!.message).toMatch(/u >= 0 side of the axis/);
  });

  test("loft and sweep take a flat shape made by a block (a moved, subtracted or joined one)", () => {
    const loft = run("loft height=10\n  bottom\n    union\n      rectangle w=10 h=10\n      circle u=6 v=0 r=3\n  top\n    transform x=1\n      circle r=4");
    expect(loft.problem).toBeUndefined();
    const sweep = run("sweep\n  subtract\n    circle r=4\n    circle r=2\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=10");
    expect(sweep.problem!.message).toMatch(/cannot have holes/); // a pipe is made with two sweeps and a subtract
    const bar = run("sweep\n  transform x=2\n    rectangle w=2 h=2\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=10");
    expect(bar.combined!.volume()).toBeCloseTo(40, 3);
  });

  test("a solid inside an extrude is refused, saying what is wanted", () => {
    // the editor and the file check do not let a box go straight into an extrude; one inside a repeat (or a part) is caught when it runs
    expect(() => run("extrude\n  box")).toThrow(/a box block cannot go inside a extrude block/);
    expect(run("extrude\n  repeat times=2\n    box").problem!.message).toMatch(/needs flat shapes .* but it holds a 3D shape/);
    expect(run("revolve\n  repeat times=1\n    sphere").problem!.message).toMatch(/needs flat shapes/);
  });

  test("an extrude of nothing but holes needs a shape to cut", () => {
    expect(run("extrude\n  circle hole").problem!.message).toMatch(/at least one shape that is not a hole/);
  });

  test("text is a flat shape too: engraving is a subtract, before or after the extrude", () => {
    const before = vol("extrude height=3\n  subtract\n    rectangle w=40 h=20\n    text text=HI size=10");
    const after = vol("extrude height=3\n  rectangle w=40 h=20\n  text text=HI size=10 hole");
    expect(before).toBeCloseTo(after, 2);
    expect(before).toBeLessThan(40 * 20 * 3);
  });
});

describe("the flat examples", async () => {
  const { DEMOS } = await import("../src/cadfly/language/demos");
  const solid = (name: string) => {
    const r = runProgram(k, DEMOS.find((e) => e.name === name)!.program);
    expect(r.problem, name).toBeUndefined();
    return r.combined!;
  };
  test("the washer: a ring 2 thick", () => {
    const v = solid("Washer").volume();
    expect(v).toBeCloseTo((disc(10) - disc(4)) * 2, 2);
    expect(solid("Washer").bounds().max[2]).toBeCloseTo(2, 3);
  });
  test("the flat plate: the joined outline less two holes, with rounded corners, 4 thick", () => {
    const plate = solid("Flat plate");
    const b = plate.bounds();
    expect(b.max[2]).toBeCloseTo(4, 3);
    expect(b.max[0]).toBeCloseTo(45, 1); // the circle at x = 30, radius 15, reaches 45
    expect(b.min[0]).toBeCloseTo(-30, 1);
    // less than the plain union, which is a 60 x 30 rectangle and a circle sticking out of one end (half of it outside)
    expect(plate.volume() / 4).toBeLessThan(1800 + disc(15) / 2);
    expect(plate.volume() / 4).toBeGreaterThan(1800 - 100);
  });
});

describe("the eye on an extrude or revolve shows its sketch instead of the 3D shape", () => {
  const withEye = (text: string) => {
    const program = applyOps([], [{ op: "append", blocks: text }]).program;
    program[0].hidden = true;
    return program;
  };

  test("a hidden extrude is its sketch: a thin slab on the plane, not part of the export", () => {
    const r = runProgram(k, withEye("extrude height=20\n  rectangle w=40 h=30\n  circle r=5 hole"));
    expect(r.problem).toBeUndefined();
    expect(r.combined).toBeNull(); // nothing to export: the extrusion is hidden
    expect(r.shapes).toHaveLength(1);
    expect(r.shapes[0].preview).toBe(true);
    const b = r.shapes[0].solid.bounds();
    expect(b.max[0] - b.min[0]).toBeCloseTo(40, 3);
    expect(b.max[2] - b.min[2]).toBeLessThan(1); // thin, lying on the plane
    expect(r.shapes[0].solid.volume()).toBeCloseTo((1200 - disc(5)) * 0.3, 2); // the hole is in the sketch too
  });

  test("it is drawn on the plane the extrude is on, at its offset", () => {
    const r = runProgram(k, withEye("extrude plane=XZ offset=7 height=20\n  rectangle w=10 h=10"));
    const b = r.shapes[0].solid.bounds();
    expect(b.max[1] - b.min[1]).toBeLessThan(1); // thin in y, the normal of XZ
    expect(Math.abs((b.min[1] + b.max[1]) / 2)).toBeCloseTo(7.15, 1); // XZ's normal is -y: at y = -7 (and the slab goes a little further)
  });

  test("a revolve shows its profile", () => {
    const r = runProgram(k, withEye("revolve\n  rectangle u=5 v=5 w=4 h=10"));
    expect(r.combined).toBeNull();
    expect(r.shapes[0].preview).toBe(true);
    expect(r.shapes[0].solid.bounds().max[0]).toBeCloseTo(7, 3); // the profile, not the whole turned shape
  });

  test("a hidden cutter in a subtract shows its sketch, and the cut is left out of the result", () => {
    const program = applyOps([], [{ op: "append", blocks: "subtract\n  extrude height=10\n    rectangle w=40 h=40\n  extrude height=20\n    circle r=8" }]).program;
    const whole = runProgram(k, program).combined!.volume();
    program[0].inner![1].hidden = true;
    const r = runProgram(k, program);
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(16000, 0); // the plate, uncut
    expect(whole).toBeLessThan(16000);
    expect(r.shapes.filter((s) => s.preview)).toHaveLength(1); // the circle, to see where the cut will be
  });

  test("it moves with a transform around it, and goes with a hidden holder", () => {
    const text = "transform x=50 z=5\n  extrude height=10\n    rectangle w=10 h=10";
    const program = applyOps([], [{ op: "append", blocks: text }]).program;
    program[0].inner![0].hidden = true;
    const r = runProgram(k, program);
    const b = r.shapes.find((s) => s.preview)!.solid.bounds();
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(50, 3);
    expect(b.min[2]).toBeCloseTo(5, 3);
    program[0].hidden = true; // the holder hidden too: everything inside goes, the sketch with it
    expect(runProgram(k, program).shapes).toEqual([]);
  });

  test("a loft shows the two outlines it blends between; a sweep shows its profile where the path starts and where it ends", () => {
    const loft = applyOps([], [{ op: "append", blocks: "loft height=10\n  bottom\n    rectangle w=10 h=10\n  top\n    circle r=4" }]).program;
    loft[0].hidden = true;
    const l = runProgram(k, loft);
    expect(l.problem).toBeUndefined();
    expect(l.combined).toBeNull();
    const heights = l.shapes.map((s) => s.solid.bounds().min[2]).sort((a, b) => a - b);
    expect(heights).toHaveLength(2);
    expect(heights[0]).toBeCloseTo(0, 3);
    expect(heights[1]).toBeCloseTo(10, 3); // the second is a height up
    const sweep = applyOps([], [{ op: "append", blocks: "sweep\n  circle r=2\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=30\n  vertex x=20 y=0 z=50" }]).program;
    sweep[0].hidden = true;
    const s = runProgram(k, sweep);
    expect(s.problem).toBeUndefined();
    expect(s.combined).toBeNull();
    expect(s.shapes).toHaveLength(2);
    const [start, end] = s.shapes.map((x) => x.solid.bounds());
    expect(start.min[2]).toBeCloseTo(0, 1); // at the start of the path
    expect(end.max[0]).toBeGreaterThan(19); // at its end
    for (const x of s.shapes) expect(x.solid.volume()).toBeLessThan(10); // thin
  });

});
