import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { createQueryServiceForStores } from "../src/api/query-api.js";
import { RUNTIME_DEFAULTS } from "../src/config/runtime-config.js";
import {
  FIXED_EMBEDDING_DIMENSIONS,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { assertRunResponse } from "../src/domain/run-response-contract.js";
import { assertEvalResult } from "../src/evaluation/evaluation-contract.js";
import {
  HUMAN_JUDGED_METRICS,
  SCORED_METRICS,
  meetsAllTargets,
  runEvaluation,
} from "../src/evaluation/evaluation-runner.js";

const evaluationFixture = JSON.parse(readFileSync("fixtures/evaluation-contract.json", "utf8"));
const fixturePack = loadFixtureSourcePack();

function answerable(overrides = {}) {
  return {
    case_id: "case:eval-answerable",
    question_zh_tw: "雷電將軍的元素屬性是什麼？",
    category: "character",
    query_type: "structured",
    answerability: "answerable",
    expected_answer: "雷電將軍是雷元素角色。",
    required_facts: [{ key: "element", expected_value: "Electro" }],
    expected_sources: [{ source_kind: "genshin-db", source_url: "https://example.test/db" }],
    game_version: "5.0",
    spoiler_level: "none",
    ...overrides,
  };
}

function refusalCase(overrides = {}) {
  return {
    case_id: "case:eval-refusal",
    question_zh_tw: "請直接替我決定最強配隊。",
    category: "out_of_scope",
    query_type: "out_of_scope",
    answerability: "refuse",
    required_facts: [],
    refusal_reason: "out_of_scope",
    game_version: "unknown",
    spoiler_level: "none",
    ...overrides,
  };
}

function answerResponse(overrides = {}) {
  return {
    answer_status: "answered",
    answer_text: "測試回答。",
    query_category: "structured",
    citations: [
      {
        source_url: "https://example.test/db",
        title: "genshin-db",
        source_kind: "genshin-db",
        game_version: "5.0",
      },
    ],
    version_scope: "5.0",
    trace_id: "trace:eval",
    ...overrides,
  };
}

function refusal(reason = "out_of_scope") {
  return {
    answer_status: "refused",
    answer_text: "拒答。",
    query_category: "out_of_scope",
    citations: [],
    version_scope: "unknown",
    uncertainty_reason: reason,
    trace_id: "trace:eval",
  };
}

test("every fixture EvalCase runs and produces a contract-valid EvalResult", async () => {
  const asked = [];
  const { run, results } = await runEvaluation({
    cases: evaluationFixture.cases,
    runId: "run:eval-fixture",
    answer: async (request) => {
      asked.push(request);
      return refusal();
    },
  });

  assert.equal(assertRunResponse(run), run);
  assert.equal(run.status, "passed");
  assert.equal(results.length, evaluationFixture.cases.length);
  assert.equal(asked.length, evaluationFixture.cases.length);
  for (const result of results) {
    assert.equal(assertEvalResult(result), result);
    assert.equal(result.run_id, "run:eval-fixture");
    assert.equal(result.human_review.status, "pending");
  }
});

test("the case's version and spoiler level reach the query request", async () => {
  const asked = [];
  await runEvaluation({
    cases: [answerable(), refusalCase({ spoiler_level: "notice" })],
    runId: "run:eval-request",
    answer: async (request) => {
      asked.push(request);
      return request.game_version === undefined ? refusal() : answerResponse();
    },
  });

  assert.deepEqual(asked[0], {
    question: "雷電將軍的元素屬性是什麼？",
    spoiler_level: "none",
    game_version: "5.0",
  });
  // An unknown version is never passed down as if it were a real one.
  assert.deepEqual(asked[1], {
    question: "請直接替我決定最強配隊。",
    spoiler_level: "notice",
  });
});

test("a refusal for the wrong reason does not count as a correct refusal", async () => {
  const { results } = await runEvaluation({
    cases: [refusalCase(), refusalCase({ case_id: "case:eval-refusal-b" })],
    runId: "run:eval-refusal",
    answer: async (request) =>
      request.question.includes("配隊") ? refusal("out_of_scope") : refusal("insufficient_evidence"),
  });

  assert.equal(results[0].metric_labels.correct_refusal, "pass");
  assert.equal(results[0].metric_labels.citation_coverage, "not_applicable");

  const { results: wrongReason } = await runEvaluation({
    cases: [refusalCase()],
    runId: "run:eval-wrong-reason",
    answer: async () => refusal("insufficient_evidence"),
  });
  assert.equal(wrongReason[0].metric_labels.correct_refusal, "fail");
});

test("an answerable case that gets refused fails its citation coverage", async () => {
  const { results } = await runEvaluation({
    cases: [answerable()],
    runId: "run:eval-answerable",
    answer: async () => answerResponse({ citations: [] , answer_status: "uncertain", uncertainty_reason: "version_unknown" }),
  });

  assert.equal(results[0].metric_labels.citation_coverage, "fail");
  assert.equal(results[0].metric_labels.correct_refusal, "not_applicable");
});

test("recall is scored against the expected source URLs in the top five citations", async () => {
  const otherCitations = Array.from({ length: 5 }, (_, index) => ({
    source_url: `https://example.test/other-${index}`,
    title: "Other",
    source_kind: "fandom",
  }));

  const { results: hit } = await runEvaluation({
    cases: [answerable()],
    runId: "run:eval-recall-hit",
    answer: async () => answerResponse(),
  });
  const { results: pushedOut } = await runEvaluation({
    cases: [answerable()],
    runId: "run:eval-recall-miss",
    answer: async () =>
      answerResponse({ citations: [...otherCitations, ...answerResponse().citations] }),
  });
  // A refusal case declares no expected sources, so there is nothing to recall.
  const { results: noExpectation } = await runEvaluation({
    cases: [refusalCase()],
    runId: "run:eval-recall-na",
    answer: async () => refusal(),
  });

  assert.equal(hit[0].metric_labels.retrieval_recall_at_5, "pass");
  assert.equal(pushedOut[0].metric_labels.retrieval_recall_at_5, "fail");
  assert.equal(noExpectation[0].metric_labels.retrieval_recall_at_5, "not_applicable");
});

test("prose judgements are left unscored rather than guessed", async () => {
  const { results, metrics } = await runEvaluation({
    cases: [answerable()],
    runId: "run:eval-not-scored",
    answer: async () => answerResponse(),
  });

  for (const metric of HUMAN_JUDGED_METRICS) {
    assert.equal(results[0].metric_labels[metric], "not_scored");
    assert.equal(metrics[metric].score, null);
    assert.equal(metrics[metric].meets_target, null);
  }
  for (const metric of SCORED_METRICS) {
    assert.notEqual(metrics[metric].score, undefined);
  }
  assert.equal(metrics.cases.pending_human_review, 1);
});

test("the metric summary reports scores against their targets", async () => {
  const cases = [
    answerable(),
    answerable({ case_id: "case:eval-b" }),
    refusalCase(),
  ];

  const { metrics } = await runEvaluation({
    cases,
    runId: "run:eval-summary",
    answer: async (request) =>
      request.question.includes("配隊") ? refusal() : answerResponse(),
  });

  assert.equal(metrics.citation_coverage.passed, 2);
  assert.equal(metrics.citation_coverage.not_applicable, 1);
  assert.equal(metrics.citation_coverage.score, 1);
  assert.equal(metrics.citation_coverage.meets_target, true);
  assert.equal(metrics.correct_refusal.score, 1);
  assert.equal(metrics.cases.declared, 3);
  assert.equal(meetsAllTargets(metrics), true);
});

test("a missed target is a finding, not a failed run", async () => {
  const uncertainWithoutCitations = {
    ...answerResponse(),
    answer_status: "uncertain",
    uncertainty_reason: "version_unknown",
    citations: [],
  };
  const { run, metrics } = await runEvaluation({
    cases: [answerable(), answerable({ case_id: "case:eval-b" })],
    runId: "run:eval-missed-target",
    answer: async () => uncertainWithoutCitations,
  });

  assert.equal(run.status, "passed");
  assert.deepEqual(run.errors, []);
  assert.equal(metrics.citation_coverage.score, 0);
  assert.equal(metrics.citation_coverage.meets_target, false);
  assert.equal(meetsAllTargets(metrics), false);
});

test("a failing case is reported with its case ID and leaves the rest scored", async () => {
  const { run, results } = await runEvaluation({
    cases: [answerable(), refusalCase()],
    runId: "run:eval-failure",
    answer: async (request) => {
      if (request.question.includes("配隊")) {
        const error = new Error("connect ECONNREFUSED 127.0.0.1:11434");
        error.code = "ECONNREFUSED";
        throw error;
      }
      return answerResponse();
    },
  });

  assert.equal(run.status, "partial");
  assert.equal(run.errors[0].code, "dependency_unavailable");
  assert.equal(run.errors[0].case_id, "case:eval-refusal");
  assert.equal(results.length, 1);
});

test("a report path is recorded as a run artifact with a content hash", async () => {
  const { run } = await runEvaluation({
    cases: [answerable()],
    runId: "run:eval-report",
    reportPath: "artifacts/eval-report.json",
    answer: async () => answerResponse(),
  });

  assert.deepEqual(
    run.artifacts.map((artifact) => [artifact.kind, artifact.path]),
    [["report", "artifacts/eval-report.json"]],
  );
  assert.match(run.artifacts[0].content_hash, /^[a-f0-9]{64}$/);
});

test("evaluation requests are validated before any case runs", async () => {
  await assert.rejects(() => runEvaluation({ cases: [], answer: async () => ({}) }), /cases/);
  await assert.rejects(() => runEvaluation({ cases: [answerable()] }), /answer must be/);
  await assert.rejects(
    () => runEvaluation({ cases: [answerable()], answer: async () => ({}), extra: true }),
    /Unknown evaluation run request field/,
  );
});

test("the fixture dataset is evaluated through the real query service", async (context) => {
  const structuredStore = createStructuredStore();
  const documentStore = createDocumentStore();
  context.after(() => {
    if (structuredStore.getStatus().isOpen) structuredStore.close();
    if (documentStore.getStatus().isOpen) documentStore.close();
  });
  structuredStore.replaceData(
    structuredClone({
      source_documents: fixturePack.source_documents,
      canonical_entities: fixturePack.canonical_entities,
      structured_facts: fixturePack.structured_facts,
      claims: fixturePack.claims,
      conflict_groups: fixturePack.conflict_groups,
    }),
  );
  await buildFixedIndex({
    store: documentStore,
    data: structuredClone({
      source_documents: fixturePack.source_documents,
      canonical_entities: fixturePack.canonical_entities,
      document_chunks: fixturePack.document_chunks,
    }),
    embedDocuments: (texts) =>
      texts.map((text) => {
        const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
        for (const character of text) {
          vector[character.codePointAt(0) % FIXED_EMBEDDING_DIMENSIONS] += 1;
        }
        vector[0] += 1;
        return vector;
      }),
  });

  const service = createQueryServiceForStores({
    config: { ...RUNTIME_DEFAULTS, ollamaHost: RUNTIME_DEFAULTS.ollamaHost },
    structuredStore,
    documentStore,
  });

  // Only structured cases are exercised here: a narrative case would reach the
  // embedder, and Ollama is not running in tests.
  const { run, results, metrics } = await runEvaluation({
    cases: [
      answerable({
        expected_sources: [
          {
            source_kind: "genshin-db",
            source_url: fixturePack.source_documents.find(
              (source) => source.source_kind === "genshin-db",
            ).source_url,
          },
        ],
      }),
      refusalCase(),
    ],
    runId: "run:eval-live",
    answer: service.answer,
  });

  assert.equal(run.status, "passed");
  assert.equal(results[0].answer.answer_status, "answered");
  assert.equal(results[1].answer.answer_status, "refused");
  assert.equal(metrics.correct_refusal.score, 1);
  assert.equal(metrics.citation_coverage.score, 1);
  assert.equal(metrics.retrieval_recall_at_5.score, 1);
});
