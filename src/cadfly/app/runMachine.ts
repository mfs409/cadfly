/**
 * When the program is built, as a state machine that does nothing itself. A
 * step takes the state and an event (the program changed, a build is wanted
 * now, a build ended) and gives the next state and the effects to carry out
 * (start a build, arm a timer, stop the engine, redraw). The caller carries the
 * effects out and keeps the timers they ask for, so the rules about stale
 * builds and newer edits can be tested with no engine and no clock.
 */

/** After a change, wait this long (ms) for more changes before building */
export const RUN_DELAY = 120;
/** A build that has gone on this long (ms) is called slow: the message box says so and offers to stop it */
export const SLOW_AFTER = 500;
/**
 * What to do about a program that changes while the last one is still being
 * built. Normally the newer one waits for the build to finish. If the build
 * has already gone on this long (ms), it is stopped, so that the newer program
 * is built at once.
 */
export const RESTART_AFTER = 1500;

/**
 * What the builds are doing:
 * - `idle`: nothing is being built and no change is waiting.
 * - `scheduled`: the program changed and the wait for more changes has begun.
 * - `building`: the engine is building the program that is on screen.
 * - `buildingWithNewer`: the engine is building, and the program has changed
 *   since, so the result is not shown and the newer program is built next.
 */
export type RunPhase = "idle" | "scheduled" | "building" | "buildingWithNewer";

/** Everything the rules need to know. */
export interface RunState {
  phase: RunPhase;
  /** Has the build gone on for a moment? */
  slow: boolean;
  /**
   * Have the project's files been brought back from the browser? Nothing is
   * built before they have, since a program that imports a file cannot be.
   */
  filesLoaded: boolean;
}

/** Something that happened. */
export type RunEvent =
  /** The files have come back from the browser. */
  | { type: "filesLoaded" }
  /** The program changed: build it after a short wait. */
  | { type: "changed" }
  /**
   * A build is wanted now (the wait ended, a font arrived, the engine loaded).
   * `busyFor` is how long (ms) the build in progress has gone on, or 0.
   */
  | { type: "wanted"; busyFor: number }
  /** The build has been going for `SLOW_AFTER`. */
  | { type: "slowElapsed" }
  /** The build ended: it gave a result, or was stopped, or failed. */
  | { type: "settled" };

/**
 * What the caller is to do, in the order given.
 * - `armDebounce`: start the wait of `RUN_DELAY` (taking away one that is
 *   running), then send `wanted`.
 * - `startBuild`: give the engine the program as it is now.
 * - `armSlow` and `disarmSlow`: start and take away the timer of `SLOW_AFTER`,
 *   which sends `slowElapsed`.
 * - `stopEngineForNewer`: stop the build in progress, since it is out of date.
 * - `refresh`: draw the editor and the message box again.
 * - `refreshMessage`: draw the message box again.
 */
export type RunEffect = "armDebounce" | "startBuild" | "armSlow" | "disarmSlow" | "stopEngineForNewer" | "refresh" | "refreshMessage";

/** The state and effects a step gives. */
export interface RunStep {
  state: RunState;
  effects: RunEffect[];
}

/** Where things start: nothing happening, and the files not back yet. */
export function initialRunState(): RunState {
  return { phase: "idle", slow: false, filesLoaded: false };
}

/** Is the engine building the program on screen (or an out-of-date one)? */
export function buildInProgress(state: RunState): boolean {
  return state.phase === "building" || state.phase === "buildingWithNewer";
}

/**
 * Has the program changed while the last one is still being built, so that a
 * newer one is waiting for the engine?
 */
export function newerWaiting(state: RunState): boolean {
  return state.phase === "buildingWithNewer";
}

/**
 * One step: what happens to the state, and what is to be done, when this
 * event arrives.
 *
 * @param state Where things are.
 * @param event What happened.
 */
export function stepRun(state: RunState, event: RunEvent): RunStep {
  switch (event.type) {
    case "filesLoaded":
      return { state: { ...state, filesLoaded: true }, effects: [] };
    case "changed":
      return { state: { ...state, phase: state.phase === "idle" ? "scheduled" : state.phase }, effects: ["armDebounce"] };
    case "wanted":
      if (!state.filesLoaded) return { state, effects: [] };
      if (buildInProgress(state)) return { state: { ...state, phase: "buildingWithNewer" }, effects: event.busyFor > RESTART_AFTER ? ["stopEngineForNewer"] : [] };
      return { state: { ...state, phase: "building" }, effects: ["startBuild", "armSlow"] };
    case "slowElapsed":
      return buildInProgress(state) ? { state: { ...state, slow: true }, effects: ["refreshMessage"] } : { state, effects: [] };
    case "settled":
      if (!buildInProgress(state)) return { state, effects: [] };
      if (newerWaiting(state)) return { state: { ...state, phase: "building", slow: false }, effects: ["disarmSlow", "startBuild", "armSlow"] };
      return { state: { ...state, phase: "idle", slow: false }, effects: ["disarmSlow", "refresh"] };
  }
}
