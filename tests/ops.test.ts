import { describe, expect, test, beforeAll } from "vitest";
import { type Op, OpError, applyOps, describeBlock } from "../src/cadfly/assistant/ops";
import { allBlocks, findBlock, createEmptyProgram } from "../src/cadfly/language/program";
import type { Program } from "../src/cadfly/language/types";
import { oneScript, topBlocks } from "./helpers/script-helpers";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { setScriptFold } from "../src/cadfly/language/edit";
import { runProgram } from "../src/cadfly/language/run";
import { blk, box, set, ids, columns, three } from "./helpers/blocks";
import type { ModeSpec } from "../src/cadfly/ui/modes";

/** A mode that offers one kind of block, and has no switches and no scripts */
const only = (kind: string): ModeSpec => ({ blocks: [kind], switches: false, scripts: false });

/**
 * The edit operations the assistant applies to a program, and the errors it gets
 * when one cannot be applied.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const sample = (): Program =>
  oneScript([
    blk("b1", "set", { name: "w", value: "40" }),
    blk("b2", "extrude", { name: "plate", plane: "XY", offset: "0", height: "5" }, [blk("b3", "rectangle", { w: "w", h: "w" }), blk("b4", "circle", { r: "3", hole: true })]),
    blk("b5", "box", { name: "box" }),
  ]);

/**
 * Apply the ops. For the programs of one script that most of these tests use,
 * `program` is the blocks of that script, and `scripts` is the result as it is
 * (a list of scripts).
 */
const apply = (ops: Op[], p: Program = sample()) => {
  const out = applyOps(p, ops);
  return { ...out, scripts: out.program, program: topBlocks(out.program) };
};

const fails = (ops: Op[], message: RegExp, p: Program = sample()) => expect(() => applyOps(p, ops)).toThrow(message);

describe("adding blocks", () => {
  test("append puts them at the end, with fresh ids and the defaults filled in", () => {
    const { program, changeLog } = apply([{ op: "append", blocks: "sphere name=ball r=7" }]);
    expect(program).toHaveLength(4);
    expect(program[3]).toEqual({ id: "b6", kind: "sphere", args: { name: "ball", r: "7", x: "0", y: "0", z: "0" } });
    expect(changeLog).toEqual(['added sphere "ball"']);
  });

  test("a block asked for with no name has no caption, and ids are still fresh", () => {
    const { program } = apply([{ op: "append", blocks: "box\nbox" }]);
    expect(program.slice(3).map((b) => b.args.name)).toEqual(["", ""]);
    expect(program.slice(3).map((b) => b.id)).toEqual(["b6", "b7"]);
  });

  test("ids stay unique across several ops, and for blocks inside blocks", () => {
    const { scripts: program } = apply([
      { op: "append", blocks: "extrude name=e2\n  rectangle\n  circle hole" },
      { op: "append", blocks: "cylinder top=0" },
    ]);
    const ids = allBlocks(program).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findBlock(program, "b6")!.block.inner!.map((b) => b.id)).toEqual(["b7", "b8"]);
  });

  test("insert_after puts blocks right after a block, in the same list", () => {
    const { program } = apply([{ op: "insert_after", block: "b3", blocks: "circle r=1" }]);
    expect(program[1].inner!.map((b) => b.kind)).toEqual(["rectangle", "circle", "circle"]);
    expect(program[1].inner![1].args.r).toBe("1");
    const top = apply([{ op: "insert_after", block: "b1", blocks: "box" }]).program;
    expect(top.map((b) => b.id)).toEqual(["b1", "b6", "b2", "b5"]);
  });

  test("insert_into adds at the end of what is inside", () => {
    const { program, changeLog } = apply([{ op: "insert_into", block: "b2", blocks: "circle u=5" }]);
    expect(program[1].inner!.map((b) => b.kind)).toEqual(["rectangle", "circle", "circle"]);
    expect(program[1].inner![2].args.u).toBe("5");
    expect(changeLog[0]).toBe('added circle inside extrude "plate"');
  });

  test("a polygon is made with its points inside", () => {
    const { program } = apply([
      { op: "append", blocks: "extrude name=t\n  polygon\n    point u=0 v=0\n    point u=4 v=0\n    point u=0 v=3" },
    ]);
    expect(program[3].inner![0].inner!.map((b) => b.args)).toEqual([{ u: "0", v: "0" }, { u: "4", v: "0" }, { u: "0", v: "3" }]);
  });

  test("a flag may be given as true or the text true", () => {
    const { program } = apply([{ op: "insert_into", block: "b2", blocks: "circle hole=true" }]);
    expect(program[1].inner![2].args.hole).toBe(true);
  });
});

describe("changing and removing blocks", () => {
  test("set changeLog one field and says so", () => {
    const { program, changeLog } = apply([{ op: "set", block: "b2", field: "height", value: "8" }]);
    expect(program[1].args.height).toBe("8");
    expect(program[1].args.name).toBe("plate");
    expect(changeLog).toEqual(['changed height of extrude "plate" to 8']);
  });

  test("set can flip a flag and pick a choice", () => {
    expect(apply([{ op: "set", block: "b4", field: "hole", value: false }]).program[1].inner![1].args.hole).toBe(false);
    expect(apply([{ op: "set", block: "b2", field: "plane", value: "XZ" }]).program[1].args.plane).toBe("XZ");
  });

  test("delete removes just that block, and what is inside it", () => {
    const { program, changeLog } = apply([{ op: "delete", block: "b2" }]);
    expect(program.map((b) => b.id)).toEqual(["b1", "b5"]);
    expect(changeLog).toEqual(['removed extrude "plate"']);
    expect(apply([{ op: "delete", block: "b3" }]).program[1].inner!.map((b) => b.id)).toEqual(["b4"]);
  });

  test("clear removes everything", () => {
    expect(apply([{ op: "clear" }]).program).toEqual([]);
    expect(apply([{ op: "clear" }], []).changeLog).toEqual([]);
  });

  test("ops run in order, so later ones can use what earlier ones made", () => {
    const { program } = apply([
      { op: "append", blocks: "cylinder name=hole" },
      { op: "set", block: "b6", field: "r", value: "2" },
      { op: "wrap", blocks: ["b6"], holder: "transform z=3" },
    ]);
    expect(program[3].kind).toBe("transform");
    expect(program[3].inner![0].args.r).toBe("2");
  });
});

describe("wrapping and unwrapping", () => {
  test("wrap puts a block inside a new holder, in the same place", () => {
    const { program, changeLog } = apply([{ op: "wrap", blocks: ["b5"], holder: "transform z=20" }]);
    expect(program.map((b) => b.kind)).toEqual(["set", "extrude", "transform"]);
    expect(program[2]).toEqual({ id: "b6", kind: "transform", args: { x: "0", y: "0", z: "20", rx: "0", ry: "0", rz: "0", sx: "1", sy: "1", sz: "1" }, inner: [topBlocks(sample())[2]] });
    expect(changeLog).toEqual(['put box "box" inside transform']);
  });

  test("it works inside other blocks too, keeping the order", () => {
    const base = oneScript([blk("b1", "union", { name: "u" }, [blk("b2", "box", { name: "a" }), blk("b3", "box", { name: "b" }), blk("b4", "box", { name: "c" })])]);
    const { program } = apply([{ op: "wrap", blocks: ["b3"], holder: "transform" }], base);
    expect(program[0].inner!.map((b) => b.kind)).toEqual(["box", "transform", "box"]);
    expect(program[0].inner![1].inner![0].id).toBe("b3");
  });

  test("several blocks go in together, and new blocks in the holder come after them", () => {
    const base = oneScript([blk("b1", "box", { name: "a" }), blk("b2", "box", { name: "b" }), blk("b3", "box", { name: "c" })]);
    const { program, changeLog } = apply([{ op: "wrap", blocks: ["b1", "b3"], holder: "subtract name=cut", with: "sphere" }], base);
    expect(program.map((b) => b.id)).toEqual(["b4", "b2"]); // the holder takes the place of the first, and b3 has left its old spot
    expect(program[0].inner!.map((b) => b.kind)).toEqual(["box", "box", "sphere"]);
    expect(program[0].inner!.map((b) => b.id)).toEqual(["b1", "b3", "b5"]);
    expect(changeLog).toEqual(['put 2 blocks inside subtract "cut"']);
  });

  test("the holder can be asked for a cube placed on top: the wrapped block first, the new one after", () => {
    const { program } = apply([{ op: "wrap", blocks: ["b2"], holder: "placeAgainst axis=z side=high", with: "box name=cube" }]);
    const holder = program[1];
    expect(holder.kind).toBe("placeAgainst");
    expect(holder.inner!.map((b) => b.kind)).toEqual(["extrude", "box"]);
  });

  test("unwrap puts what was inside in its place", () => {
    const base = oneScript([blk("b1", "transform", { z: "5" }, [blk("b2", "box", { name: "a" }), blk("b3", "sphere", { name: "s" })]), blk("b4", "box", { name: "z" })]);
    const { program, changeLog } = apply([{ op: "unwrap", block: "b1" }], base);
    expect(program.map((b) => b.id)).toEqual(["b2", "b3", "b4"]);
    expect(changeLog).toEqual(["took what was inside transform out of it"]);
  });

  test("what cannot be done is said plainly", () => {
    fails([{ op: "wrap", blocks: [], holder: "transform" }], /"blocks" must list the ids/);
    fails([{ op: "wrap", blocks: ["b9"], holder: "transform" }], /no block "b9"/);
    fails([{ op: "wrap", blocks: ["b5", "b5"], holder: "transform" }], /listed twice/);
    fails([{ op: "wrap", blocks: ["b5"], holder: "box" }], /box block cannot hold other blocks/);
    fails([{ op: "wrap", blocks: ["b5"], holder: "extrude" }], /box block cannot go inside a extrude block/);
    fails([{ op: "wrap", blocks: ["b2", "b3"], holder: "transform" }], /b3 is already inside b2/);
    fails([{ op: "wrap", blocks: ["b3"], holder: "box" }], /box block cannot hold other blocks/);
    fails([{ op: "unwrap", block: "b5" }], /nothing inside to take out/);
  });
});

describe("when an op cannot be done", () => {
  test("a block that is not there is named, with the ones that are", () => {
    fails([{ op: "delete", block: "zz" }], /no block "zz" \(the blocks are b1, b2, b3, b4, b5\)/);
    fails([{ op: "set", block: "zz", field: "w", value: "1" }], /no block "zz"/);
    fails([{ op: "insert_after", block: "zz", blocks: "" }], /no block "zz"/);
  });

  test("unknown kinds and fields say what is allowed", () => {
    fails([{ op: "append", blocks: "teleport" }], /no block called "teleport"/);
    fails([{ op: "append", blocks: "box colour=red" }], /box block has no field "colour" \(its fields are name, w, d, h, x, y, z\)/);
    fails([{ op: "set", block: "b5", field: "colour", value: "red" }], /no field "colour"/);
  });

  test("a value must suit its field", () => {
    fails([{ op: "set", block: "b2", field: "plane", value: "AB" }], /"plane" must be one of XY, XZ, YZ/);
    fails([{ op: "set", block: "b4", field: "hole", value: "maybe" }], /must be true or false/);
  });

  test("a mode that offers a block lets set change any of its fields, and a field it does not have is refused", () => {
    const p = oneScript([blk("b1", "box", { name: "a" })]);
    const change = (field: string, mode?: ModeSpec) => applyOps(p, [{ op: "set", block: "b1", field, value: "5" }], { mode });
    expect(change("w", only("box")).program[0].blocks[0].args.w).toBe("5");
    expect(change("x", only("box")).program[0].blocks[0].args.x).toBe("5");
    expect(change("x").program[0].blocks[0].args.x).toBe("5");
    expect(() => change("nope", only("box"))).toThrow(/box block has no field "nope" \(its fields are name, w, d, h, x, y, z\)/);
  });

  test("blocks go only where they belong", () => {
    fails([{ op: "insert_into", block: "b5", blocks: "circle" }], /box block cannot hold other blocks/);
    fails([{ op: "append", blocks: "point" }], /belongs inside another block/);
    fails([{ op: "append", blocks: "box\n  circle" }], /box block cannot hold other blocks/);
    fails([{ op: "insert_into", block: "b2", blocks: "box" }], /box block cannot go inside a extrude block/);
  });

  test("nothing changeLog if any op fails, and the original is never touched", () => {
    const p = sample();
    const before = structuredClone(p);
    expect(() => applyOps(p, [{ op: "append", blocks: "box" }, { op: "delete", block: "zz" }])).toThrow(OpError);
    expect(p).toEqual(before);
    applyOps(p, [{ op: "delete", block: "b5" }]);
    expect(p).toEqual(before);
  });

  test("an op that is not an op", () => {
    // cast: an op that does not exist, which the type of an op does not allow
    fails([{ op: "explode" } as unknown as Op], /unknown op "explode"/);
  });
});

describe("describing blocks", () => {
  test("by word and name where there is one", () => {
    expect(describeBlock(blk("b1", "box", { name: "plate" }))).toBe('box "plate"');
    expect(describeBlock(blk("b1", "set", { name: "w", value: "1" }))).toBe('set "w"');
    expect(describeBlock(blk("b1", "lineUp", { names: "a" }))).toBe("align");
  });
});

describe("the assistant and scripts", () => {
  test("append joins build, and never writes a place", () => {
    const { program } = applyOps(three(), [{ op: "append", blocks: "sphere r=2" }]);
    expect(program).toHaveLength(3);
    expect(ids(program[0].blocks).slice(0, 2)).toEqual(["a1", "a2"]);
    expect(program[0].blocks[2].kind).toBe("sphere");
    expect(program.filter((s) => s.at)).toHaveLength(2);
  });

  test("append to an empty program puts the blocks in build", () => {
    for (const start of [[], createEmptyProgram()]) {
      const { program } = applyOps(start, [{ op: "append", blocks: "sphere r=2\nbox" }]);
      expect(program).toHaveLength(1);
      expect(program[0]).toMatchObject({ name: "build" });
      expect(program[0].at).toBeUndefined();
      expect(program[0].blocks.map((b) => b.kind)).toEqual(["sphere", "box"]);
    }
  });

  test("append can say which script, and \"globals\" makes a global script of set blocks", () => {
    const named = applyOps(three(), [{ op: "append", blocks: "sphere r=2", to: "c" }]).program;
    expect(named[2].blocks.map((b) => b.kind)).toEqual(["box", "box", "sphere"]);
    const global = applyOps(three(), [{ op: "append", blocks: "set name=w value=4", to: "globals" }]).program;
    expect(global).toHaveLength(4);
    expect(global[3]).toMatchObject({ id: "s4", blocks: [{ kind: "set" }] });
    expect(global[3].name).toBeUndefined();
    expect(global[3].at).toBeUndefined();
    expect(() => applyOps(three(), [{ op: "append", blocks: "sphere", to: "globals" }])).toThrow(/only set blocks/);
    expect(() => applyOps(three(), [{ op: "append", blocks: "sphere", to: "nobody" }])).toThrow(/no script called "nobody" \(the scripts are build, b, c; or "globals"\)/);
  });

  test("the script op adds a named script, with blocks if given, and uses can run it", () => {
    const { program, changeLog } = applyOps(oneScript([box("a")]), [
      { op: "script", name: "leg", inputs: "h", blocks: "box w=2 d=2 h=h" },
      { op: "append", blocks: 'use name=leg values="7"' },
    ]);
    expect(program.map((s) => s.name)).toEqual(["build", "leg"]);
    expect(program[1]).toMatchObject({ name: "leg", inputs: "h" });
    expect(program[1].blocks).toHaveLength(1);
    expect(changeLog).toContain("added the script leg");
    const r = runProgram(k, program);
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(2);
    expect(applyOps(oneScript([]), [{ op: "script", name: "empty" }]).program[1]).toEqual({ id: "s2", name: "empty", blocks: [] });
    expect(() => applyOps(three(), [{ op: "script", name: "b" }])).toThrow(/already a script called "b"/);
    expect(() => applyOps(three(), [{ op: "script", name: "" }])).toThrow(/script's name/);
  });

  test("the script op, and appending to a script, are for modes that have scripts", () => {
    const early = only("box");
    expect(() => applyOps(three(), [{ op: "script", name: "x" }], { mode: early })).toThrow(/scripts are not available/);
    expect(() => applyOps(three(), [{ op: "append", blocks: "box", to: "c" }], { mode: early })).toThrow(/no scripts besides build/);
    expect(applyOps(three(), [{ op: "append", blocks: "box" }], { mode: early }).program[0].blocks).toHaveLength(3);
  });

  test("deleting the first block of a script leaves the script's place, and deleting the last block of a function leaves it empty", () => {
    const { program } = applyOps(three(), [{ op: "delete", block: "c1" }]);
    expect(program[2]).toMatchObject({ at: { x: 6, y: 0 } });
    expect(ids(program[2].blocks)).toEqual(["c2"]);
    const gone = applyOps(three(), [{ op: "delete", block: "b1" }]).program;
    expect(columns(gone)).toEqual([["a1", "a2"], [], ["c1", "c2"]]);
  });

  test("clear leaves the empty program: one empty build", () => {
    expect(applyOps(three(), [{ op: "clear" }]).program).toEqual(createEmptyProgram());
    expect(applyOps(createEmptyProgram(), [{ op: "clear" }]).changeLog).toEqual([]);
  });

  test("wrapping a script's first block keeps the script's place and fold, and unwrapping gives the block back", () => {
    const folded = setScriptFold(three(), "s3", true);
    const wrapped = applyOps(folded, [{ op: "wrap", blocks: ["c1"], holder: "transform x=1" }]).program;
    expect(wrapped[2]).toMatchObject({ at: { x: 6, y: 0 }, collapsed: true });
    const holder = wrapped[2].blocks[0];
    expect(holder.kind).toBe("transform");
    expect(ids(holder.inner!)).toEqual(["c1"]);
    const unwrapped = applyOps(wrapped, [{ op: "unwrap", block: holder.id }]).program;
    expect(unwrapped).toEqual(folded);
  });

  test("insert_after a script's last block keeps it in that script", () => {
    const { program } = applyOps(three(), [{ op: "insert_after", block: "c2", blocks: "sphere" }]);
    expect(program).toHaveLength(3);
    expect(program[2].blocks.map((b) => b.kind)).toEqual(["box", "box", "sphere"]);
    expect(ids(program[0].blocks)).toEqual(["a1", "a2"]);
  });

  test("a block in a later script can be changed, and the other scripts are as they were", () => {
    const { program } = applyOps(three(), [{ op: "set", block: "c2", field: "w", value: "99" }]);
    expect(program[2].blocks[1].args.w).toBe("99");
    expect(program[0]).toEqual(three()[0]);
  });
});
