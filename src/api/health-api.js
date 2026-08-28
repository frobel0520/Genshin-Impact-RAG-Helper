export const HEALTH_API_ROUTE = "/health";

export const HEALTH_STATUSES = Object.freeze({
  OK: "ok",
  DEGRADED: "degraded",
});

export const DATASET_STATES = Object.freeze({
  READY: "ready",
  MISSING: "missing",
  CORRUPT: "corrupt",
});

/**
 * Health contract.
 *
 * `ok` means the helper can actually answer a question: both stores are open,
 * the fixed index is built, and it verifies against its own manifest. A server
 * that started without data is `degraded`, never `ok` — reporting health from
 * process liveness alone would hide the one failure that matters most, an empty
 * or corrupted index that silently answers nothing.
 */
export const HEALTH_RULES = Object.freeze({
  route: HEALTH_API_ROUTE,
  method: "GET",
  livenessIsNotReadiness: true,
  verifiesIndexAgainstManifest: true,
  exposesNoSourceContent: true,
});

/**
 * Build the `GET /health` reporter.
 *
 * The stores are optional because the server must start and stay diagnosable
 * before any ingest run has happened; that state is reported, not hidden.
 *
 * @param {{
 *   config: object,
 *   structuredStore?: object,
 *   documentStore?: object,
 * }} options
 * @returns {{ report: () => object }}
 */
export function createHealthReporter(options) {
  const { config, structuredStore, documentStore } = validateOptions(options);

  function report() {
    const structured = describeStructuredStore(structuredStore);
    const index = describeDocumentIndex(documentStore);
    const dataset = resolveDatasetState(structured, index);

    return {
      status: dataset === DATASET_STATES.READY ? HEALTH_STATUSES.OK : HEALTH_STATUSES.DEGRADED,
      service: config.serviceName,
      baseline: {
        generation_model: config.generationModel,
        embedding_model: config.embeddingModel,
        ollama_host: config.ollamaHost,
      },
      dataset: {
        state: dataset,
        structured,
        index,
      },
    };
  }

  return Object.freeze({ report });
}

/**
 * Create the `GET /health` handler.
 *
 * @param {{ reporter: { report: () => object } }} options
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => void}
 */
export function createHealthRoute(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.reporter?.report !== "function"
  ) {
    throw new TypeError("reporter must expose report().");
  }
  const { reporter } = options;

  return function handleHealth(request, response) {
    const payload = reporter.report();
    // A degraded helper is still a healthy process answering honestly, so the
    // status code stays 200 and the body carries the detail.
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
  };
}

function describeStructuredStore(store) {
  if (store === undefined) {
    return { available: false };
  }
  const status = store.getStatus();
  return {
    available: status.isOpen,
    schema_version: status.schemaVersion,
    counts: status.counts,
  };
}

function describeDocumentIndex(store) {
  if (store === undefined) {
    return { available: false };
  }
  const status = store.getStatus();
  if (!status.isOpen) {
    return { available: false };
  }

  // The embedding contract is read back from the index's own manifest rather
  // than from configuration: what matters is what the stored vectors were built
  // with, not what this process would use today.
  const manifest = store.getIndexManifest();
  const verification = store.verifyIndex();
  return {
    available: true,
    schema_version: status.schemaVersion,
    counts: status.counts,
    index_hash: status.indexHash,
    verified: verification.ok,
    ...(manifest === undefined
      ? {}
      : {
          embedding_model: manifest.embedding_model,
          embedding_dimensions: manifest.embedding_dimensions,
        }),
    ...(verification.ok ? {} : { verification_reason: verification.reason ?? "hash_mismatch" }),
  };
}

/**
 * A store that is open but holds nothing is `missing`, not `corrupt`: an ingest
 * run has simply not happened yet. `corrupt` is reserved for an index that
 * exists and does not match its manifest, which is the case a maintainer has to
 * act on before the helper answers anything.
 */
function resolveDatasetState(structured, index) {
  if (!structured.available || !index.available) {
    return DATASET_STATES.MISSING;
  }
  if (index.index_hash === null || index.counts.documentChunks === 0) {
    return DATASET_STATES.MISSING;
  }
  return index.verified ? DATASET_STATES.READY : DATASET_STATES.CORRUPT;
}

function validateOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Health reporter options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!["config", "structuredStore", "documentStore"].includes(field)) {
      throw new TypeError(`Unknown health reporter option: ${field}.`);
    }
  }
  const { config } = options;
  if (
    config === null ||
    typeof config !== "object" ||
    typeof config.serviceName !== "string" ||
    typeof config.generationModel !== "string" ||
    typeof config.embeddingModel !== "string" ||
    typeof config.ollamaHost !== "string"
  ) {
    throw new TypeError("config must be a runtime configuration.");
  }
  for (const field of ["structuredStore", "documentStore"]) {
    if (options[field] !== undefined && typeof options[field].getStatus !== "function") {
      throw new TypeError(`${field} must expose getStatus() when provided.`);
    }
  }

  return {
    config,
    structuredStore: options.structuredStore,
    documentStore: options.documentStore,
  };
}
