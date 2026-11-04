import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { runProgram } from "../src/cadfly/language/run";
import { snapshot } from "../src/cadfly/language/snapshot";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});
const program = (text: string) => applyOps([], [{ op: "append", blocks: text }]).program;

// The engine worker releases the kernel's memory after every run (or it grows with every edit): a run's result is plain data, and the
// results of rounding and hollowing, which are remembered between runs, must survive it
describe("building again after a release", () => {
  test("a run's snapshot is still good after the release", () => {
    const snap = snapshot(runProgram(k, program("box w=10 d=20 h=30")));
    k.release();
    expect(snap.combined!.volume).toBeCloseTo(6000);
    expect(snap.shapes[0].mesh.positions.length).toBeGreaterThan(0);
  });

  test("a remembered result of rounding is used again by the next run, and gives the same shape", () => {
    const text = "round radius=2\n  box w=10 d=10 h=10";
    const first = snapshot(runProgram(k, program(text)));
    k.release();
    const second = snapshot(runProgram(k, program(text))); // finds the remembered solid, which the release must have left alone
    k.release();
    const third = snapshot(runProgram(k, program(text)));
    k.release();
    expect(first.problem).toBeUndefined();
    expect(second.problem).toBeUndefined();
    expect(second.combined!.volume).toBeCloseTo(first.combined!.volume);
    expect(third.combined!.volume).toBeCloseTo(first.combined!.volume);
    expect(first.combined!.volume).toBeLessThan(1000);
  });

  test("remembered results pushed out of the cache are freed, and building goes on working", () => {
    // more different roundings than the cache holds
    for (let r = 1; r <= 30; r++) {
      const snap = snapshot(runProgram(k, program(`round radius=${r / 10}\n  box w=10 d=10 h=10`)));
      k.release();
      expect(snap.problem).toBeUndefined();
    }
    const again = snapshot(runProgram(k, program("round radius=0.1\n  box w=10 d=10 h=10")));
    k.release();
    expect(again.problem).toBeUndefined();
  });

  test("hollowing too", () => {
    const text = "shell thickness=1 open=top\n  box w=10 d=10 h=10";
    const a = snapshot(runProgram(k, program(text)));
    k.release();
    const b = snapshot(runProgram(k, program(text)));
    k.release();
    expect(a.problem).toBeUndefined();
    expect(b.combined!.volume).toBeCloseTo(a.combined!.volume);
  });
});
