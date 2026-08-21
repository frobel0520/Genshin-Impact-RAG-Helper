import { isDomainId, SOURCE_KINDS } from "../domain/domain-contract.js";

export const SOURCE_DOCUMENT_SCHEMA_VERSION = 1;

export const SOURCE_DOCUMENT_REQUIRED_FIELDS = Object.freeze([
  "source_id",
  "source_kind",
  "source_url",
  "title",
  "retrieved_at",
  "locale",
  "rights_note",
  "content_hash",
]);

export const SOURCE_DOCUMENT_OPTIONAL_FIELDS = Object.freeze([
  "published_at",
  "game_version",
]);

export const SOURCE_DOCUMENT_FIELDS = Object.freeze([
  ...SOURCE_DOCUMENT_REQUIRED_FIELDS,
  ...SOURCE_DOCUMENT_OPTIONAL_FIELDS,
]);

export const SOURCE_DOCUMENT_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_SOURCE_ID: "invalid_source_id",
  INVALID_SOURCE_KIND: "invalid_source_kind",
  INVALID_SOURCE_URL: "invalid_source_url",
  INVALID_TITLE: "invalid_title",
  INVALID_TIMESTAMP: "invalid_timestamp",
  INVALID_GAME_VERSION: "invalid_game_version",
  INVALID_LOCALE: "invalid_locale",
  INVALID_RIGHTS_NOTE: "invalid_rights_note",
  INVALID_CONTENT_HASH: "invalid_content_hash",
});

export const SOURCE_DOCUMENT_SCHEMA = Object.freeze({
  version: SOURCE_DOCUMENT_SCHEMA_VERSION,
  required: SOURCE_DOCUMENT_REQUIRED_FIELDS,
  optional: SOURCE_DOCUMENT_OPTIONAL_FIELDS,
  contentHash: Object.freeze({
    algorithm: "sha-256",
    encoding: "hex",
    length: 64,
  }),
});

const SOURCE_KIND_VALUES = new Set(Object.values(SOURCE_KINDS));
const SOURCE_DOCUMENT_FIELD_SET = new Set(SOURCE_DOCUMENT_FIELDS);
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1\d):[0-5]\d)$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Validate the metadata needed to trace a source document or snapshot.
 * Validation is deliberately non-mutating; ingest normalization belongs to T10/T11.
 */
export function validateSourceDocument(document) {
  const errors = [];

  if (!isRecord(document)) {
    return {
      ok: false,
      errors: [
        createError(
          SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_DOCUMENT,
          "$",
          "SourceDocument must be a plain object.",
        ),
      ],
    };
  }

  for (const field of Object.keys(document)) {
    if (!SOURCE_DOCUMENT_FIELD_SET.has(field)) {
      errors.push(
        createError(
          SOURCE_DOCUMENT_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown SourceDocument field: ${field}.`,
        ),
      );
    }
  }

  for (const field of SOURCE_DOCUMENT_REQUIRED_FIELDS) {
    if (document[field] === undefined || document[field] === null) {
      errors.push(
        createError(
          SOURCE_DOCUMENT_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required SourceDocument field is missing: ${field}.`,
        ),
      );
    }
  }

  if (document.source_id !== undefined && !isDomainId(document.source_id, "source")) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_SOURCE_ID,
        "source_id",
        "source_id must be a typed source domain ID (src:<key>).",
      ),
    );
  }

  if (
    document.source_kind !== undefined &&
    (typeof document.source_kind !== "string" || !SOURCE_KIND_VALUES.has(document.source_kind))
  ) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_SOURCE_KIND,
        "source_kind",
        `source_kind must be one of: ${[...SOURCE_KIND_VALUES].join(", ")}.`,
      ),
    );
  }

  if (document.source_url !== undefined && !isHttpUrl(document.source_url)) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_SOURCE_URL,
        "source_url",
        "source_url must be an absolute http or https URL.",
      ),
    );
  }

  if (document.title !== undefined && !isNonEmptyString(document.title)) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_TITLE,
        "title",
        "title must be a non-empty string.",
      ),
    );
  }

  for (const field of ["published_at", "retrieved_at"]) {
    if (document[field] !== undefined && !isIsoDateTime(document[field])) {
      errors.push(
        createError(
          SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_TIMESTAMP,
          field,
          `${field} must be an ISO 8601 date-time with an explicit timezone.`,
        ),
      );
    }
  }

  if (document.game_version !== undefined && !isNonEmptyString(document.game_version)) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_GAME_VERSION,
        "game_version",
        "game_version must be a non-empty string when present; use 'unknown' when unavailable.",
      ),
    );
  }

  if (document.locale !== undefined && !isNonEmptyString(document.locale)) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_LOCALE,
        "locale",
        "locale must be a non-empty language/region string.",
      ),
    );
  }

  if (document.rights_note !== undefined && !isNonEmptyString(document.rights_note)) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_RIGHTS_NOTE,
        "rights_note",
        "rights_note must be a non-empty attribution or rights-handling note.",
      ),
    );
  }

  if (document.content_hash !== undefined && !SHA256_HEX_PATTERN.test(document.content_hash)) {
    errors.push(
      createError(
        SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_CONTENT_HASH,
        "content_hash",
        "content_hash must be a lowercase SHA-256 hexadecimal digest.",
      ),
    );
  }

  return errors.length === 0
    ? { ok: true, value: document }
    : { ok: false, errors };
}

export function isSourceDocument(document) {
  return validateSourceDocument(document).ok;
}

export function assertSourceDocument(document) {
  const result = validateSourceDocument(document);
  if (!result.ok) {
    const message = result.errors.map(({ path, message: detail }) => `${path}: ${detail}`).join(" ");
    throw new TypeError(`Invalid SourceDocument. ${message}`);
  }

  return result.value;
}

function createError(code, path, message) {
  return { code, path, message };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpUrl(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDateTime(value) {
  if (typeof value !== "string" || !ISO_DATETIME_PATTERN.test(value)) {
    return false;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }

  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}
