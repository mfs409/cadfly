import { describe, expect, test } from "vitest";
import type { ChatMessage } from "../src/cadfly/assistant/backend";
import Ajv from "ajv";
import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import { opsAsText } from "../src/cadfly/assistant/ops";
import { GeminiBackend, geminiReplySchema, GeminiError } from "../src/cadfly/assistant/gemini";

const SCHEMA = { type: "object" };
const ask = (b: GeminiBackend, messages: ChatMessage[] = [{ role: "system", content: "rules" }, { role: "user", content: "hi" }], signal?: AbortSignal) => b.generate({ messages, schema: SCHEMA, maxTokens: 700, signal });

function fake(reply: unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(reply), { status, headers });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const ok = (text: string, usage = { promptTokenCount: 2000, candidatesTokenCount: 100 }) => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: usage });

describe("the Gemini backend", () => {
  test("sends the system text, the turns, the schema and the key (in a header)", async () => {
    const { fetch, calls } = fake(ok('{"ops":[],"reply":"x"}'));
    const b = new GeminiBackend({ apiKey: "KEY", fetch });
    const out = await ask(b, [
      { role: "system", content: "rules" },
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(out).toBe('{"ops":[],"reply":"x"}');
    const { url, init } = calls[0];
    expect(url).toContain("/models/gemini-3.1-flash-lite:generateContent");
    expect(url).not.toContain("KEY");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("KEY");
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("rules");
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseJsonSchema).toEqual(geminiReplySchema());
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(700);
  });

  test("keeps only the answer, not the model's thoughts, and counts what was used", async () => {
    const { fetch } = fake({ candidates: [{ content: { parts: [{ text: "pondering", thought: true }, { text: '{"a":' }, { text: "1}" }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 7 } });
    const b = new GeminiBackend({ apiKey: "k", fetch });
    expect(await ask(b)).toBe('{"a":1}');
    expect([b.requests, b.inputTokens, b.outputTokens]).toEqual([1, 10, 12]);
  });

  test("a model option and a base address are used", async () => {
    const { fetch, calls } = fake(ok("{}"));
    await ask(new GeminiBackend({ apiKey: "k", model: "gemini-x", baseUrl: "https://proxy.example/v1", fetch }));
    expect(calls[0].url).toBe("https://proxy.example/v1/models/gemini-x:generateContent");
  });

  test("a limit reached says so, and how long to wait", async () => {
    const { fetch } = fake({ error: { message: "quota" } }, 429, { "retry-after": "12" });
    const err = await ask(new GeminiBackend({ apiKey: "k", fetch })).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err.status).toBe(429);
    expect(err.retryAfter).toBe(12);
    expect(err.message).toMatch(/limit/);
  });

  test("a bad key is reported plainly, and never repeated back", async () => {
    const { fetch } = fake({ error: { message: "API key not valid. Please pass a valid API key." } }, 400);
    const err = await ask(new GeminiBackend({ apiKey: "SECRET", fetch })).catch((e) => e);
    expect(err.message).toBe("Google did not accept this API key");
    expect(err.message).not.toContain("SECRET");
  });

  test("an empty or blocked answer is an error", async () => {
    const empty = fake({ candidates: [{ finishReason: "MAX_TOKENS" }] });
    await expect(ask(new GeminiBackend({ apiKey: "k", fetch: empty.fetch }))).rejects.toThrow(/MAX_TOKENS/);
    const blocked = fake({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(ask(new GeminiBackend({ apiKey: "k", fetch: blocked.fetch }))).rejects.toThrow(/blocked \(SAFETY\)/);
  });

  test("a network failure and a stopped request are told apart", async () => {
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    const err = await ask(new GeminiBackend({ apiKey: "k", fetch: down })).catch((e) => e);
    expect(err).toBeInstanceOf(GeminiError);
    expect(err.status).toBe(0);
    const stopped = (async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch;
    await expect(ask(new GeminiBackend({ apiKey: "k", fetch: stopped }))).rejects.toMatchObject({ name: "AbortError" });
  });

  test("when Google is busy it tries again, then gives up", async () => {
    let n = 0;
    const waits: number[] = [];
    const flaky = (async () => (++n < 3 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify(ok("{}"))))) as unknown as typeof fetch;
    expect(await ask(new GeminiBackend({ apiKey: "k", fetch: flaky, sleep: async (ms) => void waits.push(ms) }))).toBe("{}");
    expect(waits).toEqual([2000, 4000]);
    const always = fake({ error: { message: "high demand" } }, 503);
    await expect(ask(new GeminiBackend({ apiKey: "k", fetch: always.fetch, sleep: async () => {} }))).rejects.toThrow(/high demand/);
    expect(always.calls).toHaveLength(4);
  });

  test("the schema it sends accepts every worked example", () => {
    const valid = new Ajv({ strict: false }).compile(geminiReplySchema());
    for (const ex of WORKED_EXAMPLES) expect(valid({ ops: opsAsText(ex.ops), reply: ex.reply }), ex.user).toBe(true);
  });

  test("check asks Google whether the key works, and generates nothing", async () => {
    const good = fake({ models: [] });
    await new GeminiBackend({ apiKey: "k", fetch: good.fetch }).check();
    expect(good.calls[0].url).toContain("/models?");
    expect(good.calls[0].url).not.toContain(":generateContent");
    const bad = fake({ error: { message: "API key not valid" } }, 400);
    await expect(new GeminiBackend({ apiKey: "k", fetch: bad.fetch }).check()).rejects.toThrow("did not accept this API key");
  });
});
