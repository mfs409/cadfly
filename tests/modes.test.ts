import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import { buildMessages, examplesFor, systemPrompt } from "../src/cadfly/assistant/prompt";
import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { COMMANDS, commandById } from "../src/cadfly/language/commands";
import { parseProject, serializeProject } from "../src/cadfly/language/format";
import { layoutProgram } from "../src/cadfly/ui/layout";
import { EVERYTHING, UI_MODES, allowsScripts, canDropFree, hiddenKindsUsed, modeByName, offeredKinds, offers } from "../src/cadfly/ui/modes";
import type { Block, Program } from "../src/cadfly/language/types";
import { runProgram } from "../src/cadfly/language/run";
import { ask, checkerFor } from "../src/cadfly/assistant/assistant";
import { ScriptedBackend } from "./helpers/scripted";
import { oneScript, topBlocks } from "./helpers/script-helpers";
import { blk, box } from "./helpers/blocks";

/**
 * Modes: which blocks, switches and scripts the palette, the layout and the
 * assistant offer in each.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const named = (n: string) => modeByName(n)!;
const measure = (t: string) => t.length * 0.1;

describe("the list of modes", () => {
  test("each has a unique name, and every block it names exists, once", () => {
    const names = UI_MODES.map((m) => m.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const { name, spec } of UI_MODES) {
      expect(new Set(spec.blocks).size, name).toBe(spec.blocks.length);
      for (const kind of spec.blocks) expect(commandById(kind), `${name}: ${kind}`).toBeDefined();
    }
  });

  test("the modes grow: what an earlier mode offers, a later one offers too", () => {
    for (let i = 1; i < UI_MODES.length; i++) {
      for (const kind of offeredKinds(UI_MODES[i - 1].spec)) expect(offers(UI_MODES[i].spec, kind), `${UI_MODES[i].name}: ${kind}`).toBe(true);
    }
  });

  test("the last mode offers everything, and a mode can be found by name in any case", () => {
    expect(UI_MODES.at(-1)!.spec).toBe(EVERYTHING);
    expect(COMMANDS.every((c) => offers(EVERYTHING, c.id))).toBe(true);
    expect(modeByName("  STARTER ")).toBe(named("Starter"));
    expect(modeByName("nonsense")).toBeUndefined();
  });

  test("the first mode is small, and a block it does not list is not offered", () => {
    const first = UI_MODES[0].spec;
    expect(offeredKinds(first).length).toBeLessThan(offeredKinds(undefined).length);
    expect(offers(first, "extrude")).toBe(false);
    expect(offers(undefined, "extrude")).toBe(true); // no mode: everything
  });

  test("every block a mode offers has a way to be placed: a palette tab for its category, and no piece without its holder", () => {
    for (const { name, spec } of UI_MODES) {
      if (offers(spec, "polygon")) expect(offers(spec, "point"), `${name}: a polygon needs points`).toBe(true);
    }
  });
});

describe("the shape of a mode", () => {
  test("the switches and scripts are settings of their own: no block kind can be mistaken for them", () => {
    const spec = { blocks: [], switches: true, scripts: true };
    expect(offers(spec, "scripts")).toBe(false);
    expect(offers(spec, "switches")).toBe(false);
    expect([...EVERYTHING.blocks].sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });

  test("each mode says whether it has the switches: only the first does not", () => {
    expect(UI_MODES.map((m) => [m.name, m.spec.switches])).toEqual([["First steps", false], ["Starter", true], ["Builder", true], ["Everything", true]]);
    expect(UI_MODES.map((m) => [m.name, m.spec.scripts])).toEqual([["First steps", false], ["Starter", false], ["Builder", true], ["Everything", true]]);
  });
});

describe("scripts in a mode", () => {
  test("the early modes have only build, and the later ones have scripts; with no mode there are scripts", () => {
    expect(allowsScripts(undefined)).toBe(true);
    expect(allowsScripts(named("First steps"))).toBe(false);
    expect(allowsScripts(named("Starter"))).toBe(false);
    expect(allowsScripts(named("Builder"))).toBe(true);
    expect(allowsScripts(EVERYTHING)).toBe(true);
    expect(named("Builder").scripts).toBe(true);
  });

  test("a later mode offers no define block: scripts take its place", () => {
    expect(commandById("define")).toBeUndefined();
    for (const { spec } of UI_MODES) expect(Object.keys(spec.blocks)).not.toContain("define");
  });

  test("blocks dropped in empty space start a global script only in a mode that has scripts, and only if they are all set blocks", () => {
    const setBlock = blk("s", "set", { name: "w", value: "1" });
    const boxBlock = blk("b", "box");
    for (const mode of [undefined, named("Builder"), EVERYTHING]) {
      expect(canDropFree(mode, [setBlock])).toBe(true);
      expect(canDropFree(mode, [setBlock, blk("t", "set")])).toBe(true);
      expect(canDropFree(mode, [boxBlock])).toBe(false);
      expect(canDropFree(mode, [setBlock, boxBlock])).toBe(false);
      expect(canDropFree(mode, [])).toBe(false);
    }
    for (const mode of [named("First steps"), named("Starter")]) {
      expect(canDropFree(mode, [setBlock]), "refused in an early mode, whatever the block").toBe(false);
      expect(canDropFree(mode, [boxBlock])).toBe(false);
    }
  });

  test("the instructions to the model mention scripts only in a mode that has them", () => {
    expect(systemPrompt({ mode: named("First steps") })).not.toContain('"op":"script"');
    expect(systemPrompt({ mode: named("Starter") })).not.toContain("globals");
    expect(systemPrompt({ mode: named("Builder") })).toContain('"op":"script"');
    expect(systemPrompt({ mode: named("Builder"), compact: false })).toContain("Other scripts run only where a use block names them");
    expect(systemPrompt()).toContain('"op":"script"');
  });

  test("the examples that use scripts are offered only where they can be used", () => {
    const text = (mode: ReturnType<typeof named> | undefined) => JSON.stringify(examplesFor(mode).map((e) => e.ops));
    expect(text(named("Builder"))).toContain('"op":"script"');
    expect(text(named("First steps"))).not.toContain('"op":"script"');
    expect(text(named("Starter"))).not.toContain('"op":"script"');
  });
});

describe("what a block shows", () => {
  const first = named("First steps");
  const lay = (b: Block, mode?: ReturnType<typeof named>) => layoutProgram(oneScript([b]), { x: 1, y: 2, width: 8, measure, mode }).blocks[0];
  const labels = (b: Block, mode?: ReturnType<typeof named>) => lay(b, mode).parts.filter((x) => x.kind === "label").map((x) => x.text);

  test("a block that is offered shows every one of its fields, in every mode", () => {
    for (const mode of [first, named("Starter"), undefined]) expect(labels(blk("b1", "box"), mode)).toEqual(["width", "depth", "height", "at x", "y", "z"]);
  });

  test("a block of a kind the mode does not offer shows every field too: a mode never hides what is there", () => {
    expect(labels(blk("b1", "extrude"), first).length).toBeGreaterThan(1);
    expect(labels(blk("b1", "extrude"), first)).toEqual(labels(blk("b1", "extrude")));
  });

  test("a block has no chip after its fields, in any mode", () => {
    for (const mode of UI_MODES) expect(lay(blk("b1", "box"), mode.spec).parts.map((p) => p.kind)).not.toContain("more");
  });

  test("a union shows its name as a caption in every mode", () => {
    for (const mode of [first, undefined]) expect(lay(blk("b1", "union", { name: "box and pin" }, []), mode).parts.map((p) => p.kind)).toContain("caption");
  });

  test("a project saved with the old 'more' setting still loads, and does not write it back", () => {
    const old = JSON.parse(serializeProject(oneScript([box("b1")])));
    old.program[0].blocks[0].expanded = true;
    const loaded = parseProject(JSON.stringify(old));
    expect("expanded" in loaded.program[0].blocks[0]).toBe(false);
    expect(serializeProject(loaded.program)).not.toContain("expanded");
  });
});

describe("layout in a mode", () => {
  const box = blk("b1", "box", { w: "40", d: "30", h: "5" });
  const lay = (blocks: Block[], mode?: ReturnType<typeof named>) => layoutProgram(oneScript(blocks), { x: 1, y: 2, width: 8, measure, mode }).blocks[0];

  test("a block draws all its fields in every mode", () => {
    const labels = (mode?: ReturnType<typeof named>) => lay([box], mode).parts.filter((x) => x.kind === "label").map((x) => x.text);
    expect(labels()).toEqual(["width", "depth", "height", "at x", "y", "z"]);
    expect(labels(named("First steps"))).toEqual(labels());
  });

  test("a block's word can be tapped to give it a caption in every mode, named or not", () => {
    const word = (b: Block, mode: ReturnType<typeof named>) => lay([b], mode).parts.find((x) => x.kind === "word")!;
    expect(word(blk("b1", "union", {}, []), named("First steps")).captionParam?.id).toBe("name");
    expect(word(blk("b1", "union", { name: "joined" }, []), named("First steps")).captionParam?.id).toBe("name");
  });

  test("a block the mode hides is still drawn, with every field", () => {
    const l = lay([blk("b1", "extrude", {}, [])], named("First steps"));
    expect(l.parts.filter((x) => x.kind === "label").map((x) => x.text)).toContain("twist");
  });
});

describe("the assistant in a mode", () => {
  const first = named("First steps");

  test("the instructions list only the blocks the mode offers, with all their fields", () => {
    const text = systemPrompt({ mode: first });
    expect(text).toContain("- box: ");
    expect(text).not.toContain("- extrude");
    expect(text).not.toContain("- repeat");
    expect(text).toMatch(/- box: [^\n]*w=width[^\n]*\./);
    expect(text).toMatch(/- box: [^\n]*\bx=/);
    expect(systemPrompt({ mode: first }).length).toBeLessThan(systemPrompt().length);
    expect(systemPrompt()).toContain("- extrude");
  });

  test("the worked examples are those that use only what the mode offers", () => {
    const some = examplesFor(first);
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(WORKED_EXAMPLES.length);
    for (const ex of some) {
      const made = applyOps(ex.program, ex.ops).program;
      expect(hiddenKindsUsed(made, first), ex.user).toEqual([]);
    }
    expect(examplesFor(undefined)).toBe(WORKED_EXAMPLES);
    expect(buildMessages({ program: [], history: [], mode: first }, "a box").examplesOffered).toBe(some.length);
  });

  test("a block the mode hides cannot be added, and the message says what can", () => {
    expect(() => applyOps([], [{ op: "append", blocks: "extrude" }], { mode: first })).toThrow(/the extrude block is not available now \(the blocks you may use are .*box.*\)/);
    expect(() => applyOps([], [{ op: "append", blocks: "box nope=5" }], { mode: first })).toThrow(/box block has no field "nope" \(its fields are name, w, d, h, x, y, z\)/);
    expect(applyOps([], [{ op: "append", blocks: "box x=5" }], { mode: first }).program).toHaveLength(1);
    expect(() => applyOps([], [{ op: "wrap", blocks: ["b1"], holder: "extrude" }], { mode: first })).toThrow();
    expect(applyOps([], [{ op: "append", blocks: "box w=5" }], { mode: first }).program).toHaveLength(1);
    // with no mode, anything goes
    expect(applyOps([], [{ op: "append", blocks: "extrude" }]).program).toHaveLength(1);
  });

  test("a hidden block can be edited when it is already there: a mode limits what is added", () => {
    const p: Program = oneScript([blk("b1", "extrude", { height: "5" }, [blk("b2", "rectangle")])]);
    expect(applyOps(p, [{ op: "set", block: "b1", field: "height", value: "8" }], { mode: first }).program[0].blocks[0].args.height).toBe("8");
  });

  test("ask() holds the model to the mode: it is told, and gets a repair round", async () => {
    const backend = new ScriptedBackend([
      JSON.stringify({ ops: [{ op: "append", blocks: "extrude height=5\n  rectangle" }], reply: "Made a plate." }),
      JSON.stringify({ ops: [{ op: "append", blocks: "box w=40 d=30 h=5" }], reply: "Made a box." }),
    ]);
    const out = await ask(backend, checkerFor(k), { program: [], history: [], mode: first }, "a plate");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.tries[0].problem?.message).toMatch(/the extrude block is not available now/);
    expect(topBlocks(out.program).map((b) => b.kind)).toEqual(["box"]);
    expect(runProgram(k, out.program).problem).toBeUndefined();
  });
});
