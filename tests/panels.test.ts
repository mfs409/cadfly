import { describe, expect, test } from "vitest";
import { COMMANDS, commandById } from "../src/cadfly/language/commands";
import { CATEGORIES, PALETTE_W, SCREEN, VIEW_BOTTOM, VIEW_TOP } from "../src/cadfly/ui/editor/geometry";
import { palettePlan, toolbarPlan, visibleTabs } from "../src/cadfly/ui/editor/panels";
import { modeByName, offeredKinds } from "../src/cadfly/ui/modes";

/**
 * Where the toolbar's buttons and tabs and the palette's rows go, worked out
 * from numbers alone.
 */

const measure = (t: string) => t.length * 0.1;
const buttons = [
  { group: "file" as const, label: "Save" },
  { group: "edit" as const, label: "Undo" },
  { group: "mode" as const, label: "Builder" },
  { group: "file" as const, label: "Load" },
  { group: "edit" as const, label: "Redo" },
];
const overlaps = (a: { x: number; w: number }, b: { x: number; w: number }) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9;

describe("the tabs a mode has", () => {
  const first = modeByName("First steps");

  test("a tab for each category the mode has a block in, and the first when the chosen one has none", () => {
    const { tabs, category } = visibleTabs(first, "shapes");
    const wanted = CATEGORIES.filter((c) => offeredKinds(first).some((kind) => commandById(kind)!.category === c.id)).map((c) => c.id);
    expect(tabs.map((t) => t.id)).toEqual(wanted);
    expect(category).toBe("shapes");
    const missing = CATEGORIES.find((c) => !wanted.includes(c.id))!; // a category the mode has no block in
    expect(visibleTabs(first, missing.id).category).toBe(tabs[0].id);
    expect(visibleTabs(undefined, "sketch").category).toBe("sketch");
    expect(visibleTabs(undefined, "sketch").tabs).toHaveLength(CATEGORIES.length);
  });

  test("the blocks offered are those the mode does not hide", () => {
    expect(visibleTabs(undefined, "shapes").offered).toHaveLength(COMMANDS.length);
    expect(visibleTabs(first, "shapes").offered.map((d) => d.id).sort()).toEqual([...offeredKinds(first)].sort());
  });
});

describe("the toolbar", () => {
  const tabs = CATEGORIES.slice(0, 3);
  const plan = toolbarPlan(buttons, tabs, measure);

  test("every button is placed once, in its group", () => {
    expect(plan.file.map((p) => buttons[p.index].label)).toEqual(["Save", "Load"]);
    expect(plan.edit.map((p) => buttons[p.index].label)).toEqual(["Undo", "Redo"]);
    expect(plan.mode.map((p) => buttons[p.index].label)).toEqual(["Builder"]);
    expect(plan.tabs.map((t) => t.id)).toEqual(tabs.map((t) => t.id));
  });

  test("nothing overlaps, and everything is on the screen", () => {
    const all = [...plan.file, ...plan.edit, ...plan.mode].map((p) => p.rect).concat(plan.tabs.map((t) => t.rect));
    for (let i = 0; i < all.length; i++) {
      expect(all[i].x).toBeGreaterThanOrEqual(0);
      expect(all[i].x + all[i].w).toBeLessThanOrEqual(SCREEN.w);
      for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j]), `${i} and ${j}`).toBe(false);
    }
  });

  test("the project's buttons are at the right, the tabs at the left, and undo and redo follow the tabs", () => {
    const lastTab = plan.tabs[plan.tabs.length - 1].rect;
    expect(plan.edit[0].rect.x).toBeGreaterThan(lastTab.x + lastTab.w);
    expect(plan.file[0].rect.x).toBeGreaterThan(plan.edit[plan.edit.length - 1].rect.x);
    const lastFile = plan.file[plan.file.length - 1].rect;
    expect(lastFile.x + lastFile.w).toBeCloseTo(SCREEN.w - 0.12);
  });

  test("with room short, the words of the tabs get smaller, but not below the least", () => {
    const wide = toolbarPlan([...buttons, ...buttons, ...buttons], CATEGORIES, measure);
    expect(wide.tabTextSize).toBeLessThan(15);
    expect(wide.tabTextSize).toBeGreaterThanOrEqual(11);
    expect(plan.tabTextSize).toBe(15);
  });
});

describe("the palette", () => {
  test("the blocks of the chosen tab go in a column, each inside the palette, in the order offered", () => {
    const { offered } = visibleTabs(modeByName("Builder"), "shapes");
    const p = palettePlan(offered, "shapes", true);
    expect(p.rows.length).toBeGreaterThan(0);
    for (const row of p.rows) {
      expect(row.def.category).toBe("shapes");
      expect(row.rect.x).toBeGreaterThanOrEqual(0);
      expect(row.rect.x + row.rect.w).toBeLessThanOrEqual(PALETTE_W);
      expect(row.rect.y).toBeGreaterThanOrEqual(VIEW_TOP);
      expect(row.rect.y + row.rect.h).toBeLessThanOrEqual(VIEW_BOTTOM);
    }
    expect(p.rows.map((r) => r.def.id)).toEqual(offered.filter((d) => d.category === "shapes" && !d.automatic).map((d) => d.id));
  });

  test("the new script button is there only where the mode has scripts, below the blocks", () => {
    const { offered } = visibleTabs(undefined, "shapes");
    expect(palettePlan(offered, "shapes", false).newScript).toBeUndefined();
    const withScripts = palettePlan(offered, "shapes", true);
    const button = withScripts.newScript!;
    expect(button.h).toBeGreaterThan(0);
    for (const row of withScripts.rows) expect(row.rect.y + row.rect.h).toBeLessThanOrEqual(button.y + 1e-9);
  });

  test("when there are more blocks than fit, the rows get closer, and with far too many they go in two columns", () => {
    const some = (n: number) => Array.from({ length: n }, (_, i) => ({ ...COMMANDS[0], id: `k${i}`, category: "shapes" as const, automatic: false }));
    const few = palettePlan(some(4), "shapes", false);
    const many = palettePlan(some(14), "shapes", false);
    const lots = palettePlan(some(30), "shapes", false);
    const step = (p: typeof few) => p.rows[1].rect.y - p.rows[0].rect.y;
    expect(step(many)).toBeLessThan(step(few));
    expect(new Set(few.rows.map((r) => r.rect.x)).size).toBe(1);
    expect(new Set(lots.rows.map((r) => r.rect.x)).size).toBe(2);
  });

  test("the sections of a solid come with it and are not in the palette", () => {
    const { offered } = visibleTabs(undefined, "shapes");
    expect(palettePlan(offered, "shapes", false).rows.every((r) => !r.def.automatic)).toBe(true);
  });
});
