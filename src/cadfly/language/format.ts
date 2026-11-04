import { commandById } from "./commands";
import { type Files, validateFiles } from "./files";
import type { Block, Program } from "./types";

/**
 * Saving and loading programs: the file format (JSON), and the checks that make
 * a file from outside (a saved project, a link, a reply from the model) safe to
 * run. A file that passes `validateProgram` has only blocks and fields that
 * exist, in places they are allowed, within the limits below.
 */

/**
 * The program file format. If it changes, change it in place: nothing old needs
 * to keep loading.
 */
const VERSION = 1;
/** The most blocks a program may have, counting those inside others */
const MAX_BLOCKS = 5000;
/** The deepest blocks may be inside one another (a top-level block is 0) */
const MAX_DEPTH = 12;
/** The most characters a field may hold */
const MAX_TEXT = 200;
/** How far from the workspace corner a stack may be put, in meters */
const MAX_AT = 10_000;

/**
 * Throw an Error, naming the block, unless `block` is a block this app can run:
 * a known kind, in a place its kind is allowed, with only fields that kind has,
 * each of the right type, and flags and positions that make sense. Then the
 * same for the blocks inside it.
 *
 * @param block What was read from the file.
 * @param where The kind of the block that holds this one, or null at the top of
 *              the program.
 * @param depth How many blocks this one is inside.
 * @param seen The ids found so far, to refuse an id used twice (and to count
 *             the blocks).
 */
function check(block: unknown, where: string | null, depth: number, seen: Set<string>): asserts block is Block {
  if (typeof block !== "object" || block === null || Array.isArray(block)) throw new Error("a block must be an object");
  const b = block as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id) throw new Error("a block has no id");
  const at = `block "${b.id}"`;
  if (seen.has(b.id)) throw new Error(`${at}: the id is used twice`);
  seen.add(b.id);
  if (seen.size > MAX_BLOCKS) throw new Error(`the program has more than ${MAX_BLOCKS} blocks`);
  if (depth > MAX_DEPTH) throw new Error(`${at}: blocks are nested too deeply`);
  if (typeof b.kind !== "string") throw new Error(`${at}: no kind`);
  const def = commandById(b.kind);
  if (!def) throw new Error(`${at}: unknown kind "${b.kind}"`);
  if (where === null && def.piece) throw new Error(`${at}: a ${def.word} block belongs inside another block`);
  if (where !== null && !commandById(where as string)?.inner?.includes(b.kind)) {
    throw new Error(`${at}: a ${def.word} block cannot go inside a ${where} block`);
  }

  const args = b.args;
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new Error(`${at}: args must be an object`);
  for (const [key, value] of Object.entries(args)) {
    const param = def.params.find((p) => p.id === key);
    if (!param) throw new Error(`${at}: a ${def.word} block has no field "${key}"`);
    if (param.type.kind === "flag") {
      if (typeof value !== "boolean") throw new Error(`${at}: "${key}" must be true or false`);
    } else {
      if (typeof value !== "string") throw new Error(`${at}: "${key}" must be text`);
      if (value.length > MAX_TEXT) throw new Error(`${at}: "${key}" is too long`);
      if (param.type.kind === "choice" && !param.type.options.some((o) => o.value === value)) {
        throw new Error(`${at}: "${key}" must be one of ${param.type.options.map((o) => o.value).join(", ")}`);
      }
    }
  }

  if (b.collapsed !== undefined && typeof b.collapsed !== "boolean") throw new Error(`${at}: collapsed must be true or false`);
  if (b.hidden !== undefined) {
    if (typeof b.hidden !== "boolean") throw new Error(`${at}: hidden must be true or false`);
    if (!def.make || def.observer) throw new Error(`${at}: a ${def.word} block makes no shape of its own, so it cannot be hidden`);
  }
  if (b.disabled !== undefined) {
    if (typeof b.disabled !== "boolean") throw new Error(`${at}: disabled must be true or false`);
    if (!def.modifier) throw new Error(`${at}: a ${def.word} block does not change what is inside it, so it cannot be disabled`);
  }
  if (b.expanded !== undefined && typeof b.expanded !== "boolean") throw new Error(`${at}: expanded must be true or false`);
  if (b.at !== undefined) {
    const pos = b.at as Record<string, unknown>;
    if (where !== null) throw new Error(`${at}: only a block at the top of the program can have a place (at)`);
    const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_AT;
    if (typeof pos !== "object" || pos === null || !ok(pos.x) || !ok(pos.y)) throw new Error(`${at}: at must be an x and a y, numbers no bigger than ${MAX_AT}`);
  }
  if (b.stackCollapsed !== undefined) {
    if (where !== null) throw new Error(`${at}: only a block at the top of the program can fold its stack`);
    if (typeof b.stackCollapsed !== "boolean") throw new Error(`${at}: stackCollapsed must be true or false`);
  }
  if (b.inner !== undefined) {
    if (!def.inner) throw new Error(`${at}: a ${def.word} block cannot hold other blocks`);
    if (!Array.isArray(b.inner)) throw new Error(`${at}: inner must be a list`);
    for (const child of b.inner) check(child, b.kind, depth + 1, seen);
  }
}

/**
 * Throws an Error, naming the block, if the program is not one this app can run
 * (see `check`)
 */
export function validateProgram(program: unknown): asserts program is Program {
  if (!Array.isArray(program)) throw new Error("a program must be a list of blocks");
  const seen = new Set<string>();
  for (const block of program) check(block, null, 0, seen);
}

/** A saved project: the program, and the STL files its import blocks use */
export interface Project {
  /** The blocks */
  program: Program;
  /** The STL files the program's import blocks use, by name */
  files: Files;
}

/**
 * A project as file text: JSON, indented. The files are left out when there are
 * none.
 *
 * @param program The blocks.
 * @param files The STL files the program uses (default: none).
 */
export function serializeProject(program: Program, files: Files = {}): string {
  return JSON.stringify({ blocks: VERSION, program, ...(Object.keys(files).length ? { files } : {}) }, null, 2);
}

/** Parse and validate a saved project. Throws Error with a readable message. */
export function parseProject(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("not a valid block program file");
  }
  if (typeof data !== "object" || data === null || (data as { blocks?: unknown }).blocks !== VERSION) {
    throw new Error("not a block program file (or from a newer version)");
  }
  const { program, files = {} } = data as { program?: unknown; files?: unknown };
  validateProgram(program);
  validateFiles(files);
  return { program, files };
}

/** A program on its own, as file text (a project with no files) */
export function serializeProgram(program: Program): string {
  return serializeProject(program);
}

/**
 * Parse and validate a saved program (the files, if any, are ignored). Throws
 * Error with a readable message.
 */
export function parseProgram(text: string): Program {
  return parseProject(text).program;
}
