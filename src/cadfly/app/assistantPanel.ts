import type { Checker } from "../assistant/assistant";
import { RunStopped, TIME_LIMIT, type ShapeEngine, stoppedProblem } from "../engine";
import { type LocalModel, WebLlm } from "../llm";
import { createChat } from "../ui/chat";
import type { Project } from "./project";
import type { Runner } from "./runner";
import type { Settings } from "./settings";

/**
 * The assistant bar along the bottom of the page, wired to the project: what
 * the person asks is built with the same engine as the page, and what is
 * proposed replaces the blocks as one step that Undo takes back.
 */

/** What the assistant panel needs from the page. */
export interface AssistantPanelHost {
  engine: ShapeEngine;
  project: Project;
  runner: Runner;
  settings: Settings;
  /** The page's layout changed (the bar was shown or hidden): place everything again. */
  relayout(): void;
}

/** What the assistant panel offers. */
export interface AssistantPanel {
  /** The panel's page element and its way of reporting how tall it is */
  chat: ReturnType<typeof createChat>;
  /** Show or hide the bar as the assistant switch says (the 3D view gets the room back). */
  show(): void;
  /** Use this model that runs on this computer, instead of the one that downloads. */
  useModel(model: LocalModel): void;
}

/**
 * Make the assistant bar and add it to the page.
 *
 * @param host What it needs from the page.
 */
export function createAssistantPanel(host: AssistantPanelHost): AssistantPanel {
  const { engine, project, runner, settings } = host;
  /**
   * What the assistant builds its changes with, to see if they work. The
   * change's Google fonts are asked for first, as for any build, and the build
   * is a `check` run, which edits to the program on screen do not end. A problem
   * that stopped the engine is a problem with the change.
   */
  const checker: Checker = async (p, f) => {
    await runner.requestFonts(p);
    return engine.run(p, f, "check").catch((e) => {
      if (!(e instanceof RunStopped)) throw e;
      return { problem: stoppedProblem(e.why, Math.round(TIME_LIMIT / 1000), e.detail) };
    });
  };
  /** The model that runs on this computer, when the person chooses one. */
  let localModel: LocalModel = new WebLlm();
  // It builds what the model proposes with the same engine as the page, and
  // applies it as one step that Undo takes back.
  const chat = createChat({
    get model() {
      return localModel;
    },
    program: project.program,
    problem: runner.problem,
    files: project.files,
    uiMode: settings.currentMode,
    checker: () => (engine.ready() ? checker : undefined),
    apply: project.applyAsStep,
    undo: project.undo,
  });
  document.body.appendChild(chat.element);
  /** Show or hide the assistant bar (the 3D view gets the room back) */
  const show = () => {
    chat.element.style.display = settings.assistantOn() ? "" : "none";
    host.relayout();
  };
  show();
  return {
    chat,
    show,
    useModel(model) {
      localModel = model;
    },
  };
}
