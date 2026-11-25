import { describe, expect, test } from "vitest";
import { evaluateExpr } from "../src/cadfly/geometry/expr";
import { Scope } from "../src/cadfly/language/env";

/** The chain of variable scopes that a run works in. */

describe("a scope", () => {
  test("holds the variables set in it", () => {
    const s = new Scope();
    s.set("width", 40);
    expect(s.get("width")).toBe(40);
    expect(s.has("width")).toBe(true);
    expect(s.get("depth")).toBeUndefined();
    expect(s.has("depth")).toBe(false);
  });

  test("a value of zero is a value, not a missing one", () => {
    const parent = new Scope();
    parent.set("x", 5);
    const child = parent.child();
    child.set("x", 0);
    expect(child.get("x")).toBe(0);
    expect(parent.get("x")).toBe(5);
  });

  test("a child sees its parent's variables, and its grandparent's", () => {
    const root = new Scope();
    root.set("a", 1);
    const child = root.child();
    child.set("b", 2);
    const grandchild = child.child();
    expect(grandchild.get("a")).toBe(1);
    expect(grandchild.get("b")).toBe(2);
    expect(grandchild.has("a")).toBe(true);
    expect(grandchild.has("c")).toBe(false);
  });

  test("a set in a child does not change the parent: the child's variable hides the parent's", () => {
    const parent = new Scope();
    parent.set("size", 10);
    const child = parent.child();
    child.set("size", 99);
    child.set("only_here", 1);
    expect(child.get("size")).toBe(99);
    expect(parent.get("size")).toBe(10);
    expect(parent.has("only_here")).toBe(false);
  });

  test("a variable set in the parent after the child was made is seen by the child, unless the child hides it", () => {
    const parent = new Scope();
    const child = parent.child();
    parent.set("late", 7);
    parent.set("hidden", 1);
    child.set("hidden", 2);
    parent.set("hidden", 3);
    expect(child.get("late")).toBe(7);
    expect(child.get("hidden")).toBe(2);
  });

  test("entries gives only the variables set in the scope itself", () => {
    const parent = new Scope();
    parent.set("a", 1);
    const child = parent.child();
    child.set("b", 2);
    expect([...child.entries()]).toEqual([["b", 2]]);
    expect([...parent.entries()]).toEqual([["a", 1]]);
  });

  test("an expression is worked out against a scope, including its parents", () => {
    const parent = new Scope();
    parent.set("w", 10);
    const child = parent.child();
    child.set("h", 3);
    expect(evaluateExpr("w * h", child)).toBe(30);
    expect(() => evaluateExpr("w * missing", child)).toThrow(/unknown variable "missing"/);
  });
});
