import { BUILD, type Block, type Program } from "../../src/cadfly/language/types";

/**
 * Programs of one script, and the blocks at the top of a program's scripts.
 */

/** A program of just `build`, made of these blocks (a program with nothing in it, if there are none) */
export function oneScript(blocks: Block[]): Program {
  return [{ id: "s1", name: BUILD, blocks }];
}

/** The blocks at the top of a program's scripts, in the order they are stored */
export function topBlocks(program: Program): Block[] {
  return program.flatMap((s) => s.blocks);
}
