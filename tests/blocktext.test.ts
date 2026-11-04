import { describe, expect, test } from "vitest";
import { BlockTextError, formatBlocks, parseBlocks } from "../src/cadfly/assistant/blocktext";
import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import { applyOps } from "../src/cadfly/assistant/ops";
import { programView } from "../src/cadfly/assistant/prompt";
import { type NewBlock } from "../src/cadfly/assistant/ops";

/** Blocks without empty `args`, so "no fields" is the same however it is written */
const plain = (blocks: NewBlock[]): NewBlock[] => blocks.map(({ args, inner, ...rest }) => ({ ...rest, ...(args && Object.keys(args).length ? { args } : {}), ...(inner ? { inner: plain(inner) } : {}) }));

const why = (text: string) => {
  try {
    parseBlocks(text);
  } catch (e) {
    expect(e).toBeInstanceOf(BlockTextError);
    return (e as Error).message;
  }
  throw new Error("expected an error");
};

describe("reading block text", () => {
  test("a block is its kind and the fields it sets", () => {
    expect(parseBlocks("box name=plate w=40 h=5")).toEqual([{ kind: "box", args: { name: "plate", w: "40", h: "5" } }]);
    expect(parseBlocks("union")).toEqual([{ kind: "union" }]);
  });

  test("a flag is a bare word, and may be written as hole=true too", () => {
    expect(parseBlocks("circle r=3 hole")).toEqual([{ kind: "circle", args: { r: "3", hole: true } }]);
    expect(parseBlocks("circle hole r=3")).toEqual([{ kind: "circle", args: { hole: true, r: "3" } }]);
    expect(parseBlocks("circle hole=false r=3")).toEqual([{ kind: "circle", args: { hole: "false", r: "3" } }]); // applyOps turns the text into a flag
  });

  test("a block inside another is indented under it, to any depth", () => {
    const blocks = parseBlocks(["union name=u", "  transform z=20", "    transform rx=90", "      box w=5", "  sphere r=3", "box w=1"].join("\n"));
    expect(blocks.map((b) => b.kind)).toEqual(["union", "box"]);
    expect(blocks[0].inner!.map((b) => b.kind)).toEqual(["transform", "sphere"]);
    expect(blocks[0].inner![0].inner![0].inner![0]).toEqual({ kind: "box", args: { w: "5" } });
  });

  test("any amount of indentation will do, as long as inner blocks are further in", () => {
    const blocks = parseBlocks("transform z=1\n    box\n    sphere");
    expect(blocks[0].inner!.map((b) => b.kind)).toEqual(["box", "sphere"]);
    expect(parseBlocks("transform z=1\n\tbox")[0].inner).toHaveLength(1); // a tab is two spaces
  });

  test("values with spaces are quoted, and an expression that was not quoted still reads", () => {
    expect(parseBlocks('transform x="i * 12" y=0')).toEqual([{ kind: "transform", args: { x: "i * 12", y: "0" } }]);
    expect(parseBlocks("transform x=i * 12 y=0")).toEqual([{ kind: "transform", args: { x: "i * 12", y: "0" } }]);
    expect(parseBlocks("box w=width / 4 d=2 h=width + 1")).toEqual([{ kind: "box", args: { w: "width / 4", d: "2", h: "width + 1" } }]);
    expect(parseBlocks('box name="my plate, big" w=1')).toEqual([{ kind: "box", args: { name: "my plate, big", w: "1" } }]);
    expect(parseBlocks('box name="say \\"hi\\"" w=1')[0].args!.name).toBe('say "hi"');
  });

  test("a value runs on over spaces after an operator, a comma or a bracket, and no other way", () => {
    expect(parseBlocks("transform x=max(1, 2) y=sqrt(4) + 1")).toEqual([{ kind: "transform", args: { x: "max(1, 2)", y: "sqrt(4) + 1" } }]);
    expect(parseBlocks("box w=(1 + 2) * 3 d=2")).toEqual([{ kind: "box", args: { w: "(1 + 2) * 3", d: "2" } }]);
    // a stray word after a finished value is a mistake, and the kind's fields are listed
    expect(why("cylinder r=3 h=5 hole")).toMatch(/I do not understand "hole": a cylinder block has the fields name, r, top, h/);
    expect(why("teleport x=1 y")).toMatch(/there is no block called "teleport"/);
  });

  test("an id in front of the kind, as the program view writes it, is ignored", () => {
    expect(parseBlocks("b7 circle u=1 r=2 hole")).toEqual([{ kind: "circle", args: { u: "1", r: "2", hole: true } }]);
  });

  test("blank lines and # comments are skipped", () => {
    expect(parseBlocks("\n# a plate\nbox w=1\n\n")).toEqual([{ kind: "box", args: { w: "1" } }]);
    expect(parseBlocks("")).toEqual([]);
  });

  test("what is wrong is said, with the line", () => {
    expect(why("box w=1\n  = 5")).toMatch(/^line 2 .*a block starts with its kind/);
    expect(why('box name="oops')).toMatch(/line 1.*a quote is not closed after name=/);
    expect(why("box 40")).toMatch(/I do not understand "40"/);
  });

  test("a kind that does not exist reads (applyOps says what is wrong with it)", () => {
    expect(parseBlocks("teleport x=1")).toEqual([{ kind: "teleport", args: { x: "1" } }]);
  });
});

describe("writing block text", () => {
  test("fields come in the order the block shows them, flags bare, defaults left out", () => {
    const blocks: NewBlock[] = [{ kind: "circle", args: { hole: true, r: "3", u: "8", v: "8" } }];
    expect(formatBlocks(blocks)).toBe("circle u=8 v=8 r=3 hole");
    expect(formatBlocks([{ kind: "circle", args: { hole: false, r: "3" } }])).toBe("circle r=3");
  });

  test("values with spaces are quoted, and what is inside is indented", () => {
    const text = formatBlocks([{ kind: "transform", args: { x: "i * 12" }, inner: [{ kind: "box", args: { name: "a b", w: "2" } }] }]);
    expect(text).toBe('transform x="i * 12"\n  box name="a b" w=2');
  });

  test("what is written reads back the same, for every worked example", () => {
    for (const ex of WORKED_EXAMPLES) {
      for (const o of ex.ops) {
        const lists = [(o as { blocks?: unknown }).blocks, (o as { with?: unknown }).with].filter((x): x is NewBlock[] => Array.isArray(x) && x.every((e) => typeof e === "object"));
        for (const blocks of lists) expect(plain(parseBlocks(formatBlocks(blocks))), ex.user).toEqual(plain(blocks));
      }
    }
  });

  test("it reads what the program view writes (without the ids), so the model can copy what it sees", () => {
    const { program } = applyOps([], [{ op: "append", blocks: "transform x=5\n  extrude name=plate height=5\n    rectangle w=40 h=30\n    circle u=8 v=8 r=3 hole" }]);
    const view = programView(program).replace(/\bb\d+ /g, "");
    expect(parseBlocks(view)).toEqual(parseBlocks("transform x=5\n  extrude name=plate plane=XY height=5\n    rectangle u=0 v=0 w=40 h=30\n    circle u=8 v=8 r=3 hole"));
  });
});

describe("as ops", () => {
  test("block text in an op builds the same program as blocks do", () => {
    const text = applyOps([], [{ op: "append", blocks: "extrude name=plate height=5\n  rectangle w=40 h=30\n  circle u=8 v=8 r=3 hole" }]).program;
    const objects = applyOps([], [{ op: "append", blocks: [{ kind: "extrude", args: { name: "plate", height: "5" }, inner: [{ kind: "rectangle", args: { w: "40", h: "30" } }, { kind: "circle", args: { u: "8", v: "8", r: "3", hole: true } }] }] }]).program;
    expect(text).toEqual(objects);
  });

  test("a mistake in the text is an op error that names the op and the line", () => {
    expect(() => applyOps([], [{ op: "append", blocks: "box w=1\nbox \"x" }])).toThrow(/op 1 \(append\): line 2/);
  });
});

describe("a field that may be written without its name", () => {
  test("a face is its vertex numbers", () => {
    expect(parseBlocks("face 1 2 3 4")).toEqual([{ kind: "face", args: { corners: "1 2 3 4" } }]);
    expect(parseBlocks("face 1, 2, 3")).toEqual([{ kind: "face", args: { corners: "1, 2, 3" } }]);
    expect(parseBlocks('face corners="1 2 3"')).toEqual([{ kind: "face", args: { corners: "1 2 3" } }]);
    expect(parseBlocks("face corners=1")).toEqual([{ kind: "face", args: { corners: "1" } }]);
    expect(parseBlocks("solid name=p\n  vertices\n    vertex x=0 y=0 z=0\n  faces\n    face 1 2 3")[0].inner!.map((b) => b.kind)).toEqual(["vertices", "faces"]);
  });

  test("other blocks do not read a bare value that way", () => {
    expect(() => parseBlocks("box 10")).toThrow(/I do not understand "10"/);
  });
});
