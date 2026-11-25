import { describe, expect, test } from "vitest";
import {
  NO_GESTURE,
  aimedAt,
  beginCarrying,
  beginMoving,
  carriedTo,
  giveUp,
  markMoved,
  movedTo,
  carryingPointer,
  panScrollTarget,
  release,
  scriptMoveTarget,
  scrollsWorkspace,
  startPress,
  startedFrom,
  type Gesture,
} from "../src/cadfly/ui/editor/gesture";
import type { Drag, Move, Touched } from "../src/cadfly/ui/editor/types";
import { box } from "./helpers/blocks";
import { oneScript } from "./helpers/script-helpers";

/**
 * The states of a finger or the mouse on the editor (pressing, carrying, moving
 * a script) and the steps between them.
 */

const program = oneScript([box("a")]);
const taken = oneScript([]);
const onBlock: Touched = { kind: "work", hit: { kind: "block", blockId: "a" } };
const drag = (): Drag => ({ blocks: [box("b")], startedFrom: program, programWithout: taken, grabOffset: { dx: -0.6, dy: -0.28 }, pointer: { x: 4, y: 3 } });
const move = (): Move => ({ scriptId: "s1", startedFrom: program, from: { x: 0, y: 1 }, to: { x: 0, y: 1 }, pointer: { x: 5, y: 4 }, programWithPlaces: program });
const pressing = () => startPress(onBlock, { x: 5, y: 4 }, 0.5);
const carrying = () => beginCarrying(markMoved(pressing()), drag());
const moving = () => beginMoving(markMoved(pressing()), move());

describe("starting", () => {
  test("a press starts a gesture that has not moved, and replaces whatever was going", () => {
    const g = pressing();
    expect(g).toEqual({ kind: "pressing", press: { at: { x: 5, y: 4 }, touched: onBlock, moved: false, scrollStart: 0.5 } });
    expect(startPress(onBlock, { x: 1, y: 1 }, 0).kind).toBe("pressing");
  });

  test("moving far enough marks the press as a drag, and changes nothing else", () => {
    const g = markMoved(pressing());
    expect(g.kind === "pressing" && g.press.moved).toBe(true);
    expect(markMoved(NO_GESTURE)).toBe(NO_GESTURE);
    const c = carrying();
    expect(markMoved(c)).toBe(c);
  });

  test("only a press can turn into carrying blocks or moving a script", () => {
    expect(carrying().kind).toBe("carrying");
    expect(moving().kind).toBe("movingScript");
    expect(beginCarrying(NO_GESTURE, drag())).toBe(NO_GESTURE);
    const m = moving();
    expect(beginCarrying(m, drag())).toBe(m);
    const c = carrying();
    expect(beginMoving(c, move())).toBe(c);
  });
});

describe("while it goes on", () => {
  test("carried blocks follow the pointer and are aimed at where they would land", () => {
    const g = aimedAt(carriedTo(carrying(), { x: 7, y: 2 }), { newScriptAt: { x: 1, y: 2 } });
    expect(g.kind === "carrying" && g.drag.pointer).toEqual({ x: 7, y: 2 });
    expect(g.kind === "carrying" && g.drag.newScriptAt).toEqual({ x: 1, y: 2 });
    expect(g.kind === "carrying" && g.drag.snap).toBeUndefined();
    // the blocks and the program they came from stay as they were
    expect(g.kind === "carrying" && g.drag.startedFrom).toBe(program);
  });

  test("a step does not change the state it was given", () => {
    const c = carrying();
    carriedTo(c, { x: 9, y: 9 });
    expect(c.kind === "carrying" && c.drag.pointer).toEqual({ x: 4, y: 3 });
  });

  test("pointer and aim steps leave a gesture that is not carrying alone", () => {
    for (const g of [NO_GESTURE, pressing(), moving()]) {
      expect(carriedTo(g, { x: 1, y: 1 })).toBe(g);
      expect(aimedAt(g, {})).toBe(g);
    }
  });

  test("a script that is moving is moved to where the pointer takes it", () => {
    const g = movedTo(moving(), { x: 2, y: 3 }, { x: 6, y: 7 });
    expect(g.kind === "movingScript" && g.move.to).toEqual({ x: 2, y: 3 });
    expect(g.kind === "movingScript" && g.move.pointer).toEqual({ x: 6, y: 7 });
    expect(movedTo(pressing(), { x: 2, y: 3 }, { x: 6, y: 7 }).kind).toBe("pressing");
  });

  test("the pointer of a gesture that carries something is known, for the view to scroll under it", () => {
    expect(carryingPointer(carrying())).toEqual({ x: 4, y: 3 });
    expect(carryingPointer(carriedTo(carrying(), { x: 1, y: 8 }))).toEqual({ x: 1, y: 8 });
    expect(carryingPointer(moving())).toEqual({ x: 5, y: 4 });
    expect(carryingPointer(movedTo(moving(), { x: 2, y: 3 }, { x: 6, y: 7 }))).toEqual({ x: 6, y: 7 });
    // nothing carried, no pointer to scroll under
    expect(carryingPointer(NO_GESTURE)).toBeUndefined();
    expect(carryingPointer(pressing())).toBeUndefined();
  });
});

describe("where things are put", () => {
  test("a moved script keeps the offset the pointer had, and the workspace scrolling since counts", () => {
    const m = move();
    const press = { at: { x: 5, y: 4 }, touched: onBlock, moved: true, scrollStart: 0.5 };
    expect(scriptMoveTarget(m, press, { x: 5, y: 4 }, 0.5)).toEqual({ x: 0, y: 1 }); // not moved: where it was
    expect(scriptMoveTarget(m, press, { x: 6.5, y: 5 }, 0.5)).toEqual({ x: 1.5, y: 2 });
    expect(scriptMoveTarget(m, press, { x: 5, y: 4 }, 1.5)).toEqual({ x: 0, y: 2 }); // scrolled a metre: it is a metre lower in the workspace
  });

  test("a drag that carries nothing drags the workspace along with the pointer, and only from empty space or the workspace", () => {
    const press = { at: { x: 5, y: 4 }, touched: onBlock, moved: true, scrollStart: 2 };
    expect(panScrollTarget(press, { x: 5, y: 3 })).toBe(3);
    expect(panScrollTarget(press, { x: 5, y: 5 })).toBe(1);
    expect(scrollsWorkspace(press)).toBe(true);
    expect(scrollsWorkspace({ ...press, touched: { kind: "empty" } })).toBe(true);
    expect(scrollsWorkspace({ ...press, touched: { kind: "palette", blockKind: "box" } })).toBe(false);
    expect(scrollsWorkspace({ ...press, touched: { kind: "tab", category: "shapes" } })).toBe(false);
  });
});

describe("how a gesture ends", () => {
  test("carried blocks are put down, and a moved script is put down, by either kind of release", () => {
    for (const how of ["panStop", "up"] as const) {
      expect(release(carrying(), how)).toEqual({ then: "dropBlocks" });
      expect(release(moving(), how)).toEqual({ then: "dropScript" });
    }
  });

  test("a press that never moved is a tap when the pointer comes up, and the end of a drag that moved nothing is not", () => {
    expect(release(pressing(), "up")).toEqual({ then: "tap", touched: onBlock });
    expect(release(markMoved(pressing()), "up")).toEqual({ then: "nothing" }); // it moved, but carried nothing
    expect(release(pressing(), "panStop")).toEqual({ then: "nothing" });
  });

  test("a release when nothing is going on does nothing: the engine reports the end of a drag and then the release", () => {
    expect(release(NO_GESTURE, "panStop")).toEqual({ then: "nothing" });
    expect(release(NO_GESTURE, "up")).toEqual({ then: "nothing" });
  });

  test("giving up goes back to nothing, from every state", () => {
    const states: Gesture[] = [NO_GESTURE, pressing(), carrying(), moving()];
    for (const g of states) expect(giveUp(), g.kind).toBe(NO_GESTURE);
  });
});

describe("the program a gesture started from", () => {
  test("only a gesture that took something out of the program has one: blocks, or a script's places", () => {
    expect(startedFrom(carrying())).toBe(program);
    expect(startedFrom(moving())).toBe(program);
    expect(startedFrom(pressing())).toBeUndefined();
    expect(startedFrom(NO_GESTURE)).toBeUndefined();
  });
});
