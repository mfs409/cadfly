import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { COMMANDS, blankBlock, commandById } from "../src/cadfly/language/commands";
import { newBlockFor } from "../src/cadfly/language/edit";
import { DEMOS } from "../src/cadfly/language/demos";
import { parseProgram, serializeProgram, validateProgram } from "../src/cadfly/language/format";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import type { Block, Program } from "../src/cadfly/language/types";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

let n = 0;
/** A block, with an id, in as few characters as possible */
const b = (kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({
  id: `b${++n}`,
  kind,
  args,
  ...(inner ? { inner } : {}),
});

const run = (...blocks: Block[]) => runProgram(k, blocks);
const bounds = (r: RunResult) => {
  const x = r.combined!.bounds();
  return [...x.min, ...x.max];
};
const close = (got: number[], want: number[], digits = 5) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
const vol = (r: RunResult) => r.combined!.volume();
const names = (r: RunResult) => r.shapes.map((s) => s.name);
const disc = (r: number) => 0.5 * 64 * r * r * Math.sin((2 * Math.PI) / 64); // the area of the 64-sided circle outline

describe("making shapes", () => {
  test("a box", () => {
    const r = run(b("box", { name: "plate", w: "40", d: "30", h: "5" }));
    expect(r.problem).toBeUndefined();
    expect(names(r)).toEqual(["plate"]);
    expect(vol(r)).toBeCloseTo(6000);
    close(bounds(r), [-20, -15, 0, 20, 15, 5]); // centred in x and y, and sitting on the ground
  });

  test("a cylinder, a cone (a cylinder with a smaller top) and a sphere", () => {
    const cyl = run(b("cylinder", { name: "c", r: "5", h: "10" }));
    expect(vol(cyl) / (Math.PI * 25 * 10)).toBeGreaterThan(0.99);
    const cone = run(b("cylinder", { name: "c", r: "6", top: "0", h: "9" }));
    expect(vol(cone) / ((Math.PI * 36 * 9) / 3)).toBeGreaterThan(0.99);
    const frustum = run(b("cylinder", { name: "c", r: "6", top: "3", h: "9" }));
    expect(vol(frustum) / ((Math.PI * 9 * (36 + 18 + 9)) / 3)).toBeGreaterThan(0.99);
    const ball = run(b("sphere", { name: "s", r: "5" }));
    expect(vol(ball) / ((4 / 3) * Math.PI * 125)).toBeGreaterThan(0.98);
  });

  test("a sketch extruded: a plate with a hole", () => {
    const r = run(
      b("extrude", { name: "plate", plane: "XY", offset: "0", height: "5" }, [
        b("rectangle", { u: "0", v: "0", w: "40", h: "40" }),
        b("circle", { u: "0", v: "0", r: "5", hole: true }),
      ]),
    );
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo((1600 - disc(5)) * 5, 3);
    close(bounds(r), [-20, -20, 0, 20, 20, 5]); // a sketch piece is centred where u,v say
  });

  test("a polygon with a rotation, and a revolve", () => {
    const tri = run(
      b("extrude", { name: "t", plane: "XY", offset: "0", height: "2" }, [
        b("polygon", { rotate: "90" }, [b("point", { u: "0", v: "0" }), b("point", { u: "4", v: "0" }), b("point", { u: "0", v: "3" })]),
      ]),
    );
    expect(vol(tri)).toBeCloseTo(12);
    const ring = run(b("revolve", { name: "r", plane: "XZ", offset: "0", angle: "360" }, [b("rectangle", { u: "3.5", v: "5", w: "3", h: "10" })]));
    expect(vol(ring) / (Math.PI * 21 * 10)).toBeCloseTo(1, 1);
    const half = run(b("revolve", { name: "r", plane: "XZ", offset: "0", angle: "180" }, [b("rectangle", { u: "3.5", v: "5", w: "3", h: "10" })]));
    expect(vol(half) / (0.5 * Math.PI * 21 * 10)).toBeCloseTo(1, 1);
  });
});

describe("variables and arithmetic", () => {
  test("a number field can use variables", () => {
    const r = run(b("set", { name: "w", value: "40" }), b("box", { name: "p", w: "w", d: "w", h: "w / 8" }));
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo(40 * 40 * 5);
  });

  test("changing one variable changes the whole design", () => {
    const design = (w: string) =>
      run(
        b("set", { name: "w", value: w }),
        b("extrude", { name: "plate", plane: "XY", offset: "0", height: "5" }, [
          b("rectangle", { u: "0", v: "0", w: "w", h: "w" }),
          b("circle", { u: "0", v: "0", r: "w / 8", hole: true }),
        ]),
      );
    close(bounds(design("40")), [-20, -20, 0, 20, 20, 5]);
    close(bounds(design("60")), [-30, -30, 0, 30, 30, 5]);
    expect(vol(design("40"))).toBeCloseTo((1600 - disc(5)) * 5, 3);
    expect(vol(design("80"))).toBeCloseTo((6400 - disc(10)) * 5, 3);
  });

  test("a variable can be set again, using its old value", () => {
    const r = run(b("set", { name: "x", value: "2" }), b("set", { name: "x", value: "x * 5" }), b("box", { name: "b", w: "x", d: "1", h: "1" }));
    expect(vol(r)).toBeCloseTo(10);
  });
});

describe("placing shapes: holders that act on the shapes inside", () => {
  const cube = (s = "10", name = "c") => b("box", { name, w: s, d: s, h: s });

  test("move, rotate and scale", () => {
    close(bounds(run(b("transform", { x: "10", y: "0", z: "5" }, [cube()]))), [5, -5, 5, 15, 5, 15]);
    const long = () => b("box", { name: "bar", w: "10", d: "2", h: "2" });
    close(bounds(run(b("transform", { rz: "90" }, [long()]))), [-1, -5, 0, 1, 5, 2]);
    close(bounds(run(b("transform", { sx: "2", sy: "1", sz: "1" }, [long()]))), [-10, -1, 0, 10, 1, 2]);
  });

  test("rotate and scale act about the origin, not the shape's own middle", () => {
    // a cube centred at x = 20, turned 90 degrees about z, swings round to y = 20
    const r = run(b("transform", { rz: "90" }, [b("transform", { x: "20" }, [cube()])]));
    close(bounds(r), [-5, 15, 0, 5, 25, 10]);
    // scaled from the origin, it moves out as well as growing
    close(bounds(run(b("transform", { sx: "2", sy: "2", sz: "2" }, [b("transform", { x: "20" }, [cube()])]))), [30, -10, 0, 50, 10, 20]);
  });

  test("holders nest, working from the inside out", () => {
    // first up, then turned about the origin: the result is where "turn it" leaves it
    const r = run(b("transform", { rx: "90" }, [b("transform", { z: "20" }, [cube()])]));
    close(bounds(r), [-5, -30, -5, 5, -20, 5]);
    const other = run(b("transform", { z: "20" }, [b("transform", { rx: "90" }, [cube()])]));
    close(bounds(other), [-5, -10, 15, 5, 0, 25]);
  });

  test("the shapes inside a holder are merged", () => {
    const r = run(b("transform", { x: "100" }, [cube("10", "a"), b("transform", { x: "10" }, [cube("10", "b")])]));
    close(bounds(r), [95, -5, 0, 115, 5, 10]);
    expect(vol(r)).toBeCloseTo(2000);
  });

  test("line up and place against: the first shape is the base and stays put", () => {
    const far = () => b("transform", { x: "30", y: "30", z: "30" }, [cube("2", "small")]);
    const lined = run(b("lineUp", { axis: "x", at: "center" }, [cube("10", "base"), far()]));
    close(bounds(lined), [-5, -5, 0, 5, 31, 32]); // the small one is now centred on x = 0, still at y and z = 30
    const onTop = run(b("placeAgainst", { axis: "z", side: "high" }, [cube("10", "base"), cube("2", "small")]));
    close(bounds(onTop), [-5, -5, 0, 5, 5, 12]); // the small cube sits on the base: z from 10 to 12
    const under = run(b("placeAgainst", { axis: "z", side: "low" }, [cube("10", "base"), cube("2", "small")]));
    close(bounds(under), [-5, -5, -2, 5, 5, 10]);
  });

  test("line up, place against, subtract and intersect need a base and something else", () => {
    for (const kind of ["lineUp", "placeAgainst", "subtract"]) {
      expect(run(b(kind, {}, [cube()])).problem!.message).toMatch(/at least two shapes inside: the first is the base/);
    }
    expect(run(b("intersect", {}, [cube()])).problem!.message).toMatch(/at least two shapes/);
    expect(run(b("transform", {}, [])).problem!.message).toBe("put at least one shape inside this block");
  });
});

describe("combining shapes", () => {
  const cube = (s = "10", name = "c") => b("box", { name, w: s, d: s, h: s });

  test("subtract cuts every later shape out of the first", () => {
    const r = run(b("subtract", { name: "bracket" }, [cube(), b("cylinder", { name: "hole", r: "2", h: "30" })]));
    expect(r.problem).toBeUndefined();
    expect(names(r)).toEqual(["bracket"]);
    expect(vol(r) / (1000 - Math.PI * 4 * 10)).toBeCloseTo(1, 1);
    const two = run(b("subtract", {}, [cube("20", "big"), cube("4", "a"), b("transform", { x: "8" }, [cube("4", "b")])]));
    expect(vol(two)).toBeCloseTo(8000 - 64 - 64);
  });

  test("union and intersect", () => {
    const shifted = () => b("transform", { x: "5" }, [cube("10", "b")]);
    expect(vol(run(b("union", { name: "ab" }, [cube("10", "a"), shifted()])))).toBeCloseTo(1500);
    expect(vol(run(b("intersect", { name: "both" }, [cube("10", "a"), shifted()])))).toBeCloseTo(500);
  });

  test("a combined shape can be placed like any other", () => {
    const r = run(b("transform", { x: "100" }, [b("union", { name: "ab" }, [cube("10", "a"), b("transform", { x: "10" }, [cube("10", "b")])])]));
    expect(bounds(r)[0]).toBeCloseTo(95);
  });

  test("the eye on a shape builds it but leaves it out of the result", () => {
    const r = run(cube("10", "a"), { ...cube("20", "b"), hidden: true });
    expect(vol(r)).toBeCloseTo(1000);
    expect(names(r)).toEqual(["a"]);
    // what is hidden still has to work
    const broken = { ...b("box", { name: "bad", w: "0" }), hidden: true };
    expect(run(broken).problem!.blockId).toBe(broken.id);
    // inside another holder, it is left out of the merge
    expect(vol(run(b("union", {}, [cube("10", "a"), { ...cube("30", "b"), hidden: true }])))).toBeCloseTo(1000);
    // a holder whose shapes are all hidden has nothing to make, which is not a mistake
    expect(run(b("union", {}, [{ ...cube("30", "b"), hidden: true }])).problem).toBeUndefined();
    expect(run(b("extrude", {}, [{ ...b("rectangle"), hidden: true }])).shapes).toEqual([]);
  });

  test("the power switch on a block that changes what is inside it turns the change off: the shapes inside still show; the eye hides the lot", () => {
    const moved = (extra: Partial<Block>) => run({ ...b("transform", { x: "50" }, [cube("10", "a")]), ...extra });
    close(bounds(moved({})), [45, -5, 0, 55, 5, 10]);
    close(bounds(moved({ disabled: true })), [-5, -5, 0, 5, 5, 10]); // not moved, and not gone
    expect(moved({ hidden: true }).shapes).toEqual([]); // the eye hides the block and what is in it
    const filleted = (hidden: boolean) => vol(run({ ...b("fillet", { radius: "3" }, [b("union", {}, [cube("10", "a"), b("cylinder", { name: "p", r: "3", h: "20" })])]), ...(hidden ? { disabled: true } : {}) }));
    expect(filleted(false)).toBeGreaterThan(filleted(true));
    // the same for every block that changes what is inside it
    for (const kind of ["transform", "mirror", "round", "chamfer", "shell", "lineUp", "placeAgainst"]) {
      expect(commandById(kind)!.modifier, kind).toBe(true);
    }
    for (const kind of ["union", "subtract", "intersect", "extrude", "repeat", "box", "measure"]) expect(commandById(kind)!.modifier, kind).toBeFalsy();
    // and it does not matter that what it changes would fail: it is off
    expect(run({ ...b("shell", { thickness: "50" }, [cube("10", "a")]), disabled: true }).problem).toBeUndefined();
  });

  test("hiding a cutter, or the base, of a subtract carries on with what is left", () => {
    const cut = (base?: boolean, cutter?: boolean) =>
      run(b("subtract", {}, [{ ...cube("20", "base"), ...(base ? { hidden: true } : {}) }, { ...b("cylinder", { name: "pin", r: "3", h: "30" }), ...(cutter ? { hidden: true } : {}) }]));
    expect(vol(cut())).toBeLessThan(8000);
    expect(vol(cut(false, true))).toBeCloseTo(8000); // the cutter off: the whole base
    expect(cut(true, false).shapes).toEqual([]); // the base off: nothing to cut
    expect(cut(true, false).problem).toBeUndefined();
  });

  test("disabled is only for blocks that change what is inside them", () => {
    expect(() => validateProgram([{ id: "a", kind: "box", args: {}, disabled: true }])).toThrow(/does not change what is inside it, so it cannot be disabled/);
    expect(() => validateProgram([{ id: "a", kind: "transform", args: {}, inner: [], disabled: "yes" }])).toThrow(/disabled must be true or false/);
    expect(() => validateProgram([{ id: "a", kind: "transform", args: {}, inner: [], disabled: true }])).not.toThrow();
  });

  test("hidden is only for blocks that make a shape", () => {
    expect(() => validateProgram([{ id: "a", kind: "set", args: {}, hidden: true }])).toThrow(/makes no shape of its own, so it cannot be hidden/);
    expect(() => validateProgram([{ id: "a", kind: "box", args: {}, hidden: "yes" }])).toThrow(/hidden must be true or false/);
  });

  test("a shape's label is its own name, or the name of the one shape inside it", () => {
    expect(names(run(b("transform", {}, [cube("10", "leg")])))).toEqual(["leg"]);
    expect(names(run(b("transform", {}, [cube("10", "a"), cube("10", "b")])))).toEqual(["transform"]);
  });

  test("names are only labels: two shapes may share one", () => {
    const r = run(cube("10", "x"), cube("10", "x"));
    expect(r.problem).toBeUndefined();
    expect(names(r)).toEqual(["x", "x"]);
  });
});

describe("variables are scoped to the block that holds them", () => {
  test("a set inside a holder does not leak out", () => {
    const r = run(
      b("set", { name: "s", value: "5" }),
      b("union", {}, [b("set", { name: "s", value: "50" }), b("box", { name: "in", w: "s", d: "s", h: "s" })]),
      b("box", { name: "out", w: "s", d: "s", h: "s" }),
    );
    expect(r.problem).toBeUndefined();
    expect(r.shapes.map((x) => x.solid.bounds().max[0] * 2)).toEqual([50, 5]);
  });

  test("what was set above is visible inside", () => {
    const r = run(b("set", { name: "s", value: "6" }), b("transform", { x: "s" }, [b("box", { name: "c", w: "s", d: "s", h: "s", z: "0 - s / 2" })]));
    close(bounds(r), [3, -3, -3, 9, 3, 3]);
  });

  test("a variable not set yet is reported where it is used", () => {
    const bad = b("box", { name: "c", w: "later", d: "1", h: "1" });
    const r = run(b("transform", {}, [bad]), b("set", { name: "later", value: "3" }));
    expect(r.problem).toEqual({ blockId: bad.id, message: 'width: unknown variable "later"' });
  });
});

describe("repeat", () => {
  const post = () => b("box", { name: "post", w: "2", d: "2", h: "2", z: "-1" }); // centred in z too, so the bounds are easy to read

  test("builds what is inside once for each pass, counting from 0, and merges the results", () => {
    const r = run(b("repeat", { times: "4", counter: "i" }, [b("transform", { x: "i * 10" }, [post()])]));
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(1);
    close(bounds(r), [-1, -1, -1, 31, 1, 1]); // posts at x = 0, 10, 20, 30
    expect(vol(r)).toBeCloseTo(4 * 8);
  });

  test("the counter works in any field, and is gone after the loop", () => {
    const r = run(
      b("set", { name: "i", value: "100" }),
      b("repeat", { times: "3", counter: "i" }, [b("box", { name: "step", w: "2 + i", d: "2", h: "2" })]),
      b("box", { name: "after", w: "i", d: "1", h: "1" }),
    );
    expect(r.problem).toBeUndefined();
    expect(r.shapes[1].solid.bounds().max[0] * 2).toBeCloseTo(100); // i is 100 again, as before the loop
  });

  test("loops nest, each with its own counter", () => {
    const r = run(
      b("repeat", { times: "3", counter: "row" }, [b("repeat", { times: "4", counter: "col" }, [b("transform", { x: "col * 10", y: "row * 10" }, [post()])])]),
    );
    expect(r.problem).toBeUndefined();
    close(bounds(r), [-1, -1, -1, 31, 21, 1]);
    expect(vol(r)).toBeCloseTo(12 * 8);
  });

  test("inside a sketch it repeats pieces, so a row of holes is one block", () => {
    const plate = (n: string) =>
      run(
        b("extrude", { name: "plate", height: "5" }, [
          b("rectangle", { u: "0", v: "0", w: "100", h: "30" }),
          b("repeat", { times: n, counter: "i" }, [b("circle", { u: "-35 + i * 15", v: "0", r: "3", hole: true })]),
        ]),
      );
    const r = plate("5");
    expect(r.problem).toBeUndefined();
    expect(vol(r) / (100 * 30 * 5 - 5 * Math.PI * 9 * 5)).toBeCloseTo(1, 2);
    expect(vol(plate("2")) / (100 * 30 * 5 - 2 * Math.PI * 9 * 5)).toBeCloseTo(1, 2);
    // loops nest in a sketch too, and the counter reaches every field of the piece
    const grid = run(b("extrude", { height: "2" }, [b("rectangle", { w: "40", h: "40" }), b("repeat", { times: "3", counter: "r" }, [b("repeat", { times: "3", counter: "c" }, [b("circle", { u: "-12 + c * 12", v: "-12 + r * 12", r: "2", hole: true })])])]));
    expect(vol(grid) / (40 * 40 * 2 - 9 * Math.PI * 4 * 2)).toBeCloseTo(1, 2);
  });

  test("an extrude that repeats nothing is empty, and a solid in its repeat is refused", () => {
    expect(run(b("extrude", {}, [b("repeat", { times: "0" }, [b("circle")])])).problem!.message).toMatch(/put a rectangle, circle or polygon inside/);
    const e = b("extrude", {}, [b("rectangle"), b("repeat", { times: "2" }, [b("box")])]);
    const r = run(e);
    expect(r.problem!.blockId).toBe(e.id);
    expect(r.problem!.message).toMatch(/both flat shapes .* and 3D shapes/);
    expect(run(b("extrude", {}, [b("box")])).problem!.message).toMatch(/needs flat shapes .* but it holds a 3D shape/);
  });

  test("flat shapes can be repeated at the top: each pass makes a flat shape, and they are joined", () => {
    const r = run(b("repeat", { times: "3", counter: "i" }, [b("transform", { x: "i * 10" }, [b("circle", { r: "2" })])]));
    expect(r.problem).toBeUndefined();
    expect(r.shapes.filter((s) => !s.piece)).toHaveLength(1); // and each pass has an outline of its own
    expect(r.shapes.filter((s) => s.piece)).toHaveLength(3);
    expect(r.flat!.area()).toBeCloseTo(3 * disc(2), 3);
    expect(r.combined).toBeNull(); // a flat shape is not a solid: nothing to export
  });

  test("trig places things round a circle", () => {
    const r = run(b("repeat", { times: "4", counter: "i" }, [b("transform", { x: "10 * cos(i * 90)", y: "10 * sin(i * 90)" }, [post()])]));
    close(bounds(r), [-11, -11, -1, 11, 11, 1]);
  });

  test("zero passes make nothing, and a loop of only set blocks makes nothing", () => {
    expect(run(b("repeat", { times: "0" }, [post()])).shapes).toEqual([]);
    expect(run(b("repeat", { times: "2" }, [b("set", { name: "q", value: "1" })])).shapes).toEqual([]);
  });

  test("how many times must be a whole number that is not too big", () => {
    expect(run(b("repeat", { times: "2.5" }, [post()])).problem!.message).toMatch(/times: must be a whole number/);
    expect(run(b("repeat", { times: "0 - 1" }, [post()])).problem!.message).toMatch(/times: must be a whole number/);
    expect(run(b("repeat", { times: "5000" }, [post()])).problem!.message).toMatch(/at most 1000 passes/);
    expect(run(b("repeat", { times: "3", counter: "2x" }, [post()])).problem!.message).toMatch(/variable name/);
  });

  test("a loop that would do too much is stopped, and says where", () => {
    const inner = b("repeat", { times: "100", counter: "j" }, [post()]);
    const outer = b("repeat", { times: "100", counter: "i" }, [inner]);
    const r = run(outer);
    expect(r.problem!.message).toMatch(/built more than 5000 blocks/);
    expect([outer.id, inner.id, inner.inner![0].id]).toContain(r.problem!.blockId);
  });

  test("a problem inside a pass is pointed at", () => {
    const bad = b("box", { name: "b", w: "10 / (2 - i)" });
    const r = run(b("repeat", { times: "4", counter: "i" }, [bad]));
    expect(r.problem).toEqual({ blockId: bad.id, message: "width: division by zero" });
  });
});

describe("if and else", () => {
  const cube = (name = "c", w = "10") => b("box", { name, w, d: "10", h: "10" });
  const either = (cond: string, then: Block[], other: Block[]) => run(b("if", { condition: cond }, [...then, b("else", {}, other)]));

  test("an if builds what is inside only when its condition is true", () => {
    expect(names(run(b("if", { condition: "1 < 2" }, [cube("yes")])))).toEqual(["yes"]);
    expect(run(b("if", { condition: "2 < 1" }, [cube("no")])).shapes).toEqual([]);
    expect(run(b("if", { condition: "false" }, [cube()])).shapes).toEqual([]);
    expect(run(b("if", { condition: "5" }, [cube("five")])).problem!.message).toMatch(/must be a yes\/no/); // a number is not a condition
  });

  test("the else inside it holds what is built when the condition is false, and only that", () => {
    expect(either("true", [cube("a")], [cube("b", "20")]).combined!.volume()).toBeCloseTo(1000); // the 10 wide cube
    expect(either("false", [cube("a")], [cube("b", "20")]).combined!.volume()).toBeCloseTo(2000); // the 20 wide one
    expect(either("false", [cube("a")], []).shapes).toEqual([]); // an empty else builds nothing
    // the blocks of the if next to the else are what is built when it is true, however many there are
    expect(either("true", [cube("a"), cube("c", "20")], [cube("b")]).combined!.volume()).toBeCloseTo(2000); // both are built, and joined (the 20 wide one holds the 10 wide)
    expect(either("false", [cube("a"), cube("c", "20")], [cube("b")]).combined!.volume()).toBeCloseTo(1000);
  });

  test("the branch that is not taken is never built, so it may be wrong without harm", () => {
    const wrong = b("box", { name: "bad", w: "1 / 0" });
    expect(either("false", [wrong], [cube("fine")]).problem).toBeUndefined();
    expect(either("true", [cube("fine")], [wrong]).problem).toBeUndefined();
    // the branch that is taken is pointed at as usual
    expect(run(b("if", { condition: "true" }, [wrong])).problem!.blockId).toBe(wrong.id);
    expect(either("false", [cube()], [wrong]).problem!.blockId).toBe(wrong.id);
  });

  test("an if has at most one else, and an else is only for an if", () => {
    const second = b("else", {}, [cube()]);
    expect(run(b("if", { condition: "true" }, [cube(), b("else", {}, [cube()]), second])).problem).toEqual({ blockId: second.id, message: "an if can have only one else" });
    expect(() => validateProgram([b("else", {}, [cube()])])).toThrow(/belongs inside another block/);
    expect(() => validateProgram([b("transform", {}, [b("else", {}, [])])])).toThrow(/else block cannot go inside a transform block/);
  });

  test("a new if starts with an empty else", () => {
    const made = newBlockFor([], "if");
    expect(made.inner!.map((x) => x.kind)).toEqual(["else"]);
    expect(runProgram(k, [made]).problem).toBeUndefined();
  });

  test("an if inside a loop picks for each pass: every other one", () => {
    const r = run(
      b("repeat", { times: "6", counter: "i" }, [
        b("if", { condition: "i % 2 == 0" }, [
          b("transform", { x: "i * 10" }, [b("box", { name: "tall", w: "4", d: "4", h: "20", z: "-10" })]),
          b("else", {}, [b("transform", { x: "i * 10" }, [b("box", { name: "short", w: "4", d: "4", h: "6", z: "-3" })])]),
        ]),
      ]),
    );
    expect(r.problem).toBeUndefined();
    // posts at x = 0, 10, ... 50: even ones 20 tall, odd ones 6 tall (every box is centred, so it spans -h/2 to h/2)
    close(bounds(r), [-2, -2, -10, 52, 2, 10]);
    expect(vol(r)).toBeCloseTo(3 * 16 * 20 + 3 * 16 * 6);
  });

  test("a condition can use variables and comparisons, and is checked like any field", () => {
    expect(names(run(b("set", { name: "w", value: "30" }), b("if", { condition: "w > 20 and w < 40" }, [cube("mid")])))).toEqual(["mid"]);
    const bad = b("if", { condition: "w >" }, [cube()]);
    expect(run(bad).problem!.blockId).toBe(bad.id);
  });

  test("an empty if makes nothing, and is not an error", () => {
    expect(run(b("if", { condition: "true" }, [])).problem).toBeUndefined();
    expect(run(b("if", { condition: "true" }, [b("set", { name: "q", value: "1" })])).shapes).toEqual([]);
  });

  test("a variable named like an operator word is refused", () => {
    expect(run(b("set", { name: "and", value: "1" })).problem!.message).toMatch(/built in to expressions/);
  });
});

describe("parts: define and use", () => {
  const leg = (inner?: Block[]) => b("define", { name: "leg", inputs: "w, h" }, inner ?? [b("box", { name: "leg", w: "w", d: "w", h: "h" })]);

  test("a part is made once and used as often as you like, with different values", () => {
    const r = run(leg(), b("transform", { x: "0" }, [b("use", { name: "leg", values: "4, 20" })]), b("transform", { x: "30" }, [b("use", { name: "leg", values: "6, 10" })]));
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(2);
    expect(r.shapes[0].solid.volume()).toBeCloseTo(4 * 4 * 20);
    expect(r.shapes[1].solid.volume()).toBeCloseTo(6 * 6 * 10);
    expect(names(r)).toEqual(["transform", "transform"].map(() => "leg")); // a move around a use is called what the part is called
  });

  test("a define makes nothing by itself", () => {
    const r = run(leg());
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toEqual([]);
  });

  test("values are expressions, in the variables of the place that uses the part", () => {
    const r = run(leg(), b("set", { name: "size", value: "5" }), b("use", { name: "leg", values: "size * 2, size + 1" }));
    expect(vol(r)).toBeCloseTo(10 * 10 * 6);
    expect(vol(run(leg(), b("use", { name: "leg", values: "max(1, 3), 2" })))).toBeCloseTo(3 * 3 * 2); // a comma inside brackets does not split
  });

  test("a part can use variables set above where it is used, and its inputs win over them", () => {
    const part = b("define", { name: "post", inputs: "h" }, [b("box", { name: "p", w: "width", d: "width", h: "h" })]);
    const r = run(part, b("set", { name: "width", value: "4" }), b("set", { name: "h", value: "999" }), b("use", { name: "post", values: "10" }));
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo(4 * 4 * 10); // width from outside, h from the input, not the 999
  });

  test("what a part sets stays inside it, and what is set outside is untouched", () => {
    const part = b("define", { name: "p", inputs: "" }, [b("set", { name: "inside", value: "3" }), b("box", { name: "b", w: "inside", d: "1", h: "1" })]);
    const r = run(b("set", { name: "inside", value: "50" }), part, b("use", { name: "p", values: "" }), b("box", { name: "after", w: "inside", d: "1", h: "1" }));
    expect(r.shapes.map((x) => x.solid.bounds().max[0] * 2)).toEqual([3, 50]);
  });

  test("a part may hold several shapes, which are merged, and use other parts", () => {
    const post = b("define", { name: "post", inputs: "h" }, [b("box", { name: "b", w: "2", d: "2", h: "h" })]);
    const pair = b("define", { name: "pair", inputs: "h" }, [b("transform", { x: "-10" }, [b("use", { name: "post", values: "h" })]), b("transform", { x: "10" }, [b("use", { name: "post", values: "h * 2" })])]);
    const r = run(post, pair, b("use", { name: "pair", values: "5" }));
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(1);
    expect(vol(r)).toBeCloseTo(4 * 5 + 4 * 10);
  });

  test("a part is in scope below its define, and inside the blocks there, but not outside the holder it was defined in", () => {
    const inside = b("union", {}, [leg(), b("use", { name: "leg", values: "2, 2" })]);
    expect(run(inside).problem).toBeUndefined();
    const outside = b("use", { name: "leg", values: "2, 2" });
    expect(run(b("union", {}, [leg(), b("box")]), outside).problem).toEqual({ blockId: outside.id, message: 'name: there is no part called "leg" (define it above this block)' });
    const early = b("use", { name: "leg", values: "2, 2" });
    expect(run(early, leg()).problem!.blockId).toBe(early.id); // it has to be defined first
  });

  test("a recursion that has a way to stop works: a stack of shrinking boxes", () => {
    const tower = b("define", { name: "tower", inputs: "size, n" }, [
      b("box", { name: "b", w: "size", d: "size", h: "size" }),
      b("if", { condition: "n > 1" }, [b("transform", { z: "size" }, [b("use", { name: "tower", values: "size * 0.5, n - 1" })])]),
    ]);
    const r = run(tower, b("use", { name: "tower", values: "16, 4" }));
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo(16 ** 3 + 8 ** 3 + 4 ** 3 + 2 ** 3, 0); // the boxes sit at different heights and do not overlap enough to matter
  });

  test("a recursion with no way to stop is stopped, and says so", () => {
    const forever = b("define", { name: "again", inputs: "" }, [b("box"), b("use", { name: "again", values: "" })]);
    const r = run(forever, b("use", { name: "again", values: "" }));
    expect(r.problem!.message).toMatch(/more than 16 levels deep: does it have a way to stop\?/);
  });

  test("a problem inside a part points at the block in the part, and says which use led to it", () => {
    const bad = b("box", { name: "b", w: "10 / (w - 5)" });
    const r = run(b("define", { name: "p", inputs: "w" }, [bad]), b("use", { name: "p", values: "5" }));
    expect(r.problem).toEqual({ blockId: bad.id, message: "width: division by zero (when part p was used with 5)" });
  });

  test("the values are checked", () => {
    const wrongCount = b("use", { name: "leg", values: "4" });
    expect(run(leg(), wrongCount).problem).toEqual({ blockId: wrongCount.id, message: "with: leg needs 2 values (w, h) but got 1" });
    const none = b("use", { name: "p", values: "1" });
    expect(run(b("define", { name: "p", inputs: "" }, [b("box")]), none).problem!.message).toBe("with: p needs 0 values but got 1");
    const badValue = b("use", { name: "leg", values: "4, oops" });
    expect(run(leg(), badValue).problem!.message).toBe('with: value 2 (oops): unknown variable "oops"');
  });

  test("names of parts and inputs are checked", () => {
    expect(run(b("define", { name: "2x", inputs: "" })).problem!.message).toMatch(/variable name/);
    expect(run(b("define", { name: "p", inputs: "w, w" })).problem!.message).toBe("inputs: an input name is used twice");
    expect(run(b("define", { name: "p", inputs: "w, 2h" })).problem!.message).toMatch(/"2h" is not a name/);
    expect(run(b("define", { name: "p", inputs: "pi" })).problem!.message).toMatch(/cannot be an input name/);
    expect(run(b("define", { name: "p", inputs: "" }, [b("box")]), b("use", { name: "q", values: "" })).problem!.message).toMatch(/no part called "q"/);
  });

  test("a part that makes nothing makes nothing, and a part can be used inside a repeat", () => {
    expect(run(b("define", { name: "p", inputs: "" }, []), b("use", { name: "p", values: "" })).shapes).toEqual([]);
    const post = b("define", { name: "post", inputs: "x" }, [b("transform", { x: "x" }, [b("box", { name: "b", w: "2", d: "2", h: "2", z: "-1" })])]);
    const r = run(post, b("repeat", { times: "4", counter: "i" }, [b("use", { name: "post", values: "i * 10" })]));
    close(bounds(r), [-1, -1, -1, 31, 1, 1]);
  });
});

describe("mirror", () => {
  const wing = () => b("transform", { x: "10" }, [b("box", { name: "wing", w: "8", d: "4", h: "2", z: "-1" })]);

  test("reflects across the plane through the origin", () => {
    const r = run(b("mirror", { axis: "x" }, [wing()]));
    expect(r.problem).toBeUndefined();
    close(bounds(r), [-14, -2, -1, -6, 2, 1]); // it was at x 6 to 14
    expect(vol(r)).toBeCloseTo(64);
  });

  test("both keeps the original too, which makes a symmetric part", () => {
    const r = run(b("mirror", { axis: "x", both: true }, [wing()]));
    close(bounds(r), [-14, -2, -1, 14, 2, 1]);
    expect(vol(r)).toBeCloseTo(128);
    expect(r.combined!.isValid()).toBe(true);
  });

  test("across y and z, and a shape that crosses the plane overlaps itself harmlessly", () => {
    close(bounds(run(b("mirror", { axis: "y" }, [b("transform", { y: "5" }, [b("box", { name: "b", w: "2", d: "2", h: "2", z: "-1" })])]))), [-1, -6, -1, 1, -4, 1]);
    close(bounds(run(b("mirror", { axis: "z", both: true }, [b("transform", { z: "5" }, [b("box", { name: "b", w: "2", d: "2", h: "2" })])]))), [-1, -1, -7, 1, 1, 7]);
    expect(vol(run(b("mirror", { axis: "x", both: true }, [b("box", { name: "b", w: "4", d: "4", h: "4" })])))).toBeCloseTo(64); // a centred box is its own mirror image
  });

  test("a mirrored solid is still a solid with outward faces (volume is not negative)", () => {
    const r = run(b("mirror", { axis: "x" }, [b("solid", {}, [b("vertices", {}, [["0", "0", "0"], ["10", "0", "0"], ["0", "10", "0"], ["0", "0", "10"]].map(([x, y, z]) => b("vertex", { x, y, z }))), b("faces", {})])]));
    expect(vol(r)).toBeCloseTo(1000 / 6);
    expect(r.combined!.isValid()).toBe(true);
  });

  test("it needs a shape inside", () => {
    expect(run(b("mirror", { axis: "x" }, [])).problem!.message).toBe("put at least one shape inside this block");
  });
});

describe("measure", () => {
  test("sets variables for the size and the edges, for the blocks below it", () => {
    const r = run(
      b("measure", { name: "top" }, [b("transform", { x: "10", z: "100" }, [b("box", { name: "t", w: "40", d: "20", h: "5" })])]),
      b("box", { name: "after", w: "top_w", d: "top_d", h: "top_h" }),
      b("transform", { z: "top_z1" }, [b("box", { name: "on top", w: "1", d: "1", h: "1" })]),
    );
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(3);
    close(r.shapes[1].solid.bounds().max, [20, 10, 5]); // 40 x 20 x 5: built from the measured size
    expect(r.shapes[2].solid.bounds().min[2]).toBeCloseTo(105); // moved to the top edge (z = 105), where the 1 mm box now stands
    // the shape itself is still there, untouched
    close(bounds(run(b("measure", { name: "t" }, [b("transform", { x: "10" }, [b("box", { name: "b", w: "4", d: "4", h: "4" })])]))), [8, -2, 0, 12, 2, 4]);
  });

  test("the edges are named for the part", () => {
    const r = run(b("measure", { name: "m" }, [b("transform", { x: "10", y: "-4", z: "3" }, [b("box", { name: "b", w: "2", d: "6", h: "4" })])]), b("box", { name: "probe", w: "m_x0", d: "m_x1", h: "m_y0 + 100" }));
    // x from 9 to 11, y from -7 to -1, z from 3 to 7
    close(r.shapes[1].solid.bounds().max, [4.5, 5.5, 93]);
    const sizes = run(b("measure", { name: "m" }, [b("box", { name: "b", w: "2", d: "6", h: "4" })]), b("box", { name: "p", w: "m_w", d: "m_d", h: "m_h" }));
    close(sizes.shapes[1].solid.bounds().max, [1, 3, 4]);
  });

  test("it works inside a part, to size things from what exists", () => {
    const table = b("define", { name: "table", inputs: "" }, [
      b("measure", { name: "top" }, [b("box", { name: "top", w: "60", d: "40", h: "4" })]),
      b("box", { name: "leg", w: "4", d: "4", h: "40", x: "top_x0 + 2", y: "top_y0 + 2", z: "-40" }),
    ]);
    const r = run(table, b("use", { name: "table", values: "" }));
    expect(r.problem).toBeUndefined();
    expect(bounds(r)[0]).toBeCloseTo(-30); // the leg is flush with the left edge of the top
  });

  test("a bad name, and nothing inside, are problems", () => {
    expect(run(b("measure", { name: "2x" }, [b("box")])).problem!.message).toMatch(/variable name/);
    expect(run(b("measure", { name: "m" }, [])).problem!.message).toBe("put at least one shape inside this block");
  });
});

describe("when something is wrong", () => {
  test("a field's problem is named, and points at its block", () => {
    const bad = b("box", { name: "p", w: "width", d: "1", h: "1" });
    const r = run(bad);
    expect(r.problem).toEqual({ blockId: bad.id, message: 'width: unknown variable "width"' });
  });

  test("the program stops there, and what came before is still built", () => {
    const bad = b("box", { name: "b", w: "1 / 0", d: "1", h: "1" });
    const r = run(b("box", { name: "a", w: "10", d: "10", h: "10" }), bad, b("box", { name: "c", w: "1", d: "1", h: "1" }));
    expect(r.problem!.blockId).toBe(bad.id);
    expect(r.problem!.message).toBe("width: division by zero");
    expect(names(r)).toEqual(["a"]); // c never ran
    expect(vol(r)).toBeCloseTo(1000); // and a is still there to see
  });

  test("variable names", () => {
    expect(run(b("set", { name: "2x", value: "1" })).problem!.message).toMatch(/variable name/);
    expect(run(b("set", { name: "pi", value: "1" })).problem!.message).toMatch(/built in/);
  });

  test("sizes", () => {
    expect(run(b("box", { name: "a", w: "0" })).problem!.message).toBe("width: must be more than zero (it is 0)");
    expect(run(b("sphere", { name: "a", r: "-1" })).problem!.message).toMatch(/radius: must be more than zero/);
    expect(run(b("cylinder", { name: "a", r: "0", top: "0" })).problem!.message).toMatch(/cannot both be zero/);
    const flat = b("transform", { sx: "0" }, [b("box")]);
    expect(run(flat).problem).toEqual({ blockId: flat.id, message: "scale x: must be more than zero (it is 0)" });
  });

  test("sketch problems are pointed at the piece that is wrong", () => {
    const flat = b("rectangle", { w: "0" });
    const r = run(b("extrude", { name: "e" }, [b("rectangle", {}), flat]));
    expect(r.problem!.blockId).toBe(flat.id);
    expect(r.problem!.message).toMatch(/rectangle width must be a positive number/);

    const poly = b("polygon", {}, [b("point", { u: "0", v: "0" }), b("point", { u: "1", v: "1" })]);
    expect(run(b("extrude", { name: "e" }, [poly])).problem).toEqual({ blockId: poly.id, message: "a polygon needs at least three points" });

    const bowtie = b("polygon", {}, [b("point", { u: "0", v: "0" }), b("point", { u: "2", v: "2" }), b("point", { u: "2", v: "0" }), b("point", { u: "0", v: "2" })]);
    expect(run(b("extrude", { name: "e" }, [bowtie])).problem).toEqual({ blockId: bowtie.id, message: "polyline crosses itself" });
  });

  test("an empty sketch, or one of only holes", () => {
    const empty = b("extrude", { name: "e" }, []);
    expect(run(empty).problem).toEqual({ blockId: empty.id, message: "put a rectangle, circle or polygon inside this block" });
    const holes = b("extrude", { name: "e" }, [b("circle", { hole: true })]);
    expect(run(holes).problem!.message).toMatch(/at least one shape that is not a hole/);
  });

  test("a shape whose geometry fails is reported at the block that made it, and the rest is still drawn", () => {
    const crossing = b("revolve", { name: "r", plane: "XY", offset: "0", angle: "360" }, [b("rectangle", { u: "-1", v: "0", w: "3", h: "5" })]);
    const r = run(b("box", { name: "ok", w: "2", d: "2", h: "2" }), crossing);
    expect(r.problem!.blockId).toBe(crossing.id);
    expect(r.problem!.message).toMatch(/revolve profile must lie on the u >= 0 side/);
    expect(vol(r)).toBeCloseTo(8); // the box is still drawn
    expect(names(r)).toEqual(["ok"]);
  });

  test("a problem deep inside holders is pointed at, not at the holders around it", () => {
    const deep = b("box", { name: "deep", w: "1 / 0" });
    const r = run(b("transform", {}, [b("transform", {}, [b("union", {}, [b("box"), deep])])]));
    expect(r.problem).toEqual({ blockId: deep.id, message: "width: division by zero" });
    expect(r.shapes).toEqual([]);
  });

  test("holes that remove everything", () => {
    const e = b("extrude", { name: "e", plane: "XY", offset: "0", height: "1" }, [b("rectangle", { w: "4", h: "4" }), b("rectangle", { u: "-1", v: "-1", w: "6", h: "6", hole: true })]);
    expect(run(e).problem).toEqual({ blockId: e.id, message: "the holes remove everything" });
  });

  test("a bad revolve angle, and a part of a block used as a statement", () => {
    expect(run(b("revolve", { name: "r", angle: "400" }, [b("rectangle", { u: "1" })])).problem!.message).toMatch(/angle: must be more than 0 and at most 360/);
    expect(run(b("point", {})).problem!.message).toMatch(/belongs inside another block/);
  });

  test("an empty program is just empty", () => {
    const r = run();
    expect(r.problem).toBeUndefined();
    expect(r.combined).toBeNull();
  });
});

describe("the command list itself", () => {
  test("every command is well formed", () => {
    const ids = new Set<string>();
    for (const c of COMMANDS) {
      expect(ids.has(c.id), `${c.id} is listed twice`).toBe(false);
      ids.add(c.id);
      const paramIds = new Set<string>();
      for (const p of c.params) {
        expect(paramIds.has(p.id), `${c.id}.${p.id} is listed twice`).toBe(false);
        paramIds.add(p.id);
        if (p.type.kind === "flag") expect(typeof p.default).toBe("boolean");
        else expect(typeof p.default).toBe("string");
        if (p.type.kind === "choice") expect(p.type.options.map((o) => o.value)).toContain(p.default);
      }
      for (const kind of c.inner ?? []) expect(commandById(kind), `${c.id} holds unknown ${kind}`).toBeDefined();
      // a block either does something, or makes a shape, or is a piece of a bigger block
      expect([c.run, c.make, c.piece].filter(Boolean).length, `${c.id} should have exactly one of run, make or piece`).toBe(1);
      if (c.buildsInner) expect(c.make && c.inner, `${c.id} builds its inner blocks, so it needs make and inner`).toBeTruthy();
      if (c.piece && !["point", "vertex", "face", "bottom", "top", "else", "vertices", "faces"].includes(c.id)) expect(c.sketch, `${c.id} needs a sketch function`).toBeDefined();
    }
  });

  test("a blank block has every field at its default", () => {
    const blank = blankBlock("extrude", "x1");
    expect(blank).toEqual({ id: "x1", kind: "extrude", args: { name: "", plane: "XY", offset: "0", height: "5", twist: "0", taper: "1" }, inner: [] });
    expect(() => blankBlock("nope", "x2")).toThrow(/no such command/);
  });

  test("a blank program built from blank blocks runs (except where something has to go inside)", () => {
    const r = runProgram(k, [blankBlock("box", "1"), blankBlock("sphere", "2"), blankBlock("cylinder", "3")]);
    expect(r.problem).toBeUndefined();
    expect(names(r)).toEqual(["box", "sphere", "cylinder"]);
  });
});

describe("saving and loading programs", () => {
  const program = (): Program => [
    b("set", { name: "w", value: "40" }),
    b("extrude", { name: "plate", plane: "YZ", offset: "w / 2", height: "5" }, [
      b("rectangle", { u: "0", v: "0", w: "w", h: "w", rotate: "5", hole: false }),
      b("polygon", { hole: true }, [b("point", { u: "1", v: "1" }), b("point", { u: "2", v: "1" }), b("point", { u: "1", v: "2" })]),
    ]),
    { ...b("box", { name: "ghost" }), hidden: true },
  ];

  test("a program round trips exactly", () => {
    const p = program();
    expect(parseProgram(serializeProgram(p))).toEqual(p);
  });

  test("what loads still runs the same", () => {
    const p = program();
    expect(vol(runProgram(k, parseProgram(serializeProgram(p)).filter((x) => !x.hidden)))).toBeCloseTo(vol(runProgram(k, p.filter((x) => !x.hidden))));
  });

  test("files that are not programs get readable errors", () => {
    expect(() => parseProgram("{")).toThrow(/not a valid block program/);
    expect(() => parseProgram("{}")).toThrow(/not a block program file/);
    expect(() => parseProgram('{"blocks":2,"program":[]}')).toThrow(/newer version/);
    expect(() => parseProgram('{"blocks":1,"program":{}}')).toThrow(/list of blocks/);
  });

  test("blocks are checked against the command list", () => {
    const fails = (p: unknown, message: RegExp) => expect(() => validateProgram(p)).toThrow(message);
    fails([{ id: "a", kind: "teleport", args: {} }], /unknown kind "teleport"/);
    fails([{ id: "a", kind: "box", args: { colour: "red" } }], /has no field "colour"/);
    fails([{ id: "a", kind: "extrude", args: { hole: true } }], /has no field "hole"/);
    fails([{ id: "a", kind: "rectangle", args: { hole: "yes" } }], /"hole" must be true or false/);
    fails([{ id: "a", kind: "point", args: {} }], /belongs inside another block/);
    fails([{ id: "a", kind: "extrude", args: { plane: "AB" }, inner: [] }], /"plane" must be one of XY, XZ, YZ/);
    fails([{ id: "a", kind: "box", args: { w: 5 } }], /"w" must be text/);
    fails([{ id: "a", kind: "extrude", args: {}, inner: [{ id: "b", kind: "box", args: {} }] }], /a box block cannot go inside a extrude block/);
    fails([{ id: "a", kind: "extrude", args: {}, inner: [{ id: "a", kind: "circle", args: {} }] }], /id is used twice/);
    fails([{ id: "a", kind: "box", args: {}, inner: [] }], /cannot hold other blocks/);
    fails([{ id: "a", kind: "transform", args: {}, inner: [{ id: "b", kind: "point", args: {} }] }], /a point block cannot go inside a transform block/);
    fails([{ id: "a", kind: "transform", args: { names: "x" }, inner: [] }], /has no field "names"/);
    fails([{ id: "a", kind: "extrude", args: {}, inner: [{ id: "b", kind: "rectangle", args: { hole: "x" } }] }], /"hole" must be true or false/);
    fails([{ kind: "box", args: {} }], /no id/);
    fails([{ id: "a", kind: "box", args: { name: "x".repeat(300) } }], /too long/);
  });
});

describe("the examples", () => {
  const byName = (name: string) => DEMOS.find((e) => e.name === name)!;

  test("each one is valid and runs with nothing wrong", () => {
    for (const e of DEMOS) {
      validateProgram(e.program);
      const r = runProgram(k, e.program);
      expect(r.problem, e.name).toBeUndefined();
      expect(r.combined, e.name).not.toBeNull();
      expect(r.combined!.isValid(), e.name).toBe(true);
    }
  }, 120_000); // there are many examples, and two (hollowing, filleting) take 5 to 25 seconds, depending on how busy the computer is

  test("the plate follows its variables", () => {
    const plate = (width: string) => {
      const p = structuredClone(byName("Plate with holes").program);
      p[0].args.value = width;
      return runProgram(k, p);
    };
    const r = plate("60");
    // 60 x 40 x 4, minus four holes of radius 3
    expect(vol(r)).toBeCloseTo((2400 - 4 * disc(3)) * 4, 2);
    close(bounds(r), [-30, -20, 0, 30, 20, 4]);
    close(bounds(plate("100")), [-50, -20, 0, 50, 20, 4]);
  });

  test("the bracket is one piece, standing on the ground, with the wall on top of the base", () => {
    const r = runProgram(k, byName("Bracket").program);
    expect(names(r)).toEqual(["bracket"]);
    const b = bounds(r);
    expect(b[2]).toBeCloseTo(0);
    expect(b[5]).toBeCloseTo(35); // 5 thick base + 30 high wall
    // base 40 x 30 x 5, wall 40 x 5 x 30 on its back edge, less a screw hole of radius 3 through the base
    const hole = Math.PI * 9 * 5;
    expect(vol(r) / (40 * 30 * 5 + 40 * 5 * 30 - hole)).toBeCloseTo(1, 2);
    close([b[0], b[1], b[3], b[4]], [-20, -15, 20, 15]); // the wall is flush with the plate's back edge, so nothing sticks out
  });

  test("the row of holes cuts one hole per count, evenly spaced about the middle", () => {
    const row = (holes: string) => {
      const p = structuredClone(byName("Row of holes").program);
      p[0].args.value = holes;
      return runProgram(k, p);
    };
    const five = row("5");
    expect(five.problem).toBeUndefined();
    const bar = (5 * 12 + 12) * 20 * 4;
    expect(vol(five) / (bar - 5 * Math.PI * 9 * 4)).toBeCloseTo(1, 3);
    expect(bounds(five)[0]).toBeCloseTo(-36); // the bar runs from -36 to 36, centred on the holes
    const seven = row("7");
    expect(vol(seven) / ((7 * 12 + 12) * 20 * 4 - 7 * Math.PI * 9 * 4)).toBeCloseTo(1, 3);
  });

  test("the ring of posts has a post for each count, turned round the middle", () => {
    const ring = (count: string) => {
      const p = structuredClone(byName("Ring of posts").program);
      p[0].args.value = count;
      return runProgram(k, p);
    };
    const eight = ring("8");
    expect(eight.problem).toBeUndefined();
    const disc2 = Math.PI * 24 * 24 * 2;
    // the posts overlap the disc (it is 2 thick and they stand from z = 1 to 11), so each adds only what sticks out above it
    expect(vol(eight)).toBeGreaterThan(disc2);
    expect(vol(eight)).toBeLessThan(disc2 + 8 * Math.PI * 4 * 10);
    close(bounds(eight).slice(0, 2), [-24, -24], 0);
    expect(bounds(ring("3"))[5]).toBeCloseTo(11);
    expect(vol(ring("3"))).toBeLessThan(vol(eight));
  });

  test("the table is a top and four legs, all standing on the ground", () => {
    const r = runProgram(k, byName("Table with legs").program);
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(1);
    expect(vol(r)).toBeCloseTo(100 * 60 * 5 + 4 * 5 * 5 * 40, 0);
    const bb = bounds(r);
    close([bb[2], bb[5]], [0, 45]);
    close([bb[0], bb[3]], [-50, 50]);
    // a wider top moves the legs out with it
    const wide = structuredClone(byName("Table with legs").program);
    wide[0].args.value = "160";
    expect(bounds(runProgram(k, wide).combined ? runProgram(k, wide) : r)[3]).toBeCloseTo(80);
  });

  test("the stairs rise one step at a time, and more steps make more stairs", () => {
    const r = runProgram(k, byName("Stairs").program);
    expect(r.problem).toBeUndefined();
    close(bounds(r), [-30, -12.5, 0, 30, 137.5, 60]);
    const more = structuredClone(byName("Stairs").program);
    more[0].args.value = "10";
    expect(bounds(runProgram(k, more))[5]).toBeCloseTo(100);
  });

  test("the tree grows from the ground, spreads sideways, and stops", () => {
    const r = runProgram(k, byName("Tree").program);
    expect(r.problem).toBeUndefined();
    const bb = bounds(r);
    expect(bb[2]).toBeCloseTo(0);
    expect(bb[5]).toBeGreaterThan(60);
    expect(bb[0]).toBeLessThan(-10);
    expect(bb[3]).toBeGreaterThan(10);
    // the same tree, one level deeper, is taller
    const deeper = structuredClone(byName("Tree").program);
    deeper[1].args.values = "30, 5";
    expect(bounds(runProgram(k, deeper))[5]).toBeGreaterThan(bb[5]);
    // a part that never stops is caught (the if is what stops it)
    const forever = structuredClone(byName("Tree").program);
    forever[0].inner![1].args.condition = "true";
    expect(runProgram(k, forever).problem!.message).toMatch(/levels deep/);
  });

  test("the wing reaches out on both sides, equally", () => {
    const r = runProgram(k, byName("Wing").program);
    expect(r.problem).toBeUndefined();
    const bb = bounds(r);
    close([bb[0], bb[3]], [-35, 35]);
    expect(vol(r)).toBeCloseTo(2 * 30 * 8 * 2);
  });

  test("the open box is hollow with its top open, and its edges are rounded", () => {
    const r = runProgram(k, byName("Open box").program);
    expect(r.problem).toBeUndefined();
    const solid = 50 * 35 * 25;
    expect(vol(r)).toBeLessThan(solid - 46 * 31 * 23 + 10); // the walls and the floor (46 x 31 x 23 is the inside), and the rounding takes a little more
    expect(vol(r)).toBeGreaterThan(solid - 46 * 31 * 23 - 500);
    close(bounds(r), [-25, -17.5, 0, 25, 17.5, 25], 0);
  });

  test("the twisted tower leans round and narrows; changing turn and narrowing changes it", () => {
    const r = runProgram(k, byName("Twisted tower").program);
    expect(r.problem).toBeUndefined();
    const b = bounds(r);
    expect(b[2]).toBeCloseTo(0, 3);
    expect(b[5]).toBeCloseTo(60, 3);
    expect(b[3]).toBeLessThan(14.2);
    const straight = structuredClone(byName("Twisted tower").program);
    straight[0].args.value = "0";
    straight[1].args.value = "1";
    expect(vol(runProgram(k, straight))).toBeGreaterThan(vol(r));
  });

  test("the rounded plate has four holes, and moving the corner radius moves them", () => {
    const r = runProgram(k, byName("Rounded plate").program);
    expect(r.problem).toBeUndefined();
    const rect = 70 * 45 - 4 * (64 - 16 * Math.PI);
    expect(vol(r) / ((rect - 4 * Math.PI * 4) * 5)).toBeCloseTo(1, 2);
    const wider = structuredClone(byName("Rounded plate").program);
    wider[0].args.value = "12";
    expect(runProgram(k, wider).problem).toBeUndefined();
  });

  test("the cup is a hollow vessel", () => {
    const r = runProgram(k, byName("Cup").program);
    // outer cylinder of radius 15 and height 30, less the inner cavity of radius 13 and height 28
    const outer = Math.PI * 225 * 30;
    const inner = Math.PI * 169 * 28;
    expect(vol(r) / (outer - inner)).toBeCloseTo(1, 1);
    expect(bounds(r)[5] - bounds(r)[2]).toBeCloseTo(30);
  });

  test("the snowman's three balls stack, with a nose pointing out of the head", () => {
    const r = runProgram(k, byName("Snowman").program);
    const b = bounds(r);
    expect(b[2]).toBeCloseTo(0); // body on the ground
    expect(b[5]).toBeGreaterThan(2 * 12 + 2 * 8 + 2 * 5 - 5); // taller than the three balls' stack less overlaps
    expect(names(r)).toEqual(["snowman"]);
  });
});
