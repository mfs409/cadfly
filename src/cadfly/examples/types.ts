import type { Program } from "../language/types";

/**
 * What an example is, and how one is written down. An example is written as
 * block text (the same text the assistant reads and writes), one piece of text
 * for each script, with `#` lines for the notes that explain it; a reader turns
 * that into the program.
 */

/** A program to start from: each one is a complete, working design. */
export interface Example {
  /** What names the example for good: lowercase words joined by dashes, which never changes even if its name does */
  id: string;
  /** What the example is called in the list of examples */
  name: string;
  /** What the example shows, in a sentence or two */
  description: string;
  /** The scripts of the example */
  program: Program;
}

/** One script of an example, as block text. */
export interface ScriptText {
  /** The script's name (none for a global script, `BUILD` for the one that builds) */
  name?: string;
  /** The names of its inputs, like "x, y" (none by default) */
  inputs?: string;
  /** Its blocks as block text: one block per line, blocks inside another indented under it, `#` for notes */
  text: string;
}

/** What every example is made of, whichever way its scripts are written. */
interface ExampleHeader {
  /** See `Example.id` */
  id: string;
  /** See `Example.name` */
  name: string;
  /** See `Example.description` */
  description: string;
}

/**
 * An example as it is written: the header, and either the block text of
 * `build` (when that is all there is) or the text of every script, in order.
 */
export type ExampleSpec = ExampleHeader & ({ build: string; scripts?: undefined } | { scripts: ScriptText[]; build?: undefined });
