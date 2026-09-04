// Selection geometry and resize math.
//
// Handles live in world space but are hit-tested with a screen-space radius, so
// the grab target stays 10 px wide whether the board is at 20% or 300%.
// Resizing a multi-selection scales every shape proportionally inside the
// group's bounding box; connections are left alone because their endpoints are
// recomputed from the resized nodes.

import { distance, unionBounds } from "./geometry.js";
import { connectorGeometry } from "./connectors.js";
import { shapeBounds } from "./shapes.js";
import { shapesById, updateShapes } from "./scene.js";

export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const MIN_SIZE = 24;

export function handlePositions(box) {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const right = x + w;
  const bottom = y + h;
  return [
    { name: "nw", x, y },
    { name: "n", x: cx, y },
    { name: "ne", x: right, y },
    { name: "e", x: right, y: cy },
    { name: "se", x: right, y: bottom },
    { name: "s", x: cx, y: bottom },
    { name: "sw", x, y: bottom },
    { name: "w", x, y: cy },
  ];
}

export function handleCursor(name) {
  if (name === "nw" || name === "se") return "nwse-resize";
  if (name === "ne" || name === "sw") return "nesw-resize";
  if (name === "n" || name === "s") return "ns-resize";
  if (name === "e" || name === "w") return "ew-resize";
  return "default";
}

export function getResizeHandle(box, point, zoom = 1, hitPx = 10) {
  if (!box) return null;
  const radius = hitPx / 2 + 2;
  for (const handle of handlePositions(box)) {
    if (distance(handle, point) * zoom <= radius) return handle.name;
  }
  return null;
}

/**
 * Apply a drag delta to one edge or corner. The opposite edge is the anchor, so
 * dragging past it clamps instead of flipping the box inside out.
 */
export function resizeBounds(box, handle, dx, dy, minSize = MIN_SIZE) {
  let { x, y, w, h } = box;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");

  if (west) {
    const right = x + w;
    x += dx;
    w = right - x;
    if (w < minSize) { w = minSize; x = right - minSize; }
  } else if (east) {
    w = Math.max(minSize, w + dx);
  }

  if (north) {
    const bottom = y + h;
    y += dy;
    h = bottom - y;
    if (h < minSize) { h = minSize; y = bottom - minSize; }
  } else if (south) {
    h = Math.max(minSize, h + dy);
  }

  return { x, y, w, h };
}

export function selectionBounds(scene, ids) {
  const selected = new Set(ids);
  if (!selected.size) return null;
  const byId = shapesById(scene);
  const boxes = [];
  for (const shape of scene.shapes) {
    if (!selected.has(shape.id)) continue;
    if (shape.type === "connector") {
      const geom = connectorGeometry(shape, byId);
      if (geom) boxes.push(geom.bounds);
    } else {
      boxes.push(shapeBounds(shape));
    }
  }
  return unionBounds(boxes);
}

export function selectionInfo(scene, ids) {
  const selected = new Set(ids);
  const shapes = scene.shapes.filter((shape) => selected.has(shape.id));
  const byId = shapesById(scene);
  const boxes = [];
  for (const shape of shapes) {
    if (shape.type === "connector") {
      const geom = connectorGeometry(shape, byId);
      if (geom) boxes.push(geom.bounds);
    } else {
      boxes.push(shapeBounds(shape));
    }
  }
  return {
    count: shapes.length,
    shapes,
    bounds: unionBounds(boxes),
    hasConnector: shapes.some((s) => s.type === "connector"),
    single: shapes.length === 1 ? shapes[0] : null,
  };
}

/**
 * Resize the selection. For a single node the new box maps 1:1; for a group
 * every node is scaled by the group's width/height ratio while text keeps its
 * type size so notes stay readable.
 */
export function resizeShapes(scene, ids, handle, dx, dy, { minSize = MIN_SIZE } = {}) {
  const selected = new Set(ids);
  const targets = scene.shapes.filter((shape) => selected.has(shape.id) && shape.type !== "connector");
  if (!targets.length) return scene;

  const oldBox = unionBounds(targets.map(shapeBounds));
  if (!oldBox) return scene;
  const newBox = resizeBounds(oldBox, handle, dx, dy, minSize);

  const sx = oldBox.w > 0 ? newBox.w / oldBox.w : 1;
  const sy = oldBox.h > 0 ? newBox.h / oldBox.h : 1;

  const patches = new Map();
  for (const shape of targets) {
    const patch = {
      x: newBox.x + (shape.x - oldBox.x) * sx,
      y: newBox.y + (shape.y - oldBox.y) * sy,
      w: Math.max(8, shape.w * sx),
      h: Math.max(8, shape.h * sy),
    };
    patches.set(shape.id, patch);
  }
  return updateShapes(scene, patches);
}

export function isResizeHandle(name) {
  return HANDLES.includes(name);
}
