import assert from "node:assert/strict";
import test from "node:test";

import { summarizeRepeatedRuns } from "../src/evaluation/repeated-run-summary.js";

function sample(templateCount, firstAnswer) {
  return {
    cases: { answered_with_template: templateCount },
    metrics: {
      citation_coverage: { score: 1 },
      groundedness: { score: null },
    },
    results: [
      { case_id: "case:a", answer: { answer_status: "answered", answer_text: firstAnswer } },
      { case_id: "case:b", answer: { answer_status: "refused", answer_text: "無資料" } },
    ],
  };
}

test("repeated runs report a range and identify changing prose", () => {
  const summary = summarizeRepeatedRuns([
    sample(4, "答案 A"),
    sample(9, "答案 B"),
    sample(6, "答案 A"),
  ]);
  assert.deepEqual(summary.answered_with_template, { values: [4, 9, 6], min: 4, max: 9 });
  assert.deepEqual(summary.changed_answer_cases, ["case:a"]);
  assert.deepEqual(summary.metric_scores.citation_coverage, {
    values: [1, 1, 1], min: 1, max: 1,
  });
  assert.deepEqual(summary.status_distributions, [
    { answered: 1, refused: 1 },
    { answered: 1, refused: 1 },
    { answered: 1, refused: 1 },
  ]);
});

test("runs with different cases cannot be compared", () => {
  const changed = sample(4, "答案");
  changed.results[1].case_id = "case:c";
  assert.throws(() => summarizeRepeatedRuns([sample(4, "答案"), changed]), /same cases/);
});
