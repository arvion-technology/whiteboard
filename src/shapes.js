// Shape factories and text layout.
//
// Shapes are plain serialisable objects: no classes, no methods, no canvas
// references. The renderer, the SVG exporter and the tests all read the same
// fields, which is what keeps a downloaded SVG looking like the board.

import { containsPoint, ellipseContains } from "./geometry.js";

export const STICKY_COLORS = {
  butter: { fill: "#ffe9a8", edge: "#edcf7c", ink: "#4a3811", label: "Butter" },
  lilac: { fill: "#e9dcff", edge: "#d3bdf7", ink: "#35245c", label: "Lilac" },
  mint: { fill: "#d6f3e0", edge: "#b2e2c1", ink: "#1d4934", label: "Mint" },
  peach: { fill: "#ffdcc8", edge: "#f3c2a6", ink: "#5b2f1c", label: "Peach" },
  sky: { fill: "#d9e9ff", edge: "#b9d4f5", ink: "#20375c", label: "Sky" },
};

export const STICKY_COLOR_KEYS = Object.keys(STICKY_COLORS);

export const SHAPE_TYPES = ["rect", "ellipse", "sticky", "text", "connector"];

const LABELS = {
  rect: "Rectangle",
  ellipse: "Ellipse",
  sticky: "Sticky note",
  text: "Text",
  connector: "Connector",
};

let idCounter = 0;

export function makeId(prefix = "shape") {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function stickyColor(shape) {
  return STICKY_COLORS[shape.color] || STICKY_COLORS.butter;
}

export function shapeLabel(shape) {
  if (!shape) return "Nothing";
  const base = LABELS[shape.type] || shape.type;
  const text = (shape.text || shape.label || "").trim().replace(/\s+/g, " ");
  if (!text) return base;
  return `${base} · ${text.length > 28 ? text.slice(0, 27) + "…" : text}`;
}

export function isConnectable(shape) {
  return Boolean(shape) && shape.type !== "connector";
}

/** A dashed background panel. Frames paint below connectors, nodes above them. */
export function isFrameShape(shape) {
  return Boolean(shape) && shape.type === "rect" && shape.frame === true;
}

export function createShape(type, init = {}) {
  const id = init.id || makeId(type);
  const seed = { id, type, x: 0, y: 0, ...init };

  switch (type) {
    case "rect":
      return {
        w: 180, h: 100, fill: "#fffdf8", stroke: "#d8cbb9", strokeWidth: 1.5,
        radius: 12, dashed: false, frame: false, label: "", fontSize: 16,
        textColor: "#3a3048", ...seed,
      };
    case "ellipse":
      return {
        w: 160, h: 100, fill: "#f0e9ff", stroke: "#b28bff", strokeWidth: 2,
        label: "", fontSize: 16, textColor: "#3b2a5e", ...seed,
      };
    case "sticky":
      return {
        w: 180, h: 150, color: "butter", text: "New note", fontSize: 15,
        textColor: null, ...seed,
      };
    case "text": {
      const shape = {
        w: 300, h: 32, text: "Text", fontSize: 22, weight: 600,
        color: "#2b2438", align: "left", ...seed,
      };
      if (!init.w || !init.h) {
        const size = textBoxSize(shape.text, { fontSize: shape.fontSize });
        shape.w = init.w || size.w;
        shape.h = init.h || size.h;
      }
      return shape;
    }
    case "connector":
      return {
        from: null, to: null, fromSide: "auto", toSide: "auto",
        stroke: "#8d7aa5", strokeWidth: 2.2, arrow: true, dashed: false,
        ...seed,
      };
    default:
      throw new Error(`Unknown shape type: ${type}`);
  }
}

export function cloneShape(shape) {
  return { ...shape };
}

export function shapeBounds(shape) {
  if (!shape || shape.type === "connector") return null;
  return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
}

export function shapeContains(shape, point, pad = 0) {
  if (!shape || shape.type === "connector") return false;
  if (shape.type === "ellipse") return ellipseContains(shape, point, pad);
  if (shape.type === "text") return containsPoint(shape, point, pad + 4);
  return containsPoint(shape, point, pad);
}

export function moveShape(shape, dx, dy) {
  if (!shape || shape.type === "connector") return cloneShape(shape);
  return { ...shape, x: shape.x + dx, y: shape.y + dy };
}

export function shapeText(shape) {
  if (!shape) return "";
  if (shape.type === "sticky" || shape.type === "text") return shape.text || "";
  if (shape.type === "rect" || shape.type === "ellipse") return shape.label || "";
  return "";
}

/* --------------------------------------------------------------- text flow */

/**
 * Greedy word wrap on a character budget. We do not have a font metrics API in
 * node:test, and measuring in the browser would make the SVG export depend on
 * the renderer. A fixed advance width (0.52 em for Inter) is close enough for
 * note-sized copy and keeps the export deterministic.
 */
export function wrapText(text, maxChars) {
  const paragraphs = String(text ?? "").split("\n");
  const limit = Math.max(4, maxChars);
  const lines = [];
  for (const paragraph of paragraphs) {
    if (paragraph === "") { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= limit) line += " " + word;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

export function textLayout(shape) {
  const fontSize = shape.fontSize || 15;
  const padding = shape.type === "sticky" ? 16 : 0;
  const available = Math.max(40, (shape.w || 180) - padding * 2);
  const maxChars = Math.max(4, Math.floor(available / (fontSize * 0.52)));
  const lines = wrapText(shapeText(shape), maxChars);
  const lineHeight = Math.round(fontSize * 1.38);
  return { lines, lineHeight, fontSize, padding, available };
}

/** Lines that physically fit inside the shape, plus a clipped flag for a fade. */
export function visibleTextLines(shape) {
  const layout = textLayout(shape);
  const pad = shape.type === "sticky" ? 16 : 4;
  const maxLines = Math.max(1, Math.floor((shape.h - pad * 2) / layout.lineHeight));
  return {
    ...layout,
    lines: layout.lines.slice(0, maxLines),
    clipped: layout.lines.length > maxLines,
  };
}

/** Measured box for a free text shape; used when a text tool click has no drag. */
export function textBoxSize(text, { fontSize = 22, maxWidth = 340, padding = 0 } = {}) {
  const probe = { type: "text", text, w: maxWidth, h: 100, fontSize };
  const layout = textLayout(probe);
  const longest = layout.lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    w: Math.max(80, Math.ceil(longest * fontSize * 0.52) + padding * 2),
    h: Math.max(Math.ceil(fontSize * 1.5), layout.lines.length * layout.lineHeight),
  };
}

/** After an inline text edit the box must grow or shrink to fit again. */
export function fitTextShape(shape) {
  if (!shape || shape.type !== "text") return shape;
  const size = textBoxSize(shape.text, { fontSize: shape.fontSize });
  return { ...shape, w: size.w, h: size.h };
}
