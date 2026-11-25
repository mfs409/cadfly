import type { ZIndex } from "jetlag2d";
import type { Category, Point } from "../../language/types";
import type { RevealHow } from "./types";

/**
 * Where everything goes on the 16 x 9 meter screen, and the other fixed sizes
 * the editor is built from: the toolbar, the palette, the status bar and the
 * workspace, how close a drag has to be to things, and the stacking of what is
 * drawn.
 */

/** The screen is 16 meters wide and 9 tall. */
export const SCREEN = { w: 16, h: 9 };
/** Left of this x (in meters) is the editor; the 3D view covers the rest. */
export const VIEW_LEFT = 9.6;
/** The height of the toolbar along the top, in meters. */
export const TOOLBAR_H = 0.85;
/** The height of the status bar along the bottom, in meters. */
export const STATUS_H = 0.6;
/** The width of the palette down the left side, in meters. */
export const PALETTE_W = 2.7;
/** Where the editor's workspace starts, below the toolbar */
export const VIEW_TOP = TOOLBAR_H;
/** Where the workspace ends, above the status bar */
export const VIEW_BOTTOM = SCREEN.h - STATUS_H;
/** Where the program starts, and how wide it may get, in the scrolling workspace */
export const WORK = { x: PALETTE_W + 0.25, y: TOOLBAR_H + 0.65, width: VIEW_LEFT - PALETTE_W - 0.5 };

/** The size of the text on blocks */
export const TEXT_SIZE = 20;
/** The size of the text on the toolbar buttons */
export const TOOLBAR_TEXT = 16;
/** A dragged block snaps to a drop point this close to its top left corner */
export const SNAP = 0.9;
/** How close (in meters) a drag has to be to the top or bottom edge of the workspace for the view to scroll along with it, as time passes */
export const EDGE_ZONE = 0.4;
/**
 * How fast the view scrolls (in meters per second) when the pointer is right at
 * the top or bottom edge. Scrolling is slower the nearer the pointer is to the
 * inner side of the edge zone, and stops outside it.
 */
export const EDGE_SPEED = 5;
/** Where the top left of a block taken from the palette is, relative to the pointer, so the pointer holds it near its middle */
export const PALETTE_GRAB = { dx: -0.6, dy: -0.28 };
/** How far below the last thing the workspace can be scrolled, so there is room to drop blocks under it */
export const ROOM_BELOW = 1.2;
/** How close to the top and bottom of the view a field has to be before it is scrolled into sight, and how far below the top it is then put */
export const FIELD_REVEAL: RevealHow = { margin: { top: 0.3, bottom: 0.6 }, lead: 1.5 };
/** The same for the block with a problem, which is only scrolled to when it is out of sight altogether */
export const PROBLEM_REVEAL: RevealHow = { margin: { top: 0, bottom: 0 }, lead: 1 };
/**
 * The smallest size, in CSS pixels, that a thing to touch is given: a button or
 * field drawn smaller than this has a larger area to touch it by, where there is
 * room. It is about 9 mm on a tablet screen, which is what a fingertip needs.
 */
export const MIN_TARGET_PX = 44;
/** Where a toolbar button starts below the top of the screen, and how tall it is, in meters */
export const BUTTON_ROW = { y: 0.12, h: 0.6 };

/** The palette's tabs, in order, with what each is called */
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "shapes", label: "Shapes" },
  { id: "sketch", label: "Sketch" },
  { id: "code", label: "Code" },
  { id: "place", label: "Modify" },
  { id: "combine", label: "Combine" },
];

/**
 * A stacking order the game engine accepts. It only has -4 to 4 (anything else
 * crashes its renderer), and a carried block with a power switch asks for 5.
 *
 * @param n The order wanted.
 */
export const zIndex = (n: number) => Math.max(-4, Math.min(4, n)) as ZIndex;

/** Is this point over the part of the screen that shows the program? */
export const inWorkspace = (p: Point) => p.x >= PALETTE_W && p.x <= VIEW_LEFT && p.y >= VIEW_TOP && p.y <= VIEW_BOTTOM;

/** Is this point over the palette, where carried blocks are thrown away? */
export const overPalette = (p: Point) => p.x < PALETTE_W && p.y > VIEW_TOP && p.y < VIEW_BOTTOM;
