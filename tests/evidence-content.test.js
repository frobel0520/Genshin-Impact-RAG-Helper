import assert from "node:assert/strict";
import test from "node:test";

import { createEvidenceContentResolver, formatFact } from "../src/query/evidence-content.js";

const stores = {
  structuredStore: {
    getStructuredFact: (factId) =>
      factId === "fact:mualani-element"
        ? {
            fact_id: factId,
            entity_id: "ent:mualani",
            field_key: "element",
            value: "Hydro",
            unit: null,
            game_version: "5.0",
            source_id: "src:hoyolab-version-5-0",
            validity: "active",
          }
        : undefined,
    getCanonicalEntity: (entityId) =>
      entityId === "ent:mualani"
        ? { entity_id: entityId, canonical_name: "瑪拉妮", entity_type: "character" }
        : undefined,
    getClaim: (claimId) =>
      claimId === "claim:one"
        ? { claim_id: claimId, claim_text: "官方公告記載…", entity_id: "ent:raiden-shogun" }
        : undefined,
  },
  documentStore: {
    getDocumentChunk: (chunkId) =>
      chunkId === "chunk:one" ? { chunk_id: chunkId, text: "逐字原文。" } : undefined,
  },
};

function evidence(overrides) {
  return {
    evidence_id: "evd:one",
    source_id: "src:hoyolab-version-5-0",
    source_kind: "hoyolab",
    source_url: "https://www.hoyolab.com/article/32547672",
    source_title: "5.0版本更新說明",
    source_retrieved_at: "2026-08-29T00:00:00Z",
    rank: 1,
    support_type: "direct",
    ...overrides,
  };
}

test("a fact, a claim, and a chunk each resolve to their own text", () => {
  const resolver = createEvidenceContentResolver(stores);

  const contents = resolver.resolve([
    evidence({ fact_id: "fact:mualani-element", game_version: "5.0" }),
    evidence({ evidence_id: "evd:two", claim_id: "claim:one" }),
    evidence({ evidence_id: "evd:three", chunk_id: "chunk:one" }),
  ]);

  assert.deepEqual(
    contents.map((content) => content.text),
    ["瑪拉妮的元素：水", "官方公告記載…", "逐字原文。"],
  );
  assert.equal(contents[0].source_title, "5.0版本更新說明");
  assert.equal(contents[0].game_version, "5.0");
  assert.equal("game_version" in contents[1], false);
});

test("a record the dataset no longer holds is skipped, not rendered blank", () => {
  const resolver = createEvidenceContentResolver(stores);

  const contents = resolver.resolve([
    evidence({ fact_id: "fact:gone" }),
    evidence({ evidence_id: "evd:two", chunk_id: "chunk:one" }),
  ]);

  assert.equal(contents.length, 1);
  assert.equal(contents[0].evidence_id, "evd:two");
});

test("an item that references no record contributes nothing", () => {
  const resolver = createEvidenceContentResolver(stores);

  assert.deepEqual(resolver.resolve([evidence({})]), []);
});

test("a fact is rendered in zh-TW so the model never has to translate it", () => {
  assert.equal(formatFact({ field_key: "rarity", value: 5, unit: "stars" }), "星級：5 星");
  assert.equal(
    formatFact({ field_key: "rarity", value: 5, unit: "stars" }, "瑪拉妮"),
    "瑪拉妮的星級：5 星",
  );
  assert.equal(formatFact({ field_key: "element", value: "Hydro", unit: null }), "元素：水");
  // Claymore is the case that made this necessary: left in English, the model
  // rendered it 長劍 — a different weapon — with the confidence of a cited fact.
  assert.equal(
    formatFact({ field_key: "weapon_type", value: "Claymore", unit: null }),
    "武器類型：雙手劍",
  );
  assert.equal(
    formatFact({ field_key: "weapon_type", value: "Catalyst", unit: null }),
    "武器類型：法器",
  );
});

test("a field or value with no defined label is passed through, never guessed", () => {
  assert.equal(
    formatFact({ field_key: "release_window", value: { start: "3.0" }, unit: null }),
    '登場版本區間：{"start":"3.0"}',
  );
  assert.equal(
    formatFact({ field_key: "constellation_count", value: 6, unit: null }),
    "constellation_count：6",
  );
  assert.equal(
    formatFact({ field_key: "element", value: "Quantum", unit: null }),
    "元素：Quantum",
  );
});

test("the resolver validates its stores and its input", () => {
  assert.throws(() => createEvidenceContentResolver({}), /structuredStore/);
  assert.throws(
    () =>
      createEvidenceContentResolver({
        structuredStore: { getStructuredFact: () => {}, getClaim: () => {} },
        documentStore: stores.documentStore,
      }),
    /getCanonicalEntity/,
  );
  assert.throws(
    () => createEvidenceContentResolver({ structuredStore: stores.structuredStore }),
    /documentStore/,
  );
  assert.throws(() => createEvidenceContentResolver({ ...stores, extra: 1 }), /Unknown/);
  assert.throws(() => createEvidenceContentResolver(stores).resolve("nope"), /array/);
  assert.throws(() => createEvidenceContentResolver(stores).resolve([null]), /plain object/);
});
