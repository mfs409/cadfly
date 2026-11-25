import { describeSource } from "./address";

/**
 * Getting the text of a project from a web address. The request carries no
 * cookies and no referrer, gives up after a time limit, and stops reading a
 * body that grows past the size limit, whatever the server said its size was.
 * Every way it can fail ends in a `LoadError` whose message names where the
 * project came from and says what to do.
 */

/**
 * The most text a project may be, in bytes: the files a project holds are
 * limited to 24 MiB, and written as text they take about a third more.
 */
export const MAX_PROJECT_TEXT_BYTES = 40 * 1024 * 1024;

/** How long the server has to send the whole project, in milliseconds. */
export const LOAD_TIMEOUT_MS = 30_000;

/** A project that could not be fetched, and why, in words for the person. */
export class LoadError extends Error {}

/** What `fetchProjectText` may be given besides the address. Every one has a default. */
export interface FetchProjectOptions {
  /** Stands in for `fetch` (tests give their own). */
  fetch?: typeof fetch;
  /** How long to wait, in milliseconds. Default `LOAD_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The most text to accept, in bytes. Default `MAX_PROJECT_TEXT_BYTES`. */
  maxBytes?: number;
  /** Cancels the fetch. */
  signal?: AbortSignal;
  /**
   * The page's own origin (`https://example.com`). A failure to reach a host on
   * another origin is probably the host not allowing other sites (CORS); one on
   * the page's own origin cannot be.
   */
  pageOrigin?: string;
}

/** A size in bytes as megabytes, for a message. */
const megabytes = (bytes: number) => `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/**
 * Get the text of the project at an address.
 *
 * @param url The address of the project.
 * @param options Limits and stand-ins (see `FetchProjectOptions`).
 * @returns The project's text, decoded as UTF-8, without a byte order mark.
 * @throws LoadError if the host cannot be reached or does not allow it, does
 *         not answer in time, answers with an error, sends too much, or the
 *         fetch was cancelled.
 */
export async function fetchProjectText(url: URL, options: FetchProjectOptions = {}): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const limit = options.maxBytes ?? MAX_PROJECT_TEXT_BYTES;
  const timeoutMs = options.timeoutMs ?? LOAD_TIMEOUT_MS;
  const label = describeSource(url);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = () => controller.abort();
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener("abort", cancel);

  /** The error to report when the fetch or the reading of it failed. */
  const failure = (e: unknown): LoadError => {
    if (e instanceof LoadError) return e;
    if (timedOut) return new LoadError(`${label}: no answer after ${Math.round(timeoutMs / 1000)} seconds`);
    if (options.signal?.aborted) return new LoadError(`opening ${label} was cancelled`);
    const sameSite = options.pageOrigin !== undefined && options.pageOrigin === url.origin;
    return new LoadError(sameSite ? `${label}: could not be reached` : `${label}: could not be reached. The host (${url.host}) must be running and must allow other websites to read it (CORS)`);
  };

  try {
    const res = await doFetch(url.href, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow", signal: controller.signal });
    if (!res.ok) throw new LoadError(`${label}: the server answered ${res.status}${res.statusText ? ` (${res.statusText})` : ""}`);
    const announced = Number(res.headers.get("content-length"));
    if (announced > limit) throw new LoadError(`${label}: it is ${megabytes(announced)}, and a project can be at most ${megabytes(limit)}`);
    return await readLimited(res, limit, label);
  } catch (e) {
    throw failure(e);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/**
 * Read a response's body as UTF-8 text, counting the bytes as they arrive and
 * stopping at the limit.
 *
 * @param res The response.
 * @param limit The most bytes to accept.
 * @param label Where the project came from, for the message.
 * @throws LoadError if the body is larger than the limit.
 */
async function readLimited(res: Response, limit: number, label: string): Promise<string> {
  const tooBig = () => new LoadError(`${label}: it is more than ${megabytes(limit)}, which is more than a project can be`);
  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw tooBig();
    return withoutByteOrderMark(text);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    text += decoder.decode(value, { stream: true });
  }
  return withoutByteOrderMark(text + decoder.decode());
}

/**
 * Text without the byte order mark that some editors put first, which a JSON
 * reader does not accept.
 *
 * @param text The text.
 */
function withoutByteOrderMark(text: string): string {
  return text.startsWith("﻿") ? text.slice(1) : text;
}
