// Draw a block program as an SVG picture, with the editor's own layout and its font (Arimo) to measure text:
//
//   npx tsx --tsconfig tsconfig.tests.json scripts/blocks-svg.ts <program> [out.svg] [--mode "Builder"] [--width 6.4] [--scale 80] [--no-background]
//
// <program> is a project file (.blocks.json, what Save writes), or a link's value (what follows #p= in a link, or the whole #p=... hash).
// With no out.svg the SVG is written to the standard output. A book's build can call `renderProject` or `svgForText` instead.
import * as fs from "node:fs";
import * as path from "node:path";
import opentype from "opentype.js";
import { UI_MODES, modeByName } from "../src/cadfly/language/modes";
import { decodeLink, linkValue } from "../src/cadfly/language/link";
import { parseProject } from "../src/cadfly/language/format";
import { TEXT, type SvgOptions, programToSvg } from "../src/cadfly/language/svg";
import type { Program } from "../src/cadfly/language/types";

const FONT_FILE = path.join(__dirname, "..", "src", "cadfly", "assets", "Arimo-Regular.ttf");

/** A function that says how wide text is in the editor, in metres, from the widths of its letters in Arimo */
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

/** The picture of what a link holds: the value after `#p=`, or the whole hash */
export async function renderLink(link: string, options: Omit<SvgOptions, "measure"> = {}): Promise<string> {
  return renderProgram(await decodeLink(linkValue(link.startsWith("#") ? link : `#p=${link}`) ?? ""), options);
}

async function main(argv: string[]) {
  const flag = (name: string) => argv.includes(`--${name}`);
  const option = (name: string) => (flag(name) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
  const taken = new Set(["--mode", "--width", "--scale"].flatMap((f) => (argv.includes(f) ? [argv.indexOf(f), argv.indexOf(f) + 1] : [])));
  const positional = argv.filter((a, i) => !a.startsWith("--") && !taken.has(i));
  if (!positional.length) {
    console.error('usage: blocks-svg.ts <program: file or link> [out.svg] [--mode "Builder"] [--width 6.4] [--scale 80] [--no-background]');
    process.exitCode = 2;
    return;
  }
  const modeName = option("mode");
  const mode = modeName === undefined ? undefined : modeByName(modeName);
  if (modeName !== undefined && !mode) throw new Error(`no mode called "${modeName}" (the modes are ${UI_MODES.map(([n]) => n).join(", ")})`);
  const options: Omit<SvgOptions, "measure"> = {
    mode,
    ...(option("width") ? { width: Number(option("width")) } : {}),
    ...(option("scale") ? { scale: Number(option("scale")) } : {}),
    ...(flag("no-background") ? { background: false as const } : {}),
  };
  const [input, out] = positional;
  const svg = fs.existsSync(input) ? renderProject(fs.readFileSync(input, "utf8"), options) : await renderLink(input, options);
  if (out) fs.writeFileSync(out, svg + "\n");
  else process.stdout.write(svg + "\n");
}

if (typeof require !== "undefined" && require.main === module) {
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
