import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DATASET_STATES,
  HEALTH_API_ROUTE,
  createHealthReporter,
  createHealthRoute,
} from "../src/api/health-api.js";
import { RUNTIME_DEFAULTS, loadRuntimeConfig } from "../src/config/runtime-config.js";
import {
  FIXED_EMBEDDING_DIMENSIONS,
  FIXED_EMBEDDING_MODEL,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { runIngestBuild } from "../src/ingest/ingest-pipeline.js";
import { createApplication } from "../src/server.js";

const LOOPBACK_HOST = "127.0.0.1";
const fixturePack = loadFixtureSourcePack();
const config = loadRuntimeConfig({});

function embedText(text) {
  const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
  for (const character of text) {
    vector[character.codePointAt(0) % FIXED_EMBEDDING_DIMENSIONS] += 1;
  }
  vector[0] += 1;
  return vector;
}

async function loadedStores(context, { withIndex = true } = {}) {
  const structuredStore = createStructuredStore();
  const documentStore = createDocumentStore();
  context.after(() => {
    if (structuredStore.getStatus().isOpen) structuredStore.close();
    if (documentStore.getStatus().isOpen) documentStore.close();
  });

  structuredStore.replaceData(
    structuredClone({
      source_documents: fixturePack.source_documents,
      canonical_entities: fixturePack.canonical_entities,
      structured_facts: fixturePack.structured_facts,
      claims: fixturePack.claims,
      conflict_groups: fixturePack.conflict_groups,
    }),
  );
  if (withIndex) {
    await buildFixedIndex({
      store: documentStore,
      data: structuredClone({
        source_documents: fixturePack.source_documents,
        canonical_entities: fixturePack.canonical_entities,
        document_chunks: fixturePack.document_chunks,
      }),
      embedDocuments: (texts) => texts.map((text) => embedText(text)),
    });
  }
  return { structuredStore, documentStore };
}

test("a server without data reports degraded instead of ok", () => {
  const report = createHealthReporter({ config }).report();

  assert.equal(report.status, "degraded");
  assert.equal(report.dataset.state, DATASET_STATES.MISSING);
  assert.equal(report.dataset.structured.available, false);
  assert.equal(report.dataset.index.available, false);
  assert.equal(report.service, RUNTIME_DEFAULTS.serviceName);
});

test("open stores with no index built are still missing, not ready", async (context) => {
  const stores = await loadedStores(context, { withIndex: false });

  const report = createHealthReporter({ config, ...stores }).report();

  assert.equal(report.status, "degraded");
  assert.equal(report.dataset.state, DATASET_STATES.MISSING);
  assert.equal(report.dataset.structured.available, true);
  assert.equal(report.dataset.index.index_hash, null);
});

test("a built and verified index reports ok with its own embedding contract", async (context) => {
  const stores = await loadedStores(context);

  const report = createHealthReporter({ config, ...stores }).report();

  assert.equal(report.status, "ok");
  assert.equal(report.dataset.state, DATASET_STATES.READY);
  assert.equal(report.dataset.index.verified, true);
  assert.equal(report.dataset.index.embedding_model, FIXED_EMBEDDING_MODEL);
  assert.equal(report.dataset.index.embedding_dimensions, FIXED_EMBEDDING_DIMENSIONS);
  assert.equal(
    report.dataset.index.index_hash,
    stores.documentStore.getIndexManifest().index_hash,
  );
  assert.equal(
    report.dataset.structured.counts.structuredFacts,
    fixturePack.structured_facts.length,
  );
  assert.equal(report.baseline.generation_model, RUNTIME_DEFAULTS.generationModel);
  assert.equal(report.baseline.embedding_model, RUNTIME_DEFAULTS.embeddingModel);
});

test("an index that no longer matches its manifest is reported as corrupt", async (context) => {
  const stores = await loadedStores(context);
  const brokenIndex = {
    getStatus: () => stores.documentStore.getStatus(),
    getIndexManifest: () => stores.documentStore.getIndexManifest(),
    verifyIndex: () => ({ ok: false, index_hash: "a", actual_index_hash: "b", chunk_count: 1 }),
  };

  const report = createHealthReporter({
    config,
    structuredStore: stores.structuredStore,
    documentStore: brokenIndex,
  }).report();

  assert.equal(report.status, "degraded");
  assert.equal(report.dataset.state, DATASET_STATES.CORRUPT);
  assert.equal(report.dataset.index.verification_reason, "hash_mismatch");
});

test("the health route serves the report over HTTP without caching it", async (context) => {
  const stores = await loadedStores(context);
  const { config: appConfig, server } = createApplication(
    { PORT: "0", STRUCTURED_DB_PATH: "does-not-exist.db", DOCUMENT_DB_PATH: "missing.db" },
    { healthHandler: createHealthRoute({ reporter: createHealthReporter({ config, ...stores }) }) },
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(appConfig.port, LOOPBACK_HOST, resolve);
  });
  context.after(
    () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const response = await fetch(
    `http://${LOOPBACK_HOST}:${server.address().port}${HEALTH_API_ROUTE}`,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(payload.status, "ok");
  assert.equal(payload.dataset.state, DATASET_STATES.READY);
});

test("a server started without databases mounts no query route", async (context) => {
  const application = createApplication({
    PORT: "0",
    STRUCTURED_DB_PATH: "does-not-exist.db",
    DOCUMENT_DB_PATH: "also-missing.db",
  });
  const { config: appConfig, server } = application;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(appConfig.port, LOOPBACK_HOST, resolve);
  });
  context.after(async () => {
    application.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const base = `http://${LOOPBACK_HOST}:${server.address().port}`;
  const health = await (await fetch(`${base}/health`)).json();
  const query = await fetch(`${base}/api/v1/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "雷電將軍的元素屬性是什麼？" }),
  });

  assert.equal(health.status, "degraded");
  assert.equal(health.dataset.state, DATASET_STATES.MISSING);
  assert.equal(query.status, 404);
});

test("an empty structured store is not ready, however good the index looks", async (context) => {
  const stores = await loadedStores(context);
  const emptyStructured = createStructuredStore();
  context.after(() => {
    if (emptyStructured.getStatus().isOpen) emptyStructured.close();
  });

  const report = createHealthReporter({
    config,
    structuredStore: emptyStructured,
    documentStore: stores.documentStore,
  }).report();

  // Every structured question would refuse for lack of an entity, so reporting
  // ok here would be a promise the helper cannot keep.
  assert.equal(report.status, "degraded");
  assert.equal(report.dataset.state, DATASET_STATES.MISSING);
});

test("stores left holding different batches are reported as mismatched", async (context) => {
  const structuredStore = createStructuredStore();
  const documentStore = createDocumentStore();
  context.after(() => {
    if (structuredStore.getStatus().isOpen) structuredStore.close();
    if (documentStore.getStatus().isOpen) documentStore.close();
  });

  // The state a build that replaced the structured store and then failed on the
  // index leaves behind: new facts beside stale text.
  await runIngestBuild({
    dataset: structuredClone(fixturePack),
    structuredStore,
    documentStore,
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
  });
  const changed = structuredClone(fixturePack);
  changed.structured_facts[0].value = "changed";
  const partial = await runIngestBuild({
    dataset: changed,
    structuredStore,
    documentStore,
    embedDocuments: () => {
      const error = new Error("ollama is down");
      error.code = "ECONNREFUSED";
      throw error;
    },
  });

  const report = createHealthReporter({ config, structuredStore, documentStore }).report();

  assert.equal(partial.status, "partial");
  assert.equal(report.status, "degraded");
  assert.equal(report.dataset.state, DATASET_STATES.MISMATCHED);
  assert.notEqual(
    report.dataset.structured.dataset_version,
    report.dataset.index.dataset_version,
  );
});

test("a matching pair of stores reports the dataset version they share", async (context) => {
  const structuredStore = createStructuredStore();
  const documentStore = createDocumentStore();
  context.after(() => {
    if (structuredStore.getStatus().isOpen) structuredStore.close();
    if (documentStore.getStatus().isOpen) documentStore.close();
  });
  const run = await runIngestBuild({
    dataset: structuredClone(fixturePack),
    structuredStore,
    documentStore,
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
  });

  const report = createHealthReporter({ config, structuredStore, documentStore }).report();

  assert.equal(report.dataset.state, DATASET_STATES.READY);
  assert.equal(report.dataset.structured.dataset_version, run.input_version);
  assert.equal(report.dataset.index.dataset_version, run.input_version);
});

test("a database that cannot be opened is reported, not fatal", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "health-unreadable-"));
  const structuredDatabasePath = join(directory, "structured.db");
  const documentDatabasePath = join(directory, "index.db");
  writeFileSync(structuredDatabasePath, "this is not a database");
  writeFileSync(documentDatabasePath, "neither is this");

  const application = createApplication({
    PORT: "0",
    STRUCTURED_DB_PATH: structuredDatabasePath,
    DOCUMENT_DB_PATH: documentDatabasePath,
  });
  context.after(() => {
    application.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const report = application.health.report();

  assert.equal(report.status, "degraded");
  assert.equal(report.dataset.state, DATASET_STATES.UNREADABLE);
  assert.match(report.dataset.structured.reason, /could not be opened/);
});

test("the health reporter validates its wiring", () => {
  assert.throws(() => createHealthReporter({ config, unexpected: true }), /Unknown health/);
  assert.throws(() => createHealthReporter({ config: { serviceName: "x" } }), /runtime config/);
  assert.throws(
    () => createHealthReporter({ config, structuredStore: {} }),
    /structuredStore must expose getStatus/,
  );
  assert.throws(() => createHealthRoute({}), /reporter must expose report/);
});

test("a server started on built databases reports ok and mounts the query route", async () => {
  const directory = mkdtempSync(join(tmpdir(), "health-api-"));
  const structuredDatabasePath = join(directory, "structured.db");
  const documentDatabasePath = join(directory, "index.db");

  const structuredStore = createStructuredStore({ databasePath: structuredDatabasePath });
  const documentStore = createDocumentStore({ databasePath: documentDatabasePath });
  const run = await runIngestBuild({
    dataset: structuredClone(fixturePack),
    structuredStore,
    documentStore,
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
    structuredStorePath: structuredDatabasePath,
    documentStorePath: documentDatabasePath,
  });
  structuredStore.close();
  documentStore.close();
  assert.equal(run.status, "passed");

  const application = createApplication({
    PORT: "0",
    STRUCTURED_DB_PATH: structuredDatabasePath,
    DOCUMENT_DB_PATH: documentDatabasePath,
  });
  try {
    await new Promise((resolve, reject) => {
      application.server.once("error", reject);
      application.server.listen(application.config.port, LOOPBACK_HOST, resolve);
    });
    const base = `http://${LOOPBACK_HOST}:${application.server.address().port}`;

    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.status, "ok");
    assert.equal(health.dataset.state, DATASET_STATES.READY);
    assert.equal(health.dataset.index.index_hash, run.artifacts[1].content_hash);

    // The route is mounted and answers from the databases on disk. A structured
    // question never reaches the embedder, so this path works with Ollama down,
    // which is what a local-first helper should do.
    const query = await fetch(`${base}/api/v1/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "雷電將軍的元素屬性是什麼？" }),
    });
    const answer = await query.json();

    assert.equal(query.status, 200);
    assert.equal(answer.answer_status, "answered");
    assert.ok(answer.citations.length > 0);
  } finally {
    // The databases must be released before the directory can be removed on
    // Windows, so cleanup is ordered here rather than left to after hooks.
    application.close();
    application.server.closeAllConnections();
    await new Promise((resolve, reject) => {
      application.server.close((error) => (error ? reject(error) : resolve()));
    });
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
