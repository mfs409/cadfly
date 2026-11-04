import Ajv from "ajv";
import { beforeAll, describe, expect, test } from "vitest";
import { ScriptedBackend } from "./scripted";
import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import { applyOps, opsAsText } from "../src/cadfly/assistant/ops";
import { DEFAULT_BUDGET, buildMessages, estimateTokens, programView, systemPrompt } from "../src/cadfly/assistant/prompt";
import { replySchema } from "../src/cadfly/assistant/schema";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { COMMANDS } from "../src/cadfly/language/commands";
import { allBlocks } from "../src/cadfly/language/edit";
import { runProgram } from "../src/cadfly/language/run";
import type { Block, Program } from "../src/cadfly/language/types";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id, kind, args, ...(inner ? { inner } : {}) });

describe("the instructions", () => {
  const text = systemPrompt();

  test("every block and every field is described, from the command list", () => {
    for (const c of COMMANDS) {
      expect(text, c.id).toContain(`- ${c.id}`);
      expect(text, c.id).toContain(c.hint);
      for (const p of c.params) expect(text, `${c.id}.${p.id}`).toContain(p.id);
    }
  });

  test("it says how to reply, and what the ops are", () => {
    for (const w of ["JSON only", "\"ops\"", "append", "insert_after", "insert_into", "\"op\":\"set\"", "delete", "clear", "language", "wrap", "unwrap", "one block per line", "indented"]) expect(text).toContain(w);
  });

  test("the instructions leave room in a 4096-token window", () => {
    expect(estimateTokens(text)).toBeLessThan(3600);
  });
});

describe("showing the program", () => {
  const p: Program = [
    blk("b1", "set", { name: "w", value: "40" }),
    blk("b2", "extrude", { name: "my plate", plane: "XY", offset: "0", height: "w / 8" }, [blk("b3", "rectangle", { w: "w", h: "w" }), blk("b4", "circle", { r: "3", hole: true })]),
  ];

  test("one line per block, inside blocks indented, flags shown only when set", () => {
    expect(programView(p).split("\n")).toEqual([
      "b1 set name=w value=40",
      'b2 extrude name="my plate" plane=XY height="w / 8"',
      "  b3 rectangle u=0 v=0 w=w h=w",
      "  b4 circle u=0 v=0 r=3 hole",
    ]);
  });

  test("older blocks can be shortened", () => {
    expect(programView(p, 3).split("\n")).toEqual([
      "b1 set w",
      'b2 extrude "my plate"',
      "  b3 rectangle",
      "  b4 circle u=0 v=0 r=3 hole",
    ]);
  });

  test("or hidden, with a line saying so", () => {
    const v = programView(p, 0, 2).split("\n");
    expect(v[0]).toBe("(2 earlier blocks are not shown; they still exist)");
    expect(v).toHaveLength(3);
    expect(v[2]).toContain("b4 circle");
  });

  test("an empty program says so", () => {
    expect(programView([])).toBe("(empty)");
  });
});

describe("fitting a request into the window", () => {
  const long = (n: number): Program =>
    Array.from({ length: n }, (_, i) => blk(`b${i + 1}`, "box", { name: `shape number ${i + 1}`, w: "10", d: "20", h: "30" }));

  test("a short program gets the instructions, all the examples, and the request last", () => {
    const built = buildMessages({ program: [blk("b1", "box", { name: "a" })], history: [] }, "make it taller", { context: 7500, reply: 700 });
    const m = built.messages;
    expect(m[0].role).toBe("system");
    expect(m.at(-1)!.role).toBe("user");
    expect(m.at(-1)!.content).toContain("Request: make it taller");
    expect(m.at(-1)!.content).toContain("b1 box");
    expect(built.trimmed).toEqual({ examples: 0, turns: 0, terseBlocks: 0 });
    expect(m).toHaveLength(1 + 2 * WORKED_EXAMPLES.length + 1);
    expect(built.tokens).toBeLessThanOrEqual(7500 - 700);
  });

  test("in a 4096-token window most of the examples still fit", () => {
    const built = buildMessages({ program: [blk("b1", "box", { name: "a" })], history: [] }, "make it taller");
    expect(built.trimmed.examples).toBeLessThanOrEqual(18);
    expect(built.tokens).toBeLessThanOrEqual(DEFAULT_BUDGET.context - DEFAULT_BUDGET.reply);
  });

  test("messages alternate user and assistant after the instructions", () => {
    const built = buildMessages({ program: [], history: [{ user: "hi", assistant: '{"ops":[],"reply":"hello"}' }] }, "next");
    built.messages.slice(1).forEach((x, i) => expect(x.role).toBe(i % 2 === 0 ? "user" : "assistant"));
  });

  test("a long program is shortened, and it still fits", () => {
    for (const n of [20, 60, 200]) {
      const built = buildMessages({ program: long(n), history: [] }, "delete the last one");
      expect(built.tokens, `${n} blocks`).toBeLessThanOrEqual(DEFAULT_BUDGET.context - DEFAULT_BUDGET.reply);
      expect(built.messages.at(-1)!.content).toContain("Request: delete the last one");
      expect(built.messages.at(-1)!.content).toContain(`b${n} box`); // the newest block is always there
    }
    expect(buildMessages({ program: long(30), history: [] }, "x").trimmed.terseBlocks).toBe(0); // 30 of these still fit in full
    expect(buildMessages({ program: long(120), history: [] }, "x").trimmed.terseBlocks).toBeGreaterThan(0);
  });

  test("the examples go first when there is no room, then the history, never the request or the program", () => {
    const history = [
      { user: "first thing", assistant: '{"ops":[],"reply":"one"}' },
      { user: "second thing", assistant: '{"ops":[],"reply":"two"}' },
      { user: "third thing", assistant: '{"ops":[],"reply":"three"}' },
    ];
    const roomy = buildMessages({ program: long(10), history }, "now");
    expect(roomy.messages.some((m) => m.content === "second thing")).toBe(true);
    expect(roomy.messages.some((m) => m.content === "first thing")).toBe(false); // only the last two exchanges
    const tight = buildMessages({ program: long(10), history }, "now", { context: 2800, reply: 300 });
    expect(tight.trimmed.examples).toBeGreaterThan(0);
    expect(tight.messages.at(-1)!.content).toContain("Request: now");
    expect(tight.messages.at(-1)!.content).toContain("b10 box");
    expect(tight.tokens).toBeLessThanOrEqual(2500);
  });

  test("a problem in the program is told to the model", () => {
    const built = buildMessages({ program: [blk("b1", "box", { w: "oops" })], problem: { blockId: "b1", message: 'width: unknown variable "oops"' }, history: [] }, "fix it");
    expect(built.messages.at(-1)!.content).toContain('Problem in b1: width: unknown variable "oops"');
  });

  test("a bigger window keeps more", () => {
    const small = buildMessages({ program: long(120), history: [] }, "x", { context: 4096, reply: 700 });
    const big = buildMessages({ program: long(120), history: [] }, "x", { context: 16384, reply: 700 });
    expect(big.trimmed.terseBlocks).toBeLessThan(small.trimmed.terseBlocks);
    expect(big.trimmed.terseBlocks).toBe(0);
  });
});

describe("the worked examples", () => {
  const ajv = new Ajv({ strict: false });
  const valid = ajv.compile(replySchema());

  test("each one is a reply the schema accepts", () => {
    for (const ex of WORKED_EXAMPLES) expect(valid({ ops: opsAsText(ex.ops), reply: ex.reply }), ex.user).toBe(true);
  });

  test("each one does what its reply says, and the result runs with nothing wrong", () => {
    for (const ex of WORKED_EXAMPLES) {
      const { program, changes } = applyOps(ex.program, ex.ops);
      if (ex.ops.length) expect(changes.length, ex.user).toBeGreaterThan(0);
      const r = runProgram(k, program);
      expect(r.problem, ex.user).toBeUndefined();
      // hiding the only shape leaves nothing to show; a flat shape (not extruded yet) is shown but is not a solid
      if (!ex.user.startsWith("hide") && ex.ops.length) expect(r.combined ?? r.flat, ex.user).not.toBeNull();
    }
  });

  test("the first builds a plate with four holes; the second changes all four; the third puts a cube on top", () => {
    const [a, b, c] = WORKED_EXAMPLES.map((ex) => applyOps(ex.program, ex.ops).program);
    expect(allBlocks(a).filter((x) => x.kind === "circle")).toHaveLength(4);
    expect(allBlocks(b).filter((x) => x.kind === "circle").map((x) => x.args.r)).toEqual(["4", "4", "4", "4"]);
    expect(c.map((x) => x.kind)).toEqual(["extrude", "box"]);
    const r = runProgram(k, c);
    expect(r.shapes).toHaveLength(2);
    expect(r.combined!.bounds().max[2]).toBeCloseTo(15); // a 5 thick plate (from z = 0) with a 10 mm cube on it
  });

  test("the others do what they say", () => {
    const by = (text: string) => WORKED_EXAMPLES.find((e) => e.user.startsWith(text))!;
    const volume = (text: string) => runProgram(k, applyOps(by(text).program, by(text).ops).program).combined?.volume();
    expect(volume("a pyramid")).toBeCloseTo((40 * 40 * 25) / 3, 2);
    expect(volume("cut the pin")).toBeCloseTo(30 * 30 * 10 - Math.PI * 16 * 10, -1);
    expect(runProgram(k, applyOps(by("move the plate").program, by("move the plate").ops).program).combined!.bounds().min[2]).toBeCloseTo(20);
    expect(runProgram(k, applyOps(by("hide the plate").program, by("hide the plate").ops).program).combined).toBeNull();
    // the table is a top and four legs, the posts alternate in height, and the wing reaches out on both sides
    expect(volume("a table")).toBeCloseTo(100 * 60 * 5 + 4 * 5 * 5 * 40, 0);
    expect(volume("a row of 6 posts")).toBeCloseTo(3 * 16 * 20 + 3 * 16 * 8, 0);
    expect(volume("a hollow box")).toBeCloseTo(40 * 30 * 20 - 36 * 26 * 18, 0);
    expect(volume("a plate 60 by 40")! / ((60 * 40 - 4 * (36 - 9 * Math.PI)) * 5)).toBeCloseTo(1, 2);
    expect(volume("round the edges")!).toBeLessThan(8000);
    const wing = runProgram(k, applyOps(by("a box 30").program, by("a box 30").ops).program).combined!.bounds();
    expect([wing.min[0], wing.max[0]]).toEqual([expect.closeTo(-35, 4), expect.closeTo(35, 4)]);
  });

  test("a scripted model that replies like an example is understood end to end", async () => {
    const ex = WORKED_EXAMPLES[0];
    const backend = new ScriptedBackend([JSON.stringify({ ops: ex.ops, reply: ex.reply })]);
    const out = await backend.generate({ messages: [], schema: {}, maxTokens: 10 });
    expect(JSON.parse(out).reply).toBe(ex.reply);
  });
});
