import type { ExampleSpec } from "./types";

/**
 * Examples of solids made from points and faces.
 */

/**
 * The "Pyramid" example: a solid with vertices and no faces, which is the
 * smallest convex shape around its points.
 */
export const pyramid: ExampleSpec = {
  id: "pyramid",
  name: "Pyramid",
  description: "A solid with vertices and no faces is the smallest convex shape around its points: change side or tall.",
  build: `
    set name=side value=40
    set name=tall value=25
    # only vertices, and no faces: the solid is the smallest convex shape
    # around its five points (each vertex has its number on it)
    solid name=pyramid
      vertices
        vertex x="-side / 2" y="-side / 2" z=0
        vertex x="side / 2" y="-side / 2" z=0
        vertex x="side / 2" y="side / 2" z=0
        vertex x="-side / 2" y="side / 2" z=0
        vertex x=0 y=0 z=tall
      faces
  `,
};

/**
 * The "House" example: a solid with faces, which makes it exactly those faces:
 * a house with a gabled roof (10 vertices, 7 faces).
 */
export const house: ExampleSpec = {
  id: "house",
  name: "House",
  description: "Faces in the solid's second section make it exactly those faces: a house with a gabled roof (10 vertices, 7 faces).",
  build: `
    set name=wall value=20
    set name=roof value=30
    # with faces in the second section the solid is exactly those faces, so a
    # notch or a gable is possible (a hull would fill it in). Vertices 1 to 4
    # are the floor, 5 to 8 the tops of the walls, 9 and 10 the two ends of the
    # ridge of the roof. Take a face out and the solid has a gap, and says so.
    solid name=house
      vertices
        vertex x=-15 y=-10 z=0
        vertex x=15 y=-10 z=0
        vertex x=15 y=10 z=0
        vertex x=-15 y=10 z=0
        vertex x=-15 y=-10 z=wall
        vertex x=15 y=-10 z=wall
        vertex x=15 y=10 z=wall
        vertex x=-15 y=10 z=wall
        vertex x=-15 y=0 z=roof
        vertex x=15 y=0 z=roof
      faces
        face corners="1 4 3 2"
        face corners="1 2 6 5"
        face corners="3 4 8 7"
        face corners="1 5 9 8 4"
        face corners="2 3 7 10 6"
        face corners="5 6 10 9"
        face corners="8 9 10 7"
  `,
};

/**
 * The "Star" example: a three-dimensional star, made from vertices and faces
 * because it has notches that a convex hull would fill in.
 */
export const star: ExampleSpec = {
  id: "star",
  name: "Star",
  description: "A 3D star made from faces (14 vertices, 24 faces), since a hull would fill its notches. Change core and tip.",
  build: `
    # a three-dimensional star: an octahedron (vertices 1 to 6, one on each axis)
    # with a spike on each of its eight faces (vertices 7 to 14, one at each
    # corner of the cube around it). It has notches between the spikes, so it is
    # not a convex hull, and it is not an extrusion. Every face is listed
    # counterclockwise as seen from outside, so its outside is the solid side in
    # the 3D view: a spike that is a mirror image of the first (an odd number of
    # minus signs in its corner) goes round the other way
    set name=core value=10
    set name=tip value=20
    solid name=star
      vertices
        vertex x=core y=0 z=0
        vertex x=-core y=0 z=0
        vertex x=0 y=core z=0
        vertex x=0 y=-core z=0
        vertex x=0 y=0 z=core
        vertex x=0 y=0 z=-core
        vertex x=tip y=tip z=tip
        vertex x=tip y=tip z=-tip
        vertex x=tip y=-tip z=tip
        vertex x=tip y=-tip z=-tip
        vertex x=-tip y=tip z=tip
        vertex x=-tip y=tip z=-tip
        vertex x=-tip y=-tip z=tip
        vertex x=-tip y=-tip z=-tip
      # each spike is three triangles from its tip to the three corners of the
      # octahedron's face it stands on
      faces
        face corners="7 1 3"
        face corners="7 3 5"
        face corners="7 5 1"
        face corners="8 3 1"
        face corners="8 6 3"
        face corners="8 1 6"
        face corners="9 4 1"
        face corners="9 5 4"
        face corners="9 1 5"
        face corners="10 1 4"
        face corners="10 4 6"
        face corners="10 6 1"
        face corners="11 3 2"
        face corners="11 5 3"
        face corners="11 2 5"
        face corners="12 2 3"
        face corners="12 3 6"
        face corners="12 6 2"
        face corners="13 2 4"
        face corners="13 4 5"
        face corners="13 5 2"
        face corners="14 4 2"
        face corners="14 6 4"
        face corners="14 2 6"
  `,
};
