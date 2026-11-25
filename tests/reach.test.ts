import { describe, expect, test } from "vitest";
import { addScript } from "../src/cadfly/language/edit";
import type { Program } from "../src/cadfly/language/types";
import { DEFAULT_METRICS, type Rect, grownRects, hit, layoutProgram, metricsForTouch, nearestReaching } from "../src/cadfly/ui/layout";
import { hotspotAt } from "../src/cadfly/ui/editor/panels";
import type { Hotspot } from "../src/cadfly/ui/editor/types";
import { blk, box } from "./helpers/blocks";
import { oneScript } from "./helpers/script-helpers";

/**
 * How far something to touch reaches when it is smaller than a finger: the rule
 * that grows rectangles into free room, and what it does to what a touch finds
 * in the workspace, the toolbar and the palette. Also the taller rows that a
 * small screen gives a block's header so that what is on them can be touched.
 */

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
const room = r(0, 0, 100, 100);
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const grow = (rects: Rect[], min: number, limit: Rect = room) => grownRects(rects, rects.map(() => limit), min);

describe("growing small rectangles to a size", () => {
  test("a rectangle that is big enough stays as it is", () => {
    expect(grow([r(10, 10, 5, 5)], 5)).toEqual([r(10, 10, 5, 5)]);
    expect(grow([r(10, 10, 8, 9)], 5)).toEqual([r(10, 10, 8, 9)]);
  });

  test("a small rectangle with room all round grows equally on every side, to the size", () => {
    const [g] = grow([r(10, 10, 2, 3)], 6);
    expect(g).toEqual(r(8, 8.5, 6, 6));
  });

  test("it grows only in the direction it is too small in", () => {
    const [g] = grow([r(10, 10, 20, 3)], 6);
    expect(g).toEqual(r(10, 8.5, 20, 6));
  });

  test("it cannot grow past its limit, and what one side cannot give the other makes up", () => {
    // the limit is a row that starts 1 to the left of it
    const [g] = grow([r(11, 10, 2, 6)], 6, r(10, 0, 100, 100));
    expect(g.x).toBe(10);
    expect(g.w).toBe(6);
    expect(g).toEqual(r(10, 10, 6, 6));
  });

  test("it grows as far as it can when there is not room for the size", () => {
    const [g] = grow([r(10, 10, 2, 2)], 20, r(8, 8, 6, 6));
    expect(g).toEqual(r(8, 8, 6, 6));
  });

  test("two small neighbors share the free space between them, so they never overlap", () => {
    // 4 apart: each takes 2 of it on that side
    const [a, b] = grow([r(10, 10, 2, 6), r(16, 10, 2, 6)], 6);
    expect(a.x + a.w).toBeCloseTo(14);
    expect(b.x).toBeCloseTo(14);
    expect(overlap(a, b)).toBe(false);
  });

  test("a neighbor that is big enough already takes none of the space: the small one may use all of it", () => {
    // 1 of space to a neighbor that is big enough: the small one takes all of it (a small neighbor would be given half), and makes up the rest on the other side
    const [a] = grow([r(10, 10, 2, 6), r(13, 10, 8, 6)], 6);
    expect(a.x + a.w).toBeCloseTo(13);
    expect(a.w).toBeCloseTo(6);
    const [b] = grow([r(10, 10, 2, 6), r(13, 10, 2, 6)], 6);
    expect(b.x + b.w).toBeCloseTo(12.5);
  });

  test("a rectangle that is not to grow stays as it is, and takes the room it is in without sharing it", () => {
    // a word, 0.4 away, that nothing answers a touch on: the small one may use all of the space up to it
    const [a, word] = grownRects([r(10, 10, 2, 6), r(12.4, 10, 2, 6)], [room, room], 6, [true, false]);
    expect(word).toEqual(r(12.4, 10, 2, 6));
    expect(a.x + a.w).toBeCloseTo(12.4);
    expect(a.w).toBeCloseTo(6);
  });

  test("a rectangle with a neighbor touching it cannot grow that way, and grows the other", () => {
    const [a, b] = grow([r(10, 10, 2, 6), r(12, 10, 8, 6)], 6);
    expect(a.x + a.w).toBe(12);
    expect(a.x).toBe(6); // all four it needs, to the left
    expect(b).toEqual(r(12, 10, 8, 6));
  });

  test("a rectangle that is level with nothing is not held back by one above or below it", () => {
    const [a] = grow([r(10, 10, 2, 6), r(10, 40, 2, 6)], 6);
    expect(a.x).toBe(8);
    expect(a.w).toBe(6);
  });

  test("it grows up and down only into room that the rectangles above and below do not take", () => {
    // three small buttons in a column, 3 apart, each 2 high, to be 5 high
    const grown = grow([r(10, 10, 6, 2), r(10, 15, 6, 2), r(10, 20, 6, 2)], 5);
    grown.forEach((g, i) => expect(g.h, `${i}`).toBeLessThanOrEqual(5));
    for (let i = 0; i < grown.length; i++) for (let j = i + 1; j < grown.length; j++) expect(overlap(grown[i], grown[j]), `${i} ${j}`).toBe(false);
    // the middle one is held by both neighbors: half of each 3 gap
    expect(grown[1].h).toBeCloseTo(2 + 1.5 + 1.5);
  });

  test("growing across first can make two rectangles meet above one another, and then they share up and down", () => {
    // the upper one is wide enough only after growing across, and then it is over the lower one
    const grown = grow([r(10, 10, 2, 6), r(11, 18, 2, 6)], 6);
    expect(overlap(grown[0], grown[1])).toBe(false);
  });

  test("rectangles in a row never overlap and never leave their limit, whatever their sizes", () => {
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let trial = 0; trial < 200; trial++) {
      const rects: Rect[] = [];
      let x = 1 + next() * 3;
      const n = 2 + Math.floor(next() * 6);
      for (let i = 0; i < n; i++) {
        const w = 1 + next() * 8;
        rects.push(r(x, 20 + next() * 3, w, 1 + next() * 8));
        x += w + next() * 3;
      }
      const limit = r(0, 15, x + 2, 20);
      const grown = grownRects(rects, rects.map(() => limit), 6);
      grown.forEach((g, i) => {
        expect(g.x).toBeLessThanOrEqual(rects[i].x + 1e-9);
        expect(g.y).toBeLessThanOrEqual(rects[i].y + 1e-9);
        expect(g.x + g.w).toBeGreaterThanOrEqual(rects[i].x + rects[i].w - 1e-9);
        expect(g.y + g.h).toBeGreaterThanOrEqual(rects[i].y + rects[i].h - 1e-9);
        expect(g.x).toBeGreaterThanOrEqual(limit.x - 1e-9);
        expect(g.x + g.w).toBeLessThanOrEqual(limit.x + limit.w + 1e-9);
        expect(g.y).toBeGreaterThanOrEqual(limit.y - 1e-9);
        expect(g.y + g.h).toBeLessThanOrEqual(limit.y + limit.h + 1e-9);
        for (let j = i + 1; j < grown.length; j++) expect(overlap(g, grown[j]), `trial ${trial}: ${i} ${j}`).toBe(false);
      });
    }
  });

  test("of areas that overlap a point, the nearest one decides", () => {
    const found = [
      { area: r(0, 0, 10, 10), answer: "a" },
      { area: r(4, 0, 10, 10), answer: "b" },
    ];
    expect(nearestReaching(found, 2, 5)).toBe("a");
    expect(nearestReaching(found, 12, 5)).toBe("b");
    expect(nearestReaching(found, 50, 50)).toBeUndefined();
  });
});

describe("what a touch finds in the workspace when things are small", () => {
  const measure = (t: string) => t.length * 0.1;
  const lay = (program: Program) => layoutProgram(program, { x: 1, y: 2, width: 8, measure });
  const holder = oneScript([blk("h", "union", {}, [box("b")])]);
  const row = (l: ReturnType<typeof lay>) => l.blocks[0].rows[0];

  test("with no minimum, a touch is answered where things are drawn, and nowhere else", () => {
    const l = lay(holder);
    const fold = l.blocks[0].parts.find((p) => p.kind === "fold")!.rect;
    expect(hit(l, fold.x + fold.w / 2, fold.y + fold.h / 2)).toEqual({ kind: "blockFold", blockId: "h" });
    // in the row's left padding, beside the button
    expect(hit(l, fold.x - 0.05, fold.y + fold.h / 2)).toEqual({ kind: "block", blockId: "h" });
    expect(hit(l, fold.x - 0.05, fold.y + fold.h / 2, 0)).toEqual({ kind: "block", blockId: "h" });
  });

  test("with a minimum, a touch a little beside a small button is answered by it, within the row", () => {
    const l = lay(holder);
    const fold = l.blocks[0].parts.find((p) => p.kind === "fold")!.rect;
    const mid = fold.y + fold.h / 2;
    expect(hit(l, fold.x - 0.05, mid, 0.5)).toEqual({ kind: "blockFold", blockId: "h" });
    // above the row, in no block at all, nothing reaches
    expect(hit(l, fold.x + fold.w / 2, row(l).y - 0.05, 0.5)).toBeUndefined();
    // a touch on the button is the button either way
    expect(hit(l, fold.x + fold.w / 2, mid, 0.5)).toEqual({ kind: "blockFold", blockId: "h" });
  });

  test("a part is never given room that another part of the row takes: a word is still nothing, and a neighbor still its own", () => {
    const l = lay(oneScript([blk("b1", "box", { w: "40", d: "30", h: "5" })]));
    const parts = l.blocks[0].parts;
    const fields = parts.filter((p) => p.kind === "field");
    const label = parts.find((p) => p.kind === "label")!;
    // the middle of a label that is between a field and the word answers as the block, not as a grown field
    const labelMid = { x: label.rect.x + label.rect.w / 2, y: label.rect.y + label.rect.h / 2 };
    expect(hit(l, labelMid.x, labelMid.y, 0.8)).toEqual({ kind: "block", blockId: "b1" });
    // every field is still found at its own middle
    for (const f of fields) expect(hit(l, f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2, 0.8)).toMatchObject({ kind: "field" });
  });

  test("a block drawn on top is not answered through by the reach of a button on one underneath", () => {
    const under = oneScript([blk("under", "union", {}, [box("u1")])]);
    const program: Program = [
      { id: "s1", name: "build", at: { x: 0, y: 0 }, blocks: under[0].blocks },
      { id: "s2", name: "f", at: { x: 0, y: 0 }, blocks: [blk("over", "union", {}, [box("o1")])] },
    ];
    const l = lay(program);
    const first = l.blocks.find((b) => b.block.id === "under")!;
    const fold = first.parts.find((p) => p.kind === "fold")!.rect;
    // the two blocks sit on one another; a touch beside the fold button of the one underneath is on the one on top
    expect(hit(l, fold.x - 0.05, fold.y + fold.h / 2, 0.5)).toMatchObject({ blockId: "over" });
  });

  test("a script's header buttons reach within the header", () => {
    const program = addScript(oneScript([box("b")]), "leg", "w");
    const l = layoutProgram(program, { x: 1, y: 2, width: 8, measure, mode: { blocks: [], switches: true, scripts: true } });
    const s = l.scripts.find((x) => x.kind === "editable")!;
    if (s.kind !== "editable") throw new Error("expected an editable header");
    const mid = s.remove.y + s.remove.h / 2;
    // just right of the remove button, inside the header
    const inside = s.remove.x + s.remove.w + 0.03;
    if (inside <= s.header.x + s.header.w) {
      expect(hit(l, inside, mid, 0.6)).toEqual({ kind: "scriptRemove", scriptId: s.scriptId });
      expect(hit(l, inside, mid)).not.toEqual({ kind: "scriptRemove", scriptId: s.scriptId });
    }
    // on the button itself it is the button, whatever the minimum
    expect(hit(l, s.remove.x + s.remove.w / 2, mid, 0.6)).toEqual({ kind: "scriptRemove", scriptId: s.scriptId });
  });
});

describe("what a touch finds on the toolbar and the palette when things are small", () => {
  const spot = (id: number, rect: Rect): Hotspot => ({ rect, touched: { kind: "button", index: id } });
  // two tabs 0.06 apart on the toolbar, 0.6 high from y 0.12 (the toolbar is 0.85 high)
  const toolbar = [spot(1, r(0.1, 0.12, 0.6, 0.6)), spot(2, r(0.76, 0.12, 0.6, 0.6))];

  test("a touch on a hotspot is that hotspot", () => {
    expect(hotspotAt(toolbar, 0.3, 0.4, 0.7)?.touched).toEqual({ kind: "button", index: 1 });
  });

  test("a touch just above or below a small hotspot, in the bar, finds it, once it is given a minimum", () => {
    expect(hotspotAt(toolbar, 0.3, 0.05, 0)).toBeUndefined();
    expect(hotspotAt(toolbar, 0.3, 0.05, 0.8)?.touched).toEqual({ kind: "button", index: 1 });
    expect(hotspotAt(toolbar, 0.3, 0.8, 0.8)?.touched).toEqual({ kind: "button", index: 1 });
  });

  test("between two small hotspots the space goes to the nearer, and a point is never in two", () => {
    const left = hotspotAt(toolbar, 0.72, 0.4, 0.7)?.touched;
    const right = hotspotAt(toolbar, 0.74, 0.4, 0.7)?.touched;
    expect(left).toEqual({ kind: "button", index: 1 });
    expect(right).toEqual({ kind: "button", index: 2 });
  });

  test("nothing reaches below the toolbar", () => {
    expect(hotspotAt(toolbar, 0.3, 0.9, 5)).toBeUndefined();
  });
});

describe("rows tall enough to touch", () => {
  /** The smallest touch target, in CSS pixels */
  const FINGER_PX = 44;
  /** The minimum, in meters, that a screen of this many pixels to the meter gives */
  const minAt = (pixelsPerMeter: number) => FINGER_PX / pixelsPerMeter;
  const measure = (t: string) => t.length * 0.1;
  const wrapped = oneScript([blk("b1", "repeat", { times: "a-very-long-expression-to-make-the-header-wrap-onto-more-rows-than-one", counter: "i" }, [box("b2")])]);

  test("a screen that is big enough for the default rows keeps them, and a smaller one gets taller rows", () => {
    expect(metricsForTouch(0)).toEqual(DEFAULT_METRICS);
    expect(metricsForTouch(minAt(120)).rowH).toBe(DEFAULT_METRICS.rowH);
    expect(metricsForTouch(minAt(50)).rowH).toBeCloseTo(0.88);
    expect(metricsForTouch(minAt(50)).rowH * 50).toBeGreaterThanOrEqual(FINGER_PX - 1e-9);
  });

  test("rows are exactly as tall as the minimum when the default is shorter, and never shorter than the default", () => {
    const boundary = DEFAULT_METRICS.rowH;
    expect(metricsForTouch(boundary).rowH).toBe(boundary);
    expect(metricsForTouch(boundary + 0.01).rowH).toBeCloseTo(boundary + 0.01);
    expect(metricsForTouch(boundary - 0.1).rowH).toBe(boundary);
  });

  test("the sizes other than the rows do not change", () => {
    expect({ ...metricsForTouch(minAt(50)), rowH: 0 }).toEqual({ ...DEFAULT_METRICS, rowH: 0 });
  });

  test("a layout with taller rows has every row that tall, and a header of several rows is that many of them high", () => {
    const metrics = metricsForTouch(minAt(50));
    const l = layoutProgram(wrapped, { x: 1, y: 2, width: 8, measure, metrics }).blocks[0];
    expect(l.rows.length).toBeGreaterThan(1);
    for (const row of l.rows) expect(row.h).toBeCloseTo(metrics.rowH);
    expect(l.bounds.h).toBeGreaterThanOrEqual(l.rows.length * metrics.rowH - 1e-9);
  });

  test("on every row of a wrapped header, a field can be touched anywhere within the minimum's height of its middle", () => {
    const min = minAt(50);
    const l = layoutProgram(wrapped, { x: 1, y: 2, width: 8, measure, metrics: metricsForTouch(min) });
    const fields = l.blocks[0].parts.filter((p) => p.kind === "field");
    const rowsWithFields = new Set(fields.map((f) => l.blocks[0].rows.findIndex((row) => f.rect.y >= row.y - 1e-9 && f.rect.y + f.rect.h <= row.y + row.h + 1e-9)));
    expect(rowsWithFields.size).toBeGreaterThan(1);
    for (const f of fields) {
      const x = f.rect.x + f.rect.w / 2;
      const mid = f.rect.y + f.rect.h / 2;
      // a little inside the minimum's reach, above and below the middle
      for (const dy of [-(min / 2 - 0.01), min / 2 - 0.01]) expect(hit(l, x, mid + dy, min)).toMatchObject({ kind: "field", blockId: "b1" });
    }
  });

  test("with the default rows, the same field is not reached that far, which is why the rows grow", () => {
    const min = minAt(50);
    const l = layoutProgram(wrapped, { x: 1, y: 2, width: 8, measure });
    const reached = (f: Rect) => hit(l, f.x + f.w / 2, f.y + f.h / 2 - (min / 2 - 0.01), min)?.kind === "field";
    const fields = l.blocks[0].parts.filter((p) => p.kind === "field");
    expect(fields.some((f) => !reached(f.rect))).toBe(true);
  });
});
