import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_EMBEDDING_DIMENSIONS,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { assertEvidenceBundle } from "../src/policy/evidence-answer-contract.js";
import {
  createDocumentRetriever,
  retrieveDocumentEvidence,
} from "../src/query/document-retrieval.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";

const fixturePack = loadFixtureSourcePack();

/** Deterministic offline embedder: character codes hashed into fixed buckets. */
function embedText(text) {
  const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
  for (const character of text) {
    vector[character.codePointAt(0) % FIXED_EMBEDDING_DIMENSIONS] += 1;
  }
  vector[0] += 1;
  return vector;
}

function constantVector() {
  const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
  vector.fill(0.25);
  return vector;
}

async function createFixtureStore(context) {
  const store = createDocumentStore();
  context.after(() => {
    if (store.getStatus().isOpen) store.close();
  });
  await buildFixedIndex({
    store,
    data: structuredClone({
      source_documents: fixturePack.source_documents,
      canonical_entities: fixturePack.canonical_entities,
      document_chunks: fixturePack.document_chunks,
    }),
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
  });
  return store;
}

function createFixtureClassifier() {
  return createQueryClassifier({ canonicalEntities: fixturePack.canonical_entities });
}

test("narrative QueryPlan retrieves ranked, traceable document evidence", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    queryId: "qry:raiden-narrative",
    queryPlan,
    question,
  });

  assert.equal(queryPlan.retrieval_mode, "document");
  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.equal(bundle.query_id, "qry:raiden-narrative");
  assert.deepEqual(bundle.conflict_groups, []);
  assert.equal(bundle.items[0].chunk_id, "chunk:fandom-raiden-story-euthymia");
  assert.deepEqual(bundle.items.map((item) => item.rank), [1, 2, 3, 4]);
  assert.ok(bundle.items.every((item) => item.support_type === "contextual"));

  const [top] = bundle.items;
  assert.equal(top.evidence_id, "evd:raiden-narrative-chunk-fandom-raiden-story-euthymia");
  assert.equal(top.source_id, "src:fandom-raiden-shogun");
  assert.equal(top.source_kind, "fandom");
  assert.equal(top.game_version, "4.8");
  assert.ok(top.source_url.startsWith("http"));
  assert.ok(typeof top.source_title === "string" && top.source_title.length > 0);
  assert.ok(typeof top.source_retrieved_at === "string");
});

test("structured and none routes return an empty bundle without reading the index", async (context) => {
  const store = await createFixtureStore(context);
  let indexReads = 0;
  const spyStore = {
    ...store,
    listDocumentChunks(filters) {
      indexReads += 1;
      return store.listDocumentChunks(filters);
    },
  };
  const classifier = createFixtureClassifier();
  const retriever = createDocumentRetriever({ store: spyStore, embedQuery: embedText });

  for (const question of ["雷電將軍的元素屬性是什麼？", "今天天氣如何？"]) {
    const queryPlan = classifier.classify({ question });
    const bundle = await retriever.retrieve({
      queryId: "qry:no-document-route",
      queryPlan,
      question,
    });

    assert.ok(["structured", "none"].includes(queryPlan.retrieval_mode));
    assert.equal(assertEvidenceBundle(bundle), bundle);
    assert.deepEqual(bundle.items, []);
    assert.deepEqual(bundle.conflict_groups, []);
  }
  assert.equal(indexReads, 0);
});

test("hybrid route retrieves document chunks for every resolved entity", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍的元素爆發數值與稻妻的背景故事分別是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    queryId: "qry:raiden-hybrid",
    queryPlan,
    question,
  });

  assert.equal(queryPlan.retrieval_mode, "hybrid");
  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.ok(bundle.items.length > 0);
  const chunkIds = bundle.items.map((item) => item.chunk_id);
  assert.equal(new Set(chunkIds).size, chunkIds.length);
  assert.ok(chunkIds.includes("chunk:fandom-raiden-story-euthymia"));
});

test("exact version constraint isolates chunks to the requested version", async (context) => {
  const store = await createFixtureStore(context);
  const question = "5.0版本神里綾華的更新內容與故事背景是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.0" });

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    queryId: "qry:ayaka-exact",
    queryPlan,
    question,
    gameVersion: "5.0",
  });

  assert.equal(queryPlan.version_constraint, "exact");
  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.deepEqual(
    bundle.items.map((item) => item.chunk_id),
    ["chunk:hoyolab-5-0-character-updates"],
  );
  assert.ok(bundle.items.every((item) => item.game_version === "5.0"));
});

test("exact constraint refuses missing or unknown game versions", async (context) => {
  const store = await createFixtureStore(context);
  const question = "5.0版本神里綾華的更新內容與故事背景是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.0" });
  const retriever = createDocumentRetriever({ store, embedQuery: embedText });

  await assert.rejects(
    () => retriever.retrieve({ queryId: "qry:ayaka-exact", queryPlan, question }),
    /gameVersion is required for exact document retrieval/,
  );
  await assert.rejects(
    () => retriever.retrieve({
      queryId: "qry:ayaka-exact",
      queryPlan,
      question,
      gameVersion: "unknown",
    }),
    /gameVersion cannot be unknown/,
  );
});

test("equal cosine scores fall back to a deterministic chunk_id order", async (context) => {
  const store = createDocumentStore();
  context.after(() => {
    if (store.getStatus().isOpen) store.close();
  });
  await buildFixedIndex({
    store,
    data: structuredClone({
      source_documents: fixturePack.source_documents,
      canonical_entities: fixturePack.canonical_entities,
      document_chunks: fixturePack.document_chunks,
    }),
    embedDocuments: (texts) => texts.map(() => constantVector()),
  });
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });
  const retriever = createDocumentRetriever({ store, embedQuery: embedText });

  const first = await retriever.retrieve({ queryId: "qry:tie-break", queryPlan, question });
  const second = await retriever.retrieve({ queryId: "qry:tie-break", queryPlan, question });

  const chunkIds = first.items.map((item) => item.chunk_id);
  assert.ok(chunkIds.length > 1);
  assert.deepEqual(chunkIds, [...chunkIds].sort((left, right) => left.localeCompare(right)));
  assert.deepEqual(second, first);
});

test("topK bounds the bundle and leaves the request untouched", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });
  const request = Object.freeze({ queryId: "qry:top-k", queryPlan, question });
  const before = structuredClone(request);

  const bundle = await createDocumentRetriever({
    store,
    embedQuery: embedText,
    topK: 2,
  }).retrieve(request);

  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.deepEqual(bundle.items.map((item) => item.rank), [1, 2]);
  assert.deepEqual(structuredClone(request), before);
});

test("malformed query vectors and options fail closed", async (context) => {
  const store = await createFixtureStore(context);
  const classifier = createFixtureClassifier();
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = classifier.classify({ question });
  await assert.rejects(
    () => retrieveDocumentEvidence({
      store,
      embedQuery: () => new Float32Array(8),
      queryId: "qry:bad-vector",
      queryPlan,
      question,
    }),
    /Query vector must have 1024 dimensions/,
  );
  await assert.rejects(
    () => retrieveDocumentEvidence({
      store,
      embedQuery: () => new Float32Array(FIXED_EMBEDDING_DIMENSIONS),
      queryId: "qry:zero-vector",
      queryPlan,
      question,
    }),
    /Query vector must not be a zero vector/,
  );
  assert.throws(
    () => createDocumentRetriever({ store, embedQuery: embedText, topK: 0 }),
    /topK must be a positive integer/,
  );
});

test("a plan without resolved entities ranks the whole index", async (context) => {
  const store = await createFixtureStore(context);
  const question = "提瓦特的天空有什麼特點？";
  const queryPlan = createFixtureClassifier().classify({ question });

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    queryId: "qry:entity-less",
    queryPlan,
    question,
  });

  assert.equal(queryPlan.retrieval_mode, "document");
  assert.deepEqual(queryPlan.normalized_entities, []);
  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.equal(bundle.items[0].chunk_id, "chunk:fandom-unclassified-world-lore");
  assert.equal(
    bundle.items.length,
    fixturePack.document_chunks.length,
    "an entity-less plan considers every indexed chunk",
  );
});

test("an entity-less plan still honours the exact version filter", async (context) => {
  const store = await createFixtureStore(context);
  const question = "5.0 版本更新了哪些內容？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.0" });

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    queryId: "qry:entity-less-version",
    queryPlan,
    question,
    gameVersion: "5.0",
  });

  assert.deepEqual(queryPlan.normalized_entities, []);
  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.ok(bundle.items.length > 0);
  assert.ok(bundle.items.every((item) => item.game_version === "5.0"));
  assert.ok(bundle.items.some((item) => item.chunk_id === "chunk:hoyolab-5-0-character-updates"));
});
