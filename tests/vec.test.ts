import { describe, expect, test } from "vitest";
import { cross, polygonArea, cross2, turn } from "../src/cadfly/geometry/vec";

describe("the flat vector functions", () => {
  // cross2 is the z of the 3D cross product, so the two always agree
  test("the 2D cross product is the z of the 3D one, and its sign says which way b is turned from a", () => {
    for (const [a, b] of [[[1, 0], [0, 1]], [[3, 2], [-1, 4]], [[2, 2], [4, 4]], [[1, 0], [0, -1]]] as const) {
      expect(cross2([...a], [...b])).toBeCloseTo(cross([a[0], a[1], 0], [b[0], b[1], 0])[2]);
    }
    expect(cross2([1, 0], [0, 1])).toBe(1); // counter-clockwise
    expect(cross2([1, 0], [0, -1])).toBe(-1); // clockwise
    expect(cross2([2, 2], [4, 4])).toBe(0); // the same way
  });

  // turn is cross2 of (b - a) and (c - a), so twice the triangle's area
  test("turn is twice the signed area of a triangle: left is positive, right is negative, a line is zero", () => {
    expect(turn([0, 0], [4, 0], [0, 3])).toBe(12);
    expect(turn([0, 0], [0, 3], [4, 0])).toBe(-12);
    expect(turn([0, 0], [1, 1], [2, 2])).toBe(0);
    expect(turn([5, 5], [9, 5], [5, 8])).toBe(cross2([4, 0], [0, 3]));
  });

  // the shoelace formula, built from cross2 of each point with the next
  test("the area of a polygon is positive going counter-clockwise and negative going clockwise", () => {
    const square: [number, number][] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(polygonArea(square)).toBe(16);
    expect(polygonArea([...square].reverse())).toBe(-16);
    expect(polygonArea([[1, 1], [5, 1], [1, 4]])).toBe(6); // a triangle, away from the origin
    expect(polygonArea([[0, 0], [1, 1]])).toBe(0); // two points enclose nothing
  });
});
