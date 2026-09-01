export const ENTITY_TYPES = Object.freeze({
  CHARACTER: "character",
  WEAPON: "weapon",
  MATERIAL: "material",
  QUEST: "quest",
  REGION: "region",
  WORLD_LORE: "world_lore",
});

export const SOURCE_KINDS = Object.freeze({
  HOYOLAB: "hoyolab",
  GENSHIN_DB: "genshin-db",
  FANDOM: "fandom",
});

export const ANSWER_STATUSES = Object.freeze({
  ANSWERED: "answered",
  UNCERTAIN: "uncertain",
  REFUSED: "refused",
  ERROR: "error",
});

export const VERSION_STATUSES = Object.freeze({
  EXPLICIT: "explicit",
  RANGE: "range",
  UNKNOWN: "unknown",
});

export const VALIDITY_STATUSES = Object.freeze({
  ACTIVE: "active",
  SUPERSEDED: "superseded",
  UNKNOWN: "unknown",
  CONFLICT: "conflict",
});

export const QUERY_CATEGORIES = Object.freeze({
  STRUCTURED: "structured",
  NARRATIVE: "narrative",
  VERSION: "version",
  COMPOSITE: "composite",
  OUT_OF_SCOPE: "out_of_scope",
});

export const VERSION_CONSTRAINTS = Object.freeze({
  EXACT: "exact",
  RANGE: "range",
  CURRENT_UNSPECIFIED: "current-unspecified",
  UNKNOWN: "unknown",
});

export const RETRIEVAL_MODES = Object.freeze({
  STRUCTURED: "structured",
  DOCUMENT: "document",
  HYBRID: "hybrid",
  NONE: "none",
});

export const SPOILER_LEVELS = Object.freeze({
  NONE: "none",
  NOTICE: "notice",
  EXPLICIT: "explicit",
});

export const SUPPORT_TYPES = Object.freeze({
  DIRECT: "direct",
  CONTEXTUAL: "contextual",
  CONFLICTING: "conflicting",
});

/**
 * zh-TW labels for the field keys and enum values a StructuredFact stores.
 *
 * Values are stored in the vocabulary that compares across sources — genshin-db
 * writes `Claymore`, and rewriting it per source would make two sources look
 * like they disagree when they do not. A reader must still be told 雙手劍, and
 * anything that renders a fact for a person, or hands one to a model, must
 * translate here rather than leave it to be guessed: asked to render `Claymore`
 * in Chinese, a model answers 長劍, which is a different weapon.
 */
export const FIELD_KEY_LABELS_ZH_TW = Object.freeze({
  element: "元素",
  weapon_type: "武器類型",
  rarity: "星級",
  base_atk_lvl90: "90級基礎攻擊力",
  material_type: "素材類型",
  release_version: "登場版本",
  release_window: "登場版本區間",
  version_update_start: "版本更新開始時間",
});

export const FIELD_VALUE_LABELS_ZH_TW = Object.freeze({
  element: Object.freeze({
    Anemo: "風",
    Geo: "岩",
    Electro: "雷",
    Dendro: "草",
    Hydro: "水",
    Pyro: "火",
    Cryo: "冰",
  }),
  weapon_type: Object.freeze({
    Sword: "單手劍",
    Claymore: "雙手劍",
    Polearm: "長柄武器",
    Bow: "弓",
    Catalyst: "法器",
  }),
});

/**
 * @param {string} fieldKey
 * @param {unknown} value
 * @returns {string | undefined} the zh-TW label, or undefined when none is defined
 */
export function labelForFieldValue(fieldKey, value) {
  if (typeof value !== "string") {
    return undefined;
  }
  return FIELD_VALUE_LABELS_ZH_TW[fieldKey]?.[value];
}

export const ANSWERABILITY = Object.freeze({
  ANSWERABLE: "answerable",
  REFUSE: "refuse",
});

export const UNCERTAINTY_REASONS = Object.freeze({
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
  SOURCE_CONFLICT: "source_conflict",
  VERSION_UNKNOWN: "version_unknown",
  OUT_OF_SCOPE: "out_of_scope",
  ENTITY_UNKNOWN: "entity_unknown",
});

export const RUN_STATUSES = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  PARTIAL: "partial",
});

export const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  OUT_OF_SCOPE: "out_of_scope",
  INSUFFICIENT_EVIDENCE: "insufficient_evidence",
  SOURCE_CONFLICT: "source_conflict",
  VERSION_UNKNOWN: "version_unknown",
  ENTITY_UNKNOWN: "entity_unknown",
  CONFIGURATION_ERROR: "configuration_error",
  DEPENDENCY_UNAVAILABLE: "dependency_unavailable",
  INTERNAL_ERROR: "internal_error",
});

export const AUTHORITY_RANKS = Object.freeze({
  [SOURCE_KINDS.HOYOLAB]: 1,
  [SOURCE_KINDS.GENSHIN_DB]: 2,
  [SOURCE_KINDS.FANDOM]: 3,
});

export const DOMAIN_ID_PREFIXES = Object.freeze({
  source: "src",
  entity: "ent",
  fact: "fact",
  claim: "claim",
  chunk: "chunk",
  query: "qry",
  evidence: "evd",
  answer: "ans",
  case: "case",
  run: "run",
  citation: "cit",
});

const PREFIX_TO_KIND = Object.freeze(
  Object.fromEntries(
    Object.entries(DOMAIN_ID_PREFIXES).map(([kind, prefix]) => [prefix, kind]),
  ),
);
const DOMAIN_ID_PATTERN = /^([a-z]+):[a-z0-9][a-z0-9._-]*$/;

/**
 * @param {keyof typeof DOMAIN_ID_PREFIXES} kind
 * @param {unknown} key
 * @returns {string}
 * @throws {TypeError} when kind or key is invalid
 */
export function createDomainId(kind, key) {
  const prefix = DOMAIN_ID_PREFIXES[kind];
  if (!prefix) {
    throw new TypeError(`Unknown domain ID kind: ${kind}`);
  }
  if (key === undefined || key === null) {
    throw new TypeError("Domain ID key is required.");
  }

  const normalizedKey = String(key)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalizedKey) {
    throw new TypeError("Domain ID key must contain an alphanumeric character.");
  }

  return `${prefix}:${normalizedKey}`;
}

/**
 * @param {unknown} value
 * @param {string | undefined} expectedKind
 * @returns {boolean}
 */
export function isDomainId(value, expectedKind) {
  if (typeof value !== "string") {
    return false;
  }

  const match = DOMAIN_ID_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const kind = PREFIX_TO_KIND[match[1]];
  return kind !== undefined && (expectedKind === undefined || kind === expectedKind);
}

/**
 * @param {unknown} value
 * @param {string | undefined} expectedKind
 * @returns {string}
 * @throws {TypeError} when value is not a matching domain ID
 */
export function assertDomainId(value, expectedKind) {
  if (!isDomainId(value, expectedKind)) {
    const suffix = expectedKind ? ` for ${expectedKind}` : "";
    throw new TypeError(`Invalid domain ID${suffix}: ${value}`);
  }

  return value;
}

export const GAME_VERSION_UNKNOWN = "unknown";

const GAME_VERSION_RANGE_SEPARATOR = /\s*(?:\.\.|-|–|—|to)\s*/iu;
const GAME_VERSION_SEGMENTS_PATTERN = /^\d+(?:\.\d+)*$/u;

/**
 * Parse a game version string into a comparable descriptor.
 *
 * Shared here so version semantics stay identical across the data, query, and
 * policy layers; `unknown` is preserved as its own status and must never be
 * treated as the current version.
 *
 * @param {unknown} value
 * @returns {{ status: string, min?: number[], max?: number[] }}
 */
export function parseGameVersion(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return { status: VERSION_STATUSES.UNKNOWN };
  }
  if (value === GAME_VERSION_UNKNOWN) {
    return { status: VERSION_STATUSES.UNKNOWN };
  }

  const segments = value.split(GAME_VERSION_RANGE_SEPARATOR).filter((part) => part.length > 0);
  if (segments.length === 2) {
    const min = toVersionSegments(segments[0]);
    const max = toVersionSegments(segments[1]);
    if (min === undefined || max === undefined || compareVersionSegments(min, max) > 0) {
      return { status: VERSION_STATUSES.UNKNOWN };
    }
    return { status: VERSION_STATUSES.RANGE, min, max };
  }

  const explicit = toVersionSegments(value);
  return explicit === undefined
    ? { status: VERSION_STATUSES.UNKNOWN }
    : { status: VERSION_STATUSES.EXPLICIT, min: explicit, max: explicit };
}

/**
 * Compare two explicit game versions segment by segment.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {number | undefined} undefined when either side is not explicit
 */
export function compareGameVersions(left, right) {
  const parsedLeft = parseGameVersion(left);
  const parsedRight = parseGameVersion(right);
  if (
    parsedLeft.status !== VERSION_STATUSES.EXPLICIT ||
    parsedRight.status !== VERSION_STATUSES.EXPLICIT
  ) {
    return undefined;
  }
  return compareVersionSegments(parsedLeft.min, parsedRight.min);
}

/**
 * @param {unknown} value
 * @returns {number[] | undefined}
 */
function toVersionSegments(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!GAME_VERSION_SEGMENTS_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed.split(".").map(Number);
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @returns {number}
 */
function compareVersionSegments(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export const DOMAIN_CONTRACT_FIXTURE = Object.freeze({
  entityTypes: Object.freeze(Object.values(ENTITY_TYPES)),
  sourceKinds: Object.freeze(Object.values(SOURCE_KINDS)),
  answerStatuses: Object.freeze(Object.values(ANSWER_STATUSES)),
  versionStatuses: Object.freeze(Object.values(VERSION_STATUSES)),
  validityStatuses: Object.freeze(Object.values(VALIDITY_STATUSES)),
  queryCategories: Object.freeze(Object.values(QUERY_CATEGORIES)),
  versionConstraints: Object.freeze(Object.values(VERSION_CONSTRAINTS)),
  retrievalModes: Object.freeze(Object.values(RETRIEVAL_MODES)),
  spoilerLevels: Object.freeze(Object.values(SPOILER_LEVELS)),
  supportTypes: Object.freeze(Object.values(SUPPORT_TYPES)),
  answerability: Object.freeze(Object.values(ANSWERABILITY)),
  uncertaintyReasons: Object.freeze(Object.values(UNCERTAINTY_REASONS)),
  runStatuses: Object.freeze(Object.values(RUN_STATUSES)),
  errorCodes: Object.freeze(Object.values(ERROR_CODES)),
  authorityRanks: AUTHORITY_RANKS,
  idPrefixes: DOMAIN_ID_PREFIXES,
});
