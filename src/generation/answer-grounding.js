export const ANSWER_GROUNDING_RULESET_VERSION = 2;

export const MIN_CHECKED_TERM_LENGTH = 2;

const QUOTED_TERM_PATTERN = /[「『]([^」』\n]{1,40})[」』]/gu;
const LIST_LINE_PATTERN = /^[\s　]*(?:[-•*·]|\d+[.、)])[\s　]*(.+)$/gmu;
const HAN_RUN_PATTERN = /[\p{Script=Han}]{2,}/gu;
const ELEMENTS = "風雷水火冰草岩";
const CHARACTER_ELEMENT_PATTERN = new RegExp(
  `「([^」\\n]{2,80})[（(]([${ELEMENTS}])[）)]」`,
  "gu",
);
const CHARACTER_VISION_PATTERN = new RegExp(
  `(?:神之眼|神之心)\\s*[:：]\\s*([${ELEMENTS}])`,
  "gu",
);

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
  checksCharacterElementConsistency: true,
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
 * @returns {{ grounded: boolean, unsupportedTerms: string[], diagnostics: { elementContradictions: object[] } }}
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
  const elementContradictions = findElementContradictions(answerText, contents);

  return {
    grounded: unsupportedTerms.length === 0 && elementContradictions.length === 0,
    unsupportedTerms,
    diagnostics: { elementContradictions },
  };
}

/**
 * Check only an explicit character-element claim against an unambiguous,
 * same-character evidence block. This intentionally does not infer an
 * element from damage, resistance, reactions, or a mention of another role.
 *
 * @param {string} answerText
 * @param {object[]} contents
 * @returns {object[]}
 */
function findElementContradictions(answerText, contents) {
  if (typeof answerText !== "string") {
    return [];
  }

  const evidenceBySubject = collectEvidenceElements(contents);
  const contradictions = [];
  for (const [subject, evidenceElements] of evidenceBySubject) {
    if (evidenceElements.length !== 1) {
      continue;
    }
    for (const assertedElement of collectAnswerElements(answerText, subject)) {
      if (assertedElement !== evidenceElements[0]) {
        contradictions.push({ subject, assertedElement, evidenceElements });
      }
    }
  }
  return contradictions;
}

function collectEvidenceElements(contents) {
  const elementsBySubject = new Map();
  for (const content of contents) {
    const text = typeof content?.text === "string" ? content.text : "";
    const descriptors = [...text.matchAll(CHARACTER_ELEMENT_PATTERN)];
    for (let index = 0; index < descriptors.length; index += 1) {
      const descriptor = descriptors[index];
      const subject = descriptor[1].trim();
      const inlineElement = descriptor[2];
      const blockEnd = descriptors[index + 1]?.index ?? text.length;
      const block = text.slice(descriptor.index, blockEnd);
      const visionElements = [...block.matchAll(CHARACTER_VISION_PATTERN)].map((match) => match[1]);
      if (visionElements.length === 0 || visionElements.some((element) => element !== inlineElement)) {
        continue;
      }
      const elements = elementsBySubject.get(subject) ?? new Set();
      elements.add(inlineElement);
      elementsBySubject.set(subject, elements);
    }
  }
  return new Map([...elementsBySubject].map(([subject, elements]) => [subject, [...elements]]));
}

function collectAnswerElements(answerText, subject) {
  const elements = [];
  const subjectPattern = new RegExp(`[「『]${escapeRegExp(subject)}[」』]`, "gu");
  for (const match of answerText.matchAll(subjectPattern)) {
    const lineStart = answerText.lastIndexOf("\n", match.index) + 1;
    const lineEnd = answerText.indexOf("\n", match.index);
    const line = answerText.slice(lineStart, lineEnd === -1 ? answerText.length : lineEnd);
    const subjectOffset = match.index - lineStart;
    const prefix = line.slice(0, subjectOffset);
    if (/(?:不是|並非|不像|而非)\s*$/u.test(prefix)) {
      continue;
    }
    const afterSubject = line.slice(subjectOffset + match[0].length);
    const details = afterSubject.match(/^[」』）)\s:：，,；;]*[（(]([^\n）)]*)[）)]/u);
    if (details) {
      const detailFields = details[1]
        .split(/[，,、；;]/u)
        .map((field) => field.trim())
        .filter(Boolean);
      const detailElements = detailFields
        .map((field) => field.match(new RegExp(`^([${ELEMENTS}])元素(?:角色|屬性)?$`, "u")))
        .filter(Boolean)
        .map((entry) => entry[1]);
      if (detailElements.length === 1) {
        addUnique(elements, detailElements[0]);
      }
    }
  }
  return elements;
}

function addUnique(values, value) {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

/**
 * Patterns a model uses when it is telling you the evidence does not answer the
 * question. Deliberately narrow: each one has to be the *shape of the whole
 * reply*, not a phrase that could appear inside a real answer.
 */
const CANNOT_ANSWER_PATTERNS = Object.freeze([
  /(?:證據|資料|來源)(?:中|裡)?(?:並)?(?:沒有|未)(?:提到|提及|說明|記載|包含)/,
  /無法(?:根據|依據)?(?:現有)?(?:證據|資料|來源)?回答/,
  /(?:證據|資料|來源)不足以回答/,
]);

const MAX_CANNOT_ANSWER_LENGTH = 60;

/**
 * Does this reply say the evidence cannot answer the question?
 *
 * The retrieval floor decides whether a chunk is close enough to the question;
 * it cannot decide whether the chunk *addresses* it. The model, having read
 * both, sometimes says so outright — and the system used to throw that away and
 * report the reply as an answer, with a citation behind it. A reader is not
 * misled by the prose, but `answer_status: answered` is still a false claim
 * about what happened.
 *
 * Narrow on purpose. A long reply that mentions a gap in passing is still an
 * answer: 「證據中沒有提到她的生日，但她是水元素角色」 answers the question. Only a
 * short reply that is *nothing but* the statement of inability counts, so a
 * false positive cannot silently turn a good answer into a refusal.
 *
 * @param {string} answerText
 * @returns {boolean}
 */
export function readsAsCannotAnswer(answerText) {
  if (typeof answerText !== "string") {
    return false;
  }
  const trimmed = answerText.trim();
  if (trimmed === "" || trimmed.length > MAX_CANNOT_ANSWER_LENGTH) {
    return false;
  }
  // More than one sentence means the model went on to say something else, and
  // whatever that was is content this check must not discard.
  if (trimmed.replace(/[。！？]\s*$/u, "").search(/[。！？]/u) !== -1) {
    return false;
  }
  // Nor may it discard content that arrived in the same sentence:
  // 「證據中沒有提到她的生日，但她是水元素角色」 names the gap and then answers.
  if (/但|不過|然而|惟|只(?:知道|能說)/u.test(trimmed)) {
    return false;
  }
  return CANNOT_ANSWER_PATTERNS.some((pattern) => pattern.test(trimmed));
}
