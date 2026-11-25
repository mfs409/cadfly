import { PROJECT_EXTENSION, isProjectFileName, parseProject } from "../language/format";
import type { Project } from "./project";
import type { Settings } from "./settings";

/**
 * Opening a project file the person gave: read it, check it, and replace the
 * blocks and STL files with it after asking if there are unsaved blocks. A file
 * that is not a good project is reported and nothing changes.
 */

/** What opening a project file needs from the page. */
export interface OpenFileHost {
  /** The project that is replaced, and that is asked about unsaved blocks. */
  project: Pick<Project, "okToReplace" | "replace">;
  /** Where the blocks the mode does not offer are reported, once the project is open. */
  settings: Pick<Settings, "noteHiddenBlocks">;
  /** Say something to the person. */
  notify(message: string): void;
}

/**
 * Open a project file in place of the current project.
 *
 * The change is one step that Undo takes back. A file whose name does not end
 * in the project extension, or whose text is not a good project, is reported to
 * the person, and the project is left as it is. So is a project that the person
 * decides not to replace.
 *
 * @param file The file the person chose or dropped.
 * @param host What opening it needs from the page.
 * @returns True if the project was replaced.
 */
export async function openProjectFile(file: File, host: OpenFileHost): Promise<boolean> {
  if (!isProjectFileName(file.name)) {
    host.notify(`${file.name}: that is not a ${PROJECT_EXTENSION} file`);
    return false;
  }
  try {
    const loaded = parseProject(await file.text());
    if (!host.project.okToReplace(`Load ${file.name}?`)) return false;
    host.project.replace(loaded.program, loaded.files);
    host.settings.noteHiddenBlocks();
    return true;
  } catch (e) {
    host.notify(`${file.name}: ${(e as Error).message}`);
    return false;
  }
}
