export const ANSWER_GROUNDING_RULESET_VERSION = 1;

export const MIN_CHECKED_TERM_LENGTH = 2;

const QUOTED_TERM_PATTERN = /[「『]([^」』\n]{1,40})[」』]/gu;
const LIST_LINE_PATTERN = /^[\s　]*(?:[-•*·]|\d+[.、)])[\s　]*(.+)$/gmu;
const HAN_RUN_PATTERN = /[\p{Script=Han}]{2,}/gu;

/**
 * What this checker is, and what it deliberately is not.
 *
 * It is not a hallucination detector. A model writing fluent prose invents word
 * sequences constantly and legitimately — 「開放了以下區域」 appears in no
 * source and is not a fabrication — so a general containment check over the
 * answer would reject good answers by the dozen and teach everyone to ignore it.
 *
 * It checks the one place where invention is never legitimate: a **name the
 * answer presents as copied**. The sources write proper nouns inside 「」, and a
 * list item that is nothing but a name is a name being quoted, not prose being
 * composed. Both must appear verbatim in the evidence. That is how 蓋石山 —
 * written where every source says 踞石山 — reached a reader with a citation
 * behind it.
 *
 * Narrow on purpose: it misses fabrications stated in running prose. A check
 * that fires only on real problems is one people act on.
 */
export const ANSWER_GROUNDING_RULES = Object.freeze({
  version: ANSWER_GROUNDING_RULESET_VERSION,
  checksQuotedTerms: true,
  checksStandaloneListNames: true,
  checksRunningProse: false,
  minTermLength: MIN_CHECKED_TERM_LENGTH,
});

/**
 * Collect the terms an answer presents as copied from its evidence.
 *
 * @param {string} answerText
 * @returns {string[]} unique terms, in the order they appear
 */
export function collectQuotedTerms(answerText) {
  if (typeof answerText !== "string") {
    return [];
  }

  const terms = [];
  for (const [, term] of answerText.matchAll(QUOTED_TERM_PATTERN)) {
    addTerm(terms, term);
  }
  for (const [, line] of answerText.matchAll(LIST_LINE_PATTERN)) {
    // Only a bare name counts. A list item carrying a sentence, punctuation, or
    // its own parenthetical is the model writing, not the model copying.
    const bare = line.trim();
    if (isBareName(bare)) {
      addTerm(terms, bare);
    }
  }
  return terms;
}

/**
 * Find the copied-looking terms that no evidence actually contains.
 *
 * @param {{ answerText: string, contents: object[] }} request
 * @returns {{ grounded: boolean, unsupportedTerms: string[] }}
 */
export function checkAnswerGrounding(request) {
  const answerText = request?.answerText;
  const contents = Array.isArray(request?.contents) ? request.contents : [];
  const evidenceText = contents
    .map((content) => (typeof content?.text === "string" ? content.text : ""))
    .join("\n");

  const unsupportedTerms = collectQuotedTerms(answerText).filter(
    (term) => !evidenceText.includes(term),
  );

  return { grounded: unsupportedTerms.length === 0, unsupportedTerms };
}

function addTerm(terms, rawTerm) {
  const term = rawTerm.trim();
  if (term.length >= MIN_CHECKED_TERM_LENGTH && !terms.includes(term)) {
    terms.push(term);
  }
}

/**
 * A bare name is one Han run and nothing else — no verbs around it, no digits,
 * no brackets. 「踞石山」 qualifies; 「「瑪拉妮」（五星，水屬性）」 does not,
 * because the model composed that line rather than copying a name.
 */
function isBareName(value) {
  const runs = value.match(HAN_RUN_PATTERN) ?? [];
  return runs.length === 1 && runs[0] === value;
}
