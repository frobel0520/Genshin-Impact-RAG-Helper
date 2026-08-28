import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ANSWERABILITY,
  ANSWER_STATUSES,
  AUTHORITY_RANKS,
  DOMAIN_CONTRACT_FIXTURE,
  DOMAIN_ID_PREFIXES,
  compareGameVersions,
  parseGameVersion,
  ENTITY_TYPES,
  ERROR_CODES,
  QUERY_CATEGORIES,
  RETRIEVAL_MODES,
  SOURCE_KINDS,
  SPOILER_LEVELS,
  SUPPORT_TYPES,
  UNCERTAINTY_REASONS,
  VALIDITY_STATUSES,
  VERSION_CONSTRAINTS,
  VERSION_STATUSES,
  RUN_STATUSES,
  assertDomainId,
  createDomainId,
  isDomainId,
} from "../src/domain/domain-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("domain enums match the versioned fixture", () => {
  const fixture = JSON.parse(
    readFileSync(resolve(PROJECT_ROOT, "fixtures/domain-contract.json"), "utf8"),
  );

  assert.deepEqual(fixture.entity_types, DOMAIN_CONTRACT_FIXTURE.entityTypes);
  assert.deepEqual(fixture.source_kinds, DOMAIN_CONTRACT_FIXTURE.sourceKinds);
  assert.deepEqual(fixture.answer_statuses, DOMAIN_CONTRACT_FIXTURE.answerStatuses);
  assert.deepEqual(fixture.version_statuses, DOMAIN_CONTRACT_FIXTURE.versionStatuses);
  assert.deepEqual(fixture.validity_statuses, DOMAIN_CONTRACT_FIXTURE.validityStatuses);
  assert.deepEqual(fixture.query_categories, DOMAIN_CONTRACT_FIXTURE.queryCategories);
  assert.deepEqual(fixture.version_constraints, DOMAIN_CONTRACT_FIXTURE.versionConstraints);
  assert.deepEqual(fixture.retrieval_modes, DOMAIN_CONTRACT_FIXTURE.retrievalModes);
  assert.deepEqual(fixture.spoiler_levels, DOMAIN_CONTRACT_FIXTURE.spoilerLevels);
  assert.deepEqual(fixture.support_types, DOMAIN_CONTRACT_FIXTURE.supportTypes);
  assert.deepEqual(fixture.answerability, DOMAIN_CONTRACT_FIXTURE.answerability);
  assert.deepEqual(fixture.uncertainty_reasons, DOMAIN_CONTRACT_FIXTURE.uncertaintyReasons);
  assert.deepEqual(fixture.run_statuses, DOMAIN_CONTRACT_FIXTURE.runStatuses);
  assert.deepEqual(fixture.error_codes, DOMAIN_CONTRACT_FIXTURE.errorCodes);
  assert.deepEqual(fixture.authority_ranks, AUTHORITY_RANKS);
  assert.deepEqual(fixture.id_prefixes, DOMAIN_ID_PREFIXES);
});

test("domain enum values are unique and frozen", () => {
  for (const enumObject of [
    ENTITY_TYPES,
    SOURCE_KINDS,
    ANSWER_STATUSES,
    VERSION_STATUSES,
    VALIDITY_STATUSES,
    QUERY_CATEGORIES,
    VERSION_CONSTRAINTS,
    RETRIEVAL_MODES,
    SPOILER_LEVELS,
    SUPPORT_TYPES,
    ANSWERABILITY,
    UNCERTAINTY_REASONS,
    RUN_STATUSES,
    ERROR_CODES,
  ]) {
    const values = Object.values(enumObject);
    assert.equal(new Set(values).size, values.length);
    assert.equal(Object.isFrozen(enumObject), true);
  }
});

test("domain IDs are stable, typed, and validated", () => {
  const entityId = createDomainId("entity", "Raiden Shogun");
  assert.equal(entityId, "ent:raiden-shogun");
  assert.equal(createDomainId("entity", "Raiden Shogun"), entityId);
  assert.equal(isDomainId(entityId), true);
  assert.equal(isDomainId(entityId, "entity"), true);
  assert.equal(isDomainId(entityId, "source"), false);
  assert.equal(assertDomainId(entityId, "entity"), entityId);
  assert.throws(() => createDomainId("unknown", "value"), /Unknown domain ID kind/);
  assert.throws(() => createDomainId("entity"), /key is required/);
  assert.throws(() => createDomainId("entity", "---"), /alphanumeric character/);
  assert.throws(() => assertDomainId("bad-id", "entity"), /Invalid domain ID/);
});

test("game versions parse into comparable explicit, range, and unknown descriptors", () => {
  assert.deepEqual(parseGameVersion("5.0"), {
    status: "explicit",
    min: [5, 0],
    max: [5, 0],
  });
  assert.deepEqual(parseGameVersion("3.0-3.8"), {
    status: "range",
    min: [3, 0],
    max: [3, 8],
  });
  assert.deepEqual(parseGameVersion("3.0 to 3.8"), {
    status: "range",
    min: [3, 0],
    max: [3, 8],
  });

  for (const value of ["unknown", "", "  5.0", "5.x", "3.8-3.0", 5, null, undefined]) {
    assert.equal(parseGameVersion(value).status, "unknown", String(value));
  }

  assert.ok(compareGameVersions("5.1", "5.0") > 0);
  assert.ok(compareGameVersions("4.8", "5.0") < 0);
  assert.equal(compareGameVersions("5.0", "5.0.0"), 0);
  assert.equal(compareGameVersions("5.0", "unknown"), undefined);
  assert.equal(compareGameVersions("3.0-3.8", "3.4"), undefined);
});
