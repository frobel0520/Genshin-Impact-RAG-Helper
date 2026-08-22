import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DOCUMENT_CHUNK_REQUIRED_FIELDS,
  DOCUMENT_CHUNK_SCHEMA,
  DOCUMENT_CHUNK_SCHEMA_VERSION,
  DOCUMENT_CHUNK_VALIDATION_CODES,
  assertDocumentChunk,
  isDocumentChunk,
  validateDocumentChunk,
} from "../src/data/document-chunk-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/document-chunk.json"), "utf8"),
);

test("DocumentChunk fixture covers versioned, unknown, and entity-linked chunks", () => {
  assert.equal(fixture.schema_version, DOCUMENT_CHUNK_SCHEMA_VERSION);
  assert.equal(fixture.chunks.length, 3);
  assert.equal(fixture.chunks.filter((chunk) => chunk.entity_ids.length === 0).length, 1);
  assert.equal(fixture.chunks.filter((chunk) => chunk.entity_ids.length > 0).length, 2);

  for (const chunk of fixture.chunks) {
    assert.deepEqual(validateDocumentChunk(chunk), { ok: true, value: chunk });
    assert.equal(isDocumentChunk(chunk), true);
  }
});

test(
  "DocumentChunk schema keeps locator, text, token hint, version, and entity links explicit",
  () => {
    assert.deepEqual(DOCUMENT_CHUNK_SCHEMA.required, DOCUMENT_CHUNK_REQUIRED_FIELDS);
    assert.equal(DOCUMENT_CHUNK_SCHEMA.documentLocator, "non-empty stable string");
    assert.equal(DOCUMENT_CHUNK_SCHEMA.text, "non-empty source text; preserved verbatim");
    assert.equal(DOCUMENT_CHUNK_SCHEMA.tokenHint, "non-negative integer estimate");
    assert.equal(DOCUMENT_CHUNK_SCHEMA.gameVersion, "non-empty string; unknown is explicit");
    assert.deepEqual(DOCUMENT_CHUNK_SCHEMA.entityIds, {
      type: "unique entity:<id>[]",
      allowEmpty: true,
    });
  },
);

test(
  "DocumentChunk preserves text boundaries and accepts unknown version with no entity IDs",
  () => {
    const chunk = { ...fixture.chunks[1], text: "  保留來源文字的前後空白  " };
    const result = validateDocumentChunk(chunk);

    assert.deepEqual(result, { ok: true, value: chunk });
    assert.equal(result.value.text, "  保留來源文字的前後空白  ");
    assert.equal(result.value.game_version, "unknown");
    assert.deepEqual(result.value.entity_ids, []);
  },
);

test("DocumentChunk rejects invalid typed IDs, locator, token hint, and version", () => {
  const invalid = {
    ...fixture.chunks[0],
    chunk_id: "fact:not-a-chunk",
    source_id: "ent:not-a-source",
    document_locator: "   ",
    token_hint: -1,
    game_version: "",
  };

  const result = validateDocumentChunk(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_CHUNK_ID, path: "chunk_id" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_SOURCE_ID, path: "source_id" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_DOCUMENT_LOCATOR, path: "document_locator" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_TOKEN_HINT, path: "token_hint" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_GAME_VERSION, path: "game_version" },
    ],
  );
});

test("entity links may be empty for unclassified text but must be typed and unique", () => {
  const invalid = {
    ...fixture.chunks[0],
    entity_ids: ["ent:kamisato-ayaka", "ent:kamisato-ayaka", "src:not-an-entity"],
    unknown_field: true,
  };

  const result = validateDocumentChunk(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.UNKNOWN_FIELD, path: "unknown_field" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.DUPLICATE_ENTITY_ID, path: "entity_ids[1]" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.INVALID_ENTITY_ID, path: "entity_ids[2]" },
    ],
  );
});

test("DocumentChunk requires all metadata fields", () => {
  const incomplete = { ...fixture.chunks[0] };
  delete incomplete.document_locator;
  delete incomplete.token_hint;
  delete incomplete.entity_ids;

  const result = validateDocumentChunk(incomplete);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "document_locator" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "token_hint" },
      { code: DOCUMENT_CHUNK_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "entity_ids" },
    ],
  );
});

test("DocumentChunk assertion is non-mutating and preserves valid object identity", () => {
  const chunk = structuredClone(fixture.chunks[0]);
  const before = structuredClone(chunk);

  assert.equal(assertDocumentChunk(chunk), chunk);
  assert.deepEqual(chunk, before);
  assert.throws(
    () => assertDocumentChunk({ ...chunk, chunk_id: "bad" }),
    /chunk_id: chunk_id must be a typed chunk domain ID/,
  );
});
