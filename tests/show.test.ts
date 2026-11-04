import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { runProgram } from "../src/cadfly/language/run";
import { snapshot } from "../src/cadfly/language/snapshot";
import { displayShapes, readoutText } from "../src/cadfly/view/show";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});
const snap = (text: string) => snapshot(runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program));

// What the readout over the 3D view says, for the app and for the viewer page
describe("the readout", () => {
  test("a solid gives its size and volume", () => {
    expect(readoutText(snap("box w=10 d=20 h=30"))).toBe("1 shape\nsize  10 x 20 x 30 mm\nvolume  6,000 mm3");
  });

  test("flat shapes give their size and area", () => {
    expect(readoutText(snap("rectangle w=10 h=5"))).toBe("1 shape\nflat  10 x 5 mm\narea  50 mm2");
  });

  test("an empty program has nothing to measure", () => {
    expect(readoutText(snapshot(runProgram(k, [])))).toBeUndefined();
  });

  test("the shapes to draw are the result's shapes", () => {
    const s = snap("box w=10 d=20 h=30");
    expect(displayShapes(s)).toHaveLength(1);
    expect(displayShapes(s)[0].mesh).toBe(s.shapes[0].mesh);
  });
});
