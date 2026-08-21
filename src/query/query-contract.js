import {
  ENTITY_TYPES,
  QUERY_CATEGORIES,
  RETRIEVAL_MODES,
  SPOILER_LEVELS,
  VERSION_CONSTRAINTS,
  isDomainId,
} from "../domain/domain-contract.js";

export const QUERY_CONTRACT_SCHEMA_VERSION = 1;
export const DEFAULT_QUERY_LOCALE = "zh-TW";

export const QUERY_REQUEST_REQUIRED_FIELDS = Object.freeze(["question"]);

export const QUERY_REQUEST_OPTIONAL_FIELDS = Object.freeze([
  "locale",
  "game_version",
  "spoiler_level",
  "request_id",
]);

export const QUERY_REQUEST_FIELDS = Object.freeze([
  ...QUERY_REQUEST_REQUIRED_FIELDS,
  ...QUERY_REQUEST_OPTIONAL_FIELDS,
]);

export const NORMALIZED_ENTITY_REQUIRED_FIELDS = Object.freeze([
  "text",
  "aliases_used",
]);

export const NORMALIZED_ENTITY_OPTIONAL_FIELDS = Object.freeze([
  "entity_id",
  "entity_type",
]);

export const NORMALIZED_ENTITY_FIELDS = Object.freeze([
  ...NORMALIZED_ENTITY_REQUIRED_FIELDS,
  ...NORMALIZED_ENTITY_OPTIONAL_FIELDS,
]);

export const QUERY_PLAN_REQUIRED_FIELDS = Object.freeze([
  "query_category",
  "normalized_entities",
  "version_constraint",
  "retrieval_mode",
  "spoiler_level",
]);

export const QUERY_PLAN_FIELDS = QUERY_PLAN_REQUIRED_FIELDS;

export const QUERY_CONTRACT_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_QUESTION: "invalid_question",
  INVALID_LOCALE: "invalid_locale",
  INVALID_GAME_VERSION: "invalid_game_version",
  INVALID_REQUEST_SPOILER_LEVEL: "invalid_request_spoiler_level",
  INVALID_REQUEST_ID: "invalid_request_id",
  INVALID_QUERY_CATEGORY: "invalid_query_category",
  INVALID_NORMALIZED_ENTITIES: "invalid_normalized_entities",
  INVALID_ENTITY_TEXT: "invalid_entity_text",
  INVALID_ENTITY_ID: "invalid_entity_id",
  INVALID_ENTITY_TYPE: "invalid_entity_type",
  INVALID_ALIASES_USED: "invalid_aliases_used",
  INVALID_ALIAS: "invalid_alias",
  DUPLICATE_ALIAS: "duplicate_alias",
  INVALID_VERSION_CONSTRAINT: "invalid_version_constraint",
  INVALID_RETRIEVAL_MODE: "invalid_retrieval_mode",
  INVALID_PLAN_SPOILER_LEVEL: "invalid_plan_spoiler_level",
});

export const QUERY_CONTRACT_SCHEMA = Object.freeze({
  version: QUERY_CONTRACT_SCHEMA_VERSION,
  queryRequest: Object.freeze({
    required: QUERY_REQUEST_REQUIRED_FIELDS,
    optional: QUERY_REQUEST_OPTIONAL_FIELDS,
    defaults: Object.freeze({ locale: DEFAULT_QUERY_LOCALE }),
  }),
  normalizedEntity: Object.freeze({
    required: NORMALIZED_ENTITY_REQUIRED_FIELDS,
    optional: NORMALIZED_ENTITY_OPTIONAL_FIELDS,
    unresolved: "entity_id and entity_type may be absent or null",
  }),
  queryPlan: Object.freeze({
    required: QUERY_PLAN_REQUIRED_FIELDS,
  }),
});

const QUERY_REQUEST_FIELD_SET = new Set(QUERY_REQUEST_FIELDS);
const NORMALIZED_ENTITY_FIELD_SET = new Set(NORMALIZED_ENTITY_FIELDS);
const QUERY_PLAN_FIELD_SET = new Set(QUERY_PLAN_FIELDS);
const QUERY_CATEGORY_VALUES = new Set(Object.values(QUERY_CATEGORIES));
const ENTITY_TYPE_VALUES = new Set(Object.values(ENTITY_TYPES));
const VERSION_CONSTRAINT_VALUES = new Set(Object.values(VERSION_CONSTRAINTS));
const RETRIEVAL_MODE_VALUES = new Set(Object.values(RETRIEVAL_MODES));
const SPOILER_LEVEL_VALUES = new Set(Object.values(SPOILER_LEVELS));

export function validateQueryRequest(request) {
  const errors = [];

  if (!isRecord(request)) {
    return invalidDocumentResult("QueryRequest must be a plain object.");
  }

  collectUnknownFields(request, QUERY_REQUEST_FIELD_SET, errors);
  collectMissingFields(request, QUERY_REQUEST_REQUIRED_FIELDS, errors);

  if (request.question !== undefined && !isNonEmptyString(request.question)) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_QUESTION,
        "question",
        "question must contain non-whitespace user text.",
      ),
    );
  }

  if (request.locale !== undefined && !isStableString(request.locale)) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_LOCALE,
        "locale",
        "locale must be a non-empty language/region string without surrounding whitespace.",
      ),
    );
  }

  if (
    request.game_version !== undefined &&
    request.game_version !== null &&
    !isStableString(request.game_version)
  ) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_GAME_VERSION,
        "game_version",
        "game_version must be null or a non-empty string; null means the system may infer it.",
      ),
    );
  }

  if (
    request.spoiler_level !== undefined &&
    (typeof request.spoiler_level !== "string" || !SPOILER_LEVEL_VALUES.has(request.spoiler_level))
  ) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_REQUEST_SPOILER_LEVEL,
        "spoiler_level",
        `spoiler_level must be one of: ${[...SPOILER_LEVEL_VALUES].join(", ")}.`,
      ),
    );
  }

  if (request.request_id !== undefined && !isStableString(request.request_id)) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_REQUEST_ID,
        "request_id",
        "request_id must be a non-empty stable string when present.",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: request } : { ok: false, errors };
}

export function validateNormalizedEntity(entity) {
  const errors = [];

  if (!isRecord(entity)) {
    return invalidDocumentResult("Normalized entity must be a plain object.");
  }

  collectUnknownFields(entity, NORMALIZED_ENTITY_FIELD_SET, errors);
  collectMissingFields(entity, NORMALIZED_ENTITY_REQUIRED_FIELDS, errors);

  if (entity.text !== undefined && !isNonEmptyString(entity.text)) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_TEXT,
        "text",
        "text must contain non-whitespace entity text.",
      ),
    );
  }

  if (entity.entity_id !== undefined && entity.entity_id !== null) {
    if (!isDomainId(entity.entity_id, "entity")) {
      errors.push(
        createError(
          QUERY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_ID,
          "entity_id",
          "entity_id must be a typed entity domain ID (ent:<key>).",
        ),
      );
    }
  }

  if (
    entity.entity_type !== undefined &&
    entity.entity_type !== null &&
    (typeof entity.entity_type !== "string" || !ENTITY_TYPE_VALUES.has(entity.entity_type))
  ) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_ENTITY_TYPE,
        "entity_type",
        `entity_type must be one of: ${[...ENTITY_TYPE_VALUES].join(", ")}.`,
      ),
    );
  }

  if (entity.aliases_used !== undefined) {
    errors.push(...validateAliasesUsed(entity.aliases_used));
  }

  return errors.length === 0 ? { ok: true, value: entity } : { ok: false, errors };
}

export function validateQueryPlan(plan) {
  const errors = [];

  if (!isRecord(plan)) {
    return invalidDocumentResult("QueryPlan must be a plain object.");
  }

  collectUnknownFields(plan, QUERY_PLAN_FIELD_SET, errors);
  collectMissingFields(plan, QUERY_PLAN_REQUIRED_FIELDS, errors);

  if (
    plan.query_category !== undefined &&
    (typeof plan.query_category !== "string" || !QUERY_CATEGORY_VALUES.has(plan.query_category))
  ) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_QUERY_CATEGORY,
        "query_category",
        `query_category must be one of: ${[...QUERY_CATEGORY_VALUES].join(", ")}.`,
      ),
    );
  }

  if (plan.normalized_entities !== undefined) {
    if (!Array.isArray(plan.normalized_entities)) {
      errors.push(
        createError(
          QUERY_CONTRACT_VALIDATION_CODES.INVALID_NORMALIZED_ENTITIES,
          "normalized_entities",
          "normalized_entities must be an array.",
        ),
      );
    } else {
      for (const [index, entity] of plan.normalized_entities.entries()) {
        const result = validateNormalizedEntity(entity);
        if (!result.ok) {
          errors.push(
            ...result.errors.map((error) => ({
              ...error,
              path: `normalized_entities[${index}].${error.path}`,
            })),
          );
        }
      }
    }
  }

  if (
    plan.version_constraint !== undefined &&
    (typeof plan.version_constraint !== "string" ||
      !VERSION_CONSTRAINT_VALUES.has(plan.version_constraint))
  ) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_VERSION_CONSTRAINT,
        "version_constraint",
        `version_constraint must be one of: ${[...VERSION_CONSTRAINT_VALUES].join(", ")}.`,
      ),
    );
  }

  if (
    plan.retrieval_mode !== undefined &&
    (typeof plan.retrieval_mode !== "string" || !RETRIEVAL_MODE_VALUES.has(plan.retrieval_mode))
  ) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_RETRIEVAL_MODE,
        "retrieval_mode",
        `retrieval_mode must be one of: ${[...RETRIEVAL_MODE_VALUES].join(", ")}.`,
      ),
    );
  }

  if (
    plan.spoiler_level !== undefined &&
    (typeof plan.spoiler_level !== "string" || !SPOILER_LEVEL_VALUES.has(plan.spoiler_level))
  ) {
    errors.push(
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_PLAN_SPOILER_LEVEL,
        "spoiler_level",
        `spoiler_level must be one of: ${[...SPOILER_LEVEL_VALUES].join(", ")}.`,
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: plan } : { ok: false, errors };
}

export function applyQueryRequestDefaults(request) {
  const result = validateQueryRequest(request);
  if (!result.ok) {
    const message = result.errors.map(({ path, message: detail }) => `${path}: ${detail}`).join(" ");
    throw new TypeError(`Invalid QueryRequest. ${message}`);
  }

  return {
    ...result.value,
    locale: result.value.locale ?? DEFAULT_QUERY_LOCALE,
  };
}

export function isQueryRequest(request) {
  return validateQueryRequest(request).ok;
}

export function isNormalizedEntity(entity) {
  return validateNormalizedEntity(entity).ok;
}

export function isQueryPlan(plan) {
  return validateQueryPlan(plan).ok;
}

export function assertQueryRequest(request) {
  return assertValid(validateQueryRequest(request), "QueryRequest");
}

export function assertNormalizedEntity(entity) {
  return assertValid(validateNormalizedEntity(entity), "Normalized entity");
}

export function assertQueryPlan(plan) {
  return assertValid(validateQueryPlan(plan), "QueryPlan");
}

function validateAliasesUsed(aliasesUsed) {
  if (!Array.isArray(aliasesUsed)) {
    return [
      createError(
        QUERY_CONTRACT_VALIDATION_CODES.INVALID_ALIASES_USED,
        "aliases_used",
        "aliases_used must be an array of strings.",
      ),
    ];
  }

  const errors = [];
  const seen = new Set();
  for (const [index, alias] of aliasesUsed.entries()) {
    if (!isNonEmptyString(alias)) {
      errors.push(
        createError(
          QUERY_CONTRACT_VALIDATION_CODES.INVALID_ALIAS,
          `aliases_used[${index}]`,
          "aliases_used entries must contain non-whitespace text.",
        ),
      );
      continue;
    }

    const comparable = alias.toLowerCase();
    if (seen.has(comparable)) {
      errors.push(
        createError(
          QUERY_CONTRACT_VALIDATION_CODES.DUPLICATE_ALIAS,
          `aliases_used[${index}]`,
          "aliases_used must be unique without case differences.",
        ),
      );
    }
    seen.add(comparable);
  }
  return errors;
}

function collectUnknownFields(value, allowedFields, errors) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      errors.push(
        createError(
          QUERY_CONTRACT_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown query contract field: ${field}.`,
        ),
      );
    }
  }
}

function collectMissingFields(value, fields, errors) {
  for (const field of fields) {
    if (value[field] === undefined) {
      errors.push(
        createError(
          QUERY_CONTRACT_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required query contract field is missing: ${field}.`,
        ),
      );
    }
  }
}

function invalidDocumentResult(message) {
  return {
    ok: false,
    errors: [
      createError(QUERY_CONTRACT_VALIDATION_CODES.INVALID_DOCUMENT, "$", message),
    ],
  };
}

function assertValid(result, label) {
  if (!result.ok) {
    const message = result.errors.map(({ path, message: detail }) => `${path}: ${detail}`).join(" ");
    throw new TypeError(`Invalid ${label}. ${message}`);
  }
  return result.value;
}

function createError(code, path, message) {
  return { code, path, message };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStableString(value) {
  return isNonEmptyString(value) && value.trim() === value;
}
