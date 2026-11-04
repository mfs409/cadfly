import { describe, expect, test } from "vitest";
import { layoutProgram } from "../src/cadfly/language/layout";
import { type Pt, blockOutline, roundedPolygon } from "../src/cadfly/language/outline";

/** The area inside a polygon (shoelace formula; positive whichever way round it goes) */
function polygonArea(points: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
import type { Block, Program } from "../src/cadfly/language/types";

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id, kind, args, ...(inner ? { inner } : {}) });
const measure = (t: string) => t.length * 0.1;
const lay = (p: Program, width = 8) => layoutProgram(p, { x: 1, y: 2, width, measure });

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
  const program: Program = [blk("b1", "repeat", { times: "3", counter: "i" }, [blk("b2", "box", { name: "a" }), blk("b3", "box", { name: "b" })])];

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
