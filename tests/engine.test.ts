import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { RunStopped, TIME_LIMIT, createFontRequester, createShapeEngine, stoppedProblem } from "../src/cadfly/engine";
import { sameFiles } from "../src/cadfly/language/files";
import type { Block, Program } from "../src/cadfly/language/types";
import type { FromWorker, ToWorker } from "../src/cadfly/protocol";
import type { RunSnapshot } from "../src/cadfly/snapshot";

/**
 * The page's side of the engine worker, against a stand-in worker and a clock
 * the test controls: which files are sent and when, run timing, failures,
 * stopping, and one run at a time.
 */

/** What a stand-in worker answers a run with. */
const SNAPSHOT: RunSnapshot = { shapes: [], combined: null, flat: null, hullFaces: {}, overlays: [], measurements: {} };
/** An answer that can be told from the others: it carries a problem that says whose answer it is */
const answerFor = (who: string): RunSnapshot => ({ ...SNAPSHOT, problem: { blockId: who, message: `answer for ${who}` } });

/** A stand-in for the engine's Web Worker: it records what the page sends it, and says what the test tells it to */
class FakeWorker {
  static all: FakeWorker[] = [];
  /** Does a new worker say it is ready at once? */
  static autoReady = true;
  /** Does a worker answer every run at once? */
  static autoAnswer = true;
  sent: ToWorker[] = [];
  terminated = false;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
    if (FakeWorker.autoReady) queueMicrotask(() => this.say({ type: "ready" }));
  }
  /** The worker sends the page a message. */
  say(m: FromWorker) {
    this.onmessage?.({ data: m });
  }
  postMessage(m: ToWorker) {
    this.sent.push(m);
    if (m.type === "run" && FakeWorker.autoAnswer) queueMicrotask(() => this.say({ type: "ran", id: m.id, result: SNAPSHOT }));
  }
  terminate() {
    this.terminated = true;
  }
  /** The runs sent to this worker. */
  runs() {
    return this.sent.filter((m): m is Extract<ToWorker, { type: "run" }> => m.type === "run");
  }
}

beforeEach(() => {
  FakeWorker.all = [];
  FakeWorker.autoReady = true;
  FakeWorker.autoAnswer = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A program that is easy to tell from another by its id. */
const prog = (id: string): Program => [{ id: "s1", name: "build", blocks: [{ id, kind: "box", args: {} } as Block] }];
/** Let the microtasks run (a worker that answers at once, a promise that settles). */
const settle = () => vi.advanceTimersByTimeAsync(0);
/** Why a promise was rejected, as a `RunStopped`. */
const stoppedWhy = (p: Promise<unknown>) => p.then(() => undefined, (e: RunStopped) => e);

describe("the files sent to the worker", () => {
  const filesA = { "a.stl": "AAAA" };
  const filesB = { "a.stl": "AAAA", "b.stl": "BBBB" };
  const filesOf = (w: FakeWorker) => w.runs().map((m) => m.files);

  test("a run sends the files only when the worker does not have them already", async () => {
    const engine = createShapeEngine();
    await engine.run([], filesA);
    await engine.run([], filesA);
    await engine.run([], filesA);
    expect(filesOf(FakeWorker.all[0])).toEqual([filesA, undefined, undefined]);
  });

  test("new files are sent, once", async () => {
    const engine = createShapeEngine();
    await engine.run([], filesA);
    await engine.run([], filesB);
    await engine.run([], filesB);
    expect(filesOf(FakeWorker.all[0])).toEqual([filesA, filesB, undefined]);
  });

  test("another object with the same names and the same text is not sent again (undo past a reload makes one)", async () => {
    const engine = createShapeEngine();
    await engine.run([], filesA);
    await engine.run([], { ...filesA });
    await engine.run([], { "a.stl": "AAAA" });
    expect(filesOf(FakeWorker.all[0])).toEqual([filesA, undefined, undefined]);
  });

  test("the same names with different text are sent", async () => {
    const engine = createShapeEngine();
    await engine.run([], filesA);
    await engine.run([], { "a.stl": "AAAB" });
    expect(filesOf(FakeWorker.all[0])).toEqual([filesA, { "a.stl": "AAAB" }]);
  });

  test("going back to an earlier set of files sends it again, since the worker has the later one", async () => {
    const engine = createShapeEngine();
    await engine.run([], filesA);
    await engine.run([], filesB);
    await engine.run([], filesA);
    expect(filesOf(FakeWorker.all[0])).toEqual([filesA, filesB, filesA]);
  });

  test("a worker that has been started again has no files, so the next run sends them", async () => {
    const engine = createShapeEngine();
    await engine.run([], filesA);
    engine.stop();
    await engine.run([], filesA);
    expect(FakeWorker.all).toHaveLength(2);
    expect(filesOf(FakeWorker.all[1])).toEqual([filesA]);
  });

  test("an empty set of files is sent the first time too (the worker starts with none of its own to rely on)", async () => {
    const engine = createShapeEngine();
    await engine.run([], {});
    expect(filesOf(FakeWorker.all[0])).toHaveLength(1);
  });

  test("a run that was dropped before it was sent does not count as having sent its files", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const first = engine.run(prog("b1"), filesA, "view");
    const second = engine.run(prog("b2"), filesB, "view"); // waits behind the first
    await settle();
    engine.stop("newer"); // drops the second before it is sent, and ends the first
    expect((await stoppedWhy(first))?.why).toBe("newer");
    expect((await stoppedWhy(second))?.why).toBe("newer");
    FakeWorker.autoAnswer = true;
    await engine.run(prog("b3"), filesB);
    expect(filesOf(FakeWorker.all[1])).toEqual([filesB]);
  });
});

describe("telling files apart", () => {
  test("same names and the same text are the same files, whatever object holds them", () => {
    expect(sameFiles({ a: "x" }, { a: "x" })).toBe(true);
    expect(sameFiles({ a: "x" }, { a: "y" })).toBe(false);
    expect(sameFiles({ a: "x" }, { a: "x", b: "x" })).toBe(false);
    expect(sameFiles({ a: "x", b: "y" }, { a: "x", c: "y" })).toBe(false);
    expect(sameFiles({}, {})).toBe(true);
  });
});

describe("how long a run may take", () => {
  test("a run that is not answered is stopped at the time limit, and the engine starts again", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const run = stoppedWhy(engine.run(prog("b1"), {}));
    await settle();
    await vi.advanceTimersByTimeAsync(TIME_LIMIT - 1);
    expect(FakeWorker.all).toHaveLength(1);
    expect(engine.busyFor()).toBe(TIME_LIMIT - 1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run)?.why).toBe("time");
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
    expect(engine.busyFor()).toBe(0);
  });

  test("a run that is answered while a font is still being fetched clears its own timer", async () => {
    const engine = createShapeEngine();
    await settle();
    void engine.loadGoogleFont("Pacifico").catch(() => undefined); // never answered
    await engine.run(prog("b1"), {});
    expect(engine.busyFor()).toBe(0);
    await vi.advanceTimersByTimeAsync(TIME_LIMIT * 3);
    expect(FakeWorker.all).toHaveLength(1); // no false stop for a time that was not spent building
    expect(FakeWorker.all[0].terminated).toBe(false);
    expect(engine.busyFor()).toBe(0);
  });

  test("a pending font request does not keep a finished run looking busy, and the next run has a full time limit", async () => {
    const engine = createShapeEngine();
    await settle();
    void engine.loadGoogleFont("Pacifico").catch(() => undefined);
    await engine.run(prog("b1"), {});
    await vi.advanceTimersByTimeAsync(TIME_LIMIT - 1000);
    FakeWorker.autoAnswer = false;
    const slow = stoppedWhy(engine.run(prog("b2"), {}));
    await settle();
    await vi.advanceTimersByTimeAsync(TIME_LIMIT - 1);
    expect(FakeWorker.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect((await slow)?.why).toBe("time");
  });

  test("the time limit starts when the engine starts on the run, not while it is still loading", async () => {
    FakeWorker.autoReady = false;
    FakeWorker.autoAnswer = true;
    const engine = createShapeEngine();
    const done = engine.run(prog("b1"), {});
    await vi.advanceTimersByTimeAsync(15_000);
    FakeWorker.all[0].say({ type: "ready" });
    await done;
    expect(FakeWorker.all[0].terminated).toBe(false);
  });
});

describe("a worker that says it failed", () => {
  test("a failed run is reported with the worker's words, at once, and the engine goes on", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const bad = stoppedWhy(engine.run(prog("b1"), {}));
    await settle();
    const id = FakeWorker.all[0].runs()[0].id;
    FakeWorker.all[0].say({ type: "failed", id, message: "out of memory" });
    const stopped = await bad;
    expect(stopped?.why).toBe("error");
    expect(stopped?.detail).toBe("out of memory");
    expect(stoppedProblem("error", 20, "out of memory").message).toMatch(/failed while building.*out of memory/);
    expect(FakeWorker.all[0].terminated).toBe(false);
    expect(engine.busyFor()).toBe(0);
    FakeWorker.autoAnswer = true;
    await engine.run(prog("b2"), {}); // the same worker answers the next one
    expect(FakeWorker.all).toHaveLength(1);
  });

  test("a failure with no request, which is the engine failing to load, is given up on with its reason, and runs say so", async () => {
    FakeWorker.autoReady = false;
    const engine = createShapeEngine();
    const waiting = stoppedWhy(engine.run(prog("b1"), {}));
    FakeWorker.all[0].say({ type: "failed", message: "the geometry engine (WebAssembly) did not load: bad magic number" });
    const stopped = await waiting;
    expect(stopped?.why).toBe("failed");
    expect(stopped?.detail).toBe("the 3D engine did not start: the geometry engine (WebAssembly) did not load: bad magic number");
    expect(engine.failure()).toBe(stopped?.detail);
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect((await stoppedWhy(engine.run(prog("b2"), {})))?.why).toBe("failed");
    expect(stoppedProblem("failed", 20, stopped!.detail).message).not.toContain("is it built");
  });

  test("an answer the page cannot read ends the run with a reason, and the engine starts again", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const run = stoppedWhy(engine.run(prog("b1"), {}));
    await settle();
    FakeWorker.all[0].onmessageerror?.();
    expect((await run)?.why).toBe("error");
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[0].terminated).toBe(true);
  });

  test("a worker script that fails to load is given up on with the browser's message", async () => {
    FakeWorker.autoReady = false;
    const engine = createShapeEngine();
    FakeWorker.all[0].onerror?.({ message: "SyntaxError: Unexpected token" });
    expect(engine.failure()).toBe("the 3D engine did not start: SyntaxError: Unexpected token");
  });
});

describe("loading", () => {
  test("a worker that keeps showing signs of life is not given up on, however long it takes in all", async () => {
    FakeWorker.autoReady = false;
    const engine = createShapeEngine();
    await vi.advanceTimersByTimeAsync(25_000);
    FakeWorker.all[0].say({ type: "progress", stage: "script" });
    await vi.advanceTimersByTimeAsync(25_000);
    FakeWorker.all[0].say({ type: "progress", stage: "wasm" });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(engine.failure()).toBe("");
    FakeWorker.all[0].say({ type: "ready" });
    expect(engine.ready()).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(engine.failure()).toBe("");
  });

  test("a worker that goes quiet for a whole stage is given up on, and the message says how long", async () => {
    FakeWorker.autoReady = false;
    const engine = createShapeEngine();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(engine.failure()).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.failure()).toMatch(/no sign of life from \.\/engine\.bundle\.js for 30 seconds/);
    expect(FakeWorker.all[0].terminated).toBe(true);
  });

  test("once it is ready, silence is fine", async () => {
    const engine = createShapeEngine();
    await settle();
    expect(engine.ready()).toBe(true);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(engine.failure()).toBe("");
  });
});

describe("runs go one at a time, in order", () => {
  test("a second run waits until the first is answered", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const first = engine.run(prog("b1"), {});
    const second = engine.run(prog("b2"), {});
    await settle();
    const w = FakeWorker.all[0];
    expect(w.runs().map((m) => (m.program[0].blocks[0] as Block).id)).toEqual(["b1"]);
    w.say({ type: "ran", id: w.runs()[0].id, result: SNAPSHOT });
    await first;
    await settle();
    expect(w.runs().map((m) => (m.program[0].blocks[0] as Block).id)).toEqual(["b1", "b2"]);
    w.say({ type: "ran", id: w.runs()[1].id, result: SNAPSHOT });
    await second;
  });
});

describe("stopping", () => {
  test("stopping for the user ends everything, the run in progress and the ones waiting", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const a = stoppedWhy(engine.run(prog("b1"), {}, "view"));
    const b = stoppedWhy(engine.run(prog("b2"), {}, "check"));
    await settle();
    engine.stop("user");
    expect((await a)?.why).toBe("user");
    expect((await b)?.why).toBe("user");
    expect(FakeWorker.all[0].terminated).toBe(true);
  });

  test("a newer program ends a view run that is being built, and the view runs waiting", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const a = stoppedWhy(engine.run(prog("b1"), {}, "view"));
    const b = stoppedWhy(engine.run(prog("b2"), {}, "view"));
    await settle();
    engine.stop("newer");
    expect((await a)?.why).toBe("newer");
    expect((await b)?.why).toBe("newer");
    expect(FakeWorker.all[0].terminated).toBe(true);
    expect(FakeWorker.all).toHaveLength(2);
  });

  test("a newer program does not end a check run that is being built, and the check finishes", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const check = engine.run(prog("b1"), {}, "check");
    const view = stoppedWhy(engine.run(prog("b2"), {}, "view"));
    await settle();
    engine.stop("newer");
    expect((await view)?.why).toBe("newer"); // the view run that waited behind the check is dropped (the page builds the newer program next)
    expect(FakeWorker.all[0].terminated).toBe(false);
    const w = FakeWorker.all[0];
    w.say({ type: "ran", id: w.runs()[0].id, result: answerFor("b1") });
    await expect(check).resolves.toEqual(answerFor("b1"));
  });

  test("a check run that waits behind a view run that is stopped for a newer program still runs, on the new worker", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const view = stoppedWhy(engine.run(prog("b1"), {}, "view"));
    const check = engine.run(prog("b2"), {}, "check");
    await settle();
    engine.stop("newer");
    expect((await view)?.why).toBe("newer");
    await settle();
    expect(FakeWorker.all).toHaveLength(2);
    const w = FakeWorker.all[1];
    expect(w.runs()).toHaveLength(1);
    w.say({ type: "ran", id: w.runs()[0].id, result: answerFor("b2") });
    await expect(check).resolves.toEqual(answerFor("b2"));
  });

  test("an export run is not stopped by a newer program, and asks the worker for the hidden shapes only when told to", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const exported = engine.run(prog("b1"), {}, "export", true);
    const view = stoppedWhy(engine.run(prog("b2"), {}, "view"));
    await settle();
    engine.stop("newer");
    expect((await view)?.why).toBe("newer");
    const w = FakeWorker.all[0];
    expect(w.terminated).toBe(false);
    expect(w.runs()[0].withHidden).toBe(true);
    w.say({ type: "ran", id: w.runs()[0].id, result: answerFor("export") });
    await expect(exported).resolves.toEqual(answerFor("export"));
    FakeWorker.autoAnswer = true;
    await engine.run(prog("b3"), {});
    expect(FakeWorker.all[0].runs().at(-1)!.withHidden).toBeUndefined();
  });

  test("a run that takes too long ends only itself: the runs that wait go on, on a new worker", async () => {
    FakeWorker.autoAnswer = false;
    const engine = createShapeEngine();
    const slow = stoppedWhy(engine.run(prog("b1"), {}, "check"));
    const next = engine.run(prog("b2"), {}, "view");
    await settle();
    await vi.advanceTimersByTimeAsync(TIME_LIMIT);
    expect((await slow)?.why).toBe("time");
    await settle();
    const w = FakeWorker.all[1];
    expect(w.runs()).toHaveLength(1);
    w.say({ type: "ran", id: w.runs()[0].id, result: answerFor("b2") });
    await expect(next).resolves.toEqual(answerFor("b2"));
  });
});

describe("restarting", () => {
  test("everyone who asked is told when the engine starts again, and a listener can be taken away", async () => {
    const engine = createShapeEngine();
    let a = 0;
    let b = 0;
    engine.addRestartListener(() => a++);
    const removeB = engine.addRestartListener(() => b++);
    engine.stop();
    removeB();
    engine.stop();
    expect([a, b]).toEqual([2, 1]);
  });

  test("the fonts a program needs are asked for again after a restart, and the promise says when they are in", async () => {
    FakeWorker.autoAnswer = true;
    const engine = createShapeEngine();
    await settle();
    let again = 0;
    const request = createFontRequester(engine, () => again++);
    const program: Program = [{ id: "s1", name: "build", blocks: [{ id: "b1", kind: "text", args: { font: "Pacifico" } }] }];
    request(program);
    request(program); // already asked for
    expect(FakeWorker.all[0].sent.filter((m) => m.type === "font")).toHaveLength(1);
    const font = FakeWorker.all[0].sent.find((m) => m.type === "font")!;
    FakeWorker.all[0].say({ type: "fonted", id: font.id });
    await settle();
    expect(again).toBe(1);
    engine.stop();
    request(program);
    expect(FakeWorker.all[1].sent.filter((m) => m.type === "font")).toHaveLength(1);
    let settled = false;
    void request(program).then(() => (settled = true));
    await settle();
    expect(settled).toBe(true); // nothing new to wait for
  });
});
