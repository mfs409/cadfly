import type { Problem } from "./language/types";

/**
 * What the message box over the workspace says, as plain functions of what is
 * going on: the message box shows one thing at a time, and a message the person
 * dismissed does not come back until something else has been said.
 */

/** What is going on that the message box may need to talk about. */
export interface ToastState {
  /** Has a build been going for a moment? */
  working: boolean;
  /** A message about something that just happened (saved, could not load) */
  notice: string;
  /** What is wrong with the program, from the latest build */
  problem: Problem | undefined;
  /** Why the 3D engine could not start, or "" */
  engineFailure: string;
  /** Has the 3D engine loaded? */
  engineReady: boolean;
}

/**
 * What the message box says: that a build is going on, else a notice (which
 * stays a few seconds), else the problem (until it is fixed), else why the
 * engine failed, else that it is loading, else nothing.
 *
 * @param state What is going on.
 */
export function toastText(state: ToastState): string {
  if (state.working) return "Working on it...";
  return state.notice || state.problem?.message || state.engineFailure || (!state.engineReady ? "loading the 3D engine..." : "");
}

/**
 * Is the message box showing a problem, and not just news? True when the
 * words come from the program's problem.
 *
 * @param state What is going on.
 */
export function toastIsProblem(state: ToastState): boolean {
  return !state.working && !state.notice && !!state.problem;
}

/**
 * Which message the person has dismissed, after the box was asked to say
 * `text`: it is remembered while the box keeps being asked for that same text,
 * and forgotten as soon as the text is anything else (including nothing), so
 * that the same problem coming back after it was fixed is shown again.
 *
 * @param dismissed The text the person dismissed ("" if none).
 * @param text What the box has to say now.
 */
export function dismissedAfter(dismissed: string, text: string): string {
  return text === dismissed ? dismissed : "";
}

/**
 * Should the message box show this text? Not if it is empty, and not if it is
 * what the person dismissed (unless a build is going on, which always shows).
 *
 * @param text What the box has to say.
 * @param dismissed The text the person dismissed.
 * @param working Is a build going on?
 */
export function toastVisible(text: string, dismissed: string, working: boolean): boolean {
  return text !== "" && (working || text !== dismissed);
}

/**
 * What the message box has been told and what it has shown: the notice it was
 * given, the message the person dismissed, and what it is saying now. It is
 * changed only by the functions below, each of which gives a new one.
 */
export interface ToastModel {
  /** A message about something that just happened, until the next change or a few seconds pass */
  notice: string;
  /** The text the person dismissed ("" if none) */
  dismissed: string;
  /** What the box is saying now, without the warning sign it may have in front */
  saying: string;
}

/** A message box that has been told nothing. */
export const NEW_TOAST: ToastModel = { notice: "", dismissed: "", saying: "" };

/**
 * A notice was given. It is shown even if the same words were dismissed before.
 *
 * @param model The box as it was.
 * @param message What to say.
 */
export function toastTold(model: ToastModel, message: string): ToastModel {
  return { ...model, notice: message, dismissed: "" };
}

/** The notice was taken away (the program changed), and what was dismissed is remembered. */
export function toastNoticeCleared(model: ToastModel): ToastModel {
  return { ...model, notice: "" };
}

/** The notice had been up long enough: it goes, and so does what was dismissed. */
export function toastNoticeExpired(model: ToastModel): ToastModel {
  return { ...model, notice: "", dismissed: "" };
}

/** The person dismissed what the box is saying. */
export function toastDismissed(model: ToastModel): ToastModel {
  return { ...model, dismissed: model.saying };
}

/** What is going on besides the notice, which the box has itself. */
export type ToastFacts = Omit<ToastState, "notice">;

/** What the message box looks like and does. */
export interface ToastView {
  /** Is the box shown? */
  visible: boolean;
  /** The words, without the warning sign */
  text: string;
  /** Is it a problem (a warning sign, red), and not news? */
  isProblem: boolean;
  /** Is the Stop button shown? */
  showStop: boolean;
  /** Should the notice be taken away after a few seconds? */
  expires: boolean;
}

/**
 * What the message box shows now, and how it remembers what it showed: the
 * dismissed text is forgotten when the box is asked for anything else, and the
 * words it says are kept so that dismissing means that message.
 *
 * @param model The box as it is.
 * @param facts What is going on besides the notice.
 * @returns The box afterwards, and what to draw.
 */
export function viewToast(model: ToastModel, facts: ToastFacts): { model: ToastModel; view: ToastView } {
  const state: ToastState = { ...facts, notice: model.notice };
  const text = toastText(state);
  const dismissed = dismissedAfter(model.dismissed, text);
  const visible = toastVisible(text, dismissed, facts.working);
  return {
    model: { ...model, dismissed, saying: visible ? text : model.saying },
    view: { visible, text, isProblem: toastIsProblem(state), showStop: facts.working, expires: visible && model.notice !== "" },
  };
}
