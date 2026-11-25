import { Actor, BoxBody, FilledBox, TextSprite, ZIndex, stage } from "jetlag2d";
import { COMMANDS } from "./language/commands";
import { type ModeSpec, exposure } from "./language/modes";
import { accepts, appendIndex, findBlock, insertStack, newBlockFor, setArg, setCollapsed, setDisabled, setExpanded, setHidden, setStackCollapsed, takeBlock } from "./language/edit";
import { AttachPoint, Hit, Measure, ProgramLayout, Rect, acceptingPoints, hit, layoutProgram, nearestPoint, rectContains } from "./language/layout";
import type { Block, Category, Problem, Program } from "./language/types";
import { openFieldEditor, openInfo } from "./fields";
import { blockOutline } from "./language/outline";
import { FONT, PiecePool, ShapePool } from "./pool";

// ---- where everything goes on the 16 x 9 meter screen ----

/** The screen is 16 meters wide and 9 tall.  Left of VIEW_LEFT is the editor; the 3D view covers the rest. */
export const SCREEN = { w: 16, h: 9 };
export const VIEW_LEFT = 9.6;
export const TOOLBAR_H = 0.85;
export const STATUS_H = 0.6;
export const PALETTE_W = 2.7;
const VIEW_TOP = TOOLBAR_H;
const VIEW_BOTTOM = SCREEN.h - STATUS_H;
/** Where the program starts, and how wide it may get, in the scrolling workspace */
const WORK = { x: PALETTE_W + 0.25, y: TOOLBAR_H + 0.65, width: VIEW_LEFT - PALETTE_W - 0.5 };

/** The size of the text on blocks, and on the toolbar buttons */
const TEXT_SIZE = 20;
const TOOLBAR_TEXT = 16;
/** A dragged block snaps to a drop point this close to its top left corner */
const SNAP = 0.9;

/** JetLag only has z indices -4 to 4 (anything else crashes its renderer), and a carried block with a power switch asks for 5 */
const z = (n: number) => Math.max(-4, Math.min(4, n)) as ZIndex;

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "shapes", label: "Shapes" },
  { id: "sketch", label: "Sketch" },
  { id: "code", label: "Code" },
  { id: "place", label: "Modify" },
  { id: "combine", label: "Combine" },
];

// ---- what the editor needs from the app that uses it ----

export interface ToolbarButton {
  /** Where it goes in the top bar: after the tabs (what acts on the blocks: undo, redo), in the middle (the mode), or at the right (the project: new, save, load, demos, STL, support) */
  group: "edit" | "mode" | "file";
  label: string;
  color: string;
  enabled: () => boolean;
  /** Called with where the button is on the screen (meters), so it can open something beside itself */
  action: (at: Rect) => void;
}

/** Where a rectangle on the HUD (meters) is on the page, in CSS pixels */
export function hudPageRect(r: Rect) {
  const camera = stage.hud.camera;
  const box = (stage.renderer.pixi.canvas as HTMLCanvasElement).getBoundingClientRect();
  const topLeft = camera.metersToScreen({ x: r.x, y: r.y });
  return { left: box.left + topLeft.x, top: box.top + topLeft.y, width: r.w * camera.scale, height: r.h * camera.scale };
}

export interface EditorHost {
  program(): Program;
  /**
   * The user changed the program.  The app records it for undo (unless `undoable` is false: folding a block is a change to how
   * it is shown, not to the program), saves it, and runs it.
   */
  change(next: Program, options?: { undoable?: boolean }): void;
  problem(): Problem | undefined;
  buttons(): ToolbarButton[];
  /** The names of the STL files the project has: an import block's file field offers them */
  files?(): string[];
  /** Open the drop-down under an import block's file field (its files, and "Import STL file..."); `pick` gets the chosen name */
  chooseFile?(at: { left: number; top: number; width: number; height: number }, current: string, pick: (name: string) => void): void;
  /** A block's own button was pressed (the "hull" button on the faces of a solid): `id` says which */
  pressButton?(blockId: string, id: string): void;
  /** What a measure block found the last time it ran (the variables it set), if it has run */
  measurements?(blockId: string): Record<string, number> | undefined;
  /** How much of each block to offer and show (see modes.ts). Leave it out for everything. */
  mode?(): ModeSpec | undefined;
}

// ---- input ----

type Target =
  | { kind: "button"; index: number }
  | { kind: "tab"; category: Category }
  | { kind: "palette"; blockKind: string }
  | { kind: "work"; hit: Hit }
  | { kind: "empty" };

interface Region {
  rect: Rect;
  target: Target;
}

/** A finger (or the mouse) that is down */
interface Press {
  at: { x: number; y: number };
  target: Target;
  moved: boolean;
  scrollStart: number;
}

/** Blocks being carried */
interface Drag {
  stack: Block[];
  /** The program without the stack: what the stack is being dragged over */
  base: Program;
  /** Where the top left of the stack is, relative to the pointer */
  grab: { dx: number; dy: number };
  at: { x: number; y: number };
  target?: AttachPoint;
  /** Dropped here it would start a new stack, at this place in the workspace (not near anything to join) */
  free?: { x: number; y: number };
}


/**
 * The block editor.  It draws a program as blocks (with actors, using
 * layout.ts to say where everything goes) and turns what the user does into
 * calls to `host.change`.  JetLag decides which actor receives a touch with
 * a loose box test, so only one invisible actor takes touches; this code works
 * out exactly what was under the finger.
 *
 * The workspace is the world scene, which scrolls by moving the camera.  The
 * palette, toolbar and status bar are on the HUD, over it.
 */
export function createEditor(host: EditorHost) {
  const worldPool = new PiecePool(stage.world);
  /** Blocks that hold others are drawn as one polygon each (the workspace's pool of them) */
  const worldShapes = new ShapePool(stage.world);
  const hudShapes = new ShapePool(stage.hud);
  const hudPool = new PiecePool(stage.hud);
  let scrollY = 0;
  let category: Category = "shapes";
  let press: Press | undefined;
  let drag: Drag | undefined;
  let regions: Region[] = [];
  let layout: ProgramLayout = { blocks: [], stacks: [], attach: [], bottom: WORK.y };
  let lastProblem: string | undefined;

  // ---- measuring text ----
  const sample = new TextSprite({ center: true, face: FONT, size: TEXT_SIZE, color: "#ffffff" }, "");
  const widths = new Map<string, number>();
  const measure: Measure = (text) => {
    let w = widths.get(text);
    if (w === undefined) {
      w = sample.dims(stage.hud.camera, text).width;
      widths.set(text, w);
    }
    return w;
  };
  window.addEventListener("resize", () => {
    widths.clear();
    sample.size = TEXT_SIZE; // rebuilds the style for the new window size
    render();
  });

  // ---- drawing ----

  /** Draw a laid-out program with a pool.  `zBase` is the z of block backgrounds; fields are one above, text two. */
  function drawLayout(pool: PiecePool, shapes: ShapePool | undefined, l: ProgramLayout, zBase: number, problemId?: string) {
    for (const b of l.blocks) {
      const bad = b.block.id === problemId;
      // a hidden block is drawn faded: it is built, but gives nothing to the picture
      const faded = b.block.hidden === true || b.block.disabled === true;
      const frame = { fill: faded ? `${b.def.color}66` : b.def.color, line: bad ? "#ff3b3b" : faded ? "#ffffff30" : "#ffffff55", lineWidth: bad ? 0.07 : 0.03, boxZ: z(zBase) };
      const outline = shapes && blockOutline(b);
      if (outline) {
        // one polygon for the whole block; it sits just under the blocks and fields drawn on it
        shapes.draw({ points: outline, fill: frame.fill, line: frame.line, lineWidth: frame.lineWidth, z: z(zBase - 1) });
      } else {
        // a header that wraps onto several rows is one box, not a box for each row
        const first = b.rows[0];
        const last = b.rows[b.rows.length - 1];
        pool.draw({ x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y, ...frame });
        if (b.spine) pool.draw({ ...b.spine, ...frame });
        if (b.footer) pool.draw({ ...b.footer, ...frame });
      }
      if (b.empty) pool.draw({ ...b.empty, fill: "#00000040", line: "#ffffff30", boxZ: z(zBase) });
      for (const p of b.parts) {
        if (p.kind === "word" || p.kind === "label") {
          pool.draw({ ...p.rect, text: p.text, textColor: faded ? "#ffffff80" : p.kind === "word" ? "#ffffff" : "#ffffffd0", textSize: TEXT_SIZE, textZ: z(zBase + 2) });
        } else if (p.kind === "button") {
          // a block's own button (hull): a chip that stands out from the fields
          pool.draw({ ...p.rect, fill: "#ffd23f", line: "#00000050", lineWidth: 0.015, radius: p.rect.h / 2, boxZ: z(zBase + 1), text: p.text, textColor: "#1f2842", textSize: TEXT_SIZE - 3, textZ: z(zBase + 2) });
        } else if (p.kind === "number") {
          // the number of a vertex (1, 2, 3) or of a face (f1, f2, f3): a badge, so a face's "1 2 3" can be matched to the points and the face to its drawing
          pool.draw({ ...p.rect, fill: "#ffffff", line: "#1f2842", lineWidth: 0.02, radius: p.rect.h / 2, boxZ: z(zBase + 1), text: p.text, textColor: "#1f2842", textSize: TEXT_SIZE - 3, textZ: z(zBase + 2) });
        } else if (p.kind === "info") {
          // the "?" of a block that reports on what is inside it
          pool.draw({ ...p.rect, fill: "#ffffff1f", line: "#ffffff80", lineWidth: 0.015, radius: p.rect.h / 2, boxZ: z(zBase + 1), text: "?", textColor: "#ffffff", textSize: TEXT_SIZE - 2, textZ: z(zBase + 2) });
        } else if (p.kind === "power") {
          // a power switch: a ring with a bar through its top; lit when the block works, dark when it is off
          const { x, y, w, h } = p.rect;
          const on = b.block.disabled !== true;
          pool.draw({ x, y, w, h, fill: on ? "#ffffffe6" : "#0000004d", line: on ? "#00000040" : "#ffffff66", lineWidth: 0.015, radius: h / 2, boxZ: z(zBase + 1) });
          const d = h * 0.52;
          pool.draw({ x: x + w / 2 - d / 2, y: y + h / 2 - d / 2 + 0.012, w: d, h: d, fill: "#00000000", line: on ? "#1f2842" : "#ffffffb0", lineWidth: 0.025, radius: d / 2, boxZ: z(zBase + 2) });
          pool.draw({ x: x + w / 2 - 0.012, y: y + h / 2 - d / 2 - 0.045, w: 0.024, h: d * 0.62, fill: on ? "#1f2842" : "#ffffffb0", radius: 0, boxZ: z(zBase + 3) });
        } else if (p.kind === "eye") {
          // an eye: open (a pill with a pupil) when the block shows, shut (a dark pill with a lid line) when it is hidden
          const { x, y, w, h } = p.rect;
          if (faded) {
            pool.draw({ x, y, w, h, fill: "#0000004d", line: "#ffffff66", lineWidth: 0.015, radius: h / 2, boxZ: z(zBase + 1) });
            pool.draw({ x: x + w * 0.18, y: y + h / 2 - 0.012, w: w * 0.64, h: 0.024, fill: "#ffffffb0", radius: 0, boxZ: z(zBase + 2) });
          } else {
            pool.draw({ x, y, w, h, fill: "#ffffffe6", line: "#00000040", lineWidth: 0.015, radius: h / 2, boxZ: z(zBase + 1) });
            const d = h * 0.46;
            pool.draw({ x: x + w / 2 - d / 2, y: y + h / 2 - d / 2, w: d, h: d, fill: "#1f2842", radius: d / 2, boxZ: z(zBase + 2) });
          }
        } else if (p.kind === "caption") {
          // a label for people, on its own line above the block
          pool.draw({ ...p.rect, text: p.text, textColor: "#ffffffc0", textSize: TEXT_SIZE - 4, textZ: z(zBase + 2) });
        } else if (p.kind === "more") {
          // the chip that shows the fields a partly exposed block leaves out (or hides them again)
          pool.draw({ ...p.rect, fill: "#ffffff1f", line: "#ffffff55", lineWidth: 0.015, boxZ: z(zBase + 1), text: p.text, textColor: "#ffffffd0", textSize: TEXT_SIZE - 4, textZ: z(zBase + 2) });
        } else if (p.kind === "fold") {
          // the - / + button that folds a block that holds others
          pool.draw({ ...p.rect, fill: "#ffffff2e", line: "#ffffff55", lineWidth: 0.015, boxZ: z(zBase + 1), text: p.text, textColor: "#ffffff", textSize: TEXT_SIZE, textZ: z(zBase + 2) });
        } else {
          pool.draw({
            ...p.rect,
            fill: "#fffffff0",
            line: "#00000040",
            boxZ: z(zBase + 1),
            text: p.text,
            textColor: "#1f2842",
            textSize: TEXT_SIZE,
            textZ: z(zBase + 2),
          });
        }
      }
    }
  }

  /** The line above each stack of several blocks: a +/- button, and how many blocks it has; and the strip that stands for a folded one */
  function drawStacks(pool: PiecePool, l: ProgramLayout) {
    for (const s of l.stacks) {
      pool.draw({ ...s.button, fill: "#ffffff2e", line: "#ffffff55", lineWidth: 0.015, boxZ: z(1), text: s.collapsed ? "+" : "−", textColor: "#ffffff", textSize: TEXT_SIZE, textZ: z(2) });
      pool.draw({ x: s.header.x + s.button.w + 0.08, y: s.header.y, w: s.header.w - s.button.w - 0.08, h: s.header.h, text: s.label, textColor: "#ffffff90", textSize: TEXT_SIZE - 5, textZ: z(2) });
      if (s.strip) pool.draw({ ...s.strip, fill: "#00000040", line: "#ffffff30", boxZ: z(0), text: "...", textColor: "#ffffffb0", textSize: TEXT_SIZE, textZ: z(2) });
    }
  }

  /** Blocks as they are laid out when carried: without the place and fold that belong to the stack they came from */
  const strip = (blocks: Block[]) => blocks.map(({ at: _at, stackCollapsed: _fold, ...rest }) => rest as Block);

  /** The most that the workspace can scroll */
  const maxScroll = () => Math.max(0, layout.bottom + 1.2 - VIEW_BOTTOM);
  const setScroll = (v: number) => {
    scrollY = Math.min(Math.max(0, v), maxScroll());
    stage.world.camera.setCenter({ x: SCREEN.w / 2, y: SCREEN.h / 2 + scrollY });
  };

  /** Draw everything */
  function render() {
    worldPool.begin();
    worldShapes.begin();
    hudPool.begin();
    hudShapes.begin();
    regions = [];

    // the workspace: the program, or the program without what is being carried
    const base = drag ? drag.base : host.program();
    layout = layoutProgram(base, { x: WORK.x, y: WORK.y, width: WORK.width, measure, mode: host.mode?.() });
    setScroll(scrollY);
    drawLayout(worldPool, worldShapes, layout, 0, host.problem()?.blockId);
    drawStacks(worldPool, layout);

    // where the carried blocks would land
    if (drag) {
      const pointerInWork = drag.at.x >= PALETTE_W;
      const kinds = drag.stack.map((b) => b.kind);
      const corner = { x: drag.at.x + drag.grab.dx, y: drag.at.y + drag.grab.dy + scrollY };
      drag.target = pointerInWork ? nearestPoint(acceptingPoints(layout, base, kinds), corner.x, corner.y, SNAP) : undefined;
      // near nothing to join, a drop in the workspace starts a stack of its own, right there
      drag.free = !drag.target && inWorkspace(drag.at) && kinds.every((k) => accepts(null, k)) ? { x: Math.max(0, corner.x - WORK.x), y: Math.max(0, corner.y - WORK.y) } : undefined;
      if (drag.target) worldPool.draw({ x: drag.target.x, y: drag.target.y - 0.05, w: 2.6, h: 0.1, fill: "#ffd23f", line: "#ffffff", boxZ: z(3) });
      if (drag.free) {
        const size = layoutProgram(strip(drag.stack), { x: 0, y: 0, width: WORK.width, measure, mode: host.mode?.() });
        const w = Math.max(...size.blocks.map((b) => b.bounds.w), 1);
        worldPool.draw({ x: WORK.x + drag.free.x, y: WORK.y + drag.free.y, w, h: size.bottom, fill: "#ffffff14", line: "#ffffffb0", lineWidth: 0.03, boxZ: z(3) });
      }
    }

    // the panels around the workspace
    const bar = "#10172b";
    hudPool.draw({ x: 0, y: 0, w: SCREEN.w, h: TOOLBAR_H, fill: bar, radius: 0, boxZ: z(-2) }); // the bar runs across the whole top: the 3D view starts under it
    hudPool.draw({ x: 0, y: VIEW_BOTTOM, w: SCREEN.w, h: STATUS_H, fill: bar, radius: 0, boxZ: z(-2) }); // under the assistant bar
    hudPool.draw({ x: VIEW_LEFT, y: TOOLBAR_H, w: SCREEN.w - VIEW_LEFT, h: VIEW_BOTTOM - TOOLBAR_H, fill: "#e8e8e8", radius: 0, boxZ: z(-2) });
    hudPool.draw({ x: 0, y: VIEW_TOP, w: PALETTE_W, h: VIEW_BOTTOM - VIEW_TOP, fill: "#1f2842", radius: 0, boxZ: z(-2) });

    drawToolbar();
    drawPalette();
    // an empty workspace says what to do (it used to be in the status bar)
    if (!host.program().length && !drag) hudPool.draw({ x: WORK.x, y: WORK.y + 0.05, w: 6, h: 0.5, text: "Drag blocks in from the left to build something.", textColor: "#8590aa", textSize: 16, textZ: z(1) });

    if (drag) {
      const over = drag.at.x < PALETTE_W && drag.at.y > VIEW_TOP && drag.at.y < VIEW_BOTTOM;
      if (over) {
        hudPool.draw({ x: 0, y: VIEW_TOP, w: PALETTE_W, h: VIEW_BOTTOM - VIEW_TOP, fill: "#d9363ecc", radius: 0, boxZ: z(1), text: "drop here to delete", textColor: "#ffffff", textZ: z(1), textSize: 18 });
      }
      const carried = layoutProgram(strip(drag.stack), { x: drag.at.x + drag.grab.dx, y: drag.at.y + drag.grab.dy, width: WORK.width, measure, mode: host.mode?.() });
      drawLayout(hudPool, hudShapes, carried, 2);
    }

    worldPool.end();
    worldShapes.end();
    hudPool.end();
    hudShapes.end();
  }

  /** The categories this mode has blocks in (a tab each), and the category showing: the first that has any if the chosen one has none */
  function tabsNow() {
    const mode = host.mode?.();
    const offered = COMMANDS.filter((d) => exposure(mode, d.id) !== "hidden");
    const tabs = CATEGORIES.filter((c) => offered.some((d) => d.category === c.id));
    if (tabs.length && !tabs.some((c) => c.id === category)) category = tabs[0].id;
    return { tabs, offered };
  }

  /**
   * The top bar: the category tabs at the left, and the buttons at the right (right-justified), so the palette below is just the
   * blocks and can be narrow.
   */
  function drawToolbar() {
    const buttons = host.buttons();
    // the toolbar's text is a little smaller than the blocks', so more buttons fit
    const widths = buttons.map((b) => Math.max(0.8, measure(b.label) * (TOOLBAR_TEXT / TEXT_SIZE) + 0.34));
    const gap = 0.08;
    const groupOf = (g: ToolbarButton["group"]) => buttons.map((b, i) => ({ b, i })).filter((x) => x.b.group === g);
    const widthOf = (items: { i: number }[]) => items.reduce((t, x) => t + widths[x.i], 0) + gap * Math.max(0, items.length - 1);
    const place = (items: { b: ToolbarButton; i: number }[], from: number) => {
      let x = from;
      for (const { b, i } of items) {
        const rect = { x, y: 0.12, w: widths[i], h: 0.6 };
        const on = b.enabled();
        hudPool.draw({ ...rect, fill: on ? b.color : "#4b5563", line: "#ffffff80", lineWidth: 0.03, boxZ: z(0), text: b.label, textColor: on ? "#ffffff" : "#9ca3af", textSize: TOOLBAR_TEXT, textZ: z(1) });
        regions.push({ rect, target: { kind: "button", index: i } });
        x += widths[i] + gap;
      }
    };
    // the project's buttons are right-justified; the tabs are at the left, then undo and redo (they act on the blocks), then the mode
    // in the middle of what is left, with as much room on one side as on the other
    const file = groupOf("file");
    const fileLeft = SCREEN.w - 0.12 - widthOf(file);
    place(file, fileLeft);
    // the tabs, in the room left of the buttons: as wide as their words need, and a smaller size if the room is short
    const { tabs } = tabsNow();
    const edit = groupOf("edit");
    const tabGap = 0.06;
    const room = Math.min(fileLeft - 0.3 - 0.1 - widthOf(edit) - 0.3, 5.2);
    const wordsAt = (size: number) => tabs.map((c) => (c.label.length * 0.55 * size) / 80 + 0.34); // a letter is about 0.55 of the size wide, and 80 pixels is a metre
    let size = 15;
    let tabWidths = wordsAt(size);
    while (size > 11 && tabWidths.reduce((t, w) => t + w, 0) + tabGap * (tabs.length - 1) > room) tabWidths = wordsAt(--size);
    let tx = 0.1;
    tabs.forEach((c, i) => {
      const rect = { x: tx, y: 0.12, w: tabWidths[i], h: 0.6 };
      const color = COMMANDS.find((d) => d.category === c.id)!.color;
      const selected = c.id === category;
      hudPool.draw({ ...rect, fill: selected ? color : "#2b3554", line: selected ? "#ffffff" : color, lineWidth: 0.03, boxZ: z(0), text: c.label, textColor: "#ffffff", textSize: size, textZ: z(1) });
      regions.push({ rect, target: { kind: "tab", category: c.id } });
      tx += tabWidths[i] + tabGap;
    });
    // undo and redo come right after the tabs
    const editLeft = tx - tabGap + 0.3;
    place(edit, editLeft);
    // the mode is centred between the end of undo and redo and the start of the project's buttons
    const mode = groupOf("mode");
    const editRight = editLeft + widthOf(edit);
    place(mode, editRight + (fileLeft - editRight - widthOf(mode)) / 2);
  }

  function drawPalette() {
    const { offered } = tabsNow();
    // the blocks of the chosen category, to be dragged out. When there are more than fit, the rows get closer together (and a little
    // smaller); with far too many they go in two columns.
    const mine = offered.filter((d) => d.category === category && !d.automatic); // the sections of a solid come with it
    const top = VIEW_TOP + 0.2;
    const room = VIEW_BOTTOM - 0.65 - top; // the hint line is under the last block
    const columns = mine.length * 0.45 > room ? 2 : 1;
    const perColumn = Math.ceil(mine.length / columns);
    const step = Math.min(0.67, room / perColumn);
    const colW = (PALETTE_W - 0.4 - (columns - 1) * 0.1) / columns;
    mine.forEach((def, i) => {
      const col = Math.floor(i / perColumn);
      const rect = { x: 0.2 + col * (colW + 0.1), y: top + (i % perColumn) * step, w: colW, h: Math.max(0.3, step - 0.12) };
      hudPool.draw({ ...rect, fill: def.color, line: "#ffffff80", lineWidth: 0.03, boxZ: z(0), text: def.word + (def.piece ? `  (in ${def.partOf ?? "a sketch"})` : ""), textColor: "#ffffff", textSize: step < 0.6 ? TEXT_SIZE - 5 : TEXT_SIZE - 3, textZ: z(1) });
      regions.push({ rect, target: { kind: "palette", blockKind: def.id } });
    });
    hudPool.draw({ x: 0.1, y: VIEW_BOTTOM - 0.55, w: PALETTE_W - 0.2, h: 0.45, text: "drag blocks out or back", textColor: "#8590aa", textSize: 12, textZ: z(1) });
  }

  // ---- what the user does ----

  const toWorld = (p: { x: number; y: number }) => ({ x: p.x, y: p.y + scrollY });
  const inWorkspace = (p: { x: number; y: number }) => p.x >= PALETTE_W && p.x <= VIEW_LEFT && p.y >= VIEW_TOP && p.y <= VIEW_BOTTOM;

  function classify(p: { x: number; y: number }): Target {
    const region = regions.find((r) => rectContains(r.rect, p.x, p.y));
    if (region) return region.target;
    if (inWorkspace(p)) {
      const w = toWorld(p);
      const h = hit(layout, w.x, w.y);
      if (h) return { kind: "work", hit: h };
    }
    return { kind: "empty" };
  }

  function pickUp(blockKind: string | undefined, blockId: string | undefined, p: { x: number; y: number }) {
    const program = host.program();
    if (blockKind) {
      const stack = [newBlockFor(program, blockKind)];
      drag = { stack, base: program, grab: { dx: -0.6, dy: -0.28 }, at: p };
    } else if (blockId) {
      // the sections of a solid and the ends of a loft are parts of it: they cannot be pulled out (a drag there scrolls instead)
      const kind = findBlock(program, blockId)?.block.kind;
      if (COMMANDS.find((c) => c.id === kind)?.automatic) return;
      const taken = takeBlock(program, blockId);
      if (!taken.stack.length) return;
      // where the block was drawn, in screen coordinates
      const was = layout.blocks.find((b) => b.block.id === blockId)!.bounds;
      drag = { stack: taken.stack, base: taken.program, grab: { dx: was.x - p.x, dy: was.y - scrollY - p.y }, at: p };
    }
  }

  function onDown(p: { x: number; y: number }) {
    press = { at: p, target: classify(p), moved: false, scrollStart: scrollY };
  }

  function onPanStart(p: { x: number; y: number }) {
    if (!press) return;
    press.moved = true;
    const t = press.target;
    if (t.kind === "palette") pickUp(t.blockKind, undefined, press.at);
    else if (t.kind === "work") pickUp(undefined, t.hit.blockId, press.at);
    // anything else that is dragged inside the workspace scrolls it
    onPanMove(p);
  }

  function onPanMove(p: { x: number; y: number }) {
    if (!press) return;
    if (drag) {
      drag.at = p;
      // near the top or bottom edge, carry the view along
      if (p.y < VIEW_TOP + 0.4) setScroll(scrollY - 0.12);
      else if (p.y > VIEW_BOTTOM - 0.4) setScroll(scrollY + 0.12);
      render();
    } else if (press.target.kind === "empty" || press.target.kind === "work") {
      setScroll(press.scrollStart - (p.y - press.at.y));
      render();
    }
  }

  function drop(p: { x: number; y: number }) {
    const d = drag!;
    drag = undefined;
    const overPalette = p.x < PALETTE_W && p.y > VIEW_TOP && p.y < VIEW_BOTTOM;
    let next: Program | undefined;
    if (overPalette) next = d.base; // carried back to the palette: thrown away
    else if (d.target) next = insertStack(d.base, { parentId: d.target.parentId, index: d.target.index, top: d.target.top }, d.stack);
    else if (d.free) next = insertStack(d.base, { parentId: null, index: d.base.length, at: d.free }, d.stack);
    // dropped nowhere: put back as it was
    if (next && JSON.stringify(next) !== JSON.stringify(host.program())) host.change(next);
    else render();
  }

  /** A tap: the finger went down and up without moving */
  function activate(t: Target) {
    if (t.kind === "button") {
      const b = host.buttons()[t.index];
      const rect = regions.find((r) => r.target.kind === "button" && r.target.index === t.index)!.rect;
      if (b?.enabled()) b.action(rect);
    } else if (t.kind === "tab") {
      category = t.category;
      render();
    } else if (t.kind === "palette") {
      appendBlock(t.blockKind);
    } else if (t.kind === "work") {
      const h = t.hit;
      if (h.kind === "stackFold") {
        const first = findBlock(host.program(), h.blockId)!.block;
        host.change(setStackCollapsed(host.program(), h.blockId, first.stackCollapsed !== true), { undoable: false });
      } else if (h.kind === "fold") {
        const block = findBlock(host.program(), h.blockId)!.block;
        host.change(setCollapsed(host.program(), h.blockId, block.collapsed !== true), { undoable: false });
      } else if (h.kind === "button") {
        host.pressButton?.(h.blockId, h.id);
      } else if (h.kind === "info") {
        showMeasurements(h.blockId, h.rect);
      } else if (h.kind === "power") {
        const block = findBlock(host.program(), h.blockId)!.block;
        host.change(setDisabled(host.program(), h.blockId, block.disabled !== true)); // it changes what the program makes, so Undo takes it back
      } else if (h.kind === "eye") {
        const block = findBlock(host.program(), h.blockId)!.block;
        host.change(setHidden(host.program(), h.blockId, block.hidden !== true)); // hiding changes what the program makes, so Undo takes it back
      } else if (h.kind === "more") {
        const block = findBlock(host.program(), h.blockId)!.block;
        host.change(setExpanded(host.program(), h.blockId, block.expanded !== true), { undoable: false });
      } else if (h.kind === "flag") {
        const block = findBlock(host.program(), h.blockId)!.block;
        host.change(setArg(host.program(), h.blockId, h.param.id, (block.args[h.param.id] ?? h.param.default) !== true));
      } else if (h.kind === "field") {
        openField(h);
      }
    }
  }

  /** Tapping a block in the palette adds it at the end (a sketch piece goes into the last sketch) */
  function appendBlock(kind: string) {
    const program = host.program();
    const def = COMMANDS.find((c) => c.id === kind)!;
    const fresh = newBlockFor(program, kind);
    if (!def.piece) {
      host.change(insertStack(program, { parentId: null, index: appendIndex(program) }, [fresh]));
      return;
    }
    // the last block, anywhere, that can hold this piece
    const holders: Block[] = [];
    const visit = (list: Block[]) => list.forEach((b) => (COMMANDS.find((c) => c.id === b.kind)?.inner?.includes(kind) && holders.push(b), visit(b.inner ?? [])));
    visit(program);
    const holder = holders[holders.length - 1];
    if (holder) host.change(insertStack(program, { parentId: holder.id, index: holder.inner?.length ?? 0 }, [fresh]));
    else if (kind === "face") {
      // a solid made without a faces section (by the assistant, say) gets one when its first face is added
      const solids: Block[] = [];
      const find = (list: Block[]) => list.forEach((b) => (b.kind === "solid" && solids.push(b), find(b.inner ?? [])));
      find(program);
      const solid = solids[solids.length - 1];
      if (solid) host.change(insertStack(program, { parentId: solid.id, index: solid.inner?.length ?? 0 }, [{ ...newBlockFor(program, "faces"), inner: [fresh] }]));
    }
  }

  /**
   * Move from one field to the next (or previous) in reading order, as Tab does in a form. Only fields you type into are stops:
   * drop-downs and ticks are skipped. Works from the layout as it is now, found again by block and field, since keeping the
   * value that was just typed may have moved things. Scrolls to the field if it is out of sight.
   */
  function nextField(blockId: string, paramId: string, direction: 1 | -1) {
    const fields = layout.blocks.flatMap((b) => b.parts.filter((p) => (p.kind === "field" || p.kind === "caption") && p.param).map((p) => ({ blockId: b.block.id, param: p.param!, rect: p.rect })));
    const typed = (f: (typeof fields)[number]) => f.param.type.kind !== "choice" && f.param.type.kind !== "file";
    let i = fields.findIndex((f) => f.blockId === blockId && f.param.id === paramId);
    if (i < 0) return undefined;
    do i += direction;
    while (i >= 0 && i < fields.length && !typed(fields[i]));
    return fields[i];
  }

  function tabFrom(blockId: string, paramId: string, direction: 1 | -1) {
    const next = nextField(blockId, paramId, direction);
    if (!next) return;
    // show it, with room above and below
    if (next.rect.y < scrollY + VIEW_TOP + 0.3 || next.rect.y + next.rect.h > scrollY + VIEW_BOTTOM - 0.6) {
      setScroll(next.rect.y - VIEW_TOP - 1.5);
      render();
    }
    const now = layout.blocks.find((b) => b.block.id === next.blockId)?.parts.find((p) => p.param?.id === next.param.id);
    if (now) openField({ kind: "field", blockId: next.blockId, param: next.param, rect: now.rect });
  }

  /** The pop-up of a measure block's "?": what it measured, and the names to use it by */
  function showMeasurements(blockId: string, rect: Rect) {
    const camera = stage.world.camera;
    const box = (stage.renderer.pixi.canvas as HTMLCanvasElement).getBoundingClientRect();
    const topLeft = camera.metersToScreen({ x: rect.x, y: rect.y });
    const at = { left: box.left + topLeft.x, top: box.top + topLeft.y, width: rect.w * camera.scale, height: rect.h * camera.scale };
    const block = findBlock(host.program(), blockId)?.block;
    const name = String(block?.args.name ?? "part").trim() || "part";
    const found = host.measurements?.(blockId);
    if (!found) {
      openInfo(at, `${name}: not measured yet`, ["This block has not run yet: either the program is still loading,", "or a problem above it (shown in red) stopped it."]);
      return;
    }
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

  function openField(h: Extract<Hit, { kind: "field" }>) {
    const camera = stage.world.camera;
    const box = (stage.renderer.pixi.canvas as HTMLCanvasElement).getBoundingClientRect();
    const topLeft = camera.metersToScreen({ x: h.rect.x, y: h.rect.y });
    const block = findBlock(host.program(), h.blockId)!.block;
    if (h.param.type.kind === "file" && host.chooseFile) {
      // a file field is a menu of the project's files, ending in "Import STL file..."
      host.chooseFile(
        { left: box.left + topLeft.x, top: box.top + topLeft.y, width: h.rect.w * camera.scale, height: h.rect.h * camera.scale },
        String(block.args[h.param.id] ?? h.param.default),
        (name) => host.change(setArg(host.program(), h.blockId, h.param.id, name)),
      );
      return;
    }
    // a file field is a drop-down of the files there are
    const param =
      h.param.type.kind === "file"
        ? { ...h.param, type: { kind: "choice" as const, options: [{ value: "", label: "(choose a file)" }, ...(host.files?.() ?? []).map((name) => ({ value: name, label: name }))] } }
        : h.param;
    openFieldEditor({
      rect: { left: box.left + topLeft.x, top: box.top + topLeft.y, width: h.rect.w * camera.scale, height: h.rect.h * camera.scale },
      param,
      value: String(block.args[h.param.id] ?? h.param.default),
      onCommit: (value) => host.change(setArg(host.program(), h.blockId, h.param.id, value)),
      onTab: (direction) => tabFrom(h.blockId, h.param.id, direction),
      canTab: (direction) => nextField(h.blockId, h.param.id, direction) !== undefined,
    });
  }

  function onPanStop(p: { x: number; y: number }) {
    if (drag) drop(p);
    press = undefined;
  }

  function onUp(p: { x: number; y: number }) {
    const pr = press;
    press = undefined;
    if (drag) {
      drop(p);
      return;
    }
    if (pr && !pr.moved) activate(pr.target);
  }

  new Actor({
    appearance: new FilledBox({ width: SCREEN.w, height: SCREEN.h, fillColor: "#00000000", z: z(-4) }),
    rigidBody: new BoxBody({ cx: SCREEN.w / 2, cy: SCREEN.h / 2, width: SCREEN.w, height: SCREEN.h }, { scene: stage.hud }),
    gestures: {
      onTouchDown: (_a, p) => (onDown(p), true),
      onPanStart: (_a, p) => (onPanStart(p), true),
      onPanMove: (_a, p) => (onPanMove(p), true),
      onPanStop: (_a, p) => (onPanStop(p), true),
      onTouchUp: (_a, p) => (onUp(p), true),
    },
  });

  // JetLag has no mouse wheel, so the workspace scrolls with the page's own wheel event
  const canvas = stage.renderer.pixi.canvas as HTMLCanvasElement;
  canvas.addEventListener(
    "wheel",
    (e) => {
      const r = canvas.getBoundingClientRect();
      const perMeter = r.width / SCREEN.w;
      const at = { x: (e.clientX - r.left) / perMeter, y: (e.clientY - r.top) / perMeter };
      if (!inWorkspace(at)) return;
      e.preventDefault();
      setScroll(scrollY + (e.deltaY * (e.deltaMode === 1 ? 16 : 1)) / perMeter);
      render();
    },
    { passive: false },
  );

  return {
    /** Where everything is, as of the last drawing (for tests) */
    state: () => ({ layout, scrollY, category, regions: regions.map((r) => ({ rect: r.rect, target: r.target })), buttons: regions.filter((r) => r.target.kind === "button").map((r) => r.rect) }),
    /** The program, the problem or the status changed: draw again */
    refresh() {
      render();
      // show the block that has a problem, if it is a new one
      const problem = host.problem();
      const id = problem?.blockId;
      if (id && id !== lastProblem) {
        const b = layout.blocks.find((x) => x.block.id === id);
        if (b && (b.bounds.y < scrollY + VIEW_TOP || b.bounds.y + b.bounds.h > scrollY + VIEW_BOTTOM)) {
          setScroll(b.bounds.y - VIEW_TOP - 1);
          render();
        }
      }
      lastProblem = id;
    },
  };
}
