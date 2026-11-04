import type { Kernel } from "../geometry/kernel";
import { type Files, describeFiles } from "../language/files";
import type { ModeSpec } from "../language/modes";
import type { Problem, Program } from "../language/types";
import { runProgram } from "../language/run";
import type { ChatBackend, ChatMessage } from "./backend";
import { type Op, OpError, applyOps } from "./ops";
import { type BuiltPrompt, DEFAULT_BUDGET, type PromptBudget, type Turn, buildMessages, estimateTokens } from "./prompt";
import { replySchema } from "./schema";

export interface AssistantState {
  program: Program;
  /** What is wrong with the program right now, if anything: the model is told */
  problem?: Problem;
  history: Turn[];
  /** The STL files the project has, which an import block may name: the model is told about them, and they are needed to run what it makes */
  files?: Files;
  /** How much of each block the person is offered: the model may add only those blocks and fields */
  mode?: ModeSpec;
}

/** Something that builds a program (in a Web Worker, say) and tells what went wrong with it, if anything: used in place of a kernel */
export type Checker = (program: Program, files: Files) => Promise<{ problem?: Problem }>;

export interface AskOptions {
  budget?: PromptBudget;
  /** How many times the model may try: the first, and then repairs after it is told what went wrong. Default 2. */
  attempts?: number;
  signal?: AbortSignal;
  /** The reply schema to hand the backend. Default: the compact one with references. */
  schema?: object;
}

export interface AskResult {
  /** The program after the change (the same program if nothing could be done) */
  program: Program;
  /** What to say to the person */
  reply: string;
  /** A plain list of what changed, for showing */
  changes: string[];
  ops: Op[];
  /** True if the model's edits were applied */
  ok: boolean;
  /** What is wrong with the new program, if anything (it is still applied: it can be fixed or undone) */
  problem?: Problem;
  attempts: number;
  /** The conversation so far, to pass to the next request */
  history: Turn[];
  /** What the model was given the first time: for showing how it works */
  prompt: PromptInfo;
  /** Each try, what the model wrote and what was wrong with it: for showing how it checks itself */
  tries: Try[];
}

/** What the model saw, and how much of its limited memory (the context window) that took */
export interface PromptInfo {
  messages: ChatMessage[];
  /** An estimate of how many tokens the messages take */
  tokens: number;
  /** The size of the window, in tokens, the prompt was fitted to (the reply needs room in it too) */
  window: number;
  /** What had to be left out to fit */
  trimmed: BuiltPrompt["trimmed"];
  /** How many worked examples were there to choose from */
  examplesOffered: number;
}

/** One go at a request */
export interface Try {
  /** Exactly what the model wrote */
  raw: string;
  /** What was wrong with it: it could not be read, an edit could not be applied, or the program it made has a block that fails */
  problem?: { kind: "reply" | "edit" | "run"; message: string };
  /** What the model was told about it before it tried again */
  feedback?: string;
}

const KEEP_TURNS = 4;
const MAX_OPS = 24;

/** The model's answer could not be understood, and why */
class ReplyError extends Error {}

/** Read the model's answer. Tolerates a fence or text around the JSON, which a model with no enforced schema may add. */
function parseReply(raw: string): { ops: Op[]; reply: string } {
  let text = raw.trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first > 0 || last < text.length - 1) text = first >= 0 && last > first ? text.slice(first, last + 1) : text;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ReplyError("it was not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new ReplyError('it must be a JSON object like {"ops":[...],"reply":"..."}');
  const { ops, reply } = data as { ops?: unknown; reply?: unknown };
  if (!Array.isArray(ops)) throw new ReplyError('"ops" must be a list');
  if (ops.length > MAX_OPS) throw new ReplyError(`"ops" has more than ${MAX_OPS} entries`);
  if (typeof reply !== "string") throw new ReplyError('"reply" must be text');
  for (const [i, op] of ops.entries()) {
    if (typeof op !== "object" || op === null || typeof (op as { op?: unknown }).op !== "string") throw new ReplyError(`op ${i + 1} must be an object with an "op" name`);
  }
  return { ops: ops as Op[], reply };
}

/** How the model's reply is remembered for the next request: short, and in the same format it must write */
function remember(ops: Op[], reply: string, changes: string[]): string {
  const full = JSON.stringify({ ops, reply });
  return full.length <= 600 ? full : JSON.stringify({ ops: [], reply: `${reply} (${changes.length} changes)` });
}

/**
 * Turn a request into a change to the program. Ask the model; apply what it
 * says; run the result. If the reply cannot be read, cannot be applied, or
 * leaves a block that fails, tell the model exactly what went wrong and let it
 * try again (once, by default). The program is never left half-changed.
 */
export async function ask(backend: ChatBackend, kernel: Kernel | Checker, state: AssistantState, text: string, options: AskOptions = {}): Promise<AskResult> {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const maxAttempts = Math.max(1, options.attempts ?? 2);
  const schema = options.schema ?? replySchema();
  const files = state.files ?? {};
  const forPrompt = { ...state, files: describeFiles(files) };
  const first = buildMessages(forPrompt, text, budget);
  let messages: ChatMessage[] = first.messages;
  const prompt: PromptInfo = { messages: first.messages, tokens: first.tokens, window: budget.context, trimmed: first.trimmed, examplesOffered: first.examplesOffered };
  const tries: Try[] = [];

  let candidate: { program: Program; changes: string[]; ops: Op[]; reply: string; problem?: Problem } | undefined;
  let failure = "";
  let attempt = 0;

  for (; attempt < maxAttempts; ) {
    attempt++;
    const raw = await backend.generate({ messages, schema, maxTokens: budget.reply, signal: options.signal });
    let feedback = "";
    let problem: Try["problem"];
    try {
      const { ops, reply } = parseReply(raw);
      const { program, changes } = applyOps(state.program, ops, { mode: state.mode });
      const run = typeof kernel === "function" ? await kernel(program, files) : runProgram(kernel, program, files);
      candidate = { program, changes, ops, reply, problem: run.problem };
      if (run.problem) {
        feedback = `After your change the program has a problem in ${run.problem.blockId}: ${run.problem.message}. Reply again with corrected ops for the original program.`;
        problem = { kind: "run", message: `${run.problem.blockId}: ${run.problem.message}` };
      }
    } catch (e) {
      if (!(e instanceof ReplyError || e instanceof OpError)) throw e;
      candidate = undefined;
      failure = e.message;
      feedback = e instanceof ReplyError ? `Your reply was not usable: ${e.message}. Reply again with JSON only.` : `Your ops could not be applied: ${e.message}. Reply again with corrected ops for the original program.`;
      problem = { kind: e instanceof ReplyError ? "reply" : "edit", message: e.message };
    }
    tries.push({ raw, ...(problem ? { problem } : {}), ...(feedback && attempt < maxAttempts ? { feedback } : {}) });
    if (!feedback) break;
    if (attempt < maxAttempts) {
      // the earlier answer and the complaint take room, so build the prompt again with a smaller window
      const extra = estimateTokens(raw) + estimateTokens(feedback) + 30;
      const rebuilt = buildMessages(forPrompt, text, { ...budget, context: Math.max(1200, budget.context - extra) }).messages;
      messages = [...rebuilt, { role: "assistant", content: raw }, { role: "user", content: feedback }];
    }
  }

  if (!candidate) {
    return { program: state.program, reply: `I could not make that change: ${failure}.`, changes: [], ops: [], ok: false, attempts: attempt, history: state.history, prompt, tries };
  }
  const history = [...state.history, { user: text, assistant: remember(candidate.ops, candidate.reply, candidate.changes) }].slice(-KEEP_TURNS);
  return { program: candidate.program, reply: candidate.reply, changes: candidate.changes, ops: candidate.ops, ok: true, problem: candidate.problem, attempts: attempt, history, prompt, tries };
}
