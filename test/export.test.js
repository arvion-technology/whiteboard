import test from "node:test";
import assert from "node:assert/strict";
import { escapeXml, exportSize, sceneFileName, sceneToSVG, shapeToSVG } from "../src/export.js";
import { createScene, shapesById } from "../src/scene.js";
import { createShape } from "../src/shapes.js";

function scene() {
  return createScene({
    name: "Sprint & review",
    shapes: [
      createShape("rect", { id: "frame", x: -20, y: -20, w: 520, h: 260, frame: true, fill: "rgba(255,255,255,0.55)" }),
      createShape("rect", { id: "r1", x: 0, y: 0, w: 100, h: 50, label: "Cart" }),
      createShape("ellipse", { id: "e1", x: 300, y: 0, w: 120, h: 60, label: "Pay" }),
      createShape("sticky", {
        id: "s1", x: 0, y: 120, w: 180, h: 150, color: "mint",
        text: "Use < 5 steps & keep it > 2",
      }),
      createShape("text", { id: "t1", x: 280, y: 140, w: 200, h: 30, text: "Owner: Nyx" }),
      createShape("connector", { id: "c1", from: "r1", to: "e1", dashed: true }),
    ],
  });
}

test("escapeXml handles the five XML metacharacters", () => {
  assert.equal(escapeXml(`<a href="x">&'</a>`), "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
});

test("exportSize adds padding then applies the raster scale", () => {
  const size = exportSize(scene(), { padding: 20, scale: 2 });
  assert.equal(size.width, 1120); // (-20..440 = 460 wide) + 40, doubled
  assert.equal(size.height, 660); // (-20..270 = 290 tall) + 40, doubled
  assert.equal(size.scale, 2);
  assert.equal(size.padding, 20);
});

test("sceneToSVG produces a standalone, self-contained document", () => {
  const svg = sceneToSVG(scene());
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<title>Sprint &amp; review<\/title>/);
  assert.match(svg, /viewBox="-84 -84 648 418"/);
  assert.match(svg, /fill="#faf6ee"/);
  assert.match(svg, /<pattern id="board-dots"/);
  assert.doesNotMatch(svg, /<script/);
  assert.doesNotMatch(svg, /<image/);
  assert.doesNotMatch(svg, /(?:href|src)="https?:/);
});

test("nodes, sticky colours and escaped copy survive serialisation", () => {
  const svg = sceneToSVG(scene());
  assert.match(svg, /data-id="r1"/);
  assert.match(svg, /data-id="e1"/);
  assert.match(svg, /fill="#d6f3e0"/); // mint sticky fill
  assert.match(svg, /Use &lt; 5 steps/);
  assert.ok(svg.includes("&amp;"));
  assert.ok(svg.includes("keep it &gt; 2"));
  assert.match(svg, /Owner: Nyx/);
});

test("connectors export as a path with an arrowhead and dash pattern", () => {
  const svg = sceneToSVG(scene());
  const connectorBlock = svg.split('data-id="c1"')[1].split("</g>")[0];
  assert.match(connectorBlock, /<path d="M /);
  assert.match(connectorBlock, /stroke-dasharray="6 6"/);
  assert.match(connectorBlock, /<polygon points="/);
});

test("individual shapes serialise with their own data id", () => {
  const s = scene();
  const byId = shapesById(s);
  const rect = shapeToSVG(s.shapes.find((shape) => shape.id === "r1"), byId);
  assert.match(rect, /data-id="r1"/);
  assert.match(rect, /<rect /);
  assert.match(rect, /Cart/);
  const connector = shapeToSVG(s.shapes.find((shape) => shape.id === "c1"), byId);
  assert.match(connector, /<path /);
});

test("sceneFileName is a safe download slug", () => {
  assert.equal(sceneFileName({ name: "Q4 checkout teardown" }), "q4-checkout-teardown");
  assert.equal(sceneFileName({ name: "  " }), "whiteboard");
});
