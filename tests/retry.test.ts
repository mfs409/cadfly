import { describe, expect, test } from "vitest";
import { generateWithRetry, isSamplerGlitch } from "../src/cadfly/assistant/retry";

const glitch = () => new Error("Grammar matcher rejected the newly sampled token.");

describe("retrying when the sampler glitches", () => {
  test("recognises the known errors and nothing else", () => {
    expect(isSamplerGlitch(glitch())).toBe(true);
    expect(isSamplerGlitch(new Error("Invalid token id 1739415078 for GrammarMatcher"))).toBe(true);
    expect(isSamplerGlitch(new Error("Unable to find a compatible GPU"))).toBe(false);
    expect(isSamplerGlitch(new DOMException("aborted", "AbortError"))).toBe(false);
  });

  test("a try that works is returned at once", async () => {
    const seen: boolean[] = [];
    expect(await generateWithRetry(async (c) => (seen.push(c), "ok"))).toBe("ok");
    expect(seen).toEqual([true]);
  });

  test("a glitch is tried again, with the grammar", async () => {
    let n = 0;
    const seen: boolean[] = [];
    const out = await generateWithRetry(async (c) => {
      seen.push(c);
      if (++n < 3) throw glitch();
      return "ok";
    });
    expect(out).toBe("ok");
    expect(seen).toEqual([true, true, true]);
  });

  test("after the grammar has failed every time, one try is made without it", async () => {
    const seen: boolean[] = [];
    const out = await generateWithRetry(async (c) => {
      seen.push(c);
      if (c) throw glitch();
      return "plain";
    });
    expect(out).toBe("plain");
    expect(seen).toEqual([true, true, true, false]);
  });

  test("if even that fails, the error is reported", async () => {
    await expect(generateWithRetry(async () => { throw glitch(); })).rejects.toThrow("Grammar matcher rejected");
  });

  test("other errors are not retried", async () => {
    let n = 0;
    await expect(generateWithRetry(async () => { n++; throw new Error("out of memory"); })).rejects.toThrow("out of memory");
    expect(n).toBe(1);
  });

  test("a stopped request is not retried", async () => {
    const ctl = new AbortController();
    let n = 0;
    await expect(generateWithRetry(async () => { n++; ctl.abort(); throw glitch(); }, { signal: ctl.signal })).rejects.toThrow();
    expect(n).toBe(1);
  });

  test("onRetry is told before each new try", async () => {
    const calls: [number, boolean][] = [];
    await generateWithRetry(async (c) => { if (c) throw glitch(); return "x"; }, { onRetry: (a, c) => void calls.push([a, c]) });
    expect(calls).toEqual([[1, true], [2, true], [3, false]]);
  });
});
