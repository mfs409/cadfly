import { BUILD } from "../language/types";
import type { ExampleSpec } from "./types";

/**
 * The basic examples: a few blocks each, for learning how shapes are put together, moved, combined, repeated and reused.
 */

/**
 * The "Step stool" example: nothing but boxes. A union joins the seat and four
 * legs; the seat's z lifts it onto the legs, and each leg's x and y put it in
 * a corner.
 */
export const stepStool: ExampleSpec = {
  id: "step-stool",
  name: "Step stool",
  description: "A union joins a seat and four legs, all boxes: the seat's z lifts it onto the legs, and each leg's x and y put it in a corner.",
  build: `
    union name="step stool"
      box name=seat w=40 d=30 h=4 z=26
      box name=leg w=4 d=4 h=26 x=-16 y=-11
      box name=leg w=4 d=4 h=26 x=16 y=-11
      box name=leg w=4 d=4 h=26 x=-16 y=11
      box name=leg w=4 d=4 h=26 x=16 y=11
  `,
};

/**
 * The "Pencil pot" example: a bigger cylinder with a smaller one subtracted
 * from it. The smaller one starts a little above the bottom, so the pot has a
 * floor, and runs past the top, so the pot is open.
 */
export const pencilPot: ExampleSpec = {
  id: "pencil-pot",
  name: "Pencil pot",
  description: "A smaller cylinder subtracted from a bigger one, starting a little above the bottom so the pot has a floor.",
  build: `
    subtract name="pencil pot"
      cylinder name=pot r=20 h=45
      cylinder name=inside r=17 h=45 z=4
  `,
};

/**
 * The "Snowman with a hat" example: three spheres, each raised by its z so it
 * sinks a little into the one below; coal eyes and buttons sunk a little into
 * the balls so they stay part of the snowman; a cone for a nose that one
 * transform turns to point forward; and a hat of two cylinders that another
 * transform moves up together as one. All of it is joined by a union.
 */
export const snowmanWithHat: ExampleSpec = {
  id: "snowman-with-a-hat",
  name: "Snowman with a hat",
  description: "Balls stacked with z, coal eyes and buttons, a nose turned by a transform, and a hat of two cylinders moved on as a group.",
  build: `
    union name=snowman
      sphere name=body r=12
      sphere name=middle r=8 z=22
      sphere name=head r=5 z=36
      # the face is on the front of the head (the front is toward negative y);
      # each coal sits a little inside the head, so it joins
      sphere name=left_eye r=0.8 x=-1.8 y=-4.3 z=41.7
      sphere name=right_eye r=0.8 x=1.8 y=-4.3 z=41.7
      # a cone (a cylinder with a top radius of 0), turned by rx=90 to point
      # forward, with its wide end inside the head
      transform y=-3 z=41 rx=90
        cylinder name=nose r=1.2 top=0 h=6
      # three buttons down the front of the middle ball
      sphere name=top_button r=1 y=-7 z=32
      sphere name=middle_button r=1 y=-7.6 z=29
      sphere name=bottom_button r=1 y=-7 z=26
      # the hat is built on its own, flat on the ground, then moved up onto the
      # head as one piece
      transform z=44
        cylinder name=brim r=7 h=1
        cylinder name=crown r=4 h=6 z=1
  `,
};

/**
 * The "Bracket" example: a plate with a screw hole subtracted from it and a
 * wall standing on its back edge, joined into one part.
 */
export const bracket: ExampleSpec = {
  id: "bracket",
  name: "Bracket",
  description: "A plate with a screw hole subtracted, a wall standing on it, and the whole thing set on the ground.",
  build: `
    set name=thick value=5
    union name=bracket
      subtract name=base
        box name=plate w=40 d=30 h=thick
        cylinder name=screw r=3 h=20 y=5
      # flush with the back edge of the plate (y = -15) and standing on top of
      # it
      box name=wall w=40 d=thick h=30 y="thick / 2 - 15" z=thick
  `,
};

/**
 * The "Plate with holes" example: a rectangle with a hole near each corner, all
 * sized from variables at the top, so changing one number reshapes the plate.
 */
export const plateWithHoles: ExampleSpec = {
  id: "plate-with-holes",
  name: "Plate with holes",
  description: "Change width, depth, hole or edge at the top and the whole plate follows.",
  build: `
    set name=width value=60
    set name=depth value=40
    set name=hole value=3
    set name=edge value=8
    extrude name=plate height=4
      rectangle w=width h=depth
      # the plate is drawn about its middle, so a hole is \`edge\` in from each side:
      # half the width (or the depth) from the middle, less \`edge\`
      circle u="width / 2 - edge" v="depth / 2 - edge" r=hole hole
      circle u="edge - width / 2" v="depth / 2 - edge" r=hole hole
      circle u="width / 2 - edge" v="edge - depth / 2" r=hole hole
      circle u="edge - width / 2" v="edge - depth / 2" r=hole hole
  `,
};

/**
 * The "Row of holes" example: a repeat block makes each hole of a row, spaced
 * by a gap.
 */
export const rowOfHoles: ExampleSpec = {
  id: "row-of-holes",
  name: "Row of holes",
  description: "A repeat block makes the holes; change holes or gap at the top.",
  build: `
    set name=holes value=5
    set name=gap value=12
    subtract name=strip
      box name=bar w="holes * gap + gap" d=20 h=4
      repeat times=holes counter=i
        # the first hole is half a gap in from the left end, and each next one
        # a gap further along
        cylinder name=hole r=3 h=10 x="(i - (holes - 1) / 2) * gap"
  `,
};

/**
 * The "Ring of posts" example: a repeat block turns each post a little further
 * round the middle.
 */
export const ringOfPosts: ExampleSpec = {
  id: "ring-of-posts",
  name: "Ring of posts",
  description: "A repeat block turns each post a little further round the middle.",
  build: `
    set name=count value=8
    set name=radius value=20
    union name=ring
      cylinder name=disc r="radius + 4" h=2
      repeat times=count counter=i
        # a post out at x = radius, sunk a little into the disc, turned round
        # the middle by a whole number of steps
        transform rz="i * 360 / count"
          cylinder name=post r=2 h=10 x=radius z=1
  `,
};

/**
 * The "Stairs" example: a repeat block builds each step, using its counter `i`
 * for how high and how far along the step is.
 */
export const stairs: ExampleSpec = {
  id: "stairs",
  name: "Stairs",
  description: "A repeat block builds each step; the counter i says how high it is.",
  build: `
    set name=steps value=6
    set name=rise value=10
    set name=run value=25
    union name=stairs
      repeat times=steps counter=i
        # step number i is as high as its number says, and one step further
        # along than the last
        box name=step w=60 d=run h="rise * (i + 1)" y="i * run"
  `,
};

/**
 * The "Wing" example: only one half is built, and a mirror adds the other. The
 * half starts at the middle, so the two halves meet there and are one body.
 */
export const wing: ExampleSpec = {
  id: "wing",
  name: "Wing",
  description: "Only one half is built; mirror, with both on, adds the other, and the halves meet in the middle as one body.",
  build: `
    set name=span value=30
    mirror axis=x both
      # only the right-hand half is built: the mirror makes the left
      box name=half w=span d=8 h=2 x="span / 2"
  `,
};

/**
 * The "Align" example: one align block holding a plate (the anchor, which stays
 * where it is) and three pieces, each set off to a different place. Every piece
 * slides along x until its center matches the plate's; none moves in y or z.
 */
export const align: ExampleSpec = {
  id: "align",
  name: "Align",
  description: "The first shape inside stays; the others slide along one axis (x) to match its center. Try at min or max, or on y or z.",
  build: `
    lineUp axis=x at=center
      box name=plate w=60 d=40 h=4
      box name=post w=8 d=8 h=20 x=30 y=-35
      box name=block w=14 d=14 h=12 x=-30 y=35
      box name=slab w=6 d=20 h=16 x=45 y=55
  `,
};

/**
 * The "Place against" example: one place against block holding a base (the
 * anchor) and three pegs, each floating at a different height and place. Every
 * peg drops (or rises) on its own until it touches the top of the base; none
 * moves in x or y, and the pegs do not stack on each other.
 */
export const placeAgainst: ExampleSpec = {
  id: "place-against",
  name: "Place against",
  description: "The base stays; each peg moves along z until it touches the top of the base, wherever it started. Try side low, or on x or y.",
  build: `
    placeAgainst axis=z side=high
      box name=base w=60 d=40 h=6
      cylinder name="peg 1" r=4 h=14 x=-20 y=-10 z=30
      cylinder name="peg 2" r=3 h=20 y=10 z=-15
      cylinder name="peg 3" r=5 h=8 x=20 y=-5 z=12
  `,
};

/**
 * The "Cup" example: a polygon of points revolved all the way around the
 * axis.
 */
export const cup: ExampleSpec = {
  id: "cup",
  name: "Cup",
  description: "A polygon revolved all the way around.",
  build: `
    set name=radius value=15
    set name=wall value=2
    revolve name=cup
      polygon
        point u=0 v=0
        point u=radius v=0
        point u=radius v=30
        point u="radius - wall" v=30
        point u="radius - wall" v=wall
        point u=0 v=wall
  `,
};

/**
 * The "Open box" example: a box whose edges are rounded, then hollowed with
 * the top left open.
 */
export const openBox: ExampleSpec = {
  id: "open-box",
  name: "Open box",
  description: "shell hollows a box and leaves the top open; round takes the edges off.",
  build: `
    set name=wall value=2
    # the box's edges are rounded first, then it is hollowed out with the top
    # left open
    shell thickness=wall open=top
      round radius=1.5
        box name=box w=50 d=35 h=25
  `,
};

/**
 * The "Table with legs" example: a leg is a script (a function), made once and
 * used four times. The leg's height is a global, since the leg cannot see the
 * variables of `build`.
 */
export const tableWithLegs: ExampleSpec = {
  id: "table-with-legs",
  name: "Table with legs",
  description: "A leg is a script, made once and used four times; legH, its height, is a global script so the leg can see it.",
  scripts: [
    {
      text: `
        set name=legH value=40
      `,
    },
    {
      name: BUILD,
      text: `
        set name=topW value=100
        set name=topD value=60
        set name=topT value=5
        set name=inset value=5
        union name=table
          box name=top w=topW d=topD h=topT z=legH
          use name=leg values="topW / 2 - inset, topD / 2 - inset"
          use name=leg values="inset - topW / 2, topD / 2 - inset"
          use name=leg values="topW / 2 - inset, inset - topD / 2"
          use name=leg values="inset - topW / 2, inset - topD / 2"
      `,
    },
    {
      name: "leg",
      inputs: "x, y",
      text: `
        # a script: written once, used four times with a different corner each time
        box name=leg w=5 d=5 h=legH x=x y=y
      `,
    },
  ],
};

/**
 * The "Tree" example: a branch (a script) that uses itself, smaller each time,
 * until its count runs out.
 */
export const tree: ExampleSpec = {
  id: "tree",
  name: "Tree",
  description: "A branch uses itself, smaller each time, until n runs out: the if is how it stops.",
  scripts: [
    {
      name: BUILD,
      text: `
        use name=branch values="30, 4"
      `,
    },
    {
      name: "branch",
      inputs: "len, n",
      text: `
        # a branch is a trunk with two smaller branches on top, until there are
        # none left: the if is the way it stops
        cylinder name=trunk r="len / 10" h=len
        if condition="n > 1"
          transform z=len
            transform ry=25
              use name=branch values="len * 0.7, n - 1"
            transform ry=-25
              use name=branch values="len * 0.7, n - 1"
      `,
    },
  ],
};
