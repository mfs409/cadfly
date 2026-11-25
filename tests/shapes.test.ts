import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { commandById } from "../src/cadfly/language/commands";
import { validateProgram } from "../src/cadfly/language/format";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import type { Block, Program, Script } from "../src/cadfly/language/types";
import { oneScript } from "./helpers/script-helpers";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { applyOps } from "../src/cadfly/assistant/ops";
import { modeByName } from "../src/cadfly/ui/modes";
import { programView } from "../src/cadfly/assistant/prompt";
import { hit, layoutProgram } from "../src/cadfly/ui/layout";
import { blk, box } from "./helpers/blocks";

/** Running programs that make, place, combine and measure shapes. */

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

const run = (...blocks: Block[]) => runProgram(k, oneScript(blocks));

const bounds = (r: RunResult) => {
  const x = r.combined!.bounds();
  return [...x.min, ...x.max];
};

const close = (got: number[], want: number[], digits = 5) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
const vol = (r: RunResult) => r.combined!.volume();
const names = (r: RunResult) => r.shapes.map((s) => s.name);
const disc = (r: number) => 0.5 * 64 * r * r * Math.sin((2 * Math.PI) / 64); // the area of the 64-sided circle outline

/** A named script (a function) */
const fn = (name: string, inputs: string, blocks: Block[]): Script => ({ id: "s1", name, ...(inputs ? { inputs } : {}), blocks });

/** Run `build` with these blocks, beside these other scripts */
const runWith = (blocks: Block[], ...others: Script[]) => runProgram(k, [{ id: "s1", name: "build", blocks }, ...others]);

const runText = (text: string) => runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program);
const volOfText = (text: string) => runText(text).combined!.volume();

const boundsOfText = (text: string) => {
  const b = runText(text).combined!.bounds();
  return [...b.min, ...b.max];
};

const named = (n: string) => modeByName(n)!;
const measure = (t: string) => t.length * 0.1;

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

  test("align and place against: the first shape is the base and stays put", () => {
    const far = () => b("transform", { x: "30", y: "30", z: "30" }, [cube("2", "small")]);
    const lined = run(b("lineUp", { axis: "x", at: "center" }, [cube("10", "base"), far()]));
    close(bounds(lined), [-5, -5, 0, 5, 31, 32]); // the small one is now centred on x = 0, still at y and z = 30
    const onTop = run(b("placeAgainst", { axis: "z", side: "high" }, [cube("10", "base"), cube("2", "small")]));
    close(bounds(onTop), [-5, -5, 0, 5, 5, 12]); // the small cube sits on the base: z from 10 to 12
    const under = run(b("placeAgainst", { axis: "z", side: "low" }, [cube("10", "base"), cube("2", "small")]));
    close(bounds(under), [-5, -5, -2, 5, 5, 10]);
  });

  test("align, place against, subtract and intersect need a base and something else", () => {
    for (const kind of ["lineUp", "placeAgainst", "subtract"]) {
      expect(run(b(kind, {}, [cube()])).problem!.message).toMatch(/at least two shapes inside: the first is the base/);
    }
    expect(run(b("intersect", {}, [cube()])).problem!.message).toMatch(/at least two shapes/);
    expect(run(b("transform", {}, [])).problem!.message).toMatch(/at least one shape inside/);
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
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "box", args: {}, disabled: true }] }])).toThrow(/does not change what is inside it, so it cannot be disabled/);
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "transform", args: {}, inner: [], disabled: "yes" }] }])).toThrow(/disabled must be true or false/);
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "transform", args: {}, inner: [], disabled: true }] }])).not.toThrow();
  });

  test("hidden is only for blocks that make a shape", () => {
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "set", args: {}, hidden: true }] }])).toThrow(/makes no shape of its own, so it cannot be hidden/);
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "box", args: {}, hidden: "yes" }] }])).toThrow(/hidden must be true or false/);
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
    expect(run(b("mirror", { axis: "x" }, [])).problem!.message).toMatch(/at least one shape inside/);
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

  test("it works inside a script, to size things from what exists", () => {
    const table = fn("table", "", [
      b("measure", { name: "top" }, [b("box", { name: "top", w: "60", d: "40", h: "4" })]),
      b("box", { name: "leg", w: "4", d: "4", h: "40", x: "top_x0 + 2", y: "top_y0 + 2", z: "-40" }),
    ]);
    const r = runWith([b("use", { name: "table", values: "" })], table);
    expect(r.problem).toBeUndefined();
    expect(bounds(r)[0]).toBeCloseTo(-30); // the leg is flush with the left edge of the top
  });

  test("a bad name, and nothing inside, are problems", () => {
    expect(run(b("measure", { name: "2x" }, [b("box")])).problem!.message).toMatch(/variable name/);
    expect(run(b("measure", { name: "m" }, [])).problem!.message).toMatch(/at least one shape inside/);
  });
});

describe("size in a formula (measure)", () => {
  test("a lid is as wide as the box it fits, plus a margin", () => {
    const text = [
      "measure name=base",
      "  box w=40 d=30 h=10",
      "box w=base_w + 2 d=base_d + 2 h=3",
    ].join("\n");
    const r = runText(text);
    expect(r.problem).toBeUndefined();
    expect(r.shapes[1].solid.bounds().max[0] * 2).toBeCloseTo(42, 3);
  });
});

describe("a cone is a cylinder with a smaller top", () => {
  test("an empty top radius is a cylinder; a smaller one tapers; 0 makes a point; a larger one flares", () => {
    const v = (top: string) => volOfText(`cylinder r=6 top=${top} h=9`);
    expect(volOfText("cylinder r=6 h=9") / (Math.PI * 36 * 9)).toBeGreaterThan(0.99);
    expect(v("3") / ((Math.PI * 9 * (36 + 18 + 9)) / 3)).toBeGreaterThan(0.99); // a frustum
    expect(v("0") / ((Math.PI * 36 * 9) / 3)).toBeGreaterThan(0.99); // a cone
    expect(v("9")).toBeGreaterThan(volOfText("cylinder r=6 h=9"));
    expect(boundsOfText("cylinder r=6 top=0 h=9")).toEqual(expect.arrayContaining([0, 9]));
  });
  test("it needs some radius, and a negative one is refused", () => {
    expect(runText("cylinder r=0 top=0").problem!.message).toMatch(/cannot both be zero/);
    expect(runText("cylinder r=3 top=-1").problem!.message).toMatch(/top radius: cannot be negative/);
    expect(() => runText("cone")).toThrow(/there is no block called "cone"/);
  });
  test("it is a field of the block in every mode that offers one, First steps too", () => {
    for (const mode of ["First steps", "Starter"]) {
      const labels = layoutProgram(oneScript([blk("b1", "cylinder")]), { x: 1, y: 2, width: 8, measure, mode: named(mode) }).blocks[0].parts.filter((p) => p.kind === "label").map((p) => p.text);
      expect(labels, mode).toContain("top radius");
    }
  });
});

describe("measure: a ? that shows what it found, and no switches", () => {
  const prog = (): Program => oneScript([blk("b1", "measure", { name: "top" }, [blk("b2", "box", { w: "40", d: "20", h: "5" })]), blk("b3", "box", { w: "top_w", d: "top_d", h: "top_h" })]);
  const lay = (p: Program) => layoutProgram(p, { x: 1, y: 2, width: 8, measure });

  test("its header ends with a ?, and it has no eye or power switch", () => {
    const parts = lay(prog()).blocks[0].parts;
    expect(parts.at(-1)!.kind).toBe("info");
    expect(parts.some((p) => p.kind === "eye" || p.kind === "power")).toBe(false);
    expect(lay(prog()).blocks[1].parts.some((p) => p.kind === "eye")).toBe(true); // the box inside has its own
  });

  test("tapping the ? is a hit that names the block and where the chip is, so the pop-up can sit under it", () => {
    const l = lay(prog());
    const chip = l.blocks[0].parts.at(-1)!;
    const h = hit(l, chip.rect.x + chip.rect.w / 2, chip.rect.y + chip.rect.h / 2);
    expect(h).toMatchObject({ kind: "info", blockId: "b1" });
  });

  test("a measure block cannot be hidden (the shape inside has the eye), in the file or from the assistant", () => {
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "measure", args: {}, inner: [], hidden: true }] }])).toThrow(/makes no shape of its own/);
    expect(() => applyOps([], [{ op: "append", blocks: "measure\n  box hidden" }])).not.toThrow(); // the box inside may be
    expect(() => applyOps([], [{ op: "append", blocks: "measure hidden\n  box" }])).toThrow();
  });

  test("the run keeps what each measure block found, by block id: the size and the edges, under the names the blocks below use", () => {
    const r = runProgram(k, prog());
    expect(r.problem).toBeUndefined();
    expect(r.measurements.b1).toMatchObject({ top_w: 40, top_d: 20, top_h: 5, top_x0: -20, top_x1: 20, top_y0: -10, top_y1: 10, top_z0: 0, top_z1: 5 });
    expect(runProgram(k, oneScript([blk("b1", "measure", { name: "m" }, [])])).measurements).toEqual({}); // one that did not run has nothing
  });

  test("a measure inside a loop shows the last pass", () => {
    const loop = oneScript([blk("r", "repeat", { times: "3", counter: "i" }, [blk("m", "measure", { name: "q" }, [blk("b", "box", { w: "i + 1" })])])]);
    expect(runProgram(k, loop).measurements.m.q_w).toBe(3);
  });
});

describe("transform: one block that scales, turns and moves a group", () => {
  const sel = (text: string) => applyOps([], [{ op: "append", blocks: text }]).program;
  const bounds = (text: string) => {
    const b = runProgram(k, sel(text)).combined!.bounds();
    return [...b.min, ...b.max];
  };

  test("it scales, then turns, then moves, about the origin: the same as nesting a scale, a turn and a move in that order", () => {
    // a 10 cube at x = 20 (from the cube's own x), stretched by 2, turned 90 degrees about z, then moved up 5
    const text = "transform sx=2 sy=2 sz=2 rz=90 z=5\n  box w=10 d=10 h=10 x=20";
    const b = bounds(text);
    expect(b[0]).toBeCloseTo(-10, 3); // the x offset of 20 became 40 when scaled, then swung round to y = 40
    expect(b[1]).toBeCloseTo(30, 3);
    expect(b[2]).toBeCloseTo(5, 3);
    expect(b[5]).toBeCloseTo(25, 3);
  });

  test("a new transform does nothing, and has all nine of its fields", () => {
    expect(bounds("transform\n  box w=10 d=10 h=10")).toEqual([-5, -5, 0, 5, 5, 10]);
    expect(commandById("transform")!.params.length).toBe(9);
  });

  test("every field of it is left out of what the model reads while it is at its neutral value", () => {
    expect(programView(oneScript([blk("b1", "transform", { x: "5" }, [blk("b2", "box", { name: "a" })])])).split("\n")[0]).toBe("b1 transform x=5");
  });

  test("the power switch is part of its header, and tapping it is a hit; disabled it leaves the shapes as they were", () => {
    const l = layoutProgram(oneScript([blk("b1", "transform", { x: "50" }, [blk("b2", "box", { name: "a" })])]), { x: 1, y: 2, width: 8, measure });
    const power = l.blocks[0].parts.find((p) => p.kind === "power")!;
    expect(power.text).toBe("on");
    expect(hit(l, power.rect.x + power.rect.w / 2, power.rect.y + power.rect.h / 2)).toMatchObject({ kind: "power", blockId: "b1" });
    expect(l.blocks[0].parts.at(-1)!.kind).toBe("eye"); // the eye comes last, after the power switch
    const off = layoutProgram(oneScript([{ ...blk("b1", "transform", { x: "50" }, [blk("b2", "box", { name: "a" })]), disabled: true }]), { x: 1, y: 2, width: 8, measure });
    expect(off.blocks[0].parts.find((p) => p.kind === "power")!.text).toBe("off");
    expect(runProgram(k, oneScript([{ ...blk("b1", "transform", { x: "50" }, [blk("b2", "box", { name: "a" })]), disabled: true }])).combined!.bounds().min[0]).toBeCloseTo(-5, 3);
  });

  test("a block that is not a modifier has no power switch; the eye alone", () => {
    const l = layoutProgram(oneScript([blk("b1", "box")]), { x: 1, y: 2, width: 8, measure });
    expect(l.blocks[0].parts.some((p) => p.kind === "power")).toBe(false);
  });

  test("a disabled or hidden block always shows its switch, whatever the mode, so it can be turned back on", () => {
    const first = named("First steps");
    const mk = (extra: Partial<Block>) => layoutProgram(oneScript([{ ...blk("b1", "transform", {}, [blk("b2", "box")]), ...extra }]), { x: 1, y: 2, width: 8, measure, mode: first }).blocks[0].parts.map((p) => p.kind);
    expect(mk({})).not.toContain("power"); // First steps has no switches
    expect(mk({ disabled: true })).toContain("power");
    expect(mk({ hidden: true })).toContain("eye");
  });

  test("the assistant can set hidden and disabled, and write them in block text", () => {
    const p = oneScript([blk("b1", "transform", { x: "5" }, [blk("b2", "box")])]);
    expect(applyOps(p, [{ op: "set", block: "b2", field: "hidden", value: "true" }]).program[0].blocks[0].inner![0].hidden).toBe(true);
    expect(applyOps(p, [{ op: "set", block: "b1", field: "disabled", value: "true" }]).program[0].blocks[0].disabled).toBe(true);
    expect(() => applyOps(p, [{ op: "set", block: "b2", field: "disabled", value: "true" }])).toThrow(/does not change what is inside it/);
    const made = applyOps([], [{ op: "append", blocks: "transform x=5 disabled\n  box hidden" }]).program;
    expect(made[0].blocks[0].disabled).toBe(true);
    expect(made[0].blocks[0].inner![0].hidden).toBe(true);
    expect(programView(made)).toContain("b1 transform x=5 disabled");
    expect(programView(made)).toMatch(/b2 box .*hidden/);
  });
});
