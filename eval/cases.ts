import { WORKED_EXAMPLES } from "../src/cadfly/assistant/workedExamples";
import { type Op, applyOps } from "../src/cadfly/assistant/ops";
import type { Vec3 } from "../src/cadfly/geometry/kernel";
import type { RunResult } from "../src/cadfly/language/run";
import { allBlocks, isBlank } from "../src/cadfly/language/program";
import type { Program } from "../src/cadfly/language/types";
import { type StlFiles, addStlFile } from "../src/cadfly/language/files";
import { writeStl } from "../src/cadfly/geometry/stl";

/**
 * The requests that the evaluation puts to a model, and the checks that say whether each answer is what was asked for.
 * A check looks at the shapes the resulting program builds, such as their size, volume or the blocks used, and never at the model's wording.
 * Some requests start from an existing program, some follow earlier requests in the same conversation, and some come with STL files.
 */

/** What came out of a case, for its check. */
export interface Outcome {
  /** The program after the model's reply was applied (the starting program, if it was not). */
  program: Program;
  /** What running that program built. */
  run: RunResult;
  /** The reply was understood and applied. */
  ok: boolean;
  /** What the model said to the person. */
  reply: string;
  /** How many operations the reply asked for. */
  opCount: number;
}

/** One request to a model, with the check on its result. */
export interface Case {
  /** STL files the project has when the request is made. */
  files?: StlFiles;
  /** A short name, unique among the cases, for picking one to run. */
  id: string;
  /** The language the request is in (`en`, `es`, ...), for the report. */
  lang: string;
  /** Earlier requests, made first. Their results are not checked. */
  before?: string[];
  /** The program the request is made against. */
  start: Program;
  /** The request, as the person would type it. */
  text: string;
  /** True if the result is what was asked for. */
  check(o: Outcome): boolean;
}

/** The program that applying these operations to an empty project makes. */
const program = (ops: Op[]): Program => applyOps([], ops).program;
/** A 40 by 30 plate, 5 thick, with a hole of radius 3 near each corner: the starting point of many requests to change something. */
const PLATE = program(WORKED_EXAMPLES[0].ops);
/** A variable `width` (40) and two boxes: `a` (width by 20 by 10) and `b` (10 by 10 by 30). */
const BOXES = program([
  { op: "append", blocks: "set name=width value=40" },
  { op: "append", blocks: "box name=a w=width d=20 h=10" },
  { op: "append", blocks: "box name=b w=10 d=10 h=30" },
]);

/** Is `a` within a fraction `tol` of `b` (or within 0.05, for values near zero)? */
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * tol);
/** The bounding box of everything the program built together, if it built anything. */
const bounds = (o: Outcome) => o.run.combined?.bounds();
/** The width, depth and height of everything built together, if anything was built. */
const size = (o: Outcome): Vec3 | undefined => {
  const b = bounds(o);
  return b && [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
};
/** A check: the program built without a problem, and the result is this wide, deep and high. */
const sized = (x: number, y: number, z: number) => (o: Outcome) => {
  const s = size(o);
  return !o.run.problem && !!s && near(s[0], x) && near(s[1], y) && near(s[2], z);
};
/** A check: the program built without a problem, and the result has this volume, within `tol`. */
const volume = (v: number, tol = 0.03) => (o: Outcome) => !o.run.problem && !!o.run.combined && near(o.run.combined.volume(), v, tol);
/** How many blocks of this kind the program has, however deeply they are nested. */
const has = (o: Outcome, kind: string) => allBlocks(o.program).filter((b) => b.kind === kind).length;
/** How many named scripts the program has besides `build`. */
const functions = (o: Outcome) => o.program.filter((s) => s.name !== undefined && s.name !== "build").length;
/** Shorthand for the many volume formulas below. */
const PI = Math.PI;
/** The volume of the plate before any holes: 40 by 30 by 5. */
const PLATE_V = 40 * 30 * 5;
/** The volume of `n` holes of radius `r` through the plate (4 by default). */
const holes = (r: number, n = 4) => n * PI * r * r * 5;

/** The project files for the import case: an STL file of a cube, 10 on each side, centred on the origin, made without the geometry kernel. */
const CUBE_STL = (() => {
  const p = new Float32Array([-5, -5, -5, 5, -5, -5, 5, 5, -5, -5, 5, -5, -5, -5, 5, 5, -5, 5, 5, 5, 5, -5, 5, 5]);
  const i = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return addStlFile({}, "cube.stl", writeStl({ positions: p, indices: i })).files;
})();

/**
 * Make a case.
 * `start`, `before` and `files` are for requests that need a starting program, earlier requests or STL files.
 */
const c = (id: string, lang: string, text: string, check: Case["check"], start: Program = [], before?: string[], files?: StlFiles): Case => ({ id, lang, text, check, start, before, files });

/** Every case, in groups: making things from nothing, the newer parts of the language, modelling, changing what is there, other languages, and conversation. */
export const CASES: Case[] = [
  // making things from nothing
  c("box", "en", "make a box 20 by 30 by 10", sized(20, 30, 10)),
  c("cylinder", "en", "a cylinder with radius 5 and height 20", sized(10, 10, 20)),
  c("sphere-diameter", "en", "a sphere with a diameter of 30", sized(30, 30, 30)),
  c("cone", "en", "a cone with a base radius of 10, height 15 and a pointed top", sized(20, 20, 15)),
  c("plate-holes", "en", "a 40 by 30 plate, 5 thick, with a hole of radius 3 near each corner", (o) => sized(40, 30, 5)(o) && volume(PLATE_V - holes(3))(o)),
  c("triangle", "en", "a right triangle with legs 20 and 10, extruded 8 high", (o) => sized(20, 10, 8)(o) && volume(800)(o)),
  c("ring", "en", "a ring with outer radius 20, inner radius 15 and height 5", volume(PI * (400 - 225) * 5)),
  c("vase", "en", "revolve a rectangle 10 wide and 40 tall into a solid of revolution", sized(20, 20, 40)),
  c("variable", "en", "set a variable width to 30 and make a box that is width on every side", (o) => sized(30, 30, 30)(o) && has(o, "set") >= 1),
  c("side-by-side", "en", "two 10 mm cubes next to each other along x, touching", sized(20, 10, 10)),
  // stacked balls may touch (44 tall) or sink into each other so that they join (shorter), so the height is a range
  c("snowman", "en", "a snowman: three spheres of radius 10, 7 and 5 stacked on each other", (o) => !o.run.problem && has(o, "sphere") === 3 && near(size(o)?.[0] ?? 0, 20) && (size(o)?.[2] ?? 0) >= 34 && (size(o)?.[2] ?? 0) <= 44.5),
  c("table", "en", "a table: a top 100 by 60 and 5 thick, on four legs that are 5 by 5 and 40 tall", (o) => !o.run.problem && !!size(o) && near(size(o)![0], 100) && near(size(o)![1], 60) && near(size(o)![2], 45)),
  c("pyramid", "en", "make a pyramid with a 40mm-per-side square base and a height of 25 mm", (o) => sized(40, 40, 25)(o) && volume((40 * 40 * 25) / 3)(o)),
  c("wedge", "en", "a wedge 20 wide and 30 long, 10 high at one end sloping down to nothing at the other end", (o) => sized(20, 30, 10)(o) && volume(0.5 * 20 * 30 * 10)(o)),
  c("row", "en", "a row of 6 cylinders, radius 3 and height 10, with their centres 12 apart along x", (o) => sized(66, 6, 10)(o) && has(o, "repeat") >= 1),
  c("ring-of-posts", "en", "a ring of 8 posts, each a box 4 by 4 by 10, evenly spaced on a circle of radius 20 around the origin", (o) => !o.run.problem && !!size(o) && near(size(o)![0], 44, 0.08) && near(size(o)![1], 44, 0.08) && near(size(o)![2], 10) && near(o.run.combined!.volume(), 8 * 160, 0.02)),
  c("holes-row", "en", "a plate 100 by 30 by 5 with 5 holes of radius 3 in a row along its middle, 15 apart", (o) => !o.run.problem && !!size(o) && near(size(o)![0], 100) && near(o.run.combined!.volume(), 15000 - 5 * Math.PI * 9 * 5, 0.03)),
  // the newer parts of the language (scripts, if, mirror, ...)
  c("scripts", "en", "make a script called post that is a 4 by 4 box of a height I give it, and use it three times, with heights 10, 20 and 30, 15 apart along x", (o) => !o.run.problem && functions(o) >= 1 && has(o, "use") >= 3 && near(o.run.combined?.volume() ?? 0, 16 * 60, 0.03) && near(size(o)?.[0] ?? 0, 34, 0.05)),
  c("recursion", "en", "a tower of 4 cubes stacked on each other, 16 wide at the bottom and each one above half the width of the one below it, made with a script that uses itself", (o) => !o.run.problem && functions(o) >= 1 && has(o, "use") >= 2 && near(o.run.combined?.volume() ?? 0, 16 ** 3 + 8 ** 3 + 4 ** 3 + 2 ** 3, 0.03) && near(size(o)?.[2] ?? 0, 30, 0.04)),
  c("if-loop", "en", "6 posts, each 4 by 4, 10 apart along x, every other one 20 tall and the rest 8 tall", (o) => !o.run.problem && has(o, "repeat") >= 1 && has(o, "if") >= 1 && near(o.run.combined?.volume() ?? 0, 3 * 16 * 20 + 3 * 16 * 8, 0.03)),
  c("mirror", "en", "a wing: a box 30 by 8 by 2 whose near edge is 5 from the middle along x, and a mirror image of it on the other side", (o) => !o.run.problem && has(o, "mirror") >= 1 && sized(70, 8, 2)(o) && volume(960)(o)),
  c("measure", "en", "a plate 60 by 40 by 4, and a post of radius 3 standing on top of it whose height is half the plate's width: use measure to read the plate's size", (o) => !o.run.problem && has(o, "measure") >= 1 && sized(60, 40, 34)(o)),
  c("import", "en", "put the cube.stl part 30 along x, next to a sphere of radius 8", (o) => !o.run.problem && has(o, "import") >= 1 && volume(1000 + (4 / 3) * PI * 512, 0.03)(o), [], undefined, CUBE_STL),
  // modelling
  c("rounded-plate", "en", "a plate 60 by 40 by 5 with rounded corners of radius 6", (o) => sized(60, 40, 5)(o) && volume((60 * 40 - 4 * (36 - 9 * PI)) * 5, 0.02)(o)),
  c("hollow-box", "en", "a hollow box 40 by 30 by 20 with 2 mm walls, open at the top", (o) => sized(40, 30, 20)(o) && volume(40 * 30 * 20 - 36 * 26 * 18, 0.03)(o)),
  c("twist", "en", "a square bar 10 by 10 and 40 tall whose top is twisted a quarter turn (90 degrees) from its bottom", (o) => !o.run.problem && near(size(o)?.[2] ?? 0, 40) && near(o.run.combined?.volume() ?? 0, 4000, 0.06) && allBlocks(o.program).some((b) => b.kind === "extrude" && !!b.args.twist && b.args.twist !== "0")),
  c("taper", "en", "a pillar with a 20 mm square base, 30 tall, whose top is half as wide as its base", (o) => sized(20, 20, 30)(o) && volume(7000, 0.03)(o)),
  c("round-edges", "en", "a 20 mm cube with all of its edges rounded by 2 mm", (o) => sized(20, 20, 20)(o) && volume(7805, 0.02)(o) && allBlocks(o.program).some((b) => b.kind === "round")),
  c("text", "en", "a plate 60 by 20 and 3 thick with the word HELLO engraved into its top", (o) => !o.run.problem && allBlocks(o.program).some((b) => b.kind === "text") && (o.run.combined?.volume() ?? 0) < 60 * 20 * 3 && near(size(o)?.[2] ?? 0, 3)),
  c("loft", "en", "a vase that is a 30 mm square at the bottom and a circle of radius 10 at the top, 60 tall", (o) => !o.run.problem && allBlocks(o.program).some((b) => b.kind === "loft") && near(size(o)?.[2] ?? 0, 60)),
  c("sweep", "en", "a pipe of radius 4 that goes up 30 and then 20 along x", (o) => !o.run.problem && allBlocks(o.program).some((b) => b.kind === "sweep") && !!size(o) && size(o)![2] > 29),
  c("lid", "en", "a lid for a 50 by 35 box: 2 thick and 0.4 wider than the box on every side", (o) => !o.run.problem && (o.run.shapes.length >= 2 || !!o.run.combined) && !!size(o) && near(size(o)![0], 50.8, 0.03)),
  // "a post of height 30 standing on a base" reads as 30 above the base (35 in all) or as 30 in all, so both are accepted
  c("fillet", "en", "a round post of radius 5 and height 30 standing on a 50 by 50 by 5 base, with a fillet of 3 where they meet", (o) => !o.run.problem && allBlocks(o.program).some((b) => b.kind === "fillet") && [30, 35].some((h) => near(size(o)?.[2] ?? 0, h)) && (o.run.combined?.volume() ?? 0) > 12500 + Math.PI * 25 * 25 + 20),
  c("washer", "en", "a washer 2 thick with an outer radius of 10 and a hole of radius 4 through the middle", (o) => !o.run.problem && near(o.run.combined?.volume() ?? 0, (Math.PI * 100 - Math.PI * 16) * 2, 0.03) && near(size(o)?.[2] ?? 0, 2)),
  c("flat-draw", "en", "just draw, flat and not extruded, a 40 by 20 rectangle with a circle of radius 5 cut out of its middle", (o) => !o.run.problem && !o.run.combined && near(o.run.flat?.area() ?? 0, 800 - Math.PI * 25, 0.02)),
  // changing what is there
  c("holes-radius", "en", "make the holes radius 4", volume(PLATE_V - holes(4)), PLATE),
  c("plate-thicker", "en", "make the plate 8 thick", sized(40, 30, 8), PLATE),
  c("remove-holes", "en", "remove the holes", volume(PLATE_V), PLATE),
  c("rename", "en", "rename the plate to base", (o) => allBlocks(o.program).some((b) => b.args.name === "base") && !allBlocks(o.program).some((b) => b.args.name === "plate"), PLATE),
  c("plate-wider", "en", "make the plate 60 wide", (o) => !o.run.problem && !!size(o) && near(size(o)![0], 60), PLATE),
  c("cube-on-top", "en", "put a 10 mm cube on top of the plate and join them", (o) => !o.run.problem && !!size(o) && near(size(o)![2], 15), PLATE),
  c("move-up", "en", "move the plate up by 20", (o) => !o.run.problem && !!bounds(o) && near(bounds(o)!.min[2], 20) && near(size(o)![2], 5), PLATE),
  c("rotate", "en", "rotate the plate 90 degrees about x", sized(40, 5, 30), PLATE),
  c("hide", "en", "hide the plate", (o) => !o.run.problem && !o.run.combined, PLATE),
  c("clear", "en", "delete everything", (o) => isBlank(o.program), PLATE),
  c("double", "en", "make the plate twice as big in every direction", sized(80, 60, 10), PLATE),
  c("slide", "en", "move the plate 30 along x", (o) => !o.run.problem && !!bounds(o) && near(bounds(o)!.min[0], 10, 0.05) && near(bounds(o)!.min[1], -15, 0.05), PLATE),
  c("extra-hole", "en", "add a hole of radius 5 in the middle of the plate", volume(PLATE_V - holes(3) - PI * 25 * 5), PLATE),
  c("variable-edit", "en", "change width to 50", (o) => !o.run.problem && !!size(o) && near(size(o)![0], 50), BOXES),
  c("taller", "en", "make b twice as tall", sized(40, 20, 60), BOXES),
  c("stack", "en", "put b on top of a", sized(40, 20, 40), BOXES),
  c("subtract", "en", "subtract b from a and call the result cut", volume(40 * 20 * 10 - 1000), BOXES),
  // other languages
  c("es-box", "es", "Haz una caja de 20 por 30 por 10", sized(20, 30, 10)),
  c("es-cylinder", "es", "Un cilindro de radio 5 y altura 20", sized(10, 10, 20)),
  c("es-thicker", "es", "hazla de 8 de grosor", sized(40, 30, 8), PLATE),
  c("fr-cylinder", "fr", "Fais un cylindre de rayon 10 et de hauteur 5", sized(20, 20, 5)),
  c("de-sphere", "de", "Mach eine Kugel mit Radius 6", sized(12, 12, 12)),
  c("hi-box", "hi", "20 गुणा 30 गुणा 10 का एक डिब्बा बनाओ", sized(20, 30, 10)),
  c("hi-holes", "hi", "छेदों की त्रिज्या 4 कर दो", volume(PLATE_V - holes(4)), PLATE),
  c("hinglish-sphere", "hi-Latn", "ek sphere banao jiska radius 10 ho", sized(20, 20, 20)),
  c("ta-box", "ta", "20, 30, 10 அளவுள்ள ஒரு பெட்டி செய்", sized(20, 30, 10)),
  // conversation, and things that should not change anything
  c("followup", "en", "no, make it 30", sized(30, 30, 30), [], ["a cube, 20 on each side"]),
  c("followup-taller", "en", "make it taller, 25 in total", sized(10, 10, 25), [], ["a cylinder of radius 5 and height 10"]),
  c("question", "en", "what can you do?", (o) => o.ok && o.opCount === 0 && o.reply.length > 0, PLATE),
  c("vague", "en", "make it look nice", (o) => o.ok && !o.run.problem, PLATE),
];
