// A simulated collaborator. There is no WebSocket in this project; the peer is
// a small deterministic state machine that moves a cursor between shapes,
// drops a note every few seconds and occasionally nudges a sticky. Its random
// stream is seeded so the same seed produces the same choreography in tests.
//
// It returns operations instead of applying them: the demo decides whether to
// commit them to history, and the tests can inspect them without a browser.

import { makeId, createShape, shapeBounds } from "./shapes.js";
import { geometricShapes } from "./scene.js";

export const PEER_NOTES = [
  "Can we test this with three users?",
  "Needs a copy pass before review.",
  "Move this after authentication.",
  "Who owns this error state?",
  "Parking this until QA signs off.",
  "This maps to the retry ticket.",
];

export const PEER_COLORS = ["butter", "lilac", "mint", "peach", "sky"];

export function mulberry32(seed) {
  let state = (seed >>> 0) || 1;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createPeer(init = {}) {
  const cursor = init.cursor || { x: 0, y: 0 };
  return {
    id: init.id || "nyx",
    name: init.name || "Nyx",
    color: init.color || "#ff7ac6",
    role: init.role || "simulated peer",
    cursor: { ...cursor },
    waypoint: { ...cursor },
    hasWaypoint: false,
    speed: init.speed || 230,
    cooldown: init.cooldown ?? 2.2,
    actions: 0,
    status: "reviewing the board",
    rand: mulberry32(init.seed ?? 7),
  };
}

function nextWaypoint(peer, scene) {
  const nodes = geometricShapes(scene);
  const rand = peer.rand;
  if (!nodes.length) {
    peer.waypoint = {
      x: peer.cursor.x + (rand() - 0.5) * 320,
      y: peer.cursor.y + (rand() - 0.5) * 200,
    };
    peer.hasWaypoint = true;
    return;
  }
  const shape = nodes[Math.floor(rand() * nodes.length)];
  const box = shapeBounds(shape);
  // Stop just outside a shape instead of on top of it: a real peer parks its
  // cursor in the whitespace while reading, and it keeps the name label off
  // the note copy.
  const angle = rand() * Math.PI * 2;
  const radius = Math.max(box.w, box.h) / 2 + 38 + rand() * 54;
  peer.waypoint = {
    x: box.x + box.w / 2 + Math.cos(angle) * radius,
    y: box.y + box.h / 2 + Math.sin(angle) * radius,
  };
  peer.hasWaypoint = true;
}

function placeNote(peer) {
  const rand = peer.rand;
  const text = PEER_NOTES[Math.floor(rand() * PEER_NOTES.length)];
  const color = PEER_COLORS[Math.floor(rand() * PEER_COLORS.length)];
  const x = peer.cursor.x - 92 + (rand() - 0.5) * 24;
  const y = peer.cursor.y - 56 + (rand() - 0.5) * 24;
  peer.status = "placing a note";
  return {
    type: "place-sticky",
    sticky: createShape("sticky", {
      id: `peer-note-${peer.id}-${peer.actions}`,
      x: Math.round(x / 8) * 8,
      y: Math.round(y / 8) * 8,
      color,
      text,
      w: 184,
      h: 148,
    }),
  };
}

function nudgeShape(peer, scene) {
  const rand = peer.rand;
  const candidates = geometricShapes(scene).filter((shape) => shape.type !== "text");
  if (!candidates.length) return placeNote(peer);
  const target = candidates[Math.floor(rand() * candidates.length)];
  const distance = 18 + rand() * 46;
  const angle = rand() * Math.PI * 2;
  peer.status = "nudging a sticky";
  return {
    type: "nudge",
    id: target.id,
    dx: Math.round(Math.cos(angle) * distance),
    dy: Math.round(Math.sin(angle) * distance),
  };
}

/**
 * Advance the peer by `dt` seconds. Mutates cursor/waypoint/cooldown on the
 * passed object and returns `{type:"place-sticky"...}`, `{type:"nudge"...}` or
 * null when the peer is only moving.
 */
export function stepPeer(peer, dt, scene, { minCooldown = 7, cooldownJitter = 4 } = {}) {
  const delta = Math.min(0.35, Math.max(0, dt));
  if (!peer.hasWaypoint) nextWaypoint(peer, scene);

  const dx = peer.waypoint.x - peer.cursor.x;
  const dy = peer.waypoint.y - peer.cursor.y;
  const distance = Math.hypot(dx, dy);
  const travel = peer.speed * delta;

  if (distance <= travel || distance < 2) {
    peer.cursor = { ...peer.waypoint };
    nextWaypoint(peer, scene);
    if (!peer.status.startsWith("placing") && !peer.status.startsWith("nudging")) {
      peer.status = "reviewing the board";
    }
  } else {
    peer.cursor = {
      x: peer.cursor.x + (dx / distance) * travel,
      y: peer.cursor.y + (dy / distance) * travel,
    };
  }

  peer.cooldown -= delta;
  if (peer.cooldown > 0) return null;

  peer.actions += 1;
  peer.cooldown = minCooldown + peer.rand() * cooldownJitter;
  return peer.actions % 2 === 1 ? placeNote(peer) : nudgeShape(peer, scene);
}

export function describePeerOp(op) {
  if (!op) return "";
  if (op.type === "place-sticky") return `placed “${op.sticky.text}”`;
  if (op.type === "nudge") return "nudged a sticky";
  return "";
}
