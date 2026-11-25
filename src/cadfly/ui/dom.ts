/** Small helpers for the pages the app draws itself: elements, the colours they share, and what the browser keeps for a page */

export const INK = "#e6ebf5";
export const MUTED = "#9aa7c0";
export const PANEL = "#141b2d";
export const LINE = "#2b3652";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, css = "", text = "") {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

/** What is kept in this browser under a key, or "" if nothing is (or the browser does not allow storage) */
export function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Keep text in this browser under a key (an empty value forgets it). False if the browser would not: a private window, a full disk. */
export function writeStored(key: string, value: string): boolean {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
