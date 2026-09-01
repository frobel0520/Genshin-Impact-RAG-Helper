import { createHash } from "node:crypto";

import {
  ANSWERABILITY,
  ANSWER_STATUSES,
  RUN_STATUSES,
  createDomainId,
} from "../domain/domain-contract.js";
import { isRecord } from "../domain/contract-validation.js";
import {
  RUN_ARTIFACT_KINDS,
  assertRunResponse,
  classifyErrorCode,
} from "../domain/run-response-contract.js";
import {
  EVAL_METRIC_DEFINITIONS,
  EVAL_METRIC_KEYS,
  EVAL_METRIC_LABELS,
  HUMAN_REVIEW_STATUSES,
  assertEvalCase,
  assertEvalResult,
} from "./evaluation-contract.js";

export const EVALUATION_RUNNER_VERSION = 1;
export const RECALL_CUTOFF = 5;

/**
 * What this runner can and cannot decide on its own.
 *
 * Three metrics are mechanical: whether a refusal happened for the declared
 * reason, whether an answer carries citations, and whether an expected source
 * appears in the top-ranked citations. The other two — is the answer correct,
 * is it grounded in what was cited — are judgements about prose, and a
 * deterministic runner that scored them would only be inventing agreement.
 * They are labelled `not_scored` and left to the human review the contract
 * already carries, rather than reported as passes nobody verified.
 */
export const SCORED_METRICS = Object.freeze([
  "correct_refusal",
  "citation_coverage",
  "retrieval_recall_at_5",
]);

export const HUMAN_JUDGED_METRICS = Object.freeze(["answer_correctness", "groundedness"]);

const RUN_REQUEST_FIELDS = new Set([
  "cases",
  "answer",
  "runId",
  "now",
  "reportPath",
  "logger",
]);

/**
 * Run every EvalCase through the query contract and score what can be scored.
 *
 * The query service is injected rather than imported: module boundaries keep
 * the evaluation layer away from the API, and a runner that builds its own
 * pipeline would be evaluating something other than what the API serves.
 *
 * @param {{
 *   cases: object[],
 *   answer: (request: object) => Promise<object>,
 *   runId?: string,
 *   now?: () => Date,
 *   reportPath?: string,
 * }} request
 * @returns {Promise<{ run: object, results: object[], metrics: object }>}
 */
export async function runEvaluation(request) {
  const { cases, answer, runId, now, reportPath, logger } = validateRequest(request);
  const startedAt = now();
  const results = [];
  const errors = [];

  for (const evalCase of cases) {
    try {
      const result = await evaluateCase(evalCase, answer, runId);
      results.push(result);
      logger?.logEvalResult({ runId, result });
    } catch (error) {
      errors.push({
        code: classifyErrorCode(error),
        message: error instanceof Error ? error.message : "The evaluation case failed.",
        case_id: evalCase.case_id,
      });
    }
  }

  const { metrics, cases: caseSummary } = summarizeRun(cases, results);
  const artifacts =
    reportPath === undefined
      ? []
      : [
          {
            path: reportPath,
            content_hash: hashCanonical({ results, metrics }),
            kind: RUN_ARTIFACT_KINDS.REPORT,
          },
        ];

  const run = assertRunResponse({
    run_id: runId,
    input_version: hashCanonical(cases),
    started_at: startedAt.toISOString(),
    finished_at: now().toISOString(),
    status: resolveStatus(errors, results),
    errors,
    artifacts,
  });

  return { run, results, metrics, cases: caseSummary };
}

/**
 * Whether a scored metric met its target.
 *
 * Kept out of the RunResponse on purpose: a metric below target is a real
 * evaluation finding, not a failed run. The command line decides what to do
 * about it, so the run keeps reporting only whether it executed.
 *
 * @param {object} metrics
 * @returns {boolean}
 */
export function meetsAllTargets(metrics) {
  return EVAL_METRIC_KEYS.every((key) => metrics[key]?.meets_target !== false);
}

async function evaluateCase(evalCase, answer, runId) {
  assertEvalCase(evalCase);

  const response = await answer({
    question: evalCase.question_zh_tw,
    spoiler_level: evalCase.spoiler_level,
    ...(evalCase.game_version === undefined || evalCase.game_version === "unknown"
      ? {}
      : { game_version: evalCase.game_version }),
  });

  return assertEvalResult({
    case_id: evalCase.case_id,
    run_id: runId,
    // The Query API deliberately never exposes internal evidence IDs, so the
    // public citations are what an evaluation can see and score.
    retrieved_evidence: [],
    answer: response,
    citations: response.citations,
    metric_labels: scoreCase(evalCase, response),
    human_review: { status: HUMAN_REVIEW_STATUSES.PENDING },
  });
}

function scoreCase(evalCase, response) {
  const refusalExpected = evalCase.answerability === ANSWERABILITY.REFUSE;
  const refused = response.answer_status === ANSWER_STATUSES.REFUSED;

  return {
    answer_correctness: EVAL_METRIC_LABELS.NOT_SCORED,
    groundedness: EVAL_METRIC_LABELS.NOT_SCORED,
    correct_refusal: refusalExpected
      ? label(refused && matchesDeclaredReason(evalCase, response))
      : EVAL_METRIC_LABELS.NOT_APPLICABLE,
    citation_coverage: refused
      ? EVAL_METRIC_LABELS.NOT_APPLICABLE
      : label(response.citations.length > 0),
    retrieval_recall_at_5: scoreRecall(evalCase, response),
  };
}

/**
 * A refusal for the wrong reason is not a correct refusal: refusing an
 * out-of-scope question because no evidence was found would pass the letter of
 * the case and miss what it was written to check.
 */
function matchesDeclaredReason(evalCase, response) {
  return (
    evalCase.refusal_reason === undefined ||
    evalCase.refusal_reason === response.uncertainty_reason
  );
}

function scoreRecall(evalCase, response) {
  const expectedUrls = expectedSourceUrls(evalCase);
  if (expectedUrls.length === 0) {
    return EVAL_METRIC_LABELS.NOT_APPLICABLE;
  }
  const topUrls = new Set(
    response.citations.slice(0, RECALL_CUTOFF).map((citation) => citation.source_url),
  );
  return label(expectedUrls.some((url) => topUrls.has(url)));
}

function expectedSourceUrls(evalCase) {
  if (!Array.isArray(evalCase.expected_sources)) {
    return [];
  }
  return evalCase.expected_sources
    .map((source) => (isRecord(source) ? source.source_url : undefined))
    .filter((url) => typeof url === "string");
}

/**
 * Metrics stay a map of metrics. The case counts are their own thing: mixing a
 * tally into the metric map makes every consumer special-case one key.
 */
function summarizeRun(cases, results) {
  const summary = {};

  for (const key of EVAL_METRIC_KEYS) {
    const labels = results.map((result) => result.metric_labels[key]);
    const passed = labels.filter((value) => value === EVAL_METRIC_LABELS.PASS).length;
    const failed = labels.filter((value) => value === EVAL_METRIC_LABELS.FAIL).length;
    const scored = passed + failed;
    const target = EVAL_METRIC_DEFINITIONS[key].target;
    const score = scored === 0 ? null : passed / scored;

    summary[key] = {
      target,
      scope: EVAL_METRIC_DEFINITIONS[key].scope,
      passed,
      failed,
      not_applicable: labels.filter((value) => value === EVAL_METRIC_LABELS.NOT_APPLICABLE).length,
      not_scored: labels.filter((value) => value === EVAL_METRIC_LABELS.NOT_SCORED).length,
      score,
      // A metric nothing scored has not met its target and has not missed it.
      meets_target: score === null ? null : score >= target,
    };
  }

  return {
    metrics: summary,
    cases: {
      declared: cases.length,
      evaluated: results.length,
      pending_human_review: results.length,
    },
  };
}

function resolveStatus(errors, results) {
  if (errors.length === 0) {
    return RUN_STATUSES.PASSED;
  }
  return results.length > 0 ? RUN_STATUSES.PARTIAL : RUN_STATUSES.FAILED;
}

function label(passed) {
  return passed ? EVAL_METRIC_LABELS.PASS : EVAL_METRIC_LABELS.FAIL;
}

function validateRequest(request) {
  if (!isRecord(request)) {
    throw new TypeError("Evaluation run request must be a plain object.");
  }
  for (const field of Object.keys(request)) {
    if (!RUN_REQUEST_FIELDS.has(field)) {
      throw new TypeError(`Unknown evaluation run request field: ${field}.`);
    }
  }
  if (!Array.isArray(request.cases) || request.cases.length === 0) {
    throw new TypeError("cases must be a non-empty array of EvalCases.");
  }
  if (typeof request.answer !== "function") {
    throw new TypeError("answer must be a function taking a QueryRequest.");
  }
  if (request.now !== undefined && typeof request.now !== "function") {
    throw new TypeError("now must be a function returning a Date.");
  }
  if (request.reportPath !== undefined && typeof request.reportPath !== "string") {
    throw new TypeError("reportPath must be a string when provided.");
  }
  if (request.logger !== undefined && typeof request.logger.logEvalResult !== "function") {
    throw new TypeError("logger must be a run logger when provided.");
  }

  return {
    cases: request.cases,
    answer: request.answer,
    runId: request.runId ?? createDomainId("run", `eval-${Date.now()}`),
    now: request.now ?? (() => new Date()),
    reportPath: request.reportPath,
    logger: request.logger,
  };
}

function hashCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
