import { beforeAll, describe, expect, test } from "vitest";
import { writeStl } from "../src/cadfly/geometry/stl";
import { createManifoldKernel } from "../src/cadfly/geometry/manifold";
import { toBase64 } from "../src/cadfly/geometry/stl";
import type { StlFiles } from "../src/cadfly/language/files";
import { type FileStore, FilePersister, createMemoryStore } from "../src/cadfly/ui/fileStore";

/**
 * Keeping a project's STL files between visits, against an in-memory store and
 * one that fails on demand.
 */

let good: (w: number) => string;
beforeAll(async () => {
  const k = await createManifoldKernel();
  good = (w) => toBase64(writeStl(k.box(w, 10, 10).mesh()));
});

/** A store that records what is done to it, and can be made to fail. */
function recording(initial: Record<string, unknown> = {}) {
  const store = createMemoryStore(initial);
  const log: string[] = [];
  const failing = { put: new Set<string>(), remove: new Set<string>(), load: false };
  const wrapped: FileStore & { entries: Record<string, unknown> } = {
    entries: store.entries,
    async load() {
      if (failing.load) throw new Error("cannot read");
      return store.load();
    },
    async put(name, data) {
      log.push(`put ${name}`);
      if (failing.put.has(name)) throw new Error("full");
      return store.put(name, data);
    },
    async remove(name) {
      log.push(`remove ${name}`);
      if (failing.remove.has(name)) throw new Error("stuck");
      return store.remove(name);
    },
  };
  return { store: wrapped, log, failing };
}

describe("loading the files", () => {
  test("the good files come back as they were kept", async () => {
    const a = good(10);
    const { store } = recording({ "a.stl": a });
    expect((await new FilePersister(store).load()).files).toEqual({ "a.stl": a });
  });

  test("an entry that is not a good file is skipped and named, and the rest still load", async () => {
    const a = good(10);
    const { store } = recording({ "a.stl": a, "bad.stl": "not base64!", "worse.stl": 42, "notes.txt": a });
    const loaded = await new FilePersister(store).load();
    expect(loaded.files).toEqual({ "a.stl": a });
    expect(loaded.skipped.sort()).toEqual(["bad.stl", "notes.txt", "worse.stl"]);
  });

  test("a store that cannot be read rejects, so the caller can say so", async () => {
    const { store, failing } = recording();
    failing.load = true;
    await expect(new FilePersister(store).load()).rejects.toThrow("cannot read");
  });
});

describe("saving the files", () => {
  test("only the files that are new or changed are written, and the ones that are gone are removed", async () => {
    const a = good(10);
    const b = good(20);
    const c = good(30);
    const { store, log } = recording({ "a.stl": a, "b.stl": b });
    const persister = new FilePersister(store);
    await persister.load();
    expect(await persister.save({ "a.stl": a, "b.stl": c, "c.stl": a })).toEqual([]);
    expect(log).toEqual(["put b.stl", "put c.stl"]);
    log.length = 0;
    expect(await persister.save({ "c.stl": a })).toEqual([]);
    expect(log).toEqual(["remove a.stl", "remove b.stl"]);
    expect(Object.keys(store.entries)).toEqual(["c.stl"]);
  });

  test("saving what is already kept does nothing", async () => {
    const a = good(10);
    const { store, log } = recording({ "a.stl": a });
    const persister = new FilePersister(store);
    await persister.load();
    await persister.save({ "a.stl": a });
    await persister.save({ "a.stl": "" + a }); // another string with the same text
    expect(log).toEqual([]);
  });

  test("a file that cannot be written loses its old entry, so an older version does not come back", async () => {
    const old = good(10);
    const bigger = good(20);
    const { store, failing } = recording({ "gear.stl": old });
    const persister = new FilePersister(store);
    await persister.load();
    failing.put.add("gear.stl");
    expect(await persister.save({ "gear.stl": bigger })).toEqual(["gear.stl"]);
    expect(store.entries).toEqual({});
    // and the next save tries again
    failing.put.clear();
    expect(await persister.save({ "gear.stl": bigger })).toEqual([]);
    expect(store.entries).toEqual({ "gear.stl": bigger });
  });

  test("a store that keeps nothing reports every file, and saving never throws", async () => {
    const { store, failing } = recording();
    failing.put.add("a.stl").add("b.stl");
    const persister = new FilePersister(store);
    expect((await persister.save({ "a.stl": good(10), "b.stl": good(20) })).sort()).toEqual(["a.stl", "b.stl"]);
  });

  test("a removal that fails is reported, and tried again with the next save", async () => {
    const a = good(10);
    const { store, failing } = recording({ "a.stl": a });
    const persister = new FilePersister(store);
    await persister.load();
    failing.remove.add("a.stl");
    expect(await persister.save({})).toEqual(["a.stl"]);
    failing.remove.clear();
    expect(await persister.save({})).toEqual([]);
    expect(store.entries).toEqual({});
  });

  test("operations run in the order they were asked for: a save asked for before a load finishes waits for it", async () => {
    const a = good(10);
    const { store, log } = recording({ "old.stl": a });
    const persister = new FilePersister(store);
    const loading = persister.load();
    const saving = persister.save({ "new.stl": a });
    await Promise.all([loading, saving]);
    // the load knew about old.stl before the save compared, so the save removed it deliberately, not by mistake
    expect(log).toEqual(["put new.stl", "remove old.stl"]);
  });
});

describe("moving the old localStorage files into the store", () => {
  test("every good file is stored, and only then is the old text cleared", async () => {
    const a = good(10);
    const { store } = recording();
    const persister = new FilePersister(store);
    await persister.load();
    let cleared = 0;
    const moved = await persister.migrate(JSON.stringify({ "a.stl": a, "bad.stl": "x" }), () => cleared++);
    expect(moved).toEqual({ "a.stl": a });
    expect(store.entries).toEqual({ "a.stl": a });
    expect(cleared).toBe(1);
  });

  test("a failed move keeps the old text, and is tried again next time", async () => {
    const a = good(10);
    const { store, failing } = recording();
    const persister = new FilePersister(store);
    await persister.load();
    failing.put.add("a.stl");
    let cleared = 0;
    await persister.migrate(JSON.stringify({ "a.stl": a }), () => cleared++);
    expect(cleared).toBe(0);
    failing.put.clear();
    await persister.migrate(JSON.stringify({ "a.stl": a }), () => cleared++);
    expect(cleared).toBe(1);
    expect(store.entries).toEqual({ "a.stl": a });
  });

  test("the store's own version of a file is not overwritten by the old text", async () => {
    const stored = good(20);
    const old = good(10);
    const { store } = recording({ "a.stl": stored });
    const persister = new FilePersister(store);
    await persister.load();
    await persister.migrate(JSON.stringify({ "a.stl": old }), () => undefined);
    expect(store.entries).toEqual({ "a.stl": stored });
  });

  test("nothing, or text that is not a set of files, is left alone", async () => {
    const { store } = recording();
    const persister = new FilePersister(store);
    let cleared = 0;
    expect(await persister.migrate("", () => cleared++)).toEqual({});
    expect(await persister.migrate("{not json", () => cleared++)).toEqual({});
    expect(await persister.migrate("[1]", () => cleared++)).toEqual({});
    expect(cleared).toBe(0);
    expect(store.entries).toEqual({});
  });
});

describe("the files as a project", () => {
  test("a project's files survive a save and a fresh load", async () => {
    const files: StlFiles = { "a.stl": good(10), "b.stl": good(20) };
    const { store } = recording();
    await new FilePersister(store).save(files);
    expect((await new FilePersister(store).load()).files).toEqual(files);
  });
});
