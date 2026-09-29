import assert from "node:assert/strict";
import test from "node:test";

import { summarizeLatency } from "../src/evaluation/latency-summary.js";

test("the ten-second gate checks every end-to-end case", () => {
  const summary = summarizeLatency([
    { case_id: "case:fast", duration_ms: 900 },
    { case_id: "case:limit", duration_ms: 10_000 },
    { case_id: "case:slow", duration_ms: 10_001 },
  ]);
  assert.equal(summary.meets_target, false);
  assert.equal(summary.max_ms, 10_001);
  assert.deepEqual(summary.over_target, [{ case_id: "case:slow", duration_ms: 10_001 }]);
});
