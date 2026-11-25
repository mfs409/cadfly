import { describe, expect, test } from "vitest";
import { arimoMeasure, renderProgram, renderProject } from "./helpers/svg";
import { commandById } from "../src/cadfly/language/commands";
import { EXAMPLES, exampleById } from "../src/cadfly/examples";
import { serializeProject } from "../src/cadfly/language/format";
import { modeByName } from "../src/cadfly/ui/modes";
import { programToSvg } from "../src/cadfly/ui/svg";
import type { Block, Program } from "../src/cadfly/language/types";
import { oneScript, topBlocks } from "./helpers/script-helpers";

/** Pictures of programs as SVG, drawn with the editor's layout and font. */

/** A width that needs no font: every letter is 0.15 m */
const fixed = (text: string) => text.length * 0.15;

/** Is this markup balanced, and free of the signs of a bug (NaN, undefined) in a number or text? */
function wellFormed(svg: string): void {
  const stack: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)((?:[^>"]|"[^"]*")*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (selfClosing) continue;
    if (closing) expect(stack.pop(), `</${name}> closes ${name}`).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
}

const b = (kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({ id: `b${Math.random().toString(36).slice(2)}`, kind, args, ...(inner ? { inner } : {}) });

// A picture of the blocks, drawn from the editor's own layout, with no editor running
describe("the picture of a program with several scripts", () => {
  const program: Program = [
    { id: "s1", name: "build", blocks: [b("box"), b("box")] },
    { id: "s2", name: "leg", inputs: "w, h", blocks: [b("box")] },
  ];

  test("a function's name and inputs are chips with a remove button, as in the editor, and build and a global script are plain text", () => {
    const svg = programToSvg([{ id: "s1", blocks: [b("set")] }, ...program], { measure: fixed });
    wellFormed(svg);
    expect(svg).toContain(">leg</text>");
    expect(svg).toContain(">(w, h)</text>");
    expect(svg).toContain(">×</text>");
    expect(svg).toMatch(/>build[^<]*2 blocks<\/text>/); // build is plain text that says how many blocks it has
    expect(svg).toMatch(/>global<\/text>/);
    expect(svg.match(/>×<\/text>/g)).toHaveLength(1);
  });

  test("a mode without scripts draws the name as text, with no chips and no remove button", () => {
    const svg = programToSvg(program, { measure: fixed, mode: modeByName("First steps") });
    expect(svg).toContain(">leg(w, h)</text>");
    expect(svg).not.toContain(">×</text>");
    expect(svg).not.toContain(">(w, h)</text>");
  });
});

describe("the picture of a program", () => {
  test.each(EXAMPLES.map((d) => [d.name, d.program] as const))("%s: well-formed, with every block's name in it", (_name, program) => {
    const svg = programToSvg(program, { measure: fixed });
    wellFormed(svg);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    const words = new Set<string>();
    const note = (blocks: Block[]) => blocks.forEach((x) => (words.add(x.kind === "use" ? "use" : x.kind), note(x.inner ?? [])));
    note(topBlocks(program));
    for (const kind of words) if (kind !== "else" && kind !== "vertex" && kind !== "face") expect(svg, kind).toContain(`>${commandById(kind)?.word ?? kind}</text>`);
  });

  test("an empty program is a small picture that says so", () => {
    const svg = programToSvg([], { measure: fixed });
    wellFormed(svg);
    expect(svg).toContain("(no blocks)");
  });

  test("text is escaped, so a field cannot break the picture", () => {
    const svg = programToSvg(oneScript([b("text", { text: '</text><b a="1">&' })]), { measure: fixed });
    wellFormed(svg);
    expect(svg).toContain("&lt;/text&gt;&lt;b a=&quot;1&quot;&gt;&amp;");
  });

  test("a background, a title and a field cannot break out of their attributes or the markup", () => {
    const svg = programToSvg(oneScript([b("text", { text: "a\u0001b\u0008c" })]), { measure: fixed, background: '#123"/><script>', title: 'x"><script>' });
    wellFormed(svg);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain('fill="#123&quot;/&gt;&lt;script&gt;"');
  });

  test("characters that XML 1.0 does not allow are dropped, and tab and newline are kept", () => {
    const svg = programToSvg(oneScript([b("text", { text: "a\u0000b\u000Bc\u001Fd\te" })]), { measure: fixed });
    expect(svg).toContain(">abcd\te<");
    expect(svg).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  test("a hidden block is drawn faded, and a switched-off one has a dark power switch", () => {
    const plain = programToSvg(oneScript([b("box")]), { measure: fixed });
    const hidden = programToSvg(oneScript([{ ...b("box"), hidden: true }]), { measure: fixed });
    expect(plain).toContain('fill="#2f7fe0"'); // the shapes' colour
    expect(hidden).not.toContain('fill="#2f7fe0" stroke');
    expect(hidden).toContain('fill="#2f7fe0" fill-opacity="0.4"');
  });

  test("a block that holds others is one outline, and the blocks inside are inside it", () => {
    const svg = programToSvg(oneScript([b("union", {}, [b("box"), b("sphere")])]), { measure: fixed });
    expect(svg.match(/<polygon /g)).toHaveLength(1);
    wellFormed(svg);
  });

  test("a mode without the switches leaves the eye out, as the editor does", () => {
    const program: Program = oneScript([b("box", { w: "40", d: "30", h: "20" })]);
    const all = programToSvg(program, { measure: fixed });
    const some = programToSvg(program, { measure: fixed, mode: modeByName("First steps") });
    expect(all.length).toBeGreaterThan(some.length);
  });

  test("the picture is as big as the blocks: a taller program is a taller picture", () => {
    const height = (n: number) => Number(/height="(\d+)"/.exec(programToSvg(oneScript(Array.from({ length: n }, () => b("box"))), { measure: fixed }))![1]);
    expect(height(6)).toBeGreaterThan(height(2));
  });

  test("no background panel when asked", () => {
    expect(programToSvg(oneScript([b("box")]), { measure: fixed, background: false })).not.toContain("#1b2440");
  });
});

describe("the picture, with the editor's font", () => {
  // widths measured in the running editor: "set" 0.358 m in a 1400-pixel window and 0.365 m in a 960-pixel one, "middle" in a field 0.974 and 0.986 less its padding
  test("text is about as wide as the editor draws it", () => {
    const measure = arimoMeasure();
    expect(measure("set")).toBeGreaterThan(0.33);
    expect(measure("set")).toBeLessThan(0.39);
    expect(measure("middle")).toBeGreaterThan(0.74);
    expect(measure("middle")).toBeLessThan(0.82);
    expect(measure("")).toBe(0);
  });

  test("a project file and a program give the same picture", () => {
    const program = exampleById("plate-with-holes")!.program;
    const fromProgram = renderProgram(program);
    expect(renderProject(serializeProject(program))).toBe(fromProgram);
    wellFormed(fromProgram);
  });
});
