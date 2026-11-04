// The 3D engine runs in a Web Worker: a program that takes a long time to build (rounding a big shape) then does not freeze the page,
// and can be stopped by ending the worker.
import wasmUrl from "manifold-3d/manifold.wasm";
import { installFonts, installGoogleFont } from "./geometry/fonts";
import { createManifoldKernel } from "./geometry/manifold";
import type { Program } from "./language/types";
import { runProgram } from "./language/run";
import { type FromWorker, type ToWorker, buffersOf, snapshot } from "./language/snapshot";

const post = (m: FromWorker, transfer: ArrayBuffer[] = []) => (self as unknown as Worker).postMessage(m, transfer);

const ready = (async () => {
  const kernel = await createManifoldKernel({ wasmUrl });
  await installFonts(async (file) => (await fetch(`./assets/${file}`)).arrayBuffer());
  post({ type: "ready" });
  return kernel;
})();

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  const kernel = await ready;
  if (m.type === "font") {
    await installGoogleFont(m.input);
    post({ type: "fonted", id: m.id });
  } else {
    try {
      const result = snapshot(runProgram(kernel, m.program as Program, m.files));
      post({ type: "ran", id: m.id, result }, buffersOf(result));
    } finally {
      kernel.release(); // the result is plain data now: free the shapes the run made, or the worker's memory grows with every run
    }
  }
};
