/**
 * The commands of the Combine tab: union, subtract and intersect.
 *
 * Each entry is the whole definition of one block, as a `CommandDef`.
 */

import type { Solid } from "../../../geometry/kernel";
import { ProgramError } from "../../env";
import { type FlatPiece, isFlat } from "../../types";
import { caption, singlePiece, merged, baseAndRest } from "../helpers";
import { SHAPES } from "../types";
import type { CommandEntry } from "../types";
import { commandById } from "../lookup";

/**
 * The commands of the Combine tab, in the order of the palette within the
 * tab.
 */
export const combineEntries: readonly CommandEntry[] = [
  /** Merges the shapes inside into one */
  {
    id: "union",
    hint: "merges the shapes inside into one",
    plain: true,
    short: "merges the shapes inside",
    word: "union",
    category: "combine",
    params: [caption("name")],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => merged(env, a, kids),
  },
  /**
   * Cuts every shape after the first out of the first. The
   * shapes must all be flat or all 3D, and a flat shape that is cut away
   * completely is an error.
   */
  {
    id: "subtract",
    hint: "cuts every shape after the first out of the first",
    short: "cuts every shape after the first out of the first",
    word: "subtract",
    category: "combine",
    params: [caption("name")],
    inner: SHAPES,
    buildsInner: true,
    baseFirst: true,
    make: (env, a, kids) => {
      const pair = baseAndRest(env, a, kids, "cut out of it", "nothing");
      if ("done" in pair) return pair.done;
      const { base, rest } = pair;
      const cutter = merged(env, a, rest);
      if (isFlat(base) !== isFlat(cutter)) throw new ProgramError(a.block.id, "a flat shape can only be cut from a flat shape, and a 3D shape from a 3D shape");
      if (isFlat(base) && isFlat(cutter)) {
        const left = env.kernel.flatSubtract(base.flat, cutter.flat);
        if (left.isEmpty()) throw new ProgramError(a.block.id, "what is cut out leaves nothing");
        return singlePiece(left);
      }
      return env.kernel.subtract(base as Solid, cutter as Solid);
    },
  },
  /**
   * Keeps only where the shapes inside overlap: at least two, all flat or all
   * 3D. With an eye shut on one of them it carries on with the one left.
   */
  {
    id: "intersect",
    hint: "keeps only where the shapes inside overlap",
    plain: true,
    short: "keeps only where the shapes inside overlap",
    word: "intersect",
    category: "combine",
    params: [caption("name")],
    inner: SHAPES,
    buildsInner: true,
    make: (env, a, kids) => {
      if (kids.length < 2) {
        // an eye is shut on one of them
        if ((a.block.inner ?? []).some((k) => k.hidden === true && commandById(k.kind)?.make)) return kids[0] ?? null;
        throw new ProgramError(a.block.id, "put at least two shapes inside");
      }
      if (kids.some(isFlat) !== kids.every(isFlat)) throw new ProgramError(a.block.id, "this block holds both flat shapes and 3D shapes: extrude the flat ones first");
      const k = env.kernel;
      if (isFlat(kids[0])) return singlePiece((kids as FlatPiece[]).map((f) => f.flat).reduce((x, y) => k.flatIntersect(x, y)));
      return (kids as Solid[]).reduce((x, y) => k.intersect(x, y));
    },
  },
];
