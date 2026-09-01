import { ERROR_CODES, RUN_STATUSES, isDomainId } from "./domain-contract.js";
import {
  assertValid,
  createError,
  invalidDocumentResult,
  isIsoDateTime,
  isNonEmptyString,
  isRecord,
  isStableString,
  prefixErrors,
} from "./contract-validation.js";

export const RUN_RESPONSE_SCHEMA_VERSION = 1;

export const RUN_RESPONSE_REQUIRED_FIELDS = Object.freeze([
  "run_id",
  "input_version",
  "started_at",
  "finished_at",
  "status",
  "errors",
  "artifacts",
]);

export const RUN_RESPONSE_FIELDS = RUN_RESPONSE_REQUIRED_FIELDS;

export const RUN_ERROR_REQUIRED_FIELDS = Object.freeze(["code", "message"]);

export const RUN_ERROR_OPTIONAL_FIELDS = Object.freeze(["source_id", "case_id", "path"]);

export const RUN_ERROR_FIELDS = Object.freeze([
  ...RUN_ERROR_REQUIRED_FIELDS,
  ...RUN_ERROR_OPTIONAL_FIELDS,
]);

export const RUN_ARTIFACT_REQUIRED_FIELDS = Object.freeze(["path", "content_hash", "kind"]);

export const RUN_ARTIFACT_FIELDS = RUN_ARTIFACT_REQUIRED_FIELDS;

export const RUN_ARTIFACT_KINDS = Object.freeze({
  STRUCTURED_STORE: "structured_store",
  DOCUMENT_INDEX: "document_index",
  REPORT: "report",
});

export const RUN_RESPONSE_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_RUN_ID: "invalid_run_id",
  INVALID_INPUT_VERSION: "invalid_input_version",
  INVALID_STARTED_AT: "invalid_started_at",
  INVALID_FINISHED_AT: "invalid_finished_at",
  INVALID_RUN_WINDOW: "invalid_run_window",
  INVALID_STATUS: "invalid_status",
  INVALID_ERRORS: "invalid_errors",
  INVALID_ARTIFACTS: "invalid_artifacts",
  INVALID_ERROR_CODE: "invalid_error_code",
  INVALID_ERROR_MESSAGE: "invalid_error_message",
  INVALID_ERROR_SOURCE_ID: "invalid_error_source_id",
  INVALID_ERROR_CASE_ID: "invalid_error_case_id",
  INVALID_ERROR_PATH: "invalid_error_path",
  INVALID_ARTIFACT_PATH: "invalid_artifact_path",
  INVALID_ARTIFACT_CONTENT_HASH: "invalid_artifact_content_hash",
  INVALID_ARTIFACT_KIND: "invalid_artifact_kind",
  PASSED_FORBIDS_ERRORS: "passed_forbids_errors",
  FAILURE_REQUIRES_ERROR: "failure_requires_error",
});

const RUN_STATUS_VALUES = new Set(Object.values(RUN_STATUSES));
const ERROR_CODE_VALUES = new Set(Object.values(ERROR_CODES));
const ARTIFACT_KIND_VALUES = new Set(Object.values(RUN_ARTIFACT_KINDS));
const RUN_RESPONSE_FIELD_SET = new Set(RUN_RESPONSE_FIELDS);
const RUN_ERROR_FIELD_SET = new Set(RUN_ERROR_FIELDS);
const RUN_ARTIFACT_FIELD_SET = new Set(RUN_ARTIFACT_FIELDS);
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const UNAVAILABLE_SYSTEM_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "EAI_AGAIN",
]);

/** @typedef {import("./contract-validation.js").ValidationResult} ValidationResult */

/**
 * Shared result of a maintainer command: ingest validate/build (T24) and the
 * evaluation runner (T25) both report through it.
 *
 * A run that produced nothing must not look like a success: `passed` forbids
 * errors, and `failed`/`partial` require at least one classifiable error, so a
 * command can never hand back an empty index dressed up as a clean run.
 */
export const RUN_RESPONSE_SCHEMA = Object.freeze({
  version: RUN_RESPONSE_SCHEMA_VERSION,
  required: RUN_RESPONSE_REQUIRED_FIELDS,
  error: Object.freeze({
    required: RUN_ERROR_REQUIRED_FIELDS,
    optional: RUN_ERROR_OPTIONAL_FIELDS,
    codes: Object.freeze(Object.values(ERROR_CODES)),
  }),
  artifact: Object.freeze({
    required: RUN_ARTIFACT_REQUIRED_FIELDS,
    kinds: Object.freeze(Object.values(RUN_ARTIFACT_KINDS)),
    contentHash: "sha256 hex",
  }),
  invariants: Object.freeze({
    passedForbidsErrors: true,
    failureRequiresError: true,
    finishedAtNotBeforeStartedAt: true,
  }),
});

/**
 * @param {unknown} response
 * @returns {ValidationResult}
 */
export function validateRunResponse(response) {
  const errors = [];

  if (!isRecord(response)) {
    return invalidDocumentResult(
      RUN_RESPONSE_VALIDATION_CODES.INVALID_DOCUMENT,
      "RunResponse must be a plain object.",
    );
  }

  collectUnknownFields(response, RUN_RESPONSE_FIELD_SET, errors);
  collectMissingFields(response, RUN_RESPONSE_REQUIRED_FIELDS, errors);

  if (response.run_id !== undefined && !isDomainId(response.run_id, "run")) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_RUN_ID,
        "run_id",
        "run_id must be a typed run domain ID (run:<key>).",
      ),
    );
  }

  if (response.input_version !== undefined && !isStableString(response.input_version)) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_INPUT_VERSION,
        "input_version",
        "input_version must be a non-empty string identifying the input batch.",
      ),
    );
  }

  if (response.started_at !== undefined && !isIsoDateTime(response.started_at)) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_STARTED_AT,
        "started_at",
        "started_at must be an ISO 8601 date-time with an explicit timezone.",
      ),
    );
  }

  if (response.finished_at !== undefined && !isIsoDateTime(response.finished_at)) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_FINISHED_AT,
        "finished_at",
        "finished_at must be an ISO 8601 date-time with an explicit timezone.",
      ),
    );
  }

  if (
    isIsoDateTime(response.started_at) &&
    isIsoDateTime(response.finished_at) &&
    Date.parse(response.finished_at) < Date.parse(response.started_at)
  ) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_RUN_WINDOW,
        "finished_at",
        "finished_at must not be earlier than started_at.",
      ),
    );
  }

  if (
    response.status !== undefined &&
    (typeof response.status !== "string" || !RUN_STATUS_VALUES.has(response.status))
  ) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_STATUS,
        "status",
        `status must be one of: ${[...RUN_STATUS_VALUES].join(", ")}.`,
      ),
    );
  }

  if (response.errors !== undefined) {
    if (!Array.isArray(response.errors)) {
      errors.push(
        createError(
          RUN_RESPONSE_VALIDATION_CODES.INVALID_ERRORS,
          "errors",
          "errors must be an array of run errors.",
        ),
      );
    } else {
      for (const [index, runError] of response.errors.entries()) {
        const result = validateRunError(runError);
        if (!result.ok) {
          errors.push(...prefixErrors(result.errors, `errors[${index}]`));
        }
      }

      if (response.status === RUN_STATUSES.PASSED && response.errors.length > 0) {
        errors.push(
          createError(
            RUN_RESPONSE_VALIDATION_CODES.PASSED_FORBIDS_ERRORS,
            "errors",
            "a passed run must not report errors.",
          ),
        );
      }
      if (
        (response.status === RUN_STATUSES.FAILED || response.status === RUN_STATUSES.PARTIAL) &&
        response.errors.length === 0
      ) {
        errors.push(
          createError(
            RUN_RESPONSE_VALIDATION_CODES.FAILURE_REQUIRES_ERROR,
            "errors",
            "a failed or partial run must report at least one classifiable error.",
          ),
        );
      }
    }
  }

  if (response.artifacts !== undefined) {
    if (!Array.isArray(response.artifacts)) {
      errors.push(
        createError(
          RUN_RESPONSE_VALIDATION_CODES.INVALID_ARTIFACTS,
          "artifacts",
          "artifacts must be an array of run artifacts.",
        ),
      );
    } else {
      for (const [index, artifact] of response.artifacts.entries()) {
        const result = validateRunArtifact(artifact);
        if (!result.ok) {
          errors.push(...prefixErrors(result.errors, `artifacts[${index}]`));
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true, value: response } : { ok: false, errors };
}

/**
 * @param {unknown} runError
 * @returns {ValidationResult}
 */
export function validateRunError(runError) {
  const errors = [];

  if (!isRecord(runError)) {
    return invalidDocumentResult(
      RUN_RESPONSE_VALIDATION_CODES.INVALID_DOCUMENT,
      "Run error must be a plain object.",
    );
  }

  collectUnknownFields(runError, RUN_ERROR_FIELD_SET, errors);
  collectMissingFields(runError, RUN_ERROR_REQUIRED_FIELDS, errors);

  if (
    runError.code !== undefined &&
    (typeof runError.code !== "string" || !ERROR_CODE_VALUES.has(runError.code))
  ) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ERROR_CODE,
        "code",
        `code must be one of: ${[...ERROR_CODE_VALUES].join(", ")}.`,
      ),
    );
  }

  if (runError.message !== undefined && !isNonEmptyString(runError.message)) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ERROR_MESSAGE,
        "message",
        "message must be a non-empty string.",
      ),
    );
  }

  if (runError.source_id !== undefined && !isDomainId(runError.source_id, "source")) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ERROR_SOURCE_ID,
        "source_id",
        "source_id must be a typed source domain ID (src:<key>).",
      ),
    );
  }

  if (runError.case_id !== undefined && !isDomainId(runError.case_id, "case")) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ERROR_CASE_ID,
        "case_id",
        "case_id must be a typed case domain ID (case:<key>).",
      ),
    );
  }

  if (runError.path !== undefined && !isNonEmptyString(runError.path)) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ERROR_PATH,
        "path",
        "path must be a non-empty string locating the failing item.",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: runError } : { ok: false, errors };
}

/**
 * @param {unknown} artifact
 * @returns {ValidationResult}
 */
export function validateRunArtifact(artifact) {
  const errors = [];

  if (!isRecord(artifact)) {
    return invalidDocumentResult(
      RUN_RESPONSE_VALIDATION_CODES.INVALID_DOCUMENT,
      "Run artifact must be a plain object.",
    );
  }

  collectUnknownFields(artifact, RUN_ARTIFACT_FIELD_SET, errors);
  collectMissingFields(artifact, RUN_ARTIFACT_REQUIRED_FIELDS, errors);

  if (artifact.path !== undefined && !isStableString(artifact.path)) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ARTIFACT_PATH,
        "path",
        "path must be a non-empty string without surrounding whitespace.",
      ),
    );
  }

  if (
    artifact.content_hash !== undefined &&
    (typeof artifact.content_hash !== "string" ||
      !CONTENT_HASH_PATTERN.test(artifact.content_hash))
  ) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ARTIFACT_CONTENT_HASH,
        "content_hash",
        "content_hash must be a lowercase sha256 hex digest.",
      ),
    );
  }

  if (
    artifact.kind !== undefined &&
    (typeof artifact.kind !== "string" || !ARTIFACT_KIND_VALUES.has(artifact.kind))
  ) {
    errors.push(
      createError(
        RUN_RESPONSE_VALIDATION_CODES.INVALID_ARTIFACT_KIND,
        "kind",
        `kind must be one of: ${[...ARTIFACT_KIND_VALUES].join(", ")}.`,
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: artifact } : { ok: false, errors };
}

/**
 * Map a thrown failure onto a stable error code without reading its message.
 *
 * Error text is not a contract: it changes with a library upgrade and differs
 * between platforms, so classification looks only at the error's own code and
 * type. Anything unrecognised is an internal error, never a data-level refusal.
 *
 * @param {unknown} error
 * @returns {string} one of ERROR_CODES
 */
export function classifyErrorCode(error) {
  const code = error?.code;
  if (typeof code === "string" && ERROR_CODE_VALUES.has(code)) {
    return code;
  }
  if (typeof code === "string" && UNAVAILABLE_SYSTEM_CODES.has(code)) {
    return ERROR_CODES.DEPENDENCY_UNAVAILABLE;
  }
  if (error instanceof TypeError) {
    return ERROR_CODES.INVALID_REQUEST;
  }
  return ERROR_CODES.INTERNAL_ERROR;
}

/**
 * @param {unknown} response
 * @returns {boolean}
 */
export function isRunResponse(response) {
  return validateRunResponse(response).ok;
}

/**
 * @param {unknown} response
 * @returns {unknown}
 * @throws {TypeError} when validation fails
 */
export function assertRunResponse(response) {
  return assertValid(validateRunResponse(response), "RunResponse");
}

function collectUnknownFields(value, allowedFields, errors) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      errors.push(
        createError(
          RUN_RESPONSE_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown run contract field: ${field}.`,
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
          RUN_RESPONSE_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required run contract field is missing: ${field}.`,
        ),
      );
    }
  }
}
