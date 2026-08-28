import assert from "node:assert/strict";
import test from "node:test";

import {
  QUERY_API_MAX_BODY_BYTES,
  QUERY_API_ROUTE,
  createQueryRoute,
  createQueryService,
} from "../src/api/query-api.js";
import {
  FIXED_EMBEDDING_DIMENSIONS,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { assertAnswerResponse } from "../src/policy/evidence-answer-contract.js";
import { createDocumentRetriever } from "../src/query/document-retrieval.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
import { createQueryOrchestrator } from "../src/query/query-orchestrator.js";
import { createStructuredRetriever } from "../src/query/structured-retrieval.js";
import { createRunLogger } from "../src/observability/run-log-adapter.js";
import { createApplication } from "../src/server.js";

const LOOPBACK_HOST = "127.0.0.1";
const fixturePack = loadFixtureSourcePack();
const scenarios = fixturePack.test_scenarios;

/** Deterministic offline embedder, matching the acceptance-scenario harness. */
function embedText(text) {
  const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
  for (const character of text) {
    vector[character.codePointAt(0) % FIXED_EMBEDDING_DIMENSIONS] += 1;
  }
  vector[0] += 1;
  return vector;
}

async function createService(context, { generateTraceId } = {}) {
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
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
  });

  return createQueryService({
    orchestrator: createQueryOrchestrator({
      classifier: createQueryClassifier({ canonicalEntities: fixturePack.canonical_entities }),
      structuredRetriever: createStructuredRetriever({ store: structuredStore }),
      documentRetriever: createDocumentRetriever({
        store: documentStore,
        embedQuery: embedText,
      }),
    }),
    ...(generateTraceId === undefined ? {} : { generateTraceId }),
  });
}

async function startQueryServer(context, service) {
  const { config, server } = createApplication(
    { PORT: "0" },
    { queryHandler: createQueryRoute({ service }) },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, LOOPBACK_HOST, resolve);
  });
  context.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return `http://${LOOPBACK_HOST}:${server.address().port}${QUERY_API_ROUTE}`;
}

function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("an answerable question returns 200 with a cited AnswerResponse", async (context) => {
  const url = await startQueryServer(context, await createService(context));

  const response = await postJson(url, { question: scenarios.answerable_character_query.question });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(assertAnswerResponse(payload), payload);
  assert.equal(payload.answer_status, "answered");
  assert.ok(payload.citations.length > 0);
  assert.ok(payload.trace_id.length > 0);
});

test("a refusal is a successful response, not a transport failure", async (context) => {
  const url = await startQueryServer(context, await createService(context));

  const response = await postJson(url, { question: scenarios.out_of_scope_query.question });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.answer_status, "refused");
  assert.equal(payload.uncertainty_reason, "out_of_scope");
  assert.deepEqual(payload.citations, []);
});

test("the response never exposes internal evidence or source IDs", async (context) => {
  const url = await startQueryServer(context, await createService(context));

  const response = await postJson(url, { question: scenarios.answerable_weapon_query.question });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(body.includes("evidence_id"), false);
  assert.equal(body.includes("source_id"), false);
  assert.equal(body.includes("fact_id"), false);
  for (const citation of JSON.parse(body).citations) {
    assert.deepEqual(Object.keys(citation).includes("source_id"), false);
  }
});

test("an explicit game_version reaches the version filter through the API", async (context) => {
  const url = await startQueryServer(context, await createService(context));

  const response = await postJson(url, {
    question: scenarios.answerable_character_query.question,
    game_version: "5.0",
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.version_scope, "5.0");
  for (const citation of payload.citations) {
    assert.equal(citation.game_version, "5.0");
  }
});

test("the trace_id is stable per request and reusable for lookup", async (context) => {
  let counter = 0;
  const service = await createService(context, {
    generateTraceId: () => `trace-${(counter += 1)}`,
  });
  const url = await startQueryServer(context, service);

  const first = await (await postJson(url, { question: "雷電將軍的元素屬性是什麼？" })).json();
  const second = await (await postJson(url, { question: "雷電將軍的元素屬性是什麼？" })).json();

  assert.equal(first.trace_id, "trace-1");
  assert.equal(second.trace_id, "trace-2");
  assert.deepEqual({ ...first, trace_id: null }, { ...second, trace_id: null });
});

test("a contract-invalid request is rejected with field-level codes", async (context) => {
  const url = await startQueryServer(context, await createService(context));

  const response = await postJson(url, { question: "   ", locale: "zh-TW" });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, "invalid_request");
  assert.ok(payload.error.details.some((detail) => detail.field === "question"));
  // A malformed request is not a broken helper, so it is not an error status.
  assert.equal(payload.answer_status, undefined);
  assert.ok(payload.trace_id.length > 0);
});

test("malformed JSON, wrong media type, and wrong method are refused separately", async (context) => {
  const url = await startQueryServer(context, await createService(context));

  const malformed = await postJson(url, "{not json");
  const wrongMedia = await postJson(url, { question: "測試" }, { "content-type": "text/plain" });
  const wrongMethod = await fetch(url, { method: "GET" });

  assert.equal(malformed.status, 400);
  assert.equal(wrongMedia.status, 415);
  assert.equal(wrongMethod.status, 405);
  for (const response of [malformed, wrongMedia, wrongMethod]) {
    const payload = await response.json();
    assert.equal(payload.error.code, "invalid_request");
    assert.equal(payload.answer_status, undefined);
    assert.ok(payload.trace_id.length > 0);
  }
});

test("an oversized body is refused before it is parsed", async (context) => {
  const url = await startQueryServer(context, await createService(context));

  const response = await postJson(url, {
    question: "雷".repeat(QUERY_API_MAX_BODY_BYTES),
  });

  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "invalid_request");
});

test("an internal failure becomes a classified error without leaking its message", async (context) => {
  const failing = {
    answer() {
      throw new Error("bge-m3 embedding socket blew up at line 42");
    },
  };
  const url = await startQueryServer(context, failing);

  const response = await postJson(url, { question: "雷電將軍的元素屬性是什麼？" });
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(body.includes("bge-m3"), false);
  const payload = JSON.parse(body);
  // A system failure keeps the error status, and stays traceable.
  assert.equal(payload.answer_status, "error");
  assert.equal(payload.error.code, "internal_error");
  assert.ok(payload.trace_id.length > 0);
});

test("an unavailable dependency is classified by its error code", async (context) => {
  const failing = {
    answer() {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:11434");
      error.code = "ECONNREFUSED";
      throw error;
    },
  };
  const url = await startQueryServer(context, failing);

  const response = await postJson(url, { question: "雷電將軍的元素屬性是什麼？" });

  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.code, "dependency_unavailable");
});

test("a failure is logged and answers with the trace it failed under", async (context) => {
  const records = [];
  const failing = {
    answer() {
      const error = new Error("bge-m3 socket blew up");
      error.traceId = "trace:failed-run";
      throw error;
    },
  };
  const { config, server } = createApplication(
    { PORT: "0" },
    {
      queryHandler: createQueryRoute({
        service: failing,
        logger: createRunLogger({ write: (record) => records.push(record) }),
      }),
    },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, LOOPBACK_HOST, resolve);
  });
  context.after(
    () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const url = `http://${LOOPBACK_HOST}:${server.address().port}${QUERY_API_ROUTE}`;

  const failure = await postJson(url, { question: "雷電將軍的元素屬性是什麼？" });
  const rejected = await postJson(url, { question: "   " });
  const failurePayload = await failure.json();
  const rejectedPayload = await rejected.json();

  // The answer that never came back is still findable: the response carries the
  // same trace the log record was written under.
  assert.equal(failurePayload.trace_id, "trace:failed-run");
  assert.deepEqual(
    records.map((record) => [record.event, record.trace_id]),
    [
      ["failure", "trace:failed-run"],
      ["request_rejected", rejectedPayload.trace_id],
    ],
  );
  // The internal message is kept in the log and never sent to the player.
  assert.equal(records[0].message, "bge-m3 socket blew up");
  assert.equal(failurePayload.error.message.includes("socket"), false);
  assert.equal(records[1].status_code, 400);
});

test("the query route is not mounted when no handler is injected", async (context) => {
  const { config, server } = createApplication({ PORT: "0" });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, LOOPBACK_HOST, resolve);
  });
  context.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const response = await postJson(
    `http://${LOOPBACK_HOST}:${server.address().port}${QUERY_API_ROUTE}`,
    { question: "測試" },
  );

  assert.equal(response.status, 404);
});

test("query service and route wiring is validated", () => {
  assert.throws(() => createQueryService({}), /orchestrator/);
  assert.throws(
    () => createQueryService({ orchestrator: { run() {} }, unexpected: true }),
    /Unknown query service option/,
  );
  assert.throws(
    () => createQueryService({ orchestrator: { run() {} }, generateTraceId: "no" }),
    /generateTraceId/,
  );
  assert.throws(() => createQueryRoute({}), /service must expose answer/);
});
