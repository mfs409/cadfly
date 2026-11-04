import type { ChatBackend, GenerateRequest } from "./backend";
import { replySchema } from "./schema";

/** A call to the Gemini API that did not work, with what Google said */
export class GeminiError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or 0 if the request never got an answer */
    readonly status: number,
    /** For a 429: how long Google asks to wait before trying again, in seconds */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface GeminiOptions {
  /** An API key from Google AI Studio. It stays on this machine and is sent only to Google. */
  apiKey: string;
  /** Default: the small, cheap one */
  model?: string;
  /** For tests, or to go through your own server (which then holds the key) */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Extra room, in tokens, for a model that "thinks" before it answers: its thoughts count against the limit */
  thinkingRoom?: number;
  /** For tests: how to wait between tries when Google is busy */
  sleep?(ms: number): Promise<void>;
}

/** A copy of a schema without the given keywords, at every depth */
function without(schema: unknown, drop: string[]): unknown {
  if (Array.isArray(schema)) return schema.map((s) => without(s, drop));
  if (schema && typeof schema === "object") return Object.fromEntries(Object.entries(schema).filter(([k]) => !drop.includes(k)).map(([k, v]) => [k, without(v, drop)]));
  return schema;
}

/**
 * The reply schema for Google's service: the full one from schema.ts (every block with its own fields, nested
 * through references), without `maxItems`, which the service refuses ("invalid argument") on arrays that sit
 * inside others. Found by trying each keyword; `maxLength`, `$defs` and recursive references are accepted.
 * The reader checks the number of ops itself.
 */
export function geminiReplySchema(): object {
  return without(replySchema(), ["maxItems"]) as object;
}

/** Google's models have a context window of many thousands of tokens: room for every example, and long programs */
export const GEMINI_BUDGET = { context: 16384, reply: 1500 };

export const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

interface Part {
  text?: string;
  thought?: boolean;
}
interface Reply {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string };
}

/**
 * A model hosted by Google, over plain HTTPS (no SDK, so it runs in a browser or Node). The reply is
 * constrained to the schema by the service. Counts what it uses, for working out the cost.
 */
export class GeminiBackend implements ChatBackend {
  requests = 0;
  inputTokens = 0;
  outputTokens = 0;

  constructor(private options: GeminiOptions) {}

  /** Ask Google whether the key works, without generating anything (so it costs nothing). Throws a GeminiError if not. */
  async check(): Promise<void> {
    const { apiKey, baseUrl = BASE } = this.options;
    let res: Response;
    try {
      res = await (this.options.fetch ?? fetch)(`${baseUrl}/models?pageSize=1`, { headers: { "x-goog-api-key": apiKey } });
    } catch (e) {
      throw new GeminiError(`could not reach Google (${(e as Error).message})`, 0);
    }
    if (!res.ok) throw failure(res, (await res.json().catch(() => ({}))) as Reply);
  }

  async generate(req: GenerateRequest): Promise<string> {
    const { apiKey, model = GEMINI_DEFAULT_MODEL, baseUrl = BASE, thinkingRoom = 2048 } = this.options;
    const doFetch = this.options.fetch ?? fetch;
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content);
    const body = {
      ...(system.length ? { systemInstruction: { parts: [{ text: system.join("\n\n") }] } } : {}),
      contents: req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: req.maxTokens + thinkingRoom,
        responseMimeType: "application/json",
        responseJsonSchema: geminiReplySchema(),
      },
    };
    let res: Response;
    // Google answers 503 ("high demand") now and then; it passes, so try again a few times
    for (let busy = 0; ; busy++) {
      try {
        // the key goes in a header, never in the address (addresses end up in logs)
        res = await doFetch(`${baseUrl}/models/${model}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: req.signal,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        throw new GeminiError(`could not reach Google (${(e as Error).message})`, 0);
      }
      if (res.status !== 503 || busy >= 3) break;
      await (this.options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(2000 * 2 ** busy);
    }
    const data = (await res.json().catch(() => ({}))) as Reply;
    if (!res.ok) throw failure(res, data);
    this.requests++;
    this.inputTokens += data.usageMetadata?.promptTokenCount ?? 0;
    this.outputTokens += (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0);
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
    if (!text) {
      const why = data.promptFeedback?.blockReason ? `blocked (${data.promptFeedback.blockReason})` : (candidate?.finishReason ?? "no answer");
      throw new GeminiError(`the model gave no reply: ${why}`, res.status);
    }
    return text;
  }
}

/** Turn an error answer into something a person can act on */
function failure(res: Response, data: Reply): GeminiError {
  const said = data.error?.message ?? res.statusText;
  const retry = Number(res.headers.get("retry-after")) || undefined;
  if (res.status === 429) return new GeminiError(`Google's limit on this key was reached; wait a little and try again (${said})`, 429, retry);
  if (res.status === 400 && /api key/i.test(said)) return new GeminiError("Google did not accept this API key", 400);
  if (res.status === 401 || res.status === 403) return new GeminiError(`this API key is not allowed to do that (${said})`, res.status);
  return new GeminiError(said || `HTTP ${res.status}`, res.status, retry);
}
