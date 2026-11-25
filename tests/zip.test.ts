import { describe, expect, test } from "vitest";
import { crc32, partFileNames, writeZip } from "../src/cadfly/geometry/zip";

/**
 * The zip archive that holds the parts of an export, and the names of the files
 * in it.
 */

const text = (s: string) => new TextEncoder().encode(s);

/**
 * A small independent reader of zip files that follows the format's
 * specification, to check what the writer made: it finds the directory from
 * the end of the file, and checks every file's checksum and size against it.
 */
function readZip(zip: Uint8Array): { name: string; data: Uint8Array }[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // the end record is the last 22 bytes (there is no comment)
  const end = zip.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  expect(v.getUint16(end + 8, true)).toBe(count);
  const directoryAt = v.getUint32(end + 16, true);
  expect(directoryAt + v.getUint32(end + 12, true)).toBe(end);
  const files: { name: string; data: Uint8Array }[] = [];
  let at = directoryAt;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    expect(v.getUint16(at + 10, true)).toBe(0); // stored
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    expect(v.getUint32(at + 20, true)).toBe(size);
    const nameLength = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    // the file's own header says the same
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint32(local + 14, true)).toBe(crc);
    expect(v.getUint32(local + 22, true)).toBe(size);
    expect(new TextDecoder().decode(zip.subarray(local + 30, local + 30 + v.getUint16(local + 26, true)))).toBe(name);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = zip.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    files.push({ name, data });
    at += 46 + nameLength + v.getUint16(at + 30, true) + v.getUint16(at + 32, true);
  }
  expect(at).toBe(end);
  return files;
}

describe("the checksum", () => {
  test("is the CRC-32 that zip files use (the standard check value, and nothing)", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe("a zip archive", () => {
  test("holds the files, in order, with their names and bytes, and reads back", () => {
    const zip = writeZip([
      { name: "a.stl", data: text("first") },
      { name: "b.stl", data: new Uint8Array([0, 255, 1, 254]) },
      { name: "empty.stl", data: new Uint8Array(0) },
    ]);
    const back = readZip(zip);
    expect(back.map((f) => f.name)).toEqual(["a.stl", "b.stl", "empty.stl"]);
    expect(new TextDecoder().decode(back[0].data)).toBe("first");
    expect([...back[1].data]).toEqual([0, 255, 1, 254]);
    expect(back[2].data.length).toBe(0);
  });

  test("an archive of no files is just the end record", () => {
    const zip = writeZip([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });

  test("names are kept as UTF-8, and the same files always make the same bytes", () => {
    const files = [{ name: "plaque é.stl", data: text("x") }];
    expect(readZip(writeZip(files))[0].name).toBe("plaque é.stl");
    expect(writeZip(files)).toEqual(writeZip(files));
  });

  test("starts with a file header, as every zip program expects", () => {
    expect([...writeZip([{ name: "a", data: text("x") }]).subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});

describe("the names of the files for parts", () => {
  test("end in the extension, and keep a plain name as it is", () => {
    expect(partFileNames(["plate", "lower block"], ".stl")).toEqual(["plate.stl", "lower block.stl"]);
  });

  test("the same name twice, or names that differ only in capitals, are told apart", () => {
    expect(partFileNames(["leg", "leg", "LEG", "leg-2"], ".stl")).toEqual(["leg.stl", "leg-2.stl", "LEG-3.stl", "leg-2-2.stl"]);
  });

  test("characters a computer may not allow in a file name are replaced, and nothing is left empty or hidden", () => {
    const [slashes, dots, nothing, long] = partFileNames(["a/b\\c:d", "..", "", "x".repeat(200)], ".stl");
    expect(slashes).toBe("a_b_c_d.stl");
    expect(dots).toBe("_.stl");
    expect(nothing).toBe("part.stl");
    expect(long.length).toBe(60 + 4);
    expect(new Set([slashes, dots, nothing, long]).size).toBe(4);
  });
});
