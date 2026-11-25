import { describe, expect, test } from "vitest";
import type { Program } from "../src/cadfly/language/types";
import { layoutProgram } from "../src/cadfly/ui/layout";
import { modeByName } from "../src/cadfly/ui/modes";
import { type EdgeZone, dropPlan, edgeScrollSpeed, edgeScrolled, isStale, movedEnough, valueToKeep } from "../src/cadfly/ui/rules";
import { box, set } from "./helpers/blocks";
import { oneScript } from "./helpers/script-helpers";

/**
 * The small decisions the interface makes, as plain functions: whether a gesture
 * has gone stale, where carried blocks would land, whether a script has moved,
 * and what a field edit leaves in the field.
 */

describe("a gesture or answer that has gone stale", () => {
  test("a program that is not the one it started from is stale", () => {
    const a = oneScript([box("a")]);
    const b = oneScript([box("a")]); // equal, but a different program
    expect(isStale(a, a)).toBe(false);
    expect(isStale(a, b)).toBe(true);
  });

  test("with nothing started, nothing is stale", () => {
    expect(isStale(undefined, oneScript([box("a")]))).toBe(false);
  });
});

describe("where carried blocks would land", () => {
  const measure = (t: string) => t.length * 0.1;
  const program = (): Program => oneScript([box("a"), box("b")]);
  const layout = (p: Program) => layoutProgram(p, { x: 1, y: 2, width: 8, measure });
  const origin = { x: 1, y: 2 };
  const builder = modeByName("Builder");
  const firstSteps = modeByName("First steps");

  test("near a drop point that takes them, they snap to it", () => {
    const p = program();
    const l = layout(p);
    const target = l.dropPoints[1];
    const plan = dropPlan(l, p, [box("c")], { x: target.x + 0.1, y: target.y + 0.1 }, true, origin, builder, 0.9);
    expect(plan.snap).toMatchObject({ scriptId: "s1", index: 1 });
    expect(plan.newScriptAt).toBeUndefined();
  });

  test("far from every drop point, a set block starts a script of its own where it is, in a mode that has scripts", () => {
    const p = program();
    const plan = dropPlan(layout(p), p, [set("w", "5")], { x: 30, y: 30 }, true, origin, builder, 0.9);
    expect(plan.snap).toBeUndefined();
    expect(plan.newScriptAt).toEqual({ x: 29, y: 28 });
  });

  test("any other block far from everything goes nowhere, and so does a set block in a mode with no scripts", () => {
    const p = program();
    expect(dropPlan(layout(p), p, [box("c")], { x: 30, y: 30 }, true, origin, builder, 0.9)).toEqual({});
    expect(dropPlan(layout(p), p, [set("w", "5")], { x: 30, y: 30 }, true, origin, firstSteps, 0.9)).toEqual({});
  });

  test("a place left of or above the workspace's corner is not negative", () => {
    const p = program();
    expect(dropPlan(layout(p), p, [set("w", "5")], { x: -20, y: -20 }, true, origin, builder, 0.9).newScriptAt).toEqual({ x: 0, y: 0 });
  });

  test("a pointer outside the workspace lands nowhere, even right on a drop point", () => {
    const p = program();
    const l = layout(p);
    const target = l.dropPoints[0];
    expect(dropPlan(l, p, [box("c")], { x: target.x, y: target.y }, false, origin, builder, 0.9)).toEqual({});
  });
});

describe("whether a script moved", () => {
  test("a move shorter than the step a place is kept to is no move", () => {
    expect(movedEnough({ x: 1, y: 1 }, { x: 1.004, y: 1.003 })).toBe(false);
    expect(movedEnough({ x: 1, y: 1 }, { x: 1.01, y: 1 })).toBe(true);
    expect(movedEnough({ x: 1, y: 1 }, { x: 1, y: 1.02 })).toBe(true);
  });

  test("places are kept at 0 or more, so a move that ends left of 0 from 0 is no move", () => {
    expect(movedEnough({ x: 0, y: 0 }, { x: -3, y: -3 })).toBe(false);
  });
});

describe("what a field edit leaves in the field", () => {
  test("a new value replaces the old one; the same value changes nothing", () => {
    expect(valueToKeep("12", "10", false)).toBe("12");
    expect(valueToKeep("10", "10", false)).toBeUndefined();
  });

  test("a field cleared out becomes empty", () => {
    expect(valueToKeep("", "10", false)).toBe("");
  });

  test("a field that offers suggestions starts empty, and keeps its old value if nothing is typed", () => {
    expect(valueToKeep("", "serif", true)).toBeUndefined();
    expect(valueToKeep("Pacifico", "serif", true)).toBe("Pacifico");
  });
});

describe("scrolling the view when blocks are carried near an edge", () => {
  const zone: EdgeZone = { top: 1, bottom: 8, depth: 0.5, maxSpeed: 4 };

  test("the view scrolls only inside the zones, up near the top and down near the bottom", () => {
    expect(edgeScrollSpeed(4, zone)).toBe(0);
    expect(edgeScrollSpeed(1.5, zone)).toBe(0); // the inner side of the top zone
    expect(edgeScrollSpeed(7.5, zone)).toBe(0); // the inner side of the bottom zone
    expect(edgeScrollSpeed(1.25, zone)).toBeLessThan(0);
    expect(edgeScrollSpeed(7.75, zone)).toBeGreaterThan(0);
  });

  test("the speed grows in a straight line with how far into the zone the pointer is, to the top speed at the edge", () => {
    expect(edgeScrollSpeed(1.25, zone)).toBeCloseTo(-2); // halfway in
    expect(edgeScrollSpeed(1.125, zone)).toBeCloseTo(-3); // three quarters in
    expect(edgeScrollSpeed(1, zone)).toBeCloseTo(-4); // at the edge
    expect(edgeScrollSpeed(7.75, zone)).toBeCloseTo(2);
    expect(edgeScrollSpeed(8, zone)).toBeCloseTo(4);
  });

  test("beyond the edge, the speed stays at the top speed", () => {
    expect(edgeScrollSpeed(0.2, zone)).toBe(-4);
    expect(edgeScrollSpeed(9, zone)).toBe(4);
  });

  test("the distance is the speed times the time", () => {
    expect(edgeScrolled(2, 3, 0.05, 0, 10)).toBeCloseTo(2.15);
    expect(edgeScrolled(2, -3, 0.05, 0, 10)).toBeCloseTo(1.85);
    expect(edgeScrolled(2, 0, 0.05, 0, 10)).toBe(2);
  });

  test("it is the same distance however the time is cut into frames, and does not need the pointer to move", () => {
    const run = (frames: number) => {
      let y = 0;
      for (let i = 0; i < frames; i++) y = edgeScrolled(y, 3, 1 / frames, -100, 100);
      return y;
    };
    // a whole second at 15, 30, 60 and 144 frames a second
    for (const fps of [15, 30, 60, 144]) expect(run(fps), `${fps} fps`).toBeCloseTo(run(60), 6);
    // one second held at speed 3 scrolls 3 meters, not a number of meters per event
    expect(run(60)).toBeCloseTo(3, 6);
  });

  test("it stops at the limits of the view", () => {
    expect(edgeScrolled(9.9, 4, 0.1, 0, 10)).toBe(10);
    expect(edgeScrolled(0.1, -4, 0.1, 0, 10)).toBe(0);
    expect(edgeScrolled(5, 4, 0.1, -1, -1)).toBe(-1);
    // the view cannot scroll at all: it stays at its least
    expect(edgeScrolled(0, 4, 0.1, 0, 0)).toBe(0);
  });

  test("a stalled page does not jump: a long step counts as a tenth of a second", () => {
    expect(edgeScrolled(0, 4, 5, -100, 100)).toBeCloseTo(0.4);
    expect(edgeScrolled(0, 4, 0.1, -100, 100)).toBeCloseTo(0.4);
  });
});
