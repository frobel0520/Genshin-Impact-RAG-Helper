#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = `Usage:
  node scripts/apply-human-review.js <review-export.json> [--report <path>] [--out <path>]

Takes the export from the review tool and records it as the project's verdict on
the two human-judged gate criteria. Writes the verdict to <out> (default
artifacts/human-review.json) and stamps it back onto the matching cases in
<report> (default artifacts/eval-report.json).

Exits non-zero when the export does not describe the report it is applied to, or
when a case is still unreviewed — a gate closed on a partial review is worse
than one left open.`;

const VALID_LABELS = new Set(["pass", "fail", "hold"]);
const TARGETS = { answer_correctness: 90, groundedness: 95 };

/**
 * Maintainer entry point for recording the human half of the release gate.
 *
 * The two labels this applies are the ones the runner deliberately leaves
 * `not_scored`: no machine decided them, so they arrive from a person or not at
 * all. The command therefore refuses to guess — an unreviewed case is an error,
 * not a default — and it recomputes the rates itself rather than trusting the
 * totals the export carried, so the number that reaches the gate document is
 * derived from the per-case verdicts it is supposed to summarize.
 */
export function main(argv, streams = {}) {
  const out = streams.stdout ?? ((text) => process.stdout.write(text));
  const err = streams.stderr ?? ((text) => process.stderr.write(text));
  const [exportPath, ...rest] = argv;
  if (exportPath === undefined) {
    err(`${USAGE}\n`);
    return 2;
  }

  let flags;
  try {
    flags = parseFlags(rest);
  } catch (error) {
    err(`${error.message}\n`);
    return 2;
  }
  const reportPath = flags.report ?? "artifacts/eval-report.json";
  const outputPath = flags.out ?? "artifacts/human-review.json";

  const exported = readJson(exportPath, err);
  const report = readJson(reportPath, err);
  if (exported === undefined || report === undefined) {
    return 1;
  }

  const reviews = new Map();
  for (const entry of exported.reviews ?? []) {
    if (!isStableString(entry?.case_id)) {
      err("A review entry carries no case_id.\n");
      return 1;
    }
    reviews.set(entry.case_id, entry.human_review ?? {});
  }

  const answered = (report.results ?? []).filter(
    (result) => result.answer?.answer_status === "answered",
  );
  if (answered.length === 0) {
    err(`${reportPath} contains no answered case to review.\n`);
    return 1;
  }

  const problems = [];
  const totals = { answer_correctness: [0, 0], groundedness: [0, 0] };

  // A review of one run says nothing about another. The case IDs are what makes
  // the two describe the same thing, so a review carrying a case the report
  // does not answer is a review of some other run, not a partial one.
  const answerable = new Set(answered.map((result) => result.case_id));
  for (const caseId of reviews.keys()) {
    if (!answerable.has(caseId)) {
      problems.push(`${caseId}: reviewed, but ${reportPath} has no answered case by that ID`);
    }
  }

  for (const result of answered) {
    const review = reviews.get(result.case_id);
    if (review === undefined) {
      problems.push(`${result.case_id}: missing from the review`);
      continue;
    }
    for (const metric of ["answer_correctness", "groundedness"]) {
      const label = review[metric];
      if (!VALID_LABELS.has(label)) {
        problems.push(`${result.case_id}: ${metric} is "${label ?? "not_scored"}"`);
        continue;
      }
      totals[metric][1] += 1;
      if (label === "pass") {
        totals[metric][0] += 1;
      }
    }
  }

  if (problems.length > 0) {
    err(`The review is incomplete, so nothing was written:\n`);
    for (const problem of problems) {
      err(`  ${problem}\n`);
    }
    return 1;
  }

  const reviewedAt = isStableString(exported.reviewed_at)
    ? exported.reviewed_at
    : new Date().toISOString();

  const metrics = {};
  for (const [metric, [passed, scored]] of Object.entries(totals)) {
    const rate = Math.round((passed / scored) * 1000) / 10;
    metrics[metric] = {
      passed,
      scored,
      rate,
      target: TARGETS[metric],
      verdict: rate >= TARGETS[metric] ? "pass" : "fail",
    };
  }

  const record = {
    dataset_version: isStableString(exported.dataset_version) ? exported.dataset_version : null,
    reviewed_at: reviewedAt,
    report: reportPath,
    metrics,
    reviews: answered.map((result) => {
      const review = reviews.get(result.case_id);
      return {
        case_id: result.case_id,
        answer_correctness: review.answer_correctness,
        groundedness: review.groundedness,
        note: isStableString(review.note) ? review.note : "",
      };
    }),
  };

  for (const result of answered) {
    const review = reviews.get(result.case_id);
    result.metric_labels = {
      ...result.metric_labels,
      answer_correctness: review.answer_correctness,
      groundedness: review.groundedness,
    };
    result.human_review = {
      status: "reviewed",
      reviewed_at: reviewedAt,
      answer_correctness: review.answer_correctness,
      groundedness: review.groundedness,
      note: isStableString(review.note) ? review.note : "",
    };
  }

  writeJson(outputPath, record);
  writeJson(reportPath, report);

  out(`Recorded ${record.reviews.length} reviewed cases to ${outputPath}\n`);
  for (const [metric, value] of Object.entries(metrics)) {
    out(
      `  ${metric}: ${value.rate.toFixed(1)}% (${value.passed}/${value.scored}) ` +
        `against ≥ ${value.target}% — ${value.verdict}\n`,
    );
  }

  const flagged = record.reviews.filter(
    (review) => review.answer_correctness !== "pass" || review.groundedness !== "pass",
  );
  if (flagged.length > 0) {
    out(`\n${flagged.length} case(s) did not pass both criteria:\n`);
    for (const review of flagged) {
      out(
        `  ${review.case_id} — correctness ${review.answer_correctness}, ` +
          `grounded ${review.groundedness}${review.note ? `: ${review.note}` : ""}\n`,
      );
    }
  }

  // A recorded verdict is still a verdict when it is a failing one: the record
  // is written either way, and the exit code reports what it says.
  return Object.values(metrics).every((value) => value.verdict === "pass") ? 0 : 1;
}

/**
 * @returns {Record<string, string>}
 */
function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--report" && flag !== "--out") {
      throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${flag} needs a path\n\n${USAGE}`);
    }
    flags[flag.slice(2)] = value;
    index += 1;
  }
  return flags;
}

function readJson(path, err) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    err(`No file at ${path}.\n`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    err(`${path} is not valid JSON: ${error.message}\n`);
    return undefined;
  }
}

function writeJson(path, value) {
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isStableString(value) {
  return typeof value === "string" && value.trim() !== "";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}
