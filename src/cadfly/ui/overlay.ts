import { ACCENT, INK, INPUT_BG, LINE, MUTED, PANEL, QUIET_BUTTON, el, showPopup } from "./dom";

/**
 * A choice laid out as cards over the whole page: a title, then a scrolling list
 * of cards, each with a name, a few words about it, and one or more buttons. It
 * closes on a click outside the cards, on Escape, on its Close button, or after
 * a card's button is pressed. It can also have check boxes above the cards,
 * which a card's button reads when it is pressed.
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
  /** The buttons, left to right */
  actions: CardAction[];
}

/**
 * Open an overlay of cards. Only one is open at a time: opening another closes
 * the first.
 *
 * @param title The bold line at the top.
 * @param cards The cards, top to bottom.
 * @param toggles The check boxes above the cards, top to bottom.
 * @returns A function that closes it.
 */
export function openCards(title: string, cards: Card[], toggles: Toggle[] = []): () => void {
  const backdrop = el("div", "position:fixed;inset:0;z-index:1002;display:flex;align-items:center;justify-content:center;background:#0009;padding:16px;box-sizing:border-box");
  const panel = el("div", `display:flex;flex-direction:column;box-sizing:border-box;width:min(560px,100%);max-height:100%;border:1px solid ${LINE};border-radius:12px;background:${PANEL};color:${INK};font:14px/1.4 sans-serif;box-shadow:0 8px 28px #000a`);
  const head = el("div", `display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid ${LINE}`);
  head.append(el("div", "font-size:17px;font-weight:bold", title));
  const list = el("div", "overflow-y:auto;padding:10px 12px 14px;display:flex;flex-direction:column;gap:8px");
  panel.append(head, list);
  backdrop.append(panel);

  /** Closes the overlay; set once it is on the page, since the buttons made before then close it too. */
  let close = () => {};
  const closeButton = el("button", `min-height:36px;min-width:36px;border:0;border-radius:8px;background:${QUIET_BUTTON};color:#fff;font:14px sans-serif;cursor:pointer`, "Close");
  closeButton.onclick = () => close();
  head.append(closeButton);

  const boxes = toggles.map((toggle) => {
    const row = el("label", "display:flex;align-items:center;gap:10px;min-height:44px;padding:0 4px;cursor:pointer");
    const input = el("input", "width:22px;height:22px");
    input.type = "checkbox";
    input.checked = toggle.ticked === true;
    row.append(input, toggle.label);
    list.append(row);
    return input;
  });

  for (const card of cards) {
    const box = el("div", `display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:8px;background:${INPUT_BG};border:2px solid ${card.marked ? ACCENT : LINE}`);
    const name = el("div", "display:flex;gap:8px;align-items:baseline");
    name.append(el("span", "font-weight:bold;font-size:15px", card.title));
    if (card.tag) name.append(el("span", `font-size:12px;color:${ACCENT}`, card.tag));
    const buttons = el("div", "display:flex;gap:8px;flex-wrap:wrap");
    for (const action of card.actions) {
      const button = el("button", `min-height:44px;padding:0 16px;border:0;border-radius:8px;background:${action.color ?? ACCENT};color:#fff;font:14px sans-serif;cursor:pointer`, action.label);
      button.onclick = () => {
        const on = boxes.map((b) => b.checked);
        close();
        action.run(on);
      };
      buttons.append(button);
    }
    box.append(name, el("div", `color:${MUTED}`, card.description), buttons);
    list.append(box);
  }

  // clicks and keys do not reach the editor underneath
  for (const type of ["pointerdown", "pointerup", "wheel", "touchstart"]) backdrop.addEventListener(type, (e) => e.stopPropagation());
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  close = showPopup(backdrop, { slot: "cards", keepKeysFromPage: true });
  return () => close();
}
