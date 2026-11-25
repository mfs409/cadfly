import { type Files, addFile, describeFiles, removeFile } from "./language/files";
import { INK, MUTED, el } from "./view/dom";
import type { PageRect } from "./fields";

let closeCurrent: (() => void) | undefined;

/** What the file menu needs from the app */
export interface FileMenuHost {
  files(): Files;
  /** The files changed (one added, or one removed): the app keeps them, and runs the program again */
  setFiles(next: Files): void;
  /** The names of the files an import block uses, which cannot be removed from here */
  inUse(): Set<string>;
}

/**
 * The drop-down under an import block's file field: the project's STL files, and, last, "Import STL file...", which opens the
 * file chooser and picks the file once it is added. An unused file has a small x to remove it. (It is made of page elements, not a
 * <select>, because the browser only opens a file chooser from a real click.)
 */
export function openFileMenu(at: PageRect, host: FileMenuHost, current: string, pick: (name: string) => void) {
  closeCurrent?.();
  const root = el("div", `position:fixed;z-index:1000;box-sizing:border-box;left:${Math.round(at.left)}px;top:${Math.round(at.top + at.height + 2)}px;min-width:${Math.max(220, Math.round(at.width))}px;max-width:340px;max-height:60%;overflow:auto;padding:4px;background:#0d1322;border:2px solid #2f7fe0;border-radius:8px;color:${INK};font:13px sans-serif;box-shadow:0 4px 14px #0008`);
  const list = el("div", "display:flex;flex-direction:column;gap:2px");
  const message = el("div", "color:#f19a9a;line-height:1.35;padding:4px 6px;display:none;font-size:12px");
  const input = el("input") as HTMLInputElement;
  input.type = "file";
  input.accept = ".stl";
  input.style.display = "none";
  root.append(list, message, input);

  const close = () => {
    root.remove();
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", keys, true);
    closeCurrent = undefined;
  };
  const outside = (e: Event) => {
    if (!root.contains(e.target as Node)) close();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    e.stopPropagation(); // keys typed here are not for the game
  };
  closeCurrent = close;

  const row = (css: string) => el("div", `display:flex;align-items:center;gap:4px;border-radius:5px;${css}`);

  function show() {
    list.replaceChildren();
    const infos = describeFiles(host.files());
    const used = host.inUse();
    for (const f of infos) {
      const line = row(f.name === current ? "background:#1d3a66" : "");
      const choose = el("button", `flex:1;text-align:left;background:none;border:0;color:${INK};padding:5px 8px;font:13px sans-serif;cursor:pointer;min-width:0`);
      choose.append(el("div", "font-weight:bold;word-break:break-all", f.name), el("div", `color:${MUTED};font-size:11px`, `${f.triangles.toLocaleString("en-US")} triangles, ${f.size.map((v) => Math.round(v * 10) / 10).join(" x ")} mm`));
      choose.onclick = () => {
        close();
        pick(f.name);
      };
      line.append(choose);
      if (!used.has(f.name)) {
        const remove = el("button", `background:none;border:0;color:#f19a9a;font:16px sans-serif;padding:2px 8px;cursor:pointer`, "×");
        remove.title = `Remove ${f.name} from the project (nothing uses it)`;
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

  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = ""; // so the same file can be chosen again
    if (!file) return;
    try {
      const { files, info } = addFile(host.files(), file.name, await file.arrayBuffer());
      host.setFiles(files);
      close();
      pick(info.name);
    } catch (e) {
      message.textContent = (e as Error).message;
      message.style.display = "";
    }
  };

  show();
  document.body.appendChild(root);
  setTimeout(() => {
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
  }, 0);
}
