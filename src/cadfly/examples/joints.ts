import { BUILD } from "../language/types";
import type { ExampleSpec } from "./types";

/**
 * Examples of joints that print in one piece or fit together. Each joint is
 * written as scripts that take the joint's dimensions as inputs (a script that
 * makes the shape to cut away, and one that makes the matching part), so that
 * adding the example to a project gives pieces that can be used on its own
 * parts. `build` is a small demonstration that uses them on two example parts,
 * with dimensions to adjust for the printer.
 */

/**
 * The "Dowel joint" example: a hidden joint. Two blocks each have a hole, and
 * a dowel sits in both. The blocks are pulled apart by `explode` so that the
 * parts can be seen; with explode at 0 the dowel is inside, out of sight.
 * `dowel_hole` cuts a hole that is a little wider than the dowel, and
 * `dowel_pin` makes the dowel.
 */
export const dowelJoint: ExampleSpec = {
  id: "dowel-joint",
  name: "Dowel joint",
  description: "A hidden joint: a dowel sits in a hole in each block. Set explode to 0 and it disappears inside.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=size value=30
        set name=tall value=15
        set name=dowel value=3
        set name=slack value=0.2
        set name=length value=16
        set name=explode value=10
        # each hole is a little deeper than half the dowel
        set name=depth value="length / 2 + 0.5"
        subtract name="lower block"
          box w=size d=size h=tall
          use name=dowel_hole values="dowel, slack, depth, tall - depth"
        subtract name="upper block"
          box w=size d=size h=tall z="tall + explode"
          use name=dowel_hole values="dowel, slack, depth, tall + explode - 1"
        use name=dowel_pin values="dowel, length, tall + explode / 2 - length / 2"
      `,
    },
    {
      name: "dowel_hole",
      inputs: "dowel, slack, depth, z",
      text: `
        # Cut this out of a part: a hole for a dowel of radius dowel, widened by
        # slack all round. It starts at height z and is depth deep, with 1 more
        # so that it opens cleanly through the face it starts in.
        cylinder name=hole r="dowel + slack" h="depth + 1" z=z
      `,
    },
    {
      name: "dowel_pin",
      inputs: "dowel, length, z",
      text: `
        # A dowel of radius dowel and the given length, whose bottom is at height z.
        cylinder name=pin r=dowel h=length z=z
      `,
    },
  ],
};

/**
 * The "Magnet pocket" example: another hidden joint. Two plates have pockets
 * that face each other, and a magnet sits in each; once the plates meet
 * (explode at 0) the magnets are inside and the joint cannot be seen.
 * `magnet_pocket` cuts a pocket that is a little wider than the magnet, and
 * `magnet_disc` makes the magnet.
 */
export const magnetPocket: ExampleSpec = {
  id: "magnet-pocket",
  name: "Magnet pocket",
  description: "A hidden joint: a magnet in a pocket in each plate, the pockets facing. Set explode to 0 and the plates close over them.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=magnet value=6
        set name=thick value=2
        set name=slack value=0.15
        set name=plate value=6
        set name=size value=25
        set name=explode value=6
        set name=depth value="thick + slack"
        subtract name="lower plate"
          box w=size d=size h=plate
          use name=magnet_pocket values="magnet, slack, depth, plate - depth"
        subtract name="upper plate"
          box w=size d=size h=plate z="plate + explode"
          use name=magnet_pocket values="magnet, slack, depth, plate + explode - 1"
        use name=magnet_disc values="magnet, thick, plate - depth"
        use name=magnet_disc values="magnet, thick, plate + explode + slack"
      `,
    },
    {
      name: "magnet_pocket",
      inputs: "magnet, slack, depth, z",
      text: `
        # Cut this out of a plate: a pocket for a round magnet of width magnet,
        # widened by slack all round. It starts at height z and is depth deep,
        # with 1 more so that it opens cleanly through the face it starts in.
        cylinder name=pocket r="magnet / 2 + slack" h="depth + 1" z=z
      `,
    },
    {
      name: "magnet_disc",
      inputs: "magnet, thick, z",
      text: `
        # A round magnet of width magnet and thickness thick, whose bottom is at height z.
        cylinder name=disc r="magnet / 2" h=thick z=z
      `,
    },
  ],
};

/**
 * The "Slot and tab" example: a board that stands in a slot in another. The
 * tab is a little smaller than the slot all round (`gap`). It is held up by
 * `lift` so the parts can be seen; at 0 it stands on the base. `slot_for_tab`
 * cuts the slot, and `tab` makes the tab.
 */
export const slotAndTab: ExampleSpec = {
  id: "slot-and-tab",
  name: "Slot and tab",
  description: "A board that stands in a slot in another, the tab smaller than the slot by gap. Set lift to 0 to stand it on the base.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=tab_w value=12
        set name=tab_t value=4
        set name=gap value=0.3
        set name=base value=6
        set name=lift value=4
        subtract name="base board"
          box w=40 d=30 h=base
          use name=slot_for_tab values="tab_w, tab_t, gap, base"
        union name="upright board"
          box w=30 d=tab_t h=30 z="base + lift"
          use name=tab values="tab_w, tab_t, base, lift"
      `,
    },
    {
      name: "slot_for_tab",
      inputs: "tab_w, tab_t, gap, thick",
      text: `
        # Cut this out of a board thickness thick that is standing on the ground: a
        # slot for a tab that is tab_w wide and tab_t thick, with gap of room all
        # round, and 1 more above and below so that it opens cleanly.
        box name=slot w="tab_w + 2 * gap" d="tab_t + 2 * gap" h="thick + 2" z=-1
      `,
    },
    {
      name: "tab",
      inputs: "tab_w, tab_t, thick, z",
      text: `
        # A tab tab_w wide and tab_t thick that goes through a board of thickness
        # thick (1 more, so that it is part of the board it is joined to); its
        # bottom is at height z.
        box name=tab w=tab_w d=tab_t h="thick + 1" z=z
      `,
    },
  ],
};

/**
 * The "Finger joint" example: the corner of a box made from flat panels, as
 * for a laser cutter. Each panel has fingers where the other has notches, and
 * a repeat with an if cuts every other notch. `slack` makes the notches a
 * little wider than the fingers; `apart` moves the wall back so the parts can
 * be seen (0 to close the joint). `floor_notches` and `wall_notches` cut the
 * notches along the edge of a panel that lies flat and of one that stands up.
 */
export const fingerJoint: ExampleSpec = {
  id: "finger-joint",
  name: "Finger joint",
  description: "The corner of a box of flat panels, as for a laser cutter: a repeat with an if cuts every other notch. Set apart to 0 to close it.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=sheet value=3
        set name=finger value=6
        set name=fingers value=7
        set name=slack value=0.1
        set name=depth value=30
        set name=tall value=30
        set name=apart value=10
        set name=width value="fingers * finger"
        # the floor panel has a notch in its back edge at every odd place...
        subtract name="floor panel"
          box w=width d=depth h=sheet
          use name=floor_notches values="width, finger, fingers, slack, sheet, depth / 2 - sheet / 2 + 0.5"
        # ...and the wall has one in its bottom edge at every even place
        subtract name="wall panel"
          box w=width d=sheet h=tall y="depth / 2 - sheet / 2 + apart"
          use name=wall_notches values="width, finger, fingers, slack, sheet, depth / 2 - sheet / 2 + apart"
      `,
    },
    {
      name: "floor_notches",
      inputs: "width, finger, fingers, slack, sheet, y",
      text: `
        # Cut this out of a panel that lies flat, width wide and sheet thick,
        # and whose edge is at y: a notch in that edge at every odd place of
        # fingers places along it, each finger wide and widened by slack.
        repeat times=fingers counter=i
          if condition="i % 2 == 1"
            box name=notch w="finger + 2 * slack" d="sheet + 1" h="sheet + 2" x="-width / 2 + finger * (i + 0.5)" y=y z=-1
      `,
    },
    {
      name: "wall_notches",
      inputs: "width, finger, fingers, slack, sheet, y",
      text: `
        # Cut this out of a panel that stands on the ground, width wide and sheet
        # thick, at y: a notch in its bottom edge at every even place of fingers
        # places along it, each finger wide and widened by slack.
        repeat times=fingers counter=i
          if condition="i % 2 == 0"
            box name=notch w="finger + 2 * slack" d="sheet + 2" h="sheet + 1" x="-width / 2 + finger * (i + 0.5)" y=y z=-1
      `,
    },
  ],
};

/**
 * The "Cross lap joint" example: two panels that slot together at right angles,
 * each with a slot half its height, one from the top and one from the bottom,
 * as in the dividers of a box. `slack` widens the slots a little; `lift` holds
 * the second panel above so the parts can be seen (0 to slot them together).
 * `lap_slot_top` and `lap_slot_bottom` cut the slots.
 */
export const crossLap: ExampleSpec = {
  id: "cross-lap-joint",
  name: "Cross lap joint",
  description: "Two panels that slot together at right angles, each with a slot half its height. Set lift to 0 to slot them together.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=sheet value=3
        set name=slack value=0.15
        set name=long value=50
        set name=tall value=20
        set name=lift value=25
        subtract name="panel one"
          box w=long d=sheet h=tall
          use name=lap_slot_top values="sheet, slack, tall, 0"
        subtract name="panel two"
          box w=sheet d=long h=tall z=lift
          use name=lap_slot_bottom values="sheet, slack, tall, lift"
      `,
    },
    {
      name: "lap_slot_top",
      inputs: "sheet, slack, tall, z",
      text: `
        # Cut this out of a panel that runs along x, sheet thick and tall high,
        # with its bottom at height z: a slot open at the top and half its height,
        # for a panel sheet thick that runs along y, widened by slack.
        box name=slot w="sheet + 2 * slack" d="sheet + 2" h="tall / 2 + 1" z="z + tall / 2"
      `,
    },
    {
      name: "lap_slot_bottom",
      inputs: "sheet, slack, tall, z",
      text: `
        # Cut this out of a panel that runs along y, sheet thick and tall high,
        # with its bottom at height z: a slot open at the bottom and half its
        # height, for a panel sheet thick that runs along x, widened by slack.
        box name=slot w="sheet + 2" d="sheet + 2 * slack" h="tall / 2 + 1" z="z - 1"
      `,
    },
  ],
};

/**
 * The "Dovetail slide" example: a block that slides along a rail. The rail is
 * wider at the top than the bottom, so the block cannot lift off; the channel
 * in the block is bigger than the rail by `gap`. Change slide to move the block
 * along. `dovetail_rail` makes the rail, and `dovetail_channel` cuts the
 * channel for it.
 */
export const dovetailSlide: ExampleSpec = {
  id: "dovetail-slide",
  name: "Dovetail slide",
  description: "A block that slides along a rail wider at the top than the bottom, so it cannot lift off: change slide to move it along.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=plate_t value=4
        set name=rail_bottom value=10
        set name=rail_top value=16
        set name=rail_h value=8
        set name=gap value=0.4
        set name=slide value=5
        union name="base and rail"
          box name=base w=40 d=50 h=plate_t
          use name=dovetail_rail values="rail_bottom, rail_top, rail_h, plate_t, -25, 50"
        subtract name=slider
          box w=34 d=20 h="rail_h + 4" y=slide z="plate_t + gap"
          use name=dovetail_channel values="rail_bottom, rail_top, rail_h, plate_t, gap, -(slide + 11), 22"
      `,
    },
    {
      name: "dovetail_rail",
      inputs: "rail_bottom, rail_top, rail_h, base_t, y0, length",
      text: `
        # A rail on top of a base that is base_t thick: rail_bottom wide at the bottom, rail_top wide at the
        # top and rail_h high. It runs along y from y0 for length. Drawn on the XZ
        # plane (u across, v up) and pushed along y; it starts a little inside the
        # base so that the two are one piece.
        extrude name=rail plane=XZ offset=y0 height=length
          polygon
            point u="-rail_bottom / 2" v="base_t - 0.5"
            point u="rail_bottom / 2" v="base_t - 0.5"
            point u="rail_top / 2" v="base_t + rail_h"
            point u="-rail_top / 2" v="base_t + rail_h"
      `,
    },
    {
      name: "dovetail_channel",
      inputs: "rail_bottom, rail_top, rail_h, base_t, gap, y0, length",
      text: `
        # Cut this out of a block that rides on that rail: the rail's outline moved
        # out by gap on every side. It runs along y from y0 for length.
        extrude name=channel plane=XZ offset=y0 height=length
          polygon
            point u="-(rail_bottom / 2 + gap)" v="base_t - 0.5"
            point u="rail_bottom / 2 + gap" v="base_t - 0.5"
            point u="rail_top / 2 + gap" v="base_t + rail_h"
            point u="rail_top / 2 + gap" v="base_t + rail_h + gap"
            point u="-(rail_top / 2 + gap)" v="base_t + rail_h + gap"
            point u="-(rail_top / 2 + gap)" v="base_t + rail_h"
      `,
    },
  ],
};

/**
 * The "Snap pin" example: a push pin that clicks into a hole. Its tip is a cone
 * wider than the hole, and a slit down the middle lets the two halves squeeze
 * together as it goes through; past the plate they spring out and hold it.
 * `lift` raises it so the parts can be seen; at 0 it is pushed home.
 * `snap_hole` cuts the hole, and `snap_pin` makes the pin.
 */
export const snapPin: ExampleSpec = {
  id: "snap-pin",
  name: "Snap pin",
  description: "A push pin that clicks into a hole: a slit lets its wider tip squeeze through. Set lift to 0 to push it home.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=plate_t value=4
        set name=pin_r value=3
        set name=gap value=0.2
        set name=lift value=10
        subtract name=plate
          box w=30 d=20 h=plate_t
          use name=snap_hole values="pin_r, gap, plate_t"
        use name=snap_pin values="pin_r, plate_t, lift"
      `,
    },
    {
      name: "snap_hole",
      inputs: "pin_r, gap, plate_t",
      text: `
        # Cut this out of a plate plate_t thick that is standing on the ground: a
        # hole for a snap pin of radius pin_r, with gap of room all round, and 1
        # more above and below so that it opens cleanly.
        cylinder name=hole r="pin_r + gap" h="plate_t + 2" z=-1
      `,
    },
    {
      name: "snap_pin",
      inputs: "pin_r, plate_t, lift",
      text: `
        # A pin of radius pin_r for a plate plate_t thick, with its tip lift above
        # the ground. The barb is a cone from the tip, widening to wider than the
        # hole, and the slit lets the two halves squeeze together.
        subtract name=pin
          union
            cylinder name=barb r="pin_r - 0.5" top="pin_r + 1" h=3 z="lift - 4"
            cylinder name=shaft r=pin_r h="plate_t + 1" z="lift - 1"
            cylinder name=head r="pin_r + 3" h=2 z="lift + plate_t"
          box name=slit w=1.2 d="2 * pin_r + 4" h="plate_t + 3" z="lift - 5"
      `,
    },
  ],
};

/**
 * The "Locking tab" example: a snap lock between two panels. A thin arm hangs
 * from the wall and goes through a slot in the floor; its barb is wider than
 * the slot, so the arm bends to pass and then springs back and catches the
 * underside. `lift` holds the wall up so the parts can be seen (0 to snap it
 * home). `locking_slot` cuts the slot, and `locking_arm` makes the arm.
 */
export const lockingTab: ExampleSpec = {
  id: "locking-tab",
  name: "Locking tab",
  description: "A snap lock: an arm from the wall goes through a slot in the floor, and its barb catches the underside. Set lift to 0 to lock it.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=sheet value=3
        set name=slack value=0.25
        # the arm: how wide, how thick, and how long from the wall's bottom edge
        # (the barb's top is sheet + slack below it, so it catches the floor)
        set name=arm_w value=8
        set name=arm_t value=1.5
        set name=arm value="sheet + 3 + slack"
        set name=lift value=8
        subtract name="floor panel"
          box w=40 d=30 h=sheet
          use name=locking_slot values="arm_w, arm_t, slack, sheet"
        union name="wall panel"
          box w=40 d=sheet h=30 z="sheet + lift"
          use name=locking_arm values="arm_w, arm_t, arm, sheet, lift"
      `,
    },
    {
      name: "locking_slot",
      inputs: "arm_w, arm_t, slack, sheet",
      text: `
        # Cut this out of a floor panel sheet thick that is standing on the ground: a
        # slot for an arm arm_w wide and arm_t thick, widened by slack all round.
        # It is narrower than the arm with its barb, so the arm has to bend.
        box name=slot w="arm_w + 2 * slack" d="arm_t + 2 * slack" h="sheet + 2" z=-1
      `,
    },
    {
      name: "locking_arm",
      inputs: "arm_w, arm_t, arm, sheet, lift",
      text: `
        # The arm and its barb, hanging from the bottom edge of a wall panel whose
        # bottom is at height sheet + lift: arm_w wide, arm_t thick and arm long.
        # Drawn from the side (y across, z up) and pushed along x; the barb sticks
        # out 1 mm, with a ramp below it to push through.
        extrude name=arm plane=YZ offset="-arm_w / 2" height=arm_w
          polygon
            point u="-arm_t / 2" v="sheet + lift + 2"
            point u="arm_t / 2" v="sheet + lift + 2"
            point u="arm_t / 2" v="sheet + lift - (arm - 3)"
            point u="arm_t / 2 + 1" v="sheet + lift - (arm - 3)"
            point u="arm_t / 2" v="sheet + lift - arm"
            point u="-arm_t / 2" v="sheet + lift - arm"
      `,
    },
  ],
};

/**
 * The "T-slot joint" example: the locking joint of laser-cut boxes. A tab on
 * the wall goes through a slot in the floor; a bolt, put in from the floor's
 * edge, goes through a hole in the tab and into a nut held in a pocket, which
 * pulls the two together. `lift` holds the wall up so the parts can be seen (0
 * to put it together). `tslot_cuts` cuts the slot, bolt channel and nut pocket
 * out of the floor, `tslot_tab` makes the tab with its bolt hole, and
 * `tslot_bolt` and `tslot_nut` make the bolt and the nut.
 */
export const tSlot: ExampleSpec = {
  id: "t-slot-joint",
  name: "T-slot joint",
  description: "The locking joint of laser-cut boxes: a bolt through a tab goes into a nut in a pocket. Set lift to 0 to put it together.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=sheet value=8
        set name=tab_w value=14
        set name=bolt_r value=1.5
        set name=nut_w value=5.5
        set name=nut_t value=2.4
        set name=slack value=0.15
        set name=lift value=12
        subtract name="floor panel"
          box w=50 d=40 h=sheet
          use name=tslot_cuts values="sheet, tab_w, bolt_r, nut_w, nut_t, slack"
        union name="wall panel"
          box w=40 d=sheet h=30 z="sheet + lift"
          use name=tslot_tab values="sheet, tab_w, bolt_r, lift"
        use name=tslot_bolt values="sheet, bolt_r, nut_t, slack"
        use name=tslot_nut values="sheet, bolt_r, nut_w, nut_t, slack"
      `,
    },
    {
      name: "tslot_cuts",
      inputs: "sheet, tab_w, bolt_r, nut_w, nut_t, slack",
      text: `
        # Cut these out of a floor panel sheet thick that is standing on the ground:
        # the slot for a tab tab_w wide, the channel for a bolt of radius bolt_r that
        # runs in from the edge across the slot, and the pocket for a nut nut_w wide
        # and nut_t thick behind the slot, with slack of room all round.
        # half the slot's width, from the middle, and where the nut sits behind it
        set name=hw value="sheet / 2 + slack"
        set name=nut_y value="hw + 1 + slack + nut_t / 2"
        set name=bolt_end value="nut_y + nut_t / 2 + 1"
        box name=slot w="tab_w + 2 * slack" d="2 * hw" h="sheet + 2" z=-1
        # the bolt, its channel, hole and thread are cylinders along y (the way the
        # bolt goes): rx=-90 lays a cylinder that stands up down along y
        transform y=-21 z="sheet / 2" rx=-90
          # the bolt's channel runs in from the edge, across the slot, to the nut
          cylinder name=channel r="bolt_r + 0.1" h="bolt_end + 21"
        box name="nut pocket" w="nut_w + 2 * slack" d="nut_t + 2 * slack" h="nut_w / 2 + slack + sheet / 2 + 1" y=nut_y z="sheet / 2 - nut_w / 2 - slack"
      `,
    },
    {
      name: "tslot_tab",
      inputs: "sheet, tab_w, bolt_r, lift",
      text: `
        # A tab tab_w wide and sheet thick on the bottom edge of a wall panel whose
        # bottom is at height sheet + lift, with a hole for a bolt of radius bolt_r.
        subtract name=tab
          box w=tab_w d=sheet h="sheet + 1" z=lift
          transform y="-sheet / 2 - 1" z="lift + sheet / 2" rx=-90
            cylinder name="bolt hole" r="bolt_r + 0.1" h="sheet + 2"
      `,
    },
    {
      name: "tslot_bolt",
      inputs: "sheet, bolt_r, nut_t, slack",
      text: `
        # A bolt of radius bolt_r with a head, put in from the edge of the floor and
        # long enough to reach through the slot to the nut pocket behind it.
        set name=hw value="sheet / 2 + slack"
        set name=nut_y value="hw + 1 + slack + nut_t / 2"
        set name=bolt_end value="nut_y + nut_t / 2 + 1"
        union name=bolt
          transform y=-22 z="sheet / 2" rx=-90
            cylinder name=head r=3 h=2
          transform y=-21 z="sheet / 2" rx=-90
            cylinder name=shaft r=bolt_r h="bolt_end - 0.5 + 21"
      `,
    },
    {
      name: "tslot_nut",
      inputs: "sheet, bolt_r, nut_w, nut_t, slack",
      text: `
        # A nut nut_w wide and nut_t thick, with a thread for a bolt of radius
        # bolt_r, sitting in its pocket behind the slot.
        set name=hw value="sheet / 2 + slack"
        set name=nut_y value="hw + 1 + slack + nut_t / 2"
        subtract name=nut
          box w=nut_w d=nut_t h=nut_w y=nut_y z="sheet / 2 - nut_w / 2"
          transform y="nut_y - nut_t / 2 - 1" z="sheet / 2" rx=-90
            cylinder name=thread r="bolt_r + 0.05" h="nut_t + 2"
      `,
    },
  ],
};

/**
 * The "Hinge" example: a hinge printed in place. One leaf carries the pin (and
 * the two outer knuckles), the other has the middle knuckle with a hole that
 * is bigger than the pin by `gap`, and every gap between the leaves is `gap`,
 * so the leaves swing freely. `pin_leaf` and `hole_leaf` make the two leaves.
 */
export const hinge: ExampleSpec = {
  id: "hinge",
  name: "Hinge",
  description: "A hinge printed in place: the pin sits in a hole bigger than it by gap, and every gap between the leaves is gap.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=knuckle_r value=4
        set name=pin_r value=1.5
        set name=knuckle_len value=8
        set name=gap value=0.5
        set name=thick value=3
        set name=leaf value=20
        use name=pin_leaf values="knuckle_r, pin_r, knuckle_len, gap, thick, leaf"
        use name=hole_leaf values="knuckle_r, pin_r, knuckle_len, gap, thick, leaf"
      `,
    },
    {
      name: "pin_leaf",
      inputs: "knuckle_r, pin_r, knuckle_len, gap, thick, leaf",
      text: `
        # The leaf of a hinge that carries the pin and the two outer knuckles. The
        # knuckles have radius knuckle_r and are knuckle_len long, the pin has radius pin_r, the
        # leaf is leaf wide and thick thick, and every gap between the leaves is gap.
        # The hinge's axis is the x axis, and this leaf lies on the negative y side.
        set name=length value="3 * knuckle_len + 2 * gap"
        union name="leaf with pin"
          # a knuckle: a cylinder along the x axis (the hinge's axis), starting at x
          transform z=knuckle_r ry=90
            cylinder r=knuckle_r h=knuckle_len
          transform x="2 * (knuckle_len + gap)" z=knuckle_r ry=90
            cylinder r=knuckle_r h=knuckle_len
          transform z=knuckle_r ry=90
            cylinder name=pin r=pin_r h=length
          # the plate stops short of the other leaf's knuckle by gap; a bridge
          # joins each of this leaf's knuckles to it
          box name=plate w=length d="leaf - knuckle_r - gap" h=thick x="length / 2" y="-(leaf + knuckle_r + gap) / 2"
          box name=bridge w=knuckle_len d="knuckle_r + gap + 0.5 - knuckle_r / 2" h=thick x="knuckle_len / 2" y="-(knuckle_r + gap + 0.5 + knuckle_r / 2) / 2"
          box name=bridge w=knuckle_len d="knuckle_r + gap + 0.5 - knuckle_r / 2" h=thick x="2 * (knuckle_len + gap) + knuckle_len / 2" y="-(knuckle_r + gap + 0.5 + knuckle_r / 2) / 2"
      `,
    },
    {
      name: "hole_leaf",
      inputs: "knuckle_r, pin_r, knuckle_len, gap, thick, leaf",
      text: `
        # The leaf of a hinge that has the middle knuckle, with a hole for a pin of
        # radius pin_r, widened by gap. The values mean what they do for pin_leaf, and
        # this leaf lies on the positive y side.
        set name=length value="3 * knuckle_len + 2 * gap"
        union name="leaf with hole"
          subtract name="middle knuckle"
            transform x="knuckle_len + gap" z=knuckle_r ry=90
              cylinder r=knuckle_r h=knuckle_len
            transform x="knuckle_len + gap - 1" z=knuckle_r ry=90
              cylinder name=hole r="pin_r + gap" h="knuckle_len + 2"
          box name=plate w=length d="leaf - knuckle_r - gap" h=thick x="length / 2" y="(leaf + knuckle_r + gap) / 2"
          box name=bridge w=knuckle_len d="knuckle_r + gap + 0.5 - knuckle_r / 2" h=thick x="knuckle_len + gap + knuckle_len / 2" y="(knuckle_r + gap + 0.5 + knuckle_r / 2) / 2"
      `,
    },
  ],
};

/**
 * The "Swivel" example: a plate that turns on a pin, printed in place. The pin
 * has a head wider than the plate's hole, and `gap` of room above and below the
 * plate and around the pin. `swivel_base` makes the base with its pin, and
 * `swivel_arm` makes the plate that turns on it.
 */
export const swivel: ExampleSpec = {
  id: "swivel",
  name: "Swivel",
  description: "A plate that turns on a pin, printed in place: the pin's head is wider than the plate's hole, with gap of room all round.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=post value=3
        set name=gap value=0.5
        set name=thick value=3
        use name=swivel_base values="post, gap, thick"
        use name=swivel_arm values="post, gap, thick"
      `,
    },
    {
      name: "swivel_base",
      inputs: "post, gap, thick",
      text: `
        # A round base with a pin of radius post that the arm turns on: the pin is
        # tall enough for an arm thick thick, with gap of room above and below it,
        # and ends in a head wider than the arm's hole.
        # the height where the pin's head starts
        set name=head value="3 + gap + thick + gap"
        union name="base and pin"
          cylinder name=base r=12 h=3
          cylinder name=pin r=post h="head + 1"
          cylinder name=head r="post + 2" h=2 z=head
      `,
    },
    {
      name: "swivel_arm",
      inputs: "post, gap, thick",
      text: `
        # The arm that turns on that pin: thick thick, with a hole bigger than the
        # pin by gap, held gap above the base.
        subtract name=arm
          box w=34 d=12 h=thick z="3 + gap"
          cylinder name=hole r="post + gap" h="thick + 2" z="3 + gap - 1"
      `,
    },
  ],
};

/**
 * The "Ball joint" example: a ball in a socket, printed in place. The cavity is
 * bigger than the ball by `gap` all round, so the two do not touch and the
 * ball can turn; the opening is narrower than the ball, so it cannot come out.
 * `ball_socket` makes the socket, and `ball_and_stem` makes the ball with its
 * stem.
 */
export const ballJoint: ExampleSpec = {
  id: "ball-joint",
  name: "Ball joint",
  description: "A ball printed in its socket: the cavity is bigger than the ball by gap and the opening is narrower, so it turns but stays in.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=r value=6
        set name=gap value=0.5
        set name=wall value=3
        # the opening is narrower than the ball (r), so the ball cannot pass
        set name=opening value="r * 0.7"
        use name=ball_socket values="r, gap, wall, opening"
        use name=ball_and_stem values="r, gap, wall, opening"
      `,
    },
    {
      name: "ball_socket",
      inputs: "r, gap, wall, opening",
      text: `
        # A socket for a ball of radius r: the cavity is bigger by gap, the walls
        # are wall thick, and the opening at the top has radius opening.
        set name=cavity value="r + gap"
        set name=center value="wall + cavity"
        set name=tall value="center + cavity + wall"
        subtract name=socket
          cylinder r="cavity + wall" h=tall
          sphere r=cavity z="center - cavity"
          cylinder r=opening h="tall - center + 1" z=center
      `,
    },
    {
      name: "ball_and_stem",
      inputs: "r, gap, wall, opening",
      text: `
        # A ball of radius r sitting in that socket, with a stem that comes out
        # through the opening (thinner than it by gap) and ends in a knob.
        set name=cavity value="r + gap"
        set name=center value="wall + cavity"
        set name=tall value="center + cavity + wall"
        union name="ball and stem"
          sphere r=r z="center - r"
          # the stem is thinner than the opening by gap
          cylinder r="opening - gap" h="tall + 8 - center" z=center
          sphere name=knob r=3.5 z="tall + 8 - 3.5"
      `,
    },
  ],
};

/**
 * The "Ball and socket" example: the two halves of a ball joint as separate
 * parts, to be pushed together. Slits cut the socket's rim into four flaps
 * that bend apart to let the ball in. `ball_part` makes the ball with its
 * foot, and `socket_part` makes the socket; both take the x they stand at.
 */
export const ballAndSocket: ExampleSpec = {
  id: "ball-and-socket",
  name: "Ball and socket",
  description: "The two halves of a ball joint as separate parts: slits let the socket's rim flex so the ball snaps in.",
  scripts: [
    {
      name: BUILD,
      text: `
        set name=r value=6
        set name=gap value=0.3
        set name=wall value=2.5
        # the opening is a little narrower than the ball: the flaps have to bend to
        # let it in
        set name=opening value="r * 0.8"
        set name=neck value=8
        use name=ball_part values="r, neck, -20"
        use name=socket_part values="r, gap, wall, opening, 20"
      `,
    },
    {
      name: "ball_part",
      inputs: "r, neck, x",
      text: `
        # A ball of radius r on a neck neck long, standing on a round foot, with
        # its middle at x.
        union name="ball part"
          cylinder name=foot r="r + 2" h=3 x=x
          cylinder name=neck r=3 h="3 + neck" x=x
          sphere name=ball r=r x=x z="3 + neck - 1"
      `,
    },
    {
      name: "socket_part",
      inputs: "r, gap, wall, opening, x",
      text: `
        # A socket for a ball of radius r, with its middle at x: the cavity is
        # bigger by gap, the walls are wall thick, and the opening has radius
        # opening. Two slits cut the rim into four flaps that bend to let the ball in.
        set name=cavity value="r + gap"
        set name=center value="wall + cavity"
        set name=tall value="center + cavity + wall"
        subtract name="socket part"
          cylinder r="cavity + wall" h=tall x=x
          sphere r=cavity x=x z="center - cavity"
          cylinder name=opening r=opening h="tall - center + 1" x=x z=center
          box name=slit w=1.2 d="2 * (cavity + wall) + 2" h="tall - center + 1" x=x z=center
          box name=slit w="2 * (cavity + wall) + 2" d=1.2 h="tall - center + 1" x=x z=center
      `,
    },
  ],
};
