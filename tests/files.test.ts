import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, MeshData } from "../src/cadfly/geometry/kernel";
import { writeStl } from "../src/cadfly/geometry/stl";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { MAX_STL_FILE_BYTES, MAX_STL_TOTAL_BYTES, addStlFile, bytesOf, removeFile, summarizeStlFiles, toSafeStlName } from "../src/cadfly/language/files";
import { runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";
import { oneScript } from "./helpers/script-helpers";
import { box } from "./helpers/blocks";

/** A project's STL files and the import block. */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** An STL file of a box, as the bytes of a file */
const boxStl = (w: number, d: number, h: number) => writeStl(k.box(w, d, h).mesh());

/** A single triangle: a valid STL, but not a solid */
const triangleStl = () => writeStl({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) } as MeshData);

let n = 0;
const b = (kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id: `b${++n}`, kind, args, ...(inner ? { inner } : {}) });

describe("adding a file", () => {
  test("a good STL is stored as base64 and described", () => {
    const { files, info } = addStlFile({}, "gear.stl", boxStl(10, 20, 30));
    expect(Object.keys(files)).toEqual(["gear.stl"]);
    expect(info).toMatchObject({ name: "gear.stl", triangles: 12 });
    expect(info.size).toEqual({ width: 10, depth: 20, height: 30 });
    expect(info.bytes).toBe(84 + 12 * 50);
    expect(summarizeStlFiles(files)).toEqual([info]);
  });

  test("the name is made safe, and must be an STL name", () => {
    expect(toSafeStlName("C:\\parts\\My Gear (1).STL")).toBe("My_Gear__1_.STL");
    expect(toSafeStlName("/tmp/a-b.c.stl")).toBe("a-b.c.stl");
    expect(() => toSafeStlName("notes.txt")).toThrow(/not an STL file name/);
    expect(() => toSafeStlName("..stl")).toThrow(/not an STL file name/);
  });

  test("adding the same name again replaces it", () => {
    const first = addStlFile({}, "a.stl", boxStl(1, 1, 1)).files;
    const second = addStlFile(first, "a.stl", boxStl(2, 2, 2)).files;
    expect(summarizeStlFiles(second)[0].size).toEqual({ width: 2, depth: 2, height: 2 });
  });

  test("a file that is not an STL, or is too big, is refused with the reason", () => {
    expect(() => addStlFile({}, "a.stl", new TextEncoder().encode("hello").buffer as ArrayBuffer)).toThrow(/a.stl is not a valid STL file/);
    expect(() => addStlFile({}, "big.stl", new ArrayBuffer(MAX_STL_FILE_BYTES + 1))).toThrow(/at most 3 MB/);
    const full = { x1: "A".repeat(Math.floor((MAX_STL_TOTAL_BYTES * 4) / 3) - 8) };
    expect(() => addStlFile(Object.fromEntries(Object.entries(full).map(([_, v]) => ["x1.stl", v])), "a.stl", boxStl(1, 1, 1))).toThrow(new RegExp(`only room for ${MAX_STL_TOTAL_BYTES / 1048576} MB`));
  });

  test("remove takes a file out", () => {
    const { files } = addStlFile({}, "a.stl", boxStl(1, 1, 1));
    expect(removeFile(files, "a.stl")).toEqual({});
    expect(removeFile(files, "zzz.stl")).toEqual(files);
  });

  test("bytesOf counts what the base64 stands for", () => {
    expect(bytesOf("")).toBe(0);
    expect(bytesOf("QQ==")).toBe(1);
    expect(bytesOf("QUI=")).toBe(2);
    expect(bytesOf("QUJD")).toBe(3);
  });
});

describe("the import block", () => {
  const files = () => addStlFile(addStlFile({}, "box.stl", boxStl(10, 20, 30)).files, "tri.stl", triangleStl()).files;
  const run = (blocks: Block[], f = files()) => runProgram(k, oneScript(blocks), f);

  test("brings the part in, as it was made", () => {
    const r = run([b("import", { file: "box.stl" })]);
    expect(r.problem).toBeUndefined();
    expect(r.shapes.map((s) => s.name)).toEqual(["import"]);
    expect(r.combined!.volume()).toBeCloseTo(6000);
    const { min, max } = r.combined!.bounds();
    expect([max[0] - min[0], max[1] - min[1], max[2] - min[2]]).toEqual([10, 20, 30].map((v) => expect.closeTo(v, 4)));
  });

  test("scale changes its size (25.4 is inches), and centre puts its middle on the origin", () => {
    expect(run([b("import", { file: "box.stl", scale: "2" })]).combined!.volume()).toBeCloseTo(6000 * 8);
    const moved = b("transform", { x: "100", y: "0", z: "0" }, [b("import", { file: "box.stl", center: true })]);
    const { min, max } = run([moved]).combined!.bounds();
    expect([min[0], max[0]]).toEqual([expect.closeTo(95, 4), expect.closeTo(105, 4)]);
    expect(run([b("import", { file: "box.stl", scale: "0" })]).problem!.message).toMatch(/scale: must be more than zero/);
  });

  test("it is a shape like any other: it can be moved, mirrored, combined, repeated", () => {
    const r = run([b("subtract", { name: "cut" }, [b("import", { file: "box.stl" }), b("cylinder", { name: "hole", r: "2", h: "100" })])]);
    expect(r.problem).toBeUndefined();
    expect(r.combined!.volume()).toBeLessThan(6000);
    const row = run([b("repeat", { times: "3", counter: "i" }, [b("transform", { x: "i * 20" }, [b("import", { file: "box.stl" })])])]);
    expect(row.combined!.volume()).toBeCloseTo(18000);
  });

  test("the file is read once for a whole run, however often it is used", () => {
    let builds = 0;
    const counting = { ...k, fromMesh: (m: MeshData) => (builds++, k.fromMesh(m)) } as Kernel;
    runProgram(counting, oneScript([b("repeat", { times: "5", counter: "i" }, [b("transform", { x: "i * 20" }, [b("import", { file: "box.stl" })])])]), files());
    expect(builds).toBe(1);
  });

  test("what is wrong with the file is said, naming the files there are", () => {
    const none = b("import", { file: "" });
    {
      const found = run([none]).problem!;
      expect(found.blockId).toBe(none.id);
      expect(found.message).toMatch(/choose a file/);
    }
    expect(run([b("import", { file: "" })], {}).problem!.message).toMatch(/choose a file/);
    expect(run([b("import", { file: "nope.stl" })]).problem!.message).toMatch(/no file called "nope\.stl"/);
    expect(run([b("import", { file: "nope.stl" })], {}).problem!.message).toMatch(/choose \"Import STL file...\" to add one/);
    expect(run([b("import", { file: "tri.stl" })]).problem!.message).toMatch(/not a closed solid/);
  });
});
