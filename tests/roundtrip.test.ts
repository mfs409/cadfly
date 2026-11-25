import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { type ProjectHost, createProject } from "../src/cadfly/app/project";
import { EXAMPLES, exampleById } from "../src/cadfly/examples";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { parseProject, serializeProject, validateProgram } from "../src/cadfly/language/format";
import { dropBlocks, takeBlock } from "../src/cadfly/language/edit";
import { acceptsInScript, allBlocks, canHold, canHoldInScript } from "../src/cadfly/language/program";
import { runProgram } from "../src/cadfly/language/run";
import { applyOps, type Op } from "../src/cadfly/assistant/ops";
import type { Block, Program } from "../src/cadfly/language/types";
import { acceptingPoints, layoutProgram } from "../src/cadfly/ui/layout";
import { randomEdit, seeded } from "./helpers/randomEdits";

/**
 * That every project the app can make is a file the app can open again: saving
 * and loading give back the very same blocks, whatever was done to the blocks
 * on the way there. The blocks come from the built-in examples, from random
 * sequences of the changes the editor makes (with a seed, so a failure can be
 * run again), from the assistant's operations, and from the project's own
 * undo, redo and stored copy.
 */

let kernel: Kernel;
beforeAll(async () => {
  kernel = await createManifoldKernel();
});

/** The keys a block may have; any other key means an operation left something behind. */
const BLOCK_KEYS = new Set(["id", "kind", "args", "inner", "hidden", "disabled", "collapsed"]);
/** The keys a script may have. */
const SCRIPT_KEYS = new Set(["id", "name", "inputs", "at", "collapsed", "blocks"]);

/** Every key that a block or script has but should not, with where it is. */
function strayKeys(program: Program): string[] {
  const stray: string[] = [];
  for (const script of program) for (const key of Object.keys(script)) if (!SCRIPT_KEYS.has(key)) stray.push(`script ${script.id} has "${key}"`);
  for (const block of allBlocks(program)) for (const key of Object.keys(block)) if (!BLOCK_KEYS.has(key)) stray.push(`block ${block.id} has "${key}"`);
  return stray;
}

/**
 * Everything that must be true of a program the app has made: it is a valid
 * program, it has only the keys a program has, writing it and reading it gives
 * the same program, and running it does not crash (a program that makes no
 * sense may report a problem, which is not a crash).
 *
 * @param program The program.
 * @param run Whether to run it too.
 */
function expectOpenable(program: Program, run: boolean) {
  expect(() => validateProgram(program)).not.toThrow();
  expect(strayKeys(program)).toEqual([]);
  const text = serializeProject(program);
  expect(parseProject(text).program).toEqual(program);
  if (run) expect(() => runProgram(kernel, program)).not.toThrow();
}

describe("the built-in examples", () => {
  test.each(EXAMPLES.map((e) => [e.id, e] as const))("%s is saved and read back as the same blocks, and the copy builds", (_id, example) => {
    const program = structuredClone(example.program) as Program;
    const text = serializeProject(program);
    const back = parseProject(text).program;
    expect(back).toEqual(program);
    expect(strayKeys(back)).toEqual([]);
    const run = runProgram(kernel, back);
    expect(run.problem).toBeUndefined();
    expect(run.shapes.length + (run.flat ? 1 : 0)).toBeGreaterThan(0);
  });
});

/** The examples that the random changes start from: small, nested, with scripts, with a repeat of points, and with a solid. */
const STARTS = ["step-stool", "table-with-legs", "tree", "gear", "pyramid", "dowel-joint", "hinge", "ring-of-posts"];
/** The seeds each start is tried with. */
const SEEDS = [1, 2, 3];
/** How many changes are made in each run. */
const STEPS = 60;

describe("after any editing", () => {
  test.each(STARTS.flatMap((id) => SEEDS.map((seed) => [id, seed] as const)))("%s with seed %i stays a program that can be saved and opened", (id, seed) => {
    const random = seeded(seed);
    let program = structuredClone(exampleById(id)!.program) as Program;
    const log: string[] = [`start from ${id}`];
    for (let step = 1; step <= STEPS; step++) {
      const edit = randomEdit(program, random);
      if (!edit) continue;
      log.push(`${step}: ${edit.label}`);
      program = edit.program;
      try {
        expectOpenable(program, step % 6 === 0);
      } catch (e) {
        throw new Error(`seed ${seed}, after step ${step}: ${(e as Error).message}\n${log.join("\n")}`);
      }
    }
  });
});

describe("through the project's undo, redo and stored copy", () => {
  /** What the page's storage holds. */
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    });
    vi.stubGlobal("location", { search: "", href: "https://app.example/cadfly/", origin: "https://app.example", pathname: "/cadfly/", hash: "" });
    vi.stubGlobal("window", { history: { replaceState: () => undefined } });
    vi.stubGlobal("confirm", () => true);
  });

  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the project finish what it started before the page it ran in is taken away
    vi.unstubAllGlobals();
  });

  /** A page that does nothing with what the project tells it. */
  const quietHost = (): ProjectHost => ({ schedule: vi.fn(), filesReady: vi.fn(), reframe: vi.fn(), redraw: vi.fn(), clearNotice: vi.fn(), notify: vi.fn(), loaded: vi.fn() });

  test.each(STARTS.flatMap((id) => [4, 5].map((seed) => [id, seed] as const)))("%s with seed %i: every state the project passes through, and the copy it stores, can be opened", (id, seed) => {
    const random = seeded(seed);
    const project = createProject(quietHost());
    project.change(structuredClone(exampleById(id)!.program) as Program);
    const log: string[] = [`start from ${id}`];
    for (let step = 1; step <= STEPS; step++) {
      const pick = random();
      if (pick < 0.15 && project.canUndo()) {
        log.push(`${step}: undo`);
        project.undo();
      } else if (pick < 0.25 && project.canRedo()) {
        log.push(`${step}: redo`);
        project.redo();
      } else {
        const edit = randomEdit(project.program(), random);
        if (!edit) continue;
        log.push(`${step}: ${edit.label}`);
        project.change(edit.program);
      }
      try {
        expectOpenable(project.program(), false);
        const text = stored.get("cadfly.program");
        expect(text).toBeDefined();
        expect(parseProject(text!).program).toEqual(project.program());
      } catch (e) {
        throw new Error(`seed ${seed}, after step ${step}: ${(e as Error).message}\n${log.join("\n")}`);
      }
    }
  });
});

describe("after the assistant's operations", () => {
  /** A block of the program, given its kind, in the order they come. */
  const firstOf = (program: Program, kind: string): Block => allBlocks(program).find((b) => b.kind === kind)!;

  test("operations of every kind leave a program that can be saved and opened", () => {
    let program = structuredClone(exampleById("table-with-legs")!.program) as Program;
    /** Apply the operations, and check the program they leave. */
    const apply = (ops: Op[]) => {
      program = applyOps(program, ops).program;
      expectOpenable(program, true);
    };
    apply([{ op: "append", blocks: "box name=extra w=10 d=10 h=5" }]);
    apply([{ op: "set", block: firstOf(program, "box").id, field: "w", value: "30" }]);
    apply([{ op: "wrap", blocks: [firstOf(program, "box").id], holder: "transform z=5" }]);
    apply([{ op: "insert_after", block: firstOf(program, "box").id, blocks: "cylinder r=3 h=8" }]);
    apply([{ op: "script", name: "peg", inputs: "r, x", blocks: "cylinder r=r h=10 x=x" }]);
    apply([{ op: "append", blocks: 'use name=peg values="2, 5"' }]);
    apply([{ op: "append", blocks: "set name=width value=40", to: "globals" }]);
    apply([{ op: "insert_into", block: firstOf(program, "transform").id, blocks: "sphere r=2" }]);
    apply([{ op: "unwrap", block: firstOf(program, "transform").id }]);
    apply([{ op: "delete", block: firstOf(program, "cylinder").id }]);
    apply([{ op: "clear" }]);
    expect(program.map((s) => s.name)).toEqual(["build"]);
  });

  test("operations on an outline with a repeat of points leave a program that can be saved and opened", () => {
    let program = structuredClone(exampleById("gear")!.program) as Program;
    const polygon = firstOf(program, "polygon");
    program = applyOps(program, [{ op: "insert_into", block: polygon.id, blocks: "point u=1 v=1" }]).program;
    expectOpenable(program, true);
    program = applyOps(program, [{ op: "delete", block: firstOf(program, "repeat").id }]).program;
    expectOpenable(program, true);
  });
});

/**
 * Mistakes that these tests found. The editor once decided where a carried block
 * may go from its kind alone, so a repeat was accepted among shapes and among
 * points alike, whatever it held, and a drop could write a file that cannot be
 * opened. Now what is inside a carried block counts too.
 */
describe("where a repeat may be dropped depends on what it holds", () => {
  /** The layout of a program, as the editor draws it, to ask for its drop points. */
  const layoutOf = (program: Program) => layoutProgram(program, { x: 1, y: 2, width: 8, measure: (t) => t.length * 0.1 });

  test("a repeat of points carried out of its outline is not offered a place in a script, and still is one in the outline", () => {
    const program = structuredClone(exampleById("gear")!.program) as Program;
    const repeat = allBlocks(program).find((b) => b.kind === "repeat")!;
    const outline = allBlocks(program).find((b) => b.kind === "polygon")!;
    const taken = takeBlock(program, repeat.id);
    expect(acceptsInScript(program[0], repeat.kind)).toBe(true); // by kind alone a script would take it
    expect(canHoldInScript(taken.blocks, program[0])).toBe(false); // with the points in it, it does not
    const offered = acceptingPoints(layoutOf(taken.program), taken.program, taken.blocks);
    expect(offered.some((p) => "scriptId" in p)).toBe(false);
    expect(offered.some((p) => "parentId" in p && p.parentId === outline.id)).toBe(true);
    // the place that the kind alone would have offered makes a file that cannot be opened
    expect(() => validateProgram(dropBlocks(taken.program, { scriptId: program[0].id, index: 0 }, taken.blocks))).toThrow(/point block cannot go inside a repeat block/);
    expectOpenable(dropBlocks(taken.program, { parentId: outline.id, index: 0 }, taken.blocks), false);
  });

  test("a repeat of shapes is not offered a place inside an outline, and still is one in a script", () => {
    const program = structuredClone(exampleById("gear")!.program) as Program;
    const outline = allBlocks(program).find((b) => b.kind === "polygon")!;
    const repeat: Block = { id: "b900", kind: "repeat", args: { times: "2", counter: "i" }, inner: [{ id: "b901", kind: "box", args: {} }] };
    expect(canHold([repeat], outline.kind, "point")).toBe(false);
    const offered = acceptingPoints(layoutOf(program), program, [repeat]);
    expect(offered.some((p) => "parentId" in p && p.parentId === outline.id)).toBe(false);
    expect(offered.some((p) => "scriptId" in p)).toBe(true);
    expect(() => validateProgram(dropBlocks(program, { parentId: outline.id, index: 0 }, [repeat]))).toThrow(/box block cannot go inside a repeat block/);
    expectOpenable(dropBlocks(program, { scriptId: program[0].id, index: 0 }, [repeat]), false);
  });
});
