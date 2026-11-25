import { describe, expect, test } from "vitest";
import { BUILD } from "../src/cadfly/language/types";
import { programFromText, readExample } from "../src/cadfly/examples/read";
import { EXAMPLES } from "../src/cadfly/examples";

/**
 * Reading an example's block text into its program: ids, ticks, notes and
 * scripts.
 */

describe("the blocks", () => {
  test("are numbered in the order they are written, an outer block before the ones inside it", () => {
    const [script] = programFromText([{ name: BUILD, text: "union name=u\n  box w=1\n  transform z=2\n    sphere r=3\ncylinder r=1" }]);
    const ids: string[] = [];
    const walk = (blocks: typeof script.blocks) => blocks.forEach((b) => (ids.push(`${b.id}:${b.kind}`), walk(b.inner ?? [])));
    walk(script.blocks);
    expect(ids).toEqual(["b1:union", "b2:box", "b3:transform", "b4:sphere", "b5:cylinder"]);
  });

  test("hold only the fields the text names, and no inner list when there is nothing inside", () => {
    const [script] = programFromText([{ text: "box name=plate w=40" }]);
    expect(script.blocks).toEqual([{ id: "b1", kind: "box", args: { name: "plate", w: "40" } }]);
  });

  test("have a tick that is true or false whether it is written bare or as a value", () => {
    const [script] = programFromText([{ text: "circle r=3 hole\ncircle r=3 hole=false\ncircle r=3 hole=true" }]);
    expect(script.blocks.map((b) => b.args.hole)).toEqual([true, false, true]);
  });

  test("keep hidden and disabled", () => {
    const [script] = programFromText([{ text: "transform z=1 disabled\n  box hidden" }]);
    expect(script.blocks[0]).toMatchObject({ disabled: true });
    expect(script.blocks[0].inner?.[0]).toMatchObject({ hidden: true });
  });

  test("leave out the notes that start with a hash, wherever they are", () => {
    const [script] = programFromText([{ text: "# a note\nunion\n  # another\n  box w=1" }]);
    expect(script.blocks).toHaveLength(1);
    expect(script.blocks[0].inner).toHaveLength(1);
  });
});

describe("the scripts", () => {
  test("are numbered in order, with the names and inputs they were given and none they were not", () => {
    const program = programFromText([{ text: "set name=a value=1" }, { name: BUILD, text: "box" }, { name: "leg", inputs: "x, y", text: "box x=x" }]);
    expect(program.map((s) => ({ id: s.id, name: s.name, inputs: s.inputs }))).toEqual([
      { id: "s1", name: undefined, inputs: undefined },
      { id: "s2", name: BUILD, inputs: undefined },
      { id: "s3", name: "leg", inputs: "x, y" },
    ]);
    expect("name" in program[0]).toBe(false);
  });

  test("keep counting the blocks from one script to the next", () => {
    const program = programFromText([{ text: "set name=a value=1" }, { name: BUILD, text: "box\nbox" }]);
    expect(program.flatMap((s) => s.blocks.map((b) => b.id))).toEqual(["b1", "b2", "b3"]);
  });
});

describe("an example", () => {
  test("written as the text of build alone is a program of just build", () => {
    const example = readExample({ id: "x", name: "X", description: "d", build: "box" });
    expect(example.program).toEqual([{ id: "s1", name: BUILD, blocks: [{ id: "b1", kind: "box", args: {} }] }]);
    expect(example).toMatchObject({ id: "x", name: "X", description: "d" });
  });

  test("written as scripts is the program of those scripts", () => {
    const example = readExample({ id: "x", name: "X", description: "d", scripts: [{ name: BUILD, text: "use name=leg values=1" }, { name: "leg", inputs: "x", text: "box w=x" }] });
    expect(example.program.map((s) => s.name)).toEqual([BUILD, "leg"]);
  });

  test("every example the app offers has a build script and block ids that are not repeated", () => {
    for (const e of EXAMPLES) {
      expect(e.program.some((s) => s.name === BUILD), e.id).toBe(true);
      const ids = e.program.flatMap((s) => s.blocks.flatMap(function all(b): string[] { return [b.id, ...(b.inner ?? []).flatMap(all)]; }));
      expect(new Set(ids).size, e.id).toBe(ids.length);
    }
  });
});
