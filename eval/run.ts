/**
 * Tries a model on the cases and writes the results to `out/`.
 *
 *     npm run eval -- qwen3:4b [--only id,id] [--out name]
 *
 * A name like `qwen3:4b` goes to a local Ollama.
 * Ollama turns the reply schema into a grammar, which is what WebLLM does in the browser, and the window is the same 4096 tokens the browser models have.
 * A name like `gemini:gemini-3.1-flash-lite` goes to Google.
 * It needs a key in `GEMINI_API_KEY`, `./key.secret` or `~/.config/cadfly/gemini-key`.
 * A free AI Studio key works, but the free tier allows only a few requests a minute, so the runner waits and retries.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { type AssistantState, ask, checkerFor } from "../src/cadfly/assistant/assistant";
import type { ChatBackend, GenerateRequest } from "../src/cadfly/assistant/backend";
import { GEMINI_BUDGET, GeminiBackend, GeminiError } from "../src/cadfly/assistant/gemini";
import { installFonts } from "../src/cadfly/geometry/fonts";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { runProgram } from "../src/cadfly/language/run";
import { CASES, type Outcome } from "./cases";

/** The command line, without the program name. */
const args = process.argv.slice(2);
/** Is `--name` on the command line? */
const flag = (name: string) => args.includes(`--${name}`);
/** The word after `--name` on the command line, if there is one. */
const option = (name: string): string | undefined => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
/** The model to try: the first word that is not an option or an option's value. */
const model: string =
  args.find((a) => !a.startsWith("--") && a !== option("only") && a !== option("out")) ??
  (() => {
    throw new Error("usage: run.ts <model> [--only id,id] [--out name]");
  })();
/** The ids of the cases to run, if `--only` limits them. */
const only = flag("only") ? option("only")!.split(",") : undefined;
/** Where Ollama is listening. */
const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/** A local model, asked through Ollama's chat interface, with a count of what it used. */
class Ollama implements ChatBackend {
  /** Tokens of prompt used so far in this case. */
  prompt = 0;
  /** Tokens generated so far in this case. */
  generated = 0;
  /** Seconds spent waiting for the model so far in this case. */
  seconds = 0;
  /** Everything the model has written so far in this case. */
  raws: string[] = [];
  /** Ask the model, with the reply schema as the grammar for its answer. */
  async generate(req: GenerateRequest): Promise<string> {
    const started = Date.now();
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: req.messages,
        stream: false,
        think: false,
        format: req.schema,
        options: { num_ctx: 4096, temperature: 0.1, num_predict: req.maxTokens },
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { message: { content: string }; prompt_eval_count: number; eval_count: number };
    this.seconds += (Date.now() - started) / 1000;
    this.prompt += data.prompt_eval_count;
    this.generated += data.eval_count;
    this.raws.push(data.message.content);
    return data.message.content;
  }
}

/** The key from a file: ./key.secret, or ~/.config/cadfly/gemini-key. May be the bare key or `NAME=key`. */
function readKeyFile(): string | undefined {
  for (const path of ["key.secret", `${homedir()}/.config/cadfly/gemini-key`]) {
    try {
      const key = readFileSync(path, "utf8").trim().replace(/^[A-Z_]+\s*=\s*/, "").replace(/^["']|["']$/g, "");
      if (key) return key;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

/** Google's backend, waiting out the rate limit instead of failing, with a count of what it used. */
class Gemini implements ChatBackend {
  /** Tokens of prompt used so far in this case. */
  prompt = 0;
  /** Tokens generated so far in this case. */
  generated = 0;
  /** Seconds spent waiting for the model so far in this case, not counting rate-limit waits. */
  seconds = 0;
  /** Everything the model has written so far in this case. */
  raws: string[] = [];
  /** The backend the app uses. */
  private inner: GeminiBackend;
  /**
   * @param name The model's name, such as `gemini-3.1-flash-lite`. Empty means the app's default.
   */
  constructor(name: string) {
    const apiKey = process.env.GEMINI_API_KEY ?? readKeyFile();
    if (!apiKey) throw new Error("set GEMINI_API_KEY, or put an API key from Google AI Studio in key.secret");
    this.inner = new GeminiBackend({ apiKey, model: name || undefined });
  }
  /** Ask the model, waiting and trying again when Google says the free tier's limit is reached (up to eight times). */
  async generate(req: GenerateRequest): Promise<string> {
    for (let wait = 0; ; wait++) {
      const started = Date.now();
      const before = [this.inner.inputTokens, this.inner.outputTokens];
      try {
        const text = await this.inner.generate(req);
        this.seconds += (Date.now() - started) / 1000;
        this.prompt += this.inner.inputTokens - before[0];
        this.generated += this.inner.outputTokens - before[1];
        this.raws.push(text);
        return text;
      } catch (e) {
        if (!(e instanceof GeminiError) || e.status !== 429 || wait >= 8) throw e;
        const seconds = e.retryAfter ?? 20;
        console.log(`  (rate limit; waiting ${seconds}s)`);
        await new Promise((r) => setTimeout(r, seconds * 1000));
      }
    }
  }
}

/**
 * Runs every case (or the ones `--only` names) against the model, prints a line for each, and writes the rows to `out/`.
 * It is a function, not top-level code, so that this file is plain CommonJS: that way the program's code and the font installer are one copy of each module.
 */
async function main(): Promise<void> {
  /** Is the model one that Google hosts? */
  const hosted = model.startsWith("gemini:");
  /** The limit on what one request may cost, which only the hosted model has. */
  const budget = hosted ? GEMINI_BUDGET : undefined;
  /** The geometry kernel the checks build with. */
  const kernel = await createManifoldKernel();
  /** What tells the assistant whether the program it made builds. */
  const checker = checkerFor(kernel);
  await installFonts(async (file) => {
    const b = readFileSync(path.join(__dirname, "..", "src", "cadfly", "assets", file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  /** Tokens of prompt used by all the cases. */
  let totalIn = 0;
  /** Tokens generated by all the cases. */
  let totalOut = 0;
  /** One row per case run, as the report reads them. */
  const rows: Record<string, unknown>[] = [];
  for (const c of CASES) {
    if (only && !only.includes(c.id)) continue;
    const backend = hosted ? new Gemini(model.slice(7)) : new Ollama();
    let state: AssistantState = { program: c.start, history: [], files: c.files };
    let outcome: Outcome;
    let error: string | undefined;
    try {
      for (const earlier of c.before ?? []) {
        const r = await ask(backend, checker, state, earlier, { budget });
        state = { program: r.program, history: r.history, files: c.files };
      }
      backend.seconds = backend.prompt = backend.generated = 0;
      backend.raws = [];
      const r = await ask(backend, checker, state, c.text, { budget });
      outcome = { program: r.program, run: runProgram(kernel, r.program, c.files), ok: r.ok, reply: r.reply, opCount: r.ops.length };
      let correct = false;
      try {
        correct = c.check(outcome);
      } catch (e) {
        error = `check threw: ${(e as Error).message}`;
      }
      totalIn += backend.prompt;
      totalOut += backend.generated;
      rows.push({ id: c.id, lang: c.lang, correct, valid: r.ok && !r.problem, attempts: r.attempts, seconds: +backend.seconds.toFixed(1), prompt: backend.prompt, generated: backend.generated, reply: r.reply, problem: r.problem?.message, error, raws: backend.raws });
      console.log(`${correct ? "ok  " : "FAIL"} ${c.id.padEnd(16)} ${backend.seconds.toFixed(1).padStart(6)}s  tries=${r.attempts} prompt=${backend.prompt} out=${backend.generated}${r.problem ? `  problem: ${r.problem.message}` : ""}${r.ok ? "" : `  ${r.reply}`}`);
    } catch (e) {
      rows.push({ id: c.id, lang: c.lang, correct: false, valid: false, error: (e as Error).message });
      console.log(`ERR  ${c.id}: ${(e as Error).message}`);
    }
    kernel.release(); // what the case's checks built is done with
  }
  /** How many cases ran. */
  const n = rows.length;
  /** How many rows have this field true. */
  const count = (key: string) => rows.filter((r) => r[key]).length;
  /** The seconds each case took, smallest first. */
  const times = rows.map((r) => (r.seconds as number) ?? 0).sort((a, b) => a - b);
  console.log(`\n${model}: correct ${count("correct")}/${n}, valid ${count("valid")}/${n}, median ${times[Math.floor(n / 2)]}s`);
  if (hosted) console.log(`tokens used by the cases: ${totalIn} in, ${totalOut} out`);
  mkdirSync(path.join(__dirname, "out"), { recursive: true });
  writeFileSync(path.join(__dirname, "out", `${option("out") ?? model.replace(/[^\w.-]/g, "_")}.json`), JSON.stringify({ model, rows }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
