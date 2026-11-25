import { afterEach, describe, expect, test, vi } from "vitest";
import { oneDecimal, withCommas } from "../src/cadfly/ui/numbers";
import { readSession, readStored, writeSession, writeStored } from "../src/cadfly/ui/storage";

/**
 * What the browser keeps for the page, and how numbers are written for people to
 * read.
 */

/** A store that keeps text in memory, like the browser's, or one that refuses everything */
function fakeStore(refuses = false): Storage {
  const data = new Map<string, string>();
  const refuse = () => {
    if (refuses) throw new DOMException("not allowed", "SecurityError");
  };
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => (refuse(), data.get(k) ?? null),
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => (refuse(), void data.delete(k)),
    setItem: (k, v) => (refuse(), void data.set(k, v)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("what the browser keeps", () => {
  test("text kept on this computer, and text kept until the page closes, are in different places", () => {
    vi.stubGlobal("localStorage", fakeStore());
    vi.stubGlobal("sessionStorage", fakeStore());
    expect(writeStored("k", "on the computer")).toBe(true);
    expect(writeSession("k", "for the visit")).toBe(true);
    expect(readStored("k")).toBe("on the computer");
    expect(readSession("k")).toBe("for the visit");
  });

  test("an empty value forgets the key", () => {
    vi.stubGlobal("localStorage", fakeStore());
    vi.stubGlobal("sessionStorage", fakeStore());
    writeStored("k", "a");
    writeSession("k", "b");
    writeStored("k", "");
    writeSession("k", "");
    expect([readStored("k"), readSession("k")]).toEqual(["", ""]);
  });

  test("a browser that refuses is told apart from one that does not, and nothing throws", () => {
    vi.stubGlobal("localStorage", fakeStore(true));
    vi.stubGlobal("sessionStorage", fakeStore(true));
    expect(writeStored("k", "a")).toBe(false);
    expect(writeSession("k", "a")).toBe(false);
    expect(readStored("k")).toBe("");
    expect(readSession("k")).toBe("");
  });

  test("with no storage at all (no browser) it works the same way", () => {
    expect(writeStored("k", "a")).toBe(false);
    expect(readSession("k")).toBe("");
  });
});

describe("numbers for people", () => {
  test("a number to one decimal place, with thousands separated", () => {
    expect(oneDecimal(3200.04)).toBe("3,200");
    expect(oneDecimal(12.345)).toBe("12.3");
    expect(oneDecimal(0)).toBe("0");
  });

  test("a count with thousands separated", () => {
    expect(withCommas(3200)).toBe("3,200");
    expect(withCommas(42)).toBe("42");
  });
});
