import assert from "node:assert/strict";
import test from "node:test";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { assertEvidenceBundle } from "../src/policy/evidence-answer-contract.js";
import {
  CONFLICT_RESOLUTIONS,
  CONFLICT_VERSION_POLICY_RULESET_VERSION,
  EXCLUSION_REASONS,
  applyConflictVersionPolicy,
  createConflictVersionPolicy,
} from "../src/policy/conflict-version-policy.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
import { createStructuredRetriever } from "../src/query/structured-retrieval.js";

const fixturePack = loadFixtureSourcePack();

function fixtureConflictBundle(context) {
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

  const { question } = fixturePack.test_scenarios.conflict_query;
  const queryPlan = createQueryClassifier({
    canonicalEntities: fixturePack.canonical_entities,
  }).classify({ question });
  return createStructuredRetriever({ store }).retrieve({
    queryId: "qry:conflict-policy",
    queryPlan,
  });
}

function claimItem(overrides) {
  return {
    evidence_id: "evd:policy-claim",
    source_id: "src:policy",
    source_kind: "fandom",
    source_url: "https://example.test/policy",
    source_title: "Policy fixture",
    source_retrieved_at: "2026-08-01T00:00:00Z",
    game_version: "5.0",
    claim_id: "claim:policy",
    rank: 1,
    support_type: "conflicting",
    ...overrides,
  };
}

function bundle(items, conflictGroups = []) {
  const value = {
    query_id: "qry:policy",
    items,
    conflict_groups: conflictGroups,
  };
  return assertEvidenceBundle(value);
}

test("the fixture conflict is dominated by the higher-authority source", (context) => {
  const evidenceBundle = fixtureConflictBundle(context);
  const scenario = fixturePack.test_scenarios.conflict_query;

  const decision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });

  const resolution = decision.conflict_resolutions.find(
    (candidate) => candidate.conflict_group_id === scenario.conflict_group_id,
  );
  assert.equal(resolution.resolution, CONFLICT_RESOLUTIONS.DOMINATED);
  assert.equal(resolution.winning_claim_id, scenario.official_claim_id);
  assert.ok(resolution.claim_ids.includes(scenario.differing_claim_id));
  assert.equal(decision.answer_status, "answered");
  assert.equal(decision.uncertainty_reason, undefined);
  assert.equal(decision.ruleset_version, CONFLICT_VERSION_POLICY_RULESET_VERSION);
});

test("a claim that lost its conflict stops being applicable evidence", (context) => {
  const evidenceBundle = fixtureConflictBundle(context);
  const scenario = fixturePack.test_scenarios.conflict_query;

  const decision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });

  const applicableClaimIds = decision.applicable_items.map((item) => item.claim_id);
  assert.ok(applicableClaimIds.includes(scenario.official_claim_id));
  assert.equal(applicableClaimIds.includes(scenario.differing_claim_id), false);

  const losingEvidenceId = evidenceBundle.items.find(
    (item) => item.claim_id === scenario.differing_claim_id,
  ).evidence_id;
  assert.deepEqual(
    decision.excluded_items.find((entry) => entry.evidence_id === losingEvidenceId),
    { evidence_id: losingEvidenceId, reason: EXCLUSION_REASONS.LOST_CONFLICT },
  );
});

test("an unresolved conflict keeps every claim so the refusal can show both sides", () => {
  const evidenceBundle = bundle(
    [
      claimItem({ evidence_id: "evd:kept-a", claim_id: "claim:kept-a" }),
      claimItem({ evidence_id: "evd:kept-b", claim_id: "claim:kept-b" }),
    ],
    [{ conflict_group_id: "conflict:kept", claim_ids: ["claim:kept-a", "claim:kept-b"] }],
  );

  const decision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });

  assert.equal(decision.answer_status, "refused");
  assert.equal(decision.uncertainty_reason, "source_conflict");
  assert.equal(decision.applicable_items.length, 2);
  assert.deepEqual(decision.excluded_items, []);
});

test("equal authority within one version scope refuses instead of picking a claim", () => {
  const evidenceBundle = bundle(
    [
      claimItem({
        evidence_id: "evd:wiki-a",
        claim_id: "claim:wiki-a",
        source_id: "src:wiki-a",
        source_published_at: "2026-01-01T00:00:00Z",
      }),
      claimItem({
        evidence_id: "evd:wiki-b",
        claim_id: "claim:wiki-b",
        source_id: "src:wiki-b",
        source_published_at: "2026-01-01T00:00:00Z",
        rank: 2,
      }),
    ],
    [{ conflict_group_id: "conflict:policy", claim_ids: ["claim:wiki-a", "claim:wiki-b"] }],
  );

  const decision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });

  assert.equal(decision.answer_status, "refused");
  assert.equal(decision.uncertainty_reason, "source_conflict");
  assert.equal(decision.conflict_resolutions[0].resolution, CONFLICT_RESOLUTIONS.UNRESOLVED);
  assert.equal(decision.conflict_resolutions[0].winning_claim_id, undefined);
});

test("an exact version excludes mismatched and unknown-version evidence", () => {
  const evidenceBundle = bundle([
    claimItem({ evidence_id: "evd:match", claim_id: "claim:match", game_version: "5.0" }),
    claimItem({ evidence_id: "evd:other", claim_id: "claim:other", game_version: "4.8" }),
    claimItem({ evidence_id: "evd:unknown", claim_id: "claim:unknown", game_version: "unknown" }),
    claimItem({ evidence_id: "evd:range", claim_id: "claim:range", game_version: "4.8-5.2" }),
  ]);

  const decision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "exact",
    gameVersion: "5.0",
  });

  assert.deepEqual(
    decision.applicable_items.map((item) => item.evidence_id).sort(),
    ["evd:match", "evd:range"],
  );
  assert.deepEqual(decision.excluded_items, [
    { evidence_id: "evd:other", reason: EXCLUSION_REASONS.VERSION_MISMATCH },
    { evidence_id: "evd:unknown", reason: EXCLUSION_REASONS.VERSION_UNKNOWN },
  ]);
  assert.equal(decision.version_scope, "5.0");
  assert.equal(decision.answer_status, "answered");
});

test("a version range only applies to versions inside the range", () => {
  const items = [claimItem({ evidence_id: "evd:sumeru", claim_id: "claim:sumeru", game_version: "3.0-3.8" })];

  const inside = applyConflictVersionPolicy({
    bundle: bundle(items),
    versionConstraint: "exact",
    gameVersion: "3.4",
  });
  const outside = applyConflictVersionPolicy({
    bundle: bundle(items),
    versionConstraint: "exact",
    gameVersion: "4.0",
  });

  assert.equal(inside.applicable_items.length, 1);
  assert.equal(inside.answer_status, "answered");
  assert.deepEqual(outside.applicable_items, []);
  assert.equal(outside.answer_status, "refused");
  assert.equal(outside.uncertainty_reason, "insufficient_evidence");
});

test("unknown version scope answers with uncertainty instead of assuming the current version", () => {
  const decision = applyConflictVersionPolicy({
    bundle: bundle([
      claimItem({ evidence_id: "evd:unknown-a", claim_id: "claim:unknown-a", game_version: "unknown" }),
      claimItem({ evidence_id: "evd:known-b", claim_id: "claim:known-b", game_version: "5.0", rank: 2 }),
    ]),
    versionConstraint: "current-unspecified",
  });

  assert.equal(decision.version_scope, "5.0");
  assert.equal(decision.answer_status, "answered");

  const mixed = applyConflictVersionPolicy({
    bundle: bundle([
      claimItem({ evidence_id: "evd:v1", claim_id: "claim:v1", game_version: "5.0" }),
      claimItem({ evidence_id: "evd:v2", claim_id: "claim:v2", game_version: "4.8", rank: 2 }),
    ]),
    versionConstraint: "current-unspecified",
  });

  assert.equal(mixed.version_scope, "unknown");
  assert.equal(mixed.answer_status, "uncertain");
  assert.equal(mixed.uncertainty_reason, "version_unknown");
});

test("evidence is ordered by authority, then recency, then evidence_id", () => {
  const evidenceBundle = bundle([
    claimItem({
      evidence_id: "evd:fandom",
      claim_id: "claim:fandom",
      source_kind: "fandom",
      source_published_at: "2026-05-01T00:00:00Z",
    }),
    claimItem({
      evidence_id: "evd:hoyolab-old",
      claim_id: "claim:hoyolab-old",
      source_kind: "hoyolab",
      source_published_at: "2026-01-01T00:00:00Z",
      rank: 2,
    }),
    claimItem({
      evidence_id: "evd:hoyolab-new",
      claim_id: "claim:hoyolab-new",
      source_kind: "hoyolab",
      source_published_at: "2026-06-01T00:00:00Z",
      rank: 3,
    }),
    claimItem({
      evidence_id: "evd:genshin-db",
      claim_id: "claim:genshin-db",
      source_kind: "genshin-db",
      rank: 4,
    }),
  ]);
  const before = structuredClone(evidenceBundle);

  const decision = applyConflictVersionPolicy({
    bundle: evidenceBundle,
    versionConstraint: "current-unspecified",
  });

  assert.deepEqual(decision.applicable_items.map((item) => item.evidence_id), [
    "evd:hoyolab-new",
    "evd:hoyolab-old",
    "evd:genshin-db",
    "evd:fandom",
  ]);
  assert.deepEqual(evidenceBundle, before);
});

test("a conflict group emptied by the version filter stays unresolved", () => {
  const decision = applyConflictVersionPolicy({
    bundle: bundle(
      [
        claimItem({ evidence_id: "evd:old-a", claim_id: "claim:old-a", game_version: "4.8" }),
        claimItem({ evidence_id: "evd:old-b", claim_id: "claim:old-b", game_version: "4.8", rank: 2 }),
      ],
      [{ conflict_group_id: "conflict:policy", claim_ids: ["claim:old-a", "claim:old-b"] }],
    ),
    versionConstraint: "exact",
    gameVersion: "5.0",
  });

  assert.equal(decision.conflict_resolutions[0].resolution, CONFLICT_RESOLUTIONS.UNRESOLVED);
  assert.equal(decision.answer_status, "refused");
  assert.equal(decision.uncertainty_reason, "source_conflict");
});

test("a version filter that leaves one claim resolves the group without authority", () => {
  const decision = applyConflictVersionPolicy({
    bundle: bundle(
      [
        claimItem({ evidence_id: "evd:current", claim_id: "claim:current", game_version: "5.0" }),
        claimItem({ evidence_id: "evd:legacy", claim_id: "claim:legacy", game_version: "4.8", rank: 2 }),
      ],
      [{ conflict_group_id: "conflict:policy", claim_ids: ["claim:current", "claim:legacy"] }],
    ),
    versionConstraint: "exact",
    gameVersion: "5.0",
  });

  assert.equal(
    decision.conflict_resolutions[0].resolution,
    CONFLICT_RESOLUTIONS.RESOLVED_BY_VERSION,
  );
  assert.equal(decision.conflict_resolutions[0].winning_claim_id, "claim:current");
  assert.equal(decision.answer_status, "answered");
});

test("policy boundaries reject malformed requests and empty evidence", () => {
  const empty = applyConflictVersionPolicy({
    bundle: bundle([]),
    versionConstraint: "current-unspecified",
  });
  assert.equal(empty.answer_status, "refused");
  assert.equal(empty.uncertainty_reason, "insufficient_evidence");
  assert.equal(empty.version_scope, "unknown");

  const policy = createConflictVersionPolicy();
  assert.equal(policy.rulesetVersion, CONFLICT_VERSION_POLICY_RULESET_VERSION);
  assert.throws(
    () => policy.apply({ bundle: bundle([]), versionConstraint: "exact" }),
    /gameVersion is required for an exact version constraint/,
  );
  assert.throws(
    () => policy.apply({
      bundle: bundle([]),
      versionConstraint: "exact",
      gameVersion: "unknown",
    }),
    /gameVersion must be an explicit version/,
  );
  assert.throws(
    () => policy.apply({ bundle: bundle([]), versionConstraint: "eventually" }),
    /versionConstraint must be one of/,
  );
  assert.throws(
    () => policy.apply({ bundle: { query_id: "qry:bad" }, versionConstraint: "unknown" }),
    /EvidenceBundle/,
  );
  assert.throws(
    () => policy.apply({
      bundle: bundle([]),
      versionConstraint: "unknown",
      topK: 3,
    }),
    /Unknown conflict\/version policy request field/,
  );
});
