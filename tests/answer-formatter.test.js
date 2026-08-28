import assert from "node:assert/strict";
import test from "node:test";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import {
  ANSWER_FORMATTER_RULESET_VERSION,
  ANSWER_TEXT_TEMPLATES,
  SPOILER_NOTICES,
  createAnswerFormatter,
  formatAnswer,
} from "../src/policy/answer-formatter.js";
import { applyConflictVersionPolicy } from "../src/policy/conflict-version-policy.js";
import {
  assertAnswerResponse,
  assertEvidenceBundle,
} from "../src/policy/evidence-answer-contract.js";
import { evaluateRefusalScope } from "../src/policy/refusal-scope-policy.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
import { assertQueryPlan } from "../src/query/query-contract.js";
import { createStructuredRetriever } from "../src/query/structured-retrieval.js";

const fixturePack = loadFixtureSourcePack();

function classifier() {
  return createQueryClassifier({ canonicalEntities: fixturePack.canonical_entities });
}

function storedRetriever(context) {
  const store = createStructuredStore();
  context.after(() => {
    if (store.getStatus().isOpen) store.close();
  });
  store.replaceData(
    structuredClone({
      source_documents: fixturePack.source_documents,
      canonical_entities: fixturePack.canonical_entities,
      structured_facts: fixturePack.structured_facts,
      claims: fixturePack.claims,
      conflict_groups: fixturePack.conflict_groups,
    }),
  );
  return createStructuredRetriever({ store });
}

function plan(overrides) {
  return assertQueryPlan({
    query_category: "structured",
    normalized_entities: [
      {
        entity_id: "ent:raiden-shogun",
        text: "雷電將軍",
        entity_type: "character",
        resolution_status: "resolved",
        aliases_used: [],
      },
    ],
    version_constraint: "current-unspecified",
    retrieval_mode: "structured",
    spoiler_level: "none",
    ...overrides,
  });
}

function bundle(items, conflictGroups = []) {
  return assertEvidenceBundle({
    query_id: "qry:formatter",
    items,
    conflict_groups: conflictGroups,
  });
}

function factItem(overrides = {}) {
  return {
    evidence_id: "evd:formatter-fact",
    source_id: "src:hoyolab",
    source_kind: "hoyolab",
    source_url: "https://example.test/notice",
    source_title: "Formatter fixture",
    source_published_at: "2026-07-01T00:00:00Z",
    source_retrieved_at: "2026-08-01T00:00:00Z",
    game_version: "5.0",
    fact_id: "fact:formatter",
    rank: 1,
    support_type: "direct",
    ...overrides,
  };
}

test("an answered decision becomes a cited AnswerResponse that hides internal IDs", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle([factItem()]);
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });
  const refusalDecision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-answered",
  });

  assert.equal(assertAnswerResponse(response), response);
  assert.equal(response.answer_status, "answered");
  assert.equal(response.query_category, "structured");
  assert.equal(response.version_scope, policyDecision.version_scope);
  assert.equal(response.uncertainty_reason, undefined);
  assert.equal(response.spoiler_notice, undefined);
  assert.equal(response.trace_id, "trace:formatter-answered");
  assert.deepEqual(response.citations, [
    {
      source_url: "https://example.test/notice",
      title: "Formatter fixture",
      source_kind: "hoyolab",
      published_at: "2026-07-01T00:00:00Z",
      retrieved_at: "2026-08-01T00:00:00Z",
      game_version: "5.0",
    },
  ]);
  assert.equal(Object.hasOwn(response.citations[0], "source_id"), false);
  assert.equal(Object.hasOwn(response.citations[0], "evidence_id"), false);
  assert.match(response.answer_text, /1 筆來源佐證/);
});

test("citations follow the policy's applicable items and drop duplicate source URLs", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle([
    factItem({ evidence_id: "evd:formatter-a", rank: 1 }),
    factItem({
      evidence_id: "evd:formatter-b",
      source_url: "https://example.test/notice",
      source_title: "Duplicate URL, different record",
      fact_id: "fact:formatter-duplicate",
      rank: 2,
    }),
    factItem({
      evidence_id: "evd:formatter-c",
      source_id: "src:fandom",
      source_kind: "fandom",
      source_url: "https://example.test/wiki",
      source_title: "Wiki page",
      fact_id: "fact:formatter-wiki",
      rank: 3,
    }),
    factItem({
      evidence_id: "evd:formatter-excluded",
      source_url: "https://example.test/old",
      source_title: "Old version page",
      game_version: "2.1",
      fact_id: "fact:formatter-old",
      rank: 4,
    }),
  ]);
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "exact",
    gameVersion: "5.0",
  });
  const refusalDecision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-citations",
  });

  assert.deepEqual(
    response.citations.map((citation) => citation.source_url),
    ["https://example.test/notice", "https://example.test/wiki"],
  );
  assert.equal(response.version_scope, "5.0");
});

test("a refusal carries the reason and no citations", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle([]);
  const refusalDecision = evaluateRefusalScope({ queryPlan, bundle: evidenceBundle });

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    refusalDecision,
    traceId: "trace:formatter-refused",
  });

  assert.equal(response.answer_status, "refused");
  assert.equal(response.uncertainty_reason, "insufficient_evidence");
  assert.deepEqual(response.citations, []);
  assert.equal(response.version_scope, "unknown");
  assert.equal(response.answer_text, ANSWER_TEXT_TEMPLATES.insufficient_evidence);
});

test("an unresolved source conflict is refused but still shows the conflicting sources", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle(
    [
      factItem({
        evidence_id: "evd:formatter-conflict-a",
        source_id: "src:fandom",
        source_kind: "fandom",
        source_url: "https://example.test/wiki-a",
        source_title: "Wiki A",
        fact_id: undefined,
        claim_id: "claim:formatter-conflict-a",
        support_type: "conflicting",
      }),
      factItem({
        evidence_id: "evd:formatter-conflict-b",
        source_id: "src:fandom",
        source_kind: "fandom",
        source_url: "https://example.test/wiki-b",
        source_title: "Wiki B",
        fact_id: undefined,
        claim_id: "claim:formatter-conflict-b",
        rank: 2,
        support_type: "conflicting",
      }),
    ],
    [
      {
        conflict_group_id: "conflict:formatter",
        claim_ids: ["claim:formatter-conflict-a", "claim:formatter-conflict-b"],
      },
    ],
  );
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });
  const refusalDecision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });
  assert.equal(refusalDecision.uncertainty_reason, "source_conflict");

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-conflict",
  });

  assert.equal(response.answer_status, "refused");
  assert.equal(response.uncertainty_reason, "source_conflict");
  assert.ok(response.citations.length > 0);
  assert.equal(response.answer_text, ANSWER_TEXT_TEMPLATES.source_conflict);
});

test("the fixture conflict scenario is answered because authority resolves the group", (context) => {
  const scenario = fixturePack.test_scenarios.conflict_query;
  const queryPlan = classifier().classify({ question: scenario.question });
  const evidenceBundle = storedRetriever(context).retrieve({
    queryId: "qry:formatter-fixture-conflict",
    queryPlan,
  });
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: queryPlan.version_constraint,
  });
  const resolution = policyDecision.conflict_resolutions.find(
    (entry) => entry.conflict_group_id === scenario.conflict_group_id,
  );
  assert.equal(resolution.resolution, "dominated");
  assert.equal(resolution.winning_claim_id, scenario.official_claim_id);

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision: evaluateRefusalScope({
      queryPlan,
      bundle: evidenceBundle,
      policyDecision,
    }),
    traceId: "trace:formatter-fixture-conflict",
  });

  assert.equal(response.answer_status, "answered");
  assert.ok(response.citations.length > 0);

  // The rejected claim's source must not be cited: an answer never carries the
  // source whose statement the policy just discarded.
  const losingSourceId = fixturePack.claims.find(
    (claim) => claim.claim_id === scenario.differing_claim_id,
  ).source_id;
  const losingSourceUrl = fixturePack.source_documents.find(
    (source) => source.source_id === losingSourceId,
  ).source_url;
  assert.equal(
    response.citations.some((citation) => citation.source_url === losingSourceUrl),
    false,
  );
});

test("an uncertain version_unknown answer keeps its citations and reports the count", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle([factItem({ game_version: "unknown" })]);
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });
  const refusalDecision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });
  assert.equal(refusalDecision.answer_status, "uncertain");

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-uncertain",
  });

  assert.equal(response.answer_status, "uncertain");
  assert.equal(response.uncertainty_reason, "version_unknown");
  assert.equal(response.citations.length, 1);
  assert.equal(
    response.answer_text,
    ANSWER_TEXT_TEMPLATES.version_unknown.replace("{count}", "1"),
  );
});

test("spoiler level only adds a notice and never changes status or citations", () => {
  const evidenceBundle = bundle([factItem()]);
  const build = (spoilerLevel) => {
    const queryPlan = plan({ spoiler_level: spoilerLevel });
    const policyDecision = applyConflictVersionPolicy({
      bundle: evidenceBundle,
      versionConstraint: "current-unspecified",
    });
    return formatAnswer({
      queryPlan,
      bundle: evidenceBundle,
      policyDecision,
      refusalDecision: evaluateRefusalScope({ queryPlan, bundle: evidenceBundle, policyDecision }),
      traceId: "trace:formatter-spoiler",
    });
  };

  const none = build("none");
  const notice = build("notice");
  const explicit = build("explicit");

  assert.equal(none.spoiler_notice, undefined);
  assert.equal(notice.spoiler_notice, SPOILER_NOTICES.notice);
  assert.equal(explicit.spoiler_notice, SPOILER_NOTICES.explicit);
  for (const response of [notice, explicit]) {
    assert.equal(response.answer_status, none.answer_status);
    assert.deepEqual(response.citations, none.citations);
  }
});

test("a caller-supplied answer text replaces the template without changing the projection", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle([factItem()]);
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });
  const refusalDecision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });
  const request = {
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-text",
  };

  const templated = formatAnswer(request);
  const supplied = formatAnswer({ ...request, answerText: "雷電將軍的元素屬性是雷。" });

  assert.equal(supplied.answer_text, "雷電將軍的元素屬性是雷。");
  assert.notEqual(templated.answer_text, supplied.answer_text);
  assert.deepEqual(supplied.citations, templated.citations);
  assert.equal(supplied.answer_status, templated.answer_status);
});

test("formatting is deterministic and leaves the inputs untouched", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle([factItem()]);
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });
  const refusalDecision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });
  const planSnapshot = structuredClone(queryPlan);
  const bundleSnapshot = structuredClone(evidenceBundle);
  const formatter = createAnswerFormatter();

  const first = formatter.format({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-determinism",
  });
  const second = formatter.format({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-determinism",
  });

  assert.equal(formatter.rulesetVersion, ANSWER_FORMATTER_RULESET_VERSION);
  assert.deepEqual(first, second);
  assert.deepEqual(queryPlan, planSnapshot);
  assert.deepEqual(evidenceBundle, bundleSnapshot);
});

test("invalid formatter requests fail fast", () => {
  const queryPlan = plan();
  const evidenceBundle = bundle([factItem()]);
  const refusalDecision = evaluateRefusalScope({ queryPlan, bundle: evidenceBundle });
  const base = { queryPlan, bundle: evidenceBundle, refusalDecision, traceId: "trace:formatter" };

  assert.throws(() => formatAnswer({ ...base, unexpected: true }), /Unknown answer formatter/);
  assert.throws(() => formatAnswer({ ...base, traceId: "  " }), /traceId/);
  assert.throws(() => formatAnswer({ ...base, answerText: "" }), /answerText/);
  assert.throws(
    () => formatAnswer({ ...base, queryPlan: { ...queryPlan, query_category: "chit-chat" } }),
    /query_category/,
  );
  assert.throws(
    () => formatAnswer({ ...base, refusalDecision: { answer_status: "error" } }),
    /system failure/,
  );
  assert.throws(
    () =>
      formatAnswer({
        ...base,
        refusalDecision: { ...refusalDecision, query_id: "qry:other" },
      }),
    /refusalDecision.query_id/,
  );
  assert.throws(
    () =>
      formatAnswer({
        ...base,
        policyDecision: { query_id: "qry:other", applicable_items: [] },
      }),
    /policyDecision.query_id/,
  );
});

test("the answerable fixture scenario formats an answered response end to end", (context) => {
  const scenario = fixturePack.test_scenarios.answerable_character_query;
  const queryPlan = classifier().classify({ question: scenario.question });
  const evidenceBundle = storedRetriever(context).retrieve({
    queryId: "qry:formatter-answerable",
    queryPlan,
  });
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: queryPlan.version_constraint,
  });
  const refusalDecision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
    refusalDecision,
    traceId: "trace:formatter-acceptance",
  });

  assert.equal(assertAnswerResponse(response), response);
  assert.equal(response.answer_status, "answered");
  assert.ok(response.citations.length > 0);
  for (const citation of response.citations) {
    assert.match(citation.source_url, /^https?:\/\//);
    assert.ok(citation.title.length > 0);
  }
});

test("the out-of-scope fixture scenario formats a refusal with the scope wording", (context) => {
  const scenario = fixturePack.test_scenarios.out_of_scope_query;
  const queryPlan = classifier().classify({ question: scenario.question });
  const evidenceBundle = storedRetriever(context).retrieve({
    queryId: "qry:formatter-out-of-scope",
    queryPlan,
  });
  const refusalDecision = evaluateRefusalScope({ queryPlan, bundle: evidenceBundle });

  const response = formatAnswer({
    queryPlan,
    bundle: evidenceBundle,
    refusalDecision,
    traceId: "trace:formatter-out-of-scope",
  });

  assert.equal(response.answer_status, "refused");
  assert.equal(response.uncertainty_reason, "out_of_scope");
  assert.equal(response.query_category, "out_of_scope");
  assert.deepEqual(response.citations, []);
  assert.equal(response.answer_text, ANSWER_TEXT_TEMPLATES.out_of_scope);
});
