import { beforeAll, describe, expect, test } from "vitest";
import { type Op, applyOps } from "../src/cadfly/assistant/ops";
import { exportFile, exportParts } from "../src/cadfly/exportStl";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { readStl } from "../src/cadfly/geometry/stl";
import { runProgram } from "../src/cadfly/language/run";
import { exampleById } from "../src/cadfly/examples";
import { buffersOf, snapshotOf } from "../src/cadfly/snapshot";

/**
 * What an STL export writes and which shapes count as parts, including hidden
 * shapes in a run and its snapshot.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** The snapshot of a program made by appending this block text, with or without the hidden shapes. */
const snap = (text: string, withHidden = false) => snapshotOf(runProgram(k, applyOps([], [{ op: "append", blocks: text } satisfies Op]).program, {}, withHidden), withHidden);

/** The files in a zip, read by the reader of the zip tests' format: names from the directory, then the STL inside */
function stlsIn(zip: Uint8Array): Map<string, ReturnType<typeof readStl>> {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  const out = new Map<string, ReturnType<typeof readStl>>();
  let at = v.getUint32(end + 16, true);
  for (let i = 0; i < v.getUint16(end + 10, true); i++) {
    const size = v.getUint32(at + 24, true);
    const nameLength = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    out.set(name, readStl(zip.slice(start, start + size).buffer));
    at += 46 + nameLength;
  }
  return out;
}

const triangles = (m: { indices: Uint32Array | number[] }) => m.indices.length / 3;

describe("a run's hidden shapes", () => {
  test("the shapes at the top of build whose eye is shut are kept, named, and are not in the picture or the merged solid", () => {
    const r = runProgram(k, applyOps([], [{ op: "append", blocks: "box name=seen w=10 d=10 h=10\nbox name=secret w=4 d=4 h=4 hidden" }]).program);
    expect(r.shapes.map((s) => s.name)).toEqual(["seen"]);
    expect(r.hiddenShapes.map((s) => s.name)).toEqual(["secret"]);
    expect(r.combined!.volume()).toBeCloseTo(1000);
    expect(r.combinedWithHidden).toBeNull(); // not asked for
  });

  test("when asked for, the merged solid with the hidden ones is made, and the visible one is left as it was", () => {
    const r = runProgram(k, applyOps([], [{ op: "append", blocks: "box name=seen w=10 d=10 h=10\nbox name=secret w=4 d=4 h=4 x=20 hidden" }]).program, {}, true);
    expect(r.combined!.volume()).toBeCloseTo(1000);
    expect(r.combinedWithHidden!.volume()).toBeCloseTo(1064);
  });

  test("a hidden shape inside another block is part of that block's shape, not a shape of its own", () => {
    const r = runProgram(k, applyOps([], [{ op: "append", blocks: "union name=both\n  box w=10 d=10 h=10\n  box w=4 d=4 h=4 x=20 hidden" }]).program);
    expect(r.hiddenShapes).toHaveLength(0);
  });

  test("the snapshot carries them only when asked, and with their meshes among the buffers to hand over", () => {
    const text = "box name=seen w=10 d=10 h=10\nbox name=secret w=4 d=4 h=4 x=20 hidden";
    expect(snap(text).hidden).toBeUndefined();
    const s = snap(text, true);
    expect(s.hidden!.shapes.map((x) => x.name)).toEqual(["secret"]);
    expect(s.hidden!.combined).not.toBeNull();
    expect(structuredClone(s).hidden!.shapes[0].mesh.positions).toBeInstanceOf(Float32Array);
    expect(buffersOf(s).length).toBeGreaterThan(buffersOf(snap(text)).length);
  });
});

describe("which shapes are parts", () => {
  test("the solids at the top of build, in order, and never flat shapes or sketches", () => {
    const s = snap("box name=a w=1 d=1 h=1\nrectangle w=5 h=5\nextrude name=hidden-sketch height=2 hidden\n  circle r=2\nbox name=b w=1 d=1 h=1 x=5");
    expect(exportParts(s, false).map((p) => p.name)).toEqual(["a", "b"]);
  });

  test("hidden shapes are added after them, as 'hidden' and their name, only when they are wanted", () => {
    const s = snap("box name=a w=1 d=1 h=1\nbox name=b w=1 d=1 h=1 x=5 hidden", true);
    expect(exportParts(s, false).map((p) => p.name)).toEqual(["a"]);
    expect(exportParts(s, true).map((p) => p.name)).toEqual(["a", "hidden b"]);
  });

  test("a use at the top of build of a script that makes several solids gives a part for each", () => {
    const dowel = exampleById("dowel-joint")!.program;
    const s = snapshotOf(runProgram(k, structuredClone(dowel)));
    expect(exportParts(s, false)).toHaveLength(3);
  });
});

describe("the file that is given", () => {
  test("one file is part.stl, the solids merged, as it was before parts", () => {
    const f = exportFile(snap("box w=10 d=10 h=10\nbox w=10 d=10 h=10 x=30"), { separate: false, withHidden: false })!;
    expect(f.name).toBe("part.stl");
    expect(f.type).toBe("model/stl");
    expect(triangles(readStl(f.data as ArrayBuffer))).toBe(24);
  });

  test("one file with the hidden shapes has them merged in; without a run that has them it is the visible solids", () => {
    const text = "box name=seen w=10 d=10 h=10\nbox name=secret w=4 d=4 h=4 x=20 hidden";
    const with_ = exportFile(snap(text, true), { separate: false, withHidden: true })!;
    const without = exportFile(snap(text, true), { separate: false, withHidden: false })!;
    expect(triangles(readStl(with_.data as ArrayBuffer))).toBe(24);
    expect(triangles(readStl(without.data as ArrayBuffer))).toBe(12);
    expect(triangles(readStl(exportFile(snap(text), { separate: false, withHidden: true })!.data as ArrayBuffer))).toBe(12);
  });

  test("separate files are parts.zip, an STL for each part named after it, each one that part", () => {
    const f = exportFile(snap("box name=cube w=10 d=10 h=10\nsphere name=ball r=5 x=30"), { separate: true, withHidden: false })!;
    expect(f.name).toBe("parts.zip");
    expect(f.type).toBe("application/zip");
    const files = stlsIn(f.data as Uint8Array);
    expect([...files.keys()]).toEqual(["cube.stl", "ball.stl"]);
    expect(triangles(files.get("cube.stl")!)).toBe(12);
    expect(triangles(files.get("ball.stl")!)).toBeGreaterThan(12);
  });

  test("two parts with one name get different file names, and hidden parts are in the zip when wanted", () => {
    const f = exportFile(snap("box name=leg w=1 d=1 h=1\nbox name=leg w=1 d=1 h=1 x=4\nbox name=lid w=1 d=1 h=1 x=8 hidden", true), { separate: true, withHidden: true })!;
    expect([...stlsIn(f.data as Uint8Array).keys()]).toEqual(["leg.stl", "leg-2.stl", "hidden lid.stl"]);
  });

  test("the dowel joint's three parts are three files, each a single solid that adds up to what was built", () => {
    const r = runProgram(k, structuredClone(exampleById("dowel-joint")!.program));
    const s = snapshotOf(r);
    const f = exportFile(s, { separate: true, withHidden: false })!;
    const files = stlsIn(f.data as Uint8Array);
    expect([...files.keys()]).toEqual(["lower block.stl", "upper block.stl", "dowel_pin.stl"]);
    expect(r.shapes.reduce((a, x) => a + x.solid.volume(), 0)).toBeCloseTo(r.combined!.volume(), 3);
  });

  test("nothing to export gives no file", () => {
    expect(exportFile(snap("rectangle w=5 h=5"), { separate: false, withHidden: false })).toBeNull();
    expect(exportFile(snap("rectangle w=5 h=5"), { separate: true, withHidden: false })).toBeNull();
  });
});
