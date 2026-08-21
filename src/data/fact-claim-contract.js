import {
  AUTHORITY_RANKS,
  ENTITY_TYPES,
  SOURCE_KINDS,
  VALIDITY_STATUSES,
  VERSION_STATUSES,
  isDomainId,
} from "../domain/domain-contract.js";

export const FACT_CLAIM_SCHEMA_VERSION = 1;

export const STRUCTURED_FACT_REQUIRED_FIELDS = Object.freeze([
  "fact_id",
  "entity_id",
  "field_key",
  "value",
  "unit",
  "game_version",
  "source_id",
  "validity",
]);

export const CLAIM_REQUIRED_FIELDS = Object.freeze([
  "claim_id",
  "claim_key",
  "entity_id",
  "claim_text",
  "game_version",
  "source_id",
  "authority_rank",
  "conflict_group_id",
]);

export const CONFLICT_GROUP_REQUIRED_FIELDS = Object.freeze([
  "conflict_group_id",
  "claim_ids",
]);

export const FACT_CLAIM_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_FACT_ID: "invalid_fact_id",
  INVALID_CLAIM_ID: "invalid_claim_id",
  INVALID_ENTITY_ID: "invalid_entity_id",
  INVALID_SOURCE_ID: "invalid_source_id",
  INVALID_FIELD_KEY: "invalid_field_key",
  INVALID_VALUE: "invalid_value",
  INVALID_UNIT: "invalid_unit",
  INVALID_GAME_VERSION: "invalid_game_version",
  INVALID_VALIDITY: "invalid_validity",
  INVALID_CLAIM_KEY: "invalid_claim_key",
  INVALID_CLAIM_TEXT: "invalid_claim_text",
  INVALID_AUTHORITY_RANK: "invalid_authority_rank",
  INVALID_CONFLICT_GROUP_ID: "invalid_conflict_group_id",
  INVALID_CLAIM_IDS: "invalid_claim_ids",
  DUPLICATE_CLAIM_ID: "duplicate_claim_id",
});

export const FACT_CLAIM_SCHEMA = Object.freeze({
  version: FACT_CLAIM_SCHEMA_VERSION,
  structuredFact: Object.freeze({
    required: STRUCTURED_FACT_REQUIRED_FIELDS,
    value: "JSON value",
    unit: "string|null",
  }),
  claim: Object.freeze({
    required: CLAIM_REQUIRED_FIELDS,
    conflictGroupId: "conflict:<stable-key>|null",
  }),
  conflictGroup: Object.freeze({
    required: CONFLICT_GROUP_REQUIRED_FIELDS,
    claimIds: "unique claim:<id>[]",
  }),
});

export const CONFLICT_GROUP_ID_PREFIX = "conflict";

const ENTITY_TYPE_VALUES = new Set(Object.values(ENTITY_TYPES));
const VALIDITY_STATUS_VALUES = new Set(Object.values(VALIDITY_STATUSES));
const AUTHORITY_RANK_VALUES = new Set(Object.values(AUTHORITY_RANKS));
const STRUCTURED_FACT_FIELD_SET = new Set(STRUCTURED_FACT_REQUIRED_FIELDS);
const CLAIM_FIELD_SET = new Set(CLAIM_REQUIRED_FIELDS);
const CONFLICT_GROUP_FIELD_SET = new Set(CONFLICT_GROUP_REQUIRED_FIELDS);
const CONFLICT_GROUP_ID_PATTERN = /^conflict:[a-z0-9][a-z0-9._-]*$/;
const VERSION_RANGE_PATTERN = /^\S+\s*(?:\.\.|-|–|—|to)\s*\S+$/iu;

export function validateStructuredFact(fact) {
  const errors = [];

  if (!isRecord(fact)) {
    return invalidDocumentResult("StructuredFact must be a plain object.");
  }

  collectUnknownFields(fact, STRUCTURED_FACT_FIELD_SET, errors);
  collectMissingFields(fact, STRUCTURED_FACT_REQUIRED_FIELDS, errors);

  if (fact.fact_id !== undefined && !isDomainId(fact.fact_id, "fact")) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_FACT_ID,
        "fact_id",
        "fact_id must be a typed fact domain ID (fact:<key>).",
      ),
    );
  }

  if (fact.entity_id !== undefined && !isDomainId(fact.entity_id, "entity")) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_ENTITY_ID,
        "entity_id",
        "entity_id must be a typed entity domain ID (ent:<key>).",
      ),
    );
  }

  if (fact.field_key !== undefined && !isKey(fact.field_key)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_FIELD_KEY,
        "field_key",
        "field_key must be a non-empty stable key without surrounding whitespace.",
      ),
    );
  }

  if (fact.value !== undefined && !isJsonValue(fact.value)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_VALUE,
        "value",
        "value must be JSON-compatible data.",
      ),
    );
  }

  if (fact.unit !== undefined && fact.unit !== null && !isName(fact.unit)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_UNIT,
        "unit",
        "unit must be a non-empty string or null.",
      ),
    );
  }

  if (fact.game_version !== undefined && !isGameVersion(fact.game_version)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_GAME_VERSION,
        "game_version",
        "game_version must be a non-empty string; use 'unknown' when unavailable.",
      ),
    );
  }

  if (
    fact.validity !== undefined &&
    (typeof fact.validity !== "string" || !VALIDITY_STATUS_VALUES.has(fact.validity))
  ) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_VALIDITY,
        "validity",
        `validity must be one of: ${[...VALIDITY_STATUS_VALUES].join(", ")}.`,
      ),
    );
  }

  if (fact.source_id !== undefined && !isDomainId(fact.source_id, "source")) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_SOURCE_ID,
        "source_id",
        "source_id must be a typed source domain ID (src:<key>).",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: fact } : { ok: false, errors };
}

export function validateClaim(claim) {
  const errors = [];

  if (!isRecord(claim)) {
    return invalidDocumentResult("Claim must be a plain object.");
  }

  collectUnknownFields(claim, CLAIM_FIELD_SET, errors);
  collectMissingFields(claim, CLAIM_REQUIRED_FIELDS, errors);

  if (claim.claim_id !== undefined && !isDomainId(claim.claim_id, "claim")) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_CLAIM_ID,
        "claim_id",
        "claim_id must be a typed claim domain ID (claim:<key>).",
      ),
    );
  }

  if (claim.claim_key !== undefined && !isKey(claim.claim_key)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_CLAIM_KEY,
        "claim_key",
        "claim_key must be a non-empty stable key without surrounding whitespace.",
      ),
    );
  }

  if (claim.entity_id !== undefined && !isDomainId(claim.entity_id, "entity")) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_ENTITY_ID,
        "entity_id",
        "entity_id must be a typed entity domain ID (ent:<key>).",
      ),
    );
  }

  if (claim.claim_text !== undefined && !isName(claim.claim_text)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_CLAIM_TEXT,
        "claim_text",
        "claim_text must be a non-empty string without surrounding whitespace.",
      ),
    );
  }

  if (claim.game_version !== undefined && !isGameVersion(claim.game_version)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_GAME_VERSION,
        "game_version",
        "game_version must be a non-empty string; use 'unknown' when unavailable.",
      ),
    );
  }

  if (claim.source_id !== undefined && !isDomainId(claim.source_id, "source")) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_SOURCE_ID,
        "source_id",
        "source_id must be a typed source domain ID (src:<key>).",
      ),
    );
  }

  if (
    claim.authority_rank !== undefined &&
    (!Number.isInteger(claim.authority_rank) || !AUTHORITY_RANK_VALUES.has(claim.authority_rank))
  ) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_AUTHORITY_RANK,
        "authority_rank",
        `authority_rank must be one of: ${[...AUTHORITY_RANK_VALUES].join(", ")}.`,
      ),
    );
  }

  if (
    claim.conflict_group_id !== undefined &&
    claim.conflict_group_id !== null &&
    !isConflictGroupId(claim.conflict_group_id)
  ) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_CONFLICT_GROUP_ID,
        "conflict_group_id",
        "conflict_group_id must be null or conflict:<stable-key>.",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: claim } : { ok: false, errors };
}

export function validateConflictGroup(group) {
  const errors = [];

  if (!isRecord(group)) {
    return invalidDocumentResult("Conflict group must be a plain object.");
  }

  collectUnknownFields(group, CONFLICT_GROUP_FIELD_SET, errors);
  collectMissingFields(group, CONFLICT_GROUP_REQUIRED_FIELDS, errors);

  if (group.conflict_group_id !== undefined && !isConflictGroupId(group.conflict_group_id)) {
    errors.push(
      createError(
        FACT_CLAIM_VALIDATION_CODES.INVALID_CONFLICT_GROUP_ID,
        "conflict_group_id",
        "conflict_group_id must be conflict:<stable-key>.",
      ),
    );
  }

  if (group.claim_ids !== undefined) {
    if (!Array.isArray(group.claim_ids) || group.claim_ids.length === 0) {
      errors.push(
        createError(
          FACT_CLAIM_VALIDATION_CODES.INVALID_CLAIM_IDS,
          "claim_ids",
          "claim_ids must be a non-empty array of typed claim IDs.",
        ),
      );
    } else {
      const seen = new Set();
      for (const [index, claimId] of group.claim_ids.entries()) {
        if (!isDomainId(claimId, "claim")) {
          errors.push(
            createError(
              FACT_CLAIM_VALIDATION_CODES.INVALID_CLAIM_ID,
              `claim_ids[${index}]`,
              "claim_ids entries must be typed claim domain IDs (claim:<key>).",
            ),
          );
        }
        if (seen.has(claimId)) {
          errors.push(
            createError(
              FACT_CLAIM_VALIDATION_CODES.DUPLICATE_CLAIM_ID,
              `claim_ids[${index}]`,
              "claim_ids must be unique.",
            ),
          );
        }
        seen.add(claimId);
      }
    }
  }

  return errors.length === 0 ? { ok: true, value: group } : { ok: false, errors };
}

export function isStructuredFact(fact) {
  return validateStructuredFact(fact).ok;
}

export function isClaim(claim) {
  return validateClaim(claim).ok;
}

export function isConflictGroup(group) {
  return validateConflictGroup(group).ok;
}

export function assertStructuredFact(fact) {
  return assertValid(validateStructuredFact(fact), "StructuredFact");
}

export function assertClaim(claim) {
  return assertValid(validateClaim(claim), "Claim");
}

export function assertConflictGroup(group) {
  return assertValid(validateConflictGroup(group), "Conflict group");
}

export function createConflictGroupId(key) {
  if (key === undefined || key === null) {
    throw new TypeError("Conflict group key is required.");
  }

  const normalizedKey = String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalizedKey) {
    throw new TypeError("Conflict group key must contain an alphanumeric character.");
  }

  return `${CONFLICT_GROUP_ID_PREFIX}:${normalizedKey}`;
}

export function isConflictGroupId(value) {
  return typeof value === "string" && CONFLICT_GROUP_ID_PATTERN.test(value);
}

export function classifyGameVersion(gameVersion) {
  if (!isGameVersion(gameVersion)) {
    return undefined;
  }
  if (gameVersion === "unknown") {
    return VERSION_STATUSES.UNKNOWN;
  }
  return VERSION_RANGE_PATTERN.test(gameVersion)
    ? VERSION_STATUSES.RANGE
    : VERSION_STATUSES.EXPLICIT;
}

export const getGameVersionStatus = classifyGameVersion;

export function authorityRankForSourceKind(sourceKind) {
  const rank = AUTHORITY_RANKS[sourceKind];
  if (rank === undefined) {
    throw new TypeError(`Unknown source kind: ${sourceKind}`);
  }
  return rank;
}

export function hasMatchingAuthorityRank(sourceKind, authorityRank) {
  return AUTHORITY_RANKS[sourceKind] === authorityRank;
}

export function getClaimScopeKey(claim) {
  if (!isRecord(claim)) {
    throw new TypeError("Claim is required to build a scope key.");
  }
  return JSON.stringify([claim.claim_key, claim.entity_id, claim.game_version]);
}

export function claimsShareScope(left, right) {
  return getClaimScopeKey(left) === getClaimScopeKey(right);
}

/**
 * Sort claims according to ADR-003: lower authority rank first, then newer
 * publication/retrieval timestamps, then stable IDs for deterministic ties.
 * sourceDocuments may be an array, Map, or object keyed by source_id.
 */
export function sortClaims(claims, sourceDocuments = []) {
  if (!Array.isArray(claims)) {
    throw new TypeError("claims must be an array.");
  }

  return [...claims].sort((left, right) => compareClaims(left, right, sourceDocuments));
}

export function compareClaims(left, right, sourceDocuments = []) {
  const authorityDifference = left.authority_rank - right.authority_rank;
  if (authorityDifference !== 0) {
    return authorityDifference;
  }

  const leftSource = findSourceDocument(sourceDocuments, left.source_id);
  const rightSource = findSourceDocument(sourceDocuments, right.source_id);

  const publishedDifference = compareTimestampsDescending(
    leftSource?.published_at,
    rightSource?.published_at,
  );
  if (publishedDifference !== 0) {
    return publishedDifference;
  }

  const retrievedDifference = compareTimestampsDescending(
    leftSource?.retrieved_at,
    rightSource?.retrieved_at,
  );
  if (retrievedDifference !== 0) {
    return retrievedDifference;
  }

  return String(left.claim_id).localeCompare(String(right.claim_id));
}

/**
 * Build conflict groups only for same-scope claims with differing text. The
 * function returns new group records and never mutates the input claims.
 */
export function buildConflictGroups(claims) {
  if (!Array.isArray(claims)) {
    throw new TypeError("claims must be an array.");
  }

  const scopedClaims = new Map();
  for (const claim of claims) {
    const scopeKey = getClaimScopeKey(claim);
    const scopeClaims = scopedClaims.get(scopeKey) ?? [];
    scopeClaims.push(claim);
    scopedClaims.set(scopeKey, scopeClaims);
  }

  const groups = [];
  for (const scopeClaims of scopedClaims.values()) {
    const distinctTexts = new Set(scopeClaims.map((claim) => claim.claim_text));
    if (scopeClaims.length < 2 || distinctTexts.size < 2) {
      continue;
    }

    const existingIds = scopeClaims
      .map((claim) => claim.conflict_group_id)
      .filter((groupId) => groupId !== null && groupId !== undefined);
    const conflictGroupId = existingIds[0] ?? createConflictGroupId(
      `${scopeClaims[0].entity_id}-${scopeClaims[0].claim_key}-${scopeClaims[0].game_version}`,
    );

    groups.push({
      conflict_group_id: conflictGroupId,
      claim_ids: [...new Set(scopeClaims.map((claim) => claim.claim_id))].sort(),
    });
  }

  return groups;
}

function compareTimestampsDescending(left, right) {
  const leftTime = toTimestamp(left);
  const rightTime = toTimestamp(right);
  if (leftTime === rightTime) {
    return 0;
  }
  if (leftTime === undefined) {
    return 1;
  }
  if (rightTime === undefined) {
    return -1;
  }
  return rightTime - leftTime;
}

function toTimestamp(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function findSourceDocument(sourceDocuments, sourceId) {
  if (sourceDocuments instanceof Map) {
    return sourceDocuments.get(sourceId);
  }
  if (Array.isArray(sourceDocuments)) {
    return sourceDocuments.find((document) => document?.source_id === sourceId);
  }
  if (isRecord(sourceDocuments)) {
    return sourceDocuments[sourceId];
  }
  return undefined;
}

function collectUnknownFields(value, allowedFields, errors) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      errors.push(
        createError(
          FACT_CLAIM_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown fact/claim contract field: ${field}.`,
        ),
      );
    }
  }
}

function collectMissingFields(value, fields, errors) {
  for (const field of fields) {
    if (value[field] === undefined) {
      errors.push(
        createError(
          FACT_CLAIM_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required fact/claim contract field is missing: ${field}.`,
        ),
      );
    }
  }
}

function invalidDocumentResult(message) {
  return {
    ok: false,
    errors: [
      createError(FACT_CLAIM_VALIDATION_CODES.INVALID_DOCUMENT, "$", message),
    ],
  };
}

function assertValid(result, label) {
  if (!result.ok) {
    const message = result.errors.map(({ path, message: detail }) => `${path}: ${detail}`).join(" ");
    throw new TypeError(`Invalid ${label}. ${message}`);
  }
  return result.value;
}

function createError(code, path, message) {
  return { code, path, message };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isName(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim() === value;
}

function isKey(value) {
  return isName(value) && !/\s/u.test(value);
}

function isGameVersion(value) {
  return isName(value);
}

function isJsonValue(value, ancestors = new Set()) {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  let valid;
  if (Array.isArray(value)) {
    valid = value.every((item) => isJsonValue(item, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    valid =
      (prototype === Object.prototype || prototype === null) &&
      Object.values(value).every((item) => isJsonValue(item, ancestors));
  }
  ancestors.delete(value);
  return valid;
}
