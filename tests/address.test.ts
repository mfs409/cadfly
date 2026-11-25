import { describe, expect, test } from "vitest";
import { describeSource, loadTarget, lockedAssistant, lockedModeName, projectNameOf, wantsTestHandle, withoutLoadParam } from "../src/cadfly/address";

/**
 * What the page's address can ask for: the interface mode, the assistant switch,
 * the handle for test scripts, and a project to open.
 */

describe("the mode the address picks", () => {
  test("a mode named in any case, with spaces, is picked, as the list spells it", () => {
    expect(lockedModeName("?mode=Starter")).toBe("Starter");
    expect(lockedModeName("?mode=starter")).toBe("Starter");
    expect(lockedModeName("?mode=%20FIRST%20STEPS%20")).toBe("First steps");
    expect(lockedModeName("?ai=on&mode=builder")).toBe("Builder");
  });

  test("no mode, or one that does not exist, picks nothing", () => {
    expect(lockedModeName("")).toBeUndefined();
    expect(lockedModeName("?mode=")).toBeUndefined();
    expect(lockedModeName("?mode=Expert")).toBeUndefined();
    expect(lockedModeName("?ai=on")).toBeUndefined();
  });
});

describe("the assistant switch the address picks", () => {
  test("on, in any of its spellings, in any case", () => {
    for (const word of ["1", "on", "ON", "true", "yes", " Yes "]) expect(lockedAssistant(`?ai=${encodeURIComponent(word)}`), word).toBe(true);
  });

  test("off, in any of its spellings", () => {
    for (const word of ["0", "off", "false", "no", "NO"]) expect(lockedAssistant(`?ai=${word}`), word).toBe(false);
  });

  test("anything else, or nothing, picks neither (the last choice is used)", () => {
    expect(lockedAssistant("")).toBeUndefined();
    expect(lockedAssistant("?ai=")).toBeUndefined();
    expect(lockedAssistant("?ai=maybe")).toBeUndefined();
    expect(lockedAssistant("?mode=Starter")).toBeUndefined();
  });
});

describe("the handle for test scripts", () => {
  test("it is wanted only with test=1", () => {
    expect(wantsTestHandle("?test=1")).toBe(true);
    expect(wantsTestHandle("?mode=Starter&test=1")).toBe(true);
    expect(wantsTestHandle("")).toBe(false);
    expect(wantsTestHandle("?test=0")).toBe(false);
    expect(wantsTestHandle("?test")).toBe(false);
    expect(wantsTestHandle("?test=true")).toBe(false);
  });
});

describe("the project the address asks to open", () => {
  const page = "https://mfs409.github.io/cadfly/index.html?mode=Starter";
  /** The web address a `load` asks for, as text. */
  const urlOf = (search: string, at = page) => {
    const t = loadTarget(search, at);
    if (!t || "error" in t) throw new Error(`no address: ${JSON.stringify(t)}`);
    return t.url.href;
  };
  /** Why a `load` was refused. */
  const errorOf = (search: string, at = page) => {
    const t = loadTarget(search, at);
    if (!t || !("error" in t)) throw new Error(`not refused: ${JSON.stringify(t)}`);
    return t.error;
  };

  test("an https address is taken as it is, with its port, query and encoding", () => {
    expect(urlOf("?load=https://example.com/a/bracket.cadfly")).toBe("https://example.com/a/bracket.cadfly");
    expect(urlOf("?load=https://example.com:8443/x.cadfly")).toBe("https://example.com:8443/x.cadfly");
    expect(urlOf(`?load=${encodeURIComponent("https://example.com/x.cadfly?v=1&b=2")}`)).toBe("https://example.com/x.cadfly?v=1&b=2");
    expect(urlOf(`?load=${encodeURIComponent("https://example.com/my plate.cadfly")}`)).toBe("https://example.com/my%20plate.cadfly");
  });

  test("a relative address is taken from the page", () => {
    expect(urlOf("?load=x.cadfly")).toBe("https://mfs409.github.io/cadfly/x.cadfly");
    expect(urlOf("?load=/files/x.cadfly")).toBe("https://mfs409.github.io/files/x.cadfly");
    expect(urlOf("?load=../up.cadfly")).toBe("https://mfs409.github.io/up.cadfly");
    expect(urlOf("?load=//other.example/x.cadfly")).toBe("https://other.example/x.cadfly");
  });

  test("http is accepted only for this computer, whatever its port", () => {
    expect(urlOf("?load=http://localhost:7100/x.cadfly")).toBe("http://localhost:7100/x.cadfly");
    expect(urlOf("?load=http://127.0.0.1/x.cadfly")).toBe("http://127.0.0.1/x.cadfly");
    expect(urlOf("?load=http://[::1]:8000/x.cadfly")).toBe("http://[::1]:8000/x.cadfly");
    expect(errorOf("?load=http://example.com/x.cadfly")).toMatch(/only https addresses/);
    expect(errorOf("?load=http://localhost.example.com/x.cadfly")).toMatch(/only https addresses/);
    expect(urlOf("?load=x.cadfly", "http://localhost:7100/")).toBe("http://localhost:7100/x.cadfly");
  });

  test("every other kind of address is refused, with the reason", () => {
    for (const bad of ["javascript:alert(1)", "data:text/plain,hi", "file:///etc/passwd", "blob:https://example.com/1234", "ftp://example.com/x.cadfly", "ws://localhost/x"]) {
      expect(errorOf(`?load=${encodeURIComponent(bad)}`), bad).toMatch(/cannot be opened: only https addresses/);
    }
    expect(errorOf("?load=https://user:secret@example.com/x.cadfly")).toMatch(/name and password/);
  });

  test("something that is not an address at all is refused, and a long one is shortened in the message", () => {
    expect(errorOf("?load=https://")).toMatch(/not a web address/);
    const long = `https://${"a".repeat(200)}`;
    expect(errorOf(`?load=${long}:bad`).length).toBeLessThan(160);
  });

  test("nothing, an empty value, or blanks ask for nothing", () => {
    expect(loadTarget("", page)).toBeUndefined();
    expect(loadTarget("?mode=Starter", page)).toBeUndefined();
    expect(loadTarget("?load=", page)).toBeUndefined();
    expect(loadTarget("?load=%20%20", page)).toBeUndefined();
    expect(loadTarget("?loaded=https://example.com/x.cadfly", page)).toBeUndefined();
  });

  test("when it is given more than once, the first is used", () => {
    expect(urlOf("?load=https://a.example/1.cadfly&load=https://b.example/2.cadfly")).toBe("https://a.example/1.cadfly");
    expect(urlOf("?mode=Starter&load=https://a.example/1.cadfly&test=1")).toBe("https://a.example/1.cadfly");
  });

  test("where it came from is the host and the end of the path, and the name is the file's", () => {
    const url = new URL("https://raw.githubusercontent.com/mfs409/book/main/examples/my%20plate.cadfly");
    expect(describeSource(url)).toBe("raw.githubusercontent.com/…/my plate.cadfly");
    expect(describeSource(new URL("https://example.com/x.cadfly"))).toBe("example.com/x.cadfly");
    expect(describeSource(new URL("https://example.com/"))).toBe("example.com");
    expect(projectNameOf(url)).toBe("my plate.cadfly");
    expect(projectNameOf(new URL("https://example.com/"))).toBe("the project");
    expect(describeSource(new URL(`https://example.com/${"n".repeat(100)}.cadfly`)).length).toBeLessThan(80);
  });

  test("the request is taken out of the query string and nothing else changes", () => {
    expect(withoutLoadParam("?load=https://example.com/x.cadfly")).toBe("");
    expect(withoutLoadParam("?mode=First%20steps&load=https%3A%2F%2Fexample.com%2Fx.cadfly&test=1")).toBe("?mode=First%20steps&test=1");
    expect(withoutLoadParam("?load=a&mode=Starter&load=b")).toBe("?mode=Starter");
    expect(withoutLoadParam("?mode=Starter")).toBe("?mode=Starter");
    expect(withoutLoadParam("")).toBe("");
    expect(withoutLoadParam("?load")).toBe("");
    expect(withoutLoadParam("?loaded=1&x=load")).toBe("?loaded=1&x=load");
  });
});
