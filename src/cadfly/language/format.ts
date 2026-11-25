import { RESERVED } from "../geometry/expr";
import { canDisable, canHide, commandById } from "./commands";
import { VARIABLE_NAME, inputNames } from "./env";
import { accepts, acceptsInScript, allBlocks, pointListOf } from "./program";
import { type StlFiles, validateStlFiles } from "./files";
import { BUILD, type Block, type Program, type Script } from "./types";

/**
 * Saving and loading programs:
 * - The file format (JSON)
 * - Checks for making sure a program read from outside (a saved file, say) is
 *   safe to run
 */

/** The program file format version */
const VERSION = 1;
/** The most blocks a program may have, counting those inside others */

const MAX_BLOCKS = 5000;

/** The deepest blocks may be inside one another (a top-level block is 0) */
const MAX_DEPTH = 12;

/** The most characters a field may hold */
const MAX_TEXT = 200;

/** How far from the workspace corner a script may be put, in meters */
const MAX_AT = 10_000;

/**
 * Throw an Error, naming the block, unless `block` is valid.
 *
 * Valid means the block has a known kind, is in a place its kind is allowed to
 * be inside a holder, only has fields appropriate for its kind, each of its
 * fields is the right type, and flags make sense. Whether a block may be at the
 * top of its script is checked with the script, not here.
 *
 * This recurses to the blocks within it, too.
 *
 * @param block What was read from the file.  Untrusted type.
 * @param parent The kind of the block that holds this one: null for a block at
 *               the top of a script, which has no parent.
 * @param list The point holder whose list of points this block is in (a
 *             polygon, a solid's vertices section, a sweep), or null if the
 *             blocks around it are not a list of points.
 * @param depth How many blocks this one is inside.
 * @param seen The ids found so far, to refuse an id used twice (and to count
 *             the blocks).
 */
function check(block: unknown, parent: string | null, list: string | null, depth: number, seen: Set<string>): asserts block is Block {
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
  if (parent !== null && !accepts(parent, b.kind, list)) throw new Error(`${at}: a ${def.word} block cannot go inside a ${parent} block`);

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
    if (!canHide(def)) throw new Error(`${at}: a ${def.word} block makes no shape of its own, so it cannot be hidden`);
  }
  if (b.disabled !== undefined) {
    if (typeof b.disabled !== "boolean") throw new Error(`${at}: disabled must be true or false`);
    if (!canDisable(def)) throw new Error(`${at}: a ${def.word} block does not change what is inside it, so it cannot be disabled`);
  }
  if (b.inner !== undefined) {
    if (!def.inner) throw new Error(`${at}: a ${def.word} block cannot hold other blocks`);
    if (!Array.isArray(b.inner)) throw new Error(`${at}: inner must be a list`);
    for (const child of b.inner) check(child, b.kind, pointListOf(b.kind, list), depth + 1, seen);
  }
}

/**
 * Throws an Error, naming the script or block, if the program is not one that
 * can be run
 * - It must be a list of scripts
 * - Each script has an id (a short piece of text), used by no other script
 * - Each script must have a valid place and fold
 * - A script with no name (a global script) has one or more blocks, all `set`,
 *   and no inputs
 * - A named script has a name made like a variable name, used by no other
 *   script, and inputs that are names (and none for `build`)
 * - There is exactly one `build`
 * - The blocks must be valid
 */
export function validateProgram(program: unknown): asserts program is Program {
  if (!Array.isArray(program)) throw new Error("a program must be a list of scripts");
  const seen = new Set<string>();
  const names = new Set<string>();
  const scriptIds = new Set<string>();
  program.forEach((entry: unknown, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`script ${i + 1} must be an object`);
    const { id, name, inputs, at: place, collapsed, blocks } = entry as Record<string, unknown>;
    const at = typeof name === "string" ? `script "${name}"` : `script ${i + 1}`;
    if (typeof id !== "string" || !id || id.length > MAX_TEXT) throw new Error(`${at}: a script needs an id`);
    if (scriptIds.has(id)) throw new Error(`${at}: the id "${id}" is used by another script`);
    scriptIds.add(id);
    if (name !== undefined) {
      if (typeof name !== "string" || !VARIABLE_NAME.test(name) || name.length > MAX_TEXT) throw new Error(`${at}: a name uses letters, digits and _, and starts with a letter`);
      if (RESERVED.has(name)) throw new Error(`${at}: "${name}" is built in to expressions, so it cannot be a name`);
      if (names.has(name)) throw new Error(`${at}: the name is used by another script`);
      names.add(name);
    }
    if (inputs !== undefined) {
      if (name === undefined || name === BUILD) throw new Error(`${at}: ${name === BUILD ? "build" : "a global script"} has no inputs`);
      if (typeof inputs !== "string" || inputs.length > MAX_TEXT) throw new Error(`${at}: inputs must be text, like "w, h"`);
      try {
        inputNames(inputs);
      } catch (e) {
        throw new Error(`${at}: inputs: ${(e as Error).message}`);
      }
    }
    if (!Array.isArray(blocks) || (name === undefined && !blocks.length)) throw new Error(`${at}: blocks must be a list${name === undefined ? " with at least one block" : ""}`);
    if (collapsed !== undefined && typeof collapsed !== "boolean") throw new Error(`${at}: collapsed must be true or false`);
    if (place !== undefined) {
      const pos = place as Record<string, unknown>;
      /** Is this a finite number no bigger than the limit? */
      const ok = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_AT;
      if (typeof pos !== "object" || pos === null || !ok(pos.x) || !ok(pos.y)) throw new Error(`${at}: at must be an x and a y, numbers no bigger than ${MAX_AT}`);
    }
    for (const block of blocks) check(block, null, null, 0, seen);
    // every block is valid now, so each kind is known: say where it may not be
    const valid = { id, name, blocks } as Script;
    for (const block of valid.blocks) {
      if (acceptsInScript(valid, block.kind)) continue;
      const def = commandById(block.kind)!;
      const global = valid.name === undefined && !def.piece;
      throw new Error(global ? `block "${block.id}": a ${def.word} block cannot be in a global script (only set blocks can)` : `block "${block.id}": a ${def.word} block belongs inside another block`);
    }
  });
  if (!names.has(BUILD)) throw new Error(`a program needs a script called "${BUILD}"`);
}

/** The end of a saved project's file name. */
export const PROJECT_EXTENSION = ".cadfly";

/** The file name that Save offers. */
export const PROJECT_FILE_NAME = `design${PROJECT_EXTENSION}`;

/**
 * Is this the name of a project file? It ends in `.cadfly`, in any case, and
 * has something before it.
 *
 * @param name A file name.
 */
export function isProjectFileName(name: string): boolean {
  return name.length > PROJECT_EXTENSION.length && name.toLowerCase().endsWith(PROJECT_EXTENSION);
}

/** A saved project: the program, and the STL files its import blocks use */
export interface Project {
  /** The scripts, each a column of blocks */
  program: Program;
  /** The STL files the program's import blocks use, by name */
  files: StlFiles;
}

/**
 * A project as file text: JSON, indented. The files are left out when there are
 * none.
 *
 * @param program The scripts.
 * @param files The STL files the program uses (default: none).
 */
export function serializeProject(program: Program, files: StlFiles = {}): string {
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
  validateStlFiles(files);
  // `expanded` and `at` are no longer things a block has (a script has `at`); a file that still carries them on a block is loaded without them
  for (const block of allBlocks(program)) {
    delete (block as { expanded?: unknown }).expanded;
    delete (block as { at?: unknown }).at;
  }
  return { program, files };
}
