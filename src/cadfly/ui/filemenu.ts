import { type StlFiles, addStlFile, removeFile, summarizeStlFiles } from "../language/files";
import { ACCENT, ERROR_TEXT, INK, INPUT_BG, MUTED, type PageRect, el, showPopup } from "./dom";
import { oneDecimal, withCommas } from "./numbers";

/**
 * The menu for a block's file field: the project's STL files with their sizes,
 * a small x to remove one that nothing uses, and "Import STL file...". It works
 * on the project's files through a host and never keeps them itself. Only one
 * menu is open at a time.
 */

/** What the file menu needs from its host */
export interface FileMenuHost {
  files(): StlFiles;
  /** The files changed (one added, or one removed): the host keeps them, and runs the program again */
  setFiles(next: StlFiles): void;
  /** The names of the files an import block uses, which cannot be removed from here */
  inUse(): Set<string>;
  /** Say something to the person once the menu is closed (that a file was replaced, say) */
  notify?(message: string): void;
}

/**
 * The drop-down under an import block's file field: the project's STL files, and, last, "Import STL file...", which opens the
 * file chooser and picks the file once it is added. An unused file has a small x to remove it. (It is made of page elements, not a
 * <select>, because the browser only opens a file chooser from a real click.)
 *
 * @param at Where the file field is on the page.
 * @param host The project's files.
 * @param current The file the field names now, which is highlighted.
 * @param pick Called with the name of the file that is chosen, or added.
 */
export function openFileMenu(at: PageRect, host: FileMenuHost, current: string, pick: (name: string) => void) {
  const root = el("div", `position:fixed;z-index:1000;box-sizing:border-box;left:${Math.round(at.left)}px;top:${Math.round(at.top + at.height + 2)}px;min-width:${Math.max(220, Math.round(at.width))}px;max-width:340px;max-height:60%;overflow:auto;padding:4px;background:${INPUT_BG};border:2px solid ${ACCENT};border-radius:8px;color:${INK};font:13px sans-serif;box-shadow:0 4px 14px #0008`);
  const list = el("div", "display:flex;flex-direction:column;gap:2px");
  const message = el("div", `color:${ERROR_TEXT};line-height:1.35;padding:4px 6px;display:none;font-size:12px`);
  const input = el("input");
  input.type = "file";
  input.accept = ".stl";
  input.style.display = "none";
  root.append(list, message, input);
  // a click outside closes it, and so does Escape; no key typed here is for the game
  const close = showPopup(root, { slot: "file menu", keepKeysFromPage: true });

  /** A line of the menu: its pieces side by side. */
  const row = (css: string) => el("div", `display:flex;align-items:center;gap:4px;border-radius:5px;${css}`);

  /**
   * Draw the list again from the project's files: each file chooses itself when
   * tapped, and one that nothing uses has an x that removes it.
   */
  function show() {
    list.replaceChildren();
    const infos = summarizeStlFiles(host.files());
    const used = host.inUse();
    for (const f of infos) {
      const line = row(f.name === current ? "background:#1d3a66" : "");
      const choose = el("button", `flex:1;text-align:left;background:none;border:0;color:${INK};padding:5px 8px;font:13px sans-serif;cursor:pointer;min-width:0`);
      choose.append(el("div", "font-weight:bold;word-break:break-all", f.name), el("div", `color:${MUTED};font-size:11px`, `${withCommas(f.triangles)} triangles, ${[f.size.width, f.size.depth, f.size.height].map(oneDecimal).join(" x ")} mm`));
      // Tapping a file picks it and closes the menu.
      choose.onclick = () => {
        close();
        pick(f.name);
      };
      line.append(choose);
      if (!used.has(f.name)) {
        const remove = el("button", `background:none;border:0;color:${ERROR_TEXT};font:16px sans-serif;padding:2px 8px;cursor:pointer`, "×");
        remove.title = `Remove ${f.name} from the project (nothing uses it)`;
        // Remove the file from the project and draw the list again.
        remove.onclick = () => {
          host.setFiles(removeFile(host.files(), f.name));
          message.style.display = "none";
          show();
        };
        line.append(remove);
      }
      list.append(line);
    }
    if (!infos.length) list.append(el("div", `color:${MUTED};padding:5px 8px`, "No STL files in this project yet."));
    const add = el("button", "text-align:left;background:#14305a;border:0;border-radius:5px;color:#fff;padding:6px 8px;font:13px sans-serif;cursor:pointer;margin-top:2px", "Import STL file...");
    add.onclick = () => input.click(); // a real click, so the browser opens the chooser
    list.append(add);
  }

  // A file was chosen from the file chooser: add it to the project and pick it. If it is not a
  // good STL file, say why and keep the menu open. A file with the name of one the project
  // already has replaces it, and the person is told, since the blocks that use it change.
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = ""; // so the same file can be chosen again
    if (!file) return;
    try {
      const before = host.files();
      const { files, info } = addStlFile(before, file.name, await file.arrayBuffer());
      host.setFiles(files);
      close();
      pick(info.name);
      if (info.name in before) host.notify?.(`Replaced ${info.name}: the blocks that use it now use the new file.`);
    } catch (e) {
      message.textContent = (e as Error).message;
      message.style.display = "";
    }
  };

  show();
}
