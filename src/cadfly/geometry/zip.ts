/**
 * A ZIP archive with the files stored as they are (not compressed): the least
 * that a person can open with any unzip program. STL files hardly compress, so
 * nothing is lost. Also the names to give the files in it.
 */

/** One file to put in an archive. */
export interface ZipEntry {
  /** The file's name, with no folders */
  name: string;
  /** What is in it */
  data: Uint8Array;
}

/** The most files one archive can hold (the format keeps the count in 16 bits). */
const MAX_ENTRIES = 0xffff;
/** The most bytes in one file, or in the whole archive (the format keeps sizes in 32 bits). */
const MAX_BYTES = 0xffffffff;

/** The CRC-32 of every byte value, worked out once */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * The CRC-32 checksum of some bytes, as ZIP files use it.
 *
 * @param data The bytes.
 */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Make a ZIP archive of files, each stored without compression. Every file is
 * dated 1 January 1980, so the same files always give the same archive.
 * Throws an Error if there are more than 65535 files, or a file or the archive
 * is over 4 GB.
 *
 * @param entries The files, in order.
 */
export function writeZip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length > MAX_ENTRIES) throw new Error(`a zip file holds at most ${MAX_ENTRIES} files`);
  const names = entries.map((e) => new TextEncoder().encode(e.name));
  let size = 22;
  entries.forEach((e, i) => {
    if (e.data.length > MAX_BYTES) throw new Error(`${e.name} is too big for a zip file`);
    size += 30 + names[i].length + e.data.length + 46 + names[i].length;
  });
  if (size > MAX_BYTES) throw new Error("the files are too big for one zip file");
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let at = 0;
  /** Write a 2-byte number at the current place, little-endian, and move on. */
  const u16 = (v: number) => {
    view.setUint16(at, v, true);
    at += 2;
  };
  /** Write a 4-byte number at the current place, little-endian, and move on. */
  const u32 = (v: number) => {
    view.setUint32(at, v, true);
    at += 4;
  };
  const offsets: number[] = [];
  entries.forEach((e, i) => {
    offsets.push(at);
    u32(0x04034b50); // a file's header
    u16(20); // needs version 2.0 to open
    u16(0x0800); // the name is UTF-8
    u16(0); // stored
    u16(0); // time
    u16(0x21); // date: 1980-01-01
    u32(crc32(e.data));
    u32(e.data.length); // compressed size
    u32(e.data.length); // size
    u16(names[i].length);
    u16(0); // no extra field
    out.set(names[i], at);
    at += names[i].length;
    out.set(e.data, at);
    at += e.data.length;
  });
  const directoryAt = at;
  entries.forEach((e, i) => {
    u32(0x02014b50); // the directory's entry for a file
    u16(20); // made by version 2.0
    u16(20);
    u16(0x0800);
    u16(0);
    u16(0);
    u16(0x21);
    u32(crc32(e.data));
    u32(e.data.length);
    u32(e.data.length);
    u16(names[i].length);
    u16(0); // extra field
    u16(0); // comment
    u16(0); // disk
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[i]);
    out.set(names[i], at);
    at += names[i].length;
  });
  const directorySize = at - directoryAt;
  u32(0x06054b50); // the end of the directory
  u16(0); // this disk
  u16(0); // the disk with the directory
  u16(entries.length);
  u16(entries.length);
  u32(directorySize);
  u32(directoryAt);
  u16(0); // no comment
  return out;
}

/**
 * File names for parts, made from what the parts are called: safe to use on any
 * computer (letters, digits, `-`, `_` and spaces only; nothing else, and not
 * empty), different from one another even when the names are the same or differ
 * only in capitals, and ending in `extension`.
 *
 * @param names What each part is called, in order.
 * @param extension The ending to give each file, with its dot (".stl").
 */
export function partFileNames(names: string[], extension: string): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = name.replace(/[^A-Za-z0-9 _-]+/g, "_").slice(0, 60).trim() || "part";
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}`;
    used.add(candidate.toLowerCase());
    return candidate + extension;
  });
}
