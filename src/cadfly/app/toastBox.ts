import { type ToastFacts, type ToastModel, NEW_TOAST, toastDismissed, toastNoticeCleared, toastNoticeExpired, toastTold, viewToast } from "../toast";
import { el } from "../ui/dom";

/**
 * The message box over the workspace: what is wrong with the program, what
 * just happened, or that a build is going on. It is a box and not a line in a
 * bar, so that a long message can be read in full. It can be dismissed, and a
 * notice goes away after a few seconds. What it says and when it is shown are
 * decided by plain rules that need no page; this makes them visible.
 */

/** How long (ms) a notice stays up. */
const NOTICE_LIFE = 9000;

/** What the message box offers. */
export interface ToastBox {
  /** The page element, to be placed over the canvas */
  element: HTMLElement;
  /** Give a notice: it is shown even if the same words were dismissed before. */
  say(message: string): void;
  /** Take the notice away and draw the box again (the program changed). */
  clear(): void;
  /** Take the notice away without drawing the box again (the editor is about to be). */
  forget(): void;
  /** Draw the box again: what is going on may have changed. */
  refresh(): void;
}

/**
 * Make the message box.
 *
 * @param facts What is going on besides the notice, asked whenever the box is
 *              drawn.
 * @param onStop Called when the Stop button is pressed.
 */
export function createToastBox(facts: () => ToastFacts, onStop: () => void): ToastBox {
  const box = el("div", "position:fixed;z-index:6;display:none;box-sizing:border-box;padding:8px 34px 8px 12px;border-radius:8px;font:14px/1.4 sans-serif;white-space:pre-wrap;box-shadow:0 4px 14px #0008");
  /** The x that dismisses the message. */
  const close = el("button", "position:absolute;right:6px;top:2px;background:none;border:0;color:inherit;font:20px sans-serif;cursor:pointer", "×");
  close.title = "Dismiss";
  /** The words of the message. */
  const words = el("span");
  /** The Stop button, shown while a build is going on. */
  const stop = el("button", "margin-left:10px;padding:2px 10px;border:1px solid #ffffff60;border-radius:5px;background:#ffffff18;color:inherit;font:13px sans-serif;cursor:pointer", "Stop");
  stop.onclick = onStop;
  box.append(words, stop, close);
  for (const type of ["pointerdown", "wheel", "keydown"]) box.addEventListener(type, (e) => e.stopPropagation());
  document.body.appendChild(box);
  /** What the box has been told and has shown. */
  let model: ToastModel = NEW_TOAST;
  /** The timer that takes a notice away after a few seconds. */
  let expiry = 0;

  /** Draw the box as the rules say, and keep the notice's timer. */
  function refresh() {
    const next = viewToast(model, facts());
    model = next.model;
    const view = next.view;
    stop.style.display = view.showStop ? "" : "none";
    if (!view.visible) {
      box.style.display = "none";
      return;
    }
    words.textContent = (view.isProblem ? "⚠ " : "") + view.text;
    box.style.background = view.isProblem ? "#4a1d24" : "#1d2a44";
    box.style.color = view.isProblem ? "#ffc9c9" : "#d8e2f5";
    box.style.border = `1px solid ${view.isProblem ? "#ff6b6b" : "#3a4a70"}`;
    box.style.display = "";
    clearTimeout(expiry);
    if (view.expires) {
      expiry = window.setTimeout(() => {
        model = toastNoticeExpired(model);
        refresh();
      }, NOTICE_LIFE);
    }
  }

  close.onclick = () => {
    model = toastDismissed(model);
    box.style.display = "none";
  };

  return {
    element: box,
    say(message) {
      model = toastTold(model, message);
      refresh();
    },
    clear() {
      model = toastNoticeCleared(model);
      refresh();
    },
    forget() {
      model = toastNoticeCleared(model);
    },
    refresh,
  };
}
