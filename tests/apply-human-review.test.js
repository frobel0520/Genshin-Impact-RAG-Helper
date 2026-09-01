import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../scripts/apply-human-review.js";

function capture() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    streams: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
  };
}

function workspace(context) {
  const directory = mkdtempSync(join(tmpdir(), "apply-human-review-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function report(cases) {
  return {
    run: { run_id: "run:test", status: "passed" },
    results: cases.map(({ caseId, status = "answered" }) => ({
      case_id: caseId,
      answer: { answer_status: status, answer_text: "…", citations: [] },
      metric_labels: {
        answer_correctness: "not_scored",
        groundedness: "not_scored",
        citation_coverage: "pass",
      },
    })),
  };
}

function review(entries) {
  return {
    dataset_version: "dataset-1",
    reviewed_at: "2026-09-01T00:00:00Z",
    reviews: entries.map(({ caseId, acc = "pass", gnd = "pass", note = "" }) => ({
      case_id: caseId,
      human_review: { status: "reviewed", answer_correctness: acc, groundedness: gnd, note },
    })),
  };
}

function fixture(directory, reportValue, reviewValue) {
  const reportPath = join(directory, "report.json");
  const reviewPath = join(directory, "review.json");
  const outPath = join(directory, "human-review.json");
  writeFileSync(reportPath, JSON.stringify(reportValue), "utf8");
  writeFileSync(reviewPath, JSON.stringify(reviewValue), "utf8");
  return { reportPath, reviewPath, outPath };
}

function run(paths, streams) {
  return main(
    [paths.reviewPath, "--report", paths.reportPath, "--out", paths.outPath],
    streams,
  );
}

test("a complete review is recorded and stamped onto the report", (context) => {
  const directory = workspace(context);
  const paths = fixture(
    directory,
    report([{ caseId: "case:a" }, { caseId: "case:b" }]),
    review([{ caseId: "case:a" }, { caseId: "case:b" }]),
  );
  const { stdout, streams } = capture();

  assert.equal(run(paths, streams), 0);

  const record = JSON.parse(readFileSync(paths.outPath, "utf8"));
  assert.equal(record.metrics.answer_correctness.rate, 100);
  assert.equal(record.metrics.answer_correctness.verdict, "pass");
  assert.equal(record.metrics.groundedness.verdict, "pass");
  assert.equal(record.reviews.length, 2);
  assert.equal(record.reviewed_at, "2026-09-01T00:00:00Z");

  const written = JSON.parse(readFileSync(paths.reportPath, "utf8"));
  assert.equal(written.results[0].metric_labels.answer_correctness, "pass");
  assert.equal(written.results[0].human_review.status, "reviewed");
  // The labels the runner already decided must survive the stamp.
  assert.equal(written.results[0].metric_labels.citation_coverage, "pass");
  assert.match(stdout.join(""), /answer_correctness: 100\.0%/);
});

test("a missed target is recorded and reported as a failure", (context) => {
  const directory = workspace(context);
  const paths = fixture(
    directory,
    report([{ caseId: "case:a" }, { caseId: "case:b" }]),
    review([{ caseId: "case:a", acc: "fail", note: "答錯武器" }, { caseId: "case:b" }]),
  );
  const { stdout, streams } = capture();

  assert.equal(run(paths, streams), 1);

  const record = JSON.parse(readFileSync(paths.outPath, "utf8"));
  assert.equal(record.metrics.answer_correctness.rate, 50);
  assert.equal(record.metrics.answer_correctness.verdict, "fail");
  assert.match(stdout.join(""), /case:a — correctness fail/);
  assert.match(stdout.join(""), /答錯武器/);
});

test("an unreviewed case blocks the write rather than defaulting to a pass", (context) => {
  const directory = workspace(context);
  const paths = fixture(
    directory,
    report([{ caseId: "case:a" }, { caseId: "case:b" }]),
    review([{ caseId: "case:a" }, { caseId: "case:b", gnd: "hold" }]),
  );
  const { stderr, streams } = capture();

  // `hold` is a verdict, so it is recorded — it just is not a pass, and the
  // rate says so. An unreviewed case is the different thing: nothing is written.
  assert.equal(run(paths, streams), 1);
  assert.equal(
    JSON.parse(readFileSync(paths.outPath, "utf8")).metrics.groundedness.rate,
    50,
  );

  const partial = fixture(
    directory,
    report([{ caseId: "case:a" }, { caseId: "case:b" }]),
    review([{ caseId: "case:a" }]),
  );
  assert.equal(run(partial, streams), 1);
  assert.match(stderr.join(""), /case:b: missing from the review/);

  const before = JSON.parse(readFileSync(partial.reportPath, "utf8"));
  assert.equal(before.results[1].metric_labels.answer_correctness, "not_scored");
});

test("a review naming a case the report does not answer is refused", (context) => {
  const directory = workspace(context);
  const paths = fixture(
    directory,
    report([{ caseId: "case:a" }]),
    review([{ caseId: "case:a" }, { caseId: "case:from-another-run" }]),
  );
  const { stderr, streams } = capture();

  assert.equal(run(paths, streams), 1);
  assert.match(stderr.join(""), /case:from-another-run/);
});

test("refused cases are neither reviewed nor required", (context) => {
  const directory = workspace(context);
  const paths = fixture(
    directory,
    report([{ caseId: "case:a" }, { caseId: "case:refused", status: "refused" }]),
    review([{ caseId: "case:a" }]),
  );
  const { streams } = capture();

  assert.equal(run(paths, streams), 0);

  const record = JSON.parse(readFileSync(paths.outPath, "utf8"));
  assert.deepEqual(
    record.reviews.map((entry) => entry.case_id),
    ["case:a"],
  );
  const written = JSON.parse(readFileSync(paths.reportPath, "utf8"));
  assert.equal(written.results[1].metric_labels.answer_correctness, "not_scored");
});

test("a bad label is named rather than silently dropped", (context) => {
  const directory = workspace(context);
  const paths = fixture(
    directory,
    report([{ caseId: "case:a" }]),
    review([{ caseId: "case:a", gnd: "probably" }]),
  );
  const { stderr, streams } = capture();

  assert.equal(run(paths, streams), 1);
  assert.match(stderr.join(""), /case:a: groundedness is "probably"/);
});

test("the command explains itself instead of guessing at missing arguments", (context) => {
  const directory = workspace(context);
  const { stderr, streams } = capture();

  assert.equal(main([], streams), 2);
  assert.match(stderr.join(""), /Usage:/);

  assert.equal(main([join(directory, "nothing.json")], streams), 1);
  assert.match(stderr.join(""), /No file at/);
});

test("who judged is recorded, and defaults to unattributed", (context) => {
  const directory = workspace(context);
  const attributed = fixture(
    directory,
    report([{ caseId: "case:a" }]),
    { ...review([{ caseId: "case:a" }]), reviewer: "claude-opus-5 (machine review)" },
  );
  const { stdout, streams } = capture();

  assert.equal(run(attributed, streams), 0);
  const record = JSON.parse(readFileSync(attributed.outPath, "utf8"));
  assert.equal(record.reviewer, "claude-opus-5 (machine review)");
  assert.equal(
    JSON.parse(readFileSync(attributed.reportPath, "utf8")).results[0].human_review.reviewer,
    "claude-opus-5 (machine review)",
  );
  assert.match(stdout.join(""), /reviewer: claude-opus-5/);

  // A record that does not say who judged must not read as though a person did.
  const anonymous = fixture(directory, report([{ caseId: "case:a" }]), review([{ caseId: "case:a" }]));
  assert.equal(run(anonymous, streams), 0);
  assert.equal(JSON.parse(readFileSync(anonymous.outPath, "utf8")).reviewer, "unattributed");
});
