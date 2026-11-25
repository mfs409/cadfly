import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { COMMANDS } from "../src/cadfly/language/commands";
import { createBlock, fillFaces, insertBlocks, setArg, setFlag, setScriptFold, takeBlock, addScript, dropBlocks, moveScript, removeScript, setScriptInputs, setScriptName, takeOutOfHolder, moveIntoNewHolder } from "../src/cadfly/language/edit";
import { allBlocks, blocksWithin, findBlock, findScript, blocksToWrap, createEmptyProgram, freshScriptName } from "../src/cadfly/language/program";
import { validateProgram } from "../src/cadfly/language/format";
import { runProgram } from "../src/cadfly/language/run";
import type { Block, Program } from "../src/cadfly/language/types";
import { oneScript } from "./helpers/script-helpers";
import { blk, box, set, ids, columns, three } from "./helpers/blocks";

/**
 * Editing a program: moving, inserting, taking, wrapping and folding blocks and
 * scripts, with every edit returning a fresh program and never changing the one
 * it was given.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const sample = (): Program =>
  oneScript([
    blk("b1", "set", { name: "w", value: "10" }),
    blk("b2", "extrude", { name: "plate" }, [blk("b3", "rectangle"), blk("b4", "circle", { hole: true })]),
    blk("b5", "box", { name: "box" }),
  ]);

/** An edit that changes nothing still gives a new program: equal to the old one, but not the same object */
function sameButCopy(out: Program, before: Program) {
  expect(out).toEqual(before);
  expect(out).not.toBe(before);
}

describe("moving blocks", () => {
  test("putting a block back at the same place restores the program", () => {
    const p = sample();
    const { program, blocks } = takeBlock(p, "b2");
    expect(insertBlocks(program, { scriptId: "s1", index: 1 }, blocks)).toEqual(p);
  });

  test("a block goes in front of what was at the insert point", () => {
    const { program, blocks } = takeBlock(sample(), "b5");
    const moved = insertBlocks(program, { scriptId: "s1", index: 0 }, blocks);
    expect(moved[0].blocks.map((b) => b.id)).toEqual(["b5", "b1", "b2"]);
    const inside = insertBlocks(program, { parentId: "b2", index: 1 }, [blk("b9", "polygon", {}, [])]);
    expect(inside[0].blocks[1].inner!.map((b) => b.id)).toEqual(["b3", "b9", "b4"]);
  });

  test("an insert point in a block that is not there is an error", () => {
    expect(() => insertBlocks(sample(), { parentId: "zz", index: 0 }, [blk("b9", "box")])).toThrow(/no such block/);
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

describe("making a new block", () => {
  test("it has a fresh id, and no caption until someone adds one", () => {
    const p = oneScript([blk("b1", "box", { name: "plate" })]);
    const made = createBlock(p, "box");
    expect(made.id).toBe("b2");
    expect(made.args.name).toBe("");
  });

  test("a sketch block starts with a piece inside it, with its own id", () => {
    const made = createBlock(oneScript([blk("b1", "box", { name: "box" })]), "extrude");
    expect(made.id).toBe("b2");
    expect(made.inner!.map((b) => [b.id, b.kind])).toEqual([["b3", "rectangle"]]);
    const ring = createBlock([], "revolve");
    expect(ring.inner![0].args).toMatchObject({ u: "2", v: "0", w: "3", h: "10" });
    const poly = createBlock([], "polygon");
    expect(poly.inner!.map((b) => b.kind)).toEqual(["point", "point", "point"]);
    expect(new Set(blocksWithin([poly]).map((b) => b.id)).size).toBe(4);
  });

  test("every kind of block can be made, and a program of them is valid", () => {
    // a piece has to go inside its parent to be valid
    let p: Program = [];
    for (const def of COMMANDS.filter((c) => !c.piece)) {
      p = insertBlocks(p, { end: true }, [createBlock(p, def.id)]);
    }
    validateProgram(p);
    expect(p).toHaveLength(1);
    expect(new Set(allBlocks(p).map((b) => b.id)).size).toBe(allBlocks(p).length);
    expect(createBlock(p, "rectangle").kind).toBe("rectangle");
  });

  test("blocks dropped from the palette make a program that runs", () => {
    let p: Program = [];
    for (const kind of ["box", "extrude", "revolve", "cylinder"]) p = insertBlocks(p, { end: true }, [createBlock(p, kind)]);
    const r = runProgram(k, p);
    expect(r.problem).toBeUndefined();
    expect(r.shapes.map((s) => s.name)).toEqual(["box", "extrude", "revolve", "cylinder"]); // nothing is named, so each is called what it is
  });
});

describe("folding", () => {
  const p = oneScript([blk("b1", "transform", {}, [blk("b2", "box")]), blk("b3", "box")]);

  test("setFlag folds and opens a block, leaving everything else as it was", () => {
    const folded = setFlag(p, "b1", "collapsed", true);
    const [first, second] = folded[0].blocks;
    expect(first.collapsed).toBe(true);
    expect(first.inner).toEqual(p[0].blocks[0].inner);
    expect(second).toEqual(p[0].blocks[1]);
    expect(p[0].blocks[0].collapsed).toBeUndefined(); // the original is untouched
    const open = setFlag(folded, "b1", "collapsed", false);
    expect(open).toEqual(p); // not even a "collapsed: false" is left behind
    expect("collapsed" in open[0].blocks[0]).toBe(false);
  });

  test("a block inside another can be folded, and an unknown id changes nothing", () => {
    const nested = oneScript([blk("b1", "union", {}, [blk("b2", "transform", {}, [blk("b3", "box")])])]);
    expect(setFlag(nested, "b2", "collapsed", true)[0].blocks[0].inner![0].collapsed).toBe(true);
    expect(setFlag(p, "zz", "collapsed", true)).toEqual(p);
  });

  test("folding does not change what the program builds", async () => {
    const run = (prog: Program) => runProgram(k, prog).combined?.volume();
    expect(run(setFlag(p, "b1", "collapsed", true))).toBeCloseTo(run(p)!);
  });

  test("the file format checks the flag", () => {
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "transform", args: {}, inner: [{ id: "b", kind: "box", args: {} }], collapsed: true }] }])).not.toThrow();
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "a", kind: "transform", args: {}, inner: [], collapsed: "yes" }] }])).toThrow(/collapsed must be true or false/);
  });
});

describe("carrying blocks out of a script", () => {
  const floating = (): Program => [{ id: "s1", name: "build", at: { x: 2, y: 3 }, collapsed: true, blocks: [blk("b1", "box"), blk("b2", "union", {}, [])] }];

  test("blocks taken out and put into a holder keep nothing of the script they came from, so the program is valid", () => {
    const { program, blocks } = takeBlock(floating(), "b1");
    const next = insertBlocks(program, { parentId: "b2", index: 0 }, blocks);
    expect(findBlock(next, "b1")!.block).toEqual(blk("b1", "box"));
    expect(() => validateProgram(next)).not.toThrow();
    expect(next[0]).toMatchObject({ at: { x: 2, y: 3 }, collapsed: true }); // the script itself is as it was
  });

  test("the blocks given are not changed", () => {
    const { blocks } = takeBlock(floating(), "b1");
    const before = structuredClone(blocks);
    insertBlocks(floating(), { parentId: "b2", index: 0 }, blocks);
    expect(blocks).toEqual(before);
  });

  test("picking a script up block by block and putting the blocks down again elsewhere makes a new script, and leaves build empty", () => {
    const first = takeBlock(floating(), "b1");
    const second = takeBlock(first.program, "b2");
    expect(second.program).toEqual([{ id: "s1", name: "build", at: { x: 2, y: 3 }, collapsed: true, blocks: [] }]); // build stays, empty
    const placed = insertBlocks(second.program, { newScript: { at: { x: 1, y: 1 } } }, [...first.blocks, ...second.blocks]);
    expect(placed[1]).toEqual({ id: "s2", at: { x: 1, y: 1 }, blocks: [blk("b1", "box"), blk("b2", "union", {}, [])] });
  });
});

describe("putting down no blocks", () => {
  test("gives back the program as it was, wherever it would have gone", () => {
    const p = sample();
    sameButCopy(insertBlocks(p, { scriptId: "s1", index: 1 }, []), p);
    sameButCopy(insertBlocks(p, { scriptId: "s1", index: 0 }, []), p);
    sameButCopy(insertBlocks(p, { parentId: "b2", index: 0 }, []), p);
    sameButCopy(insertBlocks(p, { newScript: { at: { x: 1, y: 1 } } }, []), p);
    expect(insertBlocks([], { newScript: { at: { x: 1, y: 1 } } }, [])).toEqual([]);
  });
});

describe("a change that changes nothing still gives a new program", () => {
  const p = oneScript([blk("b1", "transform", { x: "1" }, [blk("b2", "box")]), blk("b3", "box")]);

  test("setFlag: a block that is not there, or already as asked", () => {
    sameButCopy(setFlag(p, "zz", "hidden", true), p);
    sameButCopy(setFlag(p, "b3", "hidden", false), p);
    const hidden = setFlag(p, "b3", "hidden", true);
    expect(hidden).not.toBe(p);
    sameButCopy(setFlag(hidden, "b3", "hidden", true), hidden);
    expect(p[0].blocks[1].hidden).toBeUndefined();
  });

  test("setFlag: every setting, on and off", () => {
    for (const flag of ["collapsed", "hidden", "disabled"] as const) {
      const on = setFlag(p, "b1", flag, true);
      expect(on[0].blocks[0][flag]).toBe(true);
      expect(flag in setFlag(on, "b1", flag, false)[0].blocks[0]).toBe(false);
    }
  });

  test("setArg: a block that is not there, or a field that already holds that", () => {
    sameButCopy(setArg(p, "zz", "x", "2"), p);
    sameButCopy(setArg(p, "b1", "x", "1"), p);
    expect(setArg(p, "b1", "x", "2")[0].blocks[0].args.x).toBe("2");
  });

  test("setScriptFold: a script that is not there", () => {
    sameButCopy(setScriptFold(p, "s5", true), p);
  });

  test("fillFaces: no such block, or no faces", () => {
    sameButCopy(fillFaces(p, "zz", [[1, 2, 3]]), p);
    sameButCopy(fillFaces(p, "b1", []), p);
  });

  test("takeBlock: a block that is not there", () => {
    sameButCopy(takeBlock(p, "zz").program, p);
  });
});

describe("making blocks with ids", () => {
  test("createBlock gives a block and what it starts out holding different ids, none that the program uses", () => {
    const made = createBlock(sample(), "loft");
    const ids = blocksWithin([made]).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("b6");
    expect(ids.every((id) => !allBlocks(sample()).some((b) => b.id === id))).toBe(true);
    expect(() => createBlock(sample(), "nope")).toThrow(/no such command/);
  });

  test("a kind with no starter starts out empty", () => {
    expect(createBlock([], "box").inner).toBeUndefined();
    expect(createBlock([], "union").inner).toEqual([]);
  });
});

describe("taking and putting down scripts", () => {
  test("dropping at a place starts a new global script there, at the end of the program", () => {
    const next = insertBlocks(oneScript([box("a1")]), { newScript: { at: { x: 4.2345, y: 2 } } }, [set("n1"), set("n2", "d")]);
    expect(columns(next)).toEqual([["a1"], ["n1", "n2"]]);
    expect(next[1].at).toEqual({ x: 4.23, y: 2 });
    expect(next[1].name).toBeUndefined();
    expect(next[0].at).toBeUndefined();
  });

  test("a place cannot be negative, and a new script may have no place at all", () => {
    expect(insertBlocks(createEmptyProgram(), { newScript: { at: { x: -3, y: 1 } } }, [set("n")])[1]).toEqual({ id: "s2", at: { x: 0, y: 1 }, blocks: [set("n")] });
    expect(insertBlocks(createEmptyProgram(), { newScript: {} }, [set("n")])[1]).toEqual({ id: "s2", blocks: [set("n")] });
  });

  test("dropping into the middle or the end of a script adds to that script", () => {
    const mid = insertBlocks(three(), { scriptId: "s1", index: 1 }, [box("n")]);
    expect(columns(mid)).toEqual([["a1", "n", "a2"], ["b1"], ["c1", "c2"]]);
    const end = insertBlocks(three(), { scriptId: "s1", index: 2 }, [box("n")]);
    expect(columns(end)).toEqual([["a1", "a2", "n"], ["b1"], ["c1", "c2"]]);
    expect(end[1].at).toEqual({ x: 0, y: 5 }); // b is still b
  });

  test("dropping above a script makes the new blocks its first, and the script keeps its place and its fold", () => {
    const next = insertBlocks(setScriptFold(three(), "s2", true), { scriptId: "s2", index: 0 }, [box("n")]);
    expect(columns(next)).toEqual([["a1", "a2"], ["n", "b1"], ["c1", "c2"]]);
    expect(next[1].at).toEqual({ x: 0, y: 5 });
    expect(next[1].collapsed).toBe(true);
    expect(columns(insertBlocks(three(), { scriptId: "s1", index: 0 }, [box("n")]))[0]).toEqual(["n", "a1", "a2"]);
  });

  test("a script that is not there is an error, in a program that has none or has some", () => {
    expect(() => insertBlocks([], { scriptId: "s1", index: 0 }, [box("n")])).toThrow(/no such script/);
    expect(() => insertBlocks(three(), { scriptId: "s4", index: 0 }, [box("n")])).toThrow(/no such script/);
    expect(() => insertBlocks(three(), { scriptId: "nope", index: 0 }, [box("n")])).toThrow(/no such script/);
  });

  test("the blocks given are copied, and the program given is not changed", () => {
    const p = three();
    const n = box("n");
    const next = insertBlocks(p, { scriptId: "s3", index: 2 }, [n]);
    expect(columns(p)).toEqual([["a1", "a2"], ["b1"], ["c1", "c2"]]);
    expect(next[2].blocks[2]).toEqual(n);
    expect(next[2].blocks[2]).not.toBe(n);
  });

  test("removing the first block of a script leaves the script where it is", () => {
    const p = takeBlock(three(), "c1").program; // c1 goes
    expect(columns(p)).toEqual([["a1", "a2"], ["b1"], ["c2"]]);
    expect(p[2].at).toEqual({ x: 6, y: 0 });
    const q = takeBlock(setScriptFold(three(), "s3", true), "c1").program;
    expect(q[2].collapsed).toBe(true);
  });

  test("removing the last block of a named script leaves it, empty, and removing the last block of a global script removes it", () => {
    const p = takeBlock(three(), "b1").program;
    expect(columns(p)).toEqual([["a1", "a2"], [], ["c1", "c2"]]);
    expect(p[1]).toEqual({ id: "s2", name: "b", at: { x: 0, y: 5 }, blocks: [] });
    expect(takeBlock(oneScript([box("only")]), "only").program).toEqual(createEmptyProgram());
    const withGlobal: Program = [{ id: "s1", blocks: [set("g")] }, ...three()];
    expect(takeBlock(withGlobal, "g").program).toEqual(three());
  });

  test("a block inside a holder can be taken without changing its script", () => {
    const p = oneScript([blk("m", "transform", {}, { inner: [box("c")] })]);
    const { program, blocks } = takeBlock(p, "c");
    expect(ids(blocks)).toEqual(["c"]);
    expect(program).toHaveLength(1);
    expect(program[0].blocks[0].inner).toEqual([]);
  });

  test("{ end: true } puts blocks at the end of build, wherever build is", () => {
    const names = (p: Program) => p.map((s) => s.blocks.map((b) => b.id).join(""));
    expect(names(insertBlocks(oneScript([box("a"), box("b")]), { end: true }, [box("x")]))).toEqual(["abx"]);
    expect(names(insertBlocks(three(), { end: true }, [box("x")]))).toEqual(["a1a2x", "b1", "c1c2"]);
    const reordered = [...three()].reverse();
    expect(names(insertBlocks(reordered, { end: true }, [box("x")]))).toEqual(["c1c2", "b1", "a1a2x"]);
  });

  test("{ end: true } in an empty build puts the blocks in it, and with no build at all makes one", () => {
    expect(insertBlocks(createEmptyProgram(), { end: true }, [box("x"), box("y")])).toEqual(oneScript([box("x"), box("y")]));
    const p = insertBlocks([], { end: true }, [box("x"), box("y")]);
    expect(p).toEqual([{ id: "s1", name: "build", blocks: [box("x"), box("y")] }]);
    expect(p[0].at).toBeUndefined();
    expect(insertBlocks(three(), { end: true }, [])).toEqual(three());
  });
});

describe("making, removing and renaming named scripts", () => {
  test("addScript adds an empty named script at the end, with inputs and a place if given", () => {
    const next = addScript(oneScript([box("a")]), "leg", " x, y ", { x: 3.5, y: -2 });
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ id: "s2", name: "leg", inputs: "x, y", at: { x: 3.5, y: 0 }, blocks: [] });
    expect(addScript(createEmptyProgram(), "leg")[1]).toEqual({ id: "s2", name: "leg", blocks: [] }); // no inputs, no place
    expect(() => validateProgram(next)).not.toThrow();
  });

  test("addScript refuses a name that is not a name, a reserved word, or one that is used, and inputs that are not names", () => {
    const p = three();
    expect(() => addScript(p, "2x")).toThrow(/is not a name/);
    expect(() => addScript(p, "")).toThrow(/is not a name/);
    expect(() => addScript(p, "pi")).toThrow(/built in/);
    expect(() => addScript(p, "build")).toThrow(/already a script called "build"/);
    expect(() => addScript(p, "b")).toThrow(/already a script called "b"/);
    expect(() => addScript(p, "ok", "w, w")).toThrow(/used twice/);
    expect(() => addScript(p, "ok", "w, 2h")).toThrow(/is not a name/);
    expect(columns(p)).toEqual([["a1", "a2"], ["b1"], ["c1", "c2"]]); // the program given is not changed
  });

  test("removeScript removes a script with its blocks, but never build", () => {
    expect(columns(removeScript(three(), "s3"))).toEqual([["a1", "a2"], ["b1"]]);
    expect(columns(removeScript(three(), "s2"))).toEqual([["a1", "a2"], ["c1", "c2"]]);
    expect(() => removeScript(three(), "s1")).toThrow(/cannot be removed/);
    expect(() => removeScript(three(), "s4")).toThrow(/no such script/);
    expect(columns(removeScript([{ id: "g1", blocks: [set("g")] }, ...three()], "g1"))).toEqual([["a1", "a2"], ["b1"], ["c1", "c2"]]); // a global script can go
  });

  test("setScriptName renames a function, but not build, a global script, or onto a name that is used", () => {
    expect(setScriptName(three(), "s2", "leg")[1]).toEqual({ id: "s2", name: "leg", at: { x: 0, y: 5 }, blocks: [box("b1")] });
    expect(setScriptName(three(), "s2", "b")[1].name).toBe("b"); // to the same name is fine
    expect(() => setScriptName(three(), "s2", "c")).toThrow(/already a script called "c"/);
    expect(() => setScriptName(three(), "s2", "build")).toThrow(/already a script called "build"/);
    expect(() => setScriptName(three(), "s2", "1b")).toThrow(/is not a name/);
    expect(() => setScriptName(three(), "s1", "main")).toThrow(/cannot be renamed/);
    expect(() => setScriptName([{ id: "g1", blocks: [set("g")] }, ...three()], "g1", "x")).toThrow(/global script has no name/);
    expect(() => setScriptName(three(), "s8", "x")).toThrow(/no such script/);
  });

  test("setScriptInputs changes or clears a function's inputs, but build and a global script have none", () => {
    expect(setScriptInputs(three(), "s2", "x, y")[1].inputs).toBe("x, y");
    expect("inputs" in setScriptInputs(three(), "s3", "")[2]).toBe(false);
    expect(() => setScriptInputs(three(), "s2", "x, x")).toThrow(/used twice/);
    expect(() => setScriptInputs(three(), "s1", "x")).toThrow(/has no inputs/);
    expect(() => setScriptInputs([{ id: "g1", blocks: [set("g")] }, ...three()], "g1", "x")).toThrow(/global script has no inputs/);
    expect(() => setScriptInputs(three(), "s10", "x")).toThrow(/no such script/);
  });
});

describe("folding a script", () => {
  test("setScriptFold folds and opens one script, leaving everything else as it was", () => {
    const p = three();
    const folded = setScriptFold(p, "s3", true);
    expect(folded[2].collapsed).toBe(true);
    expect(folded[2].blocks).toEqual(p[2].blocks);
    expect(folded[2].at).toEqual({ x: 6, y: 0 });
    expect(folded[0]).toEqual(p[0]);
    expect(p[2].collapsed).toBeUndefined(); // the original is untouched
    const open = setScriptFold(folded, "s3", false);
    expect(open).toEqual(p); // not even a "collapsed: false" is left behind
    expect("collapsed" in open[2]).toBe(false);
  });

  test("a script that is not there changes nothing, but still gives a new program", () => {
    const p = three();
    for (const n of ["nope", "s4"]) {
      const out = setScriptFold(p, n, true);
      expect(out).toEqual(p);
      expect(out).not.toBe(p);
    }
  });

  test("folding does not change what the program builds", () => {
    const run = (prog: Program) => runProgram(k, prog).combined?.volume();
    expect(run(setScriptFold(three(), "s1", true))).toBeCloseTo(run(three())!);
  });
});

describe("wrapping and unwrapping blocks in the program", () => {
  const holder = () => ({ id: "h", kind: "union", args: {} }) as Block;

  test("moveIntoNewHolder puts the holder where the first block was, in its script, and gathers the others", () => {
    const p = setScriptFold(three(), "s3", true);
    const next = moveIntoNewHolder(p, ["c1", "a2"], holder());
    expect(columns(next)).toEqual([["a1"], ["b1"], ["h", "c2"]]);
    expect(ids(next[2].blocks[0].inner!)).toEqual(["c1", "a2"]);
    expect(next[2]).toMatchObject({ at: { x: 6, y: 0 }, collapsed: true });
    expect(() => validateProgram(next)).not.toThrow();
    expect(columns(p)).toEqual([["a1", "a2"], ["b1"], ["c1", "c2"]]); // the program given is not changed
  });

  test("a named script whose only block is wrapped into a holder somewhere else stays, empty; a global script is gone", () => {
    const next = moveIntoNewHolder(three(), ["a1", "b1"], holder());
    expect(columns(next)).toEqual([["h", "a2"], [], ["c1", "c2"]]);
    expect(next[1].at).toEqual({ x: 0, y: 5 });
    const withGlobal: Program = [{ id: "s1", blocks: [set("g")] }, ...three()];
    expect(columns(moveIntoNewHolder(withGlobal, ["a1", "g"], holder()))).toEqual([["h", "a2"], ["b1"], ["c1", "c2"]]);
  });

  test("the new blocks go inside after the wrapped ones, and are copied", () => {
    const extra = box("x");
    const next = moveIntoNewHolder(three(), ["b1"], holder(), [extra]);
    expect(ids(next[1].blocks[0].inner!)).toEqual(["b1", "x"]);
    expect(next[1].blocks[0].inner![1]).not.toBe(extra);
  });

  test("a block that is not there is an error", () => {
    expect(() => moveIntoNewHolder(three(), ["a1", "zz"], holder())).toThrow(/no block "zz"/);
  });

  test("takeOutOfHolder puts what was inside in the holder's place, in its script", () => {
    const wrapped = moveIntoNewHolder(three(), ["c1", "c2"], holder());
    expect(columns(wrapped)).toEqual([["a1", "a2"], ["b1"], ["h"]]);
    const next = takeOutOfHolder(wrapped, "h");
    expect(columns(next)).toEqual([["a1", "a2"], ["b1"], ["c1", "c2"]]);
    expect(next[2].at).toEqual({ x: 6, y: 0 });
    const missing = takeOutOfHolder(wrapped, "zz");
    expect(missing).toEqual(wrapped);
    expect(missing).not.toBe(wrapped);
  });

  test("taking the contents out of an empty block that was alone in a function leaves the function, and removes a global script", () => {
    const p: Program = [{ id: "s1", name: "build", blocks: [box("a")] }, { id: "s2", name: "f", at: { x: 1, y: 1 }, blocks: [blk("h", "union", {}, { inner: [] })] }];
    expect(columns(takeOutOfHolder(p, "h"))).toEqual([["a"], []]);
  });
});

describe("moving a script", () => {
  test("it goes to the new place, and nothing else changes", () => {
    const p = three();
    const next = moveScript(p, "s2", { x: 3, y: 4 });
    expect(next[1].at).toEqual({ x: 3, y: 4 });
    expect(next[1].blocks).toEqual(p[1].blocks);
    expect([next[0], next[2]]).toEqual([p[0], p[2]]);
    expect(next).not.toBe(p);
    expect(p[1].at).toEqual({ x: 0, y: 5 }); // the program given is not changed
  });

  test("the place is rounded to 2 decimals and not less than 0", () => {
    expect(moveScript(three(), "s1", { x: 1.23456, y: 2.005 })[0].at).toEqual({ x: 1.23, y: 2.01 });
    expect(moveScript(three(), "s1", { x: -3, y: -0.4 })[0].at).toEqual({ x: 0, y: 0 });
  });

  test("a script with no place of its own gets one; a script that is not there leaves a copy", () => {
    expect(moveScript(createEmptyProgram(), "s1", { x: 2, y: 2 })[0].at).toEqual({ x: 2, y: 2 });
    const p = three();
    const same = moveScript(p, "s10", { x: 1, y: 1 });
    expect(same).toEqual(p);
    expect(same).not.toBe(p);
  });

  test("the result is a valid program, and it builds the same shapes", () => {
    const moved = moveScript(three(), "s3", { x: 40, y: 0.5 });
    expect(() => validateProgram(moved)).not.toThrow();
    expect(runProgram(k, moved).shapes.map((s) => s.id)).toEqual(runProgram(k, three()).shapes.map((s) => s.id));
  });
});

describe("making, renaming and removing scripts the way the editor does", () => {
  test("a new script is called script1, then script2, and skips a name that is taken", () => {
    expect(freshScriptName(createEmptyProgram())).toBe("script1");
    const one = addScript(createEmptyProgram(), freshScriptName(createEmptyProgram()));
    expect(freshScriptName(one)).toBe("script2");
    const gap = addScript(addScript(createEmptyProgram(), "script2"), "other");
    expect(freshScriptName(gap)).toBe("script1");
    expect(freshScriptName(addScript(gap, "script1"))).toBe("script3");
  });

  test("a new script is empty, has no place of its own, and is valid", () => {
    const p = addScript(three(), freshScriptName(three()));
    expect(p[p.length - 1]).toEqual({ id: "s4", name: "script1", blocks: [] });
    expect(() => validateProgram(p)).not.toThrow();
  });

  test("renaming, then changing the inputs, then removing: each is one change of the program, and the others are untouched", () => {
    const made = addScript(three(), "script1");
    const renamed = setScriptName(made, "s4", "leg");
    expect(renamed[3].name).toBe("leg");
    const withInputs = setScriptInputs(renamed, "s4", "w, h");
    expect(withInputs[3]).toEqual({ id: "s4", name: "leg", inputs: "w, h", blocks: [] });
    const gone = removeScript(withInputs, "s4");
    expect(gone).toEqual(three());
  });

  test("a name or inputs that will not do change nothing and say why", () => {
    const p = three();
    expect(() => setScriptName(p, "s2", "c")).toThrow(/already a script called "c"/);
    expect(() => setScriptName(p, "s2", "1a")).toThrow(/not a name/);
    expect(() => setScriptName(p, "s2", "")).toThrow(/not a name/);
    expect(() => setScriptName(p, "s1", "main")).toThrow(/cannot be renamed/);
    expect(() => setScriptInputs(p, "s2", "w, w")).toThrow(/twice/);
    expect(() => setScriptInputs(p, "s1", "w")).toThrow(/no inputs/);
    expect(() => removeScript(p, "s1")).toThrow(/cannot be removed/);
    expect(p).toEqual(three());
  });

  test("a script is found by its id, so removing or adding scripts before it does not change which one an edit means", () => {
    const without = removeScript(three(), "s2"); // "c" is the second script now, no longer the third
    expect(without.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(setScriptName(without, "s3", "leg")[1].name).toBe("leg");
    expect(setScriptInputs(without, "s3", "x")[1].inputs).toBe("x");
    expect(setScriptFold(without, "s3", true)[1].collapsed).toBe(true);
    expect(moveScript(without, "s3", { x: 2, y: 3 })[1].at).toEqual({ x: 2, y: 3 });
    expect(columns(insertBlocks(without, { scriptId: "s3", index: 0 }, [box("n")]))).toEqual([["a1", "a2"], ["n", "c1", "c2"]]);
    expect(columns(removeScript(without, "s3"))).toEqual([["a1", "a2"]]);
    // an id that was removed is not a script any more, and is not given to another one that is still there
    expect(() => removeScript(without, "s2")).toThrow(/no such script/);
    const added = addScript(without, "leg");
    expect(added.map((s) => s.id)).toEqual(["s1", "s3", "s4"]);
    expect(addScript(removeScript(added, "s4"), "again").map((s) => s.id)).toEqual(["s1", "s3", "s4"]); // the last one went, so its id is free
  });

  test("the editor finds the script it just added as the last one, by its id", () => {
    const p = addScript(three(), "extra");
    const added = p[p.length - 1];
    expect(added.name).toBe("extra");
    expect(findScript(p, added.id)).toBe(p.length - 1);
    expect(p.filter((s) => s.id === added.id)).toHaveLength(1);
  });

  test("a rename does not touch a use block that names the old name, which then says so when it runs", () => {
    const user: Program = [
      { id: "s1", name: "build", blocks: [blk("u", "use", { name: "leg", values: "" })] },
      { id: "s2", name: "leg", blocks: [box("a")] },
    ];
    expect(runProgram(k, user).problem).toBeUndefined();
    const renamed = setScriptName(user, "s2", "post");
    expect(renamed[0].blocks[0].args.name).toBe("leg");
    expect(runProgram(k, renamed).problem?.message).toMatch(/no script called "leg"/);
  });
});

describe("dropping an empty holder above blocks wraps them", () => {
  const holder = (id = "h", kind = "transform") => blk(id, kind);
  const three3 = (): Program => [{ id: "s1", name: "build", at: { x: 3, y: 4 }, collapsed: true, blocks: [box("a"), box("b"), box("c")] }];

  test("in the middle of a script, the holder takes the blocks from there to the end", () => {
    const p = three3();
    const next = dropBlocks(p, { scriptId: "s1", index: 1 }, [holder()]);
    expect(ids(next[0].blocks)).toEqual(["a", "h"]);
    expect(ids(next[0].blocks[1].inner ?? [])).toEqual(["b", "c"]);
    expect(ids(blocksToWrap(p, { scriptId: "s1", index: 1 }, [holder()]))).toEqual(["b", "c"]);
    expect(() => validateProgram(next)).not.toThrow();
    expect(p[0].blocks).toHaveLength(3); // the program given is not changed
  });

  test("at the start of a script it holds the whole script, which keeps its place and fold", () => {
    const next = dropBlocks(three3(), { scriptId: "s1", index: 0 }, [holder()]);
    expect(ids(next[0].blocks)).toEqual(["h"]);
    expect(ids(next[0].blocks[0].inner ?? [])).toEqual(["a", "b", "c"]);
    expect(next[0].at).toEqual({ x: 3, y: 4 });
    expect(next[0].collapsed).toBe(true);
    expect(() => validateProgram(next)).not.toThrow();
  });

  test("inside a holder it wraps the rest of that list only", () => {
    const p = oneScript([blk("outer", "union", {}, { inner: [box("i1"), box("i2"), box("i3")] }), box("z")]);
    const next = dropBlocks(p, { parentId: "outer", index: 1 }, [holder()]);
    expect(ids(next[0].blocks)).toEqual(["outer", "z"]);
    expect(ids(next[0].blocks[0].inner ?? [])).toEqual(["i1", "h"]);
    expect(ids(findBlock(next, "h")!.block.inner ?? [])).toEqual(["i2", "i3"]);
    expect(() => validateProgram(next)).not.toThrow();
  });

  test("with nothing after the drop point, it is a plain insert", () => {
    const p = three3();
    expect(blocksToWrap(p, { scriptId: "s1", index: 3 }, [holder()])).toEqual([]);
    const next = dropBlocks(p, { scriptId: "s1", index: 3 }, [holder()]);
    expect(ids(next[0].blocks)).toEqual(["a", "b", "c", "h"]);
    expect(next[0].blocks[3].inner ?? []).toEqual([]);
  });

  test("a holder that already has blocks, or several blocks, or another kind of block, is a plain insert", () => {
    const p = three3();
    const full = blk("h", "union", {}, { inner: [box("x")] });
    expect(ids(dropBlocks(p, { scriptId: "s1", index: 1 }, [full])[0].blocks)).toEqual(["a", "h", "b", "c"]);
    expect(ids(dropBlocks(p, { scriptId: "s1", index: 1 }, [holder("h1"), holder("h2")])[0].blocks)).toEqual(["a", "h1", "h2", "b", "c"]);
    expect(ids(dropBlocks(p, { scriptId: "s1", index: 1 }, [box("n")])[0].blocks)).toEqual(["a", "n", "b", "c"]);
  });

  test("when a block after the point cannot go inside the holder, it is a plain insert", () => {
    // an extrude holds flat shapes, so a box after the drop point cannot go inside it
    const p = oneScript([blk("r", "rectangle", { w: "5", h: "5" }), box("b"), blk("c", "circle", { r: "2" })]);
    const h = holder("h", "extrude");
    expect(blocksToWrap(p, { scriptId: "s1", index: 1 }, [h])).toEqual([]);
    expect(ids(dropBlocks(p, { scriptId: "s1", index: 1 }, [h])[0].blocks)).toEqual(["r", "h", "b", "c"]);
    // but the flat shapes alone can
    expect(ids(blocksToWrap(p, { scriptId: "s1", index: 2 }, [h]))).toEqual(["c"]);
  });

  test("blocks that are automatic parts of their parent are never wrapped", () => {
    const p = oneScript([blk("s", "solid", {}, { inner: [blk("v", "vertices"), blk("f", "faces")] })]);
    expect(blocksToWrap(p, { parentId: "s", index: 0 }, [holder()])).toEqual([]);
  });

  test("a new script, the end of the program, or a global script is never wrapped", () => {
    expect(blocksToWrap(three3(), { newScript: { at: { x: 1, y: 1 } } }, [holder()])).toEqual([]);
    expect(blocksToWrap(three3(), { end: true }, [holder()])).toEqual([]);
    expect(dropBlocks(createEmptyProgram(), { scriptId: "s1", index: 0 }, [holder()])).toEqual([{ id: "s1", name: "build", blocks: [holder()] }]);
    const withGlobal: Program = [{ id: "s1", blocks: [set("g1"), set("g2", "d")] }, ...three3()];
    expect(blocksToWrap(withGlobal, { scriptId: "s1", index: 0 }, [holder()])).toEqual([]);
  });

  test("a holder that was carried out of the program can be dropped to wrap too", () => {
    const p = oneScript([box("a"), holder("h"), box("b"), box("c")]);
    const taken = takeBlock(p, "h");
    const next = dropBlocks(taken.program, { scriptId: "s1", index: 1 }, taken.blocks);
    expect(ids(next[0].blocks)).toEqual(["a", "h"]);
    expect(ids(next[0].blocks[1].inner ?? [])).toEqual(["b", "c"]);
  });
});
