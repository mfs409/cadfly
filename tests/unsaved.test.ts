import { describe, expect, test } from "vitest";
import { createEmptyProgram } from "../src/cadfly/language/program";
import type { Block, Program } from "../src/cadfly/language/types";
import { contentText, unsavedChanges } from "../src/cadfly/unsaved";
import { oneScript } from "./helpers/script-helpers";

/**
 * Whether the project has changed since it was saved. How the blocks are shown
 * is not a change; the blocks and the files are.
 */

const box = (extra: Partial<Block> = {}): Block => ({ id: "b1", kind: "box", args: { w: "10" }, ...extra });
const files = { "a.stl": "AAAA" };

describe("the program as text, without how it is shown", () => {
  test("where a script is, and whether it is folded, are not part of it", () => {
    const plain: Program = [{ id: "s1", name: "build", blocks: [box()] }];
    const moved: Program = [{ id: "s1", name: "build", at: { x: 4, y: 9 }, collapsed: true, blocks: [box()] }];
    expect(contentText(moved)).toBe(contentText(plain));
  });

  test("a block's fold is not part of it", () => {
    expect(contentText(oneScript([box({ collapsed: true })]))).toBe(contentText(oneScript([box()])));
    const holder: Block = { id: "b2", kind: "union", args: {}, inner: [box({ collapsed: true })] };
    const plainHolder: Block = { id: "b2", kind: "union", args: {}, inner: [box()] };
    expect(contentText(oneScript([holder]))).toBe(contentText(oneScript([plainHolder])));
  });

  test("a field that is only for looking is not part of it", () => {
    const vertices = (show: boolean): Block => ({ id: "b1", kind: "vertices", args: { show }, inner: [] });
    expect(contentText(oneScript([vertices(true)]))).toBe(contentText(oneScript([vertices(false)])));
  });

  test("a change to a block's field is part of it", () => {
    expect(contentText(oneScript([box({ args: { w: "11" } })]))).not.toBe(contentText(oneScript([box()])));
  });
});

describe("has the project changed since it was saved", () => {
  const program = oneScript([box()]);
  const saved = contentText(program);

  test("not when nothing differs", () => {
    expect(unsavedChanges(program, files, saved, files)).toBe(false);
  });

  test("not when only how it is shown differs: moving or folding a script, folding a block", () => {
    const shown: Program = [{ ...program[0], at: { x: 3, y: 3 }, collapsed: true, blocks: [box({ collapsed: true })] }];
    expect(unsavedChanges(shown, files, saved, files)).toBe(false);
  });

  test("yes when a block changed", () => {
    expect(unsavedChanges(oneScript([box({ args: { w: "12" } })]), files, saved, files)).toBe(true);
  });

  test("yes when a file was added, removed or replaced, however the file set is held", () => {
    expect(unsavedChanges(program, { ...files, "b.stl": "BBBB" }, saved, files)).toBe(true);
    expect(unsavedChanges(program, {}, saved, files)).toBe(true);
    expect(unsavedChanges(program, { "a.stl": "AAAB" }, saved, files)).toBe(true);
  });

  test("not when the files are another object with the same text", () => {
    expect(unsavedChanges(program, { ...files }, saved, files)).toBe(false);
  });

  test("never for an empty program, which has nothing to lose", () => {
    expect(unsavedChanges(createEmptyProgram(), files, saved, {})).toBe(false);
  });
});
