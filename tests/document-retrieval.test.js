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

test("a version overview takes the whole announcement, not the nearest sections", async (context) => {
  const store = await createFixtureStore(context);
  const question = "5.0版本更新了哪些內容？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.0" });
  assert.equal(queryPlan.query_category, "version");
  assert.equal(
    queryPlan.normalized_entities.filter((e) => e.resolution_status === "resolved").length,
    0,
    "this case is about a version question that names no subject",
  );

  const everyChunk = store.listDocumentChunks({ gameVersion: "5.0" });
  assert.ok(everyChunk.length > 1, "the fixture needs more than one 5.0 chunk");

  // topK of 1 and a floor nothing could clear: neither may apply here, because
  // the question is about the release and the answer is the announcement.
  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    topK: 1,
    minScore: 1,
    queryId: "qry:version-overview",
    queryPlan,
    question,
    gameVersion: "5.0",
  });

  assert.deepEqual(
    bundle.items.map((item) => item.chunk_id).sort(),
    everyChunk.map((chunk) => chunk.chunk_id).sort(),
  );
  assert.ok(bundle.items.every((item) => item.game_version === "5.0"));
  assert.deepEqual(
    bundle.items.map((item) => item.rank),
    bundle.items.map((_, index) => index + 1),
  );
  assertEvidenceBundle(bundle);
});

test("a version question that names a subject still ranks", async (context) => {
  const store = await createFixtureStore(context);
  const question = "5.0版本神里綾華的更新內容與故事背景是什麼？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.0" });
  assert.equal(queryPlan.query_category, "version");

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    minScore: 0,
    queryId: "qry:version-with-subject",
    queryPlan,
    question,
    gameVersion: "5.0",
  });

  // The entity filter is the point of this question. Handing it every section
  // of the release would bury the one the reader asked for.
  const everyChunk = store.listDocumentChunks({ gameVersion: "5.0" });
  assert.ok(bundle.items.length < everyChunk.length);
  assert.deepEqual(
    bundle.items.map((item) => item.chunk_id),
    ["chunk:hoyolab-5-0-character-updates"],
  );
});

test("an announcement past the chunk ceiling goes back to ranking", async (context) => {
  const store = await createFixtureStore(context);
  const question = "5.0版本更新了哪些內容？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.0" });
  const everyChunk = store.listDocumentChunks({ gameVersion: "5.0" });

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    minScore: 0,
    topK: 1,
    versionDocumentMaxChunks: everyChunk.length - 1,
    queryId: "qry:version-too-long",
    queryPlan,
    question,
    gameVersion: "5.0",
  });

  // A partial answer that says so through its citations beats pushing a hundred
  // sections at the model.
  assert.equal(bundle.items.length, 1);
});

test("an unusable chunk ceiling fails closed", async (context) => {
  const store = await createFixtureStore(context);

  for (const versionDocumentMaxChunks of [0, -1, 2.5, "24"]) {
    assert.throws(
      () => createDocumentRetriever({ store, embedQuery: embedText, versionDocumentMaxChunks }),
      /versionDocumentMaxChunks must be a positive integer/,
    );
  }
});

/**
 * A store carrying one announcement-shaped release notice.
 *
 * The fixture pack's 5.0 chunks are prose without headings, which is the right
 * shape for the cases above and the wrong shape for this one: importance is
 * read off the heading a section starts with.
 */
async function createAnnouncementStore(context) {
  const store = createDocumentStore();
  context.after(() => {
    if (store.getStatus().isOpen) store.close();
  });
  const sourceId = "src:hoyolab-version-5-9";
  const sourceUrl = "https://www.hoyolab.com/article/99999999";
  // Deliberately listed in chunk_id order, which is what the store returns and
  // what put a voice-over fix at the top of a 5.3 answer.
  const headings = [
    ["s01-compensation", "〓補償內容〓\n原石×600"],
    ["s02-adjustments", "〓調整及改善〓\n「信件」介面，「信件珍藏盒」增加了搜尋功能。"],
    ["s03-bug-fixes", "〓問題修正〓\n修正了部分任務中的華語語音錯誤。"],
    ["s04-new-characters", "二、全新角色\n五星角色「測試角色」將在本版本登場。"],
    ["s05-new-region", "一、全新地區\n全新地區「測試之地」正式開放。"],
    ["s06-other-updates", "九、其他更新內容\n新增了若干成就。"],
  ];
  await buildFixedIndex({
    store,
    data: {
      source_documents: [
        {
          source_id: sourceId,
          source_kind: "hoyolab",
          source_url: sourceUrl,
          title: "「測試」5.9版本更新說明",
          retrieved_at: "2026-09-06T00:00:00Z",
          game_version: "5.9",
          locale: "zh-TW",
          rights_note: "Personal non-commercial use; retain official attribution and URL.",
          content_hash: "a".repeat(64),
        },
      ],
      canonical_entities: [],
      document_chunks: headings.map(([id, text]) => ({
        chunk_id: `chunk:hoyolab-5-9-${id}`,
        source_id: sourceId,
        document_locator: `${sourceUrl}#${id}`,
        text,
        token_hint: text.length,
        game_version: "5.9",
        entity_ids: [],
      })),
    },
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
  });
  return store;
}

test("a version overview opens with the main line, not with the bug fixes", async (context) => {
  const store = await createAnnouncementStore(context);
  const question = "5.9版本更新了哪些內容？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.9" });
  assert.equal(queryPlan.query_category, "version");

  // What the store hands over, and why the order it hands it over in is not an
  // order: chunk_id is alphabetical, so the adjustments section is second.
  const stored = store.listDocumentChunks({ gameVersion: "5.9" });
  assert.equal(stored[1].text.split("\n", 1)[0], "〓調整及改善〓");

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    minScore: 1,
    queryId: "qry:version-importance",
    queryPlan,
    question,
    gameVersion: "5.9",
  });

  assert.deepEqual(
    bundle.items.map((item) => item.chunk_id),
    [
      "chunk:hoyolab-5-9-s05-new-region",
      "chunk:hoyolab-5-9-s04-new-characters",
      "chunk:hoyolab-5-9-s06-other-updates",
    ],
    "the release's subject, and not its housekeeping",
  );
  assert.deepEqual(
    bundle.items.map((item) => item.rank),
    [1, 2, 3],
  );
  assertEvidenceBundle(bundle);
});

test("a version question about fixes is answered from the fix list", async (context) => {
  const store = await createAnnouncementStore(context);
  const question = "5.9版本修正了什麼問題？";
  const queryPlan = createFixtureClassifier().classify({ question, game_version: "5.9" });

  const bundle = await retrieveDocumentEvidence({
    store,
    embedQuery: embedText,
    minScore: 1,
    queryId: "qry:version-fixes",
    queryPlan,
    question,
    gameVersion: "5.9",
  });

  // Every section, because for this reader the tail is the answer — but still
  // led by the main line rather than by the compensation notice.
  assert.equal(bundle.items.length, 6);
  assert.equal(bundle.items[0].chunk_id, "chunk:hoyolab-5-9-s05-new-region");
  assert.ok(
    bundle.items.some((item) => item.chunk_id === "chunk:hoyolab-5-9-s03-bug-fixes"),
    "the fix list is evidence for a question about fixes",
  );
  assertEvidenceBundle(bundle);
});
