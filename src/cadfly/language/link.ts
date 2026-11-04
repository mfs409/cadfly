import { parseProject, serializeProject } from "./format";
import type { Program } from "./types";

/**
 * A program in a web address, so a page can hand one to the app or the viewer:
 * `...#p=<value>`. The value is the program's file text, deflated and written
 * in base64url. It goes after the `#` (the part of an address a server never
 * sees), so its length is a matter for the browser only. Every built-in example
 * is under 800 characters this way. A value that starts with `{` is taken as
 * the file text itself, for a short program written by hand. Files (STL
 * imports) are not carried.
 */

/** The name of the value in the address's hash: `#p=...` */
const KEY = "p";
/**
 * The most a link may unpack to: a bigger one is refused before it is read all
 * the way (it may be a decompression bomb)
 */
const MAX_UNPACKED = 4_000_000;

/**
 * Everything a stream gives. Throws an Error once it has given more than
 * `limit` bytes, and stops reading it.
 */
async function collect(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      void reader.cancel();
      throw new Error("the link holds too much data");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/**
 * Run bytes through a (de)compression stream, and give what comes out (at most
 * `limit` bytes: see `collect`)
 */
function through(bytes: Uint8Array, transform: CompressionStream | DecompressionStream, limit: number) {
  return collect(new Blob([bytes as BlobPart]).stream().pipeThrough(transform as unknown as TransformStream<Uint8Array, Uint8Array>), limit);
}

/** The bytes as base64url: base64 with - and _, and no = at the end */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What is said of a link that cannot be unpacked */
const DAMAGED = "the link is damaged or incomplete: it does not unpack to a program (was it cut short when it was copied?)";

/**
 * The bytes that base64url text stands for. Throws an Error that says the link
 * is not a program, or is damaged or incomplete, if the text cannot be read.
 */
function fromBase64Url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("the link is not a program (it has characters a link of ours never has)");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(DAMAGED);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * The value of a link for this program: its file text, deflated, as base64url
 * (put it after `#p=` in an address)
 */
export async function encodeLink(program: Program): Promise<string> {
  const text = JSON.stringify(JSON.parse(serializeProject(program))); // the file's text, without the indentation
  return toBase64Url(await through(new TextEncoder().encode(text), new CompressionStream("deflate-raw"), MAX_UNPACKED));
}

/**
 * The program a link's value holds: the text of a program file written out by
 * hand (it starts with `{`), or one that `encodeLink` made. Throws an Error
 * with a readable message if it is not one, or holds too much data.
 */
export async function decodeLink(value: string): Promise<Program> {
  const trimmed = value.trim();
  let text: string;
  if (trimmed.startsWith("{")) text = trimmed;
  else {
    const packed = fromBase64Url(trimmed);
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await through(packed, new DecompressionStream("deflate-raw"), MAX_UNPACKED));
    } catch (e) {
      if (/too much data/.test((e as Error).message)) throw e;
      throw new Error(DAMAGED);
    }
  }
  return parseProject(text).program;
}

/**
 * The value in a page address's hash (`location.hash`), if it has one: what
 * follows `#p=`, with a hand-written `{` that the browser or a chat program
 * wrote as %7B turned back. Undefined if the hash has no `p` value.
 */
export function linkValue(hash: string): string | undefined {
  const raw = hash.replace(/^#/, "");
  if (!raw.startsWith(`${KEY}=`)) return undefined;
  const value = raw.slice(KEY.length + 1);
  // a hand-written JSON value may be percent-encoded by the browser or a chat
  // program
  try {
    return value.startsWith("%7B") || value.startsWith("%7b") ? decodeURIComponent(value) : value;
  } catch {
    return value;
  }
}
