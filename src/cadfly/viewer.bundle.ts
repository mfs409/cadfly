// The viewer: a page (cadfly-viewer.html) that shows the one program in its address (...#p=..., see language/link.ts) in 3D, and nothing
// else: no editor, no JetLag, no assistant. A book can put it in an iframe next to a picture of the blocks. It is built as its own file,
// viewer.bundle.js, and uses the same engine worker (engine.bundle.js) and files as the app, so a reader who has seen one has them for the other.
import { Stopped, TIME_LIMIT, createEngine, createFontRequester, stoppedProblem } from "./engine";
import { decodeLink, linkValue } from "./language/link";
import type { Program } from "./language/types";
import { MUTED, el } from "./view/dom";
import { createGizmo } from "./view/gizmo";
import { displayShapes, readoutText, showOverlays } from "./view/show";
import { Viewer } from "./view/viewer";

const page = document.getElementById("viewer")!;
page.style.cssText = "position:fixed;inset:0;overflow:hidden";
const viewer = new Viewer(page);
createGizmo(viewer);

const chip = "position:absolute;padding:4px 10px;border-radius:6px;background:rgba(20,27,45,.82);color:#e6ebf5;font:12px/1.4 monospace;";
const readout = el("div", `${chip}left:8px;top:8px;pointer-events:none;white-space:pre;display:none`);
const note = el("div", `${chip}left:8px;bottom:8px;right:200px;font:13px/1.4 sans-serif;white-space:pre-wrap;display:none`);
const buttons = "position:absolute;bottom:10px;padding:5px 12px;border:1px solid #00000030;border-radius:6px;background:rgba(20,27,45,.82);color:#e6ebf5;font:13px sans-serif;cursor:pointer;text-decoration:none;";
const fit = el("button", `${buttons}right:10px`, "Fit");
fit.title = "Frame the whole model in the view";
fit.onclick = () => viewer.fitToView();
const open = el("a", `${buttons}right:60px;display:none`, "Open in cadfly ↗") as HTMLAnchorElement;
open.title = "Open this program in the editor, in a new tab";
open.target = "_blank";
open.rel = "noopener";
page.append(readout, note, fit, open);

const say = (text: string, bad = false) => {
  note.textContent = text;
  note.style.color = bad ? "#f19a9a" : MUTED;
  note.style.display = text ? "" : "none";
};

const engine = createEngine();
const requestFonts = createFontRequester(engine, () => build());
let program: Program | undefined;
/** Which build is the latest: an answer to an earlier one (the link changed, or a font arrived) is dropped */
let latest = 0;
let fitted = false;

/** Read the program from the address, and show it */
async function load() {
  const value = linkValue(location.hash);
  program = undefined;
  latest++;
  fitted = false;
  readout.style.display = open.style.display = "none";
  viewer.setShapes([]);
  viewer.setOverlays([], []);
  if (value === undefined) return say("There is nothing to show: this page shows the program in its address (...#p=...).");
  try {
    program = await decodeLink(value);
  } catch (e) {
    return say(`The link could not be opened: ${(e as Error).message}`, true);
  }
  open.href = `${document.body.dataset.app ?? "./"}#p=${value.startsWith("{") ? encodeURIComponent(value) : value}`;
  open.style.display = "";
  build();
}

function build() {
  if (!program) return;
  const mine = ++latest;
  const made = program;
  say("Building...");
  engine.run(made, {}).then(
    (r) => {
      if (mine !== latest) return;
      const items = displayShapes(r);
      showOverlays(viewer, r, r.problem);
      // a program that fails to build should not blank the view
      if (items.length || !r.problem) viewer.setShapes(items);
      const text = readoutText(r);
      readout.style.display = text === undefined ? "none" : "";
      if (text !== undefined) readout.textContent = text;
      if (items.length && !fitted) (viewer.fitToView(), (fitted = true));
      say(r.problem?.message ?? "", !!r.problem);
      requestFonts(made);
    },
    (e) => {
      if (!(e instanceof Stopped)) throw e;
      if (mine === latest) say(stoppedProblem(e.why, Math.round(TIME_LIMIT / 1000), e.detail).message, true);
    },
  );
}

window.addEventListener("hashchange", () => void load());
void load();
// for tests and the curious
(window as unknown as { __cadflyViewer: unknown }).__cadflyViewer = { get program() { return program; }, get ready() { return engine.ready(); } };
