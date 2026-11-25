import type { ChatBackend, GenerateRequest } from "./assistant/backend";
import { generateWithRetry } from "./assistant/retry";

/**
 * Running a language model in the browser with WebLLM. The engine's code is
 * fetched only when it is first needed, and the model runs in a Web Worker so
 * the page stays smooth. This file lists the models that are offered, finds out
 * whether this browser can run one, downloads and starts a model, and writes
 * replies that must match the schema. Nothing a person types leaves their
 * computer.
 */

/** The WebLLM library, as the type of its module. */
type WebLLMModule = typeof import("@mlc-ai/web-llm");
/** A model that is loaded and running in a worker. */
type LoadedModel = Awaited<ReturnType<WebLLMModule["CreateWebWorkerMLCEngine"]>>;

/** The models offered.  Sizes are what the browser downloads once, and the video memory it then needs. */
export interface ModelChoice {
  id: string;
  label: string;
  download: string;
  memory: string;
  note: string;
}

/** The models offered, best first. The first is the one recommended. */
export const MODELS: ModelChoice[] = [
  { id: "Qwen3-4B-q4f16_1-MLC", label: "Qwen3 4B", download: "about 2.5 GB", memory: "3.4 GB", note: "best answers; the recommended one" },
  { id: "Qwen3-1.7B-q4f16_1-MLC", label: "Qwen3 1.7B", download: "about 1.1 GB", memory: "2 GB", note: "faster and smaller, makes more mistakes" },
  { id: "Qwen3-8B-q4f16_1-MLC", label: "Qwen3 8B", download: "about 4.5 GB", memory: "5.7 GB", note: "for strong graphics cards" },
];

/** Where the engine's code is served. */
const SCRIPT = "./webllm.bundle.js";
/** Where the worker that runs a model is served. */
const WORKER = "./webllm.worker.bundle.js";

/** The name of the browser cache the library keeps a model's files in. */
const MODEL_CACHE = "webllm/model";
/** Where the models are served from; a model's files are under its id. */
const MODEL_HOST = "https://huggingface.co/mlc-ai/";

/** The engine's code, once it has been asked for. */
let loading: Promise<WebLLMModule> | undefined;

/** The engine's code if it is already in the page, without fetching it. */
function loadedEngineCode(): WebLLMModule | undefined {
  return (globalThis as unknown as { WebLLM?: WebLLMModule }).WebLLM;
}

/** Fetch the engine's code, once, the first time it is needed */
function loadEngineCode(): Promise<WebLLMModule> {
  loading ??= new Promise((resolve, reject) => {
    const have = loadedEngineCode();
    if (have) return resolve(have);
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.onload = () => {
      const code = loadedEngineCode();
      if (code) resolve(code);
      else {
        loading = undefined;
        reject(new Error("the language-model code loaded, but did not provide the engine"));
      }
    };
    script.onerror = () => {
      loading = undefined;
      reject(new Error("could not load the language-model code"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The part of the browser's WebGPU object that is used here: the adapter it
 * hands out, and the optional features that adapter has.
 */
interface GpuLike {
  requestAdapter(): Promise<{ features?: { has(feature: string): boolean } } | null>;
}

/**
 * The WebGPU feature the models need: 16-bit floating point in shaders. All the
 * models offered are `q4f16` builds, which compute in 16 bits, and a graphics
 * adapter without the feature cannot run them (the library's own check does not
 * name this requirement for these models, and the load then fails with an
 * unhelpful message).
 */
const SHADER_F16 = "shader-f16";

/**
 * Can this browser run a model? It needs WebGPU, a graphics adapter it will
 * hand out (a browser can have the first and not the second: common on Linux,
 * or with a blocked or old driver), and an adapter that has the 16-bit shader
 * feature the models need. Returns why not, if not.
 *
 * @param gpu The browser's WebGPU object. Default: the page's own (`navigator.gpu`).
 */
export async function webGpuProblem(gpu: GpuLike | undefined = (navigator as unknown as { gpu?: GpuLike }).gpu): Promise<string | undefined> {
  if (!gpu) return "This browser does not have WebGPU.";
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return "This browser has WebGPU, but it found no usable graphics adapter.";
    if (!adapter.features?.has(SHADER_F16)) return `This computer's graphics adapter does not support 16-bit shaders (${SHADER_F16}), which the models need.`;
  } catch (e) {
    return `WebGPU failed to start: ${(e as Error).message}`;
  }
  return undefined;
}

/** Where a model is: not loaded, being downloaded and started, or ready to answer. */
export type LlmState = "idle" | "loading" | "ready";

/** What the chat needs from a model: so a test can put a fake in its place */
export interface LocalModel extends ChatBackend {
  readonly state: LlmState;
  readonly modelId: string;
  isDownloaded(modelId: string): Promise<boolean>;
  load(modelId: string, progress: (fraction: number, text: string) => void): Promise<void>;
  stop(): Promise<void>;
  remove(modelId: string): Promise<void>;
}

/**
 * A language model running in the browser, through WebLLM, in a Web Worker.
 * Nothing leaves the machine; the model is downloaded once and kept by the browser.
 */
export class WebLlm implements LocalModel {
  /** Where the model is. */
  state: LlmState = "idle";
  /** Which model is loaded. Empty when none is (it is set when a load finishes and cleared by `stop`). */
  modelId = "";
  /** The running model, while one is loaded. */
  private engine?: LoadedModel;
  /** The worker the model runs in, while one is loaded. */
  private worker?: Worker;
  /** Gives up the load that is in progress, if there is one: `stop` calls it. */
  private giveUpLoading?: () => void;

  /**
   * Is this model already downloaded? The engine's code is large, so it is not
   * fetched just to find out: if it is not in the page yet, the browser's cache
   * is asked directly whether the model's file list is there. That is only a
   * good guess (a download that was cut short has the list), and it says "not
   * downloaded" if the library keeps its files somewhere else.
   *
   * @param modelId The model.
   */
  async isDownloaded(modelId: string): Promise<boolean> {
    const code = loadedEngineCode();
    if (code) return code.hasModelInCache(modelId);
    try {
      if (typeof caches === "undefined") return false;
      const cache = await caches.open(MODEL_CACHE);
      return !!(await cache.match(`${MODEL_HOST}${modelId}/resolve/main/tensor-cache.json`));
    } catch {
      return false;
    }
  }

  /**
   * Download (if needed) and start a model. `progress` gets a fraction 0..1 and a
   * line of text. If `stop` is called while it is loading, it throws an
   * `AbortError` and the model is left stopped, never ready.
   */
  async load(modelId: string, progress: (fraction: number, text: string) => void): Promise<void> {
    if (this.state === "ready" && this.modelId === modelId) return;
    await this.stop();
    this.state = "loading";
    try {
      const webllm = await loadEngineCode();
      const worker = new Worker(WORKER);
      this.worker = worker;
      // `stop` rejects this, so a load that is given up does not wait for the engine
      const given = new Promise<never>((_, reject) => {
        this.giveUpLoading = () => reject(new DOMException("loading was stopped", "AbortError"));
      });
      const creating = webllm.CreateWebWorkerMLCEngine(worker, modelId, {
        initProgressCallback: (report) => progress(report.progress, report.text),
      });
      try {
        this.engine = await Promise.race([creating, given]);
      } catch (e) {
        // an engine that finishes after the load was given up is shut down, and its failure is not news
        creating.then((engine) => engine.unload()).catch(() => undefined);
        throw e;
      }
      if (this.state !== "loading" || this.worker !== worker) throw new DOMException("loading was stopped", "AbortError");
      this.giveUpLoading = undefined;
      this.modelId = modelId;
      this.state = "ready";
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  /** Stop the model, or the load that is in progress, and free its memory */
  async stop() {
    this.giveUpLoading?.();
    this.giveUpLoading = undefined;
    try {
      await this.engine?.unload();
    } catch {
      // already gone
    }
    this.worker?.terminate();
    this.engine = this.worker = undefined;
    this.modelId = "";
    this.state = "idle";
  }

  /** Delete a downloaded model from the browser's storage */
  async remove(modelId: string) {
    if (this.modelId === modelId) await this.stop();
    await (await loadEngineCode()).deleteModelAllInfoInCache(modelId);
  }

  /**
   * Ask the loaded model for a reply. The reply is held to the schema while the
   * model writes it. If the grammar's sampler glitches, it tries again, and
   * last of all without the grammar. Throws if no model is loaded, and an
   * `AbortError` if the request is aborted, which also stops the model.
   *
   * @param req The messages, the schema, and the most the model may write.
   */
  async generate(req: GenerateRequest): Promise<string> {
    const engine = this.engine;
    if (!engine || this.state !== "ready") throw new Error("the model is not loaded");
    if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const stop = () => void engine.interruptGenerate();
    req.signal?.addEventListener("abort", stop);
    try {
      // WebLLM's grammar sampler sometimes glitches (web-llm#807): try again, and in the end without the grammar
      return await generateWithRetry(
        async (constrained) => {
          const out = await engine.chat.completions.create({
            messages: req.messages,
            // the schema is enforced while the model writes, so the reply is well-formed
            ...(constrained ? { response_format: { type: "json_object" as const, schema: JSON.stringify(req.schema) } } : {}),
            max_tokens: req.maxTokens,
            temperature: 0.1,
            // Qwen3 can "think" first; that costs time and room in the window, and the schema does not allow it
            extra_body: { enable_thinking: false },
          });
          if (req.signal?.aborted) throw new DOMException("aborted", "AbortError");
          return out.choices[0]?.message.content ?? "";
        },
        {
          signal: req.signal,
          onRetry: async (attempt, nextIsConstrained, error) => {
            console.warn(`the model's grammar sampler failed (try ${attempt}); trying again${nextIsConstrained ? "" : " without the grammar"}:`, error);
            await engine.resetChat().catch(() => undefined);
          },
        },
      );
    } finally {
      req.signal?.removeEventListener("abort", stop);
    }
  }
}
