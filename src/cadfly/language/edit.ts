import { RESERVED } from "../geometry/expr";
import { blankBlock, blockWith, commandById } from "./commands";
import { VARIABLE_NAME, inputNames } from "./env";
import { blocksToWrap, findBlock, findBuildIndex, findScript, freshScriptId, idCounter, isGlobalScript, type BlockLocation, type InsertPoint } from "./program";
import { BUILD, type Block, type Point, type Program, type Script } from "./types";

/**
 * This file implements all of the operations that restructure a Program.  Every
 * function is *pure*: it takes in a Program and returns a new Program.  Even if
 * the function doesn't change anything, it still returns a new Program.
 *
 * The operations cover the blocks (insert, take, wrap, set a field or a flag)
 * and the scripts (add, remove, rename, change the inputs of, fold, move).
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
export type BlockFlag = "collapsed" | "hidden" | "disabled" | "expanded";

/**
 * Turn one of a block's settings on or off. Off removes the setting:
 *
 * - `collapsed`: fold a block that holds others (or open it again): only its
 *   header is shown. Nothing else changes.
 * - `hidden`: the eye on the block: it is built, but leaves nothing in the
 *   picture, the export or the block around it; or show it again.
 * - `disabled`: switch a block that changes what is inside it off (the shapes
 *   inside pass through), or on again.
 * - `expanded`: show all of a partly exposed block's fields (or only the ones
 *   its mode offers): "more" and "less" on the block.
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
