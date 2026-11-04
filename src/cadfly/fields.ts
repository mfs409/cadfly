import type { Param } from "./language/types";

/** Where on the page (in CSS pixels) a field is */
export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

let closeCurrent: (() => void) | undefined;
let closeInfo: (() => void) | undefined;

/**
 * A small pop-up under a chip (the "?" on a measure block): a title and some lines. It closes when you click or press a key
 * anywhere, or open another.
 */
export function openInfo(at: PageRect, title: string, lines: string[]) {
  closeInfo?.();
  const box = document.createElement("div");
  box.style.cssText =
    `position:fixed;z-index:1001;box-sizing:border-box;left:${Math.round(at.left)}px;top:${Math.round(at.top + at.height + 4)}px;` +
    "max-width:360px;padding:8px 10px;border:2px solid #0f766e;border-radius:8px;background:#0d1322;color:#e6edf7;" +
    "font:13px/1.45 sans-serif;box-shadow:0 4px 14px #0008;white-space:pre-wrap";
  const head = document.createElement("div");
  head.textContent = title;
  head.style.cssText = "font-weight:bold;margin-bottom:4px";
  const body = document.createElement("div");
  body.textContent = lines.join("\n");
  body.style.fontFamily = "monospace";
  box.append(head, body);
  document.body.appendChild(box);
  // keep it on the page: if it would run off the right edge, move it left
  const over = box.getBoundingClientRect().right - (window.innerWidth - 8);
  if (over > 0) box.style.left = `${Math.max(8, Math.round(at.left - over))}px`;
  const close = () => {
    box.remove();
    document.removeEventListener("pointerdown", close, true);
    document.removeEventListener("keydown", close, true);
    closeInfo = undefined;
  };
  closeInfo = close;
  // not on the pointer-down that opened it
  setTimeout(() => {
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", close, true);
  }, 0);
}

/** Close the field editor without changing anything */
function closeFieldEditor() {
  closeCurrent?.();
}

/**
 * Edit one field of a block.  JetLag has no text entry, so this puts a real
 * `<input>` (or a `<select>`, for a choice) over the field.  Enter or clicking
 * away keeps what was typed; Escape throws it away.
 */
export function openFieldEditor(req: {
  rect: PageRect;
  param: Param;
  value: string;
  onCommit: (value: string) => void;
  /** Tab (1) or Shift+Tab (-1) was pressed: what was typed is kept, and this is asked to open the next or previous field */
  onTab?: (direction: 1 | -1) => void;
  /** Is there a field to go to that way? At the first and last field Tab does nothing, and the field stays open. */
  canTab?: (direction: 1 | -1) => boolean;
}) {
  closeFieldEditor();
  const { rect, param } = req;
  const choice = param.type.kind === "choice";
  let suggestions: HTMLDataListElement | undefined;
  const el = document.createElement(choice ? "select" : "input");
  el.style.cssText =
    `position:fixed;z-index:1000;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;` +
    `width:${Math.max(rect.width, 110)}px;height:${rect.height}px;font:${Math.max(12, rect.height * 0.62)}px sans-serif;` +
    "border:2px solid #2f7fe0;border-radius:6px;padding:0 6px;background:#fff;color:#1f2842";

  if (el instanceof HTMLSelectElement && param.type.kind === "choice") {
    for (const o of param.type.options) el.add(new Option(o.label, o.value));
    el.value = req.value;
  } else if (el instanceof HTMLInputElement) {
    el.type = "text";
    el.value = req.value;
    el.spellcheck = false;
    el.autocomplete = "off";
    // a field with suggestions (a font) offers them as you type, and takes anything else typed too
    if (param.type.kind === "text" && param.type.suggestions) {
      const list = document.createElement("datalist");
      list.id = "field-suggestions";
      for (const s of param.type.suggestions) list.appendChild(new Option(s, s));
      el.setAttribute("list", list.id);
      // the box starts empty, so the browser shows every suggestion; the old value is the placeholder, and kept if nothing is typed
      el.value = "";
      el.placeholder = req.value;
      suggestions = list;
      document.body.appendChild(list);
    }
  }

  let finished = false;
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    closeCurrent = undefined;
    const value = el.value || (suggestions ? req.value : "");
    el.remove();
    suggestions?.remove();
    if (commit && value !== req.value) req.onCommit(value);
  };
  closeCurrent = () => finish(false);

  if (choice) {
    el.addEventListener("change", () => finish(true));
    el.addEventListener("blur", () => finish(false));
  } else {
    el.addEventListener("blur", () => finish(true));
  }
  el.addEventListener("keydown", (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === "Enter") finish(true);
    else if (key === "Escape") finish(false);
    else if (key === "Tab" && req.onTab) {
      e.preventDefault(); // not the browser's own tab, which would leave the game
      const direction = (e as KeyboardEvent).shiftKey ? -1 : 1;
      if (req.canTab && !req.canTab(direction)) return e.stopPropagation();
      finish(true);
      req.onTab(direction);
    }
    e.stopPropagation(); // keys typed here are not for the game
  });

  document.body.appendChild(el);
  el.focus();
  if (el instanceof HTMLInputElement) el.select();
  else (el as HTMLSelectElement).showPicker?.();
}
