import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_EMBEDDING_DIMENSIONS,
  FIXED_EMBEDDING_MODEL,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { assertRunResponse } from "../src/domain/run-response-contract.js";
import { INGEST_STAGES, runIngestBuild, runIngestValidate } from "../src/ingest/ingest-pipeline.js";
import { createOllamaEmbedder } from "../src/ingest/ollama-embedder.js";

const fixturePack = loadFixtureSourcePack();

function dataset() {
  return structuredClone(fixturePack);
}

function embedText(text) {
  const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
  for (const character of text) {
    vector[character.codePointAt(0) % FIXED_EMBEDDING_DIMENSIONS] += 1;
  }
  vector[0] += 1;
  return vector;
}

function stores(context) {
  const structuredStore = createStructuredStore();
  const documentStore = createDocumentStore();
  context.after(() => {
    if (structuredStore.getStatus().isOpen) structuredStore.close();
    if (documentStore.getStatus().isOpen) documentStore.close();
  });
  return { structuredStore, documentStore };
}

function buildRequest(context, overrides = {}) {
  return {
    dataset: dataset(),
    ...stores(context),
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
    ...overrides,
  };
}

test("validating the fixture dataset passes and writes nothing", () => {
  const response = runIngestValidate({ dataset: dataset() });

  assert.equal(assertRunResponse(response), response);
  assert.equal(response.status, "passed");
  assert.deepEqual(response.errors, []);
  assert.deepEqual(response.artifacts, []);
  assert.match(response.input_version, /^[a-f0-9]{64}$/);
});

test("input_version is derived from the dataset, not from the clock", () => {
  const first = runIngestValidate({ dataset: dataset() });
  const second = runIngestValidate({ dataset: dataset() });

  const changed = dataset();
  changed.source_documents[0].source_title = "A different title";
  const third = runIngestValidate({ dataset: changed });

  assert.equal(first.input_version, second.input_version);
  assert.notEqual(third.input_version, first.input_version);
});

test("a malformed source document fails with a locatable error", () => {
  const broken = dataset();
  broken.source_documents[0].source_url = "not-a-url";

  const response = runIngestValidate({ dataset: broken });

  assert.equal(response.status, "failed");
  assert.equal(response.errors[0].code, "invalid_request");
  assert.equal(response.errors[0].source_id, broken.source_documents[0].source_id);
  assert.match(response.errors[0].path, /source_url/);
});

test("a broken cross-collection reference is caught before anything is written", async (context) => {
  const broken = buildRequest(context);
  broken.dataset.structured_facts[0].source_id = "src:does-not-exist";

  const response = await runIngestBuild(broken);

  assert.equal(response.status, "failed");
  assert.deepEqual(response.artifacts, []);
  assert.equal(broken.structuredStore.getStatus().counts.structuredFacts, 0);
  assert.equal(broken.documentStore.getStatus().counts.documentChunks, 0);
});

test("building the fixture dataset fills both stores and reports both artifacts", async (context) => {
  const request = buildRequest(context, {
    structuredStorePath: "artifacts/structured.db",
    documentStorePath: "artifacts/index.db",
  });

  const response = await runIngestBuild(request);

  assert.equal(assertRunResponse(response), response);
  assert.equal(response.status, "passed");
  assert.deepEqual(
    response.artifacts.map((artifact) => [artifact.kind, artifact.path]),
    [
      ["structured_store", "artifacts/structured.db"],
      ["document_index", "artifacts/index.db"],
    ],
  );
  for (const artifact of response.artifacts) {
    assert.match(artifact.content_hash, /^[a-f0-9]{64}$/);
  }
  assert.equal(
    response.artifacts[1].content_hash,
    request.documentStore.getIndexManifest().index_hash,
  );
  assert.equal(
    request.structuredStore.getStatus().counts.structuredFacts,
    fixturePack.structured_facts.length,
  );
  assert.equal(request.documentStore.verifyIndex().ok, true);
});

test("two builds of the same dataset produce the same index hash", async (context) => {
  const first = await runIngestBuild(buildRequest(context));
  const second = await runIngestBuild(buildRequest(context));

  assert.equal(first.artifacts[1].content_hash, second.artifacts[1].content_hash);
  assert.equal(first.input_version, second.input_version);
});

test("colliding entity names stop the build before the store is replaced", async (context) => {
  const request = buildRequest(context);
  request.dataset.canonical_entities[1].canonical_name =
    request.dataset.canonical_entities[0].canonical_name;

  const response = await runIngestBuild(request);

  assert.equal(response.status, "failed");
  assert.deepEqual(response.artifacts, []);
  assert.equal(request.structuredStore.getStatus().counts.canonicalEntities, 0);
});

test("an embedder failure is reported as partial, because the store was already replaced", async (context) => {
  const request = buildRequest(context, {
    embedDocuments: () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:11434");
      error.code = "ECONNREFUSED";
      throw error;
    },
  });

  const response = await runIngestBuild(request);

  assert.equal(response.status, "partial");
  assert.equal(response.errors[0].code, "dependency_unavailable");
  assert.deepEqual(
    response.artifacts.map((artifact) => artifact.kind),
    ["structured_store"],
  );
  assert.equal(request.documentStore.getStatus().indexHash, null);
});

test("the stage order is the documented gate order", () => {
  assert.deepEqual(INGEST_STAGES, [
    "validate_batch",
    "validate_dataset",
    "normalize_names",
    "replace_structured_store",
    "build_document_index",
  ]);
});

test("ingest requests are validated before any work starts", () => {
  assert.throws(() => runIngestValidate({ dataset: dataset(), unexpected: true }), /Unknown ingest/);
  assert.throws(() => runIngestValidate({ dataset: dataset(), now: "noon" }), /now must be/);
  assert.rejects(() => runIngestBuild({ dataset: dataset() }), /structuredStore/);
});

test("the Ollama embedder turns a live response into fixed-width vectors", async () => {
  const requests = [];
  const embedder = createOllamaEmbedder({
    host: "http://127.0.0.1:11434/",
    model: FIXED_EMBEDDING_MODEL,
    batchSize: 2,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, count: body.input.length });
      return {
        ok: true,
        json: async () => ({
          embeddings: body.input.map(() => Array.from({ length: 1024 }, () => 0.5)),
        }),
      };
    },
  });

  const vectors = await embedder.embedDocuments(["a", "b", "c"], {
    model: FIXED_EMBEDDING_MODEL,
    dimensions: 1024,
  });

  assert.equal(vectors.length, 3);
  assert.equal(vectors[0] instanceof Float32Array, true);
  assert.equal(vectors[0].length, 1024);
  assert.deepEqual(
    requests.map((request) => request.count),
    [2, 1],
  );
  assert.equal(requests[0].url, "http://127.0.0.1:11434/api/embed");
});

test("the Ollama embedder refuses a response that does not match the fixed contract", async () => {
  const embedderWith = (json, ok = true) =>
    createOllamaEmbedder({
      host: "http://127.0.0.1:11434",
      model: FIXED_EMBEDDING_MODEL,
      fetchImpl: async () => ({ ok, status: 500, json: async () => json }),
    });
  const contract = { model: FIXED_EMBEDDING_MODEL, dimensions: 1024 };

  await assert.rejects(
    () => embedderWith({ embeddings: [[0.1, 0.2]] }).embedDocuments(["a"], contract),
    (error) => error.code === "dependency_unavailable",
  );
  await assert.rejects(
    () => embedderWith({ embeddings: [] }).embedDocuments(["a"], contract),
    (error) => error.code === "dependency_unavailable",
  );
  await assert.rejects(
    () => embedderWith({}, false).embedDocuments(["a"], contract),
    (error) => error.code === "dependency_unavailable",
  );
  await assert.rejects(
    () =>
      createOllamaEmbedder({
        host: "http://127.0.0.1:11434",
        model: "some-other-model",
        fetchImpl: async () => ({ ok: true, json: async () => ({ embeddings: [] }) }),
      }).embedDocuments(["a"], contract),
    (error) => error.code === "configuration_error",
  );
});

test("an unreachable Ollama host is a dependency failure, not a data failure", async () => {
  const embedder = createOllamaEmbedder({
    host: "http://127.0.0.1:11434",
    model: FIXED_EMBEDDING_MODEL,
    fetchImpl: async () => {
      const error = new Error("fetch failed");
      error.code = "ECONNREFUSED";
      throw error;
    },
  });

  await assert.rejects(
    () =>
      embedder.embedDocuments(["a"], { model: FIXED_EMBEDDING_MODEL, dimensions: 1024 }),
    (error) => error.code === "dependency_unavailable",
  );
});
