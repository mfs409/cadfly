import { expect, test } from "vitest";
import { type SketchShape, SketchError, shapeToContour, shapeToContours } from "../src/cadfly/geometry/sketch";

test("rect becomes a 4-point contour", () => {
  expect(shapeToContour({ kind: "rect", at: [1, 2], w: 3, h: 4 })).toEqual([
    [1, 2],
    [4, 2],
    [4, 6],
    [1, 6],
  ]);
});

test("a circle is a polygon of 64 points, all on the radius", () => {
  const pts = shapeToContour({ kind: "circle", center: [5, 5], r: 2 });
  expect(pts).toHaveLength(64);
  for (const [x, y] of pts) expect(Math.hypot(x - 5, y - 5)).toBeCloseTo(2);
});

test("non-positive dimensions are rejected", () => {
  expect(() => shapeToContour({ kind: "rect", at: [0, 0], w: 0, h: 1 })).toThrow(SketchError);
  expect(() => shapeToContour({ kind: "circle", center: [0, 0], r: -1 })).toThrow(/radius/);
});

test("a polyline with fewer than 3 points is rejected", () => {
  expect(() => shapeToContour({ kind: "polyline", points: [[0, 0], [1, 0]] })).toThrow(/at least 3 points/);
});

test("self-intersecting polylines are rejected", () => {
  // bow tie
  expect(() =>
    shapeToContour({ kind: "polyline", points: [[0, 0], [2, 2], [2, 0], [0, 2]] }),
  ).toThrow(/crosses itself/);
});

test("collinear polylines enclose no area", () => {
  expect(() =>
    shapeToContour({ kind: "polyline", points: [[0, 0], [1, 1], [2, 2]] }),
  ).toThrow(/no area/);
});

test("a valid L shape is accepted", () => {
  const pts: [number, number][] = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]];
  expect(shapeToContour({ kind: "polyline", points: pts })).toHaveLength(6);
});

test("rect angle turns it about its center", () => {
  const pts = shapeToContour({ kind: "rect", at: [0, 0], w: 10, h: 2, angle: 90 });
  const expected = [[6, -4], [6, 6], [4, 6], [4, -4]]; // the center is (5, 1)
  pts.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(expected[i][0]);
    expect(y).toBeCloseTo(expected[i][1]);
  });
});

test("polyline angle turns it about its first point", () => {
  const pts = shapeToContour({ kind: "polyline", angle: 90, points: [[1, 1], [5, 1], [1, 4]] });
  const expected = [[1, 1], [1, 5], [-2, 1]];
  pts.forEach(([x, y], i) => {
    expect(x).toBeCloseTo(expected[i][0]);
    expect(y).toBeCloseTo(expected[i][1]);
  });
});

test("the points that come back are new: changing them cannot change the shape", () => {
  const points: [number, number][] = [[0, 0], [4, 0], [4, 3]];
  const polyline = shapeToContour({ kind: "polyline", points });
  expect(polyline).not.toBe(points);
  polyline[0][0] = 99;
  expect(points[0]).toEqual([0, 0]);

  const turned = shapeToContour({ kind: "polyline", points, angle: 90 });
  turned[0][1] = 99;
  expect(points[0]).toEqual([0, 0]);

  const contours: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [8, 2], [8, 8], [2, 8]]];
  const outer = shapeToContour({ kind: "glyph", contours });
  outer[0][0] = 99;
  const all = shapeToContours({ kind: "glyph", contours });
  all[1][0][0] = 99;
  expect(contours[0][0]).toEqual([0, 0]);
  expect(contours[1][0]).toEqual([2, 2]);
});
