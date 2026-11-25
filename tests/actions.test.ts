import { beforeEach, describe, expect, test, vi } from "vitest";
import { createActions } from "../src/cadfly/ui/editor/actions";
import type { EditorContext, EditorHost, Touched } from "../src/cadfly/ui/editor/types";
import { openFieldEditor, openInfo } from "../src/cadfly/ui/fields";
import type { Hit } from "../src/cadfly/ui/layout";
import { findBlock } from "../src/cadfly/language/program";
import type { Param, Program } from "../src/cadfly/language/types";
import { blk } from "./helpers/blocks";
import { oneScript } from "./helpers/script-helpers";

/**
 * What a tap does in the editor: which change to the program each kind of tap
 * asks for, and what is opened for typing or reading. The page's pop-ups and
 * the engine's camera are stand-ins.
 */

vi.mock("jetlag2d", () => ({ stage: { world: {} } }));
vi.mock("../src/cadfly/ui/fields", () => ({ openFieldEditor: vi.fn(), openInfo: vi.fn() }));
vi.mock("../src/cadfly/ui/editor/page", () => ({ pageRect: (_scene: unknown, r: { x: number; y: number; w: number; h: number }) => ({ left: r.x, top: r.y, width: r.w, height: r.h }) }));

const RECT = { x: 1, y: 2, w: 3, h: 4 };
const W: Param = { id: "w", label: "width", type: { kind: "expr", want: "number" }, default: "10" } as Param; // cast: only the shape the editor reads is needed

/** An editor over this program: the changes the taps ask for are applied to it, and recorded. */
function setup(program: Program, extra: Partial<EditorHost> = {}) {
  let current = program;
  const changes: { program: Program; options?: { undoable?: boolean } }[] = [];
  const notices: string[] = [];
  const pressed: [string, string][] = [];
  const host = {
    program: () => current,
    change: (next: Program, options?: { undoable?: boolean }) => {
      current = next;
      changes.push({ program: next, options });
    },
    problem: () => undefined,
    buttons: () => [],
    notify: (m: string) => notices.push(m),
    pressButton: (blockId: string, id: string) => pressed.push([blockId, id]),
    ...extra,
  } as unknown as EditorHost; // cast: the editor's host has more parts than the taps use
  const st = { layout: { blocks: [], scripts: [] }, hotspots: [], category: "shapes" };
  const ctx = { host, st, render: vi.fn(), reveal: vi.fn() } as unknown as EditorContext; // cast: only what the taps use
  const actions = createActions(ctx);
  const tap = (t: Touched) => actions.onTap(t);
  const work = (hit: Hit) => tap({ kind: "work", hit });
  return { tap, work, changes, notices, pressed, st, ctx, program: () => current };
}

const box = () => blk("b1", "box", { w: "10", d: "10", h: "10" });

beforeEach(() => vi.clearAllMocks());

describe("tapping a block in the palette", () => {
  test("a block is added at the end of the program, with all its fields, as a step", () => {
    const t = setup(oneScript([box()]));
    t.tap({ kind: "palette", blockKind: "sphere" });
    const blocks = t.program()[0].blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["box", "sphere"]);
    expect(Object.keys(blocks[1].args).length).toBeGreaterThan(0);
    expect(t.changes).toHaveLength(1);
    expect(t.changes[0].options).toBeUndefined();
  });

  test("a piece goes into the last block that can hold it", () => {
    const t = setup(oneScript([blk("b1", "polygon", {}, [blk("b2", "point", { u: "0", v: "0" })]), blk("b3", "polygon", {}, [])]));
    t.tap({ kind: "palette", blockKind: "point" });
    const [first, second] = t.program()[0].blocks;
    expect(first.inner).toHaveLength(1);
    expect(second.inner!.map((b) => b.kind)).toEqual(["point"]);
  });

  test("a piece with nothing to hold it is not added, and the person is told where it goes", () => {
    const t = setup(oneScript([box()]));
    t.tap({ kind: "palette", blockKind: "point" });
    expect(t.changes).toEqual([]);
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toMatch(/point/);
  });
});

describe("tapping a tab, a button or the new script button", () => {
  test("a tab chooses the category and draws again", () => {
    const t = setup(oneScript([]));
    t.tap({ kind: "tab", category: "combine" });
    expect(t.st.category).toBe("combine");
    expect(t.ctx.render).toHaveBeenCalledTimes(1);
  });

  test("a toolbar button does its action where it is, only if it is enabled", () => {
    const action = vi.fn();
    let enabled = false;
    const t = setup(oneScript([]), { buttons: () => [{ group: "file", label: "Save", color: "#fff", enabled: () => enabled, action }] as unknown as ReturnType<EditorHost["buttons"]> }); // cast: only what the tap reads
    t.st.hotspots.push({ rect: RECT, touched: { kind: "button", index: 0 } } as never); // cast: a hotspot, as the editor lays them out
    t.tap({ kind: "button", index: 0 });
    expect(action).not.toHaveBeenCalled();
    enabled = true;
    t.tap({ kind: "button", index: 0 });
    expect(action).toHaveBeenCalledWith(RECT);
  });

  test("a new script is added last with a name nobody has, as a step", () => {
    const t = setup(oneScript([box()]));
    t.tap({ kind: "newScript" });
    t.tap({ kind: "newScript" });
    const names = t.program().map((s) => s.name);
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(t.changes).toHaveLength(2);
  });

  test("a tap on nothing does nothing", () => {
    const t = setup(oneScript([box()]));
    t.tap({ kind: "empty" });
    expect(t.changes).toEqual([]);
  });
});

describe("tapping the switches of a block", () => {
  test("the eye and the power switch turn a setting over, and Undo takes that back", () => {
    const t = setup(oneScript([blk("b1", "subtract", {}, [box()])]));
    t.work({ kind: "eye", blockId: "b1" });
    expect(findBlock(t.program(), "b1")!.block.hidden).toBe(true);
    expect(t.changes[0].options).toBeUndefined();
    t.work({ kind: "eye", blockId: "b1" });
    expect(findBlock(t.program(), "b1")!.block.hidden).not.toBe(true);
    t.work({ kind: "power", blockId: "b1" });
    expect(findBlock(t.program(), "b1")!.block.disabled).toBe(true);
    expect(t.changes[2].options).toBeUndefined();
  });

  test("folding a block changes how it is shown, not what it makes, so Undo does not take it back", () => {
    const t = setup(oneScript([blk("b1", "union", {}, [box()])]));
    t.work({ kind: "blockFold", blockId: "b1" });
    expect(findBlock(t.program(), "b1")!.block.collapsed).toBe(true);
    expect(t.changes[0].options).toEqual({ undoable: false });
  });

  test("a tap on a block that has gone changes nothing", () => {
    const t = setup(oneScript([box()]));
    t.work({ kind: "eye", blockId: "gone" });
    t.work({ kind: "flag", blockId: "gone", param: W });
    expect(t.changes).toEqual([]);
  });

  test("a tick is turned over, starting from its default when the block has not set it", () => {
    const hole: Param = { id: "hole", label: "hole", type: { kind: "flag" }, default: false } as Param; // cast: only the shape the editor reads is needed
    const t = setup(oneScript([blk("b1", "circle", {})]));
    t.work({ kind: "flag", blockId: "b1", param: hole });
    expect(findBlock(t.program(), "b1")!.block.args.hole).toBe(true);
    t.work({ kind: "flag", blockId: "b1", param: hole });
    expect(findBlock(t.program(), "b1")!.block.args.hole).not.toBe(true);
  });

  test("a block's own button is handed to the page, with the block it belongs to", () => {
    const t = setup(oneScript([box()]));
    t.work({ kind: "button", blockId: "b1", id: "hull" });
    expect(t.pressed).toEqual([["b1", "hull"]]);
    expect(t.changes).toEqual([]);
  });
});

describe("tapping the header of a script", () => {
  const program = (): Program => [
    { id: "s1", name: "build", blocks: [box()] },
    { id: "s2", name: "leg", inputs: "w", blocks: [box()] },
  ];

  test("the fold button folds and unfolds it, without a step to undo", () => {
    const t = setup(program());
    t.work({ kind: "scriptFold", scriptId: "s2" });
    expect(t.program()[1].collapsed).toBe(true);
    t.work({ kind: "scriptFold", scriptId: "s2" });
    expect(t.program()[1].collapsed).not.toBe(true);
    expect(t.changes.every((c) => c.options?.undoable === false)).toBe(true);
  });

  test("the remove button takes the script away, and a script that cannot go is explained", () => {
    const t = setup(program());
    t.work({ kind: "scriptRemove", scriptId: "s2" });
    expect(t.program().map((s) => s.id)).toEqual(["s1"]);
    t.work({ kind: "scriptRemove", scriptId: "s1" }); // build cannot be removed
    expect(t.program().map((s) => s.id)).toEqual(["s1"]);
    expect(t.notices).toHaveLength(1);
    expect(t.notices[0]).toMatch(/not removed/);
  });

  test("the name and the inputs open for typing with what they hold, and a name that will not do is explained", () => {
    const t = setup(program());
    t.work({ kind: "scriptName", scriptId: "s2", rect: RECT });
    const name = vi.mocked(openFieldEditor).mock.calls[0][0];
    expect(name.value).toBe("leg");
    name.onCommit("foot");
    expect(t.program()[1].name).toBe("foot");
    t.work({ kind: "scriptInputs", scriptId: "s2", rect: RECT });
    const inputs = vi.mocked(openFieldEditor).mock.calls[1][0];
    expect(inputs.value).toBe("w");
    inputs.onCommit("w, h");
    expect(t.program()[1].inputs).toBe("w, h");
    name.onCommit("2 bad name");
    expect(t.notices.at(-1)).toMatch(/not renamed/);
    expect(t.program()[1].name).toBe("foot"); // left as it was
  });

  test("the name goes on to the inputs with Tab, and no further back than the name", () => {
    const t = setup(program());
    t.work({ kind: "scriptName", scriptId: "s2", rect: RECT });
    const { canTab } = vi.mocked(openFieldEditor).mock.calls[0][0];
    expect(canTab!(1)).toBe(true);
    expect(canTab!(-1)).toBe(false);
  });

  test("an unnamed script (the globals) has no name to type", () => {
    const t = setup([{ id: "g", blocks: [blk("b1", "set", { name: "w", value: "1" })] }, ...program()]);
    t.work({ kind: "scriptName", scriptId: "g", rect: RECT });
    expect(openFieldEditor).not.toHaveBeenCalled();
  });
});

describe("tapping a field", () => {
  test("it opens for typing with what the block holds, or the default, and keeping it changes the block as a step", () => {
    const t = setup(oneScript([blk("b1", "box", { w: "40" })]));
    t.work({ kind: "field", blockId: "b1", param: W, rect: RECT });
    const open = vi.mocked(openFieldEditor).mock.calls[0][0];
    expect(open.value).toBe("40");
    open.onCommit("55");
    expect(findBlock(t.program(), "b1")!.block.args.w).toBe("55");
    expect(t.changes[0].options).toBeUndefined();
    const other: Param = { ...W, id: "d" };
    t.work({ kind: "field", blockId: "b1", param: other, rect: RECT });
    expect(vi.mocked(openFieldEditor).mock.calls[1][0].value).toBe("10"); // the default
  });

  test("a field of a block that has gone does not open", () => {
    const t = setup(oneScript([box()]));
    t.work({ kind: "field", blockId: "gone", param: W, rect: RECT });
    expect(openFieldEditor).not.toHaveBeenCalled();
  });

  test("a file field is a menu of the project's files when the page has one, and a list of them when it does not", () => {
    const file: Param = { id: "file", label: "file", type: { kind: "file" }, default: "" } as Param; // cast: only the shape the editor reads is needed
    const chooseFile = vi.fn();
    const withMenu = setup(oneScript([blk("b1", "import", { file: "a.stl" })]), { chooseFile });
    withMenu.work({ kind: "field", blockId: "b1", param: file, rect: RECT });
    expect(chooseFile).toHaveBeenCalledTimes(1);
    expect(chooseFile.mock.calls[0][1]).toBe("a.stl");
    chooseFile.mock.calls[0][2]("b.stl");
    expect(findBlock(withMenu.program(), "b1")!.block.args.file).toBe("b.stl");
    expect(openFieldEditor).not.toHaveBeenCalled();

    const without = setup(oneScript([blk("b1", "import", { file: "" })]), { files: () => ["a.stl", "b.stl"] });
    without.work({ kind: "field", blockId: "b1", param: file, rect: RECT });
    const param = vi.mocked(openFieldEditor).mock.calls[0][0].param;
    expect(param.type.kind).toBe("choice");
    expect((param.type as unknown as { options: { value: string }[] }).options.map((o) => o.value)).toEqual(["", "a.stl", "b.stl"]); // cast: the file param type is a choice here, and the type only says so after the narrowing the test just checked
  });
});

describe("tapping the ? of a measure block", () => {
  test("it shows what was measured, named for use below the block, or says it has not run yet", () => {
    const measure = blk("b1", "measure", { name: "plate" }, [box()]);
    const none = setup(oneScript([measure]), { measurements: () => undefined });
    none.work({ kind: "info", blockId: "b1", rect: RECT });
    expect(vi.mocked(openInfo).mock.calls[0][1]).toMatch(/not measured yet/);
    const found = { plate_w: 40, plate_d: 30, plate_h: 5, plate_x0: -20, plate_x1: 20, plate_y0: -15, plate_y1: 15, plate_z0: 0, plate_z1: 5 };
    const some = setup(oneScript([measure]), { measurements: () => found });
    some.work({ kind: "info", blockId: "b1", rect: RECT });
    const [, title, lines] = vi.mocked(openInfo).mock.calls[1];
    expect(title).toContain("plate");
    expect(lines.join("\n")).toContain("40 wide");
    expect(lines.join("\n")).toContain("plate_w");
  });
});
