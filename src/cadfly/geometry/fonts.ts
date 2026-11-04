import opentype, { type Font } from "opentype.js";
import type { Vec2 } from "./kernel";
import { GOOGLE_FONT_FOLDERS, GoogleFontError, type GoogleFace, type GoogleFont, chooseFace, googleFolderName, googleFontId, parseFaces, parseGoogleFont } from "./googlefont";
import type { SketchShape } from "./sketch";

/**
 * Fonts: text drawn as flat shapes, and the loading of the fonts it is drawn
 * with.
 *
 * `textShapes` turns words into shapes, in any font. The fonts come from files
 * (an `Outliner` reads each letter's outlines out of a font file): the four that
 * come with the app are read from its assets (`installFonts`), and a Google
 * font is fetched over the internet when a block asks for one
 * (`installGoogleFont`). Loading takes time but `textShapes` cannot wait, so
 * each font is entered in a registry when it arrives, with a status while it is
 * on its way or if it failed. A block that asks for a font that is not there
 * yet gets an error that says so, and is built again when the font arrives.
 */

/**
 * The most characters a text block may have. It is a plain limit, to keep one
 * block from making an enormous number of shapes.
 */
const MAX_TEXT_LENGTH = 40;

/** Why some text cannot be drawn, in words a person can act on */
export class FontError extends Error {}

/**
 * What a font from a file gives: for each letter of the text, its outlines (a
 * letter like O has two), measured in the same units as `size`, with the
 * baseline at v = 0 and the left of the first letter's ink at u = 0. `size` is
 * how tall a capital letter is.
 */
type Outliner = (text: string, size: number) => Vec2[][][];

/** The fonts that are ready to use, by font id (see `googleFontId`) */
const outliners = new Map<string, Outliner>();

/** For a font that is being fetched, or could not be: "loading", or why not */
const statuses = new Map<string, string>();

/** Make a font ready to use, and forget that it was ever loading or failed */
function registerFont(id: string, outliner: Outliner) {
  outliners.set(id, outliner);
  statuses.delete(id);
}

/** Note that a font is being fetched ("loading"), or why it could not be */
function setFontStatus(id: string, status: string) {
  statuses.set(id, status);
}

/**
 * What is known of a font that is not ready: undefined if nothing (it was never
 * asked for), "loading", or why it failed
 */
export function fontStatus(id: string): string | undefined {
  return statuses.get(id);
}

/** The built-in fonts a text block can use (any other name is a Google font) */
export const FONT_NAMES = ["sans", "bold", "serif", "mono"] as const;

/** The type of a font name */
export type FontName = (typeof FONT_NAMES)[number];

/**
 * The shapes that write `text` with the middle of it (halfway along, and
 * halfway up a capital letter) at (u, v). Each letter is one shape, so letters
 * that touch are joined.
 *
 * Throws a FontError, saying why, for a size that is not above 0, text of more
 * than 40 characters, text with no letter in it (a space draws nothing), a
 * character the font has no letter for, or a font that is not ready. A Google
 * font that has not arrived yet is one of those: the error says it is being
 * fetched, and the caller builds again when it is in.
 *
 * @param text What to write.
 * @param u Where the middle of the text goes, across.
 * @param v Where the middle of the text goes, up.
 * @param size How tall a capital letter is.
 * @param hole Mark the shapes as holes, to cut the text out of other shapes
 *             (engraving) instead of adding it.
 * @param font A built-in font (any case), or the name of a Google font, or its
 *             address (see `parseGoogleFont`).
 */
export function textShapes(text: string, u: number, v: number, size: number, hole = false, font = "sans"): SketchShape[] {
  if (!(size > 0)) throw new FontError("the size must be more than 0");
  if (text.length > MAX_TEXT_LENGTH) throw new FontError(`the text is longer than ${MAX_TEXT_LENGTH} characters`);
  const which = builtInFont(font);
  // a built-in font, or else a Google font, named or given by its address
  let id: string = which ?? "";
  if (!which) {
    try {
      id = googleFontId(parseGoogleFont(font));
    } catch (e) {
      if (e instanceof GoogleFontError) throw new FontError(e.message);
      throw e;
    }
  }
  const outline = outliners.get(id);
  if (!outline) {
    const status = fontStatus(id);
    if (status && status !== "loading") throw new FontError(status);
    throw new FontError(which ? `the ${which} font is not available yet (it is still loading)` : `the font "${font.trim()}" is being fetched from Google: it will appear in a moment (it needs the internet)`);
  }
  const letters = outline(text, size).filter((contours) => contours.length);
  if (!letters.length) throw new FontError("write at least one letter (a space draws nothing)");
  const width = Math.max(...letters.flat(2).map((p) => p[0]));
  return letters.map((contours) => ({ kind: "glyph", contours: contours.map((c) => c.map(([x, y]): Vec2 => [x + u - width / 2, y + v - size / 2])), ...(hole ? { hole: true as const } : {}) }));
}

/**
 * Which of the built-in fonts a font field names (any case), if it does:
 * otherwise it names a Google font
 */
export function builtInFont(font: string): FontName | undefined {
  const name = font.trim().toLowerCase();
  return (FONT_NAMES as readonly string[]).includes(name) ? (name as FontName) : undefined;
}

/**
 * The font files, by the name a text block uses (DejaVu's are in the assets
 * with their license; Arimo is the editor's own font)
 */
const FONT_FILES: Record<string, string> = {
  sans: "Arimo-Regular.ttf",
  bold: "DejaVuSans-Bold.ttf",
  serif: "DejaVuSerif.ttf",
  mono: "DejaVuSansMono.ttf",
};

/** A curve in a letter is drawn as this many straight pieces */
const CURVE_STEPS = 8;

/**
 * Turn a parsed font into a function that outlines text (see `Outliner`).
 *
 * Each letter is placed after the one before, using the font's own widths and
 * its kerning (the pairs that sit closer or further apart, as in "AV"). The
 * font's own substitution rules, such as ligatures, are not used. Its curves
 * are cut into straight pieces. The size is the height of a capital letter,
 * which is measured from the font's "H".
 *
 * The outliner throws a FontError if the text has a character that the font
 * has no letter for (a space is always fine).
 *
 * @param font The parsed font.
 * @param weight For a variable font, the weight to draw it at (clamped to what
 *               the font can do). Ignored for a font that is not variable.
 */
function outliner(font: Font, weight?: number) {
  // a variable font is set to the weight asked for (clamped to what it can do)
  const wght = font.tables.fvar?.axes.find((a) => a.tag === "wght");
  const coords = wght && weight ? { wght: Math.min(wght.maxValue, Math.max(wght.minValue, weight)) } : undefined;
  if (coords) font.variation?.set(coords);
  // the size that makes a capital letter as tall as asked: measure an H
  const em = font.unitsPerEm;
  const capHeight = Math.max(...font.charToGlyph("H").getPath(0, 0, em, {}, font).commands.map((c) => (c.y !== undefined ? -c.y : 0)));
  return (text: string, size: number): Vec2[][][] => {
    for (const ch of text) {
      if (ch !== " " && font.charToGlyphIndex(ch) === 0) throw new FontError(`this font has no letter "${ch}"`);
    }
    // each letter is laid out here, after the one before (the font's own
    // substitution rules, such as ligatures, are not used)
    const fontSize = (size * em) / capHeight;
    let pen = 0;
    let before: ReturnType<Font["charToGlyph"]> | undefined;
    const paths = [...text].map((ch) => {
      const glyph = font.charToGlyph(ch);
      if (before) pen += (font.getKerningValue(before, glyph) * fontSize) / em;
      const path = glyph.getPath(pen, 0, fontSize, {}, font);
      pen += (((coords && font.variation ? font.variation.getTransform(glyph, coords).advanceWidth : glyph.advanceWidth) ?? 0) * fontSize) / em;
      before = glyph;
      return path;
    });
    const letters = paths.map((path) => {
      const contours: Vec2[][] = [];
      let current: Vec2[] = [];
      /** Where the pen is, in the font's own coordinates (y points down) */
      let last: Vec2 = [0, 0];
      /**
       * Move the pen to (x, y) in the font's coordinates, and add the point to
       * the outline, with y pointing up
       */
      function add(x: number, y: number) {
        last = [x, y];
        current.push([x, -y]);
      }
      for (const c of path.commands) {
        if (c.type === "M") {
          if (current.length) contours.push(current);
          current = [];
          add(c.x!, c.y!);
        } else if (c.type === "L") add(c.x!, c.y!);
        else if (c.type === "Q" || c.type === "C") {
          const [x0, y0] = last;
          for (let i = 1; i <= CURVE_STEPS; i++) {
            const t = i / CURVE_STEPS;
            const m = 1 - t;
            if (c.type === "Q") add(m * m * x0 + 2 * m * t * c.x1! + t * t * c.x!, m * m * y0 + 2 * m * t * c.y1! + t * t * c.y!);
            else add(m * m * m * x0 + 3 * m * m * t * c.x1! + 3 * m * t * t * c.x2! + t * t * t * c.x!, m * m * m * y0 + 3 * m * m * t * c.y1! + 3 * m * t * t * c.y2! + t * t * t * c.y!);
          }
        } else if (c.type === "Z") {
          if (current.length) contours.push(current);
          current = [];
        }
      }
      if (current.length) contours.push(current);
      // a closed outline ends where it began: say that point once; and drop
      // points that repeat the one before
      return contours.map((ring) => ring.filter((p, i) => Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]) > 1e-6)).filter((ring) => ring.length >= 3);
    });
    // the left of the first letter's ink goes at u = 0 (see `Outliner`)
    const left = Math.min(...letters.flat(2).map((p) => p[0]));
    return Number.isFinite(left) ? letters.map((contours) => contours.map((ring) => ring.map(([x, y]): Vec2 => [x - left, y]))) : letters;
  };
}

/** Parse a font file and make it available to text blocks under `name` */
function installFont(name: string, data: ArrayBuffer) {
  registerFont(name, outliner(opentype.parse(data)));
}

/**
 * Read every font file with `read` (a fetch in the app, a file read in tests)
 * and install it; a font that cannot be read is left out, and a text block that
 * asks for it says so. The files are read at the same time.
 *
 * @param read Gives the bytes of a file in the assets, by its name.
 */
export async function installFonts(read: (file: string) => Promise<ArrayBuffer>): Promise<void> {
  await Promise.all(
    Object.entries(FONT_FILES).map(async ([name, file]) => {
      try {
        installFont(name, await read(file));
      } catch {
        // that font is not offered: a text block that asks for it says so
      }
    }),
  );
}

/** Fonts bigger than this are not fetched */
const MAX_FONT_BYTES = 5_000_000;

/**
 * Google's fonts are in this repository; this service sends them with the
 * headers a web page needs to use them
 */
const FONT_SERVER = "https://cdn.jsdelivr.net/gh/google/fonts@main";

/**
 * Fetch a file from the font service. Gives undefined if it is not there (the
 * service answers 404, or 403 for a file that is not there). Throws a
 * GoogleFontError if the service cannot be reached or answers with anything
 * else that is not a success.
 */
async function get(url: string): Promise<Response | undefined> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new GoogleFontError("could not reach the font service (are you online?)");
  }
  if (response.status === 404 || response.status === 403) return undefined; // the font service answers 403 for a file that is not there
  if (!response.ok) throw new GoogleFontError(`the font service answered ${response.status}`);
  return response;
}

/**
 * Fetch a Google font, given what a person typed, and make it available to text
 * blocks, under the id `googleFontId` gives for the same text. It looks for the
 * family's METADATA.pb in each license folder, picks the file closest to the
 * weight and style asked for, and reads it.
 *
 * It does not throw. While it works the font's status is "loading"; if it
 * fails, the status says why (no such font, no internet, a file that is too
 * big, a file that cannot be read), and the text block shows that. If the text
 * does not name a font at all, there is nothing to record: `textShapes` says
 * what is wrong with it itself.
 *
 * @param input A font name, or the address of a font on fonts.google.com or
 *              fonts.googleapis.com (see `parseGoogleFont`).
 */
export async function installGoogleFont(input: string): Promise<void> {
  /** Known once the text has been read as a font */
  let id: string | undefined;
  try {
    const want: GoogleFont = parseGoogleFont(input);
    id = googleFontId(want);
    setFontStatus(id, "loading");
    let faces: GoogleFace[] | undefined;
    let folder = "";
    for (const f of GOOGLE_FONT_FOLDERS) {
      const meta = await get(`${FONT_SERVER}/${f}/${googleFolderName(want.family)}/METADATA.pb`);
      if (meta) {
        faces = parseFaces(await meta.text());
        folder = f;
        break;
      }
    }
    if (!faces) throw new GoogleFontError(`there is no Google font called "${want.family}" (check the spelling on fonts.google.com)`);
    const face = chooseFace(faces, want);
    if (!face) throw new GoogleFontError(`"${want.family}" has no font files this app can read`);
    const file = await get(`${FONT_SERVER}/${folder}/${googleFolderName(want.family)}/${encodeURIComponent(face.filename)}`);
    if (!file) throw new GoogleFontError(`the file for "${want.family}" is missing from the font service`);
    const data = await file.arrayBuffer();
    if (data.byteLength > MAX_FONT_BYTES) throw new GoogleFontError(`the font file is too big (${Math.round(data.byteLength / 1e6)} MB)`);
    // a fixed-weight file is the weight it is; a variable one is set to the
    // weight asked for
    registerFont(id, outliner(opentype.parse(data), want.weight));
  } catch (e) {
    if (id) setFontStatus(id, e instanceof GoogleFontError || e instanceof FontError ? e.message : `the font could not be read (${(e as Error).message})`);
  }
}
