import { describe, expect, test } from "vitest";
import { NEW_TOAST, type ToastFacts, type ToastModel, type ToastState, dismissedAfter, toastDismissed, toastIsProblem, toastNoticeCleared, toastNoticeExpired, toastText, toastTold, toastVisible, viewToast } from "../src/cadfly/toast";

/**
 * What the message box over the workspace says, when it is shown, and what
 * happens when it is dismissed.
 */

const calm: ToastState = { working: false, notice: "", problem: undefined, engineFailure: "", engineReady: true };
const problem = { blockId: "b1", message: "width must be positive" };

describe("what the box says", () => {
  test("a build that is going on comes first, then a notice, then the problem, then the engine's failure, then that it is loading", () => {
    const all: ToastState = { working: true, notice: "Saved", problem, engineFailure: "the 3D engine did not start: x", engineReady: false };
    expect(toastText(all)).toMatch(/working/i);
    expect(toastText({ ...all, working: false })).toBe("Saved");
    expect(toastText({ ...all, working: false, notice: "" })).toBe("width must be positive");
    expect(toastText({ ...all, working: false, notice: "", problem: undefined })).toBe("the 3D engine did not start: x");
    expect(toastText({ ...all, working: false, notice: "", problem: undefined, engineFailure: "" })).toBe("loading the 3D engine...");
  });

  test("it says nothing when there is nothing to say", () => {
    expect(toastText(calm)).toBe("");
  });

  test("only the program's problem is shown as a problem, not news or a build in progress", () => {
    expect(toastIsProblem({ ...calm, problem })).toBe(true);
    expect(toastIsProblem({ ...calm, problem, notice: "Saved" })).toBe(false);
    expect(toastIsProblem({ ...calm, problem, working: true })).toBe(false);
    expect(toastIsProblem(calm)).toBe(false);
  });
});

describe("a message the person dismissed", () => {
  test("it stays dismissed while the box keeps being asked for that text", () => {
    expect(dismissedAfter("width must be positive", "width must be positive")).toBe("width must be positive");
  });

  test("it is forgotten as soon as the text is anything else, even nothing, so the same problem coming back is shown again", () => {
    let dismissed = "width must be positive";
    dismissed = dismissedAfter(dismissed, ""); // the problem was fixed
    expect(dismissed).toBe("");
    expect(toastVisible("width must be positive", dismissed, false)).toBe(true); // and it came back
    expect(dismissedAfter("old", "new")).toBe("");
  });

  test("a dismissed message is not shown, but a build in progress always is", () => {
    expect(toastVisible("Saved", "Saved", false)).toBe(false);
    expect(toastVisible("Working on it...", "Working on it...", true)).toBe(true);
    expect(toastVisible("", "", false)).toBe(false);
    expect(toastVisible("Saved", "", false)).toBe(true);
  });
});

describe("the message box as one state", () => {
  const facts: ToastFacts = { working: false, problem: undefined, engineFailure: "", engineReady: true };
  const bad = { blockId: "b1", message: "width must be positive" };
  /** Show the box and keep what it remembers, as the page does each time it draws it. */
  const show = (model: ToastModel, f: Partial<ToastFacts> = {}) => viewToast(model, { ...facts, ...f });

  test("a box that has been told nothing is hidden, and expects nothing", () => {
    const { view } = show(NEW_TOAST);
    expect(view).toEqual({ visible: false, text: "", isProblem: false, showStop: false, expires: false });
  });

  test("a notice is shown and expires, a problem is shown and does not, and a build shows Stop", () => {
    const told = show(toastTold(NEW_TOAST, "Saved")).view;
    expect(told).toMatchObject({ visible: true, text: "Saved", isProblem: false, expires: true });
    const problem = show(NEW_TOAST, { problem: bad }).view;
    expect(problem).toMatchObject({ visible: true, text: "width must be positive", isProblem: true, expires: false });
    expect(show(NEW_TOAST, { working: true }).view).toMatchObject({ visible: true, text: "Working on it...", showStop: true, expires: false });
  });

  test("what the person dismissed stays dismissed until something else is said, and then comes back when it recurs", () => {
    const first = show(NEW_TOAST, { problem: bad });
    const dismissed = toastDismissed(first.model);
    expect(show(dismissed, { problem: bad }).view.visible).toBe(false);
    const fixed = show(dismissed);
    expect(fixed.view.visible).toBe(false);
    expect(show(fixed.model, { problem: bad }).view.visible).toBe(true);
  });

  test("a build is always shown, even over a dismissed message", () => {
    const dismissed = toastDismissed(show(NEW_TOAST, { problem: bad }).model);
    expect(show(dismissed, { working: true }).view.visible).toBe(true);
  });

  test("a new notice is shown even if the same words were dismissed", () => {
    const dismissed = toastDismissed(show(toastTold(NEW_TOAST, "Saved")).model);
    expect(show(dismissed).view.visible).toBe(false);
    expect(show(toastTold(dismissed, "Saved")).view.visible).toBe(true);
  });

  test("clearing the notice keeps what was dismissed, and its expiring forgets it", () => {
    const dismissed = toastDismissed(show(toastTold(NEW_TOAST, "Saved")).model);
    expect(toastNoticeCleared(dismissed).dismissed).toBe("Saved");
    expect(toastNoticeExpired(dismissed)).toEqual({ ...dismissed, notice: "", dismissed: "" });
  });
});
