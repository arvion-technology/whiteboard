// Undo/redo as labelled scene snapshots.
//
// A whiteboard edit is cheap to clone (a few hundred plain objects) and the
// command pattern buys nothing here: every gesture already produces a complete
// scene. Snapshot history is simpler to reason about, and it makes undo of a
// multi-shape move or a peer-driven deletion trivially correct.

import { serializeScene } from "./scene.js";

export const DEFAULT_HISTORY_LIMIT = 80;

export function createHistory(scene, { limit = DEFAULT_HISTORY_LIMIT, label = "Board loaded" } = {}) {
  return { entries: [{ scene, label }], index: 0, limit: Math.max(2, limit) };
}

export function currentEntry(history) {
  return history.entries[history.index];
}

export function currentScene(history) {
  return currentEntry(history).scene;
}

export function canUndo(history) {
  return history.index > 0;
}

export function canRedo(history) {
  return history.index < history.entries.length - 1;
}

/** Label of the action an undo would reverse, or null at the start. */
export function undoLabel(history) {
  return canUndo(history) ? history.entries[history.index].label : null;
}

export function redoLabel(history) {
  return canRedo(history) ? history.entries[history.index + 1].label : null;
}

export function commit(history, scene, label = "Edit") {
  const present = currentScene(history);
  if (serializeScene(present) === serializeScene(scene)) return history;

  // Anything that was redoable is now unreachable, which is what every editor
  // does: a new edit forks the timeline.
  const entries = history.entries.slice(0, history.index + 1);
  entries.push({ scene, label });
  while (entries.length > history.limit) entries.shift();
  return { ...history, entries, index: entries.length - 1 };
}

export function undo(history) {
  if (!canUndo(history)) return history;
  return { ...history, index: history.index - 1 };
}

export function redo(history) {
  if (!canRedo(history)) return history;
  return { ...history, index: history.index + 1 };
}

export function historyDepth(history) {
  return { past: history.index, future: history.entries.length - 1 - history.index, limit: history.limit };
}
