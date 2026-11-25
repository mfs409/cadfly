import { describe, expect, test } from "vitest";
import { History, type ProjectState, copyForHistory, sameFileNames, replacingFileData } from "../src/cadfly/history";
import { carryViewState, insertBlocks, moveScript, removeScript, setFlag, setScriptFold, takeBlock } from "../src/cadfly/language/edit";
import { findBlock } from "../src/cadfly/language/program";
import type { Program } from "../src/cadfly/language/types";
import { blk, box } from "./helpers/blocks";

/**
 * Undo and redo of whole projects, including their STL files, and what undo and
 * redo leave folded, opened and moved.
 */

test("undo and redo walk through the recorded states", () => {
  const h = new History<number[]>();
  expect(h.undo([1])).toBeNull();
  h.record([1]);
  h.record([1, 2]);
  expect(h.undo([1, 2, 3])).toEqual([1, 2]);
  expect(h.canRedo()).toBe(true);
  expect(h.redo([1, 2])).toEqual([1, 2, 3]);
  expect(h.undo([1, 2, 3])).toEqual([1, 2]);
});

test("a new change forgets what could be redone", () => {
  const h = new History<number[]>();
  h.record([1]);
  h.undo([1, 2]);
  expect(h.canRedo()).toBe(true);
  h.record([1]);
  expect(h.canRedo()).toBe(false);
});

test("recorded states are copies, so later edits do not change them", () => {
  const h = new History<{ n: number }>();
  const state = { n: 1 };
  h.record(state);
  state.n = 99;
  expect(h.undo({ n: 5 })).toEqual({ n: 1 });
});

test("only the most recent states are kept", () => {
  const h = new History<number>((n) => n, 3);
  for (const n of [1, 2, 3, 4, 5]) h.record(n);
  expect(h.undo(6)).toBe(5);
  expect(h.undo(5)).toBe(4);
  expect(h.undo(4)).toBe(3);
  expect(h.undo(3)).toBeNull(); // 1 and 2 were let go
  expect(h.canRedo()).toBe(true);
});

test("the copy that is kept is the one the history was given to make", () => {
  const h = new History<{ list: number[] }>((s) => ({ list: [...s.list, 0] }));
  h.record({ list: [1] });
  expect(h.undo({ list: [9] })).toEqual({ list: [1, 0] });
  expect(h.redo({ list: [1, 0] })).toEqual({ list: [9, 0] });
});

test("amendAll changes the states that can be undone to and redone to", () => {
  const h = new History<number>((n) => n);
  h.record(1);
  h.record(2);
  h.record(3);
  h.undo(4); // 3 is back, 4 can be redone
  h.amendAll((n) => n * 10);
  expect(h.redo(30)).toBe(40);
  expect(h.undo(40)).toBe(30);
  expect(h.undo(30)).toBe(20);
  expect(h.undo(20)).toBe(10);
});

const A = "AAAA";
const B = "BBBB";
const state = (files: Record<string, string>): ProjectState => ({ program: [{ id: "s1", name: "build", blocks: [{ id: "b1", kind: "box", args: {} }] }], files });

test("a copy of the project's state copies the blocks and shares the files", () => {
  const s = state({ "a.stl": A });
  const c = copyForHistory(s);
  expect(c.program).toEqual(s.program);
  expect(c.program).not.toBe(s.program);
  expect(c.files).toBe(s.files);
});

test("sameFileNames looks at the names and not at what is in the files", () => {
  expect(sameFileNames({}, {})).toBe(true);
  expect(sameFileNames({ "a.stl": A }, { "a.stl": B })).toBe(true);
  expect(sameFileNames({ "a.stl": A }, { "a.stl": A, "b.stl": A })).toBe(false);
  expect(sameFileNames({ "a.stl": A, "b.stl": A }, { "a.stl": A })).toBe(false);
  expect(sameFileNames({ "a.stl": A }, { "b.stl": A })).toBe(false);
});

test("replacingFileData gives the new data in every state that has the file, and leaves the others as they were", () => {
  const change = replacingFileData("a.stl", B);
  expect(change(state({ "a.stl": A, "b.stl": A })).files).toEqual({ "a.stl": B, "b.stl": A });
  const without = state({ "b.stl": A });
  expect(change(without)).toBe(without);
  const already = state({ "a.stl": B });
  expect(change(already)).toBe(already);
});

describe("files in the history", () => {
  const h = () => new History<ProjectState>(copyForHistory);

  test("adding a file and taking it away are steps that undo and redo", () => {
    const history = h();
    const none = state({});
    const withA = state({ "a.stl": A });
    history.record(none); // the file is added
    history.record(withA); // the file is taken away (the state before is the one with it)
    expect(history.undo(none)?.files).toEqual({ "a.stl": A }); // undo the removal: the file is back
    expect(history.undo(withA)?.files).toEqual({}); // undo the add: no file
    expect(history.redo(none)?.files).toEqual({ "a.stl": A });
  });

  test("a file loaded again is not a step, and no earlier state keeps the old file", () => {
    const history = h();
    history.record(state({ "a.stl": A })); // an earlier state that has the file
    history.record(state({})); // a later one that has not
    history.undo(state({ "a.stl": A })); // back to the one without; the one with the file waits to be redone
    history.amendAll(replacingFileData("a.stl", B)); // a.stl is loaded again, with different data
    expect(history.undo(state({ "a.stl": B }))?.files).toEqual({ "a.stl": B }); // the earlier state has the new data
    expect(history.redo(state({}))?.files).toEqual({ "a.stl": B }); // and so does the state redone to
  });
});

describe("undo and redo leave what is folded, opened and moved as it is", () => {
  /** Two scripts: build with a holder (b1, holding b2) and a box (b3), and a function `leg` with a box (b4) */
  const start = (): Program => [
    { id: "s1", name: "build", blocks: [blk("b1", "union", {}, [box("b2")]), box("b3")] },
    { id: "s2", name: "leg", at: { x: 5, y: 1 }, blocks: [box("b4")] },
  ];

  /**
   * A session as the page keeps one: `change` is a step that undo takes back
   * (it records the state first), `view` is a change to how things are shown
   * (it does not), and undo and redo put a state back with the display state of
   * the program as it is now.
   */
  function session(first: Program) {
    const h = new History<ProjectState>(copyForHistory);
    let program = first;
    const state = (): ProjectState => ({ program, files: {} });
    return {
      get program() {
        return program;
      },
      change(next: Program) {
        h.record(state());
        program = next;
      },
      view(next: Program) {
        program = next;
      },
      undo() {
        const prev = h.undo(state());
        if (prev) program = carryViewState(prev.program, program);
      },
      redo() {
        const next = h.redo(state());
        if (next) program = carryViewState(next.program, program);
      },
    };
  }

  test("a fold made after a step is still there when that step is undone, and redone", () => {
    const s = session(start());
    s.change(insertBlocks(s.program, { scriptId: "s1", index: 2 }, [box("b5")]));
    s.view(setScriptFold(s.program, "s2", true));
    s.view(setFlag(s.program, "b1", "collapsed", true));
    s.undo();
    expect(s.program[0].blocks.map((b) => b.id)).toEqual(["b1", "b3"]);
    expect(s.program[1].collapsed).toBe(true);
    expect(findBlock(s.program, "b1")!.block.collapsed).toBe(true);
    s.redo();
    expect(s.program[0].blocks.map((b) => b.id)).toEqual(["b1", "b3", "b5"]);
    expect(s.program[1].collapsed).toBe(true);
    expect(findBlock(s.program, "b1")!.block.collapsed).toBe(true);
  });

  test("a fold that was undone with the fold turned off stays off", () => {
    const s = session(setScriptFold(start(), "s2", true));
    s.change(insertBlocks(s.program, { scriptId: "s1", index: 2 }, [box("b5")]));
    s.view(setScriptFold(s.program, "s2", false));
    s.undo();
    expect(s.program[1].collapsed).toBeUndefined();
    s.view(setScriptFold(s.program, "s2", true));
    s.redo();
    expect(s.program[1].collapsed).toBe(true);
  });

  test("a script that was moved after a step stays where it was put", () => {
    const s = session(start());
    s.change(insertBlocks(s.program, { scriptId: "s1", index: 2 }, [box("b5")]));
    s.view(moveScript(s.program, "s2", { x: 7, y: 3 }));
    s.undo();
    expect(s.program[1].at).toEqual({ x: 7, y: 3 });
    s.redo();
    expect(s.program[1].at).toEqual({ x: 7, y: 3 });
  });

  test("a block or script that undo brings back keeps the state it had", () => {
    const folded = setFlag(setScriptFold(start(), "s2", true), "b1", "collapsed", true);
    const s = session(folded);
    s.change(removeScript(takeBlock(s.program, "b1").program, "s2"));
    expect(s.program).toHaveLength(1);
    s.undo();
    expect(s.program).toHaveLength(2);
    expect(s.program[1].collapsed).toBe(true);
    expect(s.program[1].at).toEqual({ x: 5, y: 1 });
    expect(findBlock(s.program, "b1")!.block.collapsed).toBe(true);
    s.redo();
    expect(s.program).toHaveLength(1);
  });

  test("what undo restores is not changed in place, and what is not display state is restored", () => {
    const before = start();
    const s = session(before);
    s.change(setFlag(s.program, "b3", "hidden", true));
    s.view(setScriptFold(s.program, "s1", true));
    s.undo();
    expect(findBlock(s.program, "b3")!.block.hidden).toBeUndefined();
    expect(s.program[0].collapsed).toBe(true);
    expect(before[0].collapsed).toBeUndefined();
  });

  test("carryViewState copies and leaves both programs alone", () => {
    const restored = start();
    const current = setScriptFold(start(), "s1", true);
    const out = carryViewState(restored, current);
    expect(out).not.toBe(restored);
    expect(restored[0].collapsed).toBeUndefined();
    expect(current[0].collapsed).toBe(true);
    expect(out[0].collapsed).toBe(true);
  });
});
