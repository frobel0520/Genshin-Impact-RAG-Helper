/**
 * View models for the query page.
 *
 * The UI may only show what the AnswerResponse says. It never rebuilds a source
 * link, never infers a version the answer did not state, and never turns a
 * refusal into an answer with a softer word: a player has to be able to trust
 * that what is on screen is what the helper could actually support.
 *
 * These functions are pure so the display rules can be tested without a browser.
 */

export const ANSWER_STATUS_LABELS = Object.freeze({
  answered: "已回答",
  uncertain: "不確定",
  refused: "拒答",
  error: "系統錯誤",
});

export const UNCERTAINTY_REASON_LABELS = Object.freeze({
  insufficient_evidence: "現有資料不足",
  source_conflict: "來源說法衝突且無法判定",
  version_unknown: "適用版本無法確認",
  out_of_scope: "超出本助手範疇",
  entity_unknown: "無法辨識問題中的對象",
});

export const SOURCE_KIND_LABELS = Object.freeze({
  hoyolab: "HoYoLAB 官方",
  "genshin-db": "genshin-db 資料庫",
  fandom: "Fandom Wiki",
});

export const DATASET_STATE_LABELS = Object.freeze({
  ready: "資料已就緒",
  missing: "尚未建立資料，請先執行 ingest build",
  corrupt: "索引與檢查碼不符，請重新建立索引",
});

const UNKNOWN_VERSION = "unknown";

/**
 * @param {unknown} payload an AnswerResponse
 * @returns {object} what the page should display
 */
export function describeAnswer(payload) {
  if (!isRecord(payload) || typeof payload.answer_status !== "string") {
    return describeError(payload);
  }

  return {
    kind: "answer",
    status: payload.answer_status,
    status_label: ANSWER_STATUS_LABELS[payload.answer_status] ?? payload.answer_status,
    // A refusal is a legitimate outcome, not a failure to hide or apologise for.
    is_refusal: payload.answer_status === "refused",
    text: typeof payload.answer_text === "string" ? payload.answer_text : "",
    reason_label:
      payload.uncertainty_reason === undefined
        ? undefined
        : (UNCERTAINTY_REASON_LABELS[payload.uncertainty_reason] ?? payload.uncertainty_reason),
    version_label: describeVersionScope(payload.version_scope),
    spoiler_notice: payload.spoiler_notice,
    citations: describeCitations(payload.citations),
    trace_id: payload.trace_id,
  };
}

/**
 * An unknown version scope is stated plainly rather than left blank: "we do not
 * know which version this applies to" is information the player needs.
 */
export function describeVersionScope(versionScope) {
  if (typeof versionScope !== "string" || versionScope.length === 0) {
    return "版本範圍：未提供";
  }
  return versionScope === UNKNOWN_VERSION ? "版本範圍：未知" : `版本範圍：${versionScope}`;
}

export function describeCitations(citations) {
  if (!Array.isArray(citations)) {
    return [];
  }
  return citations.filter(isRecord).map((citation) => ({
    // The URL is used exactly as given; the page never assembles one itself.
    url: citation.source_url,
    title: citation.title,
    kind_label: SOURCE_KIND_LABELS[citation.source_kind] ?? citation.source_kind,
    meta: [
      citation.game_version === undefined ? undefined : `版本 ${citation.game_version}`,
      citation.published_at === undefined ? undefined : `發布 ${toDateText(citation.published_at)}`,
      citation.retrieved_at === undefined ? undefined : `取得 ${toDateText(citation.retrieved_at)}`,
    ].filter((entry) => entry !== undefined),
  }));
}

/**
 * @param {unknown} payload the API error envelope, or anything unexpected
 * @returns {object}
 */
export function describeError(payload) {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  return {
    kind: "error",
    status: "error",
    status_label: ANSWER_STATUS_LABELS.error,
    code: error?.code ?? "internal_error",
    text: error?.message ?? "查詢沒有完成，請稍後再試。",
    details: Array.isArray(error?.details) ? error.details : [],
  };
}

/**
 * @param {unknown} payload a HealthResponse
 * @returns {object}
 */
export function describeHealth(payload) {
  if (!isRecord(payload) || !isRecord(payload.dataset)) {
    return { ready: false, label: "無法取得服務狀態", detail: "" };
  }

  const state = payload.dataset.state;
  const index = isRecord(payload.dataset.index) ? payload.dataset.index : {};
  const chunkCount = isRecord(index.counts) ? index.counts.documentChunks : undefined;

  return {
    ready: payload.status === "ok",
    label: DATASET_STATE_LABELS[state] ?? `資料狀態：${state}`,
    detail:
      payload.status === "ok" && typeof index.index_hash === "string"
        ? `索引 ${index.index_hash.slice(0, 12)}・${chunkCount ?? 0} 個切塊・${index.embedding_model ?? ""}`
        : "",
  };
}

function toDateText(value) {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
