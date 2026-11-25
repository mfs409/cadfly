import type { Param } from "../language/types";
import { ACCENT, INPUT_BG, type PageRect, el, showPopup } from "./dom";
import { valueToKeep } from "./rules";

/**
 * Pop-ups made of real page elements that open over the workspace, because the
 * game engine has no text entry: one to edit a single block field, and one to
 * show a few lines of information. Only one of each is open at a time, and
 * opening another closes the first.
 */

/** Closes the field editor that is open, if one is. */
let closeCurrent: (() => void) | undefined;

/**
 * A small pop-up under a chip (the "?" on a measure block): a title and some
 * lines. It closes when you click or press a key anywhere, or open another.
 *
 * @param at Where the chip is on the page.
 * @param title The bold line at the top.
 * @param lines What it says under the title, one per line.
 */
export function openInfo(at: PageRect, title: string, lines: string[]) {
  const box = el(
    "div",
    `position:fixed;z-index:1001;box-sizing:border-box;left:${Math.round(at.left)}px;top:${Math.round(at.top + at.height + 4)}px;` +
      `max-width:360px;padding:8px 10px;border:2px solid #0f766e;border-radius:8px;background:${INPUT_BG};color:#e6edf7;` +
      "font:13px/1.45 sans-serif;box-shadow:0 4px 14px #0008;white-space:pre-wrap",
  );
  box.append(el("div", "font-weight:bold;margin-bottom:4px", title), el("div", "font-family:monospace", lines.join("\n")));
  showPopup(box, { slot: "info", clickInsideCloses: true, anyKeyCloses: true });
  // keep it on the page: if it would run off the right edge, move it left
  const over = box.getBoundingClientRect().right - (window.innerWidth - 8);
  if (over > 0) box.style.left = `${Math.max(8, Math.round(at.left - over))}px`;
}

/**
 * Edit one field of a block.  JetLag has no text entry, so this puts a real
 * `<input>` (or a `<select>`, for a choice) over the field.  Enter or clicking
 * away keeps what was typed; Escape throws it away.
 *
 * @param req What to edit: where the field is on the page, the field, the value
 *            it holds, and what to do with a new value or a Tab.
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
  closeCurrent?.();
  const { rect, param } = req;
  const choice = param.type.kind === "choice";
  let suggestions: HTMLDataListElement | undefined;
  const input = el(choice ? "select" : "input");
  input.style.cssText =
    `position:fixed;z-index:1000;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;` +
    `width:${Math.max(rect.width, 110)}px;height:${rect.height}px;font:${Math.max(12, rect.height * 0.62)}px sans-serif;` +
    `border:2px solid ${ACCENT};border-radius:6px;padding:0 6px;background:#fff;color:#1f2842`;

  if (input instanceof HTMLSelectElement && param.type.kind === "choice") {
    for (const o of param.type.options) input.add(new Option(o.label, o.value));
    input.value = req.value;
  } else if (input instanceof HTMLInputElement) {
    input.type = "text";
    input.value = req.value;
    input.spellcheck = false;
    input.autocomplete = "off";
    // a field with suggestions (a font) offers them as you type, and takes anything else typed too
    if (param.type.kind === "text" && param.type.suggestions) {
      const list = el("datalist");
      list.id = "field-suggestions";
      for (const s of param.type.suggestions) list.appendChild(new Option(s, s));
      input.setAttribute("list", list.id);
      // the box starts empty, so the browser shows every suggestion; the old value is the placeholder, and kept if nothing is typed
      input.value = "";
      input.placeholder = req.value;
      suggestions = list;
      document.body.appendChild(list);
    }
  }

  let finished = false;
  /**
   * Close the editor, keeping what was typed only if `commit`, and only if it
   * is different from what was there. Runs at most once.
   */
  const finish = (commit: boolean) => {
    if (finished) return;
    finished = true;
    closeCurrent = undefined;
    const value = valueToKeep(input.value, req.value, suggestions !== undefined);
    input.remove();
    suggestions?.remove();
    if (commit && value !== undefined) req.onCommit(value);
  };
  closeCurrent = () => finish(false);

  // A drop-down keeps its choice as soon as one is made, and a text box keeps what was typed when
  // it loses focus. A drop-down that loses focus first keeps nothing.
  if (choice) {
    input.addEventListener("change", () => finish(true));
    input.addEventListener("blur", () => finish(false));
  } else {
    input.addEventListener("blur", () => finish(true));
  }
  // Enter keeps the value and Escape drops it. Tab keeps it and moves to the next field, when
  // there is one to go to. No key typed here is for the game.
  input.addEventListener("keydown", (e) => {
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

  document.body.appendChild(input);
  input.focus();
  if (input instanceof HTMLInputElement) input.select();
  else {
    try {
      (input as HTMLSelectElement).showPicker?.(); // the browser may refuse to open it without a click
    } catch {
      // the drop-down stays closed: tapping it opens it
    }
  }
}
