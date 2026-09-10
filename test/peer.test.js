import test from "node:test";
import assert from "node:assert/strict";
import { createPeer, describePeerOp, stepPeer } from "../src/peer.js";
import { seedBoard } from "../src/board.js";

test("peer movement is deterministic for a given seed", () => {
  const scene = seedBoard("sprint");
  const a = createPeer({ seed: 11, cursor: { x: 400, y: 300 } });
  const b = createPeer({ seed: 11, cursor: { x: 400, y: 300 } });
  const opsA = [];
  const opsB = [];
  for (let i = 0; i < 80; i++) {
    const opA = stepPeer(a, 0.1, scene);
    const opB = stepPeer(b, 0.1, scene);
    if (opA) opsA.push(opA);
    if (opB) opsB.push(opB);
  }
  assert.deepEqual(opsA, opsB);
  assert.deepEqual(a.cursor, b.cursor);
  assert.ok(opsA.length >= 1);
});

test("the peer moves its cursor between waypoints", () => {
  const peer = createPeer({ seed: 4, cursor: { x: 0, y: 0 } });
  const start = { ...peer.cursor };
  for (let i = 0; i < 20; i++) stepPeer(peer, 0.1, seedBoard("sprint"));
  assert.notDeepEqual(peer.cursor, start);
  assert.ok(Number.isFinite(peer.cursor.x) && Number.isFinite(peer.cursor.y));
});

test("the first peer action places a note and the second nudges a shape", () => {
  const scene = seedBoard("sprint");
  const peer = createPeer({ seed: 2, cursor: { x: 600, y: 400 } });
  const ops = [];
  for (let i = 0; i < 400 && ops.length < 3; i++) {
    const op = stepPeer(peer, 0.1, scene);
    if (op) ops.push(op);
  }
  assert.equal(ops[0].type, "place-sticky");
  assert.equal(ops[1].type, "nudge");
  assert.equal(ops[2].type, "place-sticky");
  assert.ok(ops[0].sticky.text.length > 0);
  assert.ok(scene.shapes.some((shape) => shape.id === ops[1].id));
  assert.equal(ops[0].sticky.id, "peer-note-nyx-1");
  assert.ok(describePeerOp(ops[0]).startsWith("placed"));
});
