import { COMMANDS, type CommandDef, commandById } from "./commands";
import type { Block, Param } from "./types";

/**
 * Modes: how much of the editor a person is shown. A mode says, for each kind
 * of block, whether the palette offers it and with how many of its fields, so
 * that a beginner sees a few blocks with a few fields and an experienced
 * person sees everything. A mode only changes what is offered and shown: it
 * never changes what a program builds, and it never hides what is already
 * there.
 */

/**
 * How much of the interface a block gets. `hidden`: not offered in the palette
 * (and not offered to the assistant). `partial`: offered, with only the fields
 * its `partial` list in commands.ts names. `full`: offered with every field.
 */
export type Exposure = "hidden" | "partial" | "full";

/**
 * A mode: an exposure for each kind of block, by id. A block not named is
 * hidden.
 */
export type ModeSpec = Readonly<Record<string, Exposure>>;

/**
 * The eye on a shape block (hides it, or shows it again), and the power switch
 * on a block that changes what is inside it, are listed in a mode like a block
 * is: a mode that does not list it has neither. A block that is hidden or
 * disabled always has its switch, so it can be turned back on.
 */
export const EYE = "eye";

/** Every block, fully exposed (and the eye) */
export const EVERYTHING: ModeSpec = { ...Object.fromEntries(COMMANDS.map((c) => [c.id, "full" as const])), [EYE]: "full" };

/**
 * Does a block show an eye? Only a block that makes a shape can be hidden.
 *
 * @param def The command the block is of.
 * @param mode The mode in use, if any.
 * @param block The block.
 */
export function showsEye(def: CommandDef, mode: ModeSpec | undefined, block: Block): boolean {
  return !!def.make && !def.piece && !def.observer && (block.hidden === true || exposure(mode, EYE) !== "hidden");
}

/**
 * Does a block show a power switch? Only a block that changes what is inside it
 * can be disabled (and the mode offers the eye's switches).
 *
 * @param def The command the block is of.
 * @param mode The mode in use, if any.
 * @param block The block.
 */
export function showsPower(def: CommandDef, mode: ModeSpec | undefined, block: Block): boolean {
  return def.modifier === true && (block.disabled === true || exposure(mode, EYE) !== "hidden");
}

/**
 * The same exposure listed for several kinds of block: `give("partial", "box",
 * "cylinder")` is `{ box: "partial", cylinder: "partial" }`
 */
function give(how: Exposure, ...kinds: string[]): ModeSpec {
  return Object.fromEntries(kinds.map((k) => [k, how]));
}

/**
 * The modes the editor offers, in this order, as (name, which blocks and how
 * much of each). The first is what a new visitor sees, unless the page says
 * otherwise (`?mode=Builder`). To add a mode, or change what one shows, change
 * this list: nothing else needs to know.
 */
export const UI_MODES: readonly (readonly [string, ModeSpec])[] = [
  [
    "First steps",
    { ...give("partial", "box", "cylinder", "sphere", "union", "subtract"), ...give("partial", "transform") },
  ],
  [
    "Starter",
    { ...give("full", "box", "cylinder", "sphere", "set"), ...give("full", "transform"), ...give("partial", "union", "subtract", "intersect"), ...give("full", EYE) },
  ],
  [
    "Builder",
    {
      ...give("full", "box", "cylinder", "sphere", "transform", "mirror", "set", "repeat", "if", "else", "define", "use", "round", "fillet", EYE),
      ...give("partial", "union", "subtract", "intersect", "rectangle", "circle", "polygon", "point", "text", "extrude", "revolve", "shell"),
    },
  ],
  ["Everything", EVERYTHING],
];

/** The name of the mode a new visitor sees: the first of `UI_MODES` */
export const DEFAULT_MODE_NAME = UI_MODES[0][0];

/** The mode with this name (in any case), if there is one */
export function modeByName(name: string): ModeSpec | undefined {
  const lower = name.trim().toLowerCase();
  return UI_MODES.find(([n]) => n.toLowerCase() === lower)?.[1];
}

/** How much of a kind of block a mode offers. With no mode, everything. */
export function exposure(mode: ModeSpec | undefined, kind: string): Exposure {
  return mode ? (mode[kind] ?? "hidden") : "full";
}

/**
 * Does a field hold something other than its default? (A field that does is
 * shown whatever the mode: a mode never hides what is there.)
 */
function changed(block: Block, p: Param) {
  const v = block.args[p.id];
  return v !== undefined && v !== p.default;
}

/**
 * The fields of a block to show. A fully exposed block shows all of them; a
 * partly exposed one shows the ones its `partial` list names, and a block of a
 * kind the mode hides (one that was loaded, or made in another mode) shows all,
 * so nothing is lost. In every case a field with a value that is not its
 * default is shown.
 *
 * @param def The command the block is of.
 * @param mode The mode in use, if any.
 * @param block The block, if there is one (a palette entry has none yet).
 */
export function shownParams(def: CommandDef, mode: ModeSpec | undefined, block?: Block): readonly Param[] {
  if (exposure(mode, def.id) !== "partial" || !def.partial || block?.expanded === true) return def.params;
  const wanted = new Set(def.partial);
  return def.params.filter((p) => wanted.has(p.id) || (block !== undefined && changed(block, p)));
}

/**
 * Does a block have a "more" chip? A partly exposed block does, when it has
 * fields its partial list leaves out and not all of them are showing already:
 * "more" shows them, and once they are showing the chip says "less". Fully
 * exposed blocks, and blocks of a kind the mode hides, have none.
 *
 * @param def The command the block is of.
 * @param mode The mode in use, if any.
 * @param block The block.
 */
export function moreChip(def: CommandDef, mode: ModeSpec | undefined, block: Block): "more" | "less" | undefined {
  if (exposure(mode, def.id) !== "partial" || !def.partial) return undefined;
  // a caption is not worth a chip: tapping the block's word adds one
  const left = def.params.filter((p) => p.type.kind !== "caption" && !def.partial!.includes(p.id));
  if (!left.length) return undefined;
  if (block.expanded === true) return "less";
  return left.every((p) => changed(block, p)) ? undefined : "more";
}

/**
 * May a new block, or a change to a field, use this? It is what the assistant
 * is held to: the blocks and fields the person can see.
 *
 * @param mode The mode in use, if any.
 * @param kind The kind of block.
 * @param field The id of the field.
 */
export function allowedField(mode: ModeSpec | undefined, kind: string, field: string): boolean {
  const how = exposure(mode, kind);
  if (how === "hidden") return false;
  const def = commandById(kind);
  // a caption is only a label for people: the assistant may always write one,
  // though the block does not offer to
  const caption = def?.params.find((p) => p.id === field)?.type.kind === "caption";
  return how === "full" || !def?.partial || def.partial.includes(field) || caption;
}

/** The kinds of block a mode offers, in the palette's order */
export function offeredKinds(mode: ModeSpec | undefined): string[] {
  return COMMANDS.filter((c) => exposure(mode, c.id) !== "hidden").map((c) => c.id);
}

/**
 * Every kind of block that a program (or list of blocks) uses which the mode
 * hides
 */
export function hiddenKindsUsed(blocks: Block[], mode: ModeSpec | undefined): string[] {
  const found = new Set<string>();
  const visit = (list: Block[]) =>
    list.forEach((b) => {
      if (exposure(mode, b.kind) === "hidden") found.add(b.kind);
      visit(b.inner ?? []);
    });
  visit(blocks);
  return [...found];
}
