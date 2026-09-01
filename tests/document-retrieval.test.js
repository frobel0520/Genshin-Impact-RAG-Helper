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
    minScore: 0,
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
  const retriever = createDocumentRetriever({ store: spyStore, embedQuery: embedText, minScore: 0 });

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
    minScore: 0,
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
    minScore: 0,
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
  const retriever = createDocumentRetriever({ store, embedQuery: embedText, minScore: 0 });

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
  const retriever = createDocumentRetriever({ store, embedQuery: embedText, minScore: 0 });

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
    minScore: 0,
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
    minScore: 0,
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
    minScore: 0,
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

test("a chunk below the similarity floor is not evidence", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });
  const request = { queryId: "qry:floor", queryPlan, question };

  const open = await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: 0,
  }).retrieve(request);
  assert.ok(open.items.length > 0, "the fixture must rank some chunk to begin with");

  // A floor no chunk can clear is the case this exists for: the nearest
  // neighbours are still the nearest, and none of them answers the question.
  const closed = await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: 1,
  }).retrieve(request);
  assert.deepEqual(closed.items, []);
  assertEvidenceBundle(closed);
});

test("the floor is applied before topK, not after it", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });
  const request = { queryId: "qry:floor-order", queryPlan, question };

  const ranked = await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: 0,
  }).retrieve(request);
  assert.ok(ranked.items.length > 1, "this case needs more than one ranked chunk");

  // The best score is the only cut that is guaranteed to keep something and
  // drop something, whatever the fixture's vectors happen to be.
  let bestScore;
  await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: 1,
    onBelowThreshold: (report) => {
      bestScore = report.bestScore;
    },
  }).retrieve(request);
  assert.ok(bestScore > 0 && bestScore < 1);

  const cut = await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: bestScore,
    topK: 8,
  }).retrieve(request);

  // Had the floor run after topK, the chunks below it would have taken slots
  // and the bundle would still be capped at what survived a full-size page.
  assert.ok(cut.items.length >= 1);
  assert.ok(cut.items.length < ranked.items.length);
  assert.equal(cut.items[0].chunk_id, ranked.items[0].chunk_id);
  assert.deepEqual(
    cut.items.map((item) => item.rank),
    cut.items.map((_, index) => index + 1),
    "ranks are renumbered over what survived, with no gap where a chunk was cut",
  );
});

test("filtered evidence is reported so a refusal can be explained", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });
  const reports = [];

  const bundle = await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: 1,
    onBelowThreshold: (report) => reports.push(report),
  }).retrieve({ queryId: "qry:floor-report", queryPlan, question });

  assert.deepEqual(bundle.items, []);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].query_id ?? reports[0].queryId, "qry:floor-report");
  assert.equal(reports[0].kept, 0);
  assert.ok(reports[0].considered > 0);
  assert.ok(reports[0].bestScore < 1);
  assert.equal(reports[0].minScore, 1);
});

test("nothing is reported when the floor drops nothing", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });
  const reports = [];

  await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: 0,
    onBelowThreshold: (report) => reports.push(report),
  }).retrieve({ queryId: "qry:floor-quiet", queryPlan, question });

  assert.deepEqual(reports, []);
});

test("a reporter that throws cannot break the retrieval it observes", async (context) => {
  const store = await createFixtureStore(context);
  const question = "雷電將軍在一心淨土追求永恆的故事是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question });

  const bundle = await createDocumentRetriever({
    store,
    embedQuery: embedText,
    minScore: 1,
    onBelowThreshold: () => {
      throw new Error("the log is full");
    },
  }).retrieve({ queryId: "qry:floor-throws", queryPlan, question });

  assert.deepEqual(bundle.items, []);
});

test("an out-of-range floor fails closed", async (context) => {
  const store = await createFixtureStore(context);

  for (const minScore of [-0.1, 1.1, "0.5", Number.NaN]) {
    assert.throws(
      () => createDocumentRetriever({ store, embedQuery: embedText, minScore }),
      /minScore must be a number between 0 and 1/,
    );
  }
  assert.throws(
    () => createDocumentRetriever({ store, embedQuery: embedText, onBelowThreshold: "log" }),
    /onBelowThreshold must be a function/,
  );
});
