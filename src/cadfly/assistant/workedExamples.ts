import type { Program } from "../language/types";
import { type Op, applyOps } from "./ops";

/**
 * The worked examples the model is shown. Each is a request, the program it was
 * made against, and the reply a good model gives: the ops, written as block
 * text exactly as the model must write them, and a sentence for the person.
 * The programs are built by applying ops, so an example can never teach
 * something that does not work.
 */

/** One worked example. The tests apply every one. */
export interface WorkedExample {
  /** The program the request is made against */
  program: Program;
  /** The request */
  user: string;
  /** The ops a good model replies with */
  ops: Op[];
  /** What a good model says to the person */
  reply: string;
}

/** An op that adds blocks at the end of `build`, given as block text. */
const append = (blocks: string): Op => ({ op: "append", blocks });

/** Ops that set one field to one value on each of the blocks. */
const setEach = (blocks: string[], field: string, value: string): Op[] => blocks.map((block) => ({ op: "set", block, field, value }));

/** The ops that make the plate: 40 by 30, 5 thick, a hole of radius 3 near each corner. */
const makePlate: Op[] = [
  append(
    [
      "extrude name=plate height=5",
      "  rectangle w=40 h=30",
      "  circle u=-12 v=-7 r=3 hole",
      "  circle u=12 v=-7 r=3 hole",
      "  circle u=-12 v=7 r=3 hole",
      "  circle u=12 v=7 r=3 hole",
    ].join("\n"),
  ),
];

/** The program that these ops make from nothing. */
const build = (ops: Op[]): Program => applyOps([], ops).program;
/** The plate: block b1, with its pieces b2 (the rectangle) and b3 to b6 (the holes) */
const plate = (): Program => build(makePlate);
/** A program with one 20 mm cube. */
const cube = (): Program => build([append("box name=cube w=20 d=20 h=20")]);
/** A program with a block and a pin standing in it, side by side as built. */
const blockAndPin = (): Program => build([append("box name=block w=30 d=30 h=10\ncylinder name=pin r=4 h=20")]);

/**
 * Every worked example, the most useful first: the prompt takes as many as fit
 * in the room the model has.
 */
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
    ops: setEach(["b3", "b4", "b5", "b6"], "r", "4"),
    reply: "Changed the four holes to radius 4.",
  },
  {
    // a new shape sits on the ground, so z is how high its bottom is: the plate is 5 thick
    program: plate(),
    user: "put a 10 mm cube on top of the plate",
    ops: [append("box name=cube w=10 d=10 h=10 z=5")],
    reply: "Put a 10 mm cube on top of the plate.",
  },
  {
    program: plate(),
    user: "move the plate up by 20",
    ops: [{ op: "wrap", blocks: ["b1"], holder: "transform z=20" }],
    reply: "Moved the plate up by 20.",
  },
  {
    program: [],
    user: "a box 40 wide, 30 deep and 10 high",
    ops: [append("box w=40 d=30 h=10")],
    reply: "Made a box 40 wide, 30 deep and 10 high.",
  },
  {
    // the cylinder is taller than the block and sits on the ground like it, so it goes all the way through
    program: [],
    user: "a block 40 by 40 by 10 with a hole of radius 5 through its middle",
    ops: [append("subtract\n  box w=40 d=40 h=10\n  cylinder r=5 h=20")],
    reply: "Made a 40 by 40 by 10 block with a hole of radius 5 through the middle.",
  },
  {
    // a flat shape is a shape of its own: it can be cut, joined and moved before it is extruded
    program: [],
    user: "a flat washer, outer radius 10 and a hole of radius 4, not extruded yet",
    ops: [append("subtract\n  circle r=10\n  circle r=4")],
    reply: "Drew a flat washer: a circle of radius 10 with a circle of radius 4 cut out.",
  },
  {
    program: [],
    user: "a hollow box 40 by 30 by 20 with 2 mm walls, open at the top",
    ops: [append("shell thickness=2 open=top\n  box name=box w=40 d=30 h=20")],
    reply: "Made a box 40 by 30 by 20 with 2 mm walls, open at the top.",
  },
  {
    program: [],
    user: "a plate 60 by 40 by 5 with rounded corners, radius 6",
    ops: [append("extrude name=plate height=5\n  rectangle w=60 h=40 corner=6")],
    reply: "Made a 60 by 40 plate, 5 thick, with corners of radius 6.",
  },
  {
    // both shapes go inside the fillet, so it rounds the corner where the pin meets the block
    program: blockAndPin(),
    user: "put a fillet of radius 2 where the pin meets the block",
    ops: [{ op: "wrap", blocks: ["b1", "b2"], holder: "fillet radius=2" }],
    reply: "Put a fillet of radius 2 where the pin meets the block.",
  },
  {
    program: cube(),
    user: "round the edges of the cube by 2",
    ops: [{ op: "wrap", blocks: ["b1"], holder: "round radius=2" }],
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
    ops: [append("cylinder name=cylinder r=5 h=20")],
    reply: "Made a cylinder with radius 5 and height 20.",
  },
  {
    // z is how high the bottom of a shape is: the body is 20 high, and the head is sunk 2 into it so they join
    program: [],
    user: "a sphere of radius 10 with a smaller sphere of radius 6 sitting on top of it",
    ops: [append("union name=snowman\n  sphere name=body r=10\n  sphere name=head r=6 z=18")],
    reply: "Made a sphere of radius 10 with a sphere of radius 6 on top.",
  },
  {
    program: [],
    user: "two 10 mm cubes side by side along x, touching",
    ops: [append("placeAgainst axis=x side=high\n  box name=left w=10 d=10 h=10\n  box name=right w=10 d=10 h=10")],
    reply: "Made two 10 mm cubes side by side along x.",
  },
  {
    program: plate(),
    user: "add a hole of radius 5 in the middle",
    ops: [{ op: "insert_into", block: "b1", blocks: "circle u=20 v=15 r=5 hole" }],
    reply: "Added a hole of radius 5 in the middle of the plate.",
  },
  {
    program: [],
    user: "a pyramid with a square base 40 on each side and a height of 25",
    ops: [
      append(
        [
          "solid name=pyramid",
          "  vertices",
          "    vertex x=-20 y=-20 z=0",
          "    vertex x=20 y=-20 z=0",
          "    vertex x=20 y=20 z=0",
          "    vertex x=-20 y=20 z=0",
          "    vertex x=0 y=0 z=25",
          "  faces",
        ].join("\n"),
      ),
    ],
    reply: "Made a pyramid with a 40 by 40 base and a height of 25.",
  },
  {
    program: blockAndPin(),
    user: "cut the pin out of the block",
    ops: [{ op: "wrap", blocks: ["b1", "b2"], holder: "subtract name=cut" }],
    reply: "Cut the pin out of the block.",
  },
  {
    program: cube(),
    user: "no, make it 30",
    ops: ["w", "d", "h"].map((field): Op => ({ op: "set", block: "b1", field, value: "30" })),
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
    ops: [append('repeat times=6 counter=i\n  cylinder name=post r=3 h=10 x="i * 12"')],
    reply: "Made a row of 6 cylinders, 12 apart along x.",
  },
  {
    program: [],
    user: "a right triangle with legs 20 and 10, extruded 8 high",
    ops: [append("extrude name=triangle height=8\n  polygon\n    point u=0 v=0\n    point u=20 v=0\n    point u=0 v=10")],
    reply: "Made a right triangle with legs 20 and 10, 8 high.",
  },
  {
    // a script (a function) is made once and used four times
    program: [],
    user: "a table: a top 100 by 60 and 5 thick on four legs, 5 by 5 and 40 tall",
    ops: [
      { op: "script", name: "leg", inputs: "x, y", blocks: "box name=leg w=5 d=5 h=40 x=x y=y" },
      append(
        [
          "union name=table",
          "  box name=top w=100 d=60 h=5 z=40",
          '  use name=leg values="45, 25"',
          '  use name=leg values="-45, 25"',
          '  use name=leg values="45, -25"',
          '  use name=leg values="-45, -25"',
        ].join("\n"),
      ),
    ],
    reply: "Made a table: a leg script, used four times under the top.",
  },
  {
    // a use only gives values to inputs, so the position is an input too
    program: [],
    user: "three posts, 4 by 4, with heights 10, 20 and 30, 15 apart along x",
    ops: [
      { op: "script", name: "post", inputs: "h, x", blocks: "box name=post w=4 d=4 h=h x=x" },
      append(['union name=posts', '  use name=post values="10, 0"', '  use name=post values="20, 15"', '  use name=post values="30, 30"'].join("\n")),
    ],
    reply: "Made a post script with a height and a position, used three times.",
  },
  {
    // nothing here says what 'nice' means, so nothing changes and the person is asked
    program: plate(),
    user: "make it look nice",
    ops: [],
    reply: "What would you like: rounded corners, a different size, or more holes?",
  },
  {
    program: [],
    user: "a row of 6 posts 10 apart, every other one taller",
    ops: [
      append(
        [
          "repeat times=6 counter=i",
          '  if condition="i % 2 == 0"',
          '    box name=tall w=4 d=4 h=20 x="i * 10"',
          "    else",
          '      box name=short w=4 d=4 h=8 x="i * 10"',
        ].join("\n"),
      ),
    ],
    reply: "Made a row of 6 posts, every other one taller.",
  },
  {
    program: [],
    user: "a 60 by 20 plate, 3 thick, with the word HI engraved in it",
    ops: [append("extrude name=plate height=3\n  rectangle w=60 h=20\n  text text=HI size=10 hole")],
    reply: "Made a 60 by 20 plate with HI engraved in it.",
  },
  {
    program: [],
    user: "a box 30 by 8 by 2 starting 5 out along x, with a mirror image on the other side",
    ops: [append("mirror axis=x both\n  box name=wing w=30 d=8 h=2 x=20")],
    reply: "Made a wing on each side of the middle.",
  },
];
