import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import { formatBlocks, parseBlocks } from "../src/cadfly/assistant/blocktext";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { textShapes } from "../src/cadfly/geometry/fonts";
import { triangulate } from "../src/cadfly/geometry/sweep";
import { modeByName, shownParams } from "../src/cadfly/language/modes";
import { commandById } from "../src/cadfly/language/commands";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { newBlockFor } from "../src/cadfly/language/edit";
import { runProgram } from "../src/cadfly/language/run";

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
const close = (got: number[], want: number[], digits = 3) => want.forEach((v, i) => expect(got[i], `item ${i}`).toBeCloseTo(v, digits));

describe("triangulate", () => {
  test("an L shape is cut into triangles that add up to its area", () => {
    const l: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
    const tris = triangulate(l);
    expect(tris).toHaveLength(4);
    const area = tris.reduce((a, [i, j, m]) => a + ((l[j][0] - l[i][0]) * (l[m][1] - l[i][1]) - (l[j][1] - l[i][1]) * (l[m][0] - l[i][0])) / 2, 0);
    expect(area).toBeCloseTo(7, 6);
  });
  test("a flat point on a side is used, not skipped", () => {
    const sq: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]];
    const used = new Set(triangulate(sq).flat());
    expect(used.size).toBe(5);
  });
});

describe("loft", () => {
  test("a square blended into the same square is a box", () => {
    const text = "loft height=10\n  bottom\n    rectangle w=10 h=10\n  top\n    rectangle w=10 h=10";
    expect(vol(text)).toBeCloseTo(1000, 3);
    close(bounds(text), [-5, -5, 0, 5, 5, 10]);
  });
  test("a square into a smaller square is a frustum", () => {
    const text = "loft height=9\n  bottom\n    rectangle w=10 h=10\n  top\n    rectangle w=4 h=4";
    expect(vol(text)).toBeCloseTo((9 / 3) * (100 + 16 + 40), 3);
  });
  test("a square into a circle is in between the two prisms, and reaches the circle at the top", () => {
    const text = "loft height=20\n  bottom\n    rectangle w=20 h=20\n  top\n    circle u=0 v=0 r=5";
    const v = vol(text);
    expect(v).toBeGreaterThan(20 * Math.PI * 25);
    expect(v).toBeLessThan(20 * 400);
    close(bounds(text), [-10, -10, 0, 10, 10, 20], 2);
  });
  test("an L shape can be lofted (the ends are cut into triangles)", () => {
    const text = "loft height=5\n  bottom\n    polygon\n      point u=0 v=0\n      point u=4 v=0\n      point u=4 v=1\n      point u=1 v=1\n      point u=1 v=4\n      point u=0 v=4\n  top\n    rectangle u=0 v=0 w=2 h=2";
    expect(run(text).problem).toBeUndefined();
    expect(vol(text)).toBeGreaterThan(0);
  });
  test("it lands on the plane it is asked to be on", () => {
    const text = "loft height=10 plane=XZ\n  bottom\n    rectangle w=10 h=10\n  top\n    rectangle w=10 h=10";
    const b = bounds(text);
    expect(b[4]).toBeCloseTo(0, 3); // XZ: the normal is -y, so it goes from y = 0 down to -10
    expect(b[1]).toBeCloseTo(-10, 3);
  });
  test("it says what is wrong", () => {
    expect(run("loft\n  bottom\n    rectangle").problem?.message).toMatch(/one bottom block and one top/);
    expect(run("loft\n  bottom\n    rectangle\n  top").problem?.message).toMatch(/inside the top/);
    expect(run("loft\n  bottom\n    rectangle\n    circle u=30 v=0 r=2\n  top\n    circle").problem?.message).toMatch(/single outline/);
    expect(run("loft\n  bottom\n    rectangle hole\n  top\n    circle").problem?.message).toMatch(/not a hole/);
    expect(run("loft\n  bottom\n    rectangle w=20 h=20\n    circle r=3 hole\n  top\n    circle").problem?.message).toMatch(/single outline with no holes/);
  });
  test("a new loft block works as it is", () => {
    const block = newBlockFor([], "loft");
    const r = runProgram(k, [block]);
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeGreaterThan(0);
  });
});

describe("sweep", () => {
  test("a circle along a straight path is a cylinder", () => {
    const text = "sweep\n  circle u=0 v=0 r=3\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=30";
    expect(vol(text) / (Math.PI * 9 * 30)).toBeCloseTo(1, 2);
    close(bounds(text), [-3, -3, 0, 3, 3, 30], 2);
  });
  test("along x the outline is seen with u across (y) and v up (z)", () => {
    const text = "sweep\n  rectangle w=2 h=4\n  vertex x=0 y=0 z=0\n  vertex x=10 y=0 z=0";
    close(bounds(text), [0, -1, -2, 10, 1, 2]);
    expect(vol(text)).toBeCloseTo(80, 3);
  });
  test("a bend keeps the width: an L path of a square bar has about the volume of both legs", () => {
    const text = "sweep\n  rectangle w=2 h=2\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=20\n  vertex x=20 y=0 z=20";
    // the legs 20 long each, 2 x 2: the mitre adds nothing and takes nothing for a right angle at the centreline
    expect(vol(text)).toBeCloseTo(4 * 40, 1);
  });
  test("a path that runs back on itself, or has a repeated point, is explained", () => {
    expect(run("sweep\n  circle u=0 v=0 r=1\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=10\n  vertex x=0 y=0 z=0").problem?.message).toMatch(/back on itself/);
    expect(run("sweep\n  circle u=0 v=0 r=1\n  vertex x=0 y=0 z=0\n  vertex x=0 y=0 z=0").problem?.message).toMatch(/same place/);
    expect(run("sweep\n  circle u=0 v=0 r=1\n  vertex x=0 y=0 z=0").problem?.message).toMatch(/at least 2/);
  });
  test("a new sweep block works as it is", () => {
    const r = runProgram(k, [newBlockFor([], "sweep")]);
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeGreaterThan(0);
  });
});

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

describe("size in a formula (measure)", () => {
  test("a lid is as wide as the box it fits, plus a margin", () => {
    const text = [
      "measure name=base",
      "  box w=40 d=30 h=10",
      "box w=base_w + 2 d=base_d + 2 h=3",
    ].join("\n");
    const r = run(text);
    expect(r.problem).toBeUndefined();
    expect(r.shapes[1].solid.bounds().max[0] * 2).toBeCloseTo(42, 3);
  });
});

describe("the new examples", async () => {
  const { DEMOS } = await import("../src/cadfly/language/demos");
  const byName = (n: string) => DEMOS.find((e) => e.name === n)!.program;
  test("name plate: the letters are cut into the plate", () => {
    const r = runProgram(k, byName("Name plate"));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeLessThan(70 * 20 * 3);
  });
  test("vase: 60 tall, a rounded square at the bottom", () => {
    const r = runProgram(k, byName("Vase"));
    expect(r.problem).toBeUndefined();
    const b = r.combined!.bounds();
    expect(b.max[2] - b.min[2]).toBeCloseTo(60, 3);
    expect(b.max[0] - b.min[0]).toBeCloseTo(30, 2);
  });
  test("pipe: follows its bends", () => {
    const r = runProgram(k, byName("Pipe"));
    expect(r.problem).toBeUndefined();
    const b = r.combined!.bounds();
    expect(b.max[2]).toBeGreaterThan(50);
    expect(b.max[1]).toBeGreaterThanOrEqual(30 - 1e-6);
  });
  test("tray and lid: the lid is 0.8 wider than the tray, sitting on top of it", () => {
    const r = runProgram(k, byName("Tray and lid"));
    expect(r.problem).toBeUndefined();
    const lid = r.shapes[1].solid.bounds();
    expect(lid.max[0] - lid.min[0]).toBeCloseTo(50.8, 3);
    expect(r.shapes[0].solid.bounds().max[2]).toBeLessThanOrEqual(lid.min[2] + 1e-6 + 15);
  });
});

describe("hollow and lettered examples", async () => {
  const { DEMOS } = await import("../src/cadfly/language/demos");
  const byName = (n: string) => DEMOS.find((e) => e.name === n)!.program;
  const solid = (n: string) => {
    const r = runProgram(k, byName(n));
    expect(r.problem, n).toBeUndefined();
    return r.combined!;
  };
  test("hollow vase: lighter than the solid vase, still 60 tall, and open at the top", () => {
    const hollow = solid("Hollow vase");
    expect(hollow.volume()).toBeLessThan(solid("Vase").volume() * 0.6);
    expect(hollow.bounds().max[2]).toBeCloseTo(60, 2);
    // open at the top: a thin slice of the top has a hole, so it has less than the full circle there
    expect(hollow.volume()).toBeGreaterThan(5000);
  });
  test("hollow pipe: the bore is open at both ends, and the walls are what is left", () => {
    const pipe = solid("Hollow pipe");
    const solidPipe = solid("Pipe");
    expect(pipe.volume() / solidPipe.volume()).toBeGreaterThan(0.3);
    expect(pipe.volume() / solidPipe.volume()).toBeLessThan(0.75); // (4^2 - 2.5^2) / 4^2 = 0.61
    expect(pipe.bounds().min[2]).toBeCloseTo(0, 2); // the extra length of the bore is not part of the pipe
  });
  test("etched text: the plate keeps its thickness and loses the letters' depth", () => {
    const etched = solid("Etched text");
    const plateVolume = solid("Raised text").volume() - 0; // the plate with letters on it, so only the bounds are compared
    expect(etched.bounds().max[2]).toBeCloseTo(3, 3);
    expect(etched.volume()).toBeLessThan(70 * 20 * 3);
    expect(etched.volume()).toBeGreaterThan(70 * 20 * 3 - 70 * 20 * 1);
    expect(plateVolume).toBeGreaterThan(etched.volume());
  });
  test("raised text: the letters stand up from the plate by raise", () => {
    const raised = solid("Raised text");
    expect(raised.bounds().max[2]).toBeCloseTo(4, 3);
    expect(raised.volume()).toBeGreaterThan(70 * 20 * 3 - 4 * 20 * 3);
  });
});

describe("a cone is a cylinder with a smaller top", () => {
  test("an empty top radius is a cylinder; a smaller one tapers; 0 makes a point; a larger one flares", () => {
    const v = (top: string) => vol(`cylinder r=6 top=${top} h=9`);
    expect(vol("cylinder r=6 h=9") / (Math.PI * 36 * 9)).toBeGreaterThan(0.99);
    expect(v("3") / ((Math.PI * 9 * (36 + 18 + 9)) / 3)).toBeGreaterThan(0.99); // a frustum
    expect(v("0") / ((Math.PI * 36 * 9) / 3)).toBeGreaterThan(0.99); // a cone
    expect(v("9")).toBeGreaterThan(vol("cylinder r=6 h=9"));
    expect(bounds("cylinder r=6 top=0 h=9")).toEqual(expect.arrayContaining([0, 9]));
  });
  test("it needs some radius, and a negative one is refused", () => {
    expect(run("cylinder r=0 top=0").problem!.message).toMatch(/cannot both be zero/);
    expect(run("cylinder r=3 top=-1").problem!.message).toMatch(/top radius: cannot be negative/);
    expect(() => run("cone")).toThrow(/there is no block called "cone"/);
  });
  test("it is a partly exposed field: First steps shows the radius and height, and more shows the top radius", () => {
    expect(shownParamIds("cylinder", "First steps")).toEqual(["r", "h"]);
    expect(shownParamIds("cylinder", "Starter")).toContain("top");
  });
});

const shownParamIds = (kind: string, mode: string) => shownParams(commandById(kind)!, modeByName(mode)!).filter((p) => p.type.kind !== "caption" && !["x", "y", "z"].includes(p.id)).map((p) => p.id);
