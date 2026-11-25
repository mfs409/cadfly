import { blankBlock, canDisable, canHide, commandById, type CommandDef } from "../language/commands";
import { addScript, insertBlocks, setArg, setFlag, takeBlock, takeOutOfHolder, moveIntoNewHolder } from "../language/edit";
import { allBlocks, blocksWithin, canStartScript, createEmptyProgram, findBlock, findBuildIndex, freshScriptId, hasBlocks, idCounter } from "../language/program";
import { BlockTextError, type NewBlock, parseBlocks } from "./blocktext";
import { validateProgram } from "../language/format";
import { type ModeSpec, allowsScripts, offeredKinds, offers } from "../ui/modes";
import { BUILD, type Block, type Program } from "../language/types";

/**
 * The ways a model may change a block program. The model never writes ids for
 * new blocks (we number them) and never writes code: it only says which blocks
 * to add, which field to change, or which block to remove. New blocks are
 * always written as block text.
 */

/** One change the model may ask for. An op names the blocks it works on by their ids. */
export type Op =
  /**
   * Add blocks at the end of `build` (or of the named script `to`; `to: "globals"` puts `set` blocks in a new global
   * script)
   */
  | { op: "append"; blocks: string; to?: string }
  /** Add a new named script (a function that a `use` block runs), with `inputs` like "w, h", holding `blocks` if any */
  | { op: "script"; name: string; inputs?: string; blocks?: string }
  /** Add blocks right after an existing block, in the same list */
  | { op: "insert_after"; block: string; blocks: string }
  /** Add blocks at the end of the inside of an existing block (a sketch, a polygon) */
  | { op: "insert_into"; block: string; blocks: string }
  /** Change one field of one block */
  | { op: "set"; block: string; field: string; value: string | boolean }
  /**
   * Put existing blocks inside a new block that holds them (move, rotate, hide, subtract, ...), where the first
   * stood. The new block is `holder`, one line of block text. Blocks listed in `with` are new, and go inside the
   * holder after the wrapped ones.
   */
  | { op: "wrap"; blocks: string[]; holder: string; with?: string }
  /** Take a block that holds others out of the way: what was inside takes its place */
  | { op: "unwrap"; block: string }
  /** Remove one block (and what is inside it) */
  | { op: "delete"; block: string }
  /** Remove every block, and every script but an empty build */
  | { op: "clear" };

/** An op that cannot be carried out, and why, in words that can be sent back to the model */
export class OpError extends Error {}

/** The word a block of this kind starts with, or the kind itself if it is not a command */
const wordOf = (kind: string) => commandById(kind)?.word ?? kind;

/** A block in words, by its word and its name if it has one: `box "plate"` */
export function describeBlock(block: Block): string {
  const def = commandById(block.kind);
  const named = def?.params.find((p) => p.type.kind === "caption" || p.type.kind === "var");
  const name = named ? String(block.args[named.id] ?? "").trim() : "";
  return name ? `${wordOf(block.kind)} "${name}"` : wordOf(block.kind);
}

/**
 * What the handler of an op works with: the program it is changing, the
 * running list of what changed, and what it needs to make new blocks.
 */
interface OpContext {
  /** The program being changed. A handler replaces it with the changed one. */
  program: Program;
  /** The plain list of what changed, for showing to the person */
  changeLog: string[];
  /** The blocks made so far in this call of `applyOps`, which are not all in the program yet, so that no two get the same id */
  madeSoFar: Block[];
  /** The mode in use, if any: it limits what may be added or changed */
  mode?: ModeSpec;
  /** How to refer to the op that is being carried out in a message: `op 2 (append)` */
  label: string;
  /** Gives a new block id each time it is called: made fresh for each op, from the program as it is then */
  nextId: () => string;
}

/** Throw an `OpError` unless a block of this kind can be hidden (the eye) */
function checkCanHide(def: CommandDef, label: string): void {
  if (!canHide(def)) throw new OpError(`${label}: a ${def.word} block makes no shape of its own, so it cannot be hidden`);
}

/** Throw an `OpError` unless a block of this kind can be switched off (the power switch) */
function checkCanDisable(def: CommandDef, label: string): void {
  if (!canDisable(def)) throw new OpError(`${label}: a ${def.word} block does not change what is inside it, so it cannot be disabled`);
}

/**
 * Turn a requested block into a real one: ids, defaults, names, and what is inside
 *
 * @param requested The block the model asked for.
 * @param ctx What the op works with (the ids, the mode).
 * @param label How to refer to the block in a message.
 */
function makeBlock(requested: NewBlock, ctx: OpContext, label: string): Block {
  const { mode } = ctx;
  const def = commandById(requested.kind);
  if (!def) throw new OpError(`${label}: there is no block called "${requested.kind}"`);
  // a mode limits what may be added to the blocks the person is offered
  if (!offers(mode, requested.kind)) throw new OpError(`${label}: the ${def.word} block is not available now (the blocks you may use are ${offeredKinds(mode).join(", ")})`);
  const block = blankBlock(requested.kind, ctx.nextId());
  ctx.madeSoFar.push(block); // remembered, so the next block (or one inside this one) gets a different id and name
  for (const [key, value] of Object.entries(requested.args ?? {})) {
    const param = def.params.find((p) => p.id === key);
    if (!param) throw new OpError(`${label}: a ${def.word} block has no field "${key}" (its fields are ${fieldIds(def)})`);
    block.args[key] = param.type.kind === "flag" ? toFlag(value, `${label}, ${key}`) : String(value);
  }
  if (requested.hidden) {
    checkCanHide(def, label);
    block.hidden = true;
  }
  if (requested.disabled) {
    checkCanDisable(def, label);
    block.disabled = true;
  }
  if (requested.inner?.length) {
    if (!def.inner) throw new OpError(`${label}: a ${def.word} block cannot hold other blocks`);
    block.inner = requested.inner.map((child, i) => makeBlock(child, ctx, `${label}, inside #${i + 1}`));
  }
  return block;
}

/**
 * The ids of the fields of a block, in words: `name, w, d, h`.
 *
 * @param def The command the block is of.
 */
function fieldIds(def: CommandDef): string {
  return def.params.map((p) => p.id).join(", ");
}

/**
 * Read a flag the model gave as text or as a boolean: "true" and "false" are
 * accepted. Throws an `OpError` otherwise.
 *
 * @param value What the model wrote.
 * @param label How to refer to the op, for the message.
 */
function toFlag(value: string | boolean, label: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new OpError(`${label} must be true or false`);
}

/**
 * Read block text into the blocks it describes. Nothing is read from a missing
 * value; anything that is not text is refused.
 *
 * @param given What the model wrote, if anything.
 * @param label How to refer to the op, for the message.
 */
function toBlocks(given: string | undefined, label: string): NewBlock[] {
  if (given === undefined) return [];
  if (typeof given !== "string") throw new OpError(`${label}: "blocks" must be block text, like "box w=10"`);
  try {
    return parseBlocks(given);
  } catch (e) {
    if (e instanceof BlockTextError) throw new OpError(`${label}: ${e.message}`);
    throw e;
  }
}

/**
 * Make the real blocks for block text the model gave.
 *
 * @param ctx What the op works with.
 * @param given The block text, if any.
 * @param part What to call each block in a message: `block` gives "block #1".
 */
function makeBlocks(ctx: OpContext, given: string | undefined, part = "block"): Block[] {
  return toBlocks(given, ctx.label).map((requested, k) => makeBlock(requested, ctx, `${ctx.label}, ${part} #${k + 1}`));
}

/**
 * Say in the change log that blocks were added.
 *
 * @param ctx What the op works with.
 * @param blocks The blocks that were added.
 * @param suffix Where they went, if it is worth saying: ` inside box "plate"`.
 */
function logAdded(ctx: OpContext, blocks: Block[], suffix = ""): void {
  for (const b of blocks) ctx.changeLog.push(`added ${describeBlock(b)}${suffix}`);
}

/** The location of the block with this id, or an `OpError` that names the ids there are. */
function mustFind(ctx: OpContext, id: string) {
  const found = findBlock(ctx.program, id);
  if (!found) throw new OpError(`${ctx.label}: there is no block "${id}" (the blocks are ${allBlocks(ctx.program).map((b) => b.id).join(", ") || "none yet"})`);
  return found;
}

/** Add blocks at the end of `build`, or of the named script, or in a new global script. */
function doAppend(ctx: OpContext, op: Extract<Op, { op: "append" }>): void {
  const { label } = ctx;
  const blocks = makeBlocks(ctx, op.blocks);
  const to = typeof op.to === "string" && op.to.trim() ? op.to.trim() : BUILD;
  if (to === BUILD) ctx.program = insertBlocks(ctx.program, { end: true }, blocks);
  else {
    if (!allowsScripts(ctx.mode)) throw new OpError(`${label}: there are no scripts besides build to add to now`);
    if (to === "globals") {
      if (!canStartScript(blocks)) throw new OpError(`${label}: only set blocks can go in the globals`);
      ctx.program = insertBlocks(ctx.program, { newScript: {} }, blocks);
    } else {
      const script = ctx.program.find((sc) => sc.name === to);
      if (!script) throw new OpError(`${label}: there is no script called "${to}" (the scripts are ${ctx.program.flatMap((sc) => (sc.name === undefined ? [] : [sc.name])).join(", ")}; or "globals")`);
      ctx.program = insertBlocks(ctx.program, { scriptId: script.id, index: script.blocks.length }, blocks);
    }
  }
  logAdded(ctx, blocks);
}

/** Add a new named script, with the blocks it starts with. */
function doScript(ctx: OpContext, op: Extract<Op, { op: "script" }>): void {
  const { label } = ctx;
  if (!allowsScripts(ctx.mode)) throw new OpError(`${label}: scripts are not available now: put the blocks in build`);
  if (typeof op.name !== "string" || !op.name.trim()) throw new OpError(`${label}: say the script's name, like "leg"`);
  const name = op.name.trim();
  try {
    ctx.program = addScript(ctx.program, name, typeof op.inputs === "string" ? op.inputs : "");
  } catch (e) {
    throw new OpError(`${label}: ${(e as Error).message}`);
  }
  const blocks = makeBlocks(ctx, op.blocks);
  // addScript puts the new script last
  if (blocks.length) ctx.program = insertBlocks(ctx.program, { scriptId: ctx.program[ctx.program.length - 1].id, index: 0 }, blocks);
  ctx.changeLog.push(`added the script ${name}`);
  logAdded(ctx, blocks, ` inside the script ${name}`);
}

/** Add blocks right after an existing block, in whatever list it is in. */
function doInsertAfter(ctx: OpContext, op: Extract<Op, { op: "insert_after" }>): void {
  const found = mustFind(ctx, op.block);
  const blocks = makeBlocks(ctx, op.blocks);
  const index = found.index + 1;
  const point = found.parent ? { parentId: found.parent.id, index } : { scriptId: found.script.id, index };
  ctx.program = insertBlocks(ctx.program, point, blocks);
  logAdded(ctx, blocks);
}

/** Add blocks at the end of the inside of an existing block. */
function doInsertInto(ctx: OpContext, op: Extract<Op, { op: "insert_into" }>): void {
  const found = mustFind(ctx, op.block);
  if (!commandById(found.block.kind)?.inner) throw new OpError(`${ctx.label}: a ${wordOf(found.block.kind)} block cannot hold other blocks`);
  const blocks = makeBlocks(ctx, op.blocks);
  ctx.program = insertBlocks(ctx.program, { parentId: found.block.id, index: found.block.inner?.length ?? 0 }, blocks);
  logAdded(ctx, blocks, ` inside ${describeBlock(found.block)}`);
}

/**
 * Change one field of one block, or turn its eye (`hidden`) or power switch
 * (`disabled`) on or off.
 */
function doSet(ctx: OpContext, op: Extract<Op, { op: "set" }>): void {
  const { label } = ctx;
  const found = mustFind(ctx, op.block);
  const def = commandById(found.block.kind)!;
  if (op.field === "hidden") {
    // every shape block has this flag: true leaves it out of the picture and the export, false shows it again
    checkCanHide(def, label);
    const on = toFlag(op.value, `${label}, hidden`);
    ctx.changeLog.push(`${on ? "hid" : "showed"} ${describeBlock(found.block)}`);
    ctx.program = setFlag(ctx.program, op.block, "hidden", on);
    return;
  }
  if (op.field === "disabled") {
    // blocks that change what is inside them (transform, round, fillet, ...) can be switched off: the shapes inside pass through
    checkCanDisable(def, label);
    const off = toFlag(op.value, `${label}, disabled`);
    ctx.changeLog.push(`${off ? "switched off" : "switched on"} ${describeBlock(found.block)}`);
    ctx.program = setFlag(ctx.program, op.block, "disabled", off);
    return;
  }
  const param = def.params.find((p) => p.id === op.field);
  if (!param) throw new OpError(`${label}: a ${def.word} block has no field "${op.field}" (its fields are ${fieldIds(def)})`);
  let value: string | boolean;
  if (param.type.kind === "flag") value = toFlag(op.value, `${label}, ${op.field}`);
  else {
    value = String(op.value);
    if (param.type.kind === "choice" && !param.type.options.some((o) => o.value === value)) {
      throw new OpError(`${label}: "${op.field}" must be one of ${param.type.options.map((o) => o.value).join(", ")}`);
    }
  }
  ctx.changeLog.push(`changed ${op.field} of ${describeBlock(found.block)} to ${value}`);
  ctx.program = setArg(ctx.program, op.block, op.field, value);
}

/** Put existing blocks inside a new holder, where the first of them was. */
function doWrap(ctx: OpContext, op: Extract<Op, { op: "wrap" }>): void {
  const { label } = ctx;
  if (!Array.isArray(op.blocks) || !op.blocks.length) throw new OpError(`${label}: "blocks" must list the ids of the blocks to wrap, like ["b1"]`);
  if (typeof op.holder !== "string") throw new OpError(`${label}: say which block to wrap them in, like "holder":"transform z=20"`);
  const lines = toBlocks(op.holder, label);
  if (!lines[0]?.kind) throw new OpError(`${label}: say which block to wrap them in, like "holder":"transform z=20"`);
  if (lines.length !== 1) throw new OpError(`${label}: the holder is one line, like "transform z=20"`);
  if (new Set(op.blocks).size !== op.blocks.length) throw new OpError(`${label}: a block is listed twice`);
  const wrapped = op.blocks.map((id) => mustFind(ctx, id).block);
  for (const w of wrapped) {
    if (commandById(w.kind)?.automatic) throw new OpError(`${label}: the ${wordOf(w.kind)} block is a part of the block it is in and cannot be wrapped (wrap the whole block, or the blocks inside it)`);
  }
  for (const outer of wrapped) {
    const inside = wrapped.find((other) => other !== outer && blocksWithin(outer.inner ?? []).some((b) => b.id === other.id));
    if (inside) throw new OpError(`${label}: ${inside.id} is already inside ${outer.id}, so they cannot both be wrapped`);
  }
  const holder = makeBlock({ kind: lines[0].kind, args: lines[0].args }, ctx, `${label}, holder`);
  if (!commandById(holder.kind)?.inner) throw new OpError(`${label}: a ${wordOf(holder.kind)} block cannot hold other blocks`);
  const added = makeBlocks(ctx, op.with, "with");
  ctx.program = moveIntoNewHolder(ctx.program, op.blocks, holder, added);
  ctx.changeLog.push(wrapped.length === 1 ? `put ${describeBlock(wrapped[0])} inside ${describeBlock(holder)}` : `put ${wrapped.length} blocks inside ${describeBlock(holder)}`);
}

/** Take what is inside a block out, and remove the block. */
function doUnwrap(ctx: OpContext, op: Extract<Op, { op: "unwrap" }>): void {
  const found = mustFind(ctx, op.block);
  if (commandById(found.block.kind)?.automatic) throw new OpError(`${ctx.label}: the ${wordOf(found.block.kind)} block is a part of its ${wordOf(found.parent!.kind)} and cannot be taken out of it`);
  if (!found.block.inner?.length) throw new OpError(`${ctx.label}: ${describeBlock(found.block)} has nothing inside to take out`);
  ctx.changeLog.push(`took what was inside ${describeBlock(found.block)} out of it`);
  ctx.program = takeOutOfHolder(ctx.program, op.block);
}

/** Remove one block and what is inside it. */
function doDelete(ctx: OpContext, op: Extract<Op, { op: "delete" }>): void {
  const found = mustFind(ctx, op.block);
  if (commandById(found.block.kind)?.automatic) {
    const parent = wordOf(found.parent!.kind);
    throw new OpError(`${ctx.label}: the ${wordOf(found.block.kind)} block is a part of its ${parent} and cannot be removed (delete the whole ${parent}, or the blocks inside it)`);
  }
  ctx.changeLog.push(`removed ${describeBlock(found.block)}`);
  ctx.program = takeBlock(ctx.program, op.block).program;
}

/** Remove every block, and every script but an empty build. */
function doClear(ctx: OpContext): void {
  if (hasBlocks(ctx.program) || ctx.program.length > 1) ctx.changeLog.push("removed everything");
  ctx.program = createEmptyProgram();
}

/** What carries out each kind of op */
const HANDLERS: { [K in Op["op"]]: (ctx: OpContext, op: Extract<Op, { op: K }>) => void } = {
  append: doAppend,
  script: doScript,
  insert_after: doInsertAfter,
  insert_into: doInsertInto,
  set: doSet,
  wrap: doWrap,
  unwrap: doUnwrap,
  delete: doDelete,
  clear: doClear,
};

/**
 * Apply the ops, in order, to a copy of the program. Either all of them work or
 * none do (an OpError says which one failed). Returns the new program and a
 * plain list of what changed, for showing to the person.
 */
export function applyOps(program: Program, ops: Op[], options: { mode?: ModeSpec } = {}): { program: Program; changeLog: string[] } {
  const next: Program = structuredClone(program);
  // a program without `build` (such as the old empty one, `[]`) gets an empty one, since every program has one
  if (findBuildIndex(next) < 0) next.push({ id: freshScriptId(next), name: BUILD, blocks: [] });
  const ctx: OpContext = { program: next, changeLog: [], madeSoFar: [], mode: options.mode, label: "", nextId: () => "" };

  ops.forEach((op, i) => {
    ctx.label = `op ${i + 1} (${op.op})`;
    ctx.nextId = idCounter(ctx.program, ctx.madeSoFar);
    const handler = HANDLERS[op.op] as ((ctx: OpContext, op: Op) => void) | undefined;
    if (!handler) throw new OpError(`${ctx.label}: unknown op "${(op as { op: string }).op}"`);
    handler(ctx, op);
  });

  try {
    validateProgram(ctx.program);
  } catch (e) {
    throw new OpError(`the result is not a valid program: ${(e as Error).message}`);
  }
  return { program: ctx.program, changeLog: ctx.changeLog };
}
