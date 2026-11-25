import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, Vec3 } from "../src/cadfly/geometry/kernel";
import { PolyhedronError, hullFaces, parseCorners, polyhedronMesh, polyhedronSolid } from "../src/cadfly/geometry/polyhedron";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { type Op, applyOps } from "../src/cadfly/assistant/ops";
import { runProgram } from "../src/cadfly/language/run";
import { commandById } from "../src/cadfly/language/commands";
import { fillFaces, createBlock } from "../src/cadfly/language/edit";
import { hit, layoutProgram } from "../src/cadfly/ui/layout";
import { oneScript } from "./helpers/script-helpers";
import { triangulate } from "../src/cadfly/geometry/sweep";

/** Solids made from points and faces, the hull of points, and the solid block. */

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
  const build = (ops: Op[]) => applyOps([], ops).program;
  /** A vertex as block text */
  const vertex = ([x, y, z]: (string | number)[]) => `vertex x=${x} y=${y} z=${z}`;
  /** A solid block as block text: the vertices section, and a faces section (empty for a hull) */
  const solid = (points: (string | number)[][], faces: number[][] = [], name = "pyramid") =>
    [`solid name=${name}`, "  vertices", ...points.map((p) => `    ${vertex(p)}`), "  faces", ...faces.map((f) => `    face ${f.join(" ")}`)].join("\n");
  const make = (text: string) => build([{ op: "append", blocks: text }]);
  const base = [[-20, -20, 0], [20, -20, 0], [20, 20, 0], [-20, 20, 0], [0, 0, 25]];

  test("with no faces it is the smallest convex solid around its vertices: the pyramid", () => {
    const r = runProgram(k, make(solid(base)));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(PYRAMID_V, 3);
    expect(r.combined!.bounds().max[2]).toBeCloseTo(25);
  });

  test("vertex values can use variables and arithmetic", () => {
    const program = build([
      { op: "append", blocks: "set name=side value=40" },
      { op: "append", blocks: solid([["-side/2", "-side/2", "0"], ["side/2", "-side/2", "0"], ["side/2", "side/2", "0"], ["-side/2", "side/2", "0"], ["0", "0", "side*0.625"]]) },
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
    expect(few[0].blocks[0].inner![0].id).toBe(r.problem!.blockId); // the vertices section

    const bad = make(solid(PYRAMID, [[1, 2, 9]]));
    const problem = runProgram(k, bad).problem!;
    expect(problem.message).toMatch(/vertex 9 does not exist.*1 to 5/);
    const found = bad[0].blocks[0].inner![1].inner![0];
    expect(problem.blockId).toBe(found.id); // the face block, not the whole solid

    expect(runProgram(k, make(solid(PYRAMID, FACES.slice(0, 4)))).problem?.message).toMatch(/gap/);
  });

  test("a solid has one vertices section and at most one faces section", () => {
    const none = make("solid\n  faces");
    expect(runProgram(k, none).problem?.message).toMatch(/needs one vertices section/);
    const twice = make(`solid\n  vertices\n${base.map((p) => `    ${vertex(p)}`).join("\n")}\n  faces\n  faces`);
    expect(runProgram(k, twice).problem?.message).toMatch(/only one faces section/);
  });

  test("a vertex or face cannot sit outside a solid, a vertex only goes in a vertices section, and a face in a faces section", () => {
    expect(() => make("vertex")).toThrow();
    expect(() => make("solid\n  vertex")).toThrow(/vertex block cannot go inside a solid block/);
    expect(() => make("solid\n  faces\n    vertex")).toThrow(/vertex block cannot go inside a faces block/);
  });

  test("a new solid starts as a pyramid with an empty faces section, and a vertex shows its number", () => {
    const block = createBlock([], "solid");
    expect(block.inner!.map((b) => b.kind)).toEqual(["vertices", "faces"]);
    expect(block.inner![0].inner).toHaveLength(5);
    const r = runProgram(k, oneScript([block]));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeGreaterThan(0);
    const l = layoutProgram(oneScript([block]), { x: 0, y: 0, width: 8, measure: (t) => t.length * 0.1 });
    const numbers = l.blocks.filter((b) => b.block.kind === "vertex").map((b) => b.parts.find((p) => p.kind === "number")!.text);
    expect(numbers).toEqual(["1", "2", "3", "4", "5"]);
    // the sections are not offered in the palette: they come with the solid
    expect(commandById("vertices")!.automatic).toBe(true);
    expect(commandById("faces")!.automatic).toBe(true);
  });
});

describe("the sections of a solid, and the ends of a loft, are fixed parts", () => {
  const solid = () => applyOps([], [{ op: "append", blocks: "solid\n  vertices\n    vertex\n    vertex x=10\n    vertex y=10\n    vertex z=10\n  faces" }]).program;
  test("the assistant cannot remove, wrap or unwrap one, but can change what is inside", () => {
    const p = solid();
    const vertices = p[0].blocks[0].inner![0].id;
    const faces = p[0].blocks[0].inner![1].id;
    expect(() => applyOps(p, [{ op: "delete", block: faces }])).toThrow(/faces block is a part of its solid and cannot be removed/);
    expect(() => applyOps(p, [{ op: "wrap", blocks: [vertices], holder: "transform" }])).toThrow(/cannot be wrapped/);
    expect(() => applyOps(p, [{ op: "unwrap", block: vertices }])).toThrow(/cannot be taken out/);
    expect(applyOps(p, [{ op: "delete", block: p[0].blocks[0].inner![0].inner![3].id }]).program[0].blocks[0].inner![0].inner).toHaveLength(3); // a vertex can go
    expect(applyOps(p, [{ op: "insert_into", block: faces, blocks: "face corners=\"1 2 3\"" }]).program[0].blocks[0].inner![1].inner).toHaveLength(1);
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
    expect(run(p).problem!.blockId).toBe(p[0].blocks[0].inner![1].inner![0].id);
    // and an edge with a gap is pointed at one of the faces that has it
    const gap = solidOf(["1 2 3 4", "1 2 5", "2 3 5", "3 4 5"]);
    const g = run(gap);
    expect(g.problem!.message).toMatch(/gap/);
    expect(gap[0].blocks[0].inner![1].inner!.map((f) => f.id)).toContain(g.problem!.blockId);
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
    const p = createBlock([], "solid");
    const run0 = runProgram(k, oneScript([p]));
    const facesId = p.inner![1].id;
    expect(run0.hullFaces[facesId]).toHaveLength(5);
    const lay = (prog: Parameters<typeof runProgram>[1]) => layoutProgram(prog, { x: 0, y: 0, width: 8, measure: (t) => t.length * 0.1 });
    const facesBlock = (prog: Parameters<typeof runProgram>[1]) => lay(prog).blocks.find((b) => b.block.kind === "faces")!;
    const button = facesBlock(oneScript([p])).parts.find((x) => x.kind === "button")!;
    expect(button.text).toBe("hull");
    expect(hit(lay(oneScript([p])), button.rect.x + button.rect.w / 2, button.rect.y + button.rect.h / 2)).toEqual({ kind: "button", blockId: facesId, id: "hull" });
    const filled = fillFaces(oneScript([p]), facesId, run0.hullFaces[facesId]);
    expect(facesBlock(filled).parts.some((x) => x.kind === "button")).toBe(false);
    const r = runProgram(k, filled);
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(run0.combined!.volume(), 3); // the same solid, now from faces
    expect(filled[0].blocks[0].inner![1].inner!.map((f) => f.kind)).toEqual(["face", "face", "face", "face", "face"]);
    // one face taken out: the solid says so and points at a face
    const broken = structuredClone(filled);
    broken[0].blocks[0].inner![1].inner!.pop();
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
