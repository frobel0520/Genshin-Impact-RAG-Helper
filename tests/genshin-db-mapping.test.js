import assert from "node:assert/strict";
import test from "node:test";

import { FIELD_VALUE_LABELS_ZH_TW } from "../src/domain/domain-contract.js";
import {
  ELEMENT_BY_GENSHIN_DB,
  WEAPON_TYPE_BY_GENSHIN_DB,
  factsFromGenshinDb,
} from "../src/ingest/genshin-db-mapping.js";

const CHARACTER = Object.freeze({
  elementType: "ELEMENT_HYDRO",
  weaponType: "WEAPON_CATALYST",
  rarity: 5,
});

function facts(overrides = {}) {
  return factsFromGenshinDb({
    entityId: "ent:mualani",
    entityType: "character",
    record: { ...CHARACTER, ...overrides },
    sourceId: "src:genshin-db",
  }).facts;
}

test("a character record becomes the three facts this project stores", () => {
  const result = facts();

  assert.deepEqual(
    result.map((fact) => [fact.field_key, fact.value, fact.unit]),
    [
      ["element", "Hydro", null],
      ["weapon_type", "Catalyst", null],
      ["rarity", 5, "stars"],
    ],
  );
  for (const fact of result) {
    assert.equal(fact.entity_id, "ent:mualani");
    assert.equal(fact.source_id, "src:genshin-db");
    assert.equal(fact.validity, "active");
    // genshin-db describes the current game, not a version. Saying "unknown"
    // lets the version policy tell that apart from a version nobody recorded.
    assert.equal(fact.game_version, "unknown");
  }
});

test("a weapon record has no element", () => {
  const result = factsFromGenshinDb({
    entityId: "ent:surfs-up",
    entityType: "weapon",
    record: { weaponType: "WEAPON_CATALYST", rarity: 5 },
    sourceId: "src:genshin-db",
  }).facts;

  assert.deepEqual(result.map((fact) => fact.field_key), ["weapon_type", "rarity"]);
});

test("every mapped value is one this project can label", () => {
  // A value with no zh-TW label would reach an answer untranslated, which is
  // the defect T32 found when a model rendered `Claymore` as 長劍.
  for (const value of Object.values(ELEMENT_BY_GENSHIN_DB)) {
    assert.ok(FIELD_VALUE_LABELS_ZH_TW.element[value], `element ${value} has no label`);
  }
  for (const value of Object.values(WEAPON_TYPE_BY_GENSHIN_DB)) {
    assert.ok(FIELD_VALUE_LABELS_ZH_TW.weapon_type[value], `weapon_type ${value} has no label`);
  }
});

test("an unmapped enum stops the import instead of passing the raw name through", () => {
  // The first draft of the table guessed `ELEMENT_ELECTRIC`; the real name is
  // `ELEMENT_ELECTRO`. A pass-through would have written the guess as a fact
  // with a source behind it.
  assert.throws(
    () => facts({ elementType: "ELEMENT_ELECTRIC" }),
    /genshin-db element "ELEMENT_ELECTRIC" has no mapping/,
  );
  assert.throws(
    () => facts({ weaponType: "WEAPON_SWORD_TWO_HAND" }),
    /genshin-db weapon_type "WEAPON_SWORD_TWO_HAND" has no mapping/,
  );
});

test("a name the guard reported is added deliberately, then it maps", () => {
  // WEAPON_SWORD_ONE_HAND was left out until an entity used one. Importing
  // 芙寧娜 stopped the run and named it; the key below is the name it reported,
  // not a guess made in advance.
  assert.deepEqual(
    facts({ weaponType: "WEAPON_SWORD_ONE_HAND" }).map((fact) => [fact.field_key, fact.value]),
    [
      ["element", "Hydro"],
      ["weapon_type", "Sword"],
      ["rarity", 5],
    ],
  );
});

test("a missing or malformed field is an error, not a blank fact", () => {
  assert.throws(() => facts({ elementType: undefined }), /has no element/);
  assert.throws(() => facts({ weaponType: "" }), /has no weapon_type/);
  for (const rarity of [0, 6, 4.5, "5", null]) {
    assert.throws(() => facts({ rarity }), /rarity .* is not 1-5/);
  }
});

test("the caller's own arguments are checked", () => {
  assert.throws(
    () => factsFromGenshinDb({ entityId: "", entityType: "character", record: CHARACTER, sourceId: "s" }),
    /entityId must be a non-empty string/,
  );
  assert.throws(
    () => factsFromGenshinDb({ entityId: "ent:a", entityType: "character", record: [], sourceId: "s" }),
    /record must be a plain object/,
  );
  assert.throws(
    () => factsFromGenshinDb({ entityId: "ent:a", entityType: "character", record: CHARACTER, sourceId: "" }),
    /sourceId must be a non-empty string/,
  );
});
