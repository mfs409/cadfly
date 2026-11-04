import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { builtInFont, fontStatus, installGoogleFont, textShapes } from "../src/cadfly/geometry/fonts";
import { GoogleFontError, chooseFace, googleFontId, parseFaces, parseGoogleFont } from "../src/cadfly/geometry/googlefont";

describe("which Google font is meant", () => {
  test("a name, with or without a weight", () => {
    expect(parseGoogleFont("Pacifico")).toEqual({ family: "Pacifico", weight: 400, italic: false });
    expect(parseGoogleFont("  open   sans 700 ")).toEqual({ family: "open sans", weight: 700, italic: false });
    expect(parseGoogleFont("Roboto Bold Italic")).toEqual({ family: "Roboto", weight: 700, italic: true });
    expect(parseGoogleFont("Roboto Slab Light")).toEqual({ family: "Roboto Slab", weight: 300, italic: false });
  });
  test("the address of a font's page, or the address Google gives for using it", () => {
    expect(parseGoogleFont("https://fonts.google.com/specimen/Open+Sans")).toMatchObject({ family: "Open Sans", weight: 400 });
    expect(parseGoogleFont("https://fonts.googleapis.com/css2?family=Open+Sans:wght@700&display=swap")).toMatchObject({ family: "Open Sans", weight: 700 });
    expect(parseGoogleFont("https://fonts.googleapis.com/css2?family=Lato:ital,wght@1,300")).toMatchObject({ family: "Lato", weight: 300, italic: true });
    expect(parseGoogleFont("https://fonts.googleapis.com/css?family=Pacifico")).toMatchObject({ family: "Pacifico" });
  });
  test("an address that is not Google's, or not https, or not one font, is explained", () => {
    expect(() => parseGoogleFont("https://example.com/font.ttf")).toThrow(/only addresses at fonts.google.com/);
    expect(() => parseGoogleFont("http://fonts.google.com/specimen/Lato")).toThrow(/https/);
    expect(() => parseGoogleFont("https://fonts.google.com/?query=lato")).toThrow(/\/specimen\//);
    expect(() => parseGoogleFont("../../etc/passwd")).toThrow(GoogleFontError);
    expect(() => parseGoogleFont("")).toThrow(GoogleFontError);
  });
  test("the same font asked for in different ways has one id", () => {
    const a = googleFontId(parseGoogleFont("Open Sans 700"));
    expect(googleFontId(parseGoogleFont("https://fonts.googleapis.com/css2?family=Open+Sans:wght@700"))).toBe(a);
    expect(googleFontId(parseGoogleFont("open sans bold"))).toBe(a);
    expect(googleFontId(parseGoogleFont("Open Sans"))).not.toBe(a);
  });
});

const METADATA = `name: "Open Sans"
fonts {
  name: "Open Sans"
  style: "normal"
  weight: 400
  filename: "OpenSans[wdth,wght].ttf"
}
fonts {
  name: "Open Sans"
  style: "italic"
  weight: 400
  filename: "OpenSans-Italic[wdth,wght].ttf"
}
`;
const STATIC = `fonts {
  style: "normal"
  weight: 400
  filename: "Thing-Regular.ttf"
}
fonts {
  style: "normal"
  weight: 700
  filename: "Thing-Bold.ttf"
}
`;

describe("a family's files", () => {
  test("the faces are read from its METADATA.pb", () => {
    expect(parseFaces(METADATA)).toEqual([
      { style: "normal", weight: 400, filename: "OpenSans[wdth,wght].ttf" },
      { style: "italic", weight: 400, filename: "OpenSans-Italic[wdth,wght].ttf" },
    ]);
  });
  test("the nearest weight, in the style asked for", () => {
    const faces = parseFaces(STATIC);
    expect(chooseFace(faces, { family: "Thing", weight: 700, italic: false })?.filename).toBe("Thing-Bold.ttf");
    expect(chooseFace(faces, { family: "Thing", weight: 600, italic: false })?.filename).toBe("Thing-Bold.ttf");
    expect(chooseFace(faces, { family: "Thing", weight: 300, italic: false })?.filename).toBe("Thing-Regular.ttf");
    expect(chooseFace(parseFaces(METADATA), { family: "Open Sans", weight: 400, italic: true })?.filename).toBe("OpenSans-Italic[wdth,wght].ttf");
  });
  test("a file name that could point somewhere else is ignored", () => {
    expect(parseFaces('fonts {\n  style: "normal"\n  weight: 400\n  filename: "../../x.ttf"\n}')).toEqual([]);
  });
});

describe("fetching a Google font", () => {
  afterEach(() => vi.unstubAllGlobals());
  const font = readFileSync(new URL("../src/cadfly/assets/Arimo-Regular.ttf", import.meta.url));
  const bytes = () => font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength);
  const serve = (files: Record<string, string | ArrayBuffer>) => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      const hit = Object.entries(files).find(([end]) => url.endsWith(end));
      if (!hit) return new Response("", { status: 403 });
      return new Response(hit[1] as BodyInit, { status: 200 });
    });
    return asked;
  };

  test("the metadata and then the file are fetched from the font service, and the font then writes", async () => {
    const asked = serve({ "/ofl/thingone/METADATA.pb": STATIC, "/ofl/thingone/Thing-Bold.ttf": bytes() });
    await installGoogleFont("Thingone 700");
    expect(asked).toEqual([
      "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/thingone/METADATA.pb",
      "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/thingone/Thing-Bold.ttf",
    ]);
    const id = googleFontId(parseGoogleFont("Thingone 700"));
    const shapes = textShapes("Hi", 0, 0, 10, false, "Thingone 700");
    expect(shapes).toHaveLength(2);
    expect(shapes.every((s) => s.kind === "glyph")).toBe(true);
  });
  test("a family that is not there is said so, and the text block says it too", async () => {
    serve({});
    await installGoogleFont("No Such Family");
    expect(fontStatus(googleFontId(parseGoogleFont("No Such Family")))).toMatch(/no Google font called "No Such Family"/);
    expect(() => textShapes("Hi", 0, 0, 10, false, "No Such Family")).toThrow(/no Google font called/);
  });
  test("being offline is said so", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await installGoogleFont("Offline Family");
    expect(() => textShapes("Hi", 0, 0, 10, false, "Offline Family")).toThrow(/online/);
  });
  test("a file that is not a font is said so", async () => {
    serve({ "/ofl/notafont/METADATA.pb": STATIC, "/ofl/notafont/Thing-Regular.ttf": "this is text" });
    await installGoogleFont("NotAFont");
    expect(() => textShapes("Hi", 0, 0, 10, false, "NotAFont")).toThrow(/could not be read/);
  });
  test("until it is in, the text block says it is being fetched", () => {
    expect(() => textShapes("Hi", 0, 0, 10, false, "Never Asked For")).toThrow(/being fetched/);
  });
  test("a built-in font's name (in any case) is never looked up on Google", () => {
    const asked = serve({});
    expect(textShapes("Hi", 0, 0, 10, false, " Serif ").length).toBe(2);
    expect(builtInFont("BOLD")).toBe("bold");
    expect(builtInFont("Roboto")).toBeUndefined();
    expect(asked).toEqual([]);
  });
  test("an address that is not Google's is refused before anything is fetched", () => {
    const asked = serve({});
    expect(() => textShapes("Hi", 0, 0, 10, false, "https://example.com/a.ttf")).toThrow(/only addresses at fonts.google.com/);
    expect(asked).toEqual([]);
  });
});
test("an address with a broken % code is refused in plain words, not with a raw URIError", () => {
  expect(() => parseGoogleFont("https://fonts.google.com/specimen/%E0%A4%A")).toThrow(GoogleFontError);
});
