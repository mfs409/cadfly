import { describe, expect, test } from "vitest";
import { DEMOS } from "../src/cadfly/language/demos";
import { decodeLink, encodeLink, linkValue } from "../src/cadfly/language/link";
import type { Program } from "../src/cadfly/language/types";

// A program carried in a page address: every example survives the trip, it stays short, and a bad link says so plainly
describe("links", () => {
  test.each(DEMOS.map((e) => [e.name, e.program] as const))("%s survives the round trip", async (_name, program) => {
    expect(await decodeLink(await encodeLink(program))).toEqual(program);
  });

  test("every example fits in a short link, and the value uses only address-safe characters", async () => {
    for (const e of DEMOS) {
      const value = await encodeLink(e.program);
      expect(value.length).toBeLessThan(1000);
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("the hash is #p= and the value comes back out of it", async () => {
    const program = DEMOS[0].program;
    const hash = `#p=${await encodeLink(program)}`;
    expect(hash.startsWith("#p=")).toBe(true);
    expect(await decodeLink(linkValue(hash)!)).toEqual(program);
    expect(linkValue("")).toBeUndefined();
    expect(linkValue("#other=1")).toBeUndefined();
  });

  test("a program written by hand as JSON works, even percent-encoded", async () => {
    const program: Program = [{ id: "a", kind: "box", args: { w: "10", d: "10", h: "10" } }];
    // the file text a link carries, as plain JSON
    const plain = new TextDecoder().decode(await inflate(await encodeLink(program)));
    expect(await decodeLink(plain)).toEqual(program);
    expect(await decodeLink(linkValue(`#p=${encodeURIComponent(plain)}`)!)).toEqual(program);
  });

  test("damaged, cut-short and unrelated links are refused with a readable message", async () => {
    const value = await encodeLink(DEMOS[0].program);
    await expect(decodeLink(value.slice(0, 20))).rejects.toThrow(/damaged or incomplete/);
    await expect(decodeLink("not a link!")).rejects.toThrow(/not a program/);
    await expect(decodeLink("{}")).rejects.toThrow(/not a block program/);
    await expect(decodeLink("")).rejects.toThrow();
  });

  test("a link that unpacks to something huge is refused", async () => {
    const bomb = new Uint8Array(5_000_000).fill(32);
    const packed = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    let binary = "";
    for (const b of packed) binary += String.fromCharCode(b);
    const value = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expect(decodeLink(value)).rejects.toThrow(/too much data/);
  });
});

/** The file text inside a link's value, for the test that needs to see it */
async function inflate(value: string): Promise<Uint8Array> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}
