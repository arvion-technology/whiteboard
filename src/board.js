// The two seeded boards. Kept in src/ (not the demo) so a reset, a screenshot
// deep link and any future test all get byte-identical content.

import { createScene } from "./scene.js";
import { createShape } from "./shapes.js";

export const BOARDS = {
  sprint: {
    kind: "sprint",
    name: "Q4 checkout teardown",
    description: "Current checkout flow with four research notes and a parking lot.",
    selectId: null,
  },
  flow: {
    kind: "flow",
    name: "Checkout user flow",
    description: "Happy path plus the two branches the team is still arguing about.",
    selectId: "flow-note-account",
  },
};

export const DEFAULT_BOARD = "sprint";

function sprintBoard() {
  const shapes = [];
  const add = (type, init) => { const shape = createShape(type, init); shapes.push(shape); return shape; };

  add("text", {
    id: "sprint-title", x: 56, y: 24, w: 620, h: 44,
    text: "Q4 checkout teardown", fontSize: 30, weight: 700, color: "#2a2136",
  });
  add("text", {
    id: "sprint-subtitle", x: 58, y: 70, w: 520, h: 24,
    text: "Sprint 24  ·  owner Nyx  ·  review Friday", fontSize: 14, weight: 500, color: "#85748f",
  });

  add("rect", {
    id: "sprint-frame", x: 56, y: 112, w: 872, h: 204, frame: true,
    fill: "rgba(255, 255, 255, 0.55)", stroke: "#ded0bb", strokeWidth: 1.5,
    dashed: true, radius: 18, label: "",
  });
  add("text", {
    id: "sprint-flow-label", x: 80, y: 128, w: 200, h: 18,
    text: "CURRENT FLOW", fontSize: 11, weight: 700, color: "#a1909d",
  });

  add("rect", { id: "sprint-landing", x: 92, y: 168, w: 150, h: 84, label: "Landing", fontSize: 16 });
  add("rect", { id: "sprint-cart", x: 300, y: 168, w: 150, h: 84, label: "Cart", fontSize: 16 });
  add("ellipse", { id: "sprint-payment", x: 506, y: 170, w: 160, h: 80, label: "Payment", fontSize: 16 });
  add("rect", { id: "sprint-confirm", x: 724, y: 168, w: 160, h: 84, label: "Confirmation", fontSize: 16 });

  for (const [id, from, to] of [
    ["sprint-c1", "sprint-landing", "sprint-cart"],
    ["sprint-c2", "sprint-cart", "sprint-payment"],
    ["sprint-c3", "sprint-payment", "sprint-confirm"],
  ]) {
    add("connector", { id, from, to, stroke: "#8d7aa5", strokeWidth: 2.2 });
  }

  add("sticky", {
    id: "sprint-guest", x: 76, y: 366, w: 190, h: 154, color: "butter",
    text: "Guest checkout is the biggest drop-off. 38% leave at account creation.",
  });
  add("sticky", {
    id: "sprint-wallet", x: 290, y: 352, w: 190, h: 154, color: "lilac",
    text: "Add wallet options: Apple Pay, eSewa, Khalti.",
  });
  add("sticky", {
    id: "sprint-fraud", x: 504, y: 372, w: 190, h: 154, color: "mint",
    text: "Fraud check adds 1.2s. Move it after authentication.",
  });
  add("sticky", {
    id: "sprint-retry", x: 718, y: 356, w: 190, h: 154, color: "peach",
    text: "Retry failed cards inline, not on a new page.",
  });
  add("sticky", {
    id: "sprint-parking", x: 960, y: 150, w: 176, h: 132, color: "sky",
    text: "Parking lot: dark-mode checkout",
  });
  add("sticky", {
    id: "sprint-idea", x: 968, y: 360, w: 176, h: 132, color: "butter",
    text: "Idea: remember carts across devices.",
  });
  add("sticky", {
    id: "sprint-test", x: 760, y: 566, w: 190, h: 130, color: "lilac",
    text: "Test guest checkout with five real users.",
  });

  // A dashed connector from a sticky up to the payment node. It exists to prove
  // that an anchor can be reattached across a move; it also looks like a real
  // annotation rather than a diagram-only edge.
  add("connector", {
    id: "sprint-link", from: "sprint-fraud", to: "sprint-payment",
    stroke: "#b28bff", strokeWidth: 1.8, dashed: true, arrow: false,
  });

  add("text", {
    id: "sprint-questions", x: 76, y: 552, w: 300, h: 24,
    text: "Open questions", fontSize: 16, weight: 600, color: "#3a3048",
  });
  add("text", {
    id: "sprint-questions-body", x: 76, y: 582, w: 560, h: 56,
    text: "• Do we keep a separate cart page at all?\n• Who owns the payment error states?",
    fontSize: 14, weight: 500, color: "#6f5f79",
  });

  return shapes;
}

function flowBoard() {
  const shapes = [];
  const add = (type, init) => { const shape = createShape(type, init); shapes.push(shape); return shape; };

  add("text", {
    id: "flow-title", x: 120, y: 32, w: 620, h: 44,
    text: "Checkout user flow", fontSize: 30, weight: 700, color: "#2a2136",
  });
  add("text", {
    id: "flow-subtitle", x: 122, y: 78, w: 560, h: 24,
    text: "Happy path plus the two branches we keep arguing about", fontSize: 14, weight: 500, color: "#85748f",
  });

  add("rect", { id: "flow-cart", x: 180, y: 150, w: 220, h: 88, label: "Cart page", fontSize: 17 });
  add("ellipse", { id: "flow-account", x: 200, y: 300, w: 180, h: 100, label: "Account?", fontSize: 16 });
  add("rect", { id: "flow-signin", x: 40, y: 470, w: 190, h: 84, label: "Sign in", fontSize: 16 });
  add("rect", { id: "flow-guest", x: 320, y: 470, w: 200, h: 84, label: "Guest details", fontSize: 16 });
  add("ellipse", { id: "flow-payment", x: 210, y: 620, w: 180, h: 100, label: "Payment ok?", fontSize: 16 });
  add("rect", { id: "flow-done", x: 180, y: 770, w: 220, h: 88, label: "Confirmation", fontSize: 17 });

  for (const [id, from, to] of [
    ["flow-c1", "flow-cart", "flow-account"],
    ["flow-c2", "flow-account", "flow-signin"],
    ["flow-c3", "flow-account", "flow-guest"],
    ["flow-c4", "flow-signin", "flow-payment"],
    ["flow-c5", "flow-guest", "flow-payment"],
    ["flow-c6", "flow-payment", "flow-done"],
  ]) {
    add("connector", { id, from, to, stroke: "#8d7aa5", strokeWidth: 2.2 });
  }

  add("sticky", {
    id: "flow-note-account", x: 540, y: 300, w: 198, h: 150, color: "lilac",
    text: "Guest path must never ask for an account.",
  });
  add("sticky", {
    id: "flow-note-one", x: 520, y: 500, w: 198, h: 150, color: "butter",
    text: "One screen checkout: fewer steps wins the test.",
  });
  add("sticky", {
    id: "flow-note-scope", x: 820, y: 210, w: 200, h: 150, color: "peach",
    text: "Ship Friday? Needs QA sign-off first.",
  });
  add("sticky", {
    id: "flow-note-qa", x: 820, y: 430, w: 200, h: 150, color: "sky",
    text: "Add an e2e test for the guest checkout path.",
  });
  add("sticky", {
    id: "flow-note-copy", x: 520, y: 700, w: 198, h: 150, color: "mint",
    text: "Copy review: error states still say “card declined”.",
  });

  add("text", {
    id: "flow-note-heading", x: 820, y: 168, w: 220, h: 24,
    text: "REVIEW NOTES", fontSize: 11, weight: 700, color: "#a1909d",
  });

  return shapes;
}

export function seedBoard(kind = DEFAULT_BOARD) {
  const meta = BOARDS[kind] || BOARDS[DEFAULT_BOARD];
  const shapes = meta.kind === "flow" ? flowBoard() : sprintBoard();
  return createScene({ name: meta.name, shapes });
}
