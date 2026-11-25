import { JetLagGameConfig, initializeAndLaunch, stage } from "jetlag2d";
import { wantsTestHandle } from "./address";
import { type AssistantPanel, createAssistantPanel } from "./app/assistantPanel";
import { watchDrops } from "./app/dropFile";
import { createEditorHost } from "./app/editorHost";
import { openProjectFile } from "./app/openProjectFile";
import { createProject } from "./app/project";
import { createRunner } from "./app/runner";
import { createSettings } from "./app/settings";
import { createToastBox } from "./app/toastBox";
import { createToolbar } from "./app/toolbar";
import { createView3d } from "./app/view3d";
import { createShapeEngine } from "./engine";
import type { LocalModel } from "./llm";
import { SCREEN, createEditor } from "./ui/editor";
import { FONT } from "./ui/pool";

/**
 * The page itself. When the game engine has started, it builds everything the
 * person sees and ties the pieces together: the project (the blocks, the STL
 * files and the history of changes), the 3D engine that builds the blocks into
 * shapes and the runner that decides when, the 3D view that shows the result,
 * the message box, the block editor, the assistant bar and the toolbar, and the
 * settings (interface mode and assistant switch) that a page address can lock.
 */

/**
 * How the game engine is set up for this page: the shape of the screen, no
 * debug boxes, and the font to load.
 */
class Config implements JetLagGameConfig {
  /** The shape of the screen the page is laid out on; the canvas is scaled to the window. */
  aspectRatio = { width: SCREEN.w, height: SCREEN.h };
  /** Whether to draw the boxes the game engine uses to find what a pointer touched (off). */
  hitBoxes = false;
  /** Where the game engine's images and fonts are served from, and the fonts to load. */
  resources = { prefix: "./assets/", fonts: ["Arimo-Regular.ttf"] };
}

/**
 * Build the page: make each part, give it the few things it needs from the
 * others, and start. Parts that need each other are given functions that look
 * the other up when they are called, so that none has to exist before the one
 * that uses it.
 */
function builder() {
  stage.backgroundColor = "#1b2338";
  const engine = createShapeEngine();
  const view = createView3d();
  /** The block editor, made last: the parts above draw it again when something changes. */
  let editor: ReturnType<typeof createEditor> | undefined;
  /** The assistant bar, which sits under the 3D view: it is made after the parts that place it. */
  let panel: AssistantPanel | undefined;
  const redraw = () => editor?.update();
  const toast = createToastBox(
    () => ({ working: runner.slow(), problem: runner.problem(), engineFailure: engine.failure(), engineReady: engine.ready() }),
    () => engine.stop("user"),
  );
  /** Say something to the person, and keep it until the next change. */
  const notify = (message: string) => {
    redraw();
    toast.say(message);
  };
  const runner = createRunner({
    engine,
    program: () => project.program(),
    files: () => project.files(),
    show: view.show,
    refresh: () => {
      redraw();
      toast.refresh();
    },
    refreshMessage: toast.refresh,
  });
  const settings = createSettings({ program: () => project.program(), notify, forgetNotice: toast.forget, redraw, assistantChanged: () => panel?.show() });
  const project = createProject({
    schedule: runner.schedule,
    filesReady() {
      runner.filesReady();
      runner.request();
    },
    reframe: view.reframe,
    redraw,
    clearNotice: toast.clear,
    notify,
    loaded: settings.noteHiddenBlocks,
  });
  /** Put the 3D view, the assistant bar and the message box where they belong over the canvas. */
  const layout = () => view.place(panel?.chat.element, panel?.chat.height() ?? 0, toast.element);
  panel = createAssistantPanel({ engine, project, runner, settings, relayout: layout });
  stage.world.repeatEvents.push(layout);
  layout();
  const buttons = createToolbar({ project, settings, lastShapes: runner.lastShapes, buildWithHidden: () => engine.run(project.program(), project.files(), "export", true), problem: runner.problem, notify });
  editor = createEditor(createEditorHost({ project, runner, settings, buttons, notify }));

  // a project file dropped anywhere on the page opens as the Load button does
  watchDrops({ open: (file) => openProjectFile(file, { project, settings, notify }), notify });

  // Ctrl+Z and Ctrl+Y, except while typing in a field
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) project.undo();
    else if (k === "y" || (k === "z" && e.shiftKey)) project.redo();
    else return;
    e.preventDefault();
  });

  project.start();
  if (settings.lockedMode !== undefined) settings.noteHiddenBlocks();

  // for browser checks: the page hands them its parts only when the address says `?test=1`
  if (wantsTestHandle(location.search)) {
    (window as unknown as { __cadfly: unknown }).__cadfly = {
      get program() { return project.program(); },
      get problem() { return runner.problem(); },
      get ready() { return engine.ready(); },
      get files() { return project.files(); },
      setFiles: project.setFiles,
      undo: project.undo,
      redo: project.redo,
      engine,
      editor,
      FONT,
      get chat() { return panel?.chat; },
      setModel(m: LocalModel) { panel?.useModel(m); },
    };
  }
}

initializeAndLaunch("game-player", new Config(), builder);
