import { FIELD_VALUE_LABELS_ZH_TW } from "../domain/domain-contract.js";

/**
 * Turning a genshin-db record into this project's facts.
 *
 * The mapping is a table, not an inference. genshin-db names an element
 * `ELEMENT_HYDRO` and a weapon `WEAPON_CATALYST`; this project stores `Hydro`
 * and `Catalyst`, because facts from different sources have to be comparable
 * and the zh-TW label is rendered from the domain layer at the end. Deriving
 * one from the other by stripping a prefix would look right until genshin-db
 * introduces a name that does not follow the pattern, and the wrong value would
 * arrive as a fact with a source behind it — the shape of the defect T32 found
 * when a model translated `Claymore` into 長劍.
 *
 * Every key below was read out of the pinned data, not guessed. The first draft
 * of this table guessed `ELEMENT_ELECTRIC`; the real name is `ELEMENT_ELECTRO`.
 * The one-handed sword was then left out until an entity actually used one, and
 * when 芙寧娜 was imported the run stopped and reported the name it could not
 * place — which is the whole reason an unmapped value is an error rather than a
 * pass-through.
 */
export const ELEMENT_BY_GENSHIN_DB = Object.freeze({
  ELEMENT_ANEMO: "Anemo",
  ELEMENT_GEO: "Geo",
  ELEMENT_ELECTRO: "Electro",
  ELEMENT_DENDRO: "Dendro",
  ELEMENT_HYDRO: "Hydro",
  ELEMENT_PYRO: "Pyro",
  ELEMENT_CRYO: "Cryo",
});

export const WEAPON_TYPE_BY_GENSHIN_DB = Object.freeze({
  // Every key confirmed against the pinned data. WEAPON_SWORD_ONE_HAND was left
  // out of the first version precisely because no imported entity used it — and
  // when 芙寧娜 was added, the import stopped and named it rather than writing a
  // guess. The name it reported is the one below.
  WEAPON_SWORD_ONE_HAND: "Sword",
  WEAPON_CLAYMORE: "Claymore",
  WEAPON_POLE: "Polearm",
  WEAPON_BOW: "Bow",
  WEAPON_CATALYST: "Catalyst",
});

const VALID_ELEMENTS = new Set(Object.keys(FIELD_VALUE_LABELS_ZH_TW.element));
const VALID_WEAPON_TYPES = new Set(Object.keys(FIELD_VALUE_LABELS_ZH_TW.weapon_type));

/**
 * Read the facts this project stores out of one genshin-db record.
 *
 * Unknown enum values are an error, never a pass-through: a value this project
 * has no label for would reach an answer untranslated, which is exactly what
 * the label table exists to prevent.
 *
 * @param {{ entityId: string, entityType: string, record: object, sourceId: string }} options
 * @returns {{ facts: object[] }}
 */
export function factsFromGenshinDb({ entityId, entityType, record, sourceId }) {
  if (typeof entityId !== "string" || entityId.trim() === "") {
    throw new TypeError("entityId must be a non-empty string.");
  }
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError(`${entityId}: record must be a plain object.`);
  }
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    throw new TypeError("sourceId must be a non-empty string.");
  }

  const key = entityId.slice(entityId.indexOf(":") + 1);
  const facts = [];

  if (entityType === "character") {
    facts.push(
      fact(key, entityId, "element", mapped(ELEMENT_BY_GENSHIN_DB, VALID_ELEMENTS, record.elementType, entityId, "element"), null, sourceId),
    );
  }
  facts.push(
    fact(
      key,
      entityId,
      "weapon_type",
      mapped(WEAPON_TYPE_BY_GENSHIN_DB, VALID_WEAPON_TYPES, record.weaponType, entityId, "weapon_type"),
      null,
      sourceId,
    ),
  );
  facts.push(fact(key, entityId, "rarity", rarity(record.rarity, entityId), "stars", sourceId));

  return { facts };
}

function mapped(table, valid, raw, entityId, fieldKey) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`${entityId}: genshin-db record has no ${fieldKey}.`);
  }
  const value = table[raw];
  if (value === undefined) {
    throw new Error(
      `${entityId}: genshin-db ${fieldKey} ${JSON.stringify(raw)} has no mapping. ` +
        "Add it to the table deliberately rather than guessing at the value.",
    );
  }
  if (!valid.has(value)) {
    throw new Error(`${entityId}: ${fieldKey} ${value} is not a value this project labels.`);
  }
  return value;
}

function rarity(raw, entityId) {
  if (!Number.isInteger(raw) || raw < 1 || raw > 5) {
    throw new Error(`${entityId}: genshin-db rarity ${JSON.stringify(raw)} is not 1-5.`);
  }
  return raw;
}

function fact(key, entityId, fieldKey, value, unit, sourceId) {
  return {
    fact_id: `fact:genshin-db-${key}-${fieldKey.replaceAll("_", "-")}`,
    entity_id: entityId,
    field_key: fieldKey,
    value,
    unit,
    // genshin-db states what is true of the current game, not of a version, so
    // the version is genuinely unknown here rather than merely unrecorded. A
    // reader who needs one has the announcement's fact beside it, and the
    // version policy can tell the two apart.
    game_version: "unknown",
    source_id: sourceId,
    validity: "active",
  };
}
