/**
 * Query and evaluation logging.
 *
 * This module imports nothing: a logging adapter that depended on the modules
 * it observes could break the request it is only supposed to record. It takes
 * plain objects, redacts, and writes.
 *
 * Two rules hold for every record. Everything a run produced must be findable
 * from one `trace_id`, so an answer can be traced back to the plan and the
 * evidence behind it. And nothing secret is written: keys that look like
 * credentials are replaced rather than serialized, because a local log file is
 * the easiest place for a secret to end up and the last place anyone looks.
 */

export const RUN_LOG_SCHEMA_VERSION = 1;

export const RUN_LOG_EVENTS = Object.freeze({
  QUERY_RUN: "query_run",
  ANSWER_RUN: "answer_run",
  EVIDENCE: "evidence",
  EVAL_RESULT: "eval_result",
  REQUEST_REJECTED: "request_rejected",
  FAILURE: "failure",
  RETRIEVAL_FILTERED: "retrieval_filtered",
});

export const REDACTED = "[redacted]";

/**
 * Key names whose values are never written, at any depth.
 */
export const SECRET_KEY_PATTERN =
  /(?:^|_|-)(?:token|secret|password|passwd|credential|cookie|session)(?:$|_|-)|api[-_]?key|authorization|bearer/i;

const MAX_TEXT_LENGTH = 500;
const LOGGER_OPTION_FIELDS = new Set(["write", "now", "maxTextLength"]);

/**
 * Create a run logger.
 *
 * @param {{ write: (record: object) => void, now?: () => Date, maxTextLength?: number }} options
 * @returns {{
 *   logQueryRun: (entry: object) => object,
 *   logAnswerRun: (entry: object) => object,
 *   logEvidence: (entry: object) => object,
 *   logRetrievalFiltered: (entry: object) => object,
 *   logEvalResult: (entry: object) => object,
 *   getFailureCount: () => number,
 * }}
 */
export function createRunLogger(options) {
  const { write, now, maxTextLength } = validateOptions(options);
  let failureCount = 0;

  function emit(event, record) {
    const entry = {
      schema_version: RUN_LOG_SCHEMA_VERSION,
      event,
      logged_at: now().toISOString(),
      ...record,
    };
    try {
      write(entry);
    } catch {
      // A failed write must never fail the query it was recording; the count is
      // there so a silent logging outage is still visible.
      failureCount += 1;
    }
    return entry;
  }

  return Object.freeze({
    /**
     * The question as asked and the plan it produced, before any retrieval.
     */
    logQueryRun({ traceId, queryId, request, queryPlan }) {
      return emit(RUN_LOG_EVENTS.QUERY_RUN, {
        trace_id: requireTraceId(traceId),
        query_id: queryId,
        question: clip(request?.question, maxTextLength),
        locale: request?.locale,
        requested_game_version: request?.game_version,
        spoiler_level: queryPlan?.spoiler_level ?? request?.spoiler_level,
        query_category: queryPlan?.query_category,
        retrieval_mode: queryPlan?.retrieval_mode,
        version_constraint: queryPlan?.version_constraint,
        resolved_entities: resolvedEntityIds(queryPlan),
        unresolved_mentions: unresolvedMentions(queryPlan),
      });
    },

    /**
     * What the evidence supported, by ID: enough to re-read the records, not a
     * second copy of the source material.
     */
    logEvidence({ traceId, queryId, bundle, policyDecision }) {
      const items = Array.isArray(bundle?.items) ? bundle.items : [];
      return emit(RUN_LOG_EVENTS.EVIDENCE, {
        trace_id: requireTraceId(traceId),
        query_id: queryId,
        evidence_ids: items.map((item) => item?.evidence_id),
        source_ids: [...new Set(items.map((item) => item?.source_id))],
        conflict_group_ids: (bundle?.conflict_groups ?? []).map(
          (group) => group?.conflict_group_id,
        ),
        applicable_count: policyDecision?.applicable_items?.length,
        excluded: (policyDecision?.excluded_items ?? []).map((entry) => ({
          evidence_id: entry?.evidence_id,
          reason: entry?.reason,
        })),
        version_scope: policyDecision?.version_scope,
      });
    },

    /**
     * The answer as the player received it, linked to the plan and evidence by
     * the same trace.
     */
    logAnswerRun({ traceId, queryId, answer, refusalDecision }) {
      return emit(RUN_LOG_EVENTS.ANSWER_RUN, {
        trace_id: requireTraceId(traceId),
        query_id: queryId,
        answer_status: answer?.answer_status,
        uncertainty_reason: answer?.uncertainty_reason,
        matched_rule: refusalDecision?.matched_rule,
        query_category: answer?.query_category,
        version_scope: answer?.version_scope,
        citation_count: answer?.citations?.length,
        citation_urls: (answer?.citations ?? []).map((citation) => citation?.source_url),
        answer_text: clip(answer?.answer_text, maxTextLength),
      });
    },

    /**
     * A request refused before it became a query: still traced, because a
     * caller holding the trace from an error response has to find something.
     */
    logRequestRejected({ traceId, statusCode, code, message }) {
      return emit(RUN_LOG_EVENTS.REQUEST_REJECTED, {
        trace_id: requireTraceId(traceId),
        status_code: statusCode,
        code,
        message: clip(message, maxTextLength),
      });
    },

    /**
     * A system failure. The internal message is recorded here and never sent to
     * the player, who gets the code and the trace instead.
     */
    logFailure({ traceId, queryId, code, message }) {
      return emit(RUN_LOG_EVENTS.FAILURE, {
        trace_id: requireTraceId(traceId),
        query_id: queryId,
        code,
        message: clip(message, maxTextLength),
      });
    },

    /**
     * Evidence the similarity floor removed. This is normal operation, not a
     * failure — it is what a correct refusal looks like from the inside — so it
     * is recorded under its own event and never counted as one.
     */
    logRetrievalFiltered({ traceId, queryId, considered, kept, bestScore, minScore }) {
      return emit(RUN_LOG_EVENTS.RETRIEVAL_FILTERED, {
        trace_id: requireTraceId(traceId),
        query_id: queryId,
        considered,
        kept,
        best_score: bestScore,
        min_score: minScore,
      });
    },

    logEvalResult({ runId, result }) {
      return emit(RUN_LOG_EVENTS.EVAL_RESULT, {
        // An evaluation is traced by its run, and each case by the answer's own
        // trace, so a metric can always be taken back to the answer behind it.
        trace_id: requireTraceId(result?.answer?.trace_id ?? runId),
        run_id: runId,
        case_id: result?.case_id,
        answer_status: result?.answer?.answer_status,
        uncertainty_reason: result?.answer?.uncertainty_reason,
        metric_labels: result?.metric_labels,
        citation_count: result?.citations?.length,
        human_review_status: result?.human_review?.status,
      });
    },

    getFailureCount: () => failureCount,
  });
}

/**
 * Create a logger that writes one JSON object per line.
 *
 * @param {{ write: (line: string) => void, now?: () => Date }} options
 * @returns {ReturnType<typeof createRunLogger>}
 */
export function createJsonLineLogger(options) {
  if (options === null || typeof options !== "object" || typeof options.write !== "function") {
    throw new TypeError("write must be a function taking a line of text.");
  }
  const { write, ...rest } = options;
  return createRunLogger({
    ...rest,
    write: (record) => write(`${JSON.stringify(redact(record))}\n`),
  });
}

/**
 * Replace secret-looking values and drop what cannot be serialized.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function redact(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object" && value !== null) {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined || typeof entry === "function") {
        continue;
      }
      output[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(entry);
    }
    return output;
  }
  if (typeof value === "bigint" || typeof value === "symbol") {
    return String(value);
  }
  return value;
}

function resolvedEntityIds(queryPlan) {
  return (queryPlan?.normalized_entities ?? [])
    .filter((entity) => entity?.resolution_status === "resolved")
    .map((entity) => entity.entity_id);
}

function unresolvedMentions(queryPlan) {
  return (queryPlan?.normalized_entities ?? [])
    .filter((entity) => entity?.resolution_status !== "resolved")
    .map((entity) => entity?.text);
}

function clip(text, maxLength) {
  if (typeof text !== "string") {
    return undefined;
  }
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function requireTraceId(traceId) {
  if (typeof traceId !== "string" || traceId.trim().length === 0) {
    throw new TypeError("trace_id is required: a record nothing can be traced from is not a log.");
  }
  return traceId;
}

function validateOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Run logger options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!LOGGER_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown run logger option: ${field}.`);
    }
  }
  if (typeof options.write !== "function") {
    throw new TypeError("write must be a function taking a record.");
  }
  if (options.now !== undefined && typeof options.now !== "function") {
    throw new TypeError("now must be a function returning a Date.");
  }
  const maxTextLength = options.maxTextLength ?? MAX_TEXT_LENGTH;
  if (!Number.isInteger(maxTextLength) || maxTextLength < 1) {
    throw new TypeError("maxTextLength must be a positive integer.");
  }

  return {
    write: options.write,
    now: options.now ?? (() => new Date()),
    maxTextLength,
  };
}
