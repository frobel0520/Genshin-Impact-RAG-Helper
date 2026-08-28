import { createHash } from "node:crypto";

import { ERROR_CODES, RUN_STATUSES, createDomainId } from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";
import {
  RUN_ARTIFACT_KINDS,
  assertRunResponse,
  classifyErrorCode,
} from "../domain/run-response-contract.js";
import { buildFixedIndex } from "../data/document-store.js";
import { validateFixtureSourcePack } from "../data/fixture-source-pack.js";
import { buildEntityNameIndex } from "./source-name-normalizer.js";
import { validateSourceImport } from "./source-import-validator.js";

export const INGEST_PIPELINE_VERSION = 1;

/**
 * The maintainer pipeline, in the order the stages must run.
 *
 * Every stage is a gate: a later stage never runs on input an earlier one
 * rejected, and nothing is written until validation and normalization pass. A
 * failed run therefore leaves the previous dataset exactly as it was, instead
 * of half-replacing it with a batch that could not be trusted.
 */
export const INGEST_STAGES = Object.freeze([
  "validate_batch",
  "validate_dataset",
  "normalize_names",
  "replace_structured_store",
  "build_document_index",
]);

const VALIDATE_REQUEST_FIELDS = new Set(["dataset", "runId", "now"]);
const BUILD_REQUEST_FIELDS = new Set([
  "dataset",
  "structuredStore",
  "documentStore",
  "embedDocuments",
  "structuredStorePath",
  "documentStorePath",
  "runId",
  "now",
]);
const IN_MEMORY_PATH = ":memory:";

const STRUCTURED_COLLECTIONS = Object.freeze([
  "source_documents",
  "canonical_entities",
  "structured_facts",
  "claims",
  "conflict_groups",
]);
const INDEX_COLLECTIONS = Object.freeze([
  "source_documents",
  "canonical_entities",
  "document_chunks",
]);

/**
 * Validate a maintainer batch without writing anything.
 *
 * @param {{ dataset: unknown, runId?: string, now?: () => Date }} request
 * @returns {object} a RunResponse
 */
export function runIngestValidate(request) {
  const { dataset, runId, now } = validateRequest(request, VALIDATE_REQUEST_FIELDS, "validate");
  const startedAt = now();
  const errors = validateDataset(dataset);

  return finishRun({ runId, dataset, startedAt, finishedAt: now(), errors, artifacts: [] });
}

/**
 * Validate, normalize, store, and index a maintainer batch.
 *
 * @param {{
 *   dataset: unknown,
 *   structuredStore: object,
 *   documentStore: object,
 *   embedDocuments: Function,
 *   runId?: string,
 *   now?: () => Date,
 * }} request
 * @returns {Promise<object>} a RunResponse
 */
export async function runIngestBuild(request) {
  const {
    dataset,
    structuredStore,
    documentStore,
    embedDocuments,
    structuredStorePath,
    documentStorePath,
    runId,
    now,
  } = validateRequest(request, BUILD_REQUEST_FIELDS, "build");
  const startedAt = now();
  const artifacts = [];

  const validationErrors = validateDataset(dataset);
  if (validationErrors.length > 0) {
    return finishRun({
      runId,
      dataset,
      startedAt,
      finishedAt: now(),
      errors: validationErrors,
      artifacts,
    });
  }

  const errors = [];
  try {
    // The name dictionary is built before anything is written: two entities
    // that normalize to the same key make the batch unusable, and finding that
    // out after the store was replaced would leave a dataset nobody validated.
    buildEntityNameIndex(dataset.canonical_entities);

    structuredStore.replaceData(pick(dataset, STRUCTURED_COLLECTIONS));
    artifacts.push({
      path: structuredStorePath,
      content_hash: hashCanonical(pick(dataset, STRUCTURED_COLLECTIONS)),
      kind: RUN_ARTIFACT_KINDS.STRUCTURED_STORE,
    });

    const manifest = await buildFixedIndex({
      store: documentStore,
      data: pick(dataset, INDEX_COLLECTIONS),
      embedDocuments,
    });
    artifacts.push({
      path: documentStorePath,
      content_hash: manifest.index_hash,
      kind: RUN_ARTIFACT_KINDS.DOCUMENT_INDEX,
    });
  } catch (error) {
    errors.push({
      code: classifyErrorCode(error),
      message: describeFailure(error),
    });
  }

  return finishRun({ runId, dataset, startedAt, finishedAt: now(), errors, artifacts });
}

/**
 * The batch validator and the dataset validator, in that order: T10 checks the
 * source batch envelope, then T12 checks the cross-collection references that a
 * per-document validator cannot see.
 */
function validateDataset(dataset) {
  if (!isRecord(dataset)) {
    return [{ code: ERROR_CODES.INVALID_REQUEST, message: "Dataset must be a plain object." }];
  }

  const batch = validateSourceImport({
    schema_version: 1,
    documents: Array.isArray(dataset.source_documents) ? dataset.source_documents : [],
  });
  if (!batch.ok) {
    return batch.errors.map((error) => toRunError(error, dataset));
  }

  const pack = validateFixtureSourcePack(dataset);
  return pack.ok ? [] : pack.errors.map((error) => toRunError(error, dataset));
}

/**
 * Keep the maintainer's own locator: the batch path points at the item, and the
 * source ID points at the document, so a failing entry can be found by hand.
 */
function toRunError(error, dataset) {
  const sourceId = sourceIdForPath(error.path, dataset);
  return {
    code: ERROR_CODES.INVALID_REQUEST,
    message: error.message,
    path: error.path,
    ...(sourceId === undefined ? {} : { source_id: sourceId }),
  };
}

function sourceIdForPath(path, dataset) {
  const match = /^(?:documents|source_documents)\[(\d+)\]/.exec(String(path));
  if (match === null) {
    return undefined;
  }
  const document = dataset.source_documents?.[Number(match[1])];
  return typeof document?.source_id === "string" ? document.source_id : undefined;
}

function finishRun({ runId, dataset, startedAt, finishedAt, errors, artifacts }) {
  return assertRunResponse({
    run_id: runId,
    input_version: hashCanonical(dataset),
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    status: resolveStatus(errors, artifacts),
    errors,
    artifacts,
  });
}

/**
 * `partial` is reserved for a run that both failed and left artifacts behind,
 * so a maintainer can tell "nothing changed" from "something was written and
 * then a later stage failed".
 */
function resolveStatus(errors, artifacts) {
  if (errors.length === 0) {
    return RUN_STATUSES.PASSED;
  }
  return artifacts.length > 0 ? RUN_STATUSES.PARTIAL : RUN_STATUSES.FAILED;
}

function describeFailure(error) {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "The ingest run failed without a reportable message.";
}

function pick(dataset, collections) {
  const picked = {};
  for (const collection of collections) {
    picked[collection] = structuredClone(dataset[collection]);
  }
  return picked;
}

function hashCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function validateRequest(request, allowedFields, label) {
  if (!isRecord(request)) {
    throw new TypeError(`Ingest ${label} request must be a plain object.`);
  }
  for (const field of Object.keys(request)) {
    if (!allowedFields.has(field)) {
      throw new TypeError(`Unknown ingest ${label} request field: ${field}.`);
    }
  }
  if (allowedFields.has("structuredStore")) {
    if (typeof request.structuredStore?.replaceData !== "function") {
      throw new TypeError("structuredStore must be a structured store.");
    }
    if (typeof request.documentStore?.replaceIndex !== "function") {
      throw new TypeError("documentStore must be a document store.");
    }
    if (typeof request.embedDocuments !== "function") {
      throw new TypeError("embedDocuments must be a function.");
    }
  }
  for (const field of ["structuredStorePath", "documentStorePath"]) {
    if (request[field] !== undefined && !isStableString(request[field])) {
      throw new TypeError(`${field} must be a non-empty string without surrounding whitespace.`);
    }
  }
  const runId = request.runId ?? createDomainId("run", `ingest-${label}-${Date.now()}`);
  if (request.now !== undefined && typeof request.now !== "function") {
    throw new TypeError("now must be a function returning a Date.");
  }

  return {
    dataset: request.dataset,
    structuredStore: request.structuredStore,
    documentStore: request.documentStore,
    embedDocuments: request.embedDocuments,
    structuredStorePath: request.structuredStorePath ?? IN_MEMORY_PATH,
    documentStorePath: request.documentStorePath ?? IN_MEMORY_PATH,
    runId,
    now: request.now ?? (() => new Date()),
  };
}
