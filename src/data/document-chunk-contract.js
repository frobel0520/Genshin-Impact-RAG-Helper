import { isDomainId } from "../domain/domain-contract.js";

export const DOCUMENT_CHUNK_SCHEMA_VERSION = 1;

export const DOCUMENT_CHUNK_REQUIRED_FIELDS = Object.freeze([
  "chunk_id",
  "source_id",
  "document_locator",
  "text",
  "token_hint",
  "game_version",
  "entity_ids",
]);

export const DOCUMENT_CHUNK_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_CHUNK_ID: "invalid_chunk_id",
  INVALID_SOURCE_ID: "invalid_source_id",
  INVALID_DOCUMENT_LOCATOR: "invalid_document_locator",
  INVALID_TEXT: "invalid_text",
  INVALID_TOKEN_HINT: "invalid_token_hint",
  INVALID_GAME_VERSION: "invalid_game_version",
  INVALID_ENTITY_IDS: "invalid_entity_ids",
  INVALID_ENTITY_ID: "invalid_entity_id",
  DUPLICATE_ENTITY_ID: "duplicate_entity_id",
});

export const DOCUMENT_CHUNK_SCHEMA = Object.freeze({
  version: DOCUMENT_CHUNK_SCHEMA_VERSION,
  required: DOCUMENT_CHUNK_REQUIRED_FIELDS,
  documentLocator: "non-empty stable string",
  text: "non-empty source text; preserved verbatim",
  tokenHint: "non-negative integer estimate",
  gameVersion: "non-empty string; unknown is explicit",
  entityIds: Object.freeze({
    type: "unique entity:<id>[]",
    allowEmpty: true,
  }),
});

const DOCUMENT_CHUNK_FIELD_SET = new Set(DOCUMENT_CHUNK_REQUIRED_FIELDS);

/**
 * Validate a retrievable source text chunk. This contract does not trim or
 * rewrite text; token_hint remains an estimate supplied by the chunk builder.
 */
export function validateDocumentChunk(chunk) {
  const errors = [];

  if (!isRecord(chunk)) {
    return invalidDocumentResult("DocumentChunk must be a plain object.");
  }

  collectUnknownFields(chunk, errors);
  collectMissingFields(chunk, errors);

  if (chunk.chunk_id !== undefined && !isDomainId(chunk.chunk_id, "chunk")) {
    errors.push(
      createError(
        DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_CHUNK_ID,
        "chunk_id",
        "chunk_id must be a typed chunk domain ID (chunk:<key>).",
      ),
    );
  }

  if (chunk.source_id !== undefined && !isDomainId(chunk.source_id, "source")) {
    errors.push(
      createError(
        DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_SOURCE_ID,
        "source_id",
        "source_id must be a typed source domain ID (src:<key>).",
      ),
    );
  }

  if (chunk.document_locator !== undefined && !isStableString(chunk.document_locator)) {
    errors.push(
      createError(
        DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_DOCUMENT_LOCATOR,
        "document_locator",
        "document_locator must be a non-empty string without surrounding whitespace.",
      ),
    );
  }

  if (chunk.text !== undefined && !isNonEmptyString(chunk.text)) {
    errors.push(
      createError(
        DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_TEXT,
        "text",
        "text must contain non-whitespace source text.",
      ),
    );
  }

  if (
    chunk.token_hint !== undefined &&
    (!Number.isInteger(chunk.token_hint) || chunk.token_hint < 0)
  ) {
    errors.push(
      createError(
        DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_TOKEN_HINT,
        "token_hint",
        "token_hint must be a non-negative integer estimate.",
      ),
    );
  }

  if (chunk.game_version !== undefined && !isStableString(chunk.game_version)) {
    errors.push(
      createError(
        DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_GAME_VERSION,
        "game_version",
        "game_version must be a non-empty string; use 'unknown' when unavailable.",
      ),
    );
  }

  if (chunk.entity_ids !== undefined) {
    errors.push(...validateEntityIds(chunk.entity_ids));
  }

  return errors.length === 0 ? { ok: true, value: chunk } : { ok: false, errors };
}

export function isDocumentChunk(chunk) {
  return validateDocumentChunk(chunk).ok;
}

export function assertDocumentChunk(chunk) {
  const result = validateDocumentChunk(chunk);
  if (!result.ok) {
    const message = result.errors.map(({ path, message: detail }) => `${path}: ${detail}`).join(" ");
    throw new TypeError(`Invalid DocumentChunk. ${message}`);
  }

  return result.value;
}

function validateEntityIds(entityIds) {
  if (!Array.isArray(entityIds)) {
    return [
      createError(
        DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_ENTITY_IDS,
        "entity_ids",
        "entity_ids must be an array of typed entity IDs.",
      ),
    ];
  }

  const errors = [];
  const seen = new Set();
  for (const [index, entityId] of entityIds.entries()) {
    if (!isDomainId(entityId, "entity")) {
      errors.push(
        createError(
          DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_ENTITY_ID,
          `entity_ids[${index}]`,
          "entity_ids entries must be typed entity domain IDs (ent:<key>).",
        ),
      );
    }
    if (seen.has(entityId)) {
      errors.push(
        createError(
          DOCUMENT_CHUNK_VALIDATION_CODES.DUPLICATE_ENTITY_ID,
          `entity_ids[${index}]`,
          "entity_ids must be unique.",
        ),
      );
    }
    seen.add(entityId);
  }

  return errors;
}

function collectUnknownFields(chunk, errors) {
  for (const field of Object.keys(chunk)) {
    if (!DOCUMENT_CHUNK_FIELD_SET.has(field)) {
      errors.push(
        createError(
          DOCUMENT_CHUNK_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown DocumentChunk field: ${field}.`,
        ),
      );
    }
  }
}

function collectMissingFields(chunk, errors) {
  for (const field of DOCUMENT_CHUNK_REQUIRED_FIELDS) {
    if (chunk[field] === undefined) {
      errors.push(
        createError(
          DOCUMENT_CHUNK_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required DocumentChunk field is missing: ${field}.`,
        ),
      );
    }
  }
}

function invalidDocumentResult(message) {
  return {
    ok: false,
    errors: [
      createError(DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_DOCUMENT, "$", message),
    ],
  };
}

function createError(code, path, message) {
  return { code, path, message };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStableString(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim() === value;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
