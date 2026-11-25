import type { Block } from "../types";
import type { CommandDef } from "./types";

/**
 * Finding a command by its id, and making blocks from commands. It is a file of
 * its own, filled in once `COMMANDS` is built, so that the helpers and the
 * entries, which need these while they run, do not have to import the code that
 * builds the table, which imports them. Nothing can be looked up before the
 * table has been built.
 */

let byId = new Map<string, CommandDef>();

/**
 * Make these the commands that `commandById` finds (done once, when
 * `COMMANDS` has been built).
 */
export function registerCommands(commands: readonly CommandDef[]): void {
  byId = new Map(commands.map((c) => [c.id, c]));
}

/**
 * The command with this id (a block's `kind`), or undefined if there is none
 */
export function commandById(id: string): CommandDef | undefined {
  return byId.get(id);
}

/**
 * A new block of this kind, with every field at its default (and an empty
 * `inner`, if it holds blocks). Throws an Error for a kind that is not a
 * command.
 */
export function blankBlock(kind: string, id: string): Block {
  const def = commandById(kind);
  if (!def) throw new Error(`no such command: ${kind}`);
  const block: Block = { id, kind, args: Object.fromEntries(def.params.map((p) => [p.id, p.default])) };
  if (def.inner) block.inner = [];
  return block;
}

/**
 * A new block of this kind with some of its fields set, and the others at their
 * defaults. The block holds nothing yet.
 *
 * @param kind The kind of the block (a command id).
 * @param id The block's id.
 * @param args The fields to set, by parameter id.
 */
export function blockWith(kind: string, id: string, args: Record<string, string>): Block {
  const block = blankBlock(kind, id);
  Object.assign(block.args, args);
  return block;
}
