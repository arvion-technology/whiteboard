import test from "node:test";
import assert from "node:assert/strict";
import { BOARDS, seedBoard } from "../src/board.js";
import { sceneBounds, sceneCounts, serializeScene, shapesById } from "../src/scene.js";
import { connectorGeometry } from "../src/connectors.js";

for (const kind of Object.keys(BOARDS)) {
  test(`seed board "${kind}" is populated and internally connected`, () => {
    const scene = seedBoard(kind);
    const counts = sceneCounts(scene);
    assert.ok(counts.shapes >= 10, `${counts.shapes} nodes`);
    assert.ok(counts.connectors >= 4, `${counts.connectors} connectors`);
    assert.equal(scene.name, BOARDS[kind].name);

    const byId = shapesById(scene);
    for (const shape of scene.shapes) {
      assert.ok(shape.id, "every shape needs an id");
      if (shape.type === "connector") {
        assert.ok(byId.has(shape.from), `missing connector source ${shape.from}`);
        assert.ok(byId.has(shape.to), `missing connector target ${shape.to}`);
        assert.ok(connectorGeometry(shape, byId), "connector must resolve");
      }
    }

    const box = sceneBounds(scene);
    assert.ok(box.w > 300 && box.h > 300);
    assert.ok(Number.isFinite(box.x) && Number.isFinite(box.y));
  });
}

test("the seed boards are deterministic", () => {
  assert.equal(serializeScene(seedBoard("sprint")), serializeScene(seedBoard("sprint")));
  assert.equal(serializeScene(seedBoard("flow")), serializeScene(seedBoard("flow")));
  assert.notEqual(serializeScene(seedBoard("sprint")), serializeScene(seedBoard("flow")));
});

test("unknown board kinds fall back to the default", () => {
  assert.equal(seedBoard("nope").name, BOARDS.sprint.name);
});
