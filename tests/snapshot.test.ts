import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { runProgram } from "../src/cadfly/language/run";
import { buffersOf, snapshot } from "../src/cadfly/language/snapshot";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});
const snap = (text: string) => snapshot(runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program));

describe("a run as plain data, for the page (the engine is in a Web Worker)", () => {
  test("it carries the meshes, the size and the volume, and can be copied (it holds nothing but data)", () => {
    const s = snap("box w=10 d=20 h=30");
    expect(s.shapes).toHaveLength(1);
    expect(s.combined!.max.map((v, i) => v - s.combined!.min[i])).toEqual([10, 20, 30]);
    expect(s.combined!.volume).toBeCloseTo(6000);
    expect(structuredClone(s).shapes[0].mesh.positions).toBeInstanceOf(Float32Array);
  });

  test("flat shapes give their area and bounds, and no volume", () => {
    const s = snap("rectangle w=10 h=5");
    expect(s.combined).toBeNull();
    expect(s.flat!.area).toBeCloseTo(50);
  });

  test("a problem is carried, with the block it is in", () => {
    const s = snap("box w=-5 d=10 h=10");
    expect(s.problem?.blockId).toBeTruthy();
  });

  test("the buffers to hand over are each listed once, even when two meshes could share one", () => {
    const s = snap("box w=10 d=20 h=30");
    const list = buffersOf(s);
    expect(new Set(list).size).toBe(list.length);
    expect(list.length).toBe(4); // the shape's mesh and the combined mesh, each positions and indices
  });
});

describe("flat shapes and sketches are marked so the view draws their boundary", () => {
  test("a flat shape and the sketch of a hidden extrude have an outline; a solid has none", () => {
    expect(snap("rectangle w=10 h=5").shapes[0].outline).toBe(true);
    expect(snap("box w=10 d=10 h=10").shapes[0].outline).toBeUndefined();
    const hidden = snap("extrude height=5 hidden\n  circle r=4");
    expect(hidden.shapes.map((s) => s.outline)).toEqual([true]);
  });
});

describe("a defined part can be a sketch", () => {
  const part = "define name=ring inputs=\"r\"\n  subtract\n    circle r=r\n    circle r=r-2 hole\n";
  test("used by itself it is a flat shape with an outline", () => {
    const s = snap(part + "use name=ring values=\"10\"");
    expect(s.problem).toBeUndefined();
    expect(s.flat!.area).toBeCloseTo(Math.PI * (100 - 64), -1);
    expect(s.shapes[0].outline).toBe(true);
  });
  test("used inside an extrude, it is the sketch that is extruded, and two uses can be combined", () => {
    const s = snap(part + "extrude height=4\n  use name=ring values=\"10\"\n  use name=ring values=\"4\"");
    expect(s.problem).toBeUndefined();
    expect(s.combined!.volume).toBeCloseTo((Math.PI * (100 - 64) + Math.PI * (16 - 4)) * 4, -1);
  });
});

describe("every piece of a sketch has its own outline, so one inside another can be seen", () => {
  test("a circle in the middle of a rectangle is joined into it, but still has an outline of its own", () => {
    const s = snap("union\n  rectangle w=40 h=30\n  circle r=5");
    expect(s.problem).toBeUndefined();
    expect(s.shapes.filter((x) => !x.linesOnly)).toHaveLength(1);
    expect(s.shapes.filter((x) => x.linesOnly)).toHaveLength(2); // one outline for each piece
    expect(s.flat!.area).toBeCloseTo(1200); // the joined shape is still just the rectangle
    expect(s.combined).toBeNull();
  });
  test("a single shape has no pieces to draw, and holes are not pieces", () => {
    expect(snap("circle r=5").shapes.filter((x) => x.linesOnly)).toHaveLength(0);
    expect(snap("union\n  rectangle w=40 h=30\n  circle r=5 hole").shapes.filter((x) => x.linesOnly)).toHaveLength(0);
  });
  test("they move with a transform and a mirror, and are lost by round (the shape is one piece after)", () => {
    const at = (text: string) => snap(text).shapes.filter((x) => x.linesOnly).map((x) => x.mesh.positions[0]);
    expect(snap("transform x=100\n  union\n    rectangle w=40 h=30\n    circle r=5").shapes.filter((x) => x.linesOnly)).toHaveLength(2);
    const moved = snap("transform x=100\n  union\n    rectangle w=40 h=30\n    circle r=5").shapes.filter((x) => x.linesOnly).flatMap((x) => [...x.mesh.positions].filter((_, i) => i % 3 === 0));
    expect(Math.min(...moved)).toBeGreaterThan(70);
    expect(snap("mirror axis=x both\n  union\n    rectangle w=10 h=10\n    circle r=2").shapes.filter((x) => x.linesOnly)).toHaveLength(4);
    expect(at("round radius=1\n  union\n    rectangle w=40 h=30\n    circle r=5")).toEqual([]);
  });
  test("a hidden extrude shows the pieces of its sketch too", () => {
    const s = snap("extrude height=5 hidden\n  union\n    rectangle w=40 h=30\n    circle r=5");
    expect(s.problem).toBeUndefined();
    expect(s.shapes.filter((x) => x.linesOnly)).toHaveLength(2);
    expect(s.combined).toBeNull();
  });
});
