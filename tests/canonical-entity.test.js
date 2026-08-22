import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CANONICAL_ENTITY_REQUIRED_FIELDS,
  CANONICAL_ENTITY_SCHEMA_VERSION,
  ENTITY_CONTRACT_SCHEMA,
  ENTITY_CONTRACT_VALIDATION_CODES,
  ENTITY_RESOLUTION_OPTIONAL_FIELDS,
  ENTITY_RESOLUTION_REQUIRED_FIELDS,
  ENTITY_RESOLUTION_STATUSES,
  assertCanonicalEntity,
  assertEntityResolution,
  isCanonicalEntity,
  isEntityResolution,
  validateCanonicalEntity,
  validateEntityResolution,
} from "../src/data/canonical-entity-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/canonical-entity.json"), "utf8"),
);

test("CanonicalEntity and resolution fixtures are valid", () => {
  assert.equal(fixture.schema_version, CANONICAL_ENTITY_SCHEMA_VERSION);
  assert.equal(fixture.canonical_entities.length, 3);
  assert.deepEqual(
    new Set(fixture.canonical_entities.map((entity) => entity.entity_type)),
    new Set(["character", "weapon", "region"]),
  );

  for (const entity of fixture.canonical_entities) {
    assert.deepEqual(validateCanonicalEntity(entity), { ok: true, value: entity });
    assert.equal(isCanonicalEntity(entity), true);
  }

  for (const resolution of fixture.resolution_examples) {
    assert.deepEqual(validateEntityResolution(resolution), { ok: true, value: resolution });
    assert.equal(isEntityResolution(resolution), true);
  }

  assert.equal(fixture.resolution_examples[1].resolution_status, "unrecognized");
  assert.equal(fixture.resolution_examples[1].entity_id, null);
  assert.equal(fixture.resolution_examples[1].entity_type, null);
});

test("entity schema fields and alias rules are explicit", () => {
  assert.deepEqual(
    ENTITY_CONTRACT_SCHEMA.canonicalEntity.required,
    CANONICAL_ENTITY_REQUIRED_FIELDS,
  );
  assert.deepEqual(
    ENTITY_CONTRACT_SCHEMA.entityResolution.required,
    ENTITY_RESOLUTION_REQUIRED_FIELDS,
  );
  assert.deepEqual(
    ENTITY_CONTRACT_SCHEMA.entityResolution.optional,
    ENTITY_RESOLUTION_OPTIONAL_FIELDS,
  );
  assert.deepEqual(ENTITY_CONTRACT_SCHEMA.canonicalEntity.aliases, {
    type: "string[]",
    unique: true,
    allowEmpty: true,
  });
  assert.deepEqual(Object.values(ENTITY_RESOLUTION_STATUSES), ["resolved", "unrecognized"]);
});

test("CanonicalEntity requires a typed ID, supported type, name, aliases, and locale", () => {
  const invalid = { ...fixture.canonical_entities[0] };
  delete invalid.canonical_name;
  invalid.entity_id = "src:not-an-entity";
  invalid.entity_type = "character_unknown";
  invalid.aliases = [];
  invalid.locale = "";

  const result = validateCanonicalEntity(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: ENTITY_CONTRACT_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "canonical_name" },
      { code: ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_ID, path: "entity_id" },
      { code: ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_TYPE, path: "entity_type" },
      { code: ENTITY_CONTRACT_VALIDATION_CODES.INVALID_LOCALE, path: "locale" },
    ],
  );
});

test("aliases are non-empty strings and unique without case differences", () => {
  const result = validateCanonicalEntity({
    ...fixture.canonical_entities[0],
    aliases: ["Ayaka", "ayaka", ""],
    extra: true,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: ENTITY_CONTRACT_VALIDATION_CODES.UNKNOWN_FIELD, path: "extra" },
      { code: ENTITY_CONTRACT_VALIDATION_CODES.DUPLICATE_ALIAS, path: "aliases[1]" },
      { code: ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ALIAS, path: "aliases[2]" },
    ],
  );
});

test("resolved and unrecognized entity resolution states are mutually explicit", () => {
  const resolved = { ...fixture.resolution_examples[0] };
  const missingId = { ...resolved, entity_id: null };
  const missingIdResult = validateEntityResolution(missingId);
  assert.equal(missingIdResult.ok, false);
  assert.equal(
    missingIdResult.errors[0].code,
    ENTITY_CONTRACT_VALIDATION_CODES.RESOLVED_ENTITY_ID_REQUIRED,
  );

  const unrecognizedWithIdentity = {
    ...fixture.resolution_examples[1],
    entity_id: "ent:kamisato-ayaka",
    entity_type: "character",
  };
  const unrecognizedResult = validateEntityResolution(unrecognizedWithIdentity);
  assert.equal(unrecognizedResult.ok, false);
  assert.deepEqual(
    unrecognizedResult.errors.map(({ code, path }) => ({ code, path })),
    [
      {
        code: ENTITY_CONTRACT_VALIDATION_CODES.UNRECOGNIZED_ENTITY_ID_FORBIDDEN,
        path: "entity_id",
      },
      {
        code: ENTITY_CONTRACT_VALIDATION_CODES.UNRECOGNIZED_ENTITY_TYPE_FORBIDDEN,
        path: "entity_type",
      },
    ],
  );
});

test("entity contract validation is non-mutating and assertion helpers preserve identity", () => {
  const entity = {
    ...fixture.canonical_entities[0],
    aliases: [...fixture.canonical_entities[0].aliases],
  };
  const resolution = {
    ...fixture.resolution_examples[0],
    aliases_used: [...fixture.resolution_examples[0].aliases_used],
  };
  const entityBefore = structuredClone(entity);
  const resolutionBefore = structuredClone(resolution);

  assert.equal(assertCanonicalEntity(entity), entity);
  assert.equal(assertEntityResolution(resolution), resolution);
  assert.deepEqual(entity, entityBefore);
  assert.deepEqual(resolution, resolutionBefore);
  assert.throws(
    () => assertCanonicalEntity({ ...entity, entity_id: "bad" }),
    /entity_id: entity_id must be a typed entity domain ID/,
  );
});
