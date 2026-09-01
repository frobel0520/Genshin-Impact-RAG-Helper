import assert from "node:assert/strict";
import test from "node:test";

import { createQueryServiceForStores } from "../src/api/query-api.js";
import { RUNTIME_DEFAULTS } from "../src/config/runtime-config.js";
import {
  FIXED_EMBEDDING_DIMENSIONS,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { runEvaluation } from "../src/evaluation/evaluation-runner.js";
import {
  REDACTED,
  RUN_LOG_EVENTS,
  RUN_LOG_SCHEMA_VERSION,
  createJsonLineLogger,
  createRunLogger,
  redact,
} from "../src/observability/run-log-adapter.js";

const fixturePack = loadFixtureSourcePack();

function collectingLogger(overrides = {}) {
  const records = [];
  const logger = createRunLogger({
    write: (record) => records.push(record),
    now: () => new Date("2026-08-28T00:00:00Z"),
    ...overrides,
  });
  return { logger, records };
}

function queryPlan() {
  return {
    query_category: "structured",
    normalized_entities: [
      {
        entity_id: "ent:raiden-shogun",
        text: "雷電將軍",
        entity_type: "character",
        resolution_status: "resolved",
        aliases_used: [],
      },
      { text: "不存在的角色", resolution_status: "unrecognized", aliases_used: [] },
    ],
    version_constraint: "current-unspecified",
    retrieval_mode: "structured",
    spoiler_level: "none",
  };
}

test("a query run records the plan it produced, linked by trace", () => {
  const { logger, records } = collectingLogger();

  logger.logQueryRun({
    traceId: "trace:one",
    queryId: "qry:one",
    request: { question: "雷電將軍的元素屬性是什麼？", locale: "zh-TW" },
    queryPlan: queryPlan(),
  });

  assert.deepEqual(records, [
    {
      schema_version: RUN_LOG_SCHEMA_VERSION,
      event: RUN_LOG_EVENTS.QUERY_RUN,
      logged_at: "2026-08-28T00:00:00.000Z",
      trace_id: "trace:one",
      query_id: "qry:one",
      question: "雷電將軍的元素屬性是什麼？",
      locale: "zh-TW",
      requested_game_version: undefined,
      spoiler_level: "none",
      query_category: "structured",
      retrieval_mode: "structured",
      version_constraint: "current-unspecified",
      resolved_entities: ["ent:raiden-shogun"],
      unresolved_mentions: ["不存在的角色"],
    },
  ]);
});

test("evidence is recorded by ID, not copied", () => {
  const { logger, records } = collectingLogger();

  logger.logEvidence({
    traceId: "trace:one",
    queryId: "qry:one",
    bundle: {
      items: [
        { evidence_id: "evd:a", source_id: "src:hoyolab", source_title: "公告內文" },
        { evidence_id: "evd:b", source_id: "src:hoyolab" },
      ],
      conflict_groups: [{ conflict_group_id: "conflict:x", claim_ids: ["claim:a"] }],
    },
    policyDecision: {
      applicable_items: [{ evidence_id: "evd:a" }],
      excluded_items: [{ evidence_id: "evd:b", reason: "lost_conflict" }],
      version_scope: "5.0",
    },
  });

  const [record] = records;
  assert.deepEqual(record.evidence_ids, ["evd:a", "evd:b"]);
  assert.deepEqual(record.source_ids, ["src:hoyolab"]);
  assert.deepEqual(record.conflict_group_ids, ["conflict:x"]);
  assert.deepEqual(record.excluded, [{ evidence_id: "evd:b", reason: "lost_conflict" }]);
  assert.equal(record.applicable_count, 1);
  assert.equal(JSON.stringify(record).includes("公告內文"), false);
});

test("every record for one query shares its trace ID", () => {
  const { logger, records } = collectingLogger();
  const shared = { traceId: "trace:linked", queryId: "qry:linked" };

  logger.logQueryRun({ ...shared, request: { question: "問題" }, queryPlan: queryPlan() });
  logger.logEvidence({ ...shared, bundle: { items: [], conflict_groups: [] } });
  logger.logAnswerRun({
    ...shared,
    answer: {
      answer_status: "refused",
      uncertainty_reason: "out_of_scope",
      answer_text: "拒答。",
      citations: [],
      version_scope: "unknown",
    },
    refusalDecision: { matched_rule: "out_of_scope" },
  });

  assert.deepEqual(
    records.map((record) => [record.event, record.trace_id]),
    [
      [RUN_LOG_EVENTS.QUERY_RUN, "trace:linked"],
      [RUN_LOG_EVENTS.EVIDENCE, "trace:linked"],
      [RUN_LOG_EVENTS.ANSWER_RUN, "trace:linked"],
    ],
  );
  assert.equal(records[2].matched_rule, "out_of_scope");
  assert.equal(records[2].answer_status, "refused");
});

test("a record with nothing to trace it by is refused", () => {
  const { logger } = collectingLogger();

  assert.throws(
    () => logger.logQueryRun({ queryId: "qry:x", request: {}, queryPlan: queryPlan() }),
    /trace_id is required/,
  );
});

test("secret-looking keys are never written, at any depth", () => {
  const redacted = redact({
    ollama_host: "http://127.0.0.1:11434",
    api_key: "sk-live-123",
    authorization: "Bearer abc",
    nested: { session_token: "t", password: "p", safe: "kept" },
    list: [{ cookie: "c" }, "plain"],
  });

  assert.deepEqual(redacted, {
    ollama_host: "http://127.0.0.1:11434",
    api_key: REDACTED,
    authorization: REDACTED,
    nested: { session_token: REDACTED, password: REDACTED, safe: "kept" },
    list: [{ cookie: REDACTED }, "plain"],
  });
});

test("long text is clipped so one record cannot swallow the log", () => {
  const { logger, records } = collectingLogger({ maxTextLength: 10 });

  logger.logQueryRun({
    traceId: "trace:long",
    queryId: "qry:long",
    request: { question: "問".repeat(50) },
    queryPlan: queryPlan(),
  });

  assert.equal(records[0].question.length, 11);
  assert.ok(records[0].question.endsWith("…"));
});

test("the JSON line logger writes one redacted object per line", () => {
  const lines = [];
  const logger = createJsonLineLogger({
    write: (line) => lines.push(line),
    now: () => new Date("2026-08-28T00:00:00Z"),
  });

  logger.logAnswerRun({
    traceId: "trace:json",
    queryId: "qry:json",
    answer: {
      answer_status: "answered",
      answer_text: "回答。",
      citations: [{ source_url: "https://example.test/a" }],
      version_scope: "5.0",
    },
    refusalDecision: { matched_rule: null, api_key: "sk-live" },
  });

  assert.equal(lines.length, 1);
  assert.ok(lines[0].endsWith("\n"));
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, RUN_LOG_EVENTS.ANSWER_RUN);
  assert.deepEqual(record.citation_urls, ["https://example.test/a"]);
  assert.equal(lines[0].includes("sk-live"), false);
});

test("a failing write is counted, not thrown at the caller", () => {
  const logger = createRunLogger({
    write: () => {
      throw new Error("disk full");
    },
  });

  assert.doesNotThrow(() =>
    logger.logQueryRun({
      traceId: "trace:fail",
      queryId: "qry:fail",
      request: { question: "問題" },
      queryPlan: queryPlan(),
    }),
  );
  assert.equal(logger.getFailureCount(), 1);
});

test("logger options are validated", () => {
  assert.throws(() => createRunLogger({}), /write must be a function/);
  assert.throws(() => createRunLogger({ write: () => {}, extra: true }), /Unknown run logger/);
  assert.throws(() => createRunLogger({ write: () => {}, maxTextLength: 0 }), /maxTextLength/);
  assert.throws(() => createJsonLineLogger({}), /write must be a function/);
});

test("an eval result is traced by the answer it scored", async () => {
  const { logger, records } = collectingLogger();

  await runEvaluation({
    cases: [
      {
        case_id: "case:log",
        question_zh_tw: "請直接替我決定最強配隊。",
        category: "out_of_scope",
        query_type: "out_of_scope",
        answerability: "refuse",
        required_facts: [],
        refusal_reason: "out_of_scope",
        game_version: "unknown",
        spoiler_level: "none",
      },
    ],
    runId: "run:log-eval",
    logger,
    answer: async () => ({
      answer_status: "refused",
      answer_text: "拒答。",
      query_category: "out_of_scope",
      citations: [],
      version_scope: "unknown",
      uncertainty_reason: "out_of_scope",
      trace_id: "trace:eval-case",
    }),
  });

  assert.equal(records.length, 1);
  assert.equal(records[0].event, RUN_LOG_EVENTS.EVAL_RESULT);
  assert.equal(records[0].trace_id, "trace:eval-case");
  assert.equal(records[0].run_id, "run:log-eval");
  assert.equal(records[0].case_id, "case:log");
  assert.equal(records[0].metric_labels.correct_refusal, "pass");
  assert.equal(records[0].human_review_status, "pending");
});

test("a real query writes all three records under one trace", async (context) => {
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

  const { logger, records } = collectingLogger();
  const service = createQueryServiceForStores({
    config: RUNTIME_DEFAULTS,
    structuredStore,
    documentStore,
    logger,
  });

  const response = await service.answer({ question: "雷電將軍的元素屬性是什麼？" });

  // A `failure` record may sit between the evidence and the answer: with no
  // generation model reachable under the offline guard, the answer falls back
  // to the template and says so. That is a logged fallback, not a failed query,
  // so the three records this test is about must still be there and in order.
  assert.deepEqual(
    records
      .map((record) => record.event)
      .filter((event) => event !== RUN_LOG_EVENTS.FAILURE),
    [RUN_LOG_EVENTS.QUERY_RUN, RUN_LOG_EVENTS.EVIDENCE, RUN_LOG_EVENTS.ANSWER_RUN],
  );
  for (const record of records) {
    assert.equal(record.trace_id, response.trace_id);
  }
  const evidenceRecord = records.find((record) => record.event === RUN_LOG_EVENTS.EVIDENCE);
  const answerRecord = records.find((record) => record.event === RUN_LOG_EVENTS.ANSWER_RUN);
  assert.equal(answerRecord.answer_status, "answered");
  assert.ok(evidenceRecord.evidence_ids.length > 0);
  assert.equal(answerRecord.citation_count, response.citations.length);
});

test("filtered retrieval is recorded under its own event and is not a failure", () => {
  const { logger, records } = collectingLogger();

  const record = logger.logRetrievalFiltered({
    traceId: "3e85e747-105b-45a2-812f-b889a533bd37",
    queryId: "qry:3e85e747-105b-45a2-812f-b889a533bd37",
    considered: 13,
    kept: 0,
    bestScore: 0.21,
    minScore: 0.35,
  });

  assert.equal(record.event, RUN_LOG_EVENTS.RETRIEVAL_FILTERED);
  assert.equal(record.trace_id, "3e85e747-105b-45a2-812f-b889a533bd37");
  assert.equal(record.considered, 13);
  assert.equal(record.kept, 0);
  assert.equal(record.best_score, 0.21);
  assert.equal(record.min_score, 0.35);
  assert.equal(records.length, 1);

  // Dropping irrelevant evidence is what a correct refusal looks like from the
  // inside. Counting it as a failure would make a working system look broken.
  assert.equal(logger.getFailureCount(), 0);
});

test("a filtered-retrieval record still needs a trace to be findable", () => {
  const { logger } = collectingLogger();

  assert.throws(
    () => logger.logRetrievalFiltered({ queryId: "qry:no-trace", considered: 3, kept: 0 }),
    /trace/i,
  );
});
