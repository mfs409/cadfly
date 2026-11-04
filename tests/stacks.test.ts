import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import { programView } from "../src/cadfly/assistant/prompt";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { appendIndex, insertStack, removeAt, runOrder, setStackCollapsed, stackRanges, takeBlock } from "../src/cadfly/language/edit";
import { parseProgram, serializeProgram, validateProgram } from "../src/cadfly/language/format";
import { type Hit, hit, layoutProgram } from "../src/cadfly/language/layout";
import { runProgram } from "../src/cadfly/language/run";
import type { Block, Program } from "../src/cadfly/language/types";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, extra: Partial<Block> = {}): Block => ({ id, kind, args, ...extra });
const box = (id: string, at?: { x: number; y: number }, w = "10") => blk(id, "box", { w, d: "10", h: "10" }, at ? { at } : {});
const ids = (p: Program) => p.map((b) => b.id);

/** Three stacks: A (a1, a2) at the top left, B (b1) lower down, C (c1, c2) to the right of A, level with it */
const three = (): Program => [box("a1"), box("a2"), box("b1", { x: 0, y: 5 }), box("c1", { x: 6, y: 0 }), box("c2")];

describe("stacks", () => {
  test("a program with no places is one stack, as it always was", () => {
    expect(stackRanges([box("a"), box("b"), box("c")])).toEqual([{ start: 0, end: 3 }]);
    expect(stackRanges([])).toEqual([]);
  });

  test("a block with a place starts a stack, and the blocks after it without one are the rest of it", () => {
    expect(stackRanges(three())).toEqual([{ start: 0, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 5 }]);
  });

  test("they run from the top of the workspace down, left to right where they are level, each from its top to its bottom", () => {
    expect(ids(runOrder(three()))).toEqual(["a1", "a2", "c1", "c2", "b1"]);
    // moving a stack above another changes the order
    const moved = three().map((b) => (b.id === "b1" ? { ...b, at: { x: 0, y: -1 } } : b));
    expect(ids(runOrder(moved))).toEqual(["b1", "a1", "a2", "c1", "c2"]);
    // a stack with no place is at the corner, so it runs before a stack that is level with it but further right
    expect(ids(runOrder([box("x"), box("y", { x: 3, y: 0 }), box("z", { x: 0, y: 0 })]))).toEqual(["x", "z", "y"]);
  });

  test("the program builds in that order, so a variable set in a stack above is there for the stack below", () => {
    const program: Program = [
      blk("u", "use", { name: "p", values: "" }, { at: { x: 0, y: 4 } }),
      blk("d", "define", { name: "p", inputs: "" }, { at: { x: 0, y: 0 } }),
      { ...blk("d2", "box", { w: "4", d: "4", h: "4" }), at: undefined },
    ];
    const body = blk("b", "box", { w: "4", d: "4", h: "4" });
    const stored: Program = [program[0], { ...program[1], inner: [body] }];
    expect(runProgram(k, stored).problem).toBeUndefined(); // the part is defined above, though it is stored below
    expect(runProgram(k, [stored[0]]).problem!.message).toMatch(/no part called/);
  });

  test("what the model reads is in run order", () => {
    expect(programView(three()).split("\n").map((l) => l.split(" ")[0])).toEqual(["a1", "a2", "c1", "c2", "b1"]);
  });
});

describe("taking and putting down stacks", () => {
  test("dropping at a place starts a new stack there, at the end of the program", () => {
    const next = insertStack([box("a1")], { parentId: null, index: 0, at: { x: 4.2345, y: 2 } }, [box("n1"), box("n2")]);
    expect(ids(next)).toEqual(["a1", "n1", "n2"]);
    expect(next[1].at).toEqual({ x: 4.23, y: 2 });
    expect(next[2].at).toBeUndefined();
    expect(stackRanges(next)).toHaveLength(2);
  });

  test("a place cannot be negative, and carried blocks lose the place they had", () => {
    const next = insertStack([], { parentId: null, index: 0, at: { x: -3, y: 1 } }, [box("n", { x: 9, y: 9 })]);
    expect(next[0].at).toEqual({ x: 0, y: 1 });
    const joined = insertStack([box("a1")], { parentId: null, index: 1 }, [box("n", { x: 9, y: 9 })]);
    expect(joined[1].at).toBeUndefined();
  });

  test("dropping into the middle or the end of a stack adds to that stack", () => {
    const mid = insertStack(three(), { parentId: null, index: 1 }, [box("n")]);
    expect(ids(mid)).toEqual(["a1", "n", "a2", "b1", "c1", "c2"]);
    expect(stackRanges(mid)[0]).toEqual({ start: 0, end: 3 });
    const end = insertStack(three(), { parentId: null, index: 2 }, [box("n")]); // the end of A is the index where B starts
    expect(stackRanges(end).map((r) => r.end - r.start)).toEqual([3, 1, 2]);
    expect(end[3].at).toEqual({ x: 0, y: 5 }); // B is still B
  });

  test("dropping above a stack makes the new blocks its first, and the stack keeps its place", () => {
    const next = insertStack(three(), { parentId: null, index: 2, top: true }, [box("n")]);
    expect(ids(next)).toEqual(["a1", "a2", "n", "b1", "c1", "c2"]);
    expect(next[2].at).toEqual({ x: 0, y: 5 });
    expect(next[3].at).toBeUndefined();
    expect(stackRanges(next).map((r) => r.end - r.start)).toEqual([2, 2, 2]);
    // above the first stack, which has no place
    const first = insertStack(three(), { parentId: null, index: 0, top: true }, [box("n")]);
    expect(ids(first).slice(0, 3)).toEqual(["n", "a1", "a2"]);
    expect(first[0].at).toBeUndefined();
  });

  test("the fold of a stack goes with its place when blocks are put above it", () => {
    const folded = setStackCollapsed(three(), "b1", true);
    const next = insertStack(folded, { parentId: null, index: 2, top: true }, [box("n")]);
    expect(next[2].stackCollapsed).toBe(true);
    expect(next[3].stackCollapsed).toBeUndefined();
  });

  test("removing the first block of a stack hands its place on, so the rest does not slide into the stack above", () => {
    const p = three();
    removeAt({ list: p, index: 3, parent: null }); // c1 goes
    expect(ids(p)).toEqual(["a1", "a2", "b1", "c2"]);
    expect(p[3].at).toEqual({ x: 6, y: 0 });
    const q = three();
    removeAt({ list: q, index: 1, parent: null }); // a2 is not a stack start: nothing to hand on
    expect(q.some((b) => b.id === "c2" && b.at)).toBe(false);
    const alone = three();
    removeAt({ list: alone, index: 2, parent: null }); // b1 was alone: the next stack keeps its own place
    expect(alone[2].at).toEqual({ x: 6, y: 0 });
  });

  test("where blocks are simply added: the end of the stack that runs last", () => {
    expect(appendIndex([])).toBe(0);
    expect(appendIndex([box("a"), box("b")])).toBe(2);
    expect(appendIndex(three())).toBe(3); // B, the lowest stack, ends at index 3
    const reordered = three().map((b) => (b.id === "b1" ? { ...b, at: { x: 0, y: -2 } } : b));
    expect(appendIndex(reordered)).toBe(5); // now C is last
  });
});

describe("the assistant and stacks", () => {
  test("append joins the stack that runs last, and never writes a place", () => {
    const { program } = applyOps(three(), [{ op: "append", blocks: "sphere r=2" }]);
    expect(ids(program).slice(0, 3)).toEqual(["a1", "a2", "b1"]);
    expect(program[3].kind).toBe("sphere");
    expect(program[3].at).toBeUndefined();
    expect(program.filter((b) => b.at)).toHaveLength(2);
  });

  test("deleting the first block of a stack hands its place on", () => {
    const { program } = applyOps(three(), [{ op: "delete", block: "c1" }]);
    expect(program.find((b) => b.id === "c2")!.at).toEqual({ x: 6, y: 0 });
  });

  test("wrapping a stack's first block gives the holder its place, and unwrapping gives it back", () => {
    const wrapped = applyOps(three(), [{ op: "wrap", blocks: ["c1"], holder: "transform x=1" }]).program;
    const holder = wrapped.find((b) => b.kind === "transform")!;
    expect(holder.at).toEqual({ x: 6, y: 0 });
    expect(wrapped.find((b) => b.id === "c1" || (holder.inner ?? []).some((i) => i.id === "c1"))).toBeDefined();
    expect(JSON.stringify(holder.inner![0])).not.toContain('"at"');
    const unwrapped = applyOps(wrapped, [{ op: "unwrap", block: holder.id }]).program;
    expect(unwrapped.find((b) => b.id === "c1")!.at).toEqual({ x: 6, y: 0 });
    expect(stackRanges(unwrapped)).toHaveLength(3);
  });

  test("insert_after a stack's last block keeps it in that stack", () => {
    const { program } = applyOps(three(), [{ op: "insert_after", block: "a2", blocks: "sphere" }]);
    expect(ids(program).slice(0, 3)).toEqual(["a1", "a2", program[2].id]);
    expect(stackRanges(program)[0].end).toBe(3);
  });
});

describe("the file", () => {
  test("places and folds are saved and read back", () => {
    const p = setStackCollapsed(three(), "c1", true);
    expect(parseProgram(serializeProgram(p))).toEqual(p);
  });

  test("a place has to be numbers of sensible size, at the top of the program only", () => {
    const fails = (p: unknown, m: RegExp) => expect(() => validateProgram(p)).toThrow(m);
    fails([{ id: "a", kind: "box", args: {}, at: { x: "1", y: 2 } }], /at must be an x and a y/);
    fails([{ id: "a", kind: "box", args: {}, at: { x: 1 } }], /at must be an x and a y/);
    fails([{ id: "a", kind: "box", args: {}, at: { x: 1, y: 1e9 } }], /no bigger than/);
    fails([{ id: "a", kind: "box", args: {}, at: { x: NaN, y: 1 } }], /at must be/);
    fails([{ id: "a", kind: "transform", args: {}, inner: [{ id: "b", kind: "box", args: {}, at: { x: 1, y: 1 } }] }], /only a block at the top/);
    fails([{ id: "a", kind: "box", args: {}, stackCollapsed: "yes" }], /stackCollapsed must be true or false/);
    fails([{ id: "a", kind: "transform", args: {}, inner: [{ id: "b", kind: "box", args: {}, stackCollapsed: true }] }], /only a block at the top/);
    expect(() => validateProgram([{ id: "a", kind: "box", args: {}, at: { x: 1, y: 2 }, stackCollapsed: true }])).not.toThrow();
  });
});

describe("the layout of floating stacks", () => {
  const lay = (p: Program, width = 8) => layoutProgram(p, { x: 1, y: 2, width, measure: (t) => t.length * 0.1 });

  test("each stack is where its place says, from the workspace corner", () => {
    const l = lay(three());
    const at = (id: string) => l.blocks.find((b) => b.block.id === id)!.bounds;
    expect([at("a1").x, at("a1").y]).toEqual([1, 2]);
    expect([at("b1").x, at("b1").y]).toEqual([1, 7]);
    expect([at("c1").x, at("c1").y]).toEqual([7, 2]);
    expect(at("a2").y).toBeCloseTo(at("a1").y + at("a1").h); // the rest of a stack follows it down
    expect(at("c2").x).toBeCloseTo(7);
  });

  test("a stack of several blocks has a header above it, with a button; a single block has none", () => {
    const l = lay(three());
    expect(l.stacks.map((s) => [s.firstId, s.count, s.collapsed])).toEqual([["a1", 2, false], ["c1", 2, false]]);
    const a = l.stacks[0];
    expect(a.header.y + a.header.h).toBeLessThanOrEqual(2); // above the first block
    expect(a.button.x).toBe(1);
  });

  test("the points where blocks can be dropped are labelled: above a stack, between its blocks, at its end", () => {
    const l = lay(three());
    const top = l.attach.filter((a) => a.parentId === null && a.top);
    expect(top.map((a) => a.index)).toEqual([0, 2, 3]); // above A, above B, above C
    const endOfA = l.attach.find((a) => a.parentId === null && !a.top && a.index === 2)!;
    expect(endOfA.y).toBeGreaterThan(top[0].y);
    expect(l.attach.filter((a) => a.parentId === null).map((a) => a.index).sort()).toEqual([0, 1, 2, 2, 3, 3, 4, 5]);
  });

  test("a folded stack shows its first block and a strip, and offers only the place above it", () => {
    const l = lay(setStackCollapsed(three(), "a1", true));
    expect(l.blocks.map((b) => b.block.id)).toEqual(["a1", "b1", "c1", "c2"]); // a2 is hidden
    const a = l.stacks[0];
    expect(a.collapsed).toBe(true);
    expect(a.strip).toBeDefined();
    expect(l.attach.filter((x) => x.parentId === null && x.index === 1)).toEqual([]);
    expect(l.attach.filter((x) => x.parentId === null && x.top && x.index === 0)).toHaveLength(1);
  });

  test("tapping the stack's button, or its header, or its strip", () => {
    const folded = lay(setStackCollapsed(three(), "a1", true));
    const a = folded.stacks[0];
    const mid = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;
    expect(hit(folded, ...mid(a.button))).toEqual({ kind: "stackFold", blockId: "a1" });
    expect(hit(folded, a.header.x + a.header.w - 0.05, a.header.y + a.header.h / 2)).toEqual({ kind: "block", blockId: "a1" });
    expect(hit(folded, ...mid(a.strip!))).toEqual({ kind: "block", blockId: "a1" } as Hit);
  });

  test("the lowest thing sets how far the workspace scrolls", () => {
    const l = lay(three());
    expect(l.bottom).toBeGreaterThan(7); // b1 is 5 down from y = 2, and a block is half a metre tall
  });

  test("a stack placed far to the right is given the room that is left, and never less than a little", () => {
    const l = lay([box("a", { x: 7.9, y: 0 }, "100")], 8);
    expect(l.blocks[0].bounds.x).toBeCloseTo(8.9);
    expect(Number.isFinite(l.blocks[0].bounds.w)).toBe(true);
  });
});

describe("picking up one block", () => {
  const ids = (blocks: Block[]) => blocks.map((b) => b.id);
  test("a block from the middle comes out alone and the others close up", () => {
    const { program, stack } = takeBlock(three(), "a2");
    expect(ids(stack)).toEqual(["a2"]);
    expect(ids(program)).toEqual(["a1", "b1", "c1", "c2"]);
    expect(runOrder(program).map((b) => b.id)).toEqual(["a1", "c1", "c2", "b1"]); // the stacks are still where they were
  });
  test("the first block of a stack comes out alone, and the rest of the stack keeps the stack's place", () => {
    const before = three();
    const first = before.find((b) => b.id === "a1")!;
    const { program, stack } = takeBlock(before, "a1");
    expect(ids(stack)).toEqual(["a1"]);
    const second = program.find((b) => b.id === "a2")!;
    expect(second.at).toEqual(first.at);
  });
  test("a holder comes out with what is inside it", () => {
    const p: Program = [{ id: "m", kind: "transform", args: {}, inner: [{ id: "c", kind: "box", args: {} }, { id: "d", kind: "box", args: {} }] }, { id: "z", kind: "box", args: {} }];
    const { program, stack } = takeBlock(p, "m");
    expect(ids(stack)).toEqual(["m"]);
    expect(ids(stack[0].inner ?? [])).toEqual(["c", "d"]);
    expect(ids(program)).toEqual(["z"]);
  });
  test("one block of the inside of a holder comes out alone", () => {
    const p: Program = [{ id: "m", kind: "transform", args: {}, inner: [{ id: "c", kind: "box", args: {} }, { id: "d", kind: "box", args: {} }, { id: "e", kind: "box", args: {} }] }];
    const { program, stack } = takeBlock(p, "d");
    expect(ids(stack)).toEqual(["d"]);
    expect(ids(program[0].inner ?? [])).toEqual(["c", "e"]);
  });
  test("a block that is not there leaves the program alone", () => {
    const p = three();
    expect(takeBlock(p, "nope")).toEqual({ program: p, stack: [] });
  });
});
