import type { StlFiles } from "./language/files";
import type { Program } from "./language/types";
import type { RunSnapshot } from "./snapshot";

/**
 * The messages that pass between the page and the Web Worker that runs the 3D
 * engine. Each request carries an `id`, which comes back in its answer.
 */

/**
 * The messages the page sends to the worker: run a program, or fetch a Google
 * font.
 *
 * A run carries the project's files only when the worker does not have them
 * already: they can be many megabytes of text, and copying them to the worker
 * for every run would cost more than a quick run. The worker keeps the files
 * of the last run that had any, and uses them for the runs that have none.
 *
 * A run with `withHidden` also answers with the hidden shapes, for an export
 * that includes them. Other runs leave them out, so they cost nothing.
 */
export type ToWorker = { type: "run"; id: number; program: Program; files?: StlFiles; withHidden?: true } | { type: "font"; id: number; input: string };

/**
 * A step of the engine's start-up that has been reached: the worker's script is
 * running (`script`), or the geometry kernel has loaded and the fonts are being
 * fetched (`wasm`).
 */
export type LoadStage = "script" | "wasm";

/**
 * The messages the worker sends to the page:
 * - `progress`: a step of the start-up has been reached (a sign of life);
 * - `ready`: the engine has loaded;
 * - `ran`: a run is done, with its snapshot;
 * - `fonted`: a font request has finished (it worked or failed: the font's
 *   status says which);
 * - `failed`: something went wrong, with the words for it. With an `id`, that
 *   request failed. Without one, the engine could not start.
 */
export type FromWorker =
  | { type: "progress"; stage: LoadStage }
  | { type: "ready" }
  | { type: "ran"; id: number; result: RunSnapshot }
  | { type: "fonted"; id: number }
  | { type: "failed"; id?: number; message: string };
