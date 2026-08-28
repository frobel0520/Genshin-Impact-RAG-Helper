import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import {
  STRUCTURED_STORE_SCHEMA_VERSION,
  createStructuredStore,
} from "../src/data/structured-store.js";

const fixturePack = loadFixtureSourcePack();


function createFixtureData() {
  return structuredClone({
    source_documents: fixturePack.source_documents,
    canonical_entities: fixturePack.canonical_entities,
    structured_facts: fixturePack.structured_facts,
    claims: fixturePack.claims,
    conflict_groups: fixturePack.conflict_groups,
  });
}

function expectedCounts(data) {
  return {
    sourceDocuments: data.source_documents.length,
    canonicalEntities: data.canonical_entities.length,
    structuredFacts: data.structured_facts.length,
    claims: data.claims.length,
    conflictGroups: data.conflict_groups.length,
  };
}

function closeStoreAfterTest(context, store) {
  context.after(() => {
    if (store.getStatus().isOpen) {
      store.close();
    }
  });
}

test("structured store replaces fixture data atomically and reports status", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  const data = createFixtureData();
  const before = structuredClone(data);

  assert.deepEqual(store.getStatus().counts, {
    sourceDocuments: 0,
    canonicalEntities: 0,
    structuredFacts: 0,
    claims: 0,
    conflictGroups: 0,
  });

  store.replaceData(data);

  const status = store.getStatus();
  assert.equal(status.isOpen, true);
  assert.equal(status.schemaVersion, STRUCTURED_STORE_SCHEMA_VERSION);
  assert.deepEqual(status.counts, expectedCounts(data));
  assert.deepEqual(data, before);
});

test("StructuredFact queries filter by entity, field, and exact game version", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  store.replaceData(createFixtureData());

  const raidenFacts = store.findStructuredFacts({ entityId: "ent:raiden-shogun" });
  assert.deepEqual(
    raidenFacts.map((fact) => fact.fact_id).sort(),
    [
      "fact:raiden-shogun-element",
      "fact:raiden-shogun-rarity",
      "fact:raiden-shogun-weapon-type",
    ],
  );

  assert.deepEqual(
    store.findStructuredFacts({
      entityId: "ent:raiden-shogun",
      fieldKey: "element",
      gameVersion: "5.0",
    }),
    [fixturePack.structured_facts.find((fact) => fact.fact_id === "fact:raiden-shogun-element")],
  );

  assert.deepEqual(
    store.findStructuredFacts({
      entityId: "ent:sumeru",
      fieldKey: "release_window",
      gameVersion: "3.0-3.8",
    }).map((fact) => fact.fact_id),
    ["fact:sumeru-release-window"],
  );
  assert.deepEqual(
    store.findStructuredFacts({
      entityId: "ent:sumeru",
      fieldKey: "release_window",
      gameVersion: "3.0",
    }),
    [],
  );

  assert.equal(
    store.findStructuredFacts({
      entityId: "ent:engulfing-lightning",
      fieldKey: "base_atk_lvl90",
      gameVersion: "unknown",
    }).length,
    1,
  );
  assert.deepEqual(
    store.findStructuredFacts({
      entityId: "ent:engulfing-lightning",
      fieldKey: "base_atk_lvl90",
      gameVersion: "5.0",
    }),
    [],
  );
});

test("StructuredFact JSON values round-trip without losing their types", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  store.replaceData(createFixtureData());

  const [rangeFact] = store.findStructuredFacts({
    entityId: "ent:sumeru",
    fieldKey: "release_window",
    gameVersion: "3.0-3.8",
  });
  const [numericFact] = store.findStructuredFacts({
    entityId: "ent:engulfing-lightning",
    fieldKey: "base_atk_lvl90",
    gameVersion: "unknown",
  });

  assert.deepEqual(rangeFact.value, { start: "3.0", end: "3.8" });
  assert.equal(rangeFact.unit, null);
  assert.equal(numericFact.value, 608);
  assert.equal(typeof numericFact.value, "number");
});

test("Claim queries preserve every conflicting claim in authority order", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  store.replaceData(createFixtureData());

  const claims = store.findClaims({
    entityId: "ent:kamisato-ayaka",
    claimKey: "elemental_burst_name",
    gameVersion: "5.0",
  });

  assert.deepEqual(
    claims.map((claim) => claim.claim_id),
    [
      "claim:kamisato-ayaka-burst-official",
      "claim:kamisato-ayaka-burst-wiki-differing",
    ],
  );
  assert.deepEqual(
    claims.map((claim) => claim.authority_rank),
    [1, 3],
  );
  assert.equal(
    claims.every(
      (claim) => claim.conflict_group_id === "conflict:kamisato-ayaka-burst-name",
    ),
    true,
  );
});

test("Claim queries reuse contract timestamp ordering for equal authority", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  const data = createFixtureData();
  const sourceTemplate = data.source_documents.find(
    (source) => source.source_id === "src:fandom-kamisato-ayaka",
  );
  const conflictGroupId = "conflict:timestamp-order-test";

  data.source_documents.push(
    {
      ...sourceTemplate,
      source_id: "src:fandom-timestamp-older",
      source_url: "https://genshin-impact.fandom.com/wiki/Test_Older",
      title: "Timestamp order older source",
      published_at: "2025-01-01T00:30:00+02:00",
      content_hash: "a".repeat(64),
    },
    {
      ...sourceTemplate,
      source_id: "src:fandom-timestamp-newer",
      source_url: "https://genshin-impact.fandom.com/wiki/Test_Newer",
      title: "Timestamp order newer source",
      published_at: "2024-12-31T23:00:00Z",
      content_hash: "b".repeat(64),
    },
  );
  data.claims.push(
    {
      claim_id: "claim:timestamp-order-older",
      claim_key: "timestamp_order_test",
      entity_id: "ent:kamisato-ayaka",
      claim_text: "較舊的實際發布時間。",
      game_version: "5.0",
      source_id: "src:fandom-timestamp-older",
      authority_rank: 3,
      conflict_group_id: conflictGroupId,
    },
    {
      claim_id: "claim:timestamp-order-newer",
      claim_key: "timestamp_order_test",
      entity_id: "ent:kamisato-ayaka",
      claim_text: "較新的實際發布時間。",
      game_version: "5.0",
      source_id: "src:fandom-timestamp-newer",
      authority_rank: 3,
      conflict_group_id: conflictGroupId,
    },
  );
  data.conflict_groups.push({
    conflict_group_id: conflictGroupId,
    claim_ids: ["claim:timestamp-order-older", "claim:timestamp-order-newer"],
  });

  store.replaceData(data);

  assert.deepEqual(
    store.findClaims({
      entityId: "ent:kamisato-ayaka",
      claimKey: "timestamp_order_test",
      gameVersion: "5.0",
    }).map((claim) => claim.claim_id),
    ["claim:timestamp-order-newer", "claim:timestamp-order-older"],
  );
});

test("structured store resolves source and conflict records and returns empty query results", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  store.replaceData(createFixtureData());

  assert.deepEqual(
    store.getSourceDocument("src:hoyolab-version-5-0"),
    fixturePack.source_documents.find(
      (source) => source.source_id === "src:hoyolab-version-5-0",
    ),
  );
  assert.deepEqual(
    store.getConflictGroup("conflict:kamisato-ayaka-burst-name"),
    fixturePack.conflict_groups[0],
  );
  assert.deepEqual(
    store.findStructuredFacts({ entityId: "ent:nahida" }),
    [],
  );
  assert.deepEqual(
    store.findClaims({ entityId: "ent:nahida" }),
    [],
  );
});

test("structured store rejects malformed and unknown query filters", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  store.replaceData(createFixtureData());

  for (const filters of [
    undefined,
    null,
    {},
    { entityId: "src:not-an-entity" },
    { entityId: "ent:raiden-shogun", fieldKey: "element", unexpected: true },
    { entityId: "ent:raiden-shogun", gameVersion: "" },
  ]) {
    assert.throws(() => store.findStructuredFacts(filters));
  }

  for (const filters of [
    undefined,
    null,
    {},
    { entityId: "claim:not-an-entity" },
    { entityId: "ent:kamisato-ayaka", fieldKey: "elemental_burst_name" },
    { entityId: "ent:kamisato-ayaka", claimKey: "" },
  ]) {
    assert.throws(() => store.findClaims(filters));
  }
});

test("failed replacement rolls back every table and preserves prior data", (context) => {
  const store = createStructuredStore();
  closeStoreAfterTest(context, store);
  const validData = createFixtureData();
  store.replaceData(validData);
  const beforeStatus = store.getStatus();

  const invalidData = createFixtureData();
  invalidData.structured_facts[0].value = "must-not-persist";
  invalidData.claims.push({
    ...invalidData.claims.at(-1),
    claim_id: invalidData.claims[0].claim_id,
  });

  assert.throws(() => store.replaceData(invalidData));
  assert.deepEqual(store.getStatus().counts, beforeStatus.counts);

  assert.throws(
    () => store.replaceData({ ...createFixtureData(), unexpected: true }),
    /Unknown structured store data field: unexpected/,
  );
  assert.deepEqual(store.getStatus().counts, beforeStatus.counts);

  const missingConflictData = createFixtureData();
  missingConflictData.conflict_groups = [];
  for (const claim of missingConflictData.claims) {
    if (claim.conflict_group_id === "conflict:kamisato-ayaka-burst-name") {
      claim.conflict_group_id = null;
    }
  }
  assert.throws(() => store.replaceData(missingConflictData), /conflict_groups/);
  assert.deepEqual(store.getStatus().counts, beforeStatus.counts);

  const [preservedFact] = store.findStructuredFacts({
    entityId: "ent:raiden-shogun",
    fieldKey: "element",
    gameVersion: "5.0",
  });
  assert.equal(preservedFact.value, "Electro");
  assert.deepEqual(
    store.findClaims({
      entityId: "ent:kamisato-ayaka",
      claimKey: "elemental_burst_name",
      gameVersion: "5.0",
    }).map((claim) => claim.claim_id),
    [
      "claim:kamisato-ayaka-burst-official",
      "claim:kamisato-ayaka-burst-wiki-differing",
    ],
  );
});

test("file-backed structured store persists across close and reopen", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "genshin-structured-store-"));
  const databasePath = join(temporaryDirectory, "structured-store.sqlite");
  const data = createFixtureData();
  const counts = expectedCounts(data);
  let firstStore;
  let reopenedStore;

  try {
    firstStore = createStructuredStore({ databasePath });
    firstStore.replaceData(data);
    assert.deepEqual(firstStore.getStatus().counts, counts);

    firstStore.close();
    const closedStatus = firstStore.getStatus();
    assert.equal(closedStatus.isOpen, false);
    assert.equal(closedStatus.schemaVersion, STRUCTURED_STORE_SCHEMA_VERSION);
    assert.deepEqual(closedStatus.counts, counts);

    reopenedStore = createStructuredStore({ databasePath });
    assert.equal(reopenedStore.getStatus().isOpen, true);
    assert.deepEqual(reopenedStore.getStatus().counts, counts);
    assert.deepEqual(
      reopenedStore.findStructuredFacts({
        entityId: "ent:raiden-shogun",
        fieldKey: "element",
        gameVersion: "5.0",
      }).map((fact) => fact.fact_id),
      ["fact:raiden-shogun-element"],
    );
    assert.equal(
      reopenedStore.getConflictGroup("conflict:kamisato-ayaka-burst-name")
        .claim_ids.length,
      2,
    );
  } finally {
    if (firstStore?.getStatus().isOpen) {
      firstStore.close();
    }
    if (reopenedStore?.getStatus().isOpen) {
      reopenedStore.close();
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("incompatible database schema is rejected without creating store tables", () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "genshin-structured-store-schema-"));
  const databasePath = join(temporaryDirectory, "incompatible.sqlite");
  const incompatibleDatabase = new DatabaseSync(databasePath);

  try {
    incompatibleDatabase.exec(`
      CREATE TABLE structured_store_metadata (
        singleton INTEGER PRIMARY KEY,
        schema_version INTEGER NOT NULL
      );
      INSERT INTO structured_store_metadata (singleton, schema_version) VALUES (1, 999);
    `);
  } finally {
    incompatibleDatabase.close();
  }

  try {
    assert.throws(
      () => createStructuredStore({ databasePath }),
      /Unsupported structured store schema version: 999/,
    );

    const inspectionDatabase = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const storeTable = inspectionDatabase
        .prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = 'structured_facts'
        `)
        .get();
      assert.equal(storeTable, undefined);
    } finally {
      inspectionDatabase.close();
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
