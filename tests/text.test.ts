import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import { formatBlocks, parseBlocks } from "../src/cadfly/assistant/blocktext";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { runProgram } from "../src/cadfly/language/run";
import { box } from "./helpers/blocks";

/** The text block and the fonts it uses. */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const run = (text: string) => runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program);
const vol = (text: string) => run(text).combined!.volume();

const bounds = (text: string) => {
  const b = run(text).combined!.bounds();
  return [...b.min, ...b.max];
};

describe("text", () => {
  test("extruded text has the size asked for, and is centered where u, v say", () => {
    const b = bounds('extrude height=2\n  text text=HI size=14');
    // H and I have flat tops, so a capital is exactly `size` tall; v is halfway up it
    expect(b[1]).toBeCloseTo(-7, 3);
    expect(b[4]).toBeCloseTo(7, 3);
    expect(b[5]).toBeCloseTo(2, 3);
    // across, the middle of the ink is at u
    expect(b[0]).toBeCloseTo(-b[3], 3);
    expect(b[3]).toBeGreaterThan(5);
  });
  test("every letter and digit makes a solid", () => {
    expect(run('extrude height=1\n  text text="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"').problem).toBeUndefined();
  });
  test("hole engraves the letters out of a plate", () => {
    const plate = 'extrude height=3\n  rectangle w=30 h=18\n  text text=OK size=14 hole';
    const v = vol(plate);
    expect(v).toBeLessThan(30 * 18 * 3);
    expect(v).toBeGreaterThan(30 * 18 * 3 - 2 * 14 * 14 * 3);
  });
  test("a character the font has no letter for is explained, and a space draws nothing", () => {
    expect(run('extrude height=1\n  text text="a\u6f22b"').problem?.message).toMatch(/no letter "\u6f22"/);
    expect(run('extrude height=1\n  text text="   "').problem?.message).toMatch(/at least one letter/);
  });
  test("a letter with a counter (O) is one shape with a hole in it, not a filled one", () => {
    const o = (font: string) => run(`extrude height=1\n  text text=O font=${font} size=20`).combined!;
    const sans = o("sans");
    const box = sans.bounds();
    expect(box.max[1] - box.min[1]).toBeGreaterThan(19.5); // a round capital overshoots its height a little
    expect(box.max[1] - box.min[1]).toBeLessThan(21.5);
    expect(sans.volume()).toBeLessThan(0.7 * (box.max[0] - box.min[0]) * (box.max[1] - box.min[1])); // an O is mostly empty
    expect(sans.volume()).toBeGreaterThan(0);
  });
  test("every font writes, the capitals are as tall as asked, and the text starts at u on its baseline", () => {
    for (const font of ["sans", "bold", "serif", "mono"]) {
      const r = run(`extrude height=2\n  text text=HELLO font=${font} u=5 v=3 size=10`);
      expect(r.problem, font).toBeUndefined();
      const b = r.combined!.bounds();
      // centred on (5, 3): the same distance out each way sideways, and a capital's middle at v
      expect((b.min[0] + b.max[0]) / 2, font).toBeCloseTo(5, 1);
      expect(b.min[1], font).toBeGreaterThan(3 - 5.4); // a round letter dips a little under the baseline
      expect(b.max[1] - 3, font).toBeGreaterThan(4.9); // H is exactly size tall (half above the middle); the round O may pass it a little
      expect(b.max[1] - 3, font).toBeLessThan(5.8);
    }
  });
  test("lower case, digits and punctuation are in the real fonts; a letter the font lacks is explained; a font that does not exist is explained", () => {
    expect(run('extrude height=1\n  text text="Hello, World 2026!" font=bold').problem?.message).toBeUndefined();
    expect(run('extrude height=1\n  text text="a\u4e2db" font=sans').problem?.message).toMatch(/no letter/);
    expect(run('extrude height=1\n  text text=hi font=comic').problem?.message).toMatch(/"comic" is being fetched from Google/); // not a built-in, so it is taken for a Google font
    expect(run('extrude height=1\n  text text=hi font="https://example.com/a.ttf"').problem?.message).toMatch(/only addresses at fonts.google.com/);
  });
  test("a text hole engraves a letter with a counter without cutting its counter's island out of the plate twice", () => {
    const plate = (hole: string) => run(`extrude height=3\n  rectangle w=30 h=30\n  text text=O font=bold size=20 ${hole}`).combined!.volume();
    expect(plate("hole")).toBeLessThan(30 * 30 * 3);
    expect(plate("hole")).toBeGreaterThan(30 * 30 * 3 - 20 * 20 * 3);
  });
  test("text can be written without saying text=, and round-trips as block text", () => {
    const parsed = parseBlocks('extrude\n  text "HI THERE" size=9');
    expect(parsed[0].inner![0].args).toEqual({ text: "HI THERE", size: "9" });
    expect(parseBlocks(formatBlocks(parsed))).toEqual(parsed);
  });
});
