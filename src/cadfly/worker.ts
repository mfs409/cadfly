import { installGoogleFont } from "./geometry/fonts";
import type { Kernel } from "./geometry/kernel";
import { keepOnlyMeshesNamed } from "./geometry/stl";
import type { StlFiles } from "./language/files";
import { runProgram } from "./language/run";
import type { FromWorker, ToWorker } from "./protocol";
import { buffersOf, snapshotOf } from "./snapshot";

/**
 * What the worker that runs the 3D engine does with a message from the page:
 * build a program and answer with a snapshot of the result, or install a
 * Google font. Whatever goes wrong while handling a message is answered with a
 * `failed` message that says what, so the page never has to wait out a timeout
 * to find out.
 */

/** What the worker remembers between messages. */
export interface WorkerState {
  /** The project's files, from the last run that came with them */
  files: StlFiles;
}

/**
 * The words for an error, for a message to the page.
 *
 * @param e Whatever was thrown.
 */
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

/**
 * Take the files that arrive with a run. This is done at once, before waiting
 * for the engine to load, so that a run without files sees those of the run
 * before it.
 *
 * @param state What the worker remembers.
 * @param m The message.
 */
export function takeFiles(state: WorkerState, m: ToWorker) {
  if (m.type === "run" && m.files) {
    state.files = m.files;
    keepOnlyMeshesNamed(Object.keys(state.files)); // the files the project has now; the ones it lost are freed
  }
}

/**
 * Handle one message from the page.
 *
 * @param kernel The geometry kernel, or a promise of it while it is loading. If
 *               it fails to load, every message is answered `failed`.
 * @param state What the worker remembers between messages.
 * @param m The message.
 * @param post Sends a message to the page, handing over the buffers listed
 *             second instead of copying them.
 */
export async function handleMessage(kernel: Kernel | Promise<Kernel>, state: WorkerState, m: ToWorker, post: (m: FromWorker, transfer?: ArrayBuffer[]) => void): Promise<void> {
  takeFiles(state, m);
  let k: Kernel;
  try {
    k = await kernel;
  } catch (e) {
    post({ type: "failed", id: m.id, message: `the 3D engine did not load: ${describeError(e)}` });
    return;
  }
  try {
    if (m.type === "font") {
      await installGoogleFont(m.input);
      post({ type: "fonted", id: m.id });
    } else {
      try {
        const result = snapshotOf(runProgram(k, m.program, state.files, m.withHidden === true), m.withHidden === true);
        post({ type: "ran", id: m.id, result }, buffersOf(result));
      } finally {
        k.release(); // the result is plain data now: free the shapes the run made, or the worker's memory grows with every run
      }
    }
  } catch (e) {
    post({ type: "failed", id: m.id, message: describeError(e) });
  }
}
