import type { Example } from "../examples/types";
import { addProgram } from "../language/edit";
import type { StlFiles } from "../language/files";
import type { Program } from "../language/types";
import { type ModeSpec, type UiMode, allowsScripts, hiddenKindsUsed } from "./modes";

/**
 * The cards for choosing a mode or an example, and the rule for adding an
 * example to a project. All of it is plain data and rules, so none of it needs
 * a page.
 */

/** One mode in the list of modes */
export interface ModeCard {
  /** The mode's name */
  name: string;
  /** What the mode offers */
  description: string;
  /** Is this the mode in force? */
  current: boolean;
}

/**
 * The modes as cards, in order, with the one in force marked.
 *
 * @param modes The modes that can be chosen.
 * @param current The name of the mode in force.
 */
export function modeCards(modes: readonly UiMode[], current: string): ModeCard[] {
  return modes.map((m) => ({ name: m.name, description: m.description, current: m.name === current }));
}

/** One example in the list of examples */
export interface ExampleCard {
  /** The example's id */
  id: string;
  /** What the example is called */
  name: string;
  /** What the example shows */
  description: string;
}

/**
 * The examples that a mode can show, in order: one that uses a block the mode
 * hides is left out (it is in the modes that have the block).
 *
 * @param examples Every example.
 * @param mode The mode in force.
 */
export function exampleCards(examples: readonly Example[], mode: ModeSpec | undefined): ExampleCard[] {
  return examples.filter((e) => !hiddenKindsUsed(e.program, mode).length).map((e) => ({ id: e.id, name: e.name, description: e.description }));
}

/** What adding an example came to: the new program and what to tell the person, or why it was refused */
export type AddOutcome = { program: Program; notice: string } | { refused: string };

/**
 * Add an example to a project, leaving the project as it is when that cannot be
 * done. Where the mode has no scripts, an example that is only a `build` has its
 * blocks added straight to the end of the project's `build`; otherwise it is
 * added as a script of its own, used at the end of `build`.
 *
 * @param program The project's blocks (not changed).
 * @param files The project's STL files.
 * @param example The example to add (not changed).
 * @param mode The mode in force.
 */
export function addExampleToProject(program: Program, files: StlFiles, example: Example, mode: ModeSpec | undefined): AddOutcome {
  try {
    const added = addProgram(program, example.program, { title: example.name, inline: !allowsScripts(mode), files });
    const where = added.scriptName ? ` Its blocks are in the script ${added.scriptName}, which build uses.` : "";
    return { program: added.program, notice: `Added the ${example.name} example. ${example.description}${where}` };
  } catch (e) {
    return { refused: `The ${example.name} example was not added: ${(e as Error).message}.` };
  }
}
