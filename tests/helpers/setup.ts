import { readFile } from "node:fs/promises";
import { installFonts } from "../src/cadfly/geometry/fonts";

// the text block's fonts, read from the app's assets
await installFonts(async (file) => {
  const buffer = await readFile(new URL(`../src/cadfly/assets/${file}`, import.meta.url));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
});
