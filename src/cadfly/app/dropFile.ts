import { PROJECT_EXTENSION, isProjectFileName } from "../language/format";
import { ACCENT, el } from "../ui/dom";

/**
 * Opening a project by dropping its file anywhere on the page. While a file is
 * being dragged over the page, a message says where to drop it; a drag that
 * carries no file (text or a link dragged around on the page) is left alone.
 */

/** Which of the dropped files to open, and how many others are left out. */
export interface DropPlan {
  /** The position, among the dropped files, of the one to open. */
  index: number;
  /** How many of the other dropped files are left unopened. */
  ignored: number;
}

/**
 * Choose the file to open from the files that were dropped: the first one with
 * a project file's name. When none has one, the first file is chosen, so that
 * opening it reports that it is not a project file.
 *
 * @param names The names of the dropped files, in the order they were dropped.
 * @returns The choice, or nothing when no file was dropped.
 */
export function planDrop(names: readonly string[]): DropPlan | undefined {
  if (!names.length) return undefined;
  const found = names.findIndex(isProjectFileName);
  return { index: found < 0 ? 0 : found, ignored: names.length - 1 };
}

/**
 * What to tell the person after one file of several was opened.
 *
 * @param name The name of the file that was opened.
 * @param ignored How many other dropped files were left unopened (at least one).
 */
export function ignoredNote(name: string, ignored: number): string {
  return `Opened ${name}. ${ignored === 1 ? "The other file you dropped was" : `The other ${ignored} files you dropped were`} not opened: only one project can be open.`;
}

/** What dropping a file needs from the page. */
export interface DropHost {
  /**
   * Open the file as a project, as the Load button does.
   *
   * @returns True if it was opened.
   */
  open(file: File): Promise<boolean>;
  /** Say something to the person. */
  notify(message: string): void;
}

/**
 * Does a drag carry files? It is the only kind of drag that opening a project
 * has anything to do with.
 *
 * @param event A drag event.
 */
function carriesFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * The message shown over the page while a file is dragged across it. It lets
 * pointer events through, so it never changes which element is under the drag.
 */
function makeCue(): HTMLElement {
  const cue = el("div", "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:24px;background:rgba(15,23,42,0.72);pointer-events:none");
  cue.append(el("div", `padding:28px 36px;border:4px dashed ${ACCENT};border-radius:16px;background:#14305a;color:#fff;font:bold 26px/1.3 sans-serif;text-align:center`, `Drop a ${PROJECT_EXTENSION} file to open it`));
  return cue;
}

/**
 * Open a project when its file is dropped on the page. The browser's own
 * handling of a dropped file (leaving the page to show it) is turned off for
 * drags that carry files.
 *
 * @param host What opening a file needs from the page.
 * @param page The page to watch (the document by default).
 * @returns A function that stops watching and takes the message away.
 */
export function watchDrops(host: DropHost, page: Document = document): () => void {
  /** The message over the page, while there is one. */
  let cue: HTMLElement | undefined;
  /**
   * How many elements the drag has entered and not yet left. Entering a child
   * element fires before leaving its parent, so the drag has left the page only
   * when this is back to zero.
   */
  let depth = 0;

  /** Take the message away and forget what the drag entered. */
  const finish = () => {
    depth = 0;
    cue?.remove();
    cue = undefined;
  };
  const onEnter = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth++;
    if (!cue) page.body.appendChild((cue = makeCue()));
  };
  const onOver = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    e.preventDefault(); // without this the page does not accept the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const onLeave = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) finish();
  };
  const onDrop = async (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    finish();
    const files = Array.from(e.dataTransfer?.files ?? []);
    const plan = planDrop(files.map((f) => f.name));
    if (!plan) return;
    const file = files[plan.index];
    if ((await host.open(file)) && plan.ignored) host.notify(ignoredNote(file.name, plan.ignored));
  };

  const events: [string, (e: DragEvent) => void][] = [
    ["dragenter", onEnter],
    ["dragover", onOver],
    ["dragleave", onLeave],
    ["drop", onDrop],
    ["dragend", finish],
  ];
  // listening in the capture phase, so that nothing on the page can keep a drop from being seen
  for (const [name, handler] of events) page.addEventListener(name, handler as EventListener, true);
  return () => {
    for (const [name, handler] of events) page.removeEventListener(name, handler as EventListener, true);
    finish();
  };
}
