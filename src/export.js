// Export the scene as standalone SVG.
//
// The exporter is deliberately separate from the canvas renderer: it uses the
// same shape geometry and the same text wrapping, but emits plain SVG elements
// so the file opens anywhere without the app. PNG is produced by the demo from
// the same scene, using the browser renderer, since rasterising text is a
// browser job.

import { expandBox } from "./geometry.js";
import { arrowHead, connectorGeometry, pathData } from "./connectors.js";
import { sceneBounds, shapesById } from "./scene.js";
import { isFrameShape, stickyColor, visibleTextLines } from "./shapes.js";

const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

export function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  }[char]));
}

/** Pixel dimensions of a PNG/SVG export at `scale`, including padding. */
export function exportSize(scene, { padding = 64, scale = 2 } = {}) {
  const box = sceneBounds(scene);
  return {
    width: Math.max(320, Math.round((box.w + padding * 2) * scale)),
    height: Math.max(240, Math.round((box.h + padding * 2) * scale)),
    bounds: box,
    padding,
    scale,
  };
}

function number(value) {
  return Math.round(value * 100) / 100;
}

function textBlock(shape, { x, y, anchor = "start", color, weight, fontSize, lines, lineHeight }) {
  const tspans = lines.map((line, index) =>
    `<tspan x="${number(x)}" y="${number(y + index * lineHeight)}">${escapeXml(line)}</tspan>`).join("");
  const anchorAttr = anchor === "middle" ? ' text-anchor="middle"' : "";
  return `<text x="${number(x)}" y="${number(y)}" font-family="${FONT}" font-size="${number(fontSize)}" font-weight="${weight}" fill="${escapeXml(color)}"${anchorAttr}>${tspans}</text>`;
}

function labelBlock(shape) {
  const text = shape.type === "rect" || shape.type === "ellipse" ? shape.label : "";
  if (!text) return "";
  const layout = visibleTextLines({ ...shape, text, type: "rect" });
  const totalHeight = layout.lines.length * layout.lineHeight;
  const startY = shape.y + shape.h / 2 - totalHeight / 2 + layout.fontSize * 0.98;
  return textBlock(shape, {
    x: shape.x + shape.w / 2,
    y: startY,
    anchor: "middle",
    color: shape.textColor || "#3a3048",
    weight: 600,
    fontSize: layout.fontSize,
    lines: layout.lines,
    lineHeight: layout.lineHeight,
  });
}

function stickyBlock(shape) {
  const palette = stickyColor(shape);
  const layout = visibleTextLines(shape);
  const rect = `<rect x="${number(shape.x)}" y="${number(shape.y)}" width="${number(shape.w)}" height="${number(shape.h)}" rx="6" fill="${palette.fill}" stroke="${palette.edge}" stroke-width="1"/>`;
  const text = textBlock(shape, {
    x: shape.x + layout.padding,
    y: shape.y + layout.padding + layout.fontSize,
    color: shape.textColor || palette.ink,
    weight: 500,
    fontSize: layout.fontSize,
    lines: layout.lines,
    lineHeight: layout.lineHeight,
  });
  return rect + text;
}

function freeTextBlock(shape) {
  const layout = visibleTextLines(shape);
  const anchor = shape.align === "center" ? "middle" : "start";
  const x = shape.align === "center" ? shape.x + shape.w / 2 : shape.x;
  return textBlock(shape, {
    x,
    y: shape.y + layout.fontSize * 0.98,
    anchor,
    color: shape.color || "#2b2438",
    weight: shape.weight || 600,
    fontSize: layout.fontSize,
    lines: layout.lines,
    lineHeight: layout.lineHeight,
  });
}

export function shapeToSVG(shape, byId) {
  const dataId = ` data-id="${escapeXml(shape.id)}"`;
  switch (shape.type) {
    case "rect": {
      const dash = shape.dashed ? ' stroke-dasharray="7 6"' : "";
      const radius = shape.radius ?? 12;
      const rect = `<rect${dataId} x="${number(shape.x)}" y="${number(shape.y)}" width="${number(shape.w)}" height="${number(shape.h)}" rx="${radius}" fill="${escapeXml(shape.fill || "none")}" stroke="${escapeXml(shape.stroke || "#d8cbb9")}" stroke-width="${shape.strokeWidth ?? 1.5}"${dash}/>`;
      return rect + labelBlock(shape);
    }
    case "ellipse": {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      const ellipse = `<ellipse${dataId} cx="${number(cx)}" cy="${number(cy)}" rx="${number(shape.w / 2)}" ry="${number(shape.h / 2)}" fill="${escapeXml(shape.fill || "#f0e9ff")}" stroke="${escapeXml(shape.stroke || "#b28bff")}" stroke-width="${shape.strokeWidth ?? 2}"/>`;
      return ellipse + labelBlock({ ...shape, text: shape.label || "" });
    }
    case "sticky":
      return `<g${dataId}>${stickyBlock(shape)}</g>`;
    case "text":
      return `<g${dataId}>${freeTextBlock(shape)}</g>`;
    case "connector": {
      const geom = connectorGeometry(shape, byId);
      if (!geom) return "";
      const dash = shape.dashed ? ' stroke-dasharray="6 6"' : "";
      const path = `<path d="${pathData(geom)}" fill="none" stroke="${escapeXml(shape.stroke || "#8d7aa5")}" stroke-width="${shape.strokeWidth ?? 2.2}" stroke-linecap="round"${dash}/>`;
      const arrow = shape.arrow === false ? "" : `<polygon points="${arrowHead(geom).points.map((p) => `${number(p.x)},${number(p.y)}`).join(" ")}" fill="${escapeXml(shape.stroke || "#8d7aa5")}"/>`;
      return `<g${dataId}>${path}${arrow}</g>`;
    }
    default:
      return "";
  }
}

/**
 * Standalone SVG document. Frames paint first, then connectors, then nodes, so
 * a connector never draws over a sticky note and the dashed flow panel does not
 * wash out the arrows inside it.
 */
export function sceneToSVG(scene, options = {}) {
  const { padding = 64, background = "#faf6ee", grid = true, title } = options;
  const box = expandBox(sceneBounds(scene), padding);
  const byId = shapesById(scene);
  const frames = scene.shapes.filter(isFrameShape);
  const connectors = scene.shapes.filter((shape) => shape.type === "connector");
  const nodes = scene.shapes.filter((shape) => shape.type !== "connector" && !isFrameShape(shape));

  const label = title || scene.name;
  const counts = {
    nodes: scene.shapes.filter((s) => s.type !== "connector").length,
    connectors: connectors.length,
  };

  const defs = grid
    ? `<defs><pattern id="board-dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1.2" cy="1.2" r="1.2" fill="#d8d0c2"/></pattern></defs>`
    : "";
  const gridRect = grid
    ? `<rect x="${number(box.x)}" y="${number(box.y)}" width="${number(box.w)}" height="${number(box.h)}" fill="url(#board-dots)"/>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(box.w)}" height="${Math.round(box.h)}" viewBox="${number(box.x)} ${number(box.y)} ${number(box.w)} ${number(box.h)}" role="img" aria-label="${escapeXml(label)}">`,
    `<title>${escapeXml(label)}</title>`,
    `<desc>${counts.nodes} nodes and ${counts.connectors} connectors exported from Canvas.</desc>`,
    defs,
    `<rect x="${number(box.x)}" y="${number(box.y)}" width="${number(box.w)}" height="${number(box.h)}" fill="${escapeXml(background)}"/>`,
    gridRect,
    frames.map((shape) => shapeToSVG(shape, byId)).join("\n"),
    connectors.map((shape) => shapeToSVG(shape, byId)).join("\n"),
    nodes.map((shape) => shapeToSVG(shape, byId)).join("\n"),
    `</svg>`,
  ].filter(Boolean).join("\n");
}

export function sceneFileName(scene) {
  const slug = String(scene.name || "whiteboard")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "whiteboard";
  return slug;
}
