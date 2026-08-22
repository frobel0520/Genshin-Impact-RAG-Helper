import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  DEFAULT_QUERY_LOCALE,
  NORMALIZED_ENTITY_FIELDS,
  NORMALIZED_ENTITY_OPTIONAL_FIELDS,
  NORMALIZED_ENTITY_REQUIRED_FIELDS,
  QUERY_CONTRACT_SCHEMA,
  QUERY_CONTRACT_SCHEMA_VERSION,
  QUERY_CONTRACT_VALIDATION_CODES,
  QUERY_PLAN_FIELDS,
  QUERY_PLAN_REQUIRED_FIELDS,
  QUERY_REQUEST_FIELDS,
  QUERY_REQUEST_OPTIONAL_FIELDS,
  QUERY_REQUEST_REQUIRED_FIELDS,
  applyQueryRequestDefaults,
  assertNormalizedEntity,
  assertQueryPlan,
  assertQueryRequest,
  isNormalizedEntity,
  isQueryPlan,
  isQueryRequest,
  validateNormalizedEntity,
  validateQueryPlan,
  validateQueryRequest,
} from "../src/query/query-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/query-contract.json"), "utf8"),
);

test("QueryRequest and QueryPlan fixtures cover all supported routing modes", () => {
  assert.equal(fixture.schema_version, QUERY_CONTRACT_SCHEMA_VERSION);
  assert.equal(fixture.requests.length, 3);
  assert.equal(fixture.plans.length, 4);

  for (const request of fixture.requests) {
    assert.deepEqual(validateQueryRequest(request), { ok: true, value: request });
    assert.equal(isQueryRequest(request), true);
  }
  for (const plan of fixture.plans) {
    assert.deepEqual(validateQueryPlan(plan), { ok: true, value: plan });
    assert.equal(isQueryPlan(plan), true);
  }
});

test("query contract schema documents required, optional, and default fields", () => {
  assert.deepEqual(QUERY_CONTRACT_SCHEMA.queryRequest.required, QUERY_REQUEST_REQUIRED_FIELDS);
  assert.deepEqual(QUERY_CONTRACT_SCHEMA.queryRequest.optional, QUERY_REQUEST_OPTIONAL_FIELDS);
  assert.deepEqual(QUERY_CONTRACT_SCHEMA.queryRequest.defaults, { locale: DEFAULT_QUERY_LOCALE });
  assert.deepEqual(
    QUERY_CONTRACT_SCHEMA.normalizedEntity.required,
    NORMALIZED_ENTITY_REQUIRED_FIELDS,
  );
  assert.deepEqual(
    QUERY_CONTRACT_SCHEMA.normalizedEntity.optional,
    NORMALIZED_ENTITY_OPTIONAL_FIELDS,
  );
  assert.deepEqual(NORMALIZED_ENTITY_FIELDS, [
    ...NORMALIZED_ENTITY_REQUIRED_FIELDS,
    ...NORMALIZED_ENTITY_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(QUERY_CONTRACT_SCHEMA.queryPlan.required, QUERY_PLAN_REQUIRED_FIELDS);
  assert.deepEqual(QUERY_REQUEST_FIELDS, [
    ...QUERY_REQUEST_REQUIRED_FIELDS,
    ...QUERY_REQUEST_OPTIONAL_FIELDS,
  ]);
  assert.deepEqual(QUERY_PLAN_FIELDS, QUERY_PLAN_REQUIRED_FIELDS);
});

test("QueryRequest accepts null version inference and applies only the documented locale default", () => {
  const request = fixture.requests[2];
  const normalized = applyQueryRequestDefaults(request);

  assert.equal(normalized.locale, DEFAULT_QUERY_LOCALE);
  assert.equal(normalized.game_version, "unknown");
  assert.equal(Object.hasOwn(request, "locale"), false);
  assert.equal(Object.hasOwn(normalized, "locale"), true);
  assert.equal(applyQueryRequestDefaults(fixture.requests[0]).game_version, null);
  assert.equal(assertQueryRequest(normalized), normalized);
});

test("QueryRequest rejects empty text, malformed locale/version, and unknown spoiler values", () => {
  const invalid = {
    question: "   ",
    locale: " zh-TW",
    game_version: 5,
    spoiler_level: "all",
    request_id: "",
  };

  const result = validateQueryRequest(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_QUESTION, path: "question" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_LOCALE, path: "locale" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_GAME_VERSION, path: "game_version" },
      {
        code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_REQUEST_SPOILER_LEVEL,
        path: "spoiler_level",
      },
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_REQUEST_ID, path: "request_id" },
    ],
  );
});

test("normalized entities preserve unresolved text and validate typed identity when present", () => {
  const unresolved = fixture.plans[2].normalized_entities[0];
  assert.deepEqual(validateNormalizedEntity(unresolved), { ok: true, value: unresolved });
  assert.equal(unresolved.entity_id, null);
  assert.equal(unresolved.entity_type, null);

  const invalid = {
    ...fixture.plans[0].normalized_entities[0],
    entity_id: "src:not-an-entity",
    entity_type: "unknown_type",
    aliases_used: ["雷神", "雷神"],
    extra: true,
  };
  const result = validateNormalizedEntity(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: QUERY_CONTRACT_VALIDATION_CODES.UNKNOWN_FIELD, path: "extra" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_ID, path: "entity_id" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_TYPE, path: "entity_type" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.DUPLICATE_ALIAS, path: "aliases_used[1]" },
    ],
  );
});

test("QueryPlan validates categories, version constraints, retrieval modes, and spoiler levels", () => {
  const invalid = {
    ...fixture.plans[0],
    query_category: "guessing",
    normalized_entities: "not-an-array",
    version_constraint: "latest",
    retrieval_mode: "vector-db",
    spoiler_level: "all",
  };
  const result = validateQueryPlan(invalid);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_QUERY_CATEGORY, path: "query_category" },
      {
        code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_NORMALIZED_ENTITIES,
        path: "normalized_entities",
      },
      {
        code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_VERSION_CONSTRAINT,
        path: "version_constraint",
      },
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_RETRIEVAL_MODE, path: "retrieval_mode" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.INVALID_PLAN_SPOILER_LEVEL, path: "spoiler_level" },
    ],
  );
});

test("QueryPlan requires each routing field and rejects unknown fields", () => {
  const incomplete = { query_category: "structured", unexpected: true };
  const result = validateQueryPlan(incomplete);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map(({ code, path }) => ({ code, path })),
    [
      { code: QUERY_CONTRACT_VALIDATION_CODES.UNKNOWN_FIELD, path: "unexpected" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "normalized_entities" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "version_constraint" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "retrieval_mode" },
      { code: QUERY_CONTRACT_VALIDATION_CODES.MISSING_REQUIRED_FIELD, path: "spoiler_level" },
    ],
  );
});

test("query assertion helpers preserve identity and do not mutate input", () => {
  const request = structuredClone(fixture.requests[0]);
  const plan = structuredClone(fixture.plans[0]);
  const entity = structuredClone(plan.normalized_entities[0]);
  const before = {
    request: structuredClone(request),
    plan: structuredClone(plan),
    entity: structuredClone(entity),
  };

  assert.equal(assertQueryRequest(request), request);
  assert.equal(assertQueryPlan(plan), plan);
  assert.equal(assertNormalizedEntity(entity), entity);
  assert.deepEqual({ request, plan, entity }, before);
  assert.throws(
    () => applyQueryRequestDefaults({ question: "" }),
    /question: question must contain/,
  );
  assert.throws(() => assertQueryPlan({ ...plan, retrieval_mode: "bad" }), /retrieval_mode/);
});
