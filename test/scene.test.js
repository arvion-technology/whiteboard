import test from "node:test";
import assert from "node:assert/strict";
import {
  createScene, addShape, duplicateShapes, hitTest, moveShapes, removeShapes,
  reorderShapes, sceneBounds, sceneCounts, serializeScene, deserializeScene,
  shapesById, shapesInRect, updateShape,
} from "../src/scene.js";
import { createShape } from "../src/shapes.js";
import { connectorGeometry } from "../src/connectors.js";

function sampleScene() {
  return createScene({
    name: "Test board",
    shapes: [
      createShape("rect", { id: "r1", x: 0, y: 0, w: 100, h: 80, label: "One" }),
      createShape("ellipse", { id: "e1", x: 200, y: 0, w: 100, h: 80, label: "Two" }),
      createShape("sticky", { id: "s1", x: 0, y: 200, w: 100, h: 100, text: "Note" }),
      createShape("text", { id: "t1", x: 200, y: 200, w: 120, h: 30, text: "Label" }),
      createShape("connector", { id: "c1", from: "r1", to: "e1" }),
    ],
  });
}

test("hitTest finds rectangles, ellipse interiors and empty space", () => {
  const scene = sampleScene();
  assert.equal(hitTest(scene, { x: 50, y: 40 }).shape.id, "r1");
  assert.equal(hitTest(scene, { x: 250, y: 40 }).shape.id, "e1");
  assert.equal(hitTest(scene, { x: 320, y: -20 }), null);
  // A bounding-box corner of an ellipse is outside the ellipse itself.
  assert.equal(hitTest(scene, { x: 205, y: 5 }), null);
});

test("hitTest finds sticky notes and free text", () => {
  const scene = sampleScene();
  assert.equal(hitTest(scene, { x: 40, y: 240 }).shape.id, "s1");
  assert.equal(hitTest(scene, { x: 250, y: 215 }).shape.id, "t1");
});

test("the topmost shape wins when shapes overlap", () => {
  let scene = createScene({ shapes: [createShape("rect", { id: "a", x: 0, y: 0, w: 100, h: 100 })] });
  scene = addShape(scene, createShape("rect", { id: "b", x: 40, y: 40, w: 100, h: 100 }));
  assert.equal(hitTest(scene, { x: 60, y: 60 }).shape.id, "b");
  scene = reorderShapes(scene, ["b"], "back");
  assert.equal(hitTest(scene, { x: 60, y: 60 }).shape.id, "a");
});

test("connectors are hit-tested along the curve, not in their bounding box", () => {
  const scene = sampleScene();
  const geom = connectorGeometry(scene.shapes.find((s) => s.id === "c1"), shapesById(scene));
  const onCurve = hitTest(scene, geom.mid, { tolerance: 8, zoom: 1 });
  assert.equal(onCurve.shape.id, "c1");
  assert.equal(onCurve.part, "connector");
  // A point inside the connector bounds but well off the curve misses it.
  const offCurve = { x: 150, y: geom.bounds.y + 2 };
  assert.equal(hitTest(scene, offCurve, { tolerance: 4, zoom: 1 }), null);
});

test("hit tolerance is expressed in screen pixels", () => {
  const scene = sampleScene();
  const geom = connectorGeometry(scene.shapes.find((s) => s.id === "c1"), shapesById(scene));
  const offset = { x: geom.mid.x, y: geom.mid.y + 9 };
  assert.equal(hitTest(scene, offset, { tolerance: 8, zoom: 2 }), null); // 9 world px = 18 screen px
  assert.equal(hitTest(scene, offset, { tolerance: 8, zoom: 0.5 }).shape.id, "c1");
});

test("moveShapes moves the selection and leaves the rest alone", () => {
  const scene = sampleScene();
  const moved = moveShapes(scene, ["r1", "s1"], 15, -10);
  assert.deepEqual([moved.shapes[0].x, moved.shapes[0].y], [15, -10]);
  assert.deepEqual([moved.shapes[1].x, moved.shapes[1].y], [200, 0]);
  assert.deepEqual([moved.shapes[2].x, moved.shapes[2].y], [15, 190]);
});

test("deleting a node deletes its attached connectors", () => {
  const scene = sampleScene();
  const pruned = removeShapes(scene, ["r1"]);
  assert.equal(pruned.shapes.some((s) => s.id === "r1"), false);
  assert.equal(pruned.shapes.some((s) => s.id === "c1"), false);
  // Deleting an unrelated node keeps the connector.
  assert.ok(removeShapes(scene, ["s1"]).shapes.some((s) => s.id === "c1"));
});

test("reorderShapes moves blocks within paint order", () => {
  const scene = createScene({
    shapes: ["a", "b", "c", "d"].map((id) => createShape("rect", { id, x: 0, y: 0, w: 10, h: 10 })),
  });
  assert.deepEqual(reorderShapes(scene, ["c"], "front").shapes.map((s) => s.id), ["a", "b", "d", "c"]);
  assert.deepEqual(reorderShapes(scene, ["b"], "back").shapes.map((s) => s.id), ["b", "a", "c", "d"]);
  assert.deepEqual(reorderShapes(scene, ["b"], "forward").shapes.map((s) => s.id), ["a", "c", "b", "d"]);
  assert.deepEqual(reorderShapes(scene, ["c"], "backward").shapes.map((s) => s.id), ["a", "c", "b", "d"]);
});

test("duplicating connected shapes remaps the connector", () => {
  const scene = createScene({
    shapes: [
      createShape("rect", { id: "a", x: 0, y: 0, w: 80, h: 60 }),
      createShape("rect", { id: "b", x: 200, y: 0, w: 80, h: 60 }),
      createShape("connector", { id: "c", from: "a", to: "b" }),
    ],
  });
  const result = duplicateShapes(scene, ["a", "b"], 20);
  assert.equal(result.scene.shapes.length, 6);
  const copyIds = result.ids.filter((id) => !id.startsWith("connector"));
  const copyConnector = result.scene.shapes.find((s) => s.type === "connector" && s.id !== "c");
  assert.ok(copyIds.includes(copyConnector.from));
  assert.ok(copyIds.includes(copyConnector.to));
  assert.equal(result.scene.shapes.find((s) => s.id === copyConnector.from).x, 20);
});

test("marquee selection returns intersecting nodes only", () => {
  const scene = sampleScene();
  const hits = shapesInRect(scene, { x: -10, y: -10, w: 130, h: 130 }).map((s) => s.id);
  assert.deepEqual(hits, ["r1"]);
  const stickyHits = shapesInRect(scene, { x: -10, y: 150, w: 300, h: 200 }).map((s) => s.id);
  assert.deepEqual(stickyHits, ["s1", "t1"]);
});

test("scene bounds include node extents and connector curves", () => {
  const scene = sampleScene();
  const box = sceneBounds(scene);
  assert.equal(box.x, 0);
  assert.equal(box.y, 0);
  assert.ok(box.w >= 300);
  assert.ok(box.h >= 300);
});

test("scene counts and serialisation round-trip", () => {
  const scene = sampleScene();
  assert.deepEqual(sceneCounts(scene), { shapes: 4, connectors: 1, stickies: 1, texts: 1 });
  const restored = deserializeScene(serializeScene(scene));
  assert.equal(restored.name, "Test board");
  assert.equal(restored.shapes.length, 5);
  assert.deepEqual(restored.shapes.find((s) => s.id === "c1").from, "r1");
});

test("updateShape is a no-op for an unknown id", () => {
  const scene = sampleScene();
  assert.equal(updateShape(scene, "missing", { x: 5 }), scene);
});
