import { COMMANDS, type CommandDef } from "../../language/commands";
import type { Category } from "../../language/types";
import { type Measure, type Rect, grownRects, nearestReaching, rectContains } from "../layout";
import { type ModeSpec, offers } from "../modes";
import { BUTTON_ROW, CATEGORIES, PALETTE_W, SCREEN, TEXT_SIZE, TOOLBAR_TEXT, VIEW_BOTTOM, VIEW_TOP } from "./geometry";
import type { Hotspot, ToolbarButton } from "./types";

/**
 * Where the toolbar's buttons and tabs and the palette's rows go, worked out
 * from numbers alone: which tabs a mode has, how wide each button and tab is,
 * and how the palette's blocks are spaced to fit.
 */

/** A tab of the palette: the category it shows, and what it is called */
export interface Tab {
  id: Category;
  label: string;
}

/**
 * The tabs this mode has blocks for (one each, in the palette's order), the
 * blocks it offers, and the category to show: the one chosen if it has a tab,
 * and otherwise the first tab.
 *
 * @param mode The mode in use, if any.
 * @param category The category that was showing.
 */
export function visibleTabs(mode: ModeSpec | undefined, category: Category): { tabs: Tab[]; offered: CommandDef[]; category: Category } {
  const offered = COMMANDS.filter((d) => offers(mode, d.id));
  const tabs = CATEGORIES.filter((c) => offered.some((d) => d.category === c.id));
  const shown = tabs.length && !tabs.some((c) => c.id === category) ? tabs[0].id : category;
  return { tabs, offered, category: shown };
}

/** A button of the toolbar and where it goes */
export interface PlacedButton {
  /** The button's place in the host's list of buttons */
  index: number;
  rect: Rect;
}

/** A tab of the palette, where it goes in the toolbar, and the color it is drawn in */
export interface PlacedTab extends Tab {
  rect: Rect;
  /** The color of the category's blocks */
  color: string;
}

/** Where the toolbar's buttons and tabs go */
export interface ToolbarPlan {
  /** The project's buttons, right-justified */
  file: PlacedButton[];
  /** The tabs, at the left */
  tabs: PlacedTab[];
  /** The size the tabs' words are drawn at */
  tabTextSize: number;
  /** Undo and redo, right after the tabs (they act on the blocks) */
  edit: PlacedButton[];
  /** The mode, in the middle of the room that is left */
  mode: PlacedButton[];
}

/**
 * Place the top bar: the category tabs at the left, then undo and redo, the
 * mode in the middle of what is left, and the project's buttons at the right
 * (right-justified), so the palette below is just the blocks and can be narrow.
 *
 * @param buttons The host's buttons.
 * @param tabs The tabs to show.
 * @param measure How wide text is on screen, in meters.
 */
export function toolbarPlan(buttons: Pick<ToolbarButton, "group" | "label">[], tabs: Tab[], measure: Measure): ToolbarPlan {
  // the toolbar's text is a little smaller than the blocks', so more buttons fit
  const buttonWidths = buttons.map((b) => Math.max(0.8, measure(b.label) * (TOOLBAR_TEXT / TEXT_SIZE) + 0.34));
  const gap = 0.08;
  /** The buttons of one group, with their positions in the list. */
  const groupOf = (g: ToolbarButton["group"]) => buttons.map((b, i) => ({ b, i })).filter((x) => x.b.group === g);
  /** The width a row of buttons takes, with the gaps between. */
  const widthOf = (items: { i: number }[]) => items.reduce((t, x) => t + buttonWidths[x.i], 0) + gap * Math.max(0, items.length - 1);
  /** Place a row of buttons starting at this x. */
  const place = (items: { i: number }[], from: number): PlacedButton[] => {
    let x = from;
    return items.map(({ i }) => {
      const rect = { x, y: BUTTON_ROW.y, w: buttonWidths[i], h: BUTTON_ROW.h };
      x += buttonWidths[i] + gap;
      return { index: i, rect };
    });
  };
  // the project's buttons are right-justified; the tabs are at the left, then undo and redo (they act on the blocks), then the mode
  // in the middle of what is left, with as much room on one side as on the other
  const file = groupOf("file");
  const fileLeft = SCREEN.w - 0.12 - widthOf(file);
  // the tabs, in the room left of the buttons: as wide as their words need, and a smaller size if the room is short
  const edit = groupOf("edit");
  const tabGap = 0.06;
  const room = Math.min(fileLeft - 0.3 - 0.1 - widthOf(edit) - 0.3, 5.2);
  /** How wide each tab is when its words are drawn at this size. */
  const wordsAt = (size: number) => tabs.map((c) => (c.label.length * 0.55 * size) / 80 + 0.34); // a letter is about 0.55 of the size wide, and 80 pixels is a metre
  let size = 15;
  let tabWidths = wordsAt(size);
  while (size > 11 && tabWidths.reduce((t, w) => t + w, 0) + tabGap * (tabs.length - 1) > room) tabWidths = wordsAt(--size);
  let tx = 0.1;
  const placedTabs = tabs.map((c, i) => {
    const rect = { x: tx, y: BUTTON_ROW.y, w: tabWidths[i], h: BUTTON_ROW.h };
    tx += tabWidths[i] + tabGap;
    return { ...c, rect, color: COMMANDS.find((d) => d.category === c.id)!.color };
  });
  // undo and redo come right after the tabs
  const editLeft = tx - tabGap + 0.3;
  // the mode is centred between the end of undo and redo and the start of the project's buttons
  const mode = groupOf("mode");
  const editRight = editLeft + widthOf(edit);
  return { file: place(file, fileLeft), tabs: placedTabs, tabTextSize: size, edit: place(edit, editLeft), mode: place(mode, editRight + (fileLeft - editRight - widthOf(mode)) / 2) };
}

/** A row of the palette: a block to drag out, where it is, and how large its words are */
export interface PaletteRow {
  def: CommandDef;
  rect: Rect;
  textSize: number;
}

/** Where the palette's rows and its "+ new script" button go */
export interface PalettePlan {
  rows: PaletteRow[];
  /** The "+ new script" button, in a mode that has scripts */
  newScript?: Rect;
}

/**
 * Place the blocks of the chosen tab, to be dragged out or tapped. When there
 * are more than fit, the rows are spaced closer together (and the words made a
 * little smaller), and with far too many they go in two columns. Where the mode
 * has scripts, a "+ new script" button goes under them.
 *
 * @param offered The blocks the mode offers.
 * @param category The tab that is showing.
 * @param scripts Does the mode have scripts?
 */
export function palettePlan(offered: CommandDef[], category: Category, scripts: boolean): PalettePlan {
  const mine = offered.filter((d) => d.category === category && !d.automatic); // the sections of a solid come with it
  const top = VIEW_TOP + 0.2;
  const room = VIEW_BOTTOM - (scripts ? 1.2 : 0.65) - top; // the hint line is under the last block (and the new script button, when there is one)
  const columns = mine.length * 0.45 > room ? 2 : 1;
  const perColumn = Math.ceil(mine.length / columns);
  const step = Math.min(0.67, room / perColumn);
  const colW = (PALETTE_W - 0.4 - (columns - 1) * 0.1) / columns;
  const rows = mine.map((def, i) => {
    const col = Math.floor(i / perColumn);
    const rect = { x: 0.2 + col * (colW + 0.1), y: top + (i % perColumn) * step, w: colW, h: Math.max(0.3, step - 0.12) };
    return { def, rect, textSize: step < 0.6 ? TEXT_SIZE - 5 : TEXT_SIZE - 3 };
  });
  return { rows, ...(scripts ? { newScript: { x: 0.2, y: VIEW_BOTTOM - 1.1, w: PALETTE_W - 0.4, h: 0.45 } } : {}) };
}

/** Where the toolbar's hotspots may grow to: the whole bar */
const TOOLBAR_AREA: Rect = { x: 0, y: 0, w: SCREEN.w, h: VIEW_TOP };
/** Where the palette's hotspots may grow to: the palette under the toolbar */
const PALETTE_AREA: Rect = { x: 0, y: VIEW_TOP, w: PALETTE_W, h: VIEW_BOTTOM - VIEW_TOP };

/**
 * What a touch at a point outside the workspace finds: the hotspot it is on, or
 * failing that the hotspot that has the point within its larger area to touch.
 * A button, tab or palette row smaller than `min` grows into the free room
 * beside it, within the toolbar or the palette, and clear of the other
 * hotspots.
 *
 * @param hotspots The hotspots, as drawn.
 * @param x Where the touch is on the screen (meters).
 * @param y Where the touch is on the screen (meters).
 * @param min The smallest size a thing to touch is given (meters; 0 for none).
 */
export function hotspotAt(hotspots: Hotspot[], x: number, y: number, min: number): Hotspot | undefined {
  const exact = hotspots.find((h) => rectContains(h.rect, x, y));
  if (exact || min <= 0) return exact;
  const areas = grownRects(
    hotspots.map((h) => h.rect),
    hotspots.map((h) => (h.rect.y + h.rect.h <= VIEW_TOP ? TOOLBAR_AREA : PALETTE_AREA)),
    min,
  );
  return nearestReaching(
    hotspots.map((h, i) => ({ area: areas[i], answer: h })),
    x,
    y,
  );
}
