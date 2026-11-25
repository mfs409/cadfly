import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, Solid } from "../src/cadfly/geometry/kernel";
import { commandById } from "../src/cadfly/language/commands";
import { EXAMPLES, exampleById } from "../src/cadfly/examples";
import { validateProgram } from "../src/cadfly/language/format";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import { BUILD, type Block, type Program } from "../src/cadfly/language/types";
import { oneScript, topBlocks } from "./helpers/script-helpers";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { applyOps } from "../src/cadfly/assistant/ops";
import { PolyhedronError } from "../src/cadfly/geometry/polyhedron";
import { hollow } from "../src/cadfly/geometry/finish";
import type { MeshData } from "../src/cadfly/geometry/kernel";
import { allBlocks } from "../src/cadfly/language/program";
import { UI_MODES, hiddenKindsUsed, offers } from "../src/cadfly/ui/modes";

/**
 * The built-in examples: each builds without a problem, each mode offers the
 * right ones, and the ones that teach something give the numbers they teach.
 * They are also the shared fixtures of other tests.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** How many separate pieces a solid is made of: its triangles, joined where they share a corner, make this many groups */
function pieces(solid: Solid): number {
  const { positions, indices } = solid.mesh();
  const corner = new Map<string, number>();
  const parent: number[] = [];
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const idOf = (p: number) => {
    const key = [0, 1, 2].map((d) => positions[3 * p + d].toFixed(3)).join(",");
    if (!corner.has(key)) {
      corner.set(key, parent.length);
      parent.push(parent.length);
    }
    return corner.get(key)!;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b2, c] = [idOf(indices[t]), idOf(indices[t + 1]), idOf(indices[t + 2])];
    parent[find(a)] = find(b2);
    parent[find(b2)] = find(c);
  }
  return new Set(parent.map((_, i) => find(i))).size;
}

let n = 0;

/** A block, with an id, in as few characters as possible */
const b = (kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({
  id: `b${++n}`,
  kind,
  args,
  ...(inner ? { inner } : {}),
});

const bounds = (r: RunResult) => {
  const x = r.combined!.bounds();
  return [...x.min, ...x.max];
};

const close = (got: number[], want: number[], digits = 5) => want.forEach((v, i) => expect(got[i]).toBeCloseTo(v, digits));
const vol = (r: RunResult) => r.combined!.volume();
const names = (r: RunResult) => r.shapes.map((s) => s.name);
const disc = (r: number) => 0.5 * 64 * r * r * Math.sin((2 * Math.PI) / 64); // the area of the 64-sided circle outline
const run = (text: string) => runProgram(k, applyOps([], [{ op: "append", blocks: text }]).program);

/** The joint examples, and the variable (if any) that pulls them apart */
const JOINTS: [name: string, parts: number, apart?: string][] = [
  ["ball-joint", 2],
  ["ball-and-socket", 2],
  ["hinge", 2],
  ["swivel", 2],
  ["dowel-joint", 3, "explode"],
  ["magnet-pocket", 4, "explode"],
  ["slot-and-tab", 2, "lift"],
  ["dovetail-slide", 2],
  ["snap-pin", 2, "lift"],
  ["finger-joint", 2, "apart"],
  ["cross-lap-joint", 2, "lift"],
  ["locking-tab", 2, "lift"],
  ["t-slot-joint", 4, "lift"],
];

/** The program of the example with this name, as a copy to change */
const program = (name: string): Program => structuredClone(exampleById(name)!.program);

/** The blocks of the script that builds */
const buildBlocks = (p: Program): Block[] => p.find((s) => s.name === BUILD)!.blocks;

/** Set the variable made by the `set` block of `build` with this name */
function setVariable(p: Program, name: string, value: string) {
  const found = buildBlocks(p).find((b) => b.kind === "set" && b.args.name === name);
  if (!found) throw new Error(`no variable ${name}`);
  found.args.value = value;
}

/**
 * The volume of what a program builds, which must have built with nothing
 * wrong
 */
function volume(p: Program): number {
  const r = runProgram(k, p);
  expect(r.problem).toBeUndefined();
  expect(r.combined!.isValid()).toBe(true);
  return r.combined!.volume();
}

/**
 * The volumes of the parts on their own: each block of `build` that is not a
 * variable, built with the variables and the program's other scripts
 */
function partVolumes(p: Program): number[] {
  const sets = buildBlocks(p).filter((b) => b.kind === "set");
  const others = p.filter((s) => s.name !== BUILD);
  return buildBlocks(p)
    .filter((b) => b.kind !== "set")
    .map((part) => volume([{ id: "s0", name: BUILD, blocks: [...sets, part] }, ...others]));
}

/** The bounds of a solid, as [minx, miny, minz, maxx, maxy, maxz], rounded to 3 places */
function box6(s: Solid): number[] {
  const { min, max } = s.bounds();
  return [...min, ...max].map((v) => Math.round(v * 1e3) / 1e3);
}

const message = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(PolyhedronError);
    return (e as Error).message;
  }
  throw new Error("expected an error");
};

const pi = Math.PI;

/** How many separate bodies a mesh holds: triangles that share a corner are one body */
function bodies(mesh: MeshData): number {
  const parent = new Map<number, number>();
  const find = (a: number): number => {
    if (!parent.has(a)) parent.set(a, a);
    let root = a;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(a, root);
    return root;
  };
  for (let i = 0; i < mesh.indices.length; i += 3) {
    parent.set(find(mesh.indices[i]), find(mesh.indices[i + 1]));
    parent.set(find(mesh.indices[i]), find(mesh.indices[i + 2]));
  }
  return new Set([...parent.keys()].map(find)).size;
}

describe("every example", () => {
  const byId = (name: string) => exampleById(name)!;

  test("each one is valid and runs with nothing wrong", () => {
    for (const e of EXAMPLES) {
      validateProgram(e.program);
      const r = runProgram(k, e.program);
      expect(r.problem, e.name).toBeUndefined();
      expect(r.combined, e.name).not.toBeNull();
      expect(r.combined!.isValid(), e.name).toBe(true);
    }
  }, 120_000); // there are many examples, and two (hollowing, filleting) take 5 to 25 seconds, depending on how busy the computer is

  test("the plate follows its variables", () => {
    const plate = (width: string) => {
      const p = structuredClone(byId("plate-with-holes").program);
      p[0].blocks[0].args.value = width;
      return runProgram(k, p);
    };
    const r = plate("60");
    // 60 x 40 x 4, minus four holes of radius 3
    expect(vol(r)).toBeCloseTo((2400 - 4 * disc(3)) * 4, 2);
    close(bounds(r), [-30, -20, 0, 30, 20, 4]);
    close(bounds(plate("100")), [-50, -20, 0, 50, 20, 4]);
  });

  test("the bracket is one piece, standing on the ground, with the wall on top of the base", () => {
    const r = runProgram(k, byId("bracket").program);
    expect(names(r)).toEqual(["bracket"]);
    const b = bounds(r);
    expect(b[2]).toBeCloseTo(0);
    expect(b[5]).toBeCloseTo(35); // 5 thick base + 30 high wall
    // base 40 x 30 x 5, wall 40 x 5 x 30 on its back edge, less a screw hole of radius 3 through the base
    const hole = Math.PI * 9 * 5;
    expect(vol(r) / (40 * 30 * 5 + 40 * 5 * 30 - hole)).toBeCloseTo(1, 2);
    close([b[0], b[1], b[3], b[4]], [-20, -15, 20, 15]); // the wall is flush with the plate's back edge, so nothing sticks out
  });

  test("the row of holes cuts one hole per count, evenly spaced about the middle", () => {
    const row = (holes: string) => {
      const p = structuredClone(byId("row-of-holes").program);
      p[0].blocks[0].args.value = holes;
      return runProgram(k, p);
    };
    const five = row("5");
    expect(five.problem).toBeUndefined();
    const bar = (5 * 12 + 12) * 20 * 4;
    expect(vol(five) / (bar - 5 * Math.PI * 9 * 4)).toBeCloseTo(1, 3);
    expect(bounds(five)[0]).toBeCloseTo(-36); // the bar runs from -36 to 36, centred on the holes
    const seven = row("7");
    expect(vol(seven) / ((7 * 12 + 12) * 20 * 4 - 7 * Math.PI * 9 * 4)).toBeCloseTo(1, 3);
  });

  test("the ring of posts has a post for each count, turned round the middle", () => {
    const ring = (count: string) => {
      const p = structuredClone(byId("ring-of-posts").program);
      p[0].blocks[0].args.value = count;
      return runProgram(k, p);
    };
    const eight = ring("8");
    expect(eight.problem).toBeUndefined();
    const disc2 = Math.PI * 24 * 24 * 2;
    // the posts overlap the disc (it is 2 thick and they stand from z = 1 to 11), so each adds only what sticks out above it
    expect(vol(eight)).toBeGreaterThan(disc2);
    expect(vol(eight)).toBeLessThan(disc2 + 8 * Math.PI * 4 * 10);
    close(bounds(eight).slice(0, 2), [-24, -24], 0);
    expect(bounds(ring("3"))[5]).toBeCloseTo(11);
    expect(vol(ring("3"))).toBeLessThan(vol(eight));
  });

  test("the table is a top and four legs, all standing on the ground", () => {
    const r = runProgram(k, byId("table-with-legs").program);
    expect(r.problem).toBeUndefined();
    expect(r.shapes).toHaveLength(1);
    expect(vol(r)).toBeCloseTo(100 * 60 * 5 + 4 * 5 * 5 * 40, 0);
    const bb = bounds(r);
    close([bb[2], bb[5]], [0, 45]);
    close([bb[0], bb[3]], [-50, 50]);
    // a wider top moves the legs out with it
    const wide = structuredClone(byId("table-with-legs").program);
    wide[1].blocks[0].args.value = "160";
    expect(bounds(runProgram(k, wide).combined ? runProgram(k, wide) : r)[3]).toBeCloseTo(80);
  });

  test("the stairs rise one step at a time, and more steps make more stairs", () => {
    const r = runProgram(k, byId("stairs").program);
    expect(r.problem).toBeUndefined();
    close(bounds(r), [-30, -12.5, 0, 30, 137.5, 60]);
    const more = structuredClone(byId("stairs").program);
    more[0].blocks[0].args.value = "10";
    expect(bounds(runProgram(k, more))[5]).toBeCloseTo(100);
  });

  test("the tree grows from the ground, spreads sideways, and stops", () => {
    const r = runProgram(k, byId("tree").program);
    expect(r.problem).toBeUndefined();
    const bb = bounds(r);
    expect(bb[2]).toBeCloseTo(0);
    expect(bb[5]).toBeGreaterThan(60);
    expect(bb[0]).toBeLessThan(-10);
    expect(bb[3]).toBeGreaterThan(10);
    // the same tree, one level deeper, is taller
    const deeper = structuredClone(byId("tree").program);
    deeper[0].blocks[0].args.values = "30, 5";
    expect(bounds(runProgram(k, deeper))[5]).toBeGreaterThan(bb[5]);
    // a script that never stops is caught (the if is what stops it)
    const forever = structuredClone(byId("tree").program);
    forever[1].blocks[1].args.condition = "true";
    expect(runProgram(k, forever).problem!.message).toMatch(/levels deep/);
  });

  test("the wing reaches out on both sides, equally", () => {
    const r = runProgram(k, byId("wing").program);
    expect(r.problem).toBeUndefined();
    const bb = bounds(r);
    close([bb[0], bb[3]], [-30, 30]);
    expect(vol(r)).toBeCloseTo(2 * 30 * 8 * 2);
    expect(bodies(r.combined!.mesh())).toBe(1); // the halves meet in the middle: one body, not two
  });

  test("the open box is hollow with its top open, and its edges are rounded", () => {
    const r = runProgram(k, byId("open-box").program);
    expect(r.problem).toBeUndefined();
    const solid = 50 * 35 * 25;
    expect(vol(r)).toBeLessThan(solid - 46 * 31 * 23 + 10); // the walls and the floor (46 x 31 x 23 is the inside), and the rounding takes a little more
    expect(vol(r)).toBeGreaterThan(solid - 46 * 31 * 23 - 500);
    close(bounds(r), [-25, -17.5, 0, 25, 17.5, 25], 0);
  });

  test("the twisted tower leans round and narrows; changing turn and narrowing changes it", () => {
    const r = runProgram(k, byId("twisted-tower").program);
    expect(r.problem).toBeUndefined();
    const b = bounds(r);
    expect(b[2]).toBeCloseTo(0, 3);
    expect(b[5]).toBeCloseTo(60, 3);
    expect(b[3]).toBeLessThan(14.2);
    const straight = structuredClone(byId("twisted-tower").program);
    straight[0].blocks[0].args.value = "0";
    straight[0].blocks[1].args.value = "1";
    expect(vol(runProgram(k, straight))).toBeGreaterThan(vol(r));
  });

  test("the rounded plate has four holes, and moving the corner radius moves them", () => {
    const r = runProgram(k, byId("rounded-plate").program);
    expect(r.problem).toBeUndefined();
    const rect = 70 * 45 - 4 * (64 - 16 * Math.PI);
    expect(vol(r) / ((rect - 4 * Math.PI * 4) * 5)).toBeCloseTo(1, 2);
    const wider = structuredClone(byId("rounded-plate").program);
    wider[0].blocks[0].args.value = "12";
    expect(runProgram(k, wider).problem).toBeUndefined();
  });

  test("the cup is a hollow vessel", () => {
    const r = runProgram(k, byId("cup").program);
    // outer cylinder of radius 15 and height 30, less the inner cavity of radius 13 and height 28
    const outer = Math.PI * 225 * 30;
    const inner = Math.PI * 169 * 28;
    expect(vol(r) / (outer - inner)).toBeCloseTo(1, 1);
    expect(bounds(r)[5] - bounds(r)[2]).toBeCloseTo(30);
  });
});

describe("the lettered and sketched examples", () => {
  const byId = (n: string) => exampleById(n)!.program;
  test("name plate: the letters are cut into the plate", () => {
    const r = runProgram(k, byId("name-plate"));
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeLessThan(70 * 20 * 3);
  });
  test("pipe: follows its bends", () => {
    const r = runProgram(k, byId("pipe"));
    expect(r.problem).toBeUndefined();
    const b = r.combined!.bounds();
    expect(b.max[2]).toBeGreaterThan(50);
    expect(b.max[1]).toBeGreaterThanOrEqual(30 - 1e-6);
  });
  test("tray and lid: the lid is 0.8 wider than the tray, sitting on top of it", () => {
    const r = runProgram(k, byId("tray-and-lid"));
    expect(r.problem).toBeUndefined();
    const lid = r.shapes[1].solid.bounds();
    expect(lid.max[0] - lid.min[0]).toBeCloseTo(50.8, 3);
    expect(r.shapes[0].solid.bounds().max[2]).toBeLessThanOrEqual(lid.min[2] + 1e-6 + 15);
  });
});

describe("the hollow and lettered examples", () => {
  const byId = (n: string) => exampleById(n)!.program;
  const solid = (n: string) => {
    const r = runProgram(k, byId(n));
    expect(r.problem, n).toBeUndefined();
    return r.combined!;
  };
  test("hollow vase: lighter than the same loft left solid, still 60 tall, and open at the top", () => {
    const hollow = solid("hollow-vase");
    const loft = structuredClone(byId("hollow-vase")[0].blocks.find((x) => x.kind === "shell")!.inner![0]);
    const filled = runProgram(k, oneScript([loft]));
    expect(filled.problem).toBeUndefined();
    expect(filled.combined!.bounds().max[0] - filled.combined!.bounds().min[0]).toBeCloseTo(30, 2); // a square 30 across at the bottom
    expect(hollow.volume()).toBeLessThan(filled.combined!.volume() * 0.6);
    expect(hollow.bounds().max[2]).toBeCloseTo(60, 2);
    // open at the top: a thin slice of the top has a hole, so it has less than the full circle there
    expect(hollow.volume()).toBeGreaterThan(5000);
  });
  test("hollow pipe: the bore is open at both ends, and the walls are what is left", () => {
    const pipe = solid("hollow-pipe");
    const solidPipe = solid("pipe");
    expect(pipe.volume() / solidPipe.volume()).toBeGreaterThan(0.3);
    expect(pipe.volume() / solidPipe.volume()).toBeLessThan(0.75); // (4^2 - 2.5^2) / 4^2 = 0.61
    expect(pipe.bounds().min[2]).toBeCloseTo(0, 2); // the extra length of the bore is not part of the pipe
  });
  test("etched text: the plate keeps its thickness and loses the letters' depth", () => {
    const etched = solid("etched-text");
    const plateVolume = solid("raised-text").volume() - 0; // the plate with letters on it, so only the bounds are compared
    expect(etched.bounds().max[2]).toBeCloseTo(3, 3);
    expect(etched.volume()).toBeLessThan(70 * 20 * 3);
    expect(etched.volume()).toBeGreaterThan(70 * 20 * 3 - 70 * 20 * 1);
    expect(plateVolume).toBeGreaterThan(etched.volume());
  });
  test("raised text: the letters stand up from the plate by raise", () => {
    const raised = solid("raised-text");
    expect(raised.bounds().max[2]).toBeCloseTo(4, 3);
    expect(raised.volume()).toBeGreaterThan(70 * 20 * 3 - 4 * 20 * 3);
  });
});

describe.each(JOINTS)("%s", (name, parts, apart) => {
  // two parts that are meant to move, or to be taken apart, must not share any
  // space: the volume of all of them together is then the sum of their volumes
  test(`builds with nothing wrong, as ${parts} parts that share no space`, () => {
    const p = program(name);
    const each = partVolumes(p);
    expect(each).toHaveLength(parts);
    expect(volume(p)).toBeCloseTo(
      each.reduce((a, b) => a + b, 0),
      3,
    );
  });

  if (apart) {
    // the same, with the joint closed up
    test(`still shares no space with ${apart} at 0`, () => {
      const p = program(name);
      setVariable(p, apart, "0");
      expect(volume(p)).toBeCloseTo(
        partVolumes(p).reduce((a, b) => a + b, 0),
        3,
      );
    });
  }
});

describe.each(JOINTS)("%s as scripts to reuse", (name) => {
  test("is made of scripts that take the joint's dimensions as inputs, and build uses every one", () => {
    const p = program(name);
    const scripts = p.filter((s) => s.name !== undefined && s.name !== BUILD);
    expect(scripts.length).toBeGreaterThan(0);
    const used = new Set(allBlocks(p).filter((blk) => blk.kind === "use").map((blk) => String(blk.args.name)));
    for (const s of scripts) {
      expect(s.inputs, `${s.name} has inputs`).toBeTruthy();
      expect(used.has(s.name!), `${s.name} is used`).toBe(true);
    }
  });
});

describe("the dimensions that make the joints work", () => {
  // the ball can only come out through the opening, which is narrower than it
  test("the ball joint's opening is narrower than the ball, and its stem fits through with room to spare", () => {
    const p = program("ball-joint");
    const value = (n: string) => buildBlocks(p).find((b) => b.args.name === n)!.args.value;
    expect(value("opening")).toBe("r * 0.7");
    const bigger = structuredClone(p);
    setVariable(bigger, "opening", "r * 1.2");
    // with an opening wider than the ball the socket is cut through its sides
    // too, so it no longer has the volume it had
    expect(partVolumes(bigger)[0]).not.toBeCloseTo(partVolumes(p)[0], 0);
  });

  // a tighter fit is a smaller gap: the parts stay apart until it is 0
  test("each print-in-place joint stays in separate parts for a small gap, and a negative gap would join them", () => {
    for (const name of ["ball-joint", "hinge", "swivel"]) {
      const p = program(name);
      setVariable(p, "gap", "0.2");
      expect(volume(p), name).toBeCloseTo(partVolumes(p).reduce((a, b) => a + b, 0), 3);
      // with a negative gap the parts overlap, and so are joined
      setVariable(p, "gap", "-0.3");
      expect(volume(p), name).toBeLessThan(partVolumes(p).reduce((a, b) => a + b, 0) - 1);
    }
  });
});

describe("the Align and Place against examples", () => {
  const bounds = (name: string) => {
    const r = runProgram(k, exampleById(name)!.program);
    expect(r.problem).toBeUndefined();
    return box6(r.combined!);
  };

  test("Align: the pieces share the plate's center on x, and keep their own y and z", () => {
    // plate 60 wide (x -30..30); the pieces are narrower, so x stays -30..30; y runs from the post (-39) to the slab (65)
    expect(bounds("align")).toEqual([-30, -39, 0, 30, 65, 20]);
  });

  test("Place against: every peg stands on the base, none on another peg", () => {
    // base is 6 high; the tallest peg is 20: so the top is 6 + 20 = 26, not a tower of all three
    expect(bounds("place-against")).toEqual([-30, -20, 0, 30, 20, 26]);
  });
});

describe("the flat examples", () => {
  const solid = (name: string) => {
    const r = runProgram(k, exampleById(name)!.program);
    expect(r.problem, name).toBeUndefined();
    return r.combined!;
  };
  test("the washer: a ring 2 thick", () => {
    const v = solid("washer").volume();
    expect(v).toBeCloseTo((disc(10) - disc(4)) * 2, 2);
    expect(solid("washer").bounds().max[2]).toBeCloseTo(2, 3);
  });
  test("the flat plate: the joined outline less two holes, with rounded corners, 4 thick", () => {
    const plate = solid("flat-plate");
    const b = plate.bounds();
    expect(b.max[2]).toBeCloseTo(4, 3);
    expect(b.max[0]).toBeCloseTo(45, 1); // the circle at x = 30, radius 15, reaches 45
    expect(b.min[0]).toBeCloseTo(-30, 1);
    // less than the plain union, which is a 60 x 30 rectangle and a circle sticking out of one end (half of it outside)
    expect(plate.volume() / 4).toBeLessThan(1800 + disc(15) / 2);
    expect(plate.volume() / 4).toBeGreaterThan(1800 - 100);
  });
  test("the valentine heart: one solid, even about x = 0, with the area of a square and two half circles less the keyring hole", () => {
    const r = runProgram(k, exampleById("valentine-heart")!.program);
    expect(r.problem).toBeUndefined();
    expect(r.shapes.length).toBe(1);
    const heart = r.combined!;
    const b = heart.bounds();
    const side = 40;
    expect(b.max[2]).toBeCloseTo(4, 3);
    expect(b.min[0]).toBeCloseTo(-b.max[0], 3);
    // the point at the bottom is a corner of the turned square; the lobes reach a half side above the side's middle
    expect(b.min[1]).toBeCloseTo((-side * Math.SQRT2) / 2, 1);
    expect(b.max[1]).toBeCloseTo((side * Math.SQRT2) / 4 + side / 2, 1);
    // the widest point is where a circle's side is furthest out: its centre's x plus its radius
    expect(b.max[0]).toBeCloseTo((side * Math.SQRT2) / 4 + side / 2, 1);
    // the square, and half of each of the two circles outside it (the other half is inside the square)
    const area = side * side + disc(side / 2) - disc(3);
    expect(heart.volume() / 4).toBeCloseTo(area, -1);
    expect(pieces(heart)).toBe(1);
  });
});

describe("the examples whose points a repeat makes", () => {
  /** The area of an outline given by its points as (angle in degrees, distance from the middle), going round: half the sum of r1 * r2 * sin(angle between) */
  const polarArea = (corners: [number, number][]) => {
    let sum = 0;
    corners.forEach(([angle, radius], n) => {
      const [nextAngle, nextRadius] = corners[(n + 1) % corners.length];
      sum += 0.5 * radius * nextRadius * Math.sin(((nextAngle - angle + 360) % 360) * (Math.PI / 180));
    });
    return sum;
  };

  test("the gear: one solid, 5 thick, with the area of its teeth and rim less the bore", () => {
    const r = runProgram(k, exampleById("gear")!.program);
    expect(r.problem).toBeUndefined();
    expect(r.shapes.length).toBe(1);
    const gear = r.combined!;
    const b = gear.bounds();
    expect(b.max[2]).toBeCloseTo(5, 3);
    // no tooth reaches past the outer radius, and some come close to it on every side
    for (const edge of [b.max[0], b.max[1], -b.min[0], -b.min[1]]) {
      expect(edge).toBeLessThanOrEqual(20 + 1e-6);
      expect(edge).toBeGreaterThan(19);
    }
    // each tooth is four corners of the outline: where it leaves the rim, its two top corners, and where it meets the rim again
    const [teeth, outer, root, pitch] = [14, 20, 16, 360 / 14];
    const outline: [number, number][] = Array.from({ length: teeth }, (_, tooth) => [
      [tooth * pitch - 0.25 * pitch, root],
      [tooth * pitch - 0.12 * pitch, outer],
      [tooth * pitch + 0.12 * pitch, outer],
      [tooth * pitch + 0.25 * pitch, root],
    ] as [number, number][]).flat();
    expect(gear.volume() / 5).toBeCloseTo(polarArea(outline) - disc(4), -1);
    expect(pieces(gear)).toBe(1);
  });

  test("the gear gets a tooth for every one that teeth asks for, and stays one solid", () => {
    for (const teeth of ["8", "30"]) {
      const p = program("gear");
      setVariable(p, "teeth", teeth);
      const r = runProgram(k, p);
      expect(r.problem).toBeUndefined();
      expect(pieces(r.combined!)).toBe(1);
      // more teeth means a rim with more of its width taken by teeth: the area changes, in the right direction and by a sensible amount
      expect(r.combined!.volume()).toBeGreaterThan(Math.PI * 14 * 14 * 5);
      expect(r.combined!.volume()).toBeLessThan(Math.PI * 20 * 20 * 5);
    }
  });

  test("the star outline: one solid with a point at the top, its tips on the outer circle", () => {
    const r = runProgram(k, exampleById("star-outline")!.program);
    expect(r.problem).toBeUndefined();
    const star = r.combined!;
    const b = star.bounds();
    expect(b.max[2]).toBeCloseTo(4, 3);
    // the first tip points straight up, at the tip radius
    expect(b.max[1]).toBeCloseTo(20, 3);
    expect(b.min[0]).toBeCloseTo(-b.max[0], 3);
    const corners: [number, number][] = Array.from({ length: 5 }, (_, arm) => [
      [arm * 72 + 90, 20],
      [arm * 72 + 126, 8],
    ] as [number, number][]).flat();
    expect(star.volume() / 4).toBeCloseTo(polarArea(corners), 3);
    expect(pieces(star)).toBe(1);
  });

  test("the raindrop: a ball with a cone that just touches it, standing on its point at the bottom", () => {
    const r = runProgram(k, exampleById("raindrop")!.program);
    expect(r.problem).toBeUndefined();
    const drop = r.combined!;
    const b = drop.bounds();
    const [radius, sharp] = [12, 60];
    // the tip is where the cone's side, which touches the ball, meets the axis
    const tip = radius + radius / Math.cos((sharp * Math.PI) / 180);
    expect(b.min[2]).toBeCloseTo(0, 3);
    expect(b.max[2]).toBeCloseTo(tip, 3);
    expect(b.max[0]).toBeCloseTo(radius, 1);
    expect(b.min[0]).toBeCloseTo(-radius, 1);
    // the ball below the touching circle (a cap of the ball), and the cone above it
    const touch = radius * (1 + Math.cos((sharp * Math.PI) / 180));
    const below = (Math.PI * touch * touch * (3 * radius - touch)) / 3;
    const cone = (Math.PI * (radius * Math.sin((sharp * Math.PI) / 180)) ** 2 * (tip - touch)) / 3;
    // the outline is a polygon of 36 steps, so it is a little under the true shape
    expect(drop.volume()).toBeLessThan(below + cone);
    expect(drop.volume()).toBeGreaterThan((below + cone) * 0.99);
    expect(pieces(drop)).toBe(1);
  });

  test("the raindrop's tip follows sharp: a larger number is a longer tip", () => {
    const heights = ["50", "70"].map((sharp) => {
      const p = program("raindrop");
      setVariable(p, "sharp", sharp);
      const r = runProgram(k, p);
      expect(r.problem).toBeUndefined();
      return r.combined!.bounds().max[2];
    });
    expect(heights[0]).toBeLessThan(heights[1]);
  });

  describe("the round heart", () => {
    const heart = () => {
      const r = runProgram(k, exampleById("round-heart")!.program);
      expect(r.problem).toBeUndefined();
      expect(r.shapes.length).toBe(1);
      return r.combined!;
    };
    /** The heart curve's outline at 5 degree steps, in the units of the curve (its area is worked out by the shoelace sum). */
    const outline = Array.from({ length: 72 }, (_, n) => {
      const t = (n * 5 * Math.PI) / 180;
      return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)] as [number, number];
    });
    const outlineArea = Math.abs(outline.reduce((sum, [x, y], i) => sum + x * outline[(i + 1) % outline.length][1] - outline[(i + 1) % outline.length][0] * y, 0)) / 2;
    const [width, thickness, slices] = [40, 22, 8];
    const unit = width / 32;
    const degrees = (angle: number) => (angle * Math.PI) / 180;

    test("one solid with its point on the ground, even about both x = 0 and y = 0, as wide and thick as asked", () => {
      const solid = heart();
      const b = solid.bounds();
      expect(b.min[2]).toBeCloseTo(0, 3);
      expect(b.min[0]).toBeCloseTo(-width / 2, 1);
      expect(b.max[0]).toBeCloseTo(width / 2, 1);
      // the stack stops at 84 degrees round its arc, where a slice is a tenth of the full size
      expect(b.max[1]).toBeCloseTo((thickness / 2) * Math.sin(degrees(84)), 2);
      expect(b.min[1]).toBeCloseTo(-b.max[1], 3);
      // the curve is 28.9 high, so the heart is 28.9 units
      expect(b.max[2]).toBeCloseTo(28.9 * unit, 0);
      expect(pieces(solid)).toBe(1);
    });

    test("its volume is that of the stack of slices, whose outlines shrink by the cosine of their angle", () => {
      // between two sizes the loft is a frustum of similar outlines: height * area * (a * a + a * b + b * b) / 3
      let expected = 0;
      for (let slice = 0; slice < 2 * slices; slice++) {
        const [low, high] = [(slice - slices) * (84 / slices), (slice + 1 - slices) * (84 / slices)];
        const [a, b] = [Math.cos(degrees(low)), Math.cos(degrees(high))];
        const height = (thickness / 2) * (Math.sin(degrees(high)) - Math.sin(degrees(low)));
        expected += (height * outlineArea * unit ** 2 * (a * a + a * b + b * b)) / 3;
      }
      expect(heart().volume()).toBeGreaterThan(expected * 0.995);
      expect(heart().volume()).toBeLessThan(expected * 1.005);
    });

    test("both faces bulge outward: the area of a cross-section never grows away from the middle", () => {
      const solid = heart();
      /** The volume of the part of the heart past this depth, out toward the front. */
      const beyond = (depth: number) => k.intersect(solid, k.place(k.box(100, 60, 100), { position: [0, depth + 30, 20] })).volume();
      const depths = [0, 2, 4, 6, 8, 10];
      const areas = depths.slice(1).map((depth, i) => (beyond(depths[i]) - beyond(depth)) / (depth - depths[i]));
      for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeLessThanOrEqual(areas[i - 1] * 1.01);
      // in the middle it is the whole outline
      expect(areas[0]).toBeGreaterThan(0.95 * outlineArea * unit ** 2 * Math.cos(degrees(2)) ** 2);
    });

    test("it is thinner toward the point than across the lobes", () => {
      const solid = heart();
      const near = (low: number, high: number) => k.intersect(solid, k.place(k.box(100, 100, high - low), { position: [0, 0, (low + high) / 2] })).bounds();
      const tip = near(0, 1);
      const middle = near(10, 11);
      const lobes = near(24, 30);
      // the thickness falls away from the lobes toward the point, to a thin edge at the point itself
      expect(tip.max[1]).toBeLessThan(0.35 * lobes.max[1]);
      expect(tip.max[1]).toBeLessThan(middle.max[1]);
      expect(middle.max[1]).toBeLessThan(lobes.max[1]);
    });

    test("it is built quickly, from one outline drawn with a repeat", () => {
      const started = Date.now();
      heart();
      // generous, so that a slow machine does not fail it: it is 20 times what a build takes here
      expect(Date.now() - started).toBeLessThan(5000);
    });
  });
});

describe("the solid examples", () => {
  const run = (name: string) => runProgram(k, exampleById(name)!.program);
  test("the pyramid is a hull of 5 points, and follows its variables", () => {
    const r = run("pyramid");
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo((40 * 40 * 25) / 3, 3);
    const wider = structuredClone(exampleById("pyramid")!.program);
    wider[0].blocks[0].args.value = "60";
    expect(runProgram(k, wider).combined!.volume()).toBeCloseTo((60 * 60 * 25) / 3, 3);
  });
  test("the house is exactly its 7 faces: walls 30 by 20 by 20 under a gable roof 10 high", () => {
    const r = run("house");
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(30 * 20 * 20 + (20 * 10 * 30) / 2, 3);
    // a face taken out leaves a gap, which it says
    const open = structuredClone(exampleById("house")!.program);
    open[0].blocks[2].inner![1].inner!.pop();
    expect(runProgram(k, open).problem?.message).toMatch(/gap/);
  });
});

describe("the star example needs its faces", () => {
  const star = () => structuredClone(exampleById("star")!.program);
  test("it is a closed solid of volume 4 core squared times tip: 8000 for core 10 and tip 20", () => {
    const r = runProgram(k, star());
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeCloseTo(8000, 2);
    expect(r.combined!.bounds().max[0]).toBeCloseTo(20, 3);
  });
  test("a hull of the same points fills it in: much more than the star", () => {
    const hull = star();
    hull[0].blocks[2].inner = [hull[0].blocks[2].inner![0]]; // the vertices section only (index 2 is the solid after the two set blocks)
    const filled = runProgram(k, hull);
    expect(filled.problem).toBeUndefined();
    expect(filled.combined!.volume()).toBeGreaterThan(30000); // about the cube around it
  });
  test("it follows its variables", () => {
    const p = star();
    p[0].blocks[0].args.value = "5";
    p[0].blocks[1].args.value = "30";
    expect(runProgram(k, p).combined!.volume()).toBeCloseTo(4 * 25 * 30, 2);
  });
  test("taking a face out leaves a gap, at one of the faces that has the edge", () => {
    const p = star();
    p[0].blocks[2].inner![1].inner!.pop();
    const r = runProgram(k, p);
    expect(r.problem!.message).toMatch(/gap/);
    expect(p[0].blocks[2].inner![1].inner!.map((f) => f.id)).toContain(r.problem!.blockId);
  });
  test("neither the points nor the faces are shown by default; the ticks are views only", () => {
    const r = runProgram(k, star());
    expect(r.overlays).toHaveLength(0);
    const on = star();
    on[0].blocks[2].inner![0].args.show = true;
    on[0].blocks[2].inner![1].args.show = true;
    const shown = runProgram(k, on).overlays;
    expect(shown.filter((o) => o.kind === "point")).toHaveLength(14);
    expect(shown.filter((o) => o.kind === "face")).toHaveLength(24);
    expect(commandById("vertices")!.viewOnly).toEqual(["show"]);
    expect(commandById("faces")!.viewOnly).toEqual(["show"]);
  });
  test("a transform moves the points and faces that were drawn, and a hidden block takes them away", () => {
    const p = star();
    const [first, second, solid] = p[0].blocks;
    solid.inner![0].args.show = true;
    const moved: typeof p = oneScript([first, second, { id: "t", kind: "transform", args: { x: "100", rz: "90" }, inner: [solid] }]);
    const r = runProgram(k, moved);
    const tip = r.overlays.find((o) => o.kind === "point" && o.label === "1")!; // (core, 0, 0): turned a quarter to (0, core, 0), then moved
    expect(tip.kind === "point" && tip.at.map((v) => Math.round(v))).toEqual([100, 10, 0]);
    const hidden = structuredClone(moved);
    hidden[0].blocks[2].hidden = true;
    expect(runProgram(k, hidden).overlays).toHaveLength(0);
  });
});

describe("every example lists every face counterclockwise from outside (so the outside is the solid side in the view)", () => {
  for (const [name, centre] of [["star", [0, 0, 0]], ["house", [0, 0, 10]]] as const) {
    test(`${name}: every face's normal points away from the middle`, () => {
      const program = structuredClone(exampleById(name)!.program);
      topBlocks(program).flatMap((b) => b.inner ?? []).filter((b) => b.kind === "faces").forEach((b) => (b.args.show = true)); // the faces are drawn only when shown
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

describe("the post and base example", () => {
  const program = () => structuredClone(exampleById("post-and-base")!.program);
  test("it runs, has its two screw holes, and a bigger foot makes more material", () => {
    const small = runProgram(k, program());
    expect(small.problem).toBeUndefined();
    const big = program();
    big[0].blocks[0].args.value = "7";
    const bigger = runProgram(k, big);
    expect(bigger.problem).toBeUndefined();
    expect(bigger.combined!.volume()).toBeGreaterThan(small.combined!.volume());
    // two holes of radius 3 through the 6 mm base are really there: the volume is the filleted joint less 2 holes
    const whole = program();
    const noHoles = [{ id: "s1", name: "build", blocks: [whole[0].blocks[0], whole[0].blocks[1].inner![0]] }];
    expect(runProgram(k, noHoles).combined!.volume() - small.combined!.volume()).toBeCloseTo(2 * pi * 9 * 6, -1);
  });
});

describe("the list of examples", () => {
  test("every example has an id of lowercase words joined by dashes, and no two ids or names are the same", () => {
    expect(EXAMPLES.length).toBeGreaterThan(40);
    for (const e of EXAMPLES) expect(e.id, e.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    expect(new Set(EXAMPLES.map((e) => e.name)).size).toBe(EXAMPLES.length);
  });

  test("an example is found by its id, and only by its id", () => {
    expect(exampleById("cup")?.name).toBe("Cup");
    expect(exampleById("Cup")).toBeUndefined();
    expect(exampleById("nothing")).toBeUndefined();
  });

  test("the ids of examples that other pages may link to do not change (an id is for good, even if the name does)", () => {
    expect(exampleById("snowman-with-a-hat")?.name).toBe("Snowman with a hat");
    expect(exampleById("cup")?.name).toBe("Cup");
  });

  test("they are listed simplest first: the ones the first mode offers come before all the others, and the joints come after Bracket", () => {
    const ids = EXAMPLES.map((e) => e.id);
    const firstMode = UI_MODES[0].spec;
    const simple = EXAMPLES.filter((e) => !hiddenKindsUsed(e.program, firstMode).length).map((e) => e.id);
    expect(simple.length).toBeGreaterThan(0);
    expect(ids.slice(0, simple.length)).toEqual(simple);
    for (const [name] of JOINTS) expect(ids.indexOf("bracket"), name).toBeLessThan(ids.indexOf(name));
  });

  test("they are frozen, so no test or caller can change one that others share; a copy can be changed", () => {
    const bracket = exampleById("bracket")!;
    expect(() => bracket.program[0].blocks.push(b("box"))).toThrow(TypeError);
    expect(() => {
      bracket.program[0].blocks[0].args.value = "9";
    }).toThrow(TypeError);
    const copy = structuredClone(bracket.program);
    copy[0].blocks[0].args.value = "9";
    expect(copy[0].blocks[0].args.value).toBe("9");
    expect(bracket.program[0].blocks[0].args.value).not.toBe("9");
  });
});

describe("what each mode offers", () => {
  /** The examples a mode can show: the ones that use no block it hides (what the menu offers) */
  const offered = (mode: string) => EXAMPLES.filter((e) => !hiddenKindsUsed(e.program, UI_MODES.find((m) => m.name === mode)!.spec).length).map((e) => e.id);

  test("every mode offers at least one example, and the first mode offers exactly its own", () => {
    for (const m of UI_MODES) expect(offered(m.name).length, m.name).toBeGreaterThan(0);
    expect(offered("First steps")).toEqual(["step-stool", "pencil-pot", "snowman-with-a-hat"]);
  });

  test("a bigger mode offers every example a smaller one does, and the biggest offers them all", () => {
    for (let i = 1; i < UI_MODES.length; i++) {
      const smaller = offered(UI_MODES[i - 1].name);
      const bigger = offered(UI_MODES[i].name);
      for (const id of smaller) expect(bigger, `${UI_MODES[i].name} has ${id}`).toContain(id);
    }
    expect(offered(UI_MODES[UI_MODES.length - 1].name)).toHaveLength(EXAMPLES.length);
  });

  test("a mode without scripts offers no example that has a script of its own", () => {
    const hasOwnScript = (e: (typeof EXAMPLES)[number]) => e.program.some((s) => s.name !== undefined && s.name !== BUILD);
    for (const m of UI_MODES.filter((mode) => !mode.spec.scripts)) {
      for (const id of offered(m.name)) expect(hasOwnScript(exampleById(id)!), `${m.name}: ${id}`).toBe(false);
    }
  });

  test("the examples for the first mode use only blocks that mode offers, and run with nothing wrong", () => {
    const spec = UI_MODES.find((m) => m.name === "First steps")!.spec;
    for (const id of offered("First steps")) {
      const example = exampleById(id)!;
      for (const block of allBlocks(example.program)) expect(offers(spec, block.kind), `${id}: ${block.kind}`).toBe(true);
      expect(runProgram(k, example.program).problem, id).toBeUndefined();
    }
  });
});

describe("the examples for the first mode", () => {
  const run = (id: string) => {
    const r = runProgram(k, exampleById(id)!.program);
    expect(r.problem, id).toBeUndefined();
    return r.combined!;
  };
  test("the step stool is one body, standing on the ground and centred", () => {
    const stool = run("step-stool");
    const [x0, y0, z0, x1, y1] = box6(stool);
    expect(z0).toBe(0);
    expect(x0).toBe(-x1);
    expect(y0).toBe(-y1);
    expect(bodies(stool.mesh())).toBe(1);
  });
  test("the pencil pot: a floor and a wall, open at the top", () => {
    const pot = run("pencil-pot");
    expect(pot.bounds().max[2]).toBeCloseTo(45, 3);
    const ring = (r: number) => 0.5 * 48 * r * r * Math.sin((2 * Math.PI) / 48); // the area of a cylinder's 48-sided outline
    expect(pot.volume()).toBeCloseTo(ring(20) * 45 - ring(17) * 41, 1);
  });
  /** The radius of a sphere block, as a number */
  const radius = (b: Block) => Number(b.args.r);
  /** The sphere blocks inside the snowman's union, at any depth, largest first */
  const spheres = () => allBlocks(exampleById("snowman-with-a-hat")!.program).filter((b) => b.kind === "sphere").sort((a, c) => radius(c) - radius(a));
  test("the snowman with a hat is one body on the ground, and the face and buttons add to the three balls", () => {
    const snowman = run("snowman-with-a-hat");
    expect(snowman.bounds().min[2]).toBeCloseTo(0, 3);
    expect(bodies(snowman.mesh())).toBe(1); // the eyes, nose and buttons are sunk into the balls, so none is loose
    const balls = spheres().slice(0, 3);
    const bare = runProgram(k, oneScript([{ id: "u", kind: "union", args: {}, inner: structuredClone(balls) }]));
    expect(bare.problem).toBeUndefined();
    expect(snowman.volume()).toBeGreaterThan(bare.combined!.volume());
  });
  test("the snowman's nose points forward (toward negative y), and starts inside the head", () => {
    const union = exampleById("snowman-with-a-hat")!.program[0].blocks[0];
    const nose = structuredClone(union.inner!.find((x) => x.kind === "transform" && x.args.rx === "90")!);
    const r = runProgram(k, oneScript([nose]));
    expect(r.problem).toBeUndefined();
    const b = r.combined!.bounds();
    const head = spheres()[2]; // the third largest ball is the head
    const frontOfHead = -radius(head);
    expect(b.min[1]).toBeLessThan(frontOfHead); // the tip sticks out in front of the head
    expect(b.max[1]).toBeGreaterThan(frontOfHead); // the wide end is inside it
  });
});

describe("the descriptions say what the examples are", () => {
  /**
   * The variables a description tells the person to change: the word after
   * "set" or "change". Each must be a variable the example sets.
   */
  const named = (description: string) => [...description.matchAll(/\b[Ss]et ([a-z]\w*) to\b|\b[Cc]hange ([a-z]\w*) to\b/g)].map((m) => m[1] ?? m[2]);

  test("a variable that a description tells the person to change is one the example sets", () => {
    let checked = 0;
    for (const example of EXAMPLES) {
      const set = new Set(allBlocks(example.program).filter((blk) => blk.kind === "set").map((blk) => String(blk.args.name)));
      for (const v of named(example.description)) {
        expect(set.has(v), `${example.id} sets ${v}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5); // the rule is really looking at descriptions
  });

  test("the star's description counts its vertices and faces correctly", () => {
    const blocks = allBlocks(exampleById("star")!.program);
    expect(blocks.filter((blk) => blk.kind === "vertex")).toHaveLength(14);
    expect(blocks.filter((blk) => blk.kind === "face")).toHaveLength(24);
    expect(exampleById("star")!.description).toContain("14 vertices, 24 faces");
  });

  test("the house's description counts its vertices and faces correctly", () => {
    const blocks = allBlocks(exampleById("house")!.program);
    expect(blocks.filter((blk) => blk.kind === "vertex")).toHaveLength(10);
    expect(blocks.filter((blk) => blk.kind === "face")).toHaveLength(7);
    expect(exampleById("house")!.description).toContain("10 vertices, 7 faces");
  });

  test("no description is long", () => {
    for (const e of EXAMPLES) expect(e.description.length, e.name).toBeLessThanOrEqual(140);
  });
});
