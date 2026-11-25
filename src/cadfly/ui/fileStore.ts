import { type StlFiles, validateStlFiles } from "../language/files";

/**
 * Keeping a project's STL files in the browser between visits. The files can be
 * many megabytes of text, more than `localStorage` will hold, so they go in
 * IndexedDB, one entry for each file, and only the files that changed are
 * written. If the browser will not keep them (a private window, a full disk,
 * IndexedDB turned off), the project goes on working with its files in memory,
 * and the person is told. A file that is kept is never left holding an older
 * version of itself: when a write fails, the old entry is removed.
 */

/**
 * Where files are kept: whole entries by name. A store reports a failure by
 * rejecting.
 */
export interface FileStore {
  /** Every entry, by name, as it was kept (whatever it holds: the entries are checked by whoever reads them) */
  load(): Promise<Record<string, unknown>>;
  /**
   * Keep one file, replacing what is there.
   *
   * @param name The file's name.
   * @param data The file as base64 text.
   */
  put(name: string, data: string): Promise<void>;
  /**
   * Forget one file (nothing happens if it is not there).
   *
   * @param name The file's name.
   */
  remove(name: string): Promise<void>;
}

/** The database and the store inside it that hold the files. */
const DATABASE = "cadfly";
const STORE = "files";

/**
 * Files kept in IndexedDB.
 *
 * @param factory The browser's IndexedDB. Default: the page's own, if it has
 *                one; without one every operation rejects.
 */
export function createIndexedDbStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): FileStore {
  /** The open database, once it has been asked for. */
  let opening: Promise<IDBDatabase> | undefined;

  /** The database, opened the first time it is needed (and tried again if that failed). */
  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!factory) return reject(new Error("this browser has no IndexedDB"));
      try {
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB would not open"));
        request.onblocked = () => reject(new Error("IndexedDB is blocked by another page"));
      } catch (e) {
        reject(e);
      }
    }).catch((e) => {
      opening = undefined;
      throw e;
    });
    return opening;
  }

  /**
   * Run something in one transaction on the files, and wait for the
   * transaction to finish.
   *
   * @param mode Whether the transaction writes.
   * @param job Asks for what is wanted from the object store; it may give back the request whose result is the answer.
   */
  async function inTransaction<T>(mode: IDBTransactionMode, job: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
    const db = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = job(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB stopped"));
    });
  }

  return {
    async load() {
      const db = await open();
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const found: Record<string, unknown> = {};
        const request = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve(found);
          found[String(cursor.key)] = cursor.value;
          cursor.continue();
        };
        request.onerror = () => reject(request.error ?? new Error("IndexedDB failed"));
      });
    },
    async put(name, data) {
      await inTransaction("readwrite", (store) => void store.put(data, name));
    },
    async remove(name) {
      await inTransaction("readwrite", (store) => void store.delete(name));
    },
  };
}

/**
 * Files kept in memory, which is nowhere at all: the stand-in for when the
 * browser keeps nothing, and for tests.
 *
 * @param initial What is in it to begin with.
 */
export function createMemoryStore(initial: Record<string, unknown> = {}): FileStore & { entries: Record<string, unknown> } {
  const entries: Record<string, unknown> = { ...initial };
  return {
    entries,
    load: async () => ({ ...entries }),
    put: async (name, data) => void (entries[name] = data),
    remove: async (name) => void delete entries[name],
  };
}

/** What `load` found: the files that were fine, and the names of the entries that were not (and so were left out). */
export interface LoadedFiles {
  files: StlFiles;
  skipped: string[];
}

/**
 * Whether an entry from a store is a good file: a good name, base64 text, a
 * size within the limit, and an STL that reads. (The total size of all of them
 * is not checked: they were all accepted once.)
 *
 * @param name The entry's name.
 * @param data What the entry holds.
 */
function isGoodFile(name: string, data: unknown): boolean {
  try {
    validateStlFiles({ [name]: data });
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps a project's files in a store, writing only what changed. The
 * operations run one after another, in the order they were asked for, so a
 * save never overtakes the load before it.
 */
export class FilePersister {
  /** What the store holds, as far as is known: name to data. */
  private persisted: StlFiles = {};
  /** The last operation, which the next one waits for. */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * @param store Where the files are kept.
   */
  constructor(private readonly store: FileStore) {}

  /**
   * Run a job after the ones before it.
   *
   * @param job The job.
   */
  private queued<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    this.tail = result.catch(() => undefined);
    return result;
  }

  /**
   * Read the files the store holds. An entry that is not a good file is left
   * out and its name is reported, and the rest are kept as they are. Rejects
   * if the store cannot be read at all.
   */
  load(): Promise<LoadedFiles> {
    return this.queued(async () => {
      const raw = await this.store.load();
      const files: StlFiles = {};
      const skipped: string[] = [];
      for (const [name, data] of Object.entries(raw)) {
        if (isGoodFile(name, data)) files[name] = data as string;
        else skipped.push(name);
      }
      this.persisted = { ...files };
      return { files, skipped };
    });
  }

  /**
   * Make the store hold exactly these files: write the ones that are new or
   * changed, and remove the ones that are gone. When a file cannot be written,
   * its old entry is removed too, so that it is lost and not quietly kept as an
   * older version. Never rejects.
   *
   * @param files The project's files.
   * @returns The names of the files the store could not be made right for
   *          (none, when it all worked).
   */
  save(files: StlFiles): Promise<string[]> {
    return this.queued(async () => {
      const failed: string[] = [];
      for (const [name, data] of Object.entries(files)) {
        if (this.persisted[name] === data) continue;
        try {
          await this.store.put(name, data);
          this.persisted[name] = data;
        } catch {
          failed.push(name);
          delete this.persisted[name];
          await this.store.remove(name).catch(() => undefined);
        }
      }
      for (const name of Object.keys(this.persisted)) {
        if (name in files) continue;
        try {
          await this.store.remove(name);
          delete this.persisted[name];
        } catch {
          failed.push(name);
        }
      }
      return failed;
    });
  }

  /**
   * Move the files that an older version kept as one piece of text in
   * `localStorage` into the store, once. The old text is cleared only after
   * every good file in it is safely in the store, so a failed move loses
   * nothing and is tried again next time. Text that is not a set of files is
   * left alone.
   *
   * @param text The old text ("" if there is none).
   * @param clear Forgets the old text.
   * @returns The good files that were in the old text (the store may already
   *          hold newer versions of the same names: the caller decides which
   *          to use).
   */
  migrate(text: string, clear: () => void): Promise<StlFiles> {
    return this.queued(async () => {
      if (!text) return {};
      let old: unknown;
      try {
        old = JSON.parse(text);
      } catch {
        return {};
      }
      if (typeof old !== "object" || old === null || Array.isArray(old)) return {};
      const files: StlFiles = {};
      for (const [name, data] of Object.entries(old)) if (isGoodFile(name, data)) files[name] = data as string;
      let kept = true;
      for (const [name, data] of Object.entries(files)) {
        if (name in this.persisted) continue; // the store has its own version, which is the newer
        try {
          await this.store.put(name, data);
          this.persisted[name] = data;
        } catch {
          kept = false;
        }
      }
      if (kept) clear();
      return files;
    });
  }
}
