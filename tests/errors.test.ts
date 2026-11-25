import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";
import { oneScript } from "./helpers/script-helpers";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";

/** What a program says when something is wrong, and which block it blames. */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

let n = 0;

/** A block, with an id, in as few characters as possible */
const b = (kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({
  id: `b${++n}`,
  kind,
  args,
  ...(inner ? { inner } : {}),
});

const run = (...blocks: Block[]) => runProgram(k, oneScript(blocks));
const vol = (r: RunResult) => r.combined!.volume();
const names = (r: RunResult) => r.shapes.map((s) => s.name);

describe("when something is wrong", () => {
  test("a field's problem is named, and points at its block", () => {
    const bad = b("box", { name: "p", w: "width", d: "1", h: "1" });
    const r = run(bad);
    expect(r.problem!.blockId).toBe(bad.id);
    expect(r.problem!.message).toMatch(/^width: .*unknown variable.*width/);
  });

  test("the program stops there, and what came before is still built", () => {
    const bad = b("box", { name: "b", w: "1 / 0", d: "1", h: "1" });
    const r = run(b("box", { name: "a", w: "10", d: "10", h: "10" }), bad, b("box", { name: "c", w: "1", d: "1", h: "1" }));
    expect(r.problem!.blockId).toBe(bad.id);
    expect(r.problem!.message).toMatch(/^width: .*division by zero/);
    expect(names(r)).toEqual(["a"]); // c never ran
    expect(vol(r)).toBeCloseTo(1000); // and a is still there to see
  });

  test("variable names", () => {
    expect(run(b("set", { name: "2x", value: "1" })).problem!.message).toMatch(/variable name/);
    expect(run(b("set", { name: "pi", value: "1" })).problem!.message).toMatch(/built in/);
  });

  test("sizes", () => {
    expect(run(b("box", { name: "a", w: "0" })).problem!.message).toMatch(/^width: must be more than zero/);
    expect(run(b("sphere", { name: "a", r: "-1" })).problem!.message).toMatch(/radius: must be more than zero/);
    expect(run(b("cylinder", { name: "a", r: "0", top: "0" })).problem!.message).toMatch(/cannot both be zero/);
    const flat = b("transform", { sx: "0" }, [b("box")]);
    const found = run(flat).problem!;
    expect(found.blockId).toBe(flat.id);
    expect(found.message).toMatch(/^scale x: must be more than zero/);
  });

  test("sketch problems are pointed at the piece that is wrong", () => {
    const flat = b("rectangle", { w: "0" });
    const r = run(b("extrude", { name: "e" }, [b("rectangle", {}), flat]));
    expect(r.problem!.blockId).toBe(flat.id);
    expect(r.problem!.message).toMatch(/rectangle width must be a positive number/);

    const poly = b("polygon", {}, [b("point", { u: "0", v: "0" }), b("point", { u: "1", v: "1" })]);
    {
      const found = run(b("extrude", { name: "e" }, [poly])).problem!;
      expect(found.blockId).toBe(poly.id);
      expect(found.message).toMatch(/at least three points/);
    }

    const bowtie = b("polygon", {}, [b("point", { u: "0", v: "0" }), b("point", { u: "2", v: "2" }), b("point", { u: "2", v: "0" }), b("point", { u: "0", v: "2" })]);
    {
      const found = run(b("extrude", { name: "e" }, [bowtie])).problem!;
      expect(found.blockId).toBe(bowtie.id);
      expect(found.message).toMatch(/crosses itself/);
    }
  });

  test("an empty sketch, or one of only holes", () => {
    const empty = b("extrude", { name: "e" }, []);
    {
      const found = run(empty).problem!;
      expect(found.blockId).toBe(empty.id);
      expect(found.message).toMatch(/inside this block/);
    }
    const holes = b("extrude", { name: "e" }, [b("circle", { hole: true })]);
    expect(run(holes).problem!.message).toMatch(/at least one shape that is not a hole/);
  });

  test("a shape whose geometry fails is reported at the block that made it, and the rest is still drawn", () => {
    const crossing = b("revolve", { name: "r", plane: "XY", offset: "0", angle: "360" }, [b("rectangle", { u: "-1", v: "0", w: "3", h: "5" })]);
    const r = run(b("box", { name: "ok", w: "2", d: "2", h: "2" }), crossing);
    expect(r.problem!.blockId).toBe(crossing.id);
    expect(r.problem!.message).toMatch(/revolve profile must lie on the u >= 0 side/);
    expect(vol(r)).toBeCloseTo(8); // the box is still drawn
    expect(names(r)).toEqual(["ok"]);
  });

  test("a problem deep inside holders is pointed at, not at the holders around it", () => {
    const deep = b("box", { name: "deep", w: "1 / 0" });
    const r = run(b("transform", {}, [b("transform", {}, [b("union", {}, [b("box"), deep])])]));
    {
      const found = r.problem!;
      expect(found.blockId).toBe(deep.id);
      expect(found.message).toMatch(/division by zero/);
    }
    expect(r.shapes).toEqual([]);
  });

  test("holes that remove everything", () => {
    const e = b("extrude", { name: "e", plane: "XY", offset: "0", height: "1" }, [b("rectangle", { w: "4", h: "4" }), b("rectangle", { u: "-1", v: "-1", w: "6", h: "6", hole: true })]);
    {
      const found = run(e).problem!;
      expect(found.blockId).toBe(e.id);
      expect(found.message).toMatch(/remove everything/);
    }
  });

  test("a bad revolve angle, and a part of a block used as a statement", () => {
    expect(run(b("revolve", { name: "r", angle: "400" }, [b("rectangle", { u: "1" })])).problem!.message).toMatch(/angle: must be more than 0 and at most 360/);
    expect(run(b("point", {})).problem!.message).toMatch(/belongs inside another block/);
  });

  test("an empty program is just empty", () => {
    const r = run();
    expect(r.problem).toBeUndefined();
    expect(r.combined).toBeNull();
  });
});
