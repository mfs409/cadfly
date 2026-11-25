import { fillFaces } from "../language/edit";
import type { StlFiles } from "../language/files";
import { allBlocks } from "../language/program";
import type { RunSnapshot } from "../snapshot";
import type { EditorHost, ToolbarButton } from "../ui/editor";
import { openFileMenu } from "../ui/filemenu";
import type { Project } from "./project";
import type { Runner } from "./runner";
import type { Settings } from "./settings";

/**
 * What the block editor is given by the page: the blocks and the ways to change
 * them, what is wrong with them, the project's files and the file menu, the
 * mode, what the measure blocks found, the hull button, and the toolbar.
 */

/** What the editor's host is made from. */
export interface EditorHostParts {
  project: Project;
  runner: Runner;
  settings: Settings;
  /** The toolbar's buttons */
  buttons(): ToolbarButton[];
  /** Say something to the person. */
  notify(message: string): void;
}

/**
 * Make the editor's host.
 *
 * @param parts What it is made from.
 */
export function createEditorHost(parts: EditorHostParts): EditorHost {
  const { project, runner, settings, notify } = parts;
  return {
    program: project.program,
    change: project.change,
    problem: runner.problem,
    notify,
    files: () => Object.keys(project.files()),
    chooseFile: (at, current, pick) =>
      openFileMenu(
        at,
        {
          files: project.files,
          setFiles: (next: StlFiles) => project.setFiles(next),
          inUse: () => new Set(allBlocks(project.program()).flatMap((b) => (b.kind === "import" && b.args.file ? [String(b.args.file)] : []))),
          notify,
        },
        current,
        pick,
      ),
    mode: settings.currentMode,
    measurements: (blockId) => runner.lastBuild()?.measurements[blockId],
    pressButton(blockId, id) {
      if (id !== "hull") return;
      const lastBuild: RunSnapshot | undefined = runner.lastBuild();
      // the faces come from the last build, which is of this program only if nothing has changed since
      if (!lastBuild || runner.lastBuildProgram() !== project.program()) {
        notify("The blocks have changed since the last build: wait for the build to finish, then press hull again.");
        return;
      }
      // fill an empty faces section with the faces the solid's hull is made of: a valid shape to edit from, one face at a time
      const faces = lastBuild.hullFaces[blockId];
      if (!faces?.length) {
        notify("The hull is not worked out yet: the solid has a problem (shown in red) or fewer than 4 vertices that make a solid.");
        return;
      }
      project.record();
      project.setProgram(fillFaces(project.program(), blockId, faces));
      notify(`Filled in the ${faces.length} faces of the hull, each listed counterclockwise as seen from outside. Turn on show labels on the faces to see them in the view: the outside is the solid side.`);
    },
    buttons: parts.buttons,
  };
}

