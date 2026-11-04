import { blankBlock, commandById } from "./commands";
import type { Block, Program } from "./types";

/**
 * Changing a program, as plain data in and plain data out: nothing here
 * modifies what it is given. The block editor uses these for every drag, drop
 * and field change.
 */

/**
 * Where a block sits: the list it is in, and what holds that list (null for the
 * top of the program)
 */
export interface Found {
  /** The block itself */
  block: Block;
  /** The list it is in: its parent's `inner`, or the program */
  list: Block[];
  /** Its place in `list` */
  index: number;
  /** The block that holds `list`, or null at the top of the program */
  parent: Block | null;
}

/**
 * A place a stack of blocks can be put: into the inner list of `parentId` (or
 * the top of the program) at `index`
 */
export interface Slot {
  /** The id of the block to put them in, or null for the top of the program */
  parentId: string | null;
  /** Where in that list they go */
  index: number;
  /**
   * At the top of the program: put these blocks above the stack that starts at
   * `index`, as its new first blocks
   */
  top?: boolean;
  /**
   * At the top of the program: start a new stack here instead (the blocks go at
   * the end of the program; the place is in meters)
   */
  at?: Position;
}

/** A place in the editor's workspace, in meters from its top left */
export interface Position {
  /** How far across from the left */
  x: number;
  /** How far down from the top */
  y: number;
}

/**
 * The blocks at the top of the program that belong together: a block with `at`
 * starts a new stack, and the first block always does
 */
export interface StackRange {
  /** The index of the stack's first block */
  start: number;
  /** One past the last block */
  end: number;
}

/**
 * The stacks at the top of a program, in the order their blocks are stored: a
 * block with `at` starts a new stack, and the first block always does.
 */
export function stackRanges(program: Program): StackRange[] {
  const out: StackRange[] = [];
  program.forEach((b, i) => {
    if (i === 0 || b.at) out.push({ start: i, end: i + 1 });
    else out[out.length - 1].end = i + 1;
  });
  return out;
}

/**
 * Where a stack is: its first block's `at`, or the workspace's top left if it
 * has none
 */
function stackPosition(program: Program, range: StackRange): Position {
  return program[range.start].at ?? { x: 0, y: 0 };
}

/**
 * The stacks of a program with their places, in the order they run: top to
 * bottom, then left to right, and stacks at the same place in the order they
 * are stored. (`i` is the stack's place in `stackRanges`.)
 */
function byPosition(program: Program) {
  return stackRanges(program)
    .map((range, i) => ({ range, i, at: stackPosition(program, range) }))
    .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x || a.i - b.i);
}

/**
 * The blocks in the order they run: stacks from the top of the workspace to the
 * bottom, and left to right where they are level (like reading), and the blocks
 * of each stack from top to bottom.
 */
export function runOrder(program: Program): Program {
  return byPosition(program).flatMap(({ range }) => program.slice(range.start, range.end));
}

/**
 * Where blocks that are simply added to the program go: the end of the stack
 * that runs last
 */
export function appendIndex(program: Program): number {
  const order = byPosition(program);
  return order.length ? order[order.length - 1].range.end : 0;
}

/**
 * Take the block at `index` out of a list. At the top of the program, a stack's
 * position (and fold) pass to its next block.
 *
 * This changes `list`: it is the one function here that does.
 *
 * @param where Where the block is (see `findBlock`): its list, its index, and
 *              the block that holds the list (null at the top of the program).
 * @returns The block that was taken out.
 */
export function removeAt(where: Pick<Found, "list" | "index" | "parent">): Block {
  const { list, index, parent } = where;
  const [gone] = list.splice(index, 1);
  const next = list[index];
  if (parent === null && next && !next.at) {
    if (gone.at) next.at = gone.at;
    if (gone.stackCollapsed) next.stackCollapsed = true;
  }
  return gone;
}

/** Every block in the program, outer ones before the ones inside them */
export function allBlocks(program: Program): Block[] {
  return program.flatMap((b) => [b, ...allBlocks(b.inner ?? [])]);
}

/**
 * Where the block with this id is, at any depth, or undefined if there is no
 * such block. The result points into `program` itself, not a copy.
 */
export function findBlock(program: Program, id: string): Found | undefined {
  const search = (list: Block[], parent: Block | null): Found | undefined => {
    for (let index = 0; index < list.length; index++) {
      if (list[index].id === id) return { block: list[index], list, index, parent };
      const inner = search(list[index].inner ?? [], list[index]);
      if (inner) return inner;
    }
    return undefined;
  };
  return search(program, null);
}

/**
 * Can a block of this kind be put in a list held by `parentKind` (null: the top
 * of the program)?
 */
export function accepts(parentKind: string | null, kind: string): boolean {
  const def = commandById(kind);
  if (!def) return false;
  if (parentKind === null) return !def.piece;
  return commandById(parentKind)?.inner?.includes(kind) ?? false;
}

/**
 * Take one block out of the program, with whatever is inside it (a holder comes
 * with its contents), and close the gap: what you hold when you pick a block
 * up. The blocks after it stay where they were; the first block of a stack
 * leaves its place to the next.
 *
 * @returns The program without it, and the block that was taken (as a stack of
 *          one). If there is no such block, the program as it was and an empty
 *          stack.
 */
export function takeBlock(program: Program, id: string): { program: Program; stack: Block[] } {
  const rest = structuredClone(program);
  const found = findBlock(rest, id);
  if (!found) return { program, stack: [] };
  return { program: rest, stack: [removeAt(found)] };
}

/**
 * Put a stack of blocks into a slot; whatever was already there comes after it.
 * Throws an Error if the slot names a block that is not in the program.
 *
 * @param program The program to put them in (not changed).
 * @param slot Where they go.
 * @param stack The blocks to put there, in order.
 * @returns The new program.
 */
export function insertStack(program: Program, slot: Slot, stack: Block[]): Program {
  const next = structuredClone(program);
  let list: Block[];
  if (slot.parentId === null) {
    // a stack's place belongs to its first block: carried blocks lose theirs,
    // and one that starts a new stack gets a new one
    const blocks = structuredClone(stack);
    for (const b of blocks) {
      delete b.at;
      delete b.stackCollapsed;
    }
    const round = (v: number) => Math.round(v * 100) / 100;
    if (slot.at) {
      blocks[0].at = { x: Math.max(0, round(slot.at.x)), y: Math.max(0, round(slot.at.y)) };
      next.push(...blocks);
    } else {
      if (slot.top && next[slot.index]) {
        // above a stack: the stack's place (and fold) pass to the new first
        // block
        const old = next[slot.index];
        if (old.at) blocks[0].at = old.at;
        if (old.stackCollapsed) blocks[0].stackCollapsed = true;
        delete old.at;
        delete old.stackCollapsed;
      }
      next.splice(slot.index, 0, ...blocks);
    }
    return next;
  } else {
    const parent = findBlock(next, slot.parentId)?.block;
    if (!parent) throw new Error("no such block to put them in");
    parent.inner ??= [];
    list = parent.inner;
  }
  list.splice(slot.index, 0, ...structuredClone(stack));
  return next;
}

/** Change what one field of one block holds */
export function setArg(program: Program, blockId: string, paramId: string, value: string | boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, blockId);
  if (found) found.block.args[paramId] = value;
  return next;
}

/**
 * Fold a block that holds others (or open it again): only its header is shown.
 * Nothing else changes.
 */
export function setCollapsed(program: Program, blockId: string, collapsed: boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, blockId);
  if (found) {
    if (collapsed) found.block.collapsed = true;
    else delete found.block.collapsed;
  }
  return next;
}

/**
 * Hide a block (the eye on it): it is built, but leaves nothing in the picture,
 * the export or the block around it; or show it again
 */
export function setHidden(program: Program, blockId: string, hidden: boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, blockId);
  if (found) {
    if (hidden) found.block.hidden = true;
    else delete found.block.hidden;
  }
  return next;
}

/**
 * Switch a block that changes what is inside it off (the shapes inside pass
 * through), or on again
 */
export function setDisabled(program: Program, blockId: string, disabled: boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, blockId);
  if (found) {
    if (disabled) found.block.disabled = true;
    else delete found.block.disabled;
  }
  return next;
}

/**
 * Fill a faces section with faces (each a list of vertex numbers): what the
 * "hull" button does. The faces are added after any already there. If there is
 * no such block, the program is returned as it was.
 *
 * @param program The program (not changed).
 * @param facesId The id of the faces block.
 * @param faces The faces to add, each a list of vertex numbers.
 */
export function fillFaces(program: Program, facesId: string, faces: number[][]): Program {
  const next = structuredClone(program);
  const found = findBlock(next, facesId);
  if (!found) return program;
  const made: Block[] = [];
  const blocks = faces.map((corners) => {
    const block = piece("face", freshId(next, made), { corners: corners.join(" ") });
    made.push(block);
    return block;
  });
  found.block.inner = [...(found.block.inner ?? []), ...blocks];
  return next;
}

/**
 * Show all of a partly exposed block's fields (or only the ones its mode
 * offers): "more" and "less" on the block
 */
export function setExpanded(program: Program, blockId: string, expanded: boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, blockId);
  if (found) {
    if (expanded) found.block.expanded = true;
    else delete found.block.expanded;
  }
  return next;
}

/**
 * Fold the stack that starts with this block (or open it): the editor shows
 * only the first block and a strip for the rest
 */
export function setStackCollapsed(program: Program, firstBlockId: string, collapsed: boolean): Program {
  const next = structuredClone(program);
  const found = findBlock(next, firstBlockId);
  if (found && found.parent === null) {
    if (collapsed) found.block.stackCollapsed = true;
    else delete found.block.stackCollapsed;
  }
  return next;
}

/**
 * The next id that no block uses: b1, b2, ...
 *
 * @param program The program whose ids are taken.
 * @param extra Blocks made but not in the program yet, whose ids are taken too.
 */
export function freshId(program: Program, extra: Block[] = []): string {
  let max = 0;
  for (const b of [...allBlocks(program), ...allBlocks(extra)]) {
    const n = /^b(\d+)$/.exec(b.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  return `b${max + 1}`;
}

/** A piece with some fields changed from their defaults */
function piece(kind: string, id: string, args: Record<string, string>): Block {
  const block = blankBlock(kind, id);
  Object.assign(block.args, args);
  return block;
}

/**
 * What a block starts out holding when it is made, so it works straight away
 * (undefined for a kind that starts out empty).
 *
 * @param kind The kind of block that is being made.
 * @param nextId Gives a new id each time it is called, for the blocks inside.
 */
function starterContents(kind: string, nextId: () => string): Block[] | undefined {
  switch (kind) {
    case "extrude":
      return [piece("rectangle", nextId(), {})];
    case "solid":
      // a square pyramid to start with: five vertices, and no faces, so it is
      // the convex solid around them
      return [
        {
          ...blankBlock("vertices", nextId()),
          inner: [["-10", "-10", "0"], ["10", "-10", "0"], ["10", "10", "0"], ["-10", "10", "0"], ["0", "0", "20"]].map(([x, y, z]) => piece("vertex", nextId(), { x, y, z })),
        },
        blankBlock("faces", nextId()),
      ];
    case "if":
      return [blankBlock("else", nextId())]; // an if starts with its else, empty
    case "revolve":
      return [piece("rectangle", nextId(), { u: "2", v: "0", w: "3", h: "10" })];
    case "loft":
      return [
        { ...blankBlock("bottom", nextId()), inner: [piece("rectangle", nextId(), { u: "-10", v: "-10", w: "20", h: "20" })] },
        { ...blankBlock("top", nextId()), inner: [piece("circle", nextId(), { u: "0", v: "0", r: "5" })] },
      ];
    case "sweep":
      return [
        piece("circle", nextId(), { u: "0", v: "0", r: "3" }),
        piece("vertex", nextId(), { x: "0", y: "0", z: "0" }),
        piece("vertex", nextId(), { x: "0", y: "0", z: "30" }),
        piece("vertex", nextId(), { x: "25", y: "0", z: "50" }),
      ];
    case "polygon":
      return [
        piece("point", nextId(), { u: "0", v: "0" }),
        piece("point", nextId(), { u: "10", v: "0" }),
        piece("point", nextId(), { u: "0", v: "10" }),
      ];
    default:
      return undefined;
  }
}

/**
 * A new block of this kind for dropping into `program`: a fresh id, and (for
 * sketches) a first piece inside it.
 */
export function newBlockFor(program: Program, kind: string): Block {
  const made: Block[] = [];
  const nextId = () => {
    const id = freshId(program, made);
    made.push({ id, kind, args: {} }); // remembered, so the next id is a different one
    return id;
  };
  const block = blankBlock(kind, nextId());
  const inner = starterContents(kind, nextId);
  if (inner) block.inner = inner;
  return block;
}
