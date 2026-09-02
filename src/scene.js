// Scene graph operations. The scene is `{ name, shapes }` where array order is
// paint order: later shapes sit on top. Every operation returns a new scene so
// history snapshots cannot be mutated from under an undo entry.

import { intersects, unionBounds } from "./geometry.js";
import { connectorGeometry, hitConnector } from "./connectors.js";
import {
  cloneShape, isConnectable, makeId, moveShape, shapeBounds, shapeContains,
} from "./shapes.js";

export const SCENE_VERSION = 1;

export function createScene(init = {}) {
  const shapes = Array.isArray(init.shapes) ? init.shapes.map(cloneShape) : [];
  return { version: SCENE_VERSION, name: init.name || "Untitled board", shapes };
}

export function listShapes(scene) {
  return scene.shapes;
}

export function shapeById(scene, id) {
  return scene.shapes.find((shape) => shape.id === id) || null;
}

export function shapesById(scene) {
  return new Map(scene.shapes.map((shape) => [shape.id, shape]));
}

export function geometricShapes(scene) {
  return scene.shapes.filter((shape) => shape.type !== "connector");
}

export function addShape(scene, shape) {
  return { ...scene, shapes: [...scene.shapes, cloneShape(shape)] };
}

export function addShapes(scene, shapes) {
  return { ...scene, shapes: [...scene.shapes, ...shapes.map(cloneShape)] };
}

export function updateShape(scene, id, patch) {
  let changed = false;
  const shapes = scene.shapes.map((shape) => {
    if (shape.id !== id) return shape;
    changed = true;
    return { ...shape, ...patch };
  });
  return changed ? { ...scene, shapes } : scene;
}

export function updateShapes(scene, patches) {
  const byId = patches instanceof Map ? patches : new Map(Object.entries(patches));
  let changed = false;
  const shapes = scene.shapes.map((shape) => {
    if (!byId.has(shape.id)) return shape;
    changed = true;
    return { ...shape, ...byId.get(shape.id) };
  });
  return changed ? { ...scene, shapes } : scene;
}

export function moveShapes(scene, ids, dx, dy) {
  const selected = new Set(ids);
  if (!selected.size) return scene;
  return {
    ...scene,
    shapes: scene.shapes.map((shape) => (selected.has(shape.id) ? moveShape(shape, dx, dy) : shape)),
  };
}

/**
 * Removing a node has to take its connectors with it. A connector with only one
 * endpoint is not renderable, so leaving it in the graph would only create a
 * hidden shape the user cannot select or delete.
 */
export function removeShapes(scene, ids) {
  const removed = new Set(ids);
  const shapes = scene.shapes.filter((shape) => {
    if (removed.has(shape.id)) return false;
    if (shape.type === "connector" && (removed.has(shape.from) || removed.has(shape.to))) return false;
    return true;
  });
  return { ...scene, shapes };
}

export const REORDER_MODES = ["front", "back", "forward", "backward"];

export function reorderShapes(scene, ids, mode) {
  const selected = new Set(ids);
  if (!selected.size) return scene;
  const shapes = scene.shapes.slice();

  if (mode === "front") {
    const stay = shapes.filter((shape) => !selected.has(shape.id));
    const lift = shapes.filter((shape) => selected.has(shape.id));
    return { ...scene, shapes: [...stay, ...lift] };
  }
  if (mode === "back") {
    const lift = shapes.filter((shape) => selected.has(shape.id));
    const stay = shapes.filter((shape) => !selected.has(shape.id));
    return { ...scene, shapes: [...lift, ...stay] };
  }
  if (mode === "forward") {
    // Walk from the top so a selected block slides up together.
    for (let i = shapes.length - 2; i >= 0; i--) {
      if (selected.has(shapes[i].id) && !selected.has(shapes[i + 1].id)) {
        [shapes[i], shapes[i + 1]] = [shapes[i + 1], shapes[i]];
      }
    }
    return { ...scene, shapes };
  }
  if (mode === "backward") {
    for (let i = 1; i < shapes.length; i++) {
      if (selected.has(shapes[i].id) && !selected.has(shapes[i - 1].id)) {
        [shapes[i], shapes[i - 1]] = [shapes[i - 1], shapes[i]];
      }
    }
    return { ...scene, shapes };
  }
  return scene;
}

/**
 * Duplicate the selection and offset it. A connector is only copied when both
 * of its endpoints were copied too, otherwise the copy would point at the
 * originals and the user would have created a hidden cross-link.
 */
export function duplicateShapes(scene, ids, offset = 24) {
  const selected = new Set(ids);
  const idMap = new Map();
  const copies = [];

  for (const shape of scene.shapes) {
    if (!selected.has(shape.id) || shape.type === "connector") continue;
    const copy = cloneShape(shape);
    copy.id = makeId("copy");
    copy.x += offset;
    copy.y += offset;
    idMap.set(shape.id, copy.id);
    copies.push(copy);
  }

  for (const shape of scene.shapes) {
    if (shape.type !== "connector") continue;
    if (!idMap.has(shape.from) || !idMap.has(shape.to)) continue;
    const copy = cloneShape(shape);
    copy.id = makeId("connector");
    copy.from = idMap.get(shape.from);
    copy.to = idMap.get(shape.to);
    copies.push(copy);
  }

  if (!copies.length) return { scene, ids: [], idMap };
  return { scene: { ...scene, shapes: [...scene.shapes, ...copies] }, ids: copies.map((s) => s.id), idMap };
}

/**
 * Topmost shape under the point. Nodes win over connectors regardless of paint
 * order because a connector under a sticky must never steal the click that was
 * meant for the sticky. Connectors use a screen-space tolerance converted to
 * world units so they stay clickable at every zoom level.
 */
export function hitTest(scene, point, { tolerance = 7, zoom = 1 } = {}) {
  for (let i = scene.shapes.length - 1; i >= 0; i--) {
    const shape = scene.shapes[i];
    if (shape.type === "connector") continue;
    if (shapeContains(shape, point)) return { shape, part: "body" };
  }
  if (tolerance > 0) {
    const byId = shapesById(scene);
    for (let i = scene.shapes.length - 1; i >= 0; i--) {
      const shape = scene.shapes[i];
      if (shape.type !== "connector") continue;
      const geom = connectorGeometry(shape, byId);
      if (geom && hitConnector(geom, point, tolerance, zoom)) return { shape, part: "connector" };
    }
  }
  return null;
}

export function shapesInRect(scene, box) {
  return geometricShapes(scene).filter((shape) => intersects(shape, box));
}

export function sceneBounds(scene) {
  const byId = shapesById(scene);
  const boxes = [];
  for (const shape of scene.shapes) {
    if (shape.type === "connector") {
      const geom = connectorGeometry(shape, byId);
      if (geom) boxes.push(geom.bounds);
    } else {
      boxes.push(shapeBounds(shape));
    }
  }
  return unionBounds(boxes) || { x: 0, y: 0, w: 900, h: 620 };
}

export function sceneCounts(scene) {
  const counts = { shapes: 0, connectors: 0, stickies: 0, texts: 0 };
  for (const shape of scene.shapes) {
    if (shape.type === "connector") counts.connectors += 1;
    else {
      counts.shapes += 1;
      if (shape.type === "sticky") counts.stickies += 1;
      if (shape.type === "text") counts.texts += 1;
    }
  }
  return counts;
}

export function connectableShapes(scene) {
  return scene.shapes.filter(isConnectable);
}

export function serializeScene(scene) {
  return JSON.stringify({
    version: SCENE_VERSION,
    name: scene.name,
    shapes: scene.shapes.map(cloneShape),
  });
}

export function deserializeScene(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.shapes)) throw new Error("Invalid scene payload");
  return createScene({ name: data.name, shapes: data.shapes });
}
