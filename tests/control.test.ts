import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createBlock } from "../src/cadfly/language/edit";
import { validateProgram } from "../src/cadfly/language/format";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";
import { oneScript } from "./helpers/script-helpers";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";

/** The repeat and if/else blocks when a program runs. */

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
    {
      const found = r.problem!;
      expect(found.blockId).toBe(bad.id);
      expect(found.message).toMatch(/division by zero/);
    }
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
    {
      const found = run(b("if", { condition: "true" }, [cube(), b("else", {}, [cube()]), second])).problem!;
      expect(found.blockId).toBe(second.id);
      expect(found.message).toMatch(/only one else/);
    }
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [b("else", {}, [cube()])] }])).toThrow(/belongs inside another block/);
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [b("transform", {}, [b("else", {}, [])])] }])).toThrow(/else block cannot go inside a transform block/);
  });

  test("a new if starts with an empty else", () => {
    const made = createBlock([], "if");
    expect(made.inner!.map((x) => x.kind)).toEqual(["else"]);
    expect(runProgram(k, oneScript([made])).problem).toBeUndefined();
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
