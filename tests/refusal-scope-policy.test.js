import assert from "node:assert/strict";
import test from "node:test";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { applyConflictVersionPolicy } from "../src/policy/conflict-version-policy.js";
import { assertEvidenceBundle } from "../src/policy/evidence-answer-contract.js";
import {
  REFUSAL_SCOPE_POLICY_RULESET_VERSION,
  createRefusalScopePolicy,
  evaluateRefusalScope,
} from "../src/policy/refusal-scope-policy.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
import { assertQueryPlan } from "../src/query/query-contract.js";
import { createStructuredRetriever } from "../src/query/structured-retrieval.js";

const fixturePack = loadFixtureSourcePack();

function classifier() {
  return createQueryClassifier({ canonicalEntities: fixturePack.canonical_entities });
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

function bundle(items) {
  return assertEvidenceBundle({
    query_id: "qry:refusal",
    items,
    conflict_groups: [],
  });
}

function factItem(overrides = {}) {
  return {
    evidence_id: "evd:refusal-fact",
    source_id: "src:hoyolab",
    source_kind: "hoyolab",
    source_url: "https://example.test/notice",
    source_title: "Refusal fixture",
    source_retrieved_at: "2026-08-01T00:00:00Z",
    game_version: "5.0",
    fact_id: "fact:refusal",
    rank: 1,
    support_type: "direct",
    ...overrides,
  };
}

test("the fixture out-of-scope scenario is refused with out_of_scope", () => {
  const { question } = fixturePack.test_scenarios.out_of_scope_query;
  const queryPlan = classifier().classify({ question });

  const decision = evaluateRefusalScope({ queryPlan, bundle: bundle([]) });

  assert.equal(decision.answerability, "refuse");
  assert.equal(decision.answer_status, "refused");
  assert.equal(decision.uncertainty_reason, "out_of_scope");
  assert.equal(decision.matched_rule, "out_of_scope");
  assert.equal(decision.ruleset_version, REFUSAL_SCOPE_POLICY_RULESET_VERSION);
});

test("a refusal this ruleset cannot interpret is honoured instead of answered", () => {
  const decision = evaluateRefusalScope({
    queryPlan: plan(),
    bundle: bundle([factItem()]),
    policyDecision: {
      query_id: "qry:refusal",
      answer_status: "refused",
      uncertainty_reason: "entity_unknown",
      applicable_items: [factItem()],
    },
  });

  assert.equal(decision.answerability, "refuse");
  assert.equal(decision.answer_status, "refused");
  assert.equal(decision.uncertainty_reason, "entity_unknown");
  assert.equal(decision.matched_rule, "policy_refused");
});

test("an uncertain decision this ruleset cannot interpret stays uncertain", () => {
  const decision = evaluateRefusalScope({
    queryPlan: plan(),
    bundle: bundle([factItem()]),
    policyDecision: {
      query_id: "qry:refusal",
      answer_status: "uncertain",
      uncertainty_reason: "insufficient_evidence",
      applicable_items: [factItem()],
    },
  });

  assert.equal(decision.answer_status, "uncertain");
  assert.equal(decision.uncertainty_reason, "insufficient_evidence");
  assert.equal(decision.matched_rule, "policy_uncertain");
});

test("an uncertainty reason outside the enum is rejected, not ignored", () => {
  assert.throws(
    () =>
      evaluateRefusalScope({
        queryPlan: plan(),
        bundle: bundle([factItem()]),
        policyDecision: {
          query_id: "qry:refusal",
          answer_status: "refused",
          uncertainty_reason: "some_future_reason",
          applicable_items: [factItem()],
        },
      }),
    /Unknown policyDecision.uncertainty_reason/,
  );
});

test("scope is checked before evidence, so relevant-looking evidence cannot rescue it", () => {
  const decision = evaluateRefusalScope({
    queryPlan: plan({ query_category: "out_of_scope", retrieval_mode: "none" }),
    bundle: bundle([factItem()]),
  });

  assert.equal(decision.uncertainty_reason, "out_of_scope");
  assert.equal(decision.evidence_count, 1);
});

test("a question whose only entity is unrecognized is refused with entity_unknown", () => {
  const queryPlan = plan({
    query_category: "narrative",
    retrieval_mode: "document",
    normalized_entities: [
      {
        text: "不存在的角色",
        resolution_status: "unrecognized",
        aliases_used: [],
      },
    ],
  });

  const decision = evaluateRefusalScope({ queryPlan, bundle: bundle([]) });

  assert.equal(decision.uncertainty_reason, "entity_unknown");
  assert.equal(decision.matched_rule, "entity_unknown");
});

test("a version question without any entity mention is not an unknown entity", () => {
  const queryPlan = plan({
    query_category: "version",
    retrieval_mode: "document",
    normalized_entities: [],
  });

  const refused = evaluateRefusalScope({ queryPlan, bundle: bundle([]) });
  const answered = evaluateRefusalScope({ queryPlan, bundle: bundle([factItem()]) });

  assert.equal(refused.uncertainty_reason, "insufficient_evidence");
  assert.equal(answered.answerability, "answerable");
  assert.equal(answered.answer_status, "answered");
  assert.equal(answered.uncertainty_reason, undefined);
});

test("a partially resolved question still answers on the resolved entity", () => {
  const queryPlan = plan({
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
  });

  const decision = evaluateRefusalScope({ queryPlan, bundle: bundle([factItem()]) });

  assert.equal(decision.answerability, "answerable");
  assert.equal(decision.matched_rule, null);
});

test("an unresolved conflict from T18 refuses with source_conflict", () => {
  const decision = evaluateRefusalScope({
    queryPlan: plan(),
    bundle: bundle([factItem()]),
    policyDecision: {
      applicable_items: [factItem()],
      uncertainty_reason: "source_conflict",
    },
  });

  assert.equal(decision.answerability, "refuse");
  assert.equal(decision.uncertainty_reason, "source_conflict");
  assert.equal(decision.matched_rule, "source_conflict");
});

test("an unknown version stays answerable but uncertain", () => {
  const decision = evaluateRefusalScope({
    queryPlan: plan(),
    bundle: bundle([factItem({ game_version: "unknown" })]),
    policyDecision: {
      applicable_items: [factItem({ game_version: "unknown" })],
      uncertainty_reason: "version_unknown",
    },
  });

  assert.equal(decision.answerability, "answerable");
  assert.equal(decision.answer_status, "uncertain");
  assert.equal(decision.uncertainty_reason, "version_unknown");
  assert.equal(decision.matched_rule, "version_unknown");
});

test("evidence emptied by the version filter counts as insufficient, not answerable", () => {
  const decision = evaluateRefusalScope({
    queryPlan: plan(),
    bundle: bundle([factItem({ game_version: "4.8" })]),
    policyDecision: { applicable_items: [], uncertainty_reason: "insufficient_evidence" },
  });

  assert.equal(decision.answerability, "refuse");
  assert.equal(decision.uncertainty_reason, "insufficient_evidence");
  assert.equal(decision.evidence_count, 0);
});

test("the answerable fixture scenario passes both policies end to end", (context) => {
  const store = createStructuredStore();
  context.after(() => {
    if (store.getStatus().isOpen) store.close();
  });
  store.replaceData(structuredClone({
    source_documents: fixturePack.source_documents,
    canonical_entities: fixturePack.canonical_entities,
    structured_facts: fixturePack.structured_facts,
    claims: fixturePack.claims,
    conflict_groups: fixturePack.conflict_groups,
  }));

  const { question } = fixturePack.test_scenarios.answerable_character_query;
  const queryPlan = classifier().classify({ question });
  const evidenceBundle = createStructuredRetriever({ store }).retrieve({
    queryId: "qry:refusal-answerable",
    queryPlan,
  });
  const policyDecision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: queryPlan.version_constraint,
  });
  const decision = evaluateRefusalScope({
    queryPlan,
    bundle: evidenceBundle,
    policyDecision,
  });

  assert.equal(decision.answerability, "answerable");
  assert.equal(decision.evidence_count, policyDecision.applicable_items.length);
  assert.ok(decision.evidence_count > 0);
});

test("policy boundaries reject malformed requests", () => {
  const policy = createRefusalScopePolicy();
  assert.equal(policy.rulesetVersion, REFUSAL_SCOPE_POLICY_RULESET_VERSION);

  assert.throws(() => policy.evaluate({ bundle: bundle([]) }), /queryPlan must be a QueryPlan/);
  assert.throws(
    () => policy.evaluate({ queryPlan: plan(), bundle: { query_id: "qry:bad" } }),
    /EvidenceBundle/,
  );
  assert.throws(
    () => policy.evaluate({ queryPlan: plan(), bundle: bundle([]), policyDecision: {} }),
    /applicable_items must be an array/,
  );
  assert.throws(
    () => policy.evaluate({ queryPlan: plan(), bundle: bundle([]), spoiler: "none" }),
    /Unknown refusal\/scope policy request field/,
  );
});
