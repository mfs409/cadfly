import { beforeAll, describe, expect, test } from "vitest";
import { type AssistantState, ask } from "../src/cadfly/assistant/assistant";
import { ScriptedBackend } from "./scripted";
import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import { replySchema } from "../src/cadfly/assistant/schema";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { findBlock } from "../src/cadfly/language/edit";
import { runProgram } from "../src/cadfly/language/run";
import type { Block } from "../src/cadfly/language/types";

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});

const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id, kind, args, ...(inner ? { inner } : {}) });
const say = (ops: unknown[], reply = "done") => JSON.stringify({ ops, reply });
const fresh = (): AssistantState => ({ program: [], history: [] });
const [makePlate] = WORKED_EXAMPLES;

describe("a request that works the first time", () => {
  test("the reply is applied, run, and reported", async () => {
    const backend = new ScriptedBackend([say(makePlate.ops, makePlate.reply)]);
    const out = await ask(backend, k, fresh(), "a plate with four holes");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(1);
    expect(out.reply).toBe(makePlate.reply);
    expect(out.problem).toBeUndefined();
    expect(out.program).toHaveLength(1);
    expect(out.changes).toEqual(['added extrude "plate"']);
    expect(runProgram(k, out.program).combined!.volume()).toBeGreaterThan(0);
  });

  test("a different schema can be handed to the backend", async () => {
    const backend = new ScriptedBackend([say([])]);
    const mine = { type: "object" };
    await ask(backend, k, fresh(), "hello", { schema: mine });
    expect(backend.calls[0].schema).toBe(mine);
  });

  test("the model is given the schema, the instructions, and the request with the current program", async () => {
    const backend = new ScriptedBackend([say([])]);
    await ask(backend, k, { program: [blk("b1", "box", { name: "a" })], history: [] }, "make it taller");
    const req = backend.calls[0];
    expect(req.schema).toEqual(replySchema());
    expect(req.messages[0].role).toBe("system");
    expect(req.messages.at(-1)!.content).toContain("b1 box name=a");
    expect(req.messages.at(-1)!.content).toContain("Request: make it taller");
    expect(req.maxTokens).toBeGreaterThan(0);
  });

  test("a question gets an answer and no change", async () => {
    const p = [blk("b1", "box", { name: "a" })];
    const out = await ask(new ScriptedBackend([say([], "There is one box, called a.")]), k, { program: p, history: [] }, "what is there?");
    expect(out).toMatchObject({ ok: true, program: p, changes: [], reply: "There is one box, called a." });
  });

  test("an answer wrapped in a fence or in words is still read", async () => {
    const out = await ask(new ScriptedBackend(["Sure!\n```json\n" + say(makePlate.ops, "ok") + "\n```"]), k, fresh(), "plate");
    expect(out.ok).toBe(true);
    expect(out.program).toHaveLength(1);
  });
});

describe("when the model gets it wrong, it is told why and tries again", () => {
  test("an answer that is not JSON", async () => {
    const backend = new ScriptedBackend(["I think you want a plate", say(makePlate.ops)]);
    const out = await ask(backend, k, fresh(), "plate");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    const retry = backend.calls[1].messages;
    expect(retry.at(-2)).toEqual({ role: "assistant", content: "I think you want a plate" });
    expect(retry.at(-1)!.content).toContain("not usable: it was not valid JSON");
  });

  test("an op that cannot be applied: the error names what is wrong", async () => {
    const backend = new ScriptedBackend([say([{ op: "delete", block: "zz" }]), say(makePlate.ops)]);
    const out = await ask(backend, k, { program: [blk("b1", "box", { name: "a" })], history: [] }, "remove it");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(backend.calls[1].messages.at(-1)!.content).toContain('no block "zz" (the blocks are b1)');
  });

  test("a change that breaks the program: the model is shown the problem", async () => {
    const backend = new ScriptedBackend([
      say([{ op: "append", blocks: [{ kind: "box", args: { name: "b", w: "size" } }] }]),
      say([{ op: "append", blocks: [{ kind: "box", args: { name: "b", w: "10" } }] }]),
    ]);
    const out = await ask(backend, k, fresh(), "a box");
    expect(out.attempts).toBe(2);
    expect(out.problem).toBeUndefined();
    expect(backend.calls[1].messages.at(-1)!.content).toContain('problem in b1: width: unknown variable "size"');
    expect(out.program[0].args.w).toBe("10");
  });

  test("the retry is built to fit the window even after a long wrong answer", async () => {
    const longWrong = say([{ op: "delete", block: "zz" }], "x".repeat(2000));
    const backend = new ScriptedBackend([longWrong, say([])]);
    await ask(backend, k, fresh(), "do something");
    const tokens = backend.calls[1].messages.reduce((n, m) => n + Math.ceil(m.content.length / 3) + 12, 0);
    expect(tokens).toBeLessThanOrEqual(4096 - 700);
  });

  test("if it still cannot be applied, nothing changes and the person is told", async () => {
    const p = [blk("b1", "box", { name: "a" })];
    const backend = new ScriptedBackend([say([{ op: "delete", block: "zz" }]), say([{ op: "delete", block: "yy" }])]);
    const out = await ask(backend, k, { program: p, history: [{ user: "hi", assistant: say([]) }] }, "remove it");
    expect(out.ok).toBe(false);
    expect(out.attempts).toBe(2);
    expect(out.program).toBe(p);
    expect(out.changes).toEqual([]);
    expect(out.reply).toMatch(/could not make that change: .*no block "yy"/);
    expect(out.history).toHaveLength(1); // a failed request is not remembered
  });

  test("a change that applies but leaves a problem is kept, with the problem", async () => {
    const bad = say([{ op: "append", blocks: [{ kind: "box", args: { w: "oops" } }] }], "Added a box.");
    const out = await ask(new ScriptedBackend([bad, bad]), k, fresh(), "a box");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(out.problem).toEqual({ blockId: "b1", message: 'width: unknown variable "oops"' });
    expect(out.program).toHaveLength(1); // it can be fixed by hand, or undone in one step
  });

  test("with one attempt there is no retry", async () => {
    const backend = new ScriptedBackend(["nonsense", say([])]);
    const out = await ask(backend, k, fresh(), "x", { attempts: 1 });
    expect(out.ok).toBe(false);
    expect(backend.calls).toHaveLength(1);
  });

  test("replies that are the wrong shape are explained", async () => {
    const cases: [string, RegExp][] = [
      ["[]", /must be a JSON object/],
      [JSON.stringify({ reply: "x" }), /"ops" must be a list/],
      [JSON.stringify({ ops: [] }), /"reply" must be text/],
      [JSON.stringify({ ops: ["delete"], reply: "x" }), /op 1 must be an object/],
      [JSON.stringify({ ops: new Array(30).fill({ op: "clear" }), reply: "x" }), /more than 24/],
    ];
    for (const [raw, why] of cases) {
      const backend = new ScriptedBackend([raw, say([])]);
      await ask(backend, k, fresh(), "x");
      expect(backend.calls[1].messages.at(-1)!.content, raw).toMatch(why);
    }
  });
});

describe("the conversation", () => {
  test("each answered request is remembered, newest last, keeping the last four", async () => {
    let state = fresh();
    for (let i = 1; i <= 6; i++) {
      const out = await ask(new ScriptedBackend([say([], `reply ${i}`)]), k, state, `request ${i}`);
      state = { ...state, history: out.history };
    }
    expect(state.history.map((t) => t.user)).toEqual(["request 3", "request 4", "request 5", "request 6"]);
    expect(JSON.parse(state.history[3].assistant)).toEqual({ ops: [], reply: "reply 6" });
  });

  test("the next request carries the last exchanges, so it can say 'it'", async () => {
    const first = await ask(new ScriptedBackend([say(makePlate.ops, makePlate.reply)]), k, fresh(), "a plate");
    const backend = new ScriptedBackend([say([])]);
    await ask(backend, k, { program: first.program, history: first.history }, "make it thicker");
    const sent = backend.calls[0].messages.map((m) => m.content);
    expect(sent).toContain("a plate");
    expect(sent.some((c) => c.includes(makePlate.reply))).toBe(true);
  });

  test("a long reply is remembered in short form", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ op: "append", blocks: [{ kind: "box", args: { name: `box number ${i}`, w: "10", d: "10", h: "10" } }] }));
    const out = await ask(new ScriptedBackend([say(many, "Made ten boxes.")]), k, fresh(), "ten boxes");
    expect(out.history[0].assistant.length).toBeLessThan(200);
    expect(JSON.parse(out.history[0].assistant).reply).toBe("Made ten boxes. (10 changes)");
  });
});

describe("stopping", () => {
  test("a cancelled request rejects, and changes nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(ask(new ScriptedBackend([say([])]), k, fresh(), "x", { signal: controller.signal })).rejects.toThrow(/abort/i);
  });

  test("a backend that fails (no network, out of memory) is passed on, not hidden", async () => {
    const backend = { generate: async () => { throw new Error("the GPU ran out of memory"); } };
    await expect(ask(backend, k, fresh(), "x")).rejects.toThrow("the GPU ran out of memory");
  });
});

describe("editing what is there", () => {
  test("setting a value on a block the model was shown", async () => {
    const [, tweak] = WORKED_EXAMPLES;
    const out = await ask(new ScriptedBackend([say(tweak.ops, tweak.reply)]), k, { program: tweak.program, history: [] }, "make the holes radius 4");
    expect(out.ok).toBe(true);
    expect(findBlock(out.program, "b4")!.block.args.r).toBe("4");
    expect(out.changes).toHaveLength(4);
  });
});

describe("showing how it works", () => {
  test("the result carries what the model was given, with the size of its window", async () => {
    const backend = new ScriptedBackend([say([])]);
    const out = await ask(backend, k, { program: [blk("b1", "box", { name: "a" })], history: [] }, "make it taller");
    expect(out.prompt.messages).toEqual(backend.calls[0].messages);
    expect(out.prompt.window).toBe(4096);
    expect(out.prompt.tokens).toBeGreaterThan(1000);
    expect(out.prompt.tokens).toBeLessThanOrEqual(4096);
    expect(out.prompt.trimmed).toEqual(expect.objectContaining({ examples: expect.any(Number) }));
  });

  test("a try that works is one entry, with nothing wrong", async () => {
    const out = await ask(new ScriptedBackend([say([])]), k, fresh(), "hi");
    expect(out.tries).toEqual([{ raw: say([]) }]);
  });

  test("a try that goes wrong is recorded with what was wrong and what the model was told, then the retry", async () => {
    const bad = say([{ op: "set", block: "zz", field: "w", value: "1" }]);
    const good = say([{ op: "append", blocks: "box w=5" }]);
    const out = await ask(new ScriptedBackend([bad, good]), k, fresh(), "a box");
    expect(out.ok).toBe(true);
    expect(out.tries).toHaveLength(2);
    expect(out.tries[0].raw).toBe(bad);
    expect(out.tries[0].problem).toEqual({ kind: "edit", message: expect.stringMatching(/no block "zz"/) });
    expect(out.tries[0].feedback).toMatch(/Your ops could not be applied/);
    expect(out.tries[1]).toEqual({ raw: good });
  });

  test("each kind of mistake is told apart: unreadable, cannot apply, and a block that fails", async () => {
    const unreadable = (await ask(new ScriptedBackend(["not json", "still not"]), k, fresh(), "x")).tries;
    expect(unreadable.map((t) => t.problem?.kind)).toEqual(["reply", "reply"]);
    expect(unreadable[1].feedback).toBeUndefined(); // the last try is not followed by another
    const fails = say([{ op: "append", blocks: "box w=0" }]);
    const run = (await ask(new ScriptedBackend([fails, fails]), k, fresh(), "x")).tries;
    expect(run[0].problem).toEqual({ kind: "run", message: expect.stringMatching(/^b1: width: must be more than zero/) });
  });

  test("when nothing could be done the trace is still there", async () => {
    const out = await ask(new ScriptedBackend(["nope", "nope"]), k, fresh(), "x");
    expect(out.ok).toBe(false);
    expect(out.tries).toHaveLength(2);
    expect(out.prompt.messages.at(-1)!.content).toContain("Request: x");
  });
});
