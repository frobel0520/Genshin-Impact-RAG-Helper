import { ERROR_CODES } from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";

export const OLLAMA_EMBED_PATH = "/api/embed";
export const DEFAULT_EMBED_BATCH_SIZE = 16;

const EMBEDDER_OPTION_FIELDS = new Set(["host", "model", "fetchImpl", "batchSize"]);

/**
 * Live embedding adapter for the fixed `bge-m3` baseline.
 *
 * The adapter refuses to paper over a mismatch: if Ollama answers with a
 * different number of vectors, a different width, or a non-finite value, the
 * build fails rather than writing an index whose vectors do not mean what the
 * manifest says they mean. Failures carry a classifiable `code`, so the run
 * response never has to parse an error message.
 *
 * @param {{ host: string, model: string, fetchImpl?: Function, batchSize?: number }} options
 * @returns {{ embedDocuments: (texts: string[], contract: object) => Promise<Float32Array[]> }}
 */
export function createOllamaEmbedder(options) {
  const { host, model, fetchImpl, batchSize } = validateOptions(options);

  async function embedDocuments(texts, contract) {
    if (!Array.isArray(texts)) {
      throw new TypeError("texts must be an array of strings.");
    }
    if (!isRecord(contract) || !Number.isInteger(contract.dimensions)) {
      throw new TypeError("The embedding contract must carry the fixed dimensions.");
    }
    if (contract.model !== model) {
      throw failure(
        ERROR_CODES.CONFIGURATION_ERROR,
        `The index requires ${contract.model} but this embedder is configured for ${model}.`,
      );
    }

    const vectors = [];
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const embeddings = await requestEmbeddings(batch);
      if (embeddings.length !== batch.length) {
        throw failure(
          ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          `Ollama returned ${embeddings.length} embeddings for ${batch.length} inputs.`,
        );
      }
      for (const embedding of embeddings) {
        vectors.push(toVector(embedding, contract.dimensions));
      }
    }
    return vectors;
  }

  async function requestEmbeddings(input) {
    let response;
    try {
      response = await fetchImpl(`${host}${OLLAMA_EMBED_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input }),
      });
    } catch (error) {
      throw failure(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        `Ollama at ${host} could not be reached.`,
        error,
      );
    }

    if (!response.ok) {
      throw failure(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        `Ollama at ${host} answered with HTTP ${response.status}.`,
      );
    }

    const payload = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.embeddings)) {
      throw failure(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        "Ollama returned a response without an embeddings array.",
      );
    }
    return payload.embeddings;
  }

  return Object.freeze({ model, host, embedDocuments });
}

function toVector(embedding, dimensions) {
  if (!Array.isArray(embedding) || embedding.length !== dimensions) {
    throw failure(
      ERROR_CODES.DEPENDENCY_UNAVAILABLE,
      `Every embedding must have exactly ${dimensions} dimensions.`,
    );
  }
  const vector = new Float32Array(dimensions);
  for (const [index, value] of embedding.entries()) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw failure(
        ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        "Embeddings must contain finite numbers only.",
      );
    }
    vector[index] = value;
  }
  return vector;
}

function failure(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function validateOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Ollama embedder options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!EMBEDDER_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown Ollama embedder option: ${field}.`);
    }
  }
  if (!isStableString(options.host)) {
    throw new TypeError("host must be a non-empty string without surrounding whitespace.");
  }
  if (!isStableString(options.model)) {
    throw new TypeError("model must be a non-empty string without surrounding whitespace.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function when global fetch is unavailable.");
  }
  const batchSize = options.batchSize ?? DEFAULT_EMBED_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError("batchSize must be a positive integer.");
  }

  return {
    host: options.host.replace(/\/+$/, ""),
    model: options.model,
    fetchImpl,
    batchSize,
  };
}
