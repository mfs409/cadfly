import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type ProjectHost, createProject } from "../src/cadfly/app/project";
import { serializeProject } from "../src/cadfly/language/format";
import { createEmptyProgram } from "../src/cadfly/language/program";
import type { Program } from "../src/cadfly/language/types";
import { blk } from "./helpers/blocks";
import { oneScript } from "./helpers/script-helpers";

/**
 * The project as the page uses it: the blocks and files, the steps that undo
 * and redo take back, what counts as saved, what is kept between visits, and
 * opening the project that the page's address names. The page's storage,
 * address, questions and downloads are stand-ins.
 */

/** A program of one box this wide. */
const boxOf = (w: string): Program => oneScript([blk("b1", "box", { w, d: "10", h: "10" })]);

/** A stand-in for the page that records what the project tells it. */
function makeHost() {
  const host = {
    schedule: vi.fn(),
    filesReady: vi.fn(),
    reframe: vi.fn(),
    redraw: vi.fn(),
    clearNotice: vi.fn(),
    notify: vi.fn(),
    loaded: vi.fn(),
  } satisfies ProjectHost;
  return host;
}

/** What the page's storage holds, and what it will refuse. */
let stored: Map<string, string>;
let refuseStorage: boolean;
/** The address the page is at, and what was done to it. */
let search: string;
let replacedAddress: string[];
/** What a question to the person is answered with, and what was asked. */
let answer: boolean;
let asked: string[];
/** What a fetch of the project's address answers with. */
let fetched: () => Promise<Response>;

beforeEach(() => {
  stored = new Map();
  refuseStorage = false;
  search = "";
  replacedAddress = [];
  answer = true;
  asked = [];
  fetched = async () => new Response("");
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (refuseStorage) throw new Error("full");
      stored.set(key, value);
    },
    removeItem: (key: string) => void stored.delete(key),
  });
  vi.stubGlobal("location", { get search() { return search; }, href: "https://app.example/cadfly/", origin: "https://app.example", pathname: "/cadfly/", hash: "" });
  vi.stubGlobal("window", { history: { replaceState: (_s: unknown, _t: string, url: string) => replacedAddress.push(url) } });
  vi.stubGlobal("confirm", (question: string) => {
    asked.push(question);
    return answer;
  });
  vi.stubGlobal("fetch", () => fetched());
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20)); // let the project finish what it started before the page it ran in is taken away
  vi.unstubAllGlobals();
});

describe("changing the blocks", () => {
  test("a change is a step that undo takes back and redo brings back, and it is built and drawn", () => {
    const host = makeHost();
    const project = createProject(host);
    project.change(boxOf("10"));
    project.change(boxOf("20"));
    expect(project.program()).toEqual(boxOf("20"));
    expect(host.schedule).toHaveBeenCalledTimes(2);
    expect(project.canUndo()).toBe(true);
    project.undo();
    expect(project.program()).toEqual(boxOf("10"));
    expect(project.canRedo()).toBe(true);
    project.redo();
    expect(project.program()).toEqual(boxOf("20"));
    project.undo();
    project.undo();
    expect(project.program()).toEqual(createEmptyProgram());
    expect(project.canUndo()).toBe(false);
  });

  test("a change that changes nothing is not a step and builds nothing, but the editor is drawn again", () => {
    const host = makeHost();
    const project = createProject(host);
    project.change(boxOf("10"));
    host.schedule.mockClear();
    host.redraw.mockClear();
    project.change(boxOf("10"));
    expect(host.schedule).not.toHaveBeenCalled();
    expect(host.redraw).toHaveBeenCalledTimes(1);
    project.undo();
    expect(project.program()).toEqual(createEmptyProgram()); // one step was taken, not two
  });

  test("a change that is not undoable (how blocks are shown) leaves no step", () => {
    const project = createProject(makeHost());
    project.change(boxOf("10"), { undoable: false });
    expect(project.canUndo()).toBe(false);
  });

  test("a change clears the message about the last thing that happened", () => {
    const host = makeHost();
    createProject(host).change(boxOf("10"));
    expect(host.clearNotice).toHaveBeenCalled();
  });

  test("blocks changed from outside are one step, and the model is framed again only if the project was blank", () => {
    const host = makeHost();
    const project = createProject(host);
    project.applyAsStep(boxOf("10"));
    expect(host.reframe).toHaveBeenCalledTimes(1);
    project.applyAsStep(boxOf("20"));
    expect(host.reframe).toHaveBeenCalledTimes(1);
    project.undo();
    expect(project.program()).toEqual(boxOf("10"));
  });

  test("undo and redo keep how the blocks are shown (a fold is not a step to undo)", () => {
    const project = createProject(makeHost());
    project.change(boxOf("10"));
    const folded = structuredClone(project.program());
    folded[0].collapsed = true;
    project.change(folded, { undoable: false });
    project.change(boxOf("20"));
    project.undo();
    expect(project.program()[0].blocks[0].args.w).toBe("10");
  });
});

describe("replacing the whole project", () => {
  test("it is one step that undo takes back, with the files that went with it, and it counts as saved", () => {
    const host = makeHost();
    const project = createProject(host);
    project.change(boxOf("10"));
    project.replace(boxOf("30"), { "a.stl": "solid a" });
    expect(host.reframe).toHaveBeenCalledTimes(1);
    expect(project.program()).toEqual(boxOf("30"));
    expect(project.files()).toEqual({ "a.stl": "solid a" });
    project.undo();
    expect(project.program()).toEqual(boxOf("10"));
    expect(project.files()).toEqual({}); // blocks never name a file the project does not have
    project.redo();
    expect(project.files()).toEqual({ "a.stl": "solid a" });
  });

  test("a file that is added or taken away is a step; the blocks stay as they are", () => {
    const project = createProject(makeHost());
    project.change(boxOf("10"));
    project.setFiles({ "a.stl": "solid a" });
    expect(project.files()).toEqual({ "a.stl": "solid a" });
    project.undo();
    expect(project.files()).toEqual({});
    expect(project.program()).toEqual(boxOf("10"));
  });

  test("a file loaded again under its own name does not make a step", () => {
    const project = createProject(makeHost());
    project.setFiles({ "a.stl": "solid a" });
    project.setFiles({ "a.stl": "solid a again" });
    project.undo();
    expect(project.files()).toEqual({}); // the one step was the adding
    project.redo();
    expect(project.files()).toEqual({ "a.stl": "solid a again" }); // and no earlier state keeps the old data
  });
});

describe("what counts as saved", () => {
  test("a project that was replaced or marked saved is not asked about; a changed one is", () => {
    const project = createProject(makeHost());
    project.replace(boxOf("10"));
    expect(project.okToReplace("Open this?")).toBe(true);
    expect(asked).toEqual([]);
    project.change(boxOf("20"));
    expect(project.okToReplace("Open this?")).toBe(true); // the person says yes
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Open this?");
    expect(asked[0]).toMatch(/not been saved/);
    answer = false;
    expect(project.okToReplace("Open this?")).toBe(false);
    project.markSaved();
    asked = [];
    expect(project.okToReplace("Open this?")).toBe(true);
    expect(asked).toEqual([]);
  });

  test("a change to how blocks are shown is not a change to what was saved", () => {
    const project = createProject(makeHost());
    project.replace(boxOf("10"));
    const folded = structuredClone(project.program());
    folded[0].collapsed = true;
    project.change(folded, { undoable: false });
    expect(project.okToReplace("Open this?")).toBe(true);
    expect(asked).toEqual([]);
  });

  test("an added file is something that was not saved", () => {
    const project = createProject(makeHost());
    project.replace(boxOf("10"));
    project.setFiles({ "a.stl": "solid a" });
    project.okToReplace("Open this?");
    expect(asked).toHaveLength(1);
  });
});

describe("what is kept between visits", () => {
  test("the blocks are kept at every change, and come back at the start", () => {
    const first = createProject(makeHost());
    first.change(boxOf("42"));
    const second = createProject(makeHost());
    second.start();
    expect(second.program()).toEqual(boxOf("42"));
  });

  test("blocks that cannot be read are left behind, and the project starts empty", () => {
    stored.set("cadfly.program", "{ not a project");
    const project = createProject(makeHost());
    project.start();
    expect(project.program()).toEqual(createEmptyProgram());
  });

  test("a browser that will not keep the blocks is told once, and forgets the older blocks", () => {
    stored.set("cadfly.program", serializeProject(boxOf("1")));
    refuseStorage = true;
    const host = makeHost();
    const project = createProject(host);
    project.change(boxOf("10"));
    project.change(boxOf("20"));
    const said = host.notify.mock.calls.filter(([m]) => /would not keep the blocks/.test(m as string));
    expect(said).toHaveLength(1);
    expect(stored.get("cadfly.program") ?? "").toBe(""); // the older blocks cannot come back in place of these
  });

  test("the first build waits until the stored files have been looked for", async () => {
    const host = makeHost();
    const project = createProject(host);
    project.start();
    expect(host.filesReady).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(host.filesReady).toHaveBeenCalledTimes(1));
  });

  test("a browser with no place for the files says so, once, and the project goes on without them", async () => {
    const host = makeHost();
    const project = createProject(host);
    project.start(); // these tests run without IndexedDB
    await vi.waitFor(() => expect(host.filesReady).toHaveBeenCalled());
    const said = host.notify.mock.calls.filter(([m]) => /would not open its storage/.test(m as string));
    expect(said).toHaveLength(1);
    project.setFiles({ "a.stl": "solid a" });
    expect(project.files()).toEqual({ "a.stl": "solid a" });
  });
});

describe("opening the project the address names", () => {
  /** Start a project and wait until it has dealt with the address. */
  async function opened(host = makeHost()) {
    const project = createProject(host);
    project.start();
    await vi.waitFor(() => expect(replacedAddress).toHaveLength(1));
    return { project, host };
  }

  test("it fetches the file, replaces the project with it, says so, and takes the request out of the address", async () => {
    search = "?load=" + encodeURIComponent("https://files.example/books/bracket.cadfly") + "&mode=Builder";
    fetched = async () => new Response(serializeProject(boxOf("77")));
    const { project, host } = await opened();
    expect(project.program()).toEqual(boxOf("77"));
    expect(host.notify.mock.calls.map(([m]) => m).some((m) => /Opened bracket.*files\.example/.test(m as string))).toBe(true);
    expect(host.loaded).toHaveBeenCalledTimes(1);
    expect(replacedAddress[0]).toContain("mode=Builder");
    expect(replacedAddress[0]).not.toContain("load=");
    project.undo(); // opening is a step like any other
    expect(project.program()).toEqual(createEmptyProgram());
  });

  test("with unsaved blocks it asks first, and a no leaves them as they were", async () => {
    search = "?load=" + encodeURIComponent("https://files.example/p.cadfly");
    fetched = async () => new Response(serializeProject(boxOf("77")));
    answer = false;
    const host = makeHost();
    const project = createProject(host);
    project.change(boxOf("6")); // unsaved
    project.start();
    await vi.waitFor(() => expect(replacedAddress).toHaveLength(1));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("files.example");
    expect(project.program()).toEqual(boxOf("6")); // the file was not opened
    expect(host.loaded).not.toHaveBeenCalled();
  });

  test("a file that cannot be got or read is reported, and nothing changes", async () => {
    search = "?load=" + encodeURIComponent("https://files.example/p.cadfly");
    fetched = async () => new Response("nope", { status: 404 });
    const first = await opened();
    expect(first.project.program()).toEqual(createEmptyProgram());
    const last = first.host.notify.mock.calls.at(-1)![0] as string;
    expect(last).toContain("files.example");
    replacedAddress = [];
    fetched = async () => new Response("this is not a project");
    const second = await opened();
    expect(second.project.program()).toEqual(createEmptyProgram());
    expect(second.host.loaded).not.toHaveBeenCalled();
    expect((second.host.notify.mock.calls.at(-1)![0] as string).length).toBeGreaterThan(0);
  });

  test("an address that is not one that can be opened is reported, and the request is still taken out", async () => {
    search = "?load=" + encodeURIComponent("http://files.example/p.cadfly"); // plain http is refused
    const { project, host } = await opened();
    expect(project.program()).toEqual(createEmptyProgram());
    expect((host.notify.mock.calls.at(-1)![0] as string).length).toBeGreaterThan(0);
    expect(host.loaded).not.toHaveBeenCalled();
  });

  test("an address with no request does nothing to the address", async () => {
    const host = makeHost();
    createProject(host).start();
    await vi.waitFor(() => expect(host.filesReady).toHaveBeenCalled());
    expect(replacedAddress).toEqual([]);
  });
});
