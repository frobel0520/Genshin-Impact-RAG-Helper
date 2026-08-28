import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  NAME_NORMALIZATION_RULESET_VERSION,
  NAME_NORMALIZATION_SCHEMA_VERSION,
  NAME_NORMALIZATION_RULES,
  buildEntityNameIndex,
  createComparableNameKey,
  normalizeEntityName,
  normalizeEntityNames,
  normalizeNameText,
} from "../src/ingest/source-name-normalizer.js";
import { validateEntityResolution } from "../src/data/canonical-entity-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entityFixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/canonical-entity.json"), "utf8"),
);
const normalizationFixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/source-name-normalization.json"), "utf8"),
);

test("normalization rules and fixture examples are versioned and deterministic", () => {
  assert.equal(normalizationFixture.schema_version, NAME_NORMALIZATION_SCHEMA_VERSION);
  assert.equal(normalizationFixture.ruleset_version, NAME_NORMALIZATION_RULESET_VERSION);
  assert.deepEqual(NAME_NORMALIZATION_RULES, {
    version: 1,
    unicodeForm: "NFKC",
    whitespace: "trim-and-collapse",
    comparison: "lowercase",
    aliasMatching: "explicit-only",
    fuzzyMatching: false,
  });

  const entityIndex = buildEntityNameIndex(entityFixture.canonical_entities);
  for (const example of normalizationFixture.examples) {
    const actual = normalizeEntityName(example.source_text, {
      locale: example.locale,
      entityIndex,
    });

    assert.equal(actual.schema_version, normalizationFixture.schema_version);
    assert.equal(actual.ruleset_version, normalizationFixture.ruleset_version);
    assert.equal(actual.source_text, example.source_text);
    assert.equal(actual.normalized_text, example.expected.normalized_text);
    assert.equal(actual.normalized_key, example.expected.normalized_key);
    assert.deepEqual(actual.resolution, example.expected.resolution);
    assert.deepEqual(validateEntityResolution(actual.resolution), {
      ok: true,
      value: actual.resolution,
    });
  }
});

test("Unicode normalization, whitespace cleanup, and comparison keys are stable", () => {
  assert.equal(normalizeNameText("  The\u00a0  Catch  "), "The Catch");
  assert.equal(createComparableNameKey("  KAMISATO   Ayaka  "), "kamisato ayaka");
  assert.equal(
    createComparableNameKey("Ａｙａｋａ"),
    createComparableNameKey("Ayaka"),
  );
});

test("source text is preserved while a matched alias resolves to the canonical name", () => {
  const sourceText = "  The   Catch  ";
  const before = structuredClone(sourceText);
  const result = normalizeEntityName(sourceText, {
    locale: "en-US",
    canonicalEntities: entityFixture.canonical_entities,
  });

  assert.equal(result.source_text, sourceText);
  assert.equal(result.normalized_text, "漁獲");
  assert.equal(result.resolution.entity_id, "ent:the-catch");
  assert.deepEqual(result.resolution.aliases_used, ["The Catch"]);
  assert.equal(sourceText, before);
});

test("unknown names remain traceable without guessed entity identity", () => {
  const result = normalizeEntityName("  未登錄名稱  ", {
    locale: "zh-TW",
    canonicalEntities: entityFixture.canonical_entities,
  });

  assert.equal(result.source_text, "  未登錄名稱  ");
  assert.equal(result.normalized_text, "未登錄名稱");
  assert.equal(result.normalized_key, "未登錄名稱");
  assert.equal(result.resolution.resolution_status, "unrecognized");
  assert.equal(result.resolution.entity_id, null);
  assert.equal(result.resolution.entity_type, null);
  assert.deepEqual(result.resolution.aliases_used, []);
});

test("normalization is explicit-only and rejects ambiguous normalized names", () => {
  const typo = normalizeEntityName("Kamizato Ayaka", {
    canonicalEntities: entityFixture.canonical_entities,
  });
  assert.equal(typo.resolution.resolution_status, "unrecognized");

  assert.throws(
    () =>
      buildEntityNameIndex([
        entityFixture.canonical_entities[0],
        {
          ...entityFixture.canonical_entities[1],
          entity_id: "ent:other-entity",
          canonical_name: "神里綾華",
        },
      ]),
    /Duplicate normalized entity name/,
  );
});

test("batch normalization reuses the index and preserves order", () => {
  const sourceTexts = ["Ayaka", "Sumeru", "不存在"];
  const result = normalizeEntityNames(sourceTexts, {
    canonicalEntities: entityFixture.canonical_entities,
  });

  assert.deepEqual(
    result.map(({ source_text: sourceText, normalized_text: normalizedText }) => ({
      sourceText,
      normalizedText,
    })),
    [
      { sourceText: "Ayaka", normalizedText: "神里綾華" },
      { sourceText: "Sumeru", normalizedText: "須彌" },
      { sourceText: "不存在", normalizedText: "不存在" },
    ],
  );
});
