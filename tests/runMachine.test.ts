import { describe, expect, test } from "vitest";
import { RESTART_AFTER, type RunEvent, type RunState, buildInProgress, initialRunState, newerWaiting, stepRun } from "../src/cadfly/app/runMachine";

/**
 * When the program is built: the states and what each event does, driven by hand
 * with no engine and no clock.
 */

/** A state with the files back, which is where almost every rule starts. */
const ready = (phase: RunState["phase"] = "idle", slow = false): RunState => ({ phase, slow, filesLoaded: true });
/** The state after these events, and every effect asked for on the way. */
function play(start: RunState, ...events: RunEvent[]) {
  let state = start;
  const effects: string[] = [];
  for (const event of events) {
    const step = stepRun(state, event);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}
const wanted = (busyFor = 0): RunEvent => ({ type: "wanted", busyFor });

describe("before the files are back", () => {
  test("nothing is built, however often one is wanted", () => {
    const { state, effects } = play(initialRunState(), wanted(), wanted(), { type: "changed" }, wanted());
    expect(effects).toEqual(["armDebounce"]);
    expect(state.phase).toBe("scheduled");
    expect(state.filesLoaded).toBe(false);
  });

  test("when they arrive, the next wanted build starts", () => {
    const { state, effects } = play(initialRunState(), { type: "filesLoaded" }, wanted());
    expect(effects).toEqual(["startBuild", "armSlow"]);
    expect(state.phase).toBe("building");
  });
});

describe("a change", () => {
  test("starts the wait for more changes, and every further change starts it again", () => {
    const { state, effects } = play(ready(), { type: "changed" }, { type: "changed" }, { type: "changed" });
    expect(effects).toEqual(["armDebounce", "armDebounce", "armDebounce"]);
    expect(state.phase).toBe("scheduled");
  });

  test("when the wait ends, the program is built", () => {
    const { state, effects } = play(ready(), { type: "changed" }, wanted());
    expect(effects).toEqual(["armDebounce", "startBuild", "armSlow"]);
    expect(state.phase).toBe("building");
  });

  test("while a build goes on, it is waited for, and the build is not stopped yet", () => {
    const { state, effects } = play(ready("building"), { type: "changed" }, wanted(RESTART_AFTER));
    expect(effects).toEqual(["armDebounce"]);
    expect(state.phase).toBe("buildingWithNewer");
  });
});

describe("a program that changes while the last one is being built", () => {
  test("is built after the build in progress, which is not shown", () => {
    const { state, effects } = play(ready("building"), wanted(100));
    expect(effects).toEqual([]);
    expect(newerWaiting(state)).toBe(true);
    const ended = play(state, { type: "settled" });
    expect(ended.effects).toEqual(["disarmSlow", "startBuild", "armSlow"]);
    expect(ended.state.phase).toBe("building");
    expect(newerWaiting(ended.state)).toBe(false);
  });

  test("makes the build stop when it has already gone on a while", () => {
    expect(play(ready("building"), wanted(RESTART_AFTER)).effects).toEqual([]);
    expect(play(ready("building"), wanted(RESTART_AFTER + 1)).effects).toEqual(["stopEngineForNewer"]);
  });

  test("asking again while one is already waiting changes nothing but may stop the build", () => {
    const { state, effects } = play(ready("buildingWithNewer"), wanted(10), wanted(RESTART_AFTER + 1));
    expect(state.phase).toBe("buildingWithNewer");
    expect(effects).toEqual(["stopEngineForNewer"]);
  });
});

describe("the end of a build", () => {
  test("with nothing newer waiting, the build is over and everything is drawn again", () => {
    const { state, effects } = play(ready("building", true), { type: "settled" });
    expect(state).toEqual(ready("idle", false));
    expect(effects).toEqual(["disarmSlow", "refresh"]);
  });

  test("when no build is going on, nothing happens", () => {
    expect(play(ready(), { type: "settled" })).toEqual({ state: ready(), effects: [] });
  });

  test("a build that is slow is called slow, once the time has passed, and not slow after", () => {
    const slow = play(ready("building"), { type: "slowElapsed" });
    expect(slow.state.slow).toBe(true);
    expect(slow.effects).toEqual(["refreshMessage"]);
    expect(play(slow.state, { type: "settled" }).state.slow).toBe(false);
    expect(play(ready(), { type: "slowElapsed" })).toEqual({ state: ready(), effects: [] });
  });

  test("a build is in progress in two of the four states", () => {
    expect(["idle", "scheduled", "building", "buildingWithNewer"].map((phase) => buildInProgress(ready(phase as RunState["phase"])))).toEqual([false, false, true, true]);
  });
});
