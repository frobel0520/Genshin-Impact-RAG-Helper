import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ANSWERABILITY,
  QUERY_CATEGORIES,
  SPOILER_LEVELS,
} from "../src/domain/domain-contract.js";
import {
  EVAL_CASE_FIELDS,
  EVAL_CASE_OPTIONAL_FIELDS,
  EVAL_CASE_REQUIRED_FIELDS,
  EVAL_CATEGORIES,
  EVAL_METRIC_DEFINITIONS,
  EVAL_METRIC_KEYS,
  EVAL_METRIC_LABEL_VALUES,
  EVAL_RESULT_FIELDS,
  EVAL_RESULT_OPTIONAL_FIELDS,
  EVAL_RESULT_REQUIRED_FIELDS,
  EVALUATION_CONTRACT_SCHEMA,
  EVALUATION_CONTRACT_SCHEMA_VERSION,
  EVALUATION_VALIDATION_CODES,
  HUMAN_REVIEW_DECISIONS,
  HUMAN_REVIEW_FIELDS,
  HUMAN_REVIEW_OPTIONAL_FIELDS,
  HUMAN_REVIEW_REQUIRED_FIELDS,
  HUMAN_REVIEW_STATUSES,
  assertEvalCase,
  assertEvalResult,
  isEvalCase,
  isEvalResult,
  validateEvalCase,
  validateEvalResult,
  validateExpectedSource,
  validateHumanReview,
  validateMetricLabels,
} from "../src/evaluation/evaluation-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/evaluation-contract.json"), "utf8"),
);

test("EvalCase and EvalResult fixtures validate while preserving a 50-case target template", () => {
  assert.equal(fixture.schema_version, EVALUATION_CONTRACT_SCHEMA_VERSION);
  assert.equal(fixture.dataset_version, "eval-template-v1");
  assert.deepEqual(fixture.target_counts, { total: 50, answerable: 40, refuse: 10 });
  assert.equal(fixture.cases.length, 8);
  assert.equal(fixture.results.length, 4);

  for (const evalCase of fixture.cases) {
    assert.deepEqual(validateEvalCase(evalCase), { ok: true, value: evalCase });
    assert.equal(isEvalCase(evalCase), true);
  }
  for (const result of fixture.results) {
    assert.deepEqual(validateEvalResult(result), { ok: true, value: result });
    assert.equal(isEvalResult(result), true);
  }

  assert.deepEqual(
    new Set(fixture.cases.map(({ query_type: queryType }) => queryType)),
    new Set(Object.values(QUERY_CATEGORIES)),
  );
  assert.deepEqual(
    new Set(fixture.cases.map(({ answerability }) => answerability)),
    new Set(Object.values(ANSWERABILITY)),
  );
});

test("evaluation schema documents case/result fields, human review, and release metrics", () => {
  assert.deepEqual(EVALUATION_CONTRACT_SCHEMA.evalCase.required, EVAL_CASE_REQUIRED_FIELDS);
  assert.deepEqual(EVALUATION_CONTRACT_SCHEMA.evalCase.optional, EVAL_CASE_OPTIONAL_FIELDS);
  assert.deepEqual(EVAL_CASE_FIELDS, [
    ...EVAL_CASE_REQUIRED_FIELDS,
    ...EVAL_CASE_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(EVALUATION_CONTRACT_SCHEMA.evalResult.required, EVAL_RESULT_REQUIRED_FIELDS);
  assert.deepEqual(EVALUATION_CONTRACT_SCHEMA.evalResult.optional, EVAL_RESULT_OPTIONAL_FIELDS);
  assert.deepEqual(EVAL_RESULT_FIELDS, [
    ...EVAL_RESULT_REQUIRED_FIELDS,
    ...EVAL_RESULT_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(EVALUATION_CONTRACT_SCHEMA.evalResult.metricLabels, EVAL_METRIC_KEYS);
  assert.deepEqual(EVALUATION_CONTRACT_SCHEMA.metrics, EVAL_METRIC_DEFINITIONS);
  assert.deepEqual(fixture.metric_definitions, EVAL_METRIC_DEFINITIONS);
  assert.deepEqual(EVALUATION_CONTRACT_SCHEMA.metricLabels, EVAL_METRIC_LABEL_VALUES);
  assert.deepEqual(HUMAN_REVIEW_REQUIRED_FIELDS, ["status"]);
  assert.deepEqual(HUMAN_REVIEW_FIELDS, [
    ...HUMAN_REVIEW_REQUIRED_FIELDS,
    ...HUMAN_REVIEW_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(Object.values(EVAL_CATEGORIES), [
    "character",
    "weapon",
    "material",
    "quest",
    "region",
    "world_lore",
    "version",
    "composite",
    "out_of_scope",
  ]);
  assert.deepEqual(Object.values(SPOILER_LEVELS), ["none", "notice", "explicit"]);
});

test("EvalCase applies answerable/refusal conditional fields without guessing answer content", () => {
  const answerable = {
    case_id: "case:missing-expected-answer",
    question_zh_tw: "這是一題可回答問題。",
    category: "character",
    query_type: "structured",
    answerability: "answerable",
    required_facts: [],
    game_version: "5.0",
    spoiler_level: "none",
  };
  const answerableResult = validateEvalCase(answerable);
  assert.equal(answerableResult.ok, false);
  assert.deepEqual(
    answerableResult.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVALUATION_VALIDATION_CODES.INVALID_REQUIRED_FACTS, path: "required_facts" },
      { code: EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD, path: "expected_answer" },
      { code: EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD, path: "expected_sources" },
    ],
  );

  const refusal = {
    case_id: "case:missing-refusal-reason",
    question_zh_tw: "這是一題應拒答問題。",
    category: "out_of_scope",
    query_type: "out_of_scope",
    answerability: "refuse",
    required_facts: [],
    game_version: "unknown",
    spoiler_level: "none",
  };
  const refusalResult = validateEvalCase(refusal);
  assert.equal(refusalResult.ok, false);
  assert.deepEqual(refusalResult.errors, [
    {
      code: EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD,
      path: "refusal_reason",
      message: "refuse EvalCase must include refusal_reason.",
    },
  ]);
});

test("EvalCase validates IDs, categories, query types, versions, spoiler levels, and unknown fields", () => {
  const invalid = {
    ...fixture.cases[0],
    case_id: "qry:not-a-case",
    category: "unknown",
    query_type: "guessing",
    answerability: "maybe",
    required_facts: [undefined],
    expected_answer: null,
    expected_sources: [{ source_kind: "unknown", source_url: "file:///tmp/source" }],
    refusal_reason: "conflict",
    game_version: " 5.0",
    spoiler_level: "all",
    notes: "",
    extra: true,
  };
  const result = validateEvalCase(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVALUATION_VALIDATION_CODES.UNKNOWN_FIELD, path: "extra" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_CASE_ID, path: "case_id" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_CATEGORY, path: "category" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_QUERY_TYPE, path: "query_type" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_ANSWERABILITY, path: "answerability" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_REQUIRED_FACT, path: "required_facts[0]" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_EXPECTED_ANSWER, path: "expected_answer" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_SOURCE_KIND, path: "expected_sources[0].source_kind" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_SOURCE_URL, path: "expected_sources[0].source_url" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_REFUSAL_REASON, path: "refusal_reason" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_GAME_VERSION, path: "game_version" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_SPOILER_LEVEL, path: "spoiler_level" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_NOTES, path: "notes" },
    ],
  );
});

test("expected source references accept stable strings or typed source objects", () => {
  assert.deepEqual(validateExpectedSource("hoyolab"), []);
  assert.deepEqual(
    validateExpectedSource({ source_kind: "hoyolab" }),
    [],
  );
  assert.deepEqual(
    validateExpectedSource({ source_url: "https://www.hoyolab.com/" }),
    [],
  );

  const invalid = validateExpectedSource({ extra: true });
  assert.deepEqual(
    invalid.map(({ code, path }) => ({ code, path })),
    [
      { code: EVALUATION_VALIDATION_CODES.UNKNOWN_FIELD, path: "extra" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_EXPECTED_SOURCE, path: "$" },
    ],
  );
});

test("EvalResult accepts evidence IDs or complete EvidenceItems and delegates AnswerResponse/Citation rules", () => {
  const result = fixture.results[1];
  assert.equal(result.retrieved_evidence[0].evidence_id, "evd:ayaka-story-chunk");
  assert.equal(result.answer.answer_status, "uncertain");
  assert.deepEqual(validateEvalResult(result), { ok: true, value: result });

  const invalid = structuredClone(fixture.results[0]);
  invalid.retrieved_evidence = ["evd:duplicate", "evd:duplicate"];
  invalid.answer.answer_status = "answered";
  invalid.answer.citations = [];
  invalid.citations = [];
  const validation = validateEvalResult(invalid);
  assert.equal(validation.ok, false);
  assert.deepEqual(
    validation.errors.map(({ code, path }) => ({ code, path })),
    [
      {
        code: EVALUATION_VALIDATION_CODES.DUPLICATE_EVIDENCE_REFERENCE,
        path: "retrieved_evidence[1]",
      },
      { code: "answered_requires_citation", path: "answer.citations" },
      { code: EVALUATION_VALIDATION_CODES.ANSWERED_REQUIRES_CITATION, path: "citations" },
    ],
  );
});

test("metric labels require every fixed release metric and reject unknown labels", () => {
  const labels = { ...fixture.results[0].metric_labels };
  assert.deepEqual(validateMetricLabels(labels), []);

  delete labels.groundedness;
  labels.extra_metric = "pass";
  labels.answer_correctness = "maybe";
  const errors = validateMetricLabels(labels);
  assert.deepEqual(
    errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVALUATION_VALIDATION_CODES.UNKNOWN_METRIC_LABEL, path: "metric_labels.extra_metric" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_METRIC_LABEL, path: "metric_labels.answer_correctness" },
      { code: EVALUATION_VALIDATION_CODES.MISSING_METRIC_LABEL, path: "metric_labels.groundedness" },
    ],
  );
});

test("human review keeps identity out of the contract and requires a decision only when reviewed", () => {
  assert.deepEqual(validateHumanReview({ status: HUMAN_REVIEW_STATUSES.PENDING }), []);
  assert.deepEqual(
    validateHumanReview({
      status: HUMAN_REVIEW_STATUSES.REVIEWED,
      decision: HUMAN_REVIEW_DECISIONS.ACCEPT,
      reviewed_at: "2026-08-21T01:00:00Z",
    }),
    [],
  );

  const missingDecision = validateHumanReview({ status: HUMAN_REVIEW_STATUSES.REVIEWED });
  assert.deepEqual(missingDecision, [
    {
      code: EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD,
      path: "decision",
      message: "reviewed human_review must include decision.",
    },
  ]);

  const invalid = validateHumanReview({
    status: "unknown",
    decision: "maybe",
    reviewed_at: "not-a-date",
    reviewer: "not allowed",
  });
  assert.deepEqual(
    invalid.map(({ code, path }) => ({ code, path })),
    [
      { code: EVALUATION_VALIDATION_CODES.UNKNOWN_FIELD, path: "reviewer" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_REVIEW_STATUS, path: "status" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_REVIEW_DECISION, path: "decision" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_REVIEWED_AT, path: "reviewed_at" },
    ],
  );
});

test("EvalResult rejects malformed IDs, evidence, metrics, and human review", () => {
  const invalid = {
    ...fixture.results[2],
    case_id: "qry:not-a-case",
    run_id: "case:not-a-run",
    retrieved_evidence: ["src:not-evidence"],
    answer: { ...fixture.results[2].answer, query_category: "guessing" },
    citations: "not-an-array",
    metric_labels: {},
    human_review: { status: "reviewed" },
  };
  const result = validateEvalResult(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVALUATION_VALIDATION_CODES.INVALID_CASE_ID, path: "case_id" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_RUN_ID, path: "run_id" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_EVIDENCE_REFERENCE, path: "retrieved_evidence[0]" },
      { code: "invalid_query_category", path: "answer.query_category" },
      { code: EVALUATION_VALIDATION_CODES.INVALID_CITATIONS, path: "citations" },
      ...EVAL_METRIC_KEYS.map((key) => ({
        code: EVALUATION_VALIDATION_CODES.MISSING_METRIC_LABEL,
        path: `metric_labels.${key}`,
      })),
      { code: EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD, path: "decision" },
    ],
  );
});

test("evaluation assertion helpers preserve identity and do not mutate inputs", () => {
  const evalCase = structuredClone(fixture.cases[0]);
  const result = structuredClone(fixture.results[0]);
  const before = { evalCase: structuredClone(evalCase), result: structuredClone(result) };

  assert.equal(assertEvalCase(evalCase), evalCase);
  assert.equal(assertEvalResult(result), result);
  assert.deepEqual({ evalCase, result }, before);
  assert.throws(() => assertEvalCase({ case_id: "case:missing" }), /question_zh_tw/);
  assert.throws(() => assertEvalResult({ ...result, run_id: "bad" }), /run_id/);
});
