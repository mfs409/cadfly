import { expect, test } from "vitest";
import { History } from "../src/cadfly/history";

test("undo and redo walk through the recorded states", () => {
  const h = new History<number[]>();
  expect(h.undo([1])).toBeNull();
  h.record([1]);
  h.record([1, 2]);
  expect(h.undo([1, 2, 3])).toEqual([1, 2]);
  expect(h.canRedo()).toBe(true);
  expect(h.redo([1, 2])).toEqual([1, 2, 3]);
  expect(h.undo([1, 2, 3])).toEqual([1, 2]);
});

test("a new change forgets what could be redone", () => {
  const h = new History<number[]>();
  h.record([1]);
  h.undo([1, 2]);
  expect(h.canRedo()).toBe(true);
  h.record([1]);
  expect(h.canRedo()).toBe(false);
});

test("recorded states are copies, so later edits do not change them", () => {
  const h = new History<{ n: number }>();
  const state = { n: 1 };
  h.record(state);
  state.n = 99;
  expect(h.undo({ n: 5 })).toEqual({ n: 1 });
});
