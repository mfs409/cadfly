/**
 * Small helpers for building pages out of plain DOM elements: a function that
 * makes an element, the colors such pages share, and pop-ups that close
 * themselves.
 */

/** The color of text on the dark panels */
export const INK = "#e6ebf5";
/** The color of secondary text on the dark panels */
export const MUTED = "#9aa7c0";
/** The background of the dark panels */
export const PANEL = "#141b2d";
/** The color of the lines that divide a panel */
export const LINE = "#2b3652";
/** The background of text boxes, pop-ups and other things set into a panel */
export const INPUT_BG = "#0d1322";
/** The color of text that says something went wrong */
export const ERROR_TEXT = "#f19a9a";
/** The color of text that says to take care, or that something is not final */
export const WARNING_TEXT = "#f1c27a";
/** The color of text that says something worked */
export const GOOD_TEXT = "#8fd19e";
/** The color of a button that goes ahead (Connect, Start, Apply) */
export const GO_BUTTON = "#1f9d55";
/** The color of a button that does nothing drastic (Reject, Undo, Forget) */
export const QUIET_BUTTON = "#475569";
/** The color of the line around an open pop-up or field, and of the main button */
export const ACCENT = "#2f7fe0";

/**
 * Make a DOM element.
 *
 * @param tag The kind of element, such as "div" or "button".
 * @param css Its style, as the text of a `style` attribute (default: none).
 * @param text What it says, as plain text, not HTML (default: nothing).
 * @returns The new element, not attached to the page yet.
 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, css = "", text = "") {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

/** Where on the page (in CSS pixels) a rectangle is */
export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The close function of the pop-up that is open in each slot, if one is */
const openPopups = new Map<string, () => void>();

/** How a pop-up closes itself, besides when another opens in its slot */
export interface PopupOptions {
  /**
   * Which pop-ups share a place on the page: opening one closes the one that is
   * open in the same slot.
   */
  slot: string;
  /** Does a click inside the pop-up close it too? By default only a click outside does. */
  clickInsideCloses?: boolean;
  /** Does any key close it? By default only Escape does. */
  anyKeyCloses?: boolean;
  /** Are the keys pressed while it is open kept from the rest of the page (default no)? */
  keepKeysFromPage?: boolean;
  /**
   * Does it ignore clicks made with a mouse or a finger for a moment after it
   * opens (default no)? On a touch screen the browser sends a mouse click to
   * whatever is under the finger some time after the tap that opened the
   * pop-up, which would press whatever of the pop-up's buttons is there. Clicks
   * made with the keyboard (Enter or Space) are never ignored.
   */
  ignoreEarlyTaps?: boolean;
}

/**
 * How long, in milliseconds, a pop-up that ignores early taps does so. Browsers
 * send the click that follows a tap within about 300 ms of it.
 */
export const EARLY_TAP_MS = 350;

/**
 * Put an element on the page as a pop-up that closes itself: on a click outside
 * it (or inside, if asked), on Escape (or any key, if asked), or when another
 * pop-up opens in the same slot. The pop-up is not closed by the click that
 * opened it. Closing removes the element and the listeners it added.
 *
 * @param root The pop-up's element, which is added to the page.
 * @param options How it closes.
 * @returns A function that closes the pop-up.
 */
export function showPopup(root: HTMLElement, options: PopupOptions): () => void {
  openPopups.get(options.slot)?.();
  document.body.appendChild(root);
  let closed = false;
  /** A click closes it if it is outside, or if a click inside closes it too. */
  const onPointer = (e: Event) => {
    if (options.clickInsideCloses || !root.contains(e.target as Node)) close();
  };
  /** A key closes it if it is Escape, or if any key does. */
  const onKey = (e: KeyboardEvent) => {
    if (options.anyKeyCloses || e.key === "Escape") close();
    if (options.keepKeysFromPage) e.stopPropagation();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener("pointerdown", onPointer, true);
    document.removeEventListener("keydown", onKey, true);
    if (openPopups.get(options.slot) === close) openPopups.delete(options.slot);
  };
  openPopups.set(options.slot, close);
  if (options.ignoreEarlyTaps) {
    const openedAt = Date.now();
    // a click made with a pointer has a count of one or more, and one made with the keyboard has none
    root.addEventListener(
      "click",
      (e) => {
        if (e.detail > 0 && Date.now() - openedAt < EARLY_TAP_MS) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true,
    );
  }
  // not on the click that opened it (and not at all if it was closed in the meantime)
  setTimeout(() => {
    if (closed) return;
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return close;
}
