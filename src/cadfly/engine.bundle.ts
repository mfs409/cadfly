// The 3D engine runs in a Web Worker: a program that takes a long time to
// build (rounding a big shape) then does not freeze the page, and can be
// stopped by ending the worker.
import wasmUrl from "manifold-3d/manifold.wasm";
import { installFonts } from "./geometry/fonts";
import { createManifoldKernel } from "./geometry/manifold";
import type { FromWorker, ToWorker } from "./protocol";
import { type WorkerState, describeError, handleMessage } from "./worker";

/** Send a message to the page, handing over buffers instead of copying them. */
const post = (m: FromWorker, transfer: ArrayBuffer[] = []) => (self as unknown as Worker).postMessage(m, transfer);

post({ type: "progress", stage: "script" });

/**
 * The geometry kernel, once it and the fonts have loaded. The page is told at
 * each step, and at once, with the words for it, if a step fails, so that it
 * can say why and not wait.
 */
const kernel = (async () => {
  let k: Awaited<ReturnType<typeof createManifoldKernel>>;
  try {
    k = await createManifoldKernel({ wasmUrl });
  } catch (e) {
    post({ type: "failed", message: `the geometry engine (WebAssembly) did not load: ${describeError(e)}` });
    throw e;
  }
  post({ type: "progress", stage: "wasm" });
  try {
    await installFonts(async (file) => {
      const response = await fetch(`./assets/${file}`);
      if (!response.ok) throw new Error(`the font file ${file} could not be fetched (${response.status})`);
      return response.arrayBuffer();
    });
  } catch (e) {
    post({ type: "failed", message: `the built-in fonts did not load: ${describeError(e)}` });
    throw e;
  }
  post({ type: "ready" });
  return k;
})();
// a load that failed is reported above, and again for every message that waits for it
kernel.catch(() => undefined);

/** What the worker remembers between messages. */
const state: WorkerState = { files: {} };

// A message from the page: a run builds the program and posts a snapshot of the result, and a font
// request installs a Google font.
self.onmessage = (event: MessageEvent<ToWorker>) => void handleMessage(kernel, state, event.data, post);
