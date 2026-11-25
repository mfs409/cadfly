import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import type { Block, Script } from "../src/cadfly/language/types";
import { oneScript, topBlocks } from "./helpers/script-helpers";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { programView } from "../src/cadfly/assistant/prompt";
import { box, set, three } from "./helpers/blocks";

/** Variables, globals, scripts and `use` when a program runs. */

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

/** A global script */
const globals = (...blocks: Block[]): Script => ({ id: "s1", blocks });

/** Run `build` with these blocks, beside these other scripts */
const runWith = (blocks: Block[], ...others: Script[]) => runProgram(k, [{ id: "s1", name: "build", blocks }, ...others]);

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
    {
      const found = r.problem!;
      expect(found.blockId).toBe(bad.id);
      expect(found.message).toMatch(/unknown variable.*later/);
    }
  });
});

describe("scripts: use", () => {
  const leg = (blocks?: Block[]) => fn("leg", "w, h", blocks ?? [b("box", { name: "leg", w: "w", d: "w", h: "h" })]);

  test("a script is made once and used as often as you like, with different values", () => {
    const r = runWith([b("transform", { x: "0" }, [b("use", { name: "leg", values: "4, 20" })]), b("transform", { x: "30" }, [b("use", { name: "leg", values: "6, 10" })])], leg());
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(2);
    expect(r.shapes[0].solid.volume()).toBeCloseTo(4 * 4 * 20);
    expect(r.shapes[1].solid.volume()).toBeCloseTo(6 * 6 * 10);
    expect(names(r)).toEqual(["transform", "transform"].map(() => "leg")); // a move around a use is called what the script is called
  });

  test("a script makes nothing by itself, and nobody has to define it before it is used", () => {
    const r = runWith([], leg());
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toEqual([]);
    const use = b("use", { name: "leg", values: "2, 2" });
    expect(runProgram(k, [leg(), { id: "s1", name: "build", blocks: [use] }]).problem).toBeUndefined(); // listed first or last, it is the same
    expect(runWith([use], leg()).problem).toBeUndefined();
  });

  test("where scripts are in the list, and where they are drawn, changes nothing", () => {
    const use = () => b("use", { name: "leg", values: "3, 3" });
    const a = runProgram(k, [{ id: "s1", name: "build", blocks: [use()] }, { ...leg(), at: { x: 9, y: 9 } }]);
    const c = runProgram(k, [{ ...leg(), at: { x: 0, y: 0 } }, { id: "s1", name: "build", at: { x: 50, y: 50 }, blocks: [use()] }]);
    expect(vol(a)).toBeCloseTo(vol(c));
  });

  test("values are expressions, in the variables of the place that uses the script", () => {
    const r = runWith([b("set", { name: "size", value: "5" }), b("use", { name: "leg", values: "size * 2, size + 1" })], leg());
    expect(vol(r)).toBeCloseTo(10 * 10 * 6);
    expect(vol(runWith([b("use", { name: "leg", values: "max(1, 3), 2" })], leg()))).toBeCloseTo(3 * 3 * 2); // a comma inside brackets does not split
  });

  test("a script sees the globals, and its inputs win over them", () => {
    const post = fn("post", "h", [b("box", { name: "p", w: "width", d: "width", h: "h" })]);
    const r = runWith([b("use", { name: "post", values: "10" })], post, globals(b("set", { name: "width", value: "4" }), b("set", { name: "h", value: "999" })));
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo(4 * 4 * 10); // width from the globals, h from the input, not the 999
  });

  test("a script does not see the variables of the blocks that use it (scoping is lexical)", () => {
    const post = fn("post", "", [b("box", { name: "p", w: "width", d: "width", h: "5" })]);
    const use = b("use", { name: "post", values: "" });
    const r = runWith([b("set", { name: "width", value: "4" }), use], post);
    expect(r.problem!.message).toMatch(/unknown variable "width"/);
    expect(r.problem!.blockId).toBe(post.blocks[0].id);
  });

  test("what a script sets stays inside it, and build's variables are its own", () => {
    const part = fn("p", "", [b("set", { name: "inside", value: "3" }), b("box", { name: "b", w: "inside", d: "1", h: "1" })]);
    const r = runWith([b("set", { name: "inside", value: "50" }), b("use", { name: "p", values: "" }), b("box", { name: "after", w: "inside", d: "1", h: "1" })], part);
    expect(r.shapes.map((x) => x.solid.bounds().max[0] * 2)).toEqual([3, 50]);
  });

  test("a script may hold several shapes, which a use at the top of build shows as parts, and use other scripts", () => {
    const post = fn("post", "h", [b("box", { name: "b", w: "2", d: "2", h: "h" })]);
    const pair = fn("pair", "h", [b("transform", { x: "-10" }, [b("use", { name: "post", values: "h" })]), b("transform", { x: "10" }, [b("use", { name: "post", values: "h * 2" })])]);
    const r = runWith([b("use", { name: "pair", values: "5" })], post, pair);
    expect(r.problem).toBeUndefined();
    expect(r.shapes.map((x) => x.name)).toEqual(["post", "post"]);
    expect(vol(r)).toBeCloseTo(4 * 5 + 4 * 10);
  });

  describe("a use at the top of build shows the shapes its script made as parts", () => {
    const two = fn("two", "", [b("box", { name: "left", w: "2", d: "2", h: "2" }), b("box", { name: "right", w: "2", d: "2", h: "2", x: "10" })]);

    test("each solid is a part, named for what made it, and all carry the use block's id", () => {
      const use = b("use", { name: "two", values: "" });
      const r = runWith([use], two);
      expect(names(r)).toEqual(["left", "right"]);
      expect(r.shapes.map((x) => x.id)).toEqual([use.id, use.id]);
      expect(vol(r)).toBeCloseTo(16);
    });

    test("a script that makes one shape is one shape, named for the use", () => {
      const one = fn("one", "", [b("box", { name: "inner", w: "2", d: "2", h: "2" })]);
      expect(names(runWith([b("use", { name: "one", values: "" })], one))).toEqual(["one"]);
    });

    test("a use inside another block, or inside a script, is still merged into that block's one shape", () => {
      const inside = runWith([b("union", { name: "both" }, [b("use", { name: "two", values: "" })])], two);
      expect(names(inside)).toEqual(["both"]);
      const outer = fn("outer", "", [b("use", { name: "two", values: "" })]);
      expect(names(runWith([b("use", { name: "outer", values: "" })], two, outer))).toEqual(["outer"]);
    });

    test("a script that makes flat shapes is merged as before", () => {
      const flats = fn("flats", "", [b("rectangle", { w: "4", h: "4" }), b("circle", { r: "1", u: "8" })]);
      const r = runWith([b("use", { name: "flats", values: "" })], flats);
      expect(r.problem).toBeUndefined();
      expect(r.shapes.filter((x) => !x.piece)).toHaveLength(1);
    });

    test("a hidden use is one hidden shape, and the parts stay out of the picture", () => {
      const r = runWith([{ ...b("use", { name: "two", values: "" }), hidden: true }], two);
      expect(r.shapes).toHaveLength(0);
      expect(r.hiddenShapes.map((x) => x.name)).toEqual(["two"]);
    });
  });

  test("build cannot be used, and a name no script has is a problem", () => {
    const self = b("use", { name: "build", values: "" });
    {
      const found = runWith([self]).problem!;
      expect(found.blockId).toBe(self.id);
      expect(found.message).toMatch(/no script called "build"/);
    }
    const missing = b("use", { name: "leg", values: "2, 2" });
    {
      const found = runWith([b("box"), missing]).problem!;
      expect(found.blockId).toBe(missing.id);
      expect(found.message).toMatch(/no script called "leg"/);
    }
  });

  test("a recursion that has a way to stop works: a stack of shrinking boxes", () => {
    const tower = fn("tower", "size, n", [
      b("box", { name: "b", w: "size", d: "size", h: "size" }),
      b("if", { condition: "n > 1" }, [b("transform", { z: "size" }, [b("use", { name: "tower", values: "size * 0.5, n - 1" })])]),
    ]);
    const r = runWith([b("use", { name: "tower", values: "16, 4" })], tower);
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo(16 ** 3 + 8 ** 3 + 4 ** 3 + 2 ** 3, 0); // the boxes sit at different heights and do not overlap enough to matter
  });

  test("a recursion with no way to stop is stopped, and says so", () => {
    const forever = fn("again", "", [b("box"), b("use", { name: "again", values: "" })]);
    const r = runWith([b("use", { name: "again", values: "" })], forever);
    expect(r.problem!.message).toMatch(/more than 16 levels deep: does it have a way to stop\?/);
  });

  test("a problem inside a script points at the block in the script, and says which use led to it", () => {
    const bad = b("box", { name: "b", w: "10 / (w - 5)" });
    const r = runWith([b("use", { name: "p", values: "5" })], fn("p", "w", [bad]));
    {
      const found = r.problem!;
      expect(found.blockId).toBe(bad.id);
      expect(found.message).toMatch(/division by zero.*script p/);
    }
  });

  test("a script that is never used is never run, so a problem in it is not seen", () => {
    const bad = b("box", { name: "b", w: "10 / 0" });
    expect(runWith([b("box")], fn("unused", "", [bad])).problem).toBeUndefined();
  });

  test("the values are checked", () => {
    const wrongCount = b("use", { name: "leg", values: "4" });
    {
      const found = runWith([wrongCount], leg()).problem!;
      expect(found.blockId).toBe(wrongCount.id);
      expect(found.message).toMatch(/leg needs 2 values/);
    }
    const none = b("use", { name: "p", values: "1" });
    expect(runWith([none], fn("p", "", [b("box")])).problem!.message).toMatch(/^with: p needs 0 values but got 1/);
    const badValue = b("use", { name: "leg", values: "4, oops" });
    expect(runWith([badValue], leg()).problem!.message).toMatch(/^with: value 2 .*unknown variable.*oops/);
  });

  test("inputs that are not names are a problem where the script is used", () => {
    const use = b("use", { name: "p", values: "1" });
    expect(runWith([use], fn("p", "w, w", [])).problem!.message).toMatch(/an input name is used twice/);
    expect(runWith([use], fn("p", "w, 2h", [])).problem!.message).toMatch(/"2h" is not a name/);
    expect(runWith([use], fn("p", "pi", [])).problem!.message).toMatch(/cannot be an input name/);
    expect(runWith([b("use", { name: "2x", values: "" })]).problem!.message).toMatch(/variable name/);
  });

  test("a script that makes nothing makes nothing, and a script can be used inside a repeat", () => {
    expect(runWith([b("use", { name: "p", values: "" })], fn("p", "", [])).shapes).toEqual([]);
    const post = fn("post", "x", [b("transform", { x: "x" }, [b("box", { name: "b", w: "2", d: "2", h: "2", z: "-1" })])]);
    const r = runWith([b("repeat", { times: "4", counter: "i" }, [b("use", { name: "post", values: "i * 10" })])], post);
    close(bounds(r), [-1, -1, -1, 31, 1, 1]);
  });
});

describe("globals", () => {
  test("a global script sets variables that build and every script see", () => {
    const r = runProgram(k, [globals(b("set", { name: "w", value: "6" })), { id: "s1", name: "build", blocks: [b("box", { name: "x", w: "w", d: "w", h: "w" })] }]);
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo(216);
  });

  test("a global may use another global from the same script, below the block that sets it", () => {
    const r = runProgram(k, [globals(b("set", { name: "w", value: "6" }), b("set", { name: "d", value: "w * 2" })), { id: "s1", name: "build", blocks: [b("box", { name: "x", w: "w", d: "d", h: "1" })] }]);
    expect(r.problem).toBeUndefined();
    expect(vol(r)).toBeCloseTo(6 * 12);
  });

  test("a global may not use one from another script: it says to put the block below the one that sets it", () => {
    const needs = b("set", { name: "d", value: "w * 2" });
    const r = runProgram(k, [globals(b("set", { name: "w", value: "6" })), globals(needs), { id: "s1", name: "build", blocks: [b("box")] }]);
    {
      const found = r.problem!;
      expect(found.blockId).toBe(needs.id);
      expect(found.message).toMatch(/is set in another script/);
    }
    // in the other order it is the same: the scripts are on their own
    const r2 = runProgram(k, [globals(needs), globals(b("set", { name: "w", value: "6" })), { id: "s1", name: "build", blocks: [b("box")] }]);
    expect(r2.problem!.blockId).toBe(needs.id);
  });

  test("a variable nobody sets is still just an unknown variable", () => {
    const bad = b("set", { name: "d", value: "nothing * 2" });
    expect(runProgram(k, [globals(bad), { id: "s1", name: "build", blocks: [] }]).problem!.message).toMatch(/unknown variable "nothing"/);
  });

  test("two global scripts may not set the same name", () => {
    const again = b("set", { name: "w", value: "7" });
    const r = runProgram(k, [globals(b("set", { name: "w", value: "6" })), globals(again), { id: "s1", name: "build", blocks: [] }]);
    {
      const found = r.problem!;
      expect(found.blockId).toBe(again.id);
      expect(found.message).toMatch(/already set by another global/);
    }
    // the same script may set it twice: the last one wins
    const twice = runProgram(k, [globals(b("set", { name: "w", value: "6" }), b("set", { name: "w", value: "9" })), { id: "s1", name: "build", blocks: [b("box", { name: "x", w: "w", d: "1", h: "1" })] }]);
    expect(vol(twice)).toBeCloseTo(9);
  });

  test("only set blocks can be in a global script", () => {
    const box = b("box");
    const r = runProgram(k, [globals(box), { id: "s1", name: "build", blocks: [] }]);
    {
      const found = r.problem!;
      expect(found.blockId).toBe(box.id);
      expect(found.message).toMatch(/cannot be in a global script/);
    }
  });

  test("build's own variables are local to it: a script cannot see them, and they do not change a global", () => {
    const r = runProgram(k, [globals(b("set", { name: "w", value: "6" })), { id: "s1", name: "build", blocks: [b("set", { name: "w", value: "2" }), b("use", { name: "p", values: "" })] }, fn("p", "", [b("box", { name: "x", w: "w", d: "1", h: "1" })])]);
    expect(vol(r)).toBeCloseTo(6); // the script sees the global w, not build's own
  });
});

describe("scripts", () => {
  test("a program is a list of scripts, and a program of just build is the plain case", () => {
    const p = oneScript([box("a"), box("b"), box("c")]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ name: "build" });
    expect(p[0].at).toBeUndefined();
    expect(topBlocks(p).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  test("only build makes shapes: the other scripts make something only where they are used", () => {
    const r = runProgram(k, three());
    expect(r.problem).toBeUndefined();
    expect(r.shapes.map((s) => s.id)).toEqual(["a1", "a2"]);
  });

  test("where scripts are drawn, and where they are in the list, does not change what is built", () => {
    const moved = three();
    moved[1].at = { x: 0, y: -1 };
    moved[0].at = { x: 30, y: 30 };
    expect(runProgram(k, moved).shapes.map((s) => s.id)).toEqual(["a1", "a2"]);
    expect(runProgram(k, [...three()].reverse()).shapes.map((s) => s.id)).toEqual(["a1", "a2"]);
  });

  test("what the model reads says which script is which, and a program of just build has no headers", () => {
    expect(programView(three()).split("\n").map((l) => l.split(" ")[0])).toEqual(["#", "b1", "#", "c1", "c2", "#", "a1", "a2"]);
    expect(programView(three()).split("\n").filter((l) => l.startsWith("#"))).toEqual(["# script b", "# script c (inputs: w)", "# script build"]);
    expect(programView(oneScript([box("a1")])).split("\n")).toEqual(["a1 box w=10 d=10 h=10"]);
    expect(programView([{ id: "s1", blocks: [set("g")] }, ...oneScript([box("a1")])]).split("\n")[0]).toBe("# globals");
  });
});
