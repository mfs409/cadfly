import { POINT_HOLDERS, POINT_LIST_FLOW, commandById } from "./commands";
import { BUILD, type Block, type Point, type Program, type Script } from "./types";

/**
 * Functions for working with programs.  These won't modify a program, but might
 * make a new one.
 */

/** Make a program with nothing in it */
export function createEmptyProgram(): Program {
  return [{ id: "s1", name: BUILD, blocks: [] }];
}

/** The index in the program of the `build` script, or -1 if there is none */
export function findBuildIndex(program: Program): number {
  return program.findIndex((s) => s.name === BUILD);
}

/**
 * The index in the program of the script with this id, or undefined if there is
 * no such script.  An index is only good until the program is changed: keep
 * the id, and look the script up again.
 */
export function findScript(program: Program, id: string): number | undefined {
  const index = program.findIndex((s) => s.id === id);
  return index < 0 ? undefined : index;
}

/** Is this a program with nothing in it (just an empty `build`)? */
export function isBlank(program: Program): boolean {
  return program.length === 1 && program[0].name === BUILD && program[0].blocks.length === 0;
}

/** Does the program have any blocks at all, in any script? */
export function hasBlocks(program: Program): boolean {
  return program.some((s) => s.blocks.length > 0);
}

/** A global script: no name, only `set` blocks */
export function isGlobalScript(script: Script): boolean {
  return script.name === undefined;
}

/**
 * Where a block sits: the script it is in, the list it is in, and what holds
 * that list (null for the top of a script).
 *
 * This is a cursor.  `findBlock` works it out each time it is asked, from the
 * program, and nothing stores it, so nothing has to be kept up to date when the
 * program changes: ask again.  It points into the program it was found in, not
 * a copy.
 */
export interface BlockLocation {
  /** The block itself */
  block: Block;
  /** The script that holds the block (at any depth) */
  script: Script;
  /**
   * The list it is in, with the blocks beside it: its parent's `inner`, or the
   * script's `blocks`
   */
  siblings: Block[];
  /** Its place in `siblings` */
  index: number;
  /** The block that holds `siblings`, or null at the top of a script */
  parent: Block | null;
}

/**
 * A place in one list of blocks where blocks can be put, one of two kinds:
 * - Inside another block that has a list of children, such as an extrude
 * - In a script, given by its id
 *
 * Either way it goes before `index`: 0 is "first", and the length of the list
 * is "last".
 */
export type ListPoint = { parentId: string; index: number } | { scriptId: string; index: number };

/**
 * A place within a program where blocks can be put. There are three kinds:
 * - A place in a list of blocks, inside a block or in a script
 * - A new global script, which is added to the end of the program's list.  Its
 *   `at` is where it floats; with no `at` it has no place of its
 *   own, and is drawn below the script before it. (Only `set` blocks may start
 *   one.)
 * - The end of the `build` script, which is where blocks that are simply added
 *   to the program go. If there is no `build` yet, one is made.
 */
export type InsertPoint = ListPoint | { newScript: { at?: Point } } | { end: true };

/**
 * The blocks that a holder dropped at `point` would wrap: when exactly one
 * block is being put there, it is a holder with nothing inside it, and the list
 * has blocks from `point` on, every one of which the holder may hold, those
 * blocks, in order. Otherwise, none (the blocks are simply put there).
 *
 * A block that is an automatic part of its parent, or a piece, is never
 * wrapped (except a point in a list of points, which a repeat or if may wrap). A new script or the end of the program is never a place to wrap, and
 * neither is a global script (which holds only `set` blocks).
 *
 * @param program The program the blocks are being put in (without them, if they
 *                were carried out of it).
 * @param point Where they go.
 * @param blocks The blocks being put there.
 */
export function blocksToWrap(program: Program, point: InsertPoint, blocks: Block[]): Block[] {
  if (blocks.length !== 1 || "newScript" in point || "end" in point) return [];
  const [holder] = blocks;
  // a holder of points would take the blocks of a list of shapes, and make nothing of them
  if (!commandById(holder.kind)?.inner || holder.inner?.length || holder.kind in POINT_HOLDERS) return [];
  const script = "scriptId" in point ? program.find((s) => s.id === point.scriptId) : undefined;
  if (script && isGlobalScript(script)) return [];
  const list = "parentId" in point ? findBlock(program, point.parentId)?.block.inner : script?.blocks;
  const following = list?.slice(point.index) ?? [];
  // the points that a list is made of can be wrapped in a repeat or if too
  const within = "parentId" in point ? (pointLists(program).get(point.parentId) ?? null) : null;
  const inside = pointListOf(holder.kind, within);
  const holdable = following.every((b) => {
    const def = commandById(b.kind);
    const isPoint = within !== null && b.kind === POINT_HOLDERS[within];
    return !def?.automatic && (!def?.piece || isPoint) && accepts(holder.kind, b.kind, inside);
  });
  return holdable ? following : [];
}

/**
 * Every block in a list of blocks, at any depth: outer ones before the ones
 * inside them
 */
export function blocksWithin(blocks: Block[]): Block[] {
  return blocks.flatMap((b) => [b, ...blocksWithin(b.inner ?? [])]);
}

/** Every block in the program, outer ones before the ones inside them */
export function allBlocks(program: Program): Block[] {
  return blocksWithin(program.flatMap((s) => s.blocks));
}

/**
 * Look for the block with this id in one list of blocks, and in the lists
 * inside them.
 *
 * @param id The id to find.
 * @param siblings The list to look in.
 * @param parent The block that holds `siblings`, or null at the top of a script.
 * @param script The script that `siblings` is in, or is inside of.
 */
function searchList(id: string, siblings: Block[], parent: Block | null, script: Script): BlockLocation | undefined {
  for (let index = 0; index < siblings.length; index++) {
    const block = siblings[index];
    if (block.id === id) return { block, script, siblings, index, parent };
    const inner = searchList(id, block.inner ?? [], block, script);
    if (inner) return inner;
  }
  return undefined;
}

/**
 * Where the block with this id is, at any depth, or undefined if there is no
 * such block. The result points into `program` itself, not a copy.
 */
export function findBlock(program: Program, id: string): BlockLocation | undefined {
  for (const script of program) {
    const found = searchList(id, script.blocks, null, script);
    if (found) return found;
  }
  return undefined;
}

/**
 * The kind of point holder (a polygon, a solid's vertices section, a sweep)
 * whose list of points the blocks inside a block of this kind belong to, or
 * null if they are not a list of points. A point holder's blocks are such a
 * list. So are the blocks inside a `repeat`, `if` or `else` that is itself in
 * such a list, which is how a `repeat` of shapes and a `repeat` of points can
 * both be a `repeat`.
 *
 * @param kind The kind of the block that holds the blocks.
 * @param within The point holder whose list the block is in, or null if it is
 *               not in a list of points.
 */
export function pointListOf(kind: string, within: string | null): string | null {
  if (kind in POINT_HOLDERS) return kind;
  return within !== null && POINT_LIST_FLOW.includes(kind) ? within : null;
}

/**
 * Can a block of this kind be put in the list of blocks inside a block of kind
 * `parentKind`? In a list of points, only a point, a `repeat`, an `if` (with
 * its `else`) and a `set` can. A sweep's list also holds the flat shape it
 * carries, so it takes what it ordinarily does.
 *
 * @param parentKind The kind of the block that would hold it.
 * @param kind The kind of the block to put there.
 * @param list The point holder whose list the blocks inside the parent are, or
 *             null if it is not a list of points (see `pointListOf`).
 */
export function accepts(parentKind: string, kind: string, list: string | null = null): boolean {
  if (!commandById(kind)) return false;
  if (list !== null) {
    if (kind === POINT_HOLDERS[list] || kind === "repeat" || kind === "if" || kind === "set") return true;
    if (kind === "else") return parentKind === "if";
    if (list !== "sweep") return false;
  }
  return commandById(parentKind)?.inner?.includes(kind) ?? false;
}

/**
 * For every block that holds blocks (by id), the point holder whose list of
 * points the blocks inside it are, or null (see `pointListOf`). A block that
 * holds none, or that is not a holder, has an entry that says null.
 *
 * @param program The program.
 */
export function pointLists(program: Program): Map<string, string | null> {
  const lists = new Map<string, string | null>();
  /** Note the list of every block here, and inside them; `within` is the list these blocks are in. */
  const visit = (blocks: Block[], within: string | null) => {
    for (const b of blocks) {
      const own = pointListOf(b.kind, within);
      lists.set(b.id, own);
      visit(b.inner ?? [], own);
    }
  };
  for (const script of program) visit(script.blocks, null);
  return lists;
}

/**
 * Can a block of this kind be a direct member of this script's own list of
 * blocks (as opposed to being inside a holder in it: that is
 * `accepts(parentKind, kind)`)? A named script (`build` too) takes any block
 * that does not belong inside another; a global script takes only `set`.
 *
 * @param script The script.  Only its name matters: it says which kind of
 *               script it is.
 * @param kind The kind of block.
 */
export function acceptsInScript(script: Script, kind: string): boolean {
  const def = commandById(kind);
  if (!def) return false;
  return script.name === undefined ? kind === "set" : !def.piece;
}

/**
 * Can these blocks start a new global script, which is what dropping them in
 * empty space does? Only if there are some, and every one is a `set`.
 */
export function canStartScript(blocks: Block[]): boolean {
  return blocks.length > 0 && blocks.every((b) => b.kind === "set");
}

/**
 * Gives a new id each time it is called, one that no block uses: b1, b2, ...
 * The largest `bN` is looked for once, and it counts up from there.
 *
 * This looks through every block each time a counter is made, and does not
 * remember a count between calls.  That is cheap (a program has at most
 * thousands of blocks, and it is done once per edit), and a remembered count
 * would be state derived from the program that must be saved, restored on load,
 * and kept right through undo, loaded files and ids made by other code, where
 * a look through the blocks is always right.
 *
 * @param program The program whose ids are taken.
 * @param extra Blocks made but not in the program yet, whose ids are taken too.
 */
export function idCounter(program: Program, extra: Block[] = []): () => string {
  let max = 0;
  for (const b of [...allBlocks(program), ...blocksWithin(extra)]) {
    const n = /^b(\d+)$/.exec(b.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return () => `b${++max}`;
}

/**
 * The id a new script starts with: s1, s2, ... one more than the largest `sN`
 * of any script.
 *
 * Like `idCounter`, this looks through the scripts each time (there are only a
 * handful, and it is done once per edit), because a remembered count would be
 * derived state that has to be kept right, and a look is always right.
 *
 * @param program The program whose script ids are taken.
 */
export function freshScriptId(program: Program): string {
  let max = 0;
  for (const s of program) {
    const n = /^s(\d+)$/.exec(s.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `s${max + 1}`;
}

/**
 * The name a new script starts with: script1, script2, ... the first that no
 * script has.
 *
 * This looks through the scripts each time (there are only a handful, and it is
 * done once per edit), which is cheaper than keeping a counter right.
 *
 * @param program The program whose script names are taken.
 */
export function freshScriptName(program: Program): string {
  let n = 1;
  while (program.some((s) => s.name === `script${n}`)) n++;
  return `script${n}`;
}
