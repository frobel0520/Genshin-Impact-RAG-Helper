import assert from "node:assert/strict";
import test from "node:test";

import {
  isHttpUrl,
  isIsoDateTime,
  isJsonValue,
  isRecord,
  isStableString,
} from "../src/domain/contract-validation.js";

test("shared contract validation accepts only explicit boundary values", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord(Object.create(null)), true);
  assert.equal(isRecord(new Date()), false);
  assert.equal(isRecord(new Map()), false);

  assert.equal(isStableString("zh-TW"), true);
  assert.equal(isStableString(" zh-TW"), false);
  assert.equal(isHttpUrl("https://example.test/source"), true);
  assert.equal(isHttpUrl("ftp://example.test/source"), false);
  assert.equal(isIsoDateTime("2026-08-21T12:00:00Z"), true);
  assert.equal(isIsoDateTime("2026-02-31T12:00:00Z"), false);
});

test("shared JSON validation rejects cyclic and non-JSON objects", () => {
  const cyclic = {};
  cyclic.self = cyclic;

  assert.equal(isJsonValue({ nested: ["ok", 1, false, null] }), true);
  assert.equal(isJsonValue(cyclic), false);
  assert.equal(isJsonValue(new Date()), false);
  assert.equal(isJsonValue({ value: Number.POSITIVE_INFINITY }), false);
});
