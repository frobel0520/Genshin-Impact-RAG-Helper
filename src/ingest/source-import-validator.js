import {
  assertValid,
  createError,
  invalidDocumentResult,
  isRecord,
  prefixErrors,
} from "../domain/contract-validation.js";
import { validateSourceDocument } from "../data/source-document-contract.js";

export const SOURCE_IMPORT_SCHEMA_VERSION = 1;

export const SOURCE_IMPORT_REQUIRED_FIELDS = Object.freeze(["documents"]);

export const SOURCE_IMPORT_OPTIONAL_FIELDS = Object.freeze(["schema_version"]);

export const SOURCE_IMPORT_FIELDS = Object.freeze([
  ...SOURCE_IMPORT_REQUIRED_FIELDS,
  ...SOURCE_IMPORT_OPTIONAL_FIELDS,
]);

export const SOURCE_IMPORT_VALIDATION_CODES = Object.freeze({
  INVALID_IMPORT: "invalid_import",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_SCHEMA_VERSION: "invalid_schema_version",
  INVALID_DOCUMENTS: "invalid_documents",
  EMPTY_DOCUMENTS: "empty_documents",
  DUPLICATE_SOURCE_ID: "duplicate_source_id",
  DUPLICATE_CONTENT_HASH: "duplicate_content_hash",
});

export const SOURCE_IMPORT_SCHEMA = Object.freeze({
  version: SOURCE_IMPORT_SCHEMA_VERSION,
  required: SOURCE_IMPORT_REQUIRED_FIELDS,
  optional: SOURCE_IMPORT_OPTIONAL_FIELDS,
  documents: "SourceDocument[]",
});

const SOURCE_IMPORT_FIELD_SET = new Set(SOURCE_IMPORT_FIELDS);

/** @typedef {import("../domain/contract-validation.js").ValidationResult} ValidationResult */

/**
 * Validate a source import batch without fetching, normalizing, or mutating it.
 * SourceDocument validation remains the single-document boundary; this module
 * adds batch shape and duplicate detection for the ingest path.
 * @param {unknown} sourceImport
 * @returns {ValidationResult}
 */
export function validateSourceImport(sourceImport) {
  if (!isRecord(sourceImport)) {
    return invalidDocumentResult(
      SOURCE_IMPORT_VALIDATION_CODES.INVALID_IMPORT,
      "Source import must be a plain object.",
    );
  }

  const errors = [];

  for (const field of Object.keys(sourceImport)) {
    if (!SOURCE_IMPORT_FIELD_SET.has(field)) {
      errors.push(
        createError(
          SOURCE_IMPORT_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown source import field: ${field}.`,
        ),
      );
    }
  }

  for (const field of SOURCE_IMPORT_REQUIRED_FIELDS) {
    if (sourceImport[field] === undefined || sourceImport[field] === null) {
      errors.push(
        createError(
          SOURCE_IMPORT_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required source import field is missing: ${field}.`,
        ),
      );
    }
  }

  if (
    sourceImport.schema_version !== undefined &&
    sourceImport.schema_version !== SOURCE_IMPORT_SCHEMA_VERSION
  ) {
    errors.push(
      createError(
        SOURCE_IMPORT_VALIDATION_CODES.INVALID_SCHEMA_VERSION,
        "schema_version",
        `schema_version must be ${SOURCE_IMPORT_SCHEMA_VERSION} when present.`,
      ),
    );
  }

  if (sourceImport.documents !== undefined && sourceImport.documents !== null) {
    if (!Array.isArray(sourceImport.documents)) {
      errors.push(
        createError(
          SOURCE_IMPORT_VALIDATION_CODES.INVALID_DOCUMENTS,
          "documents",
          "documents must be an array of SourceDocument objects.",
        ),
      );
    } else if (sourceImport.documents.length === 0) {
      errors.push(
        createError(
          SOURCE_IMPORT_VALIDATION_CODES.EMPTY_DOCUMENTS,
          "documents",
          "documents must contain at least one SourceDocument.",
        ),
      );
    } else {
      validateDocuments(sourceImport.documents, errors);
    }
  }

  return errors.length === 0
    ? { ok: true, value: sourceImport }
    : { ok: false, errors };
}

/**
 * @param {unknown} sourceImport
 * @returns {boolean}
 */
export function isSourceImport(sourceImport) {
  return validateSourceImport(sourceImport).ok;
}

/**
 * @param {unknown} sourceImport
 * @returns {unknown}
 * @throws {TypeError} when validation fails
 */
export function assertSourceImport(sourceImport) {
  const result = validateSourceImport(sourceImport);
  return assertValid(result, "source import");
}

/**
 * @param {unknown[]} documents
 * @param {import("../domain/contract-validation.js").ValidationError[]} errors
 * @returns {void}
 */
function validateDocuments(documents, errors) {
  const sourceIdIndexes = new Map();
  const contentHashIndexes = new Map();

  for (const [index, document] of documents.entries()) {
    const result = validateSourceDocument(document);
    if (!result.ok) {
      errors.push(...prefixErrors(result.errors, `documents[${index}]`));
    }

    collectDuplicateFieldError(
      document,
      index,
      "source_id",
      sourceIdIndexes,
      SOURCE_IMPORT_VALIDATION_CODES.DUPLICATE_SOURCE_ID,
      errors,
    );
    collectDuplicateFieldError(
      document,
      index,
      "content_hash",
      contentHashIndexes,
      SOURCE_IMPORT_VALIDATION_CODES.DUPLICATE_CONTENT_HASH,
      errors,
    );
  }
}

/**
 * @param {unknown} document
 * @param {number} index
 * @param {"source_id" | "content_hash"} field
 * @param {Map<string, number>} indexes
 * @param {string} code
 * @param {import("../domain/contract-validation.js").ValidationError[]} errors
 * @returns {void}
 */
function collectDuplicateFieldError(document, index, field, indexes, code, errors) {
  if (!isRecord(document)) {
    return;
  }

  const value = document[field];
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    return;
  }

  const firstIndex = indexes.get(value);
  if (firstIndex === undefined) {
    indexes.set(value, index);
    return;
  }

  errors.push(
    createError(
      code,
      `documents[${index}].${field}`,
      `Duplicate ${field}: value already appears at documents[${firstIndex}].${field}.`,
    ),
  );
}
