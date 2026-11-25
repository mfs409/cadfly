// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EARLY_TAP_MS } from "../src/cadfly/ui/dom";
import { type Card, openCards } from "../src/cadfly/ui/overlay";

/*
 * How an overlay of cards behaves on a page: what closes it (Escape, a click
 * outside the cards, its Close button, a choice made), what a choice hands on,
 * how a card with one choice is tapped as a whole while a card with several
 * keeps its buttons, that clicks and keys stay away from the page underneath
 * while it is open, that a tap just after it opens makes no choice, and that
 * closing takes away everything it added.
 */

/** Wait for the timer that arms an overlay's listeners, which is not set until the next turn. */
const armed = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The overlay's dimmed backdrop: the page-sized element that holds the cards. */
const backdrop = () => document.body.firstElementChild as HTMLElement | null;

/** The button with this label, if it is on the page. */
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === label);

/** A key press on the page. */
const press = (key: string) => document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

/** A press of the pointer on an element. */
const pointerDown = (target: Element) => target.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));

/** Two cards, the second with two buttons. The callbacks record what they were given. */
function cards(log: boolean[][]): Card[] {
  return [
    { title: "First", description: "the first card", actions: [{ label: "Pick first", run: (on) => log.push(on) }] },
    {
      title: "Second",
      description: "the second card",
      tag: "current",
      marked: true,
      actions: [
        { label: "Pick second", run: (on) => log.push(on) },
        { label: "Pick other", run: (on) => log.push(on) },
      ],
    },
  ];
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  vi.restoreAllMocks();
  // an overlay left open by a failed test would answer the next one
  const close = button("Close");
  close?.click();
  document.body.replaceChildren();
});

describe("what an overlay shows", () => {
  test("it puts a title, each card's name and words, and its tag on the page", () => {
    openCards("Choose one", cards([]));
    const text = document.body.textContent ?? "";
    for (const shown of ["Choose one", "First", "the first card", "Second", "the second card", "current"]) expect(text).toContain(shown);
  });

  test("each card has a button for each of its actions, plus one Close button", () => {
    openCards("Choose one", cards([]));
    expect(document.querySelectorAll("button")).toHaveLength(1 + 1 + 2);
    for (const label of ["Close", "Pick first", "Pick second", "Pick other"]) expect(button(label)).toBeDefined();
  });

  test("a check box starts ticked only when it was asked to be", () => {
    openCards("Choose one", cards([]), [{ label: "off by default" }, { label: "off", ticked: false }, { label: "on", ticked: true }]);
    const boxes = [...document.querySelectorAll("input")];
    expect(boxes.map((b) => b.type)).toEqual(["checkbox", "checkbox", "checkbox"]);
    expect(boxes.map((b) => b.checked)).toEqual([false, false, true]);
  });
});

describe("what closes an overlay", () => {
  test("Escape closes it", async () => {
    openCards("Choose one", cards([]));
    await armed();
    press("Escape");
    expect(backdrop()).toBeNull();
  });

  test("another key does not close it", async () => {
    openCards("Choose one", cards([]));
    await armed();
    press("a");
    expect(backdrop()).not.toBeNull();
  });

  test("a press on the dimmed area outside the cards closes it", async () => {
    openCards("Choose one", cards([]));
    await armed();
    pointerDown(backdrop()!);
    expect(backdrop()).toBeNull();
  });

  test("a press elsewhere on the page closes it", async () => {
    openCards("Choose one", cards([]));
    await armed();
    const elsewhere = document.createElement("div");
    document.body.append(elsewhere);
    pointerDown(elsewhere);
    expect(backdrop()?.querySelector("button")).toBeNull();
  });

  test("a press inside a card does not close it", async () => {
    openCards("Choose one", cards([]));
    await armed();
    const inside = [...document.querySelectorAll("div")].find((d) => d.textContent === "the first card")!;
    pointerDown(inside);
    expect(backdrop()).not.toBeNull();
  });

  test("the Close button closes it", () => {
    openCards("Choose one", cards([]));
    button("Close")!.click();
    expect(backdrop()).toBeNull();
  });

  test("the function it returns closes it, and closing twice is harmless", () => {
    const close = openCards("Choose one", cards([]));
    close();
    expect(backdrop()).toBeNull();
    expect(() => close()).not.toThrow();
    expect(backdrop()).toBeNull();
  });

  test("opening another overlay closes the first", () => {
    openCards("First overlay", cards([]));
    openCards("Second overlay", cards([]));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Second overlay");
    expect(text).not.toContain("First overlay");
    expect(document.body.children).toHaveLength(1);
  });

  test("a card's button closes it before it runs, so the action sees a page without the overlay", () => {
    let present: boolean | undefined;
    openCards("Choose one", [{ title: "Only", description: "d", actions: [{ label: "Go", run: () => (present = backdrop() !== null) }] }]);
    button("Go")!.click();
    expect(present).toBe(false);
  });
});

describe("what a card's button hands on", () => {
  test("the action runs once, with the state of each check box in order", () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log), [{ label: "a", ticked: true }, { label: "b" }, { label: "c", ticked: true }]);
    button("Pick second")!.click();
    expect(log).toEqual([[true, false, true]]);
  });

  test("a box the person changed is read as changed", () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log), [{ label: "a", ticked: true }, { label: "b" }]);
    const [a, b] = [...document.querySelectorAll("input")];
    a.checked = false;
    b.checked = true;
    button("Pick first")!.click();
    expect(log).toEqual([[false, true]]);
  });

  test("with no check boxes the action gets an empty list", () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log));
    button("Pick other")!.click();
    expect(log).toEqual([[]]);
  });

  test("only the button that was pressed runs", () => {
    const log: boolean[][] = [];
    const ran: string[] = [];
    openCards("Choose one", [
      {
        title: "Only",
        description: "d",
        actions: [
          { label: "A", run: () => ran.push("A") },
          { label: "B", run: () => ran.push("B") },
        ],
      },
    ]);
    button("B")!.click();
    expect(ran).toEqual(["B"]);
    expect(log).toEqual([]);
  });
});

describe("the page underneath", () => {
  test("keys do not reach a listener on the page while the overlay is open, and do again after it closes", async () => {
    const seen: string[] = [];
    const listener = (e: KeyboardEvent) => seen.push(e.key);
    document.addEventListener("keydown", listener);
    document.body.addEventListener("keydown", listener);
    try {
      const close = openCards("Choose one", cards([]));
      await armed();
      press("x");
      expect(seen).toEqual([]);
      close();
      press("y");
      // the same press reaches the document and the body
      expect(seen).toEqual(["y", "y"]);
    } finally {
      document.removeEventListener("keydown", listener);
      document.body.removeEventListener("keydown", listener);
    }
  });

  test("presses on the cards do not bubble to the page", async () => {
    const seen: string[] = [];
    const listener = (e: Event) => seen.push(e.type);
    document.body.addEventListener("pointerdown", listener);
    document.body.addEventListener("pointerup", listener);
    try {
      openCards("Choose one", cards([]));
      await armed();
      const inside = [...document.querySelectorAll("div")].find((d) => d.textContent === "the first card")!;
      pointerDown(inside);
      inside.dispatchEvent(new Event("pointerup", { bubbles: true }));
      expect(seen).toEqual([]);
    } finally {
      document.body.removeEventListener("pointerdown", listener);
      document.body.removeEventListener("pointerup", listener);
    }
  });
});

describe("what closing takes away", () => {
  /**
   * Watch the page's listeners.
   *
   * @returns How many of a kind are on the page now (adds less removes), and how many were ever added.
   */
  function watchListeners() {
    const live = new Map<string, number>();
    const added = new Map<string, number>();
    const count = (type: string, by: number) => {
      live.set(type, (live.get(type) ?? 0) + by);
      if (by > 0) added.set(type, (added.get(type) ?? 0) + 1);
    };
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation((...args: Parameters<typeof add>) => {
      count(args[0], 1);
      add(...args);
    });
    vi.spyOn(document, "removeEventListener").mockImplementation((...args: Parameters<typeof remove>) => {
      count(args[0], -1);
      remove(...args);
    });
    return { live: (type: string) => live.get(type) ?? 0, added: (type: string) => added.get(type) ?? 0 };
  }

  test("it adds a pointer and a key listener to the page once armed, and removes both on close", async () => {
    const { live, added } = watchListeners();
    const close = openCards("Choose one", cards([]));
    await armed();
    expect(live("pointerdown")).toBe(1);
    expect(live("keydown")).toBe(1);
    close();
    expect(live("pointerdown")).toBe(0);
    expect(live("keydown")).toBe(0);
  });

  test("an overlay closed before it was armed never adds its listeners", async () => {
    const { live, added } = watchListeners();
    openCards("Choose one", cards([]))();
    await armed();
    expect(added("pointerdown")).toBe(0);
    expect(added("keydown")).toBe(0);
  });

  test("opening and closing many overlays leaves no listeners behind", async () => {
    const { live, added } = watchListeners();
    for (let i = 0; i < 5; i++) {
      openCards("Choose one", cards([]));
      await armed();
    }
    button("Close")!.click();
    expect(live("pointerdown")).toBe(0);
    expect(live("keydown")).toBe(0);
  });

  test("the overlay's element is taken off the page, with nothing of it left", () => {
    const close = openCards("Choose one", cards([]));
    expect(document.body.children).toHaveLength(1);
    close();
    expect(document.body.children).toHaveLength(0);
  });
});

describe("a card with one choice", () => {
  /** The card that has this name, as the element that holds it. */
  const card = (title: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.startsWith(title))!;

  /** Two such cards, the second the one in force, which picks nothing. */
  function pickCards(log: boolean[][]): Card[] {
    return [
      { title: "Other", description: "choose this", pick: (on) => log.push(on) },
      { title: "Current", description: "already in force", tag: "current", marked: true, pick: () => {} },
    ];
  }

  test("is a button as a whole, so it can be focused, and has no other buttons inside", () => {
    openCards("Choose one", pickCards([]));
    const tappable = card("Other");
    expect(tappable.tabIndex).toBe(0);
    expect(tappable.querySelector("button")).toBeNull();
    expect(tappable.textContent).toContain("choose this");
  });

  test("makes its choice once when it is tapped anywhere on it, after the overlay has closed", () => {
    const log: boolean[][] = [];
    let present: boolean | undefined;
    openCards("Choose one", [{ title: "Other", description: "choose this", pick: (on) => (log.push(on), (present = backdrop() !== null)) }]);
    (card("Other").lastElementChild as HTMLElement).click();
    expect(log).toEqual([[]]);
    expect(present).toBe(false);
  });

  test("hands on the check boxes, as a button on a card does", () => {
    const log: boolean[][] = [];
    openCards("Choose one", pickCards(log), [{ label: "extra", ticked: true }]);
    card("Other").click();
    expect(log).toEqual([[true]]);
  });

  test("the card of the choice already in force just closes the overlay", () => {
    const log: boolean[][] = [];
    openCards("Choose one", pickCards(log));
    card("Current").click();
    expect(backdrop()).toBeNull();
    expect(log).toEqual([]);
  });

  test("leaves Enter and Space alone, so that they activate the focused card as they do any button", async () => {
    openCards("Choose one", pickCards([]));
    await armed();
    for (const key of ["Enter", " "]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      card("Other").dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(backdrop()).not.toBeNull();
  });

  test("a card with several choices keeps its own buttons and is not a button itself", () => {
    openCards("Choose one", cards([]));
    expect(button("Pick second")).toBeDefined();
    expect(button("Pick other")).toBeDefined();
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent?.startsWith("Second"))).toHaveLength(0);
  });
});

describe("a wide overlay", () => {
  /** The element that holds the cards and check boxes: the scrolling list. */
  const list = () => [...document.querySelectorAll<HTMLElement>("div")].find((d) => d.style.overflowY === "auto")!;

  test("lays the cards out in a grid of equal columns, and by default in one column", () => {
    openCards("Choose one", cards([]), [], { wide: true });
    expect(list().style.display).toBe("grid");
    expect(list().style.gridTemplateColumns).toContain("auto-fill");
    document.body.replaceChildren();
    openCards("Choose one", cards([]));
    expect(list().style.display).toBe("flex");
  });

  test("puts a check box on a row of its own across every column", () => {
    openCards("Choose one", cards([]), [{ label: "extra" }], { wide: true });
    const box = [...document.querySelectorAll<HTMLElement>("label")].find((l) => l.textContent === "extra")!;
    expect(box.style.gridColumn).toMatch(/^1\s*\/\s*-1$/);
  });

  test("closes and hands on a choice exactly as a narrow one does", async () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log), [{ label: "extra", ticked: true }], { wide: true });
    await armed();
    press("Escape");
    expect(backdrop()).toBeNull();
    openCards("Choose one", cards(log), [{ label: "extra", ticked: true }], { wide: true });
    button("Pick second")!.click();
    expect(backdrop()).toBeNull();
    expect(log).toEqual([[true]]);
  });

  test("keeps the buttons of a card at the bottom of it, so that they line up along a row", () => {
    openCards("Choose one", cards([]), [], { wide: true });
    const buttons = button("Pick second")!.parentElement!;
    expect(buttons.style.marginTop).toBe("auto");
  });
});

describe("taps just after it opens", () => {
  /** A click made with a mouse or a finger, which has a count of one, as a touch screen sends after a tap. */
  const tap = (target: Element) => target.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true, cancelable: true }));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("a tap on a button right after it opens does nothing, and the overlay stays", () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log));
    tap(button("Pick first")!);
    expect(log).toEqual([]);
    expect(backdrop()).not.toBeNull();
  });

  test("a tap on the Close button right after it opens does nothing", () => {
    openCards("Choose one", cards([]));
    tap(button("Close")!);
    expect(backdrop()).not.toBeNull();
  });

  test("a tap on a card that is a button as a whole right after it opens does nothing", () => {
    const picked = vi.fn();
    openCards("Choose one", [{ title: "Only", description: "the only choice", pick: picked }]);
    tap([...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Only"))!);
    expect(picked).not.toHaveBeenCalled();
    expect(backdrop()).not.toBeNull();
  });

  test("once the moment has passed, a tap works", () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log));
    vi.advanceTimersByTime(EARLY_TAP_MS);
    tap(button("Pick first")!);
    expect(log).toEqual([[]]);
    expect(backdrop()).toBeNull();
  });

  test("the moment lasts until its time is up, not a moment less", () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log));
    const pick = button("Pick first")!;
    vi.advanceTimersByTime(EARLY_TAP_MS - 1);
    tap(pick);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    tap(pick);
    expect(log).toEqual([[]]);
  });

  test("a click made with the keyboard works at once", () => {
    const log: boolean[][] = [];
    openCards("Choose one", cards(log));
    // pressing Enter or Space on a focused button sends a click that has no count
    button("Pick first")!.click();
    expect(log).toEqual([[]]);
    expect(backdrop()).toBeNull();
  });

  test("a press outside the cards still closes it at once", () => {
    openCards("Choose one", cards([]));
    pointerDown(backdrop()!);
    expect(backdrop()).toBeNull();
  });
});
