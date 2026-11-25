/**
 * Draws block programs as SVG with the layout of the editor, measuring text with the Arimo font so that the widths do not depend on a browser.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import opentype from "opentype.js";
import { parseProject } from "../../src/cadfly/language/format";
import type { Program } from "../../src/cadfly/language/types";
import { TEXT, type SvgOptions, programToSvg } from "../../src/cadfly/ui/svg";

/** The font the text is measured with. */
const FONT_FILE = path.join(__dirname, "..", "..", "src", "cadfly", "assets", "Arimo-Regular.ttf");

/** A function that says how wide text is on screen, in metres, from the widths of its letters in Arimo */
export function arimoMeasure(): SvgOptions["measure"] {
  const bytes = fs.readFileSync(FONT_FILE);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const memo = new Map<string, number>();
  return (text) => {
    let w = memo.get(text);
    if (w === undefined) {
      w = [...text].reduce((sum, ch) => sum + (font.charToGlyph(ch).advanceWidth ?? 0), 0) / font.unitsPerEm * TEXT;
      memo.set(text, w);
    }
    return w;
  };
}

/** The picture of a program */
export function renderProgram(program: Program, options: Omit<SvgOptions, "measure"> = {}): string {
  return programToSvg(program, { measure: arimoMeasure(), ...options });
}

/** The picture of what a project file holds (its text) */
export function renderProject(fileText: string, options: Omit<SvgOptions, "measure"> = {}): string {
  return renderProgram(parseProject(fileText).program, options);
}
