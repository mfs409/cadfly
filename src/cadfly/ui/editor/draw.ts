import { blocksToWrap, hasBlocks } from "../../language/program";
import type { Block, Program } from "../../language/types";
import { type BlockLayout, type Part, type PartKind, type ProgramLayout, blockOutline, layoutProgram, metricsForTouch } from "../layout";
import { allowsScripts } from "../modes";
import { PiecePool, ShapePool } from "../pool";
import { PALETTE_W, SCREEN, STATUS_H, TEXT_SIZE, TOOLBAR_H, TOOLBAR_TEXT, VIEW_BOTTOM, VIEW_LEFT, VIEW_TOP, WORK, overPalette, zIndex } from "./geometry";
import { palettePlan, toolbarPlan, visibleTabs } from "./panels";
import type { EditorContext, Hotspot } from "./types";

/**
 * Drawing: everything the editor shows, drawn from the numbers of the layout
 * and the state of the editor. Nothing here changes the state, except that the
 * hotspots outside the workspace are noted as the toolbar and palette are
 * drawn, since that is where their places are known.
 */

/** The pools of actors that draw the workspace and the HUD. Actors are reused from one drawing to the next. */
export interface Pools {
  /** Boxes and text in the workspace */
  world: PiecePool;
  /** Blocks that hold others are drawn as one polygon each (the workspace's pool of them) */
  worldShapes: ShapePool;
  /** Boxes and text over everything: the panels, and the blocks being carried */
  hud: PiecePool;
  /** The same polygons, on the HUD */
  hudShapes: ShapePool;
}

/** How to draw one kind of part of a block's header: on this pool, in this block, at this stacking order, faded or not */
type PartDrawer = (pool: PiecePool, p: Part, b: BlockLayout, zBase: number, faded: boolean) => void;

/** A part drawn as a chip of text on a box with a fill and a line */
function chip(pool: PiecePool, p: Part, zBase: number, look: { fill: string; line: string; lineWidth?: number; textColor: string; textSize: number; radius?: boolean }) {
  pool.draw({ ...p.rect, fill: look.fill, line: look.line, lineWidth: look.lineWidth, radius: look.radius ? p.rect.h / 2 : undefined, boxZ: zIndex(zBase + 1), text: p.text, textColor: look.textColor, textSize: look.textSize, textZ: zIndex(zBase + 2) });
}

/** Plain text, with no box */
const plainText: PartDrawer = (pool, p, _b, zBase, faded) => {
  pool.draw({ ...p.rect, text: p.text, textColor: faded ? "#ffffff80" : p.kind === "word" ? "#ffffff" : "#ffffffd0", textSize: TEXT_SIZE, textZ: zIndex(zBase + 2) });
};

/** How each kind of part is drawn */
const PART_DRAWERS: Record<PartKind, PartDrawer> = {
  word: plainText,
  label: plainText,
  // a block's own button (hull): a chip that stands out from the fields
  button: (pool, p, _b, zBase) => chip(pool, p, zBase, { fill: "#ffd23f", line: "#00000050", lineWidth: 0.015, radius: true, textColor: "#1f2842", textSize: TEXT_SIZE - 3 }),
  // the number of a vertex (1, 2, 3) or of a face (f1, f2, f3): a badge, so a face's "1 2 3" can be matched to the points and the face to its drawing
  number: (pool, p, _b, zBase) => chip(pool, p, zBase, { fill: "#ffffff", line: "#1f2842", lineWidth: 0.02, radius: true, textColor: "#1f2842", textSize: TEXT_SIZE - 3 }),
  // the "?" of a block that reports on what is inside it
  info: (pool, p, _b, zBase) => chip(pool, { ...p, text: "?" }, zBase, { fill: "#ffffff1f", line: "#ffffff80", lineWidth: 0.015, radius: true, textColor: "#ffffff", textSize: TEXT_SIZE - 2 }),
  // a power switch: a ring with a bar through its top; lit when the block works, dark when it is off
  power: (pool, p, b, zBase) => {
    const { x, y, w, h } = p.rect;
    const on = b.block.disabled !== true;
    pool.draw({ x, y, w, h, fill: on ? "#ffffffe6" : "#0000004d", line: on ? "#00000040" : "#ffffff66", lineWidth: 0.015, radius: h / 2, boxZ: zIndex(zBase + 1) });
    const d = h * 0.52;
    pool.draw({ x: x + w / 2 - d / 2, y: y + h / 2 - d / 2 + 0.012, w: d, h: d, fill: "#00000000", line: on ? "#1f2842" : "#ffffffb0", lineWidth: 0.025, radius: d / 2, boxZ: zIndex(zBase + 2) });
    pool.draw({ x: x + w / 2 - 0.012, y: y + h / 2 - d / 2 - 0.045, w: 0.024, h: d * 0.62, fill: on ? "#1f2842" : "#ffffffb0", radius: 0, boxZ: zIndex(zBase + 3) });
  },
  // an eye: open (a pill with a pupil) when the block shows, shut (a dark pill with a lid line) when it is hidden
  eye: (pool, p, _b, zBase, faded) => {
    const { x, y, w, h } = p.rect;
    if (faded) {
      pool.draw({ x, y, w, h, fill: "#0000004d", line: "#ffffff66", lineWidth: 0.015, radius: h / 2, boxZ: zIndex(zBase + 1) });
      pool.draw({ x: x + w * 0.18, y: y + h / 2 - 0.012, w: w * 0.64, h: 0.024, fill: "#ffffffb0", radius: 0, boxZ: zIndex(zBase + 2) });
    } else {
      pool.draw({ x, y, w, h, fill: "#ffffffe6", line: "#00000040", lineWidth: 0.015, radius: h / 2, boxZ: zIndex(zBase + 1) });
      const d = h * 0.46;
      pool.draw({ x: x + w / 2 - d / 2, y: y + h / 2 - d / 2, w: d, h: d, fill: "#1f2842", radius: d / 2, boxZ: zIndex(zBase + 2) });
    }
  },
  // a label for people, on its own line above the block
  caption: (pool, p, _b, zBase) => pool.draw({ ...p.rect, text: p.text, textColor: "#ffffffc0", textSize: TEXT_SIZE - 4, textZ: zIndex(zBase + 2) }),
  // the - / + button that folds a block that holds others
  fold: (pool, p, _b, zBase) => chip(pool, p, zBase, { fill: "#ffffff2e", line: "#ffffff55", lineWidth: 0.015, textColor: "#ffffff", textSize: TEXT_SIZE }),
  // a field's value, and a tick: a light chip
  field: (pool, p, _b, zBase) => chip(pool, p, zBase, { fill: "#fffffff0", line: "#00000040", textColor: "#1f2842", textSize: TEXT_SIZE }),
  flag: (pool, p, _b, zBase) => chip(pool, p, zBase, { fill: "#fffffff0", line: "#00000040", textColor: "#1f2842", textSize: TEXT_SIZE }),
};

/**
 * Draw a laid-out program with a pool. The z of block backgrounds is `zBase`;
 * fields are one above, text two.
 *
 * @param pool The pool to draw boxes and text with.
 * @param shapes The pool to draw blocks that hold others as one polygon with, if there is one.
 * @param l The layout to draw.
 * @param zBase The stacking order of block backgrounds.
 * @param problemId The block that has a problem, drawn with a red line.
 */
export function drawLayout(pool: PiecePool, shapes: ShapePool | undefined, l: ProgramLayout, zBase: number, problemId?: string) {
  for (const b of l.blocks) {
    const bad = b.block.id === problemId;
    // a hidden block is drawn faded: it is built, but gives nothing to the picture
    const faded = b.block.hidden === true || b.block.disabled === true;
    const frame = { fill: faded ? `${b.def.color}66` : b.def.color, line: bad ? "#ff3b3b" : faded ? "#ffffff30" : "#ffffff55", lineWidth: bad ? 0.07 : 0.03, boxZ: zIndex(zBase) };
    const outline = shapes && blockOutline(b);
    if (outline) {
      // one polygon for the whole block; it sits just under the blocks and fields drawn on it
      shapes.draw({ points: outline, fill: frame.fill, line: frame.line, lineWidth: frame.lineWidth, z: zIndex(zBase - 1) });
    } else {
      // a header that wraps onto several rows is one box, not a box for each row
      const first = b.rows[0];
      const last = b.rows[b.rows.length - 1];
      pool.draw({ x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y, ...frame });
      if (b.spine) pool.draw({ ...b.spine, ...frame });
      if (b.footer) pool.draw({ ...b.footer, ...frame });
    }
    if (b.empty) pool.draw({ ...b.empty, fill: "#00000040", line: "#ffffff30", boxZ: zIndex(zBase) });
    for (const p of b.parts) PART_DRAWERS[p.kind](pool, p, b, zBase, faded);
  }
}

/**
 * The line above each script that has one: a +/- button for several blocks, the
 * name (and for a named script in a mode that has scripts, chips to rename it
 * and change its inputs, and a button to remove it), and how many blocks; and
 * the strip that stands for a folded script.
 *
 * @param pool The pool to draw with.
 * @param l The layout to draw the script headers of.
 */
export function drawScripts(pool: PiecePool, l: ProgramLayout) {
  for (const s of l.scripts) {
    if (s.button) pool.draw({ ...s.button, fill: "#ffffff2e", line: "#ffffff55", lineWidth: 0.015, boxZ: zIndex(1), text: s.collapsed ? "+" : "−", textColor: "#ffffff", textSize: TEXT_SIZE, textZ: zIndex(2) });
    if (s.kind === "editable") {
      for (const c of [s.nameChip, s.inputsChip]) pool.draw({ ...c.rect, fill: "#fffffff0", line: "#00000040", boxZ: zIndex(1), text: c.text, textColor: "#1f2842", textSize: TEXT_SIZE - 3, textZ: zIndex(2) });
    }
    if (s.text.text) pool.draw({ ...s.text.rect, text: s.text.text, textColor: "#ffffff90", textSize: TEXT_SIZE - 5, textZ: zIndex(2) });
    if (s.kind === "editable") pool.draw({ ...s.remove, fill: "#d9363e", line: "#ffffff80", lineWidth: 0.015, boxZ: zIndex(1), text: "×", textColor: "#ffffff", textSize: TEXT_SIZE, textZ: zIndex(2) });
    if (s.strip) pool.draw({ ...s.strip, fill: "#00000040", line: "#ffffff30", boxZ: zIndex(0), text: "...", textColor: "#ffffffb0", textSize: TEXT_SIZE, textZ: zIndex(2) });
  }
}

/**
 * Blocks that are being carried, as a program to lay out: one script with no
 * place of its own.
 *
 * @param blocks The blocks being carried.
 */
export const carriedProgram = (blocks: Block[]): Program => [{ id: "carried", blocks }];

/**
 * The line that shows where carried blocks would snap to, and, when a holder
 * dropped there would wrap the blocks from there to the end of the list, an
 * outline round the blocks it would wrap.
 *
 * @param ctx The editor.
 * @param shown The program the blocks are being dragged over.
 */
function drawSnap(ctx: EditorContext, shown: Program) {
  const g = ctx.st.gesture;
  if (g.kind !== "carrying" || !g.drag.snap) return;
  const { world } = ctx.pools;
  const snap = g.drag.snap;
  world.draw({ x: snap.x, y: snap.y - 0.05, w: 2.6, h: 0.1, fill: "#ffd23f", line: "#ffffff", boxZ: zIndex(3) });
  // a holder dropped here would wrap the blocks from here to the end of the list: outline them
  const wrapped = new Set(blocksToWrap(shown, snap, g.drag.blocks).map((b) => b.id));
  const covered = ctx.st.layout.blocks.filter((b) => wrapped.has(b.block.id)).map((b) => b.bounds);
  if (covered.length) {
    const x = Math.min(...covered.map((r) => r.x)) - 0.05;
    const y = Math.min(...covered.map((r) => r.y)) - 0.05;
    const w = Math.max(...covered.map((r) => r.x + r.w)) + 0.05 - x;
    const h = Math.max(...covered.map((r) => r.y + r.h)) + 0.05 - y;
    world.draw({ x, y, w, h, fill: "#ffd23f26", line: "#ffd23f", lineWidth: 0.04, boxZ: zIndex(3) });
  }
}

/**
 * The top bar: the category tabs at the left, and the buttons at the right
 * (right-justified), with each button and tab made a hotspot.
 *
 * @param ctx The editor.
 * @param tabs The tabs to draw.
 */
function drawToolbar(ctx: EditorContext, tabs: ReturnType<typeof visibleTabs>["tabs"]) {
  const { hud } = ctx.pools;
  const buttons = ctx.host.buttons();
  const plan = toolbarPlan(buttons, tabs, ctx.measure);
  /** Draw a row of buttons, and make each one a hotspot. */
  const drawButtons = (placed: { index: number; rect: Hotspot["rect"] }[]) => {
    for (const { index, rect } of placed) {
      const b = buttons[index];
      const on = b.enabled();
      hud.draw({ ...rect, fill: on ? b.color : "#4b5563", line: "#ffffff80", lineWidth: 0.03, boxZ: zIndex(0), text: b.label, textColor: on ? "#ffffff" : "#9ca3af", textSize: TOOLBAR_TEXT, textZ: zIndex(1) });
      ctx.st.hotspots.push({ rect, touched: { kind: "button", index } });
    }
  };
  drawButtons(plan.file);
  for (const c of plan.tabs) {
    const selected = c.id === ctx.st.category;
    hud.draw({ ...c.rect, fill: selected ? c.color : "#2b3554", line: selected ? "#ffffff" : c.color, lineWidth: 0.03, boxZ: zIndex(0), text: c.label, textColor: "#ffffff", textSize: plan.tabTextSize, textZ: zIndex(1) });
    ctx.st.hotspots.push({ rect: c.rect, touched: { kind: "tab", category: c.id } });
  }
  drawButtons(plan.edit);
  drawButtons(plan.mode);
}

/**
 * The blocks of the chosen tab, to be dragged out or tapped, and under them
 * the "+ new script" button where the mode has scripts.
 *
 * @param ctx The editor.
 * @param offered The blocks the mode offers.
 */
function drawPalette(ctx: EditorContext, offered: ReturnType<typeof visibleTabs>["offered"]) {
  const { hud } = ctx.pools;
  const plan = palettePlan(offered, ctx.st.category, allowsScripts(ctx.host.mode?.()));
  for (const { def, rect, textSize } of plan.rows) {
    hud.draw({ ...rect, fill: def.color, line: "#ffffff80", lineWidth: 0.03, boxZ: zIndex(0), text: def.word + (def.piece ? `  (in ${def.partOf ?? "a sketch"})` : ""), textColor: "#ffffff", textSize, textZ: zIndex(1) });
    ctx.st.hotspots.push({ rect, touched: { kind: "palette", blockKind: def.id } });
  }
  if (plan.newScript) {
    // the button that makes a new script, under the blocks of every tab
    hud.draw({ ...plan.newScript, fill: "#2b3554", line: "#ffffffb0", lineWidth: 0.03, boxZ: zIndex(0), text: "+ new script", textColor: "#ffffff", textSize: TEXT_SIZE - 4, textZ: zIndex(1) });
    ctx.st.hotspots.push({ rect: plan.newScript, touched: { kind: "newScript" } });
  }
  hud.draw({ x: 0.1, y: VIEW_BOTTOM - 0.55, w: PALETTE_W - 0.2, h: 0.45, text: "drag blocks out or back", textColor: "#8590aa", textSize: 12, textZ: zIndex(1) });
}

/**
 * Draw everything: the workspace, the line and outline that show where carried
 * blocks would land, the panels around the workspace, the toolbar and palette,
 * and the blocks being carried. It only reads the layout and the gesture that
 * were worked out before it; where a carried block would land is not decided
 * here.
 *
 * @param ctx The editor.
 */
export function draw(ctx: EditorContext) {
  const { st, host, pools } = ctx;
  const { world, worldShapes, hud, hudShapes } = pools;
  world.begin();
  worldShapes.begin();
  hud.begin();
  hudShapes.begin();
  st.hotspots = [];
  const mode = host.mode?.();
  const g = st.gesture;

  // the workspace: the program, or the program without what is being carried (the layout was made from it)
  drawLayout(world, worldShapes, st.layout, 0, host.problem()?.blockId);
  drawScripts(world, st.layout);

  // the carried blocks, laid out where the pointer holds them
  const carried =
    g.kind === "carrying" ? layoutProgram(carriedProgram(g.drag.blocks), { x: g.drag.pointer.x + g.drag.grabOffset.dx, y: g.drag.pointer.y + g.drag.grabOffset.dy, width: WORK.width, measure: ctx.measure, mode, metrics: metricsForTouch(ctx.minTarget()) }) : undefined;

  // where the carried blocks would land
  if (g.kind === "carrying") {
    drawSnap(ctx, g.drag.programWithout);
    if (g.drag.newScriptAt && carried) {
      const w = Math.max(...carried.blocks.map((b) => b.bounds.w), 1);
      const h = carried.bottom - (g.drag.pointer.y + g.drag.grabOffset.dy);
      world.draw({ x: WORK.x + g.drag.newScriptAt.x, y: WORK.y + g.drag.newScriptAt.y, w, h, fill: "#ffffff14", line: "#ffffffb0", lineWidth: 0.03, boxZ: zIndex(3) });
    }
  }

  // the panels around the workspace
  const bar = "#10172b";
  hud.draw({ x: 0, y: 0, w: SCREEN.w, h: TOOLBAR_H, fill: bar, radius: 0, boxZ: zIndex(-2) }); // the bar runs across the whole top: the 3D view starts under it
  hud.draw({ x: 0, y: VIEW_BOTTOM, w: SCREEN.w, h: STATUS_H, fill: bar, radius: 0, boxZ: zIndex(-2) });
  hud.draw({ x: VIEW_LEFT, y: TOOLBAR_H, w: SCREEN.w - VIEW_LEFT, h: VIEW_BOTTOM - TOOLBAR_H, fill: "#e8e8e8", radius: 0, boxZ: zIndex(-2) });
  hud.draw({ x: 0, y: VIEW_TOP, w: PALETTE_W, h: VIEW_BOTTOM - VIEW_TOP, fill: "#1f2842", radius: 0, boxZ: zIndex(-2) });

  const { tabs, offered, category } = visibleTabs(mode, st.category);
  st.category = category;
  drawToolbar(ctx, tabs);
  drawPalette(ctx, offered);
  // an empty workspace says what to do
  if (!hasBlocks(host.program()) && g.kind !== "carrying") hud.draw({ x: WORK.x, y: WORK.y + 0.05, w: 6, h: 0.5, text: "Drag blocks in from the left to build something.", textColor: "#8590aa", textSize: 16, textZ: zIndex(1) });

  if (g.kind === "carrying" && carried) {
    if (overPalette(g.drag.pointer)) {
      hud.draw({ x: 0, y: VIEW_TOP, w: PALETTE_W, h: VIEW_BOTTOM - VIEW_TOP, fill: "#d9363ecc", radius: 0, boxZ: zIndex(1), text: "drop here to delete", textColor: "#ffffff", textZ: zIndex(1), textSize: 18 });
    }
    drawLayout(hud, hudShapes, carried, 2);
  }

  world.end();
  worldShapes.end();
  hud.end();
  hudShapes.end();
}
