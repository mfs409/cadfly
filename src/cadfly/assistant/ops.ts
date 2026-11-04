import { blankBlock, commandById } from "../language/commands";
import { appendIndex, findBlock, freshId, insertStack, removeAt, setArg, setDisabled, setHidden } from "../language/edit";
import { BlockTextError, formatBlocks, parseBlocks } from "./blocktext";
import { validateProgram } from "../language/format";
import { type ModeSpec, allowedField, exposure, offeredKinds } from "../language/modes";
import type { Block, Program } from "../language/types";

/**
 * The ways a model may change a block program. The model never writes ids for
 * new blocks (we number them) and never writes code: it only says which blocks
 * to add, which field to change, or which block to remove.
 */

/** New blocks, as the model gives them: block text (see blocktext.ts), or already read into blocks */
export type NewBlocks = string | NewBlock[];

/** A block the model asks for: no id, and only the fields that differ from the defaults */
export interface NewBlock {
  kind: string;
  args?: Record<string, string | boolean>;
  inner?: NewBlock[];
  /** Built, but left out of the picture, the export and the block around it (the eye) */
  hidden?: boolean;
  /** For a block that changes what is inside it: switched off, so the shapes inside pass through (the power switch) */
  disabled?: boolean;
}

export type Op =
  /** Add blocks at the end of the program */
  | { op: "append"; blocks: NewBlocks }
  /** Add blocks right after an existing block, in the same list */
  | { op: "insert_after"; block: string; blocks: NewBlocks }
  /** Add blocks at the end of the inside of an existing block (a sketch, a polygon) */
  | { op: "insert_into"; block: string; blocks: NewBlocks }
  /** Change one field of one block */
  | { op: "set"; block: string; field: string; value: string | boolean }
  /**
   * Put existing blocks inside a new block that holds them (move, rotate, hide, subtract, ...), where the first
   * stood. Blocks listed in `with` are new, and go inside the holder after the wrapped ones.
   */
  | { op: "wrap"; blocks: string[]; holder: string | { kind: string; args?: Record<string, string | boolean> }; with?: NewBlocks }
  /** Take a block that holds others out of the way: what was inside takes its place */
  | { op: "unwrap"; block: string }
  /** Remove one block (and what is inside it) */
  | { op: "delete"; block: string }
  /** Remove every block */
  | { op: "clear" };

/** An op that cannot be carried out, and why, in words that can be sent back to the model */
export class OpError extends Error {}

/** The blocks of a program that stand for a shape or a variable, in words: `box "plate"` */
export function describeBlock(block: Block): string {
  const def = commandById(block.kind);
  const named = def?.params.find((p) => p.type.kind === "caption" || p.type.kind === "var");
  const name = named ? String(block.args[named.id] ?? "").trim() : "";
  return name ? `${def?.word ?? block.kind} "${name}"` : (def?.word ?? block.kind);
}

/** Turn a requested block into a real one: ids, defaults, names, and what is inside */
function realize(want: NewBlock, program: Program, made: Block[], where: string, mode?: ModeSpec): Block {
  const def = commandById(want.kind);
  if (!def) throw new OpError(`${where}: there is no block called "${want.kind}"`);
  // a mode limits what may be added to the blocks (and fields) the person is offered
  if (exposure(mode, want.kind) === "hidden") throw new OpError(`${where}: the ${def.word} block is not available now (the blocks you may use are ${offeredKinds(mode).join(", ")})`);
  const block = blankBlock(want.kind, freshId(program, made));
  made.push(block); // remembered, so the next block (or one inside this one) gets a different id and name
  for (const [key, value] of Object.entries(want.args ?? {})) {
    const param = def.params.find((p) => p.id === key);
    if (!param || !allowedField(mode, want.kind, key)) throw new OpError(`${where}: a ${def.word} block has no field "${key}" (its fields are ${def.params.filter((p) => allowedField(mode, want.kind, p.id)).map((p) => p.id).join(", ")})`);
    block.args[key] = param.type.kind === "flag" ? toFlag(value, `${where}, ${key}`) : String(value);
  }
  if (want.hidden) {
    if (!def.make || def.observer) throw new OpError(`${where}: a ${def.word} block makes no shape of its own, so it cannot be hidden`);
    block.hidden = true;
  }
  if (want.disabled) {
    if (!def.modifier) throw new OpError(`${where}: a ${def.word} block does not change what is inside it, so it cannot be disabled`);
    block.disabled = true;
  }
  if (want.inner?.length) {
    if (!def.inner) throw new OpError(`${where}: a ${def.word} block cannot hold other blocks`);
    block.inner = want.inner.map((child, i) => realize(child, program, made, `${where}, inside #${i + 1}`, mode));
  }
  return block;
}

function toFlag(value: string | boolean, where: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new OpError(`${where} must be true or false`);
}

/** Blocks as the model gave them: text is read into blocks */
function toBlocks(given: NewBlocks | undefined, where: string): NewBlock[] {
  if (given === undefined) return [];
  if (Array.isArray(given)) return given;
  if (typeof given !== "string") throw new OpError(`${where}: "blocks" must be block text, like "box w=10"`);
  try {
    return parseBlocks(given);
  } catch (e) {
    if (e instanceof BlockTextError) throw new OpError(`${where}: ${e.message}`);
    throw e;
  }
}

/** The ops with every block written as block text, which is how the model writes them (and is shown them) */
export function opsAsText(ops: Op[]): Op[] {
  const text = (blocks: NewBlocks | undefined) => (typeof blocks === "string" || blocks === undefined ? blocks : formatBlocks(blocks));
  return ops.map((o) => {
    switch (o.op) {
      case "append":
        return { ...o, blocks: text(o.blocks)! };
      case "insert_after":
      case "insert_into":
        return { ...o, blocks: text(o.blocks)! };
      case "wrap": {
        const { with: added, holder, ...rest } = o;
        return { ...rest, holder: typeof holder === "string" ? holder : formatBlocks([holder]), ...(added !== undefined ? { with: text(added) } : {}) };
      }
      default:
        return o;
    }
  });
}

const blockWord = (b: Block) => commandById(b.kind)?.word ?? b.kind;

/**
 * Apply the ops, in order, to a copy of the program. Either all of them work or
 * none do (an OpError says which one failed). Returns the new program and a
 * plain list of what changed, for showing to the person.
 */
export function applyOps(program: Program, ops: Op[], options: { mode?: ModeSpec } = {}): { program: Program; changes: string[] } {
  const mode = options.mode;
  let next: Program = structuredClone(program);
  const changes: string[] = [];
  const made: Block[] = [];

  ops.forEach((op, i) => {
    const where = `op ${i + 1} (${op.op})`;
    const exists = (id: string) => {
      const found = findBlock(next, id);
      if (!found) throw new OpError(`${where}: there is no block "${id}" (the blocks are ${allIds(next).join(", ") || "none yet"})`);
      return found;
    };
    switch (op.op) {
      case "append": {
        const blocks = toBlocks(op.blocks, where).map((w, k) => realize(w, next, made, `${where}, block #${k + 1}`, mode));
        next = insertStack(next, { parentId: null, index: appendIndex(next) }, blocks);
        blocks.forEach((b) => changes.push(`added ${describeBlock(b)}`));
        break;
      }
      case "insert_after": {
        const found = exists(op.block);
        const blocks = toBlocks(op.blocks, where).map((w, k) => realize(w, next, made, `${where}, block #${k + 1}`, mode));
        next = insertStack(next, { parentId: found.parent?.id ?? null, index: found.index + 1 }, blocks);
        blocks.forEach((b) => changes.push(`added ${describeBlock(b)}`));
        break;
      }
      case "insert_into": {
        const found = exists(op.block);
        if (!commandById(found.block.kind)?.inner) throw new OpError(`${where}: a ${blockWord(found.block)} block cannot hold other blocks`);
        const blocks = toBlocks(op.blocks, where).map((w, k) => realize(w, next, made, `${where}, block #${k + 1}`, mode));
        next = insertStack(next, { parentId: found.block.id, index: found.block.inner?.length ?? 0 }, blocks);
        blocks.forEach((b) => changes.push(`added ${describeBlock(b)} inside ${describeBlock(found.block)}`));
        break;
      }
      case "set": {
        const found = exists(op.block);
        const def = commandById(found.block.kind)!;
        if (op.field === "hidden") {
          // every shape block has this flag: true leaves it out of the picture and the export, false shows it again
          if (!def.make || def.observer) throw new OpError(`${where}: a ${def.word} block makes no shape of its own, so it cannot be hidden`);
          const on = toFlag(op.value, `${where}, hidden`);
          changes.push(`${on ? "hid" : "showed"} ${describeBlock(found.block)}`);
          next = setHidden(next, op.block, on);
          break;
        }
        if (op.field === "disabled") {
          // blocks that change what is inside them (transform, round, fillet, ...) can be switched off: the shapes inside pass through
          if (!def.modifier) throw new OpError(`${where}: a ${def.word} block does not change what is inside it, so it cannot be disabled`);
          const off = toFlag(op.value, `${where}, disabled`);
          changes.push(`${off ? "switched off" : "switched on"} ${describeBlock(found.block)}`);
          next = setDisabled(next, op.block, off);
          break;
        }
        const param = def.params.find((p) => p.id === op.field);
        if (!param) throw new OpError(`${where}: a ${def.word} block has no field "${op.field}" (its fields are ${def.params.map((p) => p.id).join(", ")})`);
        let value: string | boolean;
        if (param.type.kind === "flag") value = toFlag(op.value, `${where}, ${op.field}`);
        else {
          value = String(op.value);
          if (param.type.kind === "choice" && !param.type.options.some((o) => o.value === value)) {
            throw new OpError(`${where}: "${op.field}" must be one of ${param.type.options.map((o) => o.value).join(", ")}`);
          }
        }
        changes.push(`changed ${op.field} of ${describeBlock(found.block)} to ${value}`);
        next = setArg(next, op.block, op.field, value);
        break;
      }
      case "wrap": {
        if (!Array.isArray(op.blocks) || !op.blocks.length) throw new OpError(`${where}: "blocks" must list the ids of the blocks to wrap, like ["b1"]`);
        const want = typeof op.holder === "string" ? toBlocks(op.holder, where)[0] : op.holder;
        if (!want?.kind) throw new OpError(`${where}: say which block to wrap them in, like "holder":"transform z=20"`);
        if (typeof op.holder === "string" && toBlocks(op.holder, where).length !== 1) throw new OpError(`${where}: the holder is one line, like "transform z=20"`);
        if (new Set(op.blocks).size !== op.blocks.length) throw new OpError(`${where}: a block is listed twice`);
        const wrapped = op.blocks.map((id) => exists(id).block);
        for (const w of wrapped) {
          if (commandById(w.kind)?.automatic) throw new OpError(`${where}: the ${blockWord(w)} block is a part of the block it is in and cannot be wrapped (wrap the whole block, or the blocks inside it)`);
        }
        for (const outer of wrapped) {
          const inside = wrapped.find((other) => other !== outer && findBlock(outer.inner ?? [], other.id));
          if (inside) throw new OpError(`${where}: ${inside.id} is already inside ${outer.id}, so they cannot both be wrapped`);
        }
        const holder = realize({ kind: want.kind, args: want.args }, next, made, `${where}, holder`, mode);
        if (!commandById(holder.kind)?.inner) throw new OpError(`${where}: a ${blockWord(holder)} block cannot hold other blocks`);
        const added = toBlocks(op.with, where).map((w, k) => realize(w, next, made, `${where}, with #${k + 1}`, mode));
        holder.inner = [...wrapped, ...added];
        for (const b of wrapped.slice(1)) {
          const f = findBlock(next, b.id)!;
          removeAt(f);
        }
        const first = findBlock(next, wrapped[0].id)!;
        // the holder takes the first block's place, and its place in the workspace
        if (first.parent === null) {
          if (first.block.at) holder.at = first.block.at;
          if (first.block.stackCollapsed) holder.stackCollapsed = true;
          delete first.block.at;
          delete first.block.stackCollapsed;
        }
        first.list.splice(first.index, 1, holder);
        changes.push(wrapped.length === 1 ? `put ${describeBlock(wrapped[0])} inside ${describeBlock(holder)}` : `put ${wrapped.length} blocks inside ${describeBlock(holder)}`);
        break;
      }
      case "unwrap": {
        const found = exists(op.block);
        if (commandById(found.block.kind)?.automatic) throw new OpError(`${where}: the ${blockWord(found.block)} block is a part of its ${blockWord(found.parent!)} and cannot be taken out of it`);
        if (!found.block.inner?.length) throw new OpError(`${where}: ${describeBlock(found.block)} has nothing inside to take out`);
        changes.push(`took what was inside ${describeBlock(found.block)} out of it`);
        const inner = found.block.inner;
        if (found.parent === null) {
          if (found.block.at) inner[0].at = found.block.at;
          if (found.block.stackCollapsed) inner[0].stackCollapsed = true;
        }
        found.list.splice(found.index, 1, ...inner);
        break;
      }
      case "delete": {
        const found = exists(op.block);
        if (commandById(found.block.kind)?.automatic) throw new OpError(`${where}: the ${blockWord(found.block)} block is a part of its ${blockWord(found.parent!)} and cannot be removed (delete the whole ${blockWord(found.parent!)}, or the blocks inside it)`);
        changes.push(`removed ${describeBlock(found.block)}`);
        removeAt(found);
        break;
      }
      case "clear":
        if (next.length) changes.push("removed everything");
        next = [];
        break;
      default:
        throw new OpError(`${where}: unknown op "${(op as { op: string }).op}"`);
    }
  });

  try {
    validateProgram(next);
  } catch (e) {
    throw new OpError(`the result is not a valid program: ${(e as Error).message}`);
  }
  return { program: next, changes };
}

function allIds(program: Program): string[] {
  return program.flatMap((b) => [b.id, ...allIds(b.inner ?? [])]);
}
