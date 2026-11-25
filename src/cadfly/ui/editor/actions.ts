import { stage } from "jetlag2d";
import { commandById } from "../../language/commands";
import { addScript, createBlock, insertBlocks, removeScript, setArg, setFlag, setScriptFold, setScriptInputs, setScriptName } from "../../language/edit";
import { allBlocks, findBlock, freshScriptName } from "../../language/program";
import type { Param } from "../../language/types";
import { openFieldEditor, openInfo } from "../fields";
import type { Hit, Rect } from "../layout";
import { FIELD_REVEAL } from "./geometry";
import { pageRect } from "./page";
import type { EditorContext, Touched } from "./types";

/**
 * What a tap does: pressing a toolbar button, choosing a tab, adding a block
 * from the palette, folding, switching and ticking, and opening a field for
 * typing or a pop-up for reading.
 */

/**
 * The switches on a block's header that turn one of its settings over, with
 * the setting each turns and whether Undo takes the change back. Folding
 * changes how a block is shown, not what the program makes.
 */
const TOGGLES = {
  blockFold: { flag: "collapsed", undoable: false },
  power: { flag: "disabled", undoable: true },
  eye: { flag: "hidden", undoable: true },
} as const;

/** The answers to taps */
export interface Actions {
  /**
   * A tap: the finger went down and up without moving.
   *
   * @param t What it landed on.
   */
  onTap(t: Touched): void;
}

/**
 * The answers to taps, for one editor.
 *
 * @param ctx The editor.
 */
export function createActions(ctx: EditorContext): Actions {
  const { host, st } = ctx;

  /**
   * The block with this id as the program has it now, or undefined if it is
   * gone: a tap can arrive after the program changed under it.
   *
   * @param id The block's id.
   */
  const blockNow = (id: string) => findBlock(host.program(), id)?.block;

  /** Tapping a block in the palette adds it at the end (a sketch piece goes into the last sketch) */
  function appendBlock(kind: string) {
    const program = host.program();
    const def = commandById(kind)!;
    const fresh = createBlock(program, kind);
    if (!def.piece) {
      host.change(insertBlocks(program, { end: true }, [fresh]));
      return;
    }
    // the last block, anywhere, that can hold this piece
    const holder = allBlocks(program).findLast((b) => commandById(b.kind)?.inner?.includes(kind));
    if (holder) {
      host.change(insertBlocks(program, { parentId: holder.id, index: holder.inner?.length ?? 0 }, [fresh]));
      return;
    }
    // a solid made without a faces section (some other way, say) gets one when its first face is added
    const solid = kind === "face" ? allBlocks(program).findLast((b) => b.kind === "solid") : undefined;
    if (solid) host.change(insertBlocks(program, { parentId: solid.id, index: solid.inner?.length ?? 0 }, [{ ...createBlock(program, "faces"), inner: [fresh] }]));
    else host.notify?.(`A ${def.word} goes inside ${def.partOf ?? "a sketch"}: put one in the program first.`);
  }

  /**
   * Move from one field to the next (or previous) in reading order, as Tab does in a form. Only fields you type into are stops:
   * drop-downs and ticks are skipped. Works from the layout as it is now, found again by block and field, since keeping the
   * value that was just typed may have moved things.
   *
   * @param blockId The block of the field Tab was pressed in.
   * @param paramId The field.
   * @param direction 1 for the next field, -1 for the previous.
   * @returns The field to go to, with where it is, or undefined if there is none that way.
   */
  function nextField(blockId: string, paramId: string, direction: 1 | -1) {
    const fields = st.layout.blocks.flatMap((b) => b.parts.filter((p) => (p.kind === "field" || p.kind === "caption") && p.param).map((p) => ({ blockId: b.block.id, param: p.param!, rect: p.rect })));
    const typed = (f: (typeof fields)[number]) => f.param.type.kind !== "choice" && f.param.type.kind !== "file";
    let i = fields.findIndex((f) => f.blockId === blockId && f.param.id === paramId);
    if (i < 0) return undefined;
    do i += direction;
    while (i >= 0 && i < fields.length && !typed(fields[i]));
    return fields[i];
  }

  /**
   * Open the next (or previous) field for typing, scrolling it into view first
   * if it is out of sight.
   *
   * @param blockId The block of the field Tab was pressed in.
   * @param paramId The field.
   * @param direction 1 for the next field, -1 for the previous.
   */
  function tabFrom(blockId: string, paramId: string, direction: 1 | -1) {
    const next = nextField(blockId, paramId, direction);
    if (!next) return;
    ctx.reveal(next.rect, FIELD_REVEAL);
    const now = st.layout.blocks.find((b) => b.block.id === next.blockId)?.parts.find((p) => p.param?.id === next.param.id);
    if (now) openField({ kind: "field", blockId: next.blockId, param: next.param, rect: now.rect });
  }

  /**
   * The pop-up of a measure block's "?": what it measured, and the names to use it by.
   *
   * @param blockId The measure block.
   * @param rect Where its "?" is in the workspace.
   */
  function showMeasurements(blockId: string, rect: Rect) {
    const at = pageRect(stage.world, rect);
    const block = blockNow(blockId);
    const name = String(block?.args.name ?? "part").trim() || "part";
    const found = host.measurements?.(blockId);
    if (!found) {
      openInfo(at, `${name}: not measured yet`, ["This block has not run yet: either the program is still loading,", "or a problem above it (shown in red) stopped it."]);
      return;
    }
    /** A measured value to three decimals, as text. */
    const n = (key: string) => String(Math.round(found[`${name}_${key}`] * 1000) / 1000);
    openInfo(at, `${name}: what was measured (mm)`, [
      `size    ${n("w")} wide  x  ${n("d")} deep  x  ${n("h")} high`,
      `x       ${n("x0")}  to  ${n("x1")}`,
      `y       ${n("y0")}  to  ${n("y1")}`,
      `z       ${n("z0")}  to  ${n("z1")}`,
      "",
      `Use them below this block as: ${name}_w ${name}_d ${name}_h  ${name}_x0 ${name}_x1  ${name}_y0 ${name}_y1  ${name}_z0 ${name}_z1`,
    ]);
  }

  /** Tapping "+ new script": add an empty script with a name nobody has (script1, script2, ...), show it, and ready its name to be typed over */
  function addNewScript() {
    const program = host.program();
    const name = freshScriptName(program);
    try {
      host.change(addScript(program, name));
    } catch (e) {
      host.notify?.(`The script was not added: ${(e as Error).message}`);
      return;
    }
    const added = host.program().at(-1); // addScript puts the new script last
    const header = st.layout.scripts.find((s) => s.scriptId === added?.id);
    if (!header) return;
    ctx.reveal(header.header, FIELD_REVEAL);
    if (header.kind === "editable") openScriptField(header.scriptId, "name", header.nameChip.rect);
  }

  /**
   * Edit the name or the inputs of a named script, in the same pop-up the blocks' fields use. The script is found again by its id when
   * the edit is kept, since where it is in the program (or what it is called) may have changed. A name or inputs that will not do leave
   * the script as it was, and the person is told why. Renaming a script does not change the `use` blocks that name it: they report that
   * there is no such script until they are changed to match. Tab goes between the name and the inputs.
   *
   * @param scriptId The id of the script.
   * @param which The name, or the inputs.
   * @param rect Where the chip is in the workspace (meters).
   */
  function openScriptField(scriptId: string, which: "name" | "inputs", rect: Rect) {
    const script = host.program().find((s) => s.id === scriptId);
    if (script?.name === undefined) return;
    const param: Param = { id: which, label: "", type: { kind: "text" }, default: "" };
    openFieldEditor({
      rect: pageRect(stage.world, rect),
      param,
      value: which === "name" ? script.name : (script.inputs ?? ""),
      onCommit: (value) => {
        const program = host.program();
        try {
          host.change(which === "name" ? setScriptName(program, scriptId, value.trim()) : setScriptInputs(program, scriptId, value));
        } catch (e) {
          host.notify?.(`${which === "name" ? "The script was not renamed" : "The inputs were not changed"}: ${(e as Error).message}`);
        }
      },
      onTab: (direction) => {
        const header = st.layout.scripts.find((s) => s.scriptId === scriptId);
        const chip = header?.kind === "editable" ? (direction === 1 ? header.inputsChip : header.nameChip) : undefined;
        if (chip) openScriptField(scriptId, direction === 1 ? "inputs" : "name", chip.rect);
      },
      canTab: (direction) => (which === "name" ? direction === 1 : direction === -1),
    });
  }

  /**
   * Open the editor for a block's field where it is, or the files menu for a file field.
   *
   * @param h The field that was tapped.
   */
  function openField(h: Extract<Hit, { kind: "field" }>) {
    const block = blockNow(h.blockId);
    if (!block) return;
    const at = pageRect(stage.world, h.rect);
    if (h.param.type.kind === "file" && host.chooseFile) {
      // a file field is a menu of the project's files, ending in "Import STL file..."
      host.chooseFile(at, String(block.args[h.param.id] ?? h.param.default), (name) => host.change(setArg(host.program(), h.blockId, h.param.id, name)));
      return;
    }
    // a file field is a drop-down of the files there are
    const param =
      h.param.type.kind === "file"
        ? { ...h.param, type: { kind: "choice" as const, options: [{ value: "", label: "(choose a file)" }, ...(host.files?.() ?? []).map((name) => ({ value: name, label: name }))] } }
        : h.param;
    openFieldEditor({
      rect: at,
      param,
      value: String(block.args[h.param.id] ?? h.param.default),
      onCommit: (value) => host.change(setArg(host.program(), h.blockId, h.param.id, value)),
      onTab: (direction) => tabFrom(h.blockId, h.param.id, direction),
      canTab: (direction) => nextField(h.blockId, h.param.id, direction) !== undefined,
    });
  }

  /**
   * A tap on something in the workspace.
   *
   * @param h What was under the finger.
   */
  function tapWork(h: Hit) {
    if (h.kind === "scriptName" || h.kind === "scriptInputs") {
      openScriptField(h.scriptId, h.kind === "scriptName" ? "name" : "inputs", h.rect);
    } else if (h.kind === "scriptRemove") {
      try {
        host.change(removeScript(host.program(), h.scriptId)); // the blocks in it go too, and Undo brings them back
      } catch (e) {
        host.notify?.(`The script was not removed: ${(e as Error).message}`);
      }
    } else if (h.kind === "scriptFold") {
      host.change(setScriptFold(host.program(), h.scriptId, host.program().find((s) => s.id === h.scriptId)?.collapsed !== true), { undoable: false });
    } else if (h.kind === "blockFold" || h.kind === "power" || h.kind === "eye") {
      const toggle = TOGGLES[h.kind];
      const block = blockNow(h.blockId);
      if (block) host.change(setFlag(host.program(), h.blockId, toggle.flag, block[toggle.flag] !== true), toggle.undoable ? undefined : { undoable: false });
    } else if (h.kind === "button") {
      host.pressButton?.(h.blockId, h.id);
    } else if (h.kind === "info") {
      showMeasurements(h.blockId, h.rect);
    } else if (h.kind === "flag") {
      const block = blockNow(h.blockId);
      if (block) host.change(setArg(host.program(), h.blockId, h.param.id, (block.args[h.param.id] ?? h.param.default) !== true));
    } else if (h.kind === "field") {
      openField(h);
    }
  }

  return {
    onTap(t) {
      if (t.kind === "button") {
        const b = host.buttons()[t.index];
        const rect = st.hotspots.find((r) => r.touched.kind === "button" && r.touched.index === t.index)?.rect;
        if (rect && b?.enabled()) b.action(rect);
      } else if (t.kind === "tab") {
        st.category = t.category;
        ctx.render();
      } else if (t.kind === "palette") {
        appendBlock(t.blockKind);
      } else if (t.kind === "newScript") {
        addNewScript();
      } else if (t.kind === "work") {
        tapWork(t.hit);
      }
    },
  };
}
