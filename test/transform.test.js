import test from "node:test";
import assert from "node:assert/strict";
import {
  createCamera, screenToWorld, worldToScreen, zoomAt, setZoom, panBy,
  visibleBounds, fitBounds, clampZoom, MIN_ZOOM, MAX_ZOOM,
} from "../src/transform.js";

const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);

test("screen and world transforms round-trip", () => {
  const cameras = [
    createCamera(),
    createCamera({ panX: 120, panY: -40, zoom: 2.5 }),
    createCamera({ panX: -800, panY: 360, zoom: 0.37 }),
  ];
  const points = [{ x: 0, y: 0 }, { x: 1440, y: 900 }, { x: -320.5, y: 77.25 }];
  for (const camera of cameras) {
    for (const point of points) {
      const back = worldToScreen(camera, screenToWorld(camera, point));
      close(back.x, point.x);
      close(back.y, point.y);
    }
  }
});

test("world origin maps through pan and zoom", () => {
  const camera = createCamera({ panX: 40, panY: 90, zoom: 2 });
  assert.deepEqual(worldToScreen(camera, { x: 0, y: 0 }), { x: 40, y: 90 });
  assert.deepEqual(worldToScreen(camera, { x: 10, y: -5 }), { x: 60, y: 80 });
  assert.deepEqual(screenToWorld(camera, { x: 40, y: 90 }), { x: 0, y: 0 });
});

test("zoomAt pins the world point under the cursor for every step", () => {
  let camera = createCamera({ panX: 30, panY: 70, zoom: 0.8 });
  const anchor = { x: 640, y: 360 };
  const before = screenToWorld(camera, anchor);
  const factors = [1.1, 1.2, 0.95, 1.4, 0.7, 1.15, 1.25, 0.9];
  for (const factor of factors) {
    camera = zoomAt(camera, anchor, factor);
    const after = screenToWorld(camera, anchor);
    close(after.x, before.x, 1e-8);
    close(after.y, before.y, 1e-8);
  }
});

test("zoomAt clamps at the configured limits", () => {
  let camera = createCamera({ zoom: 1 });
  const anchor = { x: 100, y: 100 };
  for (let i = 0; i < 40; i++) camera = zoomAt(camera, anchor, 1.5);
  assert.equal(camera.zoom, MAX_ZOOM);
  for (let i = 0; i < 80; i++) camera = zoomAt(camera, anchor, 0.5);
  assert.equal(camera.zoom, MIN_ZOOM);
  assert.equal(clampZoom(0.0001), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
});

test("setZoom uses the same anchor math", () => {
  const camera = createCamera({ panX: 12, panY: -8, zoom: 1.4 });
  const anchor = { x: 500, y: 300 };
  const world = screenToWorld(camera, anchor);
  const next = setZoom(camera, 0.5, anchor);
  const after = screenToWorld(next, anchor);
  close(after.x, world.x);
  close(after.y, world.y);
  assert.equal(next.zoom, 0.5);
});

test("panBy moves the visible world bounds by a screen delta", () => {
  const camera = createCamera({ panX: 0, panY: 0, zoom: 2 });
  const viewport = { width: 800, height: 600 };
  const a = visibleBounds(camera, viewport);
  const b = visibleBounds(panBy(camera, 100, -40), viewport);
  close(b.x, a.x - 50);
  close(b.y, a.y + 20);
  close(b.w, a.w);
  close(b.h, a.h);
});

test("fitBounds centres content and respects padding", () => {
  const bounds = { x: 100, y: 50, w: 800, h: 400 };
  const viewport = { width: 1000, height: 600 };
  const camera = fitBounds(bounds, viewport, 50);
  assert.equal(camera.zoom, 1.125);
  const centre = worldToScreen(camera, { x: 500, y: 250 });
  close(centre.x, viewport.width / 2, 1e-8);
  close(centre.y, viewport.height / 2, 1e-8);
  const topLeft = worldToScreen(camera, { x: bounds.x, y: bounds.y });
  assert.ok(topLeft.x >= 50 - 1e-6);
  assert.ok(topLeft.y >= 50 - 1e-6);
});

test("fitBounds degrades safely for an empty board", () => {
  const camera = fitBounds({ x: 0, y: 0, w: 0, h: 0 }, { width: 400, height: 300 }, 20);
  assert.deepEqual(camera, { panX: 200, panY: 150, zoom: 1 });
});
