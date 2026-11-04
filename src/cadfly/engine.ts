import { builtInFont } from "./geometry/fonts";
import { googleFontId, parseGoogleFont } from "./geometry/googlefont";
import { allBlocks } from "./language/edit";
import type { Files } from "./language/files";
import { type FromWorker, type RunSnapshot, type ToWorker } from "./language/snapshot";
import type { Problem, Program } from "./language/types";

const WORKER = "./engine.bundle.js";
/** A run that takes longer than this (ms) is stopped */
export const TIME_LIMIT = 20_000;
/** An engine that has not said it is ready after this long (ms) is taken to have failed to load */
const LOAD_LIMIT = 10_000;

/** Why a run gave no result: it was stopped by the person, took too long, was stale (the program changed), or the engine could not start (`detail` says why) */
export class Stopped extends Error {
  constructor(readonly why: "user" | "time" | "newer" | "failed", readonly detail = "") {
    super("stopped");
  }
}

export interface Engine {
  /** True once the 3D engine has loaded */
  ready(): boolean;
  /** Why the 3D engine could not start, or "" if it has not failed */
  failure(): string;
  /** Build the program. Resolves with the result, or rejects with `Stopped` if it was stopped or took too long. */
  run(program: Program, files: Files): Promise<RunSnapshot>;
  /** Ask the engine to fetch a Google font; resolves when it is in (or has failed, which the text block then says) */
  font(input: string): Promise<void>;
  /** Stop what is running (the engine starts again at once, with its fonts to load again) */
  stop(why?: Stopped["why"]): void;
  /** How long (ms) the run in progress has been going, or 0 */
  busyFor(): number;
  /** Called when the engine has to start again, so that what it was told (fonts) is told again */
  onRestart: () => void;
}

/** The engine, in a Web Worker. Runs are one at a time, in order. */
export function createEngine(): Engine {
  let worker: Worker;
  let isReady = false;
  let next = 1;
  let started = 0;
  let timeout = 0;
  let loadTimer = 0;
  let failed = "";
  const waiting = new Map<number, { resolve: (v: never) => void; reject: (e: Stopped) => void }>();

  /** The engine could not start: give up on it (a run now would only wait out the time limit), and say why to everything waiting */
  function fail(detail: string) {
    worker.terminate();
    clearTimeout(loadTimer);
    clearTimeout(timeout);
    started = 0;
    failed = `the 3D engine did not start: ${detail}`;
    const all = [...waiting.values()];
    waiting.clear();
    for (const w of all) w.reject(new Stopped("failed", failed));
    engine.onRestart();
  }

  function start() {
    isReady = false;
    failed = "";
    worker = new Worker(WORKER);
    // a worker whose script is missing, or that fails as it loads, raises an error here; one whose script never arrives says nothing, so it is timed
    worker.onerror = (e) => fail(e.message || `${WORKER} could not be loaded (is it built and served next to the page?)`);
    clearTimeout(loadTimer);
    loadTimer = window.setTimeout(() => !isReady && fail(`no answer from ${WORKER} after ${LOAD_LIMIT / 1000} seconds (is it built and served next to the page?)`), LOAD_LIMIT);
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "ready") (isReady = true), clearTimeout(loadTimer);
      else {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (!waiting.size) (started = 0), clearTimeout(timeout);
        (w?.resolve as ((v: unknown) => void) | undefined)?.(m.type === "ran" ? m.result : undefined);
      }
    };
  }
  start();

  function send<T>(m: ToWorker, run: boolean): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (failed) return reject(new Stopped("failed", failed));
      waiting.set(m.id, { resolve: resolve as (v: never) => void, reject });
      if (run) {
        started = started || Date.now();
        clearTimeout(timeout);
        timeout = window.setTimeout(() => engine.stop("time"), TIME_LIMIT);
      }
      worker.postMessage(m);
    });
  }

  const engine: Engine = {
    ready: () => isReady,
    failure: () => failed,
    run: (program, files) => send({ type: "run", id: next++, program, files }, true),
    font: (input) => send({ type: "font", id: next++, input }, false),
    stop(why = "user") {
      worker.terminate();
      clearTimeout(timeout);
      started = 0;
      const all = [...waiting.values()];
      waiting.clear();
      for (const w of all) w.reject(new Stopped(why));
      start();
      engine.onRestart();
    },
    busyFor: () => (started ? Date.now() - started : 0),
    onRestart: () => {},
  };
  return engine;
}

/** What a run that was stopped says is wrong */
export function stoppedProblem(why: Stopped["why"], seconds: number, detail = ""): Problem {
  if (why === "failed") return { blockId: "", message: `Cannot build: ${detail}. Reload the page; if it happens again, the engine file is missing from the server.` };
  const cause = why === "time" ? `building this took more than ${seconds} seconds, so it was stopped` : "building this was stopped";
  return { blockId: "", message: `Stopped: ${cause}. Some shape is probably too big or too detailed (rounding, filleting, chamfering or hollowing a shape with many curves is slow): use fewer sides on the curves, or finish a smaller shape.` };
}

/**
 * A text block's font may be a Google font (anything that is not one of the built-in fonts). The function this returns asks the engine for
 * the fonts a program needs that it has not been asked for yet, and calls `again` when one is in (or has failed, which the text block then
 * says), so the program can be built with it. The engine forgets its fonts when it has to start again, so they are asked for again then.
 */
export function createFontRequester(engine: Engine, again: () => void): (program: Program) => void {
  const requested = new Set<string>();
  engine.onRestart = () => requested.clear();
  return (program) => {
    for (const b of allBlocks(program)) {
      const wanted = b.kind === "text" ? String(b.args.font ?? "").trim() : "";
      if (!wanted || builtInFont(wanted) || requested.has(wanted)) continue;
      try {
        googleFontId(parseGoogleFont(wanted));
      } catch {
        continue; // the text block reports what is wrong with what was typed
      }
      requested.add(wanted);
      engine.font(wanted).then(again, () => {});
    }
  };
}
