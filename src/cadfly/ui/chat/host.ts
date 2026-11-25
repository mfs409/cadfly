import type { Checker } from "../../assistant/assistant";
import type { StlFiles } from "../../language/files";
import type { Problem, Program } from "../../language/types";
import type { LocalModel } from "../../llm";
import type { ModeSpec } from "../modes";

/**
 * What the chat needs to know from the page it is in and may do to it, and
 * what it gives back.
 */

/** What the chat needs to know from its host, and what it may do to it */
export interface ChatHost {
  model: LocalModel;
  program(): Program;
  problem(): Problem | undefined;
  /** Builds a program to see whether it works, once the 3D engine has loaded */
  checker(): Checker | undefined;
  /** The STL files the project has */
  files(): StlFiles;
  /** How much of each block the person is offered: the assistant may add only those */
  uiMode(): ModeSpec | undefined;
  /** Replace the program, as one step that Undo takes back */
  apply(next: Program): void;
  /** Take back the last step */
  undo(): void;
}

/**
 * What `createChat` gives back: the panel, and ways to open it and to find out
 * how much room it takes.
 */
export interface Chat {
  /** The panel, to be placed at the bottom of the 3D area */
  element: HTMLElement;
  open(): void;
  /** How tall the panel is now (px): just its bar when closed */
  height(): number;
}
