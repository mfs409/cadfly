/**
 * Where everything in a block program goes on the screen, worked out as plain
 * numbers (meters, y down). A drawing of the blocks only has to draw these and
 * to ask `hit()` what is under a pointer, so the layout can be tested with no
 * screen.
 *
 * `layoutProgram` does the work. It gives a `ProgramLayout`: a `BlockLayout`
 * for every block (its header rows, the `Part`s on them, and for a C-shaped
 * block the bars around what is inside), a `ScriptLayout` for every script that
 * has a header (a script of several blocks, or any script when the program has
 * more than one), and the `DropPoint`s where dragged blocks could go.
 * `acceptingPoints` and `nearestPoint` pick among those points, and `hit`
 * finds what is under a pointer.
 *
 * It knows how blocks are drawn, not what they build, and it asks the language
 * only what a block is made of and where blocks may go. It needs no browser.
 */

export { acceptingPoints, nearestPoint } from "./drop";
export { fitText } from "./header";
export { type Hit, hit, rectContains } from "./hit";
export { grownRects, nearestReaching } from "./reach";
export { layoutProgram } from "./layout";
export { blockOutline, roundedPolygon } from "./outline";
export {
  type BlockLayout,
  DEFAULT_METRICS,
  type DropPoint,
  type EditableScriptLayout,
  type LayoutOptions,
  type Measure,
  type Metrics,
  metricsForTouch,
  type Part,
  type PartKind,
  type PlainScriptLayout,
  type ProgramLayout,
  type Rect,
  type ScriptLayout,
} from "./types";
