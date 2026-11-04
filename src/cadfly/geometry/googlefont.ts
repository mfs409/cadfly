/**
 * Which Google font a person means. They may paste what they have: a name
 * ("Pacifico", "Open Sans 700"), the address of the font's page
 * (fonts.google.com/specimen/Open+Sans), or the address Google gives for using
 * it on a web page (fonts.googleapis.com/css2?family=Open+Sans:wght@700).
 *
 * Getting the font is in two parts. This file works out which font is meant
 * (`parseGoogleFont`) and which of a family's files is closest to what was
 * asked for (`parseFaces`, `chooseFace`). `fonts.ts` fetches the files from the
 * google/fonts repository and registers the font.
 */

/** Why a Google font cannot be used, in words a person can act on */
export class GoogleFontError extends Error {}

/** Which font is meant: a family, in one weight, upright or italic */
export interface GoogleFont {
  /** The family's name, as Google writes it, such as "Open Sans" */
  family: string;

  /** 100 (thin) to 900 (black), a multiple of 100; 400 is normal */
  weight: number;

  /** Is the font italic? */
  italic: boolean;
}

/**
 * Where a font is looked for: Google keeps its fonts in the google/fonts
 * repository, in one folder per license
 */
export const GOOGLE_FONT_FOLDERS = ["ofl", "apache", "ufl"] as const;

/**
 * The folder name for a family: lower case, letters and digits only ("Open
 * Sans" is opensans)
 */
export function googleFolderName(family: string): string {
  return family.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The id a font is registered under, so the same font asked for in different
 * ways is loaded once
 */
export function googleFontId(f: GoogleFont): string {
  return `google:${f.family.toLowerCase()}:${f.weight}${f.italic ? "i" : ""}`;
}

/**
 * Read what was typed into a block's font field.
 *
 * It takes a name, optionally ending in a weight (a number, or a word such as
 * bold) and the word italic; or an address at fonts.google.com (a font's page:
 * it has /specimen/ in it, and may say a weight) or at fonts.googleapis.com
 * (the address for using a font on a web page: its first family, its first
 * weight, and whether it asks for italic). Only https addresses are used.
 *
 * Throws a GoogleFontError saying what to type instead.
 */
export function parseGoogleFont(input: string): GoogleFont {
  const text = input.trim();
  const fail = (): never => {
    throw new GoogleFontError(`I do not know which Google font "${text.slice(0, 60)}" is: type its name (Pacifico, Open Sans 700) or paste its address from fonts.google.com`);
  };
  let family = "";
  let weight = 400;
  let italic = false;
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return fail();
    }
    if (url.protocol !== "https:") throw new GoogleFontError("only https addresses are used");
    const host = url.hostname.toLowerCase();
    if (host === "fonts.googleapis.com") {
      const spec = url.searchParams.get("family") ?? ""; // Open Sans:wght@700  or  Open Sans:ital,wght@1,700
      const [name, axes = ""] = spec.split(":");
      family = name;
      const m = /(?:^|[;,])(?:\d,)?(\d{3})(?=$|[;,])/.exec(axes.split("@")[1] ?? "");
      if (m) weight = Number(m[1]);
      italic = /ital@1|ital,wght@1,/.test(axes);
    } else if (host === "fonts.google.com") {
      const m = /\/specimen\/([^/?#]+)/.exec(url.pathname);
      if (!m) throw new GoogleFontError("that is not the page of one font: open the font on fonts.google.com and paste that address (it has /specimen/ in it)");
      try {
        family = decodeURIComponent(m[1]);
      } catch {
        return fail(); // a % that is not followed by a code
      }
      const w = url.searchParams.get("preview.weight") ?? url.searchParams.get("weight");
      if (w && /^\d{3}$/.test(w)) weight = Number(w);
    } else {
      throw new GoogleFontError(`only addresses at fonts.google.com or fonts.googleapis.com are used (not ${host})`);
    }
    family = family.replace(/\+/g, " ").trim();
  } else {
    // a name, perhaps with a weight (700, bold) and italic on the end
    let rest = text.replace(/\s+/g, " ");
    for (let again = true; again; ) {
      again = false;
      const m = /\s(\d{3}|thin|extralight|light|regular|medium|semibold|bold|extrabold|black|italic)$/i.exec(rest);
      if (m && rest.length > m[0].length) {
        const word = m[1].toLowerCase();
        if (word === "italic") italic = true;
        else weight = /^\d/.test(word) ? Number(word) : { thin: 100, extralight: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 }[word]!;
        rest = rest.slice(0, -m[0].length);
        again = true;
      }
    }
    family = rest;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ]{0,60}$/.test(family)) return fail();
  if (!(weight >= 100 && weight <= 900)) throw new GoogleFontError("a weight is from 100 (thin) to 900 (black)");
  return { family, weight: Math.round(weight / 100) * 100, italic };
}

/** One font file the family offers, from its METADATA.pb */
export interface GoogleFace {
  /** "normal" or "italic" */
  style: string;
  /**
   * The weight the file is drawn at (a variable font's one file gives its
   * default)
   */
  weight: number;
  /** The file's name, in the family's folder */
  filename: string;
}

/**
 * The faces listed in a family's METADATA.pb (a text file of `fonts { name: ...
 * style: ... weight: ... filename: ... }` blocks). A block with a part missing,
 * or a file name that is not a plain .ttf or .otf name (nothing with a / in it,
 * which could point somewhere else), is left out.
 */
export function parseFaces(metadata: string): GoogleFace[] {
  const faces: GoogleFace[] = [];
  for (const block of metadata.split(/^fonts \{/m).slice(1)) {
    const style = /style:\s*"([^"]*)"/.exec(block)?.[1];
    const weight = /weight:\s*(\d+)/.exec(block)?.[1];
    const filename = /filename:\s*"([^"]*)"/.exec(block)?.[1];
    if (style && weight && filename && /^[\w\- .[\],]+\.(ttf|otf)$/i.test(filename)) faces.push({ style, weight: Number(weight), filename });
  }
  return faces;
}

/**
 * The file that is closest to what was asked for: the right style first (any
 * style if the family has none of it), then the nearest weight. Of two equally
 * near, the one listed first. Undefined if the family lists no files.
 */
export function chooseFace(faces: GoogleFace[], want: GoogleFont): GoogleFace | undefined {
  const style = want.italic ? "italic" : "normal";
  const same = faces.filter((f) => f.style === style);
  const pool = same.length ? same : faces;
  return [...pool].sort((a, b) => Math.abs(a.weight - want.weight) - Math.abs(b.weight - want.weight))[0];
}
