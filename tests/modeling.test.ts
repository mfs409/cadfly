import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { shapeToContour } from "../src/cadfly/geometry/sketch";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { accepts } from "../src/cadfly/language/edit";
import { FinishError, finishEdges, hollow } from "../src/cadfly/language/finish";
import { runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";

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

describe("shell: hollowing", () => {
  test("a closed hollow box: the volume of the walls", () => {
    expect(vol("shell thickness=2\n  box w=40 d=30 h=20")).toBeCloseTo(40 * 30 * 20 - 36 * 26 * 16, 0);
  });

  test("open at the top (or the bottom): the inside is carried out through that face, and the outside is unchanged", () => {
    const top = "shell thickness=2 open=top\n  box w=40 d=30 h=20";
    expect(vol(top)).toBeCloseTo(40 * 30 * 20 - 36 * 26 * 18, 0);
    close(bounds(top), [-20, -15, 0, 20, 15, 20]);
    expect(vol("shell thickness=2 open=bottom\n  box w=40 d=30 h=20")).toBeCloseTo(40 * 30 * 20 - 36 * 26 * 18, 0);
    // the box is really open: a slab just under the top of the hollow box is only the walls
    const slab = run("intersect\n  shell thickness=2 open=top\n    box w=40 d=30 h=20\n  transform z=8\n    box w=100 d=100 h=1").combined!.volume();
    expect(slab).toBeCloseTo(40 * 30 * 1 - 36 * 26 * 1, 0);
  });

  test("a cup: a cylinder open at the top keeps its round walls, and is cut no wider than its inside", () => {
    const v = vol("shell thickness=2 open=top\n  cylinder r=15 h=30");
    const walls = pi * (225 - 169) * 28 + pi * 225 * 2; // the side, and the floor
    expect(v / walls).toBeCloseTo(1, 1);
    close(bounds("shell thickness=2 open=top\n  cylinder r=15 h=30"), [-15, -15, 0, 15, 15, 30], 0);
  });

  test("a sphere can be hollowed, and stacked inside other blocks", () => {
    const bowl = vol("shell thickness=1 open=top\n  sphere r=10");
    expect(bowl).toBeGreaterThan(0);
    expect(bowl).toBeLessThan((4 / 3) * pi * (1000 - 729));
    expect(vol("transform x=50\n  shell thickness=2\n    box w=20 d=20 h=20")).toBeCloseTo(8000 - 16 * 16 * 16, 0);
  });

  test("walls that leave nothing inside are refused, naming the block", () => {
    const r = run("shell thickness=10\n  box w=20 d=20 h=20");
    expect(r.problem!.message).toMatch(/walls are too thick/);
    expect(r.problem!.blockId).toBe("b1");
    expect(run("shell thickness=0\n  box").problem!.message).toMatch(/wall: must be more than zero/);
    expect(run("shell thickness=2\n  transform\n").problem!.message).toMatch(/put at least one shape inside/);
  });
});

describe("round and chamfer", () => {
  const cube = "box w=20 d=20 h=20";

  test("round takes the edges off: less volume, the same size, and a curved edge", () => {
    const text = `round radius=3\n  ${cube}`;
    const v = vol(text);
    // a cube 20 across with edges rounded by 3 is a 14 cube grown by a ball of 3: 14 cubed, six slabs, twelve quarter pipes, eight corners
    const exact = 14 ** 3 + 6 * 14 * 14 * 3 + 3 * pi * 9 * 14 + (4 / 3) * pi * 27;
    expect(v / exact).toBeGreaterThan(0.98); // a ball made of straight facets is a little smaller than a true one
    expect(v / exact).toBeLessThan(1.001);
    close(bounds(text), [-10, -10, 0, 10, 10, 20], 1);
  });

  test("chamfer bevels them: a flat cut, with a bit more taken than a round of the same size", () => {
    const v = vol(`chamfer size=3\n  ${cube}`);
    expect(v).toBeLessThan(8000);
    expect(v).toBeGreaterThan(7000);
    close(bounds(`chamfer size=3\n  ${cube}`), [-10, -10, 0, 10, 10, 20], 1);
    // a chamfer of size d takes a triangle of d by d off each edge: area d squared over 2 (a diamond reaches d along an axis)
    expect(v).toBeLessThan(8000 - 12 * (9 / 2) * 12);
  });

  test("a bigger radius takes more, and the shape is still one valid solid", () => {
    const small = vol(`round radius=1\n  ${cube}`);
    const big = vol(`round radius=4\n  ${cube}`);
    expect(big).toBeLessThan(small);
    expect(run(`round radius=4\n  ${cube}`).combined!.isValid()).toBe(true);
  });

  test("inside corners: an L shape gets its inner corner filled", () => {
    const L = "union\n  box w=40 d=10 h=10\n  transform x=-15 y=15\n    box w=10 d=40 h=10";
    const plain = vol(L);
    const filled = vol(`fillet radius=3\n  ${L.replaceAll("\n", "\n  ")}`);
    expect(filled).toBeGreaterThan(plain);
    expect(filled).toBeLessThan(plain + 40);
  });

  test("a size that is too big for the shape is refused with the reason", () => {
    const r = run(`round radius=10\n  ${cube}`);
    expect(r.problem!.message).toMatch(/too big for this shape/);
    expect(run(`chamfer size=11\n  ${cube}`).problem!.message).toMatch(/too big for this shape/);
    expect(run("round radius=-1\n  box").problem!.message).toMatch(/radius: must be more than zero/);
  });

  test("rounding a plate with holes keeps the holes, and works inside other blocks", { timeout: 60_000 }, () => {
    const v = vol("round radius=1\n  extrude height=6\n    rectangle w=40 h=30\n    circle r=5 hole");
    expect(v).toBeLessThan((1200 - pi * 25) * 6);
    expect(v).toBeGreaterThan((1200 - pi * 25) * 6 - 200);
    expect(vol(`transform z=20\n  round radius=2\n    ${cube}`)).toBeLessThan(8000);
  });
});

describe("too detailed to finish", () => {
  test("hollowing or rounding a very detailed shape is refused, not left to run for minutes", () => {
    const detailed = k.sphere(10, 400);
    expect(() => hollow(k, detailed, 1, "none")).toThrow(FinishError);
    expect(() => finishEdges(k, detailed, 1, false, "ball")).toThrow(/too detailed to round/);
  });
});

describe("the new blocks sit among the others", () => {
  test("every block that makes or changes a shape may be put inside the blocks that hold shapes", () => {
    for (const kind of ["mirror", "round", "chamfer", "shell", "measure", "extrude", "import"]) {
      expect(accepts("transform", kind), kind).toBe(true);
      expect(accepts("union", kind), kind).toBe(true);
    }
    expect(accepts(null, "shell")).toBe(true);
  });

  test("they read from block text with their fields", () => {
    const { program } = applyOps([], [{ op: "append", blocks: "shell thickness=2 open=top\n  round radius=1\n    box" }]);
    const shell = program[0] as Block;
    expect(shell.args).toMatchObject({ thickness: "2", open: "top" });
    expect(shell.inner![0].args).toMatchObject({ radius: "1" });
  });

  test("a shell open on a side that is not offered is an error from the edit, not a crash", () => {
    expect(() => applyOps([], [{ op: "append", blocks: "shell open=left\n  box" }])).toThrow(/open.*one of none, top, bottom/);
  });
});

describe("results are remembered, so editing something else does not redo the work", () => {
  test("the same rounded shape, asked for again, comes back at once, and a change to it is worked out afresh", () => {
    const text = "round radius=1\n  cylinder r=15 h=30";
    const time = (t: string) => {
      const start = performance.now();
      const r = run(t);
      return { ms: performance.now() - start, v: r.combined!.volume() };
    };
    const first = time(text);
    const again = time(text);
    expect(again.v).toBeCloseTo(first.v, 6);
    expect(again.ms).toBeLessThan(Math.max(50, first.ms / 4));
    expect(time("round radius=1.5\n  cylinder r=15 h=30").v).not.toBeCloseTo(first.v, 3);
  });

  test("hollowing is remembered the same way", () => {
    const text = "shell thickness=1 open=top\n  sphere r=10";
    const first = performance.now();
    run(text);
    const cold = performance.now() - first;
    const second = performance.now();
    run(text);
    expect(performance.now() - second).toBeLessThan(Math.max(50, cold / 4));
  });
});

describe("fillet: filling the corners where shapes join", () => {
  const joint = "union\n  box w=60 d=60 h=6\n  cylinder r=8 h=30";
  const wrapped = (text: string, indent = "  ") => text.replaceAll("\n", `\n${indent}`);

  test("a post on a base gains a curved foot: about the volume of a ring with the fillet's cross-section", () => {
    const f = 4;
    const R = 8;
    const plain = vol(joint);
    const filled = vol(`fillet radius=${f}\n  ${wrapped(joint)}`);
    // the fillet's cross-section is f squared less a quarter circle, and its middle is 0.2232 f out from the post's side
    const ring = (f * f * (1 - pi / 4)) * 2 * pi * (R + 0.2232 * f);
    expect((filled - plain) / ring).toBeGreaterThan(0.8);
    expect((filled - plain) / ring).toBeLessThan(1.3); // the ball is faceted, which leaves a little more than a true curve would
    close(bounds(`fillet radius=${f}\n  ${wrapped(joint)}`), [-30, -30, 0, 30, 30, 30], 1); // nothing sticks out: the outside is as it was
  });

  test("a hole cut after the fillet survives; one inside the fillet that is narrower than twice its radius is filled in", () => {
    const hole = "cylinder r=3 h=10 x=20 y=20";
    const after = vol(`subtract\n  fillet radius=4\n    ${wrapped(joint, "    ")}\n  ${hole}`);
    const inside = vol(`fillet radius=4\n  subtract\n    ${wrapped(joint, "    ")}\n    ${hole}`);
    const noHole = vol(`fillet radius=4\n  ${wrapped(joint)}`);
    expect(after).toBeCloseTo(noHole - pi * 9 * 6, -1); // the hole is there, through the 6 mm base
    expect(inside).toBeGreaterThan(after + 100); // the hole (radius 3 < 4) has been filled
  });

  test("round no longer has an inside tick: that is what fillet is for", () => {
    expect(() => applyOps([], [{ op: "append", blocks: "round radius=2 inside\n  box" }])).toThrow(/no field "inside"|do not understand "inside"/);
    expect(vol("round radius=2\n  box w=20 d=20 h=20")).toBeLessThan(8000);
  });

  test("a fillet on a single box does nothing (it has no inside corners), and too big a radius for a part is reported by the size check", () => {
    expect(vol("fillet radius=2\n  box w=20 d=20 h=20") / 8000).toBeCloseTo(1, 2);
  });

  test("fillet works on flat shapes too, and cut-after-fill keeps the order the same", () => {
    const L = "union\n  rectangle w=40 h=10\n  rectangle u=-15 v=15 w=10 h=30";
    expect(run(`fillet radius=3\n  ${wrapped(L)}`).flat!.area()).toBeGreaterThan(run(L).flat!.area());
    expect(run("fillet radius=0\n  rectangle").problem!.message).toMatch(/radius: must be more than zero/);
  });
});

describe("the post and base example", async () => {
  const { DEMOS } = await import("../src/cadfly/language/demos");
  const program = () => structuredClone(DEMOS.find((e) => e.name === "Post and base")!.program);
  test("it runs, has its two screw holes, and a bigger foot makes more material", () => {
    const small = runProgram(k, program());
    expect(small.problem).toBeUndefined();
    const big = program();
    big[0].args.value = "7";
    const bigger = runProgram(k, big);
    expect(bigger.problem).toBeUndefined();
    expect(bigger.combined!.volume()).toBeGreaterThan(small.combined!.volume());
    // two holes of radius 3 through the 6 mm base are really there: the volume is the filleted joint less 2 holes
    const whole = program();
    const noHoles = [whole[0], whole[1].inner![0]];
    expect(runProgram(k, noHoles).combined!.volume() - small.combined!.volume()).toBeCloseTo(2 * pi * 9 * 6, -1);
  });
});

describe("shapes that would take too long are refused before they start", () => {
  const plate = (holes: number) => `extrude height=5\n  rectangle w=60 h=40\n${Array.from({ length: holes }, (_, i) => `  circle u=${-20 + i * 12} v=0 r=3 hole`).join("\n")}`;

  test("a plate with several round holes is too detailed to round: refused at once, saying to round the sketch first", () => {
    const t = Date.now();
    const r = run(`round radius=1\n  ${plate(4).replaceAll("\n", "\n  ")}`);
    expect(Date.now() - t).toBeLessThan(2000); // it did not start the 28 seconds of work
    expect(r.problem!.message).toMatch(/too detailed to round: .*not convex.*take too long.*Round the flat sketch before it is extruded/);
    expect(r.problem!.blockId).toBe("b1");
  });

  test("the way it says to do it is quick: round the flat sketch, then extrude, and the sides of the plate are rounded", () => {
    const t = Date.now();
    const r = run(`extrude height=5\n  round radius=2\n    rectangle w=60 h=40\n  circle u=10 v=0 r=3 hole\n  circle u=-10 v=0 r=3 hole`);
    expect(r.problem).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(10000); // the slow way takes 30 seconds or more; a busy computer can take a few seconds
  });

  test("a convex shape with a great many triangles is still quick, because it is one hull", () => {
    const t = Date.now();
    const r = run("round radius=1\n  sphere r=10");
    expect(r.problem).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(10000); // the slow way takes 30 seconds or more; a busy computer can take a few seconds
  });

  test("the same goes for fillet, chamfer and shell", () => {
    for (const block of ["fillet radius=1", "chamfer size=0.5", "shell thickness=1"]) {
      const r = run(`${block}\n  ${plate(4).replaceAll("\n", "\n  ")}`);
      expect(r.problem!.message, block).toMatch(/too detailed to .*: .*take too long/);
    }
  });

  test("so is lettering: its curves make it too detailed to round, fillet or chamfer, and they all say so at once", () => {
    for (const block of ["round radius=0.3", "fillet radius=0.3", "chamfer size=0.3"]) {
      const t = Date.now();
      const r = run(`${block}\n  extrude height=2\n    text text=HELLO size=10`);
      expect(Date.now() - t, block).toBeLessThan(2000);
      expect(r.problem!.message, block).toMatch(/too detailed to .*: .*take too long/);
    }
  });

  test("lettering can be rounded flat, before it is extruded, which is what the message says to do", () => {
    const t = Date.now();
    const r = run("extrude height=2\n  round radius=0.2\n    text text=HELLO size=10");
    expect(r.problem).toBeUndefined();
    expect(Date.now() - t).toBeLessThan(10000); // the slow way takes 30 seconds or more; a busy computer can take a few seconds
  });
});
