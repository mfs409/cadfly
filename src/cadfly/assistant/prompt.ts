import { COMMANDS, type CommandDef, FLAT_SHAPES, SHAPES } from "../language/commands";
import { type ModeSpec, allowedField, exposure, shownParams } from "../language/modes";
import { allBlocks, runOrder } from "../language/edit";
import type { FileInfo } from "../language/files";
import type { Block, Problem, Program } from "../language/types";
import type { ChatMessage } from "./backend";
import { WORKED_EXAMPLES } from "./workedExamples";
import { applyOps, opsAsText } from "./ops";

/** One exchange, kept so "make it bigger" can mean something. `assistant` is the model's own reply, as compact JSON. */
export interface Turn {
  user: string;
  assistant: string;
}

export interface PromptState {
  program: Program;
  problem?: Problem;
  history: Turn[];
  /** The STL files the project has, which an import block may name */
  files?: FileInfo[];
  /** How much of each block the person is offered (see modes.ts): the model is held to the same blocks and fields. Default: all. */
  mode?: ModeSpec;
}

export interface PromptBudget {
  /** The model's whole window, in tokens (most in-browser models have 4096) */
  context: number;
  /** Room kept for the model's reply */
  reply: number;
}

/** A window this small (the browser models' 4096 tokens) gets the compact instructions */
const SMALL_WINDOW = 4096;

export const DEFAULT_BUDGET: PromptBudget = { context: 4096, reply: 700 };

/** Each message costs a few tokens beyond its words (the chat format's markers) */
const MESSAGE_OVERHEAD = 12;
/** A safe guess at how many tokens text takes: code and JSON are denser than prose, so use 3 characters each */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

// ---- the part that never changes: what blocks are and what the model may do ----

function fieldText(p: CommandDef["params"][number]): string {
  if (p.type.kind === "choice") return `${p.id}=${p.type.options.map((o) => o.value).join("|")}`;
  if (p.type.kind === "flag") return `${p.id} (true/false)`;
  if (p.type.kind === "text" && p.type.suggestions) return `${p.id}=${p.type.suggestions.join("|")}|a Google font name`;
  return p.label && p.label !== p.id ? `${p.id}=${p.label}` : p.id;
}

/** The instructions, and a line for every block, made from the command list */
export function systemPrompt(options: { compact?: boolean; mode?: ModeSpec } = {}): string {
  const offered = COMMANDS.filter((c) => exposure(options.mode, c.id) !== "hidden");
  const catalog = offered.filter((c) => !(options.compact && c.plain && !c.params.length)).map((c) => { // a plain block with no fields (bottom, top) says nothing a small window needs
    // blocks that hold shapes are listed once in the rules; only the odd ones say what they hold
    const inside = !c.inner || c.inner === SHAPES ? "" : SHAPES.every((k) => c.inner!.includes(k)) ? " Holds shapes." : FLAT_SHAPES.every((k) => c.inner!.includes(k)) ? ` Holds flat shapes${c.inner.includes("vertex") ? " and vertex points" : ""}.` : ` Holds: ${c.inner.join(", ")}.`;
    const where = c.piece ? ` (inside ${c.partOf ?? "a sketch"})` : "";
    // a model with a small window gets a shorter hint, and none for what is obvious from a block's word and fields
    const text = options.compact ? (c.plain ? "" : (c.short ?? c.hint)) : c.hint;
    const hint = text ? ` ${text}.` : "";
    return `- ${c.id}${where}: ${shownParams(c, options.mode).map(fieldText).join(", ")}.${hint}${inside}`;
  }).join("\n");
  const q = JSON.stringify;
  return [
    `You change a program made of blocks that builds 3D shapes. Answer with JSON only: {"ops":[...],"reply":"..."}.`,
    `"reply" is one short sentence saying what you did, in the language the user writes in. If nothing should change, use "ops":[].`,
    "",
    "How programs work:",
    `- Blocks run from top to bottom. Every value is text; a number may use variables, + - * / % ( ), comparisons (== != < <= > >=), and/or/not, and sqrt sin cos tan (degrees) abs floor ceil round min max, like "width/4". Sizes are in millimetres.`,
    `- A program is a tree. These blocks hold shapes and act on the ones inside them, which are merged: ${offered.filter((c) => c.buildsInner).map((c) => c.id).join(", ")}. The shapes at the top are shown together.`,
    "- A new shape sits on the ground, centred on the origin (x right, y away, z up). box, cylinder, sphere and import take x y z: where the bottom centre goes (z is how high). A flat shape (rectangle, circle, text) is centred at its u,v. transform (move x y z, turn rx ry rz in degrees, scale sx sy sz) HOLDS what it changes, indented under it.",
    "- rectangle, circle, polygon and text make flat shapes; flat shapes can be combined, moved and turned like solids (a piece with hole on is cut out of the pieces beside it, or use subtract). extrude, revolve, loft and sweep hold flat shapes and make solids from them.",
    "- A block's name is an optional label for people: leave it out unless asked. In subtract, place against and line up the first shape inside is the base: it stays put, the others are cut from it or moved to it. To stand B on top of A, put both inside one place against block (A first), never next to it.",
    "",
    "Blocks are written as text, one block per line, like the program you are shown but without ids: the kind, then field=value for each field you set (a value with spaces goes in quotes: x=\"i * 12\"), then the name of each flag that is on (hole; hidden: a shape block that is built but left out of the picture and the export; disabled: a block that changes what is inside it, switched off, so the shapes inside still show as they were). A block inside another is indented two spaces under it.",
    "",
    "Blocks (field=meaning):",
    catalog,
    "",
    "Ops (new blocks are always block text in a string):",
    `{"op":"append","blocks":${q("extrude name=plate height=5\n  rectangle w=40 h=30")}} add blocks at the end`,
    `{"op":"insert_after","block":"b3","blocks":${q("circle r=2")}} add after block b3`,
    `{"op":"insert_into","block":"b2","blocks":${q("circle r=2 hole")}} add inside a block that holds others`,
    `{"op":"wrap","blocks":["b3"],"holder":"transform z=20","with":${q("box w=10")}} put the listed blocks inside a new holder, where the first was; "with" is new blocks that go inside after them (leave it out if none)`,
    `{"op":"unwrap","block":"b4"} take what is inside b4 out of it and remove b4`,
    `{"op":"set","block":"b3","field":"w","value":"40"} change one field`,
    `{"op":"delete","block":"b3"} remove a block`,
    `{"op":"clear"} remove everything`,
    "Block ids (b1, b2, ...) come from the current program; names are not ids. To change a value that is already there, use set. A block you add already has all its fields, so never follow an append with a set for it.",
    "To make something new, append it (if the program is (empty) there is nothing to change: only append). set only changes a field the block has, as listed above; to move, turn, stretch or combine a shape that is already there, wrap it; to hide or show one, set its field hidden to true or false; to switch off or on a block that changes what is inside it, set disabled. extrude and revolve must hold at least one flat shape, or they fail.",
  ].join("\n");
}

// ---- the part that changes with every request: the program, and what was said ----

const quoted = (v: string) => (/[\s,"]/.test(v) || v === "" ? JSON.stringify(v) : v);

/** A block on one line, every field shown (but neutral ones like no twist): `b5 circle u=20 v=20 r=5 hole` */
function fullLine(b: Block, depth: number): string {
  const def = COMMANDS.find((c) => c.id === b.kind)!;
  const fields = def.params
    .map((p) => {
      const v = b.args[p.id] ?? p.default;
      if (p.type.kind === "flag") return p.default === true ? (v === true ? "" : `${p.id}=false`) : v === true ? p.id : ""; // a tick that is on at first is only said when it is off
      if (p.type.kind === "caption" && v === "") return ""; // a block with no caption shows none
      if (p.quiet && v === p.default) return ""; // a field that is off or neutral (no twist, no rounding) is left out: it takes room and says nothing
      return `${p.id}=${quoted(String(v))}`;
    })
    .filter(Boolean);
  return `${"  ".repeat(depth)}${b.id} ${b.kind} ${[...fields, ...(b.hidden ? ["hidden"] : []), ...(b.disabled ? ["disabled"] : [])].join(" ")}`.trimEnd();
}

/** A block in as few words as will still say which it is: `b5 box plate` */
function terseLine(b: Block, depth: number): string {
  const def = COMMANDS.find((c) => c.id === b.kind)!;
  const named = def.params.find((p) => p.type.kind === "caption" || p.type.kind === "var");
  const name = named ? quoted(String(b.args[named.id] ?? named.default)) : "";
  return `${"  ".repeat(depth)}${b.id} ${b.kind} ${name}`.trimEnd();
}

/**
 * The program, one line per block. The first `terse` blocks (in reading order)
 * get the short form, and if `showLast` is given only that many of the last
 * lines are shown, after a line saying how many were left out.
 */
export function programView(program: Program, terse = 0, showLast = Infinity): string {
  const lines: string[] = [];
  const walk = (blocks: Block[], depth: number) => {
    for (const b of blocks) {
      lines.push(lines.length < terse ? terseLine(b, depth) : fullLine(b, depth));
      walk(b.inner ?? [], depth + 1);
    }
  };
  walk(runOrder(program), 0); // in the order the blocks run, which is not always the order they are stored in
  if (!lines.length) return "(empty)";
  if (lines.length <= showLast) return lines.join("\n");
  const hidden = lines.length - showLast;
  return [`(${hidden} earlier blocks are not shown; they still exist)`, ...lines.slice(hidden)].join("\n");
}

/** The files an import block may name, in a line: `gear.stl (3,200 triangles, 40 x 40 x 10)` */
function filesLine(files: FileInfo[]): string {
  const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US");
  return `Files you can import: ${files.map((f) => `${f.name} (${f.triangles.toLocaleString("en-US")} triangles, ${f.size.map(n).join(" x ")} mm)`).join(", ")}`;
}

function stateMessage(program: Program, problem: Problem | undefined, request: string, terse: number, showLast = Infinity, files: FileInfo[] = []): string {
  const lines = [`Current program:\n${programView(program, terse, showLast)}`];
  if (files.length) lines.push(filesLine(files));
  if (problem) lines.push(`Problem in ${problem.blockId}: ${problem.message}`);
  lines.push(`Request: ${request}`);
  return lines.join("\n");
}

const cost = (m: ChatMessage) => estimateTokens(m.content) + MESSAGE_OVERHEAD;
const total = (ms: ChatMessage[]) => ms.reduce((sum, m) => sum + cost(m), 0);

export interface BuiltPrompt {
  messages: ChatMessage[];
  /** An estimate of the tokens the messages take */
  tokens: number;
  /** What had to be left out to fit */
  trimmed: { examples: number; turns: number; terseBlocks: number };
  /** How many worked examples there were to choose from (those that use only blocks the mode offers) */
  examplesOffered: number;
}

/** The worked examples that use only blocks, and fields, that a mode offers: the model is not shown what it may not do */
export function examplesFor(mode: ModeSpec | undefined): typeof WORKED_EXAMPLES {
  if (!mode) return WORKED_EXAMPLES;
  return WORKED_EXAMPLES.filter((ex) => {
    const made = applyOps(ex.program, ex.ops).program;
    return allBlocks(made).every((b) => {
      const def = COMMANDS.find((c) => c.id === b.kind)!;
      return exposure(mode, b.kind) !== "hidden" && def.params.every((p) => b.args[p.id] === undefined || b.args[p.id] === p.default || allowedField(mode, b.kind, p.id));
    });
  });
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
  const blocks = allBlocks(state.program).length;
  const allowance = Math.max(150, Math.floor((room - cost(system) - estimateTokens(request)) * 0.5));
  let terse = 0;
  let showLast = Infinity;
  const make = () => ({ role: "user", content: stateMessage(state.program, state.problem, request, terse, showLast, state.files) }) as ChatMessage;
  let last = make();
  // first shorten the older blocks, then (if it is still too long) show only the newest
  while (cost(last) > allowance && terse < blocks) {
    terse = Math.min(blocks, terse + Math.max(1, Math.ceil(blocks / 8)));
    last = make();
  }
  while (cost(last) > allowance && showLast > 8) {
    showLast = Math.max(8, Math.floor((showLast === Infinity ? blocks : showLast) * 0.7));
    last = make();
  }

  let used = cost(system) + cost(last);

  // Recent conversation, newest first, but only up to two exchanges
  const turns: ChatMessage[] = [];
  let keptTurns = 0;
  for (const t of [...state.history].reverse().slice(0, 2)) {
    const pair: ChatMessage[] = [
      { role: "user", content: t.user },
      { role: "assistant", content: t.assistant },
    ];
    if (used + total(pair) > room) break;
    turns.unshift(...pair);
    used += total(pair);
    keptTurns++;
  }

  // Worked examples with what room remains, the most useful first
  const shots: ChatMessage[] = [];
  let keptExamples = 0;
  for (const ex of examples) {
    const pair: ChatMessage[] = [
      { role: "user", content: stateMessage(ex.program, undefined, ex.user, 0) },
      { role: "assistant", content: JSON.stringify({ ops: opsAsText(ex.ops), reply: ex.reply }) },
    ];
    if (used + total(pair) > room) break;
    shots.push(...pair);
    used += total(pair);
    keptExamples++;
  }

  const messages = [system, ...shots, ...turns, last];
  return { messages, tokens: total(messages), trimmed: { examples: examples.length - keptExamples, turns: Math.min(2, state.history.length) - keptTurns, terseBlocks: terse }, examplesOffered: examples.length };
}
