import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Checks on how the tests themselves are written. A cast that tells the type
 * checker to stop looking (`as never`, `as unknown as T`, `unknown[]`, `any`)
 * hides it when a rename or a type change makes a test stale: the test still
 * compiles and only fails when it runs, or does not fail at all. Such a cast is
 * allowed only with a reason, written as `// cast: why` on the same line or the
 * line before.
 */

const ROOT = new URL("..", import.meta.url).pathname;

/** The TypeScript files under the folders the tests, and the eval, live in */
function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return name === "out" ? [] : sources(path);
    return path.endsWith(".ts") && path !== join("tests", "hygiene.test.ts") ? [path] : [];
  });
}

/** What the check refuses, with the words the failure message uses */
const ESCAPES: { pattern: RegExp; what: string }[] = [
  { pattern: /\bas never\b/, what: "`as never`" },
  { pattern: /\bas unknown as\b/, what: "`as unknown as`" },
  { pattern: /\bunknown\[\]/, what: "`unknown[]`" },
  { pattern: /\bas any\b/, what: "`as any`" },
  { pattern: /:\s*any\b/, what: "`: any`" },
];

/** Does this line, or the one before it, give a reason? */
function hasReason(lines: string[], index: number): boolean {
  return /\/\/ cast: \S/.test(lines[index]) || (index > 0 && /^\s*\/\/ cast: \S/.test(lines[index - 1]));
}

describe("casts in the tests and the eval", () => {
  for (const file of [...sources("tests"), ...sources("eval")]) {
    test(`${relative(".", file)} gives a reason for every cast that hides a type`, () => {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      const bad = lines.flatMap((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
        return ESCAPES.filter((e) => e.pattern.test(code) && !hasReason(lines, i)).map((e) => `${file}:${i + 1}: ${e.what} needs a "// cast: why" comment`);
      });
      expect(bad).toEqual([]);
    });
  }
});
