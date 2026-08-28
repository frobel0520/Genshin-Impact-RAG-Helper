import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  SOURCE_IMPORT_FIELDS,
  SOURCE_IMPORT_OPTIONAL_FIELDS,
  SOURCE_IMPORT_REQUIRED_FIELDS,
  SOURCE_IMPORT_SCHEMA,
  SOURCE_IMPORT_SCHEMA_VERSION,
  SOURCE_IMPORT_VALIDATION_CODES,
  assertSourceImport,
  isSourceImport,
  validateSourceImport,
} from "../src/ingest/source-import-validator.js";
import { SOURCE_DOCUMENT_VALIDATION_CODES } from "../src/data/source-document-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/source-document.json"), "utf8"),
);

test("source import fixture validates as a non-empty batch", () => {
  const result = validateSourceImport(fixture);

  assert.deepEqual(result, { ok: true, value: fixture });
  assert.equal(isSourceImport(fixture), true);
  assert.equal(assertSourceImport(fixture), fixture);
});

test("source import schema exposes required and optional envelope fields", () => {
  assert.equal(SOURCE_IMPORT_SCHEMA_VERSION, 1);
  assert.deepEqual(SOURCE_IMPORT_SCHEMA.required, SOURCE_IMPORT_REQUIRED_FIELDS);
  assert.deepEqual(SOURCE_IMPORT_SCHEMA.optional, SOURCE_IMPORT_OPTIONAL_FIELDS);
  assert.deepEqual(SOURCE_IMPORT_FIELDS, [
    ...SOURCE_IMPORT_REQUIRED_FIELDS,
    ...SOURCE_IMPORT_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(SOURCE_IMPORT_SCHEMA.documents, "SourceDocument[]");
});

test("source import classifies invalid envelope shapes", () => {
  assert.deepEqual(validateSourceImport(null).errors, [
    {
      code: SOURCE_IMPORT_VALIDATION_CODES.INVALID_IMPORT,
      path: "$",
      message: "Source import must be a plain object.",
    },
  ]);

  assert.deepEqual(validateSourceImport({}).errors, [
    {
      code: SOURCE_IMPORT_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
      path: "documents",
      message: "Required source import field is missing: documents.",
    },
  ]);

  assert.deepEqual(validateSourceImport({ documents: "not-an-array" }).errors, [
    {
      code: SOURCE_IMPORT_VALIDATION_CODES.INVALID_DOCUMENTS,
      path: "documents",
      message: "documents must be an array of SourceDocument objects.",
    },
  ]);

  assert.deepEqual(validateSourceImport({ documents: [] }).errors, [
    {
      code: SOURCE_IMPORT_VALIDATION_CODES.EMPTY_DOCUMENTS,
      path: "documents",
      message: "documents must contain at least one SourceDocument.",
    },
  ]);
});

test("source import classifies unknown and unsupported envelope fields", () => {
  const result = validateSourceImport({
    ...fixture,
    schema_version: SOURCE_IMPORT_SCHEMA_VERSION + 1,
    extra: true,
  });

  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      {
        code: SOURCE_IMPORT_VALIDATION_CODES.UNKNOWN_FIELD,
        path: "extra",
      },
      {
        code: SOURCE_IMPORT_VALIDATION_CODES.INVALID_SCHEMA_VERSION,
        path: "schema_version",
      },
    ],
  );
});

test("source import classifies duplicate source IDs and content hashes", () => {
  const duplicateSourceId = {
    ...fixture,
    documents: [
      fixture.documents[0],
      { ...fixture.documents[1], source_id: fixture.documents[0].source_id },
    ],
  };
  const duplicateSourceIdResult = validateSourceImport(duplicateSourceId);

  assert.deepEqual(duplicateSourceIdResult.errors, [
    {
      code: SOURCE_IMPORT_VALIDATION_CODES.DUPLICATE_SOURCE_ID,
      path: "documents[1].source_id",
      message:
        "Duplicate source_id: value already appears at documents[0].source_id.",
    },
  ]);

  const duplicateContentHash = {
    ...fixture,
    documents: [
      fixture.documents[0],
      { ...fixture.documents[1], content_hash: fixture.documents[0].content_hash },
    ],
  };
  const duplicateContentHashResult = validateSourceImport(duplicateContentHash);

  assert.deepEqual(duplicateContentHashResult.errors, [
    {
      code: SOURCE_IMPORT_VALIDATION_CODES.DUPLICATE_CONTENT_HASH,
      path: "documents[1].content_hash",
      message:
        "Duplicate content_hash: value already appears at documents[0].content_hash.",
    },
  ]);
});

test("source document errors are prefixed and preserve version and rights classifications", () => {
  const invalid = {
    ...fixture,
    documents: [
      {
        ...fixture.documents[0],
        game_version: " ",
        rights_note: "",
      },
    ],
  };
  const before = JSON.parse(JSON.stringify(invalid));
  const result = validateSourceImport(invalid);

  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      {
        code: SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_GAME_VERSION,
        path: "documents[0].game_version",
      },
      {
        code: SOURCE_DOCUMENT_VALIDATION_CODES.INVALID_RIGHTS_NOTE,
        path: "documents[0].rights_note",
      },
    ],
  );
  assert.deepEqual(invalid, before);
  assert.throws(
    () => assertSourceImport(invalid),
    /documents\[0\]\.game_version: game_version must be a non-empty string/,
  );
});
