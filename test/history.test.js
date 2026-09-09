import test from "node:test";
import assert from "node:assert/strict";
import {
  createHistory, commit, undo, redo, canUndo, canRedo, currentScene,
  currentEntry, undoLabel, redoLabel, historyDepth,
} from "../src/history.js";
import { createScene, addShape } from "../src/scene.js";
import { createShape } from "../src/shapes.js";

function sceneWith(ids) {
  return createScene({ name: "History", shapes: ids.map((id) => createShape("rect", { id, x: 0, y: 0, w: 40, h: 40 })) });
}

test("a new history cannot undo", () => {
  const history = createHistory(sceneWith(["a"]));
  assert.equal(canUndo(history), false);
  assert.equal(canRedo(history), false);
  assert.equal(currentEntry(history).label, "Board loaded");
  assert.deepEqual(historyDepth(history), { past: 0, future: 0, limit: 80 });
});

test("commit, undo and redo walk the snapshot timeline", () => {
  let scene = sceneWith(["a"]);
  let history = createHistory(scene);
  scene = addShape(scene, createShape("rect", { id: "b", x: 100, y: 0, w: 40, h: 40 }));
  history = commit(history, scene, "Add rectangle");
  assert.equal(currentScene(history).shapes.length, 2);
  assert.equal(canUndo(history), true);
  assert.equal(undoLabel(history), "Add rectangle");

  history = undo(history);
  assert.equal(currentScene(history).shapes.length, 1);
  assert.equal(canRedo(history), true);
  assert.equal(redoLabel(history), "Add rectangle");

  history = redo(history);
  assert.equal(currentScene(history).shapes.length, 2);
  assert.equal(canRedo(history), false);
});

test("undo stops at the first entry", () => {
  let history = createHistory(sceneWith(["a"]));
  history = commit(history, addShape(currentScene(history), createShape("rect", { id: "b" })), "Add b");
  history = undo(history);
  assert.equal(canUndo(history), false);
  assert.equal(undo(history), history);
  assert.equal(canRedo(history), true);
});

test("a new commit after undo discards the redo branch", () => {
  let scene = sceneWith(["a"]);
  let history = createHistory(scene);
  history = commit(history, addShape(scene, createShape("rect", { id: "b" })), "Add b");
  history = undo(history);
  scene = addShape(currentScene(history), createShape("rect", { id: "c" }));
  history = commit(history, scene, "Add c");
  assert.equal(canRedo(history), false);
  assert.equal(currentScene(history).shapes.at(-1).id, "c");
  assert.equal(currentEntry(history).label, "Add c");
});

test("committing an identical scene is a no-op", () => {
  const history = createHistory(sceneWith(["a"]));
  const same = commit(history, currentScene(history), "Nothing");
  assert.equal(same, history);
});

test("snapshot history honours its limit", () => {
  let history = createHistory(sceneWith(["s0"]), { limit: 3 });
  for (let i = 1; i <= 5; i++) {
    const scene = addShape(currentScene(history), createShape("rect", { id: `s${i}` }));
    history = commit(history, scene, `Add ${i}`);
  }
  assert.equal(history.entries.length, 3);
  assert.equal(history.index, 2);
  assert.equal(currentScene(history).shapes.length, 6);
  history = undo(history);
  history = undo(history);
  assert.equal(canUndo(history), false);
  assert.equal(currentScene(history).shapes.length, 4);
  assert.deepEqual(historyDepth(history), { past: 0, future: 2, limit: 3 });
});
