import { describeSource, loadTarget, projectNameOf, withoutLoadParam } from "../address";
import { LoadError, fetchProjectText } from "../fetchProject";
import { keepOnlyMeshesNamed } from "../geometry/stl";
import { History, type ProjectState, copyForHistory, replacingFileData, sameFileNames } from "../history";
import { carryViewState } from "../language/edit";
import type { StlFiles } from "../language/files";
import { parseProject, serializeProject } from "../language/format";
import { createEmptyProgram, isBlank } from "../language/program";
import type { Program } from "../language/types";
import { unsavedChanges, contentText } from "../unsaved";
import { FilePersister, createIndexedDbStore } from "../ui/fileStore";
import { readStored, writeStored } from "../ui/storage";

/**
 * The project: the blocks and the STL files they use, the history of changes to
 * them, what is kept in the browser between visits (the blocks in local
 * storage, the files in IndexedDB), whether anything was changed since it was
 * saved, and the ways a whole project is replaced (a file, an example, New, a
 * project the page's address names, undo and redo). Whatever must follow a
 * change (building, drawing, a message) is left to the host.
 */

/** Where the program is kept between visits */
const STORAGE_KEY = "cadfly.program";
/** Where an older version kept the project's STL files, as one piece of text: they now go in IndexedDB, and this is read once and cleared */
const OLD_FILES_KEY = "cadfly.files";

/** What the project needs from the page it is in. */
export interface ProjectHost {
  /** The blocks or the files changed: build the program after a short wait. */
  schedule(): void;
  /** The files have been brought back from the browser: builds may begin, and the first one is wanted now. */
  filesReady(): void;
  /** The project was replaced: frame the model again when the next shape appears. */
  reframe(): void;
  /** Draw the editor again. */
  redraw(): void;
  /** Take the message about the last thing that happened away, since the blocks changed. */
  clearNotice(): void;
  /** Say something to the person, and keep it until the next change. */
  notify(message: string): void;
  /** A whole project was loaded: say which of its blocks this mode does not offer. */
  loaded(): void;
}

/** What the project offers. */
export interface Project {
  /** The blocks as they are now */
  program(): Program;
  /** The STL files the project carries, for import blocks */
  files(): StlFiles;
  /** Can a step be taken back? */
  canUndo(): boolean;
  /** Can a step be brought back? */
  canRedo(): boolean;
  /** Go back one step, if there is one. */
  undo(): void;
  /** Go forward one step, if there is one. */
  redo(): void;
  /**
   * The person changed the blocks. A change that changes nothing (a field left
   * as it was) is not a step, and builds nothing.
   *
   * @param next The new blocks.
   * @param options `undoable: false` for a change to how the blocks are shown.
   */
  change(next: Program, options?: { undoable?: boolean }): void;
  /** Keep the current state as a step to undo to. */
  record(): void;
  /** Make this the program: keep it, build it, and draw. It does not touch the history. */
  setProgram(next: Program): void;
  /** The blocks were changed from outside (by the assistant, or by adding an example): one step that Undo takes back. */
  applyAsStep(next: Program): void;
  /**
   * The person added a file, took one away, or loaded one again under a name
   * the project has. Adding and removing can be undone; loading a file again
   * cannot, and no earlier state keeps the old file.
   */
  setFiles(next: StlFiles): void;
  /**
   * Replace everything with a program that came from outside (a file, an
   * example, New), as one step that Undo takes back. It counts as saved, since
   * it can be had again.
   *
   * @param next The new blocks.
   * @param nextFiles The project's files too, if they are replaced.
   */
  replace(next: Program, nextFiles?: StlFiles): void;
  /** Take the project as it is now to be the saved one. */
  markSaved(): void;
  /**
   * Ask before replacing blocks that were not saved (nothing to ask when there
   * are none, or they were saved).
   *
   * @param what What is about to happen, for the question.
   * @returns True if it is all right to go on.
   */
  okToReplace(what: string): boolean;
  /** Bring back the last program and its files, then open the project the address names, if any. */
  start(): void;
}

/**
 * Make the project.
 *
 * @param host What follows from a change.
 */
export function createProject(host: ProjectHost): Project {
  /** The blocks as they are now. */
  let program: Program = createEmptyProgram();
  /** The STL files the project carries, for import blocks */
  let files: StlFiles = {};
  /** Undo and redo take back (and bring back) the blocks and the files together, so that blocks never name a file the project does not have */
  const history = new History<ProjectState>(copyForHistory);
  /** The project as it is now, for the history */
  const projectState = (): ProjectState => ({ program, files });
  /**
   * Have the project's files been brought back from the browser? Nothing is
   * written before they have, since what is stored would be lost.
   */
  let filesLoaded = false;
  /** Where the project's files are kept between visits: in IndexedDB, which holds far more than local storage. */
  const filePersister = new FilePersister(createIndexedDbStore());
  /** The blocks, as text without how they are shown, when they were last saved (or loaded, or are an unchanged example) */
  let savedProgramText = "";
  /** The files when they were last saved. Files are never changed in place, so they are told apart by what they hold. */
  let savedFiles: StlFiles = {};
  /**
   * Whether a message was already shown about the browser not keeping
   * something: it is said once, not after every change.
   */
  let storageWarned = false;

  /**
   * Say, once, that the browser would not keep something between visits.
   *
   * @param message What to say.
   */
  function warnStorage(message: string) {
    if (storageWarned) return;
    storageWarned = true;
    host.notify(message);
  }

  /**
   * Keep the blocks in the browser. If it will not (a private window, a full
   * disk), the older blocks it holds are forgotten too, so that they cannot
   * come back in place of these, and the person is told once.
   */
  function keepProgram() {
    if (writeStored(STORAGE_KEY, serializeProject(program))) return;
    writeStored(STORAGE_KEY, "");
    warnStorage("This browser would not keep the blocks for your next visit. Save keeps them in a file.");
  }

  /**
   * Make this the program: clear the notice, keep it in the browser, and have
   * it built and drawn. It does not touch the history, which the caller
   * decides.
   *
   * @param next The new blocks.
   */
  function setProgram(next: Program) {
    program = next;
    host.clearNotice();
    keepProgram();
    host.schedule();
    host.redraw();
  }

  /**
   * Make the browser's copy of the files the same as the project's: only the
   * files that changed are written. Nothing is written before the stored files
   * have been brought back, since what is stored would be lost; once they are,
   * the files that are there are saved. If the browser will not keep them, they
   * last until the page closes, and the person is told once.
   */
  async function keepFiles() {
    if (!filesLoaded) return;
    const failed = await filePersister.save(files);
    if (failed.length) warnStorage(`This browser would not keep ${failed.length === 1 ? failed[0] : "all the files"} for your next visit: ${failed.length === 1 ? "it" : "they"} will be lost when the page closes. Save keeps the project, files and all, in a file.`);
  }

  /**
   * Take a new set of files. This does not build the program (the caller
   * does, once, after the program is set too) and does not touch the history:
   * whether a change to the files is an undo step is decided by whoever calls
   * it.
   *
   * @param next The files.
   */
  function applyFiles(next: StlFiles) {
    files = next;
    keepOnlyMeshesNamed(Object.keys(files)); // frees the parsed files that were removed
    void keepFiles();
    host.redraw();
  }

  /** Take the project as it is now to be the saved one. */
  function markSaved() {
    savedProgramText = contentText(program);
    savedFiles = files;
  }

  /**
   * Replace everything with a program that came from outside (a file, an
   * example, New), as one step that Undo takes back.
   *
   * @param next The new blocks.
   * @param nextFiles The project's files too, if they are replaced.
   */
  function replace(next: Program, nextFiles?: StlFiles) {
    history.record(projectState());
    host.reframe();
    if (nextFiles && (Object.keys(nextFiles).length || Object.keys(files).length)) applyFiles(nextFiles);
    setProgram(next);
    markSaved();
  }

  /** True if there is something here that was not saved since it last changed */
  const unsaved = () => unsavedChanges(program, files, savedProgramText, savedFiles);

  /**
   * Put the project back as a state of the history had it: the files first,
   * since the blocks may use them. What is folded, opened or moved stays as it
   * is now, since those are not steps to undo.
   *
   * @param to The state to go back (or forward) to.
   */
  function restore(to: ProjectState) {
    if (to.files !== files) applyFiles(to.files);
    setProgram(carryViewState(to.program, program));
  }

  /**
   * Open the project that the page's address asks for (`?load=<address>`), if
   * it asks for one: fetch it, check it like a chosen file, and replace the
   * blocks and files with it after asking if there are unsaved blocks. Whatever
   * happens (opened, refused, declined, failed), the request is taken out of the
   * address afterwards, so reloading the page does not replace later edits.
   */
  async function openFromAddress() {
    const target = loadTarget(location.search, location.href);
    if (target === undefined) return;
    try {
      if ("error" in target) throw new LoadError(target.error);
      const label = describeSource(target.url);
      host.notify(`Opening ${label}…`);
      const text = await fetchProjectText(target.url, { pageOrigin: location.origin });
      let loaded: ReturnType<typeof parseProject>;
      try {
        loaded = parseProject(text);
      } catch (e) {
        throw new LoadError(`${label}: ${(e as Error).message}`);
      }
      const name = projectNameOf(target.url);
      if (!okToReplace(`Open ${name} from ${target.url.host}?`)) {
        host.notify("");
        return;
      }
      replace(loaded.program, loaded.files);
      host.notify(`Opened ${name} from ${target.url.host}.`);
      host.loaded();
    } catch (e) {
      host.notify((e as Error).message);
    } finally {
      try {
        window.history.replaceState(null, "", location.pathname + withoutLoadParam(location.search) + location.hash);
      } catch {
        // a page that is not allowed to change its address keeps it
      }
    }
  }

  /**
   * Ask before replacing blocks that were not saved.
   *
   * @param what What is about to happen, for the question.
   */
  function okToReplace(what: string): boolean {
    return !unsaved() || confirm(`${what}\n\nThe blocks you have now have not been saved since you last changed them (Save keeps them in a file). Go ahead and replace them?`);
  }

  return {
    program: () => program,
    files: () => files,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    undo() {
      const prev = history.undo(projectState());
      if (prev) restore(prev);
    },
    redo() {
      const next = history.redo(projectState());
      if (next) restore(next);
    },
    change(next, options) {
      // a change that changes nothing (a field left as it was) is not a step, and builds nothing
      if (JSON.stringify(next) === JSON.stringify(program)) {
        host.redraw();
        return;
      }
      if (options?.undoable !== false) history.record(projectState());
      setProgram(next);
    },
    record: () => history.record(projectState()),
    setProgram,
    applyAsStep(next) {
      history.record(projectState());
      if (isBlank(program)) host.reframe();
      setProgram(next);
    },
    setFiles(next) {
      if (sameFileNames(files, next)) {
        for (const [name, data] of Object.entries(next)) if (files[name] !== data) history.amendAll(replacingFileData(name, data));
      } else {
        history.record(projectState());
      }
      applyFiles(next);
      host.schedule();
    },
    replace,
    markSaved,
    okToReplace,
    start() {
      // The blocks come back at once. They are read apart from the files: a file that cannot be read must not lose the blocks.
      try {
        const savedProgram = readStored(STORAGE_KEY);
        if (savedProgram) program = parseProject(savedProgram).program;
      } catch {
        // nothing saved, or it cannot be read: start empty
      }
      host.redraw();
      /**
       * The files come back from IndexedDB (and, once, from where an older
       * version kept them). The first build starts when they are here; until
       * then nothing is built, since a program that imports a file cannot be. A
       * file that cannot be read is left out and named; the others come back.
       */
      void (async () => {
        const startFiles = files;
        let stored = { files: {} as StlFiles, skipped: [] as string[] };
        let storeFailed = false;
        try {
          stored = await filePersister.load();
        } catch {
          storeFailed = true;
        }
        const older = await filePersister.migrate(readStored(OLD_FILES_KEY), () => writeStored(OLD_FILES_KEY, ""));
        // what the person did before the stored files arrived wins over them
        const next = { ...older, ...stored.files, ...(files !== startFiles ? files : {}) };
        filesLoaded = true;
        if (Object.keys(next).length) applyFiles(next);
        void keepFiles();
        if (storeFailed) warnStorage("This browser would not open its storage for the files, so they will be lost when the page closes. Save keeps the project, files and all, in a file.");
        else if (stored.skipped.length) host.notify(`Some saved files could not be read and were left out: ${stored.skipped.join(", ")}.`);
        // the engine loads (with the text block's fonts) while the first build waits for it
        host.filesReady();
        // a project the address asks for opens once what was stored has come back
        void openFromAddress();
      })();
    },
  };
}
