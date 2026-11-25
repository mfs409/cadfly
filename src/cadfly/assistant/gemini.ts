import type { ChatBackend, GenerateRequest } from "./backend";
import { answerSchema } from "./schema";

/**
 * Google's Gemini models as a backend. It sends the conversation over plain
 * HTTPS and returns the answer text, waits and tries again when Google says it
 * is busy, turns failures into errors a person can act on, and counts what it
 * uses so the cost can be worked out. It also holds the variant of the answer
 * schema that Google's service accepts.
 */

/**
 * What kind of failure a `GeminiError` is, so that code can act on it without
 * reading its words:
 * - `badKey`: Google does not accept the key (it is wrong, or revoked).
 * - `limit`: the key's limit was reached; waiting helps.
 * - `blocked`: Google refused to answer this request.
 * - `network`: the request never got an answer.
 * - `other`: anything else, including a key that is valid but not allowed to do
 *   this (a region limit, an API that is switched off).
 */
export type GeminiErrorKind = "badKey" | "limit" | "blocked" | "network" | "other";

/** A call to the Gemini API that did not work, with what Google said */
export class GeminiError extends Error {
  constructor(
    message: string,
    /** The HTTP status, or 0 if the request never got an answer */
    readonly status: number,
    /** For a 429: how long Google asks to wait before trying again, in seconds */
    readonly retryAfter?: number,
    /** What kind of failure it is */
    readonly kind: GeminiErrorKind = "other",
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/** How to reach Google, and what to use when testing. */
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
function omitKeys(schema: unknown, drop: string[]): unknown {
  if (Array.isArray(schema)) return schema.map((s) => omitKeys(s, drop));
  if (schema && typeof schema === "object") return Object.fromEntries(Object.entries(schema).filter(([k]) => !drop.includes(k)).map(([k, v]) => [k, omitKeys(v, drop)]));
  return schema;
}

/**
 * The answer schema for Google's service: the same small schema (block text in
 * strings), without `maxItems`, which the service refuses ("invalid argument")
 * on arrays that sit inside others. Found by trying each keyword; `maxLength` is
 * accepted. The answer's reader checks the number of ops itself.
 */
export function geminiAnswerSchema(): object {
  return omitKeys(answerSchema(), ["maxItems"]) as object;
}

/** Google's models have a context window of many thousands of tokens: room for every example, and long programs */
export const GEMINI_BUDGET = { context: 16384, reply: 1500 };

/** The model used when none is named: small and cheap. */
export const GEMINI_DEFAULT_MODEL = "gemini-3.1-flash-lite";

/** Where Google's API is */
const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** How random the model's writing is: low, since a program has to be right */
const TEMPERATURE = 0.1;

/** How many times a request is tried again when Google says it is busy (503) */
const MAX_BUSY_RETRIES = 3;

/** How long to wait, in milliseconds, before the first try again when Google is busy: doubled each time after */
const BUSY_BACKOFF_MS = 2000;

/**
 * One piece of a reply, as Google sends it. A piece marked `thought` is the
 * model thinking aloud and is not part of the answer.
 */
interface Part {
  text?: string;
  thought?: boolean;
}
/** The parts of what Google sends back that are used here, whether the request worked or not. */
interface GeminiResponse {
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
  /** How many requests Google has answered */
  requests = 0;
  /** The tokens sent to Google so far, for working out the cost */
  inputTokens = 0;
  /** The tokens Google has written so far, thinking included, for working out the cost */
  outputTokens = 0;

  constructor(private options: GeminiOptions) {}

  /** Ask Google whether the key works, without generating anything (so it costs nothing). Throws a GeminiError if not. */
  async check(): Promise<void> {
    const { apiKey, baseUrl = BASE } = this.options;
    const res = await reachGoogle(this.options.fetch ?? fetch, `${baseUrl}/models?pageSize=1`, { headers: { "x-goog-api-key": apiKey } });
    if (!res.ok) throw errorFor(res, (await res.json().catch(() => ({}))) as GeminiResponse);
  }

  /**
   * Send the conversation and return what the model wrote. A 503 ("high
   * demand") is tried again a few times, waiting longer each time. Any other
   * failure throws a `GeminiError`, and so does a reply with no text in it,
   * such as one that was blocked.
   *
   * @param req The messages, the schema the reply must match, and the most the model may write.
   */
  async generate(req: GenerateRequest): Promise<string> {
    const { apiKey, model = GEMINI_DEFAULT_MODEL, baseUrl = BASE, thinkingRoom = 2048 } = this.options;
    const doFetch = this.options.fetch ?? fetch;
    const system = req.messages.filter((m) => m.role === "system").map((m) => m.content);
    const body = {
      ...(system.length ? { systemInstruction: { parts: [{ text: system.join("\n\n") }] } } : {}),
      contents: req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: req.maxTokens + thinkingRoom,
        responseMimeType: "application/json",
        responseJsonSchema: geminiAnswerSchema(),
      },
    };
    let res: Response;
    // Google answers 503 ("high demand") now and then; it passes, so try again a few times
    for (let busy = 0; ; busy++) {
      // the key goes in a header, never in the address (addresses end up in logs)
      res = await reachGoogle(doFetch, `${baseUrl}/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (res.status !== 503 || busy >= MAX_BUSY_RETRIES) break;
      await (this.options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms))))(BUSY_BACKOFF_MS * 2 ** busy);
    }
    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) throw errorFor(res, data);
    this.requests++;
    this.inputTokens += data.usageMetadata?.promptTokenCount ?? 0;
    this.outputTokens += (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0);
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
    if (!text) {
      const why = data.promptFeedback?.blockReason ? `blocked (${data.promptFeedback.blockReason})` : (candidate?.finishReason ?? "no answer");
      throw new GeminiError(`the model gave no reply: ${why}`, res.status, undefined, data.promptFeedback?.blockReason ? "blocked" : "other");
    }
    return text;
  }
}

/**
 * Send a request to Google. A request that never gets an answer becomes a
 * `GeminiError` with status 0; an abort goes out as it is.
 *
 * @param doFetch The function that sends it.
 * @param url Where to send it.
 * @param init The request.
 */
async function reachGoogle(doFetch: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await doFetch(url, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new GeminiError(`could not reach Google (${(e as Error).message})`, 0, undefined, "network");
  }
}

/** Turn an error answer into something a person can act on */
function errorFor(res: Response, data: GeminiResponse): GeminiError {
  const said = data.error?.message ?? res.statusText;
  const retry = Number(res.headers.get("retry-after")) || undefined;
  if (res.status === 429) return new GeminiError(`Google's limit on this key was reached; wait a little and try again (${said})`, 429, retry, "limit");
  if (res.status === 400 && /api key/i.test(said)) return new GeminiError("Google did not accept this API key", 400, undefined, "badKey");
  if (res.status === 401) return new GeminiError(`Google did not accept this API key (${said})`, 401, undefined, "badKey");
  if (res.status === 403) return new GeminiError(`this API key is not allowed to do that (${said})`, 403);
  return new GeminiError(said || `HTTP ${res.status}`, res.status, retry);
}
