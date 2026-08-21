import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SOURCE_DOCUMENT_FIELDS,
  SOURCE_DOCUMENT_OPTIONAL_FIELDS,
  SOURCE_DOCUMENT_REQUIRED_FIELDS,
  SOURCE_DOCUMENT_SCHEMA,
  SOURCE_DOCUMENT_SCHEMA_VERSION,
  SOURCE_DOCUMENT_VALIDATION_CODES,
  assertSourceDocument,
  isSourceDocument,
  validateSourceDocument,
} from "../src/data/source-document-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/source-document.json"), "utf8"),
);

test("SourceDocument fixture covers all supported source kinds", () => {
  assert.equal(fixture.schema_version, SOURCE_DOCUMENT_SCHEMA_VERSION);
  assert.equal(fixture.documents.length, 3);
  assert.deepEqual(
    new Set(fixture.documents.map((document) => document.source_kind)),
    new Set(["hoyolab", "genshin-db", "fandom"]),
  );

  for (const document of fixture.documents) {
    const result = validateSourceDocument(document);
    assert.deepEqual(result, { ok: true, value: document });
    assert.equal(isSourceDocument(document), true);
  }
});

test("SourceDocument schema separates required and optional metadata", () => {
  assert.deepEqual(SOURCE_DOCUMENT_SCHEMA.required, SOURCE_DOCUMENT_REQUIRED_FIELDS);
  assert.deepEqual(SOURCE_DOCUMENT_SCHEMA.optional, SOURCE_DOCUMENT_OPTIONAL_FIELDS);
  assert.deepEqual(SOURCE_DOCUMENT_FIELDS, [
    ...SOURCE_DOCUMENT_REQUIRED_FIELDS,
    ...SOURCE_DOCUMENT_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(SOURCE_DOCUMENT_SCHEMA.contentHash, {
    algorithm: "sha-256",
    encoding: "hex",
    length: 64,
  });
});

test("missing traceability and rights fields are classified", () => {
  const document = { ...fixture.documents[0] };
  for (const field of ["source_url", "retrieved_at", "rights_note", "content_hash"]) {
    delete document[field];
  }

  const result = validateSourceDocument(document);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      ["source_url", SOURCE_DOCUMENT_VALIDATION_CODES.MISSING_REQUIRED_FIELD],
      ["retrieved_at", SOURCE_DOCUMENT_VALIDATION_CODES.MISSING_REQUIRED_FIELD],
      ["rights_note", SOURCE_DOCUMENT_VALIDATION_CODES.MISSING_REQUIRED_FIELD],
      ["content_hash", SOURCE_DOCUMENT_VALIDATION_CODES.MISSING_REQUIRED_FIELD],
    ].map(([path, code]) => ({ code, path })),
  );
});

test("unknown fields do not silently enter the SourceDocument contract", () => {
  const result = validateSourceDocument({
    ...fixture.documents[0],
    license_note: "Use rights_note as the canonical field.",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    {
      code: SOURCE_DOCUMENT_VALIDATION_CODES.UNKNOWN_FIELD,
      path: "license_note",
      message: "Unknown SourceDocument field: license_note.",
    },
  ]);
});

test("content hash, URL, and timestamp formats are validated", () => {
  const invalid = {
    ...fixture.documents[0],
    source_url: "ftp://example.test/source",
    retrieved_at: "2026-02-31T12:00:00Z",
    content_hash: "ABC",
  };

  const result = validateSourceDocument(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_SOURCE_URL, path: "source_url" },
      { code: SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_TIMESTAMP, path: "retrieved_at" },
      { code: SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_CONTENT_HASH, path: "content_hash" },
    ],
  );
});

test("unknown game version is preserved and validation is non-mutating", () => {
  const document = { ...fixture.documents[1] };
  const before = { ...document };

  assert.equal(document.game_version, "unknown");
  assert.equal(assertSourceDocument(document), document);
  assert.deepEqual(document, before);
  assert.equal(
    validateSourceDocument({ ...document, game_version: "   " }).errors[0].code,
    SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_GAME_VERSION,
  );
});

test("invalid SourceDocument input throws through the assertion helper", () => {
  assert.throws(
    () => assertSourceDocument({ ...fixture.documents[0], source_id: "entity:nope" }),
    /source_id: source_id must be a typed source domain ID/,
  );
  assert.equal(isSourceDocument(null), false);
});
