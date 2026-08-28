import {
  ANSWER_STATUSES,
  QUERY_CATEGORIES,
  SPOILER_LEVELS,
  UNCERTAINTY_REASONS,
} from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";
import { assertAnswerResponse, assertEvidenceBundle } from "./evidence-answer-contract.js";

export const ANSWER_FORMATTER_RULESET_VERSION = 1;

const ANSWER_STATUS_VALUES = new Set(Object.values(ANSWER_STATUSES));
const QUERY_CATEGORY_VALUES = new Set(Object.values(QUERY_CATEGORIES));

const FORMAT_REQUEST_FIELDS = new Set([
  "queryPlan",
  "bundle",
  "refusalDecision",
  "policyDecision",
  "traceId",
  "answerText",
]);

const UNKNOWN_VERSION_SCOPE = "unknown";

/**
 * Deterministic zh-TW answer bodies.
 *
 * T08 EvidenceItem stores only record IDs and source metadata, never the fact
 * value or claim text, so the formatter cannot compose a natural-language
 * summary from evidence alone. It therefore emits a stable, auditable body and
 * lets a caller that has already resolved the content pass `answerText`.
 */
export const ANSWER_TEXT_TEMPLATES = Object.freeze({
  out_of_scope:
    "這個問題超出本助手的範疇：本助手只回答能以《原神》官方或可追溯來源佐證的事實性問題，不提供抽卡、養成或配裝建議。",
  entity_unknown: "無法在現有資料中辨識問題提到的對象，因此不提供回答，以免給出無來源的內容。",
  insufficient_evidence: "現有資料不足以回答這個問題，因此不提供回答，以免給出無來源的內容。",
  source_conflict:
    "不同來源對這個問題的說法互相衝突且無法判定，因此不提供單一答案；以下列出相衝突的來源供你自行判斷。",
  version_unknown:
    "以下內容的適用版本無法確認，請自行依來源時間判斷是否仍然適用；共 {count} 筆來源佐證。",
  answered: "依據 {count} 筆來源佐證回答，適用版本範圍：{version_scope}；詳細內容請見引用來源。",
  fallback: "本次查詢無法提供可佐證的回答。",
});

export const SPOILER_NOTICES = Object.freeze({
  [SPOILER_LEVELS.NOTICE]: "提醒：以下內容可能包含劇情透露。",
  [SPOILER_LEVELS.EXPLICIT]: "劇透警告：以下內容包含明確的劇情內容，你已選擇顯示。",
});

export const ANSWER_FORMATTER_RULES = Object.freeze({
  version: ANSWER_FORMATTER_RULESET_VERSION,
  statusSource: "refusal-scope-policy",
  citationsFromApplicableItemsOnly: true,
  refusedCarriesCitationsOnlyForSourceConflict: true,
  citationsDeduplicatedBySourceUrl: true,
  internalIdsNeverExposed: true,
});

/**
 * Project the policy decisions onto the public `AnswerResponse` contract.
 *
 * The formatter decides nothing about answerability: the status and reason come
 * from T19, the version scope and applicable evidence come from T18. It only
 * projects them, and it never leaks internal `evidence_id`/`source_id` — the
 * `trace_id` is the single handle back to the QueryRun and AnswerRun.
 *
 * @param {{
 *   queryPlan: object,
 *   bundle: object,
 *   refusalDecision: object,
 *   policyDecision?: object,
 *   traceId: string,
 *   answerText?: string,
 * }} request
 * @returns {object} a validated AnswerResponse
 */
export function formatAnswer(request) {
  const { queryPlan, bundle, refusalDecision, policyDecision, traceId, answerText } =
    validateRequest(request);

  const evidenceItems = policyDecision?.applicable_items ?? bundle.items;
  const citations = buildCitations(evidenceItems, refusalDecision);
  const versionScope = policyDecision?.version_scope ?? UNKNOWN_VERSION_SCOPE;
  const spoilerNotice = SPOILER_NOTICES[queryPlan.spoiler_level];

  return assertAnswerResponse({
    answer_status: refusalDecision.answer_status,
    answer_text:
      answerText ??
      buildAnswerText(refusalDecision, { count: evidenceItems.length, versionScope }),
    query_category: queryPlan.query_category,
    citations,
    version_scope: versionScope,
    ...(refusalDecision.uncertainty_reason === undefined
      ? {}
      : { uncertainty_reason: refusalDecision.uncertainty_reason }),
    ...(spoilerNotice === undefined ? {} : { spoiler_notice: spoilerNotice }),
    trace_id: traceId,
  });
}

/**
 * Create a reusable formatter with the same behaviour as the direct call.
 *
 * @returns {{ rulesetVersion: number, format: (request: object) => object }}
 */
export function createAnswerFormatter() {
  return Object.freeze({
    rulesetVersion: ANSWER_FORMATTER_RULESET_VERSION,
    format: formatAnswer,
  });
}

function validateRequest(request) {
  if (!isRecord(request)) {
    throw new TypeError("Answer formatter request must be a plain object.");
  }
  for (const field of Object.keys(request)) {
    if (!FORMAT_REQUEST_FIELDS.has(field)) {
      throw new TypeError(`Unknown answer formatter request field: ${field}.`);
    }
  }

  if (
    !isRecord(request.queryPlan) ||
    typeof request.queryPlan.query_category !== "string" ||
    !QUERY_CATEGORY_VALUES.has(request.queryPlan.query_category)
  ) {
    throw new TypeError("queryPlan must be a QueryPlan with a known query_category.");
  }

  const bundle = assertEvidenceBundle(request.bundle);

  if (!isRecord(request.refusalDecision)) {
    throw new TypeError("refusalDecision must be a plain object.");
  }
  if (
    typeof request.refusalDecision.answer_status !== "string" ||
    !ANSWER_STATUS_VALUES.has(request.refusalDecision.answer_status)
  ) {
    throw new TypeError("refusalDecision.answer_status must be a known answer status.");
  }
  if (request.refusalDecision.answer_status === ANSWER_STATUSES.ERROR) {
    throw new TypeError(
      "answer_status 'error' means a system failure and must not be produced by the formatter.",
    );
  }
  if (
    request.refusalDecision.query_id !== undefined &&
    request.refusalDecision.query_id !== bundle.query_id
  ) {
    throw new TypeError("refusalDecision.query_id must match the EvidenceBundle query_id.");
  }

  if (request.policyDecision !== undefined) {
    if (!isRecord(request.policyDecision)) {
      throw new TypeError("policyDecision must be a plain object when provided.");
    }
    if (!Array.isArray(request.policyDecision.applicable_items)) {
      throw new TypeError("policyDecision.applicable_items must be an array.");
    }
    if (request.policyDecision.query_id !== bundle.query_id) {
      throw new TypeError("policyDecision.query_id must match the EvidenceBundle query_id.");
    }
  }

  if (!isStableString(request.traceId)) {
    throw new TypeError("traceId must be a non-empty string without surrounding whitespace.");
  }
  if (request.answerText !== undefined && !isStableString(request.answerText)) {
    throw new TypeError("answerText must be a non-empty string when provided.");
  }

  return {
    queryPlan: request.queryPlan,
    bundle,
    refusalDecision: request.refusalDecision,
    policyDecision: request.policyDecision,
    traceId: request.traceId,
    answerText: request.answerText,
  };
}

/**
 * A refusal carries no citations, because there is no answer for them to
 * support. The single exception is an unresolved source conflict, where the
 * conflicting sources are the whole point of the refusal.
 */
function buildCitations(evidenceItems, refusalDecision) {
  if (
    refusalDecision.answer_status === ANSWER_STATUSES.REFUSED &&
    refusalDecision.uncertainty_reason !== UNCERTAINTY_REASONS.SOURCE_CONFLICT
  ) {
    return [];
  }

  const citations = [];
  const seenSourceUrls = new Set();
  for (const item of evidenceItems) {
    if (seenSourceUrls.has(item.source_url)) {
      continue;
    }
    seenSourceUrls.add(item.source_url);
    citations.push({
      source_url: item.source_url,
      title: item.source_title,
      source_kind: item.source_kind,
      ...(item.source_published_at === undefined
        ? {}
        : { published_at: item.source_published_at }),
      ...(item.source_retrieved_at === undefined
        ? {}
        : { retrieved_at: item.source_retrieved_at }),
      ...(item.game_version === undefined ? {} : { game_version: item.game_version }),
    });
  }
  return citations;
}

function buildAnswerText(refusalDecision, { count, versionScope }) {
  const template =
    refusalDecision.answer_status === ANSWER_STATUSES.ANSWERED
      ? ANSWER_TEXT_TEMPLATES.answered
      : (ANSWER_TEXT_TEMPLATES[refusalDecision.uncertainty_reason] ??
        ANSWER_TEXT_TEMPLATES.fallback);

  return template.replace("{count}", String(count)).replace("{version_scope}", versionScope);
}
