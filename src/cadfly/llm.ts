import type { ChatBackend, GenerateRequest } from "./assistant/backend";
import { generateWithRetry } from "./assistant/retry";

type WebLLMModule = typeof import("@mlc-ai/web-llm");
type Engine = Awaited<ReturnType<WebLLMModule["CreateWebWorkerMLCEngine"]>>;

/** The models offered.  Sizes are what the browser downloads once, and the video memory it then needs. */
export interface ModelChoice {
  id: string;
  label: string;
  download: string;
  memory: string;
  note: string;
}

export const MODELS: ModelChoice[] = [
  { id: "Qwen3-4B-q4f16_1-MLC", label: "Qwen3 4B", download: "about 2.5 GB", memory: "3.4 GB", note: "best answers; the recommended one" },
  { id: "Qwen3-1.7B-q4f16_1-MLC", label: "Qwen3 1.7B", download: "about 1.1 GB", memory: "2 GB", note: "faster and smaller, makes more mistakes" },
  { id: "Qwen3-8B-q4f16_1-MLC", label: "Qwen3 8B", download: "about 4.5 GB", memory: "5.7 GB", note: "for strong graphics cards" },
];

const SCRIPT = "./webllm.bundle.js";
const WORKER = "./webllm.worker.bundle.js";

let loading: Promise<WebLLMModule> | undefined;

/** Fetch the engine's code, once, the first time it is needed */
function loadEngineCode(): Promise<WebLLMModule> {
  loading ??= new Promise((resolve, reject) => {
    const have = (globalThis as unknown as { WebLLM?: WebLLMModule }).WebLLM;
    if (have) return resolve(have);
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.onload = () => resolve((globalThis as unknown as { WebLLM: WebLLMModule }).WebLLM);
    script.onerror = () => {
      loading = undefined;
      reject(new Error("could not load the language-model code"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Can this browser run a model? It needs WebGPU *and* a graphics adapter it will hand out: a browser can have
 * the first and not the second (common on Linux, or with a blocked or old driver).  Returns why not, if not.
 */
export async function webGpuProblem(): Promise<string | undefined> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return "This browser does not have WebGPU.";
  try {
    if (!(await gpu.requestAdapter())) return "This browser has WebGPU, but it found no usable graphics adapter.";
  } catch (e) {
    return `WebGPU failed to start: ${(e as Error).message}`;
  }
  return undefined;
}

export type LlmState = "idle" | "loading" | "ready";

/** What the chat needs from a model: the chat panel talks to this, so a test can put a fake in its place */
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
  state: LlmState = "idle";
  modelId = "";
  private engine?: Engine;
  private worker?: Worker;

  /** Is this model already downloaded? */
  async isDownloaded(modelId: string): Promise<boolean> {
    return (await loadEngineCode()).hasModelInCache(modelId);
  }

  /** Download (if needed) and start a model. `progress` gets a fraction 0..1 and a line of text. */
  async load(modelId: string, progress: (fraction: number, text: string) => void): Promise<void> {
    if (this.state === "ready" && this.modelId === modelId) return;
    await this.stop();
    this.state = "loading";
    try {
      const webllm = await loadEngineCode();
      this.worker = new Worker(WORKER);
      this.engine = await webllm.CreateWebWorkerMLCEngine(this.worker, modelId, {
        initProgressCallback: (report) => progress(report.progress, report.text),
      });
      this.modelId = modelId;
      this.state = "ready";
    } catch (e) {
      await this.stop();
      throw e;
    }
  }

  /** Stop the model and free its memory */
  async stop() {
    try {
      await this.engine?.unload();
    } catch {
      // already gone
    }
    this.worker?.terminate();
    this.engine = this.worker = undefined;
    this.state = "idle";
  }

  /** Delete a downloaded model from the browser's storage */
  async remove(modelId: string) {
    if (this.modelId === modelId) await this.stop();
    await (await loadEngineCode()).deleteModelAllInfoInCache(modelId);
  }

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
          onRetry: async (attempt, constrained, error) => {
            console.warn(`the model's grammar sampler failed (try ${attempt}); trying again${constrained ? "" : " without the grammar"}:`, error);
            await engine.resetChat().catch(() => undefined);
          },
        },
      );
    } finally {
      req.signal?.removeEventListener("abort", stop);
    }
  }
}
