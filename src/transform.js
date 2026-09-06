// Camera math for an infinite canvas.
//
// A camera is three numbers, not a matrix. `panX`/`panY` are the screen-space
// pixel offset of world origin and `zoom` is world-units-per-pixel inverted.
// screen = world * zoom + pan. That form is trivially invertible, which is what
// makes cursor-anchored zoom a two-line function instead of a matrix dance.

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 4;

export function createCamera(init = {}) {
  return { panX: 0, panY: 0, zoom: 1, ...init };
}

export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(camera, point) {
  return {
    x: (point.x - camera.panX) / camera.zoom,
    y: (point.y - camera.panY) / camera.zoom,
  };
}

export function worldToScreen(camera, point) {
  return {
    x: point.x * camera.zoom + camera.panX,
    y: point.y * camera.zoom + camera.panY,
  };
}

/**
 * Multiply zoom while keeping the world point under `anchor` pinned to the
 * same screen pixel. The pan correction is derived from the inverse transform,
 * so rounding cannot drift the anchor across repeated zooms.
 */
export function zoomAt(camera, anchor, factor) {
  const nextZoom = clampZoom(camera.zoom * factor);
  if (nextZoom === camera.zoom) return { ...camera };
  const world = screenToWorld(camera, anchor);
  return {
    zoom: nextZoom,
    panX: anchor.x - world.x * nextZoom,
    panY: anchor.y - world.y * nextZoom,
  };
}

export function setZoom(camera, zoom, anchor) {
  const nextZoom = clampZoom(zoom);
  const world = screenToWorld(camera, anchor);
  return {
    zoom: nextZoom,
    panX: anchor.x - world.x * nextZoom,
    panY: anchor.y - world.y * nextZoom,
  };
}

export function panBy(camera, dx, dy) {
  return { ...camera, panX: camera.panX + dx, panY: camera.panY + dy };
}

export function visibleBounds(camera, viewport) {
  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: viewport.width, y: viewport.height });
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y,
  };
}

/**
 * Centre `bounds` in the viewport with equal padding on every side. A board
 * that is much wider than it is tall is limited by the horizontal fit, which
 * keeps the aspect ratio intact.
 */
export function fitBounds(bounds, viewport, padding = 64) {
  const vw = Math.max(1, viewport.width);
  const vh = Math.max(1, viewport.height);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return { panX: vw / 2, panY: vh / 2, zoom: 1 };
  }
  const usableW = Math.max(40, vw - padding * 2);
  const usableH = Math.max(40, vh - padding * 2);
  const zoom = clampZoom(Math.min(usableW / bounds.w, usableH / bounds.h));
  const centerX = bounds.x + bounds.w / 2;
  const centerY = bounds.y + bounds.h / 2;
  return {
    zoom,
    panX: vw / 2 - centerX * zoom,
    panY: vh / 2 - centerY * zoom,
  };
}
