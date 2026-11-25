import { beforeAll, describe, expect, test } from "vitest";
import { systemPrompt } from "../src/cadfly/assistant/prompt";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { dropBlocks, takeOutOfHolder } from "../src/cadfly/language/edit";
import { validateProgram } from "../src/cadfly/language/format";
import { accepts, blocksToWrap, canHold, canHoldInScript, findBlock, pointListOf, pointLists } from "../src/cadfly/language/program";
import { runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";
import { acceptingPoints, layoutProgram } from "../src/cadfly/ui/layout";
import { blk } from "./helpers/blocks";
import { oneScript } from "./helpers/script-helpers";

/**
 * Making the points of an outline, a solid's corners and a sweep's path with
 * `repeat`, `if` and `set` blocks, from a formula: what they build, what is
 * allowed where, and how such blocks are dropped, wrapped and numbered.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** A point of a polygon */
const pt = (id: string, u: string, v: string) => blk(id, "point", { u, v });
/** A corner of a solid or a sweep's path */
const vx = (id: string, x: string, y: string, z: string) => blk(id, "vertex", { x, y, z });
/** A repeat, `times` passes, counting with `i` */
const rep = (id: string, times: string, inner: Block[], counter = "i") => blk(id, "repeat", { times, counter }, inner);
/** A polygon extruded 5 high */
const slab = (polygon: Block) => blk("e", "extrude", { height: "5" }, [polygon]);
/** Run blocks as the program's `build` */
const run = (...blocks: Block[]) => runProgram(k, oneScript(blocks));

/**
 * What running blocks as the program's `build` came to, read at once: the next
 * run frees the shapes of this one.
 */
const measure = (...blocks: Block[]) => {
  const result = run(...blocks);
  const shape = result.combined;
  return {
    problem: result.problem,
    volume: shape?.volume() ?? 0,
    bounds: shape?.bounds() ?? { min: [0, 0, 0], max: [0, 0, 0] },
    hullFaces: result.hullFaces,
    overlays: result.overlays,
  };
};

/** A number as text a field can hold: rounded, and never in scientific form */
const num = (value: number) => String(Math.round(value * 1e6) / 1e6);
/** The x and y of a point at this angle (degrees) and distance from the middle, as text */
const around = (degrees: number, radius: number): [string, string] => [num(radius * Math.cos((degrees * Math.PI) / 180)), num(radius * Math.sin((degrees * Math.PI) / 180))];

/** The corners of a regular hexagon of radius 10, written out */
const hexagon = [0, 60, 120, 180, 240, 300].map((deg, n) => pt(`h${n}`, ...around(deg, 10)));

describe("the points of a polygon made by blocks", () => {
  test("a repeat makes the same outline as the points written out", () => {
    const made = measure(slab(blk("p", "polygon", {}, [rep("r", "6", [pt("q", "10 * cos(i * 60)", "10 * sin(i * 60)")])])));
    const written = measure(slab(blk("p", "polygon", {}, hexagon)));
    expect(made.problem).toBeUndefined();
    expect(made.volume).toBeCloseTo(written.volume, 4);
    const [a, b] = [made.bounds, written.bounds];
    a.min.forEach((v, n) => expect(v).toBeCloseTo(b.min[n], 4));
    a.max.forEach((v, n) => expect(v).toBeCloseTo(b.max[n], 4));
  });

  test("a repeat inside a repeat makes every point, and the outer counter is still there inside", () => {
    // 3 teeth of 2 points each, around a circle: 6 points, one counter for the tooth and one for the point in it
    const nested = measure(slab(blk("p", "polygon", {}, [rep("r", "3", [rep("s", "2", [pt("q", "10 * cos(t * 120 + j * 60)", "10 * sin(t * 120 + j * 60)")], "j")], "t")])));
    const written = measure(slab(blk("p", "polygon", {}, hexagon)));
    expect(nested.problem).toBeUndefined();
    expect(nested.volume).toBeCloseTo(written.volume, 4);
  });

  test("an if chooses between the points of its branch and of its else", () => {
    // a ten-pointed star: even points far out, odd points near in
    const star = (arms: Block[]) => measure(slab(blk("p", "polygon", {}, arms)));
    const angle = "i * 36";
    const made = star([
      rep("r", "10", [
        blk("f", "if", { condition: "i % 2 == 0" }, [pt("a", `10 * cos(${angle})`, `10 * sin(${angle})`), blk("o", "else", {}, [pt("b", `4 * cos(${angle})`, `4 * sin(${angle})`)])]),
      ]),
    ]);
    const written = star(
      Array.from({ length: 10 }, (_, n) => {
        const radius = n % 2 === 0 ? 10 : 4;
        return pt(`w${n}`, ...around(n * 36, radius));
      }),
    );
    expect(made.problem).toBeUndefined();
    expect(made.volume).toBeCloseTo(written.volume, 4);
  });

  test("a set inside a repeat is there for the points after it in that pass, and gone after", () => {
    const square = measure(slab(blk("p", "polygon", {}, [rep("r", "4", [blk("s", "set", { name: "a", value: "i * 90 + 45" }), pt("q", "10 * cos(a)", "10 * sin(a)")])])));
    expect(square.problem).toBeUndefined();
    // a square with corners 10 from the middle has sides 10 * sqrt(2)
    expect(square.volume).toBeCloseTo(200 * 5, 4);
    const leaked = measure(slab(blk("p", "polygon", {}, [rep("r", "4", [blk("s", "set", { name: "a", value: "i * 90" }), pt("q", "10 * cos(a)", "10 * sin(a)")]), pt("z", "a", "0")])));
    expect(leaked.problem?.blockId).toBe("z");
  });

  test("the counter is gone after the repeat", () => {
    const result = measure(slab(blk("p", "polygon", {}, [rep("r", "3", [pt("q", "i * 5", "i * 5 + 1")]), pt("z", "i", "0")])));
    expect(result.problem?.blockId).toBe("z");
  });

  test("a problem in a point is reported on that point, wherever it is made", () => {
    const result = measure(slab(blk("p", "polygon", {}, [rep("r", "3", [pt("q", "i * 5", "nope")])])));
    expect(result.problem?.blockId).toBe("q");
    expect(result.problem?.message).toMatch(/nope/);
  });

  test("a repeat that is not a whole number of passes is reported on the repeat", () => {
    const result = measure(slab(blk("p", "polygon", {}, [rep("r", "2.5", [pt("q", "i", "i")])])));
    expect(result.problem?.blockId).toBe("r");
    expect(result.problem?.message).toMatch(/whole number/);
  });

  test("too few points, however they are made, is reported on the polygon", () => {
    const result = measure(slab(blk("p", "polygon", {}, [rep("r", "2", [pt("q", "i", "i")])])));
    expect(result.problem?.blockId).toBe("p");
    expect(result.problem?.message).toMatch(/at least three points/);
  });

  test("a repeat inside a repeat cannot run for ever: the program's limit on what it builds applies", () => {
    const result = measure(slab(blk("p", "polygon", {}, [rep("r", "1000", [rep("s", "1000", [blk("f", "if", { condition: "false" }, [pt("q", "0", "0")])], "j")])])));
    expect(result.problem?.blockId).toBe("p");
    expect(result.problem?.message).toMatch(/built more than/);
  });

  test("blocks that are not points or the blocks that make them are refused when a run meets them", () => {
    // the loader refuses this (see below), but a program can reach a run another way
    const result = measure(slab(blk("p", "polygon", {}, [blk("bx", "box", {})])));
    expect(result.problem?.blockId).toBe("bx");
  });
});

describe("the corners of a solid and the path of a sweep made by blocks", () => {
  /** A solid whose vertices are these blocks, and which has an empty faces section */
  const solid = (corners: Block[], faces: Block[] = [], show = false) => blk("sd", "solid", {}, [blk("vs", "vertices", { show }, corners), blk("fs", "faces", {}, faces)]);

  const squareBase = [45, 135, 225, 315].map((deg, n) => vx(`c${n}`, ...around(deg, 10), "0"));
  const apex = vx("ap", "0", "0", "20");

  test("a hull of repeated vertices has the volume of the hull of the same vertices written out", () => {
    const made = measure(solid([rep("r", "4", [vx("q", "10 * cos(i * 90 + 45)", "10 * sin(i * 90 + 45)", "0")]), apex]));
    const written = measure(solid([...squareBase, apex]));
    expect(made.problem).toBeUndefined();
    expect(made.volume).toBeCloseTo(written.volume, 2);
    // a square pyramid: a third of the base, 200, times its height
    expect(made.volume).toBeCloseTo((200 * 20) / 3, 3);
  });

  test("faces refer to the vertices in the order they were made", () => {
    const faces = [blk("f1", "face", { corners: "4 3 2 1" }), blk("f2", "face", { corners: "1 2 5" }), blk("f3", "face", { corners: "2 3 5" }), blk("f4", "face", { corners: "3 4 5" }), blk("f5", "face", { corners: "4 1 5" })];
    const made = measure(solid([rep("r", "4", [vx("q", "10 * cos(i * 90 + 45)", "10 * sin(i * 90 + 45)", "0")]), apex], faces));
    const written = measure(solid([...squareBase, apex], faces));
    expect(made.problem).toBeUndefined();
    expect(made.volume).toBeCloseTo(written.volume, 4);
  });

  test("a face that names a vertex that was not made is reported on the face", () => {
    const made = measure(solid([rep("r", "4", [vx("q", "i * 10", "0", "i % 2 * 10")]), apex], [blk("f1", "face", { corners: "1 2 9" })]));
    expect(made.problem?.blockId).toBe("f1");
  });

  test("the hull button's faces follow the vertices that were made", () => {
    const made = measure(solid([rep("r", "4", [vx("q", "10 * cos(i * 90 + 45)", "10 * sin(i * 90 + 45)", "0")]), apex]));
    const faces = made.hullFaces.fs;
    expect(faces).toBeDefined();
    // a square pyramid has five faces, and every vertex is used
    expect(faces).toHaveLength(5);
    expect(new Set(faces.flat())).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  test("shown corners are numbered in the order they were made, one dot for each", () => {
    const made = measure(solid([rep("r", "4", [vx("q", "10 * cos(i * 90 + 45)", "10 * sin(i * 90 + 45)", "0")]), apex], [], true));
    const dots = made.overlays.filter((o) => o.kind === "point");
    expect(dots.map((o) => (o.kind === "point" ? o.label : ""))).toEqual(["1", "2", "3", "4", "5"]);
  });

  test("a sweep's path can be made with a repeat, and the shape it carries can still be repeated", () => {
    const circle = blk("c", "circle", { r: "2" });
    const path = [vx("a", "0", "0", "0"), vx("b", "0", "0", "10"), vx("c2", "10", "0", "20")];
    const written = measure(blk("sw", "sweep", {}, [circle, ...path]));
    const made = measure(blk("sw", "sweep", {}, [circle, rep("r", "3", [vx("q", "max(0, (i - 1) * 10)", "0", "i * 10")])]));
    expect(made.problem).toBeUndefined();
    expect(made.volume).toBeCloseTo(written.volume, 4);
    // two circles side by side, made by a repeat, are still the shape that is swept
    const twins = [blk("c3", "circle", { r: "2", u: "0" }), blk("c4", "circle", { r: "2", u: "10" })];
    const twinMade = measure(blk("sw", "sweep", {}, [rep("rs", "2", [blk("c5", "circle", { r: "2", u: "i * 10" })]), ...path]));
    const twinWritten = measure(blk("sw", "sweep", {}, [...twins, ...path]));
    expect(twinMade.problem).toBeUndefined();
    expect(twinMade.volume).toBeCloseTo(twinWritten.volume, 3);
  });
});

describe("what may go where in a list of points", () => {
  test("a list of points is the blocks inside a polygon, a vertices section or a sweep, and inside the repeat and if blocks in it", () => {
    expect(pointListOf("polygon", null)).toBe("polygon");
    expect(pointListOf("vertices", null)).toBe("vertices");
    expect(pointListOf("sweep", null)).toBe("sweep");
    expect(pointListOf("repeat", "polygon")).toBe("polygon");
    expect(pointListOf("if", "vertices")).toBe("vertices");
    expect(pointListOf("else", "sweep")).toBe("sweep");
    // a repeat of shapes is not a list of points, and neither is a shape holder inside a point list
    expect(pointListOf("repeat", null)).toBeNull();
    expect(pointListOf("extrude", null)).toBeNull();
    expect(pointListOf("union", "sweep")).toBeNull();
  });

  test("a polygon takes points, repeat, if and set, and in a repeat of points nothing else", () => {
    for (const kind of ["point", "repeat", "if", "set"]) expect(accepts("polygon", kind, "polygon")).toBe(true);
    for (const kind of ["rectangle", "box", "vertex", "else"]) expect(accepts("polygon", kind, "polygon")).toBe(false);
    for (const kind of ["point", "repeat", "if", "set"]) expect(accepts("repeat", kind, "polygon")).toBe(true);
    for (const kind of ["rectangle", "box", "vertex", "circle", "union"]) expect(accepts("repeat", kind, "polygon")).toBe(false);
  });

  test("an else belongs inside an if, and holds points when the if is in a list of points", () => {
    expect(accepts("if", "else", "polygon")).toBe(true);
    expect(accepts("repeat", "else", "polygon")).toBe(false);
    expect(accepts("else", "point", "polygon")).toBe(true);
    expect(accepts("else", "box", "polygon")).toBe(false);
  });

  test("vertices and a sweep's path take vertices, and a repeat of vertices takes nothing else", () => {
    expect(accepts("vertices", "vertex", "vertices")).toBe(true);
    expect(accepts("repeat", "vertex", "vertices")).toBe(true);
    expect(accepts("repeat", "point", "vertices")).toBe(false);
    expect(accepts("repeat", "box", "vertices")).toBe(false);
    expect(accepts("sweep", "vertex", "sweep")).toBe(true);
    expect(accepts("repeat", "vertex", "sweep")).toBe(true);
  });

  test("a repeat inside a sweep may hold the flat shape it carries, as before", () => {
    expect(accepts("sweep", "circle", "sweep")).toBe(true);
    expect(accepts("repeat", "circle", "sweep")).toBe(true);
  });

  test("everywhere else a repeat holds what it always did", () => {
    expect(accepts("repeat", "box")).toBe(true);
    expect(accepts("repeat", "point")).toBe(false);
    expect(accepts("extrude", "polygon")).toBe(true);
    expect(accepts("polygon", "point")).toBe(true);
  });

  test("the loader accepts repeat, if, else and set among the points", () => {
    const polygon = blk("p", "polygon", {}, [pt("a", "0", "0"), rep("r", "3", [blk("s", "set", { name: "a", value: "i" }), blk("f", "if", { condition: "true" }, [pt("b", "i", "0"), blk("o", "else", {}, [pt("c", "0", "i")])])])]);
    expect(() => validateProgram(oneScript([slab(polygon)]))).not.toThrow();
    const vertices = blk("sd", "solid", {}, [blk("vs", "vertices", {}, [rep("r", "4", [vx("a", "i", "0", "0")])])]);
    expect(() => validateProgram(oneScript([vertices]))).not.toThrow();
    const sweep = blk("sw", "sweep", {}, [rep("rc", "2", [blk("c", "circle", {})]), rep("r", "3", [vx("a", "0", "0", "i")])]);
    expect(() => validateProgram(oneScript([sweep]))).not.toThrow();
  });

  test("the loader refuses shapes in a repeat of points, and points in a repeat of shapes", () => {
    const shapeInRepeat = blk("p", "polygon", {}, [rep("r", "3", [blk("bx", "box", {})])]);
    expect(() => validateProgram(oneScript([slab(shapeInRepeat)]))).toThrow(/box block cannot go inside a repeat block/);
    const vertexInPolygon = blk("p", "polygon", {}, [rep("r", "3", [vx("v", "0", "0", "0")])]);
    expect(() => validateProgram(oneScript([slab(vertexInPolygon)]))).toThrow(/vertex block cannot go inside a repeat block/);
    const pointInShapes = rep("r", "3", [pt("a", "0", "0")]);
    expect(() => validateProgram(oneScript([pointInShapes]))).toThrow(/point block cannot go inside a repeat block/);
  });

  test("a repeat of points cannot be at the top of a script, and an else only goes in an if", () => {
    expect(() => validateProgram(oneScript([rep("r", "3", [pt("a", "0", "0")])]))).toThrow();
    const looseElse = blk("p", "polygon", {}, [rep("r", "3", [blk("o", "else", {}, [])])]);
    expect(() => validateProgram(oneScript([slab(looseElse)]))).toThrow(/else block cannot go inside a repeat block/);
  });
});

describe("dropping, wrapping and taking out blocks in a list of points", () => {
  const polygon = () => blk("p", "polygon", {}, [pt("a", "0", "0"), pt("b", "10", "0"), pt("c", "0", "10")]);
  const program = () => oneScript([slab(polygon())]);

  test("a repeat dropped among the points wraps the points after it", () => {
    const wrapped = blocksToWrap(program(), { parentId: "p", index: 1 }, [rep("r", "3", [])]);
    expect(wrapped.map((b) => b.id)).toEqual(["b", "c"]);
    const after = dropBlocks(program(), { parentId: "p", index: 1 }, [rep("r", "3", [])]);
    const holder = findBlock(after, "r")!;
    expect(holder.parent?.id).toBe("p");
    expect((holder.block.inner ?? []).map((b) => b.id)).toEqual(["b", "c"]);
    expect(findBlock(after, "p")!.block.inner!.map((b) => b.id)).toEqual(["a", "r"]);
  });

  test("a repeat of shapes does not wrap shapes that are not in a list of points as points", () => {
    const shapes = oneScript([blk("e", "extrude", { height: "5" }, [blk("x", "rectangle", {}), blk("y", "circle", {})])]);
    expect(blocksToWrap(shapes, { parentId: "e", index: 0 }, [rep("r", "3", [])]).map((b) => b.id)).toEqual(["x", "y"]);
    // an empty polygon dropped among shapes does not wrap them (a polygon holds points, not shapes)
    expect(blocksToWrap(shapes, { parentId: "e", index: 0 }, [blk("pp", "polygon", {}, [])])).toEqual([]);
  });

  test("the points can be taken back out of a repeat by opening it", () => {
    const wrapped = dropBlocks(program(), { parentId: "p", index: 1 }, [rep("r", "3", [])]);
    const out = takeOutOfHolder(wrapped, "r");
    expect(findBlock(out, "r")).toBeUndefined();
    expect(findBlock(out, "p")!.block.inner!.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  test("the drop points inside a repeat of points take points, repeats and sets, and not shapes", () => {
    const withRepeat = oneScript([slab(blk("p", "polygon", {}, [rep("r", "3", [pt("a", "0", "0")])]))]);
    const layout = layoutProgram(withRepeat, { x: 1, y: 2, width: 8, measure: (t) => t.length * 0.1 });
    const holders = (kinds: string[]) => new Set(acceptingPoints(layout, withRepeat, kinds.map((k, i) => blk(`k${i}`, k))).map((d) => ("parentId" in d ? d.parentId : d.scriptId)));
    expect(holders(["point"])).toEqual(new Set(["p", "r"]));
    expect(holders(["repeat"])).toContain("r");
    expect(holders(["box"])).not.toContain("r");
    expect(holders(["box"])).not.toContain("p");
    expect(holders(["vertex"])).toEqual(new Set());
  });

  test("each block that holds blocks knows whether they are a list of points", () => {
    const lists = pointLists(oneScript([slab(blk("p", "polygon", {}, [rep("r", "3", [pt("a", "0", "0")])])), rep("shapes", "2", [blk("bx", "box", {})])]));
    expect(lists.get("p")).toBe("polygon");
    expect(lists.get("r")).toBe("polygon");
    expect(lists.get("shapes")).toBeNull();
    expect(lists.get("e")).toBeNull();
  });
});

describe("how blocks in a list of points are shown and described", () => {
  const measure = (t: string) => t.length * 0.1;
  const numbersIn = (section: Block) => {
    const program = oneScript([blk("sd", "solid", {}, [section])]);
    return layoutProgram(program, { x: 1, y: 2, width: 8, measure }).blocks.filter((b) => b.block.kind === "vertex" && b.parts.some((p) => p.kind === "number")).length;
  };

  test("vertices are numbered by their place, until a repeat or if can make some of them", () => {
    expect(numbersIn(blk("vs", "vertices", {}, [vx("a", "0", "0", "0"), vx("b", "1", "0", "0")]))).toBe(2);
    expect(numbersIn(blk("vs", "vertices", {}, [vx("a", "0", "0", "0"), rep("r", "2", [vx("b", "i", "0", "0")])]))).toBe(0);
    expect(numbersIn(blk("vs", "vertices", {}, [rep("r", "2", [vx("a", "i", "0", "0"), vx("b", "i", "1", "0")])]))).toBe(0);
  });

  test("a repeat in a list of points is drawn like a repeat anywhere: it holds its points", () => {
    const program = oneScript([slab(blk("p", "polygon", {}, [rep("r", "3", [pt("a", "0", "0")])]))]);
    const layout = layoutProgram(program, { x: 1, y: 2, width: 8, measure });
    const [outer, repeat, inner] = ["p", "r", "a"].map((id) => layout.blocks.find((b) => b.block.id === id)!);
    expect(repeat.bounds.y).toBeGreaterThan(outer.bounds.y);
    expect(inner.bounds.x).toBeGreaterThan(repeat.bounds.x);
    expect(repeat.footer).toBeDefined();
  });

  test("the instructions to the assistant say that a list of points can be made by repeat, if and set", () => {
    const lines = systemPrompt().split("\n");
    const lineFor = (id: string) => lines.find((l) => l.startsWith(`- ${id}`) || l.startsWith(`- ${id} `)) ?? "";
    expect(lineFor("polygon")).toMatch(/Holds point; repeat\/if\/set make them/);
    expect(lineFor("vertices")).toMatch(/Holds vertex; repeat\/if\/set make them/);
    // a sweep already says it holds vertex points, and repeats and ifs of the shape it carries
    expect(lineFor("sweep")).toMatch(/Holds flat shapes and vertex points/);
  });
});

describe("whether blocks, and what is inside them, fit a place", () => {
  /** A `build` script, which takes any block that is not a piece of another. */
  const script = oneScript([])[0];
  /** A repeat that makes shapes. */
  const ofShapes = rep("r1", "2", [blk("b1", "box", {})]);
  /** A repeat that makes points. */
  const ofPoints = rep("r2", "2", [pt("p1", "0", "0")]);
  /** A repeat with nothing in it yet, which can be either. */
  const empty = rep("r3", "2", []);

  test("a repeat of points fits among points and nowhere else", () => {
    expect(canHold([ofPoints], "polygon", "polygon")).toBe(true);
    expect(canHold([ofPoints], "union", null)).toBe(false);
    expect(canHoldInScript([ofPoints], script)).toBe(false);
  });

  test("a repeat of shapes fits among shapes and not among points", () => {
    expect(canHold([ofShapes], "union", null)).toBe(true);
    expect(canHoldInScript([ofShapes], script)).toBe(true);
    expect(canHold([ofShapes], "polygon", "polygon")).toBe(false);
    expect(canHold([ofShapes], "vertices", "vertices")).toBe(false);
  });

  test("a repeat with nothing in it fits wherever a repeat does, since the place decides what it holds", () => {
    expect(canHold([empty], "polygon", "polygon")).toBe(true);
    expect(canHold([empty], "union", null)).toBe(true);
    expect(canHoldInScript([empty], script)).toBe(true);
  });

  test("what is deeper counts: a repeat inside a repeat, and an if with an else", () => {
    const nested = rep("r4", "2", [rep("r5", "3", [vx("v1", "0", "0", "0")])]);
    expect(canHold([nested], "vertices", "vertices")).toBe(true);
    expect(canHold([nested], "union", null)).toBe(false);
    const branches = blk("i1", "if", { condition: "true" }, [pt("p2", "0", "0"), blk("e1", "else", {}, [pt("p3", "1", "1")])]);
    expect(canHold([branches], "polygon", "polygon")).toBe(true);
    expect(canHoldInScript([branches], script)).toBe(false);
    const mixed = rep("r6", "2", [blk("b2", "box", {}), pt("p4", "0", "0")]);
    expect(canHold([mixed], "polygon", "polygon")).toBe(false);
    expect(canHold([mixed], "union", null)).toBe(false);
  });

  test("a plain block fits the places its kind fits", () => {
    expect(canHold([pt("p5", "0", "0")], "polygon", "polygon")).toBe(true);
    expect(canHold([pt("p5", "0", "0")], "union", null)).toBe(false);
    expect(canHold([blk("b3", "box", {})], "polygon", "polygon")).toBe(false);
    expect(canHoldInScript([blk("b3", "box", {})], script)).toBe(true);
  });

  test("the drop points offered for a repeat follow what it holds", () => {
    const program = oneScript([slab(blk("p", "polygon", {}, [pt("a", "0", "0")])), blk("u", "union", {}, [blk("b9", "box", {})])]);
    const layout = layoutProgram(program, { x: 1, y: 2, width: 8, measure: (t) => t.length * 0.1 });
    /** The holders that would take these blocks, by id, and the scripts. */
    const places = (carried: Block[]) => new Set(acceptingPoints(layout, program, carried).map((d) => ("parentId" in d ? d.parentId : d.scriptId)));
    expect(places([ofPoints]).has("p")).toBe(true);
    expect(places([ofPoints]).has("u")).toBe(false);
    expect(places([ofPoints]).has("s1")).toBe(false);
    expect(places([ofShapes]).has("p")).toBe(false);
    expect(places([ofShapes]).has("u")).toBe(true);
    expect(places([ofShapes]).has("s1")).toBe(true);
    expect(places([empty]).has("p")).toBe(true);
    expect(places([empty]).has("u")).toBe(true);
  });

  test("a repeat is wrapped around the blocks after it only if they belong inside it", () => {
    const program = oneScript([slab(blk("p", "polygon", {}, [pt("a", "0", "0"), pt("b", "1", "0")]))]);
    expect(blocksToWrap(program, { parentId: "p", index: 0 }, [rep("w", "2", [])]).map((b) => b.id)).toEqual(["a", "b"]);
    const shapes = oneScript([blk("u", "union", {}, [blk("b9", "box", {})])]);
    expect(blocksToWrap(shapes, { parentId: "u", index: 0 }, [rep("w", "2", [])]).map((b) => b.id)).toEqual(["b9"]);
  });
});
