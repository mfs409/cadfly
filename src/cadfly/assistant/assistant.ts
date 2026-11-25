import type { Kernel } from "../geometry/kernel";
import { type StlFiles, summarizeStlFiles } from "../language/files";
import type { Problem, Program } from "../language/types";
import { runProgram } from "../language/run";
import type { ChatBackend, ChatMessage } from "./backend";
import { type Op, OpError, applyOps } from "./ops";
import { type BuiltPrompt, DEFAULT_BUDGET, type PromptBudget, type PromptState, type Turn, buildMessages, estimateTokens } from "./prompt";
import { MAX_OPS, answerSchema } from "./schema";

/**
 * The assistant: turning a request in plain language into a change to the
 * program. `ask` builds the messages for the model, gets its answer, reads it,
 * applies the ops it asks for, and builds the result to find out whether it
 * works. When something goes wrong the model is told what, and tries again, up
 * to a limit. Nothing here talks to a particular model: that is a
 * `ChatBackend`.
 */

/**
 * What the assistant is given for one request: the program as it stands, what
 * is wrong with it, the conversation so far, and what the person is offered.
 * The STL files are the project's own, with their data, which are needed to
 * run what the model makes (the model is told only about their sizes).
 */
export interface AssistantState extends Omit<PromptState, "files"> {
  /** The STL files the project has, which an import block may name */
  files?: StlFiles;
}

/** Something that builds a program (in a Web Worker, say) and tells what went wrong with it, if anything */
export type Checker = (program: Program, files: StlFiles) => Promise<{ problem?: Problem }>;

/**
 * A `Checker` that builds the program with a kernel, on the spot.
 *
 * @param kernel The geometry kernel to build with.
 */
export function checkerFor(kernel: Kernel): Checker {
  return async (program, files) => runProgram(kernel, program, files);
}

/** Settings for one request. Every one has a default. */
export interface AskOptions {
  budget?: PromptBudget;
  /** How many times the model may try: the first, and then repairs after it is told what went wrong. Default 2. */
  attempts?: number;
  signal?: AbortSignal;
  /** The answer schema to hand the backend. Default: the compact one, `answerSchema()`. */
  schema?: object;
}

/**
 * What came of one request: the new program, what to tell the person, and a
 * record of how it went.
 */
export interface AskResult {
  /** The program after the change (the same program if nothing could be done) */
  program: Program;
  /** What to say to the person */
  reply: string;
  /** A plain list of what changed, for showing */
  changeLog: string[];
  /** The edits the model asked for, as it wrote them */
  ops: Op[];
  /** True if the model's edits were applied */
  ok: boolean;
  /** What is wrong with the new program, if anything (it is still applied: it can be fixed or undone) */
  problem?: Problem;
  /** How many tries it took, counting the first */
  attempts: number;
  /** The conversation so far, to pass to the next request */
  history: Turn[];
  /** What the model was given the first time: for showing how it works */
  prompt: PromptInfo;
  /** Each try, what the model wrote and what was wrong with it: for showing how it checks itself */
  tries: Try[];
  /**
   * The index in `tries` of the try whose program is the result. It is the last
   * try, unless a later one could not be read or applied and an earlier try's
   * program was kept. Undefined when `ok` is false.
   */
  usedTry?: number;
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
  /** What was wrong with it: it could not be read (`answer`), its ops could not be applied (`ops`), or the program it made has a block that fails (`run`) */
  problem?: { kind: "answer" | "ops" | "run"; message: string };
  /** What the model was told about it before it tried again */
  feedback?: string;
}

/** How many exchanges of the conversation are kept to pass to the next request */
const KEEP_TURNS = 4;

/** How long the model's answer may be, in characters, before it is shortened in the history */
const MAX_REMEMBERED_ANSWER = 600;

/** The least room, in tokens, the prompt is rebuilt to fit in after a failed try (the earlier answer and the complaint take room) */
const MIN_RETRY_WINDOW = 1200;

/** Tokens the chat format adds around the earlier answer and the complaint when the prompt is rebuilt for another try */
const RETRY_OVERHEAD_TOKENS = 30;

/** The model's answer could not be understood, and why */
class AnswerError extends Error {}

/** Read the model's answer. Tolerates a fence or text around the JSON, which a model with no enforced schema may add. */
function parseAnswer(raw: string): { ops: Op[]; reply: string } {
  let text = raw.trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first > 0 || last < text.length - 1) text = first >= 0 && last > first ? text.slice(first, last + 1) : text;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AnswerError("it was not valid JSON");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new AnswerError('it must be a JSON object like {"ops":[...],"reply":"..."}');
  const { ops, reply } = data as { ops?: unknown; reply?: unknown };
  if (!Array.isArray(ops)) throw new AnswerError('"ops" must be a list');
  if (ops.length > MAX_OPS) throw new AnswerError(`"ops" has more than ${MAX_OPS} entries`);
  if (typeof reply !== "string") throw new AnswerError('"reply" must be text');
  for (const [i, op] of ops.entries()) {
    if (typeof op !== "object" || op === null || typeof (op as { op?: unknown }).op !== "string") throw new AnswerError(`op ${i + 1} must be an object with an "op" name`);
  }
  return { ops: ops as Op[], reply };
}

/** How the model's answer is remembered for the next request: short, and in the same format it must write */
function remember(ops: Op[], reply: string, changeLog: string[]): string {
  const full = JSON.stringify({ ops, reply });
  return full.length <= MAX_REMEMBERED_ANSWER ? full : JSON.stringify({ ops: [], reply: `${reply} (${changeLog.length} changes)` });
}

/** An answer that was read, applied and run: what it makes, and what is wrong with it, if anything */
interface Candidate {
  program: Program;
  changeLog: string[];
  ops: Op[];
  reply: string;
  problem?: Problem;
  /** Where in `tries` the try that gave it is */
  tryIndex: number;
}

/**
 * Turn a request into a change to the program. Ask the model; apply what it
 * says; run the result. If the answer cannot be read, cannot be applied, or
 * leaves a block that fails, tell the model exactly what went wrong and let it
 * try again (once, by default). The program is never left half-changed.
 *
 * The last answer that could be applied and run is kept, even if it has a
 * problem. If a later try cannot be read or applied, that answer is the result
 * (with its problem, which can be fixed or undone). Only when no try ever gave
 * an answer that could be applied is the request a failure.
 *
 * @param backend The model to ask.
 * @param check How to build the program that an answer makes (see `checkerFor`).
 * @param state The program, and what the model is told about it.
 * @param text The request.
 * @param options Settings for this request.
 */
export async function ask(backend: ChatBackend, check: Checker, state: AssistantState, text: string, options: AskOptions = {}): Promise<AskResult> {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const maxAttempts = Math.max(1, options.attempts ?? 2);
  const schema = options.schema ?? answerSchema();
  const files = state.files ?? {};
  const promptState = { ...state, files: summarizeStlFiles(files) };
  const first = buildMessages(promptState, text, budget);
  let messages: ChatMessage[] = first.messages;
  const prompt: PromptInfo = { messages: first.messages, tokens: first.tokens, window: budget.context, trimmed: first.trimmed, examplesOffered: first.examplesOffered };
  const tries: Try[] = [];

  let candidate: Candidate | undefined;
  let failure = "";
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;
    const raw = await backend.generate({ messages, schema, maxTokens: budget.reply, signal: options.signal });
    let feedback = "";
    let problem: Try["problem"];
    try {
      const { ops, reply } = parseAnswer(raw);
      const { program, changeLog } = applyOps(state.program, ops, { mode: state.mode });
      const run = await check(program, files);
      candidate = { program, changeLog, ops, reply, problem: run.problem, tryIndex: tries.length };
      if (run.problem) {
        feedback = `After your change the program has a problem in ${run.problem.blockId}: ${run.problem.message}. Reply again with corrected ops for the original program.`;
        problem = { kind: "run", message: `${run.problem.blockId}: ${run.problem.message}` };
      }
    } catch (e) {
      if (!(e instanceof AnswerError || e instanceof OpError)) throw e;
      failure = e.message;
      feedback = e instanceof AnswerError ? `Your reply was not usable: ${e.message}. Reply again with JSON only.` : `Your ops could not be applied: ${e.message}. Reply again with corrected ops for the original program.`;
      problem = { kind: e instanceof AnswerError ? "answer" : "ops", message: e.message };
    }
    tries.push({ raw, ...(problem ? { problem } : {}), ...(feedback && attempt < maxAttempts ? { feedback } : {}) });
    if (!feedback) break;
    if (attempt < maxAttempts) {
      // the earlier answer and the complaint take room, so build the prompt again with a smaller window
      const extra = estimateTokens(raw) + estimateTokens(feedback) + RETRY_OVERHEAD_TOKENS;
      const rebuilt = buildMessages(promptState, text, { ...budget, context: Math.max(MIN_RETRY_WINDOW, budget.context - extra) }).messages;
      messages = [...rebuilt, { role: "assistant", content: raw }, { role: "user", content: feedback }];
    }
  }

  if (!candidate) {
    return { program: state.program, reply: `I could not make that change: ${failure}.`, changeLog: [], ops: [], ok: false, attempts: attempt, history: state.history, prompt, tries };
  }
  const history = [...state.history, { user: text, assistant: remember(candidate.ops, candidate.reply, candidate.changeLog) }].slice(-KEEP_TURNS);
  return { program: candidate.program, reply: candidate.reply, changeLog: candidate.changeLog, ops: candidate.ops, ok: true, problem: candidate.problem, attempts: attempt, history, prompt, tries, usedTry: candidate.tryIndex };
}
