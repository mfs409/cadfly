import { accepts, stackRanges } from "./edit";
import { type CommandDef, commandById } from "./commands";
import { type ModeSpec, moreChip, shownParams, showsEye, showsPower } from "./modes";
import type { Block, Param, Program } from "./types";

/**
 * Where everything in a block program goes on the screen, worked out as plain
 * numbers (meters, y down). The editor only has to draw these and to ask
 * `hit()` what is under a pointer, so the layout can be tested with no screen.
 *
 * `layoutProgram` does the work. It gives a `ProgramLayout`: a `BlockLayout`
 * for every block (its header rows, the `Part`s on them, and for a C-shaped
 * block the bars around what is inside), a `StackLayout` for every stack of
 * several blocks, and the `AttachPoint`s where a dragged stack could go.
 * `acceptingPoints` and `nearestPoint` pick among those points, and `hit`
 * finds what is under a pointer.
 */

/** A rectangle: its top left corner, and its size */
export interface Rect {
  /** Left edge */
  x: number;
  /** Top edge (y points down) */
  y: number;
  /** Width */
  w: number;
  /** Height */
  h: number;
}

/** How wide a piece of text is, in the editor's block text size */
export type Measure = (text: string) => number;

/** The sizes the layout is made from, all in meters */
export interface Metrics {
  /** Height of one row of a block's header */
  rowH: number;
  /** Space at the left and right inside a header */
  padX: number;
  /** Space between the parts of a header */
  gap: number;
  /** Space added to each side of a field's text, inside its chip */
  chipPad: number;
  /** The narrowest a field chip gets */
  minChipW: number;
  /** How far blocks inside a block are moved to the right */
  indent: number;
  /** Height of the bar under a C-shaped block */
  footH: number;
  /** Height of the gap that shows a C-shaped block with nothing inside yet */
  emptyH: number;
  /** A wrapped header's later rows start this far in from the left */
  wrapIndent: number;
  /** Height of the caption line above a block that has one */
  captionH: number;
  /** Width of the small +/- button that folds a block that holds others */
  foldW: number;
  /** Height of the strip that a folded stack leaves */
  foldH: number;
  /** Height of the line above a stack of several blocks (with its button) */
  stackH: number;
}

/** The sizes the editor uses, unless it is given others */
export const DEFAULT_METRICS: Metrics = {
  rowH: 0.52,
  padX: 0.14,
  gap: 0.1,
  chipPad: 0.1,
  minChipW: 0.42,
  indent: 0.32,
  footH: 0.2,
  emptyH: 0.3,
  wrapIndent: 0.25,
  captionH: 0.34,
  foldW: 0.36,
  foldH: 0.3,
  stackH: 0.34,
};

/** One thing in a block's header: a word, a field, a button, and so on */
export interface Part {
  /**
   * What the part is, which decides how it is drawn and what a tap on it does:
   * the block's `word`; a `label` before a field; a `field` or a `flag` (tick);
   * the `caption` line above the block; the `fold` button; the `more` chip;
   * the `power` switch and the `eye`; the `info` "?" of a block that reports on
   * what is inside it; a vertex's `number`; a block's own `button`.
   */
  kind: "word" | "label" | "field" | "flag" | "caption" | "fold" | "more" | "power" | "eye" | "info" | "number" | "button";
  /** Text bounds for a word or label; the chip itself for a field or flag */
  rect: Rect;
  /**
   * What to draw: the text of a word or label or caption, the value in a field,
   * "✓" in a ticked flag
   */
  text: string;
  /** The field this part shows and edits: for a field, a flag or a caption */
  param?: Param;
  /**
   * For the word of a block that has a caption: the caption's field, which
   * tapping the word edits too (the word has no field of its own)
   */
  captionParam?: Param;
}

/** Where one block goes, and the parts of its header */
export interface BlockLayout {
  /** The block this is the layout of */
  block: Block;
  /** The command the block is an instance of */
  def: CommandDef;
  /** How many blocks it is inside of: 0 at the top of the program */
  depth: number;
  /** The header: one rectangle per row (a long header wraps onto more rows) */
  rows: Rect[];
  /** The words, fields and buttons of the header, in drawing order */
  parts: Part[];
  /** C-shaped blocks: the bar down the left side */
  spine?: Rect;
  /** C-shaped blocks: the bar underneath */
  footer?: Rect;
  /** C-shaped blocks: the gap that stands for "nothing inside yet" */
  empty?: Rect;
  /** Everything the block takes up, including what is inside it */
  bounds: Rect;
}

/** A place where a dragged stack of blocks could go */
export interface AttachPoint {
  /** The block it would go inside, or null for the top level of the program */
  parentId: string | null;
  /** Where in the parent's list (or in the program) the stack would start */
  index: number;
  /** Where the left edge of the first block of the stack would be */
  x: number;
  /** Where the top of the first block of the stack would be */
  y: number;
  /**
   * At the top of the program: this is above a stack, so what is dropped here
   * becomes the stack's first blocks. (The point at the same index, lower down,
   * is the end of the stack before.)
   */
  top?: boolean;
}

/**
 * The header of a stack of several blocks: a +/- button and a count, above the
 * first block
 */
export interface StackLayout {
  /** The first block of the stack: the one that holds its place and its fold */
  firstId: string;
  /** The whole line above the stack */
  header: Rect;
  /** The +/- button, at the left of the header */
  button: Rect;
  /**
   * What the header says next to the button: "3 blocks", or "2 more" when the
   * rest is folded away
   */
  label: string;
  /** Is the stack folded, so that only its first block shows */
  collapsed: boolean;
  /** How many blocks the stack has */
  count: number;
  /**
   * A folded stack: the thin strip under its first block that stands for the
   * others
   */
  strip?: Rect;
}

/** Where everything in a program goes */
export interface ProgramLayout {
  /**
   * Every block that is laid out, each one before the blocks inside it. (A
   * block inside a folded block is not laid out.)
   */
  blocks: BlockLayout[];
  /** One for each stack of two or more blocks, in the order they are stored */
  stacks: StackLayout[];
  /** Every place a dragged stack of blocks could go */
  attach: AttachPoint[];
  /** The lowest y that anything reaches */
  bottom: number;
}

/** What `layoutProgram` needs besides the program */
export interface LayoutOptions {
  /** Where the left edge of the program is */
  x: number;
  /** Where the top of the program is */
  y: number;
  /** How wide the blocks may be, before a header wraps onto another row */
  width: number;
  /** How wide text is */
  measure: Measure;
  /** The sizes to lay out with (default: `DEFAULT_METRICS`) */
  metrics?: Metrics;
  /**
   * How much of each block to show: fields a mode hides are left out (see
   * modes.ts)
   */
  mode?: ModeSpec;
}

/** What the program's current values look like in a field */
function fieldText(block: Block, p: Param): string {
  const v = block.args[p.id] ?? p.default;
  return typeof v === "string" ? v : "";
}

/**
 * Lay out a program (or any list of blocks) with its top left at (x, y),
 * `width` wide, with header text measured by `measure`.
 *
 * Top-level blocks are grouped into stacks (see `stackRanges`). Each stack is
 * placed where its first block's `at` says, relative to (x, y), and its blocks
 * go one under another. A stack of several blocks gets a header line above it.
 *
 * @param program The blocks to lay out.
 * @param opts Where, how wide, and how to measure text (see `LayoutOptions`).
 */
export function layoutProgram(program: Program, opts: LayoutOptions): ProgramLayout {
  const m = opts.metrics ?? DEFAULT_METRICS;
  const out: ProgramLayout = { blocks: [], stacks: [], attach: [], bottom: opts.y };

  /**
   * Lay out a list of blocks one under another, noting an attach point before
   * the first and after each. Gives the y below the last one and the furthest
   * right that anything reaches.
   *
   * @param blocks The blocks to lay out.
   * @param parentId The block they are inside of, or null at the top level.
   * @param x Where their left edge is.
   * @param y Where the top of the first one is.
   * @param width How wide they may be.
   * @param depth How many blocks they are inside of.
   * @param baseAt The position of the base among them (a subtract's first
   *               shape), which is labeled as such; -1 if there is none.
   * @param offset The index in the parent of the first block here, for the
   *               attach points (a stack at the top level does not start at 0).
   */
  function list(blocks: Block[], parentId: string | null, x: number, y: number, width: number, depth: number, baseAt = -1, offset = 0) {
    let right = x;
    out.attach.push({ parentId, index: offset, x, y, ...(parentId === null ? { top: true } : {}) });
    blocks.forEach((b, i) => {
      const placed = place(b, x, y, width, depth, i === baseAt, commandById(b.kind)?.numbered !== undefined ? blocks.slice(0, i + 1).filter((k) => k.kind === b.kind).length : 0);
      y = placed.bottom;
      right = Math.max(right, placed.right);
      out.attach.push({ parentId, index: offset + i + 1, x, y });
    });
    return { bottom: y, right };
  }

  /**
   * Lay out one block, and what is inside it. Adds its `BlockLayout` to the
   * result, and gives the y below it and the furthest right it reaches.
   *
   * @param block The block to lay out.
   * @param x Where its left edge is.
   * @param y Where its top is.
   * @param width How wide it may be.
   * @param depth How many blocks it is inside of.
   * @param isBase Is it the base of its parent (labeled "base:")?
   * @param ordinal For a numbered block (a vertex), its place among the blocks
   *                of its kind in its list, counting from 1; otherwise 0.
   */
  function place(block: Block, x: number, y: number, width: number, depth: number, isBase = false, ordinal = 0) {
    const def = commandById(block.kind);
    if (!def) throw new Error(`no such command: ${block.kind}`);

    // ---- the header, as a flow of words, labels and fields ----
    // A label always stays on the same row as its field, so the header
    // wraps between those groups, never inside one.
    type Token = { kind: Part["kind"]; text: string; w: number; param?: Param; captionParam?: Param };
    const groups: Token[][] = [[{ kind: "word", text: def.word, w: opts.measure(def.word) }]];
    // the base of a subtract, line up or place against says so, so it is clear
    // which shape is which
    if (isBase) groups[0].unshift({ kind: "label", text: "base:", w: opts.measure("base:") });
    // every block starts with a +/- button that folds it: a folded block is
    // just that button, so a big program can be made small
    const folded = block.collapsed === true;
    groups.unshift([{ kind: "fold", text: folded ? "+" : "−", w: m.foldW }]);
    // a numbered block (a vertex) shows its number after the button, since
    // faces refer to it by number
    if (def.numbered !== undefined && ordinal) {
      const label = `${def.numbered}${ordinal}`;
      groups[0].push({ kind: "number", text: label, w: Math.max(m.foldW, opts.measure(label) + m.chipPad) });
    }
    if (folded) groups.splice(1); // only the button
    // a block may carry a caption: a line above it, only when there is one.
    // Tapping the block's word adds or edits it, so an empty caption takes no
    // room at all.
    const shown = folded ? [] : shownParams(def, opts.mode, block);
    const captionParam = shown.find((p) => p.type.kind === "caption");
    // spaces alone are no caption
    const captionText = captionParam ? String(block.args[captionParam.id] ?? captionParam.default).trim() : "";
    const top = y;
    if (captionText) y += m.captionH;
    for (const p of shown) {
      if (p.type.kind === "caption") continue;
      const group: Token[] = [];
      if (p.label) group.push({ kind: "label", text: p.label, w: opts.measure(p.label) });
      if (p.type.kind === "flag") {
        group.push({ kind: "flag", text: (block.args[p.id] ?? p.default) === true ? "✓" : "", w: m.rowH * 0.78, param: p });
      } else {
        const text = fieldText(block, p);
        group.push({ kind: "field", text, w: Math.max(m.minChipW, opts.measure(text) + 2 * m.chipPad), param: p });
      }
      groups.push(group);
    }
    if (captionParam) groups.flat().find((t) => t.kind === "word")!.captionParam = captionParam;
    // a partly exposed block ends with a chip that shows (or hides again) the
    // fields it leaves out
    const more = folded ? undefined : moreChip(def, opts.mode, block);
    if (more) groups.push([{ kind: "more", text: more, w: opts.measure(more) + 2 * m.chipPad }]);
    // a block with a button (the faces of a solid: "hull") shows it while it
    // applies
    if (!folded && def.button?.when(block)) groups.push([{ kind: "button", text: def.button.label, w: opts.measure(def.button.label) + 2 * m.chipPad }]);
    // a block that reports on what is inside it (measure) ends with a "?" that
    // shows what it found
    if (def.observer && !folded) groups.push([{ kind: "info", text: "?", w: m.foldW }]);
    // a switch to turn off a block that changes what is inside it, and an eye
    // to hide the block (or show it again)
    if (!folded && showsPower(def, opts.mode, block)) groups.push([{ kind: "power", text: block.disabled === true ? "off" : "on", w: m.foldW }]);
    if (!folded && showsEye(def, opts.mode, block)) groups.push([{ kind: "eye", text: block.hidden === true ? "hidden" : "shown", w: m.foldW }]);

    const parts: Part[] = [];
    let cx = x + m.padX;
    let row = 0;
    let usedMax = 0;
    const rowStart = (r: number) => x + m.padX + (r > 0 ? m.wrapIndent : 0);
    for (const group of groups) {
      const total = group.reduce((sum, t) => sum + t.w, 0) + m.gap * (group.length - 1);
      // start a new row if the group does not fit (but never leave a row empty)
      if (cx + total > x + width - m.padX && cx > rowStart(row) + 1e-9) {
        row++;
        cx = rowStart(row);
      }
      for (const t of group) {
        const chip = t.kind === "field" || t.kind === "flag";
        const h = chip ? m.rowH * 0.78 : t.kind === "fold" || t.kind === "more" || t.kind === "eye" || t.kind === "power" || t.kind === "info" || t.kind === "number" || t.kind === "button" ? m.rowH * 0.7 : m.rowH;
        parts.push({ kind: t.kind, rect: { x: cx, y: y + row * m.rowH + (m.rowH - h) / 2, w: t.w, h }, text: t.text, param: t.param, captionParam: t.captionParam });
        cx += t.w + m.gap;
        usedMax = Math.max(usedMax, cx - m.gap + m.padX - x);
      }
    }
    if (captionText) parts.unshift({ kind: "caption", rect: { x: x + m.padX, y: top, w: Math.max(m.minChipW, opts.measure(captionText) + 2 * m.chipPad), h: m.captionH }, text: captionText, param: captionParam });
    const rowCount = row + 1;
    const rowW = folded ? usedMax : Math.min(width, Math.max(usedMax, 1.2));
    const rows = Array.from({ length: rowCount }, (_, r) => ({ x, y: y + r * m.rowH, w: rowW, h: m.rowH }));
    const headerBottom = y + rowCount * m.rowH;
    const layout: BlockLayout = { block, def, depth, rows, parts, bounds: { x, y: top, w: rowW, h: headerBottom - top } };
    out.blocks.push(layout);

    // ---- what is inside a C-shaped block ----
    let bottom = headerBottom;
    if (folded) {
      // just the button: nothing of what is inside is laid out, and nothing can
      // be dropped in
    } else if (def.inner) {
      const kids = block.inner ?? [];
      const baseAt = def.baseFirst ? kids.findIndex((k) => commandById(k.kind)?.make) : -1;
      const inner = list(kids, block.id, x + m.indent, headerBottom, width - m.indent, depth + 1, baseAt);
      const innerEnd = kids.length ? inner.bottom : headerBottom + m.emptyH;
      // as wide as the header, or as the widest thing inside, or as an empty
      // slot needs
      const fullW = Math.max(rowW, inner.right - x, kids.length ? 0 : m.indent + 0.6);
      if (!kids.length) layout.empty = { x: x + m.indent, y: headerBottom, w: fullW - m.indent, h: m.emptyH };
      layout.spine = { x, y: headerBottom, w: m.indent, h: innerEnd - headerBottom };
      layout.footer = { x, y: innerEnd, w: fullW, h: m.footH };
      bottom = innerEnd + m.footH;
      layout.bounds = { x, y: top, w: fullW, h: bottom - top };
    }
    out.bottom = Math.max(out.bottom, bottom);
    return { bottom, right: x + layout.bounds.w };
  }

  if (!program.length) out.attach.push({ parentId: null, index: 0, x: opts.x, y: opts.y, top: true });
  // the stacks at the top of the program, each where it floats (a stack with
  // no place is at the workspace's top left)
  for (const range of stackRanges(program)) {
    const first = program[range.start];
    const at = first.at ?? { x: 0, y: 0 };
    const x = opts.x + at.x;
    const y = opts.y + at.y;
    const blocks = program.slice(range.start, range.end);
    const folded = first.stackCollapsed === true && blocks.length > 1;
    const shown = folded ? blocks.slice(0, 1) : blocks;
    const inner = list(shown, null, x, y, Math.max(opts.width - at.x, 3), 0, -1, range.start);
    // nothing can be dropped on a hidden part
    if (folded) out.attach.splice(out.attach.findLastIndex((a) => a.index === range.start + 1 && a.parentId === null), 1);
    if (blocks.length > 1) {
      const label = folded ? `${blocks.length - 1} more` : `${blocks.length} blocks`;
      const header = { x, y: y - m.stackH - 0.03, w: m.foldW + m.gap + opts.measure(label) + 2 * m.padX, h: m.stackH };
      const stack: StackLayout = { firstId: first.id, header, button: { x: x, y: header.y + 0.02, w: m.foldW, h: m.stackH - 0.04 }, label, collapsed: folded, count: blocks.length };
      if (folded) {
        stack.strip = { x, y: inner.bottom + 0.04, w: Math.max(1.2, inner.right - x), h: m.foldH };
        out.bottom = Math.max(out.bottom, stack.strip.y + stack.strip.h);
      }
      out.stacks.push(stack);
    }
  }
  return out;
}

/**
 * Which attach points would take a stack whose blocks are of these kinds: the
 * ones where every kind is allowed (see `accepts`) inside the block that the
 * point is in.
 *
 * @param layout The layout whose points are to be chosen from.
 * @param program The program it is the layout of, to find what each point is
 *                inside.
 * @param kinds The kinds of the blocks of the dragged stack.
 */
export function acceptingPoints(layout: ProgramLayout, program: Program, kinds: string[]): AttachPoint[] {
  const parentKind = new Map<string, string>();
  const note = (bs: Block[]) => bs.forEach((b) => (parentKind.set(b.id, b.kind), note(b.inner ?? [])));
  note(program);
  return layout.attach.filter((a) => {
    const holder = a.parentId === null ? null : (parentKind.get(a.parentId) ?? "");
    return kinds.every((k) => accepts(holder, k));
  });
}

/**
 * The closest attach point to (x, y) within `maxDist`, if any
 *
 * @param points The points to choose from.
 * @param x Where the pointer is.
 * @param y Where the pointer is.
 * @param maxDist How far away a point may be and still count.
 */
export function nearestPoint(points: AttachPoint[], x: number, y: number, maxDist: number): AttachPoint | undefined {
  let best: AttachPoint | undefined;
  let bestDist = maxDist;
  for (const p of points) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}

/**
 * What is under a pointer, as `hit` finds it. Every kind names the block
 * (`blockId`), and the others say what else is needed to act on it:
 * - `fold`, `more`, `eye`, `power`: a button of the block's header.
 * - `info`: the "?" of a block that reports on what is inside it, with where
 *   it is (to show what it found next to it).
 * - `button`: the block's own button, by its id (see `CommandDef.button`).
 * - `stackFold`: the +/- button of a stack, by its first block.
 * - `field`: a field to edit, with where it is (to put the editor over it).
 * - `flag`: a tick to turn over.
 * - `block`: the block, anywhere else on it, to pick it up or select it.
 */
export type Hit =
  | { kind: "fold"; blockId: string }
  | { kind: "more"; blockId: string }
  | { kind: "eye"; blockId: string }
  | { kind: "power"; blockId: string }
  | { kind: "info"; blockId: string; rect: Rect }
  | { kind: "button"; blockId: string; id: string }
  | { kind: "stackFold"; blockId: string }
  | { kind: "field"; blockId: string; param: Param; rect: Rect }
  | { kind: "flag"; blockId: string; param: Param }
  | { kind: "block"; blockId: string };

/** Is the point (x, y) inside the rectangle (or on its edge)? */
export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * What is at (x, y): a field or flag if there is one, otherwise the block whose
 * header or frame it is
 *
 * @param layout The layout of the program.
 * @param x Where the pointer is.
 * @param y Where the pointer is.
 * @returns What is there, or undefined if the point is over nothing.
 */
export function hit(layout: ProgramLayout, x: number, y: number): Hit | undefined {
  for (const s of layout.stacks) {
    if (rectContains(s.button, x, y)) return { kind: "stackFold", blockId: s.firstId };
  }
  // later blocks are drawn on top of earlier ones
  for (let i = layout.blocks.length - 1; i >= 0; i--) {
    const b = layout.blocks[i];
    for (const part of b.parts) {
      if (part.kind === "fold" && rectContains(part.rect, x, y)) return { kind: "fold", blockId: b.block.id };
      if (part.kind === "more" && rectContains(part.rect, x, y)) return { kind: "more", blockId: b.block.id };
      if (part.kind === "eye" && rectContains(part.rect, x, y)) return { kind: "eye", blockId: b.block.id };
      if (part.kind === "power" && rectContains(part.rect, x, y)) return { kind: "power", blockId: b.block.id };
      if (part.kind === "button" && rectContains(part.rect, x, y)) return { kind: "button", blockId: b.block.id, id: b.def.button!.id };
      if (part.kind === "info" && rectContains(part.rect, x, y)) return { kind: "info", blockId: b.block.id, rect: part.rect };
      const param = part.param ?? part.captionParam;
      if (!param || !rectContains(part.rect, x, y)) continue;
      return part.kind === "flag" ? { kind: "flag", blockId: b.block.id, param } : { kind: "field", blockId: b.block.id, param, rect: part.rect };
    }
  }
  for (let i = layout.blocks.length - 1; i >= 0; i--) {
    const b = layout.blocks[i];
    if ([...b.rows, b.spine, b.footer].some((r) => r && rectContains(r, x, y))) return { kind: "block", blockId: b.block.id };
  }
  // the line above a stack takes hold of the whole stack, by its first block
  for (const s of layout.stacks) {
    if (rectContains(s.header, x, y) || (s.strip && rectContains(s.strip, x, y))) return { kind: "block", blockId: s.firstId };
  }
  return undefined;
}
