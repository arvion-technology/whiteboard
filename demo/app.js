// Canvas demo, rendering, input and UI.
//
// All board logic lives in ../src and is imported here unchanged; this file owns
// only the canvas renderer, pointer/keyboard handling and DOM chrome. The same
// scene objects go to the PNG renderer and the SVG exporter, so what downloads
// is what sits on screen.

import {
  createCamera, screenToWorld, worldToScreen, zoomAt, setZoom, panBy, fitBounds,
} from "../src/transform.js";
import { clamp, normalizeBounds, unionBounds } from "../src/geometry.js";
import {
  createShape, shapeBounds, textLayout, visibleTextLines, fitTextShape,
  stickyColor, STICKY_COLOR_KEYS, isFrameShape, isConnectable,
} from "../src/shapes.js";
import {
  connectorGeometry, chooseSides, sidePoint, arrowHead,
} from "../src/connectors.js";
import {
  addShape, duplicateShapes, geometricShapes, hitTest, moveShapes,
  removeShapes, reorderShapes, sceneBounds, sceneCounts, shapeById, shapesById,
  shapesInRect, updateShape,
} from "../src/scene.js";
import {
  getResizeHandle, handleCursor, handlePositions, resizeShapes, selectionInfo,
} from "../src/selection.js";
import {
  canRedo, canUndo, commit, createHistory, currentScene, redo, redoLabel, undo, undoLabel,
} from "../src/history.js";
import { createPeer, stepPeer } from "../src/peer.js";
import { exportSize, sceneFileName, sceneToSVG } from "../src/export.js";
import { BOARDS, DEFAULT_BOARD, seedBoard } from "../src/board.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const dom = {
  canvas: $("#board"),
  minimap: $("#minimap"),
  card: $("#board-card"),
  title: $("#board-title"),
  saved: $("#saved-state"),
  undo: $("#undo"),
  redo: $("#redo"),
  exportSvg: $("#export-svg"),
  exportPng: $("#export-png"),
  zoomReset: $("#zoom-reset"),
  zoomIn: $("#zoom-in"),
  zoomOut: $("#zoom-out"),
  zoomFit: $("#zoom-fit"),
  minimapZoom: $("#minimap-zoom"),
  hint: $("#hint"),
  inspector: $("#inspector"),
  activity: $("#activity-list"),
  activityCount: $("#activity-count"),
  peerStatus: $("#peer-status"),
};

const ctx = dom.canvas.getContext("2d");
const minimapCtx = dom.minimap.getContext("2d");

const TAU = Math.PI * 2;
const GRID_WORLD = 28;
const HANDLE_PX = 9;
const SHAPE_NAMES = {
  rect: "Rectangle", ellipse: "Ellipse", sticky: "Sticky note", text: "Text", connector: "Connector",
};
const UI_FONT = 'Inter, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const ARRANGE_ICONS = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M12 10v9"/><path d="m8 15 4 4 4-4"/></svg>',
  backward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v11"/><path d="m8 12 4 4 4-4"/></svg>',
  forward: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V8"/><path d="m8 12 4-4 4 4"/></svg>',
  front: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18h16"/><path d="M12 14V5"/><path d="m8 9 4-4 4 4"/></svg>',
};

const state = {
  boardKind: DEFAULT_BOARD,
  scene: null,
  history: null,
  camera: createCamera(),
  viewport: { width: 1098, height: 806 },
  minimapSize: { width: 188, height: 118 },
  minimapMap: null,
  dpr: 1,
  tool: "select",
  selection: new Set(),
  hoverId: null,
  hoverHandle: null,
  pointer: { screen: { x: 0, y: 0 }, world: { x: 0, y: 0 } },
  drag: null,
  connectorFrom: null,
  editing: null,
  spaceDown: false,
  showGrid: true,
  peer: null,
  activity: [],
  inspectorSig: "",
  initialised: false,
  viewSized: false,
  lastFrame: 0,
  lastChrome: 0,
  savedTimer: null,
};

/* ------------------------------------------------------------------ helpers */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));
}

function toast(message, kind = "success") {
  if (window.A?.toast) A.toast(message, kind, 2300);
}

function truncate(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function snapToGrid(value) {
  return Math.round(value / 8) * 8;
}

function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName ? target.tagName.toLowerCase() : "";
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

/* -------------------------------------------------------------------- boot */

function resize() {
  const rect = dom.card.getBoundingClientRect();
  const previous = state.viewport;
  state.viewport = {
    width: Math.max(320, Math.round(rect.width)),
    height: Math.max(320, Math.round(rect.height)),
  };
  state.dpr = Math.min(2, window.devicePixelRatio || 1);
  dom.canvas.width = Math.round(state.viewport.width * state.dpr);
  dom.canvas.height = Math.round(state.viewport.height * state.dpr);
  dom.minimap.width = Math.round(state.minimapSize.width * state.dpr);
  dom.minimap.height = Math.round(state.minimapSize.height * state.dpr);

  if (!state.initialised) {
    loadBoard(hashKind());
    state.initialised = true;
  } else {
    // Keep the world point at the centre of the viewport stable when chrome
    // resizes (window resize, responsive rail).
    const centre = screenToWorld(state.camera, { x: previous.width / 2, y: previous.height / 2 });
    state.camera = {
      ...state.camera,
      panX: state.viewport.width / 2 - centre.x * state.camera.zoom,
      panY: state.viewport.height / 2 - centre.y * state.camera.zoom,
    };
  }

  // A headless capture can run before the flexible layout settles. The first
  // measurement then comes back clamped to the minimum, so once the real card
  // size arrives, fit the board again instead of leaving a stretched canvas.
  if (!state.viewSized && state.viewport.width > 600 && state.viewport.height > 400) {
    state.viewSized = true;
    fitView();
  }
}

function hashKind() {
  const kind = location.hash.replace(/^#/, "").toLowerCase();
  return BOARDS[kind] ? kind : DEFAULT_BOARD;
}

function seedActivity(kind) {
  const now = Date.now();
  return [
    { who: "You", color: "#b28bff", text: `opened “${BOARDS[kind].name}”`, at: now - 90000 },
    { who: "Nyx", color: "#ff7ac6", text: "joined as a simulated peer", at: now - 45000 },
    { who: "You", color: "#b28bff", text: "loaded the seeded board", at: now - 8000 },
  ];
}

function loadBoard(kind, { resetView = true } = {}) {
  const meta = BOARDS[kind] || BOARDS[DEFAULT_BOARD];
  state.boardKind = meta.kind;
  state.scene = seedBoard(meta.kind);
  state.history = createHistory(state.scene, { label: "Board loaded" });
  state.selection = new Set(meta.selectId ? [meta.selectId] : []);
  state.drag = null;
  state.connectorFrom = null;
  state.hoverId = null;
  state.hoverHandle = null;
  state.tool = "select";
  state.activity = seedActivity(meta.kind);
  state.peer = createPeer({
    seed: 7,
    cursor: meta.kind === "flow" ? { x: 430, y: 430 } : { x: 980, y: 330 },
    cooldown: 8.5,
  });
  dom.title.textContent = meta.name;
  document.title = `${meta.name} · Canvas`;
  closeEditor({ cancel: true });
  updateToolButtons();
  if (resetView) fitView();
  renderInspector();
  renderActivity();
  updateChrome();
  updateCursor();
  markSaved();
  dom.activityCount.textContent = String(state.activity.length);
  if (meta.selectId) toast("Deep link opened the flow board");
}

function fitView() {
  state.camera = fitBounds(sceneBounds(state.scene), state.viewport, 64);
  updateChrome();
}

/* ---------------------------------------------------------------- painting */

function roundRectPath(context, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawDotGrid(context, camera, viewport) {
  let spacing = GRID_WORLD;
  while (spacing * camera.zoom < 11) spacing *= 2;
  while (spacing * camera.zoom > 70) spacing /= 2;

  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: viewport.width, y: viewport.height });
  const startX = Math.floor(topLeft.x / spacing) * spacing;
  const startY = Math.floor(topLeft.y / spacing) * spacing;
  const radius = camera.zoom >= 1 ? 1.15 : 1.35;

  context.save();
  context.fillStyle = "rgba(96, 74, 58, 0.17)";
  for (let x = startX; x <= bottomRight.x; x += spacing) {
    for (let y = startY; y <= bottomRight.y; y += spacing) {
      const point = worldToScreen(camera, { x, y });
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, TAU);
      context.fill();
    }
  }
  context.restore();
}

function paintBoard(context, viewport, dpr, scene, camera, { grid = true } = {}) {
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, viewport.width, viewport.height);

  const wash = context.createLinearGradient(0, 0, 0, viewport.height);
  wash.addColorStop(0, "#fcf8f1");
  wash.addColorStop(0.65, "#faf6ee");
  wash.addColorStop(1, "#f6f0e5");
  context.fillStyle = wash;
  context.fillRect(0, 0, viewport.width, viewport.height);

  if (grid) drawDotGrid(context, camera, viewport);

  context.save();
  context.translate(camera.panX, camera.panY);
  context.scale(camera.zoom, camera.zoom);
  drawSceneShapes(context, scene, camera);
  context.restore();
}

function drawSceneShapes(context, scene, camera) {
  const byId = shapesById(scene);
  const frames = scene.shapes.filter(isFrameShape);
  const connectors = scene.shapes.filter((shape) => shape.type === "connector");
  const nodes = scene.shapes.filter((shape) => shape.type !== "connector" && !isFrameShape(shape));

  for (const frame of frames) drawShape(context, frame, camera);
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const connector of connectors) drawConnector(context, connector, byId, camera);
  context.restore();
  for (const node of nodes) drawShape(context, node, camera);
}

function setShadow(context, zoom, { color, blur, offsetY }) {
  context.shadowColor = color;
  context.shadowBlur = blur / zoom;
  context.shadowOffsetY = offsetY / zoom;
}

function clearShadow(context) {
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
}

function drawTextLines(context, layout, startX, startY, color, weight) {
  context.fillStyle = color;
  context.font = `${weight} ${layout.fontSize}px ${UI_FONT}`;
  context.textAlign = "left";
  context.textBaseline = "top";
  layout.lines.forEach((line, index) => {
    context.fillText(line, startX, startY + index * layout.lineHeight);
  });
}

function drawShape(context, shape, camera) {
  const zoom = Math.max(0.05, camera.zoom);
  switch (shape.type) {
    case "rect": drawRect(context, shape, zoom); break;
    case "ellipse": drawEllipse(context, shape, zoom); break;
    case "sticky": drawSticky(context, shape, zoom); break;
    case "text": drawFreeText(context, shape); break;
    default: break;
  }
}

function drawRect(context, shape, zoom) {
  context.save();
  if (!shape.frame) setShadow(context, zoom, { color: "rgba(62, 44, 26, 0.14)", blur: 10, offsetY: 3 });
  roundRectPath(context, shape.x, shape.y, shape.w, shape.h, shape.radius ?? 12);
  context.fillStyle = shape.fill || "#fffdf8";
  context.fill();
  clearShadow(context);
  context.strokeStyle = shape.stroke || "#d8cbb9";
  context.lineWidth = shape.strokeWidth ?? 1.5;
  context.setLineDash(shape.dashed ? [7, 6] : []);
  context.stroke();
  context.restore();
  drawCenteredLabel(context, shape);
}

function drawEllipse(context, shape, zoom) {
  context.save();
  setShadow(context, zoom, { color: "rgba(62, 44, 26, 0.12)", blur: 10, offsetY: 3 });
  context.beginPath();
  context.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, shape.w / 2, shape.h / 2, 0, 0, TAU);
  context.fillStyle = shape.fill || "#f0e9ff";
  context.fill();
  clearShadow(context);
  context.strokeStyle = shape.stroke || "#b28bff";
  context.lineWidth = shape.strokeWidth ?? 2;
  context.stroke();
  context.restore();
  drawCenteredLabel(context, shape);
}

function drawCenteredLabel(context, shape) {
  const text = shape.label || "";
  if (!text) return;
  const layout = textLayout({ ...shape, text, type: "rect" });
  const total = layout.lines.length * layout.lineHeight;
  const startY = shape.y + shape.h / 2 - total / 2;
  context.save();
  context.fillStyle = shape.textColor || "#3a3048";
  context.font = `600 ${layout.fontSize}px ${UI_FONT}`;
  context.textAlign = "center";
  context.textBaseline = "top";
  layout.lines.forEach((line, index) => {
    context.fillText(line, shape.x + shape.w / 2, startY + index * layout.lineHeight);
  });
  context.restore();
}

function drawSticky(context, shape, zoom) {
  const palette = stickyColor(shape);
  context.save();
  setShadow(context, zoom, { color: "rgba(70, 45, 18, 0.2)", blur: 12, offsetY: 4 });
  roundRectPath(context, shape.x, shape.y, shape.w, shape.h, 5);
  context.fillStyle = palette.fill;
  context.fill();
  clearShadow(context);
  context.strokeStyle = palette.edge;
  context.lineWidth = 1;
  context.stroke();

  // Folded bottom-right corner, a small cue that reads as paper at any zoom.
  const fold = Math.min(16, shape.w * 0.12, shape.h * 0.12);
  context.beginPath();
  context.moveTo(shape.x + shape.w - fold, shape.y + shape.h);
  context.lineTo(shape.x + shape.w, shape.y + shape.h - fold);
  context.lineTo(shape.x + shape.w, shape.y + shape.h);
  context.closePath();
  context.fillStyle = "rgba(60, 40, 10, 0.07)";
  context.fill();

  const layout = visibleTextLines(shape);
  drawTextLines(
    context, layout,
    shape.x + layout.padding,
    shape.y + layout.padding,
    shape.textColor || palette.ink,
    500,
  );

  if (layout.clipped) {
    const fade = context.createLinearGradient(0, shape.y + shape.h - 26, 0, shape.y + shape.h - 8);
    fade.addColorStop(0, "rgba(255,255,255,0)");
    fade.addColorStop(1, palette.fill);
    context.fillStyle = fade;
    context.fillRect(shape.x + 4, shape.y + shape.h - 28, shape.w - 8, 24);
  }
  context.restore();
}

function drawFreeText(context, shape) {
  const layout = visibleTextLines(shape);
  context.save();
  context.fillStyle = shape.color || "#2b2438";
  context.font = `${shape.weight || 600} ${layout.fontSize}px ${UI_FONT}`;
  context.textAlign = shape.align === "center" ? "center" : "left";
  context.textBaseline = "top";
  const x = shape.align === "center" ? shape.x + shape.w / 2 : shape.x;
  layout.lines.forEach((line, index) => {
    context.fillText(line, x, shape.y + index * layout.lineHeight);
  });
  context.restore();
}

function drawConnector(context, shape, byId, camera) {
  const geom = connectorGeometry(shape, byId);
  if (!geom) return;
  const zoom = Math.max(0.05, camera.zoom);
  context.save();
  context.strokeStyle = shape.stroke || "#8d7aa5";
  context.fillStyle = shape.stroke || "#8d7aa5";
  context.lineWidth = (shape.strokeWidth ?? 2.2) / Math.max(1, Math.sqrt(zoom));
  context.setLineDash(shape.dashed ? [6 / zoom, 6 / zoom] : []);
  context.beginPath();
  context.moveTo(geom.a.x, geom.a.y);
  context.bezierCurveTo(geom.c1.x, geom.c1.y, geom.c2.x, geom.c2.y, geom.b.x, geom.b.y);
  context.stroke();
  context.setLineDash([]);
  if (shape.arrow !== false) {
    const arrow = arrowHead(geom, 10);
    context.beginPath();
    context.moveTo(arrow.points[0].x, arrow.points[0].y);
    context.lineTo(arrow.points[1].x, arrow.points[1].y);
    context.lineTo(arrow.points[2].x, arrow.points[2].y);
    context.closePath();
    context.fill();
  }
  context.restore();
}

function selectedNodes() {
  return state.scene.shapes.filter((shape) => state.selection.has(shape.id) && shape.type !== "connector");
}

function nodeSelectionBounds() {
  const nodes = selectedNodes();
  if (!nodes.length) return null;
  return unionBounds(nodes.map(shapeBounds));
}

function drawOverlays(context) {
  const zoom = Math.max(0.05, state.camera.zoom);
  const accent = "#6d3be4";

  if (state.hoverId && !state.selection.has(state.hoverId)) {
    const shape = shapeById(state.scene, state.hoverId);
    if (shape && shape.type !== "connector") {
      context.save();
      context.strokeStyle = "rgba(109, 59, 228, 0.5)";
      context.lineWidth = 1.4 / zoom;
      context.strokeRect(shape.x - 1 / zoom, shape.y - 1 / zoom, shape.w + 2 / zoom, shape.h + 2 / zoom);
      context.restore();
    }
  }

  const bounds = nodeSelectionBounds();
  if (bounds) {
    context.save();
    context.strokeStyle = accent;
    context.lineWidth = 1.4 / zoom;
    context.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);

    context.strokeStyle = "rgba(109, 59, 228, 0.4)";
    context.lineWidth = 1 / zoom;
    for (const shape of selectedNodes()) {
      context.strokeRect(shape.x, shape.y, shape.w, shape.h);
    }

    if (!state.editing) {
      const size = HANDLE_PX / zoom;
      for (const handle of handlePositions(bounds)) {
        context.fillStyle = "#fffdfa";
        context.strokeStyle = accent;
        context.lineWidth = 1.4 / zoom;
        context.fillRect(handle.x - size / 2, handle.y - size / 2, size, size);
        context.strokeRect(handle.x - size / 2, handle.y - size / 2, size, size);
      }
    }
    context.restore();
  }

  // Selected connectors get an accent redraw and endpoint dots instead of
  // resize handles, because a curve cannot be resized as a box.
  const byId = shapesById(state.scene);
  for (const shape of state.scene.shapes) {
    if (shape.type !== "connector" || !state.selection.has(shape.id)) continue;
    const geom = connectorGeometry(shape, byId);
    if (!geom) continue;
    context.save();
    context.strokeStyle = "#ff7ac6";
    context.fillStyle = "#ff7ac6";
    context.lineWidth = 2.4 / zoom;
    context.beginPath();
    context.moveTo(geom.a.x, geom.a.y);
    context.bezierCurveTo(geom.c1.x, geom.c1.y, geom.c2.x, geom.c2.y, geom.b.x, geom.b.y);
    context.stroke();
    for (const point of [geom.a, geom.b]) {
      context.beginPath();
      context.arc(point.x, point.y, 3.5 / zoom, 0, TAU);
      context.fill();
    }
    context.restore();
  }

  if (state.connectorFrom) {
    const from = shapeById(state.scene, state.connectorFrom);
    if (from) {
      const target = { x: state.pointer.world.x, y: state.pointer.world.y, w: 1, h: 1 };
      const side = chooseSides(from, target).fromSide;
      const start = sidePoint(from, side);
      context.save();
      context.strokeStyle = "#7c4dff";
      context.setLineDash([6 / zoom, 5 / zoom]);
      context.lineWidth = 1.8 / zoom;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(state.pointer.world.x, state.pointer.world.y);
      context.stroke();
      context.setLineDash([]);
      context.fillStyle = "rgba(124, 77, 255, 0.85)";
      context.beginPath();
      context.arc(state.pointer.world.x, state.pointer.world.y, 3.5 / zoom, 0, TAU);
      context.fill();
      context.restore();

      if (state.hoverId) {
        const hover = shapeById(state.scene, state.hoverId);
        if (hover && hover.id !== state.connectorFrom) {
          context.save();
          context.strokeStyle = "#7c4dff";
          context.lineWidth = 1.6 / zoom;
          context.strokeRect(hover.x - 2 / zoom, hover.y - 2 / zoom, hover.w + 4 / zoom, hover.h + 4 / zoom);
          context.restore();
        }
      }
    }
  }

  if (state.drag?.kind === "draw") {
    const box = normalizeBounds(state.drag.start, state.drag.current);
    const tool = state.drag.tool;
    context.save();
    context.setLineDash([6 / zoom, 5 / zoom]);
    context.lineWidth = 1.5 / zoom;
    context.strokeStyle = "#6d3be4";
    context.fillStyle = tool === "sticky" ? "rgba(233, 220, 255, 0.75)" : "rgba(124, 77, 255, 0.08)";
    if (tool === "ellipse") {
      context.beginPath();
      context.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, TAU);
      context.fill();
      context.stroke();
    } else {
      roundRectPath(context, box.x, box.y, box.w, box.h, tool === "sticky" ? 5 : 10);
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  if (state.drag?.kind === "marquee" && state.drag.current) {
    const box = normalizeBounds(state.drag.start, state.drag.current);
    context.save();
    context.fillStyle = "rgba(124, 77, 255, 0.09)";
    context.strokeStyle = "#6d3be4";
    context.lineWidth = 1.2 / zoom;
    context.setLineDash([5 / zoom, 4 / zoom]);
    context.fillRect(box.x, box.y, box.w, box.h);
    context.strokeRect(box.x, box.y, box.w, box.h);
    context.restore();
  }
}

function drawPeerCursor() {
  if (!state.peer) return;
  const point = worldToScreen(state.camera, state.peer.cursor);
  const { width, height } = state.viewport;
  if (point.x < -40 || point.y < -60 || point.x > width + 160 || point.y > height + 60) return;

  const status = state.peer.status.includes("placing")
    ? "adding a note"
    : state.peer.status.includes("nudging") ? "moving a note" : "reviewing";

  ctx.save();
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.translate(point.x, point.y);

  const phase = (performance.now() % 2200) / 2200;
  ctx.beginPath();
  ctx.arc(0, 0, 7 + phase * 17, 0, TAU);
  ctx.strokeStyle = `rgba(255, 122, 198, ${0.38 * (1 - phase)})`;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17);
  ctx.lineTo(4.4, 12.8);
  ctx.lineTo(8.6, 19.4);
  ctx.lineTo(11.8, 17.7);
  ctx.lineTo(7.7, 11.2);
  ctx.lineTo(13.2, 10.5);
  ctx.closePath();
  ctx.fillStyle = "#ff7ac6";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();

  const label = `${state.peer.name} · ${status}`;
  ctx.font = `600 10.5px ${UI_FONT}`;
  const textWidth = ctx.measureText(label).width;
  const pillW = textWidth + 18;
  const pillH = 22;
  const flip = point.x + pillW + 22 > width - 8;
  const x = flip ? -pillW - 14 : 14;
  // Above the cursor reads cleaner than below: notes tend to sit under the
  // pointer, and a label covering the first line of a sticky is a distraction.
  const y = point.y < 76 ? 18 : -32;
  roundRectPath(ctx, x, y, pillW, pillH, 11);
  ctx.fillStyle = "rgba(34, 17, 50, 0.94)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 122, 198, 0.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#ffd8ed";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + pillW / 2, y + pillH / 2 + 0.5);
  ctx.restore();
}

function drawMinimap() {
  const { width, height } = state.minimapSize;
  const dpr = state.dpr;
  minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  minimapCtx.clearRect(0, 0, width, height);
  minimapCtx.fillStyle = "#17102a";
  minimapCtx.fillRect(0, 0, width, height);

  const box = sceneBounds(state.scene);
  const pad = 10;
  const scale = Math.min((width - pad * 2) / box.w, (height - pad * 2) / box.h);
  const ox = (width - box.w * scale) / 2 - box.x * scale;
  const oy = (height - box.h * scale) / 2 - box.y * scale;
  state.minimapMap = { scale, ox, oy };

  const project = (point) => ({ x: point.x * scale + ox, y: point.y * scale + oy });
  const byId = shapesById(state.scene);

  for (const shape of state.scene.shapes) {
    if (shape.type !== "connector") continue;
    const geom = connectorGeometry(shape, byId);
    if (!geom) continue;
    minimapCtx.beginPath();
    const a = project(geom.a);
    const b = project(geom.b);
    minimapCtx.moveTo(a.x, a.y);
    minimapCtx.lineTo(b.x, b.y);
    minimapCtx.strokeStyle = "rgba(210, 190, 245, 0.32)";
    minimapCtx.lineWidth = 0.8;
    minimapCtx.stroke();
  }

  for (const shape of state.scene.shapes) {
    if (shape.type === "connector") continue;
    const p = project(shape);
    const w = Math.max(1.2, shape.w * scale);
    const h = Math.max(1.2, shape.h * scale);
    if (shape.type === "sticky") minimapCtx.fillStyle = stickyColor(shape).fill;
    else if (shape.type === "ellipse") minimapCtx.fillStyle = "rgba(178, 139, 255, 0.7)";
    else if (shape.type === "text") minimapCtx.fillStyle = "rgba(225, 210, 245, 0.45)";
    else minimapCtx.fillStyle = shape.frame ? "rgba(255, 255, 255, 0.12)" : "rgba(240, 228, 250, 0.72)";
    minimapCtx.fillRect(p.x, p.y, w, h);
  }

  const view = screenToWorld(state.camera, { x: 0, y: 0 });
  const viewEnd = screenToWorld(state.camera, { x: state.viewport.width, y: state.viewport.height });
  const vr = project(view);
  minimapCtx.fillStyle = "rgba(196, 163, 255, 0.1)";
  minimapCtx.strokeStyle = "rgba(210, 178, 255, 0.95)";
  minimapCtx.lineWidth = 1.2;
  minimapCtx.fillRect(vr.x, vr.y, (viewEnd.x - view.x) * scale, (viewEnd.y - view.y) * scale);
  minimapCtx.strokeRect(vr.x, vr.y, (viewEnd.x - view.x) * scale, (viewEnd.y - view.y) * scale);
}

function draw() {
  paintBoard(ctx, state.viewport, state.dpr, state.scene, state.camera);
  ctx.save();
  ctx.translate(state.camera.panX, state.camera.panY);
  ctx.scale(state.camera.zoom, state.camera.zoom);
  drawOverlays(ctx);
  ctx.restore();
  drawPeerCursor();
  drawMinimap();
}

/* ------------------------------------------------------------- peer events */

function tickPeer(dt) {
  if (!state.peer || state.drag || state.editing) return;
  const op = stepPeer(state.peer, dt, state.scene);
  if (!op) return;

  if (op.type === "place-sticky") {
    const notes = state.scene.shapes.filter((shape) => shape.id.startsWith(`peer-note-${state.peer.id}-`));
    if (notes.length >= 4) state.scene = removeShapes(state.scene, [notes[0].id]);
    state.scene = addShape(state.scene, op.sticky);
    commitScene("Nyx placed a note");
    logActivity("Nyx", `placed a note “${truncate(op.sticky.text, 30)}”`);
  } else if (op.type === "nudge") {
    state.scene = moveShapes(state.scene, [op.id], op.dx, op.dy);
    commitScene("Nyx nudged a sticky");
    logActivity("Nyx", "nudged a sticky");
  }
}

/* ------------------------------------------------------------------ history */

function commitScene(label) {
  state.history = commit(state.history, state.scene, label);
  state.scene = currentScene(state.history);
  markSaved();
  renderInspector();
  updateChrome();
}

function markSaved() {
  if (!dom.saved) return;
  dom.saved.classList.add("saving");
  dom.saved.innerHTML = '<span class="dot pulse"></span> saving';
  clearTimeout(state.savedTimer);
  state.savedTimer = setTimeout(() => {
    dom.saved.classList.remove("saving");
    dom.saved.innerHTML = '<span class="dot pulse"></span> saved';
  }, 340);
}

function performUndo() {
  if (!canUndo(state.history)) return;
  const label = undoLabel(state.history);
  state.history = undo(state.history);
  restoreFromHistory();
  if (label) logActivity("You", `undid “${truncate(label, 34)}”`);
  toast(label ? `Undo · ${label}` : "Undo");
}

function performRedo() {
  if (!canRedo(state.history)) return;
  const label = redoLabel(state.history);
  state.history = redo(state.history);
  restoreFromHistory();
  if (label) logActivity("You", `redid “${truncate(label, 34)}”`);
  toast(label ? `Redo · ${label}` : "Redo");
}

function restoreFromHistory() {
  state.scene = currentScene(state.history);
  state.selection = new Set([...state.selection].filter((id) => shapeById(state.scene, id)));
  state.drag = null;
  state.connectorFrom = null;
  markSaved();
  renderInspector();
  updateChrome();
}

/* -------------------------------------------------------------- selection */

function setSelection(ids) {
  state.selection = new Set(ids);
  state.hoverHandle = null;
  state.connectorFrom = null;
  renderInspector();
  updateChrome();
  updateCursor();
}

function clearSelection() {
  setSelection([]);
}

function deleteSelection() {
  if (!state.selection.size) return;
  const count = state.selection.size;
  state.scene = removeShapes(state.scene, [...state.selection]);
  state.selection = new Set();
  commitScene("Delete selection");
  logActivity("You", `deleted ${count} ${count === 1 ? "item" : "items"}`);
  toast(count === 1 ? "Item deleted" : `${count} items deleted`);
}

function duplicateSelection() {
  if (!state.selection.size) return;
  const result = duplicateShapes(state.scene, [...state.selection], 26);
  if (!result.ids.length) { toast("Connectors need both endpoint shapes selected", "error"); return; }
  state.scene = result.scene;
  state.selection = new Set(result.ids);
  commitScene("Duplicate selection");
  logActivity("You", `duplicated ${result.ids.length} ${result.ids.length === 1 ? "item" : "items"}`);
  toast("Selection duplicated");
}

function arrangeSelection(mode) {
  if (!state.selection.size) return;
  state.scene = reorderShapes(state.scene, [...state.selection], mode);
  commitScene(`Arrange ${mode}`);
  logActivity("You", `moved the selection ${mode === "front" ? "to the front" : mode === "back" ? "to the back" : mode}`);
}

function recolourSelection(color) {
  const stickyIds = [...state.selection].filter((id) => shapeById(state.scene, id)?.type === "sticky");
  if (!stickyIds.length) return;
  for (const id of stickyIds) state.scene = updateShape(state.scene, id, { color });
  commitScene("Recolour sticky");
  logActivity("You", "recoloured a note");
}

function connectShapes(fromId, toId) {
  const shape = createShape("connector", { from: fromId, to: toId });
  state.scene = addShape(state.scene, shape);
  setSelection([shape.id]);
  commitScene("Add connector");
  logActivity("You", "connected two shapes");
  toast("Connector added");
}

/* ------------------------------------------------------------------ editor */

function openEditor(shape) {
  if (!shape) return;
  if (!["sticky", "text", "rect", "ellipse"].includes(shape.type)) return;
  closeEditor({ cancel: true });

  const topLeft = worldToScreen(state.camera, { x: shape.x, y: shape.y });
  const zoom = state.camera.zoom;
  const w = Math.max(shape.w * zoom, shape.type === "text" ? 140 : 80);
  const h = Math.max(shape.h * zoom, 34);
  const palette = stickyColor(shape);

  const editor = document.createElement("textarea");
  editor.className = "text-editor";
  editor.spellcheck = false;
  editor.setAttribute("aria-label", "Edit shape text");
  editor.value = shape.type === "sticky" || shape.type === "text"
    ? shape.text || ""
    : shape.label || "";
  editor.style.left = `${topLeft.x}px`;
  editor.style.top = `${topLeft.y}px`;
  editor.style.width = `${w}px`;
  editor.style.height = `${h}px`;
  editor.style.fontSize = `${clamp(shape.fontSize * zoom, 10, 40)}px`;
  editor.style.fontWeight = shape.type === "text" ? String(shape.weight || 600) : "500";
  editor.style.textAlign = shape.type === "rect" || shape.type === "ellipse" ? "center" : "left";
  editor.style.padding = `${Math.max(4, (shape.type === "sticky" ? 14 : 6) * zoom)}px`;
  if (shape.type === "sticky") {
    editor.style.background = palette.fill;
    editor.style.color = palette.ink;
  } else if (shape.type === "text") {
    editor.style.background = "rgba(250, 246, 238, 0.97)";
    editor.style.color = shape.color || "#2b2438";
  } else {
    editor.style.background = "#fffdf8";
    editor.style.color = shape.textColor || "#3a3048";
  }

  dom.card.append(editor);
  state.editing = { id: shape.id, editor, original: editor.value, type: shape.type };

  editor.addEventListener("blur", () => closeEditor());
  editor.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); closeEditor({ cancel: true }); return; }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); closeEditor(); }
  });

  requestAnimationFrame(() => {
    editor.focus();
    editor.select();
  });
}

function closeEditor({ cancel = false } = {}) {
  const editing = state.editing;
  if (!editing) return;
  state.editing = null;
  const value = editing.editor.value;
  editing.editor.remove();
  if (cancel) { updateChrome(); return; }

  const shape = shapeById(state.scene, editing.id);
  if (!shape) { updateChrome(); return; }
  const text = value.replace(/\r/g, "").trimEnd();

  if (editing.type === "text") {
    if (!text) {
      state.scene = removeShapes(state.scene, [shape.id]);
      state.selection.delete(shape.id);
      commitScene("Remove empty text");
    } else {
      state.scene = updateShape(state.scene, shape.id, fitTextShape({ ...shape, text }));
      commitScene("Edit text");
    }
  } else if (editing.type === "sticky") {
    state.scene = updateShape(state.scene, shape.id, { text: text || "Note" });
    commitScene("Edit note");
  } else {
    state.scene = updateShape(state.scene, shape.id, { label: text });
    commitScene("Edit label");
  }
  logActivity("You", editing.type === "text" ? "edited text" : editing.type === "sticky" ? "edited a note" : "edited a label");
}

/* ---------------------------------------------------------------- pointer */

function pointerPoint(event) {
  const rect = dom.canvas.getBoundingClientRect();
  const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  return { screen, world: screenToWorld(state.camera, screen) };
}

function onPointerDown(event) {
  if (event.button !== 0 && event.button !== 1) return;
  if (state.editing) closeEditor();
  dom.canvas.focus({ preventScroll: true });
  const point = pointerPoint(event);
  state.pointer = point;
  try { dom.canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointer */ }

  const pan = event.button === 1 || state.spaceDown || state.tool === "hand";
  if (pan) {
    event.preventDefault();
    state.drag = { kind: "pan", last: { x: event.clientX, y: event.clientY } };
    updateCursor();
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();

  if (state.tool === "select") {
    const bounds = nodeSelectionBounds();
    if (bounds) {
      const handle = getResizeHandle(bounds, point.world, state.camera.zoom);
      if (handle) {
        state.drag = {
          kind: "resize", handle, start: point.world,
          base: state.scene, ids: [...state.selection],
        };
        updateCursor();
        return;
      }
    }

    const hit = hitTest(state.scene, point.world, { tolerance: 8, zoom: state.camera.zoom });
    if (hit) {
      if (event.shiftKey) {
        if (state.selection.has(hit.shape.id)) {
          state.selection.delete(hit.shape.id);
          renderInspector();
          updateChrome();
          updateCursor();
          return;
        }
        state.selection.add(hit.shape.id);
      } else if (!state.selection.has(hit.shape.id)) {
        state.selection = new Set([hit.shape.id]);
      }
      state.drag = {
        kind: "move", start: point.world, base: state.scene,
        ids: [...state.selection], moved: false,
      };
      renderInspector();
      updateChrome();
      updateCursor();
      return;
    }

    state.drag = {
      kind: "marquee", start: point.world, current: point.world,
      baseSelection: event.shiftKey ? new Set(state.selection) : new Set(),
    };
    if (!event.shiftKey) {
      state.selection = new Set();
      renderInspector();
      updateChrome();
    }
    updateCursor();
    return;
  }

  if (state.tool === "connector") {
    const hit = hitTest(state.scene, point.world, { tolerance: 8, zoom: state.camera.zoom });
    const target = hit && isConnectable(hit.shape) ? hit.shape : null;
    if (!target) { state.connectorFrom = null; updateChrome(); return; }
    if (!state.connectorFrom) {
      state.connectorFrom = target.id;
      state.hoverId = target.id;
      updateChrome();
      return;
    }
    if (state.connectorFrom === target.id) { state.connectorFrom = null; updateChrome(); return; }
    connectShapes(state.connectorFrom, target.id);
    state.connectorFrom = null;
    setTool("select");
    return;
  }

  if (["rect", "ellipse", "sticky", "text"].includes(state.tool)) {
    state.drag = {
      kind: "draw", tool: state.tool, start: point.world, current: point.world,
      base: state.scene,
    };
    state.selection = new Set();
    renderInspector();
    updateCursor();
  }
}

function onPointerMove(event) {
  const point = pointerPoint(event);
  state.pointer = point;

  const drag = state.drag;
  if (!drag) {
    updateHover(point.world);
    return;
  }

  if (drag.kind === "pan") {
    const dx = event.clientX - drag.last.x;
    const dy = event.clientY - drag.last.y;
    drag.last = { x: event.clientX, y: event.clientY };
    state.camera = panBy(state.camera, dx, dy);
    updateChrome();
    return;
  }

  if (drag.kind === "move") {
    const dx = point.world.x - drag.start.x;
    const dy = point.world.y - drag.start.y;
    drag.moved = drag.moved || Math.abs(dx) > 1 || Math.abs(dy) > 1;
    state.scene = moveShapes(drag.base, drag.ids, dx, dy);
    updateChrome();
    return;
  }

  if (drag.kind === "resize") {
    const dx = point.world.x - drag.start.x;
    const dy = point.world.y - drag.start.y;
    state.scene = resizeShapes(drag.base, drag.ids, drag.handle, dx, dy);
    updateChrome();
    return;
  }

  if (drag.kind === "marquee" || drag.kind === "draw") {
    drag.current = point.world;
    if (drag.kind === "marquee") {
      const box = normalizeBounds(drag.start, drag.current);
      const ids = shapesInRect(state.scene, box).map((shape) => shape.id);
      state.selection = new Set([...drag.baseSelection, ...ids]);
      updateChrome();
    }
  }
}

function onPointerUp() {
  const drag = state.drag;
  if (!drag) { updateCursor(); return; }
  state.drag = null;

  if (drag.kind === "move") {
    if (drag.moved) commitScene("Move selection");
    else state.scene = drag.base;
  } else if (drag.kind === "resize") {
    commitScene("Resize selection");
  } else if (drag.kind === "marquee") {
    renderInspector();
    updateChrome();
  } else if (drag.kind === "draw") {
    finishDraw(drag);
  }

  updateCursor();
}

function finishDraw(drag) {
  const start = { x: snapToGrid(drag.start.x), y: snapToGrid(drag.start.y) };
  const end = { x: snapToGrid(drag.current.x), y: snapToGrid(drag.current.y) };
  let box = normalizeBounds(start, end);

  if (box.w < 16 && box.h < 16) {
    const defaults = drag.tool === "sticky" ? { w: 190, h: 150 }
      : drag.tool === "ellipse" ? { w: 180, h: 110 }
        : drag.tool === "text" ? { w: 220, h: 40 }
          : { w: 200, h: 120 };
    box = { x: start.x, y: start.y, ...defaults };
  } else {
    box.w = Math.max(28, box.w);
    box.h = Math.max(28, box.h);
  }

  let shape;
  if (drag.tool === "sticky") {
    const stickyCount = state.scene.shapes.filter((item) => item.type === "sticky").length;
    shape = createShape("sticky", {
      ...box,
      color: STICKY_COLOR_KEYS[stickyCount % STICKY_COLOR_KEYS.length],
      text: "New note",
    });
  } else if (drag.tool === "ellipse") {
    shape = createShape("ellipse", { ...box, label: "" });
  } else if (drag.tool === "text") {
    shape = createShape("text", { x: box.x, y: box.y, text: "New text", fontSize: 22 });
  } else {
    shape = createShape("rect", { ...box, label: "" });
  }

  state.scene = addShape(state.scene, shape);
  state.selection = new Set([shape.id]);
  commitScene(`Add ${shape.type === "text" ? "text" : shape.type === "sticky" ? "sticky note" : shape.type}`);
  logActivity("You", `added a ${SHAPE_NAMES[shape.type].toLowerCase()}`);
  setTool("select");
  renderInspector();

  if (shape.type === "text") openEditor(shape);
  updateChrome();
}

function updateHover(world) {
  state.hoverHandle = null;
  state.hoverId = null;

  if (state.tool === "select") {
    const bounds = nodeSelectionBounds();
    if (bounds) state.hoverHandle = getResizeHandle(bounds, world, state.camera.zoom);
    if (!state.hoverHandle) {
      const hit = hitTest(state.scene, world, { tolerance: 8, zoom: state.camera.zoom });
      state.hoverId = hit ? hit.shape.id : null;
    }
  } else if (state.tool === "connector") {
    const hit = hitTest(state.scene, world, { tolerance: 8, zoom: state.camera.zoom });
    state.hoverId = hit && isConnectable(hit.shape) ? hit.shape.id : null;
  } else {
    state.hoverId = null;
  }
  updateCursor();
}

function updateCursor() {
  let cursor = "default";
  const drag = state.drag;
  if (state.spaceDown) cursor = "grab";
  if (drag?.kind === "pan") cursor = "grabbing";
  else if (drag?.kind === "move") cursor = "move";
  else if (drag?.kind === "resize") cursor = handleCursor(drag.handle);
  else if (drag?.kind === "marquee" || drag?.kind === "draw") cursor = "crosshair";
  else if (state.tool === "hand") cursor = "grab";
  else if (state.tool !== "select") cursor = "crosshair";
  else if (state.hoverHandle) cursor = handleCursor(state.hoverHandle);
  else if (state.hoverId) cursor = "move";
  dom.canvas.style.cursor = cursor;
}

/* ------------------------------------------------------------ double click */

function onDoubleClick(event) {
  const point = pointerPoint(event);
  const hit = hitTest(state.scene, point.world, { tolerance: 8, zoom: state.camera.zoom });
  if (hit && ["sticky", "text", "rect", "ellipse"].includes(hit.shape.type)) {
    openEditor(hit.shape);
    return;
  }
  if (!hit && state.tool === "select") {
    const shape = createShape("sticky", {
      x: snapToGrid(point.world.x - 95),
      y: snapToGrid(point.world.y - 75),
      text: "New note",
      color: STICKY_COLOR_KEYS[state.scene.shapes.filter((s) => s.type === "sticky").length % STICKY_COLOR_KEYS.length],
    });
    state.scene = addShape(state.scene, shape);
    state.selection = new Set([shape.id]);
    commitScene("Add sticky note");
    logActivity("You", "added a sticky note");
    openEditor(shape);
  }
}

/* ------------------------------------------------------------------- wheel */

function onWheel(event) {
  event.preventDefault();
  const point = pointerPoint(event);
  state.pointer = point;
  if (event.shiftKey) {
    state.camera = panBy(state.camera, -event.deltaY, 0);
  } else {
    const factor = Math.exp(-event.deltaY * 0.0016);
    state.camera = zoomAt(state.camera, point.screen, factor);
  }
  updateChrome();
}

/* ---------------------------------------------------------------- keyboard */

function onKeyDown(event) {
  if (state.editing || isTypingTarget(event.target)) return;
  const key = event.key;
  const lower = key.toLowerCase();
  const meta = event.metaKey || event.ctrlKey;
  const tag = event.target?.tagName?.toLowerCase();
  if (tag === "button" && (key === " " || key === "Enter")) return;

  if (event.code === "Space" && !meta) {
    event.preventDefault();
    if (!state.spaceDown) { state.spaceDown = true; updateCursor(); }
    return;
  }

  if (meta) {
    if (lower === "z") {
      event.preventDefault();
      if (event.shiftKey) performRedo(); else performUndo();
      return;
    }
    if (lower === "y") { event.preventDefault(); performRedo(); return; }
    if (lower === "d") { event.preventDefault(); duplicateSelection(); return; }
    if (lower === "a") { event.preventDefault(); setSelection(geometricShapes(state.scene).map((shape) => shape.id)); return; }
    if (key === "]" || key === "}") { event.preventDefault(); arrangeSelection(event.shiftKey ? "front" : "forward"); return; }
    if (key === "[" || key === "{") { event.preventDefault(); arrangeSelection(event.shiftKey ? "back" : "backward"); return; }
    return;
  }

  if (key === "Escape") {
    if (state.connectorFrom) { state.connectorFrom = null; updateChrome(); return; }
    if (state.drag) { cancelDrag(); return; }
    if (state.selection.size) clearSelection();
    return;
  }

  if (key === "Delete" || key === "Backspace") {
    if (state.selection.size) { event.preventDefault(); deleteSelection(); }
    return;
  }

  if (key.startsWith("Arrow") && state.selection.size) {
    event.preventDefault();
    const step = event.shiftKey ? 20 : 4;
    const delta = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    }[key];
    if (delta) {
      state.scene = moveShapes(state.scene, [...state.selection], delta[0], delta[1]);
      commitScene("Nudge selection");
    }
    return;
  }

  if (event.shiftKey && event.code === "Digit1") { event.preventDefault(); fitView(); return; }

  const toolKeys = { v: "select", h: "hand", r: "rect", o: "ellipse", s: "sticky", t: "text", c: "connector" };
  if (toolKeys[lower] && !event.shiftKey) { setTool(toolKeys[lower]); return; }
  if (lower === "g" && !event.shiftKey) {
    state.showGrid = !state.showGrid;
    toast(state.showGrid ? "Grid on" : "Grid off");
    return;
  }
  if (lower === "m" && !event.shiftKey) {
    const wrap = $(".minimap-wrap");
    if (wrap) wrap.style.display = wrap.style.display === "none" ? "" : "none";
    return;
  }
  if (lower === "f" && event.shiftKey) fitView();
}

function onKeyUp(event) {
  if (event.code === "Space") {
    state.spaceDown = false;
    updateCursor();
  }
}

function cancelDrag() {
  const drag = state.drag;
  if (!drag) return;
  if (drag.base) state.scene = drag.base;
  state.drag = null;
  state.connectorFrom = null;
  updateChrome();
  updateCursor();
}

/* ------------------------------------------------------------------- tools */

function setTool(tool) {
  state.tool = tool;
  state.connectorFrom = null;
  state.hoverHandle = null;
  updateToolButtons();
  updateHint();
  updateCursor();
}

function updateToolButtons() {
  for (const button of $$(".tool[data-tool]")) {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  const presence = document.querySelector(".person-meta span");
  if (presence) presence.textContent = `editing · ${state.tool} tool`;
}

function updateHint() {
  if (!dom.hint) return;
  const tips = {
    select: '<kbd>Space</kbd> drag to pan <span class="sep">·</span> <kbd>Scroll</kbd> zoom <span class="sep">·</span> <kbd>V</kbd> select',
    hand: '<kbd>Drag</kbd> to pan the board <span class="sep">·</span> <kbd>Scroll</kbd> zoom',
    rect: '<kbd>Drag</kbd> to draw a rectangle <span class="sep">·</span> <kbd>Esc</kbd> cancel',
    ellipse: '<kbd>Drag</kbd> to draw an ellipse <span class="sep">·</span> <kbd>Esc</kbd> cancel',
    sticky: '<kbd>Drag</kbd> to place a sticky note <span class="sep">·</span> <kbd>Esc</kbd> cancel',
    text: '<kbd>Click</kbd> to place text, then type <span class="sep">·</span> <kbd>Enter</kbd> to save',
    connector: '<kbd>Click</kbd> a shape, then a second shape to connect them',
  };
  dom.hint.innerHTML = tips[state.tool] || tips.select;
}

/* --------------------------------------------------------------------- UI */

function zoomPercent() {
  return Math.round(state.camera.zoom * 100);
}

function updateChrome() {
  const percent = `${zoomPercent()}%`;
  if (dom.zoomReset) dom.zoomReset.textContent = percent;
  if (dom.minimapZoom) dom.minimapZoom.textContent = percent;
  if (dom.undo) dom.undo.disabled = !canUndo(state.history);
  if (dom.redo) dom.redo.disabled = !canRedo(state.history);
  if (dom.peerStatus) dom.peerStatus.textContent = state.peer?.status || "reviewing the board";

  const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
  const counts = sceneCounts(state.scene);
  set("stat-nodes", counts.shapes);
  set("stat-links", counts.connectors);
  set("stat-zoom", percent);

  const signature = inspectorSignature();
  if (signature !== state.inspectorSig) {
    state.inspectorSig = signature;
    renderInspector();
  }
}

function inspectorSignature() {
  if (!state.selection.size) return `board:${state.boardKind}:${state.scene.shapes.length}`;
  const ids = [...state.selection].sort();
  const info = selectionInfo(state.scene, ids);
  const b = info.bounds;
  const single = info.single;
  const box = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}` : "";
  return `sel:${ids.join(",")}:${box}:${single?.color || ""}:${single?.type || ""}`;
}

function renderInspector() {
  if (!dom.inspector) return;
  const info = selectionInfo(state.scene, [...state.selection]);
  dom.inspector.innerHTML = info.count ? selectionInspectorHTML(info) : boardInspectorHTML();
  state.inspectorSig = inspectorSignature();
}

function boardInspectorHTML() {
  const counts = sceneCounts(state.scene);
  const meta = BOARDS[state.boardKind];
  return `
    <div class="rail-head">
      <div>
        <div class="eyebrow">Board</div>
        <h3>${escapeHtml(meta.name)}</h3>
      </div>
      <span class="badge purple">live</span>
    </div>
    <div class="stat-strip">
      <div><span>Nodes</span><b id="stat-nodes">${counts.shapes}</b></div>
      <div><span>Links</span><b id="stat-links">${counts.connectors}</b></div>
      <div><span>Zoom</span><b id="stat-zoom">${zoomPercent()}%</b></div>
    </div>
    <p class="rail-note">${escapeHtml(meta.description)}</p>
    <div class="rail-actions">
      <button class="btn sm" data-action="fit">Fit board</button>
      <button class="btn sm" data-action="reset">Reset board</button>
    </div>`;
}

function selectionInspectorHTML(info) {
  const total = info.count;
  const shape = info.single;
  const heading = shape
    ? shape.type === "connector" ? "Connector" : (shape.text || shape.label || SHAPE_NAMES[shape.type])
    : `${total} items selected`;
  const badge = shape ? SHAPE_NAMES[shape.type] : "Multi-select";
  const box = info.bounds;
  const sticky = shape?.type === "sticky";
  return `
    <div class="rail-head">
      <div>
        <div class="eyebrow">Selection</div>
        <h3>${escapeHtml(heading)}</h3>
      </div>
      <span class="badge gold">${escapeHtml(badge)}</span>
    </div>
    <div class="prop-grid">
      <div><span>X</span><b>${box ? Math.round(box.x) : ", "}</b></div>
      <div><span>Y</span><b>${box ? Math.round(box.y) : ", "}</b></div>
      <div><span>W</span><b>${box ? Math.round(box.w) : ", "}</b></div>
      <div><span>H</span><b>${box ? Math.round(box.h) : ", "}</b></div>
    </div>
    ${sticky ? `<div class="swatches">${STICKY_COLOR_KEYS.map((key) => {
      const palette = stickyColor({ color: key });
      return `<button class="swatch${shape.color === key ? " active" : ""}" data-swatch="${key}" title="${key}" aria-label="${key} sticky" style="background:${palette.fill};border-color:${palette.edge}"></button>`;
    }).join("")}</div>` : ""}
    <div class="arrange-row">
      <button class="arrange" data-arrange="back" title="Send to back">${ARRANGE_ICONS.back}</button>
      <button class="arrange" data-arrange="backward" title="Send backward">${ARRANGE_ICONS.backward}</button>
      <button class="arrange" data-arrange="forward" title="Bring forward">${ARRANGE_ICONS.forward}</button>
      <button class="arrange" data-arrange="front" title="Bring to front">${ARRANGE_ICONS.front}</button>
    </div>
    <div class="rail-actions">
      <button class="btn sm" data-action="duplicate">Duplicate</button>
      <button class="btn sm danger" data-action="delete">Delete</button>
    </div>`;
}

function relativeTime(at) {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 20) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function renderActivity() {
  if (!dom.activity) return;
  dom.activityCount.textContent = String(state.activity.length);
  dom.activity.innerHTML = state.activity.slice(0, 3).map((item) => `
    <div class="activity-item">
      <span class="activity-dot" style="background:${item.color}"></span>
      <div>
        <p><b>${escapeHtml(item.who)}</b> ${escapeHtml(item.text)}</p>
        <span class="when">${relativeTime(item.at)}</span>
      </div>
    </div>`).join("");
}

function logActivity(who, text) {
  state.activity.unshift({ who, text, at: Date.now(), color: who === "Nyx" ? "#ff7ac6" : "#b28bff" });
  state.activity = state.activity.slice(0, 12);
  renderActivity();
}

/* ------------------------------------------------------------------ export */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportSVG() {
  const svg = sceneToSVG(state.scene, { padding: 64, grid: true });
  downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${sceneFileName(state.scene)}.svg`);
  logActivity("You", "exported the board as SVG");
  toast("SVG downloaded");
}

function exportPNG() {
  const scale = 2;
  const size = exportSize(state.scene, { padding: 64, scale });
  const out = document.createElement("canvas");
  out.width = size.width;
  out.height = size.height;
  const outCtx = out.getContext("2d");
  const viewport = { width: size.width, height: size.height };
  const camera = fitBounds(sceneBounds(state.scene), viewport, 64 * scale);
  paintBoard(outCtx, viewport, 1, state.scene, camera, { grid: true });
  out.toBlob((blob) => {
    if (!blob) { toast("PNG export failed", "error"); return; }
    downloadBlob(blob, `${sceneFileName(state.scene)}.png`);
    logActivity("You", "exported the board as PNG");
    toast(`PNG downloaded · ${Math.round(size.width)} × ${Math.round(size.height)}`);
  }, "image/png");
}

/* -------------------------------------------------------------------- wire */

function wireTopbar() {
  dom.undo.addEventListener("click", (event) => { performUndo(); event.currentTarget.blur(); });
  dom.redo.addEventListener("click", (event) => { performRedo(); event.currentTarget.blur(); });
  dom.exportSvg.addEventListener("click", (event) => { exportSVG(); event.currentTarget.blur(); });
  dom.exportPng.addEventListener("click", (event) => { exportPNG(); event.currentTarget.blur(); });
}

function wireTools() {
  for (const button of $$(".tool[data-tool]")) {
    button.addEventListener("click", (event) => {
      setTool(button.dataset.tool);
      event.currentTarget.blur();
    });
  }
}

function wireZoom() {
  dom.zoomIn.addEventListener("click", () => {
    state.camera = zoomAt(state.camera, { x: state.viewport.width / 2, y: state.viewport.height / 2 }, 1.25);
    updateChrome();
  });
  dom.zoomOut.addEventListener("click", () => {
    state.camera = zoomAt(state.camera, { x: state.viewport.width / 2, y: state.viewport.height / 2 }, 0.8);
    updateChrome();
  });
  dom.zoomReset.addEventListener("click", () => {
    state.camera = setZoom(state.camera, 1, { x: state.viewport.width / 2, y: state.viewport.height / 2 });
    updateChrome();
  });
  dom.zoomFit.addEventListener("click", () => fitView());
}

function wireCanvas() {
  dom.canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  dom.canvas.addEventListener("dblclick", onDoubleClick);
  dom.canvas.addEventListener("wheel", onWheel, { passive: false });
  dom.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", () => { state.spaceDown = false; updateCursor(); });
  window.addEventListener("hashchange", () => {
    const kind = hashKind();
    if (kind !== state.boardKind) loadBoard(kind);
  });

  dom.minimap.addEventListener("pointerdown", (event) => {
    const rect = dom.minimap.getBoundingClientRect();
    const map = state.minimapMap;
    if (!map) return;
    const x = ((event.clientX - rect.left) * (state.minimapSize.width / rect.width) - map.ox) / map.scale;
    const y = ((event.clientY - rect.top) * (state.minimapSize.height / rect.height) - map.oy) / map.scale;
    state.camera = {
      ...state.camera,
      panX: state.viewport.width / 2 - x * state.camera.zoom,
      panY: state.viewport.height / 2 - y * state.camera.zoom,
    };
    updateChrome();
  });
}

function wireRail() {
  dom.inspector.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const swatch = event.target.closest("[data-swatch]")?.dataset.swatch;
    const arrange = event.target.closest("[data-arrange]")?.dataset.arrange;
    if (swatch) recolourSelection(swatch);
    else if (arrange) arrangeSelection(arrange);
    else if (action === "fit") fitView();
    else if (action === "reset") resetBoard();
    else if (action === "duplicate") duplicateSelection();
    else if (action === "delete") deleteSelection();
    event.target.closest("button")?.blur();
  });
}

function resetBoard() {
  loadBoard(state.boardKind, { resetView: true });
  logActivity("You", "reset the board to the seeded layout");
  toast("Board reset to the seed");
}

/* -------------------------------------------------------------- animation */

function loop(now) {
  const dt = state.lastFrame ? Math.min(0.12, (now - state.lastFrame) / 1000) : 0.016;
  state.lastFrame = now;
  tickPeer(dt);
  draw();
  if (now - state.lastChrome > 120) {
    state.lastChrome = now;
    updateChrome();
  }
  requestAnimationFrame(loop);
}

/* --------------------------------------------------------------- automation
   The recorder in _factory/scripts/record.mjs can only click DOM selectors, so
   the demo exposes a tiny pointer hook. It dispatches real PointerEvents at the
   canvas, which means it drives the same handlers a person would. Not used by
   the application itself. */

function synthPointer(type, x, y, buttons) {
  const rect = dom.canvas.getBoundingClientRect();
  const event = new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: rect.left + x, clientY: rect.top + y,
    pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons,
  });
  dom.canvas.dispatchEvent(event);
}

function installAutomation() {
  window.__canvas = {
    state,
    tool: (name) => setTool(name),
    select(id) {
      if (!shapeById(state.scene, id)) return false;
      setTool("select");
      setSelection([id]);
      return true;
    },
    centerOf(id) {
      const shape = shapeById(state.scene, id);
      if (!shape) return null;
      const point = worldToScreen(state.camera, { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 });
      return [point.x, point.y];
    },
    click(x, y) {
      synthPointer("pointerdown", x, y, 1);
      synthPointer("pointerup", x, y, 0);
    },
    drag({ from, to, steps = 14 }) {
      synthPointer("pointerdown", from[0], from[1], 1);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        synthPointer("pointermove", from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, 1);
      }
      synthPointer("pointerup", to[0], to[1], 0);
    },
    zoom(factor) {
      state.camera = zoomAt(state.camera, { x: state.viewport.width / 2, y: state.viewport.height / 2 }, factor);
      updateChrome();
    },
    fit: () => fitView(),
    reset: () => resetBoard(),
    exportSvg: exportSVG,
    exportPng: exportPNG,
  };
}

/* -------------------------------------------------------------------- start */

wireTopbar();
wireTools();
wireZoom();
wireCanvas();
wireRail();
installAutomation();
resize();
new ResizeObserver(() => resize()).observe(dom.card);
requestAnimationFrame(loop);
