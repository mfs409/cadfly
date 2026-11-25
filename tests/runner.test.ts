import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRunner } from "../src/cadfly/app/runner";
import { RESTART_AFTER, RUN_DELAY, SLOW_AFTER } from "../src/cadfly/app/runMachine";
import { RunStopped, type RunPurpose, type ShapeEngine, TIME_LIMIT } from "../src/cadfly/engine";
import type { StlFiles } from "../src/cadfly/language/files";
import type { Problem, Program } from "../src/cadfly/language/types";
import type { RunSnapshot } from "../src/cadfly/snapshot";

/**
 * Building the program as it changes, against a stand-in engine that answers
 * when the test says and a clock the test controls: the wait, newer changes, and
 * stopped or slow builds.
 */

/** A build's result with one shape, or with this problem. */
// cast: a snapshot's shapes carry more than these tests need (a mesh and the rest), so only the fields the runner reads are given
const result = (problem?: Problem): RunSnapshot => ({ shapes: [{ id: "b1", name: "box", mesh: { positions: new Float32Array(), indices: new Uint32Array() } }], combined: null, flat: null, hullFaces: {}, overlays: [], measurements: {}, ...(problem ? { problem } : {}) }) as unknown as RunSnapshot;

/** A run the stand-in engine was asked for. */
interface Asked {
  program: Program;
  files: StlFiles;
  purpose: RunPurpose;
  resolve: (r: RunSnapshot) => void;
  reject: (why: RunStopped) => void;
}

/** A stand-in for the engine: it records the runs it is asked for and answers them when told. */
function fakeEngine() {
  const asked: Asked[] = [];
  const stops: string[] = [];
  let busy = 0;
  const engine: ShapeEngine = {
    ready: () => true,
    failure: () => "",
    run: (program, files, purpose = "view") => new Promise<RunSnapshot>((resolve, reject) => asked.push({ program, files, purpose, resolve, reject })),
    loadGoogleFont: () => Promise.resolve(),
    stop: (why = "user") => void stops.push(why),
    busyFor: () => busy,
    addRestartListener: () => () => {},
  };
  return { engine, asked, stops, busyFor: (ms: number) => (busy = ms) };
}

/** A program that is easy to tell from another by its id. */
const prog = (id: string): Program => [{ id: "s1", name: "build", blocks: [{ id, kind: "box", args: {} }] }];

/** Everything the runner is given, with the program the test can change. */
function setup() {
  const e = fakeEngine();
  let program = prog("a");
  const shown: RunSnapshot[] = [];
  const log: string[] = [];
  const runner = createRunner({
    engine: e.engine,
    program: () => program,
    files: () => ({}),
    show: (r) => (shown.push(r), true),
    refresh: () => log.push("refresh"),
    refreshMessage: () => log.push("message"),
  });
  return { ...e, runner, shown, log, change: (next: Program) => ((program = next), runner.schedule()) };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let the clock run, and the promises settle. */
const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("when a build starts", () => {
  test("nothing is built before the files are back, and the first build starts when they are", async () => {
    const t = setup();
    t.runner.schedule();
    await wait(RUN_DELAY * 2);
    expect(t.asked).toHaveLength(0);
    t.runner.filesReady();
    t.runner.request();
    expect(t.asked).toHaveLength(1);
  });

  test("a burst of changes is built once, after a short wait", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.schedule();
    await wait(RUN_DELAY - 10);
    t.runner.schedule();
    await wait(RUN_DELAY - 10);
    expect(t.asked).toHaveLength(0);
    await wait(20);
    expect(t.asked).toHaveLength(1);
  });
});

describe("a change while a build goes on", () => {
  test("is built after it, and the result of the older build is not shown", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    expect(t.asked.map((a) => a.program[0].blocks[0].id)).toEqual(["a"]);
    t.change(prog("b"));
    await wait(RUN_DELAY);
    expect(t.asked).toHaveLength(1);
    t.asked[0].resolve(result());
    await wait(0);
    expect(t.shown).toHaveLength(0);
    expect(t.asked.map((a) => a.program[0].blocks[0].id)).toEqual(["a", "b"]);
    t.asked[1].resolve(result());
    await wait(0);
    expect(t.shown).toHaveLength(1);
    expect(t.runner.lastBuildProgram()?.[0].blocks[0].id).toBe("b");
  });

  test("makes the build stop only when it has already gone on a while", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    t.busyFor(RESTART_AFTER);
    t.change(prog("b"));
    await wait(RUN_DELAY);
    expect(t.stops).toEqual([]);
    t.busyFor(RESTART_AFTER + 1);
    t.change(prog("c"));
    await wait(RUN_DELAY);
    expect(t.stops).toEqual(["newer"]);
    // the stopped build says nothing about a problem: the newer program is built next
    t.asked[0].reject(new RunStopped("newer"));
    await wait(0);
    expect(t.runner.problem()).toBeUndefined();
    expect(t.asked).toHaveLength(2);
    expect(t.asked[1].program[0].blocks[0].id).toBe("c");
  });
});

describe("a build that does not give a result", () => {
  test("stopped by the person, it is a problem, and what was shown stays", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    const first = result();
    t.asked[0].resolve(first);
    await wait(0);
    expect(t.runner.lastBuild()).toBe(first);
    t.runner.request();
    t.asked[1].reject(new RunStopped("user"));
    await wait(0);
    expect(t.runner.problem()?.message).toMatch(/building this was stopped/);
    expect(t.runner.lastBuild()).toBeUndefined();
    expect(t.runner.lastShapes()).toBe(first); // what was shown stays
  });

  test("one that took too long says how long the limit is", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    t.asked[0].reject(new RunStopped("time"));
    await wait(0);
    expect(t.runner.problem()?.message).toContain(`more than ${TIME_LIMIT / 1000} seconds`);
  });

  test("a failure in the engine says what it said", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    t.asked[0].reject(new RunStopped("error", "out of memory"));
    await wait(0);
    expect(t.runner.problem()?.message).toContain("out of memory");
  });

  test("if the program changed meanwhile, the stop is not a problem, since a newer build is coming", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    t.change(prog("b"));
    await wait(RUN_DELAY);
    t.asked[0].reject(new RunStopped("user"));
    await wait(0);
    expect(t.runner.problem()).toBeUndefined();
    expect(t.asked).toHaveLength(2);
  });
});

describe("a slow build", () => {
  test("is called slow after a moment, and is not after it ends", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    await wait(SLOW_AFTER - 1);
    expect(t.runner.slow()).toBe(false);
    await wait(1);
    expect(t.runner.slow()).toBe(true);
    expect(t.log).toContain("message");
    t.asked[0].resolve(result());
    await wait(0);
    expect(t.runner.slow()).toBe(false);
    expect(t.log.at(-1)).toBe("refresh");
  });

  test("a build that is quick never is", async () => {
    const t = setup();
    t.runner.filesReady();
    t.runner.request();
    await wait(SLOW_AFTER / 2);
    t.asked[0].resolve(result());
    await wait(SLOW_AFTER * 2);
    expect(t.runner.slow()).toBe(false);
    expect(t.log).not.toContain("message");
  });
});
