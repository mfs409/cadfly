import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { COMMANDS } from "../src/cadfly/language/commands";
import { accepts, allBlocks, findBlock, freshId, insertStack, newBlockFor, setArg, setCollapsed, takeBlock } from "../src/cadfly/language/edit";
import { validateProgram } from "../src/cadfly/language/format";
import { runProgram } from "../src/cadfly/language/run";
import type { Block, Program } from "../src/cadfly/language/types";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id, kind, args, ...(inner ? { inner } : {}) });

const sample = (): Program => [
  blk("b1", "set", { name: "w", value: "10" }),
  blk("b2", "extrude", { name: "plate" }, [blk("b3", "rectangle"), blk("b4", "circle", { hole: true })]),
  blk("b5", "box", { name: "box" }),
];

describe("finding blocks", () => {
  test("anywhere in the program, with where it sits", () => {
    const p = sample();
    expect(findBlock(p, "b5")).toMatchObject({ index: 2, parent: null });
    const inner = findBlock(p, "b4")!;
    expect(inner.index).toBe(1);
    expect(inner.parent!.id).toBe("b2");
    expect(inner.list).toBe(p[1].inner);
    expect(findBlock(p, "nope")).toBeUndefined();
  });

  test("allBlocks lists outer blocks before the ones inside", () => {
    expect(allBlocks(sample()).map((b) => b.id)).toEqual(["b1", "b2", "b3", "b4", "b5"]);
  });
});

describe("moving blocks", () => {
  test("putting a block back at the same place restores the program", () => {
    const p = sample();
    const { program, stack } = takeBlock(p, "b2");
    expect(insertStack(program, { parentId: null, index: 1 }, stack)).toEqual(p);
  });

  test("a block goes in front of what was in the slot", () => {
    const { program, stack } = takeBlock(sample(), "b5");
    const moved = insertStack(program, { parentId: null, index: 0 }, stack);
    expect(moved.map((b) => b.id)).toEqual(["b5", "b1", "b2"]);
    const inside = insertStack(program, { parentId: "b2", index: 1 }, [blk("b9", "polygon", {}, [])]);
    expect(inside[1].inner!.map((b) => b.id)).toEqual(["b3", "b9", "b4"]);
  });

  test("a slot in a block that is not there is an error", () => {
    expect(() => insertStack(sample(), { parentId: "zz", index: 0 }, [])).toThrow(/no such block/);
  });
});

describe("changing a field", () => {
  test("only that field of that block, on a copy", () => {
    const p = sample();
    const next = setArg(p, "b4", "hole", false);
    expect(findBlock(next, "b4")!.block.args.hole).toBe(false);
    expect(findBlock(p, "b4")!.block.args.hole).toBe(true);
    expect(setArg(p, "nope", "x", "1")).toEqual(p);
  });
});

describe("ids and names", () => {
  test("a fresh id is one nobody uses, counting blocks inside others", () => {
    expect(freshId(sample())).toBe("b6");
    expect(freshId([])).toBe("b1");
    expect(freshId(sample(), [blk("b9", "box")])).toBe("b10");
  });
});

describe("what goes where", () => {
  test("the top of a program takes statements and flat shapes, not the parts of a block", () => {
    expect(accepts(null, "box")).toBe(true);
    expect(accepts(null, "extrude")).toBe(true);
    expect(accepts(null, "rectangle")).toBe(true); // a flat shape is a shape of its own
    expect(accepts(null, "point")).toBe(false);
    expect(accepts(null, "nonsense")).toBe(false);
  });

  test("an extrude takes flat shapes (not solids), and a polygon takes points", () => {
    for (const parent of ["extrude", "revolve"]) {
      expect(accepts(parent, "rectangle")).toBe(true);
      expect(accepts(parent, "circle")).toBe(true);
      expect(accepts(parent, "polygon")).toBe(true);
      expect(accepts(parent, "transform")).toBe(true); // a flat shape can be moved
      expect(accepts(parent, "box")).toBe(false);
      expect(accepts(parent, "point")).toBe(false);
    }
    expect(accepts("polygon", "point")).toBe(true);
    expect(accepts("polygon", "circle")).toBe(false);
    expect(accepts("box", "rectangle")).toBe(false);
  });
});

describe("making a new block", () => {
  test("it has a fresh id, and no caption until someone adds one", () => {
    const p: Program = [blk("b1", "box", { name: "plate" })];
    const made = newBlockFor(p, "box");
    expect(made.id).toBe("b2");
    expect(made.args.name).toBe("");
  });

  test("a sketch block starts with a piece inside it, with its own id", () => {
    const made = newBlockFor([blk("b1", "box", { name: "box" })], "extrude");
    expect(made.id).toBe("b2");
    expect(made.inner!.map((b) => [b.id, b.kind])).toEqual([["b3", "rectangle"]]);
    const ring = newBlockFor([], "revolve");
    expect(ring.inner![0].args).toMatchObject({ u: "2", v: "0", w: "3", h: "10" });
    const poly = newBlockFor([], "polygon");
    expect(poly.inner!.map((b) => b.kind)).toEqual(["point", "point", "point"]);
    expect(new Set(allBlocks([poly]).map((b) => b.id)).size).toBe(4);
  });

  test("every kind of block can be made, and a program of them is valid", () => {
    // a piece has to go inside its parent to be valid
    let p: Program = [];
    for (const def of COMMANDS.filter((c) => !c.piece)) {
      p = [...p, newBlockFor(p, def.id)];
    }
    validateProgram(p);
    expect(new Set(allBlocks(p).map((b) => b.id)).size).toBe(allBlocks(p).length);
    expect(newBlockFor(p, "rectangle").kind).toBe("rectangle");
  });

  test("blocks dropped from the palette make a program that runs", () => {
    let p: Program = [];
    p = [...p, newBlockFor(p, "box")];
    p = [...p, newBlockFor(p, "extrude")];
    p = [...p, newBlockFor(p, "revolve")];
    p = [...p, newBlockFor(p, "cylinder")];
    const r = runProgram(k, p);
    expect(r.problem).toBeUndefined();
    expect(r.shapes.map((s) => s.name)).toEqual(["box", "extrude", "revolve", "cylinder"]); // nothing is named, so each is called what it is
  });
});

describe("folding", () => {
  const p: Program = [blk("b1", "transform", {}, [blk("b2", "box")]), blk("b3", "box")];

  test("setCollapsed folds and opens a block, leaving everything else as it was", () => {
    const folded = setCollapsed(p, "b1", true);
    expect(folded[0].collapsed).toBe(true);
    expect(folded[0].inner).toEqual(p[0].inner);
    expect(folded[1]).toEqual(p[1]);
    expect(p[0].collapsed).toBeUndefined(); // the original is untouched
    const open = setCollapsed(folded, "b1", false);
    expect(open).toEqual(p); // not even a "collapsed: false" is left behind
    expect("collapsed" in open[0]).toBe(false);
  });

  test("a block inside another can be folded, and an unknown id changes nothing", () => {
    const nested: Program = [blk("b1", "union", {}, [blk("b2", "transform", {}, [blk("b3", "box")])])];
    expect(setCollapsed(nested, "b2", true)[0].inner![0].collapsed).toBe(true);
    expect(setCollapsed(p, "zz", true)).toEqual(p);
  });

  test("folding does not change what the program builds", async () => {
    const run = (prog: Program) => runProgram(k, prog).combined?.volume();
    expect(run(setCollapsed(p, "b1", true))).toBeCloseTo(run(p)!);
  });

  test("the file format checks the flag", () => {
    expect(() => validateProgram([{ id: "a", kind: "transform", args: {}, inner: [{ id: "b", kind: "box", args: {} }], collapsed: true }])).not.toThrow();
    expect(() => validateProgram([{ id: "a", kind: "transform", args: {}, inner: [], collapsed: "yes" }])).toThrow(/collapsed must be true or false/);
  });
});
