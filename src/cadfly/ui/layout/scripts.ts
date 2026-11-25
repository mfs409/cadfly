import { BUILD, type Script } from "../../language/types";
import type { LayoutOptions, Metrics, Rect, ScriptLayout } from "./types";
import { allowsScripts } from "../modes";

/**
 * The line above a script: where its +/- button, name, chips, count and remove
 * button go. A header's text is one of "global", the script's name, or the name
 * with its inputs, followed by how many blocks the script has.
 */

/**
 * The words a script header says: the script's name and inputs (nothing when
 * the program has only one script, which needs no name), then how many blocks
 * it has, or how many are folded away.
 *
 * @param script The script.
 * @param several Does the program have more than one script?
 * @param folded Is the script folded?
 */
function headerLabel(script: Script, several: boolean, folded: boolean): { label: string; count: string } {
  const named = several ? (script.name === undefined ? "global" : script.name === BUILD || !script.inputs ? script.name : `${script.name}(${script.inputs})`) : "";
  const count = script.blocks.length > 1 ? (folded ? `${script.blocks.length - 1} more` : `${script.blocks.length} blocks`) : "";
  return { label: [named, count].filter(Boolean).join(" · "), count };
}

/**
 * Does a script get a header at all? A script of several blocks does, and so
 * does every script when the program has more than one, to say which is which.
 *
 * @param script The script.
 * @param several Does the program have more than one script?
 */
export function hasHeader(script: Script, several: boolean): boolean {
  return script.blocks.length > 1 || several;
}

/**
 * Lay out the header of a script (without the strip a folded script leaves,
 * which depends on where its blocks end). A named script other than `build`
 * has its name and inputs as chips, and a button to remove it, where the mode
 * has scripts; any other header is text only.
 *
 * @param script The script.
 * @param several Does the program have more than one script?
 * @param folded Is the script folded, so that only its first block shows?
 * @param x Where the script's left edge is.
 * @param y Where its first block's top is: the header goes above it.
 * @param opts The layout options: how text is measured and which mode is in use.
 * @param m The sizes to lay out with.
 * @returns The header, with the position the first block is at relative to the
 *          program's top left filled in from `x` and `y`.
 */
export function layoutScriptHeader(script: Script, several: boolean, folded: boolean, x: number, y: number, opts: LayoutOptions, m: Metrics): ScriptLayout {
  const { label, count } = headerLabel(script, several, folded);
  const button = script.blocks.length > 1;
  // a named script (not build) has its name and inputs as chips, and a button to remove it, where scripts are a thing the mode has
  const editable = several && allowsScripts(opts.mode) && script.name !== undefined && script.name !== BUILD;
  const top = y - m.scriptHeaderH - 0.03;
  const chipH = m.scriptHeaderH - 0.04;
  const chipY = top + 0.02;
  const left = button ? m.foldW + m.gap : 0;
  const common = {
    scriptId: script.id,
    ...(script.blocks.length ? { firstId: script.blocks[0].id } : {}),
    blocksAt: { x: x - opts.x, y: y - opts.y },
  };
  const buttonRect: { button?: Rect } = button ? { button: { x: x, y: chipY, w: m.foldW, h: chipH } } : {};
  const tail = { collapsed: folded, count: script.blocks.length };
  if (editable) {
    let cx = x + left;
    /** A chip as wide as its text, with room at either side, at the current x. */
    const chip = (s: string) => ({ rect: { x: cx, y: chipY, w: Math.max(m.minChipW, opts.measure(s) + 2 * m.chipPad), h: chipH }, text: s });
    const nameChip = chip(script.name!);
    cx += nameChip.rect.w + m.gap;
    const inputsChip = chip(script.inputs ? `(${script.inputs})` : "( )");
    cx += inputsChip.rect.w + m.gap;
    let text: ScriptLayout["text"];
    if (count) {
      text = { rect: { x: cx, y: top, w: opts.measure(count) + m.gap, h: m.scriptHeaderH }, text: count };
      cx += text.rect.w;
    } else text = { rect: { x: cx, y: top, w: 0, h: m.scriptHeaderH }, text: "" };
    const remove = { x: cx, y: chipY, w: m.foldW, h: chipH };
    cx += m.foldW;
    const header = { x, y: top, w: cx - x + m.padX, h: m.scriptHeaderH };
    return { kind: "editable", ...common, header, ...buttonRect, label, text, nameChip, inputsChip, remove, ...tail };
  }
  const header = { x, y: top, w: left + opts.measure(label) + 2 * m.padX, h: m.scriptHeaderH };
  const textLeft = button ? m.foldW + 0.08 : 0;
  const text = { rect: { x: x + textLeft, y: top, w: header.w - textLeft, h: m.scriptHeaderH }, text: label };
  return { kind: "plain", ...common, header, ...buttonRect, label, text, ...tail };
}
