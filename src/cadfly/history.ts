/** Undo/redo over immutable snapshots of some state. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  /** Remember the state as it was before a change; forgets any redo. */
  record(before: T) {
    this.past.push(structuredClone(before));
    this.future = [];
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }

  /** Returns the state to restore, or null; `current` becomes redoable. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(structuredClone(current));
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(structuredClone(current));
    return next;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}
