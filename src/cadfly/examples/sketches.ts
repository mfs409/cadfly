import type { ExampleSpec } from "./types";

/**
 * Examples made by drawing flat shapes and turning them into solids (extrude, loft, sweep, text, rounding and hollowing).
 */

/**
 * The "Washer" example: a flat circle with a smaller one subtracted from its
 * middle (an area, so the cut is a hole), then extruded.
 */
export const washer: ExampleSpec = {
  id: "washer",
  name: "Washer",
  description: "A flat shape with one circle cut out of another (subtract works on areas), then extruded.",
  build: `
    set name=outer value=10
    set name=inner value=4
    # draw it flat first: the big circle with the small one cut out of its
    # middle (an area, so the cut is a hole), then give it thickness
    extrude name=washer height=2
      subtract
        circle r=outer
        circle r=inner
  `,
};

/**
 * The "Twisted tower" example: an extrude whose top is turned and made
 * narrower than its bottom.
 */
export const twistedTower: ExampleSpec = {
  id: "twisted-tower",
  name: "Twisted tower",
  description: "An extrude can twist (turn its top) and taper (shrink it): change turn and narrowing.",
  build: `
    set name=turn value=90
    set name=narrowing value=0.5
    # the top turns by \`turn\` degrees and ends \`narrowing\` times as wide as the
    # bottom
    extrude name=tower height=60 twist=turn taper=narrowing
      rectangle w=20 h=20 corner=3
  `,
};

/**
 * The "Flat plate" example: an outline drawn flat first (a rectangle joined to
 * a circle, two holes cut out, the corners rounded), then extruded.
 */
export const flatPlate: ExampleSpec = {
  id: "flat-plate",
  name: "Flat plate",
  description: "Drawn in 2D first: a rectangle joined to a circle, two holes subtracted, corners rounded; only then extruded.",
  build: `
    set name=thick value=4
    # the outline is drawn in 2D: a rectangle joined to a circle, two holes cut
    # out, and the outside corners rounded; the extrude comes last
    extrude name="hook plate" height=thick
      round radius=3
        subtract
          union
            rectangle w=60 h=30
            circle u=30 r=15
          circle u=-20 r=4
          circle u=30 r=5
  `,
};

/**
 * The "Rounded plate" example: a rectangle with rounded corners and a screw
 * hole near each corner, found from the number of the repeat pass.
 */
export const roundedPlate: ExampleSpec = {
  id: "rounded-plate",
  name: "Rounded plate",
  description: "The rectangle's corner field rounds it; a repeat puts a screw hole near each corner.",
  build: `
    set name=corner value=8
    extrude name=plate height=5
      rectangle w=70 h=45 corner=corner
      # a hole near each corner, found from the number of the pass: left or
      # right, then back or front
      repeat times=4 counter=i
        circle u="((i % 2) * 2 - 1) * (35 - corner - 3)" v="(floor(i / 2) * 2 - 1) * (22.5 - corner - 3)" r=2 hole
  `,
};

/**
 * The "Valentine heart" example: a heart drawn flat, then extruded. A square
 * turned a quarter of the way round stands on its corner, and a circle as wide
 * as one of its sides sits on each of the two upper sides to make the lobes.
 * A small hole near the top is for a keyring.
 */
export const valentineHeart: ExampleSpec = {
  id: "valentine-heart",
  name: "Valentine heart",
  description: "A heart drawn flat: a square on its corner and a circle on each upper side, extruded, with a hole for a keyring.",
  build: `
    set name=side value=40
    set name=thick value=4
    # the middle of an upper side of the turned square is this far out and up
    set name=lobe value="side * sqrt(2) / 4"
    extrude name=heart height=thick
      union
        transform rz=45
          rectangle w=side h=side
        transform x="-lobe" y=lobe
          circle r="side / 2"
        transform x=lobe y=lobe
          circle r="side / 2"
      # the keyring hole is in the body, just under the dip between the lobes
      circle v="side * 0.55" r=3 hole
  `,
};

/**
 * The "Name plate" example: a plate with a name engraved in it, by a text
 * block marked as a hole.
 */
export const namePlate: ExampleSpec = {
  id: "name-plate",
  name: "Name plate",
  description: "A text block writes the name; with hole on the letters are engraved into the plate.",
  build: `
    set name=size value=10
    extrude name=plate height=3
      rectangle w=70 h=20 corner=3
      # the letters are cut out of the plate (hole), so the plate shows them
      # engraved
      text text=HELLO size=size hole
  `,
};

/**
 * The "Etched text" example: letters that start below the top of a plate and
 * are subtracted, so they are cut in without going through.
 */
export const etchedText: ExampleSpec = {
  id: "etched-text",
  name: "Etched text",
  description: "The letters start depth below the top of the plate, so subtract cuts them in without going through.",
  build: `
    set name=thick value=3
    set name=depth value=1
    # the letters are an extrude of their own that starts depth below the top
    # of the plate and goes up through it: subtract cuts them in, and the rest
    # of the plate is left
    subtract name="etched plate"
      extrude name=plate height=thick
        rectangle w=70 h=20 corner=3
      extrude name=letters offset="thick - depth" height="depth + 1"
        text text=HELLO size=10
  `,
};

/**
 * The "Raised text" example: letters that start on top of a plate and are
 * joined to it, standing up from the surface.
 */
export const raisedText: ExampleSpec = {
  id: "raised-text",
  name: "Raised text",
  description: "The letters start on top of the plate (offset = thick) and union joins them: change raise for taller letters.",
  build: `
    set name=thick value=3
    set name=raise value=1
    # the letters are an extrude that starts on top of the plate (offset =
    # thick); union joins them to it
    union name="raised text plate"
      extrude name=plate height=thick
        rectangle w=70 h=20 corner=3
      extrude name=letters offset=thick height=raise
        text text=HELLO size=10
  `,
};

/**
 * The "Pipe" example: a circle swept along a path of vertex points.
 */
export const pipe: ExampleSpec = {
  id: "pipe",
  name: "Pipe",
  description: "A sweep carries a circle along a path of vertex points.",
  build: `
    # a sweep carries the outline along the path of vertex points
    sweep name=pipe
      circle r=4
      vertex x=0 y=0 z=0
      vertex x=0 y=0 z=30
      vertex x=30 y=0 z=50
      vertex x=30 y=30 z=50
  `,
};

/**
 * The "Hollow pipe" example: a thin sweep subtracted from a thick one, running
 * a little past each end so that the pipe is open.
 */
export const hollowPipe: ExampleSpec = {
  id: "hollow-pipe",
  name: "Hollow pipe",
  description: "A thinner sweep is subtracted from a thicker one, running a little past each end so the pipe is open.",
  build: `
    set name=outer value=4
    set name=wall value=1.5
    # the pipe is a thick sweep with a thinner one cut out of it; the thin one
    # starts and ends a little beyond the pipe so both ends are open
    subtract name=pipe
      sweep
        circle r=outer
        vertex x=0 y=0 z=0
        vertex x=0 y=0 z=30
        vertex x=30 y=0 z=50
        vertex x=30 y=30 z=50
      sweep
        circle r="outer - wall"
        vertex x=0 y=0 z=-1
        vertex x=0 y=0 z=30
        vertex x=30 y=0 z=50
        vertex x=30 y=31 z=50
  `,
};

/**
 * The "Hollow vase" example: a loft that blends a square at the bottom into a
 * circle at the top, hollowed by a shell block with the mouth left open. Its
 * corners are not rounded: hollowing a shape takes longer the more triangles it
 * has.
 */
export const hollowVase: ExampleSpec = {
  id: "hollow-vase",
  name: "Hollow vase",
  description: "A loft blends a square into a circle, shell hollows it, and open=top leaves the mouth open: change wall for thicker or thinner sides.",
  build: `
    set name=wall value=2
    # a loft blends the bottom outline into the top one, here a square into a
    # circle; shell hollows what is inside it, and open=top leaves the mouth of
    # the vase open
    shell thickness=wall open=top
      loft name=vase height=60
        bottom
          rectangle w=30 h=30
        top
          circle r=10
  `,
};

/**
 * The "Post and base" example: a square post on a base with a fillet where they
 * join, and screw holes cut afterwards so the fillet does not fill them in. The
 * post is square because rounding a shape takes longer the more triangles it
 * has, and a round post has many more.
 */
export const postAndBase: ExampleSpec = {
  id: "post-and-base",
  name: "Post and base",
  description: "fillet puts a curve where the post meets the base (change foot); the screw holes are cut after it so the fillet does not fill them.",
  build: `
    set name=foot value=4
    # the fillet goes round only the two shapes that join; the screw holes are
    # cut afterwards, because a hole smaller than the fillet (these are radius
    # 3, the fillet 4) would be filled in if it were inside the fillet block
    subtract name="post and base"
      fillet radius=foot
        union
          box name=base w=60 d=60 h=6
          box name=post w=16 d=16 h=30
      cylinder name=screw r=3 h=10 x=22 y=22
      cylinder name=screw r=3 h=10 x=-22 y=-22
  `,
};

/**
 * The "Tray and lid" example: a tray, and a lid sized from it by a measure
 * block, which turns the tray's size into variables.
 */
export const trayAndLid: ExampleSpec = {
  id: "tray-and-lid",
  name: "Tray and lid",
  description: "measure turns a shape's size into variables, so the lid is sized from the tray.",
  build: `
    set name=margin value=0.4
    # measure gives the size of what is inside it as variables (tray_w, tray_d,
    # tray_h), for the blocks below it
    measure name=tray
      shell thickness=2 open=top
        box name=tray w=50 d=35 h=15
    box name=lid w="tray_w + 2 * margin" d="tray_d + 2 * margin" h=2 z=tray_h
  `,
};
