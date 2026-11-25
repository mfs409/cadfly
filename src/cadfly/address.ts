import { findModeName } from "./ui/modes";

/**
 * What the page's address can ask for, as plain functions of its query string
 * (`?mode=Starter&ai=off&test=1&load=https://example.com/bracket.cadfly`). A
 * teacher can hand out an address that picks and locks the interface mode and
 * the assistant switch, or that opens a project from the web.
 */

/**
 * The interface mode that the address picks, as `UI_MODES` spells it, or
 * undefined if it picks none (a person cannot change a mode that is picked).
 *
 * @param search The address's query string, such as `location.search`.
 */
export function lockedModeName(search: string): string | undefined {
  return findModeName(new URLSearchParams(search).get("mode") ?? "");
}

/**
 * The assistant switch that the address picks: true for `?ai=on` (or `1`,
 * `true`, `yes`), false for `?ai=off` (or `0`, `false`, `no`), and undefined
 * when it picks neither (the last choice is used then).
 *
 * @param search The address's query string.
 */
export function lockedAssistant(search: string): boolean | undefined {
  const word = (new URLSearchParams(search).get("ai") ?? "").trim().toLowerCase();
  if (["1", "on", "true", "yes"].includes(word)) return true;
  if (["0", "off", "false", "no"].includes(word)) return false;
  return undefined;
}

/**
 * Does the address ask for the page to hand itself to test scripts
 * (`?test=1`)?
 *
 * @param search The address's query string.
 */
export function wantsTestHandle(search: string): boolean {
  return new URLSearchParams(search).get("test") === "1";
}

/** The query parameter that names a project to open: `?load=<address>`. */
export const LOAD_PARAM = "load";

/** The hosts that may be reached without encryption: this computer only. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The longest piece of an address that is shown in a message. */
const SHOWN_ADDRESS_LENGTH = 60;

/**
 * What the address asks to open: the web address of a project, or the reason
 * it was refused.
 */
export type LoadTarget = { url: URL } | { error: string };

/**
 * Part of an address, short enough for a message.
 *
 * @param text The address as it was written.
 */
function shortened(text: string): string {
  return text.length > SHOWN_ADDRESS_LENGTH ? `${text.slice(0, SHOWN_ADDRESS_LENGTH)}…` : text;
}

/**
 * The project that the address asks to open (`?load=...`), if it asks for one.
 * Only `https` addresses are accepted, and `http` ones for this computer; an
 * address with a name and password in it is refused too, as is anything else
 * (`javascript:`, `data:`, `file:`, `blob:`). A relative address is taken
 * relative to the page. An empty `load`, or none, asks for nothing; when it is
 * given more than once the first is used.
 *
 * @param search The address's query string, such as `location.search`.
 * @param pageAddress The page's own address, which a relative address is taken
 *                    from.
 * @returns Undefined if nothing is asked for.
 */
export function loadTarget(search: string, pageAddress: string): LoadTarget | undefined {
  const given = (new URLSearchParams(search).get(LOAD_PARAM) ?? "").trim();
  if (!given) return undefined;
  let url: URL;
  try {
    url = new URL(given, pageAddress);
  } catch {
    return { error: `"${shortened(given)}" is not a web address, so it cannot be opened` };
  }
  const local = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !local) {
    return { error: `"${shortened(given)}" cannot be opened: only https addresses can (and http ones on this computer)` };
  }
  if (url.username || url.password) return { error: `"${shortened(given)}" cannot be opened: an address with a name and password in it is not accepted` };
  return { url };
}

/**
 * Where a project came from, in a few words for a message: the host and the
 * last piece of the path (`example.com/…/bracket.cadfly`).
 *
 * @param url The project's address.
 */
export function describeSource(url: URL): string {
  const parts = url.pathname.split("/").filter(Boolean);
  const last = parts.at(-1);
  if (!last) return url.host;
  return `${url.host}/${parts.length > 1 ? "…/" : ""}${shortened(decoded(last))}`;
}

/**
 * The file name at the end of a project's address, or a plain word when the
 * address has none.
 *
 * @param url The project's address.
 */
export function projectNameOf(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).at(-1);
  return last ? shortened(decoded(last)) : "the project";
}

/**
 * Undo the percent-encoding of a piece of an address, leaving it as it is when
 * it is not well formed.
 *
 * @param text A piece of an address.
 */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The query string without the `load` request (every `load`, if there are
 * several), and with everything else exactly as it was written.
 *
 * @param search The address's query string, such as `location.search`.
 * @returns The rest of the query string with its `?`, or "" if nothing is left.
 */
export function withoutLoadParam(search: string): string {
  const kept = search
    .replace(/^\?/, "")
    .split("&")
    .filter((pair) => pair !== "" && decoded(pair.split("=")[0].replace(/\+/g, " ")) !== LOAD_PARAM);
  return kept.length ? `?${kept.join("&")}` : "";
}
