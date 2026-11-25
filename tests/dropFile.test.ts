import { describe, expect, test, vi } from "vitest";
import { ignoredNote, planDrop } from "../src/cadfly/app/dropFile";
import { type OpenFileHost, openProjectFile } from "../src/cadfly/app/openProjectFile";
import { exampleById } from "../src/cadfly/examples";
import { serializeProject } from "../src/cadfly/language/format";

/*
 * Choosing which dropped file to open and what to tell the person about the
 * others, and opening a project file the person gave (by the Load button or by
 * dropping it): what is accepted, what is refused and said, what is asked
 * before blocks are replaced, and that a refusal changes nothing.
 */

/** A project file's text, made from a built-in example. */
const projectText = () => serializeProject(structuredClone(exampleById("step-stool")!.program), {});

/** A stand-in for the page, recording what was done. `ok` is the answer to "replace the blocks?". */
function pageThat(ok = true) {
  const replace = vi.fn();
  const okToReplace = vi.fn((_what: string) => ok);
  const noteHiddenBlocks = vi.fn();
  const notify = vi.fn();
  const host: OpenFileHost = { project: { okToReplace, replace }, settings: { noteHiddenBlocks }, notify };
  return { host, replace, okToReplace, noteHiddenBlocks, notify };
}

describe("choosing the dropped file to open", () => {
  test("nothing is chosen when no file was dropped", () => {
    expect(planDrop([])).toBeUndefined();
  });

  test("a single project file is chosen and nothing is left out", () => {
    expect(planDrop(["bracket.cadfly"])).toEqual({ index: 0, ignored: 0 });
  });

  test("the first project file is chosen, wherever it is, and the other files are counted as left out", () => {
    expect(planDrop(["notes.txt", "a.cadfly", "b.cadfly"])).toEqual({ index: 1, ignored: 2 });
  });

  test("the name is matched without regard to case", () => {
    expect(planDrop(["MODEL.CADFLY"])?.index).toBe(0);
  });

  test("when no file is a project file the first is chosen, so that opening it can say what is wrong", () => {
    expect(planDrop(["a.txt", "b.png"])).toEqual({ index: 0, ignored: 1 });
  });

  test("the note after opening one of several says which was opened and how many were not", () => {
    expect(ignoredNote("a.cadfly", 1)).toMatch(/a\.cadfly/);
    expect(ignoredNote("a.cadfly", 1)).toMatch(/other file/);
    expect(ignoredNote("a.cadfly", 3)).toMatch(/other 3 files/);
  });
});

describe("opening a project file", () => {
  test("a good project replaces the blocks and files once, after asking, and reports blocks the mode does not offer", async () => {
    const page = pageThat();
    const opened = await openProjectFile(new File([projectText()], "stool.cadfly"), page.host);
    expect(opened).toBe(true);
    expect(page.okToReplace).toHaveBeenCalledTimes(1);
    expect(page.okToReplace.mock.calls[0][0]).toMatch(/stool\.cadfly/);
    expect(page.replace).toHaveBeenCalledTimes(1);
    const [program, files] = page.replace.mock.calls[0];
    expect(program).toEqual(structuredClone(exampleById("step-stool")!.program));
    expect(files).toEqual({});
    expect(page.noteHiddenBlocks).toHaveBeenCalledTimes(1);
    expect(page.notify).not.toHaveBeenCalled();
  });

  test("a file that is not named like a project is refused and said so, without reading it or asking", async () => {
    const page = pageThat();
    const opened = await openProjectFile(new File([projectText()], "stool.txt"), page.host);
    expect(opened).toBe(false);
    expect(page.notify).toHaveBeenCalledWith("stool.txt: that is not a .cadfly file");
    expect(page.okToReplace).not.toHaveBeenCalled();
    expect(page.replace).not.toHaveBeenCalled();
  });

  test("a file that is not a good project is refused with the reason, and nothing changes", async () => {
    const page = pageThat();
    const opened = await openProjectFile(new File(["<html>not a project</html>"], "bad.cadfly"), page.host);
    expect(opened).toBe(false);
    expect(page.notify).toHaveBeenCalledTimes(1);
    expect(page.notify.mock.calls[0][0]).toMatch(/^bad\.cadfly: /);
    expect(page.okToReplace).not.toHaveBeenCalled();
    expect(page.replace).not.toHaveBeenCalled();
  });

  test("declining to replace unsaved blocks leaves the project alone and says nothing", async () => {
    const page = pageThat(false);
    const opened = await openProjectFile(new File([projectText()], "stool.cadfly"), page.host);
    expect(opened).toBe(false);
    expect(page.okToReplace).toHaveBeenCalledTimes(1);
    expect(page.replace).not.toHaveBeenCalled();
    expect(page.noteHiddenBlocks).not.toHaveBeenCalled();
    expect(page.notify).not.toHaveBeenCalled();
  });
});
