import { ACCENT, INK, INPUT_BG, LINE, MUTED, PANEL, QUIET_BUTTON, el, showPopup } from "./dom";

/**
 * A choice laid out as cards over the whole page: a title, then a scrolling list
 * of cards, each with a name and a few words about it. A card with one choice is
 * a button as a whole: tapping anywhere on it, or pressing Enter or Space when
 * it has the focus, makes the choice. A card with several choices has a button
 * for each. The overlay closes on a click outside the cards, on Escape, on its
 * Close button, or after a choice is made. It can also have check boxes above
 * the cards, which a choice reads when it is made. For a moment after it opens
 * it ignores taps and mouse clicks, so that the click a touch screen sends after
 * the tap that opened it cannot make a choice.
 */

/** A button on a card */
export interface CardAction {
  /** What the button says */
  label: string;
  /** Its color (default: the accent color) */
  color?: string;
  /**
   * What pressing it does, after the overlay has closed.
   *
   * @param on Whether each check box was ticked, in the order they were given.
   */
  run(on: boolean[]): void;
}

/** A check box above the cards */
export interface Toggle {
  /** What it says */
  label: string;
  /** Is it ticked when the overlay opens? */
  ticked?: boolean;
}

/** One card in an overlay */
export interface Card {
  /** The card's name */
  title: string;
  /** A few words about it */
  description: string;
  /** A small tag beside the name ("current"), if there is one */
  tag?: string;
  /** Draw the card as the one in force */
  marked?: boolean;
  /**
   * What tapping the card does, after the overlay has closed, for a card with
   * one choice. The card is then a button as a whole, and has no other buttons.
   * A card that only closes the overlay, such as the one in force, can pass a
   * function that does nothing.
   *
   * @param on Whether each check box was ticked, in the order they were given.
   */
  pick?(on: boolean[]): void;
  /** The buttons of a card with several choices, left to right (not used with `pick`) */
  actions?: CardAction[];
}

/** How an overlay is laid out */
export interface CardsOptions {
  /**
   * Lay the cards out in as many equal columns as fit, in a panel wide enough
   * for three, with the buttons at the bottom of each card. By default the cards
   * are one narrow column.
   */
  wide?: boolean;
}

/** The narrowest a card in a wide overlay is, in pixels, before there is room for one column fewer */
const MIN_CARD_WIDTH = 300;

/** The background of a card that can be tapped, while the pointer is over it */
const HOVER_BG = "#16203a";
/** The background of a card that can be tapped, while it is pressed */
const PRESSED_BG = "#1d2b4d";

/**
 * Open an overlay of cards. Only one is open at a time: opening another closes
 * the first.
 *
 * @param title The bold line at the top.
 * @param cards The cards, top to bottom.
 * @param toggles The check boxes above the cards, top to bottom.
 * @param options How the cards are laid out.
 * @returns A function that closes it.
 */
export function openCards(title: string, cards: Card[], toggles: Toggle[] = [], options: CardsOptions = {}): () => void {
  const wide = options.wide === true;
  const backdrop = el("div", "position:fixed;inset:0;z-index:1002;display:flex;align-items:center;justify-content:center;background:#0009;padding:16px;box-sizing:border-box");
  const panel = el("div", `display:flex;flex-direction:column;box-sizing:border-box;width:min(${wide ? 1000 : 640}px,100%);max-height:100%;border:1px solid ${LINE};border-radius:12px;background:${PANEL};color:${INK};font:16px/1.4 sans-serif;box-shadow:0 8px 28px #000a`);
  const head = el("div", `display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid ${LINE}`);
  head.append(el("div", "font-size:20px;font-weight:bold", title));
  const list = el(
    "div",
    wide
      ? `overflow-y:auto;padding:10px 12px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(${MIN_CARD_WIDTH}px,100%),1fr));gap:10px;align-items:stretch`
      : "overflow-y:auto;padding:10px 12px 14px;display:flex;flex-direction:column;gap:8px",
  );
  panel.append(head, list);
  backdrop.append(panel);

  /** Closes the overlay; set once it is on the page, since the buttons made before then close it too. */
  let close = () => {};
  const closeButton = el("button", `min-height:44px;min-width:44px;padding:0 12px;border:0;border-radius:8px;background:${QUIET_BUTTON};color:#fff;font:16px sans-serif;cursor:pointer`, "Close");
  closeButton.onclick = () => close();
  head.append(closeButton);

  const boxes = toggles.map((toggle) => {
    const row = el("label", `display:flex;align-items:center;gap:10px;min-height:44px;padding:0 4px;cursor:pointer;${wide ? "grid-column:1/-1;" : ""}`);
    const input = el("input", "width:22px;height:22px");
    input.type = "checkbox";
    input.checked = toggle.ticked === true;
    row.append(input, toggle.label);
    list.append(row);
    return input;
  });

  for (const card of cards) {
    const { pick } = card;
    const border = card.marked ? ACCENT : LINE;
    const look = `display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:8px;background:${INPUT_BG};border:2px solid ${border}`;
    // a card with one choice is a button as a whole, so that it is focusable and Enter and Space work as they do for any button
    const box = pick ? el("button", `${look};width:100%;min-height:44px;text-align:left;color:inherit;font:inherit;cursor:pointer`) : el("div", look);
    if (pick) {
      box.onpointerenter = () => (box.style.background = HOVER_BG);
      box.onpointerleave = () => (box.style.background = INPUT_BG);
      box.onpointerdown = () => (box.style.background = PRESSED_BG);
      box.onpointerup = () => (box.style.background = HOVER_BG);
      box.onclick = () => {
        const on = boxes.map((b) => b.checked);
        close();
        pick(on);
      };
    }
    const name = el("span", "display:flex;gap:8px;align-items:baseline");
    name.append(el("span", "font-weight:bold;font-size:18px", card.title));
    if (card.tag) name.append(el("span", `font-size:14px;color:${ACCENT}`, card.tag));
    box.append(name, el(pick ? "span" : "div", `color:${MUTED};font-size:16px`, card.description));
    if (!pick && card.actions?.length) {
      const buttons = el("div", "display:flex;gap:8px;flex-wrap:wrap;margin-top:auto;padding-top:4px");
      for (const action of card.actions) {
        const button = el("button", `min-height:44px;padding:0 16px;border:0;border-radius:8px;background:${action.color ?? ACCENT};color:#fff;font:16px sans-serif;cursor:pointer`, action.label);
        button.onclick = () => {
          const on = boxes.map((b) => b.checked);
          close();
          action.run(on);
        };
        buttons.append(button);
      }
      box.append(buttons);
    }
    list.append(box);
  }

  // clicks and keys do not reach the editor underneath
  for (const type of ["pointerdown", "pointerup", "wheel", "touchstart"]) backdrop.addEventListener(type, (e) => e.stopPropagation());
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  close = showPopup(backdrop, { slot: "cards", keepKeysFromPage: true, ignoreEarlyTaps: true });
  return () => close();
}
