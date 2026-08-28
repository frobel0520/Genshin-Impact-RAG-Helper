import {
  RETRIEVAL_MODES,
  SUPPORT_TYPES,
  VERSION_CONSTRAINTS,
  createDomainId,
  isDomainId,
} from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";
import { FIXED_EMBEDDING_DIMENSIONS } from "../data/document-store.js";
import { assertQueryPlan } from "./query-contract.js";

export const DEFAULT_DOCUMENT_TOP_K = 8;

const RETRIEVER_OPTION_FIELDS = new Set(["store", "embedQuery", "topK"]);
const RETRIEVAL_REQUEST_FIELDS = new Set([
  "queryId",
  "queryPlan",
  "question",
  "gameVersion",
]);
const DOCUMENT_RETRIEVAL_MODES = new Set([
  RETRIEVAL_MODES.DOCUMENT,
  RETRIEVAL_MODES.HYBRID,
]);
const REQUIRED_STORE_METHODS = Object.freeze([
  "listDocumentChunks",
  "getVector",
  "getSourceDocument",
]);

/**
 * Create a DocumentChunk retriever that ranks the fixed index by cosine
 * similarity. The embedder is injected so this stage stays offline and
 * deterministic; the live Ollama adapter belongs to T24.
 *
 * @param {{ store: object, embedQuery: Function, topK?: number }} options
 * @returns {{ retrieve: (request: object) => Promise<object> }}
 */
export function createDocumentRetriever(options) {
  const { store, embedQuery, topK } = validateRetrieverOptions(options);

  async function retrieve(request) {
    const { queryId, queryPlan, question, gameVersion } =
      validateRetrievalRequest(request);

    if (!DOCUMENT_RETRIEVAL_MODES.has(queryPlan.retrieval_mode)) {
      return createEmptyBundle(queryId);
    }

    const exactGameVersion = resolveExactGameVersion(queryPlan, gameVersion);
    const entityIds = collectResolvedEntityIds(queryPlan);
    const chunks = collectCandidateChunks(store, entityIds, exactGameVersion);
    if (chunks.length === 0) {
      return createEmptyBundle(queryId);
    }

    const queryVector = normalizeQueryVector(await embedQuery(question));
    const scored = chunks.map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryVector, getRequiredVector(store, chunk.chunk_id)),
    }));
    scored.sort((left, right) =>
      right.score - left.score || left.chunk.chunk_id.localeCompare(right.chunk.chunk_id),
    );

    const sourceDocuments = new Map();
    const items = scored.slice(0, topK).map((entry, index) => ({
      evidence_id: createEvidenceId(queryId, "chunk", entry.chunk.chunk_id),
      ...sourceProjection(
        getRequiredSource(store, sourceDocuments, entry.chunk.source_id),
      ),
      game_version: entry.chunk.game_version,
      chunk_id: entry.chunk.chunk_id,
      rank: index + 1,
      support_type: SUPPORT_TYPES.CONTEXTUAL,
    }));

    return { query_id: queryId, items, conflict_groups: [] };
  }

  return Object.freeze({ retrieve });
}

/**
 * Retrieve document evidence without retaining a retriever instance.
 *
 * @param {{
 *   store: object,
 *   embedQuery: Function,
 *   topK?: number,
 *   queryId: string,
 *   queryPlan: object,
 *   question: string,
 *   gameVersion?: string,
 * }} options
 * @returns {Promise<object>}
 */
export function retrieveDocumentEvidence(options) {
  if (!isRecord(options)) {
    throw new TypeError("Document retrieval options must be a plain object.");
  }
  const { store, embedQuery, topK, ...request } = options;
  return createDocumentRetriever({
    store,
    embedQuery,
    ...(topK === undefined ? {} : { topK }),
  }).retrieve(request);
}

function validateRetrieverOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Document retriever options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!RETRIEVER_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown document retriever option: ${field}.`);
    }
  }
  if (!isRecord(options.store)) {
    throw new TypeError("store must be a document store.");
  }
  for (const method of REQUIRED_STORE_METHODS) {
    if (typeof options.store[method] !== "function") {
      throw new TypeError(`store must be a document store with ${method}().`);
    }
  }
  if (typeof options.embedQuery !== "function") {
    throw new TypeError("embedQuery must be a function.");
  }
  const topK = options.topK ?? DEFAULT_DOCUMENT_TOP_K;
  if (!Number.isInteger(topK) || topK < 1) {
    throw new TypeError("topK must be a positive integer.");
  }
  return { store: options.store, embedQuery: options.embedQuery, topK };
}

function validateRetrievalRequest(request) {
  if (!isRecord(request)) {
    throw new TypeError("Document retrieval request must be a plain object.");
  }
  for (const field of Object.keys(request)) {
    if (!RETRIEVAL_REQUEST_FIELDS.has(field)) {
      throw new TypeError(`Unknown document retrieval request field: ${field}.`);
    }
  }
  if (!isDomainId(request.queryId, "query")) {
    throw new TypeError("queryId must be a typed query domain ID (qry:<key>).");
  }
  const queryPlan = assertQueryPlan(request.queryPlan);
  if (!isStableString(request.question)) {
    throw new TypeError(
      "question must be a non-empty string without surrounding whitespace.",
    );
  }
  if (request.gameVersion !== undefined && !isStableString(request.gameVersion)) {
    throw new TypeError(
      "gameVersion must be a non-empty string without surrounding whitespace.",
    );
  }
  return {
    queryId: request.queryId,
    queryPlan,
    question: request.question,
    gameVersion: request.gameVersion,
  };
}

function resolveExactGameVersion(queryPlan, gameVersion) {
  if (queryPlan.version_constraint !== VERSION_CONSTRAINTS.EXACT) {
    return undefined;
  }
  if (gameVersion === undefined) {
    throw new TypeError(
      "gameVersion is required for exact document retrieval because QueryPlan stores only the constraint type.",
    );
  }
  if (gameVersion === "unknown") {
    throw new TypeError("gameVersion cannot be unknown for an exact version constraint.");
  }
  return gameVersion;
}

function collectResolvedEntityIds(queryPlan) {
  const entityIds = [];
  const seen = new Set();
  for (const entity of queryPlan.normalized_entities) {
    if (entity.resolution_status !== "resolved" || seen.has(entity.entity_id)) {
      continue;
    }
    seen.add(entity.entity_id);
    entityIds.push(entity.entity_id);
  }
  return entityIds;
}

function collectCandidateChunks(store, entityIds, exactGameVersion) {
  const versionFilter =
    exactGameVersion === undefined ? {} : { gameVersion: exactGameVersion };

  // Version notices and unclassified world lore carry no entity_ids, so a plan
  // without resolved entities ranks the whole index instead of returning
  // nothing; T19 still refuses when the ranking produces no usable evidence.
  if (entityIds.length === 0) {
    return store.listDocumentChunks(versionFilter);
  }

  const chunks = new Map();
  for (const entityId of entityIds) {
    const filters = { entityId, ...versionFilter };
    for (const chunk of store.listDocumentChunks(filters)) {
      if (!chunks.has(chunk.chunk_id)) {
        chunks.set(chunk.chunk_id, chunk);
      }
    }
  }
  return [...chunks.values()];
}

function normalizeQueryVector(vector) {
  if (!(vector instanceof Float32Array) && !Array.isArray(vector)) {
    throw new TypeError("embedQuery must return a Float32Array or number array.");
  }
  if (vector.length !== FIXED_EMBEDDING_DIMENSIONS) {
    throw new TypeError(
      `Query vector must have ${FIXED_EMBEDDING_DIMENSIONS} dimensions; received ${vector.length}.`,
    );
  }
  const copy = Float32Array.from(vector);
  let hasMagnitude = false;
  for (let index = 0; index < copy.length; index += 1) {
    if (!Number.isFinite(copy[index])) {
      throw new TypeError(`Query vector[${index}] must be finite.`);
    }
    hasMagnitude ||= copy[index] !== 0;
  }
  if (!hasMagnitude) {
    throw new TypeError("Query vector must not be a zero vector.");
  }
  return copy;
}

function cosineSimilarity(left, right) {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dotProduct += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

function getRequiredVector(store, chunkId) {
  const vector = store.getVector(chunkId);
  if (vector === undefined) {
    throw new Error(`Indexed chunk ${chunkId} has no stored vector.`);
  }
  return vector;
}

function getRequiredSource(store, sourceDocuments, sourceId) {
  if (sourceDocuments.has(sourceId)) {
    return sourceDocuments.get(sourceId);
  }
  const source = store.getSourceDocument(sourceId);
  if (source === undefined) {
    throw new Error(`DocumentChunk references missing source metadata ${sourceId}.`);
  }
  sourceDocuments.set(sourceId, source);
  return source;
}

function createEvidenceId(queryId, recordKind, recordId) {
  const queryKey = queryId.slice(queryId.indexOf(":") + 1);
  const recordKey = recordId.slice(recordId.indexOf(":") + 1);
  return createDomainId("evidence", `${queryKey}-${recordKind}-${recordKey}`);
}

function sourceProjection(source) {
  return {
    source_id: source.source_id,
    source_kind: source.source_kind,
    source_url: source.source_url,
    source_title: source.title,
    ...(source.published_at === undefined
      ? {}
      : { source_published_at: source.published_at }),
    source_retrieved_at: source.retrieved_at,
  };
}

function createEmptyBundle(queryId) {
  return { query_id: queryId, items: [], conflict_groups: [] };
}
