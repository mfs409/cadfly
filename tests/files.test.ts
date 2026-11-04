import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel, MeshData } from "../src/cadfly/geometry/kernel";
import { writeStl } from "../src/cadfly/geometry/stl";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, addFile, bytesOf, describeFiles, fileName, removeFile, validateFiles } from "../src/cadfly/language/files";
import { parseProgram, parseProject, serializeProgram, serializeProject } from "../src/cadfly/language/format";
import { runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";

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
    const { files, info } = addFile({}, "gear.stl", boxStl(10, 20, 30));
    expect(Object.keys(files)).toEqual(["gear.stl"]);
    expect(info).toMatchObject({ name: "gear.stl", triangles: 12 });
    expect(info.size).toEqual([10, 20, 30]);
    expect(info.bytes).toBe(84 + 12 * 50);
    expect(describeFiles(files)).toEqual([info]);
  });

  test("the name is made safe, and must be an STL name", () => {
    expect(fileName("C:\\parts\\My Gear (1).STL")).toBe("My_Gear__1_.STL");
    expect(fileName("/tmp/a-b.c.stl")).toBe("a-b.c.stl");
    expect(() => fileName("notes.txt")).toThrow(/not an STL file name/);
    expect(() => fileName("..stl")).toThrow(/not an STL file name/);
  });

  test("adding the same name again replaces it", () => {
    const first = addFile({}, "a.stl", boxStl(1, 1, 1)).files;
    const second = addFile(first, "a.stl", boxStl(2, 2, 2)).files;
    expect(describeFiles(second)[0].size).toEqual([2, 2, 2]);
  });

  test("a file that is not an STL, or is too big, is refused with the reason", () => {
    expect(() => addFile({}, "a.stl", new TextEncoder().encode("hello").buffer as ArrayBuffer)).toThrow(/a.stl is not a valid STL file/);
    expect(() => addFile({}, "big.stl", new ArrayBuffer(MAX_FILE_BYTES + 1))).toThrow(/at most 3 MB/);
    const full = { x1: "A".repeat(Math.floor((MAX_TOTAL_BYTES * 4) / 3) - 8) };
    expect(() => addFile(Object.fromEntries(Object.entries(full).map(([_, v]) => ["x1.stl", v])), "a.stl", boxStl(1, 1, 1))).toThrow(/only room for 8 MB/);
  });

  test("remove takes a file out", () => {
    const { files } = addFile({}, "a.stl", boxStl(1, 1, 1));
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

describe("the project file carries the files", () => {
  const program = [b("import", { file: "a.stl" })];

  test("a project with files round trips, and one without stays as plain as before", () => {
    const { files } = addFile({}, "a.stl", boxStl(4, 4, 4));
    const parsed = parseProject(serializeProject(program, files));
    expect(parsed.program).toEqual(program);
    expect(parsed.files).toEqual(files);
    expect(JSON.parse(serializeProject(program)).files).toBeUndefined();
    expect(JSON.parse(serializeProgram(program)).files).toBeUndefined();
    expect(parseProject(serializeProgram(program)).files).toEqual({});
  });

  test("parseProgram still reads such a file, and ignores the files", () => {
    const { files } = addFile({}, "a.stl", boxStl(4, 4, 4));
    expect(parseProgram(serializeProject(program, files))).toEqual(program);
  });

  test("files read from a project are checked", () => {
    const text = (files: unknown) => JSON.stringify({ blocks: 1, program: [], files });
    expect(() => parseProject(text([]))).toThrow(/files must be/);
    expect(() => parseProject(text({ "a.txt": "QQ==" }))).toThrow(/not an STL file name/);
    expect(() => parseProject(text({ "a.stl": "not base64!" }))).toThrow(/must be base64/);
    expect(() => parseProject(text({ "a.stl": 5 }))).toThrow(/must be base64/);
    expect(() => validateFiles({ "a.stl": "QQ==" })).not.toThrow();
  });
});

describe("the import block", () => {
  const files = () => addFile(addFile({}, "box.stl", boxStl(10, 20, 30)).files, "tri.stl", triangleStl()).files;
  const run = (blocks: Block[], f = files()) => runProgram(k, blocks, f);

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
    runProgram(counting, [b("repeat", { times: "5", counter: "i" }, [b("transform", { x: "i * 20" }, [b("import", { file: "box.stl" })])])], files());
    expect(builds).toBe(1);
  });

  test("what is wrong with the file is said, naming the files there are", () => {
    const none = b("import", { file: "" });
    expect(run([none]).problem).toEqual({ blockId: none.id, message: "file: choose a file (box.stl, tri.stl)" });
    expect(run([b("import", { file: "" })], {}).problem!.message).toBe("file: choose a file (open its file list and choose \"Import STL file...\")");
    expect(run([b("import", { file: "nope.stl" })]).problem!.message).toBe('file: there is no file called "nope.stl" (the files are box.stl, tri.stl)');
    expect(run([b("import", { file: "nope.stl" })], {}).problem!.message).toMatch(/choose \"Import STL file...\" to add one/);
    expect(run([b("import", { file: "tri.stl" })]).problem!.message).toMatch(/not a closed solid/);
  });
});
