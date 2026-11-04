import type { BlockLayout } from "./layout";

/**
 * The shape the editor draws around a block: polygons with rounded corners, so
 * that a block that holds others reads as one piece.
 */

/** A point in the editor's workspace, in meters */
export interface Pt {
  /** Across, from the workspace's left */
  x: number;
  /** Down, from the workspace's top */
  y: number;
}

/**
 * Round the corners of a closed polygon. Each corner is cut back by `radius`
 * (less, if its edges are short) and joined with a short curve, so the shape
 * keeps one smooth outline, concave corners included.
 *
 * @param points The corners, in order (the last joins back to the first).
 * @param radius How far each corner is cut back along its two edges.
 * @param steps How many straight pieces make each curve.
 */
export function roundedPolygon(points: Pt[], radius: number, steps = 5): Pt[] {
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i + n - 1) % n];
    const here = points[i];
    const next = points[(i + 1) % n];
    const lenIn = Math.hypot(here.x - prev.x, here.y - prev.y);
    const lenOut = Math.hypot(next.x - here.x, next.y - here.y);
    const d = Math.min(radius, lenIn / 2, lenOut / 2);
    if (d <= 1e-9) {
      out.push(here);
      continue;
    }
    const a = { x: here.x + ((prev.x - here.x) / lenIn) * d, y: here.y + ((prev.y - here.y) / lenIn) * d };
    const b = { x: here.x + ((next.x - here.x) / lenOut) * d, y: here.y + ((next.y - here.y) / lenOut) * d };
    // a quadratic curve from a to b, bending towards the corner
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * here.x + t * t * b.x, y: u * u * a.y + 2 * u * t * here.y + t * t * b.y });
    }
  }
  return out;
}

/**
 * The outline of a block that holds others, as one polygon: the header, the bar
 * down the left side, and the bar underneath, with the gap between them (where
 * the inside blocks sit) cut out. Undefined for a block with no inside. Drawing
 * this as one shape, not three boxes, is what makes a C-shaped block read as
 * one piece.
 *
 * @param layout Where the parts of the block are (see `BlockLayout`).
 * @param radius How much to round the corners (see `roundedPolygon`).
 */
export function blockOutline(layout: BlockLayout, radius = 0.1): Pt[] | undefined {
  const { spine, footer, rows } = layout;
  if (!spine || !footer || !rows.length) return undefined;
  const left = rows[0].x;
  const top = rows[0].y;
  const headerRight = left + rows[0].w;
  const headerBottom = rows[rows.length - 1].y + rows[rows.length - 1].h;
  const spineRight = spine.x + spine.w;
  const right = footer.x + footer.w;
  const bottom = footer.y + footer.h;
  const corners: Pt[] = [
    { x: left, y: top },
    { x: headerRight, y: top },
    { x: headerRight, y: headerBottom },
    { x: spineRight, y: headerBottom },
    { x: spineRight, y: footer.y },
    { x: right, y: footer.y },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  return roundedPolygon(corners, radius);
}
