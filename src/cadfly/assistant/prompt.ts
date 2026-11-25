import { COMMANDS, type CommandDef, FLAT_SHAPES, SHAPES, commandById } from "../language/commands";
import { type ModeSpec, allowsScripts, offers } from "../ui/modes";
import { allBlocks, findBuildIndex, isBlank } from "../language/program";
import type { StlFileInfo } from "../language/files";
import type { Block, Problem, Program } from "../language/types";
import type { ChatMessage } from "./backend";
import { WORKED_EXAMPLES } from "./workedExamples";
import { quote } from "./blocktext";
import { applyOps } from "./ops";

/**
 * What the model is told: the instructions, made from the list of commands, and
 * then for each request the program as it stands, the problem it has, the
 * conversation so far, and some worked examples, all fitted into the room the
 * model has. Nothing here sends the messages anywhere.
 */

/** One exchange, kept so "make it bigger" can mean something. `assistant` is the model's own reply, as compact JSON. */
export interface Turn {
  user: string;
  assistant: string;
}

/**
 * What the prompt describes besides the request: the program, what is wrong
 * with it, the conversation, and what the person is offered.
 */
export interface PromptState {
  program: Program;
  problem?: Problem;
  history: Turn[];
  /** The STL files the project has, which an import block may name */
  files?: StlFileInfo[];
  /** Which blocks the person is offered: the model is held to the same blocks. Default: all. */
  mode?: ModeSpec;
}

/** How much room the prompt has to fit in. */
export interface PromptBudget {
  /** The model's whole window, in tokens (most in-browser models have 4096) */
  context: number;
  /** Room kept for the model's reply */
  reply: number;
}

/** A window this small (the browser models' 4096 tokens) gets the compact instructions */
const SMALL_WINDOW = 4096;

/** The room used when none is given: the browser models' window, with room kept for a reply. */
export const DEFAULT_BUDGET: PromptBudget = { context: SMALL_WINDOW, reply: 700 };

/** How many of the latest exchanges of the conversation the model is shown, room allowing */
const MAX_TURNS_SHOWN = 2;

/** Each message costs a few tokens beyond its words (the chat format's markers) */
const MESSAGE_OVERHEAD = 12;
/** A safe guess at how many tokens text takes: code and JSON are denser than prose, so use 3 characters each */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

// ---- the part that never changes: what blocks are and what the model may do ----

/** A field in the list of blocks, with what it takes: `type=a|b|c`, `hole (true/false)`, `w=width` */
function fieldText(p: CommandDef["params"][number]): string {
  if (p.type.kind === "choice") return `${p.id}=${p.type.options.map((o) => o.value).join("|")}`;
  if (p.type.kind === "flag") return `${p.id} (true/false)`;
  if (p.type.kind === "text" && p.type.suggestions) return `${p.id}=${p.type.suggestions.join("|")}|a Google font name`;
  return p.label && p.label !== p.id ? `${p.id}=${p.label}` : p.id;
}

/**
 * What a block says about what it holds, for its line in the list of blocks.
 * Blocks that hold shapes are listed once in the rules, so only the odd ones
 * say what they hold.
 */
function holdsText(c: CommandDef): string {
  if (!c.inner || c.inner === SHAPES) return "";
  if (SHAPES.every((k) => c.inner!.includes(k))) return " Holds shapes.";
  if (FLAT_SHAPES.every((k) => c.inner!.includes(k))) return ` Holds flat shapes${c.inner.includes("vertex") ? " and vertex points" : ""}.`;
  return ` Holds: ${c.inner.join(", ")}.`;
}

/**
 * The line of the list of blocks for one command: its id, where it goes if it is
 * a piece, its fields, a hint, and what it holds.
 *
 * @param c The command.
 * @param options `compact` for a small window (shorter hints).
 */
function describeCommand(c: CommandDef, options: { compact?: boolean }): string {
  const partOf = c.piece ? ` (inside ${c.partOf ?? "a sketch"})` : "";
  // a model with a small window gets a shorter hint, and none for what is obvious from a block's word and fields
  const text = options.compact ? (c.plain ? "" : (c.short ?? c.hint)) : c.hint;
  const hint = text ? ` ${text}.` : "";
  return `- ${c.id}${partOf}: ${c.params.map(fieldText).join(", ")}.${hint}${holdsText(c)}`;
}

/** The instructions, and a line for every block, made from the command list */
export function systemPrompt(options: { compact?: boolean; mode?: ModeSpec } = {}): string {
  const offered = COMMANDS.filter((c) => offers(options.mode, c.id));
  // a plain block with no fields (bottom, top) says nothing a small window needs
  const catalog = offered.filter((c) => !(options.compact && c.plain && !c.params.length)).map((c) => describeCommand(c, options)).join("\n");
  const q = JSON.stringify;
  const scripts = allowsScripts(options.mode);
  return [
    `You change a program made of blocks that builds 3D shapes. Answer with JSON only: {"ops":[...],"reply":"..."}.`,
    `"reply" is one short sentence saying what you did, in the language the user writes in. If nothing should change, use "ops":[].`,
    "",
    "How programs work:",
    `- Blocks run from top to bottom. Every value is text; a number may use variables, + - * / % ( ), comparisons (== != < <= > >=), and/or/not, and sqrt sin cos tan (degrees) abs floor ceil round min max, like "width/4". Sizes are in millimetres.`,
    ...(scripts && !options.compact ? [`- build is the script that runs by itself. Other scripts run only where a use block names them, and see just their inputs, their own variables and the globals (set blocks kept in scripts of their own).`] : []),
    `- A program is a tree. These blocks hold shapes and act on the ones inside them, which are merged: ${offered.filter((c) => c.buildsInner).map((c) => c.id).join(", ")}. The shapes at the top are shown together.`,
    "- A new shape sits on the ground, centred on the origin (x right, y away, z up). box, cylinder, sphere and import take x y z: where the bottom centre goes (z is how high). A flat shape (rectangle, circle, text) is centred at its u,v. transform (move x y z, turn rx ry rz in degrees, scale sx sy sz) HOLDS what it changes, indented under it.",
    "- rectangle, circle, polygon and text make flat shapes; flat shapes can be combined, moved and turned like solids (a piece with hole on is cut out of the pieces beside it, or use subtract). extrude, revolve, loft and sweep hold flat shapes and make solids from them.",
    "- A block's name is an optional label for people: leave it out unless asked. In subtract, place against and align the first shape inside is the base: it stays put, the others are cut from it or moved to it. To stand B on top of A, put both inside one place against block (A first), never next to it.",
    "",
    "Blocks are written as text, one block per line, like the program you are shown but without ids: the kind, then field=value for each field you set (a value with spaces goes in quotes: x=\"i * 12\"), then the name of each flag that is on (hole; hidden: a shape block that is built but left out of the picture and the export; disabled: a block that changes what is inside it, switched off, so the shapes inside still show as they were). A block inside another is indented two spaces under it.",
    "",
    "Blocks (field=meaning):",
    catalog,
    "",
    "Ops (new blocks are always block text in a string):",
    `{"op":"append","blocks":${q("extrude name=plate height=5\n  rectangle w=40 h=30")}} add blocks at the end`,
    ...(scripts ? [`{"op":"script","name":"leg","inputs":"x, y","blocks":${q("box w=5 x=x y=y")}} add a script; append can say "to":"leg" (or "globals", for set blocks)`] : []),
    `{"op":"insert_after","block":"b3","blocks":${q("circle r=2")}} add after block b3`,
    `{"op":"insert_into","block":"b2","blocks":${q("circle r=2 hole")}} add inside a block that holds others`,
    `{"op":"wrap","blocks":["b3"],"holder":"transform z=20","with":${q("box w=10")}} put the listed blocks inside a new holder, where the first was; "with" is new blocks that go inside after them (leave it out if none)`,
    `{"op":"unwrap","block":"b4"} take what is inside b4 out of it and remove b4`,
    `{"op":"set","block":"b3","field":"w","value":"40"} change one field`,
    `{"op":"delete","block":"b3"} remove a block`,
    `{"op":"clear"} remove everything${scripts ? ", scripts too" : ""}`,
    "Block ids (b1, b2, ...) come from the current program; names are not ids. To change a value that is already there, use set. A block you add already has all its fields, so never follow an append with a set for it.",
    "To make something new, append it (if the program is (empty) there is nothing to change: only append). set only changes a field the block has, as listed above; to move, turn, stretch or combine a shape that is already there, wrap it; to hide or show one, set its field hidden to true or false; to switch off or on a block that changes what is inside it, set disabled. extrude and revolve must hold at least one flat shape, or they fail.",
  ].join("\n");
}

// ---- the part that changes with every request: the program, and what was said ----

/** A block on one line, every field shown (but neutral ones like no twist): `b5 circle u=20 v=20 r=5 hole` */
function fullLine(b: Block, depth: number): string {
  const def = commandById(b.kind)!;
  const fields = def.params
    .map((p) => {
      const v = b.args[p.id] ?? p.default;
      if (p.type.kind === "flag") return p.default === true ? (v === true ? "" : `${p.id}=false`) : v === true ? p.id : ""; // a tick that is on at first is only said when it is off
      if (p.type.kind === "caption" && v === "") return ""; // a block with no caption shows none
      if (p.quiet && v === p.default) return ""; // a field that is off or neutral (no twist, no rounding) is left out: it takes room and says nothing
      return `${p.id}=${quote(String(v))}`;
    })
    .filter(Boolean);
  return `${"  ".repeat(depth)}${b.id} ${b.kind} ${[...fields, ...(b.hidden ? ["hidden"] : []), ...(b.disabled ? ["disabled"] : [])].join(" ")}`.trimEnd();
}

/** A block in as few words as will still say which it is: `b5 box plate` */
function terseLine(b: Block, depth: number): string {
  const def = commandById(b.kind)!;
  const named = def.params.find((p) => p.type.kind === "caption" || p.type.kind === "var");
  const name = named ? quote(String(b.args[named.id] ?? named.default)) : "";
  return `${"  ".repeat(depth)}${b.id} ${b.kind} ${name}`.trimEnd();
}

/**
 * The program, one line per block. The first `terseBlocks` blocks (in reading
 * order) get the short form, and if `maxLines` is given only that many of the
 * last lines are shown, after a line saying how many were left out.
 *
 * A program of just `build` is its blocks and nothing else. One with other
 * scripts says which is which, in comment lines (block text ignores lines that
 * start with #): the global scripts, then the named scripts, then build. Those
 * lines are written even for a script with no blocks, so the model knows it
 * is there.
 */
export function programView(program: Program, terseBlocks = 0, maxLines = Infinity): string {
  if (!program.length || isBlank(program)) return "(empty)";
  const lines: string[] = [];
  let blocksSoFar = 0;
  /** Write each block on its own line, then what is inside it, indented one more. */
  const walk = (blocks: Block[], depth: number) => {
    for (const b of blocks) {
      lines.push(blocksSoFar++ < terseBlocks ? terseLine(b, depth) : fullLine(b, depth));
      walk(b.inner ?? [], depth + 1);
    }
  };
  const build = findBuildIndex(program);
  if (program.length === 1 && build === 0) walk(program[0].blocks, 0);
  else {
    const indices = [...program.keys()];
    const order = [...indices.filter((i) => program[i].name === undefined), ...indices.filter((i) => program[i].name !== undefined && i !== build), ...(build >= 0 ? [build] : [])];
    for (const i of order) {
      const script = program[i];
      if (script.name === undefined) lines.push("# globals");
      else if (i === build) lines.push("# script build");
      else lines.push(`# script ${script.name}${script.inputs ? ` (inputs: ${script.inputs})` : ""}`);
      walk(script.blocks, 0);
    }
  }
  if (lines.length <= maxLines) return lines.join("\n");
  const hidden = lines.length - maxLines;
  return [`(${hidden} earlier blocks are not shown; they still exist)`, ...lines.slice(hidden)].join("\n");
}

/** The files an import block may name, in a line: `gear.stl (3,200 triangles, 40 x 40 x 10)` */
function filesLine(files: StlFileInfo[]): string {
  /** A size to one decimal place, with thousands separated. */
  const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
  return `Files you can import: ${files.map((f) => `${f.name} (${f.triangles.toLocaleString("en-US")} triangles, ${[f.size.width, f.size.depth, f.size.height].map(n).join(" x ")} mm)`).join(", ")}`;
}

/** What the last message says: the program as it stands, the request, and what goes with them */
interface StateMessageOptions {
  program: Program;
  problem?: Problem;
  request: string;
  /** How many of the oldest blocks are written in short form. */
  terseBlocks: number;
  /** Show only this many of the last lines (default: all). */
  maxLines?: number;
  /** The files that can be imported. */
  files?: StlFileInfo[];
}

/**
 * The last message: the program as it stands, the files that can be imported,
 * the problem if there is one, and the request.
 */
function stateMessage({ program, problem, request, terseBlocks, maxLines = Infinity, files = [] }: StateMessageOptions): string {
  const lines = [`Current program:\n${programView(program, terseBlocks, maxLines)}`];
  if (files.length) lines.push(filesLine(files));
  if (problem) lines.push(`Problem in ${problem.blockId}: ${problem.message}`);
  lines.push(`Request: ${request}`);
  return lines.join("\n");
}

/** A rough count of the tokens a message takes, with the chat format's overhead. */
const cost = (m: ChatMessage) => estimateTokens(m.content) + MESSAGE_OVERHEAD;
/** The rough token cost of all the messages together. */
const total = (ms: ChatMessage[]) => ms.reduce((sum, m) => sum + cost(m), 0);

/** The messages for a request, and how they were fitted into the budget. */
export interface BuiltPrompt {
  messages: ChatMessage[];
  /** An estimate of the tokens the messages take */
  tokens: number;
  /** What had to be left out to fit */
  trimmed: { examples: number; turns: number; terseBlocks: number };
  /** How many worked examples there were to choose from (those that use only blocks the mode offers) */
  examplesOffered: number;
}

/** The worked examples that use only blocks that a mode offers: the model is not shown what it may not do */
export function examplesFor(mode: ModeSpec | undefined): typeof WORKED_EXAMPLES {
  if (!mode) return WORKED_EXAMPLES;
  return WORKED_EXAMPLES.filter((ex) => {
    const made = applyOps(ex.program, ex.ops).program;
    return allBlocks(made).every((b) => offers(mode, b.kind));
  });
}

/**
 * Write the last message so it fits in the room it is given. First the older
 * blocks are shortened, then (if it is still too long) only the newest lines
 * are shown.
 *
 * @param state The program and what goes with it.
 * @param request The request.
 * @param allowance The most the message may cost, in tokens.
 * @returns The message, and how many blocks were shortened.
 */
function fitProgram(state: PromptState, request: string, allowance: number): { message: ChatMessage; terseBlocks: number } {
  const blocks = allBlocks(state.program).length;
  let terseBlocks = 0;
  let maxLines = Infinity;
  /** The request message for the current amount of shortening. */
  const make = (): ChatMessage => ({ role: "user", content: stateMessage({ program: state.program, problem: state.problem, request, terseBlocks, maxLines, files: state.files }) });
  let message = make();
  while (cost(message) > allowance && terseBlocks < blocks) {
    terseBlocks = Math.min(blocks, terseBlocks + Math.max(1, Math.ceil(blocks / 8)));
    message = make();
  }
  while (cost(message) > allowance && maxLines > 8) {
    maxLines = Math.max(8, Math.floor((maxLines === Infinity ? blocks : maxLines) * 0.7));
    message = make();
  }
  return { message, terseBlocks };
}

/**
 * The recent conversation that fits: the latest exchanges, newest first as they
 * are considered, but written in the order they happened.
 *
 * @param history The conversation so far.
 * @param used Tokens already used by what must go in.
 * @param room All the tokens there is room for.
 * @returns The messages, how many tokens they and the earlier ones take, and how many exchanges were kept.
 */
function fitTurns(history: Turn[], used: number, room: number): { messages: ChatMessage[]; used: number; kept: number } {
  const messages: ChatMessage[] = [];
  let kept = 0;
  for (const t of [...history].reverse().slice(0, MAX_TURNS_SHOWN)) {
    const pair: ChatMessage[] = [
      { role: "user", content: t.user },
      { role: "assistant", content: t.assistant },
    ];
    if (used + total(pair) > room) break;
    messages.unshift(...pair);
    used += total(pair);
    kept++;
  }
  return { messages, used, kept };
}

/**
 * The worked examples that fit in what room remains, the most useful first.
 *
 * @param examples The examples to choose from, in order.
 * @param used Tokens already used by what must go in.
 * @param room All the tokens there is room for.
 * @returns The messages, and how many examples were kept.
 */
function fitExamples(examples: typeof WORKED_EXAMPLES, used: number, room: number): { messages: ChatMessage[]; kept: number } {
  const messages: ChatMessage[] = [];
  let kept = 0;
  for (const ex of examples) {
    const pair: ChatMessage[] = [
      { role: "user", content: stateMessage({ program: ex.program, request: ex.user, terseBlocks: 0 }) },
      { role: "assistant", content: JSON.stringify({ ops: ex.ops, reply: ex.reply }) },
    ];
    if (used + total(pair) > room) break;
    messages.push(...pair);
    used += total(pair);
    kept++;
  }
  return { messages, kept };
}

/**
 * Build the messages for a request, to fit the budget. The instructions, the
 * program and the request always go in. Then, in order of value: the program's
 * older blocks are shortened if it is long; recent turns of conversation are
 * kept (newest first); worked examples fill what room is left.
 */
export function buildMessages(state: PromptState, request: string, budget: PromptBudget = DEFAULT_BUDGET): BuiltPrompt {
  const system: ChatMessage = { role: "system", content: systemPrompt({ compact: budget.context <= SMALL_WINDOW, mode: state.mode }) };
  const examples = examplesFor(state.mode);
  const room = budget.context - budget.reply;

  // The program may use up to about half of what is left after the instructions and the request.
  const allowance = Math.max(150, Math.floor((room - cost(system) - estimateTokens(request)) * 0.5));
  const { message: last, terseBlocks } = fitProgram(state, request, allowance);
  const turns = fitTurns(state.history, cost(system) + cost(last), room);
  const shots = fitExamples(examples, turns.used, room);

  const messages = [system, ...shots.messages, ...turns.messages, last];
  return {
    messages,
    tokens: total(messages),
    trimmed: { examples: examples.length - shots.kept, turns: Math.min(MAX_TURNS_SHOWN, state.history.length) - turns.kept, terseBlocks },
    examplesOffered: examples.length,
  };
}
