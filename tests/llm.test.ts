import { afterEach, describe, expect, test, vi } from "vitest";
import { WebLlm, webGpuProblem } from "../src/cadfly/llm";

/** Whether this browser can run a model, and whether one is already downloaded. */

afterEach(() => vi.unstubAllGlobals());

/** A stand-in for the browser's WebGPU object, whose adapter has these features. */
const gpuWith = (features: string[] | undefined) => ({ requestAdapter: async () => ({ features: features && new Set(features) }) });

describe("can this browser run a model", () => {
  test("it can with WebGPU, an adapter, and 16-bit shaders", async () => {
    expect(await webGpuProblem(gpuWith(["shader-f16", "timestamp-query"]))).toBeUndefined();
  });

  test("without WebGPU it says so", async () => {
    expect(await webGpuProblem(undefined)).toMatch(/does not have WebGPU/);
  });

  test("with no adapter it says so", async () => {
    expect(await webGpuProblem({ requestAdapter: async () => null })).toMatch(/no usable graphics adapter/);
  });

  test("an adapter without 16-bit shaders is named plainly, not left to fail when the model loads", async () => {
    const why = await webGpuProblem(gpuWith(["timestamp-query"]));
    expect(why).toMatch(/does not support 16-bit shaders \(shader-f16\)/);
    expect(await webGpuProblem(gpuWith([]))).toBe(why);
    expect(await webGpuProblem(gpuWith(undefined))).toBe(why);
  });

  test("a WebGPU that throws is reported with its message", async () => {
    expect(await webGpuProblem({ requestAdapter: async () => Promise.reject(new Error("device blocked")) })).toBe("WebGPU failed to start: device blocked");
  });

  test("by default it asks the page's own WebGPU", async () => {
    vi.stubGlobal("navigator", { gpu: gpuWith(["shader-f16"]) });
    expect(await webGpuProblem()).toBeUndefined();
    vi.stubGlobal("navigator", {});
    expect(await webGpuProblem()).toMatch(/does not have WebGPU/);
  });
});

describe("is a model downloaded", () => {
  test("the code that checks is not fetched to find out: the browser's cache is asked", async () => {
    const asked: string[] = [];
    vi.stubGlobal("caches", {
      open: async (name: string) => ({
        match: async (url: string) => {
          asked.push(`${name} ${url}`);
          return url.includes("Qwen3-4B") ? {} : undefined;
        },
      }),
    });
    const model = new WebLlm();
    expect(await model.isDownloaded("Qwen3-4B-q4f16_1-MLC")).toBe(true);
    expect(await model.isDownloaded("Qwen3-1.7B-q4f16_1-MLC")).toBe(false);
    expect(asked[0]).toBe("webllm/model https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC/resolve/main/tensor-cache.json");
  });

  test("a browser with no cache, or one that refuses, says not downloaded", async () => {
    vi.stubGlobal("caches", undefined);
    expect(await new WebLlm().isDownloaded("Qwen3-4B-q4f16_1-MLC")).toBe(false);
    vi.stubGlobal("caches", { open: async () => Promise.reject(new Error("denied")) });
    expect(await new WebLlm().isDownloaded("Qwen3-4B-q4f16_1-MLC")).toBe(false);
  });

  test("when the library's code is already in the page it is asked instead", async () => {
    vi.stubGlobal("WebLLM", { hasModelInCache: async (id: string) => id === "yes" });
    const model = new WebLlm();
    expect(await model.isDownloaded("yes")).toBe(true);
    expect(await model.isDownloaded("no")).toBe(false);
  });
});

describe("the model that is loaded", () => {
  test("none is, to begin with, and stopping leaves none", async () => {
    const model = new WebLlm();
    expect(model.modelId).toBe("");
    await model.stop();
    expect(model.modelId).toBe("");
    expect(model.state).toBe("idle");
  });
});
