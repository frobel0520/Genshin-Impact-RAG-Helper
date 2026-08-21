import {
  ANSWER_STATUSES,
  QUERY_CATEGORIES,
  SOURCE_KINDS,
  SUPPORT_TYPES,
  UNCERTAINTY_REASONS,
  isDomainId,
} from "../domain/domain-contract.js";

export const EVIDENCE_ANSWER_SCHEMA_VERSION = 1;

export const EVIDENCE_BUNDLE_REQUIRED_FIELDS = Object.freeze([
  "query_id",
  "items",
  "conflict_groups",
]);

export const EVIDENCE_BUNDLE_OPTIONAL_FIELDS = Object.freeze([]);

export const EVIDENCE_BUNDLE_FIELDS = Object.freeze([
  ...EVIDENCE_BUNDLE_REQUIRED_FIELDS,
  ...EVIDENCE_BUNDLE_OPTIONAL_FIELDS,
]);

export const EVIDENCE_ITEM_REQUIRED_FIELDS = Object.freeze([
  "evidence_id",
  "source_kind",
  "source_url",
  "source_title",
  "source_retrieved_at",
  "rank",
  "support_type",
]);

export const EVIDENCE_ITEM_OPTIONAL_FIELDS = Object.freeze([
  "source_published_at",
  "game_version",
  "fact_id",
  "claim_id",
  "chunk_id",
]);

export const EVIDENCE_ITEM_FIELDS = Object.freeze([
  ...EVIDENCE_ITEM_REQUIRED_FIELDS,
  ...EVIDENCE_ITEM_OPTIONAL_FIELDS,
]);

export const EVIDENCE_CONFLICT_GROUP_REQUIRED_FIELDS = Object.freeze([
  "conflict_group_id",
  "claim_ids",
]);

export const EVIDENCE_CONFLICT_GROUP_FIELDS = EVIDENCE_CONFLICT_GROUP_REQUIRED_FIELDS;

export const ANSWER_RESPONSE_REQUIRED_FIELDS = Object.freeze([
  "answer_status",
  "answer_text",
  "query_category",
  "citations",
  "version_scope",
  "trace_id",
]);

export const ANSWER_RESPONSE_OPTIONAL_FIELDS = Object.freeze([
  "uncertainty_reason",
  "spoiler_notice",
]);

export const ANSWER_RESPONSE_FIELDS = Object.freeze([
  ...ANSWER_RESPONSE_REQUIRED_FIELDS,
  ...ANSWER_RESPONSE_OPTIONAL_FIELDS,
]);

export const CITATION_REQUIRED_FIELDS = Object.freeze([
  "source_url",
  "title",
  "source_kind",
]);

export const CITATION_OPTIONAL_FIELDS = Object.freeze([
  "published_at",
  "retrieved_at",
  "game_version",
]);

export const CITATION_FIELDS = Object.freeze([
  ...CITATION_REQUIRED_FIELDS,
  ...CITATION_OPTIONAL_FIELDS,
]);

export const EVIDENCE_ANSWER_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_QUERY_ID: "invalid_query_id",
  INVALID_ITEMS: "invalid_items",
  INVALID_CONFLICT_GROUPS: "invalid_conflict_groups",
  INVALID_EVIDENCE_ID: "invalid_evidence_id",
  INVALID_SOURCE_KIND: "invalid_source_kind",
  INVALID_SOURCE_URL: "invalid_source_url",
  INVALID_SOURCE_TITLE: "invalid_source_title",
  INVALID_SOURCE_PUBLISHED_AT: "invalid_source_published_at",
  INVALID_SOURCE_RETRIEVED_AT: "invalid_source_retrieved_at",
  INVALID_GAME_VERSION: "invalid_game_version",
  INVALID_FACT_ID: "invalid_fact_id",
  INVALID_CLAIM_ID: "invalid_claim_id",
  INVALID_CHUNK_ID: "invalid_chunk_id",
  INVALID_RANK: "invalid_rank",
  INVALID_SUPPORT_TYPE: "invalid_support_type",
  DUPLICATE_EVIDENCE_ID: "duplicate_evidence_id",
  INVALID_CONFLICT_GROUP_ID: "invalid_conflict_group_id",
  INVALID_CLAIM_IDS: "invalid_claim_ids",
  DUPLICATE_CONFLICT_GROUP_ID: "duplicate_conflict_group_id",
  DUPLICATE_CLAIM_ID: "duplicate_claim_id",
  INVALID_ANSWER_STATUS: "invalid_answer_status",
  INVALID_ANSWER_TEXT: "invalid_answer_text",
  INVALID_QUERY_CATEGORY: "invalid_query_category",
  INVALID_CITATIONS: "invalid_citations",
  INVALID_VERSION_SCOPE: "invalid_version_scope",
  INVALID_UNCERTAINTY_REASON: "invalid_uncertainty_reason",
  INVALID_SPOILER_NOTICE: "invalid_spoiler_notice",
  INVALID_TRACE_ID: "invalid_trace_id",
  ANSWERED_REQUIRES_CITATION: "answered_requires_citation",
  REASON_REQUIRED: "reason_required",
  INVALID_CITATION_URL: "invalid_citation_url",
  INVALID_CITATION_TITLE: "invalid_citation_title",
  INVALID_CITATION_SOURCE_KIND: "invalid_citation_source_kind",
  INVALID_CITATION_PUBLISHED_AT: "invalid_citation_published_at",
  INVALID_CITATION_RETRIEVED_AT: "invalid_citation_retrieved_at",
  INVALID_CITATION_GAME_VERSION: "invalid_citation_game_version",
});

const ANSWER_STATUS_VALUES = new Set(Object.values(ANSWER_STATUSES));
const QUERY_CATEGORY_VALUES = new Set(Object.values(QUERY_CATEGORIES));
const SOURCE_KIND_VALUES = new Set(Object.values(SOURCE_KINDS));
const SUPPORT_TYPE_VALUES = new Set(Object.values(SUPPORT_TYPES));
const UNCERTAINTY_REASON_VALUES = new Set(Object.values(UNCERTAINTY_REASONS));
const EVIDENCE_BUNDLE_FIELD_SET = new Set(EVIDENCE_BUNDLE_FIELDS);
const EVIDENCE_ITEM_FIELD_SET = new Set(EVIDENCE_ITEM_FIELDS);
const EVIDENCE_CONFLICT_GROUP_FIELD_SET = new Set(EVIDENCE_CONFLICT_GROUP_FIELDS);
const ANSWER_RESPONSE_FIELD_SET = new Set(ANSWER_RESPONSE_FIELDS);
const CITATION_FIELD_SET = new Set(CITATION_FIELDS);
const CONFLICT_GROUP_ID_PATTERN = /^conflict:[a-z0-9][a-z0-9._-]*$/;
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1\d):[0-5]\d)$/;

export const EVIDENCE_ANSWER_SCHEMA = Object.freeze({
  version: EVIDENCE_ANSWER_SCHEMA_VERSION,
  evidenceBundle: Object.freeze({
    required: EVIDENCE_BUNDLE_REQUIRED_FIELDS,
    item: Object.freeze({
      required: EVIDENCE_ITEM_REQUIRED_FIELDS,
      optional: EVIDENCE_ITEM_OPTIONAL_FIELDS,
    }),
    conflictGroup: Object.freeze({
      required: EVIDENCE_CONFLICT_GROUP_REQUIRED_FIELDS,
      claimIds: "non-empty unique claim:<id>[]",
    }),
    invariants: Object.freeze({
      emptyItemsAllowed: true,
      evidenceIdsUnique: true,
      conflictGroupIdsUnique: true,
    }),
  }),
  answerResponse: Object.freeze({
    required: ANSWER_RESPONSE_REQUIRED_FIELDS,
    optional: ANSWER_RESPONSE_OPTIONAL_FIELDS,
    invariants: Object.freeze({
      answeredRequiresCitations: true,
      uncertainAndRefusedRequireReason: true,
      errorMeansSystemFailure: true,
    }),
  }),
  citation: Object.freeze({
    required: CITATION_REQUIRED_FIELDS,
    optional: CITATION_OPTIONAL_FIELDS,
  }),
});

/**
 * Validate a traceable set of retrieved evidence without requiring a real index.
 * Empty items are valid because refusal and insufficient-evidence paths still need
 * a bundle that can be linked to the query.
 */
export function validateEvidenceBundle(bundle) {
  const errors = [];

  if (!isRecord(bundle)) {
    return invalidDocumentResult("EvidenceBundle must be a plain object.");
  }

  collectUnknownFields(bundle, EVIDENCE_BUNDLE_FIELD_SET, errors);
  collectMissingFields(bundle, EVIDENCE_BUNDLE_REQUIRED_FIELDS, errors);

  if (bundle.query_id !== undefined && !isDomainId(bundle.query_id, "query")) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_QUERY_ID,
        "query_id",
        "query_id must be a typed query domain ID (qry:<key>).",
      ),
    );
  }

  if (bundle.items !== undefined) {
    if (!Array.isArray(bundle.items)) {
      errors.push(
        createError(
          EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_ITEMS,
          "items",
          "items must be an array of evidence items.",
        ),
      );
    } else {
      const seenEvidenceIds = new Set();
      for (const [index, item] of bundle.items.entries()) {
        const result = validateEvidenceItem(item);
        if (!result.ok) {
          errors.push(...prefixErrors(result.errors, `items[${index}]`));
        }

        if (isDomainId(item?.evidence_id, "evidence")) {
          if (seenEvidenceIds.has(item.evidence_id)) {
            errors.push(
              createError(
                EVIDENCE_ANSWER_VALIDATION_CODES.DUPLICATE_EVIDENCE_ID,
                `items[${index}].evidence_id`,
                "evidence_id values must be unique within an EvidenceBundle.",
              ),
            );
          }
          seenEvidenceIds.add(item.evidence_id);
        }
      }
    }
  }

  if (bundle.conflict_groups !== undefined) {
    if (!Array.isArray(bundle.conflict_groups)) {
      errors.push(
        createError(
          EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CONFLICT_GROUPS,
          "conflict_groups",
          "conflict_groups must be an array of conflict groups.",
        ),
      );
    } else {
      const seenConflictGroupIds = new Set();
      for (const [index, group] of bundle.conflict_groups.entries()) {
        const result = validateEvidenceConflictGroup(group);
        if (!result.ok) {
          errors.push(...prefixErrors(result.errors, `conflict_groups[${index}]`));
        }

        if (isConflictGroupId(group?.conflict_group_id)) {
          if (seenConflictGroupIds.has(group.conflict_group_id)) {
            errors.push(
              createError(
                EVIDENCE_ANSWER_VALIDATION_CODES.DUPLICATE_CONFLICT_GROUP_ID,
                `conflict_groups[${index}].conflict_group_id`,
                "conflict_group_id values must be unique within an EvidenceBundle.",
              ),
            );
          }
          seenConflictGroupIds.add(group.conflict_group_id);
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true, value: bundle } : { ok: false, errors };
}

export function validateEvidenceItem(item) {
  const errors = [];

  if (!isRecord(item)) {
    return invalidDocumentResult("Evidence item must be a plain object.");
  }

  collectUnknownFields(item, EVIDENCE_ITEM_FIELD_SET, errors);
  collectMissingFields(item, EVIDENCE_ITEM_REQUIRED_FIELDS, errors);

  if (item.evidence_id !== undefined && !isDomainId(item.evidence_id, "evidence")) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_EVIDENCE_ID,
        "evidence_id",
        "evidence_id must be a typed evidence domain ID (evd:<key>).",
      ),
    );
  }

  if (
    item.source_kind !== undefined &&
    (typeof item.source_kind !== "string" || !SOURCE_KIND_VALUES.has(item.source_kind))
  ) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_KIND,
        "source_kind",
        `source_kind must be one of: ${[...SOURCE_KIND_VALUES].join(", ")}.`,
      ),
    );
  }

  if (item.source_url !== undefined && !isHttpUrl(item.source_url)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_URL,
        "source_url",
        "source_url must be an absolute http or https URL.",
      ),
    );
  }

  if (item.source_title !== undefined && !isNonEmptyString(item.source_title)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_TITLE,
        "source_title",
        "source_title must be a non-empty string.",
      ),
    );
  }

  validateOptionalTimestamp(
    item,
    "source_published_at",
    EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_PUBLISHED_AT,
    errors,
  );
  validateRequiredTimestamp(
    item,
    "source_retrieved_at",
    EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SOURCE_RETRIEVED_AT,
    errors,
  );

  if (item.game_version !== undefined && !isStableString(item.game_version)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_GAME_VERSION,
        "game_version",
        "game_version must be a non-empty string when present; use 'unknown' when unavailable.",
      ),
    );
  }

  validateOptionalDomainId(
    item,
    "fact_id",
    "fact",
    EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_FACT_ID,
    "fact:<key>",
    errors,
  );
  validateOptionalDomainId(
    item,
    "claim_id",
    "claim",
    EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CLAIM_ID,
    "claim:<key>",
    errors,
  );
  validateOptionalDomainId(
    item,
    "chunk_id",
    "chunk",
    EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CHUNK_ID,
    "chunk:<key>",
    errors,
  );

  if (item.rank !== undefined && (!Number.isInteger(item.rank) || item.rank < 0)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_RANK,
        "rank",
        "rank must be a non-negative integer.",
      ),
    );
  }

  if (
    item.support_type !== undefined &&
    (typeof item.support_type !== "string" || !SUPPORT_TYPE_VALUES.has(item.support_type))
  ) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SUPPORT_TYPE,
        "support_type",
        `support_type must be one of: ${[...SUPPORT_TYPE_VALUES].join(", ")}.`,
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: item } : { ok: false, errors };
}

export function validateEvidenceConflictGroup(group) {
  const errors = [];

  if (!isRecord(group)) {
    return invalidDocumentResult("Evidence conflict group must be a plain object.");
  }

  collectUnknownFields(group, EVIDENCE_CONFLICT_GROUP_FIELD_SET, errors);
  collectMissingFields(group, EVIDENCE_CONFLICT_GROUP_REQUIRED_FIELDS, errors);

  if (group.conflict_group_id !== undefined && !isConflictGroupId(group.conflict_group_id)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CONFLICT_GROUP_ID,
        "conflict_group_id",
        "conflict_group_id must be conflict:<stable-key>.",
      ),
    );
  }

  if (group.claim_ids !== undefined) {
    if (!Array.isArray(group.claim_ids) || group.claim_ids.length === 0) {
      errors.push(
        createError(
          EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CLAIM_IDS,
          "claim_ids",
          "claim_ids must be a non-empty array of typed claim IDs.",
        ),
      );
    } else {
      const seenClaimIds = new Set();
      for (const [index, claimId] of group.claim_ids.entries()) {
        if (!isDomainId(claimId, "claim")) {
          errors.push(
            createError(
              EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CLAIM_ID,
              `claim_ids[${index}]`,
              "claim_ids entries must be typed claim domain IDs (claim:<key>).",
            ),
          );
        }
        if (seenClaimIds.has(claimId)) {
          errors.push(
            createError(
              EVIDENCE_ANSWER_VALIDATION_CODES.DUPLICATE_CLAIM_ID,
              `claim_ids[${index}]`,
              "claim_ids must be unique.",
            ),
          );
        }
        seenClaimIds.add(claimId);
      }
    }
  }

  return errors.length === 0 ? { ok: true, value: group } : { ok: false, errors };
}

export function validateAnswerResponse(response) {
  const errors = [];

  if (!isRecord(response)) {
    return invalidDocumentResult("AnswerResponse must be a plain object.");
  }

  collectUnknownFields(response, ANSWER_RESPONSE_FIELD_SET, errors);
  collectMissingFields(response, ANSWER_RESPONSE_REQUIRED_FIELDS, errors);

  if (
    response.answer_status !== undefined &&
    (typeof response.answer_status !== "string" || !ANSWER_STATUS_VALUES.has(response.answer_status))
  ) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_ANSWER_STATUS,
        "answer_status",
        `answer_status must be one of: ${[...ANSWER_STATUS_VALUES].join(", ")}.`,
      ),
    );
  }

  if (response.answer_text !== undefined && !isNonEmptyString(response.answer_text)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_ANSWER_TEXT,
        "answer_text",
        "answer_text must be a non-empty string.",
      ),
    );
  }

  if (
    response.query_category !== undefined &&
    (typeof response.query_category !== "string" || !QUERY_CATEGORY_VALUES.has(response.query_category))
  ) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_QUERY_CATEGORY,
        "query_category",
        `query_category must be one of: ${[...QUERY_CATEGORY_VALUES].join(", ")}.`,
      ),
    );
  }

  if (response.citations !== undefined) {
    if (!Array.isArray(response.citations)) {
      errors.push(
        createError(
          EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATIONS,
          "citations",
          "citations must be an array of citation objects.",
        ),
      );
    } else {
      for (const [index, citation] of response.citations.entries()) {
        const result = validateCitation(citation);
        if (!result.ok) {
          errors.push(...prefixErrors(result.errors, `citations[${index}]`));
        }
      }

      if (response.answer_status === ANSWER_STATUSES.ANSWERED && response.citations.length === 0) {
        errors.push(
          createError(
            EVIDENCE_ANSWER_VALIDATION_CODES.ANSWERED_REQUIRES_CITATION,
            "citations",
            "answered responses must include at least one citation.",
          ),
        );
      }
    }
  }

  if (response.version_scope !== undefined && !isStableString(response.version_scope)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_VERSION_SCOPE,
        "version_scope",
        "version_scope must be a non-empty string; use 'unknown' when unavailable.",
      ),
    );
  }

  if (
    response.uncertainty_reason !== undefined &&
    (typeof response.uncertainty_reason !== "string" ||
      !UNCERTAINTY_REASON_VALUES.has(response.uncertainty_reason))
  ) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_UNCERTAINTY_REASON,
        "uncertainty_reason",
        `uncertainty_reason must be one of: ${[...UNCERTAINTY_REASON_VALUES].join(", ")}.`,
      ),
    );
  }

  if (
    (response.answer_status === ANSWER_STATUSES.UNCERTAIN ||
      response.answer_status === ANSWER_STATUSES.REFUSED) &&
    response.uncertainty_reason === undefined
  ) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.REASON_REQUIRED,
        "uncertainty_reason",
        "uncertain and refused responses must include uncertainty_reason.",
      ),
    );
  }

  if (response.spoiler_notice !== undefined && !isNonEmptyString(response.spoiler_notice)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_SPOILER_NOTICE,
        "spoiler_notice",
        "spoiler_notice must be a non-empty string when present.",
      ),
    );
  }

  if (response.trace_id !== undefined && !isStableString(response.trace_id)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_TRACE_ID,
        "trace_id",
        "trace_id must be a non-empty string without surrounding whitespace.",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: response } : { ok: false, errors };
}

export function validateCitation(citation) {
  const errors = [];

  if (!isRecord(citation)) {
    return invalidDocumentResult("Citation must be a plain object.");
  }

  collectUnknownFields(citation, CITATION_FIELD_SET, errors);
  collectMissingFields(citation, CITATION_REQUIRED_FIELDS, errors);

  if (citation.source_url !== undefined && !isHttpUrl(citation.source_url)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_URL,
        "source_url",
        "source_url must be an absolute http or https URL.",
      ),
    );
  }

  if (citation.title !== undefined && !isNonEmptyString(citation.title)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_TITLE,
        "title",
        "title must be a non-empty string.",
      ),
    );
  }

  if (
    citation.source_kind !== undefined &&
    (typeof citation.source_kind !== "string" || !SOURCE_KIND_VALUES.has(citation.source_kind))
  ) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_SOURCE_KIND,
        "source_kind",
        `source_kind must be one of: ${[...SOURCE_KIND_VALUES].join(", ")}.`,
      ),
    );
  }

  validateOptionalTimestamp(
    citation,
    "published_at",
    EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_PUBLISHED_AT,
    errors,
  );
  validateOptionalTimestamp(
    citation,
    "retrieved_at",
    EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_RETRIEVED_AT,
    errors,
  );

  if (citation.game_version !== undefined && !isStableString(citation.game_version)) {
    errors.push(
      createError(
        EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_CITATION_GAME_VERSION,
        "game_version",
        "game_version must be a non-empty string when present; use 'unknown' when unavailable.",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: citation } : { ok: false, errors };
}

export function isEvidenceBundle(bundle) {
  return validateEvidenceBundle(bundle).ok;
}

export function isEvidenceItem(item) {
  return validateEvidenceItem(item).ok;
}

export function isEvidenceConflictGroup(group) {
  return validateEvidenceConflictGroup(group).ok;
}

export function isAnswerResponse(response) {
  return validateAnswerResponse(response).ok;
}

export function isCitation(citation) {
  return validateCitation(citation).ok;
}

export function assertEvidenceBundle(bundle) {
  return assertValid(validateEvidenceBundle(bundle), "EvidenceBundle");
}

export function assertEvidenceItem(item) {
  return assertValid(validateEvidenceItem(item), "Evidence item");
}

export function assertEvidenceConflictGroup(group) {
  return assertValid(validateEvidenceConflictGroup(group), "Evidence conflict group");
}

export function assertAnswerResponse(response) {
  return assertValid(validateAnswerResponse(response), "AnswerResponse");
}

export function assertCitation(citation) {
  return assertValid(validateCitation(citation), "Citation");
}

function validateOptionalDomainId(value, field, kind, code, description, errors) {
  if (value[field] !== undefined && !isDomainId(value[field], kind)) {
    errors.push(createError(code, field, `${field} must be a typed ${description} domain ID.`));
  }
}

function validateOptionalTimestamp(value, field, code, errors) {
  if (value[field] !== undefined && !isIsoDateTime(value[field])) {
    errors.push(
      createError(
        code,
        field,
        `${field} must be an ISO 8601 date-time with an explicit timezone.`,
      ),
    );
  }
}

function validateRequiredTimestamp(value, field, code, errors) {
  if (value[field] !== undefined && !isIsoDateTime(value[field])) {
    errors.push(
      createError(
        code,
        field,
        `${field} must be an ISO 8601 date-time with an explicit timezone.`,
      ),
    );
  }
}

function collectUnknownFields(value, allowedFields, errors) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      errors.push(
        createError(
          EVIDENCE_ANSWER_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown evidence/answer contract field: ${field}.`,
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
          EVIDENCE_ANSWER_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required evidence/answer contract field is missing: ${field}.`,
        ),
      );
    }
  }
}

function prefixErrors(errors, prefix) {
  return errors.map((error) => ({ ...error, path: `${prefix}.${error.path}` }));
}

function invalidDocumentResult(message) {
  return {
    ok: false,
    errors: [
      createError(EVIDENCE_ANSWER_VALIDATION_CODES.INVALID_DOCUMENT, "$", message),
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

function isHttpUrl(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDateTime(value) {
  if (typeof value !== "string" || !ISO_DATETIME_PATTERN.test(value)) {
    return false;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }

  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}

function isConflictGroupId(value) {
  return typeof value === "string" && CONFLICT_GROUP_ID_PATTERN.test(value);
}
