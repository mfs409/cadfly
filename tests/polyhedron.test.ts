import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, Vec3 } from "../src/cadfly/geometry/kernel";
import { PolyhedronError, hullFaces, parseCorners, polyhedronMesh, polyhedronSolid } from "../src/cadfly/geometry/polyhedron";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { applyOps } from "../src/cadfly/assistant/ops";
import { runProgram } from "../src/cadfly/language/run";
import { commandById } from "../src/cadfly/language/commands";
import { fillFaces, newBlockFor } from "../src/cadfly/language/edit";
import { hit, layoutProgram } from "../src/cadfly/language/layout";
import type { Block } from "../src/cadfly/language/types";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const PYRAMID: Vec3[] = [[-20, -20, 0], [20, -20, 0], [20, 20, 0], [-20, 20, 0], [0, 0, 25]];
const PYRAMID_V = (40 * 40 * 25) / 3;
// every face counter-clockwise seen from outside
const FACES = [[1, 4, 3, 2], [1, 2, 5], [2, 3, 5], [3, 4, 5], [4, 1, 5]];
const volume = (points: Vec3[], faces: number[][]) => k.fromMesh(polyhedronMesh(points, faces)).volume();
const flipped = (faces: number[][], which: number[]) => faces.map((f, i) => (which.includes(i) ? [...f].reverse() : f));
const message = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PolyhedronError);
    return (e as Error).message;
  }
  throw new Error("expected an error");
};

describe("a solid from points and faces", () => {
  test("a pyramid is 5 points and 5 faces", () => {
    expect(volume(PYRAMID, FACES)).toBeCloseTo(PYRAMID_V, 3);
  });

  test("faces may be listed in either direction, mixed, or all reversed", () => {
    for (const which of [[0], [1, 3], [0, 1, 2, 3, 4], [2]]) expect(volume(PYRAMID, flipped(FACES, which)), `flip ${which}`).toBeCloseTo(PYRAMID_V, 3);
  });

  test("starting a face at a different corner makes no difference", () => {
    const rotated = FACES.map((f) => [...f.slice(1), f[0]]);
    expect(volume(PYRAMID, rotated)).toBeCloseTo(PYRAMID_V, 3);
  });

  test("a cube from six square faces", () => {
    const cube: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], [0, 0, 10], [10, 0, 10], [10, 10, 10], [0, 10, 10]];
    const faces = [[1, 2, 3, 4], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]];
    expect(volume(cube, faces)).toBeCloseTo(1000, 3);
  });

  test("a face that is not convex (an L shape) is cut into triangles", () => {
    // an L-shaped prism: 6 corners below, 6 above
    const L: [number, number][] = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
    const pts: Vec3[] = [...L.map(([x, y]) => [x, y, 0] as Vec3), ...L.map(([x, y]) => [x, y, 5] as Vec3)];
    const faces = [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], ...L.map((_, i) => [i + 1, ((i + 1) % 6) + 1, ((i + 1) % 6) + 7, i + 7])];
    expect(volume(pts, faces)).toBeCloseTo(300 * 5, 3);
  });

  test("the vertex numbers are read from text", () => {
    expect(parseCorners("1 2 3 4")).toEqual([1, 2, 3, 4]);
    expect(parseCorners("1, 2,3")).toEqual([1, 2, 3]);
    expect(() => parseCorners("1 two 3")).toThrow(/vertex numbers/);
    expect(() => parseCorners("1.5 2 3")).toThrow(/vertex numbers/);
  });
});

describe("what is wrong is said in plain words", () => {
  test("a missing face leaves a gap", () => {
    expect(message(() => polyhedronMesh(PYRAMID, FACES.slice(0, 4)))).toMatch(/belongs to only face .*gap/);
  });
  test("a vertex that does not exist", () => {
    expect(message(() => polyhedronMesh(PYRAMID, [...FACES.slice(0, 4), [4, 1, 9]]))).toMatch(/face 5 uses vertex 9.*1 to 5/);
  });
  test("too few vertices or faces", () => {
    expect(message(() => polyhedronMesh(PYRAMID.slice(0, 3), FACES))).toMatch(/at least 4 vertices/);
    expect(message(() => polyhedronMesh(PYRAMID, FACES.slice(0, 3)))).toMatch(/at least 4 faces/);
  });
  test("a vertex used twice in a face", () => {
    expect(message(() => polyhedronMesh(PYRAMID, [[1, 2, 2], ...FACES.slice(1)]))).toMatch(/face 1 lists a vertex twice/);
  });
  test("a face of four points that are not flat", () => {
    const bent: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 4], [0, 10, 0], [5, 5, 10]];
    const faces = [[1, 4, 3, 2], [1, 2, 5], [2, 3, 5], [3, 4, 5], [4, 1, 5]];
    expect(message(() => polyhedronMesh(bent, faces))).toMatch(/face 1 is not flat/);
  });
  test("two separate pieces", () => {
    const two: Vec3[] = [...PYRAMID, ...PYRAMID.map(([x, y, z]) => [x + 100, y, z] as Vec3)];
    const faces = [...FACES, ...FACES.map((f) => f.map((v) => v + 5))];
    expect(message(() => polyhedronMesh(two, faces))).toMatch(/more than one separate piece/);
  });
  test("all points in one plane", () => {
    const flat: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    expect(message(() => polyhedronMesh(flat, [[1, 2, 3], [1, 3, 4], [1, 3, 2], [1, 4, 3]]))).toMatch(/no volume|shared by|only face/);
  });
});

describe("hull", () => {
  test("a pyramid is the hull of its 5 points", () => {
    expect(k.hull(PYRAMID).volume()).toBeCloseTo(PYRAMID_V, 3);
  });
  test("points in one plane enclose nothing", () => {
    expect(() => k.hull([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]])).toThrow(/one plane/);
  });
});

describe("the solid block: a hull of its vertices, or a polyhedron when it has faces", () => {
  const build = (ops: unknown[]) => applyOps([], ops as never).program;
  const vertex = ([x, y, z]: (string | number)[]) => ({ kind: "vertex", args: { x: String(x), y: String(y), z: String(z) } });
  const face = (corners: number[]) => ({ kind: "face", args: { corners: corners.join(" ") } });
  /** A solid block as block data: the vertices section, and a faces section (empty for a hull) */
  const solid = (points: (string | number)[][], faces: number[][] = [], name = "pyramid") => ({ kind: "solid", args: { name }, inner: [{ kind: "vertices", inner: points.map(vertex) }, { kind: "faces", inner: faces.map(face) }] });
  const make = (block: unknown) => build([{ op: "append", blocks: [block] }]);
  const base = [[-20, -20, 0], [20, -20, 0], [20, 20, 0], [-20, 20, 0], [0, 0, 25]];

  test("with no faces it is the smallest convex solid around its vertices: the pyramid", () => {
    const r = runProgram(k, make(solid(base)));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(PYRAMID_V, 3);
    expect(r.combined!.bounds().max[2]).toBeCloseTo(25);
  });

  test("vertex values can use variables and arithmetic", () => {
    const program = build([
      { op: "append", blocks: [{ kind: "set", args: { name: "side", value: "40" } }] },
      { op: "append", blocks: [solid([["-side/2", "-side/2", "0"], ["side/2", "-side/2", "0"], ["side/2", "side/2", "0"], ["-side/2", "side/2", "0"], ["0", "0", "side*0.625"]])] },
    ]);
    expect(runProgram(k, program).combined!.volume()).toBeCloseTo(PYRAMID_V, 3);
  });

  test("with faces it is exactly those faces, written in any direction", () => {
    const r = runProgram(k, make(solid(PYRAMID, flipped(FACES, [1, 4]))));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(PYRAMID_V, 3);
  });

  test("faces make it exact, where a hull would fill in: a notched shape is only possible with faces", () => {
    // the L shape: a hull of its points would fill the corner in; its faces keep it
    const L: number[][] = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
    const pts = [...L.map(([x, y]) => [x, y, 0]), ...L.map(([x, y]) => [x, y, 5])];
    const faces = [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12], ...L.map((_, i) => [i + 1, ((i + 1) % 6) + 1, ((i + 1) % 6) + 7, i + 7])];
    const exact = runProgram(k, make(solid(pts, faces, "L"))).combined!.volume();
    const hull = runProgram(k, make(solid(pts, [], "L"))).combined!.volume();
    expect(exact).toBeCloseTo(300 * 5, 3);
    expect(hull).toBeGreaterThan(exact + 100);
  });

  test("problems point at the right block and say what is wrong", () => {
    const few = make(solid([[0, 0, 0]]));
    const r = runProgram(k, few);
    expect(r.problem?.message).toMatch(/at least 4 vertex blocks/);
    expect(few[0].inner![0].id).toBe(r.problem!.blockId); // the vertices section

    const bad = make(solid(PYRAMID, [[1, 2, 9]]));
    const problem = runProgram(k, bad).problem!;
    expect(problem.message).toMatch(/vertex 9 does not exist.*1 to 5/);
    const found = bad[0].inner![1].inner![0];
    expect(problem.blockId).toBe(found.id); // the face block, not the whole solid

    expect(runProgram(k, make(solid(PYRAMID, FACES.slice(0, 4)))).problem?.message).toMatch(/gap/);
  });

  test("a solid has one vertices section and at most one faces section", () => {
    const none = applyOps([], [{ op: "append", blocks: [{ kind: "solid", inner: [{ kind: "faces" }] }] }] as never).program;
    expect(runProgram(k, none).problem?.message).toMatch(/needs one vertices section/);
    const twice = applyOps([], [{ op: "append", blocks: [{ kind: "solid", inner: [{ kind: "vertices", inner: base.map(vertex) }, { kind: "faces" }, { kind: "faces" }] }] }] as never).program;
    expect(runProgram(k, twice).problem?.message).toMatch(/only one faces section/);
  });

  test("a vertex or face cannot sit outside a solid, a vertex only goes in a vertices section, and a face in a faces section", () => {
    expect(() => build([{ op: "append", blocks: [{ kind: "vertex", args: {} }] }])).toThrow();
    expect(() => build([{ op: "append", blocks: [{ kind: "solid", inner: [{ kind: "vertex" }] }] }])).toThrow(/vertex block cannot go inside a solid block/);
    expect(() => build([{ op: "append", blocks: [{ kind: "solid", inner: [{ kind: "faces", inner: [{ kind: "vertex" }] }] }] }])).toThrow(/vertex block cannot go inside a faces block/);
  });

  test("a new solid starts as a pyramid with an empty faces section, and a vertex shows its number", () => {
    const block = newBlockFor([], "solid");
    expect(block.inner!.map((b) => b.kind)).toEqual(["vertices", "faces"]);
    expect(block.inner![0].inner).toHaveLength(5);
    const r = runProgram(k, [block]);
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeGreaterThan(0);
    const l = layoutProgram([block], { x: 0, y: 0, width: 8, measure: (t) => t.length * 0.1 });
    const numbers = l.blocks.filter((b) => b.block.kind === "vertex").map((b) => b.parts.find((p) => p.kind === "number")!.text);
    expect(numbers).toEqual(["1", "2", "3", "4", "5"]);
    // the sections are not offered in the palette: they come with the solid
    expect(commandById("vertices")!.automatic).toBe(true);
    expect(commandById("faces")!.automatic).toBe(true);
  });
});

describe("the solid examples", async () => {
  const { DEMOS } = await import("../src/cadfly/language/demos");
  const run = (name: string) => runProgram(k, DEMOS.find((e) => e.name === name)!.program);
  test("the pyramid is a hull of 5 points, and follows its variables", () => {
    const r = run("Pyramid");
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo((40 * 40 * 25) / 3, 3);
    const wider = structuredClone(DEMOS.find((e) => e.name === "Pyramid")!.program);
    wider[0].args.value = "60";
    expect(runProgram(k, wider).combined!.volume()).toBeCloseTo((60 * 60 * 25) / 3, 3);
  });
  test("the house is exactly its 7 faces: walls 30 by 20 by 20 under a gable roof 10 high", () => {
    const r = run("House");
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(30 * 20 * 20 + (20 * 10 * 30) / 2, 3);
    // a face taken out leaves a gap, which it says
    const open = structuredClone(DEMOS.find((e) => e.name === "House")!.program);
    open[2].inner![1].inner!.pop();
    expect(runProgram(k, open).problem?.message).toMatch(/gap/);
  });
});

describe("the sections of a solid, and the ends of a loft, are fixed parts", () => {
  const solid = () => applyOps([], [{ op: "append", blocks: "solid\n  vertices\n    vertex\n    vertex x=10\n    vertex y=10\n    vertex z=10\n  faces" }]).program;
  test("the assistant cannot remove, wrap or unwrap one, but can change what is inside", () => {
    const p = solid();
    const vertices = p[0].inner![0].id;
    const faces = p[0].inner![1].id;
    expect(() => applyOps(p, [{ op: "delete", block: faces }])).toThrow(/faces block is a part of its solid and cannot be removed/);
    expect(() => applyOps(p, [{ op: "wrap", blocks: [vertices], holder: "transform" }])).toThrow(/cannot be wrapped/);
    expect(() => applyOps(p, [{ op: "unwrap", block: vertices }])).toThrow(/cannot be taken out/);
    expect(applyOps(p, [{ op: "delete", block: p[0].inner![0].inner![3].id }]).program[0].inner![0].inner).toHaveLength(3); // a vertex can go
    expect(applyOps(p, [{ op: "insert_into", block: faces, blocks: "face corners=\"1 2 3\"" }]).program[0].inner![1].inner).toHaveLength(1);
  });
  test("they are marked automatic: not in the palette, and the ends of a loft too", () => {
    for (const kind of ["vertices", "faces", "bottom", "top"]) expect(commandById(kind)!.automatic, kind).toBe(true);
    expect(commandById("else")!.automatic).toBeFalsy(); // an else is optional: it can be taken out
    expect(commandById("vertex")!.automatic).toBeFalsy();
  });
});

describe("faces are taken in the order given, and a mistake points at the face", () => {
  const solidOf = (faces: string[]) => applyOps([], [{ op: "append", blocks: `solid\n  vertices\n${PYRAMID.map(([x, y, z]) => `    vertex x=${x} y=${y} z=${z}`).join("\n")}\n  faces\n${faces.map((f) => `    face "${f}"`).join("\n")}` }]).program;
  const run = (p: ReturnType<typeof solidOf>) => runProgram(k, p);

  test("a square face listed round its edge is fine in either direction; listed across (a bow tie) it is refused, at that face", () => {
    for (const base of ["1 2 3 4", "4 3 2 1", "2 3 4 1"]) expect(run(solidOf([base, "1 2 5", "2 3 5", "3 4 5", "4 1 5"])).problem, base).toBeUndefined();
    const crossed = solidOf(["1 3 2 4", "1 2 5", "2 3 5", "3 4 5", "4 1 5"]);
    const r = run(crossed);
    expect(r.problem!.message).toMatch(/face 1 crosses itself|not flat|gap|agree/);
  });

  test("a notched face (an L) is taken as listed, so it works", () => {
    const L: number[][] = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
    const pts = [...L.map(([x, y]) => [x, y, 0]), ...L.map(([x, y]) => [x, y, 5])];
    const faces = ["1 2 3 4 5 6", "7 8 9 10 11 12", ...L.map((_, i) => `${i + 1} ${((i + 1) % 6) + 1} ${((i + 1) % 6) + 7} ${i + 7}`)];
    const text = `solid\n  vertices\n${pts.map(([x, y, z]) => `    vertex x=${x} y=${y} z=${z}`).join("\n")}\n  faces\n${faces.map((f) => `    face "${f}"`).join("\n")}`;
    expect(runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program).combined!.volume()).toBeCloseTo(300 * 5, 3);
  });

  test("a problem with a face is pointed at that face, not at the whole solid", () => {
    const p = solidOf(["1 2 3 9", "1 2 5", "2 3 5", "3 4 5", "4 1 5"]);
    expect(run(p).problem!.blockId).toBe(p[0].inner![1].inner![0].id);
    // and an edge with a gap is pointed at one of the faces that has it
    const gap = solidOf(["1 2 3 4", "1 2 5", "2 3 5", "3 4 5"]);
    const g = run(gap);
    expect(g.problem!.message).toMatch(/gap/);
    expect(gap[0].inner![1].inner!.map((f) => f.id)).toContain(g.problem!.blockId);
  });
});

describe("the star example needs its faces", async () => {
  const { DEMOS } = await import("../src/cadfly/language/demos");
  const star = () => structuredClone(DEMOS.find((e) => e.name === "Star")!.program);
  test("it is a closed solid of volume 4 core squared times tip: 8000 for core 10 and tip 20", () => {
    const r = runProgram(k, star());
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(8000, 2);
    expect(r.combined!.bounds().max[0]).toBeCloseTo(20, 3);
  });
  test("a hull of the same points fills it in: much more than the star", () => {
    const hull = star();
    hull[2].inner = [hull[2].inner![0]]; // the vertices section only (index 2 is the solid after the two set blocks)
    const filled = runProgram(k, hull);
    expect(filled.problem).toBeUndefined();
    expect(filled.combined!.volume()).toBeGreaterThan(30000); // about the cube around it
  });
  test("it follows its variables", () => {
    const p = star();
    p[0].args.value = "5";
    p[1].args.value = "30";
    expect(runProgram(k, p).combined!.volume()).toBeCloseTo(4 * 25 * 30, 2);
  });
  test("taking a face out leaves a gap, at one of the faces that has the edge", () => {
    const p = star();
    p[2].inner![1].inner!.pop();
    const r = runProgram(k, p);
    expect(r.problem!.message).toMatch(/gap/);
    expect(p[2].inner![1].inner!.map((f) => f.id)).toContain(r.problem!.blockId);
  });
  test("neither the points nor the faces are shown by default; the ticks are views only", () => {
    const r = runProgram(k, star());
    expect(r.overlays).toHaveLength(0);
    const on = star();
    on[2].inner![0].args.show = true;
    on[2].inner![1].args.show = true;
    const shown = runProgram(k, on).overlays;
    expect(shown.filter((o) => o.kind === "point")).toHaveLength(14);
    expect(shown.filter((o) => o.kind === "face")).toHaveLength(24);
    expect(commandById("vertices")!.viewOnly).toEqual(["show"]);
    expect(commandById("faces")!.viewOnly).toEqual(["show"]);
  });
  test("a transform moves the points and faces that were drawn, and a hidden block takes them away", () => {
    const p = star();
    p[2].inner![0].args.show = true;
    const moved: typeof p = [p[0], p[1], { id: "t", kind: "transform", args: { x: "100", rz: "90" }, inner: [p[2]] }];
    const r = runProgram(k, moved);
    const tip = r.overlays.find((o) => o.kind === "point" && o.label === "1")!; // (core, 0, 0): turned a quarter to (0, core, 0), then moved
    expect(tip.kind === "point" && tip.at.map((v) => Math.round(v))).toEqual([100, 10, 0]);
    const hidden = structuredClone(moved);
    hidden[2].hidden = true;
    expect(runProgram(k, hidden).overlays).toHaveLength(0);
  });
});

describe("labels on the blocks", () => {
  test("vertices are numbered 1, 2, 3 and faces f1, f2, f3, in their blocks, and the toggle on each section says show labels", () => {
    const p = applyOps([], [{ op: "append", blocks: "solid\n  vertices\n    vertex\n    vertex\n    vertex\n    vertex\n  faces\n    face \"1 2 3\"\n    face \"1 2 4\"\n    face \"2 3 4\"\n    face \"1 3 4\"" }]).program;
    const l = layoutProgram(p, { x: 0, y: 0, width: 8, measure: (t) => t.length * 0.1 });
    const badges = (kind: string) => l.blocks.filter((b) => b.block.kind === kind).map((b) => b.parts.find((x) => x.kind === "number")!.text);
    expect(badges("vertex")).toEqual(["1", "2", "3", "4"]);
    expect(badges("face")).toEqual(["f1", "f2", "f3", "f4"]);
    for (const kind of ["vertices", "faces"]) expect(commandById(kind)!.params[0].label).toBe("show labels");
    for (const kind of ["vertices", "faces"]) expect(commandById(kind)!.params[0].default, kind).toBe(false); // both start off
  });
});

describe("the examples list every face counterclockwise from outside (so the outside is the solid side in the view)", async () => {
  const { DEMOS } = await import("../src/cadfly/language/demos");
  for (const [name, centre] of [["Star", [0, 0, 0]], ["House", [0, 0, 10]]] as const) {
    test(`${name}: every face's normal points away from the middle`, () => {
      const program = structuredClone(DEMOS.find((e) => e.name === name)!.program);
      program.flatMap((b) => b.inner ?? []).filter((b) => b.kind === "faces").forEach((b) => (b.args.show = true)); // the faces are drawn only when shown
      const r = runProgram(k, program);
      expect(r.problem).toBeUndefined();
      const faces = r.overlays.filter((o) => o.kind === "face");
      expect(faces.length).toBeGreaterThan(0);
      for (const o of faces) {
        if (o.kind !== "face") continue;
        // Newell's normal of the ring, and the direction from the middle of the solid to the middle of the face
        const n = [0, 0, 0];
        o.ring.forEach((a, i) => {
          const b = o.ring[(i + 1) % o.ring.length];
          n[0] += (a[1] - b[1]) * (a[2] + b[2]);
          n[1] += (a[2] - b[2]) * (a[0] + b[0]);
          n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        });
        const mid = [0, 1, 2].map((i) => o.ring.reduce((t, p) => t + p[i], 0) / o.ring.length - centre[i]);
        expect(n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2], `${name} ${o.label}`).toBeGreaterThan(0);
      }
    });
  }
});

describe("the hull button: an empty faces section can be filled with what the hull is made of", () => {
  const hullOf = (points: [number, number, number][]) => hullFaces(points, k.hull(points).mesh());
  test("a pyramid's hull is 5 faces: the square base is one face, not two triangles", () => {
    const faces = hullOf(PYRAMID as [number, number, number][]);
    expect(faces).toHaveLength(5);
    expect(faces.map((f) => f.length).sort()).toEqual([3, 3, 3, 3, 4]);
    expect(faces.find((f) => f.length === 4)!.slice().sort()).toEqual([1, 2, 3, 4]);
  });
  test("a cube's hull is its 6 square faces, each going round (not across)", () => {
    const cube: [number, number, number][] = [0, 1].flatMap((z) => [0, 1].flatMap((y) => [0, 1].map((x) => [x * 10, y * 10, z * 10] as [number, number, number])));
    const faces = hullOf(cube);
    expect(faces).toHaveLength(6);
    for (const f of faces) expect(f).toHaveLength(4);
  });
  test("a point inside the hull is not a corner of it, and is left out", () => {
    const faces = hullOf([...(PYRAMID as [number, number, number][]), [0, 0, 5]]);
    expect(faces.flat()).not.toContain(6);
  });
  test("the faces it gives make the same solid as the hull, and every one is counterclockwise from outside", () => {
    const pts = PYRAMID as [number, number, number][];
    const faces = hullOf(pts);
    expect(volume(pts, faces)).toBeCloseTo(PYRAMID_V, 3);
    const mid = [0, 1, 2].map((i) => pts.reduce((t, p) => t + p[i], 0) / pts.length);
    for (const f of faces) {
      const ring = f.map((v) => pts[v - 1]);
      const n = [0, 0, 0];
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      });
      const c = [0, 1, 2].map((i) => ring.reduce((t, p) => t + p[i], 0) / ring.length - mid[i]);
      expect(n[0] * c[0] + n[1] * c[1] + n[2] * c[2]).toBeGreaterThan(0);
    }
  });
  test("the run offers them for an empty faces section; the button shows only while it is empty; filling it makes an editable polyhedron", () => {
    const p = newBlockFor([], "solid");
    const run0 = runProgram(k, [p]);
    const facesId = p.inner![1].id;
    expect(run0.hullFaces[facesId]).toHaveLength(5);
    const lay = (prog: Parameters<typeof runProgram>[1]) => layoutProgram(prog, { x: 0, y: 0, width: 8, measure: (t) => t.length * 0.1 });
    const facesBlock = (prog: Parameters<typeof runProgram>[1]) => lay(prog).blocks.find((b) => b.block.kind === "faces")!;
    const button = facesBlock([p]).parts.find((x) => x.kind === "button")!;
    expect(button.text).toBe("hull");
    expect(hit(lay([p]), button.rect.x + button.rect.w / 2, button.rect.y + button.rect.h / 2)).toEqual({ kind: "button", blockId: facesId, id: "hull" });
    const filled = fillFaces([p], facesId, run0.hullFaces[facesId]);
    expect(facesBlock(filled).parts.some((x) => x.kind === "button")).toBe(false);
    const r = runProgram(k, filled);
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(run0.combined!.volume(), 3); // the same solid, now from faces
    expect(filled[0].inner![1].inner!.map((f) => f.kind)).toEqual(["face", "face", "face", "face", "face"]);
    // one face taken out: the solid says so and points at a face
    const broken = structuredClone(filled);
    broken[0].inner![1].inner!.pop();
    expect(runProgram(k, broken).problem!.message).toMatch(/gap/);
  });
});

describe("building the solid in the kernel", () => {
  const faces = [[1, 2, 3, 4], [1, 2, 5], [2, 3, 5], [3, 4, 5], [4, 1, 5]];

  test("a pyramid from its points and faces is a solid of the right volume", () => {
    expect(polyhedronSolid(k, PYRAMID, faces).volume()).toBeCloseTo(PYRAMID_V, 3);
  });

  test("what is wrong with the faces is said in the faces' own words", () => {
    expect(() => polyhedronSolid(k, PYRAMID, faces.slice(0, 4))).toThrow(PolyhedronError);
  });

  test("if the kernel refuses what the faces make, the message is about the faces", () => {
    const refusing = { ...k, fromMesh: () => { throw new Error("this STL is not a closed solid"); } } as Kernel;
    expect(() => polyhedronSolid(refusing, PYRAMID, faces)).toThrow(/the faces do not make a valid solid/);
    expect(() => polyhedronSolid(refusing, PYRAMID, faces)).not.toThrow(/STL/);
  });
});
