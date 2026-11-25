import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { COMMANDS, blankBlock, canDisable, canHide, commandById } from "../src/cadfly/language/commands";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";
import { oneScript } from "./helpers/script-helpers";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { ids } from "./helpers/blocks";
import { showsEye, showsPower } from "../src/cadfly/ui/modes";
import { validateProgram } from "../src/cadfly/language/format";

/**
 * The table of block kinds itself: every kind is complete, consistent and has
 * what its fields need.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const run = (...blocks: Block[]) => runProgram(k, oneScript(blocks));
const names = (r: RunResult) => r.shapes.map((s) => s.name);

describe("the command list itself", () => {
  test("every command is well formed", () => {
    const ids = new Set<string>();
    for (const c of COMMANDS) {
      expect(ids.has(c.id), `${c.id} is listed twice`).toBe(false);
      ids.add(c.id);
      const paramIds = new Set<string>();
      for (const p of c.params) {
        expect(paramIds.has(p.id), `${c.id}.${p.id} is listed twice`).toBe(false);
        paramIds.add(p.id);
        if (p.type.kind === "flag") expect(typeof p.default).toBe("boolean");
        else expect(typeof p.default).toBe("string");
        if (p.type.kind === "choice") expect(p.type.options.map((o) => o.value)).toContain(p.default);
      }
      for (const kind of c.inner ?? []) expect(commandById(kind), `${c.id} holds unknown ${kind}`).toBeDefined();
      // a block either does something, or makes a shape, or is a piece of a bigger block
      expect([c.run, c.make, c.piece].filter(Boolean).length, `${c.id} should have exactly one of run, make or piece`).toBe(1);
      if (c.buildsInner) expect(c.make && c.inner, `${c.id} builds its inner blocks, so it needs make and inner`).toBeTruthy();
    }
  });

  test("a blank block has every field at its default", () => {
    const blank = blankBlock("extrude", "x1");
    const extrude = commandById("extrude")!;
    expect(blank).toEqual({ id: "x1", kind: "extrude", args: Object.fromEntries(extrude.params.map((p) => [p.id, p.default])), inner: [] });
    expect(Object.keys(blank.args).length).toBeGreaterThan(3);
    expect(() => blankBlock("nope", "x2")).toThrow(/no such command/);
  });

  test("a blank program built from blank blocks runs (except where something has to go inside)", () => {
    const r = runProgram(k, oneScript([blankBlock("box", "1"), blankBlock("sphere", "2"), blankBlock("cylinder", "3")]));
    expect(r.problem).toBeUndefined();
    expect(names(r)).toEqual(["box", "sphere", "cylinder"]);
  });
});

describe("which blocks may be hidden or switched off", () => {
  test("only a block that makes a shape of its own may be hidden", () => {
    for (const c of COMMANDS) {
      // a piece of a bigger block never makes a shape (the check above says a command is only one of run, make, piece)
      expect(canHide(c), c.id).toBe(c.make !== undefined && !c.observer);
    }
    expect(COMMANDS.filter(canHide).map((c) => c.id)).toContain("box");
    for (const id of ["set", "measure", "vertex", "face", "point"]) expect(canHide(commandById(id)!), id).toBe(false);
  });

  test("only a block that changes what is inside it may be switched off", () => {
    for (const c of COMMANDS) expect(canDisable(c), c.id).toBe(c.modifier === true);
    expect(COMMANDS.filter(canDisable).map((c) => c.id)).toContain("transform");
  });

  test("the eye, the power switch and the file format all follow the same rules", () => {
    for (const c of COMMANDS) {
      // a block that is hidden (or disabled) always shows its switch, in any mode, so the rule is what the switch is for
      expect(showsEye(c, undefined, { id: "b1", kind: c.id, args: {}, hidden: true }), c.id).toBe(canHide(c));
      expect(showsPower(c, undefined, { id: "b1", kind: c.id, args: {}, disabled: true }), c.id).toBe(canDisable(c));
      // the format accepts the flag exactly where the rule allows it
      const flagged = (flag: "hidden" | "disabled") => () => validateProgram([{ id: "s1", name: "build", blocks: [{ id: "b1", kind: c.id, args: {}, [flag]: true }] }]);
      if (c.piece) continue; // a piece cannot be at the top of a script, which the format would say first
      if (canHide(c)) expect(flagged("hidden"), c.id).not.toThrow();
      else expect(flagged("hidden"), c.id).toThrow(/cannot be hidden/);
      if (canDisable(c)) expect(flagged("disabled"), c.id).not.toThrow();
      else expect(flagged("disabled"), c.id).toThrow(/cannot be disabled/);
    }
  });
});
