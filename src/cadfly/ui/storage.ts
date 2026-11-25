/**
 * What the browser keeps for the page, as text under a key: for good on this
 * computer (localStorage), or only until the page is closed (sessionStorage).
 *
 * The browser may refuse to keep anything: a private window, storage turned
 * off, or a full disk. No function here throws when that happens, so the page
 * works either way, and what was meant to be kept lasts only until the page
 * closes.
 */

/** Read a key from one of the browser's stores, or "" if there is nothing there or the store is not allowed. */
function read(store: () => Storage, key: string): string {
  try {
    return store().getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Keep text under a key in one of the browser's stores; an empty value forgets the key. False if the store would not. */
function write(store: () => Storage, key: string, value: string): boolean {
  try {
    if (value) store().setItem(key, value);
    else store().removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * What is kept on this computer under a key, between visits.
 *
 * @param key The key.
 * @returns The text, or "" if nothing is kept there (or the browser does not
 *          allow storage).
 */
export function readStored(key: string): string {
  return read(() => localStorage, key);
}

/**
 * Keep text on this computer under a key, between visits.
 *
 * @param key The key.
 * @param value The text. An empty value forgets the key.
 * @returns False if the browser would not keep it (a private window, a full
 *          disk).
 */
export function writeStored(key: string, value: string): boolean {
  return write(() => localStorage, key, value);
}

/**
 * What is kept under a key until this page is closed.
 *
 * @param key The key.
 * @returns The text, or "" if nothing is kept there (or the browser does not
 *          allow storage).
 */
export function readSession(key: string): string {
  return read(() => sessionStorage, key);
}

/**
 * Keep text under a key until this page is closed.
 *
 * @param key The key.
 * @param value The text. An empty value forgets the key.
 * @returns False if the browser would not keep it.
 */
export function writeSession(key: string, value: string): boolean {
  return write(() => sessionStorage, key, value);
}
