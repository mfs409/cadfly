import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { Kernel } from "../src/cadfly/geometry/kernel";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { toBase64, writeStl } from "../src/cadfly/geometry/stl";
import type { Program } from "../src/cadfly/language/types";
import type { FromWorker, ToWorker } from "../src/cadfly/protocol";
import { type WorkerState, handleMessage } from "../src/cadfly/worker";

/**
 * What the worker does with a message from the page, and what it says when
 * something goes wrong.
 */

let k: Kernel;
beforeAll(async () => {
  k = await createManifoldKernel();
});
afterEach(() => vi.restoreAllMocks());

/** A program of one box. */
const boxProgram = (w = "10"): Program => [{ id: "s1", name: "build", blocks: [{ id: "b1", kind: "box", args: { w, d: "10", h: "10" } }] }];

/** Handle a message and collect what the worker posts. */
async function handle(kernel: Kernel | Promise<Kernel>, state: WorkerState, m: ToWorker) {
  const posted: { message: FromWorker; transfer: ArrayBuffer[] | undefined }[] = [];
  await handleMessage(kernel, state, m, (message, transfer) => void posted.push({ message, transfer }));
  return posted;
}

describe("a run", () => {
  test("is built and answered with a snapshot, whose buffers are handed over", async () => {
    const posted = await handle(k, { files: {} }, { type: "run", id: 7, program: boxProgram() });
    expect(posted).toHaveLength(1);
    const answer = posted[0].message;
    expect(answer.type).toBe("ran");
    if (answer.type !== "ran") return;
    expect(answer.id).toBe(7);
    expect(answer.result.combined!.volume).toBeCloseTo(1000);
    expect(posted[0].transfer).toHaveLength(2); // the one solid's positions and indices, once
  });

  test("answers with the hidden shapes only when the run asks for them", async () => {
    const program: Program = [{ id: "s1", name: "build", blocks: [{ id: "b1", kind: "box", args: { w: "10", d: "10", h: "10" } }, { id: "b2", kind: "box", args: { name: "secret", w: "4", d: "4", h: "4" }, hidden: true }] }];
    const plain = (await handle(k, { files: {} }, { type: "run", id: 1, program })).map((p) => p.message)[0];
    const asked = (await handle(k, { files: {} }, { type: "run", id: 2, program, withHidden: true })).map((p) => p.message)[0];
    if (plain.type !== "ran" || asked.type !== "ran") throw new Error("not answered");
    expect(plain.result.hidden).toBeUndefined();
    expect(asked.result.hidden!.shapes.map((s) => s.name)).toEqual(["secret"]);
  });

  test("keeps the files that come with it for the runs that come without", async () => {
    const state: WorkerState = { files: {} };
    const stl = toBase64(writeStl(k.box(10, 10, 10).mesh()));
    const program: Program = [{ id: "s1", name: "build", blocks: [{ id: "b1", kind: "import", args: { file: "box.stl" } }] }];
    const first = await handle(k, state, { type: "run", id: 1, program, files: { "box.stl": stl } });
    const second = await handle(k, state, { type: "run", id: 2, program });
    for (const answer of [first[0].message, second[0].message]) {
      expect(answer.type).toBe("ran");
      if (answer.type === "ran") expect(answer.result.problem).toBeUndefined();
    }
    expect(Object.keys(state.files)).toEqual(["box.stl"]);
  });

  test("takes its files at once, before the engine has loaded, so a run without files sees those of the run before it", async () => {
    const state: WorkerState = { files: {} };
    let load: (kernel: Kernel) => void = () => undefined;
    const loading = new Promise<Kernel>((resolve) => (load = resolve));
    const first = handle(loading, state, { type: "run", id: 1, program: [], files: { "a.stl": "AAAA" } });
    expect(state.files).toEqual({ "a.stl": "AAAA" });
    load(k);
    await first;
  });
});

describe("when something goes wrong", () => {
  test("a run that throws is answered `failed`, with its id and the words for what happened, and the shapes it made are still freed", async () => {
    const release = vi.spyOn(k, "release");
    const proto: { mesh: () => unknown } = Object.getPrototypeOf(k.box(1, 1, 1));
    const real = proto.mesh;
    proto.mesh = () => {
      throw new RangeError("out of memory");
    };
    try {
      const posted = await handle(k, { files: {} }, { type: "run", id: 9, program: boxProgram() });
      expect(posted.map((p) => p.message)).toEqual([{ type: "failed", id: 9, message: "out of memory" }]);
      expect(release).toHaveBeenCalled();
    } finally {
      proto.mesh = real;
    }
  });

  test("the worker goes on to the next run after a failure", async () => {
    const state: WorkerState = { files: {} };
    const proto: { mesh: () => unknown } = Object.getPrototypeOf(k.box(1, 1, 1));
    const real = proto.mesh;
    proto.mesh = () => {
      throw new Error("boom");
    };
    try {
      expect((await handle(k, state, { type: "run", id: 1, program: boxProgram() }))[0].message.type).toBe("failed");
    } finally {
      proto.mesh = real;
    }
    expect((await handle(k, state, { type: "run", id: 2, program: boxProgram() }))[0].message.type).toBe("ran");
  });

  test("an engine that did not load answers every message `failed`, with its id", async () => {
    const broken = Promise.reject(new Error("bad magic number"));
    broken.catch(() => undefined);
    const run = await handle(broken, { files: {} }, { type: "run", id: 3, program: boxProgram() });
    expect(run[0].message).toEqual({ type: "failed", id: 3, message: "the 3D engine did not load: bad magic number" });
    const font = await handle(broken, { files: {} }, { type: "font", id: 4, input: "Pacifico" });
    expect(font[0].message).toMatchObject({ type: "failed", id: 4 });
  });

  test("something thrown that is not an Error is still put in words", async () => {
    const proto: { mesh: () => unknown } = Object.getPrototypeOf(k.box(1, 1, 1));
    const real = proto.mesh;
    proto.mesh = () => {
      throw "plain text";
    };
    try {
      const posted = await handle(k, { files: {} }, { type: "run", id: 5, program: boxProgram() });
      expect(posted[0].message).toEqual({ type: "failed", id: 5, message: "plain text" });
    } finally {
      proto.mesh = real;
    }
  });
});

describe("a font request", () => {
  test("is answered once, whether or not the font could be had", async () => {
    const posted = await handle(k, { files: {} }, { type: "font", id: 6, input: "!!not a font!!" });
    expect(posted).toHaveLength(1);
    expect(posted[0].message).toMatchObject({ id: 6 });
  });
});
