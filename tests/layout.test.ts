import { describe, expect, test } from "vitest";
import { findBlock } from "../src/cadfly/language/edit";
import { blockOutline } from "../src/cadfly/language/outline";
import { DEFAULT_METRICS, type Rect, acceptingPoints, hit, layoutProgram, nearestPoint } from "../src/cadfly/language/layout";
import type { Block, Program } from "../src/cadfly/language/types";

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id, kind, args, ...(inner ? { inner } : {}) });
const measure = (t: string) => t.length * 0.1;
const lay = (p: Program, width = 8) => layoutProgram(p, { x: 1, y: 2, width, measure });
const within = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-9 && inner.y >= outer.y - 1e-9 && inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;

const m = DEFAULT_METRICS;

describe("one block", () => {
  const p: Program = [blk("b1", "box", { name: "plate", w: "40", d: "30", h: "5" })];

  test("its header is a word, then each label and field, in order, left to right", () => {
    const l = lay(p).blocks[0];
    // the caption (here "plate") is a line above the header, not part of it
    expect(l.parts.map((x) => [x.kind, x.text])).toEqual([
      ["caption", "plate"], // first, so Tab goes caption, then the fields
      ["fold", "−"], // every block starts with its fold button
      ["word", "box"],
      ["label", "width"],
      ["field", "40"],
      ["label", "depth"],
      ["field", "30"],
      ["label", "height"],
      ["field", "5"],
      ["label", "at x"],
      ["field", "0"],
      ["label", "y"],
      ["field", "0"],
      ["label", "z"],
      ["field", "0"],
      ["eye", "shown"], // every block that makes a shape ends with an eye
    ]);
    const header = l.parts.filter((x) => x.kind !== "caption");
    const xs = header.map((x) => x.rect.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(l.rows).toHaveLength(1);
    expect(l.bounds.x).toBe(1);
    expect(l.bounds.y).toBe(2);
    expect(l.rows[0].y).toBeCloseTo(2 + m.captionH); // the header starts under the caption
    header.forEach((x) => expect(within(x.rect, l.rows[0])).toBe(true));
    const caption = l.parts.find((x) => x.kind === "caption")!;
    expect(caption.rect.y).toBe(2);
    expect(caption.param!.id).toBe("name");
  });

  test("a block with no caption takes no extra room: no caption line, nothing added to the header, and its word opens the caption", () => {
    const l = lay([blk("b1", "box", { name: "", w: "40", d: "30", h: "5" })]).blocks[0];
    expect(l.parts.map((x) => x.kind)).toEqual(["fold", "word", "label", "field", "label", "field", "label", "field", "label", "field", "label", "field", "label", "field", "eye"]);
    expect(l.parts.find((x) => x.kind === "word")!.captionParam!.id).toBe("name"); // the word is the way to add one
    expect(l.rows[0].y).toBe(2); // nothing above it
    expect(l.bounds.h).toBeCloseTo(m.rowH);
    // the header is no wider than the same block would be with no caption field at all
    const widest = Math.max(...l.parts.map((x) => x.rect.x + x.rect.w));
    expect(widest).toBeLessThan(l.rows[0].x + l.rows[0].w);
  });

  test("a caption of only spaces is no caption: no blank line", () => {
    const l = lay([blk("b1", "box", { name: "   ", w: "4", d: "4", h: "4" })]).blocks[0];
    expect(l.parts.some((x) => x.kind === "caption")).toBe(false);
    expect(l.bounds.h).toBeCloseTo(m.rowH);
    expect(l.parts.find((x) => x.kind === "word")!.captionParam!.id).toBe("name");
  });

  test("a block with no caption field (set, move) has no caption line, and its word opens nothing", () => {
    const move = lay([blk("b1", "transform", {}, [])]).blocks[0];
    expect(move.parts.some((x) => x.kind === "caption")).toBe(false);
    expect(move.parts.find((x) => x.kind === "word")!.captionParam).toBeUndefined();
    expect(lay([blk("b1", "set", { name: "w", value: "4" })]).blocks[0].parts.find((x) => x.kind === "word")!.captionParam).toBeUndefined();
  });

  test("tapping the caption, or the block's word, opens the caption field", () => {
    const named = lay(p);
    const cap = named.blocks[0].parts.find((x) => x.kind === "caption")!;
    expect(hit(named, cap.rect.x + 0.05, cap.rect.y + cap.rect.h / 2)).toMatchObject({ kind: "field", blockId: "b1" });
    const bare = lay([blk("b1", "box", { name: "" })]);
    const word = bare.blocks[0].parts.find((x) => x.kind === "word")!;
    expect(hit(bare, word.rect.x + word.rect.w / 2, word.rect.y + word.rect.h / 2)).toMatchObject({ kind: "field", blockId: "b1", param: { id: "name" } });
  });

  test("a field is wide enough for what it holds, and no narrower than the minimum", () => {
    const l = lay([blk("b1", "box", { w: "a-very-long-expression", d: "1" })]).blocks[0];
    const [w, d] = l.parts.filter((x) => x.kind === "field");
    expect(w.rect.w).toBeCloseTo(measure("a-very-long-expression") + 2 * m.chipPad);
    expect(d.rect.w).toBe(m.minChipW);
  });

  test("a long header wraps onto more rows, and every part stays inside its row", () => {
    const l = lay([blk("b1", "box", { name: "", w: "40", d: "30", h: "5" })], 3.2).blocks[0];
    expect(l.rows.length).toBeGreaterThan(1);
    expect(l.bounds.h).toBeCloseTo(l.rows.length * m.rowH);
    const rowOf = (part: { rect: Rect }) => l.rows.findIndex((r) => within(part.rect, r));
    l.parts.forEach((part) => expect(rowOf(part)).toBeGreaterThanOrEqual(0));
    // parts are in non-decreasing rows
    const rows = l.parts.map(rowOf);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    l.rows.forEach((r) => expect(r.x + r.w).toBeLessThanOrEqual(1 + 3.2 + 1e-9));
  });

  test("a label never gets separated from its field, however narrow the block", () => {
    for (const width of [1.6, 2.2, 3.2, 4.5]) {
      const l = lay([blk("b1", "box", { name: "plate", w: "40", d: "30", h: "5" })], width).blocks[0];
      l.parts.forEach((part, i) => {
        if (part.kind !== "label") return;
        const field = l.parts[i + 1];
        expect(field.kind, `width ${width}`).toBe("field");
        expect(field.rect.y + field.rect.h / 2, `width ${width}`).toBeCloseTo(part.rect.y + part.rect.h / 2);
      });
    }
  });

  test("a flag shows a tick only when set", () => {
    const off = lay([blk("b1", "extrude", {}, [blk("b2", "circle", { hole: false })])]).blocks[1];
    const on = lay([blk("b1", "extrude", {}, [blk("b2", "circle", { hole: true })])]).blocks[1];
    expect(off.parts.find((x) => x.kind === "flag")!.text).toBe("");
    expect(on.parts.find((x) => x.kind === "flag")!.text).toBe("✓");
  });
});

describe("blocks in a list", () => {
  const p: Program = [blk("b1", "box"), blk("b2", "sphere"), blk("b3", "cylinder")];

  test("each sits right under the one before, with the same left edge", () => {
    const { blocks } = lay(p);
    expect(blocks.map((b) => b.bounds.x)).toEqual([1, 1, 1]);
    expect(blocks[1].bounds.y).toBeCloseTo(blocks[0].bounds.y + blocks[0].bounds.h);
    expect(blocks[2].bounds.y).toBeCloseTo(blocks[1].bounds.y + blocks[1].bounds.h);
  });

  test("there is a drop point before the first block, between blocks, and after the last", () => {
    const l = lay(p);
    expect(l.attach.map((a) => [a.parentId, a.index])).toEqual([[null, 0], [null, 1], [null, 2], [null, 3]]);
    expect(l.attach[0]).toMatchObject({ x: 1, y: 2 });
    expect(l.attach[1].y).toBeCloseTo(l.blocks[1].bounds.y);
    expect(l.attach[3].y).toBeCloseTo(l.bottom);
  });

  test("an empty program still has one drop point", () => {
    const l = lay([]);
    expect(l.attach).toEqual([{ parentId: null, index: 0, x: 1, y: 2, top: true }]);
    expect(l.bottom).toBe(2);
  });
});

describe("a block with blocks inside", () => {
  const p: Program = [blk("b1", "extrude", { name: "plate" }, [blk("b2", "rectangle"), blk("b3", "circle")]), blk("b4", "box")];

  test("what is inside is indented, under the header, and the block frames it", () => {
    const l = lay(p);
    const [ext, rect, circ, box] = l.blocks;
    expect(rect.bounds.x).toBeCloseTo(1 + m.indent);
    expect(rect.bounds.y).toBeCloseTo(ext.rows[0].y + ext.rows.length * m.rowH);
    expect(circ.bounds.y).toBeCloseTo(rect.bounds.y + rect.bounds.h);
    expect(ext.spine).toBeDefined();
    expect(ext.footer!.y).toBeCloseTo(circ.bounds.y + circ.bounds.h);
    expect(within(rect.bounds, ext.bounds)).toBe(true);
    expect(within(circ.bounds, ext.bounds)).toBe(true);
    // the next block starts under the footer
    expect(box.bounds.y).toBeCloseTo(ext.footer!.y + ext.footer!.h);
    expect(ext.bounds.y + ext.bounds.h).toBeCloseTo(box.bounds.y);
  });

  test("the frame is as wide as the widest thing inside", () => {
    const wide = lay([blk("b1", "extrude", {}, [blk("b2", "rectangle", { u: "123456789012345678901234567890" })])], 12);
    const [ext, rect] = wide.blocks;
    expect(ext.bounds.w).toBeGreaterThanOrEqual(rect.bounds.x + rect.bounds.w - ext.bounds.x - 1e-9);
    expect(ext.footer!.w).toBeCloseTo(ext.bounds.w);
  });

  test("an empty one shows a gap to drop into, and a drop point inside it", () => {
    const l = lay([blk("b1", "extrude")]);
    const ext = l.blocks[0];
    expect(ext.empty).toBeDefined();
    expect(ext.empty!.h).toBe(m.emptyH);
    const inside = l.attach.filter((a) => a.parentId === "b1");
    expect(inside).toEqual([{ parentId: "b1", index: 0, x: 1 + m.indent, y: 2 + m.rowH }]);
  });

  test("drop points inside name the block that holds them", () => {
    const l = lay(p);
    expect(l.attach.filter((a) => a.parentId === "b1").map((a) => a.index)).toEqual([0, 1, 2]);
    expect(l.attach.filter((a) => a.parentId === null).map((a) => a.index)).toEqual([0, 1, 2]);
  });
});

describe("where a dragged stack may go", () => {
  const p: Program = [blk("b1", "extrude", {}, [blk("b2", "rectangle")]), blk("b3", "box"), blk("b4", "extrude")];

  test("a solid goes at the top level only; a flat shape goes there or into an extrude", () => {
    const l = lay(p);
    const top = acceptingPoints(l, p, ["box"]);
    expect(top.every((a) => a.parentId === null)).toBe(true);
    expect(top).toHaveLength(4);
    const piece = acceptingPoints(l, p, ["circle"]);
    expect(piece.every((a) => a.parentId === null || a.parentId === "b1" || a.parentId === "b4")).toBe(true);
    expect(piece).toHaveLength(7); // the four places at the top, and before and after the rectangle, and into the empty extrude
  });

  test("a stack goes where all of its blocks are allowed", () => {
    const l = lay(p);
    expect(acceptingPoints(l, p, ["rectangle", "box"])).toHaveLength(4); // only the top takes a box
    expect(acceptingPoints(l, p, ["rectangle", "circle"])).toHaveLength(7);
  });

  test("the nearest drop point wins, within a range", () => {
    const l = lay(p);
    const all = acceptingPoints(l, p, ["box"]);
    expect(nearestPoint(all, 1.1, 2.1, 1)).toEqual(all[0]);
    const last = all[all.length - 1];
    expect(nearestPoint(all, last.x + 0.1, last.y - 0.1, 1)).toEqual(last);
    expect(nearestPoint(all, 50, 50, 1)).toBeUndefined();
  });
});

describe("what is under a pointer", () => {
  const p: Program = [blk("b1", "extrude", { name: "plate" }, [blk("b2", "circle", { hole: true })]), blk("b3", "box", { name: "b" })];
  const l = lay(p);
  const centre = (r: Rect) => [r.x + r.w / 2, r.y + r.h / 2] as const;

  test("a field gives the field", () => {
    const field = l.blocks[0].parts.find((x) => x.kind === "field" && x.param?.id === "height")!;
    const h = hit(l, ...centre(field.rect));
    expect(h).toMatchObject({ kind: "field", blockId: "b1" });
    expect((h as { param: { id: string } }).param.id).toBe("height");
  });

  test("a flag gives the flag", () => {
    const flag = l.blocks[1].parts.find((x) => x.kind === "flag")!;
    expect(hit(l, ...centre(flag.rect))).toMatchObject({ kind: "flag", blockId: "b2" });
  });

  test("the word, the frame and the footer give the block", () => {
    // a block with a caption field opens it when its word is tapped; one with none (a circle) gives the block
    const word0 = l.blocks[0].parts.find((x) => x.kind === "word")!;
    expect(hit(l, ...centre(word0.rect))).toMatchObject({ kind: "field", blockId: "b1", param: { id: "name" } });
    expect(hit(l, ...centre(l.blocks[0].spine!))).toEqual({ kind: "block", blockId: "b1" });
    expect(hit(l, ...centre(l.blocks[0].footer!))).toEqual({ kind: "block", blockId: "b1" });
    // a block inside another is found as itself
    const word = l.blocks[1].parts.find((x) => x.kind === "word")!.rect;
    expect(hit(l, ...centre(word))).toEqual({ kind: "block", blockId: "b2" });
  });

  test("empty space gives nothing", () => {
    expect(hit(l, 0, 0)).toBeUndefined();
    expect(hit(l, 1 + 7.9, 2 + 0.2)).toBeUndefined();
    expect(findBlock(p, "b3")).toBeDefined();
  });
});

describe("holders of shapes", () => {
  const tree: Program = [
    blk("b1", "subtract", { name: "cut" }, [
      blk("b2", "set", { name: "r", value: "3" }),
      blk("b3", "box", { name: "block" }),
      blk("b4", "transform", {}, [blk("b5", "cylinder", { name: "pin" })]),
    ]),
  ];

  test("the first shape inside a subtract (not a set) is labelled as the base", () => {
    const l = lay(tree);
    const labelled = l.blocks.filter((b) => b.parts.some((p) => p.kind === "label" && p.text === "base:")).map((b) => b.block.id);
    expect(labelled).toEqual(["b3"]);
    const base = l.blocks.find((b) => b.block.id === "b3")!;
    const header = base.parts.filter((p) => p.kind !== "caption" && p.kind !== "fold");
    expect(header[0]).toMatchObject({ kind: "label", text: "base:" });
    expect(header[1]).toMatchObject({ kind: "word", text: "box" });
  });

  test("other holders have no base, and nesting goes as deep as the blocks do", () => {
    const l = lay([blk("b1", "transform", {}, [blk("b2", "transform", {}, [blk("b3", "transform", {}, [blk("b4", "box")])])])]);
    expect(l.blocks.map((b) => b.depth)).toEqual([0, 1, 2, 3]);
    expect(l.blocks.some((b) => b.parts.some((p) => p.text === "base:"))).toBe(false);
  });

  test("shapes can be dropped inside a holder, and the parts of a block cannot", () => {
    const l = lay([blk("b1", "transform", {}, [])]);
    expect(acceptingPoints(l, [blk("b1", "transform", {}, [])], ["box", "transform", "set"]).length).toBeGreaterThan(0);
    expect(acceptingPoints(l, [blk("b1", "transform", {}, [])], ["point"]).every((a) => a.parentId !== "b1")).toBe(true);
  });
});

describe("folding a block", () => {
  const open: Program = [
    blk("b1", "transform", { x: "1" }, [blk("b2", "box"), blk("b3", "sphere")]),
    blk("b4", "box"),
  ];
  const folded = (id = "b1"): Program => open.map((b) => (b.id === id ? { ...b, collapsed: true } : b));

  test("every block starts with a - button (+ when it is folded)", () => {
    const l = lay(open);
    for (const b of l.blocks) expect(b.parts[0], b.block.id).toMatchObject({ kind: "fold", text: "−" });
    expect(l.blocks[0].parts[0].param).toBeUndefined();
    expect(lay(folded()).blocks[0].parts[0]).toMatchObject({ kind: "fold", text: "+" });
    expect(lay(folded("b4")).blocks.find((b) => b.block.id === "b4")!.parts[0]).toMatchObject({ kind: "fold", text: "+" });
  });

  test("tapping the button gives a fold hit, before anything else under it", () => {
    const l = lay(open);
    for (const b of l.blocks) {
      const r = b.parts[0].rect;
      expect(hit(l, r.x + r.w / 2, r.y + r.h / 2)).toEqual({ kind: "fold", blockId: b.block.id });
    }
  });

  test("a folded block is only its button: no word, no fields, no switches, and what was inside is gone from the layout", () => {
    const l = lay(folded());
    expect(l.blocks.map((b) => b.block.id)).toEqual(["b1", "b4"]);
    const b1 = l.blocks[0];
    expect(b1.parts.map((p) => p.kind)).toEqual(["fold"]);
    expect(b1.spine).toBeUndefined();
    expect(b1.footer).toBeUndefined();
    expect(b1.empty).toBeUndefined();
    // a small square, and the next block follows it directly
    expect(b1.bounds.w).toBeLessThan(0.8);
    expect(b1.bounds.h).toBeCloseTo(m.rowH);
    expect(l.blocks[1].bounds.y).toBeCloseTo(b1.bounds.y + b1.bounds.h);
  });

  test("a folded plain block is a button too, and a caption does not show while it is folded", () => {
    const l = lay([{ ...blk("b1", "box", { name: "plate", w: "40" }), collapsed: true }]).blocks[0];
    expect(l.parts.map((p) => p.kind)).toEqual(["fold"]);
    expect(l.bounds.h).toBeCloseTo(m.rowH);
  });

  test("nothing can be dropped inside a folded block, but the places above and below it remain", () => {
    const l = lay(folded());
    expect(l.attach.filter((a) => a.parentId === "b1")).toEqual([]);
    expect(l.attach.filter((a) => a.parentId === null)).toHaveLength(3);
  });

  test("a folded block is a plain rounded box: one rectangle, with no notch", () => {
    expect(blockOutline(lay(folded()).blocks[0], 0)).toBeUndefined(); // no notch to draw: the editor draws a plain rounded box
  });
});

