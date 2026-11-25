import { afterEach, describe, expect, test, vi } from "vitest";
import { LOAD_TIMEOUT_MS, LoadError, MAX_PROJECT_TEXT_BYTES, fetchProjectText } from "../src/cadfly/fetchProject";
import { parseProject, serializeProject } from "../src/cadfly/language/format";
import { createEmptyProgram } from "../src/cadfly/language/program";

/**
 * Getting a project's text from a web address, against a fake `fetch`: the
 * request, the limits and the messages.
 */

const URL_OK = new URL("https://example.com/books/bracket.cadfly");

afterEach(() => vi.useRealTimers());

/** A `fetch` that answers with this response and remembers how it was asked. */
function answering(res: Response | (() => Response)) {
  const asked: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    asked.push({ url, init });
    return typeof res === "function" ? res() : res;
  }) as unknown as typeof fetch; // cast: a stand-in for fetch only needs to answer, not to be all of fetch's type
  return { fetchFn, asked };
}

/** A response whose body arrives in these pieces, with no size announced. */
function streamed(pieces: Uint8Array[]): Response {
  let i = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < pieces.length) controller.enqueue(pieces[i++]);
        else controller.close();
      },
    }),
  );
}

/** The message of the LoadError that this promise ends in. */
async function failureOf(promise: Promise<string>): Promise<string> {
  const e = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(LoadError);
  return (e as LoadError).message;
}

describe("fetching a project", () => {
  test("it gets the text, asking without cookies or referrer, following redirects", async () => {
    const text = serializeProject(createEmptyProgram());
    const { fetchFn, asked } = answering(new Response(text));
    expect(await fetchProjectText(URL_OK, { fetch: fetchFn })).toBe(text);
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toBe("https://example.com/books/bracket.cadfly");
    expect(asked[0].init).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow" });
    expect(asked[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  test("the text is read as UTF-8, and a byte order mark is not part of it", async () => {
    const bytes = new TextEncoder().encode("﻿{\"name\":\"café ✓\"}");
    expect(await fetchProjectText(URL_OK, { fetch: answering(new Response(bytes)).fetchFn })).toBe('{"name":"café ✓"}');
    const split = new TextEncoder().encode("é✓");
    const pieces = [split.slice(0, 1), split.slice(1, 4), split.slice(4)];
    expect(await fetchProjectText(URL_OK, { fetch: answering(streamed(pieces)).fetchFn })).toBe("é✓");
  });

  test("a project that parses is what comes back, and one that does not is for the reader to refuse", async () => {
    const good = await fetchProjectText(URL_OK, { fetch: answering(new Response(serializeProject(createEmptyProgram()))).fetchFn });
    expect(parseProject(good).program).toEqual(createEmptyProgram());
    const garbage = await fetchProjectText(URL_OK, { fetch: answering(new Response("<html>not a project</html>")).fetchFn });
    expect(() => parseProject(garbage)).toThrow(/not a valid block program file/);
  });

  test("an answer that is an error says which, and where it came from", async () => {
    const { fetchFn } = answering(new Response("nope", { status: 404, statusText: "Not Found" }));
    expect(await failureOf(fetchProjectText(URL_OK, { fetch: fetchFn }))).toBe("example.com/…/bracket.cadfly: the server answered 404 (Not Found)");
    const bare = answering(new Response("", { status: 503 }));
    expect(await failureOf(fetchProjectText(URL_OK, { fetch: bare.fetchFn }))).toMatch(/the server answered 503/);
  });

  test("a body that says it is too big is refused before it is read", async () => {
    const res = new Response("small really", { headers: { "content-length": "5000" } });
    let touched = false;
    const real = res.body;
    Object.defineProperty(res, "body", {
      get() {
        touched = true;
        return real;
      },
    });
    const message = await failureOf(fetchProjectText(URL_OK, { fetch: answering(res).fetchFn, maxBytes: 1000 }));
    expect(message).toMatch(/at most/);
    expect(touched).toBe(false);
  });

  test("a body that is too big is stopped while it arrives, though the server did not say its size", async () => {
    let pulled = 0;
    const res = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++;
          controller.enqueue(new Uint8Array(400));
        },
      }),
    );
    const message = await failureOf(fetchProjectText(URL_OK, { fetch: answering(res).fetchFn, maxBytes: 1000 }));
    expect(message).toMatch(/more than .* MB/);
    expect(pulled).toBeLessThan(10);
  });

  test("a server that lies about its size is not believed", async () => {
    const res = new Response(new Uint8Array(2000), { headers: { "content-length": "10" } });
    // the announced size is small, but the bytes that arrive are counted
    const fetched = fetchProjectText(URL_OK, { fetch: answering(res).fetchFn, maxBytes: 1000 });
    expect(await failureOf(fetched)).toMatch(/more than/);
  });

  test("the limit is enough for the biggest project the app allows", () => {
    const stlLimit = 8 * 3 * 1024 * 1024;
    expect(MAX_PROJECT_TEXT_BYTES).toBeGreaterThan(Math.ceil((stlLimit * 4) / 3));
  });

  test("a body exactly at the limit is accepted", async () => {
    const text = "x".repeat(1000);
    expect(await fetchProjectText(URL_OK, { fetch: answering(new Response(text)).fetchFn, maxBytes: 1000 })).toBe(text);
  });
});

describe("when the host cannot be reached", () => {
  /** A fetch that fails the way browsers fail a blocked or unreachable request. */
  const failing = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch; // cast: a stand-in for fetch that fails, which is not the type of fetch

  test("another site is told to allow cross-origin reads (CORS), and the host is named", async () => {
    const message = await failureOf(fetchProjectText(URL_OK, { fetch: failing, pageOrigin: "https://mfs409.github.io" }));
    expect(message).toContain("example.com/…/bracket.cadfly");
    expect(message).toContain("(example.com)");
    expect(message).toMatch(/CORS/);
  });

  test("a host on the page's own origin cannot be blocked by CORS, so it is not blamed", async () => {
    const message = await failureOf(fetchProjectText(new URL("https://mfs409.github.io/x.cadfly"), { fetch: failing, pageOrigin: "https://mfs409.github.io" }));
    expect(message).toMatch(/could not be reached/);
    expect(message).not.toMatch(/CORS/);
  });

  test("a long address is shown as the host and the end of its path", async () => {
    const url = new URL(`https://files.example.org/a/b/c/d/${"long".repeat(30)}.cadfly?token=${"s".repeat(80)}`);
    const message = await failureOf(fetchProjectText(url, { fetch: failing }));
    expect(message).not.toContain("token=");
    expect(message.length).toBeLessThan(260);
  });
});

describe("time and cancelling", () => {
  /** A fetch that never answers, and ends only when it is told to stop. */
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as unknown as typeof fetch; // cast: a stand-in for fetch that never answers, which is not the type of fetch

  test("a server that does not answer in time is given up on", async () => {
    vi.useFakeTimers();
    const outcome = failureOf(fetchProjectText(URL_OK, { fetch: hanging }));
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS - 1);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toBe(`example.com/…/bracket.cadfly: no answer after ${LOAD_TIMEOUT_MS / 1000} seconds`);
  });

  test("the time limit applies to reading the body too", async () => {
    vi.useFakeTimers();
    const slow = (async (_url: string, init: RequestInit) =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull: () =>
            new Promise((_resolve, reject) => {
              init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            }),
        }),
      )) as unknown as typeof fetch; // cast: a stand-in for fetch whose body never arrives, which is not the type of fetch
    const outcome = failureOf(fetchProjectText(URL_OK, { fetch: slow, timeoutMs: 5000 }));
    await vi.advanceTimersByTimeAsync(5001);
    expect(await outcome).toMatch(/no answer after 5 seconds/);
  });

  test("the time is not counted once the project has arrived", async () => {
    vi.useFakeTimers();
    const { fetchFn } = answering(new Response("{}"));
    expect(await fetchProjectText(URL_OK, { fetch: fetchFn })).toBe("{}");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("the person can cancel, and it is said so, not blamed on the host", async () => {
    const stop = new AbortController();
    const outcome = failureOf(fetchProjectText(URL_OK, { fetch: hanging, signal: stop.signal }));
    stop.abort();
    expect(await outcome).toBe("opening example.com/…/bracket.cadfly was cancelled");
  });

  test("a fetch that is cancelled before it starts never asks", async () => {
    const stop = new AbortController();
    stop.abort();
    const { fetchFn } = answering(new Response("{}"));
    const guarded = ((url: string, init: RequestInit) => (init.signal?.aborted ? Promise.reject(new DOMException("aborted", "AbortError")) : fetchFn(url, init))) as unknown as typeof fetch; // cast: a stand-in for fetch that honors the stop signal, which is not the type of fetch
    expect(await failureOf(fetchProjectText(URL_OK, { fetch: guarded, signal: stop.signal }))).toMatch(/cancelled/);
  });
});
