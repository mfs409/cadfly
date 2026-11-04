import type { Block, Program } from "./types";

/**
 * The examples: programs to start from, each one a complete, working design
 * that shows one idea. `DEMOS` lists them, in the order the editor offers them,
 * and each is made by a function here that builds its blocks with `builder`.
 * The tests run every one and check that it builds with nothing wrong.
 */

/** A program to start from: each one is a complete, working design. */
export interface Demo {
  /** What the example is called in the editor's list */
  name: string;
  /** What the example shows, in a sentence or two */
  description: string;
  /** The blocks of the example */
  program: Program;
}

/**
 * A maker of blocks, with its own count for their ids: the first it makes is
 * b1, the next b2, and so on, in the order they are written. Each example gets
 * its own, so its ids start at b1.
 *
 * The maker takes the kind of the block, its fields by parameter id (none by
 * default), and the blocks inside it if it holds others.
 */
function builder() {
  let n = 0;
  return (kind: string, args: Record<string, string | boolean> = {}, inner?: Block[]): Block => ({
    id: `b${++n}`,
    kind,
    args,
    ...(inner ? { inner } : {}),
  });
}

/**
 * The "Plate with holes" example: a rectangle with a hole near each corner, all
 * sized from variables at the top, so changing one number reshapes the plate.
 */
function plateWithHoles(): Program {
  const b = builder();
  // the plate is drawn about the middle, so a hole is `edge` in from each side:
  // that far from the middle, less the edge
  const hole = (u: string, v: string) => b("circle", { u, v, r: "hole", hole: true });
  return [
    b("set", { name: "width", value: "60" }),
    b("set", { name: "depth", value: "40" }),
    b("set", { name: "hole", value: "3" }),
    b("set", { name: "edge", value: "8" }),
    b("extrude", { name: "plate", plane: "XY", offset: "0", height: "4" }, [
      b("rectangle", { u: "0", v: "0", w: "width", h: "depth" }),
      hole("width / 2 - edge", "depth / 2 - edge"),
      hole("edge - width / 2", "depth / 2 - edge"),
      hole("width / 2 - edge", "edge - depth / 2"),
      hole("edge - width / 2", "edge - depth / 2"),
    ]),
  ];
}

/**
 * The "Bracket" example: a plate with a screw hole subtracted from it and a
 * wall standing on its back edge, joined into one part.
 */
function bracket(): Program {
  const b = builder();
  return [
    b("set", { name: "thick", value: "5" }),
    b("union", { name: "bracket" }, [
      b("subtract", { name: "base" }, [b("box", { name: "plate", w: "40", d: "30", h: "thick" }), b("cylinder", { name: "screw", r: "3", h: "20", y: "5" })]),
      // flush with the back edge of the plate (y = -15) and standing on top of
      // it
      b("box", { name: "wall", w: "40", d: "thick", h: "30", y: "thick / 2 - 15", z: "thick" }),
    ]),
  ];
}

/**
 * The "Cup" example: a polygon of points revolved all the way around the
 * axis.
 */
function cup(): Program {
  const b = builder();
  return [
    b("set", { name: "radius", value: "15" }),
    b("set", { name: "wall", value: "2" }),
    b("revolve", { name: "cup", plane: "XZ", offset: "0", angle: "360" }, [
      b("polygon", {}, [
        b("point", { u: "0", v: "0" }),
        b("point", { u: "radius", v: "0" }),
        b("point", { u: "radius", v: "30" }),
        b("point", { u: "radius - wall", v: "30" }),
        b("point", { u: "radius - wall", v: "wall" }),
        b("point", { u: "0", v: "wall" }),
      ]),
    ]),
  ];
}

/**
 * The "Snowman" example: spheres moved up one above the other by sums of the
 * variables, and a cone for a nose.
 */
function snowman(): Program {
  const b = builder();
  return [
    b("set", { name: "body", value: "12" }),
    b("set", { name: "middle", value: "8" }),
    b("set", { name: "head", value: "5" }),
    b("set", { name: "overlap", value: "2" }),
    // each ball sits on the one below, sunk in by overlap so they join
    b("set", { name: "middleZ", value: "2 * body - overlap" }),
    b("set", { name: "headZ", value: "middleZ + 2 * middle - overlap" }),
    b("union", { name: "snowman" }, [
      b("sphere", { name: "body", r: "body" }),
      b("sphere", { name: "middle", r: "middle", z: "middleZ" }),
      b("sphere", { name: "head", r: "head", z: "headZ" }),
      // a cone (a cylinder with a top radius of 0) turned to point at the
      // viewer, standing in front of the middle of the face
      b("transform", { y: "overlap - head", z: "headZ + head" }, [b("transform", { rx: "90" }, [b("cylinder", { name: "nose", r: "1.2", top: "0", h: "6" })])]),
    ]),
  ];
}

/**
 * The "Row of holes" example: a repeat block makes each hole of a row, spaced
 * by a gap.
 */
function rowOfHoles(): Program {
  const b = builder();
  return [
    b("set", { name: "holes", value: "5" }),
    b("set", { name: "gap", value: "12" }),
    b("subtract", { name: "strip" }, [
      b("box", { name: "bar", w: "holes * gap + gap", d: "20", h: "4" }),
      b("repeat", { times: "holes", counter: "i" }, [
        // the first hole is half a gap in from the left end, and each next one
        // a gap further along
        b("cylinder", { name: "hole", r: "3", h: "10", x: "(i - (holes - 1) / 2) * gap" }),
      ]),
    ]),
  ];
}

/**
 * The "Ring of posts" example: a repeat block turns each post a little further
 * round the middle.
 */
function ringOfPosts(): Program {
  const b = builder();
  return [
    b("set", { name: "count", value: "8" }),
    b("set", { name: "radius", value: "20" }),
    b("union", { name: "ring" }, [
      b("cylinder", { name: "disc", r: "radius + 4", h: "2" }),
      b("repeat", { times: "count", counter: "i" }, [
        // a post out at x = radius, sunk a little into the disc, turned round
        // the middle by a whole number of steps
        b("transform", { rz: "i * 360 / count" }, [b("cylinder", { name: "post", r: "2", h: "10", x: "radius", z: "1" })]),
      ]),
    ]),
  ];
}

/**
 * The "Table with legs" example: a leg is a part (`define`), made once and
 * used four times.
 */
function tableWithLegs(): Program {
  const b = builder();
  return [
    b("set", { name: "topW", value: "100" }),
    b("set", { name: "topD", value: "60" }),
    b("set", { name: "topT", value: "5" }),
    b("set", { name: "legH", value: "40" }),
    b("set", { name: "inset", value: "5" }),
    // a part: written once, used four times with a different corner each time
    b("define", { name: "leg", inputs: "x, y" }, [b("box", { name: "leg", w: "5", d: "5", h: "legH", x: "x", y: "y" })]),
    b("union", { name: "table" }, [
      b("box", { name: "top", w: "topW", d: "topD", h: "topT", z: "legH" }),
      b("use", { name: "leg", values: "topW / 2 - inset, topD / 2 - inset" }),
      b("use", { name: "leg", values: "inset - topW / 2, topD / 2 - inset" }),
      b("use", { name: "leg", values: "topW / 2 - inset, inset - topD / 2" }),
      b("use", { name: "leg", values: "inset - topW / 2, inset - topD / 2" }),
    ]),
  ];
}

/**
 * The "Stairs" example: a repeat block builds each step, using its counter `i`
 * for how high and how far along the step is.
 */
function stairs(): Program {
  const b = builder();
  return [
    b("set", { name: "steps", value: "6" }),
    b("set", { name: "rise", value: "10" }),
    b("set", { name: "run", value: "25" }),
    b("union", { name: "stairs" }, [
      b("repeat", { times: "steps", counter: "i" }, [
        // step number i is as high as its number says, and one step further
        // along than the last
        b("box", { name: "step", w: "60", d: "run", h: "rise * (i + 1)", y: "i * run" }),
      ]),
    ]),
  ];
}

/**
 * The "Tree" example: a branch (`define`) that uses itself, smaller each time,
 * until its count runs out.
 */
function tree(): Program {
  const b = builder();
  return [
    // a branch is a trunk with two smaller branches on top, until there are
    // none left: the if is the way it stops
    b("define", { name: "branch", inputs: "len, n" }, [
      b("cylinder", { name: "trunk", r: "len / 10", h: "len" }),
      b("if", { condition: "n > 1" }, [
        b("transform", { z: "len" }, [
          b("transform", { ry: "25" }, [b("use", { name: "branch", values: "len * 0.7, n - 1" })]),
          b("transform", { ry: "-25" }, [b("use", { name: "branch", values: "len * 0.7, n - 1" })]),
        ]),
      ]),
    ]),
    b("use", { name: "branch", values: "30, 4" }),
  ];
}

/**
 * The "Wing" example: only one half is built, and a mirror adds the other.
 */
function wing(): Program {
  const b = builder();
  return [
    b("set", { name: "span", value: "30" }),
    b("mirror", { axis: "x", both: true }, [
      // only the right-hand half is built: the mirror makes the left
      b("box", { name: "half", w: "span", d: "8", h: "2", x: "5 + span / 2" }),
    ]),
  ];
}

/**
 * The "Open box" example: a box whose edges are rounded, then hollowed with
 * the top left open.
 */
function openBox(): Program {
  const b = builder();
  return [
    b("set", { name: "wall", value: "2" }),
    // the box's edges are rounded first, then it is hollowed out with the top
    // left open
    b("shell", { thickness: "wall", open: "top" }, [b("round", { radius: "1.5" }, [b("box", { name: "box", w: "50", d: "35", h: "25" })])]),
  ];
}

/**
 * The "Twisted tower" example: an extrude whose top is turned and made
 * narrower than its bottom.
 */
function twistedTower(): Program {
  const b = builder();
  return [
    b("set", { name: "turn", value: "90" }),
    b("set", { name: "narrowing", value: "0.5" }),
    // the top turns by `turn` degrees and ends `narrowing` times as wide as the
    // bottom
    b("extrude", { name: "tower", plane: "XY", offset: "0", height: "60", twist: "turn", taper: "narrowing" }, [b("rectangle", { u: "0", v: "0", w: "20", h: "20", corner: "3" })]),
  ];
}

/**
 * The "Rounded plate" example: a rectangle with rounded corners and a screw
 * hole near each corner, found from the number of the repeat pass.
 */
function roundedPlate(): Program {
  const b = builder();
  return [
    b("set", { name: "corner", value: "8" }),
    b("extrude", { name: "plate", plane: "XY", offset: "0", height: "5" }, [
      b("rectangle", { u: "0", v: "0", w: "70", h: "45", corner: "corner" }),
      // a hole near each corner, found from the number of the pass: left or
      // right, then back or front
      b("repeat", { times: "4", counter: "i" }, [b("circle", { u: "((i % 2) * 2 - 1) * (35 - corner - 3)", v: "(floor(i / 2) * 2 - 1) * (22.5 - corner - 3)", r: "2", hole: true })]),
    ]),
  ];
}

/**
 * The "Name plate" example: a plate with a name engraved in it, by a text
 * block marked as a hole.
 */
function namePlate(): Program {
  const b = builder();
  return [
    b("set", { name: "size", value: "10" }),
    // the letters are cut out of the plate (hole), so the plate shows them
    // engraved
    b("extrude", { name: "plate", plane: "XY", offset: "0", height: "3" }, [
      b("rectangle", { u: "0", v: "0", w: "70", h: "20", corner: "3" }),
      b("text", { text: "HELLO", u: "0", v: "0", size: "size", hole: true }),
    ]),
  ];
}

/**
 * The "Vase" example: a loft that blends a rounded square at the bottom into
 * a circle at the top.
 */
function vase(): Program {
  const b = builder();
  return [
    b("set", { name: "height", value: "60" }),
    // a loft blends the bottom outline into the top one: here a square becomes
    // a circle
    b("loft", { name: "vase", plane: "XY", offset: "0", height: "height" }, [
      b("bottom", {}, [b("rectangle", { u: "0", v: "0", w: "30", h: "30", corner: "4" })]),
      b("top", {}, [b("circle", { u: "0", v: "0", r: "10" })]),
    ]),
  ];
}

/**
 * The "Pipe" example: a circle swept along a path of vertex points.
 */
function pipe(): Program {
  const b = builder();
  return [
    // a sweep carries the outline along the path of vertex points
    b("sweep", { name: "pipe" }, [
      b("circle", { u: "0", v: "0", r: "4" }),
      b("vertex", { x: "0", y: "0", z: "0" }),
      b("vertex", { x: "0", y: "0", z: "30" }),
      b("vertex", { x: "30", y: "0", z: "50" }),
      b("vertex", { x: "30", y: "30", z: "50" }),
    ]),
  ];
}

/**
 * The "Tray and lid" example: a tray, and a lid sized from it by a measure
 * block, which turns the tray's size into variables.
 */
function trayAndLid(): Program {
  const b = builder();
  return [
    b("set", { name: "margin", value: "0.4" }),
    // measure gives the size of what is inside it as variables (tray_w, tray_d,
    // tray_h), for the blocks below it
    b("measure", { name: "tray" }, [b("shell", { thickness: "2", open: "top" }, [b("box", { name: "tray", w: "50", d: "35", h: "15" })])]),
    b("box", { name: "lid", w: "tray_w + 2 * margin", d: "tray_d + 2 * margin", h: "2", z: "tray_h" }),
  ];
}

/**
 * The "Hollow vase" example: the vase hollowed by a shell block, with the
 * mouth left open.
 */
function hollowVase(): Program {
  const b = builder();
  return [
    b("set", { name: "wall", value: "2" }),
    // shell hollows what is inside it, and open=top leaves the mouth of the
    // vase open
    b("shell", { thickness: "wall", open: "top" }, [
      b("loft", { name: "vase", plane: "XY", offset: "0", height: "60" }, [
        b("bottom", {}, [b("rectangle", { u: "0", v: "0", w: "30", h: "30", corner: "4" })]),
        b("top", {}, [b("circle", { u: "0", v: "0", r: "10" })]),
      ]),
    ]),
  ];
}

/**
 * The "Hollow pipe" example: a thin sweep subtracted from a thick one, running
 * a little past each end so that the pipe is open.
 */
function hollowPipe(): Program {
  const b = builder();
  const path = (...points: [string, string, string][]) => points.map(([x, y, z]) => b("vertex", { x, y, z }));
  return [
    b("set", { name: "outer", value: "4" }),
    b("set", { name: "wall", value: "1.5" }),
    // the pipe is a thick sweep with a thinner one cut out of it; the thin one
    // starts and ends a little beyond the pipe so both ends are open
    b("subtract", { name: "pipe" }, [
      b("sweep", {}, [b("circle", { u: "0", v: "0", r: "outer" }), ...path(["0", "0", "0"], ["0", "0", "30"], ["30", "0", "50"], ["30", "30", "50"])]),
      b("sweep", {}, [b("circle", { u: "0", v: "0", r: "outer - wall" }), ...path(["0", "0", "-1"], ["0", "0", "30"], ["30", "0", "50"], ["30", "31", "50"])]),
    ]),
  ];
}

/**
 * The "Etched text" example: letters that start below the top of a plate and
 * are subtracted, so they are cut in without going through.
 */
function etchedText(): Program {
  const b = builder();
  return [
    b("set", { name: "thick", value: "3" }),
    b("set", { name: "depth", value: "1" }),
    // the letters are an extrude of their own that starts depth below the top
    // of the plate and goes up through it: subtract cuts them in, and the rest
    // of the plate is left
    b("subtract", { name: "etched plate" }, [
      b("extrude", { name: "plate", plane: "XY", offset: "0", height: "thick" }, [b("rectangle", { u: "0", v: "0", w: "70", h: "20", corner: "3" })]),
      b("extrude", { name: "letters", plane: "XY", offset: "thick - depth", height: "depth + 1" }, [b("text", { text: "HELLO", u: "0", v: "0", size: "10" })]),
    ]),
  ];
}

/**
 * The "Raised text" example: letters that start on top of a plate and are
 * joined to it, standing up from the surface.
 */
function raisedText(): Program {
  const b = builder();
  return [
    b("set", { name: "thick", value: "3" }),
    b("set", { name: "raise", value: "1" }),
    // the letters are an extrude that starts on top of the plate (offset =
    // thick); union joins them to it
    b("union", { name: "raised text plate" }, [
      b("extrude", { name: "plate", plane: "XY", offset: "0", height: "thick" }, [b("rectangle", { u: "0", v: "0", w: "70", h: "20", corner: "3" })]),
      b("extrude", { name: "letters", plane: "XY", offset: "thick", height: "raise" }, [b("text", { text: "HELLO", u: "0", v: "0", size: "10" })]),
    ]),
  ];
}

/**
 * The "Washer" example: a flat circle with a smaller one subtracted from its
 * middle (an area, so the cut is a hole), then extruded.
 */
function washer(): Program {
  const b = builder();
  return [
    b("set", { name: "outer", value: "10" }),
    b("set", { name: "inner", value: "4" }),
    // draw it flat first: the big circle with the small one cut out of its
    // middle (an area, so the cut is a hole), then give it thickness
    b("extrude", { name: "washer", plane: "XY", offset: "0", height: "2" }, [b("subtract", {}, [b("circle", { u: "0", v: "0", r: "outer" }), b("circle", { u: "0", v: "0", r: "inner" })])]),
  ];
}

/**
 * The "Flat plate" example: an outline drawn flat first (a rectangle joined to
 * a circle, two holes cut out, the corners rounded), then extruded.
 */
function flatPlate(): Program {
  const b = builder();
  return [
    b("set", { name: "thick", value: "4" }),
    // the outline is drawn in 2D: a rectangle joined to a circle, two holes cut
    // out, and the outside corners rounded; the extrude comes last
    b("extrude", { name: "hook plate", plane: "XY", offset: "0", height: "thick" }, [
      b("round", { radius: "3" }, [
        b("subtract", {}, [
          b("union", {}, [b("rectangle", { u: "0", v: "0", w: "60", h: "30" }), b("circle", { u: "30", v: "0", r: "15" })]),
          b("circle", { u: "-20", v: "0", r: "4" }),
          b("circle", { u: "30", v: "0", r: "5" }),
        ]),
      ]),
    ]),
  ];
}

/**
 * The "Post and base" example: a post on a base with a fillet where they
 * join, and screw holes cut afterwards so the fillet does not fill them in.
 */
function postAndBase(): Program {
  const b = builder();
  return [
    b("set", { name: "foot", value: "4" }),
    // the fillet goes round only the two shapes that join; the screw holes are
    // cut afterwards, because a hole smaller than the fillet (these are radius
    // 3, the fillet 4) would be filled in if it were inside the fillet block
    b("subtract", { name: "post and base" }, [
      b("fillet", { radius: "foot" }, [
        b("union", {}, [b("box", { name: "base", w: "60", d: "60", h: "6" }), b("cylinder", { name: "post", r: "8", h: "30" })]),
      ]),
      b("cylinder", { name: "screw", r: "3", h: "10", x: "22", y: "22" }),
      b("cylinder", { name: "screw", r: "3", h: "10", x: "-22", y: "-22" }),
    ]),
  ];
}

/**
 * The "Pyramid" example: a solid with vertices and no faces, which is the
 * smallest convex shape around its points.
 */
function pyramid(): Program {
  const b = builder();
  const v = (x: string, y: string, z: string) => b("vertex", { x, y, z });
  return [
    b("set", { name: "side", value: "40" }),
    b("set", { name: "tall", value: "25" }),
    // only vertices, and no faces: the solid is the smallest convex shape
    // around its five points (each vertex has its number on it)
    b("solid", { name: "pyramid" }, [
      b("vertices", {}, [v("-side / 2", "-side / 2", "0"), v("side / 2", "-side / 2", "0"), v("side / 2", "side / 2", "0"), v("-side / 2", "side / 2", "0"), v("0", "0", "tall")]),
      b("faces", {}),
    ]),
  ];
}

/**
 * The "House" example: a solid with faces, which makes it exactly those faces:
 * a house with a gabled roof (10 vertices, 7 faces).
 */
function house(): Program {
  const b = builder();
  const v = (x: string, y: string, z: string) => b("vertex", { x, y, z });
  const f = (corners: string) => b("face", { corners });
  return [
    b("set", { name: "wall", value: "20" }),
    b("set", { name: "roof", value: "30" }),
    // with faces in the second section the solid is exactly those faces, so a
    // notch or a gable is possible (a hull would fill it in). Vertices 1 to 4
    // are the floor, 5 to 8 the tops of the walls, 9 and 10 the two ends of the
    // ridge of the roof. Take a face out and the solid has a gap, and says so.
    b("solid", { name: "house" }, [
      b("vertices", {}, [v("-15", "-10", "0"), v("15", "-10", "0"), v("15", "10", "0"), v("-15", "10", "0"), v("-15", "-10", "wall"), v("15", "-10", "wall"), v("15", "10", "wall"), v("-15", "10", "wall"), v("-15", "0", "roof"), v("15", "0", "roof")]),
      b("faces", {}, [f("1 4 3 2"), f("1 2 6 5"), f("3 4 8 7"), f("1 5 9 8 4"), f("2 3 7 10 6"), f("5 6 10 9"), f("8 9 10 7")]),
    ]),
  ];
}

/**
 * The "Star" example: a three-dimensional star, made from vertices and faces
 * because it has notches that a convex hull would fill in.
 */
function star(): Program {
  const b = builder();
  const v = (x: string, y: string, z: string) => b("vertex", { x, y, z });
  const f = (corners: string) => b("face", { corners });
  // a three-dimensional star: an octahedron (vertices 1 to 6, one on each axis)
  // with a spike on each of its eight faces (vertices 7 to 14, one at each
  // corner of the cube around it). It has notches between the spikes, so it is
  // not a convex hull, and it is not an extrusion every face is listed
  // counterclockwise as seen from outside, so its outside is the solid side in
  // the 3D view: a spike that is a mirror image of the first (an odd number of
  // minus signs in its corner) goes round the other way
  const spike = (apex: number, x: number, y: number, z: number, mirrored = false) => (mirrored ? [`${apex} ${y} ${x}`, `${apex} ${z} ${y}`, `${apex} ${x} ${z}`] : [`${apex} ${x} ${y}`, `${apex} ${y} ${z}`, `${apex} ${z} ${x}`]).map(f);
  return [
    b("set", { name: "core", value: "10" }),
    b("set", { name: "tip", value: "20" }),
    b("solid", { name: "star" }, [
      b("vertices", {}, [
        v("core", "0", "0"), v("-core", "0", "0"), v("0", "core", "0"), v("0", "-core", "0"), v("0", "0", "core"), v("0", "0", "-core"),
        v("tip", "tip", "tip"), v("tip", "tip", "-tip"), v("tip", "-tip", "tip"), v("tip", "-tip", "-tip"),
        v("-tip", "tip", "tip"), v("-tip", "tip", "-tip"), v("-tip", "-tip", "tip"), v("-tip", "-tip", "-tip"),
      ]),
      // each spike is three triangles from its tip to the three corners of the
      // octahedron's face it stands on
      b("faces", {}, [...spike(7, 1, 3, 5), ...spike(8, 1, 3, 6, true), ...spike(9, 1, 4, 5, true), ...spike(10, 1, 4, 6), ...spike(11, 2, 3, 5, true), ...spike(12, 2, 3, 6), ...spike(13, 2, 4, 5), ...spike(14, 2, 4, 6, true)]),
    ]),
  ];
}

/** The examples, in the order the editor lists them */
export const DEMOS: readonly Demo[] = [
  { name: "Plate with holes", description: "Change width, depth, hole or edge at the top and the whole plate follows.", program: plateWithHoles() },
  { name: "Bracket", description: "A plate with a screw hole subtracted, a wall standing on it, and the whole thing set on the ground.", program: bracket() },
  { name: "Cup", description: "A polygon revolved all the way around.", program: cup() },
  { name: "Open box", description: "shell hollows a box and leaves the top open; round takes the edges off.", program: openBox() },
  { name: "Twisted tower", description: "An extrude can twist (turn its top) and taper (shrink it): change turn and narrowing.", program: twistedTower() },
  { name: "Washer", description: "A flat shape with one circle cut out of another (subtract works on areas), then extruded.", program: washer() },
  { name: "Flat plate", description: "Drawn in 2D first: a rectangle joined to a circle, two holes subtracted, corners rounded; only then extruded.", program: flatPlate() },
  { name: "Rounded plate", description: "The rectangle's corner field rounds it; a repeat puts a screw hole near each corner.", program: roundedPlate() },
  { name: "Name plate", description: "A text block writes the name; with hole on the letters are engraved into the plate.", program: namePlate() },
  { name: "Vase", description: "A loft blends one outline into another: a rounded square becomes a circle.", program: vase() },
  { name: "Post and base", description: "fillet puts a curve where the post meets the base (change foot); the screw holes are cut after it, so it does not fill them in.", program: postAndBase() },
  { name: "Pyramid", description: "A solid with vertices and no faces is the smallest convex shape around its points: change side or tall.", program: pyramid() },
  { name: "Star", description: "A 3D star: an octahedron with a spike on each face (14 vertices, 24 triangular faces). It needs its faces: a hull of the points would fill in the notches, and it is no extrusion. Change core and tip.", program: star() },
  { name: "House", description: "Faces in the solid's second section make it exactly those faces: a house with a gabled roof (10 vertices, 7 faces).", program: house() },
  { name: "Hollow vase", description: "shell hollows the loft, and open=top leaves the mouth open: change wall for thicker or thinner sides.", program: hollowVase() },
  { name: "Pipe", description: "A sweep carries a circle along a path of vertex points.", program: pipe() },
  { name: "Hollow pipe", description: "A thinner sweep is subtracted from a thicker one, running a little past each end so the pipe is open.", program: hollowPipe() },
  { name: "Etched text", description: "The letters start depth below the top of the plate, so subtract cuts them in without going through.", program: etchedText() },
  { name: "Raised text", description: "The letters start on top of the plate (offset = thick) and union joins them: change raise for taller letters.", program: raisedText() },
  { name: "Tray and lid", description: "measure turns a shape's size into variables, so the lid is sized from the tray.", program: trayAndLid() },
  { name: "Table with legs", description: "A leg is a part, defined once and used four times: change the numbers at the top.", program: tableWithLegs() },
  { name: "Stairs", description: "A repeat block builds each step; the counter i says how high it is.", program: stairs() },
  { name: "Tree", description: "A branch uses itself, smaller each time, until n runs out: the if is how it stops.", program: tree() },
  { name: "Wing", description: "Only one half is built; mirror, with both on, adds the other.", program: wing() },
  { name: "Row of holes", description: "A repeat block makes the holes; change holes or gap at the top.", program: rowOfHoles() },
  { name: "Ring of posts", description: "A repeat block turns each post a little further round the middle.", program: ringOfPosts() },
  { name: "Snowman", description: "Spheres moved up one above the other by sums, and a cone for a nose.", program: snowman() },
];
