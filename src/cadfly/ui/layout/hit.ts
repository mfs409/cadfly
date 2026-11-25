import type { Param } from "../../language/types";
import { grownRects, nearestReaching } from "./reach";
import type { BlockLayout, Part, ProgramLayout, Rect, ScriptLayout } from "./types";

/**
 * What is under a pointer: the buttons, chips, fields and frames that the
 * layout drew, found from the numbers of the layout alone. A button or field
 * smaller than a comfortable size to touch has a larger area to touch it by,
 * where there is room, so that a finger can find it.
 */

/**
 * What is under a pointer, as `hit` finds it. Every kind names the block
 * (`blockId`) or the script (`scriptId`), and the others say what else is
 * needed to act on it:
 * - `blockFold`, `eye`, `power`: a button of the block's header.
 * - `info`: the "?" of a block that reports on what is inside it, with where
 *   it is (to show what it found next to it).
 * - `button`: the block's own button, by its id.
 * - `scriptFold`: the +/- button of a script.
 * - `scriptName`, `scriptInputs`: the chips of a script's header, to edit,
 *   with where they are (to put the editor over them).
 * - `scriptRemove`: the button that removes a script.
 * - `scriptHeader`: the rest of a script's header, which takes hold of the
 *   whole script.
 * - `field`: a field to edit, with where it is (to put the editor over it).
 * - `flag`: a tick to turn over.
 * - `block`: the block, anywhere else on it, to pick it up or select it (and
 *   the strip of a folded script, which stands for its first block).
 */
export type Hit =
  | { kind: "blockFold"; blockId: string }
  | { kind: "eye"; blockId: string }
  | { kind: "power"; blockId: string }
  | { kind: "info"; blockId: string; rect: Rect }
  | { kind: "button"; blockId: string; id: string }
  | { kind: "scriptFold"; scriptId: string }
  | { kind: "scriptName"; scriptId: string; rect: Rect }
  | { kind: "scriptInputs"; scriptId: string; rect: Rect }
  | { kind: "scriptRemove"; scriptId: string }
  | { kind: "scriptHeader"; scriptId: string }
  | { kind: "field"; blockId: string; param: Param; rect: Rect }
  | { kind: "flag"; blockId: string; param: Param }
  | { kind: "block"; blockId: string };

/** Is the point (x, y) inside the rectangle (or on its edge)? */
export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * How a tap on each kind of part of a block's header is answered. A part with
 * no entry here is a field, a flag or a caption, which are answered by the
 * field they show (a word or label that shows none is not answered at all).
 */
const PART_HITS: Partial<Record<Part["kind"], (b: BlockLayout, part: Part) => Hit>> = {
  fold: (b) => ({ kind: "blockFold", blockId: b.block.id }),
  eye: (b) => ({ kind: "eye", blockId: b.block.id }),
  power: (b) => ({ kind: "power", blockId: b.block.id }),
  button: (b) => ({ kind: "button", blockId: b.block.id, id: b.def.button!.id }),
  info: (b, part) => ({ kind: "info", blockId: b.block.id, rect: part.rect }),
};

/**
 * How a part of a block's header is answered, if it is answered at all: a tap
 * on a button is that button, a tap on a field or flag is that field or flag,
 * and a word or label that shows none answers nothing.
 *
 * @param b The block's layout.
 * @param part One of its parts.
 */
function answerFor(b: BlockLayout, part: Part): Hit | undefined {
  const answer = PART_HITS[part.kind];
  if (answer) return answer(b, part);
  const param = part.param ?? part.captionParam;
  if (!param) return undefined;
  const blockId = b.block.id;
  return part.kind === "flag" ? { kind: "flag", blockId, param } : { kind: "field", blockId, param, rect: part.rect };
}

/**
 * What is under (x, y) in one block's header: one of its buttons, or a field or
 * flag; undefined if the point is on none of them. A part smaller than `min` is
 * also found a little beyond its drawing, within its row, where no other part
 * is.
 *
 * @param b The block's layout.
 * @param x Where the pointer is.
 * @param y Where the pointer is.
 * @param min The smallest size a thing to touch is given (meters; 0 for none).
 */
function hitPart(b: BlockLayout, x: number, y: number, min: number): Hit | undefined {
  for (const part of b.parts) {
    if (!rectContains(part.rect, x, y)) continue;
    const answer = answerFor(b, part);
    if (answer) return answer;
  }
  if (min <= 0 || !rectContains(reaching(b.bounds, min), x, y)) return undefined;
  // each part may grow within its own row, among the other parts of the row
  const rowOf = (p: Part) => b.rows.find((r) => rectContains(r, p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2)) ?? p.rect;
  const areas = grownRects(
    b.parts.map((p) => p.rect),
    b.parts.map(rowOf),
    min,
    b.parts.map((p) => answerFor(b, p) !== undefined),
  );
  return nearestReaching(
    b.parts.flatMap((p, i) => {
      const answer = answerFor(b, p);
      return answer ? [{ area: areas[i], answer }] : [];
    }),
    x,
    y,
  );
}

/** A rectangle with `by` more on every side: how near a point has to be to it to be worth looking closer */
const reaching = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });

/**
 * The buttons and chips of a script's header, in the order they are tried, with
 * what each answers.
 *
 * @param s The script's layout.
 */
function headerParts(s: ScriptLayout): { rect: Rect; answer: Hit }[] {
  const parts: { rect: Rect; answer: Hit }[] = [];
  if (s.button) parts.push({ rect: s.button, answer: { kind: "scriptFold", scriptId: s.scriptId } });
  if (s.kind === "editable") {
    parts.push({ rect: s.nameChip.rect, answer: { kind: "scriptName", scriptId: s.scriptId, rect: s.nameChip.rect } });
    parts.push({ rect: s.inputsChip.rect, answer: { kind: "scriptInputs", scriptId: s.scriptId, rect: s.inputsChip.rect } });
    parts.push({ rect: s.remove, answer: { kind: "scriptRemove", scriptId: s.scriptId } });
  }
  return parts;
}

/**
 * What is under (x, y) among a script's header buttons and chips, with the
 * ones smaller than `min` reaching beyond their drawing, within the header and
 * among the text of the header.
 *
 * @param s The script's layout.
 * @param x Where the pointer is.
 * @param y Where the pointer is.
 * @param min The smallest size a thing to touch is given (meters; 0 for none).
 */
function hitHeaderPart(s: ScriptLayout, x: number, y: number, min: number): Hit | undefined {
  const parts = headerParts(s);
  const exact = parts.find((p) => rectContains(p.rect, x, y));
  if (exact) return exact.answer;
  if (min <= 0 || !parts.length || !rectContains(reaching(s.header, min), x, y)) return undefined;
  const rects = [...parts.map((p) => p.rect), s.text.rect];
  // the text of the header takes room but is not touched
  const areas = grownRects(rects, rects.map(() => s.header), min, rects.map((_, i) => i < parts.length));
  return nearestReaching(
    parts.map((p, i) => ({ area: areas[i], answer: p.answer })),
    x,
    y,
  );
}

/**
 * What is at (x, y). The buttons and chips of a script's header are drawn over
 * the blocks, so they come first. Then the blocks, the one drawn last (on top)
 * first, and for each its buttons, fields and flags before its frame, so a
 * block that covers another is what answers. Last, the rest of a script's
 * header, and the strip of a folded script.
 *
 * Where a button or field is smaller than `min`, a point a little beyond it
 * (within its row, or its script's header, and clear of everything else there)
 * is answered by it, and a point on it is always answered by it. Parts are
 * only looked at in the order above, so a part never takes a point from a block
 * drawn over it.
 *
 * @param layout The layout of the program.
 * @param x Where the pointer is.
 * @param y Where the pointer is.
 * @param min The smallest size a thing to touch is given, in meters (default 0:
 *            things are as big as they are drawn).
 * @returns What is there, or undefined if the point is over nothing.
 */
export function hit(layout: ProgramLayout, x: number, y: number, min = 0): Hit | undefined {
  // the exact buttons of every header come before any grown one
  for (const s of layout.scripts) {
    const exact = headerParts(s).find((p) => rectContains(p.rect, x, y));
    if (exact) return exact.answer;
  }
  if (min > 0) {
    for (const s of layout.scripts) {
      const grown = hitHeaderPart(s, x, y, min);
      if (grown) return grown;
    }
  }
  // later blocks are drawn on top of earlier ones
  for (let i = layout.blocks.length - 1; i >= 0; i--) {
    const b = layout.blocks[i];
    const onPart = hitPart(b, x, y, min);
    if (onPart) return onPart;
    if ([...b.rows, b.spine, b.footer].some((r) => r && rectContains(r, x, y))) return { kind: "block", blockId: b.block.id };
  }
  for (const s of layout.scripts) {
    if (rectContains(s.header, x, y)) return { kind: "scriptHeader", scriptId: s.scriptId };
    if (s.firstId && s.strip && rectContains(s.strip, x, y)) return { kind: "block", blockId: s.firstId };
  }
  return undefined;
}
