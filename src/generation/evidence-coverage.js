import { isRecord, isStableString } from "../domain/contract-validation.js";

/**
 * Asking whether the evidence answers the question at all.
 *
 * The similarity floor decides whether a chunk is close to the question. It
 * cannot decide whether the chunk *addresses* it, and
 * [`docs/07-scale-test.md`](../../docs/07-scale-test.md) measured the point
 * where that stops being a theoretical objection: at 89 chunks the question the
 * corpus cannot answer scores 0.504, inside the 0.438–0.712 band of questions it
 * can. No floor separates them any more.
 *
 * What can still separate them is reading. The model, given the question and
 * the approved evidence, answers YES or NO. Measured on the 58-case bank it
 * catches the unanswerable question the floor misses — and refuses one
 * answerable question it should not, which is why the caller records the
 * verdict instead of acting on it by default (`docs/07-scale-test.md` §5).
 *
 * This replaces nothing. `readsAsCannotAnswer` still catches a model that
 * volunteers the gap while answering; this asks before the answer exists.
 */
export const COVERAGE_SYSTEM_PROMPT =
  "你是證據審查員。只回答 YES 或 NO，不要解釋。";

export const COVERAGE_VERDICTS = Object.freeze({
  COVERED: "covered",
  NOT_COVERED: "not_covered",
  UNKNOWN: "unknown",
});

const JUDGE_OPTION_FIELDS = new Set(["chat", "logger"]);

/**
 * Build the question put to the reviewer.
 *
 * The evidence is the approved set, in the same rendering the answer will be
 * written from — judging a different text than the one the answer uses would
 * make the verdict about something else.
 *
 * @param {{ question: string, contents: object[] }} request
 * @returns {string}
 */
export function buildCoveragePrompt(request) {
  if (!isRecord(request) || !isStableString(request.question)) {
    throw new TypeError("A coverage prompt needs a question.");
  }
  if (!Array.isArray(request.contents) || request.contents.length === 0) {
    throw new TypeError("A coverage prompt needs at least one piece of evidence.");
  }
  const lines = request.contents.map((content, index) => `[${index + 1}] ${content.text}`);
  return [
    `問題：${request.question}`,
    "",
    "證據：",
    ...lines,
    "",
    "上面的證據足以回答這個問題嗎？YES 或 NO。",
  ].join("\n");
}

/**
 * Read a reviewer's reply.
 *
 * Anything that is not a clear YES or NO is `unknown`, never a refusal: a
 * reviewer that answered oddly has told us nothing, and turning that into a
 * refusal would take a working answer away from the reader on no evidence.
 *
 * @param {unknown} reply
 * @returns {string} one of COVERAGE_VERDICTS
 */
export function readCoverageVerdict(reply) {
  if (typeof reply !== "string") {
    return COVERAGE_VERDICTS.UNKNOWN;
  }
  const normalized = reply.trim().toUpperCase();
  if (normalized.startsWith("YES")) {
    return COVERAGE_VERDICTS.COVERED;
  }
  if (normalized.startsWith("NO")) {
    return COVERAGE_VERDICTS.NOT_COVERED;
  }
  return COVERAGE_VERDICTS.UNKNOWN;
}

/**
 * Create the coverage judge the query service consults before generating.
 *
 * It fails open. A judge that times out, errors, or answers something other
 * than YES or NO returns `unknown`, and the caller answers as it would have
 * done — because the cost of a broken judge must be a missing check, never a
 * refusal the reader did not earn.
 *
 * @param {{ chat: (request: object) => Promise<string>, logger?: object }} options
 * @returns {{ judge: (request: object) => Promise<string> }}
 */
export function createCoverageJudge(options) {
  if (!isRecord(options)) {
    throw new TypeError("Coverage judge options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!JUDGE_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown coverage judge option: ${field}.`);
    }
  }
  if (typeof options.chat !== "function") {
    throw new TypeError("chat must be a function.");
  }
  const { chat, logger } = options;

  async function judge(request) {
    if (!isRecord(request) || !Array.isArray(request.contents) || request.contents.length === 0) {
      return COVERAGE_VERDICTS.UNKNOWN;
    }
    let reply;
    try {
      reply = await chat({
        system: COVERAGE_SYSTEM_PROMPT,
        prompt: buildCoveragePrompt(request),
      });
    } catch (error) {
      record(logger, request, `The coverage check could not run: ${error?.message ?? "unknown error"}`);
      return COVERAGE_VERDICTS.UNKNOWN;
    }
    const verdict = readCoverageVerdict(reply);
    if (verdict === COVERAGE_VERDICTS.UNKNOWN) {
      record(logger, request, `The coverage check answered neither YES nor NO: ${String(reply).slice(0, 80)}`);
    }
    return verdict;
  }

  return Object.freeze({ judge });
}

/**
 * A check that did not run is worth a line in the log: the answer that follows
 * was produced without it, and nothing else in the record would say so.
 */
function record(logger, request, message) {
  if (logger?.logFailure === undefined || !isStableString(request.traceId)) {
    return;
  }
  try {
    logger.logFailure({
      traceId: request.traceId,
      queryId: request.queryId,
      code: "coverage_check_unavailable",
      message,
    });
  } catch {
    // Nothing to do: the answer is already safe, and the caller is mid-answer.
  }
}
