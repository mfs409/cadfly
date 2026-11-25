import { POINT_LIST_FLOW, commandById } from "../../language/commands";
import type { ListPoint } from "../../language/program";
import type { Block, Program } from "../../language/types";
import { flowGroups, headerGroups } from "./header";
import { hasHeader, layoutScriptHeader } from "./scripts";
import type { BlockLayout, LayoutOptions, Metrics, ProgramLayout, ScriptLayout } from "./types";
import { DEFAULT_METRICS } from "./types";

/**
 * The layout of a whole program: each script where it floats, its blocks one
 * under another, a block that holds others as a C around them, and a drop
 * point before and after every block.
 */

/** What laying out a program carries along: the options and sizes, and the result being built */
interface Context {
  opts: LayoutOptions;
  m: Metrics;
  out: ProgramLayout;
}

/** The list place for a list of blocks inside `parentId`, or in the script `scriptId` if that is null */
function listPoint(parentId: string | null, scriptId: string, index: number): ListPoint {
  return parentId !== null ? { parentId, index } : { scriptId, index };
}

/**
 * Lay out a list of blocks one under another, noting a drop point before the
 * first and after each. Gives the y below the last one and the furthest right
 * that anything reaches.
 *
 * @param ctx The layout being built.
 * @param blocks The blocks to lay out.
 * @param parentId The block they are inside of, or null at the top of a script.
 * @param scriptId The id of the script they are in, for the drop points.
 * @param x Where their left edge is.
 * @param y Where the top of the first one is.
 * @param width How wide they may be.
 * @param depth How many blocks they are inside of.
 * @param baseAt The position of the base among them (a subtract's first shape),
 *               which is labeled as such; -1 if there is none.
 * @param numbering Do numbered blocks (a vertex) show their place in the list as
 *                  their number? Not inside a repeat or if, nor beside one,
 *                  because it can make several points from one block.
 */
function layoutList(ctx: Context, blocks: Block[], parentId: string | null, scriptId: string, x: number, y: number, width: number, depth: number, baseAt = -1, numbering = true) {
  let right = x;
  ctx.out.dropPoints.push({ ...listPoint(parentId, scriptId, 0), x, y });
  // where a repeat or if makes some of the points, a block's place in the list is not its number
  const numbered = numbering && !blocks.some((k) => k.kind === "repeat" || k.kind === "if");
  blocks.forEach((b, i) => {
    const ordinal = numbered && commandById(b.kind)?.numbered !== undefined ? blocks.slice(0, i + 1).filter((k) => k.kind === b.kind).length : 0;
    const placed = layoutBlock(ctx, b, scriptId, x, y, width, depth, i === baseAt, ordinal);
    y = placed.bottom;
    right = Math.max(right, placed.right);
    ctx.out.dropPoints.push({ ...listPoint(parentId, scriptId, i + 1), x, y });
  });
  return { bottom: y, right };
}

/**
 * Lay out one block, and what is inside it. Adds its `BlockLayout` to the
 * result, and gives the y below it and the furthest right it reaches.
 *
 * @param ctx The layout being built.
 * @param block The block to lay out.
 * @param scriptId The id of the script it is in.
 * @param x Where its left edge is.
 * @param y Where its top is.
 * @param width How wide it may be.
 * @param depth How many blocks it is inside of.
 * @param isBase Is it the base of its parent (labeled "base:")?
 * @param ordinal For a numbered block (a vertex), its place among the blocks of
 *                its kind in its list, counting from 1; otherwise 0.
 */
function layoutBlock(ctx: Context, block: Block, scriptId: string, x: number, y: number, width: number, depth: number, isBase: boolean, ordinal: number) {
  const { opts, m, out } = ctx;
  const def = commandById(block.kind);
  if (!def) throw new Error(`no such command: ${block.kind}`);

  const { groups, folded, captionParam, captionText } = headerGroups(block, def, opts, m, width, isBase, ordinal);
  const top = y;
  if (captionText) y += m.captionH;
  const { parts, rowCount, usedMax } = flowGroups(groups, x, y, width, m);
  if (captionText) parts.unshift({ kind: "caption", rect: { x: x + m.padX, y: top, w: Math.max(m.minChipW, opts.measure(captionText) + 2 * m.chipPad), h: m.captionH }, text: captionText, param: captionParam });
  const rowW = folded ? usedMax : Math.min(width, Math.max(usedMax, 1.2));
  const rows = Array.from({ length: rowCount }, (_, r) => ({ x, y: y + r * m.rowH, w: rowW, h: m.rowH }));
  const headerBottom = y + rowCount * m.rowH;
  const layout: BlockLayout = { block, def, depth, rows, parts, bounds: { x, y: top, w: rowW, h: headerBottom - top } };
  out.blocks.push(layout);
  out.top = Math.min(out.top, top);

  // ---- what is inside a C-shaped block ----
  let bottom = headerBottom;
  if (folded) {
    // just the button: nothing of what is inside is laid out, and nothing can
    // be dropped in
  } else if (def.inner) {
    const kids = block.inner ?? [];
    const baseAt = def.baseFirst ? kids.findIndex((k) => commandById(k.kind)?.make) : -1;
    const inner = layoutList(ctx, kids, block.id, scriptId, x + m.indent, headerBottom, width - m.indent, depth + 1, baseAt, !POINT_LIST_FLOW.includes(block.kind));
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

/**
 * Lay out a program with its first script's blocks starting at (x, y), `width`
 * wide, with header text measured by `measure`.
 *
 * Each script is placed where its `at` says, relative to (x, y) (a script with
 * no `at` goes below the script before it in the list), and its blocks go one
 * under another. A script of several blocks gets a header line above it, and so
 * does every script when the program has more than one, to say which is which.
 * A header is above its script's first block, so the layout reaches above y:
 * `top` says how far.
 *
 * @param program The scripts to lay out.
 * @param opts Where, how wide, and how to measure text.
 */
export function layoutProgram(program: Program, opts: LayoutOptions): ProgramLayout {
  const m = opts.metrics ?? DEFAULT_METRICS;
  const out: ProgramLayout = { blocks: [], scripts: [], dropPoints: [], top: opts.y, bottom: opts.y };
  const ctx: Context = { opts, m, out };

  // the scripts, each where it floats (one with no place is below the script
  // before it, the first at the workspace's top left)
  const several = program.length > 1;
  let below = 0;
  program.forEach((script, n) => {
    const at = script.at ?? { x: 0, y: n === 0 ? 0 : below + m.scriptHeaderH + 0.4 };
    const x = opts.x + at.x;
    const y = opts.y + at.y;
    const folded = script.collapsed === true && script.blocks.length > 1;
    const shown = folded ? script.blocks.slice(0, 1) : script.blocks;
    const inner = layoutList(ctx, shown, null, script.id, x, y, Math.max(opts.width - at.x, 3), 0);
    // nothing can be dropped on a hidden part
    if (folded) out.dropPoints.splice(out.dropPoints.findLastIndex((a) => "scriptId" in a && a.scriptId === script.id && a.index === 1), 1);
    below = inner.bottom - opts.y;
    if (!hasHeader(script, several)) return;
    const layout: ScriptLayout = layoutScriptHeader(script, several, folded, x, y, opts, m);
    out.top = Math.min(out.top, layout.header.y);
    if (folded) {
      layout.strip = { x, y: inner.bottom + 0.04, w: Math.max(1.2, inner.right - x), h: m.foldH };
      out.bottom = Math.max(out.bottom, layout.strip.y + layout.strip.h);
      below = layout.strip.y + layout.strip.h - opts.y;
    }
    out.scripts.push(layout);
  });
  return out;
}
