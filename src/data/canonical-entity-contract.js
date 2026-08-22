import { ENTITY_TYPES, isDomainId } from "../domain/domain-contract.js";
import {
  assertValid,
  createError,
  invalidDocumentResult,
  isRecord,
  isStableString,
} from "../domain/contract-validation.js";

export const CANONICAL_ENTITY_SCHEMA_VERSION = 1;

export const ENTITY_RESOLUTION_STATUSES = Object.freeze({
  RESOLVED: "resolved",
  UNRECOGNIZED: "unrecognized",
});

export const CANONICAL_ENTITY_REQUIRED_FIELDS = Object.freeze([
  "entity_id",
  "entity_type",
  "canonical_name",
  "aliases",
  "locale",
]);

export const CANONICAL_ENTITY_FIELDS = CANONICAL_ENTITY_REQUIRED_FIELDS;

export const ENTITY_RESOLUTION_REQUIRED_FIELDS = Object.freeze([
  "text",
  "locale",
  "aliases_used",
  "resolution_status",
]);

export const ENTITY_RESOLUTION_OPTIONAL_FIELDS = Object.freeze([
  "entity_id",
  "entity_type",
]);

export const ENTITY_RESOLUTION_FIELDS = Object.freeze([
  ...ENTITY_RESOLUTION_REQUIRED_FIELDS,
  ...ENTITY_RESOLUTION_OPTIONAL_FIELDS,
]);

export const ENTITY_CONTRACT_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_ENTITY_ID: "invalid_entity_id",
  INVALID_ENTITY_TYPE: "invalid_entity_type",
  INVALID_CANONICAL_NAME: "invalid_canonical_name",
  INVALID_ALIAS_LIST: "invalid_alias_list",
  INVALID_ALIAS: "invalid_alias",
  DUPLICATE_ALIAS: "duplicate_alias",
  INVALID_LOCALE: "invalid_locale",
  INVALID_RESOLUTION_STATUS: "invalid_resolution_status",
  RESOLVED_ENTITY_ID_REQUIRED: "resolved_entity_id_required",
  RESOLVED_ENTITY_TYPE_REQUIRED: "resolved_entity_type_required",
  UNRECOGNIZED_ENTITY_ID_FORBIDDEN: "unrecognized_entity_id_forbidden",
  UNRECOGNIZED_ENTITY_TYPE_FORBIDDEN: "unrecognized_entity_type_forbidden",
});

export const ENTITY_CONTRACT_SCHEMA = Object.freeze({
  version: CANONICAL_ENTITY_SCHEMA_VERSION,
  canonicalEntity: Object.freeze({
    required: CANONICAL_ENTITY_REQUIRED_FIELDS,
    aliases: Object.freeze({
      type: "string[]",
      unique: true,
      allowEmpty: true,
    }),
  }),
  entityResolution: Object.freeze({
    required: ENTITY_RESOLUTION_REQUIRED_FIELDS,
    optional: ENTITY_RESOLUTION_OPTIONAL_FIELDS,
  }),
});

const ENTITY_TYPE_VALUES = new Set(Object.values(ENTITY_TYPES));
const ENTITY_RESOLUTION_STATUS_VALUES = new Set(Object.values(ENTITY_RESOLUTION_STATUSES));
const CANONICAL_ENTITY_FIELD_SET = new Set(CANONICAL_ENTITY_FIELDS);
const ENTITY_RESOLUTION_FIELD_SET = new Set(ENTITY_RESOLUTION_FIELDS);

/** @typedef {import("../domain/contract-validation.js").ValidationResult} ValidationResult */

/**
 * Validate a resolved CanonicalEntity. Name normalization is intentionally
 * not performed here; the normalizer in T11 must preserve source text.
 *
 * @param {unknown} entity
 * @returns {ValidationResult}
 */
export function validateCanonicalEntity(entity) {
  const errors = [];

  if (!isRecord(entity)) {
    return invalidDocumentResult(
      ENTITY_CONTRACT_VALIDATION_CODES.INVALID_DOCUMENT,
      "CanonicalEntity must be a plain object.",
    );
  }

  collectUnknownFields(entity, CANONICAL_ENTITY_FIELD_SET, errors);
  collectMissingFields(entity, CANONICAL_ENTITY_REQUIRED_FIELDS, errors);

  if (entity.entity_id !== undefined && !isDomainId(entity.entity_id, "entity")) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_ID,
        "entity_id",
        "entity_id must be a typed entity domain ID (ent:<key>).",
      ),
    );
  }

  if (
    entity.entity_type !== undefined &&
    (typeof entity.entity_type !== "string" || !ENTITY_TYPE_VALUES.has(entity.entity_type))
  ) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_TYPE,
        "entity_type",
        `entity_type must be one of: ${[...ENTITY_TYPE_VALUES].join(", ")}.`,
      ),
    );
  }

  if (entity.canonical_name !== undefined && !isStableString(entity.canonical_name)) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_CANONICAL_NAME,
        "canonical_name",
        "canonical_name must be a non-empty string without surrounding whitespace.",
      ),
    );
  }

  if (entity.aliases !== undefined) {
    errors.push(...validateAliases(entity.aliases, "aliases"));
  }

  if (entity.locale !== undefined && !isStableString(entity.locale)) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_LOCALE,
        "locale",
        "locale must be a non-empty language/region string without surrounding whitespace.",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: entity } : { ok: false, errors };
}
/**
 * Validate the query-side entity resolution record described by QueryPlan.
 * An unrecognized record keeps the original text and locale but carries no
 * typed entity ID or entity type, so it cannot be used as a structured fact.
 *
 * @param {unknown} resolution
 * @returns {ValidationResult}
 */
export function validateEntityResolution(resolution) {
  const errors = [];

  if (!isRecord(resolution)) {
    return invalidDocumentResult(
      ENTITY_CONTRACT_VALIDATION_CODES.INVALID_DOCUMENT,
      "Entity resolution must be a plain object.",
    );
  }

  collectUnknownFields(resolution, ENTITY_RESOLUTION_FIELD_SET, errors);
  collectMissingFields(resolution, ENTITY_RESOLUTION_REQUIRED_FIELDS, errors);

  if (resolution.text !== undefined && !isStableString(resolution.text)) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_CANONICAL_NAME,
        "text",
        "text must be a non-empty source/query string without surrounding whitespace.",
      ),
    );
  }

  if (resolution.locale !== undefined && !isStableString(resolution.locale)) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_LOCALE,
        "locale",
        "locale must be a non-empty language/region string without surrounding whitespace.",
      ),
    );
  }

  if (resolution.aliases_used !== undefined) {
    errors.push(...validateAliases(resolution.aliases_used, "aliases_used"));
  }

  if (
    resolution.resolution_status !== undefined &&
    (typeof resolution.resolution_status !== "string" ||
      !ENTITY_RESOLUTION_STATUS_VALUES.has(resolution.resolution_status))
  ) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_RESOLUTION_STATUS,
        "resolution_status",
        `resolution_status must be one of: ${[...ENTITY_RESOLUTION_STATUS_VALUES].join(", ")}.`,
      ),
    );
  }

  if (resolution.resolution_status === ENTITY_RESOLUTION_STATUSES.RESOLVED) {
    if (resolution.entity_id === undefined || resolution.entity_id === null) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.RESOLVED_ENTITY_ID_REQUIRED,
          "entity_id",
          "resolved entity resolution requires entity_id.",
        ),
      );
    }
    if (resolution.entity_type === undefined || resolution.entity_type === null) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.RESOLVED_ENTITY_TYPE_REQUIRED,
          "entity_type",
          "resolved entity resolution requires entity_type.",
        ),
      );
    }
  }

  if (resolution.resolution_status === ENTITY_RESOLUTION_STATUSES.UNRECOGNIZED) {
    if (resolution.entity_id !== undefined && resolution.entity_id !== null) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.UNRECOGNIZED_ENTITY_ID_FORBIDDEN,
          "entity_id",
          "unrecognized entity resolution cannot carry entity_id.",
        ),
      );
    }
    if (resolution.entity_type !== undefined && resolution.entity_type !== null) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.UNRECOGNIZED_ENTITY_TYPE_FORBIDDEN,
          "entity_type",
          "unrecognized entity resolution cannot carry entity_type.",
        ),
      );
    }
  }

  if (resolution.entity_id !== undefined && resolution.entity_id !== null) {
    if (!isDomainId(resolution.entity_id, "entity")) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_ID,
          "entity_id",
          "entity_id must be a typed entity domain ID (ent:<key>).",
        ),
      );
    }
  }

  if (
    resolution.entity_type !== undefined &&
    resolution.entity_type !== null &&
    (typeof resolution.entity_type !== "string" || !ENTITY_TYPE_VALUES.has(resolution.entity_type))
  ) {
    errors.push(
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_TYPE,
        "entity_type",
        `entity_type must be one of: ${[...ENTITY_TYPE_VALUES].join(", ")}.`,
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: resolution } : { ok: false, errors };
}
/**
 * @param {unknown} entity
 * @returns {boolean}
 */
export function isCanonicalEntity(entity) {
  return validateCanonicalEntity(entity).ok;
}

/**
 * @param {unknown} resolution
 * @returns {boolean}
 */
export function isEntityResolution(resolution) {
  return validateEntityResolution(resolution).ok;
}

/**
 * @param {unknown} entity
 * @returns {unknown}
 * @throws {TypeError} when validation fails
 */
export function assertCanonicalEntity(entity) {
  return assertValid(validateCanonicalEntity(entity), "CanonicalEntity");
}

/**
 * @param {unknown} resolution
 * @returns {unknown}
 * @throws {TypeError} when validation fails
 */
export function assertEntityResolution(resolution) {
  return assertValid(validateEntityResolution(resolution), "Entity resolution");
}

function validateAliases(aliases, path) {
  if (!Array.isArray(aliases)) {
    return [
      createError(
        ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ALIAS_LIST,
        path,
        `${path} must be an array of strings.`,
      ),
    ];
  }

  const errors = [];
  const seen = new Set();
  aliases.forEach((alias, index) => {
    const aliasPath = `${path}[${index}]`;
    if (!isStableString(alias)) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.INVALID_ALIAS,
          aliasPath,
          "alias must be a non-empty string without surrounding whitespace.",
        ),
      );
      return;
    }

    const comparable = alias.toLowerCase();
    if (seen.has(comparable)) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.DUPLICATE_ALIAS,
          aliasPath,
          "aliases must be unique without case differences.",
        ),
      );
      return;
    }
    seen.add(comparable);
  });

  return errors;
}

function collectUnknownFields(value, allowedFields, errors) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown entity contract field: ${field}.`,
        ),
      );
    }
  }
}

function collectMissingFields(value, fields, errors) {
  for (const field of fields) {
    if (value[field] === undefined || value[field] === null) {
      errors.push(
        createError(
          ENTITY_CONTRACT_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required entity contract field is missing: ${field}.`,
        ),
      );
    }
  }
}
