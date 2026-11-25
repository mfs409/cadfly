import { describe, expect, test } from "vitest";
import { accepts, acceptsInScript, allBlocks, blocksWithin, findBuildIndex, canStartScript, createEmptyProgram, findBlock, findScript, freshScriptId, hasBlocks, idCounter, isBlank, isGlobalScript } from "../src/cadfly/language/program";
import type { Block, Program } from "../src/cadfly/language/types";
import { oneScript } from "./helpers/script-helpers";
import { blk } from "./helpers/blocks";

/**
 * Questions about a program's structure: finding blocks and scripts, their ids,
 * and what may go where.
 */

const sample = (): Program =>
  oneScript([
    blk("b1", "set", { name: "w", value: "10" }),
    blk("b2", "extrude", { name: "plate" }, [blk("b3", "rectangle"), blk("b4", "circle", { hole: true })]),
    blk("b5", "box", { name: "box" }),
  ]);

/** Three scripts: build, a function, and a global one */
const scattered = (): Program => [
  { id: "s1", name: "build", at: { x: 5, y: 0 }, blocks: [blk("r1", "box"), blk("r2", "box")] },
  { id: "s2", name: "leg", inputs: "w", at: { x: 0, y: 3 }, blocks: [blk("low", "box")] },
  { id: "s3", blocks: [blk("top", "set")] },
];

describe("finding blocks", () => {
  test("anywhere in the program, with where it sits", () => {
    const p = sample();
    expect(findBlock(p, "b5")).toMatchObject({ index: 2, parent: null });
    expect(findBlock(p, "b5")!.script).toBe(p[0]);
    const inner = findBlock(p, "b4")!;
    expect(inner.script).toBe(p[0]);
    expect(inner.index).toBe(1);
    expect(inner.parent!.id).toBe("b2");
    expect(inner.siblings).toBe(p[0].blocks[1].inner);
    expect(findBlock(p, "nope")).toBeUndefined();
  });

  test("it says which script a block is in, at any depth, and points into the script's own list", () => {
    const p = scattered();
    expect(findBlock(p, "r2")).toMatchObject({ index: 1, parent: null });
    expect(findBlock(p, "r2")!.script).toBe(p[0]);
    expect(findBlock(p, "r2")!.siblings).toBe(p[0].blocks);
    expect(findBlock(p, "low")).toMatchObject({ index: 0 });
    expect(findBlock(p, "low")!.script).toBe(p[1]);
    expect(findBlock(p, "top")).toMatchObject({ index: 0 });
    expect(findBlock(p, "top")!.script).toBe(p[2]);
    const nested: Program = [...p, { id: "s9", name: "deep", blocks: [blk("t", "transform", {}, [blk("deep", "box")])] }];
    expect(findBlock(nested, "deep")).toMatchObject({ index: 0, parent: nested[3].blocks[0] });
    expect(findBlock(nested, "deep")!.script).toBe(nested[3]);
  });

  test("allBlocks lists outer blocks before the ones inside, script by script", () => {
    expect(allBlocks(sample()).map((b) => b.id)).toEqual(["b1", "b2", "b3", "b4", "b5"]);
    expect(allBlocks(scattered()).map((b) => b.id)).toEqual(["r1", "r2", "low", "top"]);
    expect(allBlocks([])).toEqual([]);
  });

  test("blocksWithin does the same for a list of blocks", () => {
    expect(blocksWithin(sample()[0].blocks.slice(1, 2)).map((b) => b.id)).toEqual(["b2", "b3", "b4"]);
  });
});

describe("the scripts of a program", () => {
  test("the empty program is one empty build, and has no blocks", () => {
    expect(createEmptyProgram()).toEqual([{ id: "s1", name: "build", blocks: [] }]);
    expect(isBlank(createEmptyProgram())).toBe(true);
    expect(hasBlocks(createEmptyProgram())).toBe(false);
    expect(isBlank(sample())).toBe(false);
    expect(hasBlocks(sample())).toBe(true);
    // an empty build beside another script is not blank: that script is something
    expect(isBlank([...createEmptyProgram(), { id: "s1", name: "leg", blocks: [] }])).toBe(false);
    expect(createEmptyProgram()).not.toBe(createEmptyProgram()); // a new one each time
  });

  test("build is found by name, wherever it is in the list", () => {
    expect(findBuildIndex(scattered())).toBe(0);
    expect(findBuildIndex([{ id: "s1", blocks: [] }, { id: "s2", name: "build", blocks: [] }])).toBe(1);
    expect(findBuildIndex([])).toBe(-1);
  });

  test("a script with no name is a global one", () => {
    expect(isGlobalScript({ id: "s1", blocks: [] })).toBe(true);
    expect(isGlobalScript({ id: "s1", name: "build", blocks: [] })).toBe(false);
    expect(isGlobalScript({ id: "s1", name: "leg", blocks: [] })).toBe(false);
  });
});

describe("ids and names", () => {
  test("a fresh id is one nobody uses, counting blocks inside others", () => {
    expect(idCounter(sample())()).toBe("b6");
    expect(idCounter([])()).toBe("b1");
    expect(idCounter(sample(), [blk("b9", "box")])()).toBe("b10");
    expect(idCounter(scattered())()).toBe("b1"); // none of those ids is bN
  });

  test("idCounter counts up from the largest id, and leaves out those taken by blocks made but not in the program yet", () => {
    const next = idCounter(sample(), [blk("b9", "box")]);
    expect([next(), next(), next()]).toEqual(["b10", "b11", "b12"]);
    expect(idCounter([])()).toBe("b1");
  });
});

describe("script ids", () => {
  test("a fresh script id is one more than the largest sN, and a gap is not filled", () => {
    expect(freshScriptId(createEmptyProgram())).toBe("s2");
    expect(freshScriptId([])).toBe("s1");
    expect(freshScriptId([{ id: "s1", blocks: [] }, { id: "s7", blocks: [] }, { id: "s3", blocks: [] }])).toBe("s8");
    expect(freshScriptId([{ id: "mine", blocks: [] }, { id: "s2x", blocks: [] }])).toBe("s1"); // not sN: nothing to count
  });

  test("findScript gives where the script is now, which changes as others come and go, or nothing if it is not there", () => {
    const p: Program = [{ id: "s1", name: "build", blocks: [] }, { id: "s2", name: "f", blocks: [] }, { id: "s3", name: "g", blocks: [] }];
    expect(findScript(p, "s3")).toBe(2);
    expect(findScript([p[0], p[2]], "s3")).toBe(1);
    expect(findScript(p, "s4")).toBeUndefined();
    expect(findScript([], "s1")).toBeUndefined();
  });

  test("a new empty program is one build with the first id", () => {
    expect(createEmptyProgram()).toEqual([{ id: "s1", name: "build", blocks: [] }]);
  });
});

describe("what goes where", () => {
  test("the top of build, or of a function, takes statements and flat shapes, not the parts of a block", () => {
    for (const script of [{ id: "s1", name: "build", blocks: [] }, { id: "s2", name: "leg", blocks: [] }]) {
      expect(acceptsInScript(script, "box")).toBe(true);
      expect(acceptsInScript(script, "extrude")).toBe(true);
      expect(acceptsInScript(script, "use")).toBe(true);
      expect(acceptsInScript(script, "rectangle")).toBe(true); // a flat shape is a shape of its own
      expect(acceptsInScript(script, "point")).toBe(false);
      expect(acceptsInScript(script, "nonsense")).toBe(false);
    }
  });

  test("a global script takes only set blocks", () => {
    expect(acceptsInScript({ id: "s1", blocks: [] }, "set")).toBe(true);
    for (const kind of ["box", "extrude", "use", "repeat", "rectangle", "point", "nonsense"]) expect(acceptsInScript({ id: "s1", blocks: [] }, kind), kind).toBe(false);
  });

  test("only set blocks can start a new global script (what a drop in empty space does)", () => {
    expect(canStartScript([blk("a", "set")])).toBe(true);
    expect(canStartScript([blk("a", "set"), blk("b", "set")])).toBe(true);
    expect(canStartScript([])).toBe(false);
    expect(canStartScript([blk("a", "box")])).toBe(false);
    expect(canStartScript([blk("a", "set"), blk("b", "box")])).toBe(false);
  });

  test("a holder takes the kinds it lists, and nothing takes an unknown kind", () => {
    expect(accepts("transform", "box")).toBe(true);
    expect(accepts("transform", "nonsense")).toBe(false);
    expect(accepts("nonsense", "box")).toBe(false);
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
