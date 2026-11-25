import { type StlFiles, sameFiles } from "./language/files";
import { commandById } from "./language/commands";
import { serializeProject } from "./language/format";
import { isBlank } from "./language/program";
import type { Block, Program } from "./language/types";

/**
 * Telling whether the project has changed since it was saved. A change is a
 * change to the blocks or to the files. How the blocks are shown is not: where a
 * script is, and whether a script or a block is folded, do not count, since
 * looking at the project differently is not changing it.
 */

/**
 * The program as text, without how it is shown: no script places or folds, no
 * block folds, and none of the fields that are only for looking (the ones that
 * show the points or the faces).
 *
 * @param program The program.
 */
export function contentText(program: Program): string {
  /** A copy of these blocks without how they are shown. */
  const strip = (blocks: Block[]): Block[] =>
    blocks.map(({ collapsed: _c, ...rest }) => {
      const args = { ...rest.args };
      for (const id of commandById(rest.kind)?.viewOnly ?? []) delete args[id];
      return { ...rest, args, ...(rest.inner ? { inner: strip(rest.inner) } : {}) } as Block;
    });
  return serializeProject(program.map(({ collapsed: _folded, at: _at, ...script }) => ({ ...script, blocks: strip(script.blocks) })));
}

/**
 * Has the project changed since it was last saved (or loaded, or was an
 * unchanged example)? An empty program has nothing to lose, so it has not.
 *
 * @param program The blocks now.
 * @param files The files now.
 * @param savedText `contentText` of the blocks when they were last saved.
 * @param savedFiles The files when they were last saved. Files are never
 *                   changed in place, so they are compared by what they hold.
 */
export function unsavedChanges(program: Program, files: StlFiles, savedText: string, savedFiles: StlFiles): boolean {
  return !isBlank(program) && (contentText(program) !== savedText || !sameFiles(files, savedFiles));
}
