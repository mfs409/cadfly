import { describe, expect, test } from "vitest";
import { type Op, OpError, applyOps, describeBlock } from "../src/cadfly/assistant/ops";
import { allBlocks, findBlock } from "../src/cadfly/language/edit";
import type { Block, Program } from "../src/cadfly/language/types";

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id, kind, args, ...(inner ? { inner } : {}) });

const sample = (): Program => [
  blk("b1", "set", { name: "w", value: "40" }),
  blk("b2", "extrude", { name: "plate", plane: "XY", offset: "0", height: "5" }, [blk("b3", "rectangle", { w: "w", h: "w" }), blk("b4", "circle", { r: "3", hole: true })]),
  blk("b5", "box", { name: "box" }),
];

const apply = (ops: Op[], p: Program = sample()) => applyOps(p, ops);
const fails = (ops: Op[], message: RegExp, p: Program = sample()) => expect(() => applyOps(p, ops)).toThrow(message);

describe("adding blocks", () => {
  test("append puts them at the end, with fresh ids and the defaults filled in", () => {
    const { program, changes } = apply([{ op: "append", blocks: [{ kind: "sphere", args: { name: "ball", r: "7" } }] }]);
    expect(program).toHaveLength(4);
    expect(program[3]).toEqual({ id: "b6", kind: "sphere", args: { name: "ball", r: "7", x: "0", y: "0", z: "0" } });
    expect(changes).toEqual(['added sphere "ball"']);
  });

  test("a block asked for with no name has no caption, and ids are still fresh", () => {
    const { program } = apply([{ op: "append", blocks: [{ kind: "box" }, { kind: "box" }] }]);
    expect(program.slice(3).map((b) => b.args.name)).toEqual(["", ""]);
    expect(program.slice(3).map((b) => b.id)).toEqual(["b6", "b7"]);
  });

  test("ids stay unique across several ops, and for blocks inside blocks", () => {
    const { program } = apply([
      { op: "append", blocks: [{ kind: "extrude", args: { name: "e2" }, inner: [{ kind: "rectangle" }, { kind: "circle", args: { hole: true } }] }] },
      { op: "append", blocks: [{ kind: "cylinder", args: { top: "0" } }] },
    ]);
    const ids = allBlocks(program).map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findBlock(program, "b6")!.block.inner!.map((b) => b.id)).toEqual(["b7", "b8"]);
  });

  test("insert_after puts blocks right after a block, in the same list", () => {
    const { program } = apply([{ op: "insert_after", block: "b3", blocks: [{ kind: "circle", args: { r: "1" } }] }]);
    expect(program[1].inner!.map((b) => b.kind)).toEqual(["rectangle", "circle", "circle"]);
    expect(program[1].inner![1].args.r).toBe("1");
    const top = apply([{ op: "insert_after", block: "b1", blocks: [{ kind: "box" }] }]).program;
    expect(top.map((b) => b.id)).toEqual(["b1", "b6", "b2", "b5"]);
  });

  test("insert_into adds at the end of what is inside", () => {
    const { program, changes } = apply([{ op: "insert_into", block: "b2", blocks: [{ kind: "circle", args: { u: "5" } }] }]);
    expect(program[1].inner!.map((b) => b.kind)).toEqual(["rectangle", "circle", "circle"]);
    expect(program[1].inner![2].args.u).toBe("5");
    expect(changes[0]).toBe('added circle inside extrude "plate"');
  });

  test("a polygon is made with its points inside", () => {
    const { program } = apply([
      { op: "append", blocks: [{ kind: "extrude", args: { name: "t" }, inner: [{ kind: "polygon", inner: [{ kind: "point", args: { u: "0", v: "0" } }, { kind: "point", args: { u: "4", v: "0" } }, { kind: "point", args: { u: "0", v: "3" } }] }] }] },
    ]);
    expect(program[3].inner![0].inner!.map((b) => b.args)).toEqual([{ u: "0", v: "0" }, { u: "4", v: "0" }, { u: "0", v: "3" }]);
  });

  test("a flag may be given as true or the text true", () => {
    const { program } = apply([{ op: "insert_into", block: "b2", blocks: [{ kind: "circle", args: { hole: "true" } }] }]);
    expect(program[1].inner![2].args.hole).toBe(true);
  });
});

describe("changing and removing blocks", () => {
  test("set changes one field and says so", () => {
    const { program, changes } = apply([{ op: "set", block: "b2", field: "height", value: "8" }]);
    expect(program[1].args.height).toBe("8");
    expect(program[1].args.name).toBe("plate");
    expect(changes).toEqual(['changed height of extrude "plate" to 8']);
  });

  test("set can flip a flag and pick a choice", () => {
    expect(apply([{ op: "set", block: "b4", field: "hole", value: false }]).program[1].inner![1].args.hole).toBe(false);
    expect(apply([{ op: "set", block: "b2", field: "plane", value: "XZ" }]).program[1].args.plane).toBe("XZ");
  });

  test("delete removes just that block, and what is inside it", () => {
    const { program, changes } = apply([{ op: "delete", block: "b2" }]);
    expect(program.map((b) => b.id)).toEqual(["b1", "b5"]);
    expect(changes).toEqual(['removed extrude "plate"']);
    expect(apply([{ op: "delete", block: "b3" }]).program[1].inner!.map((b) => b.id)).toEqual(["b4"]);
  });

  test("clear removes everything", () => {
    expect(apply([{ op: "clear" }]).program).toEqual([]);
    expect(apply([{ op: "clear" }], []).changes).toEqual([]);
  });

  test("ops run in order, so later ones can use what earlier ones made", () => {
    const { program } = apply([
      { op: "append", blocks: [{ kind: "cylinder", args: { name: "hole" } }] },
      { op: "set", block: "b6", field: "r", value: "2" },
      { op: "wrap", blocks: ["b6"], holder: { kind: "transform", args: { z: "3" } } },
    ]);
    expect(program[3].kind).toBe("transform");
    expect(program[3].inner![0].args.r).toBe("2");
  });
});

describe("wrapping and unwrapping", () => {
  test("wrap puts a block inside a new holder, in the same place", () => {
    const { program, changes } = apply([{ op: "wrap", blocks: ["b5"], holder: { kind: "transform", args: { z: "20" } } }]);
    expect(program.map((b) => b.kind)).toEqual(["set", "extrude", "transform"]);
    expect(program[2]).toEqual({ id: "b6", kind: "transform", args: { x: "0", y: "0", z: "20", rx: "0", ry: "0", rz: "0", sx: "1", sy: "1", sz: "1" }, inner: [sample()[2]] });
    expect(changes).toEqual(['put box "box" inside transform']);
  });

  test("it works inside other blocks too, keeping the order", () => {
    const base: Program = [blk("b1", "union", { name: "u" }, [blk("b2", "box", { name: "a" }), blk("b3", "box", { name: "b" }), blk("b4", "box", { name: "c" })])];
    const { program } = apply([{ op: "wrap", blocks: ["b3"], holder: { kind: "transform" } }], base);
    expect(program[0].inner!.map((b) => b.kind)).toEqual(["box", "transform", "box"]);
    expect(program[0].inner![1].inner![0].id).toBe("b3");
  });

  test("several blocks go in together, and new blocks in the holder come after them", () => {
    const base: Program = [blk("b1", "box", { name: "a" }), blk("b2", "box", { name: "b" }), blk("b3", "box", { name: "c" })];
    const { program, changes } = apply([{ op: "wrap", blocks: ["b1", "b3"], holder: { kind: "subtract", args: { name: "cut" } }, with: [{ kind: "sphere" }] }], base);
    expect(program.map((b) => b.id)).toEqual(["b4", "b2"]); // the holder takes the place of the first, and b3 has left its old spot
    expect(program[0].inner!.map((b) => b.kind)).toEqual(["box", "box", "sphere"]);
    expect(program[0].inner!.map((b) => b.id)).toEqual(["b1", "b3", "b5"]);
    expect(changes).toEqual(['put 2 blocks inside subtract "cut"']);
  });

  test("the holder can be asked for a cube placed on top: the wrapped block first, the new one after", () => {
    const { program } = apply([{ op: "wrap", blocks: ["b2"], holder: { kind: "placeAgainst", args: { axis: "z", side: "high" } }, with: [{ kind: "box", args: { name: "cube" } }] }]);
    const holder = program[1];
    expect(holder.kind).toBe("placeAgainst");
    expect(holder.inner!.map((b) => b.kind)).toEqual(["extrude", "box"]);
  });

  test("unwrap puts what was inside in its place", () => {
    const base: Program = [blk("b1", "transform", { z: "5" }, [blk("b2", "box", { name: "a" }), blk("b3", "sphere", { name: "s" })]), blk("b4", "box", { name: "z" })];
    const { program, changes } = apply([{ op: "unwrap", block: "b1" }], base);
    expect(program.map((b) => b.id)).toEqual(["b2", "b3", "b4"]);
    expect(changes).toEqual(["took what was inside transform out of it"]);
  });

  test("what cannot be done is said plainly", () => {
    fails([{ op: "wrap", blocks: [], holder: { kind: "transform" } }], /"blocks" must list the ids/);
    fails([{ op: "wrap", blocks: ["b9"], holder: { kind: "transform" } }], /no block "b9"/);
    fails([{ op: "wrap", blocks: ["b5", "b5"], holder: { kind: "transform" } }], /listed twice/);
    fails([{ op: "wrap", blocks: ["b5"], holder: { kind: "box" } }], /box block cannot hold other blocks/);
    fails([{ op: "wrap", blocks: ["b5"], holder: { kind: "extrude" } }], /box block cannot go inside a extrude block/);
    fails([{ op: "wrap", blocks: ["b2", "b3"], holder: { kind: "transform" } }], /b3 is already inside b2/);
    fails([{ op: "wrap", blocks: ["b3"], holder: { kind: "box" } }], /box block cannot hold other blocks/);
    fails([{ op: "unwrap", block: "b5" }], /nothing inside to take out/);
  });
});

describe("when an op cannot be done", () => {
  test("a block that is not there is named, with the ones that are", () => {
    fails([{ op: "delete", block: "zz" }], /no block "zz" \(the blocks are b1, b2, b3, b4, b5\)/);
    fails([{ op: "set", block: "zz", field: "w", value: "1" }], /no block "zz"/);
    fails([{ op: "insert_after", block: "zz", blocks: [] }], /no block "zz"/);
  });

  test("unknown kinds and fields say what is allowed", () => {
    fails([{ op: "append", blocks: [{ kind: "teleport" }] }], /no block called "teleport"/);
    fails([{ op: "append", blocks: [{ kind: "box", args: { colour: "red" } }] }], /box block has no field "colour" \(its fields are name, w, d, h, x, y, z\)/);
    fails([{ op: "set", block: "b5", field: "colour", value: "red" }], /no field "colour"/);
  });

  test("a value must suit its field", () => {
    fails([{ op: "set", block: "b2", field: "plane", value: "AB" }], /"plane" must be one of XY, XZ, YZ/);
    fails([{ op: "set", block: "b4", field: "hole", value: "maybe" }], /must be true or false/);
  });

  test("blocks go only where they belong", () => {
    fails([{ op: "insert_into", block: "b5", blocks: [{ kind: "circle" }] }], /box block cannot hold other blocks/);
    fails([{ op: "append", blocks: [{ kind: "point" }] }], /belongs inside another block/);
    fails([{ op: "append", blocks: [{ kind: "box", inner: [{ kind: "circle" }] }] }], /box block cannot hold other blocks/);
    fails([{ op: "insert_into", block: "b2", blocks: [{ kind: "box" }] }], /box block cannot go inside a extrude block/);
  });

  test("nothing changes if any op fails, and the original is never touched", () => {
    const p = sample();
    const before = structuredClone(p);
    expect(() => applyOps(p, [{ op: "append", blocks: [{ kind: "box" }] }, { op: "delete", block: "zz" }])).toThrow(OpError);
    expect(p).toEqual(before);
    applyOps(p, [{ op: "delete", block: "b5" }]);
    expect(p).toEqual(before);
  });

  test("an op that is not an op", () => {
    fails([{ op: "explode" } as unknown as Op], /unknown op "explode"/);
  });
});

describe("describing blocks", () => {
  test("by word and name where there is one", () => {
    expect(describeBlock(blk("b1", "box", { name: "plate" }))).toBe('box "plate"');
    expect(describeBlock(blk("b1", "set", { name: "w", value: "1" }))).toBe('set "w"');
    expect(describeBlock(blk("b1", "lineUp", { names: "a" }))).toBe("line up");
  });
});
