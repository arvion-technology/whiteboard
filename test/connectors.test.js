import test from "node:test";
import assert from "node:assert/strict";
import { connectorGeometry, chooseSides, arrowHead, hitConnector, pathData, sidePoint } from "../src/connectors.js";
import { createScene, shapesById, updateShape, moveShapes } from "../src/scene.js";
import { createShape } from "../src/shapes.js";

function board() {
  return createScene({
    shapes: [
      createShape("rect", { id: "a", x: 0, y: 0, w: 100, h: 80 }),
      createShape("rect", { id: "b", x: 300, y: 0, w: 100, h: 80 }),
      createShape("connector", { id: "c", from: "a", to: "b" }),
    ],
  });
}

const geomOf = (scene) => connectorGeometry(scene.shapes.find((s) => s.id === "c"), shapesById(scene));

test("auto anchors attach to the facing side midpoints", () => {
  const geom = geomOf(board());
  assert.deepEqual(geom.fromSide, "right");
  assert.deepEqual(geom.toSide, "left");
  assert.deepEqual(geom.a, { x: 100, y: 40 });
  assert.deepEqual(geom.b, { x: 300, y: 40 });
});

test("moving an endpoint shape recomputes its anchor", () => {
  let scene = board();
  scene = updateShape(scene, "b", { x: 480 });
  const geom = geomOf(scene);
  assert.deepEqual(geom.b, { x: 480, y: 40 });
  assert.deepEqual(geom.a, { x: 100, y: 40 });
  // The curve follows: the midpoint moves right with the shape.
  const before = geomOf(board()).mid.x;
  assert.ok(geom.mid.x > before);
});

test("moving a shape below its partner flips the chosen sides", () => {
  let scene = board();
  scene = updateShape(scene, "b", { x: 0, y: 300 });
  const geom = geomOf(scene);
  assert.equal(geom.fromSide, "bottom");
  assert.equal(geom.toSide, "top");
  assert.deepEqual(geom.a, { x: 50, y: 80 });
  assert.deepEqual(geom.b, { x: 50, y: 300 });
});

test("moving both shapes shifts both anchors by the same delta", () => {
  const base = geomOf(board());
  const moved = geomOf(moveShapes(board(), ["a", "b"], 60, -30));
  assert.deepEqual(moved.a, { x: base.a.x + 60, y: base.a.y - 30 });
  assert.deepEqual(moved.b, { x: base.b.x + 60, y: base.b.y - 30 });
});

test("explicit sides override auto selection", () => {
  let scene = board();
  scene = updateShape(scene, "c", { fromSide: "top", toSide: "bottom" });
  const geom = geomOf(scene);
  assert.equal(geom.fromSide, "top");
  assert.equal(geom.toSide, "bottom");
  assert.deepEqual(geom.a, { x: 50, y: 0 });
  assert.deepEqual(geom.b, { x: 350, y: 80 });
});

test("chooseSides prefers the axis with the larger gap", () => {
  const a = { x: 0, y: 0, w: 100, h: 100 };
  assert.deepEqual(chooseSides(a, { x: 300, y: 0, w: 100, h: 100 }), { fromSide: "right", toSide: "left" });
  assert.deepEqual(chooseSides(a, { x: 0, y: 300, w: 100, h: 100 }), { fromSide: "bottom", toSide: "top" });
  assert.deepEqual(chooseSides(a, { x: -300, y: 0, w: 100, h: 100 }), { fromSide: "left", toSide: "right" });
});

test("a dangling connector has no geometry", () => {
  const scene = createScene({
    shapes: [
      createShape("rect", { id: "a", x: 0, y: 0, w: 100, h: 80 }),
      createShape("connector", { id: "c", from: "a", to: "missing" }),
    ],
  });
  assert.equal(geomOf(scene), null);
});

test("path data and arrowhead agree on the endpoint", () => {
  const geom = geomOf(board());
  const path = pathData(geom);
  assert.match(path, /^M 100 40 C /);
  assert.match(path, / 300 40$/);
  const arrow = arrowHead(geom);
  assert.deepEqual(arrow.tip, { x: 300, y: 40 });
  assert.equal(arrow.points.length, 3);
  assert.ok(arrow.points[0].x > arrow.points[1].x);
});

test("connector hit testing follows the curve and a zoom-aware tolerance", () => {
  const geom = geomOf(board());
  assert.equal(hitConnector(geom, geom.mid, 8, 1), true);
  assert.equal(hitConnector(geom, { x: geom.mid.x, y: geom.mid.y + 30 }, 8, 1), false);
  assert.equal(hitConnector(geom, { x: geom.mid.x, y: geom.mid.y + 12 }, 8, 2), false); // 24 screen px
  assert.equal(hitConnector(geom, { x: geom.mid.x, y: geom.mid.y + 12 }, 8, 0.5), true);
});

test("sidePoint covers all four sides", () => {
  const box = { x: 10, y: 20, w: 100, h: 60 };
  assert.deepEqual(sidePoint(box, "top"), { x: 60, y: 20 });
  assert.deepEqual(sidePoint(box, "right"), { x: 110, y: 50 });
  assert.deepEqual(sidePoint(box, "bottom"), { x: 60, y: 80 });
  assert.deepEqual(sidePoint(box, "left"), { x: 10, y: 50 });
});
