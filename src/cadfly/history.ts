import type { StlFiles } from "./language/files";
import type { Program } from "./language/types";

/**
 * Undo and redo. A history keeps copies of earlier states of anything, up to a
 * limit, and hands them back in order. The project's state is the blocks and
 * the STL files, and a copy of it shares the files, since they are never
 * changed in place and can be very large.
 */

/**
 * Undo/redo over immutable snapshots of some state. Only the last `limit` states
 * are kept, so that a long session does not use up the memory (the state can hold
 * the project's files, which are big).
 */
export class History<T> {
  /** The states that undo goes back to, oldest first. */
  private past: T[] = [];
  /** The states that redo goes forward to, next one last. */
  private future: T[] = [];

  /**
   * @param copy Makes the copy of a state that is kept, so that later changes to
   *             the state do not change it. It may share what is never changed
   *             in place (such as a very long string).
   * @param limit How many states to keep to undo to: when there are more, the
   *              oldest is let go.
   */
  constructor(
    private readonly copy: (state: T) => T = structuredClone,
    private readonly limit = 100,
  ) {}

  /** Remember the state as it was before a change; forgets any redo. */
  record(before: T) {
    this.push(this.past, before);
    this.future = [];
  }

  /** Add a copy of the state to a list, and let go of the oldest if there are too many */
  private push(list: T[], state: T) {
    list.push(this.copy(state));
    if (list.length > this.limit) list.shift();
  }

  /** Is there a state to undo to? */
  canUndo() {
    return this.past.length > 0;
  }

  /** Is there a state to redo to? */
  canRedo() {
    return this.future.length > 0;
  }

  /** Returns the state to restore, or null; `current` becomes redoable. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.push(this.future, current);
    return prev;
  }

  /**
   * Returns the state to go forward to, or null if there is none; `current`
   * becomes undoable again.
   */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.push(this.past, current);
    return next;
  }

  /**
   * Change every state that can be undone to or redone to: each is replaced by
   * what `change` gives for it (which may be the state itself, if nothing is to
   * change in it). For a change that is made to the whole history, such as a
   * file that was loaded again under its own name, which is not a step to undo
   * but is not to be undone either.
   */
  amendAll(change: (state: T) => T) {
    this.past = this.past.map(change);
    this.future = this.future.map(change);
  }

  /** Forget every state, both ways. */
  clear() {
    this.past = [];
    this.future = [];
  }
}

/**
 * What undo and redo take back and bring back: the blocks, and the STL files
 * the project has. The files are an object that is never changed in place (a
 * change makes a new one), so a state can hold the very same object as the
 * project, with none of its text copied.
 */
export interface ProjectState {
  program: Program;
  files: StlFiles;
}

/** A copy of a project's state for the history: the blocks are copied, the files are shared */
export function copyForHistory(state: ProjectState): ProjectState {
  return { program: structuredClone(state.program), files: state.files };
}

/** Do the two sets of files have the same file names (whatever is in the files)? */
export function sameFileNames(a: StlFiles, b: StlFiles): boolean {
  const names = Object.keys(a);
  return names.length === Object.keys(b).length && names.every((name) => name in b);
}

/**
 * A change for `History.amendAll`: in every state that has a file called `name`,
 * the file is `data`. The states stay as they were in all other ways.
 */
export function replacingFileData(name: string, data: string): (state: ProjectState) => ProjectState {
  return (state) => (name in state.files && state.files[name] !== data ? { program: state.program, files: { ...state.files, [name]: data } } : state);
}
