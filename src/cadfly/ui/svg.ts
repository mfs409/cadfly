import { blockOutline } from "./outline";
import { type BlockLayout, type Measure, type Rect, layoutProgram } from "./layout";
import type { ModeSpec } from "./modes";
import type { Program } from "./types";

/**
 * Draws a block program as a picture in SVG, for a book or a web page that
 * wants to show the blocks without running the editor. `programToSvg` does it,
 * from the editor's own layout (`layoutProgram`), so that the blocks look as
 * they do in the editor. Everything is in meters of layout until the end, when
 * `scale` turns it into pixels.
 */

/**
 * What `programToSvg` needs besides the program. The picture is the blocks as
 * the editor draws them (the same layout, colors and shapes). It needs no
 * screen: the editor's own layout does the work, and the one thing it cannot
 * know, how wide text is, is given as `measure` (scripts/blocks-svg.ts makes
 * one from the editor's font).
 */
export interface SvgOptions {
  /** How wide text is, in meters, at the editor's text size */
  measure: Measure;
  /**
   * How wide the blocks may be before a header wraps onto another row, in
   * meters. Default: the editor's workspace.
   */
  width?: number;
  /**
   * How much of each block to show, as in the editor (fields a mode hides are
   * left out). Default: all of it.
   */
  mode?: ModeSpec;
  /**
   * Pixels in the picture for each meter of layout. Default 80, which is about
   * the size of the blocks in the editor on a laptop.
   */
  scale?: number;
  /**
   * The panel the blocks sit on (the caption and stack labels are light, so
   * they need a dark one), or false for none
   */
  background?: string | false;
  /** An accessible name for the picture */
  title?: string;
}

/**
 * The editor's workspace is this wide (its screen less the palette and the 3D
 * view), in meters
 */
const WORK_WIDTH = 6.4;

/** The margin around the blocks in the picture, in meters */
const PAD = 0.3;

/**
 * How many meters wide one em of the editor's text is (its text size 20;
 * measured in the editor, which scales text with the window, so this is good to
 * a few percent): a text's width is its width in ems, in the editor's font,
 * times this. It is also the picture's font size.
 */
export const TEXT = 0.265;

/** The fonts the picture asks for, the editor's own first */
const FONT = "Arimo, 'Liberation Sans', Arial, Helvetica, sans-serif";

/** A number written for SVG: rounded to a thousandth of a meter */
function n(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/** Text made safe to put in SVG markup or in one of its attributes */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * A color as the editor writes it (#rrggbb, or #rrggbbaa) as an SVG paint
 * attribute, with its opacity if it has one
 *
 * @param kind Which attribute to make: `fill` or `stroke`.
 * @param color The color, as `#rrggbb` or `#rrggbbaa`.
 */
function paint(kind: "fill" | "stroke", color: string): string {
  if (color.length === 9) return `${kind}="${color.slice(0, 7)}" ${kind}-opacity="${n(parseInt(color.slice(7), 16) / 255)}"`;
  return `${kind}="${color}"`;
}

/** How a rectangle is drawn. A color is `#rrggbb` or `#rrggbbaa`. */
interface Box {
  /** The inside color (default: none) */
  fill?: string;
  /** The color of the line around it (default: none) */
  line?: string;
  /** How thick the line is, in meters (default 0.02) */
  lineWidth?: number;
  /** How round the corners are, in meters (default 0.1, less if short) */
  radius?: number;
}

/** A rectangle, as SVG markup, drawn as the box says */
function rect(r: Rect, b: Box): string {
  return `<rect x="${n(r.x)}" y="${n(r.y)}" width="${n(r.w)}" height="${n(r.h)}" rx="${n(b.radius ?? Math.min(0.1, r.h / 2))}" ${paint("fill", b.fill ?? "#00000000")} ${paint("stroke", b.line ?? "#00000000")} stroke-width="${n(b.lineWidth ?? 0.02)}"/>`;
}

/**
 * Text centered in a rectangle, as SVG markup (nothing for empty text)
 *
 * @param r The rectangle to center it in.
 * @param s The text.
 * @param color The color of the text, as `#rrggbb` or `#rrggbbaa`.
 * @param size The editor's text size (20 for most text).
 */
function text(r: Rect, s: string, color: string, size = 20): string {
  return s ? `<text x="${n(r.x + r.w / 2)}" y="${n(r.y + r.h / 2)}" text-anchor="middle" dominant-baseline="central" font-size="${n((TEXT * size) / 20)}" ${paint("fill", color)}>${esc(s)}</text>` : "";
}

/**
 * The shapes and text of one block, added to `out` as SVG markup: its frame,
 * the gap for an empty C-shaped block, and each part of its header.
 *
 * @param b The block's layout.
 * @param out The markup so far; the block's is added at the end.
 */
function drawBlock(b: BlockLayout, out: string[]) {
  const faded = b.block.hidden === true || b.block.disabled === true;
  const frame: Box = { fill: faded ? `${b.def.color}66` : b.def.color, line: faded ? "#ffffff30" : "#ffffff55", lineWidth: 0.03 };
  const outline = blockOutline(b);
  if (outline) {
    out.push(`<polygon points="${outline.map((p) => `${n(p.x)},${n(p.y)}`).join(" ")}" ${paint("fill", frame.fill!)} ${paint("stroke", frame.line!)} stroke-width="${frame.lineWidth}" stroke-linejoin="round"/>`);
  } else {
    // a header that wraps onto several rows is one box, not a box for each row
    const first = b.rows[0];
    const last = b.rows[b.rows.length - 1];
    out.push(rect({ x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y }, frame));
  }
  if (b.empty) out.push(rect(b.empty, { fill: "#00000040", line: "#ffffff30" }));
  for (const p of b.parts) {
    const r = p.rect;
    switch (p.kind) {
      case "word":
      case "label":
        out.push(text(r, p.text, faded ? "#ffffff80" : p.kind === "word" ? "#ffffff" : "#ffffffd0"));
        break;
      // a block's own button (hull): a chip that stands out from the fields
      case "button":
        out.push(rect(r, { fill: "#ffd23f", line: "#00000050", lineWidth: 0.015, radius: r.h / 2 }), text(r, p.text, "#1f2842", 17));
        break;
      case "number": // the number of a vertex or face: a badge
        out.push(rect(r, { fill: "#ffffff", line: "#1f2842", lineWidth: 0.02, radius: r.h / 2 }), text(r, p.text, "#1f2842", 17));
        break;
      case "info": // the "?" of a block that reports on what is inside it
        out.push(rect(r, { fill: "#ffffff1f", line: "#ffffff80", lineWidth: 0.015, radius: r.h / 2 }), text(r, "?", "#ffffff", 18));
        break;
      case "power": {
        // a ring with a bar through its top: lit when the block works, dark
        // when it is off
        const on = b.block.disabled !== true;
        const d = r.h * 0.52;
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2 + 0.012;
        out.push(
          rect(r, { fill: on ? "#ffffffe6" : "#0000004d", line: on ? "#00000040" : "#ffffff66", lineWidth: 0.015, radius: r.h / 2 }),
          `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(d / 2)}" fill="none" ${paint("stroke", on ? "#1f2842" : "#ffffffb0")} stroke-width="0.025"/>`,
          `<rect x="${n(cx - 0.012)}" y="${n(cy - d / 2 - 0.045)}" width="0.024" height="${n(d * 0.62)}" ${paint("fill", on ? "#1f2842" : "#ffffffb0")}/>`,
        );
        break;
      }
      case "eye":
        // open (a pill with a pupil) when the block shows, shut (a dark pill
        // with a lid line) when it is hidden
        if (faded) {
          out.push(
            rect(r, { fill: "#0000004d", line: "#ffffff66", lineWidth: 0.015, radius: r.h / 2 }),
            `<rect x="${n(r.x + r.w * 0.18)}" y="${n(r.y + r.h / 2 - 0.012)}" width="${n(r.w * 0.64)}" height="0.024" ${paint("fill", "#ffffffb0")}/>`,
          );
        } else {
          out.push(
            rect(r, { fill: "#ffffffe6", line: "#00000040", lineWidth: 0.015, radius: r.h / 2 }),
            `<circle cx="${n(r.x + r.w / 2)}" cy="${n(r.y + r.h / 2)}" r="${n((r.h * 0.46) / 2)}" fill="#1f2842"/>`,
          );
        }
        break;
      case "caption": // a label for people, on its own line above the block
        out.push(text(r, p.text, "#ffffffc0", 16));
        break;
      // the chip that shows the fields a partly exposed block leaves out
      case "more":
        out.push(rect(r, { fill: "#ffffff1f", line: "#ffffff55", lineWidth: 0.015 }), text(r, p.text, "#ffffffd0", 16));
        break;
      case "fold": // the - / + button
        out.push(rect(r, { fill: "#ffffff2e", line: "#ffffff55", lineWidth: 0.015 }), text(r, p.text, "#ffffff"));
        break;
      default: // a field or a flag: a white chip
        out.push(rect(r, { fill: "#fffffff0", line: "#00000040" }), text(r, p.text, "#1f2842"));
    }
  }
}

/**
 * The program as an SVG document (a string): the blocks laid out as the editor
 * lays them out, drawn on a panel, in a picture as big as what is drawn with a
 * margin around it. An empty program is a picture that says "(no blocks)".
 *
 * @param program The blocks to draw.
 * @param o How to draw them (see `SvgOptions`).
 */
export function programToSvg(program: Program, o: SvgOptions): string {
  const scale = o.scale ?? 80;
  const layout = layoutProgram(program, { x: 0, y: 0, width: o.width ?? WORK_WIDTH, measure: o.measure, mode: o.mode });
  const body: string[] = [];
  for (const s of layout.stacks) {
    body.push(rect(s.button, { fill: "#ffffff2e", line: "#ffffff55", lineWidth: 0.015 }), text(s.button, s.collapsed ? "+" : "−", "#ffffff"));
    const label = { x: s.header.x + s.button.w + 0.08, y: s.header.y, w: s.header.w - s.button.w - 0.08, h: s.header.h };
    body.push(text(label, s.label, "#ffffff90", 15));
    if (s.strip) body.push(rect(s.strip, { fill: "#00000040", line: "#ffffff30" }), text(s.strip, "...", "#ffffffb0"));
  }
  for (const b of layout.blocks) drawBlock(b, body);

  // the picture is as big as what is drawn, with a margin
  const rects = [...layout.blocks.map((b) => b.bounds), ...layout.stacks.flatMap((s) => [s.header, ...(s.strip ? [s.strip] : [])])];
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  if (rects.length) {
    x0 = Math.min(...rects.map((r) => r.x));
    y0 = Math.min(...rects.map((r) => r.y));
    x1 = Math.max(...rects.map((r) => r.x + r.w));
    y1 = Math.max(layout.bottom, ...rects.map((r) => r.y + r.h));
  } else {
    x1 = 2.4;
    y1 = 0.6;
    body.push(`<text x="1.2" y="0.3" text-anchor="middle" dominant-baseline="central" font-size="${TEXT}" fill="#ffffff90">(no blocks)</text>`);
  }
  const vx = x0 - PAD;
  const vy = y0 - PAD;
  const vw = x1 - x0 + 2 * PAD;
  const vh = y1 - y0 + 2 * PAD;
  const title = o.title ?? "A program made of blocks";
  const panel = o.background === false ? "" : `<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" rx="0.15" fill="${o.background ?? "#1b2440"}"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" width="${Math.round(vw * scale)}" height="${Math.round(vh * scale)}" role="img" font-family="${FONT}">`,
    `<title>${esc(title)}</title>`,
    panel,
    ...body,
    `</svg>`,
  ]
    .filter(Boolean)
    .join("\n");
}
