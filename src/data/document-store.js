import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalEntity } from "./canonical-entity-contract.js";
import { assertDocumentChunk } from "./document-chunk-contract.js";
import { assertSourceDocument } from "./source-document-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";

export const DOCUMENT_STORE_SCHEMA_VERSION = 1;
export const FIXED_INDEX_MANIFEST_VERSION = 1;
export const FIXED_EMBEDDING_MODEL = "bge-m3:latest";
export const FIXED_EMBEDDING_MODEL_DIGEST =
  "7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab";
export const FIXED_EMBEDDING_DIMENSIONS = 1024;
export const DEFAULT_DOCUMENT_STORE_DATABASE_PATH = ":memory:";

const STORE_OPTION_FIELDS = new Set(["databasePath"]);
const LIST_FILTER_FIELDS = new Set(["sourceId", "entityId", "gameVersion"]);
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const CREATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS document_store_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL,
    manifest_version INTEGER,
    embedding_model TEXT,
    embedding_model_digest TEXT,
    embedding_dimensions INTEGER,
    index_hash TEXT
  ) STRICT;

  INSERT INTO document_store_metadata (singleton, schema_version)
  VALUES (1, ${DOCUMENT_STORE_SCHEMA_VERSION})
  ON CONFLICT (singleton) DO NOTHING;

  CREATE TABLE IF NOT EXISTS document_sources (
    source_id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    source_url TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    retrieved_at TEXT NOT NULL,
    game_version TEXT,
    locale TEXT NOT NULL,
    rights_note TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS document_entities (
    entity_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    aliases_json TEXT NOT NULL CHECK (json_valid(aliases_json)),
    locale TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS document_chunks (
    chunk_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES document_sources(source_id),
    document_locator TEXT NOT NULL,
    text TEXT NOT NULL,
    token_hint INTEGER NOT NULL,
    game_version TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS document_chunk_entities (
    chunk_id TEXT NOT NULL REFERENCES document_chunks(chunk_id),
    entity_id TEXT NOT NULL REFERENCES document_entities(entity_id),
    PRIMARY KEY (chunk_id, entity_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS document_vectors (
    chunk_id TEXT PRIMARY KEY REFERENCES document_chunks(chunk_id),
    vector_blob BLOB NOT NULL,
    vector_hash TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_document_chunks_source
    ON document_chunks (source_id, chunk_id);
  CREATE INDEX IF NOT EXISTS idx_document_chunks_version
    ON document_chunks (game_version, chunk_id);
  CREATE INDEX IF NOT EXISTS idx_document_chunk_entities_entity
    ON document_chunk_entities (entity_id, chunk_id);
`;

const CLEAR_INDEX_SQL = `
  DELETE FROM document_vectors;
  DELETE FROM document_chunk_entities;
  DELETE FROM document_chunks;
  DELETE FROM document_entities;
  DELETE FROM document_sources;
`;

/**
 * Create the SQLite-backed DocumentChunk and vector store. Vector similarity is
 * intentionally left to the retrieval layer; this module owns persistence and
 * deterministic index integrity only.
 *
 * @param {{ databasePath?: string }} [options]
 * @returns {{
 *   replaceIndex: (data: object, vectors: Float32Array[], manifest: object) => object,
 *   listDocumentChunks: (filters?: object) => object[],
 *   getDocumentChunk: (chunkId: string) => object | undefined,
 *   getSourceDocument: (sourceId: string) => object | undefined,
 *   getVector: (chunkId: string) => Float32Array | undefined,
 *   getIndexManifest: () => object | undefined,
 *   verifyIndex: () => object,
 *   getStatus: () => object,
 *   close: () => void,
 * }}
 */
export function createDocumentStore(options = {}) {
  const databasePath = validateStoreOptions(options);
  const database = new DatabaseSync(databasePath);
  let isOpen = true;
  let lastStatus;

  try {
    database.exec("PRAGMA foreign_keys = ON;");
    assertExistingSchemaCompatible(database);
    database.exec(CREATE_SCHEMA_SQL);
    assertCompatibleSchema(database);
    lastStatus = readStatus(database, isOpen);
  } catch (error) {
    database.close();
    throw error;
  }

  const statements = prepareStatements(database);

  function replaceIndex(data, vectors, manifest) {
    assertStoreIsOpen(isOpen);
    const validated = validateIndexData(data);
    const validatedVectors = validateVectors(vectors, validated.documentChunks.length);
    const expectedManifest = createIndexManifest(validated, validatedVectors);
    assertManifestMatches(manifest, expectedManifest);
    let transactionStarted = false;

    try {
      database.exec("BEGIN IMMEDIATE;");
      transactionStarted = true;
      database.exec(CLEAR_INDEX_SQL);
      insertIndex(statements, validated, validatedVectors, expectedManifest);
      database.exec("COMMIT;");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        rollbackAfterFailure(database, error);
      }
      throw error;
    }

    lastStatus = readStatus(database, isOpen);
    return lastStatus;
  }

  function listDocumentChunks(filters = {}) {
    assertStoreIsOpen(isOpen);
    const validatedFilters = validateListFilters(filters);
    const { sql, parameters } = buildChunkListQuery(validatedFilters);
    return database.prepare(sql).all(...parameters).map((row) =>
      toDocumentChunk(database, row),
    );
  }

  function getDocumentChunk(chunkId) {
    assertStoreIsOpen(isOpen);
    assertTypedId(chunkId, "chunk", "chunkId");
    const row = database
      .prepare("SELECT * FROM document_chunks WHERE chunk_id = ?")
      .get(chunkId);
    return row === undefined ? undefined : toDocumentChunk(database, row);
  }

  function getSourceDocument(sourceId) {
    assertStoreIsOpen(isOpen);
    assertTypedId(sourceId, "src", "sourceId");
    const row = database
      .prepare("SELECT * FROM document_sources WHERE source_id = ?")
      .get(sourceId);
    return row === undefined ? undefined : toSourceDocument(row);
  }

  function getVector(chunkId) {
    assertStoreIsOpen(isOpen);
    assertTypedId(chunkId, "chunk", "chunkId");
    const row = database
      .prepare("SELECT vector_blob FROM document_vectors WHERE chunk_id = ?")
      .get(chunkId);
    return row === undefined ? undefined : decodeVector(row.vector_blob);
  }

  function getIndexManifest() {
    assertStoreIsOpen(isOpen);
    return readIndexManifest(database);
  }

  function verifyIndex() {
    assertStoreIsOpen(isOpen);
    const manifest = readIndexManifest(database);
    if (manifest === undefined) {
      return Object.freeze({ ok: false, reason: "index_not_built" });
    }

    const entries = readManifestEntries(database);
    const actualHash = hashCanonicalManifest({
      manifest_version: manifest.manifest_version,
      embedding_model: manifest.embedding_model,
      embedding_model_digest: manifest.embedding_model_digest,
      embedding_dimensions: manifest.embedding_dimensions,
      entries,
    });
    const vectorsValid = entries.every((entry) => entry.vector_hash === entry.actual_vector_hash);
    return Object.freeze({
      ok: vectorsValid && actualHash === manifest.index_hash,
      index_hash: manifest.index_hash,
      actual_index_hash: actualHash,
      chunk_count: entries.length,
    });
  }

  function getStatus() {
    if (isOpen) {
      lastStatus = readStatus(database, isOpen);
    }
    return lastStatus;
  }

  function close() {
    if (!isOpen) {
      return;
    }
    lastStatus = readStatus(database, false);
    database.close();
    isOpen = false;
  }

  return Object.freeze({
    replaceIndex,
    listDocumentChunks,
    getDocumentChunk,
    getSourceDocument,
    getVector,
    getIndexManifest,
    verifyIndex,
    getStatus,
    close,
  });
}

/**
 * Build and atomically persist the fixed-model index.
 *
 * @param {{
 *   store: ReturnType<typeof createDocumentStore>,
 *   data: Record<string, unknown>,
 *   embedDocuments: (texts: string[], model: object) => Promise<unknown> | unknown,
 * }} options
 * @returns {Promise<object>}
 */
export async function buildFixedIndex(options) {
  if (!isRecord(options)) {
    throw new TypeError("Fixed index options must be a plain object.");
  }
  if (typeof options.store?.replaceIndex !== "function") {
    throw new TypeError("store must be a document store.");
  }
  if (typeof options.embedDocuments !== "function") {
    throw new TypeError("embedDocuments must be a function.");
  }

  const data = validateIndexData(options.data);
  const texts = data.documentChunks.map((chunk) => chunk.text);
  const output = await options.embedDocuments([...texts], Object.freeze({
    model: FIXED_EMBEDDING_MODEL,
    digest: FIXED_EMBEDDING_MODEL_DIGEST,
    dimensions: FIXED_EMBEDDING_DIMENSIONS,
  }));
  const vectors = validateVectors(output, texts.length);
  const manifest = createIndexManifest(data, vectors);
  options.store.replaceIndex(options.data, vectors, manifest);
  return manifest;
}

function validateStoreOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Document store options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!STORE_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown document store option: ${field}.`);
    }
  }
  const databasePath = options.databasePath ?? DEFAULT_DOCUMENT_STORE_DATABASE_PATH;
  if (!isStableString(databasePath)) {
    throw new TypeError("databasePath must be a non-empty string without surrounding whitespace.");
  }
  return databasePath;
}

function assertExistingSchemaCompatible(database) {
  const row = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'document_store_metadata'
  `).get();
  if (row !== undefined) {
    assertCompatibleSchema(database);
  }
}

function assertCompatibleSchema(database) {
  const row = database
    .prepare("SELECT schema_version FROM document_store_metadata WHERE singleton = 1")
    .get();
  if (row?.schema_version !== DOCUMENT_STORE_SCHEMA_VERSION) {
    throw new Error(`Unsupported document store schema version: ${String(row?.schema_version)}.`);
  }
}

function prepareStatements(database) {
  return Object.freeze({
    metadata: database.prepare(`
      UPDATE document_store_metadata SET
        manifest_version = ?, embedding_model = ?, embedding_model_digest = ?,
        embedding_dimensions = ?, index_hash = ?
      WHERE singleton = 1
    `),
    source: database.prepare(`
      INSERT INTO document_sources (
        source_id, source_kind, source_url, title, published_at, retrieved_at,
        game_version, locale, rights_note, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    entity: database.prepare(`
      INSERT INTO document_entities (
        entity_id, entity_type, canonical_name, aliases_json, locale
      ) VALUES (?, ?, ?, ?, ?)
    `),
    chunk: database.prepare(`
      INSERT INTO document_chunks (
        chunk_id, source_id, document_locator, text, token_hint, game_version
      ) VALUES (?, ?, ?, ?, ?, ?)
    `),
    chunkEntity: database.prepare(`
      INSERT INTO document_chunk_entities (chunk_id, entity_id) VALUES (?, ?)
    `),
    vector: database.prepare(`
      INSERT INTO document_vectors (chunk_id, vector_blob, vector_hash) VALUES (?, ?, ?)
    `),
  });
}

function validateIndexData(data) {
  if (!isRecord(data)) {
    throw new TypeError("Document index data must be a plain object.");
  }
  for (const field of ["source_documents", "canonical_entities", "document_chunks"]) {
    if (!Array.isArray(data[field])) {
      throw new TypeError(`${field} must be an array.`);
    }
  }

  const sourceDocuments = validateRecords(data.source_documents, assertSourceDocument, "source_documents");
  const canonicalEntities = validateRecords(data.canonical_entities, assertCanonicalEntity, "canonical_entities");
  const documentChunks = validateRecords(data.document_chunks, assertDocumentChunk, "document_chunks");
  const sources = uniqueRecordMap(sourceDocuments, "source_id", "source_documents");
  const entities = uniqueRecordMap(canonicalEntities, "entity_id", "canonical_entities");
  uniqueRecordMap(documentChunks, "chunk_id", "document_chunks");

  for (const chunk of documentChunks) {
    if (!sources.has(chunk.source_id)) {
      throw new TypeError(`DocumentChunk ${chunk.chunk_id} references missing source ${chunk.source_id}.`);
    }
    for (const entityId of chunk.entity_ids) {
      if (!entities.has(entityId)) {
        throw new TypeError(`DocumentChunk ${chunk.chunk_id} references missing entity ${entityId}.`);
      }
    }
  }

  return { sourceDocuments, canonicalEntities, documentChunks };
}

function validateRecords(records, assertion, fieldName) {
  return records.map((record, index) => {
    try {
      return assertion(record);
    } catch (error) {
      throw new TypeError(`${fieldName}[${index}] is invalid: ${error.message}`, { cause: error });
    }
  });
}

function uniqueRecordMap(records, key, fieldName) {
  const result = new Map();
  for (const record of records) {
    if (result.has(record[key])) {
      throw new TypeError(`${fieldName} contains duplicate ID ${record[key]}.`);
    }
    result.set(record[key], record);
  }
  return result;
}

function validateVectors(vectors, expectedCount) {
  if (!Array.isArray(vectors)) {
    throw new TypeError("Embedding output must be an array of vectors.");
  }
  if (vectors.length !== expectedCount) {
    throw new TypeError(`Embedding output count must be ${expectedCount}; received ${vectors.length}.`);
  }

  return vectors.map((vector, vectorIndex) => {
    if (!(vector instanceof Float32Array) && !Array.isArray(vector)) {
      throw new TypeError(`Embedding vector ${vectorIndex} must be a Float32Array or number array.`);
    }
    if (vector.length !== FIXED_EMBEDDING_DIMENSIONS) {
      throw new TypeError(
        `Embedding vector ${vectorIndex} must have ${FIXED_EMBEDDING_DIMENSIONS} dimensions.`,
      );
    }
    const copy = Float32Array.from(vector);
    let hasMagnitude = false;
    for (let dimension = 0; dimension < copy.length; dimension += 1) {
      if (!Number.isFinite(copy[dimension])) {
        throw new TypeError(`Embedding vector ${vectorIndex}[${dimension}] must be finite.`);
      }
      hasMagnitude ||= copy[dimension] !== 0;
    }
    if (!hasMagnitude) {
      throw new TypeError(`Embedding vector ${vectorIndex} must not be a zero vector.`);
    }
    return copy;
  });
}

function createIndexManifest(data, vectors) {
  const vectorByChunkId = new Map(
    data.documentChunks.map((chunk, index) => [chunk.chunk_id, encodeVector(vectors[index])]),
  );
  const entries = [...data.documentChunks]
    .sort((left, right) => left.chunk_id.localeCompare(right.chunk_id))
    .map((chunk) => {
      const vectorBlob = vectorByChunkId.get(chunk.chunk_id);
      const vectorHash = sha256(vectorBlob);
      return Object.freeze({
        chunk_id: chunk.chunk_id,
        chunk_hash: sha256(canonicalJson(chunkIntegrityPayload(chunk))),
        vector_hash: vectorHash,
      });
    });
  const manifestBody = {
    manifest_version: FIXED_INDEX_MANIFEST_VERSION,
    embedding_model: FIXED_EMBEDDING_MODEL,
    embedding_model_digest: FIXED_EMBEDDING_MODEL_DIGEST,
    embedding_dimensions: FIXED_EMBEDDING_DIMENSIONS,
    entries,
  };
  return Object.freeze({
    ...manifestBody,
    index_hash: hashCanonicalManifest(manifestBody),
  });
}

function assertManifestMatches(actual, expected) {
  if (!isRecord(actual) || canonicalJson(actual) !== canonicalJson(expected)) {
    throw new TypeError("Index manifest does not match the supplied chunks and vectors.");
  }
}

function insertIndex(statements, data, vectors, manifest) {
  statements.metadata.run(
    manifest.manifest_version,
    manifest.embedding_model,
    manifest.embedding_model_digest,
    manifest.embedding_dimensions,
    manifest.index_hash,
  );
  for (const source of data.sourceDocuments) {
    statements.source.run(
      source.source_id, source.source_kind, source.source_url, source.title,
      source.published_at ?? null, source.retrieved_at, source.game_version ?? null,
      source.locale, source.rights_note, source.content_hash,
    );
  }
  for (const entity of data.canonicalEntities) {
    statements.entity.run(
      entity.entity_id, entity.entity_type, entity.canonical_name,
      JSON.stringify(entity.aliases), entity.locale,
    );
  }
  data.documentChunks.forEach((chunk, index) => {
    statements.chunk.run(
      chunk.chunk_id, chunk.source_id, chunk.document_locator, chunk.text,
      chunk.token_hint, chunk.game_version,
    );
    for (const entityId of chunk.entity_ids) {
      statements.chunkEntity.run(chunk.chunk_id, entityId);
    }
    const blob = encodeVector(vectors[index]);
    statements.vector.run(chunk.chunk_id, blob, sha256(blob));
  });
}

function validateListFilters(filters) {
  if (!isRecord(filters)) {
    throw new TypeError("DocumentChunk filters must be a plain object.");
  }
  for (const field of Object.keys(filters)) {
    if (!LIST_FILTER_FIELDS.has(field)) {
      throw new TypeError(`Unknown DocumentChunk filter: ${field}.`);
    }
  }
  if (filters.sourceId !== undefined) assertTypedId(filters.sourceId, "src", "sourceId");
  if (filters.entityId !== undefined) assertTypedId(filters.entityId, "ent", "entityId");
  if (filters.gameVersion !== undefined && !isStableString(filters.gameVersion)) {
    throw new TypeError("gameVersion must be a non-empty string without surrounding whitespace.");
  }
  return filters;
}

function buildChunkListQuery(filters) {
  const clauses = [];
  const parameters = [];
  let join = "";
  if (filters.entityId !== undefined) {
    join = "JOIN document_chunk_entities dce ON dce.chunk_id = dc.chunk_id";
    clauses.push("dce.entity_id = ?");
    parameters.push(filters.entityId);
  }
  if (filters.sourceId !== undefined) {
    clauses.push("dc.source_id = ?");
    parameters.push(filters.sourceId);
  }
  if (filters.gameVersion !== undefined) {
    clauses.push("dc.game_version = ?");
    parameters.push(filters.gameVersion);
  }
  return {
    sql: `SELECT dc.* FROM document_chunks dc ${join} ${
      clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
    } ORDER BY dc.chunk_id ASC`,
    parameters,
  };
}

function toDocumentChunk(database, row) {
  const entityIds = database.prepare(`
    SELECT entity_id FROM document_chunk_entities
    WHERE chunk_id = ? ORDER BY entity_id ASC
  `).all(row.chunk_id).map((entry) => entry.entity_id);
  return {
    chunk_id: row.chunk_id,
    source_id: row.source_id,
    document_locator: row.document_locator,
    text: row.text,
    token_hint: row.token_hint,
    game_version: row.game_version,
    entity_ids: entityIds,
  };
}

function toSourceDocument(row) {
  return {
    source_id: row.source_id,
    source_kind: row.source_kind,
    source_url: row.source_url,
    title: row.title,
    ...(row.published_at === null ? {} : { published_at: row.published_at }),
    retrieved_at: row.retrieved_at,
    ...(row.game_version === null ? {} : { game_version: row.game_version }),
    locale: row.locale,
    rights_note: row.rights_note,
    content_hash: row.content_hash,
  };
}

function readIndexManifest(database) {
  const metadata = database.prepare(`
    SELECT manifest_version, embedding_model, embedding_model_digest,
           embedding_dimensions, index_hash
    FROM document_store_metadata WHERE singleton = 1
  `).get();
  if (metadata?.index_hash === null || metadata?.index_hash === undefined) {
    return undefined;
  }
  return Object.freeze({
    manifest_version: metadata.manifest_version,
    embedding_model: metadata.embedding_model,
    embedding_model_digest: metadata.embedding_model_digest,
    embedding_dimensions: metadata.embedding_dimensions,
    entries: readManifestEntries(database).map(({ actual_vector_hash, ...entry }) => entry),
    index_hash: metadata.index_hash,
  });
}

function readManifestEntries(database) {
  return database.prepare(`
    SELECT dc.chunk_id, dc.source_id, dc.document_locator, dc.text,
           dc.token_hint, dc.game_version, dv.vector_hash, dv.vector_blob
    FROM document_chunks dc JOIN document_vectors dv ON dv.chunk_id = dc.chunk_id
    ORDER BY dc.chunk_id ASC
  `).all().map((row) => {
    const chunk = toDocumentChunk(database, row);
    return {
      chunk_id: row.chunk_id,
      chunk_hash: sha256(canonicalJson(chunkIntegrityPayload(chunk))),
      vector_hash: row.vector_hash,
      actual_vector_hash: sha256(row.vector_blob),
    };
  });
}

function readStatus(database, open) {
  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM document_sources) AS source_count,
      (SELECT COUNT(*) FROM document_entities) AS entity_count,
      (SELECT COUNT(*) FROM document_chunks) AS chunk_count,
      (SELECT COUNT(*) FROM document_vectors) AS vector_count,
      (SELECT index_hash FROM document_store_metadata WHERE singleton = 1) AS index_hash
  `).get();
  return Object.freeze({
    isOpen: open,
    schemaVersion: DOCUMENT_STORE_SCHEMA_VERSION,
    counts: Object.freeze({
      sourceDocuments: Number(counts.source_count),
      canonicalEntities: Number(counts.entity_count),
      documentChunks: Number(counts.chunk_count),
      vectors: Number(counts.vector_count),
    }),
    indexHash: counts.index_hash ?? null,
  });
}

function encodeVector(vector) {
  const buffer = Buffer.allocUnsafe(FIXED_EMBEDDING_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT);
  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index], index * Float32Array.BYTES_PER_ELEMENT);
  }
  return buffer;
}

function decodeVector(blob) {
  const buffer = Buffer.from(blob);
  if (buffer.length !== FIXED_EMBEDDING_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`Stored vector must contain ${FIXED_EMBEDDING_DIMENSIONS} dimensions.`);
  }
  const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] = buffer.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT);
  }
  return vector;
}

function chunkIntegrityPayload(chunk) {
  return { ...chunk, entity_ids: [...chunk.entity_ids].sort() };
}

function hashCanonicalManifest(manifest) {
  const entries = manifest.entries.map(({ actual_vector_hash, ...entry }) => entry);
  return sha256(canonicalJson({ ...manifest, entries }));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertTypedId(value, prefix, label) {
  if (!isStableString(value) || !value.startsWith(`${prefix}:`) || value.length <= prefix.length + 1) {
    throw new TypeError(`${label} must be a typed ${prefix}:<stable-key> ID.`);
  }
}

function assertStoreIsOpen(isOpen) {
  if (!isOpen) {
    throw new Error("Document store is closed.");
  }
}

function rollbackAfterFailure(database, originalError) {
  try {
    database.exec("ROLLBACK;");
  } catch (rollbackError) {
    throw new AggregateError(
      [originalError, rollbackError],
      "Document index replacement and rollback both failed.",
    );
  }
}
