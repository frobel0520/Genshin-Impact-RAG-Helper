import {
  ANSWERABILITY,
  ANSWER_STATUSES,
  QUERY_CATEGORIES,
  RETRIEVAL_MODES,
  UNCERTAINTY_REASONS,
} from "../domain/domain-contract.js";
import { isRecord } from "../domain/contract-validation.js";
import { assertEvidenceBundle } from "./evidence-answer-contract.js";

export const REFUSAL_SCOPE_POLICY_RULESET_VERSION = 2;

export const REFUSAL_RULES = Object.freeze([
  "out_of_scope",
  "entity_unknown",
  "insufficient_evidence",
  "source_conflict",
  "version_unknown",
  "policy_refused",
  "policy_uncertain",
]);

export const REFUSAL_SCOPE_POLICY_RULES = Object.freeze({
  version: REFUSAL_SCOPE_POLICY_RULESET_VERSION,
  precedence: REFUSAL_RULES,
  failClosed: true,
  evidenceRequiredToAnswer: true,
});

const POLICY_REQUEST_FIELDS = new Set(["queryPlan", "bundle", "policyDecision"]);
const UNCERTAINTY_REASON_VALUES = new Set(Object.values(UNCERTAINTY_REASONS));
const RESOLVED_STATUS = "resolved";

/**
 * Classify whether a query can be answered, and if not, why.
 *
 * The rules are evaluated in a fixed precedence so the same inputs always
 * produce the same refusal reason. Scope is checked before evidence, because a
 * question outside the MVP scope must be refused even when the index happens to
 * return something that looks relevant.
 *
 * @param {{ queryPlan: object, bundle: object, policyDecision?: object }} request
 * @returns {object} refusal decision consumed by the Answer Formatter (T20)
 */
export function evaluateRefusalScope(request) {
  const { queryPlan, bundle, policyDecision } = validateRequest(request);
  const evidenceItems = policyDecision?.applicable_items ?? bundle.items;
  const outcome = classify(queryPlan, evidenceItems, policyDecision);

  return {
    query_id: bundle.query_id,
    ruleset_version: REFUSAL_SCOPE_POLICY_RULESET_VERSION,
    answerability:
      outcome.answerStatus === ANSWER_STATUSES.REFUSED
        ? ANSWERABILITY.REFUSE
        : ANSWERABILITY.ANSWERABLE,
    answer_status: outcome.answerStatus,
    ...(outcome.uncertaintyReason === undefined
      ? {}
      : { uncertainty_reason: outcome.uncertaintyReason }),
    matched_rule: outcome.matchedRule,
    evidence_count: evidenceItems.length,
  };
}

/**
 * Create a reusable policy with the same behaviour as the direct call.
 *
 * @returns {{ rulesetVersion: number, evaluate: (request: object) => object }}
 */
export function createRefusalScopePolicy() {
  return Object.freeze({
    rulesetVersion: REFUSAL_SCOPE_POLICY_RULESET_VERSION,
    evaluate: evaluateRefusalScope,
  });
}

function validateRequest(request) {
  if (!isRecord(request)) {
    throw new TypeError("Refusal/scope policy request must be a plain object.");
  }
  for (const field of Object.keys(request)) {
    if (!POLICY_REQUEST_FIELDS.has(field)) {
      throw new TypeError(`Unknown refusal/scope policy request field: ${field}.`);
    }
  }
  if (!isRecord(request.queryPlan) || !Array.isArray(request.queryPlan.normalized_entities)) {
    throw new TypeError("queryPlan must be a QueryPlan with normalized_entities.");
  }
  const bundle = assertEvidenceBundle(request.bundle);
  if (request.policyDecision !== undefined) {
    if (!isRecord(request.policyDecision)) {
      throw new TypeError("policyDecision must be a plain object when provided.");
    }
    if (!Array.isArray(request.policyDecision.applicable_items)) {
      throw new TypeError("policyDecision.applicable_items must be an array.");
    }
    const reason = request.policyDecision.uncertainty_reason;
    if (reason !== undefined && !UNCERTAINTY_REASON_VALUES.has(reason)) {
      throw new TypeError(`Unknown policyDecision.uncertainty_reason: ${reason}.`);
    }
  }
  return {
    queryPlan: request.queryPlan,
    bundle,
    policyDecision: request.policyDecision,
  };
}

function classify(queryPlan, evidenceItems, policyDecision) {
  if (isOutOfScope(queryPlan)) {
    return refuse(UNCERTAINTY_REASONS.OUT_OF_SCOPE, "out_of_scope");
  }
  if (hasOnlyUnresolvedEntities(queryPlan)) {
    return refuse(UNCERTAINTY_REASONS.ENTITY_UNKNOWN, "entity_unknown");
  }
  if (evidenceItems.length === 0) {
    return refuse(UNCERTAINTY_REASONS.INSUFFICIENT_EVIDENCE, "insufficient_evidence");
  }
  if (policyDecision?.uncertainty_reason === UNCERTAINTY_REASONS.SOURCE_CONFLICT) {
    return refuse(UNCERTAINTY_REASONS.SOURCE_CONFLICT, "source_conflict");
  }
  if (policyDecision?.uncertainty_reason === UNCERTAINTY_REASONS.VERSION_UNKNOWN) {
    return {
      answerStatus: ANSWER_STATUSES.UNCERTAIN,
      uncertaintyReason: UNCERTAINTY_REASONS.VERSION_UNKNOWN,
      matchedRule: "version_unknown",
    };
  }
  // Fail closed on a reason this ruleset does not know: a conflict/version
  // decision the refusal rules cannot interpret must not be downgraded into an
  // answer just because it fell past every named rule.
  if (policyDecision?.answer_status === ANSWER_STATUSES.REFUSED) {
    return refuse(
      policyDecision.uncertainty_reason ?? UNCERTAINTY_REASONS.INSUFFICIENT_EVIDENCE,
      "policy_refused",
    );
  }
  if (policyDecision?.answer_status === ANSWER_STATUSES.UNCERTAIN) {
    return {
      answerStatus: ANSWER_STATUSES.UNCERTAIN,
      uncertaintyReason:
        policyDecision.uncertainty_reason ?? UNCERTAINTY_REASONS.VERSION_UNKNOWN,
      matchedRule: "policy_uncertain",
    };
  }
  return {
    answerStatus: ANSWER_STATUSES.ANSWERED,
    uncertaintyReason: undefined,
    matchedRule: null,
  };
}

function isOutOfScope(queryPlan) {
  return (
    queryPlan.query_category === QUERY_CATEGORIES.OUT_OF_SCOPE ||
    queryPlan.retrieval_mode === RETRIEVAL_MODES.NONE
  );
}

function hasOnlyUnresolvedEntities(queryPlan) {
  const entities = queryPlan.normalized_entities;
  return (
    entities.length > 0 &&
    entities.every((entity) => entity.resolution_status !== RESOLVED_STATUS)
  );
}

function refuse(uncertaintyReason, matchedRule) {
  return {
    answerStatus: ANSWER_STATUSES.REFUSED,
    uncertaintyReason,
    matchedRule,
  };
}
