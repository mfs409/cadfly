import { type NewBlock, parseBlocks } from "../assistant/blocktext";
import { commandById } from "../language/commands";
import { BUILD, type Block, type Program } from "../language/types";
import type { Example, ExampleSpec, ScriptText } from "./types";

/**
 * Reading an example's block text into the program it stands for. The blocks
 * hold only the fields the text names (the rest take their defaults when the
 * program runs), and they are numbered in the order they are written, across
 * all the scripts: b1, b2, and so on, with the scripts s1, s2.
 */

/**
 * Make blocks of what the block text says, numbering them as they come.
 *
 * @param requested What the text said, as the text reader read it.
 * @param nextId Gives the next block id each time it is called.
 */
function blocksOf(requested: NewBlock[], nextId: () => string): Block[] {
  return requested.map((want) => {
    const id = nextId();
    const params = commandById(want.kind)?.params ?? [];
    const args: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(want.args ?? {})) {
      // a field that is a tick is true or false, whether the text wrote it bare or as `show=false`
      const isFlag = params.find((p) => p.id === key)?.type.kind === "flag";
      args[key] = isFlag && typeof value === "string" ? value === "true" : value;
    }
    return {
      id,
      kind: want.kind,
      args,
      ...(want.inner?.length ? { inner: blocksOf(want.inner, nextId) } : {}),
      ...(want.hidden ? { hidden: true } : {}),
      ...(want.disabled ? { disabled: true } : {}),
    };
  });
}

/**
 * The program that scripts written as block text stand for.
 *
 * @param scripts The scripts, in order.
 */
export function programFromText(scripts: ScriptText[]): Program {
  let n = 0;
  const nextId = () => `b${++n}`;
  return scripts.map((s, i) => ({
    id: `s${i + 1}`,
    ...(s.name !== undefined ? { name: s.name } : {}),
    ...(s.inputs !== undefined ? { inputs: s.inputs } : {}),
    blocks: blocksOf(parseBlocks(s.text), nextId),
  }));
}

/**
 * The example that a written-down example stands for.
 *
 * @param spec The example as it is written.
 */
export function readExample(spec: ExampleSpec): Example {
  const scripts = spec.build !== undefined ? [{ name: BUILD, text: spec.build }] : spec.scripts;
  return { id: spec.id, name: spec.name, description: spec.description, program: programFromText(scripts) };
}
