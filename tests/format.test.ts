import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { setScriptFold } from "../src/cadfly/language/edit";
import { createEmptyProgram } from "../src/cadfly/language/program";
import { PROJECT_EXTENSION, PROJECT_FILE_NAME, isProjectFileName, parseProject, serializeProject, validateProgram } from "../src/cadfly/language/format";
import { runProgram, type RunResult } from "../src/cadfly/language/run";
import type { Block, Program } from "../src/cadfly/language/types";
import { oneScript, topBlocks } from "./helpers/script-helpers";
import { toBase64, writeStl } from "../src/cadfly/geometry/stl";
import { addStlFile, validateStlFiles } from "../src/cadfly/language/files";
import { blk, box, set, three } from "./helpers/blocks";

/**
 * Saving, loading and validating a project: its scripts, its blocks and the STL
 * files it carries.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

let n = 0;

/** A block, with an id, in as few characters as possible */
const b = (kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({
  id: `b${++n}`,
  kind,
  args,
  ...(inner ? { inner } : {}),
});

const vol = (r: RunResult) => r.combined!.volume();
const names = (r: RunResult) => r.shapes.map((s) => s.name);

/** An STL file of a box, as the bytes of a file */
const boxStl = (w: number, d: number, h: number) => writeStl(k.box(w, d, h).mesh());

describe("the file", () => {
  test("places, folds, names and inputs are saved and read back", () => {
    const p = setScriptFold(three(), "s3", true);
    expect(parseProject(serializeProject(p)).program).toEqual(p);
    expect(JSON.parse(serializeProject(p)).program[2]).toMatchObject({ name: "c", inputs: "w", at: { x: 6, y: 0 }, collapsed: true });
  });

  test("a place has to be numbers of sensible size", () => {
    const fails = (script: unknown, m: RegExp) => expect(() => validateProgram([script])).toThrow(m);
    const blocks = [box("a")];
    const build = { id: "s1", name: "build" };
    fails({ ...build, at: { x: "1", y: 2 }, blocks }, /at must be an x and a y/);
    fails({ ...build, at: { x: 1 }, blocks }, /at must be an x and a y/);
    fails({ ...build, at: { x: 1, y: 1e9 }, blocks }, /no bigger than/);
    fails({ ...build, at: { x: NaN, y: 1 }, blocks }, /at must be/);
    fails({ ...build, at: null, blocks }, /at must be/);
    expect(() => validateProgram([{ ...build, at: { x: 1, y: 2 }, collapsed: true, blocks }])).not.toThrow();
  });

  test("a script has to be an object with a list of blocks, and a fold that is true or false", () => {
    const fails = (p: unknown, m: RegExp) => expect(() => validateProgram(p)).toThrow(m);
    fails({}, /list of scripts/);
    fails([box("a")], /script 1: blocks must be a list/); // a block where a script goes
    fails(["x"], /script 1 must be an object/);
    fails([null], /script 1 must be an object/);
    fails([[box("a")]], /script 1 must be an object/);
    fails([{ id: "s1", name: "build", blocks: {} }], /script "build": blocks must be a list/);
    fails([{ id: "s1", name: "build", blocks: [box("a")], collapsed: "yes" }], /collapsed must be true or false/);
    expect(() => validateProgram(createEmptyProgram())).not.toThrow(); // build may be empty
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [] }, { id: "s2", name: "f", blocks: [] }])).not.toThrow(); // and so may a function
  });

  test("a program needs exactly one build", () => {
    expect(() => validateProgram([])).toThrow(/needs a script called "build"/);
    expect(() => validateProgram([{ id: "s1", name: "f", blocks: [box("a")] }])).toThrow(/needs a script called "build"/);
    expect(() => validateProgram([{ id: "s1", blocks: [set("g")] }])).toThrow(/needs a script called "build"/);
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [] }, { id: "s2", name: "build", blocks: [] }])).toThrow(/script "build": the name is used by another script/);
    expect(() => validateProgram([{ id: "s1", name: "build", inputs: "w", blocks: [] }])).toThrow(/build has no inputs/);
  });

  test("a script with no name holds only set blocks, at least one, and has no inputs", () => {
    const build = { id: "s1", name: "build", blocks: [] };
    expect(() => validateProgram([build, { id: "g1", blocks: [set("g1"), set("g2", "d", "w * 2")] }])).not.toThrow();
    expect(() => validateProgram([build, { id: "g1", blocks: [] }])).toThrow(/script 2: blocks must be a list with at least one block/);
    expect(() => validateProgram([build, { id: "g1", blocks: [box("a")] }])).toThrow(/block "a": a box block cannot be in a global script \(only set blocks can\)/);
    expect(() => validateProgram([build, { id: "g1", blocks: [set("g"), blk("t", "transform")] }])).toThrow(/transform block cannot be in a global script/);
    expect(() => validateProgram([build, { id: "g1", inputs: "w", blocks: [set("g")] }])).toThrow(/a global script has no inputs/);
    // a block inside a block is still only a set in a global script: a set holds nothing, so there is nowhere for another
    expect(() => validateProgram([build, { id: "g1", blocks: [blk("p", "point")] }])).toThrow(/belongs inside another block|cannot be in a global script/);
  });

  test("a named script has a name made like a variable name, used once, and inputs that are names", () => {
    const build = { id: "s1", name: "build", blocks: [] };
    const bad = (script: unknown, m: RegExp) => expect(() => validateProgram([build, script]), JSON.stringify(script)).toThrow(m);
    bad({ id: "s2", name: "2x", blocks: [] }, /a name uses letters, digits and _/);
    bad({ id: "s2", name: "has space", blocks: [] }, /a name uses letters/);
    bad({ id: "s2", name: 7, blocks: [] }, /a name uses letters/);
    bad({ id: "s2", name: "pi", blocks: [] }, /built in to expressions/);
    bad({ id: "s2", name: "f", blocks: [] , inputs: 4 }, /inputs must be text/);
    bad({ id: "s2", name: "f", inputs: "w, w", blocks: [] }, /inputs: an input name is used twice/);
    bad({ id: "s2", name: "f", inputs: "w, 2h", blocks: [] }, /inputs: "2h" is not a name/);
    expect(() => validateProgram([build, { id: "s2", name: "f", blocks: [] }, { id: "s3", name: "f", blocks: [] }])).toThrow(/script "f": the name is used by another script/);
    expect(() => validateProgram([build, { id: "s2", name: "f", inputs: "w, h", blocks: [box("a")] }, { id: "s3", name: "g_2", blocks: [] }])).not.toThrow();
  });

  test("every script has an id, a short piece of text that no other script has", () => {
    const build = { id: "s1", name: "build", blocks: [] };
    expect(() => validateProgram([build, { id: "s2", name: "f", blocks: [] }])).not.toThrow();
    expect(() => validateProgram([{ name: "build", blocks: [] }])).toThrow(/script "build": a script needs an id/);
    expect(() => validateProgram([{ id: "", name: "build", blocks: [] }])).toThrow(/a script needs an id/);
    expect(() => validateProgram([{ id: 4, name: "build", blocks: [] }])).toThrow(/a script needs an id/);
    expect(() => validateProgram([build, { blocks: [set("g")] }])).toThrow(/script 2: a script needs an id/);
    expect(() => validateProgram([build, { id: "s1", name: "f", blocks: [] }])).toThrow(/script "f": the id "s1" is used by another script/);
    expect(() => validateProgram([build, { id: "x".repeat(300), name: "f", blocks: [] }])).toThrow(/a script needs an id/);
    // a script id and a block id are different things: the same text may be both
    expect(() => validateProgram([{ id: "b1", name: "build", blocks: [box("b1")] }])).not.toThrow();
  });

  test("the blocks of every script are checked, and an id may not be used in two scripts", () => {
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [box("a")] }, { id: "s2", name: "f", blocks: [box("a")] }])).toThrow(/the id is used twice/);
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [box("a")] }, { id: "s2", name: "f", blocks: [blk("b", "teleport")] }])).toThrow(/unknown kind "teleport"/);
    expect(() => validateProgram([{ id: "s1", name: "build", blocks: [blk("p", "point")] }])).toThrow(/belongs inside another block/);
  });
});

describe("saving and loading programs", () => {
  const program = (): Program => oneScript([
    b("set", { name: "w", value: "40" }),
    b("extrude", { name: "plate", plane: "YZ", offset: "w / 2", height: "5" }, [
      b("rectangle", { u: "0", v: "0", w: "w", h: "w", rotate: "5", hole: false }),
      b("polygon", { hole: true }, [b("point", { u: "1", v: "1" }), b("point", { u: "2", v: "1" }), b("point", { u: "1", v: "2" })]),
    ]),
    { ...b("box", { name: "ghost" }), hidden: true },
  ]);

  test("a program round trips exactly", () => {
    const p = program();
    expect(parseProject(serializeProject(p)).program).toEqual(p);
  });

  test("what loads still runs the same", () => {
    const p = program();
    expect(vol(runProgram(k, oneScript(topBlocks(parseProject(serializeProject(p)).program).filter((x) => !x.hidden))))).toBeCloseTo(vol(runProgram(k, oneScript(topBlocks(p).filter((x) => !x.hidden)))));
  });

  test("files that are not programs get readable errors", () => {
    expect(() => parseProject("{")).toThrow(/not a valid block program/);
    expect(() => parseProject("{}")).toThrow(/not a block program file/);
    expect(() => parseProject('{"blocks":2,"program":[]}')).toThrow(/newer version/);
    expect(() => parseProject('{"blocks":1,"program":{}}')).toThrow(/list of scripts/);
  });

  test("blocks are checked against the command list", () => {
    // cast: the blocks are wrong on purpose, so they are not of the type of a block
    const fails = (blocks: unknown[], message: RegExp) => expect(() => validateProgram([{ id: "s1", name: "build", blocks }])).toThrow(message);
    fails([{ id: "a", kind: "teleport", args: {} }], /unknown kind "teleport"/);
    fails([{ id: "a", kind: "box", args: { colour: "red" } }], /has no field "colour"/);
    fails([{ id: "a", kind: "extrude", args: { hole: true } }], /has no field "hole"/);
    fails([{ id: "a", kind: "rectangle", args: { hole: "yes" } }], /"hole" must be true or false/);
    fails([{ id: "a", kind: "point", args: {} }], /belongs inside another block/);
    fails([{ id: "a", kind: "extrude", args: { plane: "AB" }, inner: [] }], /"plane" must be one of XY, XZ, YZ/);
    fails([{ id: "a", kind: "box", args: { w: 5 } }], /"w" must be text/);
    fails([{ id: "a", kind: "extrude", args: {}, inner: [{ id: "b", kind: "box", args: {} }] }], /a box block cannot go inside a extrude block/);
    fails([{ id: "a", kind: "extrude", args: {}, inner: [{ id: "a", kind: "circle", args: {} }] }], /id is used twice/);
    fails([{ id: "a", kind: "box", args: {}, inner: [] }], /cannot hold other blocks/);
    fails([{ id: "a", kind: "transform", args: {}, inner: [{ id: "b", kind: "point", args: {} }] }], /a point block cannot go inside a transform block/);
    fails([{ id: "a", kind: "transform", args: { names: "x" }, inner: [] }], /has no field "names"/);
    fails([{ id: "a", kind: "extrude", args: {}, inner: [{ id: "b", kind: "rectangle", args: { hole: "x" } }] }], /"hole" must be true or false/);
    fails([{ kind: "box", args: {} }], /no id/);
    fails([{ id: "a", kind: "box", args: { name: "x".repeat(300) } }], /too long/);
  });
});

describe("the project file carries the files", () => {
  const program = oneScript([b("import", { file: "a.stl" })]);

  test("a project with files round trips, and one without stays as plain as before", () => {
    const { files } = addStlFile({}, "a.stl", boxStl(4, 4, 4));
    const parsed = parseProject(serializeProject(program, files));
    expect(parsed.program).toEqual(program);
    expect(parsed.files).toEqual(files);
    expect(JSON.parse(serializeProject(program)).files).toBeUndefined();
    expect(parseProject(serializeProject(program)).files).toEqual({});
  });

  test("a file with no files field still loads", () => {
    const old = JSON.stringify({ blocks: 1, program });
    expect(parseProject(old)).toEqual({ program, files: {} });
  });

  test("files read from a project are checked", () => {
    const text = (files: unknown) => JSON.stringify({ blocks: 1, program: [{ id: "s1", name: "build", blocks: [] }], files });
    expect(() => parseProject(text([]))).toThrow(/files must be/);
    expect(() => parseProject(text({ "a.txt": "QQ==" }))).toThrow(/not an STL file name/);
    expect(() => parseProject(text({ "a.stl": "not base64!" }))).toThrow(/must be base64/);
    expect(() => parseProject(text({ "a.stl": 5 }))).toThrow(/must be base64/);
    expect(() => validateStlFiles({ "a.stl": toBase64(boxStl(1, 1, 1)) })).not.toThrow();
  });

  test("every file must be an STL that has triangles, and the error names the file", () => {
    const text = (files: unknown) => JSON.stringify({ blocks: 1, program: [{ id: "s1", name: "build", blocks: [] }], files });
    // base64 that is well formed but is not an STL ("hello")
    expect(() => validateStlFiles({ "a.stl": "aGVsbG8=" })).toThrow(/file "a.stl" is not a valid STL file/);
    expect(() => parseProject(text({ "ok.stl": toBase64(boxStl(1, 1, 1)), "bad.stl": "QQ==" }))).toThrow(/file "bad.stl" is not a valid STL file/);
    // a binary STL that says it has no triangles
    const empty = new Uint8Array(84).buffer;
    expect(() => validateStlFiles({ "e.stl": toBase64(empty) })).toThrow(/file "e.stl" has no triangles/);
    // the cheap checks come first: text that is not base64 is refused before anything is read
    expect(() => validateStlFiles({ "a.stl": "not base64!" })).toThrow(/must be base64/);
  });
});

describe("the project file's name", () => {
  test("a project file ends in .cadfly, in any case, with something before it", () => {
    expect(PROJECT_EXTENSION).toBe(".cadfly");
    expect(PROJECT_FILE_NAME).toBe("design.cadfly");
    expect(isProjectFileName("bracket.cadfly")).toBe(true);
    expect(isProjectFileName("My Plate.CADFLY")).toBe(true);
    expect(isProjectFileName(PROJECT_FILE_NAME)).toBe(true);
  });

  test("no other ending is a project file, the old ones included", () => {
    for (const name of ["design.blocks.json", "design.json", "plate.stl", "cadfly", ".cadfly", "plate.cadfly.txt", "plate.cadfly "]) expect(isProjectFileName(name), name).toBe(false);
  });
});
