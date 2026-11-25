import type { CommandDef } from "../../language/commands";
import type { Block, Param } from "../../language/types";
import { showsEye, showsPower } from "../modes";
import type { LayoutOptions, Measure, Metrics, Part, PartKind } from "./types";

/**
 * The header of one block, worked out in two steps: the tokens it is made of
 * (a word, labels, fields, buttons, each with its width), and the flow of those
 * tokens onto rows that wrap at the block's width.
 */

/** One piece of a header before it is placed: what it is, what it says, and how wide it is */
export interface Token {
  kind: PartKind;
  text: string;
  /** How wide the part is */
  w: number;
  param?: Param;
  captionParam?: Param;
}

/**
 * How tall each kind of part is, as a fraction of a row. Chips for fields and
 * ticks are a little shorter than the row, and the buttons a little shorter
 * still, so that a row of them has room around it.
 */
export const PART_HEIGHT: Record<PartKind, number> = {
  word: 1,
  label: 1,
  caption: 1,
  field: 0.78,
  flag: 0.78,
  fold: 0.7,
  eye: 0.7,
  power: 0.7,
  info: 0.7,
  number: 0.7,
  button: 0.7,
};

/** What the program's current values look like in a field */
function fieldText(block: Block, p: Param): string {
  const v = block.args[p.id] ?? p.default;
  return typeof v === "string" ? v : "";
}

/**
 * Text cut short, with an ellipsis, so that it is no wider than a limit. Text
 * that fits is returned as it is. The full text stays in the program: this is
 * only what is drawn.
 *
 * @param text The text.
 * @param maxWidth The widest it may be.
 * @param measure How wide text is.
 */
export function fitText(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text;
  // the longest start of the text that, with the ellipsis, still fits
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, mid)}…`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low)}…`;
}

/** What a header is made of, before it is placed */
export interface HeaderContent {
  /**
   * The tokens, in groups. A label always stays on the same row as its field,
   * so a header wraps between groups, never inside one.
   */
  groups: Token[][];
  /** Is the block folded, so that its header is only the fold button? */
  folded: boolean;
  /** The block's caption field, when its kind has one on show */
  captionParam?: Param;
  /** The caption's text without surrounding spaces; empty when there is none to show */
  captionText: string;
}

/**
 * The tokens of one block's header, in groups, in the order they are drawn: the
 * fold button, the word (with "base:" before it for the base of its parent and
 * a number after the button for a vertex), a group for each field,
 * then the chips and switches the block has.
 *
 * @param block The block.
 * @param def The command the block is an instance of.
 * @param opts The layout options: how text is measured and which mode is in use.
 * @param m The sizes to lay out with.
 * @param width How wide the block may be.
 * @param isBase Is it the base of its parent (labeled "base:")?
 * @param ordinal For a numbered block (a vertex), its place among the blocks of
 *                its kind in its list, counting from 1; otherwise 0.
 */
export function headerGroups(block: Block, def: CommandDef, opts: LayoutOptions, m: Metrics, width: number, isBase: boolean, ordinal: number): HeaderContent {
  const groups: Token[][] = [[{ kind: "word", text: def.word, w: opts.measure(def.word) }]];
  // the base of a subtract, align or place against says so, so it is clear
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
  const shown = folded ? [] : def.params;
  const captionParam = shown.find((p) => p.type.kind === "caption");
  // spaces alone are no caption
  const captionText = captionParam ? String(block.args[captionParam.id] ?? captionParam.default).trim() : "";
  for (const p of shown) {
    if (p.type.kind === "caption") continue;
    const group: Token[] = [];
    if (p.label) group.push({ kind: "label", text: p.label, w: opts.measure(p.label) });
    if (p.type.kind === "flag") {
      group.push({ kind: "flag", text: (block.args[p.id] ?? p.default) === true ? "✓" : "", w: m.rowH * PART_HEIGHT.flag, param: p });
    } else {
      // a value too long for the block is cut short so that its chip stays inside it
      const labelW = p.label ? opts.measure(p.label) + m.gap : 0;
      const maxChipW = Math.max(m.minChipW, width - 2 * m.padX - m.wrapIndent - labelW);
      const text = fitText(fieldText(block, p), maxChipW - 2 * m.chipPad, opts.measure);
      group.push({ kind: "field", text, w: Math.max(m.minChipW, opts.measure(text) + 2 * m.chipPad), param: p });
    }
    groups.push(group);
  }
  if (captionParam) groups.flat().find((t) => t.kind === "word")!.captionParam = captionParam;
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
  return { groups, folded, captionParam, captionText };
}

/** The parts of a header placed on rows, and how much room they took */
export interface Flow {
  /** The parts, in the order they were given, each placed on its row */
  parts: Part[];
  /** How many rows the header takes */
  rowCount: number;
  /** The width the widest row used, from the block's left edge */
  usedMax: number;
}

/**
 * Place groups of tokens left to right on rows. A group that does not fit on
 * what is left of a row starts a new one (but a row is never left empty); later
 * rows are indented.
 *
 * @param groups The tokens, in groups that are not split across rows.
 * @param x Where the block's left edge is.
 * @param y Where the top of the first row is.
 * @param width How wide the block may be.
 * @param m The sizes to lay out with.
 */
export function flowGroups(groups: Token[][], x: number, y: number, width: number, m: Metrics): Flow {
  const parts: Part[] = [];
  let cx = x + m.padX;
  let row = 0;
  let usedMax = 0;
  /** Where a row starts: wrapped rows are indented. */
  const rowStart = (r: number) => x + m.padX + (r > 0 ? m.wrapIndent : 0);
  for (const group of groups) {
    const total = group.reduce((sum, t) => sum + t.w, 0) + m.gap * (group.length - 1);
    // start a new row if the group does not fit (but never leave a row empty)
    if (cx + total > x + width - m.padX && cx > rowStart(row) + 1e-9) {
      row++;
      cx = rowStart(row);
    }
    for (const t of group) {
      const h = m.rowH * PART_HEIGHT[t.kind];
      parts.push({ kind: t.kind, rect: { x: cx, y: y + row * m.rowH + (m.rowH - h) / 2, w: t.w, h }, text: t.text, param: t.param, captionParam: t.captionParam });
      cx += t.w + m.gap;
      usedMax = Math.max(usedMax, cx - m.gap + m.padX - x);
    }
  }
  return { parts, rowCount: row + 1, usedMax };
}
