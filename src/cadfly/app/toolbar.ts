import { stage } from "jetlag2d";
import { EXAMPLES, exampleById } from "../examples";
import { RunStopped } from "../engine";
import { type ExportChoice, exportFile } from "../exportStl";
import { PROJECT_EXTENSION, PROJECT_FILE_NAME, serializeProject } from "../language/format";
import { createEmptyProgram, isBlank } from "../language/program";
import type { Problem } from "../language/types";
import type { RunSnapshot } from "../snapshot";
import { el } from "../ui/dom";
import type { ToolbarButton } from "../ui/editor";
import { addExampleToProject, exampleCards } from "../ui/menus";
import { openCards } from "../ui/overlay";
import { openProjectFile } from "./openProjectFile";
import type { Project } from "./project";
import type { Settings } from "./settings";

/**
 * The buttons along the top of the page and what they do: undo and redo, the
 * mode and the assistant switch, and the project's New, Save, Load, Examples and
 * STL. It owns the hidden file chooser behind Load and the downloads.
 */

/** How long (ms) a saved file's address is kept before it is let go: long enough for any browser to start the download */
const DOWNLOAD_URL_LIFE = 60_000;

/** What the toolbar needs from the page. */
export interface ToolbarHost {
  /** The project the buttons act on: its blocks, files and history. */
  project: Project;
  /** The mode and the assistant switch. */
  settings: Settings;
  /** The latest build that made something, which is what the STL button exports */
  lastShapes(): RunSnapshot | undefined;
  /**
   * Build the program as it is now, with the hidden shapes in the result, for
   * an export that includes them. Rejects if the build is stopped or fails.
   */
  buildWithHidden(): Promise<RunSnapshot>;
  /** What is wrong with the program, from the latest build */
  problem(): Problem | undefined;
  /** Say something to the person. */
  notify(message: string): void;
}

/**
 * Give the person a file: save `data` under `name`. The file's address is let go
 * after a while, not at once, since some browsers (iPad Safari) have not begun
 * the download by then.
 *
 * @param name What the file is called.
 * @param data What is in it.
 * @param type Its media type.
 */
function download(name: string, data: BlobPart, type: string) {
  const a = el("a");
  const url = URL.createObjectURL(new Blob([data], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFE);
}

/**
 * Make the toolbar's buttons. This also adds the hidden file chooser to the
 * page.
 *
 * @param host What the buttons act on.
 * @returns The buttons, as the editor draws them.
 */
export function createToolbar(host: ToolbarHost): () => ToolbarButton[] {
  const { project, settings } = host;

  /**
   * The file chooser behind the Load button. It is never shown: the button asks
   * for a click on it.
   */
  const fileInput = el("input", "display:none");
  fileInput.type = "file";
  fileInput.accept = PROJECT_EXTENSION;
  document.body.appendChild(fileInput);
  // A project file was chosen: open it in place of the project.
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // so the same file can be chosen again
    if (file) await openProjectFile(file, host);
  };

  // Browsers only open a file chooser from a "click" event, and JetLag acts on the
  // release before it.  So the Load button asks for one, and the click that follows opens it.
  let openChooserOnClick = false;
  (stage.renderer.pixi.canvas as HTMLCanvasElement).addEventListener("click", () => {
    if (!openChooserOnClick) return;
    openChooserOnClick = false;
    fileInput.click();
  });
  /** The Load button's action: the next click, which follows at once, opens the file chooser. */
  const askForFile = () => {
    openChooserOnClick = true;
    setTimeout(() => (openChooserOnClick = false), 600); // if no click follows, forget it
  };

  /**
   * Offer the example programs as cards over the page, each to open (replacing
   * the project) or to add to the project. Only the examples this mode can show
   * are offered.
   */
  const chooseExample = () => {
    const replaceProject = (id: string) => {
      const example = exampleById(id);
      if (!example || !project.okToReplace(`Open the ${example.name} example?`)) return;
      project.replace(structuredClone(example.program));
      host.notify(example.description);
    };
    const addToProject = (id: string) => {
      const example = exampleById(id);
      if (!example) return;
      const outcome = addExampleToProject(project.program(), project.files(), example, settings.currentMode());
      if ("refused" in outcome) {
        host.notify(outcome.refused);
        return;
      }
      project.applyAsStep(outcome.program);
      host.notify(outcome.notice);
    };
    openCards(
      "Examples",
      exampleCards(EXAMPLES, settings.currentMode()).map((e) => ({
        title: e.name,
        description: e.description,
        actions: [
          { label: "Replace project", color: "#8e44ad", run: () => replaceProject(e.id) },
          { label: "Add to project", run: () => addToProject(e.id) },
        ],
      })),
      [],
      { wide: true },
    );
  };

  /**
   * Give the person the STL they chose. Hidden shapes need a build of their
   * own, since the one on screen leaves them out.
   */
  const saveStl = async (choice: ExportChoice) => {
    let shapes = host.lastShapes();
    if (choice.withHidden) {
      try {
        shapes = await host.buildWithHidden();
      } catch (e) {
        host.notify(e instanceof RunStopped ? "The build with the hidden shapes was stopped, so nothing was saved." : "The build with the hidden shapes did not work, so nothing was saved.");
        return;
      }
    }
    let file: ReturnType<typeof exportFile> | undefined;
    try {
      file = shapes && exportFile(shapes, choice);
    } catch (e) {
      host.notify(`The STL could not be saved: ${(e as Error).message}`);
      return;
    }
    if (!shapes || !file) {
      host.notify(choice.withHidden ? "There is nothing to save: no shape is drawn or hidden." : "There is nothing to save.");
      return;
    }
    if (host.problem() || shapes.problem) host.notify("This STL is the last build that worked, and may not match the blocks: a block has a problem.");
    download(file.name, file.data, file.type);
  };

  /**
   * Offer the two ways to save an STL as cards over the page, each tapped to
   * choose it, with a check box for the hidden shapes.
   */
  const chooseExport = () =>
    openCards(
      "Save an STL",
      [
        { title: "Save one file", description: "Everything you see, joined into a single STL: part.stl.", pick: (on) => void saveStl({ separate: false, withHidden: on[0] }) },
        { title: "Save each part as its own file", description: "A zip with an STL for every shape at the top of build (and for every shape a script used there makes), so the parts can be printed apart: parts.zip.", pick: (on) => void saveStl({ separate: true, withHidden: on[0] }) },
      ],
      [{ label: "Include hidden shapes" }],
    );

  return () => [
    // after the tabs: what acts on the blocks
    { group: "edit", label: "↶", color: "#475569", enabled: () => project.canUndo(), action: project.undo },
    { group: "edit", label: "↷", color: "#475569", enabled: () => project.canRedo(), action: project.redo },
    // the middle: how much of the interface to show
    { group: "mode", label: `Mode: ${settings.modeName()}`, color: "#0f766e", enabled: () => settings.lockedMode === undefined, action: settings.chooseMode },
    { group: "mode", label: settings.assistantOn() ? "AI: on" : "AI: off", color: settings.assistantOn() ? "#0f766e" : "#475569", enabled: () => settings.lockedAssistant === undefined, action: settings.toggleAssistant },
    // the right: the project
    {
      group: "file",
      label: "New",
      color: "#b45309",
      enabled: () => !isBlank(project.program()) || Object.keys(project.files()).length > 0,
      action: () => {
        if (project.okToReplace("Start a new, empty program?")) project.replace(createEmptyProgram(), {});
      },
    },
    {
      group: "file",
      label: "Save",
      color: "#2f7fe0",
      enabled: () => !isBlank(project.program()),
      action: () => {
        download(PROJECT_FILE_NAME, serializeProject(project.program(), project.files()), "application/json");
        project.markSaved();
      },
    },
    { group: "file", label: "Load", color: "#2f7fe0", enabled: () => true, action: askForFile },
    { group: "file", label: "Examples", color: "#8e44ad", enabled: () => true, action: chooseExample },
    {
      group: "file",
      label: "STL",
      color: "#1f9d55",
      enabled: () => !!host.lastShapes()?.combined,
      action: chooseExport,
    },
  ];
}
