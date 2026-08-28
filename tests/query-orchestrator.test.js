import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_EMBEDDING_DIMENSIONS,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { formatAnswer } from "../src/policy/answer-formatter.js";
import { applyConflictVersionPolicy } from "../src/policy/conflict-version-policy.js";
import { assertEvidenceBundle } from "../src/policy/evidence-answer-contract.js";
import { evaluateRefusalScope } from "../src/policy/refusal-scope-policy.js";
import { createDocumentRetriever } from "../src/query/document-retrieval.js";
import {
  QUERY_ORCHESTRATOR_RULESET_VERSION,
  createQueryOrchestrator,
  mergeEvidenceBundles,
} from "../src/query/query-orchestrator.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
import { createStructuredRetriever } from "../src/query/structured-retrieval.js";

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

async function createOrchestrator(context) {
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

  return createQueryOrchestrator({
    classifier: createQueryClassifier({ canonicalEntities: fixturePack.canonical_entities }),
    structuredRetriever: createStructuredRetriever({ store: structuredStore }),
    documentRetriever: createDocumentRetriever({
      store: documentStore,
      embedQuery: embedText,
    }),
  });
}

function item(overrides = {}) {
  return {
    evidence_id: "evd:merge-a",
    source_id: "src:hoyolab",
    source_kind: "hoyolab",
    source_url: "https://example.test/notice",
    source_title: "Merge fixture",
    source_retrieved_at: "2026-08-01T00:00:00Z",
    game_version: "5.0",
    fact_id: "fact:merge-a",
    rank: 1,
    support_type: "direct",
    ...overrides,
  };
}

function bundle(items, conflictGroups = []) {
  return { query_id: "qry:merge", items, conflict_groups: conflictGroups };
}

test("a structured question routes to the structured store and yields a valid bundle", async (context) => {
  const orchestrator = await createOrchestrator(context);
  const scenario = scenarios.answerable_character_query;

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-structured",
    request: { question: scenario.question },
  });

  assert.equal(result.ruleset_version, QUERY_ORCHESTRATOR_RULESET_VERSION);
  assert.equal(result.retrieval_mode, "structured");
  assert.equal(result.query_plan.query_category, "structured");
  assert.equal(assertEvidenceBundle(result.bundle), result.bundle);
  assert.equal(result.retrieved.document_count, 0);
  assert.ok(result.retrieved.structured_count > 0);
  assert.ok(
    result.bundle.items.some((evidence) => evidence.fact_id === scenario.expected_fact_id),
  );
});

test("a narrative question routes to the fixed index only", async (context) => {
  const orchestrator = await createOrchestrator(context);
  const scenario = scenarios.unclassified_lore_query;

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-narrative",
    request: { question: scenario.question },
  });

  assert.equal(result.retrieval_mode, "document");
  assert.equal(result.retrieved.structured_count, 0);
  assert.ok(
    result.bundle.items.some((evidence) => evidence.chunk_id === scenario.target_chunk_id),
  );
  for (const evidence of result.bundle.items) {
    assert.equal(evidence.support_type, "contextual");
  }
});

test("a hybrid question merges both routes with structured evidence first", async (context) => {
  const orchestrator = await createOrchestrator(context);

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-hybrid",
    request: { question: "雷電將軍的元素屬性是什麼？她的故事背景是什麼？" },
  });

  assert.equal(result.retrieval_mode, "hybrid");
  assert.ok(result.retrieved.structured_count > 0);
  assert.ok(result.retrieved.document_count > 0);

  const supportTypes = result.bundle.items.map((evidence) => evidence.support_type);
  const firstContextual = supportTypes.indexOf("contextual");
  assert.notEqual(firstContextual, -1);
  assert.equal(
    supportTypes.slice(firstContextual).every((type) => type === "contextual"),
    true,
  );
  assert.deepEqual(
    result.bundle.items.map((evidence) => evidence.rank),
    result.bundle.items.map((_, index) => index + 1),
  );
});

test("an out-of-scope question reaches neither store", async (context) => {
  const orchestrator = await createOrchestrator(context);

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-out-of-scope",
    request: { question: scenarios.out_of_scope_query.question },
  });

  assert.equal(result.retrieval_mode, "none");
  assert.deepEqual(result.bundle.items, []);
  assert.deepEqual(result.bundle.conflict_groups, []);
  assert.equal(assertEvidenceBundle(result.bundle), result.bundle);
});

test("an explicit game_version is passed through as the exact version filter", async (context) => {
  const orchestrator = await createOrchestrator(context);

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-exact",
    request: { question: "雷電將軍的元素屬性是什麼？", game_version: "5.0" },
  });

  assert.equal(result.query_plan.version_constraint, "exact");
  assert.ok(result.bundle.items.length > 0);
  for (const evidence of result.bundle.items) {
    assert.equal(evidence.game_version, "5.0");
  }
});

test("the conflict scenario carries its conflict group through the merge", async (context) => {
  const orchestrator = await createOrchestrator(context);
  const scenario = scenarios.conflict_query;

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-conflict",
    request: { question: scenario.question },
  });

  assert.deepEqual(
    result.bundle.conflict_groups.map((group) => group.conflict_group_id),
    [scenario.conflict_group_id],
  );
  for (const claimId of [scenario.official_claim_id, scenario.differing_claim_id]) {
    assert.ok(result.bundle.items.some((evidence) => evidence.claim_id === claimId));
  }
});

test("the merged bundle feeds the T18/T19/T20 chain to a cited answer", async (context) => {
  const orchestrator = await createOrchestrator(context);
  const { query_plan: queryPlan, bundle: merged } = await orchestrator.run({
    queryId: "qry:orchestrator-chain",
    request: { question: scenarios.answerable_character_query.question },
  });

  const policyDecision = applyConflictVersionPolicy({
    bundle: merged,
    versionConstraint: queryPlan.version_constraint,
  });
  const response = formatAnswer({
    queryPlan,
    bundle: merged,
    policyDecision,
    refusalDecision: evaluateRefusalScope({ queryPlan, bundle: merged, policyDecision }),
    traceId: "trace:orchestrator-chain",
  });

  assert.equal(response.answer_status, "answered");
  assert.ok(response.citations.length > 0);
});

test("merging keeps precedence order, deduplicates records, and renumbers ranks", () => {
  const structured = bundle(
    [
      item(),
      item({ evidence_id: "evd:merge-b", fact_id: "fact:merge-b", rank: 2 }),
    ],
    [{ conflict_group_id: "conflict:merge", claim_ids: ["claim:merge-a", "claim:merge-b"] }],
  );
  const document = bundle(
    [
      item({
        evidence_id: "evd:merge-chunk-a",
        fact_id: undefined,
        chunk_id: "chunk:merge-a",
        support_type: "contextual",
        rank: 1,
      }),
      item({
        evidence_id: "evd:merge-duplicate",
        fact_id: "fact:merge-a",
        rank: 2,
      }),
    ],
    [{ conflict_group_id: "conflict:merge", claim_ids: ["claim:merge-a", "claim:merge-b"] }],
  );

  const merged = mergeEvidenceBundles("qry:merge", [structured, document]);

  assert.equal(assertEvidenceBundle(merged), merged);
  assert.deepEqual(
    merged.items.map((evidence) => evidence.evidence_id),
    ["evd:merge-a", "evd:merge-b", "evd:merge-chunk-a"],
  );
  assert.deepEqual(
    merged.items.map((evidence) => evidence.rank),
    [1, 2, 3],
  );
  assert.deepEqual(
    merged.conflict_groups.map((group) => group.conflict_group_id),
    ["conflict:merge"],
  );
});

test("merging refuses evidence that belongs to another query", () => {
  assert.throws(
    () => mergeEvidenceBundles("qry:merge", [bundle([]), { ...bundle([]), query_id: "qry:other" }]),
    /another query/,
  );
  assert.throws(() => mergeEvidenceBundles("merge", [bundle([])]), /queryId/);
  assert.throws(() => mergeEvidenceBundles("qry:merge", [{ query_id: "qry:merge" }]), /EvidenceBundle/);
});

test("orchestration is deterministic and leaves the request untouched", async (context) => {
  const orchestrator = await createOrchestrator(context);
  const request = { question: scenarios.version_range_query.question };
  const snapshot = structuredClone(request);

  const first = await orchestrator.run({ queryId: "qry:orchestrator-repeat", request });
  const second = await orchestrator.run({ queryId: "qry:orchestrator-repeat", request });

  assert.deepEqual(first, second);
  assert.deepEqual(request, snapshot);
});

test("invalid orchestrator wiring and run requests fail fast", async (context) => {
  const orchestrator = await createOrchestrator(context);

  assert.throws(() => createQueryOrchestrator({}), /classifier/);
  assert.throws(
    () =>
      createQueryOrchestrator({
        classifier: { classify() {} },
        structuredRetriever: {},
        documentRetriever: { retrieve() {} },
      }),
    /structuredRetriever/,
  );
  assert.throws(
    () =>
      createQueryOrchestrator({
        classifier: { classify() {} },
        structuredRetriever: { retrieve() {} },
        documentRetriever: { retrieve() {} },
        unexpected: true,
      }),
    /Unknown query orchestrator option/,
  );

  await assert.rejects(
    () => orchestrator.run({ queryId: "orchestrator", request: { question: "測試" } }),
    /queryId/,
  );
  await assert.rejects(
    () => orchestrator.run({ queryId: "qry:orchestrator", request: { question: "測試" }, topK: 3 }),
    /Unknown query orchestrator run request field/,
  );
});

test("a question that names a version is answerable without the caller repeating it", async (context) => {
  const orchestrator = await createOrchestrator(context);

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-version-in-question",
    request: { question: "5.0版本更新了哪些內容？" },
  });

  // The classifier reads the version out of the question, so the policy stage
  // that follows has a version to filter on. Before the plan carried one, this
  // question failed outright: an exact constraint with nothing to resolve.
  assert.equal(result.query_plan.version_constraint, "exact");
  assert.equal(result.query_plan.game_version, "5.0");
  assert.equal(result.game_version, "5.0");
  assert.equal(
    applyConflictVersionPolicy({
      bundle: result.bundle,
      versionConstraint: result.query_plan.version_constraint,
      gameVersion: result.game_version,
    }).version_scope,
    "5.0",
  );
});

test("an explicit request version outranks the one written in the question", async (context) => {
  const orchestrator = await createOrchestrator(context);

  const result = await orchestrator.run({
    queryId: "qry:orchestrator-version-request-wins",
    request: { question: "5.0版本更新了哪些內容？", game_version: "2.1" },
  });

  assert.equal(result.query_plan.game_version, "2.1");
  assert.equal(result.game_version, "2.1");
});
