import { type ShapeEngine, RunStopped, TIME_LIMIT, createFontRequester, stoppedProblem } from "../engine";
import type { StlFiles } from "../language/files";
import type { Problem, Program } from "../language/types";
import type { RunSnapshot } from "../snapshot";
import { type RunEffect, type RunEvent, type RunState, RUN_DELAY, SLOW_AFTER, initialRunState, newerWaiting, stepRun } from "./runMachine";

/**
 * Building the program as it changes. A change is built after a short wait, one
 * build at a time, by the 3D engine; a change made while a build goes on is
 * built when that finishes, or the build is stopped if it has gone on a while.
 * The rules are a state machine that does nothing itself; this carries out what
 * it asks (the timers, the engine, the result) and keeps what the builds gave:
 * the latest build, the latest one that made something, and what is wrong with
 * the program.
 */

/** What the runner is given. */
export interface RunnerHost {
  /** The 3D engine to build with */
  engine: ShapeEngine;
  /** The blocks as they are now */
  program(): Program;
  /** The project's STL files as they are now */
  files(): StlFiles;
  /**
   * Show a result (the 3D view's job).
   *
   * @returns True if the shapes of the result are now on screen.
   */
  show(result: RunSnapshot, problem: Problem | undefined): boolean;
  /** A build ended: draw the editor and the message box again. */
  refresh(): void;
  /** A build has gone on for a moment: draw the message box again. */
  refreshMessage(): void;
}

/** What the runner offers. */
export interface Runner {
  /** The program changed: build it after a short wait, so that a burst of changes is built once. */
  schedule(): void;
  /** Build the program now (or when the build in progress is done). */
  request(): void;
  /** The files have been brought back from the browser: builds may begin. */
  filesReady(): void;
  /** The latest build that finished, if one has */
  lastBuild(): RunSnapshot | undefined;
  /**
   * The program that `lastBuild` was built from, so that what is made of the
   * build (the hull's faces) can be checked against the program as it is now.
   */
  lastBuildProgram(): Program | undefined;
  /**
   * The latest build that made something. It stays on screen, and is what gets
   * exported, while a block has a problem.
   */
  lastShapes(): RunSnapshot | undefined;
  /** What is wrong with the program, from the latest build */
  problem(): Problem | undefined;
  /** Has a build been going for a moment? */
  slow(): boolean;
  /**
   * Ask the engine for the Google fonts a program uses that it has not been
   * asked for yet. The program is built again as each arrives.
   *
   * @returns A promise settled when they have all arrived or failed.
   */
  requestFonts(program: Program): Promise<void>;
}

/**
 * Make the runner.
 *
 * @param host What it builds with and tells.
 */
export function createRunner(host: RunnerHost): Runner {
  const { engine } = host;
  let state: RunState = initialRunState();
  let lastBuild: RunSnapshot | undefined;
  let lastBuildProgram: Program | undefined;
  let lastShapes: RunSnapshot | undefined;
  let problem: Problem | undefined;
  /** The timer that waits a moment for more changes before the program is built. */
  let debounceTimer = 0;
  /** The timer that says a build has gone on for a moment. */
  let slowTimer = 0;

  /**
   * Tell the rules what happened and carry out what they say.
   *
   * @param event What happened.
   */
  function dispatch(event: RunEvent) {
    const step = stepRun(state, event);
    state = step.state;
    for (const effect of step.effects) carryOut(effect);
  }

  /**
   * Do one thing the rules asked for.
   *
   * @param effect What to do.
   */
  function carryOut(effect: RunEffect) {
    switch (effect) {
      case "armDebounce":
        clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(want, RUN_DELAY);
        break;
      case "startBuild":
        startBuild();
        break;
      case "armSlow":
        slowTimer = window.setTimeout(() => dispatch({ type: "slowElapsed" }), SLOW_AFTER);
        break;
      case "disarmSlow":
        clearTimeout(slowTimer);
        break;
      case "stopEngineForNewer":
        engine.stop("newer");
        break;
      case "refresh":
        host.refresh();
        break;
      case "refreshMessage":
        host.refreshMessage();
        break;
    }
  }

  /** A build is wanted now. */
  function want() {
    dispatch({ type: "wanted", busyFor: engine.busyFor() });
  }

  /**
   * Give the engine the program, and take what comes of it. If a build is
   * stopped or takes too long, the problem says so, and what was on screen
   * stays.
   */
  function startBuild() {
    const built = host.program();
    engine
      .run(built, host.files())
      .then(
        (result) => finish(result, built),
        (e) => {
          if (!(e instanceof RunStopped)) throw e;
          // stopped by the person, for taking too long, or because the engine failed: say so, and keep what was on screen; if the program changed meanwhile, that is built next
          if (e.why !== "newer" && !newerWaiting(state)) {
            problem = stoppedProblem(e.why, Math.round(TIME_LIMIT / 1000), e.detail);
            lastBuild = undefined;
          }
        },
      )
      .finally(() => dispatch({ type: "settled" }));
  }

  /**
   * Take the result of a build. Ignored if the program has changed since, since
   * that one is built next.
   *
   * @param result What the build gave.
   * @param built The program that was built.
   */
  function finish(result: RunSnapshot, built: Program) {
    if (newerWaiting(state)) return;
    lastBuild = result;
    lastBuildProgram = built;
    problem = result.problem;
    if (host.show(result, problem)) lastShapes = result;
    void requestFonts(host.program());
  }

  const requestFonts = createFontRequester(engine, want);

  return {
    schedule: () => dispatch({ type: "changed" }),
    request: want,
    filesReady: () => dispatch({ type: "filesLoaded" }),
    lastBuild: () => lastBuild,
    lastBuildProgram: () => lastBuildProgram,
    lastShapes: () => lastShapes,
    problem: () => problem,
    slow: () => state.slow,
    requestFonts,
  };
}
