import { describe, expect, test } from "vitest";
import { commandById } from "../src/cadfly/language/commands";
import { PART_HEIGHT, flowGroups, headerGroups, type Token } from "../src/cadfly/ui/layout/header";
import { DEFAULT_METRICS as m, type LayoutOptions } from "../src/cadfly/ui/layout";
import { modeByName } from "../src/cadfly/ui/modes";
import { blk, box } from "./helpers/blocks";

/**
 * The two steps of laying out a block's header: the tokens it is made of, and
 * how they flow onto rows. Also how tall each kind of part is.
 */

const measure = (t: string) => t.length * 0.1;
const opts = (extra: Partial<LayoutOptions> = {}): LayoutOptions => ({ x: 0, y: 0, width: 8, measure, ...extra });
const groupsOf = (block = box("a"), o = opts(), isBase = false, ordinal = 0, width = 8) => headerGroups(block, commandById(block.kind)!, o, m, width, isBase, ordinal);
const kinds = (groups: Token[][]) => groups.map((g) => g.map((t) => t.kind));

describe("the tokens of a header", () => {
  test("a block starts with its fold button and its word, then a group for each field", () => {
    const { groups, folded, captionText } = groupsOf();
    expect(folded).toBe(false);
    expect(captionText).toBe("");
    expect(kinds(groups).slice(0, 2)).toEqual([["fold"], ["word"]]);
    expect(groups[1][0].text).toBe("box");
    // each of w, d, h: its label and its chip together, which a header never splits across rows
    expect(kinds(groups).filter((g) => g.includes("field"))).toEqual([["label", "field"], ["label", "field"], ["label", "field"], ...kinds(groups).filter((g) => g.includes("field")).slice(3)]);
  });

  test("the base of its parent says so before its word, and a numbered block shows its number after the button", () => {
    expect(groupsOf(box("a"), opts(), true).groups[1].map((t) => t.text)).toEqual(["base:", "box"]);
    const vertex = blk("v", "vertex", { x: "1", y: "2", z: "3" });
    const numbered = groupsOf(vertex, opts(), false, 3).groups[0]; // with the button
    expect(numbered.map((t) => t.kind)).toEqual(["fold", "number"]);
    expect(numbered[1].text.endsWith("3")).toBe(true);
    expect(groupsOf(vertex, opts(), false, 0).groups[0].map((t) => t.kind)).toEqual(["fold"]);
  });

  test("a folded block is only its button", () => {
    const g = groupsOf({ ...box("a"), collapsed: true });
    expect(g.folded).toBe(true);
    expect(kinds(g.groups)).toEqual([["fold"]]);
    expect(g.groups[0][0].text).toBe("+");
  });

  test("a caption is not a token: it is a line above the block, and the word remembers its field", () => {
    const captioned = box("a");
    captioned.args.name = "  plate ";
    const g = groupsOf(captioned);
    expect(g.captionText).toBe("plate");
    expect(g.captionParam?.id).toBe("name");
    expect(g.groups.flat().some((t) => t.text === "plate")).toBe(false);
    expect(g.groups.flat().find((t) => t.kind === "word")?.captionParam).toBe(g.captionParam);
    // spaces alone are no caption
    const spaces = box("b");
    spaces.args.name = "   ";
    expect(groupsOf(spaces).captionText).toBe("");
  });

  test("a block has a field for every one of its fields, in every mode, and nothing after them but its switches", () => {
    const first = opts({ mode: modeByName("First steps") });
    const g = groupsOf(box("a"), first);
    expect(g.groups.flat().filter((t) => t.kind === "field")).toHaveLength(6); // w, d, h, and the position x, y, z
    expect(g.groups.flat().filter((t) => t.kind === "field")).toHaveLength(groupsOf().groups.flat().filter((t) => t.kind === "field").length);
  });

  test("a value too long for the block is cut short with an ellipsis so that its chip stays inside it", () => {
    const long = box("a", "1234567890".repeat(15));
    const chip = groupsOf(long, opts(), false, 0, 6).groups.flat().find((t) => t.kind === "field")!;
    expect(chip.text.endsWith("…")).toBe(true);
    expect(chip.w).toBeLessThan(6);
  });

  test("a block that makes a shape has the eye in a mode that has the switches, and one that changes what is inside has the power switch", () => {
    expect(kinds(groupsOf(box("a"), opts({ mode: modeByName("Starter") })).groups).flat()).toContain("eye");
    expect(kinds(groupsOf(box("a"), opts({ mode: modeByName("First steps") })).groups).flat()).not.toContain("eye");
    expect(kinds(groupsOf(blk("t", "transform", { x: "1" }), opts({ mode: modeByName("Starter") })).groups).flat()).toContain("power");
  });
});

describe("the flow of a header onto rows", () => {
  const token = (w: number, kind: Token["kind"] = "word"): Token => ({ kind, text: "x", w });

  test("parts go left to right on one row while they fit", () => {
    const { parts, rowCount } = flowGroups([[token(1)], [token(1)]], 0, 5, 8, m);
    expect(rowCount).toBe(1);
    expect(parts[0].rect.x).toBeCloseTo(m.padX);
    expect(parts[1].rect.x).toBeCloseTo(m.padX + 1 + m.gap);
    expect(parts[0].rect.y).toBe(5);
  });

  test("a group that does not fit starts a new row, indented, and a group is never split", () => {
    const { parts, rowCount } = flowGroups([[token(3)], [token(3), token(1)], [token(2)]], 0, 5, 6, m);
    expect(rowCount).toBe(3);
    expect(parts[1].rect.y).toBeCloseTo(5 + m.rowH); // the group of two moves down together
    expect(parts[2].rect.y).toBeCloseTo(5 + m.rowH);
    expect(parts[1].rect.x).toBeCloseTo(m.padX + m.wrapIndent);
    expect(parts[3].rect.y).toBeCloseTo(5 + 2 * m.rowH);
  });

  test("a row is never left empty, even for a group wider than the block", () => {
    const { parts, rowCount } = flowGroups([[token(20)], [token(1)]], 0, 0, 4, m);
    expect(parts[0].rect.y).toBe(0);
    expect(rowCount).toBe(2);
  });

  test("how far the row reaches is how much room the header used", () => {
    const { usedMax } = flowGroups([[token(1)], [token(2)]], 0, 0, 8, m);
    expect(usedMax).toBeCloseTo(m.padX + 1 + m.gap + 2 + m.padX);
  });

  test("each kind of part is as tall as the table says, centred in its row", () => {
    const kindsInTable = Object.keys(PART_HEIGHT);
    expect(kindsInTable.length).toBeGreaterThan(0);
    for (const kind of kindsInTable as Token["kind"][]) {
      const [part] = flowGroups([[token(1, kind)]], 0, 0, 8, m).parts;
      expect(part.rect.h).toBeCloseTo(m.rowH * PART_HEIGHT[kind]);
      expect(part.rect.y).toBeCloseTo((m.rowH - part.rect.h) / 2);
    }
    expect(PART_HEIGHT.field).toBe(PART_HEIGHT.flag); // chips for fields and ticks
    expect(PART_HEIGHT.fold).toBeLessThan(PART_HEIGHT.field);
  });
});
