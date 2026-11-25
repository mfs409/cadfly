// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { type DropHost, watchDrops } from "../src/cadfly/app/dropFile";

/*
 * What the page does while files are dragged over it and dropped on it: a
 * message says where to drop while a file is being dragged, it stays steady as
 * the drag crosses elements, it goes when the drag leaves or ends, a dropped
 * project file is opened once, several files open only one, and drags that carry
 * no file (and the browser's own handling of a dropped file) are left alone or
 * stopped as they should be.
 */

/**
 * A drag event of this kind. It carries the given files, or only text when
 * there are none, in the way a browser's drag event does.
 */
function drag(type: string, files: File[] | undefined = undefined, options: { relatedTarget?: EventTarget | null } = {}): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types: files ? ["Files"] : ["text/plain"], files: files ?? [], dropEffect: "none" };
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(event, "relatedTarget", { value: options.relatedTarget ?? null });
  return event;
}

/** A file with this name. */
const file = (name: string) => new File(["{}"], name);

/** The message shown over the page, if it is showing. */
const cue = () => [...document.body.children].find((e) => /Drop a \.cadfly file/.test(e.textContent ?? ""));

/** Wait for what a drop starts: opening the file, which takes a few turns. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let open: ReturnType<typeof vi.fn<DropHost["open"]>>;
let notify: ReturnType<typeof vi.fn<DropHost["notify"]>>;
let stop: () => void;

beforeEach(() => {
  document.body.innerHTML = "<div id='canvas'></div>";
  open = vi.fn(async () => true);
  notify = vi.fn();
  stop = watchDrops({ open, notify });
});

afterEach(() => stop());

describe("the message while a file is dragged over the page", () => {
  test("it appears when a file enters the page, and says where to drop it", () => {
    expect(cue()).toBeUndefined();
    document.dispatchEvent(drag("dragenter", [file("a.cadfly")]));
    expect(cue()).toBeDefined();
  });

  test("it lets pointer events through, so it never changes what is under the drag", () => {
    document.dispatchEvent(drag("dragenter", [file("a.cadfly")]));
    expect((cue() as HTMLElement).style.pointerEvents).toBe("none");
  });

  test("it stays while the drag crosses from one element to another, and goes only when the drag has left them all", () => {
    const inner = document.getElementById("canvas")!;
    document.dispatchEvent(drag("dragenter", [file("a.cadfly")])); // into the page
    inner.dispatchEvent(drag("dragenter", [file("a.cadfly")])); // into the canvas
    document.dispatchEvent(drag("dragleave", [file("a.cadfly")])); // out of the page's own area
    expect(cue()).toBeDefined();
    inner.dispatchEvent(drag("dragleave", [file("a.cadfly")])); // out of the canvas, and so out of the page
    expect(cue()).toBeUndefined();
  });

  test("there is only ever one, however many elements the drag enters", () => {
    for (let i = 0; i < 3; i++) document.dispatchEvent(drag("dragenter", [file("a.cadfly")]));
    expect([...document.body.children].filter((e) => /Drop a/.test(e.textContent ?? "")).length).toBe(1);
  });

  test("it goes when the drag ends without a drop", () => {
    document.dispatchEvent(drag("dragenter", [file("a.cadfly")]));
    document.dispatchEvent(drag("dragend"));
    expect(cue()).toBeUndefined();
  });

  test("it goes when the file is dropped", async () => {
    document.dispatchEvent(drag("dragenter", [file("a.cadfly")]));
    document.dispatchEvent(drag("drop", [file("a.cadfly")]));
    await settled();
    expect(cue()).toBeUndefined();
  });

  test("a drag that carries no file shows nothing", () => {
    document.dispatchEvent(drag("dragenter"));
    expect(cue()).toBeUndefined();
  });

  test("it is taken away when watching stops", () => {
    document.dispatchEvent(drag("dragenter", [file("a.cadfly")]));
    stop();
    expect(cue()).toBeUndefined();
    document.dispatchEvent(drag("dragenter", [file("a.cadfly")]));
    expect(cue()).toBeUndefined();
  });
});

describe("dropping files", () => {
  test("a project file is opened once, and nothing is said when it is the only file", async () => {
    const dropped = file("a.cadfly");
    document.dispatchEvent(drag("drop", [dropped]));
    await settled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(dropped);
    expect(notify).not.toHaveBeenCalled();
  });

  test("with several files only the first project file is opened, and the person is told that the rest were not", async () => {
    const first = file("b.cadfly");
    document.dispatchEvent(drag("drop", [file("notes.txt"), first, file("c.cadfly")]));
    await settled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(first);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/b\.cadfly/);
    expect(notify.mock.calls[0][0]).toMatch(/other 2 files/);
  });

  test("nothing is said about the other files when the project file could not be opened", async () => {
    open.mockResolvedValueOnce(false);
    document.dispatchEvent(drag("drop", [file("a.cadfly"), file("b.cadfly")]));
    await settled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  test("a file that is not a project file is still handed to be opened, which is where it is refused and said", async () => {
    const dropped = file("picture.png");
    document.dispatchEvent(drag("drop", [dropped]));
    await settled();
    expect(open).toHaveBeenCalledWith(dropped);
  });

  test("a drop of no files opens nothing", async () => {
    document.dispatchEvent(drag("drop", []));
    await settled();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("the browser's own handling of a dropped file", () => {
  test("it is stopped for a drag that carries files: entering, moving over the page and dropping", () => {
    for (const type of ["dragenter", "dragover", "drop"]) {
      const event = drag(type, [file("a.cadfly")]);
      document.dispatchEvent(event);
      expect(event.defaultPrevented, type).toBe(true);
    }
  });

  test("moving over the page says the drop will copy", () => {
    const event = drag("dragover", [file("a.cadfly")]);
    document.dispatchEvent(event);
    expect((event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect).toBe("copy"); // cast: the event is made by `drag` with a dataTransfer
  });

  test("it is left alone for a drag that carries no file, such as text dragged around the page", async () => {
    for (const type of ["dragenter", "dragover", "drop"]) {
      const event = drag(type);
      document.dispatchEvent(event);
      expect(event.defaultPrevented, type).toBe(false);
    }
    await settled();
    expect(open).not.toHaveBeenCalled();
  });

  test("a drop reaches it even when something on the page stops the event from spreading", async () => {
    const inner = document.getElementById("canvas")!;
    inner.addEventListener("drop", (e) => e.stopPropagation());
    inner.dispatchEvent(drag("drop", [file("a.cadfly")]));
    await settled();
    expect(open).toHaveBeenCalledTimes(1);
  });
});
