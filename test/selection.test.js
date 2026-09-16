import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDLES, handlePositions, getResizeHandle, handleCursor, resizeBounds,
  resizeShapes, selectionBounds, selectionInfo,
} from "../src/selection.js";
import { createScene, shapesById } from "../src/scene.js";
import { createShape } from "../src/shapes.js";

const box = { x: 100, y: 100, w: 200, h: 100 };

function scene() {
  return createScene({
    shapes: [
      createShape("rect", { id: "a", x: 100, y: 100, w: 200, h: 100 }),
      createShape("rect", { id: "b", x: 400, y: 100, w: 100, h: 100 }),
      createShape("sticky", { id: "s", x: 100, y: 300, w: 180, h: 150 }),
    ],
  });
}

test("handlePositions returns all eight handles", () => {
  const handles = handlePositions(box);
  assert.equal(handles.length, 8);
  assert.deepEqual(handles.map((h) => h.name), HANDLES);
  assert.deepEqual(handles[0], { name: "nw", x: 100, y: 100 });
  assert.deepEqual(handles[4], { name: "se", x: 300, y: 200 });
  assert.deepEqual(handles[3], { name: "e", x: 300, y: 150 });
});

test("handle hit testing uses a screen-space radius", () => {
  assert.equal(getResizeHandle(box, { x: 101, y: 101 }, 1), "nw");
  assert.equal(getResizeHandle(box, { x: 301, y: 201 }, 1), "se");
  assert.equal(getResizeHandle(box, { x: 150, y: 150 }, 1), null);
  // At 4x zoom the same world distance is four times larger on screen.
  assert.equal(getResizeHandle(box, { x: 104, y: 100 }, 4), null);
  assert.equal(getResizeHandle(box, { x: 104, y: 100 }, 1), "nw");
});

test("handleCursor maps corners and edges to the right cursor", () => {
  assert.equal(handleCursor("nw"), "nwse-resize");
  assert.equal(handleCursor("ne"), "nesw-resize");
  assert.equal(handleCursor("n"), "ns-resize");
  assert.equal(handleCursor("w"), "ew-resize");
});

test("resizeBounds anchors the opposite edge and clamps at the minimum", () => {
  assert.deepEqual(resizeBounds(box, "e", 40, 0), { x: 100, y: 100, w: 240, h: 100 });
  assert.deepEqual(resizeBounds(box, "w", -40, 0), { x: 60, y: 100, w: 240, h: 100 });
  assert.deepEqual(resizeBounds(box, "nw", -20, -10), { x: 80, y: 90, w: 220, h: 110 });
  const clamped = resizeBounds(box, "w", 500, 0, 40);
  assert.equal(clamped.w, 40);
  assert.equal(clamped.x, 260); // right edge stayed at 300
  const clampedN = resizeBounds(box, "n", 0, 500, 40);
  assert.equal(clampedN.h, 40);
  assert.equal(clampedN.y, 160); // bottom edge stayed at 200
});

test("resizeShapes resizes a single node", () => {
  const before = scene();
  const after = resizeShapes(before, ["a"], "se", 50, 30);
  const a = after.shapes.find((s) => s.id === "a");
  assert.deepEqual([a.x, a.y, a.w, a.h], [100, 100, 250, 130]);
  const b = after.shapes.find((s) => s.id === "b");
  assert.deepEqual([b.x, b.y, b.w, b.h], [400, 100, 100, 100]);
});

test("resizeShapes scales a multi-selection proportionally", () => {
  const before = scene();
  const group = selectionBounds(before, ["a", "b"]);
  assert.deepEqual(group, { x: 100, y: 100, w: 400, h: 100 });
  const after = resizeShapes(before, ["a", "b"], "se", 400, 100);
  const a = after.shapes.find((s) => s.id === "a");
  const b = after.shapes.find((s) => s.id === "b");
  assert.deepEqual([a.x, a.y, a.w, a.h], [100, 100, 400, 200]);
  assert.deepEqual([b.x, b.y, b.w, b.h], [700, 100, 200, 200]);
});

test("selectionBounds unions nodes and connector curves", () => {
  const s = scene();
  assert.deepEqual(selectionBounds(s, ["a", "s"]), { x: 100, y: 100, w: 200, h: 350 });
  assert.equal(selectionBounds(s, []), null);
  const info = selectionInfo(s, ["s"]);
  assert.equal(info.count, 1);
  assert.equal(info.single.id, "s");
  assert.equal(info.hasConnector, false);
});

test("connectors are excluded from geometric resize but included in bounds", () => {
  const s = createScene({
    shapes: [
      createShape("rect", { id: "a", x: 0, y: 0, w: 100, h: 100 }),
      createShape("rect", { id: "b", x: 300, y: 0, w: 100, h: 100 }),
      createShape("connector", { id: "c", from: "a", to: "b" }),
    ],
  });
  const resized = resizeShapes(s, ["a", "b", "c"], "e", 50, 0);
  assert.equal(resized.shapes.find((x) => x.id === "c").id, "c");
  assert.ok(shapesById(resized).has("c"));
  const bounds = selectionBounds(s, ["c"]);
  assert.ok(bounds.w > 0);
  const info = selectionInfo(s, ["c"]);
  assert.equal(info.hasConnector, true);
  assert.ok(info.bounds.w > 0);
});
