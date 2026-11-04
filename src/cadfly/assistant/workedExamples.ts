import type { Program } from "../language/types";
import { type NewBlock, type Op, applyOps } from "./ops";

/**
 * Worked examples shown to the model. Each is a request, the program it was
 * made against, and the reply a good model gives. The tests apply every one,
 * so an example can never teach something that does not work.
 */
export interface WorkedExample {
  program: Program;
  user: string;
  ops: Op[];
  reply: string;
}

const block = (kind: string, args: Record<string, string | boolean> = {}, inner?: NewBlock[]): NewBlock => ({ kind, args, ...(inner ? { inner } : {}) });
const append = (...blocks: NewBlock[]): Op => ({ op: "append", blocks });
const hole = (u: string, v: string) => block("circle", { u, v, r: "3", hole: true });
const vertex = (x: string, y: string, z: string) => block("vertex", { x, y, z });
const point = (u: string, v: string) => block("point", { u, v });

const makePlate: Op[] = [
  append(block("extrude", { name: "plate", height: "5" }, [block("rectangle", { w: "40", h: "30" }), hole("-12", "-7"), hole("12", "-7"), hole("-12", "7"), hole("12", "7")])),
];

const build = (ops: Op[]): Program => applyOps([], ops).program;
/** The plate: block b1, with its pieces b2 (the rectangle) and b3 to b6 (the holes) */
const plate = (): Program => build(makePlate);
const cube = (): Program => build([append(block("box", { name: "cube", w: "20", d: "20", h: "20" }))]);
const blockAndPin = (): Program => build([append(block("box", { name: "block", w: "30", d: "30", h: "10" }), block("cylinder", { name: "pin", r: "4", h: "20" }))]);

export const WORKED_EXAMPLES: WorkedExample[] = [
  {
    program: [],
    user: "a 40 by 30 plate, 5 thick, with a hole of radius 3 near each corner",
    ops: makePlate,
    reply: "Made a 40 by 30 plate, 5 thick, with four holes of radius 3.",
  },
  {
    program: plate(),
    user: "make the holes radius 4",
    ops: ["b3", "b4", "b5", "b6"].map((b) => ({ op: "set", block: b, field: "r", value: "4" }) as Op),
    reply: "Changed the four holes to radius 4.",
  },
  {
    // a new shape sits on the ground, so z is how high its bottom is: the plate is 5 thick
    program: plate(),
    user: "put a 10 mm cube on top of the plate",
    ops: [append(block("box", { name: "cube", w: "10", d: "10", h: "10", z: "5" }))],
    reply: "Put a 10 mm cube on top of the plate.",
  },
  {
    program: plate(),
    user: "move the plate up by 20",
    ops: [{ op: "wrap", blocks: ["b1"], holder: { kind: "transform", args: { z: "20" } } }],
    reply: "Moved the plate up by 20.",
  },
  {
    program: [],
    user: "a box 40 wide, 30 deep and 10 high",
    ops: [append(block("box", { w: "40", d: "30", h: "10" }))],
    reply: "Made a box 40 wide, 30 deep and 10 high.",
  },
  {
    // the cylinder is taller than the block and sits on the ground like it, so it goes all the way through
    program: [],
    user: "a block 40 by 40 by 10 with a hole of radius 5 through its middle",
    ops: [append(block("subtract", {}, [block("box", { w: "40", d: "40", h: "10" }), block("cylinder", { r: "5", h: "20" })]))],
    reply: "Made a 40 by 40 by 10 block with a hole of radius 5 through the middle.",
  },
  {
    // a flat shape is a shape of its own: it can be cut, joined and moved before it is extruded
    program: [],
    user: "a flat washer, outer radius 10 and a hole of radius 4, not extruded yet",
    ops: [append(block("subtract", {}, [block("circle", { r: "10" }), block("circle", { r: "4" })]))],
    reply: "Drew a flat washer: a circle of radius 10 with a circle of radius 4 cut out.",
  },
  {
    program: [],
    user: "a hollow box 40 by 30 by 20 with 2 mm walls, open at the top",
    ops: [append(block("shell", { thickness: "2", open: "top" }, [block("box", { name: "box", w: "40", d: "30", h: "20" })]))],
    reply: "Made a box 40 by 30 by 20 with 2 mm walls, open at the top.",
  },
  {
    program: [],
    user: "a plate 60 by 40 by 5 with rounded corners, radius 6",
    ops: [append(block("extrude", { name: "plate", height: "5" }, [block("rectangle", { w: "60", h: "40", corner: "6" })]))],
    reply: "Made a 60 by 40 plate, 5 thick, with corners of radius 6.",
  },
  {
    // both shapes go inside the fillet, so it rounds the corner where the pin meets the block
    program: blockAndPin(),
    user: "put a fillet of radius 2 where the pin meets the block",
    ops: [{ op: "wrap", blocks: ["b1", "b2"], holder: { kind: "fillet", args: { radius: "2" } } }],
    reply: "Put a fillet of radius 2 where the pin meets the block.",
  },
  {
    program: cube(),
    user: "round the edges of the cube by 2",
    ops: [{ op: "wrap", blocks: ["b1"], holder: { kind: "round", args: { radius: "2" } } }],
    reply: "Rounded the edges of the cube by 2.",
  },
  {
    program: plate(),
    user: "hide the plate",
    ops: [{ op: "set", block: "b1", field: "hidden", value: "true" }],
    reply: "Hid the plate.",
  },
  {
    program: [],
    user: "a cylinder with radius 5 and a height of 20",
    ops: [append(block("cylinder", { name: "cylinder", r: "5", h: "20" }))],
    reply: "Made a cylinder with radius 5 and height 20.",
  },
  {
    // z is how high the bottom of a shape is: the body is 20 high, and the head is sunk 2 into it so they join
    program: [],
    user: "a sphere of radius 10 with a smaller sphere of radius 6 sitting on top of it",
    ops: [append(block("union", { name: "snowman" }, [block("sphere", { name: "body", r: "10" }), block("sphere", { name: "head", r: "6", z: "18" })]))],
    reply: "Made a sphere of radius 10 with a sphere of radius 6 on top.",
  },
  {
    program: [],
    user: "two 10 mm cubes side by side along x, touching",
    ops: [append(block("placeAgainst", { axis: "x", side: "high" }, [block("box", { name: "left", w: "10", d: "10", h: "10" }), block("box", { name: "right", w: "10", d: "10", h: "10" })]))],
    reply: "Made two 10 mm cubes side by side along x.",
  },
  {
    program: plate(),
    user: "add a hole of radius 5 in the middle",
    ops: [{ op: "insert_into", block: "b1", blocks: [block("circle", { u: "20", v: "15", r: "5", hole: true })] }],
    reply: "Added a hole of radius 5 in the middle of the plate.",
  },
  {
    program: [],
    user: "a pyramid with a square base 40 on each side and a height of 25",
    ops: [append(block("solid", { name: "pyramid" }, [block("vertices", {}, [vertex("-20", "-20", "0"), vertex("20", "-20", "0"), vertex("20", "20", "0"), vertex("-20", "20", "0"), vertex("0", "0", "25")]), block("faces", {})]))],
    reply: "Made a pyramid with a 40 by 40 base and a height of 25.",
  },
  {
    program: blockAndPin(),
    user: "cut the pin out of the block",
    ops: [{ op: "wrap", blocks: ["b1", "b2"], holder: { kind: "subtract", args: { name: "cut" } } }],
    reply: "Cut the pin out of the block.",
  },
  {
    program: cube(),
    user: "no, make it 30",
    ops: ["w", "d", "h"].map((field) => ({ op: "set", block: "b1", field, value: "30" }) as Op),
    reply: "Made the cube 30 on every side.",
  },
  {
    program: plate(),
    user: "what can you do?",
    ops: [],
    reply: "I can make boxes, cylinders, cones (a cylinder with a smaller top), spheres and sketched shapes, change them, move them and combine them.",
  },
  {
    // the counter i starts at 0 and goes up by one each time round
    program: [],
    user: "a row of 6 cylinders, radius 3 and height 10, with their centres 12 apart along x",
    ops: [append(block("repeat", { times: "6", counter: "i" }, [block("cylinder", { name: "post", r: "3", h: "10", x: "i * 12" })]))],
    reply: "Made a row of 6 cylinders, 12 apart along x.",
  },
  {
    program: [],
    user: "a right triangle with legs 20 and 10, extruded 8 high",
    ops: [append(block("extrude", { name: "triangle", height: "8" }, [block("polygon", {}, [point("0", "0"), point("20", "0"), point("0", "10")])]))],
    reply: "Made a right triangle with legs 20 and 10, 8 high.",
  },
  {
    // a part is defined once and used four times; the first block makes nothing by itself
    program: [],
    user: "a table: a top 100 by 60 and 5 thick on four legs, 5 by 5 and 40 tall",
    ops: [
      append(
        block("define", { name: "leg", inputs: "x, y" }, [block("box", { name: "leg", w: "5", d: "5", h: "40", x: "x", y: "y" })]),
        block("union", { name: "table" }, [
          block("box", { name: "top", w: "100", d: "60", h: "5", z: "40" }),
          block("use", { name: "leg", values: "45, 25" }),
          block("use", { name: "leg", values: "-45, 25" }),
          block("use", { name: "leg", values: "45, -25" }),
          block("use", { name: "leg", values: "-45, -25" }),
        ]),
      ),
    ],
    reply: "Made a table: a leg part, used four times under the top.",
  },
  {
    program: [],
    user: "a row of 6 posts 10 apart, every other one taller",
    ops: [
      append(
        block("repeat", { times: "6", counter: "i" }, [
          block("if", { condition: "i % 2 == 0" }, [block("box", { name: "tall", w: "4", d: "4", h: "20", x: "i * 10" }), block("else", {}, [block("box", { name: "short", w: "4", d: "4", h: "8", x: "i * 10" })])]),
        ]),
      ),
    ],
    reply: "Made a row of 6 posts, every other one taller.",
  },
  {
    program: [],
    user: "a 60 by 20 plate, 3 thick, with the word HI engraved in it",
    ops: [append(block("extrude", { name: "plate", height: "3" }, [block("rectangle", { w: "60", h: "20" }), block("text", { text: "HI", size: "10", hole: true })]))],
    reply: "Made a 60 by 20 plate with HI engraved in it.",
  },
  {
    program: [],
    user: "a box 30 by 8 by 2 starting 5 out along x, with a mirror image on the other side",
    ops: [append(block("mirror", { axis: "x", both: true }, [block("box", { name: "wing", w: "30", d: "8", h: "2", x: "20" })]))],
    reply: "Made a wing on each side of the middle.",
  },
];
