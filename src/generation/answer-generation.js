import { isRecord, isStableString } from "../domain/contract-validation.js";
import { checkAnswerGrounding } from "./answer-grounding.js";

export const ANSWER_GENERATION_RULESET_VERSION = 1;

export const ANSWER_GENERATION_MAX_CHARS = 400;

/**
 * The instruction the model answers under.
 *
 * Everything in it is a restriction. The assistant's whole promise is that an
 * answer is traceable to a source, so a generator that adds what it happens to
 * know about Genshin Impact breaks the product even when it is right: nobody
 * downstream can tell which sentence came from the evidence and which came from
 * the weights.
 */
export const ANSWER_GENERATION_SYSTEM_PROMPT = [
  "你是一位《原神》資料助手。",
  "只能根據使用者訊息中「證據」段落的內容作答，不得使用任何其他知識。",
  "證據沒有提到的事情就不要寫，也不要推測、補充或美化。",
  "用繁體中文寫，直接回答問題，不要重述問題，不要加開場白或結語。",
  "證據裡的用詞就照抄，不要自行翻譯或換成別的說法。",
  "不要加入證據沒有寫出來的稱謂或性別代稱。",
  `最多 ${ANSWER_GENERATION_MAX_CHARS} 個字。`,
  "不要自己編造來源、連結或編號；引用會由系統另外附上。",
].join("\n");

export const ANSWER_GENERATION_RULES = Object.freeze({
  version: ANSWER_GENERATION_RULESET_VERSION,
  evidenceOnly: true,
  refusalsAreNeverGenerated: true,
  fallsBackToTemplate: true,
  quotedNamesMustAppearInEvidence: true,
  maxChars: ANSWER_GENERATION_MAX_CHARS,
});

const GENERATOR_OPTION_FIELDS = new Set(["generate", "logger"]);

/**
 * Build the user message: the question, then the approved evidence.
 *
 * Each line is numbered and labelled with its source so the model has no reason
 * to invent an attribution, and so a human reading a log can line the answer up
 * against what it was given.
 *
 * @param {{ question: string, contents: object[], versionScope?: string }} request
 * @returns {string}
 */
export function buildGenerationPrompt(request) {
  if (!isRecord(request) || !isStableString(request.question)) {
    throw new TypeError("A generation prompt needs a question.");
  }
  if (!Array.isArray(request.contents) || request.contents.length === 0) {
    throw new TypeError("A generation prompt needs at least one piece of evidence.");
  }

  const lines = request.contents.map(
    (content, index) =>
      `[${index + 1}] （${content.source_title ?? content.source_kind}）${content.text}`,
  );
  const versionLine =
    request.versionScope === undefined || request.versionScope === "unknown"
      ? []
      : [`適用版本：${request.versionScope}`];

  // The blank separator only belongs between the evidence and a version line
  // that exists. Appended unconditionally it left a trailing newline, and the
  // generator rejects a prompt with surrounding whitespace — so every answer
  // whose version scope was unknown fell back to the template without anyone
  // asking a model anything.
  const body = [`問題：${request.question}`, "", "證據：", ...lines];
  return (versionLine.length === 0 ? body : [...body, "", ...versionLine]).join("\n");
}

/**
 * Create the answer-text composer the query service injects.
 *
 * It returns `undefined` rather than throwing whenever it cannot produce text
 * it trusts — no evidence, an unusable reply, or a model that is not answering.
 * The formatter then falls back to its deterministic template, so an outage
 * costs the reader the prose and never the citations.
 *
 * @param {{ generate: (request: object) => Promise<string>, logger?: object }} options
 */
export function createAnswerGenerator(options) {
  const { generate, logger } = validateOptions(options);

  /**
   * @param {{
   *   question: string,
   *   contents: object[],
   *   versionScope?: string,
   *   traceId?: string,
   *   queryId?: string,
   * }} request
   * @returns {Promise<string | undefined>}
   */
  async function composeAnswerText(request) {
    if (!isRecord(request) || !Array.isArray(request.contents) || request.contents.length === 0) {
      return undefined;
    }

    let reply;
    try {
      reply = await generate({
        system: ANSWER_GENERATION_SYSTEM_PROMPT,
        prompt: buildGenerationPrompt(request),
      });
    } catch (error) {
      // A generation failure is not a query failure: the evidence and the
      // citations are already decided, and refusing to answer at all would be a
      // worse outcome than answering in the template's words.
      recordFallback(
        request,
        // Only the model adapter classifies its own failures. Anything else —
        // a malformed prompt, a bug in this module — is a generation error, and
        // filing it under an unreachable dependency sends whoever reads the log
        // to the wrong place.
        error?.code ?? "generation_error",
        `Answer generation fell back to the template: ${error?.message ?? "unknown error"}`,
      );
      return undefined;
    }

    const answerText = normalizeReply(reply);
    if (answerText === undefined) {
      return undefined;
    }

    // A name the answer presents as copied but that no evidence contains is the
    // one error this product cannot ship: it arrives with a citation behind it,
    // so a reader has every reason to believe it. The template says less and is
    // never wrong, and it keeps the citations, so the reader can still go and
    // read the source.
    const grounding = checkAnswerGrounding({ answerText, contents: request.contents });
    if (!grounding.grounded) {
      recordFallback(
        request,
        "ungrounded_answer",
        `Answer generation fell back to the template: ${grounding.unsupportedTerms.join("、")} appears in no evidence.`,
      );
      return undefined;
    }

    return answerText;
  }

  /**
   * Record why the template is speaking instead of the model.
   *
   * The log is best effort on purpose: falling back is already the safe path,
   * and a logger that rejects the record — a missing trace, a full disk — must
   * not turn a served answer into a failed query. The record is skipped without
   * a trace to file it under, because an untraceable failure record helps
   * nobody and the logger refuses it anyway.
   */
  function recordFallback(request, code, message) {
    if (logger?.logFailure === undefined || !isStableString(request.traceId)) {
      return;
    }
    try {
      logger.logFailure({
        traceId: request.traceId,
        queryId: request.queryId,
        code,
        message,
      });
    } catch {
      // Nothing to do: the answer is already safe, and the caller is mid-answer.
    }
  }

  return Object.freeze({
    rulesetVersion: ANSWER_GENERATION_RULESET_VERSION,
    composeAnswerText,
  });
}

/**
 * Trim the reply and reject one that carries no answer. A model that returns
 * whitespace, or a block of text far past the limit it was given, is not
 * following the instruction, and the template says less but says it reliably.
 *
 * @param {unknown} reply
 * @returns {string | undefined}
 */
export function normalizeReply(reply) {
  if (typeof reply !== "string") {
    return undefined;
  }
  const trimmed = reply.trim();
  if (trimmed === "" || trimmed.length > ANSWER_GENERATION_MAX_CHARS * 2) {
    return undefined;
  }
  return trimmed;
}

function validateOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Answer generator options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!GENERATOR_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown answer generator option: ${field}.`);
    }
  }
  if (typeof options.generate !== "function") {
    throw new TypeError("generate must be a function.");
  }
  return { generate: options.generate, logger: options.logger };
}
