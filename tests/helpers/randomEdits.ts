import { EXAMPLES } from "../../src/cadfly/examples";
import { type BlockFlag, addProgram, addScript, createBlock, dropBlocks, insertBlocks, moveScript, removeScript, setArg, setFlag, setScriptFold, setScriptInputs, setScriptName, takeBlock, takeOutOfHolder } from "../../src/cadfly/language/edit";
import { COMMANDS, commandById } from "../../src/cadfly/language/commands";
import { type InsertPoint, allBlocks, canHold, canHoldInScript, canStartScript, findBlock, freshScriptName, pointLists } from "../../src/cadfly/language/program";
import type { Block, Program } from "../../src/cadfly/language/types";
import { canDisable, canHide } from "../../src/cadfly/language/commands/types";

/**
 * Random editing for tests: a seeded random number generator, and a way to make
 * one random change to a program using the operations that the editor and the
 * assistant use, only where the editor would allow them.
 */

/** A source of numbers from 0 up to (not including) 1. */
export type Random = () => number;

/**
 * A random number generator that gives the same numbers for the same seed, so
 * that a failure can be run again.
 *
 * @param seed Any whole number.
 */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One random member of a non-empty list. */
function pick<T>(random: Random, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)];
}

/** What one random change did: the program that came of it, and words that say which change it was. */
export interface Edit {
  /** Which operation, and on what, in words that are enough to do it again by hand. */
  label: string;
  /** The program after the change. */
  program: Program;
}

/**
 * The kinds of block that can be dragged out of the palette: every command that
 * is not a fixed part of another block.
 */
const PALETTE_KINDS = COMMANDS.filter((c) => !c.automatic).map((c) => c.id);

/**
 * Every place where these blocks may go, by the rule the editor uses: in a block
 * that holds them, or in a script that takes them, with everything inside them
 * belonging where it would then be.
 *
 * @param program The program the blocks are to go in.
 * @param blocks The blocks that are to be put there.
 */
export function legalPoints(program: Program, blocks: Block[]): InsertPoint[] {
  const lists = pointLists(program);
  const points: InsertPoint[] = [];
  for (const script of program) {
    if (canHoldInScript(blocks, script)) for (let index = 0; index <= script.blocks.length; index++) points.push({ scriptId: script.id, index });
  }
  for (const block of allBlocks(program)) {
    if (!commandById(block.kind)?.inner) continue;
    if (canHold(blocks, block.kind, lists.get(block.id) ?? null)) for (let index = 0; index <= (block.inner?.length ?? 0); index++) points.push({ parentId: block.id, index });
  }
  return points;
}

/**
 * Put blocks somewhere that the editor allows, the way a drop does: wrapping the
 * blocks after the point when a holder is dropped on them, or as a new script, or
 * at the end of `build`.
 *
 * @returns The new program and where the blocks went, or undefined if there was nowhere.
 */
function dropSomewhere(program: Program, blocks: Block[], random: Random): { program: Program; where: string } | undefined {
  const choices: { where: string; make: () => Program }[] = legalPoints(program, blocks).map((point) => ({ where: JSON.stringify(point), make: () => dropBlocks(program, point, blocks) }));
  const build = program.find((s) => s.name === "build");
  if (build && canHoldInScript(blocks, build)) choices.push({ where: "end of build", make: () => insertBlocks(program, { end: true }, blocks) });
  if (canStartScript(blocks)) choices.push({ where: "a new script", make: () => insertBlocks(program, { newScript: { at: { x: Math.floor(random() * 20), y: Math.floor(random() * 20) } } }, blocks) });
  if (!choices.length) return undefined;
  const chosen = pick(random, choices);
  return { program: chosen.make(), where: chosen.where };
}

/** Texts that go in fields: numbers and formulas that are cheap to build, so that a program of them never takes long. */
const VALUES = ["1", "2", "3", "4", "5", "10", "0", "-3", "2.5", "width / 2", "1 + 1", "i * 2", "cos(30)", "w"];

/** The ways of changing a program, each given the program, and returning the change or undefined when it does not apply. */
const MAKERS: { name: string; weight: number; make: (program: Program, random: Random) => Edit | undefined }[] = [
  {
    name: "new block from the palette",
    weight: 6,
    make(program, random) {
      const kind = pick(random, PALETTE_KINDS);
      const dropped = dropSomewhere(program, [createBlock(program, kind)], random);
      return dropped && { label: `new ${kind} at ${dropped.where}`, program: dropped.program };
    },
  },
  {
    name: "carry a block somewhere else",
    weight: 6,
    make(program, random) {
      const movable = allBlocks(program).filter((b) => !commandById(b.kind)?.automatic);
      if (!movable.length) return undefined;
      const block = pick(random, movable);
      const taken = takeBlock(program, block.id);
      const dropped = dropSomewhere(taken.program, taken.blocks, random);
      return dropped && { label: `carry ${block.kind} ${block.id} to ${dropped.where}`, program: dropped.program };
    },
  },
  {
    name: "throw a block away",
    weight: 2,
    make(program, random) {
      const throwable = allBlocks(program).filter((b) => !commandById(b.kind)?.automatic);
      if (!throwable.length) return undefined;
      const block = pick(random, throwable);
      return { label: `throw away ${block.kind} ${block.id}`, program: takeBlock(program, block.id).program };
    },
  },
  {
    name: "take what is in a holder out",
    weight: 1,
    make(program, random) {
      const lists = pointLists(program);
      const holders = allBlocks(program).filter((b) => b.inner?.length && !commandById(b.kind)?.automatic);
      if (!holders.length) return undefined;
      const holder = pick(random, holders);
      const where = findBlock(program, holder.id)!;
      const fits = where.parent ? canHold(holder.inner!, where.parent.kind, lists.get(where.parent.id) ?? null) : canHoldInScript(holder.inner!, where.script);
      return fits ? { label: `take the contents out of ${holder.kind} ${holder.id}`, program: takeOutOfHolder(program, holder.id) } : undefined;
    },
  },
  {
    name: "type in a field",
    weight: 6,
    make(program, random) {
      const blocks = allBlocks(program);
      if (!blocks.length) return undefined;
      const block = pick(random, blocks);
      const params = (commandById(block.kind)?.params ?? []).filter((p) => p.type.kind !== "caption" && p.type.kind !== "file");
      if (!params.length) return undefined;
      const param = pick(random, params);
      const type = param.type;
      const value = type.kind === "flag" ? random() < 0.5 : type.kind === "choice" ? pick(random, type.options).value : type.kind === "var" ? pick(random, ["i", "j", "k", "n"]) : type.kind === "text" ? pick(random, ["a", "hello", "x y"]) : pick(random, VALUES);
      return { label: `set ${block.kind} ${block.id} field ${param.id} to ${JSON.stringify(value)}`, program: setArg(program, block.id, param.id, value) };
    },
  },
  {
    name: "fold, hide or switch off a block",
    weight: 4,
    make(program, random) {
      const blocks = allBlocks(program);
      if (!blocks.length) return undefined;
      const block = pick(random, blocks);
      const def = commandById(block.kind)!;
      const flags: BlockFlag[] = ["collapsed", ...(canHide(def) ? (["hidden"] as const) : []), ...(canDisable(def) ? (["disabled"] as const) : [])];
      const flag = pick(random, flags);
      const on = random() < 0.7;
      return { label: `${on ? "set" : "clear"} ${flag} on ${block.kind} ${block.id}`, program: setFlag(program, block.id, flag, on) };
    },
  },
  {
    name: "add a script",
    weight: 2,
    make(program, random) {
      const name = freshScriptName(program);
      const inputs = random() < 0.5 ? "" : "p1, p2";
      const at = random() < 0.5 ? undefined : { x: Math.floor(random() * 30), y: Math.floor(random() * 30) };
      return { label: `add script ${name}(${inputs})`, program: addScript(program, name, inputs, at) };
    },
  },
  {
    name: "remove a script",
    weight: 1,
    make(program, random) {
      const removable = program.filter((s) => s.name !== "build");
      if (!removable.length) return undefined;
      const script = pick(random, removable);
      return { label: `remove script ${script.id}`, program: removeScript(program, script.id) };
    },
  },
  {
    name: "rename a script or change its inputs",
    weight: 2,
    make(program, random) {
      const named = program.filter((s) => s.name !== undefined && s.name !== "build");
      if (!named.length) return undefined;
      const script = pick(random, named);
      if (random() < 0.5) {
        const name = freshScriptName(program);
        return { label: `rename script ${script.id} to ${name}`, program: setScriptName(program, script.id, name) };
      }
      const inputs = pick(random, ["", "a", "a, b", "w, h, d"]);
      return { label: `script ${script.id} takes "${inputs}"`, program: setScriptInputs(program, script.id, inputs) };
    },
  },
  {
    name: "fold or move a script",
    weight: 2,
    make(program, random) {
      const script = pick(random, program);
      if (random() < 0.5) return { label: `fold script ${script.id}`, program: setScriptFold(program, script.id, random() < 0.5) };
      const at = { x: random() * 40 - 5, y: random() * 40 - 5 };
      return { label: `move script ${script.id} to ${JSON.stringify(at)}`, program: moveScript(program, script.id, at) };
    },
  },
  {
    name: "add an example",
    weight: 1,
    make(program, random) {
      const example = pick(random, EXAMPLES);
      try {
        const added = addProgram(program, structuredClone(example.program), { title: example.name, inline: false, files: {} });
        return { label: `add the ${example.id} example`, program: added.program };
      } catch {
        return undefined; // adding an example may be refused, and then the project stays as it was
      }
    },
  },
];

/**
 * Make one random change to a program, the way the editor would, trying other
 * kinds of change if the first one picked does not apply.
 *
 * @param program The program (not changed).
 * @param random The source of choices.
 * @returns The change, or undefined if nothing applied.
 */
export function randomEdit(program: Program, random: Random): Edit | undefined {
  const pool = MAKERS.flatMap((m) => Array<typeof m>(m.weight).fill(m));
  for (let attempt = 0; attempt < 30; attempt++) {
    const edit = pick(random, pool).make(program, random);
    if (edit) return edit;
  }
  return undefined;
}
