import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_GRAPH_ZOOM,
  MIN_GRAPH_ZOOM,
  zoomGraphAt,
} from "../lib/graph-viewport";

test("graph zoom keeps the graph point under the gesture anchor", () => {
  const before = { x: 40, y: -20, scale: 1 };
  const anchor = { x: 300, y: 180 };
  const graphPoint = {
    x: (anchor.x - before.x) / before.scale,
    y: (anchor.y - before.y) / before.scale,
  };
  const after = zoomGraphAt(before, 1.75, anchor);

  assert.equal(after.x + graphPoint.x * after.scale, anchor.x);
  assert.equal(after.y + graphPoint.y * after.scale, anchor.y);
});

test("graph zoom clamps extreme pinch scales", () => {
  assert.equal(zoomGraphAt({ x: 0, y: 0, scale: 1 }, 100, { x: 0, y: 0 }).scale, MAX_GRAPH_ZOOM);
  assert.equal(zoomGraphAt({ x: 0, y: 0, scale: 1 }, 0.01, { x: 0, y: 0 }).scale, MIN_GRAPH_ZOOM);
});
