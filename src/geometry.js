// Small, dependency-free geometry helpers shared by hit-testing, selection and
// export. Everything is plain objects and numbers so the same code runs in a
// browser module and in node:test without a canvas.

export const EPSILON = 1e-9;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function roundTo(value, step) {
  return Math.round(value / step) * step;
}

export function snap(value, step) {
  return roundTo(value, step);
}

export function bounds(x, y, w, h) {
  return { x, y, w, h };
}

/** Rectangle from two arbitrary corners, normalised to a positive extent. */
export function normalizeBounds(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function boundsFromPoints(points) {
  if (!points || points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function center(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

export function containsPoint(box, point, pad = 0) {
  return point.x >= box.x - pad && point.x <= box.x + box.w + pad
    && point.y >= box.y - pad && point.y <= box.y + box.h + pad;
}

/** Point inside an axis-aligned ellipse inscribed in `box`. */
export function ellipseContains(box, point, pad = 0) {
  const rx = box.w / 2 + pad;
  const ry = box.h / 2 + pad;
  if (rx <= 0 || ry <= 0) return false;
  const c = center(box);
  const nx = (point.x - c.x) / rx;
  const ny = (point.y - c.y) / ry;
  return nx * nx + ny * ny <= 1;
}

export function intersects(a, b) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function unionBounds(list) {
  const boxes = (list || []).filter((b) => b && Number.isFinite(b.x) && Number.isFinite(b.y));
  if (boxes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function expandBox(box, pad) {
  return { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
}

export function insetBox(box, pad) {
  return { x: box.x + pad, y: box.y + pad, w: Math.max(1, box.w - pad * 2), h: Math.max(1, box.h - pad * 2) };
}

/** Squared distance, useful when only ordering matters. */
export function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a, b) {
  return Math.sqrt(distanceSq(a, b));
}

/** Closest distance from `p` to the segment `a→b`. */
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= EPSILON) return distance(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function distanceToPolyline(points, point) {
  if (!points || points.length === 0) return Infinity;
  if (points.length === 1) return distance(point, points[0]);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment(point, points[i], points[i + 1]));
  }
  return best;
}

export function polylineBounds(points) {
  return expandBox(boundsFromPoints(points), 0);
}

export function cubicPoint(p0, c1, c2, p1, t) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * c1.x + 3 * u * tt * c2.x + tt * t * p1.x,
    y: uu * u * p0.y + 3 * uu * t * c1.y + 3 * u * tt * c2.y + tt * t * p1.y,
  };
}

export function sampleCubic(p0, c1, c2, p1, steps = 24) {
  const points = [];
  const count = Math.max(2, steps);
  for (let i = 0; i <= count; i++) points.push(cubicPoint(p0, c1, c2, p1, i / count));
  return points;
}

export function nearlyEqual(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon;
}
