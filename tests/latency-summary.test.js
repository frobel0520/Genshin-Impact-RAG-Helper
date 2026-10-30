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

test("missing or invalid durations cannot create a passing latency gate", () => {
  for (const duration_ms of [undefined, null, NaN, Infinity, -Infinity, -1, "900", true]) {
    assert.throws(() => summarizeLatency([{case_id: "synthetic", duration_ms}]), /duration_ms/);
  }
  for (const entry of [null, undefined, [], "synthetic"]) {
    assert.throws(() => summarizeLatency([entry]), /duration_ms/);
  }
  assert.throws(() => summarizeLatency(new Array(1)), /duration_ms/);
});

test("a non-finite or non-positive threshold cannot disable the latency gate", () => {
  for (const threshold of [NaN, Infinity, -Infinity, 0, -1, "10000", null]) {
    assert.throws(() => summarizeLatency([{duration_ms: 10001}], threshold), /targetMs/);
  }
  assert.equal(summarizeLatency([{duration_ms: 0}, {duration_ms: 9999.5}]).meets_target, true);
  assert.equal(summarizeLatency([{duration_ms: 1.5}], 1).meets_target, false);
});
