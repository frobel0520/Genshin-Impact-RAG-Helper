import assert from "node:assert/strict";
import test from "node:test";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { assertEvidenceBundle } from "../src/policy/evidence-answer-contract.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
import {
  createStructuredRetriever,
  retrieveStructuredEvidence,
} from "../src/query/structured-retrieval.js";

const fixturePack = loadFixtureSourcePack();

function createFixtureStore(context) {
  const store = createStructuredStore();
  store.replaceData(structuredClone({
    source_documents: fixturePack.source_documents,
    canonical_entities: fixturePack.canonical_entities,
    structured_facts: fixturePack.structured_facts,
    claims: fixturePack.claims,
    conflict_groups: fixturePack.conflict_groups,
  }));
  context.after(() => {
    if (store.getStatus().isOpen) store.close();
  });
  return store;
}

function createFixtureClassifier() {
  return createQueryClassifier({ canonicalEntities: fixturePack.canonical_entities });
}

test("structured QueryPlan retrieves traceable facts and claims", (context) => {
  const store = createFixtureStore(context);
  const classifier = createFixtureClassifier();
  const queryPlan = classifier.classify({
    question: "雷電將軍的元素屬性與元素爆發是什麼？",
    game_version: "5.0",
  });

  const bundle = retrieveStructuredEvidence({
    store,
    queryId: "qry:raiden-structured",
    queryPlan,
    gameVersion: "5.0",
  });

  assert.equal(assertEvidenceBundle(bundle), bundle);
  assert.equal(bundle.query_id, "qry:raiden-structured");
  assert.deepEqual(bundle.items.map((item) => item.rank), [1, 2, 3, 4, 5]);
  assert.deepEqual(
    bundle.items.filter((item) => item.fact_id).map((item) => item.fact_id),
    [
      "fact:raiden-shogun-element",
      "fact:raiden-shogun-rarity",
      "fact:raiden-shogun-weapon-type",
    ],
  );
  assert.deepEqual(
    bundle.items.filter((item) => item.claim_id).map((item) => item.claim_id),
    [
      "claim:raiden-shogun-burst-official",
      "claim:raiden-shogun-skill-official",
    ],
  );
  assert.ok(bundle.items.every((item) => item.game_version === "5.0"));
  assert.ok(bundle.items.every((item) => item.support_type === "direct"));
  assert.ok(bundle.items.every((item) => item.source_url.startsWith("https://")));
  assert.deepEqual(bundle.conflict_groups, []);
});

test("exact version filtering never substitutes unknown-version facts", (context) => {
  const store = createFixtureStore(context);
  const classifier = createFixtureClassifier();
  const queryPlan = classifier.classify({
    question: "薙草之稻光的滿級基礎攻擊力是多少？",
    game_version: "5.0",
  });

  const exactBundle = retrieveStructuredEvidence({
    store,
    queryId: "qry:engulfing-five-zero",
    queryPlan,
    gameVersion: "5.0",
  });
  assert.deepEqual(exactBundle.items, []);

  const unknownVersionPlan = classifier.classify({
    question: "薙草之稻光的滿級基礎攻擊力是多少？",
    game_version: "unknown",
  });
  const unknownBundle = retrieveStructuredEvidence({
    store,
    queryId: "qry:engulfing-unknown",
    queryPlan: unknownVersionPlan,
  });
  assert.ok(unknownBundle.items.some(
    (item) => item.fact_id === "fact:engulfing-lightning-base-atk",
  ));
  assert.ok(unknownBundle.items.every((item) => item.game_version === "unknown"));
});

test("conflicting claims retain their complete conflict group", (context) => {
  const store = createFixtureStore(context);
  const classifier = createFixtureClassifier();
  const queryPlan = classifier.classify({
    question: "神里綾華的元素爆發名稱是什麼？",
    game_version: "5.0",
  });

  const bundle = retrieveStructuredEvidence({
    store,
    queryId: "qry:ayaka-burst-name",
    queryPlan,
    gameVersion: "5.0",
  });

  const conflictingItems = bundle.items.filter((item) => item.support_type === "conflicting");
  assert.deepEqual(
    conflictingItems.map((item) => item.claim_id),
    [
      "claim:kamisato-ayaka-burst-official",
      "claim:kamisato-ayaka-burst-wiki-differing",
    ],
  );
  assert.deepEqual(bundle.conflict_groups, fixturePack.conflict_groups);
});

test("hybrid plans retrieve the structured portion for each resolved entity once", (context) => {
  const store = createFixtureStore(context);
  const retriever = createStructuredRetriever({ store });
  const queryPlan = {
    query_category: "composite",
    normalized_entities: [
      {
        entity_id: "ent:raiden-shogun",
        text: "雷電將軍",
        entity_type: "character",
        resolution_status: "resolved",
        aliases_used: [],
      },
      {
        entity_id: "ent:raiden-shogun",
        text: "雷神",
        entity_type: "character",
        resolution_status: "resolved",
        aliases_used: ["雷神"],
      },
      {
        text: "未知角色",
        resolution_status: "unrecognized",
        aliases_used: [],
      },
    ],
    version_constraint: "current-unspecified",
    retrieval_mode: "hybrid",
    spoiler_level: "notice",
  };

  const bundle = retriever.retrieve({
    queryId: "qry:hybrid-deduplicate",
    queryPlan,
  });

  assert.equal(new Set(bundle.items.map((item) => item.evidence_id)).size, bundle.items.length);
  assert.equal(bundle.items.length, 5);
});

test("document and none routes return valid empty bundles without touching the store", () => {
  const rejectingStore = {
    findStructuredFacts() { throw new Error("must not read facts"); },
    findClaims() { throw new Error("must not read claims"); },
    getSourceDocument() { throw new Error("must not read sources"); },
    getConflictGroup() { throw new Error("must not read conflicts"); },
  };
  const retriever = createStructuredRetriever({ store: rejectingStore });

  for (const retrievalMode of ["document", "none"]) {
    const bundle = retriever.retrieve({
      queryId: `qry:${retrievalMode}-route`,
      queryPlan: {
        query_category: retrievalMode === "none" ? "out_of_scope" : "narrative",
        normalized_entities: [],
        version_constraint: "current-unspecified",
        retrieval_mode: retrievalMode,
        spoiler_level: "none",
      },
    });
    assert.equal(assertEvidenceBundle(bundle), bundle);
    assert.deepEqual(bundle.items, []);
    assert.deepEqual(bundle.conflict_groups, []);
  }
});

test("exact structured retrieval requires the actual version value", (context) => {
  const store = createFixtureStore(context);
  const queryPlan = createFixtureClassifier().classify({
    question: "雷電將軍的元素是什麼？",
    game_version: "5.0",
  });

  assert.throws(
    () => retrieveStructuredEvidence({
      store,
      queryId: "qry:missing-exact-version",
      queryPlan,
    }),
    /gameVersion is required/,
  );
  assert.throws(
    () => retrieveStructuredEvidence({
      store,
      queryId: "qry:contradictory-version",
      queryPlan,
      gameVersion: "unknown",
    }),
    /cannot be unknown/,
  );
});

test("evidence IDs and ordering are deterministic without mutating inputs", (context) => {
  const store = createFixtureStore(context);
  const queryPlan = createFixtureClassifier().classify({
    question: "須彌的屬性與世界觀背景",
    spoiler_level: "notice",
  });
  const request = {
    queryId: "qry:sumeru-deterministic",
    queryPlan,
  };
  const before = structuredClone(request);

  const first = retrieveStructuredEvidence({ store, ...request });
  const second = retrieveStructuredEvidence({ store, ...request });

  assert.deepEqual(first, second);
  assert.deepEqual(request, before);
  assert.ok(first.items.length > 0);
  assert.ok(first.items.every((item) => /^evd:[a-z0-9._-]+$/.test(item.evidence_id)));
});

test("retrieval validates public boundaries and missing source metadata", (context) => {
  const store = createFixtureStore(context);
  const retriever = createStructuredRetriever({ store });

  assert.throws(() => retriever.retrieve({ queryId: "bad", queryPlan: {} }), /queryId/);
  assert.throws(() => createStructuredRetriever({ store: {} }), /structured store/);
  assert.throws(
    () => retriever.retrieve({ queryId: "qry:unknown-field", queryPlan: {}, extra: true }),
    /Unknown structured retrieval request field/,
  );

  const missingSourceStore = {
    findStructuredFacts: () => [{
      fact_id: "fact:missing-source",
      entity_id: "ent:raiden-shogun",
      field_key: "element",
      value: "electro",
      unit: null,
      game_version: "5.0",
      source_id: "src:missing",
      validity: "active",
    }],
    findClaims: () => [],
    getSourceDocument: () => undefined,
    getConflictGroup: () => undefined,
  };
  const missingSourceRetriever = createStructuredRetriever({ store: missingSourceStore });
  assert.throws(
    () => missingSourceRetriever.retrieve({
      queryId: "qry:missing-source",
      queryPlan: {
        query_category: "structured",
        normalized_entities: [{
          entity_id: "ent:raiden-shogun",
          text: "雷電將軍",
          entity_type: "character",
          resolution_status: "resolved",
          aliases_used: [],
        }],
        version_constraint: "current-unspecified",
        retrieval_mode: "structured",
        spoiler_level: "none",
      },
    }),
    /missing source metadata/,
  );
});
