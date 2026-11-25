import { beforeAll, describe, expect, test } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { addProgram } from "../src/cadfly/language/edit";
import { validateProgram } from "../src/cadfly/language/format";
import { allBlocks, isGlobalScript } from "../src/cadfly/language/program";
import { type RunResult, runProgram } from "../src/cadfly/language/run";
import type { Program } from "../src/cadfly/language/types";
import { EXAMPLES, exampleById } from "../src/cadfly/examples";
import { programFromText } from "../src/cadfly/examples/read";
import type { ScriptText } from "../src/cadfly/examples/types";

/**
 * Adding one whole program to another, as "Add to project" does with an example:
 * the added scripts keep working, names that clash are renamed along with their
 * uses, and a refused add changes nothing.
 */

/** The names of the global variables that a program sets, in order: read from the program itself, as a person would see them. */
const globalNames = (program: Program): string[] =>
  program.filter(isGlobalScript).flatMap((s) => s.blocks.filter((b) => b.kind === "set").map((b) => String(b.args.name)));

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

/** A program from block text, one entry per script */
const program = (...scripts: ScriptText[]): Program => programFromText(scripts);
/** The script called `build`, from block text */
const build = (text: string): ScriptText => ({ name: "build", text });

/** The names of a program's scripts, in order (a global script has none) */
const names = (p: Program) => p.map((s) => s.name);

/** The size of what a run built, as [width, depth, height] */
const size = (r: RunResult) => {
  const { min, max } = r.combined!.bounds();
  return [0, 1, 2].map((i) => Math.round((max[i] - min[i]) * 1e6) / 1e6);
};

/** The script with this name */
const script = (p: Program, name: string) => p.find((s) => s.name === name)!;

/** Check a program is a good one, and that every block id in it is different */
const good = (p: Program) => {
  validateProgram(p);
  const ids = allBlocks(p).map((b) => b.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(p.map((s) => s.id)).size).toBe(p.length);
};

const mine = () => program(build("box w=10 d=10 h=10"));
const other = () => program(build("cylinder r=4 h=20"));

describe("adding a program as a script", () => {
  test("its build goes into a new script, which the project's build uses at the end", () => {
    const before = mine();
    const copy = structuredClone(before);
    const { program: next, scriptName } = addProgram(before, other(), { title: "Pin post" });
    expect(before).toEqual(copy);
    expect(scriptName).toBe("pin_post");
    expect(names(next)).toEqual(["build", "pin_post"]);
    expect(script(next, "pin_post").blocks.map((b) => b.kind)).toEqual(["cylinder"]);
    const blocks = script(next, "build").blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["box", "use"]);
    expect(blocks[1].args).toMatchObject({ name: "pin_post", values: "" });
    good(next);
  });

  test("the result builds both: the project's shapes and the added ones", () => {
    const { program: next } = addProgram(mine(), other(), { title: "Pin" });
    const r = runProgram(k, next);
    expect(r.problem).toBeUndefined();
    expect(size(r)).toEqual([10, 10, 20]);
  });

  test("adding to a project with nothing in it, or adding twice, gives each its own script", () => {
    const empty: Program = [{ id: "s1", name: "build", blocks: [] }];
    const once = addProgram(empty, other(), { title: "Pin" });
    const twice = addProgram(once.program, other(), { title: "Pin" });
    expect(twice.scriptName).toBe("pin2");
    expect(names(twice.program)).toEqual(["build", "pin", "pin2"]);
    expect(script(twice.program, "build").blocks.map((b) => b.args.name)).toEqual(["pin", "pin2"]);
    good(twice.program);
  });

  test("every added block and script has a new id, none that the project uses", () => {
    const { program: next } = addProgram(mine(), program(build("union\n  box w=1 d=1 h=1\n  box w=2 d=2 h=2"), ), { title: "Pair" });
    good(next);
    expect(allBlocks(next)).toHaveLength(allBlocks(mine()).length + 4);
  });

  test("a title that is not a name is made into one", () => {
    expect(addProgram(mine(), other(), { title: "T-slot joint" }).scriptName).toBe("t_slot_joint");
    expect(addProgram(mine(), other(), { title: "3D thing" }).scriptName).toBe("part_3d_thing");
  });

  test("a program that is only a build can go straight into the project's build", () => {
    const { program: next, scriptName } = addProgram(mine(), other(), { title: "Pin", inline: true });
    expect(scriptName).toBeUndefined();
    expect(names(next)).toEqual(["build"]);
    expect(script(next, "build").blocks.map((b) => b.kind)).toEqual(["box", "cylinder"]);
    good(next);
  });

  test("one that has scripts of its own is added as a script even when inline is asked for", () => {
    const withScript = program({ name: "leg", inputs: "x", text: "box x=x" }, build("use name=leg values=3"));
    const { program: next, scriptName } = addProgram(mine(), withScript, { title: "Table", inline: true });
    expect(scriptName).toBe("table");
    expect(names(next)).toEqual(["build", "leg", "table"]);
  });

  test("a project with no build gets one", () => {
    const { program: next } = addProgram([], other(), { title: "Pin" });
    expect(names(next)).toEqual(["build", "pin"]);
    expect(script(next, "build").blocks.map((b) => b.kind)).toEqual(["use"]);
  });
});

describe("scripts with the same name", () => {
  const leg = () => program({ name: "leg", inputs: "x", text: "box w=2 d=2 h=5 x=x" }, build("use name=leg values=0\nuse name=leg values=10"));

  test("an added script that the project already has is renamed, and its uses with it", () => {
    const mineWithLeg = program({ name: "leg", inputs: "x", text: "box w=1 d=1 h=1 x=x" }, build("use name=leg values=0"));
    const before = structuredClone(mineWithLeg);
    const { program: next } = addProgram(mineWithLeg, leg(), { title: "Table" });
    expect(mineWithLeg).toEqual(before);
    expect(names(next)).toEqual(["leg", "build", "leg2", "table"]);
    expect(script(next, "leg").blocks[0].args.w).toBe("1");
    expect(script(next, "leg2").blocks[0].args.w).toBe("2");
    expect(script(next, "table").blocks.map((b) => b.args.name)).toEqual(["leg2", "leg2"]);
    // the project's own use is still its own leg
    expect(script(next, "build").blocks[0].args.name).toBe("leg");
    good(next);
  });

  test("the new name is one that nothing has: leg2 taken, so leg3", () => {
    const have = program({ name: "leg", inputs: "x", text: "box" }, { name: "leg2", inputs: "x", text: "box" }, build("box"));
    const { program: next } = addProgram(have, leg(), { title: "Table" });
    expect(names(next)).toContain("leg3");
    good(next);
  });

  test("the result builds the project's part and the added ones", () => {
    const mineWithLeg = program({ name: "leg", inputs: "x", text: "box w=1 d=1 h=1 x=x" }, build("use name=leg values=0"));
    const r = runProgram(k, addProgram(mineWithLeg, leg(), { title: "Table" }).program);
    expect(r.problem).toBeUndefined();
    expect(size(r)).toEqual([12, 2, 5]);
  });

  test("a script with a name the project does not have keeps it", () => {
    const { program: next } = addProgram(mine(), leg(), { title: "Table" });
    expect(names(next)).toEqual(["build", "leg", "table"]);
  });
});

describe("variables with the same name", () => {
  const sized = () =>
    program(
      { text: "set name=size value=3" },
      { name: "part", inputs: "size2", text: "box w=size2 d=size h=max(size, 1) x=size * 2" },
      build('set name=local value="size + 1"\nbox name=size w=size d=size h="local"\nuse name=part values="size"'),
    );
  const mineSized = () => program({ text: "set name=size value=10" }, build("box w=size d=size h=size"));

  test("an added global the project already has is renamed everywhere the added program says it", () => {
    const { program: next } = addProgram(mineSized(), sized(), { title: "Sized" });
    expect(globalNames(next)).toEqual(["size", "size3"]);
    const holder = script(next, "sized");
    expect(holder.blocks[0].args.value).toBe("size3 + 1");
    expect(holder.blocks[1].args).toMatchObject({ w: "size3", d: "size3", h: "local", name: "size" });
    expect(holder.blocks[2].args.values).toBe("size3");
    const part = script(next, "part");
    expect(part.blocks[0].args).toMatchObject({ w: "size2", d: "size3", h: "max(size3, 1)", x: "size3 * 2" });
    good(next);
  });

  test("the project's own variable keeps its value, and the added program uses its own", () => {
    const r = runProgram(k, addProgram(mineSized(), sized(), { title: "Sized" }).program);
    expect(r.problem).toBeUndefined();
    // the project's box is 10 everywhere; the added script's two shapes are small and are built from the added program's own size
    expect(r.shapes.map((s) => s.name)).toEqual(["box", "size", "part"]);
    expect(size(r)[2]).toBe(10);
  });

  test("a global the project does not have keeps its name, as a global script of its own", () => {
    const { program: next } = addProgram(mine(), sized(), { title: "Sized" });
    expect(globalNames(next)).toEqual(["size"]);
    expect(next.filter((s) => s.name === undefined)).toHaveLength(1);
    const r = runProgram(k, next);
    expect(r.problem).toBeUndefined();
  });

  test("words that mean something else are left alone: functions, the text a block shows, and a name's start", () => {
    const text = program({ text: "set name=size value=3" }, build('set name=r value="max(size, pi)"\nextrude name=size height=size\n  text text=size size=size'));
    const { program: next } = addProgram(mineSized(), text, { title: "Words" });
    const blocks = script(next, "words").blocks;
    expect(blocks[0].args.value).toBe("max(size2, pi)");
    expect(blocks[1].args).toMatchObject({ name: "size", height: "size2" });
    expect(blocks[1].inner![0].args).toMatchObject({ text: "size", size: "size2" });
  });

  test("a new name is chosen that the added program does not already use", () => {
    const busy = program({ text: "set name=size value=3\nset name=size2 value=4" }, build("box w=size d=size2 h=1"));
    const { program: next } = addProgram(mineSized(), busy, { title: "Busy" });
    expect(globalNames(next)).toEqual(["size", "size3", "size2"]);
  });
});

describe("files", () => {
  const importing = () => program(build("import file=part.stl"));

  test("a program that imports a file the project does not have is refused, and says which", () => {
    expect(() => addProgram(mine(), importing(), { title: "Part", files: {} })).toThrow(/part\.stl/);
    expect(() => addProgram(mine(), importing(), { title: "Part" })).toThrow(/does not have/);
  });

  test("one that imports a file the project has is added", () => {
    const { program: next } = addProgram(mine(), importing(), { title: "Part", files: { "part.stl": "x" } });
    expect(script(next, "part").blocks[0].args.file).toBe("part.stl");
  });
});

describe("the examples", () => {
  test("every example can be added to a project that has something in it, and to an empty one", () => {
    for (const example of EXAMPLES) {
      for (const base of [mine(), [{ id: "s1", name: "build", blocks: [] }] as Program]) {
        const { program: next } = addProgram(base, example.program, { title: example.name });
        good(next);
        expect(names(next).filter((n) => n === "build")).toHaveLength(1);
      }
    }
  });

  test("a joint's variables stay inside its script, so they never touch the project's", () => {
    const project = program({ text: "set name=size value=50" }, build("box w=size d=size h=5"));
    const example = exampleById("dowel-joint")!;
    const { program: next } = addProgram(project, example.program, { title: example.name });
    expect(globalNames(next)).toEqual(["size"]);
    const r = runProgram(k, next);
    expect(r.problem).toBeUndefined();
    expect(size(r)[0]).toBe(50);
  });

  test("adding a joint gives the project its scripts, with inputs, ready to use on its own parts", () => {
    const example = exampleById("dowel-joint")!;
    const { program: next } = addProgram(mine(), example.program, { title: example.name });
    const scripts = Object.fromEntries(next.filter((s) => s.name).map((s) => [s.name, s.inputs]));
    expect(scripts.dowel_hole).toBe("dowel, slack, depth, z");
    expect(scripts.dowel_pin).toBe("dowel, length, z");
    expect(Object.keys(scripts)).toContain("dowel_joint");
  });

  test("a project that has a script like the example's gets it renamed", () => {
    const example = exampleById("hinge")!;
    const once = addProgram(mine(), example.program, { title: example.name });
    const twice = addProgram(once.program, example.program, { title: example.name });
    good(twice.program);
    const r = runProgram(k, twice.program);
    expect(r.problem).toBeUndefined();
  });
});
