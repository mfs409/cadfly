import { describe, expect, test } from "vitest";
import { commandById } from "../src/cadfly/language/commands";
import { findBlock, createEmptyProgram } from "../src/cadfly/language/program";
import { DEFAULT_METRICS, type EditableScriptLayout, type Rect, type DropPoint, type ScriptLayout, acceptingPoints, blockOutline, fitText, hit, layoutProgram, nearestPoint, roundedPolygon, type Hit } from "../src/cadfly/ui/layout";
import type { Block, Point, Program } from "../src/cadfly/language/types";
import { oneScript, topBlocks } from "./helpers/script-helpers";
import { addScript, setScriptFold, takeBlock } from "../src/cadfly/language/edit";
import { UI_MODES, modeByName } from "../src/cadfly/ui/modes";
import { blk, box, set, ids, columns, three } from "./helpers/blocks";

/**
 * How blocks and scripts are laid out and hit-tested, where blocks would drop,
 * and the rounded outlines of blocks.
 */

/** The block a drop point is inside, or null if it is in a script */
const holderOf = (a: DropPoint): string | null => ("parentId" in a ? a.parentId : null);

const measure = (t: string) => t.length * 0.1;
const lay = (blocks: Block[], width = 8) => layoutProgram(oneScript(blocks), { x: 1, y: 2, width, measure });

const within = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-9 && inner.y >= outer.y - 1e-9 && inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;

const m = DEFAULT_METRICS;

/** The area inside a polygon (shoelace formula; positive whichever way round it goes) */
function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

describe("one block", () => {
  const p: Block[] = [blk("b1", "box", { name: "plate", w: "40", d: "30", h: "5" })];

  test("its header is a word, then each label and field, in order, left to right", () => {
    const l = lay(p).blocks[0];
    // the caption (here "plate") is a line above the header, not part of it
    const fields = commandById("box")!.params.filter((param) => param.type.kind !== "caption");
    const given: Record<string, string> = { w: "40", d: "30", h: "5" };
    expect(l.parts.map((x) => [x.kind, x.text])).toEqual([
      ["caption", "plate"], // first, so Tab goes caption, then the fields
      ["fold", "−"], // every block starts with its fold button
      ["word", "box"],
      ...fields.flatMap((param) => [
        ["label", param.label],
        ["field", given[param.id] ?? param.default],
      ]),
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
  const p: Block[] = [blk("b1", "box"), blk("b2", "sphere"), blk("b3", "cylinder")];

  test("each sits right under the one before, with the same left edge", () => {
    const { blocks } = lay(p);
    expect(blocks.map((b) => b.bounds.x)).toEqual([1, 1, 1]);
    expect(blocks[1].bounds.y).toBeCloseTo(blocks[0].bounds.y + blocks[0].bounds.h);
    expect(blocks[2].bounds.y).toBeCloseTo(blocks[1].bounds.y + blocks[1].bounds.h);
  });

  test("there is a drop point before the first block, between blocks, and after the last", () => {
    const l = lay(p);
    expect(l.dropPoints.map((a) => [holderOf(a), a.index])).toEqual([[null, 0], [null, 1], [null, 2], [null, 3]]);
    expect(l.dropPoints[0]).toMatchObject({ x: 1, y: 2 });
    expect(l.dropPoints[1].y).toBeCloseTo(l.blocks[1].bounds.y);
    expect(l.dropPoints[3].y).toBeCloseTo(l.bottom);
  });

  test("an empty program still has one drop point", () => {
    const l = lay([]);
    expect(l.dropPoints).toEqual([{ scriptId: "s1", index: 0, x: 1, y: 2 }]);
    expect(l.bottom).toBe(2);
  });
});

describe("a block with blocks inside", () => {
  const p: Block[] = [blk("b1", "extrude", { name: "plate" }, [blk("b2", "rectangle"), blk("b3", "circle")]), blk("b4", "box")];

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
    const inside = l.dropPoints.filter((a) => holderOf(a) === "b1");
    expect(inside).toEqual([{ parentId: "b1", index: 0, x: 1 + m.indent, y: 2 + m.rowH }]);
  });

  test("drop points inside name the block that holds them", () => {
    const l = lay(p);
    expect(l.dropPoints.filter((a) => holderOf(a) === "b1").map((a) => a.index)).toEqual([0, 1, 2]);
    expect(l.dropPoints.filter((a) => holderOf(a) === null).map((a) => a.index)).toEqual([0, 1, 2]);
  });
});

describe("where a dragged script may go", () => {
  const p: Block[] = [blk("b1", "extrude", {}, [blk("b2", "rectangle")]), blk("b3", "box"), blk("b4", "extrude")];

  test("a solid goes at the top level only; a flat shape goes there or into an extrude", () => {
    const l = lay(p);
    const top = acceptingPoints(l, oneScript(p), ["box"]);
    expect(top.every((a) => holderOf(a) === null)).toBe(true);
    expect(top).toHaveLength(4);
    const piece = acceptingPoints(l, oneScript(p), ["circle"]);
    expect(piece.every((a) => holderOf(a) === null || holderOf(a) === "b1" || holderOf(a) === "b4")).toBe(true);
    expect(piece).toHaveLength(7); // the four places at the top, and before and after the rectangle, and into the empty extrude
  });

  test("a script goes where all of its blocks are allowed", () => {
    const l = lay(p);
    expect(acceptingPoints(l, oneScript(p), ["rectangle", "box"])).toHaveLength(4); // only the top takes a box
    expect(acceptingPoints(l, oneScript(p), ["rectangle", "circle"])).toHaveLength(7);
  });

  test("the nearest drop point wins, within a range", () => {
    const l = lay(p);
    const all = acceptingPoints(l, oneScript(p), ["box"]);
    expect(nearestPoint(all, 1.1, 2.1, 1)).toEqual(all[0]);
    const last = all[all.length - 1];
    expect(nearestPoint(all, last.x + 0.1, last.y - 0.1, 1)).toEqual(last);
    expect(nearestPoint(all, 50, 50, 1)).toBeUndefined();
  });
});

describe("what is under a pointer", () => {
  const p: Block[] = [blk("b1", "extrude", { name: "plate" }, [blk("b2", "circle", { hole: true })]), blk("b3", "box", { name: "b" })];
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
    expect(findBlock(oneScript(p), "b3")).toBeDefined();
  });
});

describe("holders of shapes", () => {
  const tree: Block[] = [
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
    expect(acceptingPoints(l, oneScript([blk("b1", "transform", {}, [])]), ["box", "transform", "set"]).length).toBeGreaterThan(0);
    expect(acceptingPoints(l, oneScript([blk("b1", "transform", {}, [])]), ["point"]).every((a) => holderOf(a) !== "b1")).toBe(true);
  });
});

describe("folding a block", () => {
  const open: Block[] = [
    blk("b1", "transform", { x: "1" }, [blk("b2", "box"), blk("b3", "sphere")]),
    blk("b4", "box"),
  ];
  const folded = (id = "b1"): Block[] => open.map((b) => (b.id === id ? { ...b, collapsed: true } : b));

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
      expect(hit(l, r.x + r.w / 2, r.y + r.h / 2)).toEqual({ kind: "blockFold", blockId: b.block.id });
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
    expect(l.dropPoints.filter((a) => holderOf(a) === "b1")).toEqual([]);
    expect(l.dropPoints.filter((a) => holderOf(a) === null)).toHaveLength(3);
  });

  test("a folded block is a plain rounded box: one rectangle, with no notch", () => {
    expect(blockOutline(lay(folded()).blocks[0], 0)).toBeUndefined(); // no notch to draw: the editor draws a plain rounded box
  });
});

describe("rounding a polygon", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  test("a radius of zero gives the corners back", () => {
    expect(roundedPolygon(square, 0)).toEqual(square);
  });

  test("rounding cuts the corners, so the area shrinks a little, and the points stay inside the square", () => {
    const rounded = roundedPolygon(square, 1);
    expect(rounded.length).toBeGreaterThan(square.length);
    expect(polygonArea(rounded)).toBeLessThan(100);
    expect(polygonArea(rounded)).toBeGreaterThan(95);
    for (const p of rounded) expect(p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 10).toBe(true);
  });

  test("a radius bigger than the edges allow is cut back to fit", () => {
    const rounded = roundedPolygon(square, 100);
    for (const p of rounded) expect(p.x >= 0 && p.x <= 10 && p.y >= 0 && p.y <= 10).toBe(true);
  });
});

describe("the outline of a block that holds others", () => {
  const program: Block[] = [blk("b1", "repeat", { times: "3", counter: "i" }, [blk("b2", "box", { name: "a" }), blk("b3", "box", { name: "b" })])];

  test("a block with nothing to hold has no outline", () => {
    expect(blockOutline(lay([blk("b1", "box")]).blocks[0])).toBeUndefined();
  });

  test("it is one polygon that covers the header, the left bar and the bottom bar and nothing of the gap", () => {
    const l = lay(program).blocks[0];
    const sharp = blockOutline(l, 0)!;
    expect(sharp).toHaveLength(8); // a C: eight corners
    const area = l.rows.reduce((s, r) => s + r.w * r.h, 0) + l.spine!.w * l.spine!.h + l.footer!.w * l.footer!.h;
    expect(polygonArea(sharp)).toBeCloseTo(area, 6);
    // the gap to the right of the bar is outside
    expect(polygonArea(sharp)).toBeLessThan(l.bounds.w * l.bounds.h);
  });

  test("the rounded outline stays inside the block's bounds", () => {
    const l = lay(program).blocks[0];
    const b = l.bounds;
    for (const p of blockOutline(l, 0.1)!) {
      expect(p.x).toBeGreaterThanOrEqual(b.x - 1e-9);
      expect(p.x).toBeLessThanOrEqual(b.x + b.w + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(b.y - 1e-9);
      expect(p.y).toBeLessThanOrEqual(b.y + b.h + 1e-9);
    }
  });

  test("a wrapped header (several rows) is still one rectangle at the top of the C", () => {
    const wide = blk("b1", "repeat", { times: "a-very-long-expression-to-make-the-header-wrap-onto-more-rows-than-one", counter: "i" }, [blk("b2", "box")]);
    const l = lay([wide], 3).blocks[0];
    expect(l.rows.length).toBeGreaterThan(1);
    expect(blockOutline(l, 0)).toHaveLength(8);
  });

  test("an empty block that holds others is a C with an empty slot", () => {
    const l = lay([blk("b1", "transform", {}, [])]).blocks[0];
    expect(l.empty).toBeDefined();
    expect(blockOutline(l, 0)).toHaveLength(8);
  });
});

describe("the layout of scripts", () => {
  const lay = (p: Program, width = 8) => layoutProgram(p, { x: 1, y: 2, width, measure: (t) => t.length * 0.1 });

  test("each script is where its place says, from the workspace corner", () => {
    const l = lay(three());
    const at = (id: string) => l.blocks.find((b) => b.block.id === id)!.bounds;
    expect([at("a1").x, at("a1").y]).toEqual([1, 2]);
    expect([at("b1").x, at("b1").y]).toEqual([1, 7]);
    expect([at("c1").x, at("c1").y]).toEqual([7, 2]);
    expect(at("a2").y).toBeCloseTo(at("a1").y + at("a1").h); // the rest of a script follows it down
    expect(at("c2").x).toBeCloseTo(7);
  });

  test("a script with no place goes below the script before it, and the first is at the corner", () => {
    const l = lay([{ id: "s1", name: "build", blocks: [box("a")] }, { id: "s2", name: "f", blocks: [box("b")] }, { id: "s3", name: "g", blocks: [box("c"), box("d")] }]);
    const at = (id: string) => l.blocks.find((b) => b.block.id === id)!.bounds;
    expect([at("a").x, at("a").y]).toEqual([1, 2]);
    expect(at("b").x).toBe(1);
    expect(at("b").y).toBeGreaterThan(at("a").y + at("a").h); // below, with room for its header
    expect(at("c").y).toBeGreaterThan(at("b").y + at("b").h);
    // nothing overlaps: each header is below the script above it
    for (let i = 1; i < l.scripts.length; i++) expect(l.scripts[i].header.y).toBeGreaterThanOrEqual(i === 1 ? at("a").y + at("a").h : at("b").y + at("b").h);
  });

  test("a script with no place goes below an empty script before it, not on top of it", () => {
    const l = lay(addScript(createEmptyProgram(), "f"));
    expect(l.scripts[1].header.y).toBeGreaterThan(l.scripts[0].header.y + l.scripts[0].header.h);
    expect(l.dropPoints[1].y).toBeGreaterThan(l.dropPoints[0].y + 0.3); // and its drop point is not the build's
  });

  test("a program with several scripts gives each a header that names it; a program of just build has one only for several blocks", () => {
    const l = lay(three());
    expect(l.scripts.map((s) => [s.scriptId, s.label, s.firstId, s.count, s.collapsed])).toEqual([
      ["s1", "build · 2 blocks", "a1", 2, false],
      ["s2", "b", "b1", 1, false],
      ["s3", "c(w) · 2 blocks", "c1", 2, false],
    ]);
    const a = l.scripts[0];
    expect(a.header.y + a.header.h).toBeLessThanOrEqual(2); // above the first block
    expect(a.button!.x).toBe(1);
    expect(l.scripts[1].button).toBeUndefined(); // one block has nothing to fold
    expect(lay(oneScript([box("x")])).scripts).toEqual([]);
    expect(lay(oneScript([box("x"), box("y")])).scripts.map((s) => s.label)).toEqual(["2 blocks"]);
    expect(lay(createEmptyProgram()).scripts).toEqual([]);
  });

  test("a global script's header says global, and an empty function still has a header", () => {
    const l = lay([{ id: "s1", blocks: [set("g")] }, ...oneScript([box("a")]), { id: "s2", name: "empty", blocks: [] }]);
    expect(l.scripts.map((s) => [s.label, s.firstId])).toEqual([["global", "g"], ["build", "a"], ["empty", undefined]]);
  });

  test("the points where blocks can be dropped say which script they are in: above it, between its blocks, at its end", () => {
    const l = lay(three());
    const top = l.dropPoints.filter((a) => "scriptId" in a);
    expect(top.map((a) => [a.scriptId, a.index])).toEqual([["s1", 0], ["s1", 1], ["s1", 2], ["s2", 0], ["s2", 1], ["s3", 0], ["s3", 1], ["s3", 2]]);
    const aboveA = top.find((a) => a.scriptId === "s1" && a.index === 0)!;
    const endOfA = top.find((a) => a.scriptId === "s1" && a.index === 2)!;
    expect(endOfA.y).toBeGreaterThan(aboveA.y);
    expect(aboveA).toMatchObject({ x: 1, y: 2 });
    expect(top.find((a) => a.scriptId === "s3" && a.index === 0)).toMatchObject({ x: 7, y: 2 });
  });

  test("an empty script has one point, so blocks can be dropped into it", () => {
    expect(lay(createEmptyProgram()).dropPoints).toEqual([{ scriptId: "s1", index: 0, x: 1, y: 2 }]);
    expect(lay([]).dropPoints).toEqual([]); // no scripts at all, nowhere to drop
  });

  test("points inside a holder name the holder, not a script", () => {
    const p: Program = [{ id: "s1", name: "build", blocks: [box("a")] }, { id: "s2", name: "f", at: { x: 0, y: 3 }, blocks: [blk("m", "transform", {}, { inner: [box("c")] })] }];
    const inside = lay(p).dropPoints.filter((a) => "parentId" in a && a.parentId === "m");
    expect(inside.map((a) => [Object.keys(a).includes("script"), a.index])).toEqual([[false, 0], [false, 1]]);
  });

  test("a global script takes only set blocks, and build and functions take any block that is not a part of another", () => {
    const p: Program = [{ id: "g1", blocks: [set("g")] }, ...three()];
    const l = lay(p);
    const scriptsFor = (kinds: string[]) => [...new Set(acceptingPoints(l, p, kinds).flatMap((a) => ("scriptId" in a ? [a.scriptId] : [])))];
    expect(scriptsFor(["box"])).toEqual(["s1", "s2", "s3"]); // not the global script, g1
    expect(scriptsFor(["set"])).toEqual(["g1", "s1", "s2", "s3"]);
    expect(scriptsFor(["point"])).toEqual([]);
    expect(scriptsFor(["set", "box"])).toEqual(["s1", "s2", "s3"]);
  });

  test("a folded script shows its first block and a strip, and offers only the place above it", () => {
    const l = lay(setScriptFold(three(), "s1", true));
    expect(l.blocks.map((b) => b.block.id)).toEqual(["a1", "b1", "c1", "c2"]); // a2 is hidden
    const a = l.scripts[0];
    expect(a.collapsed).toBe(true);
    expect(a.strip).toBeDefined();
    expect(a.label).toBe("build · 1 more");
    expect(l.dropPoints.filter((x) => "scriptId" in x && x.scriptId === "s1").map((x) => x.index)).toEqual([0]);
    expect(l.dropPoints.filter((x) => "scriptId" in x && x.scriptId === "s2")).toHaveLength(2); // the others are as they were
  });

  test("the script's button, its header and its strip are what is under a pointer there: the strip stands for the first block", () => {
    const folded = lay(setScriptFold(three(), "s1", true));
    const a = folded.scripts[0];
    const mid = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;
    expect(hit(folded, ...mid(a.button!))).toEqual({ kind: "scriptFold", scriptId: "s1" });
    expect(hit(folded, a.header.x + a.header.w - 0.05, a.header.y + a.header.h / 2)).toEqual({ kind: "scriptHeader", scriptId: "s1" });
    expect(hit(folded, ...mid(a.strip!))).toEqual({ kind: "block", blockId: "a1" } as Hit);
    const open = lay(three());
    expect(hit(open, ...mid(open.scripts[2].button!))).toEqual({ kind: "scriptFold", scriptId: "s3" });
  });

  test("the lowest thing sets how far the workspace scrolls", () => {
    const l = lay(three());
    expect(l.bottom).toBeGreaterThan(7); // b1 is 5 down from y = 2, and a block is half a metre tall
  });

  test("a script placed far to the right is given the room that is left, and never less than a little", () => {
    const l = lay([{ id: "s1", name: "build", at: { x: 7.9, y: 0 }, blocks: [box("a", "100")] }], 8);
    expect(l.blocks[0].bounds.x).toBeCloseTo(8.9);
    expect(Number.isFinite(l.blocks[0].bounds.w)).toBe(true);
  });
});

describe("asking again which drop points take some blocks (as a drag does at every movement)", () => {
  const measure = (t: string) => t.length * 0.1;
  const lay = (p: Program) => layoutProgram(p, { x: 0, y: 0, width: 8, measure });

  test("the answer is the same each time for the same program", () => {
    const p = three();
    const l = lay(p);
    const first = acceptingPoints(l, p, ["box"]);
    expect(first.length).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) expect(acceptingPoints(l, p, ["box"])).toEqual(first);
    // and a different set of kinds is not confused with it: a global script takes only set blocks
    expect(acceptingPoints(l, [{ id: "s1", blocks: [set("g")] }], ["box"])).toEqual([]);
  });

  test("another program is worked out afresh, even when its ids are the same", () => {
    const holder = (kind: string): Program => oneScript([blk("h", kind, {}, [])]);
    const withUnion = holder("union");
    const withBox = holder("box"); // a box holds nothing, so nothing can go inside it
    const inside = (p: Program) => acceptingPoints(lay(p), p, ["box"]).filter((a) => "parentId" in a);
    expect(inside(withUnion)).toHaveLength(1);
    expect(inside(withBox)).toHaveLength(0);
    // asking about the first again still gives its own answer
    expect(inside(withUnion)).toHaveLength(1);
  });
});

describe("the header of a named script, in a mode that has scripts", () => {
  const builder = modeByName("Builder");
  const firstSteps = modeByName("First steps");
  const lay = (p: Program, mode?: ReturnType<typeof modeByName>) => layoutProgram(p, { x: 1, y: 2, width: 8, measure: (t) => t.length * 0.1, mode });
  const mid = (r: { x: number; y: number; w: number; h: number }) => [r.x + r.w / 2, r.y + r.h / 2] as const;
  const withGlobal = (): Program => [{ id: "s1", blocks: [set("g")] }, ...three()];
  /** The layout of a script whose header is editable (it fails the test if it is not) */
  const editable = (s: ScriptLayout): EditableScriptLayout => {
    if (s.kind !== "editable") throw new Error(`the header of script ${s.scriptId} is ${s.kind}, not editable`);
    return s;
  };

  test("a function has chips for its name and inputs and a button to remove it; build and a global script have none", () => {
    const l = lay(withGlobal(), builder);
    const byLabel = (label: string) => l.scripts.find((s) => s.label.split(" · ")[0] === label)!;
    const c = editable(byLabel("c(w)"));
    expect(c.nameChip.text).toBe("c");
    expect(c.inputsChip.text).toBe("(w)");
    expect(c.remove).toBeDefined();
    expect(c.text.text).toBe("2 blocks"); // the name and inputs are the chips; the rest of the header is only the count
    expect(editable(byLabel("b")).inputsChip.text).toBe("( )"); // no inputs: empty brackets to tap
    for (const plain of [byLabel("global"), byLabel("build")]) expect(plain.kind).toBe("plain");
  });

  test("the chips and the button are in a row, in order, inside the header, and do not overlap", () => {
    const c = editable(lay(three(), builder).scripts[2]);
    const items = [c.button!, c.nameChip.rect, c.inputsChip.rect, c.text.rect, c.remove];
    for (let i = 1; i < items.length; i++) expect(items[i].x).toBeGreaterThanOrEqual(items[i - 1].x + items[i - 1].w - 1e-9);
    for (const r of items) {
      expect(r.x).toBeGreaterThanOrEqual(c.header.x - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(c.header.x + c.header.w + 1e-9);
      expect(r.y).toBeGreaterThanOrEqual(c.header.y - 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(c.header.y + c.header.h + 1e-9);
    }
  });

  test("a pointer on each part finds it: the name, the inputs, the remove button, and the rest of the header takes the script", () => {
    const l = lay(three(), builder);
    const c = editable(l.scripts[2]);
    expect(hit(l, ...mid(c.nameChip.rect))).toEqual({ kind: "scriptName", scriptId: "s3", rect: c.nameChip.rect });
    expect(hit(l, ...mid(c.inputsChip.rect))).toEqual({ kind: "scriptInputs", scriptId: "s3", rect: c.inputsChip.rect });
    expect(hit(l, ...mid(c.remove))).toEqual({ kind: "scriptRemove", scriptId: "s3" });
    expect(hit(l, ...mid(c.button!))).toEqual({ kind: "scriptFold", scriptId: "s3" });
    expect(hit(l, ...mid(c.text.rect))).toEqual({ kind: "scriptHeader", scriptId: "s3" });
    expect(hit(l, c.header.x + c.header.w - 0.01, c.header.y + 0.01)).toEqual({ kind: "scriptHeader", scriptId: "s3" });
  });

  test("a mode without scripts shows the name as text only, and the header takes the script still", () => {
    const l = lay(three(), firstSteps);
    expect(l.scripts.map((s) => [s.label, s.kind])).toEqual([
      ["build · 2 blocks", "plain"],
      ["b", "plain"],
      ["c(w) · 2 blocks", "plain"],
    ]);
    expect(l.scripts[2].text.text).toBe("c(w) · 2 blocks");
    expect(hit(l, ...mid(l.scripts[1].header))).toEqual({ kind: "scriptHeader", scriptId: "s2" });
    // no mode at all has everything, scripts too
    expect(editable(lay(three()).scripts[1]).nameChip.text).toBe("b");
  });

  test("which modes have scripts: Builder and Everything do, the first two do not", () => {
    expect(UI_MODES.map(({ name, spec }) => [name, lay(three(), spec).scripts[1].kind === "editable"])).toEqual([
      ["First steps", false],
      ["Starter", false],
      ["Builder", true],
      ["Everything", true],
    ]);
  });

  test("a script's place is given for moving it, and a script with no place of its own reports where it is drawn", () => {
    const l = lay([{ id: "s1", name: "build", blocks: [box("a")] }, { id: "s2", name: "f", blocks: [box("b")] }, { id: "s3", name: "g", at: { x: 4, y: 7 }, blocks: [box("c")] }], builder);
    expect(l.scripts[0].blocksAt).toEqual({ x: 0, y: 0 });
    expect(l.scripts[1].blocksAt.x).toBe(0);
    expect(l.scripts[1].blocksAt.y).toBeGreaterThan(0.5);
    expect(l.scripts[2].blocksAt).toEqual({ x: 4, y: 7 });
  });
});

describe("picking up one block", () => {
  test("a block from the middle comes out alone and the others close up", () => {
    const { program, blocks } = takeBlock(three(), "a2");
    expect(ids(blocks)).toEqual(["a2"]);
    expect(columns(program)).toEqual([["a1"], ["b1"], ["c1", "c2"]]);
  });

  test("the first block of a script comes out alone, and the rest of the script keeps the script's place", () => {
    const { program, blocks } = takeBlock(three(), "c1");
    expect(ids(blocks)).toEqual(["c1"]);
    expect(program[2]).toEqual({ id: "s3", name: "c", inputs: "w", at: { x: 6, y: 0 }, blocks: [box("c2")] });
  });

  test("a holder comes out with what is inside it", () => {
    const p = oneScript([{ id: "m", kind: "transform", args: {}, inner: [{ id: "c", kind: "box", args: {} }, { id: "d", kind: "box", args: {} }] }, { id: "z", kind: "box", args: {} }]);
    const { program, blocks } = takeBlock(p, "m");
    expect(ids(blocks)).toEqual(["m"]);
    expect(ids(blocks[0].inner ?? [])).toEqual(["c", "d"]);
    expect(ids(topBlocks(program))).toEqual(["z"]);
  });

  test("one block of the inside of a holder comes out alone", () => {
    const p = oneScript([{ id: "m", kind: "transform", args: {}, inner: [{ id: "c", kind: "box", args: {} }, { id: "d", kind: "box", args: {} }, { id: "e", kind: "box", args: {} }] }]);
    const { program, blocks } = takeBlock(p, "d");
    expect(ids(blocks)).toEqual(["d"]);
    expect(ids(program[0].blocks[0].inner ?? [])).toEqual(["c", "e"]);
  });

  test("a block that is not there leaves the program alone", () => {
    const p = three();
    const out = takeBlock(p, "nope");
    expect(out).toEqual({ program: p, blocks: [] });
    expect(out.program).not.toBe(p);
  });
});

describe("scripts that overlap", () => {
  /** Two scripts at the same place: the later one is drawn over the earlier one. */
  const overlapping = (): Program => [
    { id: "s1", name: "build", at: { x: 0, y: 0 }, blocks: [blk("under", "box", { name: "plate", w: "1000000" })] },
    { id: "s2", name: "f", at: { x: 0, y: 0 }, blocks: [blk("over", "box", { name: "plate", w: "1" })] },
  ];

  test("where one block covers another, the one on top answers, not the one underneath", () => {
    const l = layoutProgram(overlapping(), { x: 1, y: 2, width: 8, measure });
    const over = l.blocks.find((b) => b.block.id === "over")!;
    const under = l.blocks.find((b) => b.block.id === "under")!;
    const onUnderField = (x: number, y: number) => under.parts.some((p) => p.kind === "field" && x >= p.rect.x && x <= p.rect.x + p.rect.w && y >= p.rect.y && y <= p.rect.y + p.rect.h);
    const onOverPart = (x: number, y: number) => over.parts.some((p) => x >= p.rect.x && x <= p.rect.x + p.rect.w && y >= p.rect.y && y <= p.rect.y + p.rect.h);
    let covered = 0; // points where a field underneath shows through the frame on top
    const row = over.rows[0]; // the header of the block on top
    for (let x = row.x; x <= row.x + row.w; x += 0.02) {
      for (let y = row.y; y <= row.y + row.h; y += 0.02) {
        const h = hit(l, x, y);
        if (!onOverPart(x, y) && onUnderField(x, y)) covered++;
        expect(h !== undefined && "blockId" in h ? h.blockId : undefined, `at (${x.toFixed(2)}, ${y.toFixed(2)})`).toBe("over");
      }
    }
    expect(covered).toBeGreaterThan(0); // the case is real: the old order of testing answered for the block underneath here
  });

  test("a field of the block on top is still a field", () => {
    const l = layoutProgram(overlapping(), { x: 1, y: 2, width: 8, measure });
    const field = l.blocks.find((b) => b.block.id === "over")!.parts.find((p) => p.kind === "field" && p.param?.id === "w")!;
    expect(hit(l, field.rect.x + field.rect.w / 2, field.rect.y + field.rect.h / 2)).toMatchObject({ kind: "field", blockId: "over" });
  });
});

describe("how far the layout reaches", () => {
  test("a script's header is above its first block, and the layout says how far up it goes", () => {
    const l = layoutProgram(addScript(createEmptyProgram(), "f"), { x: 1, y: 2, width: 8, measure });
    const highest = Math.min(...l.scripts.map((s) => s.header.y));
    expect(highest).toBeLessThan(2); // above y, where the first script's blocks start
    expect(l.top).toBeCloseTo(highest);
  });

  test("with nothing above y, the top is y", () => {
    expect(lay([box("a")]).top).toBe(2);
  });
});

describe("a value too long for its block", () => {
  test("fitText leaves text that fits, and cuts the rest short with an ellipsis", () => {
    expect(fitText("short", 5, measure)).toBe("short");
    expect(fitText("abcdefghij", 0.55, measure)).toBe("abcd…");
    expect(fitText("abc", 0.05, measure)).toBe("…");
  });

  test("a field's chip stays inside its block, and the program keeps the whole value", () => {
    const long = "9".repeat(150);
    for (const width of [3, 6, 8]) {
      const b = [blk("b1", "box", { name: "plate", w: long })];
      const l = lay(b, width).blocks[0];
      for (const part of l.parts) expect(within(part.rect, l.bounds), `${part.kind} at width ${width}`).toBe(true);
      const chip = l.parts.find((p) => p.kind === "field" && p.param?.id === "w")!;
      expect(chip.text.endsWith("…")).toBe(true);
      expect(chip.text.length).toBeLessThan(long.length);
      expect(b[0].args.w).toBe(long);
    }
  });

  test("a value that fits is shown whole", () => {
    const chip = lay([blk("b1", "box", { name: "plate", w: "40" })]).blocks[0].parts.find((p) => p.kind === "field" && p.param?.id === "w")!;
    expect(chip.text).toBe("40");
  });
});
