import { builtInFont } from "./geometry/fonts";
import { googleFontId, parseGoogleFont } from "./geometry/googlefont";
import { type StlFiles, sameFiles } from "./language/files";
import { allBlocks } from "./language/program";
import type { Problem, Program } from "./language/types";
import type { FromWorker, ToWorker } from "./protocol";
import type { RunSnapshot } from "./snapshot";

/**
 * The page's side of the 3D engine. The engine runs in a Web Worker so that a
 * program that takes a long time to build does not freeze the page, and ending
 * the worker is how a run is stopped. Runs go one at a time, in the order they
 * were asked for. A run that takes too long is stopped, an engine that stops
 * showing signs of life while it loads is given up on, an engine that reports a
 * failure is believed, and the files and fonts the worker has are not sent
 * again.
 */

const WORKER = "./engine.bundle.js";
/** A run that takes longer than this (ms), from when the engine starts on it, is stopped */
export const TIME_LIMIT = 20_000;
/**
 * The engine is taken to have failed to load when it goes this long (ms)
 * without a sign of life: a step of its start-up being reached, or its being
 * ready. Each step has this long, so a slow connection that keeps making
 * progress is not given up on.
 */
const LOAD_STAGE_LIMIT = 30_000;

/**
 * Why a run gave no result: it was stopped by the person (`user`), took too long
 * (`time`), was stale because the program changed (`newer`), the engine could
 * not start (`failed`, and `detail` says why), or the engine reported an error
 * while building it (`error`, and `detail` says what).
 */
export class RunStopped extends Error {
  constructor(readonly why: "user" | "time" | "newer" | "failed" | "error", readonly detail = "") {
    super("stopped");
  }
}

/**
 * What a run is for. A `view` run builds the program that is on screen, and a
 * newer program makes it stale. A `check` run builds a change the assistant
 * proposes, and edits to the program on screen do not stop it. An `export`
 * run builds the program for a file the person is saving, and is not stopped
 * by edits either.
 */
export type RunPurpose = "view" | "check" | "export";

/** What the page can ask of the engine. */
export interface ShapeEngine {
  /** True once the 3D engine has loaded */
  ready(): boolean;
  /** Why the 3D engine could not start, or "" if it has not failed */
  failure(): string;
  /**
   * Build the program. Resolves with the result, or rejects with `RunStopped`
   * if it was stopped, took too long, or failed.
   *
   * @param program The program to build.
   * @param files The project's STL files.
   * @param purpose What the run is for. Default: `view`.
   * @param withHidden Also give the hidden shapes, in the snapshot's `hidden`.
   */
  run(program: Program, files: StlFiles, purpose?: RunPurpose, withHidden?: boolean): Promise<RunSnapshot>;
  /** Ask the engine to fetch a Google font; resolves when it is in (or has failed, which the text block then says) */
  loadGoogleFont(input: string): Promise<void>;
  /**
   * Stop runs. `user` stops everything, at once. `newer` stops the `view` runs
   * only (the worker is ended only if it is building one), so that an edit to
   * the program on screen does not end a `check` run. In every case the engine
   * starts again if it was ended, with its fonts to load again.
   */
  stop(why?: RunStopped["why"]): void;
  /** How long (ms) the run in progress has been going, or 0 when none is */
  busyFor(): number;
  /**
   * Ask to be told when the engine has to start again (so that what it was told,
   * such as fonts, is told again).
   *
   * @param listener Called on each restart.
   * @returns A function that takes the listener away.
   */
  addRestartListener(listener: () => void): () => void;
}

/** A run that has been asked for, and what to do with its answer. */
interface PendingRun {
  id: number;
  program: Program;
  files: StlFiles;
  purpose: RunPurpose;
  withHidden: boolean;
  resolve: (snapshot: RunSnapshot) => void;
  reject: (why: RunStopped) => void;
}

/** A font request that has not been answered. */
interface PendingFont {
  resolve: () => void;
  reject: (why: RunStopped) => void;
}

/**
 * The page's end of the connection to one engine worker at a time: the worker
 * itself, what it has said about itself, the runs and font requests that wait
 * for it, and the timers that watch it. A new worker starts after any stop.
 */
class WorkerEngine implements ShapeEngine {
  /** The worker the engine runs in. */
  private worker!: Worker;
  /** Has the worker said it has loaded? */
  private isReady = false;
  /** The id of the next message, which comes back in its answer. */
  private nextId = 1;
  /** The timer that gives up on a worker that stops showing signs of life while it loads. */
  private loadTimer = 0;
  /** Why the worker could not start, or empty if it has not failed. */
  private failed = "";
  /** The files the worker has, from the last run that was sent with files: null when it has none, as when it is new */
  private sentFiles: StlFiles | null = null;
  /** The runs that wait their turn. */
  private readonly queue: PendingRun[] = [];
  /** The run the worker is building, if one is. */
  private building: PendingRun | undefined;
  /** When the run in progress was sent to the worker (ms). */
  private startedAt = 0;
  /**
   * The timer that stops the run in progress if it takes too long. Only that
   * run's answer or a stop clears it, never a font request.
   */
  private runTimer = 0;
  /** The font requests that have not been answered yet, by id. */
  private readonly fonts = new Map<number, PendingFont>();
  /** Who is to be told that the engine started again. */
  private readonly restartListeners = new Set<() => void>();

  /** Start the first worker. */
  constructor() {
    this.start();
  }

  ready(): boolean {
    return this.isReady;
  }

  failure(): string {
    return this.failed;
  }

  run(program: Program, files: StlFiles, purpose: RunPurpose = "view", withHidden = false): Promise<RunSnapshot> {
    return new Promise<RunSnapshot>((resolve, reject) => {
      if (this.failed) return reject(new RunStopped("failed", this.failed));
      this.queue.push({ id: this.nextId++, program, files, purpose, withHidden, resolve, reject });
      this.pump();
    });
  }

  loadGoogleFont(input: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.failed) return reject(new RunStopped("failed", this.failed));
      const id = this.nextId++;
      this.fonts.set(id, { resolve, reject });
      this.worker.postMessage({ type: "font", id, input } satisfies ToWorker);
    });
  }

  stop(why: RunStopped["why"] = "user"): void {
    if (why === "newer") {
      const reason = new RunStopped("newer");
      this.rejectQueued(reason, "view");
      if (this.building?.purpose === "view") this.restart(reason);
      return;
    }
    const reason = new RunStopped(why);
    this.rejectQueued(reason);
    this.restart(reason);
  }

  busyFor(): number {
    return this.building ? Date.now() - this.startedAt : 0;
  }

  addRestartListener(listener: () => void): () => void {
    this.restartListeners.add(listener);
    return () => void this.restartListeners.delete(listener);
  }

  /** Tell everyone who asked that the engine started again. */
  private restarted(): void {
    this.restartListeners.forEach((listener) => listener());
  }

  /** Forget the run in progress and its timer. */
  private clearBuilding(): void {
    clearTimeout(this.runTimer);
    this.building = undefined;
    this.startedAt = 0;
  }

  /** Reject every font request that is waiting. */
  private rejectFonts(why: RunStopped): void {
    const all = [...this.fonts.values()];
    this.fonts.clear();
    for (const f of all) f.reject(why);
  }

  /** Reject the run in progress, if there is one. */
  private rejectBuilding(why: RunStopped): void {
    const run = this.building;
    this.clearBuilding();
    run?.reject(why);
  }

  /**
   * Reject the runs that wait their turn.
   *
   * @param why What to tell them.
   * @param only Reject only the runs for this purpose (default: all of them).
   */
  private rejectQueued(why: RunStopped, only?: RunPurpose): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (only && this.queue[i].purpose !== only) continue;
      this.queue.splice(i, 1)[0].reject(why);
    }
  }

  /**
   * The engine could not start: give up on it (a run now would only wait out
   * the time limit), and say why to everything waiting.
   *
   * @param detail What went wrong.
   */
  private fail(detail: string): void {
    this.worker.terminate();
    clearTimeout(this.loadTimer);
    this.failed = `the 3D engine did not start: ${detail}`;
    const why = new RunStopped("failed", this.failed);
    this.rejectBuilding(why);
    this.rejectQueued(why);
    this.rejectFonts(why);
    this.restarted();
  }

  /** Wait for the next sign of life from a worker that is loading. */
  private armLoadTimer(): void {
    clearTimeout(this.loadTimer);
    this.loadTimer = window.setTimeout(() => !this.isReady && this.fail(`no sign of life from ${WORKER} for ${LOAD_STAGE_LIMIT / 1000} seconds (is it built and served next to the page?)`), LOAD_STAGE_LIMIT);
  }

  /** Start a new worker, and watch for it failing to load or going quiet. */
  private start(): void {
    this.isReady = false;
    this.failed = "";
    this.sentFiles = null; // a new worker has no files
    this.worker = new Worker(WORKER);
    // a worker whose script is missing, or that fails as it loads, raises an
    // error here; one whose script never arrives says nothing, so it is timed
    this.worker.onerror = (e) => this.fail(e.message || `${WORKER} could not be loaded (is it built and served next to the page?)`);
    // an answer the page cannot read (a result that cannot be copied) ends what was being built
    this.worker.onmessageerror = () => this.restart(new RunStopped("error", "the engine's answer could not be read"));
    this.armLoadTimer();
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.handle(e.data);
  }

  /**
   * Send the next run to the worker, if the engine is ready and none is being
   * built. Whether the files go with it is decided now, when it is sent, since
   * a run that was asked for and then dropped never reached the worker.
   */
  private pump(): void {
    if (this.failed || !this.isReady || this.building || !this.queue.length) return;
    const run = this.queue.shift()!;
    const needed = this.sentFiles === null || !sameFiles(run.files, this.sentFiles);
    if (needed) this.sentFiles = run.files;
    this.building = run;
    this.startedAt = Date.now();
    this.runTimer = window.setTimeout(() => this.timedOut(run), TIME_LIMIT);
    this.worker.postMessage({ type: "run", id: run.id, program: run.program, ...(needed ? { files: run.files } : {}), ...(run.withHidden ? { withHidden: true as const } : {}) } satisfies ToWorker);
  }

  /**
   * The run in progress took too long: end the worker and say so; the runs that
   * wait go on.
   *
   * @param run The run whose time ran out.
   */
  private timedOut(run: PendingRun): void {
    if (this.building !== run) return;
    this.restart(new RunStopped("time"));
  }

  /**
   * End the worker and start a new one. The run in progress and the font
   * requests are rejected with `why`; the runs that wait their turn are kept
   * for the new worker.
   *
   * @param why What to tell the run and the font requests.
   */
  private restart(why: RunStopped): void {
    this.worker.terminate();
    this.rejectBuilding(why);
    this.rejectFonts(why);
    this.start();
    this.restarted();
  }

  /**
   * Settle the font request with this id.
   *
   * @param id Which request.
   * @param error Why it failed, or nothing if it arrived.
   */
  private settleFont(id: number, error?: RunStopped): void {
    const f = this.fonts.get(id);
    this.fonts.delete(id);
    if (error) f?.reject(error);
    else f?.resolve();
  }

  /**
   * A message from the worker.
   *
   * @param m What it said.
   */
  private handle(m: FromWorker): void {
    switch (m.type) {
      case "progress":
        if (!this.isReady) this.armLoadTimer();
        break;
      case "ready":
        this.isReady = true;
        clearTimeout(this.loadTimer);
        this.pump();
        break;
      case "ran":
        if (this.building?.id === m.id) {
          const run = this.building;
          this.clearBuilding();
          run.resolve(m.result);
          this.pump();
        }
        break;
      case "fonted":
        this.settleFont(m.id);
        break;
      case "failed":
        if (m.id === undefined) this.fail(m.message);
        else if (this.building?.id === m.id) {
          const run = this.building;
          this.clearBuilding();
          run.reject(new RunStopped("error", m.message));
          this.pump();
        } else {
          this.settleFont(m.id, new RunStopped("error", m.message));
        }
        break;
    }
  }
}

/** The 3D engine, in a Web Worker. Runs are one at a time, in order. */
export function createShapeEngine(): ShapeEngine {
  return new WorkerEngine();
}

/**
 * What a run that gave no result says is wrong.
 *
 * @param why Why the run gave no result.
 * @param seconds The time limit, in seconds, for the message about taking too long.
 * @param detail What the engine said, for `failed` and `error`.
 */
export function stoppedProblem(why: RunStopped["why"], seconds: number, detail = ""): Problem {
  if (why === "failed") return { blockId: "", message: `Cannot build: ${detail}. Reload the page; if it keeps happening, the engine files may be missing from the server, or this browser may not support them.` };
  if (why === "error") return { blockId: "", message: `The 3D engine failed while building this: ${detail}.` };
  const cause = why === "time" ? `building this took more than ${seconds} seconds, so it was stopped` : "building this was stopped";
  return { blockId: "", message: `Stopped: ${cause}. Some shape is probably too big or too detailed (rounding, filleting, chamfering or hollowing a shape with many curves is slow): use fewer sides on the curves, or finish a smaller shape.` };
}

/**
 * A text block's font may be a Google font (anything that is not one of the
 * built-in fonts). The function this returns asks the engine for the fonts a
 * program needs that it has not been asked for yet, and calls `again` when one
 * is in (or has failed, which the text block then says), so the program can be
 * built with it. It gives back a promise that is settled when every font it
 * asked for just now has arrived or failed. The engine forgets its fonts when
 * it has to start again, so they are asked for again then.
 *
 * @param engine The engine to ask.
 * @param again Called when a font has arrived.
 */
export function createFontRequester(engine: ShapeEngine, again: () => void): (program: Program) => Promise<void> {
  const requested = new Set<string>();
  engine.addRestartListener(() => requested.clear());
  return (program) => {
    const arriving: Promise<void>[] = [];
    for (const b of allBlocks(program)) {
      const wanted = b.kind === "text" ? String(b.args.font ?? "").trim() : "";
      if (!wanted || builtInFont(wanted) || requested.has(wanted)) continue;
      try {
        googleFontId(parseGoogleFont(wanted));
      } catch {
        continue; // the text block reports what is wrong with what was typed
      }
      requested.add(wanted);
      arriving.push(engine.loadGoogleFont(wanted).then(again, () => {}));
    }
    return Promise.all(arriving).then(() => {});
  };
}
