import type { Block, Program } from "../../src/cadfly/language/types";

/**
 * Small builders for blocks and programs.
 */

/**
 * A block with an id. The last argument is what is inside it (a list of
 * blocks), or other fields of the block (`hidden`, `at`, ...).
 */
export const blk = (id: string, kind: string, args: Record<string, string | boolean> = {}, rest: Block[] | Partial<Block> = {}): Block => ({ id, kind, args, ...(Array.isArray(rest) ? { inner: rest } : rest) });

/** A box, 10 deep and 10 high, `w` wide (10 unless said) */
export const box = (id: string, w = "10") => blk(id, "box", { w, d: "10", h: "10" });

/** A `set` block: the variable `name` is `value` */
export const set = (id: string, name = "w", value = "5") => blk(id, "set", { name, value });

/** The ids of blocks, in order */
export const ids = (blocks: Block[]) => blocks.map((b) => b.id);

/** The ids of each script's blocks */
export const columns = (p: Program) => p.map((s) => ids(s.blocks));

/**
 * Three scripts: build (a1, a2) at the top left, a function called `b` (b1)
 * lower down, and a function called `c` (c1, c2) to the right of build, level
 * with it
 */
export const three = (): Program => [
  { id: "s1", name: "build", blocks: [box("a1"), box("a2")] },
  { id: "s2", name: "b", at: { x: 0, y: 5 }, blocks: [box("b1")] },
  { id: "s3", name: "c", inputs: "w", at: { x: 6, y: 0 }, blocks: [box("c1"), box("c2")] },
];
