import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTHORITY_RANKS,
  ENTITY_TYPES,
  SOURCE_KINDS,
  VALIDITY_STATUSES,
  isDomainId,
} from "../domain/domain-contract.js";
import {
  assertValid,
  createError,
  invalidDocumentResult,
  isHttpUrl,
  isIsoDateTime,
  isJsonValue,
  isNonEmptyString,
  isRecord,
  isStableString,
  prefixErrors,
} from "../domain/contract-validation.js";

export const FIXTURE_SOURCE_PACK_SCHEMA_VERSION = 1;

export const FIXTURE_SOURCE_PACK_REQUIRED_FIELDS = Object.freeze([
  "source_documents",
  "canonical_entities",
  "structured_facts",
  "claims",
  "conflict_groups",
  "document_chunks",
]);

export const FIXTURE_SOURCE_PACK_OPTIONAL_FIELDS = Object.freeze([
  "schema_version",
  "test_scenarios",
]);

export const FIXTURE_SOURCE_PACK_FIELDS = Object.freeze([
  ...FIXTURE_SOURCE_PACK_REQUIRED_FIELDS,
  ...FIXTURE_SOURCE_PACK_OPTIONAL_FIELDS,
]);

export const FIXTURE_SOURCE_PACK_VALIDATION_CODES = Object.freeze({
  INVALID_PACK: "invalid_pack",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_SCHEMA_VERSION: "invalid_schema_version",
  INVALID_SOURCE_DOCUMENTS: "invalid_source_documents",
  INVALID_CANONICAL_ENTITIES: "invalid_canonical_entities",
  INVALID_STRUCTURED_FACTS: "invalid_structured_facts",
  INVALID_CLAIMS: "invalid_claims",
  INVALID_CONFLICT_GROUPS: "invalid_conflict_groups",
  INVALID_DOCUMENT_CHUNKS: "invalid_document_chunks",
  DUPLICATE_ID: "duplicate_id",
  UNRESOLVED_REFERENCE: "unresolved_reference",
  INVALID_AUTHORITY_RANK: "invalid_authority_rank",
  INVALID_TEST_SCENARIOS: "invalid_test_scenarios",
});

const FIXTURE_SOURCE_PACK_FIELD_SET = new Set(FIXTURE_SOURCE_PACK_FIELDS);
const SOURCE_KIND_VALUES = new Set(Object.values(SOURCE_KINDS));
const ENTITY_TYPE_VALUES = new Set(Object.values(ENTITY_TYPES));
const VALIDITY_STATUS_VALUES = new Set(Object.values(VALIDITY_STATUSES));
const AUTHORITY_RANK_VALUES = new Set(Object.values(AUTHORITY_RANKS));
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const CONFLICT_GROUP_ID_PATTERN = /^conflict:[a-z0-9][a-z0-9._-]*$/;

/** @typedef {import("../domain/contract-validation.js").ValidationResult} ValidationResult */

/**
 * Validate the complete fixture source pack including schema, envelope, and
 * cross-record referential integrity (sources, entities, claims, conflict groups).
 *
 * @param {unknown} pack
 * @returns {ValidationResult}
 */
export function validateFixtureSourcePack(pack) {
  if (!isRecord(pack)) {
    return invalidDocumentResult(
      FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_PACK,
      "Fixture source pack must be a plain object.",
    );
  }

  const errors = [];

  for (const field of Object.keys(pack)) {
    if (!FIXTURE_SOURCE_PACK_FIELD_SET.has(field)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown fixture source pack field: ${field}.`,
        ),
      );
    }
  }

  for (const field of FIXTURE_SOURCE_PACK_REQUIRED_FIELDS) {
    if (pack[field] === undefined || pack[field] === null) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required fixture source pack field is missing: ${field}.`,
        ),
      );
    }
  }

  if (
    pack.schema_version !== undefined &&
    pack.schema_version !== FIXTURE_SOURCE_PACK_SCHEMA_VERSION
  ) {
    errors.push(
      createError(
        FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_SCHEMA_VERSION,
        "schema_version",
        `schema_version must be ${FIXTURE_SOURCE_PACK_SCHEMA_VERSION} when present.`,
      ),
    );
  }

  const knownSourceIds = new Set();
  const knownEntityIds = new Set();
  const knownClaimIds = new Set();
  const knownConflictGroupIds = new Set();

  if (pack.source_documents !== undefined && pack.source_documents !== null) {
    if (!Array.isArray(pack.source_documents)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_SOURCE_DOCUMENTS,
          "source_documents",
          "source_documents must be an array.",
        ),
      );
    } else {
      validatePackSourceDocuments(pack.source_documents, knownSourceIds, errors);
    }
  }

  if (pack.canonical_entities !== undefined && pack.canonical_entities !== null) {
    if (!Array.isArray(pack.canonical_entities)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CANONICAL_ENTITIES,
          "canonical_entities",
          "canonical_entities must be an array.",
        ),
      );
    } else {
      validatePackCanonicalEntities(pack.canonical_entities, knownEntityIds, errors);
    }
  }

  if (pack.structured_facts !== undefined && pack.structured_facts !== null) {
    if (!Array.isArray(pack.structured_facts)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_STRUCTURED_FACTS,
          "structured_facts",
          "structured_facts must be an array.",
        ),
      );
    } else {
      validatePackStructuredFacts(
        pack.structured_facts,
        knownSourceIds,
        knownEntityIds,
        errors,
      );
    }
  }

  if (pack.claims !== undefined && pack.claims !== null) {
    if (!Array.isArray(pack.claims)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CLAIMS,
          "claims",
          "claims must be an array.",
        ),
      );
    } else {
      validatePackClaims(
        pack.claims,
        knownSourceIds,
        knownEntityIds,
        knownClaimIds,
        errors,
      );
    }
  }

  if (pack.conflict_groups !== undefined && pack.conflict_groups !== null) {
    if (!Array.isArray(pack.conflict_groups)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CONFLICT_GROUPS,
          "conflict_groups",
          "conflict_groups must be an array.",
        ),
      );
    } else {
      validatePackConflictGroups(
        pack.conflict_groups,
        knownClaimIds,
        knownConflictGroupIds,
        errors,
      );
    }
  }

  if (pack.document_chunks !== undefined && pack.document_chunks !== null) {
    if (!Array.isArray(pack.document_chunks)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_DOCUMENT_CHUNKS,
          "document_chunks",
          "document_chunks must be an array.",
        ),
      );
    } else {
      validatePackDocumentChunks(
        pack.document_chunks,
        knownSourceIds,
        knownEntityIds,
        errors,
      );
    }
  }

  if (pack.test_scenarios !== undefined && pack.test_scenarios !== null) {
    if (!isRecord(pack.test_scenarios)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_TEST_SCENARIOS,
          "test_scenarios",
          "test_scenarios must be a plain object when present.",
        ),
      );
    }
  }

  return errors.length === 0
    ? { ok: true, value: pack }
    : { ok: false, errors };
}

/**
 * @param {unknown} pack
 * @returns {boolean}
 */
export function isFixtureSourcePack(pack) {
  return validateFixtureSourcePack(pack).ok;
}

/**
 * @param {unknown} pack
 * @returns {unknown}
 * @throws {TypeError} when validation fails
 */
export function assertFixtureSourcePack(pack) {
  return assertValid(validateFixtureSourcePack(pack), "Fixture source pack");
}

/**
 * Load and validate the fixture source pack from disk.
 *
 * @param {string} [customPath]
 * @returns {object}
 */
export function loadFixtureSourcePack(customPath) {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const defaultPath = resolve(currentDir, "../../fixtures/fixture-source-pack.json");
  const filePath = customPath ? resolve(customPath) : defaultPath;

  const rawJson = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(rawJson);
  return assertFixtureSourcePack(parsed);
}

/**
 * Build in-memory lookup indexes for fast testing and retrieval setup.
 *
 * @param {object} pack
 * @returns {{
 *   sourceDocumentsById: Map<string, object>,
 *   canonicalEntitiesById: Map<string, object>,
 *   structuredFactsById: Map<string, object>,
 *   claimsById: Map<string, object>,
 *   conflictGroupsById: Map<string, object>,
 *   documentChunksById: Map<string, object>,
 * }}
 */
export function createSourcePackIndexes(pack) {
  const validatedPack = assertFixtureSourcePack(pack);

  return Object.freeze({
    sourceDocumentsById: new Map(
      validatedPack.source_documents.map((doc) => [doc.source_id, doc]),
    ),
    canonicalEntitiesById: new Map(
      validatedPack.canonical_entities.map((entity) => [entity.entity_id, entity]),
    ),
    structuredFactsById: new Map(
      validatedPack.structured_facts.map((fact) => [fact.fact_id, fact]),
    ),
    claimsById: new Map(
      validatedPack.claims.map((claim) => [claim.claim_id, claim]),
    ),
    conflictGroupsById: new Map(
      validatedPack.conflict_groups.map((group) => [group.conflict_group_id, group]),
    ),
    documentChunksById: new Map(
      validatedPack.document_chunks.map((chunk) => [chunk.chunk_id, chunk]),
    ),
  });
}

function validatePackSourceDocuments(documents, knownSourceIds, errors) {
  const seenUrls = new Map();

  for (const [index, doc] of documents.entries()) {
    const pathPrefix = `source_documents[${index}]`;
    if (!isRecord(doc)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_SOURCE_DOCUMENTS,
          pathPrefix,
          "SourceDocument must be a plain object.",
        ),
      );
      continue;
    }

    if (doc.source_id !== undefined) {
      if (!isDomainId(doc.source_id, "source")) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_SOURCE_DOCUMENTS,
            `${pathPrefix}.source_id`,
            "source_id must be a typed source domain ID (src:<key>).",
          ),
        );
      } else if (knownSourceIds.has(doc.source_id)) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.DUPLICATE_ID,
            `${pathPrefix}.source_id`,
            `Duplicate source_id: ${doc.source_id}.`,
          ),
        );
      } else {
        knownSourceIds.add(doc.source_id);
      }
    }

    if (
      doc.source_kind !== undefined &&
      (typeof doc.source_kind !== "string" || !SOURCE_KIND_VALUES.has(doc.source_kind))
    ) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_SOURCE_DOCUMENTS,
          `${pathPrefix}.source_kind`,
          `source_kind must be one of: ${[...SOURCE_KIND_VALUES].join(", ")}.`,
        ),
      );
    }

    if (doc.source_url !== undefined && !isHttpUrl(doc.source_url)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_SOURCE_DOCUMENTS,
          `${pathPrefix}.source_url`,
          "source_url must be an absolute http or https URL.",
        ),
      );
    }

    if (doc.content_hash !== undefined && !SHA256_HEX_PATTERN.test(doc.content_hash)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_SOURCE_DOCUMENTS,
          `${pathPrefix}.content_hash`,
          "content_hash must be a lowercase SHA-256 hexadecimal digest.",
        ),
      );
    }
  }
}

function validatePackCanonicalEntities(entities, knownEntityIds, errors) {
  for (const [index, entity] of entities.entries()) {
    const pathPrefix = `canonical_entities[${index}]`;
    if (!isRecord(entity)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CANONICAL_ENTITIES,
          pathPrefix,
          "CanonicalEntity must be a plain object.",
        ),
      );
      continue;
    }

    if (entity.entity_id !== undefined) {
      if (!isDomainId(entity.entity_id, "entity")) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CANONICAL_ENTITIES,
            `${pathPrefix}.entity_id`,
            "entity_id must be a typed entity domain ID (ent:<key>).",
          ),
        );
      } else if (knownEntityIds.has(entity.entity_id)) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.DUPLICATE_ID,
            `${pathPrefix}.entity_id`,
            `Duplicate entity_id: ${entity.entity_id}.`,
          ),
        );
      } else {
        knownEntityIds.add(entity.entity_id);
      }
    }

    if (
      entity.entity_type !== undefined &&
      (typeof entity.entity_type !== "string" || !ENTITY_TYPE_VALUES.has(entity.entity_type))
    ) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CANONICAL_ENTITIES,
          `${pathPrefix}.entity_type`,
          `entity_type must be one of: ${[...ENTITY_TYPE_VALUES].join(", ")}.`,
        ),
      );
    }
  }
}

function validatePackStructuredFacts(facts, knownSourceIds, knownEntityIds, errors) {
  const seenFactIds = new Set();

  for (const [index, fact] of facts.entries()) {
    const pathPrefix = `structured_facts[${index}]`;
    if (!isRecord(fact)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_STRUCTURED_FACTS,
          pathPrefix,
          "StructuredFact must be a plain object.",
        ),
      );
      continue;
    }

    if (fact.fact_id !== undefined) {
      if (!isDomainId(fact.fact_id, "fact")) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_STRUCTURED_FACTS,
            `${pathPrefix}.fact_id`,
            "fact_id must be a typed fact domain ID (fact:<key>).",
          ),
        );
      } else if (seenFactIds.has(fact.fact_id)) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.DUPLICATE_ID,
            `${pathPrefix}.fact_id`,
            `Duplicate fact_id: ${fact.fact_id}.`,
          ),
        );
      } else {
        seenFactIds.add(fact.fact_id);
      }
    }

    if (fact.source_id !== undefined && !knownSourceIds.has(fact.source_id)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE,
          `${pathPrefix}.source_id`,
          `source_id "${fact.source_id}" is not present in source_documents.`,
        ),
      );
    }

    if (fact.entity_id !== undefined && !knownEntityIds.has(fact.entity_id)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE,
          `${pathPrefix}.entity_id`,
          `entity_id "${fact.entity_id}" is not present in canonical_entities.`,
        ),
      );
    }

    if (
      fact.validity !== undefined &&
      (typeof fact.validity !== "string" || !VALIDITY_STATUS_VALUES.has(fact.validity))
    ) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_STRUCTURED_FACTS,
          `${pathPrefix}.validity`,
          `validity must be one of: ${[...VALIDITY_STATUS_VALUES].join(", ")}.`,
        ),
      );
    }
  }
}

function validatePackClaims(claims, knownSourceIds, knownEntityIds, knownClaimIds, errors) {
  for (const [index, claim] of claims.entries()) {
    const pathPrefix = `claims[${index}]`;
    if (!isRecord(claim)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CLAIMS,
          pathPrefix,
          "Claim must be a plain object.",
        ),
      );
      continue;
    }

    if (claim.claim_id !== undefined) {
      if (!isDomainId(claim.claim_id, "claim")) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CLAIMS,
            `${pathPrefix}.claim_id`,
            "claim_id must be a typed claim domain ID (claim:<key>).",
          ),
        );
      } else if (knownClaimIds.has(claim.claim_id)) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.DUPLICATE_ID,
            `${pathPrefix}.claim_id`,
            `Duplicate claim_id: ${claim.claim_id}.`,
          ),
        );
      } else {
        knownClaimIds.add(claim.claim_id);
      }
    }

    if (claim.source_id !== undefined && !knownSourceIds.has(claim.source_id)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE,
          `${pathPrefix}.source_id`,
          `source_id "${claim.source_id}" is not present in source_documents.`,
        ),
      );
    }

    if (claim.entity_id !== undefined && !knownEntityIds.has(claim.entity_id)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE,
          `${pathPrefix}.entity_id`,
          `entity_id "${claim.entity_id}" is not present in canonical_entities.`,
        ),
      );
    }

    if (
      claim.authority_rank !== undefined &&
      (!Number.isInteger(claim.authority_rank) || !AUTHORITY_RANK_VALUES.has(claim.authority_rank))
    ) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_AUTHORITY_RANK,
          `${pathPrefix}.authority_rank`,
          `authority_rank must be one of: ${[...AUTHORITY_RANK_VALUES].join(", ")}.`,
        ),
      );
    }
  }
}

function validatePackConflictGroups(groups, knownClaimIds, knownConflictGroupIds, errors) {
  for (const [index, group] of groups.entries()) {
    const pathPrefix = `conflict_groups[${index}]`;
    if (!isRecord(group)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CONFLICT_GROUPS,
          pathPrefix,
          "Conflict group must be a plain object.",
        ),
      );
      continue;
    }

    if (group.conflict_group_id !== undefined) {
      if (!isConflictGroupId(group.conflict_group_id)) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_CONFLICT_GROUPS,
            `${pathPrefix}.conflict_group_id`,
            "conflict_group_id must be conflict:<stable-key>.",
          ),
        );
      } else if (knownConflictGroupIds.has(group.conflict_group_id)) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.DUPLICATE_ID,
            `${pathPrefix}.conflict_group_id`,
            `Duplicate conflict_group_id: ${group.conflict_group_id}.`,
          ),
        );
      } else {
        knownConflictGroupIds.add(group.conflict_group_id);
      }
    }

    if (Array.isArray(group.claim_ids)) {
      for (const [claimIndex, claimId] of group.claim_ids.entries()) {
        if (!knownClaimIds.has(claimId)) {
          errors.push(
            createError(
              FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE,
              `${pathPrefix}.claim_ids[${claimIndex}]`,
              `claim_id "${claimId}" is not present in claims list.`,
            ),
          );
        }
      }
    }
  }
}

function validatePackDocumentChunks(chunks, knownSourceIds, knownEntityIds, errors) {
  const seenChunkIds = new Set();

  for (const [index, chunk] of chunks.entries()) {
    const pathPrefix = `document_chunks[${index}]`;
    if (!isRecord(chunk)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_DOCUMENT_CHUNKS,
          pathPrefix,
          "DocumentChunk must be a plain object.",
        ),
      );
      continue;
    }

    if (chunk.chunk_id !== undefined) {
      if (!isDomainId(chunk.chunk_id, "chunk")) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_DOCUMENT_CHUNKS,
            `${pathPrefix}.chunk_id`,
            "chunk_id must be a typed chunk domain ID (chunk:<key>).",
          ),
        );
      } else if (seenChunkIds.has(chunk.chunk_id)) {
        errors.push(
          createError(
            FIXTURE_SOURCE_PACK_VALIDATION_CODES.DUPLICATE_ID,
            `${pathPrefix}.chunk_id`,
            `Duplicate chunk_id: ${chunk.chunk_id}.`,
          ),
        );
      } else {
        seenChunkIds.add(chunk.chunk_id);
      }
    }

    if (chunk.source_id !== undefined && !knownSourceIds.has(chunk.source_id)) {
      errors.push(
        createError(
          FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE,
          `${pathPrefix}.source_id`,
          `source_id "${chunk.source_id}" is not present in source_documents.`,
        ),
      );
    }

    if (Array.isArray(chunk.entity_ids)) {
      for (const [entIndex, entityId] of chunk.entity_ids.entries()) {
        if (!knownEntityIds.has(entityId)) {
          errors.push(
            createError(
              FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE,
              `${pathPrefix}.entity_ids[${entIndex}]`,
              `entity_id "${entityId}" is not present in canonical_entities.`,
            ),
          );
        }
      }
    }
  }
}

function isConflictGroupId(value) {
  return typeof value === "string" && CONFLICT_GROUP_ID_PATTERN.test(value);
}
