import { assertCanonicalEntity } from "../data/canonical-entity-contract.js";
import {
  QUERY_CATEGORIES,
  RETRIEVAL_MODES,
  SPOILER_LEVELS,
  VERSION_CONSTRAINTS,
} from "../domain/domain-contract.js";
import { isRecord } from "../domain/contract-validation.js";
import {
  applyQueryRequestDefaults,
  assertQueryPlan,
} from "./query-contract.js";

export const QUERY_CLASSIFIER_RULESET_VERSION = 3;
export const DEFAULT_CLASSIFIER_SPOILER_LEVEL = SPOILER_LEVELS.NONE;

const CLASSIFIER_OPTION_FIELDS = new Set(["canonicalEntities"]);
const EXPLICIT_RANGE_PATTERN = /\d+\.\d+\s*(?:-|–|—|~|～|至|到)\s*\d+\.\d+/u;
const EXPLICIT_VERSION_PATTERN = /(?:版本\s*)?\d+\.\d+/u;
const TEXTUAL_RANGE_PATTERN = /版本區間|版本範圍|哪些版本/u;

const OUT_OF_SCOPE_PATTERNS = Object.freeze([
  /配隊|組隊|隊伍搭配|配裝/u,
  /值得抽|抽不抽|抽卡建議|抽取建議/u,
  /(?:建議|推薦|該|要不要|值不值得).{0,6}(?:抽|練|養|升)/u,
  /抽.{0,6}(?:還是|或是|或)/u,
  /卡池|復刻|池子|保底/u,
  /聖遺物.{0,6}(?:推薦|建議|搭配|詞條)/u,
  /測試服|內鬼|洩漏|爆料/u,
  /(?:採集|取得|獲取|收集).{0,8}(?:路線|路徑)/u,
  /帳號交易|代儲|儲值優惠/u,
]);

const STRUCTURED_INTENT_PATTERNS = Object.freeze([
  /元素|武器類型|武器種類|稀有度|星級/u,
  /數值|面板|基礎攻擊|攻擊力|生命值|防禦力/u,
  /技能|天賦|元素戰技|元素爆發|冷卻時間|能量消耗/u,
  /突破素材|屬性|能力/u,
  /版本區間|版本範圍/u,
  /(?:發布|推出|上線|實裝|登場).{0,6}版本|版本.{0,6}(?:發布|推出|上線|實裝|登場)/u,
]);

const NARRATIVE_INTENT_PATTERNS = Object.freeze([
  /故事|背景|劇情|世界觀|傳說|經歷|身世|設定/u,
  /任務摘要|任務內容|角色介紹|地區介紹|\blore\b/iu,
  /特點|特色|由來|起源/u,
]);

const VERSION_INTENT_PATTERNS = Object.freeze([
  /版本.{0,8}(?:更新|調整|改動|修正|已知問題)/u,
  /(?:更新|調整|改動|修正|已知問題).{0,8}版本/u,
  /更新內容|版本差異|改版/u,
]);

export const QUERY_CLASSIFIER_RULES = Object.freeze({
  version: QUERY_CLASSIFIER_RULESET_VERSION,
  matching: "explicit-canonical-name-and-alias-longest-match",
  fuzzyMatching: false,
  defaultSpoilerLevel: DEFAULT_CLASSIFIER_SPOILER_LEVEL,
  outOfScopePriority: true,
});

/**
 * Build a reusable deterministic classifier from validated canonical entities.
 * Classification produces routing metadata only and never generates answers.
 *
 * @param {{ canonicalEntities: unknown[] }} options
 * @returns {{ rulesetVersion: number, classify: (request: unknown) => object }}
 */
export function createQueryClassifier(options) {
  const canonicalEntities = validateClassifierOptions(options);
  const entityMentions = buildEntityMentionIndex(canonicalEntities);

  function classify(request) {
    const normalizedRequest = applyQueryRequestDefaults(request);
    const question = normalizeQuestionForMatching(normalizedRequest.question);
    const normalizedEntities = resolveKnownEntities(question, entityMentions);
    const versionConstraint = classifyVersionConstraint(
      normalizedRequest.game_version,
      question,
    );
    const routing = classifyRouting(question, normalizedEntities.length > 0);
    const plan = {
      query_category: routing.queryCategory,
      normalized_entities: normalizedEntities,
      version_constraint: versionConstraint,
      retrieval_mode: routing.retrievalMode,
      spoiler_level:
        normalizedRequest.spoiler_level ?? DEFAULT_CLASSIFIER_SPOILER_LEVEL,
    };

    return assertQueryPlan(plan);
  }

  return Object.freeze({
    rulesetVersion: QUERY_CLASSIFIER_RULESET_VERSION,
    classify,
  });
}

/**
 * Classify one request without retaining a classifier instance.
 *
 * @param {unknown} request
 * @param {{ canonicalEntities: unknown[] }} options
 * @returns {object}
 */
export function classifyQuery(request, options) {
  return createQueryClassifier(options).classify(request);
}

function validateClassifierOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Query classifier options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!CLASSIFIER_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown query classifier option: ${field}.`);
    }
  }
  if (!Array.isArray(options.canonicalEntities)) {
    throw new TypeError("canonicalEntities must be an array.");
  }

  const seenEntityIds = new Set();
  return options.canonicalEntities.map((entity, index) => {
    let validatedEntity;
    try {
      validatedEntity = assertCanonicalEntity(entity);
    } catch (error) {
      throw new TypeError(
        `canonicalEntities[${index}] is invalid: ${error.message}`,
        { cause: error },
      );
    }
    if (seenEntityIds.has(validatedEntity.entity_id)) {
      throw new TypeError(`Duplicate entity ID ${validatedEntity.entity_id}.`);
    }
    seenEntityIds.add(validatedEntity.entity_id);
    return validatedEntity;
  });
}

function buildEntityMentionIndex(canonicalEntities) {
  const mentionsByKey = new Map();

  for (const entity of canonicalEntities) {
    registerMention(mentionsByKey, entity, entity.canonical_name, false);
    for (const alias of entity.aliases) {
      registerMention(mentionsByKey, entity, alias, true);
    }
  }

  return Object.freeze(
    [...mentionsByKey.values()].sort((left, right) =>
      right.normalizedText.length - left.normalizedText.length ||
      left.normalizedText.localeCompare(right.normalizedText),
    ),
  );
}

function registerMention(mentionsByKey, entity, text, isAlias) {
  const normalizedText = normalizeQuestionForMatching(text);
  const comparableText = normalizedText.toLowerCase();
  const existing = mentionsByKey.get(comparableText);
  if (existing !== undefined) {
    if (existing.entityId === entity.entity_id) {
      return;
    }
    throw new TypeError(
      `Ambiguous explicit entity name "${text}" for ${existing.entityId} and ${entity.entity_id}.`,
    );
  }

  mentionsByKey.set(comparableText, Object.freeze({
    entityId: entity.entity_id,
    entityType: entity.entity_type,
    canonicalName: entity.canonical_name,
    normalizedText,
    comparableText,
    isAlias,
  }));
}

function resolveKnownEntities(question, entityMentions) {
  const comparableQuestion = question.toLowerCase();
  const bestMatchByEntity = new Map();

  for (const mention of entityMentions) {
    const index = findMention(comparableQuestion, mention.comparableText);
    if (index === -1) {
      continue;
    }
    const existing = bestMatchByEntity.get(mention.entityId);
    if (
      existing === undefined ||
      mention.normalizedText.length > existing.mention.normalizedText.length ||
      (mention.normalizedText.length === existing.mention.normalizedText.length &&
        index < existing.index)
    ) {
      bestMatchByEntity.set(mention.entityId, { mention, index });
    }
  }

  return [...bestMatchByEntity.values()]
    .sort((left, right) => left.index - right.index ||
      right.mention.normalizedText.length - left.mention.normalizedText.length)
    .map(({ mention, index }) => {
      const matchedText = question.slice(index, index + mention.normalizedText.length);
      return {
        entity_id: mention.entityId,
        text: matchedText,
        entity_type: mention.entityType,
        resolution_status: "resolved",
        aliases_used: mention.isAlias ? [matchedText] : [],
      };
    });
}

function findMention(question, mention) {
  let searchFrom = 0;
  while (searchFrom <= question.length - mention.length) {
    const index = question.indexOf(mention, searchFrom);
    if (index === -1) {
      return -1;
    }
    if (!containsAsciiWordCharacters(mention) || hasAsciiWordBoundaries(question, index, mention)) {
      return index;
    }
    searchFrom = index + 1;
  }
  return -1;
}

function containsAsciiWordCharacters(value) {
  return /[a-z0-9]/i.test(value);
}

function hasAsciiWordBoundaries(question, index, mention) {
  const previous = question[index - 1];
  const next = question[index + mention.length];
  return !isAsciiWordCharacter(previous) && !isAsciiWordCharacter(next);
}

function isAsciiWordCharacter(value) {
  return typeof value === "string" && /[a-z0-9_]/i.test(value);
}

function classifyVersionConstraint(requestVersion, question) {
  if (requestVersion === "unknown") {
    return VERSION_CONSTRAINTS.UNKNOWN;
  }
  if (typeof requestVersion === "string") {
    return EXPLICIT_RANGE_PATTERN.test(requestVersion)
      ? VERSION_CONSTRAINTS.RANGE
      : VERSION_CONSTRAINTS.EXACT;
  }
  if (EXPLICIT_RANGE_PATTERN.test(question) || TEXTUAL_RANGE_PATTERN.test(question)) {
    return VERSION_CONSTRAINTS.RANGE;
  }
  if (EXPLICIT_VERSION_PATTERN.test(question)) {
    return VERSION_CONSTRAINTS.EXACT;
  }
  return VERSION_CONSTRAINTS.CURRENT_UNSPECIFIED;
}

function classifyRouting(question, hasResolvedEntity) {
  if (matchesAny(question, OUT_OF_SCOPE_PATTERNS)) {
    return routing(QUERY_CATEGORIES.OUT_OF_SCOPE, RETRIEVAL_MODES.NONE);
  }

  const hasStructuredIntent = matchesAny(question, STRUCTURED_INTENT_PATTERNS);
  const hasNarrativeIntent = matchesAny(question, NARRATIVE_INTENT_PATTERNS);
  const hasVersionIntent = matchesAny(question, VERSION_INTENT_PATTERNS);

  if (hasStructuredIntent && hasNarrativeIntent) {
    return routing(QUERY_CATEGORIES.COMPOSITE, RETRIEVAL_MODES.HYBRID);
  }
  if (hasVersionIntent) {
    return routing(QUERY_CATEGORIES.VERSION, RETRIEVAL_MODES.DOCUMENT);
  }
  if (hasStructuredIntent && hasResolvedEntity) {
    return routing(QUERY_CATEGORIES.STRUCTURED, RETRIEVAL_MODES.STRUCTURED);
  }
  if (hasResolvedEntity || hasNarrativeIntent) {
    return routing(QUERY_CATEGORIES.NARRATIVE, RETRIEVAL_MODES.DOCUMENT);
  }
  return routing(QUERY_CATEGORIES.OUT_OF_SCOPE, RETRIEVAL_MODES.NONE);
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function routing(queryCategory, retrievalMode) {
  return { queryCategory, retrievalMode };
}

function normalizeQuestionForMatching(value) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
