import { RESERVED } from "../geometry/expr";
import { blankBlock, blockWith, commandById } from "./commands";
import { VARIABLE_NAME, inputNames } from "./env";
import { allBlocks, blocksToWrap, blocksWithin, findBlock, findBuildIndex, findScript, freshScriptId, idCounter, isGlobalScript, type BlockLocation, type InsertPoint } from "./program";
import { BUILD, type Block, type Point, type Program, type Script } from "./types";

/**
 * This file implements all of the operations that restructure a Program.  Every
 * function is *pure*: it takes in a Program and returns a new Program.  Even if
 * the function doesn't change anything, it still returns a new Program.
 *
 * The operations cover the blocks (insert, take, wrap, set a field or a flag)
 * and the scripts (add, remove, rename, change the inputs of, fold, move), and
 * carrying the editor's own state (what is folded, opened or moved) from one
 * program to another.
 */

/**
 * Modify `program` by taking a block out of it.  This assumes the `program` is
 * a private copy. If this empties a global script, remove that script from the
 * program (a named script stays, empty).
 *
 * @param program The program to take it from.
 * @param found Where the block is, in `program`.
 * @returns The block that was taken out.
 */
function removeAt(program: Program, found: BlockLocation): Block {
  const [gone] = found.siblings.splice(found.index, 1);
  dropIfEmpty(program, found);
  return gone;
}

/**
 * Remove the script that a block was in, if it is a global script that has no
 * blocks left. A block inside another block cannot empty its script, and a
 * named script may be empty.
 */
function dropIfEmpty(program: Program, found: BlockLocation): void {
  if (found.parent === null && found.siblings.length === 0 && isGlobalScript(found.script)) program.splice(program.indexOf(found.script), 1);
}

/**
 * Take one block out of the program, with whatever is inside it, and close the
 * gap.  The blocks after it stay where they were.  A global script left with no
 * blocks is removed from the program.
 *
 * @returns A new program without it, and the block that was taken (as a list
 *          with one entry). If there is no such block, a copy of the program
 *          and an empty list.
 */
export function takeBlock(program: Program, id: string): { program: Program; blocks: Block[] } {
  const rest = structuredClone(program);
  const found = findBlock(rest, id);
  if (!found) return { program: rest, blocks: [] };
  return { program: rest, blocks: [removeAt(rest, found)] };
}

/**
 * Move blocks that are already in the program inside a new holder block, which
 * takes the place of the first of them.  It is what wrapping blocks in a holder
 * does, whether the request is to wrap them or a holder is dropped onto them.
 *
 * The other blocks are taken from wherever they are, in the same script or not
 * (a global script left with nothing in it is gone). The holder stays in the
 * first block's script, so the script keeps its place and its fold.
 *
 * This doesn't validate.  The caller should ensure the holder can actually hold
 * the blocks, and that no block is inside another block.
 *
 * Throws an Error if one of the ids is not a block of the program.
 *
 * @param program The original program
 * @param ids The blocks to move inside, in the order they go. The first one
 *            marks where the holder goes.
 * @param holder The new, empty holder block (not changed: it is copied).
 * @param alsoInside New blocks that go inside the holder after the moved ones.
 * @returns The new program.
 */
export function moveIntoNewHolder(program: Program, ids: string[], holder: Block, alsoInside: Block[] = []): Program {
  const next = structuredClone(program);
  const wrapped = ids.map((id) => {
    const found = findBlock(next, id);
    if (!found) throw new Error(`no block "${id}" to wrap`);
    return found.block;
  });
  for (const id of ids.slice(1)) removeAt(next, findBlock(next, id)!);
  const first = findBlock(next, ids[0])!;
  const outer = structuredClone(holder);
  outer.inner = [...wrapped, ...structuredClone(alsoInside)];
  first.siblings.splice(first.index, 1, outer);
  return next;
}

/**
 * Take the contents out of a holder, and put them where the holder was.  Delete
 * the holder.
 *
 * @param program The program (not changed).
 * @param id The block to open.
 * @returns A new program (a copy of the one given, if there is no such block).
 */
export function takeOutOfHolder(program: Program, id: string): Program {
  const next = structuredClone(program);
  const found = findBlock(next, id);
  if (!found) return next;
  found.siblings.splice(found.index, 1, ...(found.block.inner ?? []));
  dropIfEmpty(next, found);
  return next;
}

/**
 * Put blocks at an insert point; whatever was already there
 * comes after them. A new script's place is rounded to 2 decimals, and not less
 * than 0. A new script is a global one, so only `set` blocks belong in it. The
 * end of the program is the end of `build`, which is made (empty) first if the
 * program has none.
 *
 * It does not check that the blocks may go there (that is the caller's job).
 *
 * Throws an Error if the insert point is inside a block that is not in the
 * program, or in a script that is not there.
 *
 * @param program The program to put them in (not changed).
 * @param point Where they go.
 * @param blocks The blocks to put there, in order (not changed: they are
 *               copied).
 * @returns A new program (a copy of the one given, if there are no blocks).
 */
export function insertBlocks(program: Program, point: InsertPoint, blocks: Block[]): Program {
  const next = structuredClone(program);
  if (!blocks.length) return next;
  const placed = structuredClone(blocks);
  if ("parentId" in point) {
    const parent = findBlock(next, point.parentId)?.block;
    if (!parent) throw new Error("no such block to put them in");
    parent.inner ??= [];
    parent.inner.splice(point.index, 0, ...placed);
  } else if ("end" in point) {
    let build = findBuildIndex(next);
    if (build < 0) build = next.push({ id: freshScriptId(next), name: BUILD, blocks: [] }) - 1;
    next[build].blocks.push(...placed);
  } else if ("scriptId" in point) {
    const script = next.find((s) => s.id === point.scriptId);
    if (!script) throw new Error("no such script to put them in");
    script.blocks.splice(point.index, 0, ...placed);
  } else {
    const { at } = point.newScript;
    next.push({ id: freshScriptId(next), ...(at ? { at: roundedPlace(at) } : {}), blocks: placed });
  }
  return next;
}

/**
 * Drop blocks that were carried to a place: what happens when the
 * person lets go. This is `insertBlocks`, except for a holder with nothing in
 * it that is dropped above other blocks, as in Scratch: the holder wraps the
 * blocks from there to the end of the list. Dropping an empty `transform` above
 * the last two blocks of a script, say, leaves it holding them.
 *
 * It does not check that the blocks may go there (that is the caller's job).
 *
 * @param program The program to drop them in (not changed).
 * @param point Where they go.
 * @param blocks The blocks that were carried, in order (not changed: they are
 *               copied).
 * @returns A new program.
 */
export function dropBlocks(program: Program, point: InsertPoint, blocks: Block[]): Program {
  const wrapped = blocksToWrap(program, point, blocks);
  return wrapped.length ? moveIntoNewHolder(program, wrapped.map((b) => b.id), blocks[0]) : insertBlocks(program, point, blocks);
}

/**
 * Change what one field of one block holds. It does not check that the block
 * has the field, or that the value fits (a choice, a flag): the caller does.
 */
export function setArg(program: Program, blockId: string, paramId: string, value: string | boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, blockId);
  if (found) found.block.args[paramId] = value;
  return next;
}

/** The on/off settings of a block, for `setFlag` */
export type BlockFlag = "collapsed" | "hidden" | "disabled";

/**
 * Turn one of a block's settings on or off. Off removes the setting:
 *
 * - `collapsed`: fold a block that holds others (or open it again): only its
 *   header is shown. Nothing else changes.
 * - `hidden`: the eye on the block: it is built, but leaves nothing in the
 *   picture, the export or the block around it; or show it again.
 * - `disabled`: switch a block that changes what is inside it off (the shapes
 *   inside pass through), or on again.
 *
 * @param program The program (not changed).
 * @param blockId The block.
 * @param flag Which setting.
 * @param on True to turn it on, false to turn it off.
 */
export function setFlag(program: Program, blockId: string, flag: BlockFlag, on: boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, blockId);
  if (!found) return next;
  if (on) found.block[flag] = true;
  else delete found.block[flag];
  return next;
}

/** A place on the workspace, rounded to 2 decimals and not less than 0 */
function roundedPlace(at: Point): Point {
  /** Round to 2 decimals, and not below 0. */
  const round = (v: number) => Math.max(0, Math.round(v * 100) / 100);
  return { x: round(at.x), y: round(at.y) };
}

/**
 * Fold a script (or open it again): only its first block and a strip for
 * the rest are shown. Nothing else changes.
 *
 * @param program The program (not changed).
 * @param scriptId The id of the script.
 * @param on True to fold it, false to open it.
 * @returns A new program (a copy of the one given, if there is no such script).
 */
export function setScriptFold(program: Program, scriptId: string, on: boolean): Program {
  const next = structuredClone(program);
  const script = next.find((s) => s.id === scriptId);
  if (!script) return next;
  if (on) script.collapsed = true;
  else delete script.collapsed;
  return next;
}

/**
 * Move a script to a new place (where its header and blocks
 * float). The place is rounded to 2 decimals and not less than 0, as for a
 * script made by a drop.
 *
 * @param program The program (not changed).
 * @param scriptId The id of the script.
 * @param at The new place of the script's top left, in meters from the
 *           workspace's top left.
 * @returns A new program (a copy of the one given, if there is no such script).
 */
export function moveScript(program: Program, scriptId: string, at: Point): Program {
  const next = structuredClone(program);
  const script = next.find((s) => s.id === scriptId);
  if (script) script.at = roundedPlace(at);
  return next;
}

/**
 * Throws an Error unless `name` can be the name of a script: made like a
 * variable name, not a word that means something in an expression, and not the
 * name of another script.
 *
 * @param program The program whose scripts have names already.
 * @param name The name to check.
 * @param renamingId The id of the script that is being renamed, if one is. It
 *                   is not counted as "another script", so it may keep its own
 *                   name. Leave it out when the name is for a new script.
 */
function checkScriptName(program: Program, name: string, renamingId?: string): void {
  if (!VARIABLE_NAME.test(name)) throw new Error(`"${name}" is not a name: use letters, digits and _, and start with a letter`);
  if (RESERVED.has(name)) throw new Error(`"${name}" is built in to expressions, so it cannot be a name`);
  if (program.some((s) => s.id !== renamingId && s.name === name)) throw new Error(`there is already a script called "${name}"`);
}

/**
 * Add a new, empty named script (a function) to the program.  It gets a new id,
 * and goes at the end of the program's list, so the
 * caller finds it as the last script.
 *
 * Throws an Error if the name is not a good one or the
 * inputs are not names.
 *
 * @param program The program (not changed).
 * @param name The script's name.
 * @param inputs The names of its inputs, as text: "w, h" (default: none).
 * @param at Where it floats (default: below the other scripts).
 * @returns A new program with the script at the end of its list.
 */
export function addScript(program: Program, name: string, inputs = "", at?: Point): Program {
  checkScriptName(program, name);
  inputNames(inputs);
  const next = structuredClone(program);
  next.push({
    id: freshScriptId(next),
    name,
    ...(inputs.trim() ? { inputs: inputs.trim() } : {}),
    ...(at ? { at: { x: Math.max(0, at.x), y: Math.max(0, at.y) } } : {}),
    blocks: [],
  });
  return next;
}

/**
 * Remove a script, with the blocks in it. Throws an Error for `build`, which
 * cannot be removed, and for a script that is not there.
 *
 * @param program The program (not changed).
 * @param scriptId The id of the script.
 * @returns A new program without it.
 */
export function removeScript(program: Program, scriptId: string): Program {
  const index = findScript(program, scriptId);
  if (index === undefined) throw new Error("no such script");
  if (program[index].name === BUILD) throw new Error(`the "${BUILD}" script cannot be removed`);
  const next = structuredClone(program);
  next.splice(index, 1);
  return next;
}

/**
 * Find a named script other than `build` that can be changed (its name or its
 * inputs), or throw an Error saying why there is not one.
 *
 * @param program The program.
 * @param scriptId The id of the script.
 * @param build The message for `build`, which has neither a name to change nor
 *              inputs.
 * @param global The message for a global script, which has neither.
 */
function editableScript(program: Program, scriptId: string, build: string, global: string): Script {
  const script = program.find((s) => s.id === scriptId);
  if (!script) throw new Error("no such script");
  if (script.name === undefined) throw new Error(global);
  if (script.name === BUILD) throw new Error(build);
  return script;
}

/**
 * Rename a named script. Throws an Error if there is no such script, if it is
 * `build` or a global script (neither has a name to change), or if the new name
 * is not a good one. The blocks that `use` the old name
 * are not changed: the caller decides whether they should be.
 *
 * @param program The program (not changed).
 * @param scriptId The id of the script.
 * @param name The new name.
 */
export function setScriptName(program: Program, scriptId: string, name: string): Program {
  editableScript(program, scriptId, `the "${BUILD}" script cannot be renamed`, "a global script has no name");
  checkScriptName(program, name, scriptId);
  const next = structuredClone(program);
  next.find((s) => s.id === scriptId)!.name = name;
  return next;
}

/**
 * Change the inputs of a named script. Throws an Error if there is no such
 * script, if it is `build` or a global script (neither has inputs), or if the
 * inputs are not names. The blocks that `use` the script are
 * not changed.
 *
 * @param program The program (not changed).
 * @param scriptId The id of the script.
 * @param inputs The names of the inputs, as text: "w, h". Empty for none.
 */
export function setScriptInputs(program: Program, scriptId: string, inputs: string): Program {
  editableScript(program, scriptId, `the "${BUILD}" script has no inputs`, "a global script has no inputs");
  inputNames(inputs);
  const next = structuredClone(program);
  const script = next.find((s) => s.id === scriptId)!;
  if (inputs.trim()) script.inputs = inputs.trim();
  else delete script.inputs;
  return next;
}

/**
 * A new block of this kind for dropping into `program`: a fresh id, and what
 * the kind starts out holding (for a sketch, a first
 * piece inside it).
 *
 * There are three ways to make a block. `blankBlock` makes one with every field
 * at its default and nothing inside, and `blockWith` the same with some fields
 * set. `createBlock` makes one that works as soon as it is dropped: ids it
 * chooses itself, and the starting contents.
 *
 * Throws an Error for a kind that is not a command.
 */
export function createBlock(program: Program, kind: string): Block {
  const nextId = idCounter(program);
  const block = blankBlock(kind, nextId());
  const inner = commandById(kind)?.starter?.(nextId);
  if (inner) block.inner = inner;
  return block;
}

/**
 * Fill a faces section with faces (each a list of vertex numbers): what the
 * "hull" button on a solid does. The faces are added after any already there.
 *
 * @param program The program (not changed).
 * @param facesId The id of the faces block.
 * @param faces The faces to add, each a list of vertex numbers.
 * @returns A new program (a copy of the one given, if there is no such block
 *          or no faces to add).
 */
export function fillFaces(program: Program, facesId: string, faces: number[][]): Program {
  const next = structuredClone(program);
  const found = findBlock(next, facesId);
  if (!faces.length || !found) return next;
  const nextId = idCounter(next);
  found.block.inner = [...(found.block.inner ?? []), ...faces.map((corners) => blockWith("face", nextId(), { corners: corners.join(" ") }))];
  return next;
}

/**
 * Put what the editor keeps only for display, as it is in `current`, onto
 * `restored`. A fold or a move is a change to how the program is shown and not to what it makes, so it is not a step that undo takes back;
 * but the program that undo or redo brings back was copied before it, and would
 * otherwise undo it as well.
 *
 * For every script of `restored` that `current` also has (by id) the script's
 * place (`at`) and its fold are the ones in `current`, and for every block that
 * `current` also has the block's fold is. What `current` does
 * not have (a script or block that undo brings back) keeps what it had.
 *
 * @param restored The program that is being put back.
 * @param current The program that it replaces.
 * @returns A new program: `restored`, with the display state of `current`.
 */
export function carryViewState(restored: Program, current: Program): Program {
  const next = structuredClone(restored);
  const scripts = new Map(current.map((s) => [s.id, s]));
  const blocks = new Map(allBlocks(current).map((b) => [b.id, b]));
  /** Set a flag as the other has it: on, or not there at all. */
  const copyFold = (to: { collapsed?: boolean }, from: { collapsed?: boolean }) => {
    if (from.collapsed === true) to.collapsed = true;
    else delete to.collapsed;
  };
  for (const script of next) {
    const was = scripts.get(script.id);
    if (!was) continue;
    copyFold(script, was);
    if (was.at) script.at = { ...was.at };
    else delete script.at;
  }
  for (const block of allBlocks(next)) {
    const was = blocks.get(block.id);
    if (!was) continue;
    copyFold(block, was);
  }
  return next;
}

/** Matches a word in an expression, whatever it is a name of */
const WORD_IN_EXPRESSION = /(?<![\w.])[A-Za-z_]\w*(?!\w)/g;

/**
 * Every word in an expression that is the name of a variable: not a number's
 * letter (`1e3`), not a function being called (`max(`), not a word that has a
 * meaning of its own (`pi`, `and`).
 */
function variableWords(text: string): string[] {
  return [...text.matchAll(WORD_IN_EXPRESSION)].filter((m) => !RESERVED.has(m[0]) && text[m.index + m[0].length] !== "(").map((m) => m[0]);
}

/**
 * Change the names in an expression: the variables for which `to` has a new
 * name.
 *
 * @param text The expression.
 * @param to The new name of each variable that is renamed.
 */
function renameInExpression(text: string, to: ReadonlyMap<string, string>): string {
  return text.replace(WORD_IN_EXPRESSION, (word, offset: number) => (to.has(word) && !RESERVED.has(word) && text[offset + word.length] !== "(" ? to.get(word)! : word));
}

/**
 * Visit every field of the blocks (and the blocks inside them) that holds a
 * name, and give it a new value.
 *
 * @param blocks The blocks, which are changed in place.
 * @param how What to do to the text of each kind of field that holds names: an
 *            expression, the name of a variable, or the name of a script.
 */
function rewriteNames(blocks: Block[], how: { expression: (text: string) => string; variable: (name: string) => string; script: (name: string) => string }): void {
  for (const block of blocks) {
    const def = commandById(block.kind);
    for (const param of def?.params ?? []) {
      const value = block.args[param.id];
      if (typeof value !== "string") continue;
      if (param.type.kind === "expr") block.args[param.id] = how.expression(value);
      // a measure block's name is the start of the names it makes, not a variable
      else if (param.type.kind === "var" && block.kind !== "measure") block.args[param.id] = how.variable(value);
      else if (block.kind === "use" && param.id === "name") block.args[param.id] = how.script(value);
      else if (block.kind === "use" && param.id === "values") block.args[param.id] = how.expression(value);
    }
    if (block.inner) rewriteNames(block.inner, how);
  }
}

/** The names of the global variables a program sets: the `set` blocks of its global scripts */
function globalNames(program: Program): string[] {
  return program.filter(isGlobalScript).flatMap((s) => s.blocks.filter((b) => b.kind === "set").map((b) => String(b.args.name)));
}

/**
 * The first name of the form `base2`, `base3`, ... that is not taken.
 *
 * @param base The name it starts from.
 * @param taken The names that cannot be used.
 */
function freeName(base: string, taken: ReadonlySet<string>): string {
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

/**
 * The name for the script that holds an added program's `build`: the name of
 * the program with anything that is not a letter or digit turned into `_`
 * ("Dowel joint" is `dowel_joint`).
 */
function scriptNameFor(title: string): string {
  const words = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(words) ? words : `part_${words}`.replace(/_$/, "");
}

/** What `addProgram` did, besides making the new program */
export interface AddedProgram {
  /** The project with the other program added */
  program: Program;
  /** The name of the script that holds the added program's `build` (absent when its blocks went straight into `build`) */
  scriptName?: string;
}

/** How the blocks of an added program are put in */
export interface AddProgramOptions {
  /** What the added program is called, which names the script that holds its blocks */
  title: string;
  /**
   * Put the blocks straight at the end of `build`, not in a script of their
   * own. This is for a program that is only a `build`, added where scripts are
   * not offered; any other program is added with a script.
   */
  inline?: boolean;
  /** The STL files the project has: a program that imports one it lacks is refused */
  files?: Readonly<Record<string, string>>;
}

/**
 * Add another whole program (an example, say) to this one, so that both work
 * together and neither is disturbed:
 *
 * - Its named scripts join the program under fresh ids. One whose name the
 *   program already has is renamed (`hinge` to `hinge2`), and so is every `use`
 *   of it in the added program.
 * - Its global variables join as global scripts. One whose name is already a
 *   global of the program is renamed (`size` to `size2`) everywhere the added
 *   program says it, so the program's own variable keeps its value.
 * - Its `build` goes into a new named script, and a `use` of that script is
 *   added at the end of the program's `build`. (With `inline`, its blocks go
 *   there directly instead.)
 *
 * Every added block gets a new id. Nothing is changed unless all of it can be
 * added: it throws an Error otherwise, and the caller has the old program.
 *
 * @param program The program to add to (not changed).
 * @param other The program to add (not changed).
 * @param options What it is called, and how it goes in.
 * @returns The new program, and the name of the script that holds the added
 *          `build` if there is one.
 */
export function addProgram(program: Program, other: Program, options: AddProgramOptions): AddedProgram {
  const added = structuredClone(other);
  const missing = new Set<string>();
  for (const block of blocksWithin(added.flatMap((s) => s.blocks))) {
    const def = commandById(block.kind);
    for (const param of def?.params ?? []) {
      const value = block.args[param.id];
      if (param.type.kind === "file" && typeof value === "string" && value && !(options.files && value in options.files)) missing.add(value);
    }
  }
  if (missing.size) throw new Error(`it needs the STL file${missing.size === 1 ? "" : "s"} ${[...missing].join(", ")}, which this project does not have`);

  const build = added.find((s) => s.name === BUILD);
  const others = added.filter((s) => s !== build);
  const inline = options.inline === true && others.length === 0;

  // rename what clashes, in the added program only. First note every name the
  // added program uses (this visit only reads: each callback records what it is
  // given and hands it back unchanged), so a new name cannot collide with one.
  const used = new Set<string>(RESERVED);
  const words = (text: string) => variableWords(text).forEach((w) => used.add(w));
  for (const script of added) if (script.inputs) words(script.inputs);
  rewriteNames(added.flatMap((s) => s.blocks), { expression: (t) => (words(t), t), variable: (n) => (used.add(n), n), script: (n) => n });
  const existingGlobals = new Set(globalNames(program));
  for (const name of existingGlobals) used.add(name);
  const variableRenames = new Map<string, string>();
  for (const name of globalNames(added)) {
    if (!existingGlobals.has(name) || variableRenames.has(name)) continue;
    const renamed = freeName(name, used);
    used.add(renamed);
    variableRenames.set(name, renamed);
  }
  const takenScripts = new Set([...program, ...added].map((s) => s.name).filter((n): n is string => n !== undefined));
  const scriptRenames = new Map<string, string>();
  for (const script of others) {
    if (script.name === undefined || !program.some((s) => s.name === script.name)) continue;
    const renamed = freeName(script.name, takenScripts);
    takenScripts.add(renamed);
    scriptRenames.set(script.name, renamed);
  }
  const rename = (name: string) => scriptRenames.get(name) ?? name;
  const renameVariable = (name: string) => variableRenames.get(name) ?? name;
  for (const script of added) {
    if (script.name !== undefined && script.name !== BUILD) script.name = rename(script.name);
    if (script.inputs) script.inputs = renameInExpression(script.inputs, variableRenames);
    rewriteNames(script.blocks, { expression: (t) => renameInExpression(t, variableRenames), variable: renameVariable, script: rename });
  }

  // give everything added new ids, and put it in
  const next = structuredClone(program);
  const nextBlockId = idCounter(next, added.flatMap((s) => s.blocks));
  const renumber = (blocks: Block[]) => {
    for (const block of blocks) {
      block.id = nextBlockId();
      if (block.inner) renumber(block.inner);
    }
  };
  for (const script of added) renumber(script.blocks);
  for (const script of others) {
    delete script.at; // where it floats was for the program it came from
    next.push({ ...script, id: freshScriptId(next) });
  }
  const buildBlocks = build?.blocks ?? [];
  const target = next[findBuildIndex(next)] ?? next[next.push({ id: freshScriptId(next), name: BUILD, blocks: [] }) - 1];
  if (inline) {
    target.blocks.push(...buildBlocks);
    return { program: next };
  }
  const base = scriptNameFor(options.title);
  const scriptName = takenScripts.has(base) ? freeName(base, takenScripts) : base;
  next.push({ id: freshScriptId(next), name: scriptName, blocks: buildBlocks });
  target.blocks.push(blockWith("use", nextBlockId(), { name: scriptName, values: "" }));
  return { program: next, scriptName };
}
