// Connector geometry: choose sides from the relative position of two shapes,
// anchor to the side midpoints, then bow the line out of both shapes with a
// cubic bezier. Anchors are recomputed from live shape bounds on every frame,
// so moving either endpoint moves the connector with it; there is no stale
// anchor state to invalidate.

import {
  boundsFromPoints, center, clamp, cubicPoint, distance, distanceToPolyline,
  expandBox, sampleCubic,
} from "./geometry.js";

export const SIDES = ["top", "right", "bottom", "left"];

const SIDE_DIRECTIONS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export function sidePoint(box, side) {
  switch (side) {
    case "top": return { x: box.x + box.w / 2, y: box.y };
    case "right": return { x: box.x + box.w, y: box.y + box.h / 2 };
    case "bottom": return { x: box.x + box.w / 2, y: box.y + box.h };
    default: return { x: box.x, y: box.y + box.h / 2 };
  }
}

/**
 * Prefer the axis with the larger gap between the two boxes. When the boxes
 * overlap on both axes (for example a sticky dropped onto a frame) this falls
 * back to the centre-to-centre direction, which is stable while dragging.
 */
export function chooseSides(a, b) {
  const ac = center(a);
  const bc = center(b);
  const gapX = Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h));
  if (gapX >= gapY) {
    return bc.x >= ac.x
      ? { fromSide: "right", toSide: "left" }
      : { fromSide: "left", toSide: "right" };
  }
  return bc.y >= ac.y
    ? { fromSide: "bottom", toSide: "top" }
    : { fromSide: "top", toSide: "bottom" };
}

export function connectorGeometry(connector, byId) {
  if (!connector || !byId) return null;
  const from = byId.get(connector.from);
  const to = byId.get(connector.to);
  if (!from || !to || from.type === "connector" || to.type === "connector") return null;
  if (!from.w || !from.h || !to.w || !to.h) return null;

  const auto = chooseSides(from, to);
  const fromSide = connector.fromSide && connector.fromSide !== "auto" ? connector.fromSide : auto.fromSide;
  const toSide = connector.toSide && connector.toSide !== "auto" ? connector.toSide : auto.toSide;

  const a = sidePoint(from, fromSide);
  const b = sidePoint(to, toSide);
  const span = distance(a, b);
  const bow = clamp(span * 0.4, 36, 180);

  const da = SIDE_DIRECTIONS[fromSide] || SIDE_DIRECTIONS.right;
  const db = SIDE_DIRECTIONS[toSide] || SIDE_DIRECTIONS.left;
  const c1 = { x: a.x + da.x * bow, y: a.y + da.y * bow };
  const c2 = { x: b.x + db.x * bow, y: b.y + db.y * bow };

  const points = sampleCubic(a, c1, c2, b, 28);
  return {
    a, b, c1, c2, fromSide, toSide, points,
    span,
    bounds: expandBox(boundsFromPoints(points), 18),
    mid: cubicPoint(a, c1, c2, b, 0.5),
  };
}

export function pathData(geom) {
  if (!geom) return "";
  const { a, c1, c2, b } = geom;
  return `M ${round(a.x)} ${round(a.y)} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${round(b.x)} ${round(b.y)}`;
}

export function arrowHead(geom, size = 12) {
  if (!geom) return null;
  const { a, c1, c2, b } = geom;
  const approach = cubicPoint(a, c1, c2, b, 0.94);
  let dx = b.x - approach.x;
  let dy = b.y - approach.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  const base = { x: b.x - dx * size, y: b.y - dy * size };
  const wing = { x: -dy * size * 0.5, y: dx * size * 0.5 };
  return {
    tip: b,
    points: [
      { x: b.x, y: b.y },
      { x: base.x + wing.x, y: base.y + wing.y },
      { x: base.x - wing.x, y: base.y - wing.y },
    ],
  };
}

export function hitConnector(geom, point, tolerance = 7, zoom = 1) {
  if (!geom) return false;
  const worldTolerance = tolerance / Math.max(zoom, 0.01);
  return distanceToPolyline(geom.points, point) <= worldTolerance;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
