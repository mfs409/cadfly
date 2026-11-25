import { accepts, acceptsInScript, pointLists } from "../../language/program";
import type { Block, Program, Script } from "../../language/types";
import type { DropPoint, ProgramLayout } from "./types";

/**
 * Choosing among the drop points of a layout: the ones that would take the
 * blocks being dragged, and the one nearest the pointer.
 */

/** What is looked up about a program for every drop point: the kind of each block, whether the blocks inside a block are a list of points, and each script by id */
interface Lookup {
  /** The kind of every block, by id */
  kinds: Map<string, string>;
  /** For every block that holds blocks, the point holder whose list of points they are, if they are one */
  lists: Map<string, string | null>;
  /** Every script, by id */
  scripts: Map<string, Script>;
}

/**
 * The lookups for programs seen so far. A program is never changed in place (an
 * edit makes a new one), so what was worked out for it stays right, and a drag,
 * which asks again at every pointer movement, does the work once.
 */
const lookups = new WeakMap<Program, Lookup>();

/**
 * The lookup tables of a program, made the first time a program is asked about.
 *
 * @param program The program.
 */
function lookupFor(program: Program): Lookup {
  let found = lookups.get(program);
  if (!found) {
    const kinds = new Map<string, string>();
    /** Remember the kind of every block, and of those inside it. */
    const note = (bs: Block[]) => bs.forEach((b) => (kinds.set(b.id, b.kind), note(b.inner ?? [])));
    note(program.flatMap((s) => s.blocks));
    found = { kinds, lists: pointLists(program), scripts: new Map(program.map((s) => [s.id, s])) };
    lookups.set(program, found);
  }
  return found;
}

/**
 * Which drop points would take blocks of these kinds: the ones where every
 * kind is allowed in the place that the point is in (inside a holder, what that
 * holder may hold; directly in a script, what that script may hold).
 *
 * @param layout The layout whose points are to be chosen from.
 * @param program The program it is the layout of, to find what each point is
 *                inside.
 * @param kinds The kinds of the blocks being dragged.
 */
export function acceptingPoints(layout: ProgramLayout, program: Program, kinds: string[]): DropPoint[] {
  const { kinds: parentKind, lists, scripts } = lookupFor(program);
  return layout.dropPoints.filter((a) => {
    if ("parentId" in a) return kinds.every((k) => accepts(parentKind.get(a.parentId) ?? "", k, lists.get(a.parentId) ?? null));
    const script = scripts.get(a.scriptId);
    return !!script && kinds.every((k) => acceptsInScript(script, k));
  });
}

/**
 * The closest drop point to (x, y) within `maxDist`, if any
 *
 * @param points The points to choose from.
 * @param x Where the pointer is.
 * @param y Where the pointer is.
 * @param maxDist How far away a point may be and still count.
 */
export function nearestPoint(points: DropPoint[], x: number, y: number, maxDist: number): DropPoint | undefined {
  let best: DropPoint | undefined;
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
