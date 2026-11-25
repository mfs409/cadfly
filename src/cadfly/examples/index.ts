import { readExample } from "./read";
import type { Example, ExampleSpec } from "./types";
import * as basics from "./basics";
import * as joints from "./joints";
import * as sketches from "./sketches";
import * as solids from "./solids";

/**
 * The examples: programs to start from, each one a complete, working design
 * that shows one idea. They are written as block text in the files of this
 * folder, grouped by idea (basics, sketches, solids, joints), and read into
 * programs here. `EXAMPLES` lists them in the order they are offered: the ones
 * that use only the blocks of the first mode, then the others roughly from
 * simple to hard, and the joints last. The examples are frozen: a program that
 * is going to be changed has to be copied first.
 */

export type { Example } from "./types";

/** The ids of the examples in the order they are offered. */
const ORDER = [
  "step-stool",
  "pencil-pot",
  "snowman-with-a-hat",
  "bracket",
  "plate-with-holes",
  "row-of-holes",
  "ring-of-posts",
  "stairs",
  "wing",
  "align",
  "place-against",
  "cup",
  "washer",
  "open-box",
  "twisted-tower",
  "flat-plate",
  "rounded-plate",
  "valentine-heart",
  "star-outline",
  "gear",
  "name-plate",
  "etched-text",
  "raised-text",
  "pipe",
  "hollow-pipe",
  "hollow-vase",
  "raindrop",
  "post-and-base",
  "tray-and-lid",
  "table-with-legs",
  "tree",
  "pyramid",
  "round-heart",
  "house",
  "star",
  "dowel-joint",
  "magnet-pocket",
  "slot-and-tab",
  "finger-joint",
  "cross-lap-joint",
  "dovetail-slide",
  "snap-pin",
  "locking-tab",
  "t-slot-joint",
  "hinge",
  "swivel",
  "ball-joint",
  "ball-and-socket",
];

/** Every example as it is written, by id. */
const WRITTEN = new Map<string, ExampleSpec>(
  [...Object.values(basics), ...Object.values(sketches), ...Object.values(solids), ...Object.values(joints)].map((spec) => [spec.id, spec]),
);
if (WRITTEN.size !== ORDER.length || ORDER.some((id) => !WRITTEN.has(id))) throw new Error("the order of the examples and the examples written do not match");

/**
 * Freeze a value and everything inside it, so that nothing can change it.
 *
 * @param value What to freeze.
 * @returns The same value.
 */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** The examples, in the order they are offered. */
export const EXAMPLES: readonly Example[] = deepFreeze(ORDER.map((id) => readExample(WRITTEN.get(id)!)));

/**
 * The example with this id.
 *
 * @param id An example's id.
 * @returns The example, or undefined if there is none with that id.
 */
export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
