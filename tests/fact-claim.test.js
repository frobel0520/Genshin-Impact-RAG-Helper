import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CLAIM_REQUIRED_FIELDS,
  CONFLICT_GROUP_REQUIRED_FIELDS,
  FACT_CLAIM_SCHEMA,
  FACT_CLAIM_SCHEMA_VERSION,
  FACT_CLAIM_VALIDATION_CODES,
  STRUCTURED_FACT_REQUIRED_FIELDS,
  assertClaim,
  assertConflictGroup,
  assertStructuredFact,
  authorityRankForSourceKind,
  buildConflictGroups,
  claimsShareScope,
  classifyGameVersion,
  compareClaims,
  createConflictGroupId,
  getClaimScopeKey,
  hasMatchingAuthorityRank,
  isClaim,
  isConflictGroup,
  isStructuredFact,
  sortClaims,
  validateClaim,
  validateConflictGroup,
  validateStructuredFact,
} from "../src/data/fact-claim-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/fact-claim.json"), "utf8"),
);

test("StructuredFact, Claim, and Conflict fixtures are valid", () => {
  assert.equal(fixture.schema_version, FACT_CLAIM_SCHEMA_VERSION);
  assert.equal(fixture.structured_facts.length, 3);
  assert.equal(fixture.claims.length, 3);
  assert.equal(fixture.conflict_groups.length, 1);

  for (const fact of fixture.structured_facts) {
    assert.deepEqual(validateStructuredFact(fact), { ok: true, value: fact });
    assert.equal(isStructuredFact(fact), true);
  }
  for (const claim of fixture.claims) {
    assert.deepEqual(validateClaim(claim), { ok: true, value: claim });
    assert.equal(isClaim(claim), true);
  }
  for (const group of fixture.conflict_groups) {
    assert.deepEqual(validateConflictGroup(group), { ok: true, value: group });
    assert.equal(isConflictGroup(group), true);
  }
});

test("fact/claim schema keeps required fields and JSON value rules explicit", () => {
  assert.deepEqual(FACT_CLAIM_SCHEMA.structuredFact.required, STRUCTURED_FACT_REQUIRED_FIELDS);
  assert.deepEqual(FACT_CLAIM_SCHEMA.claim.required, CLAIM_REQUIRED_FIELDS);
  assert.deepEqual(FACT_CLAIM_SCHEMA.conflictGroup.required, CONFLICT_GROUP_REQUIRED_FIELDS);
  assert.deepEqual(FACT_CLAIM_SCHEMA.structuredFact, {
    required: STRUCTURED_FACT_REQUIRED_FIELDS,
    value: "JSON value",
    unit: "string|null",
  });
  assert.equal(FACT_CLAIM_SCHEMA.claim.conflictGroupId, "conflict:<stable-key>|null");
});

test("version status distinguishes explicit, range, and unknown without guessing latest", () => {
  assert.equal(classifyGameVersion("5.0"), "explicit");
  assert.equal(classifyGameVersion("3.0-3.8"), "range");
  assert.equal(classifyGameVersion("unknown"), "unknown");
  assert.equal(classifyGameVersion("   "), undefined);
  assert.equal(fixture.structured_facts[1].game_version, "unknown");
});

test("authority rank is fixed by source kind and lower rank sorts first", () => {
  const sourceKinds = new Map(
    fixture.source_metadata.map((source) => [source.source_id, source.source_kind]),
  );
  for (const claim of fixture.claims) {
    assert.equal(
      hasMatchingAuthorityRank(sourceKinds.get(claim.source_id), claim.authority_rank),
      true,
    );
    assert.equal(
      authorityRankForSourceKind(sourceKinds.get(claim.source_id)),
      claim.authority_rank,
    );
  }

  const sorted = sortClaims(fixture.claims, fixture.source_metadata);
  assert.deepEqual(
    sorted.map((claim) => claim.claim_id),
    [
      "claim:kamisato-ayaka-burst-official",
      "claim:kamisato-ayaka-burst-wiki",
      "claim:kamisato-ayaka-story-title",
    ],
  );
  assert.equal(compareClaims(sorted[0], sorted[1], fixture.source_metadata) < 0, true);
  assert.throws(() => authorityRankForSourceKind("unknown-source"), /Unknown source kind/);
});

test("same claim scope is version-sensitive and conflict groups are deterministic", () => {
  const [official, wiki] = fixture.claims.slice(1);
  assert.equal(claimsShareScope(official, wiki), true);
  assert.equal(
    getClaimScopeKey(official),
    JSON.stringify(["elemental_burst_name", "ent:kamisato-ayaka", "5.0"]),
  );
  assert.deepEqual(buildConflictGroups(fixture.claims), fixture.conflict_groups);
  assert.equal(
    buildConflictGroups([
      { ...official, claim_text: "相同主張" },
      { ...wiki, claim_text: "相同主張", conflict_group_id: null },
    ]).length,
    0,
  );
  assert.equal(
    createConflictGroupId("Kamisato Ayaka / burst name"),
    "conflict:kamisato-ayaka-burst-name",
  );
  assert.throws(() => createConflictGroupId("---"), /alphanumeric character/);
});

test("StructuredFact rejects invalid IDs, validity, and non-JSON values", () => {
  const cyclic = {};
  cyclic.self = cyclic;
  const invalid = {
    ...fixture.structured_facts[0],
    fact_id: "claim:not-a-fact",
    entity_id: "src:not-an-entity",
    validity: "current",
    value: cyclic,
  };

  const result = validateStructuredFact(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: FACT_CLAIM_VALIDATION_CODES.INVALID_FACT_ID, path: "fact_id" },
      { code: FACT_CLAIM_VALIDATION_CODES.INVALID_ENTITY_ID, path: "entity_id" },
      { code: FACT_CLAIM_VALIDATION_CODES.INVALID_VALUE, path: "value" },
      { code: FACT_CLAIM_VALIDATION_CODES.INVALID_VALIDITY, path: "validity" },
    ],
  );
});

test("Claim and ConflictGroup enforce authority, stable IDs, and unique membership", () => {
  const invalidClaim = {
    ...fixture.claims[0],
    authority_rank: 4,
    conflict_group_id: "group-1",
    unexpected: true,
  };
  const claimResult = validateClaim(invalidClaim);
  assert.equal(claimResult.ok, false);
  assert.deepEqual(
    claimResult.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: FACT_CLAIM_VALIDATION_CODES.UNKNOWN_FIELD, path: "unexpected" },
      { code: FACT_CLAIM_VALIDATION_CODES.INVALID_AUTHORITY_RANK, path: "authority_rank" },
      { code: FACT_CLAIM_VALIDATION_CODES.INVALID_CONFLICT_GROUP_ID, path: "conflict_group_id" },
    ],
  );

  const duplicateGroup = {
    ...fixture.conflict_groups[0],
    claim_ids: [fixture.claims[1].claim_id, fixture.claims[1].claim_id],
  };
  const groupResult = validateConflictGroup(duplicateGroup);
  assert.equal(groupResult.ok, false);
  assert.deepEqual(groupResult.errors, [
    {
      code: FACT_CLAIM_VALIDATION_CODES.DUPLICATE_CLAIM_ID,
      path: "claim_ids[1]",
      message: "claim_ids must be unique.",
    },
  ]);
});

test("fact/claim assertions are non-mutating and preserve valid object identity", () => {
  const fact = structuredClone(fixture.structured_facts[0]);
  const claim = structuredClone(fixture.claims[0]);
  const group = structuredClone(fixture.conflict_groups[0]);
  const before = {
    fact: structuredClone(fact),
    claim: structuredClone(claim),
    group: structuredClone(group),
  };

  assert.equal(assertStructuredFact(fact), fact);
  assert.equal(assertClaim(claim), claim);
  assert.equal(assertConflictGroup(group), group);
  assert.deepEqual({ fact, claim, group }, before);
  assert.throws(
    () => assertClaim({ ...claim, claim_id: "bad" }),
    /claim_id: claim_id must be a typed claim domain ID/,
  );
});
