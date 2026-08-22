import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ANSWER_RESPONSE_FIELDS,
  ANSWER_RESPONSE_OPTIONAL_FIELDS,
  ANSWER_RESPONSE_REQUIRED_FIELDS,
  CITATION_FIELDS,
  CITATION_OPTIONAL_FIELDS,
  CITATION_REQUIRED_FIELDS,
  EVIDENCE_ANSWER_SCHEMA,
  EVIDENCE_ANSWER_SCHEMA_VERSION,
  EVIDENCE_ANSWER_VALIDATION_CODES,
  EVIDENCE_BUNDLE_FIELDS,
  EVIDENCE_BUNDLE_REQUIRED_FIELDS,
  EVIDENCE_CONFLICT_GROUP_FIELDS,
  EVIDENCE_CONFLICT_GROUP_REQUIRED_FIELDS,
  EVIDENCE_ITEM_FIELDS,
  EVIDENCE_ITEM_OPTIONAL_FIELDS,
  EVIDENCE_ITEM_REQUIRED_FIELDS,
  assertAnswerResponse,
  assertEvidenceBundle,
  assertEvidenceConflictGroup,
  assertEvidenceItem,
  isAnswerResponse,
  isCitation,
  isEvidenceBundle,
  isEvidenceConflictGroup,
  isEvidenceItem,
  validateAnswerResponse,
  validateCitation,
  validateEvidenceBundle,
  validateEvidenceConflictGroup,
  validateEvidenceItem,
} from "../src/policy/evidence-answer-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/evidence-answer-contract.json"), "utf8"),
);

test("EvidenceBundle and AnswerResponse fixtures cover empty evidence and all answer statuses", () => {
  assert.equal(fixture.schema_version, EVIDENCE_ANSWER_SCHEMA_VERSION);
  assert.equal(fixture.evidence_bundles.length, 2);
  assert.equal(fixture.responses.length, 6);

  for (const bundle of fixture.evidence_bundles) {
    assert.deepEqual(validateEvidenceBundle(bundle), { ok: true, value: bundle });
    assert.equal(isEvidenceBundle(bundle), true);
  }
  for (const response of fixture.responses) {
    assert.deepEqual(validateAnswerResponse(response), { ok: true, value: response });
    assert.equal(isAnswerResponse(response), true);
  }

  assert.deepEqual(
    new Set(fixture.responses.map(({ answer_status: status }) => status)),
    new Set(["answered", "uncertain", "refused", "error"]),
  );
  assert.deepEqual(
    new Set(fixture.responses.map(({ query_category: category }) => category)),
    new Set(["structured", "narrative", "version", "composite", "out_of_scope"]),
  );
});

test("evidence/answer schema documents required and optional fields", () => {
  assert.deepEqual(EVIDENCE_ANSWER_SCHEMA.evidenceBundle.required, EVIDENCE_BUNDLE_REQUIRED_FIELDS);
  assert.deepEqual(
    EVIDENCE_ANSWER_SCHEMA.evidenceBundle.item.required,
    EVIDENCE_ITEM_REQUIRED_FIELDS,
  );
  assert.deepEqual(
    EVIDENCE_ANSWER_SCHEMA.evidenceBundle.item.optional,
    EVIDENCE_ITEM_OPTIONAL_FIELDS,
  );
  assert.deepEqual(
    EVIDENCE_ANSWER_SCHEMA.evidenceBundle.conflictGroup.required,
    EVIDENCE_CONFLICT_GROUP_REQUIRED_FIELDS,
  );
  assert.deepEqual(EVIDENCE_BUNDLE_FIELDS, EVIDENCE_BUNDLE_REQUIRED_FIELDS);
  assert.deepEqual(EVIDENCE_ITEM_FIELDS, [
    ...EVIDENCE_ITEM_REQUIRED_FIELDS,
    ...EVIDENCE_ITEM_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(EVIDENCE_CONFLICT_GROUP_FIELDS, EVIDENCE_CONFLICT_GROUP_REQUIRED_FIELDS);
  assert.deepEqual(EVIDENCE_ANSWER_SCHEMA.answerResponse.required, ANSWER_RESPONSE_REQUIRED_FIELDS);
  assert.deepEqual(EVIDENCE_ANSWER_SCHEMA.answerResponse.optional, ANSWER_RESPONSE_OPTIONAL_FIELDS);
  assert.deepEqual(ANSWER_RESPONSE_FIELDS, [
    ...ANSWER_RESPONSE_REQUIRED_FIELDS,
    ...ANSWER_RESPONSE_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(EVIDENCE_ANSWER_SCHEMA.citation.required, CITATION_REQUIRED_FIELDS);
  assert.deepEqual(EVIDENCE_ANSWER_SCHEMA.citation.optional, CITATION_OPTIONAL_FIELDS);
  assert.equal(EVIDENCE_ANSWER_SCHEMA.evidenceBundle.invariants.emptyItemsAllowed, true);
});

test("evidence items validate source traceability, typed references, ranking, and support type", () => {
  for (const item of fixture.evidence_bundles[0].items) {
    assert.deepEqual(validateEvidenceItem(item), { ok: true, value: item });
    assert.equal(isEvidenceItem(item), true);
    assert.equal(assertEvidenceItem(item), item);
  }

  const invalid = {
    ...fixture.evidence_bundles[0].items[0],
    evidence_id: "src:not-evidence",
    source_kind: "unknown",
    source_url: "file:///tmp/source",
    source_retrieved_at: "not-a-date",
    fact_id: "claim:not-a-fact",
    rank: -1,
    support_type: "guessing",
  };
  const result = validateEvidenceItem(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_EVIDENCE_ID, path: "evidence_id" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_KIND, path: "source_kind" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_URL, path: "source_url" },
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_RETRIEVED_AT,
        path: "source_retrieved_at",
      },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_FACT_ID, path: "fact_id" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_RANK, path: "rank" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SUPPORT_TYPE, path: "support_type" },
    ],
  );
});

test("empty evidence bundles are valid and conflict groups require unique typed claims", () => {
  const emptyBundle = fixture.evidence_bundles[1];
  assert.equal(emptyBundle.items.length, 0);
  assert.equal(emptyBundle.conflict_groups.length, 0);
  assert.equal(isEvidenceBundle(emptyBundle), true);

  const group = fixture.evidence_bundles[0].conflict_groups[0];
  assert.deepEqual(validateEvidenceConflictGroup(group), { ok: true, value: group });
  assert.equal(isEvidenceConflictGroup(group), true);
  assert.equal(assertEvidenceConflictGroup(group), group);

  const invalid = {
    ...group,
    conflict_group_id: "claim:not-a-conflict-group",
    claim_ids: [group.claim_ids[0], group.claim_ids[0], "fact:not-a-claim"],
  };
  const result = validateEvidenceConflictGroup(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CONFLICT_GROUP_ID,
        path: "conflict_group_id",
      },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.DUPLICATE_CLAIM_ID, path: "claim_ids[1]" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CLAIM_ID, path: "claim_ids[2]" },
    ],
  );
});

test("EvidenceBundle rejects malformed nested values and duplicate evidence IDs", () => {
  const bundle = structuredClone(fixture.evidence_bundles[0]);
  bundle.items[1].evidence_id = bundle.items[0].evidence_id;
  bundle.items[1].unexpected = true;
  bundle.conflict_groups[0].claim_ids = [];
  const result = validateEvidenceBundle(bundle);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.UNKNOWN_FIELD, path: "items[1].unexpected" },
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.DUPLICATE_EVIDENCE_ID,
        path: "items[1].evidence_id",
      },
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CLAIM_IDS,
        path: "conflict_groups[0].claim_ids",
      },
    ],
  );
});

test("answered responses require citations while uncertain and refused responses require reasons", () => {
  const answered = structuredClone(fixture.responses[0]);
  answered.citations = [];
  const answeredResult = validateAnswerResponse(answered);
  assert.equal(answeredResult.ok, false);
  assert.deepEqual(answeredResult.errors, [
    {
      code: EVIDENCE_ANSWER_VALIDATION_CODES.ANSWERED_REQUIRES_CITATION,
      path: "citations",
      message: "answered responses must include at least one citation.",
    },
  ]);

  for (const index of [3, 4]) {
    const response = structuredClone(fixture.responses[index]);
    delete response.uncertainty_reason;
    const result = validateAnswerResponse(response);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.REASON_REQUIRED,
        path: "uncertainty_reason",
        message: "uncertain and refused responses must include uncertainty_reason.",
      },
    ]);
  }
});

test("AnswerResponse validates status/category/version/spoiler and rejects unknown fields", () => {
  const invalid = {
    ...fixture.responses[0],
    answer_status: "guessing",
    query_category: "other",
    version_scope: " ",
    uncertainty_reason: "maybe",
    spoiler_notice: "",
    trace_id: " trace ",
    extra: true,
  };
  const result = validateAnswerResponse(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.UNKNOWN_FIELD, path: "extra" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_ANSWER_STATUS, path: "answer_status" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_QUERY_CATEGORY, path: "query_category" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_VERSION_SCOPE, path: "version_scope" },
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_UNCERTAINTY_REASON,
        path: "uncertainty_reason",
      },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SPOILER_NOTICE, path: "spoiler_notice" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_TRACE_ID, path: "trace_id" },
    ],
  );
});

test("citations validate traceable source metadata and optional dates/versions", () => {
  const citation = fixture.responses[0].citations[0];
  assert.deepEqual(validateCitation(citation), { ok: true, value: citation });
  assert.equal(isCitation(citation), true);
  assert.equal(assertAnswerResponse(fixture.responses[0]), fixture.responses[0]);

  const invalid = {
    ...citation,
    source_url: "not-a-url",
    title: "",
    source_kind: "unknown",
    published_at: "2026-02-30T00:00:00Z",
    retrieved_at: "2026-08-21",
    game_version: null,
    extra: true,
  };
  const result = validateCitation(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.UNKNOWN_FIELD, path: "extra" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_URL, path: "source_url" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_TITLE, path: "title" },
      { code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_SOURCE_KIND, path: "source_kind" },
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_PUBLISHED_AT,
        path: "published_at",
      },
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_RETRIEVED_AT,
        path: "retrieved_at",
      },
      {
        code: EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_GAME_VERSION,
        path: "game_version",
      },
    ],
  );
});

test("contract assertions preserve object identity and do not mutate inputs", () => {
  const bundle = structuredClone(fixture.evidence_bundles[0]);
  const response = structuredClone(fixture.responses[0]);
  const before = { bundle: structuredClone(bundle), response: structuredClone(response) };

  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.equal(assertAnswerResponse(response), response);
  assert.deepEqual({ bundle, response }, before);
  assert.throws(() => assertEvidenceBundle({ query_id: "qry:missing" }), /items/);
  assert.throws(
    () => assertAnswerResponse({ ...response, answer_status: "uncertain", citations: [] }),
    /uncertainty_reason/,
  );
});
