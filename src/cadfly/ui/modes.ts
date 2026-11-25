import { COMMANDS, type CommandDef, canDisable, canHide } from "../language/commands";
import { allBlocks, canStartScript } from "../language/program";
import type { Block, Program } from "../language/types";

/**
 * Modes: how much of the interface a person is shown. A mode says which kinds
 * of block the palette offers, so that a beginner sees a few blocks and an
 * experienced person sees everything. A block that is offered has all of its
 * fields. A mode only changes what is offered: it never changes what a program
 * builds, and it never hides what is already there.
 *
 * This is UI policy, not part of the language: it is about what is offered,
 * never about what a program means.
 */

/**
 * A mode: how much of each kind of block is offered, and whether the person
 * has the switches and scripts. The three are separate fields so that a kind
 * of block can never be mistaken for one of the other settings.
 */
export interface ModeSpec {
  /** The ids of the kinds of block the mode offers. A kind not listed is not offered. */
  readonly blocks: readonly string[];
  /**
   * Whether blocks have the eye (hides a shape, or shows it again) and the power
   * switch (turns off a block that changes what is inside it). One setting
   * governs both, so a mode cannot offer one without the other. A block that is
   * hidden or disabled always has its switch, so it can be turned back on.
   */
  readonly switches: boolean;
  /**
   * Whether scripts besides `build` (global scripts and named scripts) are a
   * thing: a mode that has them lets you make them, and a mode that does not
   * has only `build`, where the blocks connect to one another and dropping blocks
   * in empty space is refused. "Lets you make them" means "+ new script" is
   * offered in the palette, a named script's name and inputs are shown as chips
   * to edit, with a button to remove it, a script can be moved by its header,
   * and a `set` block dropped in empty space becomes a new global script. A
   * program that has other scripts still shows and runs them in any mode, as
   * text headers.
   */
  readonly scripts: boolean;
}

/** Every block, with the switches and scripts */
export const EVERYTHING: ModeSpec = { blocks: COMMANDS.map((c) => c.id), switches: true, scripts: true };

/**
 * Does this mode let you make scripts besides `build`? With no mode, yes.
 *
 * @param mode The mode in use, if any.
 */
export function allowsScripts(mode: ModeSpec | undefined): boolean {
  return mode ? mode.scripts : true;
}

/**
 * Does this mode have the eye and the power switch? With no mode, yes.
 *
 * @param mode The mode in use, if any.
 */
function offersSwitches(mode: ModeSpec | undefined): boolean {
  return mode ? mode.switches : true;
}

/**
 * May blocks that were carried be dropped in empty space? That starts a new
 * global script, so it is allowed only in a mode that has scripts, and only for
 * `set` blocks. Anywhere else the blocks go back to
 * where they came from.
 *
 * @param mode The mode in use, if any.
 * @param blocks The blocks that are being carried.
 */
export function canDropFree(mode: ModeSpec | undefined, blocks: Block[]): boolean {
  return allowsScripts(mode) && canStartScript(blocks);
}

/**
 * Does a block show an eye? Only a block of a kind that makes a shape of its
 * own does, and a block that is hidden always has its eye, so that it can be
 * shown again.
 *
 * @param def The command the block is of.
 * @param mode The mode in use, if any.
 * @param block The block.
 */
export function showsEye(def: CommandDef, mode: ModeSpec | undefined, block: Block): boolean {
  return canHide(def) && (block.hidden === true || offersSwitches(mode));
}

/**
 * Does a block show a power switch? Only a block that changes what is inside it
 * can be disabled (and the mode offers the switches).
 *
 * @param def The command the block is of.
 * @param mode The mode in use, if any.
 * @param block The block.
 */
export function showsPower(def: CommandDef, mode: ModeSpec | undefined, block: Block): boolean {
  return canDisable(def) && (block.disabled === true || offersSwitches(mode));
}

/** A mode that can be chosen: its name, and which blocks it offers */
export interface UiMode {
  /** What the mode is called */
  name: string;
  /** What the mode offers, in a sentence, for a person choosing */
  description: string;
  /** Which blocks the mode offers, and whether it has the switches and scripts */
  spec: ModeSpec;
}

/**
 * The modes that can be chosen, in this order. The first is what a new visitor
 * sees, unless the page says otherwise (`?mode=Builder`). To add a mode, or
 * change what one shows, change this list: nothing else needs to know.
 */
export const UI_MODES: readonly UiMode[] = [
  {
    name: "First steps",
    description: "A few basic shapes, joined with union and subtract and moved with transform. The blocks connect in one column.",
    spec: { blocks: ["box", "cylinder", "sphere", "union", "subtract", "transform"], switches: false, scripts: false },
  },
  {
    name: "Starter",
    description: "Adds variables, intersect, and the eye and power switches.",
    spec: { blocks: ["box", "cylinder", "sphere", "set", "transform", "union", "subtract", "intersect"], switches: true, scripts: false },
  },
  {
    name: "Builder",
    description: "Repeats and conditions, sketches and extrusions, mirror, rounding and fillets, and scripts of your own.",
    spec: {
      blocks: [
        "box", "cylinder", "sphere", "transform", "mirror", "set", "repeat", "if", "else", "use", "round", "fillet",
        "union", "subtract", "intersect", "rectangle", "circle", "polygon", "point", "text", "extrude", "revolve", "shell",
      ],
      switches: true,
      scripts: true,
    },
  },
  { name: "Everything", description: "Every block, with every field.", spec: EVERYTHING },
];

/** The name of the mode a new visitor sees: the first of `UI_MODES` */
export const DEFAULT_MODE_NAME = UI_MODES[0].name;

/**
 * The name, as `UI_MODES` spells it, of the mode that this text names (in any
 * case, with spaces at either end allowed), or undefined if it names none.
 *
 * @param text What was written, such as the value of `?mode=`.
 */
export function findModeName(text: string): string | undefined {
  const lower = text.trim().toLowerCase();
  return UI_MODES.find((m) => m.name.toLowerCase() === lower)?.name;
}

/** The mode with this name (in any case), if there is one */
export function modeByName(name: string): ModeSpec | undefined {
  const found = findModeName(name);
  return found === undefined ? undefined : UI_MODES.find((m) => m.name === found)?.spec;
}

/** Does the mode offer this kind of block? With no mode, every kind is offered. */
export function offers(mode: ModeSpec | undefined, kind: string): boolean {
  return mode ? mode.blocks.includes(kind) : true;
}

/** The kinds of block a mode offers, in the palette's order */
export function offeredKinds(mode: ModeSpec | undefined): string[] {
  return COMMANDS.filter((c) => offers(mode, c.id)).map((c) => c.id);
}

/**
 * The kinds of block that a program uses and the mode does not offer: they
 * stay in the program, so the person can be told that the mode does not offer
 * them.
 *
 * @param program The program.
 * @param mode The mode in use, if any.
 */
export function hiddenKindsUsed(program: Program, mode: ModeSpec | undefined): string[] {
  return [...new Set(allBlocks(program).filter((b) => !offers(mode, b.kind)).map((b) => b.kind))];
}
