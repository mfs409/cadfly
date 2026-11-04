import { beforeAll, describe, expect, test } from "vitest";
import { applyOps } from "../src/cadfly/assistant/ops";
import { buildMessages, examplesFor, programView, systemPrompt } from "../src/cadfly/assistant/prompt";
import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { COMMANDS, commandById } from "../src/cadfly/language/commands";
import { setExpanded } from "../src/cadfly/language/edit";
import { parseProgram, serializeProgram, validateProgram } from "../src/cadfly/language/format";
import { hit, layoutProgram } from "../src/cadfly/language/layout";
import { EVERYTHING, EYE, UI_MODES, allowedField, exposure, hiddenKindsUsed, modeByName, moreChip, offeredKinds, shownParams } from "../src/cadfly/language/modes";
import type { Block, Program } from "../src/cadfly/language/types";
import { runProgram } from "../src/cadfly/language/run";
import { ask } from "../src/cadfly/assistant/assistant";
import { ScriptedBackend } from "./scripted";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id, kind, args, ...(inner ? { inner } : {}) });
const named = (n: string) => modeByName(n)!;
const measure = (t: string) => t.length * 0.1;

describe("the list of modes", () => {
  test("each has a unique name, and every block it names exists and has one of the three exposures", () => {
    const names = UI_MODES.map(([n]) => n.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const [name, spec] of UI_MODES) {
      for (const [kind, how] of Object.entries(spec)) {
        if (kind !== EYE) expect(commandById(kind), `${name}: ${kind}`).toBeDefined(); // the eye is listed like a block
        expect(["hidden", "partial", "full"], `${name}: ${kind}`).toContain(how);
      }
    }
  });

  test("the modes grow: what an earlier mode offers, a later one offers too", () => {
    for (let i = 1; i < UI_MODES.length; i++) {
      for (const kind of offeredKinds(UI_MODES[i - 1][1])) expect(exposure(UI_MODES[i][1], kind), `${UI_MODES[i][0]}: ${kind}`).not.toBe("hidden");
    }
  });

  test("the last mode offers everything in full, and a mode can be found by name in any case", () => {
    expect(UI_MODES.at(-1)![1]).toBe(EVERYTHING);
    expect(COMMANDS.every((c) => exposure(EVERYTHING, c.id) === "full")).toBe(true);
    expect(modeByName("  STARTER ")).toBe(named("Starter"));
    expect(modeByName("nonsense")).toBeUndefined();
  });

  test("the first mode is small, and a block it does not list is hidden", () => {
    const first = UI_MODES[0][1];
    expect(offeredKinds(first).length).toBeLessThan(10);
    expect(exposure(first, "extrude")).toBe("hidden");
    expect(exposure(undefined, "extrude")).toBe("full"); // no mode: everything
  });

  test("every block a mode offers has a way to be placed: a palette tab for its category, and no piece without its holder", () => {
    for (const [name, spec] of UI_MODES) {
      if (exposure(spec, "polygon") !== "hidden") expect(exposure(spec, "point"), `${name}: a polygon needs points`).not.toBe("hidden");
    }
  });
});

describe("what partial means", () => {
  test("a partly exposed block shows only the fields its partial list names", () => {
    const box = commandById("box")!;
    expect(shownParams(box, named("First steps")).map((p) => p.id)).toEqual(["w", "d", "h"]);
    expect(shownParams(box, named("Starter")).map((p) => p.id)).toEqual(["name", "w", "d", "h", "x", "y", "z"]);
    expect(shownParams(box, undefined)).toBe(box.params);
  });

  test("a field that is not at its default is shown anyway: a mode never hides what is there", () => {
    const box = commandById("box")!;
    const shown = shownParams(box, named("First steps"), blk("b1", "box", { x: "30", name: "plate" })).map((p) => p.id);
    expect(shown).toEqual(["name", "w", "d", "h", "x"]);
  });

  test("a block of a kind the mode hides shows all of its fields", () => {
    expect(shownParams(commandById("extrude")!, named("First steps"), blk("b1", "extrude")).length).toBe(commandById("extrude")!.params.length);
  });

  test("every partial list names real fields", () => {
    for (const c of COMMANDS) for (const id of c.partial ?? []) expect(c.params.map((p) => p.id), `${c.id}: ${id}`).toContain(id);
  });

  test("an empty partial list hides every field, the caption too: a union is just its word", () => {
    expect(shownParams(commandById("union")!, named("First steps"))).toEqual([]);
    expect(shownParams(commandById("union")!, named("First steps"), blk("b1", "union", { name: "box and pin" })).map((p) => p.id)).toEqual(["name"]);
  });

  test("what the assistant may use follows: hidden blocks and hidden fields are not allowed", () => {
    const first = named("First steps");
    expect(allowedField(first, "box", "w")).toBe(true);
    expect(allowedField(first, "box", "x")).toBe(false);
    expect(allowedField(first, "extrude", "height")).toBe(false);
    expect(allowedField(named("Starter"), "box", "x")).toBe(true);
    expect(allowedField(undefined, "extrude", "twist")).toBe(true);
  });
});

describe("layout in a mode", () => {
  const box = blk("b1", "box", { w: "40", d: "30", h: "5" });
  const lay = (p: Program, mode?: ReturnType<typeof named>) => layoutProgram(p, { x: 1, y: 2, width: 8, measure, mode }).blocks[0];

  test("a partly exposed block draws only the fields it shows", () => {
    const labels = (mode?: ReturnType<typeof named>) => lay([box], mode).parts.filter((x) => x.kind === "label").map((x) => x.text);
    expect(labels()).toEqual(["width", "depth", "height", "at x", "y", "z"]);
    expect(labels(named("First steps"))).toEqual(["width", "depth", "height"]);
  });

  test("with no field to type into, there is no caption to tap either, until a block has a caption", () => {
    const word = (b: Block, mode: ReturnType<typeof named>) => lay([b], mode).parts.find((x) => x.kind === "word")!;
    expect(word(blk("b1", "union", {}, []), named("First steps")).captionParam).toBeUndefined();
    expect(word(blk("b1", "union", { name: "joined" }, []), named("First steps")).captionParam?.id).toBe("name");
  });

  test("a block the mode hides is still drawn, with every field", () => {
    const l = lay([blk("b1", "extrude", {}, [])], named("First steps"));
    expect(l.parts.filter((x) => x.kind === "label").map((x) => x.text)).toContain("twist");
  });
});

describe("the assistant in a mode", () => {
  const first = named("First steps");

  test("the instructions list only the blocks and fields the mode offers", () => {
    const text = systemPrompt({ mode: first });
    expect(text).toContain("- box: ");
    expect(text).not.toContain("- extrude");
    expect(text).not.toContain("- repeat");
    expect(text).toMatch(/- box: [^\n]*w=width[^\n]*\./);
    expect(text).not.toMatch(/- box: [^\n]*\bx=/);
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
    expect(() => applyOps([], [{ op: "append", blocks: "box x=5" }], { mode: first })).toThrow(/box block has no field "x" \(its fields are name, w, d, h\)/);
    expect(() => applyOps([], [{ op: "wrap", blocks: ["b1"], holder: "extrude" }], { mode: first })).toThrow();
    expect(applyOps([], [{ op: "append", blocks: "box w=5" }], { mode: first }).program).toHaveLength(1);
    // with no mode, anything goes
    expect(applyOps([], [{ op: "append", blocks: "extrude" }]).program).toHaveLength(1);
  });

  test("a hidden block can be edited when it is already there: a mode limits what is added", () => {
    const p: Program = [blk("b1", "extrude", { height: "5" }, [blk("b2", "rectangle")])];
    expect(applyOps(p, [{ op: "set", block: "b1", field: "height", value: "8" }], { mode: first }).program[0].args.height).toBe("8");
  });

  test("ask() holds the model to the mode: it is told, and gets a repair round", async () => {
    const backend = new ScriptedBackend([
      JSON.stringify({ ops: [{ op: "append", blocks: "extrude height=5\n  rectangle" }], reply: "Made a plate." }),
      JSON.stringify({ ops: [{ op: "append", blocks: "box w=40 d=30 h=5" }], reply: "Made a box." }),
    ]);
    const out = await ask(backend, k, { program: [], history: [], mode: first }, "a plate");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.tries[0].problem?.message).toMatch(/the extrude block is not available now/);
    expect(out.program.map((b) => b.kind)).toEqual(["box"]);
    expect(runProgram(k, out.program).problem).toBeUndefined();
  });
});

describe("the more chip", () => {
  const first = named("First steps");
  const box = (extra: Partial<Block> = {}, args: Record<string, string | boolean> = {}): Block => ({ ...blk("b1", "box", { w: "40", d: "30", h: "5", ...args }), ...extra });
  const lay = (b: Block, mode?: ReturnType<typeof named>) => layoutProgram([b], { x: 1, y: 2, width: 8, measure, mode }).blocks[0];

  test("a partly exposed block with fields left out has one, which says more; with the fields showing it says less", () => {
    expect(moreChip(commandById("box")!, first, box())).toBe("more");
    expect(moreChip(commandById("box")!, first, box({ expanded: true }))).toBe("less");
  });

  test("a fully exposed block, a block of a hidden kind, and no mode at all have none", () => {
    expect(moreChip(commandById("box")!, named("Starter"), box())).toBeUndefined();
    expect(moreChip(commandById("extrude")!, first, blk("b1", "extrude"))).toBeUndefined();
    expect(moreChip(commandById("box")!, undefined, box())).toBeUndefined();
  });

  test("a block whose only left-out field is its caption has none: a union is just its word", () => {
    expect(moreChip(commandById("union")!, named("First steps"), blk("b1", "union", {}, []))).toBeUndefined();
  });

  test("a partly exposed block whose left-out fields are all showing already (they have values) has none", () => {
    expect(moreChip(commandById("box")!, first, box({}, { name: "plate", x: "5", y: "5", z: "5" }))).toBeUndefined();
    expect(moreChip(commandById("box")!, first, box({}, { x: "5" }))).toBe("more"); // the others are still left out
  });

  test("the chip is the last part of the header, and tapping it is a hit that names the block", () => {
    const l = lay(box(), first);
    const last = l.parts.at(-1)!;
    expect(last.kind).toBe("more");
    expect(last.text).toBe("more");
    const centre = { x: last.rect.x + last.rect.w / 2, y: last.rect.y + last.rect.h / 2 };
    expect(hit(layoutProgram([box()], { x: 1, y: 2, width: 8, measure, mode: first }), centre.x, centre.y)).toEqual({ kind: "more", blockId: "b1" });
  });

  test("expanded shows every field, and the chip says less; collapsing goes back", () => {
    const fields = (b: Block) => lay(b, first).parts.filter((x) => x.kind === "label").map((x) => x.text);
    expect(fields(box())).toEqual(["width", "depth", "height"]);
    expect(fields(box({ expanded: true }))).toEqual(["width", "depth", "height", "at x", "y", "z"]);
    expect(lay(box({ expanded: true }), first).parts.at(-1)!.text).toBe("less");
    const toggled = setExpanded([box()], "b1", true);
    expect(toggled[0].expanded).toBe(true);
    expect(setExpanded(toggled, "b1", false)[0].expanded).toBeUndefined();
  });

  test("a block with no mode shows no chip and every field, whatever expanded says", () => {
    expect(lay(box({ expanded: true })).parts.some((x) => x.kind === "more")).toBe(false);
  });

  test("it is saved with the program, and must be true or false", () => {
    const text = serializeProgram([box({ expanded: true })]);
    expect(parseProgram(text)[0].expanded).toBe(true);
    expect(() => validateProgram([{ id: "a", kind: "box", args: {}, expanded: "yes" }])).toThrow(/expanded must be true or false/);
  });

  test("it does not change what the program builds", () => {
    const a = runProgram(k, [box()]);
    const b = runProgram(k, [box({ expanded: true })]);
    expect(b.combined!.volume()).toBeCloseTo(a.combined!.volume(), 6);
  });
});

describe("measure: a ? that shows what it found, and no switches", () => {
  const prog = (): Program => [blk("b1", "measure", { name: "top" }, [blk("b2", "box", { w: "40", d: "20", h: "5" })]), blk("b3", "box", { w: "top_w", d: "top_d", h: "top_h" })];
  const lay = (p: Program) => layoutProgram(p, { x: 1, y: 2, width: 8, measure });

  test("its header ends with a ?, and it has no eye or power switch", () => {
    const parts = lay(prog()).blocks[0].parts;
    expect(parts.at(-1)!.kind).toBe("info");
    expect(parts.some((p) => p.kind === "eye" || p.kind === "power")).toBe(false);
    expect(lay(prog()).blocks[1].parts.some((p) => p.kind === "eye")).toBe(true); // the box inside has its own
  });

  test("tapping the ? is a hit that names the block and where the chip is, so the pop-up can sit under it", () => {
    const l = lay(prog());
    const chip = l.blocks[0].parts.at(-1)!;
    const h = hit(l, chip.rect.x + chip.rect.w / 2, chip.rect.y + chip.rect.h / 2);
    expect(h).toMatchObject({ kind: "info", blockId: "b1" });
  });

  test("a measure block cannot be hidden (the shape inside has the eye), in the file or from the assistant", () => {
    expect(() => validateProgram([{ id: "a", kind: "measure", args: {}, inner: [], hidden: true }])).toThrow(/makes no shape of its own/);
    expect(() => applyOps([], [{ op: "append", blocks: "measure\n  box hidden" }])).not.toThrow(); // the box inside may be
    expect(() => applyOps([], [{ op: "append", blocks: "measure hidden\n  box" }])).toThrow();
  });

  test("the run keeps what each measure block found, by block id: the size and the edges, under the names the blocks below use", () => {
    const r = runProgram(k, prog());
    expect(r.problem).toBeUndefined();
    expect(r.measurements.b1).toMatchObject({ top_w: 40, top_d: 20, top_h: 5, top_x0: -20, top_x1: 20, top_y0: -10, top_y1: 10, top_z0: 0, top_z1: 5 });
    expect(runProgram(k, [blk("b1", "measure", { name: "m" }, [])]).measurements).toEqual({}); // one that did not run has nothing
  });

  test("a measure inside a loop shows the last pass", () => {
    const loop = [blk("r", "repeat", { times: "3", counter: "i" }, [blk("m", "measure", { name: "q" }, [blk("b", "box", { w: "i + 1" })])])];
    expect(runProgram(k, loop).measurements.m.q_w).toBe(3);
  });
});

describe("transform: one block that scales, turns and moves a group", () => {
  const sel = (text: string) => applyOps([], [{ op: "append", blocks: text }]).program;
  const bounds = (text: string) => {
    const b = runProgram(k, sel(text)).combined!.bounds();
    return [...b.min, ...b.max];
  };

  test("it scales, then turns, then moves, about the origin: the order the old blocks gave when nested that way", () => {
    // a 10 cube at x = 20 (from the cube's own x), stretched by 2, turned 90 degrees about z, then moved up 5
    const text = "transform sx=2 sy=2 sz=2 rz=90 z=5\n  box w=10 d=10 h=10 x=20";
    const b = bounds(text);
    expect(b[0]).toBeCloseTo(-10, 3); // the x offset of 20 became 40 when scaled, then swung round to y = 40
    expect(b[1]).toBeCloseTo(30, 3);
    expect(b[2]).toBeCloseTo(5, 3);
    expect(b[5]).toBeCloseTo(25, 3);
  });

  test("a new transform does nothing, and a partial one offers only the move", () => {
    expect(bounds("transform\n  box w=10 d=10 h=10")).toEqual([-5, -5, 0, 5, 5, 10]);
    expect(shownParams(commandById("transform")!, named("First steps")).map((p) => p.id)).toEqual(["x", "y", "z"]);
    expect(moreChip(commandById("transform")!, named("First steps"), blk("b1", "transform", {}, []))).toBe("more");
    expect(shownParams(commandById("transform")!, named("Starter")).length).toBe(9);
  });

  test("every field of it is left out of what the model reads while it is at its neutral value", () => {
    expect(programView([blk("b1", "transform", { x: "5" }, [blk("b2", "box", { name: "a" })])]).split("\n")[0]).toBe("b1 transform x=5");
  });

  test("the power switch is part of its header, and tapping it is a hit; disabled it leaves the shapes as they were", () => {
    const l = layoutProgram([blk("b1", "transform", { x: "50" }, [blk("b2", "box", { name: "a" })])], { x: 1, y: 2, width: 8, measure });
    const power = l.blocks[0].parts.find((p) => p.kind === "power")!;
    expect(power.text).toBe("on");
    expect(hit(l, power.rect.x + power.rect.w / 2, power.rect.y + power.rect.h / 2)).toMatchObject({ kind: "power", blockId: "b1" });
    expect(l.blocks[0].parts.at(-1)!.kind).toBe("eye"); // the eye comes last, after the power switch
    const off = layoutProgram([{ ...blk("b1", "transform", { x: "50" }, [blk("b2", "box", { name: "a" })]), disabled: true }], { x: 1, y: 2, width: 8, measure });
    expect(off.blocks[0].parts.find((p) => p.kind === "power")!.text).toBe("off");
    expect(runProgram(k, [{ ...blk("b1", "transform", { x: "50" }, [blk("b2", "box", { name: "a" })]), disabled: true }]).combined!.bounds().min[0]).toBeCloseTo(-5, 3);
  });

  test("a block that is not a modifier has no power switch; the eye alone", () => {
    const l = layoutProgram([blk("b1", "box")], { x: 1, y: 2, width: 8, measure });
    expect(l.blocks[0].parts.some((p) => p.kind === "power")).toBe(false);
  });

  test("a disabled or hidden block always shows its switch, whatever the mode, so it can be turned back on", () => {
    const first = named("First steps");
    const mk = (extra: Partial<Block>) => layoutProgram([{ ...blk("b1", "transform", {}, [blk("b2", "box")]), ...extra }], { x: 1, y: 2, width: 8, measure, mode: first }).blocks[0].parts.map((p) => p.kind);
    expect(mk({})).not.toContain("power"); // First steps has no switches
    expect(mk({ disabled: true })).toContain("power");
    expect(mk({ hidden: true })).toContain("eye");
  });

  test("the assistant can set hidden and disabled, and write them in block text", () => {
    const p = [blk("b1", "transform", { x: "5" }, [blk("b2", "box")])];
    expect(applyOps(p, [{ op: "set", block: "b2", field: "hidden", value: "true" }]).program[0].inner![0].hidden).toBe(true);
    expect(applyOps(p, [{ op: "set", block: "b1", field: "disabled", value: "true" }]).program[0].disabled).toBe(true);
    expect(() => applyOps(p, [{ op: "set", block: "b2", field: "disabled", value: "true" }])).toThrow(/does not change what is inside it/);
    const made = applyOps([], [{ op: "append", blocks: "transform x=5 disabled\n  box hidden" }]).program;
    expect(made[0].disabled).toBe(true);
    expect(made[0].inner![0].hidden).toBe(true);
    expect(programView(made)).toContain("b1 transform x=5 disabled");
    expect(programView(made)).toMatch(/b2 box .*hidden/);
  });
});
