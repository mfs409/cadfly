import type { Category, Param } from "../types";
import { codeEntries } from "./entries/code";
import { shapesEntries } from "./entries/shapes";
import { sketchEntries } from "./entries/sketch";
import { placeEntries } from "./entries/place";
import { combineEntries } from "./entries/combine";
import { drawFlat, merged } from "./helpers";
import { commandById, blankBlock, blockWith, registerCommands } from "./lookup";
import type { CommandEntry, CommandDef } from "./types";

/**
 * Commands: the kinds of block a program can be made of.
 *
 * A command is one kind of block: its word, its fields (`params`), and what it
 * builds. `COMMANDS` lists them all, and is the one place that says what a
 * block is, so adding a command adds a block everywhere.
 *
 * The commands are defined in pieces that this file puts together: what a
 * command is, what commands share, the table of entries (one set for each
 * palette tab, with one entry for each command), and the lookup that the
 * helpers and entries use while they run. This file puts the entries in order
 * and turns each into a command for `COMMANDS` (`finished`: the color derived
 * from the category, the fields that stay quiet, the modifiers and the
 * sketches), and has the lookups `commandById`, and `blankBlock` and
 * `blockWith` for making blocks.
 */

/**
 * The color of the blocks that do something with variables (set, measure),
 * which are in the Code tab. The tab holds control blocks, `use` included, in
 * yellow, and its tab is the yellow.
 */
const VARIABLE_COLOR = "#e67e22";

/**
 * The commands whose color is not their category's, by id: the blocks about
 * variables
 */
const COLOR_OVERRIDES: Record<string, string> = Object.fromEntries(["set", "measure"].map((id) => [id, VARIABLE_COLOR]));

/** The color of the blocks of each category, which is also its tab's */
const CATEGORY_COLORS: Record<Category, string> = {
  code: "#d4a017",
  shapes: "#2f7fe0",
  sketch: "#8e44ad",
  place: "#2fb34a",
  combine: "#d9363e",
};

/**
 * The fields that are neutral at their default (no twist, no rounding, no
 * turn, no offset), which are left out of the program the model reads
 */
const NEUTRAL_FIELDS = ["twist", "taper", "corner", "rotate", "offset", "top"];

/** The shapes that sit at the origin unless told otherwise */
const AT_ORIGIN = ["box", "cylinder", "sphere", "import"];

/**
 * Is this field of this command left out of the program the model reads while
 * it has its default? (`Param.quiet`)
 */
function isQuiet(c: CommandEntry, p: Param): boolean {
  // a transform that does not move, turn or scale says nothing of it
  if (c.id === "transform") return true;
  // a shape at the origin says nothing of its position
  if (AT_ORIGIN.includes(c.id) && ["x", "y", "z"].includes(p.id)) return true;
  return NEUTRAL_FIELDS.includes(p.id);
}

/**
 * The blocks that change what is inside them (`modifier`): disabled, they do
 * nothing, and the shapes inside pass through (joined, as a union would).
 */
const MODIFIERS = ["transform", "mirror", "round", "fillet", "chamfer", "shell", "lineUp", "placeAgainst"];

/**
 * A table entry made into a command: its color filled in (the category's,
 * unless `COLOR_OVERRIDES` names the entry), its quiet fields marked, its `make`
 * wrapped if it is a modifier or made from its `sketch`. The entry is not
 * changed.
 */
function finished(c: CommandEntry): CommandDef {
  let make = c.make;
  // a block that draws a flat shape: its `sketch` says what outlines, and the
  // shape it builds is those, joined
  if (c.sketch) make = (env, a) => drawFlat(env, a.block, a);
  const modifier = MODIFIERS.includes(c.id);
  if (modifier) {
    // disabled, it does nothing and the shapes inside pass through
    const change = make!;
    make = (env, a, kids) => (a.block.disabled === true ? merged(env, a, kids) : change(env, a, kids));
  }
  return {
    ...c,
    color: COLOR_OVERRIDES[c.id] ?? CATEGORY_COLORS[c.category],
    params: c.params.map((p) => (isQuiet(c, p) ? { ...p, quiet: true } : p)),
    ...(modifier ? { modifier } : {}),
    ...(make ? { make } : {}),
  };
}

/**
 * The order of the commands: the order of the palette within each tab, and the
 * order the blocks are described to the model in. It is not grouped by tab
 * (the Code tab's `set` comes before the Shapes tab's `import`, and so on), so
 * the table is listed here, by id, instead of following the files.
 */
const ORDER = [
  "set",
  "import",
  "repeat",
  "if",
  "else",
  "use",
  "box",
  "cylinder",
  "sphere",
  "solid",
  "vertices",
  "faces",
  "vertex",
  "face",
  "rectangle",
  "circle",
  "text",
  "polygon",
  "point",
  "extrude",
  "revolve",
  "loft",
  "bottom",
  "top",
  "sweep",
  "transform",
  "mirror",
  "round",
  "fillet",
  "chamfer",
  "shell",
  "lineUp",
  "placeAgainst",
  "measure",
  "union",
  "subtract",
  "intersect",
];

/**
 * The entries of all the tabs, put in the order of `ORDER`. Throws an Error if
 * `ORDER` leaves out an entry, names one twice, or names one that is not there:
 * a command added to a tab's file must be added to `ORDER` too.
 */
function inOrder(entries: readonly CommandEntry[]): CommandEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  if (byId.size !== entries.length || ORDER.length !== byId.size || ORDER.some((id) => !byId.has(id))) {
    throw new Error("commands/index.ts: ORDER must list every command exactly once");
  }
  return ORDER.map((id) => byId.get(id)!);
}

/**
 * Every command: the entries of the five tabs, in order, each made
 * into a command
 */
export const COMMANDS: readonly CommandDef[] = inOrder([...codeEntries, ...shapesEntries, ...sketchEntries, ...placeEntries, ...combineEntries]).map(finished);
registerCommands(COMMANDS);

export { blankBlock, blockWith, commandById };
export { FLAT_SHAPES, MAX_BUILT_BLOCKS, POINT_HOLDERS, POINT_LIST_FLOW, SHAPES, canDisable, canHide } from "./types";
export type { CommandDef, CommandEntry } from "./types";
