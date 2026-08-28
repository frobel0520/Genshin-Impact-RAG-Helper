import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import {
  DOCUMENT_STORE_SCHEMA_VERSION,
  FIXED_EMBEDDING_DIMENSIONS,
  FIXED_EMBEDDING_MODEL,
  FIXED_EMBEDDING_MODEL_DIGEST,
  FIXED_INDEX_MANIFEST_VERSION,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";

const fixturePack = loadFixtureSourcePack();

function fixtureData() {
  return structuredClone({
    source_documents: fixturePack.source_documents,
    canonical_entities: fixturePack.canonical_entities,
    document_chunks: fixturePack.document_chunks,
  });
}

function deterministicEmbedder(texts) {
  return texts.map((text, index) => {
    const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
    vector[0] = index + 1;
    vector[1] = text.length;
    vector[FIXED_EMBEDDING_DIMENSIONS - 1] = 0.5;
    return vector;
  });
}

function closeAfterTest(context, store) {
  context.after(() => {
    if (store.getStatus().isOpen) store.close();
  });
}

test("fixed index builds all fixture chunks with a verifiable manifest", async (context) => {
  const store = createDocumentStore();
  closeAfterTest(context, store);
  const data = fixtureData();
  const before = structuredClone(data);
  let receivedModel;

  const manifest = await buildFixedIndex({
    store,
    data,
    embedDocuments(texts, model) {
      receivedModel = model;
      return deterministicEmbedder(texts);
    },
  });

  assert.deepEqual(receivedModel, {
    model: FIXED_EMBEDDING_MODEL,
    digest: FIXED_EMBEDDING_MODEL_DIGEST,
    dimensions: FIXED_EMBEDDING_DIMENSIONS,
  });
  assert.equal(manifest.manifest_version, FIXED_INDEX_MANIFEST_VERSION);
  assert.equal(manifest.embedding_model, FIXED_EMBEDDING_MODEL);
  assert.equal(manifest.embedding_model_digest, FIXED_EMBEDDING_MODEL_DIGEST);
  assert.equal(manifest.embedding_dimensions, FIXED_EMBEDDING_DIMENSIONS);
  assert.equal(manifest.entries.length, data.document_chunks.length);
  assert.deepEqual(
    manifest.entries.map((entry) => entry.chunk_id),
    data.document_chunks.map((chunk) => chunk.chunk_id).sort(),
  );
  assert.match(manifest.index_hash, /^[a-f0-9]{64}$/);
  assert.ok(manifest.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.vector_hash)));
  assert.deepEqual(store.getIndexManifest(), manifest);
  assert.deepEqual(store.verifyIndex(), {
    ok: true,
    index_hash: manifest.index_hash,
    actual_index_hash: manifest.index_hash,
    chunk_count: data.document_chunks.length,
  });
  assert.deepEqual(data, before);
  assert.deepEqual(store.getStatus(), {
    isOpen: true,
    schemaVersion: DOCUMENT_STORE_SCHEMA_VERSION,
    counts: {
      sourceDocuments: data.source_documents.length,
      canonicalEntities: data.canonical_entities.length,
      documentChunks: data.document_chunks.length,
      vectors: data.document_chunks.length,
    },
    indexHash: manifest.index_hash,
  });
});
test("index hash is deterministic for the same chunks and vectors", async (context) => {
  const firstStore = createDocumentStore();
  const secondStore = createDocumentStore();
  closeAfterTest(context, firstStore);
  closeAfterTest(context, secondStore);

  const first = await buildFixedIndex({
    store: firstStore,
    data: fixtureData(),
    embedDocuments: deterministicEmbedder,
  });
  const second = await buildFixedIndex({
    store: secondStore,
    data: fixtureData(),
    embedDocuments: deterministicEmbedder,
  });

  assert.equal(first.index_hash, second.index_hash);
  assert.deepEqual(first.entries, second.entries);
});

test("document chunks can be listed, filtered, and read with their vectors", async (context) => {
  const store = createDocumentStore();
  closeAfterTest(context, store);
  const data = fixtureData();
  await buildFixedIndex({ store, data, embedDocuments: deterministicEmbedder });

  const chunks = store.listDocumentChunks();
  assert.equal(chunks.length, data.document_chunks.length);
  assert.deepEqual(store.getDocumentChunk(chunks[0].chunk_id), chunks[0]);
  assert.deepEqual(
    store.listDocumentChunks({ entityId: "ent:kamisato-ayaka" }).map((chunk) => chunk.chunk_id),
    data.document_chunks
      .filter((chunk) => chunk.entity_ids.includes("ent:kamisato-ayaka"))
      .map((chunk) => chunk.chunk_id)
      .sort(),
  );
  const sourceId = data.document_chunks[0].source_id;
  assert.ok(store.listDocumentChunks({ sourceId }).every((chunk) => chunk.source_id === sourceId));
  assert.ok(store.listDocumentChunks({ gameVersion: "5.0" }).every(
    (chunk) => chunk.game_version === "5.0",
  ));
  assert.ok(chunks.some((chunk) => chunk.entity_ids.length === 0));

  const originalIndex = data.document_chunks.findIndex((chunk) => chunk.chunk_id === chunks[0].chunk_id);
  const vector = store.getVector(chunks[0].chunk_id);
  assert.ok(vector instanceof Float32Array);
  assert.equal(vector.length, FIXED_EMBEDDING_DIMENSIONS);
  assert.equal(vector[0], originalIndex + 1);
  assert.equal(vector[FIXED_EMBEDDING_DIMENSIONS - 1], 0.5);
  assert.equal(store.getDocumentChunk("chunk:not-found"), undefined);
  assert.equal(store.getVector("chunk:not-found"), undefined);
});

test("source metadata remains available for retrieval citations", async (context) => {
  const store = createDocumentStore();
  closeAfterTest(context, store);
  const data = fixtureData();
  await buildFixedIndex({ store, data, embedDocuments: deterministicEmbedder });

  const expected = data.source_documents[0];
  assert.deepEqual(store.getSourceDocument(expected.source_id), expected);
  assert.equal(store.getSourceDocument("src:not-found"), undefined);
});

test("invalid embedding output leaves the existing index unchanged", async (context) => {
  const store = createDocumentStore();
  closeAfterTest(context, store);
  const data = fixtureData();
  const manifest = await buildFixedIndex({ store, data, embedDocuments: deterministicEmbedder });

  await assert.rejects(
    buildFixedIndex({ store, data, embedDocuments: () => [] }),
    /output count/,
  );
  await assert.rejects(
    buildFixedIndex({
      store,
      data,
      embedDocuments: (texts) => texts.map(() => new Float32Array(3)),
    }),
    /1024 dimensions/,
  );
  await assert.rejects(
    buildFixedIndex({
      store,
      data,
      embedDocuments: (texts) => texts.map(() => new Float32Array(FIXED_EMBEDDING_DIMENSIONS)),
    }),
    /zero vector/,
  );

  assert.equal(store.getIndexManifest().index_hash, manifest.index_hash);
  assert.equal(store.listDocumentChunks().length, data.document_chunks.length);
});

test("missing references and duplicate IDs fail before embedding", async (context) => {
  const store = createDocumentStore();
  closeAfterTest(context, store);
  const missingSource = fixtureData();
  missingSource.source_documents = missingSource.source_documents.filter(
    (source) => source.source_id !== missingSource.document_chunks[0].source_id,
  );
  let calls = 0;

  await assert.rejects(
    buildFixedIndex({
      store,
      data: missingSource,
      embedDocuments() {
        calls += 1;
        return [];
      },
    }),
    /references missing source/,
  );

  const duplicate = fixtureData();
  duplicate.document_chunks.push(structuredClone(duplicate.document_chunks[0]));
  await assert.rejects(
    buildFixedIndex({ store, data: duplicate, embedDocuments: deterministicEmbedder }),
    /duplicate ID/,
  );
  assert.equal(calls, 0);
  assert.equal(store.getIndexManifest(), undefined);
  assert.deepEqual(store.verifyIndex(), { ok: false, reason: "index_not_built" });
});

test("file-backed index survives close and reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "genshin-document-store-"));
  const databasePath = join(directory, "document-store.sqlite");
  try {
    const firstStore = createDocumentStore({ databasePath });
    const manifest = await buildFixedIndex({
      store: firstStore,
      data: fixtureData(),
      embedDocuments: deterministicEmbedder,
    });
    firstStore.close();

    const reopenedStore = createDocumentStore({ databasePath });
    try {
      assert.equal(reopenedStore.getIndexManifest().index_hash, manifest.index_hash);
      assert.equal(reopenedStore.verifyIndex().ok, true);
      assert.equal(reopenedStore.listDocumentChunks().length, fixturePack.document_chunks.length);
    } finally {
      reopenedStore.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("incompatible schema is rejected without mutation", () => {
  const directory = mkdtempSync(join(tmpdir(), "genshin-document-store-schema-"));
  const databasePath = join(directory, "document-store.sqlite");
  try {
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE document_store_metadata (
        singleton INTEGER PRIMARY KEY,
        schema_version INTEGER NOT NULL
      );
      INSERT INTO document_store_metadata VALUES (1, 999);
    `);
    database.close();

    assert.throws(
      () => createDocumentStore({ databasePath }),
      /Unsupported document store schema version: 999/,
    );

    const inspection = new DatabaseSync(databasePath);
    try {
      const tables = inspection.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
      `).all().map((row) => row.name);
      assert.deepEqual(tables, ["document_store_metadata"]);
    } finally {
      inspection.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
