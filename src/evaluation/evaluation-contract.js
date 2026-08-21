import {
  ANSWERABILITY,
  ANSWER_STATUSES,
  ENTITY_TYPES,
  QUERY_CATEGORIES,
  SOURCE_KINDS,
  SPOILER_LEVELS,
  UNCERTAINTY_REASONS,
  isDomainId,
} from "../domain/domain-contract.js";
import {
  validateAnswerResponse,
  validateCitation,
  validateEvidenceItem,
} from "../policy/evidence-answer-contract.js";

export const EVALUATION_CONTRACT_SCHEMA_VERSION = 1;

export const EVAL_CATEGORIES = Object.freeze({
  CHARACTER: ENTITY_TYPES.CHARACTER,
  WEAPON: ENTITY_TYPES.WEAPON,
  MATERIAL: ENTITY_TYPES.MATERIAL,
  QUEST: ENTITY_TYPES.QUEST,
  REGION: ENTITY_TYPES.REGION,
  WORLD_LORE: ENTITY_TYPES.WORLD_LORE,
  VERSION: "version",
  COMPOSITE: "composite",
  OUT_OF_SCOPE: "out_of_scope",
});

export const EVAL_CASE_REQUIRED_FIELDS = Object.freeze([
  "case_id",
  "question_zh_tw",
  "category",
  "query_type",
  "answerability",
  "required_facts",
  "game_version",
  "spoiler_level",
]);

export const EVAL_CASE_OPTIONAL_FIELDS = Object.freeze([
  "expected_answer",
  "expected_sources",
  "refusal_reason",
  "notes",
]);

export const EVAL_CASE_FIELDS = Object.freeze([
  ...EVAL_CASE_REQUIRED_FIELDS,
  ...EVAL_CASE_OPTIONAL_FIELDS,
]);

export const EVAL_RESULT_REQUIRED_FIELDS = Object.freeze([
  "case_id",
  "run_id",
  "retrieved_evidence",
  "answer",
  "citations",
  "metric_labels",
  "human_review",
]);

export const EVAL_RESULT_OPTIONAL_FIELDS = Object.freeze([]);

export const EVAL_RESULT_FIELDS = Object.freeze([
  ...EVAL_RESULT_REQUIRED_FIELDS,
  ...EVAL_RESULT_OPTIONAL_FIELDS,
]);

export const EXPECTED_SOURCE_FIELDS = Object.freeze([
  "source_kind",
  "source_url",
]);

export const HUMAN_REVIEW_REQUIRED_FIELDS = Object.freeze(["status"]);

export const HUMAN_REVIEW_OPTIONAL_FIELDS = Object.freeze([
  "decision",
  "notes",
  "reviewed_at",
]);

export const HUMAN_REVIEW_FIELDS = Object.freeze([
  ...HUMAN_REVIEW_REQUIRED_FIELDS,
  ...HUMAN_REVIEW_OPTIONAL_FIELDS,
]);

export const EVAL_METRIC_KEYS = Object.freeze([
  "answer_correctness",
  "retrieval_recall_at_5",
  "groundedness",
  "correct_refusal",
  "citation_coverage",
]);

export const EVAL_METRIC_LABELS = Object.freeze({
  PASS: "pass",
  FAIL: "fail",
  NOT_APPLICABLE: "not_applicable",
  NOT_SCORED: "not_scored",
});

export const EVAL_METRIC_LABEL_VALUES = Object.freeze(Object.values(EVAL_METRIC_LABELS));

export const EVAL_METRIC_DEFINITIONS = Object.freeze({
  answer_correctness: Object.freeze({ target: 0.9, scope: "answerable" }),
  retrieval_recall_at_5: Object.freeze({ target: 0.9, scope: "all" }),
  groundedness: Object.freeze({ target: 0.95, scope: "answerable" }),
  correct_refusal: Object.freeze({ target: 0.9, scope: "refuse" }),
  citation_coverage: Object.freeze({ target: 1, scope: "non_refused" }),
});

export const HUMAN_REVIEW_STATUSES = Object.freeze({
  PENDING: "pending",
  REVIEWED: "reviewed",
});

export const HUMAN_REVIEW_DECISIONS = Object.freeze({
  ACCEPT: "accept",
  REJECT: "reject",
  NEEDS_REVIEW: "needs_review",
});

export const EVALUATION_VALIDATION_CODES = Object.freeze({
  INVALID_DOCUMENT: "invalid_document",
  MISSING_REQUIRED_FIELD: "missing_required_field",
  MISSING_CONDITIONAL_FIELD: "missing_conditional_field",
  UNKNOWN_FIELD: "unknown_field",
  INVALID_CASE_ID: "invalid_case_id",
  INVALID_RUN_ID: "invalid_run_id",
  INVALID_QUESTION: "invalid_question",
  INVALID_CATEGORY: "invalid_category",
  INVALID_QUERY_TYPE: "invalid_query_type",
  INVALID_ANSWERABILITY: "invalid_answerability",
  INVALID_REQUIRED_FACTS: "invalid_required_facts",
  INVALID_REQUIRED_FACT: "invalid_required_fact",
  INVALID_EXPECTED_ANSWER: "invalid_expected_answer",
  INVALID_EXPECTED_SOURCES: "invalid_expected_sources",
  INVALID_EXPECTED_SOURCE: "invalid_expected_source",
  INVALID_SOURCE_KIND: "invalid_source_kind",
  INVALID_SOURCE_URL: "invalid_source_url",
  INVALID_GAME_VERSION: "invalid_game_version",
  INVALID_REFUSAL_REASON: "invalid_refusal_reason",
  INVALID_SPOILER_LEVEL: "invalid_spoiler_level",
  INVALID_NOTES: "invalid_notes",
  INVALID_RETRIEVED_EVIDENCE: "invalid_retrieved_evidence",
  INVALID_EVIDENCE_REFERENCE: "invalid_evidence_reference",
  DUPLICATE_EVIDENCE_REFERENCE: "duplicate_evidence_reference",
  INVALID_ANSWER: "invalid_answer",
  INVALID_CITATIONS: "invalid_citations",
  ANSWERED_REQUIRES_CITATION: "answered_requires_citation",
  INVALID_METRIC_LABELS: "invalid_metric_labels",
  MISSING_METRIC_LABEL: "missing_metric_label",
  UNKNOWN_METRIC_LABEL: "unknown_metric_label",
  INVALID_METRIC_LABEL: "invalid_metric_label",
  INVALID_HUMAN_REVIEW: "invalid_human_review",
  INVALID_REVIEW_STATUS: "invalid_review_status",
  INVALID_REVIEW_DECISION: "invalid_review_decision",
  INVALID_REVIEWED_AT: "invalid_reviewed_at",
});

const EVAL_CATEGORY_VALUES = new Set(Object.values(EVAL_CATEGORIES));
const QUERY_TYPE_VALUES = new Set(Object.values(QUERY_CATEGORIES));
const ANSWERABILITY_VALUES = new Set(Object.values(ANSWERABILITY));
const SOURCE_KIND_VALUES = new Set(Object.values(SOURCE_KINDS));
const SPOILER_LEVEL_VALUES = new Set(Object.values(SPOILER_LEVELS));
const REFUSAL_REASON_VALUES = new Set(Object.values(UNCERTAINTY_REASONS));
const METRIC_KEY_SET = new Set(EVAL_METRIC_KEYS);
const METRIC_LABEL_VALUES = new Set(EVAL_METRIC_LABEL_VALUES);
const HUMAN_REVIEW_STATUS_VALUES = new Set(Object.values(HUMAN_REVIEW_STATUSES));
const HUMAN_REVIEW_DECISION_VALUES = new Set(Object.values(HUMAN_REVIEW_DECISIONS));
const EVAL_CASE_FIELD_SET = new Set(EVAL_CASE_FIELDS);
const EVAL_RESULT_FIELD_SET = new Set(EVAL_RESULT_FIELDS);
const EXPECTED_SOURCE_FIELD_SET = new Set(EXPECTED_SOURCE_FIELDS);
const HUMAN_REVIEW_FIELD_SET = new Set(HUMAN_REVIEW_FIELDS);
const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1\d):[0-5]\d)$/;

export const EVALUATION_CONTRACT_SCHEMA = Object.freeze({
  version: EVALUATION_CONTRACT_SCHEMA_VERSION,
  evalCase: Object.freeze({
    required: EVAL_CASE_REQUIRED_FIELDS,
    optional: EVAL_CASE_OPTIONAL_FIELDS,
    categoryValues: Object.freeze([...EVAL_CATEGORY_VALUES]),
    queryTypeValues: Object.freeze([...QUERY_TYPE_VALUES]),
    answerabilityValues: Object.freeze([...ANSWERABILITY_VALUES]),
    requiredFacts: "non-empty JSON-compatible entries for answerable cases; [] allowed for refusal cases",
    expectedAnswer: "JSON-compatible answer text or answer skeleton",
    expectedSources: "non-empty string or { source_kind?, source_url? }[] for answerable cases",
  }),
  evalResult: Object.freeze({
    required: EVAL_RESULT_REQUIRED_FIELDS,
    optional: EVAL_RESULT_OPTIONAL_FIELDS,
    retrievedEvidence: "evidence:<id>[] or EvidenceItem[]",
    metricLabels: EVAL_METRIC_KEYS,
    humanReview: Object.freeze({
      required: HUMAN_REVIEW_REQUIRED_FIELDS,
      optional: HUMAN_REVIEW_OPTIONAL_FIELDS,
    }),
  }),
  metrics: EVAL_METRIC_DEFINITIONS,
  metricLabels: EVAL_METRIC_LABEL_VALUES,
});

export function validateEvalCase(evalCase) {
  const errors = [];

  if (!isRecord(evalCase)) {
    return invalidDocumentResult("EvalCase must be a plain object.");
  }

  collectUnknownFields(evalCase, EVAL_CASE_FIELD_SET, errors);
  collectMissingFields(evalCase, EVAL_CASE_REQUIRED_FIELDS, errors);

  if (evalCase.case_id !== undefined && !isDomainId(evalCase.case_id, "case")) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_CASE_ID,
        "case_id",
        "case_id must be a typed case domain ID (case:<key>).",
      ),
    );
  }

  if (evalCase.question_zh_tw !== undefined && !isNonEmptyString(evalCase.question_zh_tw)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_QUESTION,
        "question_zh_tw",
        "question_zh_tw must contain non-whitespace Traditional Chinese question text.",
      ),
    );
  }

  if (
    evalCase.category !== undefined &&
    (typeof evalCase.category !== "string" || !EVAL_CATEGORY_VALUES.has(evalCase.category))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_CATEGORY,
        "category",
        `category must be one of: ${[...EVAL_CATEGORY_VALUES].join(", ")}.`,
      ),
    );
  }

  if (
    evalCase.query_type !== undefined &&
    (typeof evalCase.query_type !== "string" || !QUERY_TYPE_VALUES.has(evalCase.query_type))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_QUERY_TYPE,
        "query_type",
        `query_type must be one of: ${[...QUERY_TYPE_VALUES].join(", ")}.`,
      ),
    );
  }

  if (
    evalCase.answerability !== undefined &&
    (typeof evalCase.answerability !== "string" || !ANSWERABILITY_VALUES.has(evalCase.answerability))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_ANSWERABILITY,
        "answerability",
        `answerability must be one of: ${[...ANSWERABILITY_VALUES].join(", ")}.`,
      ),
    );
  }

  validateRequiredFacts(evalCase.required_facts, evalCase.answerability, errors);

  if (evalCase.expected_answer !== undefined && !isMeaningfulJsonValue(evalCase.expected_answer)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_EXPECTED_ANSWER,
        "expected_answer",
        "expected_answer must be a non-null JSON-compatible answer or answer skeleton.",
      ),
    );
  }

  if (evalCase.answerability === ANSWERABILITY.ANSWERABLE) {
    if (evalCase.expected_answer === undefined) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD,
          "expected_answer",
          "answerable EvalCase must include expected_answer.",
        ),
      );
    }
    if (evalCase.expected_sources === undefined) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD,
          "expected_sources",
          "answerable EvalCase must include expected_sources.",
        ),
      );
    }
  }

  if (evalCase.expected_sources !== undefined) {
    validateExpectedSources(evalCase.expected_sources, errors);
  }

  if (evalCase.answerability === ANSWERABILITY.REFUSE && evalCase.refusal_reason === undefined) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD,
        "refusal_reason",
        "refuse EvalCase must include refusal_reason.",
      ),
    );
  }

  if (
    evalCase.refusal_reason !== undefined &&
    (typeof evalCase.refusal_reason !== "string" || !REFUSAL_REASON_VALUES.has(evalCase.refusal_reason))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_REFUSAL_REASON,
        "refusal_reason",
        `refusal_reason must be one of: ${[...REFUSAL_REASON_VALUES].join(", ")}.`,
      ),
    );
  }

  if (evalCase.game_version !== undefined && !isStableString(evalCase.game_version)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_GAME_VERSION,
        "game_version",
        "game_version must be a non-empty string; use 'unknown' when unavailable.",
      ),
    );
  }

  if (
    evalCase.spoiler_level !== undefined &&
    (typeof evalCase.spoiler_level !== "string" || !SPOILER_LEVEL_VALUES.has(evalCase.spoiler_level))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_SPOILER_LEVEL,
        "spoiler_level",
        `spoiler_level must be one of: ${[...SPOILER_LEVEL_VALUES].join(", ")}.`,
      ),
    );
  }

  if (evalCase.notes !== undefined && !isNonEmptyString(evalCase.notes)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_NOTES,
        "notes",
        "notes must be a non-empty string when present.",
      ),
    );
  }

  return errors.length === 0 ? { ok: true, value: evalCase } : { ok: false, errors };
}

export function validateEvalResult(result) {
  const errors = [];

  if (!isRecord(result)) {
    return invalidDocumentResult("EvalResult must be a plain object.");
  }

  collectUnknownFields(result, EVAL_RESULT_FIELD_SET, errors);
  collectMissingFields(result, EVAL_RESULT_REQUIRED_FIELDS, errors);

  if (result.case_id !== undefined && !isDomainId(result.case_id, "case")) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_CASE_ID,
        "case_id",
        "case_id must be a typed case domain ID (case:<key>).",
      ),
    );
  }

  if (result.run_id !== undefined && !isDomainId(result.run_id, "run")) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_RUN_ID,
        "run_id",
        "run_id must be a typed run domain ID (run:<key>).",
      ),
    );
  }

  validateRetrievedEvidence(result.retrieved_evidence, errors);

  if (result.answer !== undefined) {
    const answerResult = validateAnswerResponse(result.answer);
    if (!answerResult.ok) {
      errors.push(...prefixErrors(answerResult.errors, "answer"));
    }
  }

  if (result.citations !== undefined) {
    if (!Array.isArray(result.citations)) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.INVALID_CITATIONS,
          "citations",
          "citations must be an array of Citation objects.",
        ),
      );
    } else {
      for (const [index, citation] of result.citations.entries()) {
        const citationResult = validateCitation(citation);
        if (!citationResult.ok) {
          errors.push(...prefixErrors(citationResult.errors, `citations[${index}]`));
        }
      }

      if (
        result.answer?.answer_status === ANSWER_STATUSES.ANSWERED &&
        result.citations.length === 0
      ) {
        errors.push(
          createError(
            EVALUATION_VALIDATION_CODES.ANSWERED_REQUIRES_CITATION,
            "citations",
            "answered EvalResult responses must include at least one citation.",
          ),
        );
      }
    }
  }

  errors.push(...validateMetricLabels(result.metric_labels));
  errors.push(...validateHumanReview(result.human_review));

  return errors.length === 0 ? { ok: true, value: result } : { ok: false, errors };
}

export function validateExpectedSources(sources, errors = []) {
  if (!Array.isArray(sources) || sources.length === 0) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_EXPECTED_SOURCES,
        "expected_sources",
        "expected_sources must be a non-empty array.",
      ),
    );
    return errors;
  }

  for (const [index, source] of sources.entries()) {
    const sourceErrors = validateExpectedSource(source);
    errors.push(...prefixErrors(sourceErrors, `expected_sources[${index}]`));
  }
  return errors;
}

export function validateExpectedSource(source) {
  const errors = [];

  if (isStableString(source)) {
    return errors;
  }

  if (!isRecord(source)) {
    return [
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_EXPECTED_SOURCE,
        "$",
        "expected source must be a non-empty string or source reference object.",
      ),
    ];
  }

  collectUnknownFields(source, EXPECTED_SOURCE_FIELD_SET, errors);

  if (source.source_kind === undefined && source.source_url === undefined) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_EXPECTED_SOURCE,
        "$",
        "expected source must include source_kind or source_url.",
      ),
    );
  }

  if (
    source.source_kind !== undefined &&
    (typeof source.source_kind !== "string" || !SOURCE_KIND_VALUES.has(source.source_kind))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_SOURCE_KIND,
        "source_kind",
        `source_kind must be one of: ${[...SOURCE_KIND_VALUES].join(", ")}.`,
      ),
    );
  }

  if (source.source_url !== undefined && !isHttpUrl(source.source_url)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_SOURCE_URL,
        "source_url",
        "source_url must be an absolute http or https URL.",
      ),
    );
  }

  return errors;
}

export function validateMetricLabels(labels) {
  const errors = [];

  if (!isRecord(labels)) {
    return [
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_METRIC_LABELS,
        "metric_labels",
        "metric_labels must be a plain object.",
      ),
    ];
  }

  for (const key of Object.keys(labels)) {
    if (!METRIC_KEY_SET.has(key)) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.UNKNOWN_METRIC_LABEL,
          `metric_labels.${key}`,
          `Unknown metric label key: ${key}.`,
        ),
      );
    }
  }

  for (const key of EVAL_METRIC_KEYS) {
    if (labels[key] === undefined) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.MISSING_METRIC_LABEL,
          `metric_labels.${key}`,
          `Metric label is missing: ${key}.`,
        ),
      );
    } else if (!METRIC_LABEL_VALUES.has(labels[key])) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.INVALID_METRIC_LABEL,
          `metric_labels.${key}`,
          `Metric label must be one of: ${EVAL_METRIC_LABEL_VALUES.join(", ")}.`,
        ),
      );
    }
  }

  return errors;
}

export function validateHumanReview(review) {
  const errors = [];

  if (!isRecord(review)) {
    return [
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_HUMAN_REVIEW,
        "human_review",
        "human_review must be a plain object.",
      ),
    ];
  }

  collectUnknownFields(review, HUMAN_REVIEW_FIELD_SET, errors);
  collectMissingFields(review, HUMAN_REVIEW_REQUIRED_FIELDS, errors);

  if (
    review.status !== undefined &&
    (typeof review.status !== "string" || !HUMAN_REVIEW_STATUS_VALUES.has(review.status))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_REVIEW_STATUS,
        "status",
        `human_review.status must be one of: ${[...HUMAN_REVIEW_STATUS_VALUES].join(", ")}.`,
      ),
    );
  }

  if (
    review.status === HUMAN_REVIEW_STATUSES.REVIEWED &&
    review.decision === undefined
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.MISSING_CONDITIONAL_FIELD,
        "decision",
        "reviewed human_review must include decision.",
      ),
    );
  }

  if (
    review.decision !== undefined &&
    (typeof review.decision !== "string" || !HUMAN_REVIEW_DECISION_VALUES.has(review.decision))
  ) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_REVIEW_DECISION,
        "decision",
        `decision must be one of: ${[...HUMAN_REVIEW_DECISION_VALUES].join(", ")}.`,
      ),
    );
  }

  if (review.notes !== undefined && !isNonEmptyString(review.notes)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_NOTES,
        "notes",
        "human_review.notes must be a non-empty string when present.",
      ),
    );
  }

  if (review.reviewed_at !== undefined && !isIsoDateTime(review.reviewed_at)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_REVIEWED_AT,
        "reviewed_at",
        "reviewed_at must be an ISO 8601 date-time with an explicit timezone.",
      ),
    );
  }

  return errors;
}

export function isEvalCase(evalCase) {
  return validateEvalCase(evalCase).ok;
}

export function isEvalResult(result) {
  return validateEvalResult(result).ok;
}

export function assertEvalCase(evalCase) {
  return assertValid(validateEvalCase(evalCase), "EvalCase");
}

export function assertEvalResult(result) {
  return assertValid(validateEvalResult(result), "EvalResult");
}

function validateRequiredFacts(requiredFacts, answerability, errors) {
  if (!Array.isArray(requiredFacts)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_REQUIRED_FACTS,
        "required_facts",
        "required_facts must be an array of JSON-compatible fact requirements.",
      ),
    );
    return;
  }

  if (answerability === ANSWERABILITY.ANSWERABLE && requiredFacts.length === 0) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_REQUIRED_FACTS,
        "required_facts",
        "answerable EvalCase required_facts must contain at least one requirement.",
      ),
    );
  }

  for (const [index, fact] of requiredFacts.entries()) {
    if (!isJsonValue(fact)) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.INVALID_REQUIRED_FACT,
          `required_facts[${index}]`,
          "required_facts entries must be JSON-compatible values.",
        ),
      );
    }
  }
}

function validateRetrievedEvidence(retrievedEvidence, errors) {
  if (!Array.isArray(retrievedEvidence)) {
    errors.push(
      createError(
        EVALUATION_VALIDATION_CODES.INVALID_RETRIEVED_EVIDENCE,
        "retrieved_evidence",
        "retrieved_evidence must be an array of typed evidence IDs or EvidenceItems.",
      ),
    );
    return;
  }

  const seenEvidenceIds = new Set();
  for (const [index, evidence] of retrievedEvidence.entries()) {
    let evidenceId;
    if (isDomainId(evidence, "evidence")) {
      evidenceId = evidence;
    } else if (isRecord(evidence)) {
      const evidenceResult = validateEvidenceItem(evidence);
      if (!evidenceResult.ok) {
        errors.push(...prefixErrors(evidenceResult.errors, `retrieved_evidence[${index}]`));
      }
      evidenceId = evidence.evidence_id;
    } else {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.INVALID_EVIDENCE_REFERENCE,
          `retrieved_evidence[${index}]`,
          "retrieved evidence must be a typed evidence ID or valid EvidenceItem.",
        ),
      );
    }

    if (evidenceId !== undefined) {
      if (seenEvidenceIds.has(evidenceId)) {
        errors.push(
          createError(
            EVALUATION_VALIDATION_CODES.DUPLICATE_EVIDENCE_REFERENCE,
            `retrieved_evidence[${index}]`,
            "retrieved_evidence references must be unique.",
          ),
        );
      }
      seenEvidenceIds.add(evidenceId);
    }
  }
}

function collectUnknownFields(value, allowedFields, errors) {
  for (const field of Object.keys(value)) {
    if (!allowedFields.has(field)) {
      errors.push(
        createError(
          EVALUATION_VALIDATION_CODES.UNKNOWN_FIELD,
          field,
          `Unknown evaluation contract field: ${field}.`,
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
          EVALUATION_VALIDATION_CODES.MISSING_REQUIRED_FIELD,
          field,
          `Required evaluation contract field is missing: ${field}.`,
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
      createError(EVALUATION_VALIDATION_CODES.INVALID_DOCUMENT, "$", message),
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

function isMeaningfulJsonValue(value) {
  return value !== null && isJsonValue(value);
}

function isJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  if (isRecord(value)) {
    return Object.values(value).every((entry) => isJsonValue(entry));
  }
  return false;
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
