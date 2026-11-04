import { JetLagGameConfig, initializeAndLaunch, stage } from "jetlag2d";
import { History } from "./history";
import { writeStl } from "./geometry/stl";
import { allBlocks, fillFaces } from "./language/edit";
import { parseProject, serializeProject } from "./language/format";
import { decodeLink, linkValue } from "./language/link";
import { DEFAULT_MODE_NAME, UI_MODES, hiddenKindsUsed, modeByName } from "./language/modes";
import { type Files, validateFiles } from "./language/files";
import type { Checker } from "./assistant/assistant";
import type { RunSnapshot } from "./language/snapshot";
import type { Rect } from "./language/layout";
import type { Block, Problem, Program } from "./language/types";
import { createGizmo } from "./view/gizmo";
import { readStored, writeStored } from "./view/dom";
import { displayShapes, readoutText, showOverlays } from "./view/show";
import { Viewer } from "./view/viewer";
import { DEMOS } from "./language/demos";
import { PALETTE_W, SCREEN, STATUS_H, TOOLBAR_H, VIEW_LEFT, createEditor, hudPageRect } from "./editor";
import { openFieldEditor } from "./fields";
import { FONT } from "./pool";
import { createChat } from "./chat";
import { commandById } from "./language/commands";
import { openFileMenu } from "./filemenu";
import { type LocalModel, WebLlm } from "./llm";
import { Stopped, TIME_LIMIT, createEngine, createFontRequester, stoppedProblem } from "./engine";

class Config implements JetLagGameConfig {
  aspectRatio = { width: SCREEN.w, height: SCREEN.h };
  hitBoxes = false;
  resources = { prefix: "./assets/", fonts: ["Arimo-Regular.ttf"] };
}

/** Where the program is kept between visits */
const STORAGE_KEY = "cadfly.program";
/** The STL files the project carries are kept apart from the program, since they can be large */
const FILES_KEY = "cadfly.files";
/** The interface mode last chosen (see modes.ts) */
const MODE_KEY = "cadfly.mode";
/** Whether the assistant is offered ("on" or "off"): a separate switch from the mode, which is only about blocks */
const AI_KEY = "cadfly.ai";
/** After a change, wait this long (ms) for more changes before running the program */
const RUN_DELAY = 120;
/** Where the Support button goes: the same Ko-fi page as the JetLag tutorials */
const SUPPORT_URL = "https://ko-fi.com/mfs409";

/**
 * The 3D view is a DOM element laid over the right-hand part of the JetLag
 * canvas.  JetLag sizes its canvas to the browser window, so we work out where
 * that part is from the canvas's own position and size, each frame.
 */
function placeOverCanvas(element: HTMLElement, bar?: HTMLElement, barHeight = 0, toast?: HTMLElement) {
  const canvas = stage.renderer.pixi.canvas as HTMLCanvasElement;
  const box = canvas.getBoundingClientRect();
  const perMeter = box.width / SCREEN.w;
  const px = (v: number) => `${Math.round(v)}px`;
  const height = SCREEN.h * perMeter;
  element.style.left = px(box.left + VIEW_LEFT * perMeter);
  // the toolbar runs across the whole top, so the 3D view starts under it
  const toolbar = TOOLBAR_H * perMeter;
  element.style.top = px(box.top + toolbar);
  element.style.width = px((SCREEN.w - VIEW_LEFT) * perMeter);
  // the 3D view takes the room between the toolbar and the assistant's bar along the bottom
  const status = STATUS_H * perMeter;
  element.style.height = px(height - toolbar - status);
  if (bar) {
    // the assistant's bar runs across the whole bottom; when its conversation is open it grows upward over the rest
    bar.style.left = px(box.left);
    bar.style.width = px(box.width);
    bar.style.top = px(box.top + height - Math.max(status, barHeight));
    bar.style.height = px(Math.max(status, barHeight));
  }
  if (toast) {
    // messages about the program sit at the bottom of the workspace, above the bar
    toast.style.left = px(box.left + (PALETTE_W + 0.25) * perMeter);
    toast.style.bottom = px(window.innerHeight - (box.top + height - status) + 8);
    toast.style.maxWidth = px((VIEW_LEFT - PALETTE_W - 0.5) * perMeter);
  }
}

/** Give the user a file: save `data` under `name` */
function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function builder() {
  stage.backgroundColor = "#1b2338";

  // ---- what the app knows ----
  /** The 3D engine, in a Web Worker: building a big shape can take a while, and the page must not freeze meanwhile */
  const engine = createEngine();
  let program: Program = [];
  /** The STL files the project carries, for import blocks */
  let files: Files = {};
  const history = new History<Program>();
  /** The latest run, and the latest run that built something: that is what stays on screen (and gets exported) while a block has a problem */
  let result: RunSnapshot | undefined;
  let shown: RunSnapshot | undefined;
  let problem: Problem | undefined;
  /** A message about something that just happened (saved, could not load, ...) until the next change */
  let notice = "";
  let fitted = false;
  let timer = 0;
  /** A program is being built and has been for a moment: the toast says so, and offers to stop */
  let working = false;

  // the page is exactly the window: the canvas, the 3D view and the assistant's bar are all placed over it, so it never scrolls
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  // ---- the 3D view ----
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;overflow:hidden";
  document.body.appendChild(holder);
  const viewer = new Viewer(holder);
  // how big the result is, so it can be checked against what was asked for (the AI can be sure and wrong)
  const measure = document.createElement("div");
  measure.style.cssText = "position:absolute;left:8px;top:8px;padding:4px 8px;border-radius:6px;background:rgba(20,27,45,.82);color:#e6ebf5;font:12px/1.4 monospace;pointer-events:none;white-space:pre";
  holder.appendChild(measure);
  // "Fit" frames the model: it belongs with the view, next to the axes gizmo, not in the toolbar
  const fit = document.createElement("button");
  fit.textContent = "Fit";
  fit.title = "Frame the whole model in the view";
  fit.style.cssText = "position:absolute;right:10px;bottom:10px;padding:5px 12px;border:1px solid #00000030;border-radius:6px;background:rgba(20,27,45,.82);color:#e6ebf5;font:13px sans-serif;cursor:pointer";
  fit.onclick = () => viewer.fitToView();
  holder.appendChild(fit);
  createGizmo(viewer);
  /** The assistant's panel sits under the 3D view; set below, once it exists */
  let chat: ReturnType<typeof createChat> | undefined;
  // messages about the program (what is wrong with it, what just happened) are toasts, not a line in a bar, so they can be read in full
  const toast = document.createElement("div");
  toast.style.cssText = "position:fixed;z-index:6;display:none;box-sizing:border-box;padding:8px 34px 8px 12px;border-radius:8px;font:14px/1.4 sans-serif;white-space:pre-wrap;box-shadow:0 4px 14px #0008";
  const toastClose = document.createElement("button");
  toastClose.textContent = "×";
  toastClose.title = "Dismiss";
  toastClose.style.cssText = "position:absolute;right:6px;top:2px;background:none;border:0;color:inherit;font:20px sans-serif;cursor:pointer";
  const toastText = document.createElement("span");
  const toastStop = document.createElement("button");
  toastStop.textContent = "Stop";
  toastStop.style.cssText = "margin-left:10px;padding:2px 10px;border:1px solid #ffffff60;border-radius:5px;background:#ffffff18;color:inherit;font:13px sans-serif;cursor:pointer";
  toastStop.onclick = () => engine.stop("user");
  toast.append(toastText, toastStop, toastClose);
  for (const type of ["pointerdown", "wheel", "keydown"]) toast.addEventListener(type, (e) => e.stopPropagation());
  document.body.appendChild(toast);
  let dismissed = "";
  let toastTimer = 0;
  toastClose.onclick = () => {
    dismissed = toastText.textContent ?? "";
    toast.style.display = "none";
  };
  /** Show what there is to say: a notice (for a few seconds), else the problem (until it is fixed), else nothing */
  function updateToast() {
    const text = working ? "Working on it..." : notice || problem?.message || engine.failure() || (!engine.ready() ? "loading the 3D engine..." : "");
    toastStop.style.display = working ? "" : "none";
    if (!text || (text === dismissed && !working)) {
      toast.style.display = text ? "none" : "none";
      return;
    }
    const bad = !working && !notice && !!problem;
    toastText.textContent = (bad ? "⚠ " : "") + text;
    toast.style.background = bad ? "#4a1d24" : "#1d2a44";
    toast.style.color = bad ? "#ffc9c9" : "#d8e2f5";
    toast.style.border = `1px solid ${bad ? "#ff6b6b" : "#3a4a70"}`;
    toast.style.display = "";
    clearTimeout(toastTimer);
    if (notice) toastTimer = window.setTimeout(() => ((notice = ""), (dismissed = ""), updateToast()), 9000);
  }
  const layoutView = () => placeOverCanvas(holder, chat?.element, chat?.height() ?? 0, toast);
  stage.world.repeatEvents.push(layoutView);
  layoutView();

  // ---- running the program ----
  /** Is the engine building a program, and is there a newer one waiting for it to finish? */
  let building = false;
  let stale = false;
  /** A program that is changed while the last one is still being built is built after it: unless that has gone on a while, and then it is stopped */
  const STALE_AFTER = 1500;
  function run() {
    if (building) {
      stale = true;
      if (engine.busyFor() > STALE_AFTER) engine.stop("newer");
      return;
    }
    building = true;
    stale = false;
    const workTimer = window.setTimeout(() => ((working = true), updateToast()), 500);
    engine.run(program, files).then(
      (r) => finish(r),
      (e) => {
        if (!(e instanceof Stopped)) throw e;
        // stopped by the person or for taking too long: say so, and keep what was on screen; if the program changed meanwhile, that is built next
        if (e.why !== "newer" && !stale) {
          problem = stoppedProblem(e.why, Math.round(TIME_LIMIT / 1000), e.detail);
          result = undefined;
        }
      },
    ).finally(() => {
      clearTimeout(workTimer);
      working = false;
      building = false;
      if (stale) run();
      else {
        editor.refresh();
        updateToast();
      }
    });
  }

  function finish(r: RunSnapshot) {
    if (stale) return; // the program has changed since: that one is built next
    result = r;
    problem = r.problem;
    const items = displayShapes(r);
    if (items.length || !problem) {
      const text = readoutText(r);
      measure.style.display = text === undefined ? "none" : "";
      if (text !== undefined) measure.textContent = text;
    }
    showOverlays(viewer, r, problem);
    // a typo that makes everything fail should not blank the view
    if (items.length || !problem) {
      shown = r;
      viewer.setShapes(items);
    }
    if (items.length && !fitted) {
      viewer.fitToView();
      fitted = true;
    } else if (!items.length && !problem) {
      fitted = false;
    }
    fetchGoogleFonts(program);
  }

  const fetchGoogleFonts = createFontRequester(engine, run);

  function runSoon() {
    clearTimeout(timer);
    timer = window.setTimeout(run, RUN_DELAY);
  }

  function setProgram(next: Program) {
    program = next;
    notice = "";
    updateToast();
    writeStored(STORAGE_KEY, serializeProject(program)); // private windows and full disks cannot save; the program still works
    runSoon();
    editor.refresh();
  }

  /** Keep a new set of files (browsers allow only a few MB of storage: if it does not fit, the files last until the page closes) */
  function setFiles(next: Files) {
    files = next;
    if (!writeStored(FILES_KEY, JSON.stringify(files))) {
      notice = "The files are too big for this browser to keep: they will be lost when the page closes. Save the project to keep them.";
    }
    run();
    editor.refresh();
  }

  // what was last saved (or loaded, or is an unchanged example): New, Load and Demos ask before replacing blocks that are not
  let savedText = "";
  /** The project as text, without how it is shown (folded blocks, "more" opened): looking at it differently is not a change to it */
  const contentText = () => {
    const strip = (blocks: Block[]): Block[] =>
      blocks.map(({ collapsed: _c, expanded: _e, stackCollapsed: _s, ...rest }) => {
        // and the fields a block lists as only for looking (show the points, show the faces)
        const args = { ...rest.args };
        for (const id of commandById(rest.kind)?.viewOnly ?? []) delete args[id];
        return { ...rest, args, ...(rest.inner ? { inner: strip(rest.inner) } : {}) } as Block;
      });
    return serializeProject(strip(program), files);
  };
  const markSaved = () => (savedText = contentText());
  /**
   * Replace everything with a program that came from outside (a file, an example, a link, New), as one step that Undo takes back. It counts as
   * saved, since it can be had again. The project's files are replaced too if `nextFiles` is given.
   */
  function replaceProgram(next: Program, nextFiles?: Files) {
    history.record(program);
    fitted = false;
    if (nextFiles && (Object.keys(nextFiles).length || Object.keys(files).length)) setFiles(nextFiles);
    setProgram(next);
    markSaved();
  }
  /** True if there is something here that was not saved since it last changed */
  const unsaved = () => program.length > 0 && contentText() !== savedText;
  /** Ask before replacing blocks that were not saved (nothing to ask when there are none, or they were saved) */
  const okToReplace = (what: string) => !unsaved() || confirm(`${what}\n\nThe blocks you have now have not been saved since you last changed them (Save keeps them in a file). Go ahead and replace them?`);

  function say(message: string) {
    notice = message;
    dismissed = "";
    editor.refresh();
    updateToast();
  }

  // ---- the interface mode: how much of each block is offered (modes.ts) ----
  // a page address like ...cadfly.html?mode=Starter picks the mode and locks it (a teacher can hand out the link); otherwise the last one chosen
  const lockedName = UI_MODES.find(([n]) => n.toLowerCase() === (new URLSearchParams(location.search).get("mode") ?? "").trim().toLowerCase())?.[0];
  let modeName = lockedName ?? DEFAULT_MODE_NAME;
  if (!lockedName) {
    const saved = readStored(MODE_KEY);
    if (saved && modeByName(saved)) modeName = UI_MODES.find(([n]) => n.toLowerCase() === saved.toLowerCase())![0];
  }
  const currentMode = () => modeByName(modeName);

  // ---- the assistant switch: ...?ai=on (or off) picks it and locks it, like ?mode=; otherwise the last one chosen, and off at first ----
  const aiParam = (new URLSearchParams(location.search).get("ai") ?? "").trim().toLowerCase();
  const lockedAi = ["1", "on", "true", "yes"].includes(aiParam) ? true : ["0", "off", "false", "no"].includes(aiParam) ? false : undefined;
  let aiOn = lockedAi ?? false;
  if (lockedAi === undefined) aiOn = readStored(AI_KEY) === "on";

  /** Say, in the status bar, which blocks of a program this mode does not offer (they still work, and can be edited) */
  function noteHiddenBlocks() {
    const hidden = hiddenKindsUsed(program, currentMode());
    if (hidden.length) say(`This program uses blocks that ${modeName} mode does not offer (${hidden.join(", ")}). They still work; choose a mode with more blocks to add them.`);
  }

  const chooseMode = (at: Rect) => {
    openFieldEditor({
      rect: hudPageRect(at),
      param: { id: "mode", label: "", default: modeName, type: { kind: "choice", options: UI_MODES.map(([n]) => ({ value: n, label: n })) } },
      value: modeName,
      onCommit: (name) => {
        modeName = name;
        writeStored(MODE_KEY, name); // if the browser will not keep it, it lasts until the page closes
        notice = "";
        editor.refresh();
        noteHiddenBlocks();
      },
    });
  };

  function toggleAi() {
    aiOn = !aiOn;
    writeStored(AI_KEY, aiOn ? "on" : "off"); // if the browser will not keep it, it lasts until the page closes
    showChat();
    editor.refresh();
  }

  // ---- the toolbar ----
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".json,.blocks";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  fileInput.onchange = async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // so the same file can be chosen again
    if (!file) return;
    try {
      const loaded = parseProject(await file.text());
      if (!okToReplace(`Load ${file.name}?`)) return;
      replaceProgram(loaded.program, loaded.files);
      noteHiddenBlocks();
    } catch (e) {
      say(`${file.name}: ${(e as Error).message}`);
    }
  };

  // Browsers only open a file chooser from a "click" event, and JetLag acts on the
  // release before it.  So the Load button asks for one, and the click that follows opens it.
  let openChooserOnClick = false;
  (stage.renderer.pixi.canvas as HTMLCanvasElement).addEventListener("click", () => {
    if (!openChooserOnClick) return;
    openChooserOnClick = false;
    fileInput.click();
  });
  const askForFile = () => {
    openChooserOnClick = true;
    setTimeout(() => (openChooserOnClick = false), 600); // if no click follows, forget it
  };

  /** Offer the example programs in a drop-down beside the button */
  const chooseExample = (at: Rect) => {
    openFieldEditor({
      rect: hudPageRect(at),
      param: {
        id: "example",
        label: "",
        default: "",
        // only the examples this mode can show: ones that use a block it hides are in the other modes
        type: { kind: "choice", options: [{ value: "", label: "Choose an example..." }, ...DEMOS.filter((e) => !hiddenKindsUsed(e.program, currentMode()).length).map((e) => ({ value: e.name, label: e.name }))] },
      },
      value: "",
      onCommit: (name) => {
        const example = DEMOS.find((e) => e.name === name);
        if (!example || !okToReplace(`Open the ${example.name} example?`)) return;
        replaceProgram(structuredClone(example.program));
        say(example.description);
      },
    });
  };

  const undo = () => {
    const prev = history.undo(program);
    if (prev) setProgram(prev);
  };
  const redo = () => {
    const next = history.redo(program);
    if (next) setProgram(next);
  };

  /** What the assistant builds its changes with, to see if they work: a problem that stopped the engine is a problem with the change */
  const check: Checker = (p, f) =>
    engine.run(p, f).catch((e) => {
      if (!(e instanceof Stopped)) throw e;
      return { problem: stoppedProblem(e.why, Math.round(TIME_LIMIT / 1000), e.detail) };
    });

  // ---- the assistant: describe what you want, and the blocks change ----
  let model: LocalModel = new WebLlm();
  chat = createChat({
    get model() {
      return model;
    },
    program: () => program,
    problem: () => problem,
    files: () => files,
    uiMode: currentMode,
    checker: () => (engine.ready() ? check : undefined),
    apply(next) {
      history.record(program);
      if (!program.length) fitted = false;
      setProgram(next);
    },
    undo,
  });
  document.body.appendChild(chat.element);
  /** Show or hide the assistant bar (the 3D view gets the room back) */
  const showChat = () => {
    chat!.element.style.display = aiOn ? "" : "none";
    layoutView();
  };
  showChat();

  const editor = createEditor({
    program: () => program,
    change(next, options) {
      if (options?.undoable !== false) history.record(program);
      setProgram(next);
    },
    problem: () => problem,
    files: () => Object.keys(files),
    chooseFile: (at, current, pick) =>
      openFileMenu(
        at,
        {
          files: () => files,
          setFiles: (next) => setFiles(next),
          inUse: () => new Set(allBlocks(program).flatMap((b) => (b.kind === "import" && b.args.file ? [String(b.args.file)] : []))),
        },
        current,
        pick,
      ),
    mode: currentMode,
    measurements: (blockId) => result?.measurements[blockId],
    pressButton(blockId, id) {
      if (id !== "hull") return;
      // fill an empty faces section with the faces the solid's hull is made of: a valid shape to edit from, one face at a time
      const faces = result?.hullFaces[blockId];
      if (!faces?.length) {
        say("The hull is not worked out yet: the solid has a problem (shown in red) or fewer than 4 vertices that make a solid.");
        return;
      }
      history.record(program);
      setProgram(fillFaces(program, blockId, faces));
      say(`Filled in the ${faces.length} faces of the hull, each listed counterclockwise as seen from outside. Turn on show labels on the faces to see them in the view: the outside is the solid side.`);
    },
    buttons: () => [
      // after the tabs: what acts on the blocks
      { group: "edit", label: "↶", color: "#475569", enabled: () => history.canUndo(), action: undo },
      { group: "edit", label: "↷", color: "#475569", enabled: () => history.canRedo(), action: redo },
      // the middle: how much of the interface to show
      { group: "mode", label: `${modeName} ▾`, color: "#0f766e", enabled: () => !lockedName, action: chooseMode },
      { group: "mode", label: aiOn ? "AI: on" : "AI: off", color: aiOn ? "#0f766e" : "#475569", enabled: () => lockedAi === undefined, action: toggleAi },
      // the right: the project
      { group: "file", label: "New", color: "#b45309", enabled: () => program.length > 0, action: () => { if (okToReplace("Start a new, empty program?")) replaceProgram([]); } },
      { group: "file", label: "Save", color: "#2f7fe0", enabled: () => program.length > 0, action: () => { download("design.blocks.json", serializeProject(program, files), "application/json"); markSaved(); } },
      { group: "file", label: "Load", color: "#2f7fe0", enabled: () => true, action: askForFile },
      { group: "file", label: "Demos", color: "#8e44ad", enabled: () => true, action: chooseExample },
      {
        group: "file",
        label: "STL",
        color: "#1f9d55",
        enabled: () => !!shown?.combined,
        action: () => shown?.combined && download("part.stl", writeStl(shown.combined.mesh), "model/stl"),
      },
      // the same Ko-fi page as the tutorials' "Support me" link
      { group: "file", label: "Support Me", color: "#00b9fe", enabled: () => true, action: () => void window.open(SUPPORT_URL, "_blank", "noopener,noreferrer") },
    ],
  });

  // Ctrl+Z and Ctrl+Y, except while typing in a field
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) undo();
    else if (k === "y" || (k === "z" && e.shiftKey)) redo();
    else return;
    e.preventDefault();
  });

  // ---- start: bring back the last program, and load the 3D engine ----
  try {
    const savedFiles = readStored(FILES_KEY);
    if (savedFiles) {
      const parsed: unknown = JSON.parse(savedFiles);
      validateFiles(parsed);
      files = parsed;
    }
    const savedProgram = readStored(STORAGE_KEY);
    if (savedProgram) program = parseProject(savedProgram).program;
  } catch {
    // nothing saved, or it cannot be read: start empty
  }
  editor.refresh();
  // the engine loads (with the text block's fonts) while the first run waits for it
  run();

  // ---- a program in the page address (...#p=...): from a link in the book, or one a person was sent ----
  async function openLink() {
    const value = linkValue(location.hash);
    if (value === undefined) return;
    // take it out of the address, so reloading the page does not bring it back over the person's changes
    window.history.replaceState(null, "", location.pathname + location.search);
    try {
      const loaded = await decodeLink(value);
      if (!okToReplace("Open the program from this link?")) return;
      replaceProgram(loaded, {});
      noteHiddenBlocks();
    } catch (e) {
      say(`The link could not be opened: ${(e as Error).message}`);
    }
  }
  void openLink();
  window.addEventListener("hashchange", () => void openLink());

  // for tests and the curious
  (window as unknown as { __cadfly: unknown }).__cadfly = { get program() { return program; }, get problem() { return problem; }, get ready() { return engine.ready(); }, engine, editor, FONT, get chat() { return chat; }, setModel(m: LocalModel) { model = m; } };
}

initializeAndLaunch("game-player", new Config(), builder);
